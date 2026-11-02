// Sends natural-language requirement + catalog to Meta, validates returned plan.
// Never reveals seeded bug or expected sequence.

import { catalogDescription, BUSINESS_REQUIREMENT } from "./catalog.js";
import { basetenConfig, resolveBudgets, MAX_ATTEMPTS } from "./metaClient.js";

// Build prompt for refund invariant. No bug disclosure.
function buildRefundPrompt({ businessRequirement }) {
  const catalog = catalogDescription();
  return [
    {
      role: "system",
      content:
        "You are a QA test planner for a fictional refund service. " +
        "Translate the business requirement into a bounded JSON test plan using ONLY allowed operations. " +
        "Return STRICT JSON with exactly these keys: version, ruleId, businessRequirement, interpretedRule, operations. " +
        "version must be \"1.0\". ruleId must be \"refund-cap\". businessRequirement is the original text. " +
        "interpretedRule is your one-sentence restatement. operations is an array of 2..8 steps using only: " +
        "createOrder, requestRefund, assertTotalRefunds, assertRefundStatus. " +
        "Each operation MUST be a flat object with an 'op' field, e.g. {\"op\":\"createOrder\",\"orderId\":\"order-1\",\"capturedCents\":10000}. " +
        "Do NOT wrap operations as {\"createOrder\":{...}}. Include explicit example shapes: " +
        "{\"op\":\"createOrder\",\"orderId\":\"order-1\",\"capturedCents\":10000}, " +
        "{\"op\":\"requestRefund\",\"orderId\":\"order-1\",\"amountCents\":4000,\"refundId\":\"r1\"}, " +
        "{\"op\":\"assertRefundStatus\",\"refundId\":\"r1\",\"expectedStatus\":\"accepted\"}, " +
        "{\"op\":\"assertTotalRefunds\",\"orderId\":\"order-1\",\"expectedCents\":4000}. " +
        "Include a valid single-refund scenario and a scenario where two refunds collectively exceed captured payment. " +
        "Use realistic cents values (e.g. 10000 = $100). Never invent other operation types or fields. " +
        "If the requirement cannot be expressed with the catalog, return {\"unsupported\":true, \"reason\":\"...\"} instead. " +
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

// Planner uses its own prompt but shares bounded retry contract with metaClient.

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
function isBudgetExhausted(tok,budget){ if(typeof tok!=="number") return false; if(tok>=budget-1) return true; if(tok>=LEGACY_BUDGET-1) return true; return false; }
function isConfirmedTruncation({hasContent,finishReason,completionTokens,budgetUsed}){ if(hasContent) return false; if(finishReason==="length") return true; return isBudgetExhausted(completionTokens,budgetUsed); }
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
async function postChat({url,apiKey,model,messages,budget,fetchImpl}){
  const body={model,temperature:0,max_tokens:budget,response_format:{type:"json_object"},messages};
  return await fetchImpl(url,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
}
async function retryAfterTruncation({url,apiKey,model,messages,fetchImpl,initial,retryBudget}){
  let res2;
  try{ res2=await postChat({url,apiKey,model,messages,budget:retryBudget,fetchImpl}); }catch(err){
    return {__modelError:true,message:`Model request failed: ${err.message}`,_diag:buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})};
  }
  const httpStatus2=typeof res2.status==="number"?res2.status:(res2.ok?200:null);
  if(!res2.ok){
    let hint=""; try{ const d=await res2.json(); const m=d?.error?.message||d?.message||d?.error; if(typeof m==="string"&&m.trim()) hint=` Provider says: ${m.trim().slice(0,200)}`; }catch{}
    return {__modelError:true,message:`Model HTTP ${httpStatus2}.${hint} No answer fabricated.`,_diag:buildDiag({httpStatus:httpStatus2,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})};
  }
  let data2; try{ data2=await res2.json(); }catch{ return {__modelError:true,message:"Model returned non-JSON. No answer fabricated.",_diag:buildDiag({httpStatus:httpStatus2,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true})}; }
  const d=describeChoice(data2);
  const diag2=()=>buildDiag({httpStatus:httpStatus2,modelId:d.returnedModelId,finishReason:d.finishReason,completionTokens:d.completionTokens,reasoningTokens:d.reasoningTokens,hasContent:d.hasContent,outputBudget:retryBudget,attempts:MAX_ATTEMPTS,retried:true});
  if(typeof d.message?.refusal==="string"&&d.message.refusal.trim()) return {__modelError:true,message:"Model refused the request. No answer fabricated.",_diag:diag2()};
  if(d.hasContent){
    try{ const parsed=extractJson(d.content); let p=parsed; if(p&&Array.isArray(p.operations)){ const ops=p.operations.map(raw=>{ if(raw&&typeof raw==="object"&&!raw.op){ const keys=Object.keys(raw); if(keys.length===1&&["createOrder","requestRefund","assertTotalRefunds","assertRefundStatus"].includes(keys[0])&&typeof raw[keys[0]]==="object") return {op:keys[0],...raw[keys[0]]}; } return raw; }); p={...p,operations:ops}; } if(data2?.model) p._diag=diag2(); else p._diag=diag2(); return p; }catch{ return {__modelError:true,message:"Model returned malformed JSON. No answer fabricated.",_diag:diag2()}; }
  }
  if(d.finishReason==="length") return {__modelError:true,message:`Model output truncated (finish_reason=length, budget=${initial}->${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,_diag:diag2()};
  if(isBudgetExhausted(d.completionTokens,retryBudget)) return {__modelError:true,message:`Model output exhausted the token budget (${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,_diag:diag2()};
  return {__modelError:true,message:"Model returned empty content. No answer fabricated.",_diag:diag2()};
}

export async function generateTestPlan({ businessRequirement = BUSINESS_REQUIREMENT, fetchImpl = fetch, maxTokens } = {}) {
  const { apiKey, baseUrl, model } = basetenConfig();
  if (!apiKey) {
    return { __modelError: true, message: "Missing BASETEN_API_KEY. Set it in .env.local (never commit it).", _diag: buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:null,attempts:1,retried:false}) };
  }
  const budgets = resolveBudgets({ maxTokens });
  const initial = budgets.initial;
  const retryBudget = budgets.retry;
  const messages = buildRefundPrompt({ businessRequirement });
  const url = `${baseUrl}/chat/completions`;
  let res;
  try { res = await postChat({url,apiKey,model,messages,budget:initial,fetchImpl}); } catch(err){ return {__modelError:true,message:`Model request failed: ${err.message}`,_diag:buildDiag({httpStatus:null,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; }
  const httpStatus=typeof res.status==="number"?res.status:(res.ok?200:null);
  if(!res.ok){ let hint=""; try{ const d=await res.json(); const m=d?.error?.message||d?.message||d?.error; if(typeof m==="string"&&m.trim()) hint=` Provider says: ${m.trim().slice(0,200)}`; }catch{} return {__modelError:true,message:`Model HTTP ${httpStatus}.${hint} No answer fabricated.`,_diag:buildDiag({httpStatus,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; }
  let data; try{ data=await res.json(); }catch{ return {__modelError:true,message:"Model returned non-JSON. No answer fabricated.",_diag:buildDiag({httpStatus,modelId:null,finishReason:null,completionTokens:null,reasoningTokens:null,hasContent:false,outputBudget:initial,attempts:1,retried:false})}; }
  const first=describeChoice(data);
  const diag=()=>buildDiag({httpStatus,modelId:first.returnedModelId,finishReason:first.finishReason,completionTokens:first.completionTokens,reasoningTokens:first.reasoningTokens,hasContent:first.hasContent,outputBudget:initial,attempts:1,retried:false});
  if(typeof first.message?.refusal==="string"&&first.message.refusal.trim()) return {__modelError:true,message:"Model refused the request. No answer fabricated.",_diag:diag()};
  if(!first.hasContent){
    if(isConfirmedTruncation({hasContent:false,finishReason:first.finishReason,completionTokens:first.completionTokens,budgetUsed:initial})){
      return await retryAfterTruncation({url,apiKey,model,messages,fetchImpl,initial,retryBudget});
    }
    return {__modelError:true,message:"Model returned empty content. No answer fabricated.",_diag:diag()};
  }
  try {
    let parsed = extractJson(first.content);
    if (parsed && Array.isArray(parsed.operations)) {
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
    if(first.finishReason==="length") return await retryAfterTruncation({url,apiKey,model,messages,fetchImpl,initial,retryBudget});
    return { __modelError: true, message: "Model returned malformed JSON. No answer fabricated.",_diag:diag() };
  }
}

export { BUSINESS_REQUIREMENT, buildRefundPrompt };
