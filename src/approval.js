import { createHash, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

export function approvalHash({ businessRequirement, plan }) {
  const payload = canonicalJson({ businessRequirement: String(businessRequirement ?? ""), plan });
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyApproval({ businessRequirement, plan, approvalToken }) {
  if (typeof approvalToken !== "string" || !approvalToken) return false;
  const expected = approvalHash({ businessRequirement, plan });
  return expected === approvalToken;
}

export function canonicalRequirement(req) {
  return String(req ?? "").trim();
}

export const TOKEN_VERSION = 1;
export const TOKEN_PURPOSE = "proofcase-run";
export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const MAX_TOKEN_LENGTH = 4096;
export const ALLOWED_PROVENANCE = new Set(["LIVE", "RECORDED"]);
const ALLOWED_PAYLOAD_KEYS = ["v", "purpose", "reqHash", "planHash", "provenance", "modelId", "iat", "exp"];

export function canonicalRequirementHash(req) {
  const c = canonicalRequirement(req);
  return createHash("sha256").update(c, "utf8").digest("hex");
}

export function canonicalPlanHash(plan) {
  const payload = canonicalJson(plan);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function createSigningKey() {
  return randomBytes(32);
}

function toBase64Url(bufOrStr) {
  const b = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), "utf8");
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str) {
  let b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return Buffer.from(b64, "base64").toString("utf8");
}

function isValidBase64Url(s) {
  return typeof s === "string" && s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s);
}

export function issueAuthorization({ businessRequirement, plan, provenance, modelId, now }, { key }) {
  if (!key || !Buffer.isBuffer(key)) throw new Error("MISSING_KEY");
  const iat = now;
  const exp = now + TOKEN_TTL_MS;
  const payload = {
    v: TOKEN_VERSION,
    purpose: TOKEN_PURPOSE,
    reqHash: canonicalRequirementHash(businessRequirement),
    planHash: canonicalPlanHash(plan),
    provenance,
    modelId: String(modelId ?? ""),
    iat,
    exp,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(payloadJson);
  const sig = createHmac("sha256", key).update(payloadB64).digest();
  const sigB64 = toBase64Url(sig);
  const token = payloadB64 + "." + sigB64;
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("TOKEN_TOO_LONG");
  return token;
}

export function verifyAuthorization({ businessRequirement, plan, token, now, key }) {
  if (typeof token !== "string" || !token) {
    return { ok: false, reason: "Missing token", code: "TOKEN_MISSING" };
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "Token too long", code: "TOKEN_TOO_LONG" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "Invalid token structure", code: "TOKEN_MALFORMED" };
  }
  const payloadB64 = parts[0];
  const sigB64 = parts[1];
  if (!isValidBase64Url(payloadB64) || !isValidBase64Url(sigB64)) {
    return { ok: false, reason: "Invalid token encoding", code: "TOKEN_MALFORMED" };
  }
  let payloadJson;
  try {
    payloadJson = fromBase64Url(payloadB64);
  } catch {
    return { ok: false, reason: "Invalid token encoding", code: "TOKEN_MALFORMED" };
  }
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { ok: false, reason: "Invalid token payload", code: "TOKEN_MALFORMED" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "Invalid token payload", code: "TOKEN_MALFORMED" };
  }
  const keys = Object.keys(payload).sort();
  const allowedSorted = ALLOWED_PAYLOAD_KEYS.slice().sort();
  if (keys.length !== allowedSorted.length || !keys.every(function(k,i){return k===allowedSorted[i];})) {
    return { ok: false, reason: "Unexpected token fields", code: "TOKEN_MALFORMED" };
  }
  if (payload.v !== TOKEN_VERSION) {
    return { ok: false, reason: "Invalid token version", code: "TOKEN_VERSION_INVALID" };
  }
  if (payload.purpose !== TOKEN_PURPOSE) {
    return { ok: false, reason: "Invalid token purpose", code: "TOKEN_PURPOSE_INVALID" };
  }
  if (!ALLOWED_PROVENANCE.has(payload.provenance)) {
    return { ok: false, reason: "Invalid provenance", code: "TOKEN_PROVENANCE_INVALID" };
  }
  if (typeof payload.modelId !== "string" || !payload.modelId.trim()) {
    return { ok: false, reason: "Invalid modelId", code: "TOKEN_MODEL_INVALID" };
  }
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: "Invalid timestamps", code: "TOKEN_TIME_INVALID" };
  }
  if (payload.exp <= payload.iat) {
    return { ok: false, reason: "Invalid time interval", code: "TOKEN_TIME_INVALID" };
  }
  if (payload.exp - payload.iat > TOKEN_TTL_MS) {
    return { ok: false, reason: "Token lifetime exceeds maximum", code: "TOKEN_TTL_EXCEEDED" };
  }
  if (typeof now !== "number" || !Number.isFinite(now)) {
    return { ok: false, reason: "Invalid server clock", code: "TOKEN_TIME_INVALID" };
  }
  if (now < payload.iat || now > payload.exp) {
    return { ok: false, reason: "Token expired or not yet valid", code: "TOKEN_EXPIRED" };
  }
  let expectedSigB64;
  try {
    const expectedSig = createHmac("sha256", key).update(payloadB64).digest();
    expectedSigB64 = toBase64Url(expectedSig);
  } catch {
    return { ok: false, reason: "Verification failed", code: "TOKEN_INVALID" };
  }
  try {
    const a = Buffer.from(sigB64, "utf8");
    const b = Buffer.from(expectedSigB64, "utf8");
    if (a.length !== b.length) {
      return { ok: false, reason: "Invalid signature", code: "TOKEN_FORGED" };
    }
    if (!timingSafeEqual(a, b)) {
      return { ok: false, reason: "Invalid signature", code: "TOKEN_FORGED" };
    }
  } catch {
    return { ok: false, reason: "Invalid signature", code: "TOKEN_FORGED" };
  }
  const expectedReqHash = canonicalRequirementHash(businessRequirement);
  const expectedPlanHash = canonicalPlanHash(plan);
  try {
    const reqA = Buffer.from(payload.reqHash, "utf8");
    const reqB = Buffer.from(expectedReqHash, "utf8");
    if (reqA.length !== reqB.length || !timingSafeEqual(reqA, reqB)) {
      return { ok: false, reason: "Requirement mismatch", code: "TOKEN_REQUIREMENT_MISMATCH" };
    }
    const planA = Buffer.from(payload.planHash, "utf8");
    const planB = Buffer.from(expectedPlanHash, "utf8");
    if (planA.length !== planB.length || !timingSafeEqual(planA, planB)) {
      return { ok: false, reason: "Plan mismatch", code: "TOKEN_PLAN_MISMATCH" };
    }
  } catch {
    return { ok: false, reason: "Digest comparison failed", code: "TOKEN_INVALID" };
  }
  return { ok: true, payload };
}
