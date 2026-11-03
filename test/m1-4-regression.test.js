import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isBudgetExhausted, isConfirmedTruncation } from "../src/metaClient.js";
import { generateTestPlan } from "../src/planner.js";
import { validateTestPlan } from "../src/testPlanValidator.js";
import { checkSemanticEligibility } from "../src/semanticGate.js";
import { createServer, clearRateLimitStore } from "../src/server.js";
import { BUSINESS_REQUIREMENT } from "../src/catalog.js";
const KEYS = ["MODEL_PROVIDER","MODEL_API_KEY","META_MODEL","META_BASE_URL","META_MAX_TOKENS","META_RETRY_MAX_TOKENS","MODEL_MAX_TOKENS","MODEL_RETRY_MAX_TOKENS","BASETEN_API_KEY","BASETEN_BASE_URL","BASETEN_MODEL","BASETEN_MAX_TOKENS","BASETEN_RETRY_MAX_TOKENS"];
const snap = () => { const o = {}; for (const k of KEYS) o[k] = process.env[k]; return o; };
const restore = (s) => { for (const k of KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } };
const clear = () => { for (const k of KEYS) delete process.env[k]; };
function withMetaEnv() { process.env.MODEL_PROVIDER = "META"; process.env.MODEL_API_KEY = "test-meta-key"; delete process.env.BASETEN_API_KEY; }
function startSrv(opts) {
  const server = createServer({ port: 0, ...(opts || {}) });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}
function closeSrv(server) {
  return new Promise((r) => { try { if (server.closeAllConnections) server.closeAllConnections(); } catch {} server.close(r); });
}
function httpGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "GET", path, headers }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}
function httpPost(port, path, body) {
  const headers = { Host: "127.0.0.1:" + port, "Content-Type": "application/json", Origin: "http://127.0.0.1:" + port, "Content-Length": Buffer.byteLength(body) };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path, headers }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
function parseJson(r) { try { return JSON.parse(r.body); } catch { return null; } }
function metaOk(content) {
  return { ok: true, status: 200, json: async () => ({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content } }], usage: { completion_tokens: 100 } }) };
}
function validPlan(req) {
  return {
    version: "1.0", ruleId: "refund-cap", businessRequirement: req,
    interpretedRule: "The sum of accepted refunds for an order must not exceed its captured payment amount.",
    operations: [
      { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 4000, refundId: "r1" },
      { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 7000, refundId: "r2" },
      { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 },
    ],
  };
}
function envelopePlan(req) {
  return { result: { outcome: "supported", version: "1.0", ruleId: "refund-cap", businessRequirement: req, interpretedRule: "x", operations: validPlan(req).operations } };
}
test("M1.4 eligible unsupported placeholder becomes MODEL_ABSTAINED", async () => {
  const s = snap(); clear(); withMetaEnv();
  const gen = async () => generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: async () => metaOk(JSON.stringify({ result: { outcome: "unsupported", reason: "placeholder" } })) });
  const started = await startSrv({ generateTestPlan: gen });
  try {
    clearRateLimitStore();
    assert.equal(checkSemanticEligibility({ businessRequirement: BUSINESS_REQUIREMENT }).eligible, true);
    const body = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const j = parseJson(await httpPost(started.port, "/api/interpret", body));
    assert.equal(j.status, "MODEL_ERROR");
    assert.equal(j.code, "MODEL_ABSTAINED");
    assert.equal(j.message, "The model did not generate a valid plan for this eligible requirement.");
    assert.ok(!j.approvalToken);
    assert.ok(!JSON.stringify(j).includes("placeholder"));
  } finally { await closeSrv(started.server); restore(s); }
});
test("M1.4 tool-policy message on eligible requirement is MODEL_ERROR", async () => {
  const s = snap(); clear(); withMetaEnv();
  const policyText = "I cannot comply because this would require using tools, which are not available.";
  const gen = async () => generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: async () => metaOk(JSON.stringify({ result: { outcome: "unsupported", reason: policyText } })) });
  const started = await startSrv({ generateTestPlan: gen });
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const j = parseJson(await httpPost(started.port, "/api/interpret", body));
    assert.equal(j.status, "MODEL_ERROR");
    assert.equal(j.code, "MODEL_ABSTAINED");
    assert.ok(!j.approvalToken);
    assert.ok(!JSON.stringify(j).includes("tools"));
  } finally { await closeSrv(started.server); restore(s); }
});
test("M1.4 explicit refusal is MODEL_REFUSAL with no token", async () => {
  const s = snap(); clear(); withMetaEnv();
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { refusal: "I cannot help." } }], usage: { completion_tokens: 10 } }) });
  const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl });
  assert.equal(out.__modelError, true);
  assert.equal(out.code, "MODEL_REFUSAL");
  const gen = async () => out;
  const started = await startSrv({ generateTestPlan: gen });
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const j = parseJson(await httpPost(started.port, "/api/interpret", body));
    assert.equal(j.status, "MODEL_ERROR");
    assert.equal(j.code, "MODEL_REFUSAL");
    assert.ok(!j.approvalToken);
  } finally { await closeSrv(started.server); restore(s); }
});
test("M1.4 malformed unicode stays INVALID_PLAN single attempt", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    const ops = envelopePlan(BUSINESS_REQUIREMENT).result.operations;
    const obj = { version: "1.0" };
    obj["businessRequirement fot"] = BUSINESS_REQUIREMENT;
    obj["operations ll"] = ops;
    let calls = 0;
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: async () => { calls += 1; return metaOk(JSON.stringify(obj)); } });
    assert.equal(calls, 1);
    assert.throws(() => validateTestPlan(out), /MALFORMED_PLAN/);
  } finally { restore(s); }
});
test("M1.4 ineligible inputs never invoke provider", async () => {
  const s = snap(); clear(); withMetaEnv();
  const ineligible = [
    "Refunds should not be too large.",
    "Handle refunds correctly according to business policy.",
    "Refund requests must be processed within 24 hours of submission.",
    "Customers should receive an email confirmation after each refund is issued.",
    "Total accepted refunds per order must exceed captured payment.",
    "Total accepted refunds must be strictly less than captured payment.",
  ];
  for (const req of ineligible) {
    assert.equal(checkSemanticEligibility({ businessRequirement: req }).eligible, false, req);
    let calls = 0;
    const mock = async () => { calls += 1; return validPlan(req); };
    const started = await startSrv({ generateTestPlan: mock });
    try {
      clearRateLimitStore();
      const body = JSON.stringify({ businessRequirement: req });
      const j = parseJson(await httpPost(started.port, "/api/interpret", body));
      assert.ok(j.status === "NEEDS_INPUT" || j.status === "UNSUPPORTED" || j.status === "UNSUPPORTED_REQUIREMENT", req);
      assert.ok(!j.approvalToken);
      assert.equal(calls, 0, req);
    } finally { await closeSrv(started.server); }
  }
  restore(s);
});
test("M1.4 valid live generation executes buggy and corrected", async () => {
  const s = snap(); clear(); withMetaEnv();
  const mock = async (arg) => ({ ...validPlan(arg.businessRequirement), _diag: { modelId: "muse-spark-1.3", finishReason: "stop" } });
  const started = await startSrv({ generateTestPlan: mock });
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const j = parseJson(await httpPost(started.port, "/api/interpret", body));
    assert.equal(j.status, "VALID");
    assert.ok(j.approvalToken);
    const runBody = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT, plan: j.plan, approvalToken: j.approvalToken });
    const rep = parseJson(await httpPost(started.port, "/api/run", runBody));
    assert.equal(rep.results.buggy.finalState.orders[0].totalAcceptedCents, 11000);
    assert.equal(rep.results.correct.finalState.orders[0].totalAcceptedCents, 4000);
  } finally { await closeSrv(started.server); restore(s); }
});
test("M1.4 retry converts supported, abstention stays safe", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let calls = 0;
    const second = envelopePlan(BUSINESS_REQUIREMENT);
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, maxTokens: 4096, fetchImpl: async (url, opts) => {
      calls += 1;
      const b = JSON.parse(opts.body);
      if (calls === 1) return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "length", message: { content: "" } }], usage: { completion_tokens: b.max_completion_tokens - 1 } }) };
      return metaOk(JSON.stringify(second));
    } });
    assert.equal(calls, 2);
    assert.equal(out.version, "1.0");
    assert.equal(out._diag.retried, true);
    let c2 = 0;
    const out2 = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, maxTokens: 4096, fetchImpl: async (url, opts) => {
      c2 += 1;
      const b = JSON.parse(opts.body);
      if (c2 === 1) return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "length", message: { content: "" } }], usage: { completion_tokens: b.max_completion_tokens - 1 } }) };
      return metaOk(JSON.stringify({ result: { outcome: "unsupported", reason: "placeholder" } }));
    } });
    assert.equal(c2, 2);
    assert.equal(validateTestPlan(out2).reason, "UNSUPPORTED_REQUIREMENT");
  } finally { restore(s); }
});
test("M1.4 stop with 2084 tokens on 4096 budget does not retry", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    assert.equal(isBudgetExhausted(2084, 4096), false);
    assert.equal(isConfirmedTruncation({ hasContent: false, finishReason: "stop", completionTokens: 2084, budgetUsed: 4096 }), false);
    let calls = 0;
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, maxTokens: 4096, fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "stop", message: { content: "" } }], usage: { completion_tokens: 2084 } }) }; } });
    assert.equal(calls, 1);
    assert.equal(out.__modelError, true);
  } finally { restore(s); }
});
test("M1.4 HTTP errors never retry and secrets are not reflected", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    const statuses = [400, 401, 403, 429, 500];
    for (const status of statuses) {
      let n = 0;
      const mk = () => { n += 1; return { ok: false, status, json: async () => ({ error: { message: "boom" } }) }; };
      const o = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: mk });
      assert.equal(n, 1, "HTTP " + status);
      assert.equal(o.code, "MODEL_HTTP_ERROR");
    }
    const evil = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "denied mock-secret-b10_abc123" } }) }) });
    assert.ok(!JSON.stringify(evil).includes("mock-secret-b10_abc123"));
  } finally { restore(s); }
});
test("M1.4 applicant helper never receives refund-plan schema", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    const mod = await import("../src/metaClient.js");
    let body = null;
    const out = await mod.interpretWithMeta({ question: { id: "q1", text: "x" }, profile: {}, fetchImpl: async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ questionId: "q1", interpretation: "x", proposedAnswer: "", evidenceKeys: [], confidence: 0 }) } }], usage: {} }) };
    } });
    assert.ok(!out.__modelError);
    assert.equal(body.response_format.type, "json_object");
    assert.ok(!body.response_format.json_schema);
    assert.ok(!JSON.stringify(body).includes("refund_test_plan"));
  } finally { restore(s); }
});
test("M1.4 per-order exceed-cap cross-order rejected single-order accepted", () => {
  const cross = {
    version: "1.0", ruleId: "refund-cap", businessRequirement: BUSINESS_REQUIREMENT, interpretedRule: "x",
    operations: [
      { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
      { op: "createOrder", orderId: "order-2", capturedCents: 10000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 6000, refundId: "r1" },
      { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
      { op: "requestRefund", orderId: "order-2", amountCents: 6000, refundId: "r2" },
      { op: "assertRefundStatus", refundId: "r2", expectedStatus: "accepted" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 6000 },
    ],
  };
  assert.equal(checkSemanticEligibility({ businessRequirement: BUSINESS_REQUIREMENT, interpretedRule: "x", plan: cross }).eligible, false);
  assert.equal(checkSemanticEligibility({ businessRequirement: BUSINESS_REQUIREMENT, interpretedRule: validPlan(BUSINESS_REQUIREMENT).interpretedRule, plan: validPlan(BUSINESS_REQUIREMENT) }).eligible, true);
});
test("M1.4 timeout never retries and stalled body times out", async () => {
  const s = snap(); clear(); withMetaEnv();
  const origTimeout = (await import("../src/metaClient.js")).UPSTREAM_TIMEOUT_MS;
  assert.ok(typeof origTimeout === "number" && origTimeout > 0);
  try {
    let calls = 0;
    const aborting = async () => { calls += 1; const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: aborting });
    assert.equal(out.code, "MODEL_TIMEOUT");
    assert.equal(calls, 1);
    let bodyCalls = 0;
    const stalledBody = async () => {
      bodyCalls += 1;
      return { ok: true, status: 200, json: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; } };
    };
    const out2 = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: stalledBody });
    assert.equal(bodyCalls, 1);
    assert.equal(out2.code, "MODEL_TIMEOUT");
  } finally { restore(s); }
});
test("M1.4 model identity reported truthfully with mismatch note", async () => {
  const s = snap(); clear(); withMetaEnv();
  const mock = async (arg) => ({ ...validPlan(arg.businessRequirement), _diag: { modelId: "other-model", finishReason: "stop" } });
  const started = await startSrv({ generateTestPlan: mock });
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const j = parseJson(await httpPost(started.port, "/api/interpret", body));
    assert.equal(j.status, "VALID");
    assert.equal(j.modelId, "other-model");
    assert.equal(j._diag.modelMismatch, true);
    assert.ok(typeof j._diag.configuredModel === "string" && j._diag.configuredModel.length > 0);
  } finally { await closeSrv(started.server); restore(s); }
});
