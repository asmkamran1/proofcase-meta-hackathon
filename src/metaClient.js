// Server-side multi-provider model client (META native + BASETEN legacy).
// No fallback providers. No client-side key exposure.
//
// META (default for new installs): https://api.meta.ai/v1, muse-spark-1.3,
// max_completion_tokens, no temperature override, JSON Schema output.
// BASETEN (legacy): temperature:0, max_tokens, json_object (unchanged).
// Shared: bounded budgets, one truncation-only retry, finite upstream
// timeout, sanitized diagnostics, no fabricated plans.
const DEFAULT_OUTPUT_TOKENS = 4096;
const RETRY_OUTPUT_TOKENS = 8192;
const MAX_OUTPUT_TOKENS = 16384;
const MIN_OUTPUT_TOKENS = 1024;
// Previous budget kept as an exported diagnostic constant only. It must never
// trigger exhaustion or retry on its own: a completed stop response must be
// judged against the active request budget.
const LEGACY_BUDGET = 2048;
const MAX_ATTEMPTS = 2;

// Finite upstream inference timeout: abort safely, no uncertain retry.
const UPSTREAM_TIMEOUT_MS = 60000;

const DEFAULT_META_BASE_URL = "https://api.meta.ai/v1";
const DEFAULT_META_MODEL = "muse-spark-1.3";
const DEFAULT_BASETEN_BASE_URL = "https://inference.baseten.co/v1";
const DEFAULT_BASETEN_MODEL = "meta-models/muse-spark-open-1026";

// Strict discriminated JSON Schema for META structured output (strict:true).
// Root is a plain object with a single required `result` key whose value is
// a nested anyOf: either a supported plan variant (outcome "supported" plus
// canonical plan fields) or an abstention variant (outcome "unsupported" plus
// reason). Every object sets additionalProperties:false and every required
// array lists all declared properties, per documented strict subset. Local
// testPlanValidator remains authoritative; this schema only constrains
// generation so malformed top-level keys cannot be produced.
// Keeping both outcomes is intentional: a model may genuinely abstain. An
// unsupported output for an eligible requirement is classified downstream as
// model abstention/failure, never as proof the requirement is out of scope.
// No tools, no tool_choice, no policy bypass are ever sent.
const TEST_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    result: {
      anyOf: [
        {
          type: "object",
          properties: {
            outcome: { type: "string", enum: ["supported"] },
            version: { type: "string", enum: ["1.0"] },
            ruleId: { type: "string", enum: ["refund-cap"] },
            businessRequirement: { type: "string" },
            interpretedRule: { type: "string" },
            operations: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["createOrder"] },
                      orderId: { type: "string" },
                      capturedCents: { type: "number" },
                    },
                    required: ["op", "orderId", "capturedCents"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["requestRefund"] },
                      orderId: { type: "string" },
                      amountCents: { type: "number" },
                      refundId: { type: "string" },
                    },
                    required: ["op", "orderId", "amountCents", "refundId"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["assertTotalRefunds"] },
                      orderId: { type: "string" },
                      expectedCents: { type: "number" },
                    },
                    required: ["op", "orderId", "expectedCents"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["assertRefundStatus"] },
                      refundId: { type: "string" },
                      expectedStatus: { type: "string", enum: ["accepted", "rejected"] },
                    },
                    required: ["op", "refundId", "expectedStatus"],
                    additionalProperties: false,
                  },
                ],
              },
            },
          },
          required: ["outcome", "version", "ruleId", "businessRequirement", "interpretedRule", "operations"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            outcome: { type: "string", enum: ["unsupported"] },
            reason: { type: "string" },
          },
          required: ["outcome", "reason"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["result"],
  additionalProperties: false,
};

function isLoopbackHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

function sanitizeBaseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("Empty model base URL.");
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error("Malformed model base URL.");
  }
  if (u.username || u.password) throw new Error("Model base URL must not embed credentials.");
  if (u.search && u.search !== "") throw new Error("Model base URL must not contain a query string.");
  if (u.hash && u.hash !== "") throw new Error("Model base URL must not contain a fragment.");
  const proto = u.protocol.toLowerCase();
  if (proto !== "https:" && !(proto === "http:" && isLoopbackHostname(u.hostname))) {
    throw new Error("Model base URL must use HTTPS.");
  }
  let path = u.pathname.replace(/\/+$/, "");
  if (!path.toLowerCase().endsWith("/chat/completions")) {
    path = `${path}/chat/completions`;
  }
  path = path.replace(/\/v1\/v1(\/|$)/, "/v1$1");
  const port = u.port ? `:${u.port}` : "";
  return `${u.protocol}//${u.hostname}${port}${path}`;
}

function sanitizeBaseForConfig(raw) {
  const s = String(raw || "").trim();
  try {
    const u = new URL(s);
    const port = u.port ? `:${u.port}` : "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname}${port}${path}`;
  } catch {
    return "[invalid-url]";
  }
}

function basetenOnlyConfig() {
  const apiKey = process.env.BASETEN_API_KEY;
  const rawBase = process.env.BASETEN_BASE_URL || DEFAULT_BASETEN_BASE_URL;
  const baseUrl = String(rawBase).trim().replace(/\/+$/, "");
  const model = process.env.BASETEN_MODEL || DEFAULT_BASETEN_MODEL;
  return { apiKey, baseUrl, model };
}

// Legacy alias: Baseten-only, never returns Meta configuration.
function config() {
  return basetenOnlyConfig();
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

// Configurable output budget. Precedence: per-call maxTokens, then provider env, then default.
// META reads META_* / MODEL_* only; BASETEN reads BASETEN_* only. Stale
// Baseten values never override an explicitly selected META configuration.
function resolveBudgets({ maxTokens, provider } = {}) {
  const p = String(provider || process.env.MODEL_PROVIDER || "").trim().toUpperCase();
  const isMeta = p === "" || p === "META";
  const envInitialRaw = isMeta
    ? (process.env.META_MAX_TOKENS ?? process.env.MODEL_MAX_TOKENS ?? null)
    : (process.env.BASETEN_MAX_TOKENS ?? null);
  const envRetryRaw = isMeta
    ? (process.env.META_RETRY_MAX_TOKENS ?? process.env.MODEL_RETRY_MAX_TOKENS ?? null)
    : (process.env.BASETEN_RETRY_MAX_TOKENS ?? null);
  const envInitial = parseBudget(envInitialRaw, null);
  const envRetry = parseBudget(envRetryRaw, null);
  const fromArg = clampBudget(typeof maxTokens === "number" ? maxTokens : NaN, null);
  const initial = fromArg ?? envInitial ?? DEFAULT_OUTPUT_TOKENS;
  let retry = envRetry;
  if (typeof retry !== "number" || retry <= initial) {
    retry = Math.min(Math.max(initial * 2, RETRY_OUTPUT_TOKENS, initial + 1024), MAX_OUTPUT_TOKENS);
    if (retry <= initial) retry = Math.min(initial + 1024, MAX_OUTPUT_TOKENS);
  }
  return { initial, retry };
}

// Explicit provider configuration, server-side only. Defaults to META.
// Throws on unknown provider or unsafe endpoint. Missing keys return
// undefined so callers emit sanitized errors; never cross-provider fallback.
function modelConfig() {
  const rawProvider = process.env.MODEL_PROVIDER;
  const provider = rawProvider == null || String(rawProvider).trim() === "" ? "META" : String(rawProvider).trim().toUpperCase();
  if (provider !== "META" && provider !== "BASETEN") {
    throw new Error(`Unknown MODEL_PROVIDER "${String(rawProvider).slice(0, 32)}". Expected META or BASETEN.`);
  }
  if (provider === "META") {
    const apiKey = process.env.MODEL_API_KEY;
    const rawBase = process.env.META_BASE_URL || DEFAULT_META_BASE_URL;
    const model = process.env.META_MODEL || DEFAULT_META_MODEL;
    const chatUrl = sanitizeBaseUrl(rawBase);
    const baseUrl = String(rawBase).trim().replace(/\/+$/, "");
    return { provider, apiKey, baseUrl, model, chatUrl };
  }
  const apiKey = process.env.BASETEN_API_KEY;
  const rawBase = process.env.BASETEN_BASE_URL || DEFAULT_BASETEN_BASE_URL;
  const model = process.env.BASETEN_MODEL || DEFAULT_BASETEN_MODEL;
  const chatUrl = sanitizeBaseUrl(rawBase);
  const baseUrl = String(rawBase).trim().replace(/\/+$/, "");
  return { provider, apiKey, baseUrl, model, chatUrl };
}

// Safe diagnostics only: provider, model, sanitized endpoint, hasKey.
function describeConfig() {
  const cfg = modelConfig();
  return { provider: cfg.provider, model: cfg.model, baseUrl: sanitizeBaseForConfig(cfg.baseUrl), hasKey: !!cfg.apiKey };
}

// Centralized provider-specific Chat Completions bodies.
// META refund-plan: max_completion_tokens, no temperature, strict JSON Schema envelope.
// META applicant-interpretation: max_completion_tokens, no temperature, plain
// json_object (never the refund-plan schema).
// BASETEN: legacy shape (temperature 0, max_tokens, json_object) unchanged.
// Contract selection is internal only; browser JSON must never select it.
const REFUND_PLAN_CONTRACT = "refund-plan";
const APPLICANT_CONTRACT = "applicant-interpretation";
const ELIGIBLE_PLAN_CONTRACT = "eligible-plan";

// Deterministic eligible-plan schema for live META UI generation (M1.5).
// Exactly two root properties: interpretedRule (nonempty string) and
// operations (array of allowlisted catalog operations). No outcome,
// no unsupported branch, no version/ruleId/businessRequirement from model:
// those three metadata fields are server-owned and attached after validation.
// Every object sets additionalProperties:false; required arrays list all
// declared properties. Numeric bounds and reference checks stay in the
// local testPlanValidator, which remains authoritative.
const ELIGIBLE_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    interpretedRule: { type: "string", minLength: 1 },
    operations: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              op: { type: "string", enum: ["createOrder"] },
              orderId: { type: "string" },
              capturedCents: { type: "number" },
            },
            required: ["op", "orderId", "capturedCents"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              op: { type: "string", enum: ["requestRefund"] },
              orderId: { type: "string" },
              amountCents: { type: "number" },
              refundId: { type: "string" },
            },
            required: ["op", "orderId", "amountCents", "refundId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              op: { type: "string", enum: ["assertTotalRefunds"] },
              orderId: { type: "string" },
              expectedCents: { type: "number" },
            },
            required: ["op", "orderId", "expectedCents"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              op: { type: "string", enum: ["assertRefundStatus"] },
              refundId: { type: "string" },
              expectedStatus: { type: "string", enum: ["accepted", "rejected"] },
            },
            required: ["op", "refundId", "expectedStatus"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["interpretedRule", "operations"],
  additionalProperties: false,
};
function buildChatRequestBody({ provider, model, messages, budget, contract } = {}) {
  const selected = contract || REFUND_PLAN_CONTRACT;
  if (provider === "META") {
    if (selected === APPLICANT_CONTRACT) {
      return { model, max_completion_tokens: budget, response_format: { type: "json_object" }, messages };
    }
    // M1.5 eligible-plan: two-field strict schema + documented low reasoning.
    // All other META contracts keep the legacy two-outcome schema with no
    // reasoning override and no tools/tool_choice on any path.
    if (selected === ELIGIBLE_PLAN_CONTRACT) {
      return { model, reasoning_effort: "low", max_completion_tokens: budget, response_format: { type: "json_schema", json_schema: { name: "eligible_refund_plan", strict: true, schema: ELIGIBLE_PLAN_JSON_SCHEMA } }, messages };
    }
    return { model, max_completion_tokens: budget, response_format: { type: "json_schema", json_schema: { name: "refund_test_plan", strict: true, schema: TEST_PLAN_JSON_SCHEMA } }, messages };
  }
  return { model, temperature: 0, max_tokens: budget, response_format: { type: "json_object" }, messages };
}

// Convert a strict META envelope ({ result: { outcome, ... } }) into the
// existing internal flat contract. Returns:
// - a flat supported plan { version, ruleId, businessRequirement,
//   interpretedRule, operations } when outcome is "supported",
// - a legacy unsupported marker { unsupported: true, reason } when outcome
//   is "unsupported" (server reclassifies eligible requirements as
//   MODEL_ERROR/MODEL_ABSTAINED after deterministic preflight),
// - null when the payload carries no envelope (legacy Baseten / recorded /
//   historical flat path; caller falls through to existing handling),
// - a { __modelError: true, code } object when an envelope is present but
//   contradictory or incomplete. Never fabricates missing fields, never maps
//   malformed keys, never turns unsupported into supported.
function fromMetaEnvelope(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!Object.prototype.hasOwnProperty.call(parsed, "result")) return null;
  const hasLegacyTopLevel =
    Object.prototype.hasOwnProperty.call(parsed, "version") ||
    Object.prototype.hasOwnProperty.call(parsed, "ruleId") ||
    Object.prototype.hasOwnProperty.call(parsed, "operations") ||
    Object.prototype.hasOwnProperty.call(parsed, "unsupported");
  if (hasLegacyTopLevel) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned contradictory envelope and legacy plan fields. No answer fabricated." };
  }
  const topKeys = Object.keys(parsed);
  if (topKeys.length !== 1) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned unexpected top-level fields. No answer fabricated." };
  }
  const result = parsed.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned malformed envelope. No answer fabricated." };
  }
  const outcome = result.outcome;
  if (outcome === "supported") {
    const allowed = new Set(["outcome", "version", "ruleId", "businessRequirement", "interpretedRule", "operations"]);
    for (const k of Object.keys(result)) {
      if (!allowed.has(k)) {
        return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned unexpected envelope fields. No answer fabricated." };
      }
    }
    if (
      !Object.prototype.hasOwnProperty.call(result, "version") ||
      !Object.prototype.hasOwnProperty.call(result, "ruleId") ||
      !Object.prototype.hasOwnProperty.call(result, "businessRequirement") ||
      !Object.prototype.hasOwnProperty.call(result, "interpretedRule") ||
      !Object.prototype.hasOwnProperty.call(result, "operations")
    ) {
      return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned incomplete supported envelope. No answer fabricated." };
    }
    if (Object.prototype.hasOwnProperty.call(result, "reason") || Object.prototype.hasOwnProperty.call(result, "unsupported")) {
      return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned contradictory supported envelope. No answer fabricated." };
    }
    return {
      version: result.version,
      ruleId: result.ruleId,
      businessRequirement: result.businessRequirement,
      interpretedRule: result.interpretedRule,
      operations: result.operations,
    };
  }
  if (outcome === "unsupported") {
    const allowed = new Set(["outcome", "reason"]);
    for (const k of Object.keys(result)) {
      if (!allowed.has(k)) {
        return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned unexpected envelope fields. No answer fabricated." };
      }
    }
    if (!Object.prototype.hasOwnProperty.call(result, "reason")) {
      return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned incomplete unsupported envelope. No answer fabricated." };
    }
    if (
      Object.prototype.hasOwnProperty.call(result, "version") ||
      Object.prototype.hasOwnProperty.call(result, "ruleId") ||
      Object.prototype.hasOwnProperty.call(result, "businessRequirement") ||
      Object.prototype.hasOwnProperty.call(result, "interpretedRule") ||
      Object.prototype.hasOwnProperty.call(result, "operations") ||
      Object.prototype.hasOwnProperty.call(result, "unsupported")
    ) {
      return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned contradictory unsupported envelope. No answer fabricated." };
    }
    // Eligible requirements map this to MODEL_ABSTAINED at the server layer
    // (after deterministic preflight). The validator keeps the legacy
    // UNSUPPORTED_REQUIREMENT reason so ineligible-requirement history and
    // existing unit expectations stay intact; the server reclassifies it for
    // eligible requirements and never reflects the raw reason.
    return { unsupported: true, reason: result.reason };
  }
  return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned ambiguous outcome. No answer fabricated." };
}

async function postChatWithTimeout({ url, apiKey, body, fetchImpl }) {
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
  // Mark handled so a fired deadline after fast success cannot surface as an
  // unhandled rejection; Promise.race branches still observe the rejection.
  deadline.catch(() => {});
  const cleanup = () => { if (timer) { clearTimeout(timer); timer = null; } };
  try {
    // Headers phase: abort signal covers fetch; deadline race ensures a hung
    // fetch promise cannot outlive the timeout.
    const res = await Promise.race([
      fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }),
      deadline,
    ]);
    if (!res || typeof res.json !== "function") { cleanup(); return res; }
    // Body phase: keep the deadline armed across response.json() so headers
    // arriving before the deadline but a stalled body still times out. Patch
    // json in place to preserve response identity for callers/mocks.
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
  if (typeof budgetUsed !== "number" || !Number.isFinite(budgetUsed)) return false;
  // Only the active request budget counts. The legacy 2048 threshold is
  // retained as an exported constant for diagnostics but must never trigger
  // a retry on its own: a completed stop response with e.g. 2084 tokens
  // against a 4096 budget is not exhaustion.
  if (completionTokens >= budgetUsed - 1) return true;
  return false;
}

// Confirmed truncation only: empty content with finish_reason=length, or
// empty content with usage at/above the active budget and a non-stop
// termination. Refusals, finish_reason=stop, HTTP errors, malformed JSON
// (stop), and ordinary empty content never qualify.
function isConfirmedTruncation({ hasContent, finishReason, completionTokens, budgetUsed }) {
  if (hasContent) return false;
  if (finishReason === "length") return true;
  if (finishReason === "stop") return false;
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

async function postChat({ url, apiKey, model, messages, budget, fetchImpl, provider, contract }) {
  const resolvedProvider = provider || modelConfig().provider;
  const body = buildChatRequestBody({ provider: resolvedProvider, model, messages, budget, contract: contract || REFUND_PLAN_CONTRACT });
  return await postChatWithTimeout({ url, apiKey, body, fetchImpl });
}

function sanitizeProviderHint(value) {
  if (typeof value !== "string") return "";
  // Never reflect secrets, keys, reasoning traces, tool-policy/company text,
  // or arbitrary provider text verbatim. Keep a status-only note at most.
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (
    lowered.includes("tool") ||
    lowered.includes("business requirement") ||
    lowered.includes("unsupported") ||
    lowered.includes("you are a qa") ||
    lowered.includes("refund-cap")
  ) {
    return " Provider detail withheld.";
  }
  if (lowered.includes("sk-") || lowered.includes("b10_") || lowered.includes("bearer") || lowered.includes("api key") || lowered.includes("apikey") || lowered.includes("secret") || lowered.includes("reasoning")) {
    return " Provider detail redacted.";
  }
  // Strip obvious key-like tokens and collapse whitespace.
  const cleaned = trimmed
    .replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return cleaned ? ` Provider says: ${cleaned}` : "";
}

function sanitizeCaughtMessage(err) {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  if (/abort/i.test(raw)) return "Model request timed out. No answer fabricated.";
  // Never reflect raw exception text (paths, stacks, provider internals).
  return "Model request failed. No answer fabricated.";
}

// One bounded retry with a higher budget, same provider/model/messages.
// Never retries HTTP errors, refusals, malformed JSON (stop), validation
// failures, or ordinary empty content. At most 2 total attempts.
async function retryAfterTruncation({ url, apiKey, model, messages, fetchImpl, provider, contract, initial, retryBudget, exhausted, partialJson }) {
  let res2;
  try {
    res2 = await postChat({ url, apiKey, model, messages, budget: retryBudget, fetchImpl, provider, contract });
  } catch (err) {
    const raw0 = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
    return {
      __modelError: true,
      code: /abort/i.test(raw0) ? "MODEL_TIMEOUT" : "MODEL_HTTP_ERROR",
      message: sanitizeCaughtMessage(err),
      _diag: buildDiag({ httpStatus: null, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true })
    };
  }
  const httpStatus2 = typeof res2.status === "number" ? res2.status : (res2.ok ? 200 : null);
  if (!res2.ok) {
    let providerHint = "";
    try {
      const errData = await res2.json();
      const errMsg = errData?.error?.message || errData?.message || errData?.error;
      providerHint = sanitizeProviderHint(typeof errMsg === "string" ? errMsg : "");
    } catch (err) {
      const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
      if (/abort/i.test(rawj)) {
        return { __modelError: true, code: "MODEL_TIMEOUT", message: sanitizeCaughtMessage(err), _diag: buildDiag({ httpStatus: httpStatus2, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true }) };
      }
      // Ignore other body parse errors on error path; status is enough.
    }
    return {
      __modelError: true,
      code: "MODEL_HTTP_ERROR",
      message: `Model HTTP ${httpStatus2}.${providerHint} No answer fabricated.`,
      _diag: buildDiag({ httpStatus: httpStatus2, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true })
    };
  }
  let data2;
  try {
    data2 = await res2.json();
  } catch (err) {
    const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
    if (/abort/i.test(rawj)) {
      return { __modelError: true, code: "MODEL_TIMEOUT", message: sanitizeCaughtMessage(err), _diag: buildDiag({ httpStatus: httpStatus2, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true }) };
    }
    return {
      __modelError: true,
      code: "MODEL_INVALID_OUTPUT",
      message: "Model returned non-JSON. No answer fabricated.",
      _diag: buildDiag({ httpStatus: httpStatus2, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true })
    };
  }
  const d = describeChoice(data2);
  const diag2 = () =>
    buildDiag({ httpStatus: httpStatus2, modelId: d.returnedModelId, finishReason: d.finishReason, completionTokens: d.completionTokens, reasoningTokens: d.reasoningTokens, hasContent: d.hasContent, outputBudget: retryBudget, attempts: MAX_ATTEMPTS, retried: true });
  const refusal2 = d.message?.refusal;
  if (typeof refusal2 === "string" && refusal2.trim()) {
    return { __modelError: true, code: "MODEL_REFUSAL", message: "Model refused the request. No answer fabricated.", _diag: diag2() };
  }
  if (d.hasContent) {
    try {
      const parsed = extractJson(d.content);
      const converted = applyMetaEnvelopeForProvider(parsed, provider, contract);
      if (converted && converted.__modelError === true) {
        if (!converted.code) converted.code = "MODEL_INVALID_OUTPUT";
        converted._diag = diag2();
        return converted;
      }
      // Safe retry metadata: attach active-budget diagnostics without
      // altering the validated contract. Legacy flat payloads pass through;
      // envelope supported values already converted; contradictions fail closed.
      if (converted && typeof converted === "object") {
        if (data2?.model) converted._diag = diag2();
        else converted._diag = diag2();
        return converted;
      }
      return converted;
    } catch {
      return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned malformed JSON. No answer fabricated.", _diag: diag2() };
    }
  }
  // Retry also empty: report final budget and attempts. No further retries.
  if (d.finishReason === "length") {
    return {
      __modelError: true,
      code: "MODEL_INVALID_OUTPUT",
      message: `Model output truncated (finish_reason=length, budget=${initial}->${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,
      _diag: diag2()
    };
  }
  if (isBudgetExhausted(d.completionTokens, retryBudget)) {
    return {
      __modelError: true,
      code: "MODEL_INVALID_OUTPUT",
      message: `Model output exhausted the token budget (${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,
      _diag: diag2()
    };
  }
  if (exhausted) {
    return {
      __modelError: true,
      code: "MODEL_INVALID_OUTPUT",
      message: `Model output exhausted the token budget (${retryBudget}, attempts=${MAX_ATTEMPTS}). No answer fabricated.`,
      _diag: diag2()
    };
  }
  if (partialJson) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned malformed JSON. No answer fabricated.", _diag: diag2() };
  }
  return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned empty content. No answer fabricated.", _diag: diag2() };
}

// Shared META envelope conversion for legacy interpretWithMeta path.
// Same fail-closed semantics as the planner: envelope values convert,
// legacy flat payloads pass through, contradictions become __modelError.
// Convert a strict eligible-plan payload ({ interpretedRule, operations })
// into canonical server-owned metadata is attached by the caller. Returns
// null when the payload is not an eligible-plan shape (caller decides
// handling per provider/contract). Returns { __modelError } when an
// eligible-plan envelope key is present but contradictory/incomplete.
// Never fabricates fields, never fuzzy-matches, never passes through
// noncanonical output fields.
function fromEligiblePlan(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const hasEligibleKey = keys.includes("interpretedRule") || keys.includes("operations");
  if (!hasEligibleKey) return null;
  if (keys.length !== 2 || !keys.includes("interpretedRule") || !keys.includes("operations")) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned noncanonical generation fields. No answer fabricated." };
  }
  if (typeof parsed.interpretedRule !== "string" || !parsed.interpretedRule.trim()) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned missing interpretedRule. No answer fabricated." };
  }
  if (!Array.isArray(parsed.operations)) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned missing operations. No answer fabricated." };
  }
  // Reject explicit abstention/policy markers inside this schema: eligible
  // requirements must produce a plan; anything else is a model failure.
  if (typeof parsed.interpretedRule === "string" && /^(placeholder|unsupported|n\/a|tbd)\b/i.test(parsed.interpretedRule.trim())) {
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned unusable interpretation. No answer fabricated." };
  }
  return { interpretedRule: parsed.interpretedRule, operations: parsed.operations };
}

function applyMetaEnvelopeForProvider(parsed, provider, contract) {
  if (provider !== "META") return parsed;
  // The applicant-interpretation helper never uses the refund-plan envelope:
  // applying fromMetaEnvelope there would misclassify its own contract.
  if (contract === APPLICANT_CONTRACT) return parsed;
  // M1.5 eligible-plan: strict two-field conversion only. A non-eligible
  // shape (legacy flat/envelope) is unexpected here; legacy callers keep
  // the old conversion below. Do not mix the two contracts.
  if (contract === ELIGIBLE_PLAN_CONTRACT) {
    const eligible = fromEligiblePlan(parsed);
    if (eligible === null) {
      return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned unexpected plan shape. No answer fabricated." };
    }
    return eligible;
  }
  const converted = fromMetaEnvelope(parsed);
  if (converted === null) return parsed;
  return converted;
}

export async function interpretWithMeta({ question, profile, fetchImpl = fetch, maxTokens } = {}) {
  let cfg;
  try {
    cfg = modelConfig();
  } catch {
    return { __modelError: true, message: "Model configuration error. No answer fabricated." };
  }
  const { apiKey, model, chatUrl, provider } = cfg;
  if (!apiKey) {
    const hint = provider === "META" ? "Missing MODEL_API_KEY. Set it in .env.local (never commit it)." : "Missing BASETEN_API_KEY. Set it in .env.local (never commit it).";
    return { __modelError: true, message: hint };
  }
  const budgets = resolveBudgets({ maxTokens, provider });
  const initial = budgets.initial;
  const retryBudget = budgets.retry;
  const url = chatUrl;
  const messages = buildPrompt({ question, profile });
  // The applicant helper uses its own plain-json contract, never the
  // refund-plan structured schema and never fromMetaEnvelope conversion.
  const contract = APPLICANT_CONTRACT;
  let res;
  try {
    res = await postChat({ url, apiKey, model, messages, budget: initial, fetchImpl, provider, contract });
  } catch (err) {
    const timeout = err && (err.name === "AbortError" || /abort|timed out/i.test(String((err && err.message) || err)));
    return {
      __modelError: true,
      code: timeout ? "MODEL_TIMEOUT" : "MODEL_HTTP_ERROR",
      message: sanitizeCaughtMessage(err),
      _diag: buildDiag({ httpStatus: null, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false })
    };
  }
  const httpStatus = typeof res.status === "number" ? res.status : (res.ok ? 200 : null);
  if (!res.ok) {
    let providerHint = "";
    try {
      const errData = await res.json();
      const errMsg = errData?.error?.message || errData?.message || errData?.error;
      providerHint = sanitizeProviderHint(typeof errMsg === "string" ? errMsg : "");
    } catch (err) {
      const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
      if (/abort/i.test(rawj)) {
        return { __modelError: true, code: "MODEL_TIMEOUT", message: sanitizeCaughtMessage(err), _diag: buildDiag({ httpStatus, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false }) };
      }
      // Ignore other body parse errors on error path; status is enough.
    }
    return {
      __modelError: true,
      code: "MODEL_HTTP_ERROR",
      message: `Model HTTP ${httpStatus}.${providerHint} No answer fabricated.`,
      _diag: buildDiag({ httpStatus, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false })
    };
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    const rawj = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
    if (/abort/i.test(rawj)) {
      return { __modelError: true, code: "MODEL_TIMEOUT", message: sanitizeCaughtMessage(err), _diag: buildDiag({ httpStatus, modelId: null, finishReason: null, completionTokens: null, reasoningTokens: null, hasContent: false, outputBudget: initial, attempts: 1, retried: false }) };
    }
    return {
      __modelError: true,
      code: "MODEL_INVALID_OUTPUT",
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
    return { __modelError: true, code: "MODEL_REFUSAL", message: "Model refused the request. No answer fabricated.", _diag: diag() };
  }
  if (!first.hasContent) {
    // Never use reasoning_content as the final answer; it is private trace,
    // not the validated JSON contract.
    if (isConfirmedTruncation({ hasContent: false, finishReason: first.finishReason, completionTokens: first.completionTokens, budgetUsed: initial })) {
      return await retryAfterTruncation({ url, apiKey, model, messages, fetchImpl, provider, contract, initial, retryBudget, exhausted: isBudgetExhausted(first.completionTokens, initial) && first.finishReason !== "length", partialJson: false });
    }
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned empty content. No answer fabricated.", _diag: diag() };
  }
  try {
    let parsed = extractJson(first.content);
    parsed = applyMetaEnvelopeForProvider(parsed, provider, contract);
    if (parsed && parsed.__modelError === true) {
      if (!parsed.code) parsed.code = "MODEL_INVALID_OUTPUT";
      parsed._diag = diag();
      return parsed;
    }
    return parsed;
  } catch {
    // Truncated partial JSON (finish_reason=length) qualifies for one retry.
    // Ordinary malformed JSON with finish_reason=stop never retries.
    if (first.finishReason === "length") {
      return await retryAfterTruncation({ url, apiKey, model, messages, fetchImpl, provider, contract, initial, retryBudget, exhausted: false, partialJson: true });
    }
    return { __modelError: true, code: "MODEL_INVALID_OUTPUT", message: "Model returned malformed JSON. No answer fabricated.", _diag: diag() };
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
  UPSTREAM_TIMEOUT_MS,
  DEFAULT_META_BASE_URL,
  DEFAULT_META_MODEL,
  DEFAULT_BASETEN_BASE_URL,
  DEFAULT_BASETEN_MODEL,
  TEST_PLAN_JSON_SCHEMA,
  ELIGIBLE_PLAN_JSON_SCHEMA,
  REFUND_PLAN_CONTRACT,
  APPLICANT_CONTRACT,
  ELIGIBLE_PLAN_CONTRACT,
  resolveBudgets,
  modelConfig,
  describeConfig,
  buildChatRequestBody,
  fromMetaEnvelope,
  fromEligiblePlan,
  sanitizeBaseUrl,
  isBudgetExhausted,
  isConfirmedTruncation,
};
