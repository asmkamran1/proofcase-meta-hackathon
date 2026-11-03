import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildChatRequestBody, fromMetaEnvelope, TEST_PLAN_JSON_SCHEMA } from "../src/metaClient.js";
import { generateTestPlan } from "../src/planner.js";
import { normalizePlan, validateTestPlan } from "../src/testPlanValidator.js";
import { createServer, clearRateLimitStore } from "../src/server.js";
import { BUSINESS_REQUIREMENT } from "../src/catalog.js";

// Snapshot every provider-related key so local .env.local contents and
// parallel test files cannot leak into assertions or budgets.
const KEYS = ["MODEL_PROVIDER","MODEL_API_KEY","META_MODEL","META_BASE_URL","META_MAX_TOKENS","META_RETRY_MAX_TOKENS","MODEL_MAX_TOKENS","MODEL_RETRY_MAX_TOKENS","BASETEN_API_KEY","BASETEN_BASE_URL","BASETEN_MODEL","BASETEN_MAX_TOKENS","BASETEN_RETRY_MAX_TOKENS"];
const snap = () => { const o = {}; for (const k of KEYS) o[k] = process.env[k]; return o; };
const restore = (s) => { for (const k of KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } };
const clear = () => { for (const k of KEYS) delete process.env[k]; };
function withMetaEnv() { process.env.MODEL_PROVIDER = "META"; process.env.MODEL_API_KEY = "test-meta-key"; delete process.env.BASETEN_API_KEY; }
function metaOk(content, model, extra) {
  return { ok: true, status: 200, json: async () => ({ model: model || "muse-spark-1.3-contributor", choices: [{ finish_reason: "stop", message: { content } }], usage: { completion_tokens: 2617, completion_tokens_details: { reasoning_tokens: 2409 }, ...(extra || {}) } }) };
}
function envelopePlan(req) {
  return { result: { outcome: "supported", version: "1.0", ruleId: "refund-cap", businessRequirement: req, interpretedRule: "The sum of accepted refunds for an order must never exceed its captured payment.", operations: [{ op: "createOrder", orderId: "order-1", capturedCents: 10000 }, { op: "requestRefund", orderId: "order-1", amountCents: 4000, refundId: "r1" }, { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" }, { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 }, { op: "requestRefund", orderId: "order-1", amountCents: 7000, refundId: "r2" }, { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" }, { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 }] } };
}
function capturedMalformed() {
  const ops = envelopePlan("Total accepted refunds for an order cannot exceed captured payment.").result.operations;
  const obj = { version: "1.0" };
  obj["ruleIdnocen\u00ed"] = "refund-cap";
  obj["businessRequirement fot"] = "Total accepted refunds for an order cannot exceed captured payment.";
  obj["interpretedRule nada"] = "The sum of accepted refunds for an order must never exceed its captured payment.";
  obj["operations ll"] = ops;
  return JSON.stringify(obj);
}

function startSrv(o) { const sv = createServer({ port: 0, ...(o || {}) }); return new Promise((res, rej) => { sv.listen(0, "127.0.0.1", () => res({ server: sv, port: sv.address().port })); sv.on("error", rej); }); }
function closeSrv(s) { return new Promise((r) => { try { if (s.closeAllConnections) s.closeAllConnections(); } catch {} s.close(r); }); }
function httpReq(o) { return new Promise((res, rej) => { const r = http.request({ host: "127.0.0.1", port: o.port, method: o.method || "GET", path: o.path || "/", headers: o.headers || {} }, (rp) => { let d = ""; rp.on("data", (c) => (d += c)); rp.on("end", () => res({ statusCode: rp.statusCode, body: d })); }); r.on("error", rej); if (o.body) r.write(o.body); r.end(); }); }
const postHeaders = (port, body) => ({ Host: "127.0.0.1:" + port, "Content-Type": "application/json", Origin: "http://127.0.0.1:" + port, "Content-Length": Buffer.byteLength(body) });
const parseJson = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

test("M1.3 captured malformed output stays invalid, no repair or retry", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let calls = 0;
    const fetchImpl = async () => { calls++; return metaOk(capturedMalformed()); };
    const out = await generateTestPlan({ businessRequirement: "Total accepted refunds for an order cannot exceed captured payment.", fetchImpl });
    assert.equal(calls, 1);
    assert.throws(() => validateTestPlan(out), /MALFORMED_PLAN: ruleId required/);
    assert.equal(out.ruleId, undefined);
    assert.equal(out.operations, undefined);
  } finally { restore(s); }
});

test("M1.3 malformed output cannot obtain authorization", async () => {
  const s = snap(); clear(); withMetaEnv();
  const gen = async () => {
    const f = async () => metaOk(capturedMalformed());
    return generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: f });
  };
  const { server, port } = await startSrv({ generateTestPlan: gen });
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const j = parseJson(await httpReq({ port, method: "POST", path: "/api/interpret", headers: postHeaders(port, body), body }));
    assert.equal(j.status, "INVALID_PLAN");
    assert.equal(j.code, "INVALID_PLAN");
    assert.ok(!j.approvalToken);
    assert.ok(!j.plan || !j.plan.ruleId);
  } finally { await closeSrv(server); restore(s); }
});

test("M1.3 strict schema locks canonical top-level contract", () => {
  const b = buildChatRequestBody({ provider: "META", model: "muse-spark-1.3", messages: [{ role: "user", content: "x" }], budget: 4096 });
  assert.equal(b.response_format.type, "json_schema");
  assert.equal(b.response_format.json_schema.strict, true);
  const schema = b.response_format.json_schema.schema;
  assert.deepEqual(schema.required, ["result"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ["result"]);
  assert.equal(schema.properties.result.anyOf.length, 2);
});

test("M1.3 every schema object forbids extras and requires all keys", () => {
  const check = (node, where) => {
    assert.equal(node.type, "object", "object at " + where);
    assert.equal(node.additionalProperties, false, "extras at " + where);
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), "required at " + where);
    for (const k of Object.keys(node.properties)) {
      const v = node.properties[k];
      if (v && v.type === "object" && v.properties) check(v, where + "." + k);
      if (v && v.anyOf) for (let i = 0; i < v.anyOf.length; i++) { if (v.anyOf[i].type === "object") check(v.anyOf[i], where + "." + k + "[" + i + "]"); }
      if (v && v.type === "array" && v.items && v.items.anyOf) for (let i = 0; i < v.items.anyOf.length; i++) check(v.items.anyOf[i], where + "." + k + ".items[" + i + "]");
    }
  };
  check(TEST_PLAN_JSON_SCHEMA, "root");
});

test("M1.3 supported envelope converts to canonical flat plan", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let body = null;
    const fetchImpl = async (u, o) => { body = JSON.parse(o.body); return metaOk(JSON.stringify(envelopePlan("req-text"))); };
    const out = await generateTestPlan({ businessRequirement: "req-text", fetchImpl });
    assert.equal(out.version, "1.0");
    assert.equal(out.ruleId, "refund-cap");
    assert.equal(out.businessRequirement, "req-text");
    assert.equal(out.operations.length, 7);
    assert.ok(!("result" in out));
    assert.equal(validateTestPlan(out).ok, true);
    assert.equal(body.response_format.json_schema.strict, true);
  } finally { restore(s); }
});

test("M1.3 unsupported envelope stays safe and never executable", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    const fetchImpl = async () => metaOk(JSON.stringify({ result: { outcome: "unsupported", reason: "Cannot express with catalog" } }));
    const out = await generateTestPlan({ businessRequirement: "Refunds must be emailed within 24 hours", fetchImpl });
    assert.equal(out.unsupported, true);
    const v = validateTestPlan(out);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "UNSUPPORTED_REQUIREMENT");
  } finally { restore(s); }
});

test("M1.3 contradictory envelopes fail closed", () => {
  assert.equal(fromMetaEnvelope({ result: { outcome: "supported", version: "1.0", ruleId: "refund-cap", businessRequirement: "x", interpretedRule: "y", operations: [], reason: "extra" } }).__modelError, true);
  assert.equal(fromMetaEnvelope({ result: { outcome: "supported", version: "1.0", ruleId: "refund-cap" } }).__modelError, true);
  assert.equal(fromMetaEnvelope({ result: { outcome: "maybe", reason: "x" } }).__modelError, true);
  assert.equal(fromMetaEnvelope({ result: { outcome: "unsupported", reason: "x" }, extra: 1 }).__modelError, true);
  assert.equal(fromMetaEnvelope({ result: { outcome: "unsupported" } }).__modelError, true);
});

test("M1.3 legacy flat payload still passes through for recorded compatibility", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    const flat = { version: "1.0", ruleId: "refund-cap", businessRequirement: "x", interpretedRule: "The sum of accepted refunds for an order must not exceed its captured payment.", operations: [{ op: "createOrder", orderId: "order-1", capturedCents: 10000 }, { op: "requestRefund", orderId: "order-1", amountCents: 4000, refundId: "r1" }, { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" }] };
    const out = await generateTestPlan({ businessRequirement: "x", fetchImpl: async () => metaOk(JSON.stringify(flat)) });
    assert.equal(validateTestPlan(out).ok, true);
  } finally { restore(s); }
});

test("M1.3 Baseten payload unchanged", () => {
  const b = buildChatRequestBody({ provider: "BASETEN", model: "meta-models/muse-spark-open-1026", messages: [{ role: "user", content: "x" }], budget: 4096 });
  assert.equal(b.temperature, 0);
  assert.equal(b.response_format.type, "json_object");
  assert.ok(!("max_completion_tokens" in b));
});