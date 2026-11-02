// Server-side Baseten API client (Meta inference only).
// No fallback providers. No client-side key exposure.

// Muse Spark Open uses reasoning tokens that count against the output budget.
// A small max_tokens budget truncates the final answer (finish_reason="length")
// leaving choices[0].message.content empty. The default budget covers
// reasoning + concise structured JSON. One bounded retry with a higher budget
// recovers confirmed truncation only. All other params stay provider-compatible.
const DEFAULT_OUTPUT_TOKENS = 4096;
const RETRY_OUTPUT_TOKENS = 8192;
const MAX_OUTPUT_TOKENS = 16384;
const MIN_OUTPUT_TOKENS = 1024;
// Previous budget kept as a legacy exhaustion signal so empty output with
// ~2048 completion tokens is still classified as budget exhaustion.
const LEGACY_BUDGET = 2048;
const MAX_ATTEMPTS = 2;

const DEFAULT_BASE_URL = "https://inference.baseten.co/v1";
const DEFAULT_MODEL = "meta-models/muse-spark-open-1026";

function config() {
  const apiKey = process.env.BASETEN_API_KEY;
  const baseUrl = (process.env.BASETEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.BASETEN_MODEL || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

function parseBudget(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < MIN_OUTPUT_TOKENS || i > MAX_OUTPUT_TOKENS) return fallback;
  return i;
}

function clampBudget(n, fallback) {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < MIN_OUTPUT_TOKENS) return MIN_OUTPUT_TOKENS;
  if (i > MAX_OUTPUT_TOKENS) return MAX_OUTPUT_TOKENS;
  return i;
}

// Configurable output budget. Precedence: per-call maxTokens, then
// BASETEN_MAX_TOKENS env, then DEFAULT_OUTPUT_TOKENS. Retry budget is the
// explicit BASETEN_RETRY_MAX_TOKENS env when higher than initial, otherwise
// roughly double initial (capped). Never exceeds MAX_OUTPUT_TOKENS.
function resolveBudgets({ maxTokens } = {}) {
  const envInitial = parseBudget(process.env.BASETEN_MAX_TOKENS, null);
  const envRetry = parseBudget(process.env.BASETEN_RETRY_MAX_TOKENS, null);
  const fromArg = clampBudget(typeof maxTokens === "number" ? maxTokens : NaN, null);
  const initial = fromArg ?? envInitial ?? DEFAULT_OUTPUT_TOKENS;
  let retry = envRetry;
  if (typeof retry !== "number" || retry <= initial) {
    retry = Math.min(Math.max(initial * 2, RETRY_OUTPUT_TOKENS, initial + 1024), MAX_OUTPUT_TOKENS);
    if (retry <= initial) retry = Math.min(initial + 1024, MAX_OUTPUT_TOKENS);
  }
  return { initial, retry };
}

function buildPrompt({ question, profile }) {
  const safeProfile = {
    yearsExperience: profile.yearsExperience,
    primarySkill: profile.primarySkill,
    secondarySkills: profile.secondarySkills,
    preferredWorkType: profile.preferredWorkType,
    availableStart: profile.availableStart,
    portfolioUrl: profile.portfolioUrl
  };
  return [
    {
      role: "system",
      content:
        "Interpret one applicant form question using ONLY the given fictional profile. " +
        "Return STRICT JSON with exactly these keys: questionId, interpretation, proposedAnswer, evidenceKeys, confidence. " +
        "Keep interpretation to one short sentence. Keep proposedAnswer under 10 words, or empty string if unknown. " +
        "evidenceKeys uses only needed keys from [yearsExperience, primarySkill, secondarySkills, preferredWorkType, availableStart, portfolioUrl]. " +
        "confidence is 0-1. For work authorization, sponsorship, salary, demographics, or consent, return proposedAnswer as empty string with confidence 0. " +
        "Never invent facts. JSON only."
    },
    {
      role: "user",
      content: JSON.stringify({
        questionId: question.id,
        questionText: question.text,
        profile: safeProfile
      })
    }
  ];
}

function extractJson(text) {
  const raw = String(text ?? "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    // Tolerate code fences.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("MALFORMED_MODEL_OUTPUT: model did not return JSON");
    return JSON.parse(match[0]);
  }
}

function buildDiag({ httpStatus, modelId, finishReason, completionTokens, reasoningTokens, hasContent, outputBudget = null, attempts = null, retried = null }) {
  const diag = {
    httpStatus: typeof httpStatus === "number" ? httpStatus : null,
    modelId: typeof modelId === "string" ? modelId : null,
    finishReason: typeof finishReason === "string" ? finishReason : null,
    completionTokens: typeof completionTokens === "number" ? completionTokens : null,
    reasoningTokens: typeof reasoningTokens === "number" ? reasoningTokens : null,
    hasContent: Boolean(hasContent)
  };
  // Safe retry metadata only: numbers/booleans, no traces, keys, or profile data.
  if (typeof outputBudget === "number") diag.outputBudget = outputBudget;
  if (typeof attempts === "number") diag.attempts = attempts;
  if (typeof retried === "boolean") diag.retried = retried;
  return diag;
}

function isBudgetExhausted(completionTokens, budgetUsed) {
  if (typeof completionTokens !== "number") return false;
  if (completionTokens >= budgetUsed - 1) return true;
  // Legacy signal: 2048 was the prior budget; empty output with that much
  // usage stays classified as exhaustion after the default is raised.
  if (completionTokens >= LEGACY_BUDGET - 1) return true;
  return false;
}

// Confirmed truncation only: empty content with finish_reason=length, or
// empty content with usage at/above the budget. Refusals, finish_reason=stop
// malformed JSON, HTTP errors, and ordinary empty content never qualify.
function isConfirmedTruncation({ hasContent, finishReason, completionTokens, budgetUsed }) {
  if (hasContent) return false;
  if (finishReason === "length") return true;
  return isBudgetExhausted(completionTokens, budgetUsed);
}

function describeChoice(data) {
  const returnedModelId = typeof data?.model === "string" ? data.model : null;
  const choice = data?.choices?.[0];
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const message = choice?.message;
  const content = message?.content;
  const hasContent = typeof content === "string" && content.trim().length > 0;
  const completionTokens = pickNumber(data?.usage?.completion_tokens);
  const reasoningTokens = pickNumber(
    data?.usage?.completion_tokens_details?.reasoning_tokens,
    data?.usage?.reasoning_tokens
  );
  return { returnedModelId, finishReason, message, content, hasContent, completionTokens, reasoningTokens };
}

function pickNumber(...candidates) {
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

async function postChat({ url, apiKey, model, messages, budget, fetchImpl }) {
  const body = {
    model,
    temperature: 0,
    max_tokens: budget,
    response_format: { type: "json_object" },
    messages
  };
  // NOTE: no reasoning_effort param sent. Compatibility with the Baseten
  // hackathon model is unverified, so the default reasoning behavior is kept.
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return res;
}

// One bounded retry with a higher budget, same provider/model/messages.
// Never retries HTTP errors, refusals, malformed JSON (stop), validation
// failures, or ordinary empty content. At most 2 total attempts.
async function retryAfterTruncation({ url, apiKey, model, messages, fetchImpl, initial, retryBudget, exhausted, partialJson }) {
  let res2;
  try {
    res2 = await postChat({ url, apiKey, model, messages, budget: retryBudget, fetchImpl });
  } catch (err) {
    return {
      __modelError: true,
      message: `Model request failed: ${err.message}`,
      _diag: buildDiag({ httpStatus: null, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true })
    };
  }
  const httpStatus2 = typeof res2.status === "number" ? res2.status : (res2.ok ? 200 : null);
  if (!res2.ok) {
    let providerHint = "";
    try {
      const errData = await res2.json();
      const errMsg = errData?.error?.message || errData?.message || errData?.error;
      if (typeof errMsg === "string" && errMsg.trim()) {
        providerHint = ` Provider says: ${errMsg.trim().slice(0, 200)}`;
      }
    } catch {
      // Ignore body parse errors on error path; status is enough.
    }
    return {
      __modelError: true,
      message: `Model HTTP ${httpStatus2}.${providerHint} No answer fabricated.`,
      _diag: buildDiag({ httpStatus: httpStatus2, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true })
    };
  }
  let data2;
  try {
    data2 = await res2.json();
  } catch {
    return {
      __modelError: true,
      message: "Model returned non-JSON. No answer fabricated.",
      _diag: buildDiag({ httpStatus: httpStatus2, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true })
    };
  }
  const d = describeChoice(data2);
  const diag2 = () =>
    buildDiag({ httpStatus: httpStatus2, modelId: d.returnedModelId, finishReason: d.finishReason, completionTokens: d.completionTokens, reasoningTokens: d.reasoningTokens, hasContent: d.hasContent, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true });
  const refusal2 = d.message?.refusal;
  if (typeof refusal2 === "string" && refusal2.trim()) {
    return { __modelError: true, message: "Model refused the request. No answer fabricated.", _diag: diag2() };
  }
  if (d.hasContent) {
    try {
      const parsed = extractJson(d.content);
      // Safe retry metadata only; validator ignores the extra _diag key.
      return { ...parsed, _diag: diag2() };
    } catch {
      return { __modelError: true, message: "Model returned malformed JSON. No answer fabricated.", _diag: diag2() };
    }
  }
  // Retry also empty: report final budget and attempts. No further retries.
  if (d.finishReason === "length") {
    return {
      __modelError: true,
      message: `Model output truncated (finish_reason=length, budget=${initial}->${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,
      _diag: diag2()
    };
  }
  if (isBudgetExhausted(d.completionTokens, retryBudget)) {
    return {
      __modelError: true,
      message: `Model output exhausted the token budget (${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,
      _diag: diag2()
    };
  }
  if (exhausted) {
    return {
      __modelError: true,
      message: `Model output exhausted the token budget (${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,
      _diag: diag2()
    };
  }
  if (partialJson) {
    return { __modelError: true, message: "Model returned malformed JSON. No answer fabricated.", _diag: diag2() };
  }
  return { __modelError: true, message: "Model returned empty content. No answer fabricated.", _diag: diag2() };
}

export async function interpretWithMeta({ question, profile, fetchImpl = fetch, maxTokens } = {}) {
  const { apiKey, baseUrl, model } = config();
  if (!apiKey) {
    return { __modelError: true, message: "Missing BASETEN_API_KEY. Set it in .env.local (never commit it)." };
  }
  const budgets = resolveBudgets({ maxTokens });
  const initial = budgets.initial;
  const retryBudget = budgets.retry;
  const url = `${baseUrl}/chat/completions`;
  const messages = buildPrompt({ question, profile });
  let res;
  try {
    res = await postChat({ url, apiKey, model, messages, budget: initial, fetchImpl });
  } catch (err) {
    return {
      __modelError: true,
      message: `Model request failed: ${err.message}`,
      _diag: buildDiag({ httpStatus: null, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false })
    };
  }
  const httpStatus = typeof res.status === "number" ? res.status : (res.ok ? 200 : null);
  if (!res.ok) {
    let providerHint = "";
    try {
      const errData = await res.json();
      const errMsg = errData?.error?.message || errData?.message || errData?.error;
      if (typeof errMsg === "string" && errMsg.trim()) {
        // Truncated provider message only; never includes keys or prompts.
        providerHint = ` Provider says: ${errMsg.trim().slice(0, 200)}`;
      }
    } catch {
      // Ignore body parse errors on error path; status is enough.
    }
    return {
      __modelError: true,
      message: `Model HTTP ${httpStatus}.${providerHint} No answer fabricated.`,
      _diag: buildDiag({ httpStatus, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false })
    };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return {
      __modelError: true,
      message: "Model returned non-JSON. No answer fabricated.",
      _diag: buildDiag({ httpStatus, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false })
    };
  }
  const first = describeChoice(data);
  const diag = () =>
    buildDiag({ httpStatus, modelId: first.returnedModelId, finishReason: first.finishReason, completionTokens: first.completionTokens, reasoningTokens: first.reasoningTokens, hasContent: first.hasContent, outputBudget: initial, attempts: 1, retried: false });
  // Model refusal is distinct from empty content: never fabricate, never retry.
  const refusal = first.message?.refusal;
  if (typeof refusal === "string" && refusal.trim()) {
    return { __modelError: true, message: "Model refused the request. No answer fabricated.", _diag: diag() };
  }
  if (!first.hasContent) {
    // Never use reasoning_content as the final answer; it is private trace,
    // not the validated JSON contract.
    if (isConfirmedTruncation({ hasContent: false, finishReason: first.finishReason, completionTokens: first.completionTokens, budgetUsed: initial })) {
      return await retryAfterTruncation({ url, apiKey, model, messages, fetchImpl, initial, retryBudget, exhausted: isBudgetExhausted(first.completionTokens, initial) && first.finishReason !== "length", partialJson: false });
    }
    return { __modelError: true, message: "Model returned empty content. No answer fabricated.", _diag: diag() };
  }
  try {
    return extractJson(first.content);
  } catch {
    // Truncated partial JSON (finish_reason=length) qualifies for one retry.
    // Ordinary malformed JSON with finish_reason=stop never retries.
    if (first.finishReason === "length") {
      return await retryAfterTruncation({ url, apiKey, model, messages, fetchImpl, initial, retryBudget, exhausted: false, partialJson: true });
    }
    return { __modelError: true, message: "Model returned malformed JSON. No answer fabricated.", _diag: diag() };
  }
}

export { config as basetenConfig };
export {
  DEFAULT_OUTPUT_TOKENS,
  RETRY_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  MAX_ATTEMPTS,
  LEGACY_BUDGET,
  resolveBudgets
};
