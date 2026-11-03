// Sends natural-language requirement + catalog to Meta, validates returned plan.
// Never reveals seeded bug or expected sequence.

import { catalogDescription, BUSINESS_REQUIREMENT } from "./catalog.js";
import { modelConfig, resolveBudgets, MAX_ATTEMPTS, buildChatRequestBody, fromMetaEnvelope, fromEligiblePlan, ELIGIBLE_PLAN_CONTRACT, REFUND_PLAN_CONTRACT, UPSTREAM_TIMEOUT_MS } from "./metaClient.js";

// Concise eligible-plan prompt for already-eligible live UI requests (M1.5).
// Domain classification is deterministic and done before inference, so the
// model only generates a coherent test scenario. No schema dump, no tools,
// no tool_choice, no policy bypass language.
function buildEligiblePlanPrompt({ businessRequirement }) {
  const catalog = catalogDescription();
  return [
    {
      role: "system",
      content:
        "You are a QA test planner for a fictional refund service. " +
        "The requirement below is already eligible. Produce one coherent test scenario " +
        "that exercises cumulative accepted refunds against a captured-payment cap, " +
        "using only allowed catalog operations. " +
        "Return STRICT JSON with exactly {interpretedRule, operations}. " +
        "Do not execute tools or external actions. " +
        "Do not fabricate facts outside the requirement and catalog.",
    },
    {
      role: "user",
      content: JSON.stringify({ businessRequirement, catalog }, null, 2),
    },
  ];
}

// Build prompt for refund invariant. No bug disclosure.
function buildRefundPrompt({ businessRequirement }) {
  const catalog = catalogDescription();
  return [
    {
      role: "system",
      content:
        "You are a QA test planner for a fictional refund service. " +
        "Translate the business requirement into a bounded JSON test plan using ONLY allowed operations. " +
        "Return STRICT JSON as a discriminated envelope with exactly one top-level key: result. " +
        "For a supported plan return {\"result\":{\"outcome\":\"supported\", \"version\":\"1.0\", \"ruleId\":\"refund-cap\", \"businessRequirement\":..., \"interpretedRule\":..., \"operations\":[...]}}. " +
        "interpretedRule is your one-sentence restatement. operations is an array of 2..8 steps using only: " +
        "createOrder, requestRefund, assertTotalRefunds, assertRefundStatus. version must be \"1.0\". ruleId must be \"refund-cap\". businessRequirement is the original text. " +
        "Each operation MUST be a flat object with an 'op' field, e.g. {\"op\":\"createOrder\",\"orderId\":\"order-1\",\"capturedCents\":10000}. " +
        "Do NOT wrap operations as {\"createOrder\":{...}}. Include explicit example shapes: " +
        "{\"op\":\"createOrder\",\"orderId\":\"order-1\",\"capturedCents\":10000}, " +
        "{\"op\":\"requestRefund\",\"orderId\":\"order-1\",\"amountCents\":4000,\"refundId\":\"r1\"}, " +
        "{\"op\":\"assertRefundStatus\",\"refundId\":\"r1\",\"expectedStatus\":\"accepted\"}, " +
        "{\"op\":\"assertTotalRefunds\",\"orderId\":\"order-1\",\"expectedCents\":4000}. " +
        "Include a valid single-refund scenario and a scenario where two refunds collectively exceed captured payment. " +
        "Use realistic cents values (e.g. 10000 = $100). Never invent other operation types or fields. " +
        "If the requirement cannot be expressed with the catalog, return {\"result\":{\"outcome\":\"unsupported\", \"reason\":\"...\"}} instead. " +
        "JSON only, no markdown fences.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          businessRequirement,
          catalog,
          constraints: "No bug hints. No JavaScript code. Only listed operations and fields.",
        },
        null,
        2
      ),
    },
  ];
}

// Apply the META strict envelope contract (no repair, no fabrication).
// For META eligible-plan: convert { interpretedRule, operations } via
// fromEligiblePlan; any noncanonical shape becomes __modelError.
// For META legacy: convert { result: {...} } via fromMetaEnvelope; legacy
// flat payloads (no `result` key) pass through unchanged for backward
// compatibility with recorded/Baseten history and existing mocks. Envelope
// contradictions return the embedded __modelError for fail-closed handling.
function applyMetaContract(parsed, provider, contract) {
  if (provider !== "META") return parsed;
  if (contract === ELIGIBLE_PLAN_CONTRACT) {
    return fromEligiblePlan(parsed);
  }
  const converted = fromMetaEnvelope(parsed);
  if (converted === null) return parsed;
  return converted;
}

// Attach server-owned metadata to a validated eligible-plan generation.
// All three fields are deterministic: version/ruleId fixed, requirement is
// the original validated input. Interpretation and operations MUST come from
// the actual model response; no canned ops, no fallback, no fabrication.
function toCanonicalEligiblePlan(generated, businessRequirement) {
  return {
    version: "1.0",
    ruleId: "refund-cap",
    businessRequirement: String(businessRequirement ?? ""),
    interpretedRule: generated.interpretedRule,
    operations: generated.operations,
  };
}

function extractJson(text) {
  const raw = String(text ?? "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("MALFORMED_MODEL_OUTPUT: model did not return JSON");
    return JSON.parse(match[0]);
  }
}

function buildDiag({ httpStatus, modelId, finishReason, completionTokens, reasoningTokens, hasContent, outputBudget=null, attempts=null, retried=null }){
  const d={ httpStatus: typeof httpStatus==="number"?httpStatus:null, modelId: typeof modelId==="string"?modelId:null, finishReason: typeof finishReason==="string"?finishReason:null, completionTokens: typeof completionTokens==="number"?completionTokens:null, reasoningTokens: typeof reasoningTokens==="number"?reasoningTokens:null, hasContent: Boolean(hasContent)};
  if(typeof outputBudget==="number") d.outputBudget=outputBudget;
  if(typeof attempts==="number") d.attempts=attempts;
  if(typeof retried==="boolean") d.retried=retried;
  return d;
}
const LEGACY_BUDGET=2048;
function isBudgetExhausted(tok,budget){ if(typeof tok!=="number") return false; if(typeof budget!=="number"||!Number.isFinite(budget)) return false; if(tok>=budget-1) return true; return false; }
function isConfirmedTruncation({hasContent,finishReason,completionTokens,budgetUsed}){ if(hasContent) return false; if(finishReason==="length") return true; if(finishReason==="stop") return false; return isBudgetExhausted(completionTokens,budgetUsed); }
function pickNumber(...c){ for(const v of c) if(typeof v==="number"&&Number.isFinite(v)) return v; return null; }
function describeChoice(data){
  const returnedModelId=typeof data?.model==="string"?data.model:null;
  const choice=data?.choices?.[0];
  const finishReason=typeof choice?.finish_reason==="string"?choice.finish_reason:null;
  const message=choice?.message;
  const content=message?.content;
  const hasContent=typeof content==="string"&&content.trim().length>0;
  const completionTokens=pickNumber(data?.usage?.completion_tokens);
  const reasoningTokens=pickNumber(data?.usage?.completion_tokens_details?.reasoning_tokens, data?.usage?.reasoning_tokens);
  return {returnedModelId,finishReason,message,content,hasContent,completionTokens,reasoningTokens};
}
async function postChat({url,apiKey,model,messages,budget,fetchImpl,provider,contract}){
  const resolvedProvider = provider || modelConfig().provider;
  // BASETEN never uses the META eligible-plan contract.
  const effectiveContract = resolvedProvider === "BASETEN" && contract === ELIGIBLE_PLAN_CONTRACT ? REFUND_PLAN_CONTRACT : contract;
  const body = buildChatRequestBody({ provider: resolvedProvider, model, messages, budget, contract: effectiveContract });
  const controller = new AbortController();
  const timeoutMs = typeof UPSTREAM_TIMEOUT_MS === "number" ? UPSTREAM_TIMEOUT_MS : 60000;
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch {}
      const err = new Error("Model request timed out. No answer fabricated.");
      err.name = "AbortError";
      reject(err);
    }, timeoutMs);
  });
  deadline.catch(() => {});
  const cleanup = () => { if (timer) { clearTimeout(timer); timer = null; } };
  try {
    const res = await Promise.race([
      fetchImpl(url,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal}),
      deadline,
    ]);
    if (!res || typeof res.json !== "function") { cleanup(); return res; }
    const originalJson = res.json.bind(res);
    res.json = async () => {
      try {
        return await Promise.race([originalJson(), deadline]);
      } finally {
        cleanup();
      }
    };
    return res;
  } catch (err) {
    cleanup();
    throw err;
  }
}
function sanitizePlannerHint(value){
  if (typeof value !== "string") return "";
  // Never reflect provider text verbatim; keep a status-only note at most.
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (lowered.includes("tool") || lowered.includes("business requirement") || lowered.includes("unsupported") || lowered.includes("you are a qa") || lowered.includes("refund-cap")) {
    return " Provider detail withheld.";
  }
  if (lowered.includes("sk-") || lowered.includes("b10_") || lowered.includes("bearer") || lowered.includes("api key") || lowered.includes("apikey") || lowered.includes("secret") || lowered.includes("reasoning")) {
    return " Provider detail redacted.";
  }
  const cleaned = trimmed.replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").replace(/\s+/g, " ").slice(0, 120);
  return cleaned ? ` Provider says: ${cleaned}` : "";
}
function sanitizePlannerCaught(err){
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  if (/abort/i.test(raw)) return "Model request timed out. No answer fabricated.";
  return "Model request failed. No answer fabricated.";
}
async function retryAfterTruncation({url,apiKey,model,messages,fetchImpl,provider,contract,businessRequirement,initial,retryBudget}){
  let res2;
  try{ res2=await postChat({url,apiKey,model,messages,budget:retryBudget,fetchImpl,provider,contract}); }catch(err){
    const msg = sanitizePlannerCaught(err);
    const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
    const code = /abort/i.test(raw) ? "MODEL_TIMEOUT" : "MODEL_HTTP_ERROR";
    return {__modelError:true,code,message:msg,_diag:buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})};
  }
  const httpStatus2=typeof res2.status==="number"?res2.status:(res2.ok?200:null);
  if(!res2.ok){
    let hint=""; try{ const d=await res2.json(); const m=d?.error?.message||d?.message||d?.error; hint=sanitizePlannerHint(typeof m==="string"?m:""); }catch(err){ const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? ""); if (/abort/i.test(rawj)) return {__modelError:true,code:"MODEL_TIMEOUT",message:sanitizePlannerCaught(err),_diag:buildDiag({httpStatus:httpStatus2,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})}; }
    return {__modelError:true,code:"MODEL_HTTP_ERROR",message:`Model HTTP ${httpStatus2}.${hint} No answer fabricated.`,_diag:buildDiag({httpStatus:httpStatus2,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})};
  }
  let data2; try{ data2=await res2.json(); }catch(err){ const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? ""); if (/abort/i.test(rawj)) return {__modelError:true,code:"MODEL_TIMEOUT",message:sanitizePlannerCaught(err),_diag:buildDiag({httpStatus:httpStatus2,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})}; return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:"Model returned non-JSON. No answer fabricated.",_diag:buildDiag({httpStatus:httpStatus2,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})}; }
  const d=describeChoice(data2);
  const diag2=()=>buildDiag({httpStatus:httpStatus2,modelId:d.returnedModelId,finishReason:d.finishReason,completionTokens:d.completionTokens,reasoningTokens:d.reasoningTokens,hasContent:d.hasContent,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true});
  if(typeof d.message?.refusal==="string"&&d.message.refusal.trim()) return {__modelError:true,code:"MODEL_REFUSAL",message:"Model refused the request. No answer fabricated.",_diag:diag2()};
  if(d.hasContent){
    try{
      let parsed=extractJson(d.content);
      parsed=applyMetaContract(parsed, provider, contract);
      if (parsed && parsed.__modelError === true) {
        if (!parsed.code) parsed.code = "MODEL_INVALID_OUTPUT";
        parsed._diag = diag2();
        return parsed;
      }
      // M1.5 eligible-plan: build canonical server-owned metadata only after
      // a valid two-field generation. Same path as the initial response.
      if (contract === ELIGIBLE_PLAN_CONTRACT) {
        parsed = toCanonicalEligiblePlan(parsed, businessRequirement);
      }
      let p=parsed; if(p&&Array.isArray(p.operations)){ const ops=p.operations.map(raw=>{ if(raw&&typeof raw==="object"&&!raw.op){ const keys=Object.keys(raw); if(keys.length===1&&["createOrder","requestRefund","assertTotalRefunds","assertRefundStatus"].includes(keys[0])&&typeof raw[keys[0]]==="object") return {op:keys[0],...raw[keys[0]]}; } return raw; }); p={...p,operations:ops}; } if(data2?.model) p._diag=diag2(); else p._diag=diag2(); return p;
    }catch{ return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:"Model returned malformed JSON. No answer fabricated.",_diag:diag2()}; }
  }
  if(d.finishReason==="length") return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:`Model output truncated (finish_reason=length, budget=${initial}->${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,_diag:diag2()};
  if(isBudgetExhausted(d.completionTokens,retryBudget)) return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:`Model output exhausted the token budget (${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,_diag:diag2()};
  return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:"Model returned empty content. No answer fabricated.",_diag:diag2()};
}

export async function generateTestPlan({ businessRequirement = BUSINESS_REQUIREMENT, fetchImpl = fetch, maxTokens, contract } = {}) {
  let cfg;
  try {
    cfg = modelConfig();
  } catch (err) {
    return { __modelError: true, message: `Model configuration error: ${err.message} No answer fabricated.`, _diag: buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:null,attempts:1,retried:false}) };
  }
  const { apiKey, model, chatUrl, provider } = cfg;
  if (!apiKey) {
    const hint = provider === "META" ? "Missing MODEL_API_KEY. Set it in .env.local (never commit it)." : "Missing BASETEN_API_KEY. Set it in .env.local (never commit it).";
    return { __modelError: true, message: hint, _diag: buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:null,attempts:1,retried:false}) };
  }
  // Contract selection is server-internal only. Untrusted callers pass no
  // contract (legacy two-outcome META envelope or Baseten flat shape).
  // The live /api/interpret route passes eligible-plan explicitly. For
  // BASETEN the eligible-plan contract is not applicable: keep the legacy
  // flat shape with no reasoning/tools changes.
  const selectedContract = provider === "BASETEN" ? REFUND_PLAN_CONTRACT : (contract || REFUND_PLAN_CONTRACT);
  const budgets = resolveBudgets({ maxTokens, provider });
  const initial = budgets.initial;
  const retryBudget = budgets.retry;
  const messages = selectedContract === ELIGIBLE_PLAN_CONTRACT ? buildEligiblePlanPrompt({ businessRequirement }) : buildRefundPrompt({ businessRequirement });
  const url = chatUrl;
  let res;
  try { res = await postChat({url,apiKey,model,messages,budget:initial,fetchImpl,provider,contract:selectedContract}); } catch(err){
    const msg = sanitizePlannerCaught(err);
    const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
    const code = /abort/i.test(raw) ? "MODEL_TIMEOUT" : "MODEL_HTTP_ERROR";
    return {__modelError:true,code,message:msg,_diag:buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})};
  }
  const httpStatus=typeof res.status==="number"?res.status:(res.ok?200:null);
  if(!res.ok){ let hint=""; try{ const d=await res.json(); const m=d?.error?.message||d?.message||d?.error; hint=sanitizePlannerHint(typeof m==="string"?m:""); }catch(err){ const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? ""); if (/abort/i.test(rawj)) return {__modelError:true,code:"MODEL_TIMEOUT",message:sanitizePlannerCaught(err),_diag:buildDiag({httpStatus,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; } return {__modelError:true,code:"MODEL_HTTP_ERROR",message:`Model HTTP ${httpStatus}.${hint} No answer fabricated.`,_diag:buildDiag({httpStatus,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; }
  let data; try{ data=await res.json(); }catch(err){ const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? ""); if (/abort/i.test(rawj)) return {__modelError:true,code:"MODEL_TIMEOUT",message:sanitizePlannerCaught(err),_diag:buildDiag({httpStatus,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:"Model returned non-JSON. No answer fabricated.",_diag:buildDiag({httpStatus,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; }
  const first=describeChoice(data);
  const diag=()=>buildDiag({httpStatus,modelId:first.returnedModelId,finishReason:first.finishReason,completionTokens:first.completionTokens,reasoningTokens:first.reasoningTokens,hasContent:first.hasContent,outputBudget:initial,attempts:1,retried:false});
  if(typeof first.message?.refusal==="string"&&first.message.refusal.trim()) return {__modelError:true,code:"MODEL_REFUSAL",message:"Model refused the request. No answer fabricated.",_diag:diag()};
  if(!first.hasContent){
    if(isConfirmedTruncation({hasContent:false,finishReason:first.finishReason,completionTokens:first.completionTokens,budgetUsed:initial})){
      return await retryAfterTruncation({url,apiKey,model,messages,fetchImpl,provider,contract:selectedContract,businessRequirement,initial,retryBudget});
    }
    return {__modelError:true,code:"MODEL_INVALID_OUTPUT",message:"Model returned empty content. No answer fabricated.",_diag:diag()};
  }
  try {
    let parsed = extractJson(first.content);
    parsed = applyMetaContract(parsed, provider, selectedContract);
    if (parsed && parsed.__modelError === true) {
      if (!parsed.code) parsed.code = "MODEL_INVALID_OUTPUT";
      parsed._diag = diag();
      return parsed;
    }
    // Eligible-plan: canonical metadata is server-owned; wrap after a valid
    // two-field generation. Legacy META/Baseten keep wrapped-op unwrap.
    if (selectedContract === ELIGIBLE_PLAN_CONTRACT) {
      parsed = toCanonicalEligiblePlan(parsed, businessRequirement);
    }
    if (parsed && Array.isArray(parsed.operations) && selectedContract !== ELIGIBLE_PLAN_CONTRACT) {
      const ops = parsed.operations.map((raw) => {
        if (raw && typeof raw === "object" && !raw.op) {
          const keys = Object.keys(raw);
          if (keys.length === 1 && ["createOrder","requestRefund","assertTotalRefunds","assertRefundStatus"].includes(keys[0]) && typeof raw[keys[0]] === "object") {
            return { op: keys[0], ...raw[keys[0]] };
          }
        }
        return raw;
      });
      parsed = { ...parsed, operations: ops };
    }
    if (data?.model) parsed._diag = buildDiag({httpStatus,modelId:data.model,finishReason:first.finishReason,completionTokens:first.completionTokens,reasoningTokens:first.reasoningTokens,hasContent:true,outputBudget:initial,attempts:1,retried:false});
    else parsed._diag = diag();
    return parsed;
  } catch {
    if(first.finishReason==="length") return await retryAfterTruncation({url,apiKey,model,messages,fetchImpl,provider,contract:selectedContract,businessRequirement,initial,retryBudget});
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned malformed JSON. No answer fabricated.",_diag:diag() };
  }
}

export { BUSINESS_REQUIREMENT, buildRefundPrompt, buildEligiblePlanPrompt };
