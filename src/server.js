import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUSINESS_REQUIREMENT } from "./catalog.js";
import { generateTestPlan } from "./planner.js";
import { ELIGIBLE_PLAN_CONTRACT } from "./metaClient.js";
import { normalizePlan, validateTestPlan } from "./testPlanValidator.js";
import { executePlan } from "./executor.js";
import { approvalHash, verifyApproval, createSigningKey, issueAuthorization, verifyAuthorization, canonicalRequirement } from "./approval.js";
import { modelConfig, describeConfig } from "./metaClient.js";
import { checkSemanticEligibility } from "./semanticGate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const RECORDED_PATH = path.join(ROOT, "docs", "recordedResponse.json");

export const BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8080;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_HEADER_TIMEOUT_MS = 10_000;
export const BODY_RECEIVE_TIMEOUT_MS = 15_000;
export const MAX_DRAIN_BYTES = 128 * 1024;
export const ALLOWED_STATIC_EXTS = new Set([".html", ".css", ".js"]);
export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

let PUBLIC_REAL = null;
try {
  PUBLIC_REAL = fs.realpathSync(PUBLIC);
} catch {
  PUBLIC_REAL = PUBLIC;
}

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}
loadEnv();

function sanitizeError(e) {
  const msg = e.message || "Unknown error";
  return msg.replace(/[A-Z]:\\[^\s]+/g, "[path]").replace(/\/[^\s]*\/proofcase[^\s]*/g, "[path]");
}
function sendJson(res, code, obj) {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Length": Buffer.byteLength(payload, "utf8"),
  });
  res.end(payload);
}

function getPathname(req) {
  try {
    const u = new URL(req.url, "http://localhost");
    return u.pathname;
  } catch {
    return null;
  }
}

function hasDuplicateHost(req) {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === "host") count++;
    if (count > 1) return true;
  }
  return false;
}

export function validateHost(req, actualPort) {
  if (hasDuplicateHost(req)) {
    return { ok: false, code: 400, reason: "Multiple Host headers" };
  }
  const host = req.headers.host;
  if (host == null || String(host).trim() === "") {
    return { ok: false, code: 400, reason: "Missing Host header" };
  }
  const trimmed = String(host).trim();
  if (/\s/.test(trimmed) || trimmed.includes(",") || /[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, code: 400, reason: "Malformed Host header" };
  }
  const normalized = trimmed.toLowerCase();
  if (!/^(?:localhost|127\.0\.0\.1):\d+$/i.test(normalized)) {
    return { ok: false, code: 403, reason: "Invalid Host" };
  }
  const allowed = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
  if (!allowed.includes(normalized)) {
    return { ok: false, code: 403, reason: "Invalid Host port" };
  }
  return { ok: true };
}

export function validateOriginAndFetch(req, actualPort) {
  const secFetchSite = req.headers["sec-fetch-site"];
  if (secFetchSite !== undefined) {
    const v = String(secFetchSite).trim().toLowerCase();
    if (v === "cross-site") {
      return { ok: false, code: 403, reason: "Cross-site fetch metadata rejected" };
    }
  }
  const origin = req.headers.origin;
  if (origin === undefined) {
    return { ok: true };
  }
  const origStr = String(origin).trim();
  if (origStr === "" || origStr === "null" || origStr.toLowerCase() === "null") {
    return { ok: false, code: 403, reason: "Null origin rejected" };
  }
  let parsed;
  try {
    parsed = new URL(origStr);
  } catch {
    return { ok: false, code: 403, reason: "Malformed Origin" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: 403, reason: "Invalid Origin protocol" };
  }
  const hostWithPort = parsed.host.toLowerCase();
  const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
  if (!allowedHosts.includes(hostWithPort)) {
    return { ok: false, code: 403, reason: "Foreign Origin rejected" };
  }
  const normalizedOrigin = origStr.toLowerCase();
  const allowedOrigins = [
    `http://127.0.0.1:${actualPort}`,
    `http://localhost:${actualPort}`,
    `https://127.0.0.1:${actualPort}`,
    `https://localhost:${actualPort}`,
  ];
  if (!allowedOrigins.includes(normalizedOrigin)) {
    return { ok: false, code: 403, reason: "Foreign Origin rejected" };
  }
  return { ok: true };
}

function isValidJsonContentType(headerVal) {
  if (headerVal == null) return false;
  if (Array.isArray(headerVal)) return false;
  const parts = String(headerVal).split(";")[0].trim().toLowerCase();
  return parts === "application/json";
}

function drainRequest(req, maxDrainBytes = MAX_DRAIN_BYTES) {
  if (!req || req.destroyed) return;
  let drained = 0;
  const onData = (chunk) => {
    drained += chunk.length;
    if (drained > maxDrainBytes) {
      try { req.destroy(); } catch {}
      cleanup();
    }
  };
  const cleanup = () => {
    try { req.removeListener("data", onData); } catch {}
    try { req.removeListener("end", cleanup); } catch {}
    try { req.removeListener("close", cleanup); } catch {}
    try { req.removeListener("error", cleanup); } catch {}
  };
  req.on("data", onData);
  req.on("end", cleanup);
  req.on("close", cleanup);
  req.on("error", cleanup);
  try { req.resume(); } catch {}
}
export async function readBoundedJsonBody(req, res, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const timeoutMs = opts.timeoutMs ?? BODY_RECEIVE_TIMEOUT_MS;

  const ct = req.headers["content-type"];
  if (!isValidJsonContentType(ct)) {
    if (!res.writableEnded && !res.headersSent && !res.destroyed) {
      sendJson(res, 415, { error: "Unsupported Media Type", code: "UNSUPPORTED_MEDIA_TYPE" });
    }
    drainRequest(req);
    return null;
  }

  const clRaw = req.headers["content-length"];
  if (clRaw !== undefined) {
    if (Array.isArray(clRaw)) {
      if (!res.writableEnded && !res.headersSent && !res.destroyed) {
        sendJson(res, 400, { error: "Malformed Content-Length", code: "INVALID_REQUEST" });
      }
      drainRequest(req);
      return null;
    }
    const trimmed = String(clRaw).trim();
    if (!/^\d+$/.test(trimmed)) {
      if (!res.writableEnded && !res.headersSent && !res.destroyed) {
        sendJson(res, 400, { error: "Malformed Content-Length", code: "INVALID_REQUEST" });
      }
      drainRequest(req);
      return null;
    }
    const len = Number(trimmed);
    if (!Number.isSafeInteger(len) || len < 0) {
      if (!res.writableEnded && !res.headersSent && !res.destroyed) {
        sendJson(res, 400, { error: "Malformed Content-Length", code: "INVALID_REQUEST" });
      }
      drainRequest(req);
      return null;
    }
    if (len > maxBytes) {
      if (!res.writableEnded && !res.headersSent && !res.destroyed) {
        sendJson(res, 413, { error: "Payload Too Large", code: "PAYLOAD_TOO_LARGE" });
      }
      drainRequest(req);
      return null;
    }
  }

  return await new Promise((resolve) => {
    let total = 0;
    const chunks = [];
    let responded = false;
    let completed = false;
    let timeout = null;

    const cleanup = () => {
      clearTimeout(timeout);
      try { req.removeListener("data", onData); } catch {}
      try { req.removeListener("end", onEnd); } catch {}
      try { req.removeListener("error", onError); } catch {}
      try { req.removeListener("close", onClose); } catch {}
    };

    const sendError = (code, body) => {
      if (responded || res.writableEnded || res.headersSent || res.destroyed) return;
      responded = true;
      cleanup();
      clearTimeout(timeout);
      try { sendJson(res, code, body); } catch {}
      drainRequest(req);
      resolve(null);
    };

    const resetTimeout = () => {
      clearTimeout(timeout);
      if (completed || responded) return;
      timeout = setTimeout(() => {
        if (!res.writableEnded && res.writable && !res.destroyed && !responded) {
          sendError(408, { error: "Request Timeout", code: "REQUEST_TIMEOUT" });
          try { req.destroy(); } catch {}
        }
      }, timeoutMs);
      if (timeout && timeout.unref) timeout.unref();
    };

    const onData = (chunk) => {
      if (responded) return;
      total += chunk.length;
      if (total > maxBytes) {
        sendError(413, { error: "Payload Too Large", code: "PAYLOAD_TOO_LARGE" });
        return;
      }
      chunks.push(chunk);
      resetTimeout();
    };

    const onEnd = () => {
      if (responded) return;
      completed = true;
      cleanup();
      clearTimeout(timeout);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch {
        if (!res.writableEnded && !res.headersSent && !res.destroyed) {
          try { sendJson(res, 400, { error: "Invalid JSON body", code: "INVALID_REQUEST" }); } catch {}
        }
        drainRequest(req);
        resolve(null);
      }
    };

    const onError = () => {
      if (responded) return;
      responded = true;
      cleanup();
      clearTimeout(timeout);
      if (!res.writableEnded && !res.headersSent && !res.destroyed) {
        try { sendJson(res, 400, { error: "Bad Request", code: "INVALID_REQUEST" }); } catch {}
      }
      resolve(null);
    };

    const onClose = () => {
      if (!completed && !responded) {
        cleanup();
        clearTimeout(timeout);
        resolve(null);
      }
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
    resetTimeout();
  });
}
function isRawPathSuspicious(rawPath) {
  if (rawPath.includes("\\")) return true;
  if (/%5c/i.test(rawPath)) return true;
  if (/%00/i.test(rawPath)) return true;
  if (rawPath.includes("\0")) return true;
  if (rawPath.includes(":") || rawPath.includes("|")) return true;
  if (rawPath.startsWith("//")) return true;
  if (/%25/i.test(rawPath)) return true;
  if (/%2f/i.test(rawPath)) return true;
  return false;
}

function validateStaticDecodedPath(decodedPath) {
  if (!decodedPath.startsWith("/")) return { ok: false, reason: "Absolute required" };
  if (decodedPath.includes("\0")) return { ok: false, reason: "NUL byte" };
  if (decodedPath.includes("\\")) return { ok: false, reason: "Backslash" };
  if (/^[a-zA-Z]:/.test(decodedPath) || /^[a-zA-Z]\|/.test(decodedPath)) return { ok: false, reason: "Drive prefix" };
  const segs = decodedPath.split("/");
  for (const seg of segs) {
    if (seg === "") continue;
    if (seg === "." || seg === "..") return { ok: false, reason: "Traversal segment" };
    if (seg.includes("..")) return { ok: false, reason: "Traversal" };
    if (seg.startsWith(".")) return { ok: false, reason: "Dotfile" };
    if (seg.includes("\\") || seg.includes(":") || seg.includes("|")) return { ok: false, reason: "Unsafe segment" };
  }
  return { ok: true };
}

export function serveStaticSecure(req, res) {
  let rawUrl = req.url || "/";
  const qIdx = rawUrl.indexOf("?");
  if (qIdx !== -1) rawUrl = rawUrl.slice(0, qIdx);
  const hIdx = rawUrl.indexOf("#");
  if (hIdx !== -1) rawUrl = rawUrl.slice(0, hIdx);
  if (rawUrl === "") rawUrl = "/";

  if (isRawPathSuspicious(rawUrl)) {
    sendJson(res, 400, { error: "Invalid path", code: "INVALID_REQUEST" });
    return true;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawUrl);
  } catch {
    sendJson(res, 400, { error: "Malformed URL encoding", code: "INVALID_REQUEST" });
    return true;
  }

  let iterativelyDecoded = decodedPath;
  for (let i = 0; i < 2; i++) {
    if (!iterativelyDecoded.includes("%")) break;
    try {
      const next = decodeURIComponent(iterativelyDecoded);
      if (next !== iterativelyDecoded) {
        if (next.includes("..") || next.includes("\\") || next.includes("\0")) {
          sendJson(res, 400, { error: "Invalid path", code: "INVALID_REQUEST" });
          return true;
        }
        iterativelyDecoded = next;
      } else break;
    } catch {
      break;
    }
  }

  if (decodedPath === "/") decodedPath = "/index.html";

  const decCheck = validateStaticDecodedPath(decodedPath);
  if (!decCheck.ok) {
    sendJson(res, 400, { error: "Invalid path", code: "INVALID_REQUEST" });
    return true;
  }

  const ext = path.extname(decodedPath).toLowerCase();
  if (!ALLOWED_STATIC_EXTS.has(ext)) {
    sendJson(res, 403, { error: "Forbidden file type", code: "FORBIDDEN" });
    return true;
  }

  const joined = path.join(PUBLIC, decodedPath);
  const resolved = path.resolve(joined);
  const publicResolved = path.resolve(PUBLIC);

  const rel = path.relative(publicResolved, resolved);
  if (rel.startsWith(".." + path.sep) || rel === ".." || path.isAbsolute(rel)) {
    sendJson(res, 403, { error: "Forbidden", code: "FORBIDDEN" });
    return true;
  }
  if (resolved !== publicResolved && !resolved.startsWith(publicResolved + path.sep)) {
    sendJson(res, 403, { error: "Forbidden", code: "FORBIDDEN" });
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return false;

  try {
    const realPath = fs.realpathSync(resolved);
    const relReal = path.relative(PUBLIC_REAL, realPath);
    if (relReal.startsWith(".." + path.sep) || relReal === ".." || path.isAbsolute(relReal)) {
      sendJson(res, 403, { error: "Forbidden", code: "FORBIDDEN" });
      return true;
    }
    if (realPath !== PUBLIC_REAL && !realPath.startsWith(PUBLIC_REAL + path.sep)) {
      sendJson(res, 403, { error: "Forbidden", code: "FORBIDDEN" });
      return true;
    }
  } catch {}

  const mimeType = MIME[ext] || "application/octet-stream";
  try {
    const data = fs.readFileSync(resolved);
    if (res.writableEnded || res.destroyed) return true;
    res.writeHead(200, {
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Length": data.length,
    });
    res.end(data);
    return true;
  } catch (e) {
    sendJson(res, 500, { error: sanitizeError(e), code: "INTERNAL_ERROR" });
    return true;
  }
}
export const LIVE_INFERENCE_LIMIT = 10;
export const LIVE_INFERENCE_WINDOW_MS = 60 * 1000;
export const rateLimitStore = new Map();

export function checkLiveInferenceRateLimit(req, now = Date.now()) {
  const ip = (req.socket && req.socket.remoteAddress) || "global";
  let entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > LIVE_INFERENCE_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(ip, entry);
  }
  if (rateLimitStore.size > 100) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (now - v.windowStart > LIVE_INFERENCE_WINDOW_MS) rateLimitStore.delete(k);
      if (rateLimitStore.size <= 50) break;
    }
  }
  if (entry.count >= LIVE_INFERENCE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export function clearRateLimitStore() {
  rateLimitStore.clear();
}

export function createServer(opts = {}) {
  const signingKey = opts.signingKey ?? createSigningKey();
  const nowFn = opts.now ?? opts.clock ?? (() => Date.now());
  const generatePlanFn = opts.generateTestPlan ?? generateTestPlan;
  const assumedPort = opts.port ?? DEFAULT_PORT;
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    let actualPort = assumedPort;
    try {
      const addr = server.address();
      if (addr && typeof addr === "object" && typeof addr.port === "number") actualPort = addr.port;
    } catch {}
    const hostCheck = validateHost(req, actualPort);
    if (!hostCheck.ok) {
      const errCode = hostCheck.code === 403 ? "FORBIDDEN" : "INVALID_REQUEST";
      if (!res.writableEnded && !res.headersSent && !res.destroyed) sendJson(res, hostCheck.code, { error: hostCheck.reason, code: errCode });
      return;
    }
    if (req.method === "OPTIONS") {
      if (!res.writableEnded && !res.headersSent) {
        res.writeHead(204, { Allow: "GET, POST, OPTIONS", "Content-Length": "0", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
        res.end();
      }
      return;
    }
    if (req.method === "POST") {
      const originCheck = validateOriginAndFetch(req, actualPort);
      if (!originCheck.ok) {
        if (!res.writableEnded && !res.headersSent && !res.destroyed) sendJson(res, originCheck.code, { error: originCheck.reason, code: "FORBIDDEN" });
        return;
      }
    }
    const pathname = getPathname(req);
    if (pathname === null) {
      if (!res.writableEnded && !res.headersSent && !res.destroyed) sendJson(res, 400, { error: "Malformed URL", code: "INVALID_REQUEST" });
      return;
    }
    try {
      if (req.method === "GET" && pathname === "/api/config") {
        let payload;
        try {
          payload = describeConfig();
        } catch {
          const fallbackProvider = String(process.env.MODEL_PROVIDER || "").trim().toUpperCase() || "META";
          payload = { provider: fallbackProvider, model: null, hasKey: false };
        }
        sendJson(res, 200, { businessRequirement: BUSINESS_REQUIREMENT, ...payload });
        return;
      }
      if (req.method === "GET" && pathname === "/api/recorded") {
        if (!fs.existsSync(RECORDED_PATH)) {
          sendJson(res, 404, { error: "No recorded response available", code: "NO_RECORDED" });
          return;
        }
        const rec = JSON.parse(fs.readFileSync(RECORDED_PATH, "utf8"));
        sendJson(res, 200, { recorded: rec.plan, _diag: rec._diag, label: "RECORDED META RESPONSE" });
        return;
      }
      if (req.method === "POST" && pathname === "/api/interpret") {
        const body = await readBoundedJsonBody(req, res, { maxBytes: MAX_BODY_BYTES, timeoutMs: BODY_RECEIVE_TIMEOUT_MS });
        if (body === null) return;
        const businessRequirement = typeof body.businessRequirement === "string" ? body.businessRequirement.trim() : "";
        if (!businessRequirement) {
          sendJson(res, 400, { error: "businessRequirement required", code: "INVALID_REQUEST" });
          return;
        }
        if (businessRequirement.length > 2000) {
          sendJson(res, 400, { error: "businessRequirement too long", code: "INVALID_REQUEST" });
          return;
        }
        if (body.useRecorded === true) {
          if (!fs.existsSync(RECORDED_PATH)) {
            sendJson(res, 404, { error: "No recorded response", code: "NO_RECORDED" });
            return;
          }
          const rec = JSON.parse(fs.readFileSync(RECORDED_PATH, "utf8"));
          const norm = normalizePlan(rec.plan);
          try { validateTestPlan(norm); } catch (e) { sendJson(res, 400, { error: sanitizeError(e), code: "INVALID_PLAN" }); return; }
          const v = validateTestPlan(norm);
          if (!v.ok) {
            sendJson(res, 200, { status: v.reason, message: v.message, plan: norm, code: v.reason, modelLabel: "RECORDED META RESPONSE", modelId: rec._diag?.modelId || "recorded", live: false });
            return;
          }
          const canonicalSubmitted = canonicalRequirement(businessRequirement);
          const canonicalRecorded = canonicalRequirement(rec.plan.businessRequirement);
          if (canonicalSubmitted !== canonicalRecorded) {
            sendJson(res, 400, { error: "Recorded requirement mismatch", code: "RECORDED_REQUIREMENT_MISMATCH" });
            return;
          }
          const gateRec = checkSemanticEligibility({ businessRequirement, interpretedRule: norm.interpretedRule, plan: norm });
          if (!gateRec.eligible) {
            sendJson(res, 200, { status: gateRec.status, message: gateRec.reason, plan: norm, code: gateRec.status, missing: gateRec.missing, evidence: gateRec.evidence, unverified: true, requiresConfirmation: true, _diag: rec._diag || null });
            return;
          }
          const recModelId = rec._diag?.modelId || "recorded";
          const recToken = issueAuthorization({ businessRequirement, plan: norm, provenance: "RECORDED", modelId: recModelId, now: nowFn() }, { key: signingKey });
          sendJson(res, 200, { status: "VALID", plan: norm, approvalToken: recToken, interpretedRule: norm.interpretedRule, modelLabel: "RECORDED META RESPONSE", modelId: recModelId, live: false, gate: gateRec, _diag: rec._diag || null });
          return;
        }
        if (!checkLiveInferenceRateLimit(req)) {
          sendJson(res, 429, { error: "Too many requests", code: "RATE_LIMITED" });
          return;
        }
        // M1.4 domain preflight: deterministic eligibility before any provider
        // invocation. No fabricated interpretedRule/plan. Ineligible requirements
        // never reach the provider, never consume execution authorization.
        const preflight = checkSemanticEligibility({ businessRequirement });
        if (!preflight.eligible) {
          sendJson(res, 200, {
            status: preflight.status,
            message: preflight.reason,
            code: preflight.status,
            missing: preflight.missing,
            evidence: preflight.evidence,
            unverified: true,
            requiresConfirmation: true,
          });
          return;
        }
        // M1.5 eligible live path: domain classification is already decided by
        // the deterministic preflight above. Invoke Meta with the internal
        // eligible-plan contract (two-field generation, no supported/
        // unsupported choice). Browser JSON never selects this contract.
        const rawPlan = await generatePlanFn({ businessRequirement, contract: ELIGIBLE_PLAN_CONTRACT });
        if (rawPlan.__modelError) {
          const allowedCodes = new Set([
            "MODEL_TIMEOUT",
            "MODEL_HTTP_ERROR",
            "MODEL_REFUSAL",
            "MODEL_INVALID_OUTPUT",
            "MODEL_ABSTAINED",
            "MODEL_ERROR",
          ]);
          const publicCode = allowedCodes.has(rawPlan.code) ? rawPlan.code : "MODEL_ERROR";
          sendJson(res, 200, { status: "MODEL_ERROR", message: rawPlan.message, _diag: rawPlan._diag || null, code: publicCode });
          return;
        }
        const normalized = normalizePlan(rawPlan);
        let validation;
        try { validation = validateTestPlan(normalized); } catch (e) { sendJson(res, 200, { status: "INVALID_PLAN", message: sanitizeError(e), plan: normalized, code: "INVALID_PLAN" }); return; }
        if (!validation.ok) {
          if (validation.reason === "UNSUPPORTED_REQUIREMENT") {
            // M1.4: the requirement already passed deterministic preflight.
            // A model unsupported marker is abstention/failure, never proof the
            // eligible business rule is out of scope. Never issue authorization.
            sendJson(res, 200, {
              status: "MODEL_ERROR",
              message: "The model did not generate a valid plan for this eligible requirement.",
              code: "MODEL_ABSTAINED",
              _diag: normalized._diag || null,
            });
            return;
          }
          sendJson(res, 200, { status: "INVALID_PLAN", message: validation.message, plan: normalized, code: validation.reason });
          return;
        }
        const submittedCanon = canonicalRequirement(businessRequirement);
        const planReqCanon = canonicalRequirement(normalized.businessRequirement);
        if (planReqCanon !== submittedCanon) {
          sendJson(res, 200, { status: "NEEDS_INPUT", message: "Model plan requirement does not match submitted requirement", plan: normalized, code: "REQUIREMENT_MISMATCH", missing: ["businessRequirement_match"], unverified: true, requiresConfirmation: true, _diag: normalized._diag || null });
          return;
        }
        const gate = checkSemanticEligibility({ businessRequirement, interpretedRule: normalized.interpretedRule, plan: normalized });
        if (!gate.eligible) {
          sendJson(res, 200, { status: gate.status, message: gate.reason, plan: normalized, code: gate.status, missing: gate.missing, evidence: gate.evidence, unverified: true, requiresConfirmation: true, _diag: normalized._diag || null });
          return;
        }
        let configuredModel = null;
        try { configuredModel = modelConfig().model; } catch { configuredModel = null; }
        // Trusted identity: prefer the verified provider response, fall back
        // to server-side configured model. Never trust client-supplied IDs.
        // Mismatched mock/test IDs are still reported truthfully; a documented
        // mismatch note is attached instead of silently misattributing. The
        // authorization binds the reported modelId either way.
        const returnedModelId = normalized._diag?.modelId || null;
        const modelId = returnedModelId || configuredModel || "";
        const modelMismatch =
          Boolean(returnedModelId && configuredModel && returnedModelId !== configuredModel);
        const liveToken = issueAuthorization({ businessRequirement, plan: normalized, provenance: "LIVE", modelId, now: nowFn() }, { key: signingKey });
        const liveDiag = normalized._diag
          ? { ...normalized._diag, modelMismatch: modelMismatch || undefined, configuredModel: modelMismatch ? configuredModel : undefined }
          : normalized._diag || null;
        sendJson(res, 200, { status: "VALID", plan: normalized, approvalToken: liveToken, interpretedRule: normalized.interpretedRule, modelLabel: "LIVE META RESPONSE", modelId, live: true, _diag: liveDiag, gate });
        return;
      }
      if (req.method === "POST" && pathname === "/api/run") {
        const body = await readBoundedJsonBody(req, res, { maxBytes: MAX_BODY_BYTES, timeoutMs: BODY_RECEIVE_TIMEOUT_MS });
        if (body === null) return;
        const { businessRequirement, plan, approvalToken } = body;
        if (!businessRequirement || !plan || !approvalToken) {
          sendJson(res, 400, { error: "businessRequirement, plan, approvalToken required", code: "INVALID_REQUEST" });
          return;
        }
        const normalized = normalizePlan(plan);
        try { validateTestPlan(normalized); } catch (e) { sendJson(res, 400, { error: sanitizeError(e), code: "INVALID_PLAN" }); return; }
        const v = validateTestPlan(normalized);
        if (!v.ok) { sendJson(res, 400, { error: v.message, code: v.reason }); return; }
        const gateRun = checkSemanticEligibility({ businessRequirement, interpretedRule: normalized.interpretedRule, plan: normalized });
        if (!gateRun.eligible) { sendJson(res, 400, { error: gateRun.reason, code: gateRun.status, missing: gateRun.missing, unverified: true }); return; }
        const verifyRes = verifyAuthorization({ businessRequirement, plan: normalized, token: approvalToken, now: nowFn(), key: signingKey });
        if (!verifyRes.ok) {
          const codeMap = { TOKEN_MISSING: "APPROVAL_INVALID", TOKEN_TOO_LONG: "APPROVAL_INVALID", TOKEN_MALFORMED: "APPROVAL_INVALID", TOKEN_EXPIRED: "APPROVAL_EXPIRED", TOKEN_FORGED: "APPROVAL_INVALID", TOKEN_REQUIREMENT_MISMATCH: "APPROVAL_INVALID", TOKEN_PLAN_MISMATCH: "APPROVAL_INVALID" };
          const code = codeMap[verifyRes.code] || "APPROVAL_INVALID";
          sendJson(res, 400, { error: verifyRes.reason || "Approval token invalid", code });
          return;
        }
        const provenance = verifyRes.payload.provenance;
        const trustedModelId = verifyRes.payload.modelId;
        const trustedModelLabel = provenance === "RECORDED" ? "RECORDED META RESPONSE" : "LIVE META RESPONSE";
        const buggy = executePlan({ plan: normalized, approved: true, variant: "buggy" });
        const correct = executePlan({ plan: normalized, approved: true, variant: "correct" });
        const report = { version: "1.0", businessRequirement, interpretedRule: normalized.interpretedRule, plan: normalized, approvalToken, modelLabel: trustedModelLabel, modelId: trustedModelId, live: provenance === "LIVE", executedAt: new Date().toISOString(), results: { buggy, correct } };
        sendJson(res, 200, report);
        return;
      }
      if (req.method === "GET" && !pathname.startsWith("/api/")) {
        const handled = serveStaticSecure(req, res);
        if (handled) return;
      }
      if ((pathname === "/api/config" || pathname === "/api/recorded" || pathname === "/api/interpret" || pathname === "/api/run") && req.method !== "GET" && req.method !== "POST" && req.method !== "OPTIONS") {
        sendJson(res, 405, { error: "Method Not Allowed", code: "METHOD_NOT_ALLOWED" });
        return;
      }
      sendJson(res, 404, { error: "Not found", code: "NOT_FOUND" });
    } catch (e) {
      if (res.writableEnded || res.headersSent || res.destroyed) return;
      sendJson(res, 500, { error: sanitizeError(e), code: "INTERNAL_ERROR" });
    }
  });
  server.headersTimeout = MAX_HEADER_TIMEOUT_MS;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 5000;
  server.on("clientError", (err, socket) => {
    if (socket.writable) {
      try { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); } catch {}
    }
  });
  server._hardening = { MAX_BODY_BYTES, checkLiveInferenceRateLimit, rateLimitStore, clearRateLimitStore, PUBLIC, PUBLIC_REAL };
  server._auth = { signingKey, nowFn };
  return server;
}

export function startServer(opts = {}) {
  const port = opts.port ?? (Number(process.env.PORT) || DEFAULT_PORT);
  const host = BIND_HOST;
  const server = createServer({ port });
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      console.log(`Proofcase running at http://${host}:${addr.port}`);
      console.log(`Also available at http://localhost:${addr.port}`);
      resolve({ server, port: addr.port, host });
    });
    server.on("error", reject);
  });
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const envPort = Number(process.env.PORT);
  const PORT = Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : DEFAULT_PORT;
  const srv = createServer({ port: PORT });
  srv.listen(PORT, BIND_HOST, () => {
    console.log(`Proofcase Sprint 2 UI running at http://${BIND_HOST}:${PORT}`);
    console.log(`Also available at http://localhost:${PORT}`);
  });
}
