import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatRequestBody } from "../src/metaClient.js";
import { generateTestPlan } from "../src/planner.js";
import { validateTestPlan, normalizePlan } from "../src/testPlanValidator.js";
import { checkSemanticEligibility } from "../src/semanticGate.js";
import { createServer, clearRateLimitStore } from "../src/server.js";
import { BUSINESS_REQUIREMENT } from "../src/catalog.js";
import { executePlan } from "../src/executor.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/evaluation.json"), "utf8"));
const KEYS = ["MODEL_PROVIDER","MODEL_API_KEY","META_MODEL","META_BASE_URL","META_MAX_TOKENS","META_RETRY_MAX_TOKENS","MODEL_MAX_TOKENS","MODEL_RETRY_MAX_TOKENS","BASETEN_API_KEY","BASETEN_BASE_URL","BASETEN_MODEL","BASETEN_MAX_TOKENS","BASETEN_RETRY_MAX_TOKENS"];
const snap = () => { const o = {}; for (const k of KEYS) o[k] = process.env[k]; return o; };
const restore = (s) => { for (const k of KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } };
const clear = () => { for (const k of KEYS) delete process.env[k]; };
function withMetaEnv() { process.env.MODEL_PROVIDER = "META"; process.env.MODEL_API_KEY = "test-meta-key"; delete process.env.BASETEN_API_KEY; }
function metaOk(content, extra) { return { ok: true, status: 200, json: async () => ({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content } }], usage: { completion_tokens: 300, ...(extra || {}) } }) }; }
function validOps() { return [{ op: "createOrder", orderId: "order-1", capturedCents: 10000 },{ op: "requestRefund", orderId: "order-1", amountCents: 4000, refundId: "r1" },{ op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },{ op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 },{ op: "requestRefund", orderId: "order-1", amountCents: 7000, refundId: "r2" },{ op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },{ op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 }]; }
function validGen() { return { interpretedRule: "The sum of accepted refunds for an order must never exceed its captured payment.", operations: validOps() }; }
function startSrv(opts) { const s = createServer({ port: 0, ...(opts || {}) }); return new Promise((res, rej) => { s.listen(0, "127.0.0.1", () => res({ server: s, port: s.address().port })); s.on("error", rej); }); }
function closeSrv(s) { return new Promise((r) => { try { if (s.closeAllConnections) s.closeAllConnections(); } catch {} s.close(r); }); }
function httpPost(port, pth, body) { const h = { Host: "127.0.0.1:" + port, "Content-Type": "application/json", Origin: "http://127.0.0.1:" + port, "Content-Length": Buffer.byteLength(body) }; return new Promise((res, rej) => { const q = http.request({ host: "127.0.0.1", port, method: "POST", path: pth, headers: h }, (rp) => { let d = ""; rp.on("data", (c) => (d += c)); rp.on("end", () => res({ statusCode: rp.statusCode, body: d })); }); q.on("error", rej); q.write(body); q.end(); }); }
const jparse = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

test("M1.5 eligible-plan outbound uses two-field schema with low reasoning and no tools", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let body = null;
    const fetchImpl = async (u, o) => { body = JSON.parse(o.body); return metaOk(JSON.stringify(validGen())); };
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl, contract: "eligible-plan" });
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.required, ["interpretedRule", "operations"]);
    assert.deepEqual(Object.keys(body.response_format.json_schema.schema.properties).sort(), ["interpretedRule", "operations"]);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.ok(!JSON.stringify(body.response_format.json_schema.schema).includes("unsupported"));
    assert.ok(!JSON.stringify(body.response_format.json_schema.schema).includes("outcome"));
    assert.equal(body.reasoning_effort, "low");
    assert.ok(!("tools" in body));
    assert.ok(!("tool_choice" in body));
    assert.ok(!("temperature" in body));
    assert.equal(out.version, "1.0");
    assert.equal(out.ruleId, "refund-cap");
    assert.equal(out.businessRequirement, BUSINESS_REQUIREMENT);
    assert.equal(out.operations.length, 7);
    assert.equal(validateTestPlan(normalizePlan(out)).ok, true);
  } finally { restore(s); }
});

test("M1.5 reasoning low only for META eligible-plan", () => {
  const a = buildChatRequestBody({ provider: "META", model: "muse-spark-1.3", messages: [{ role: "user", content: "x" }], budget: 4096, contract: "eligible-plan" });
  assert.equal(a.reasoning_effort, "low");
  const b = buildChatRequestBody({ provider: "META", model: "muse-spark-1.3", messages: [{ role: "user", content: "x" }], budget: 4096, contract: "refund-plan" });
  assert.ok(!("reasoning_effort" in b));
  assert.ok(b.response_format.json_schema.schema.required.includes("result"));
  const c = buildChatRequestBody({ provider: "BASETEN", model: "m", messages: [{ role: "user", content: "x" }], budget: 4096, contract: "eligible-plan" });
  assert.ok(!("reasoning_effort" in c));
  assert.equal(c.temperature, 0);
});

test("M1.5 eligible-plan prompt concise no schema dump tools policy bypass", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let body = null;
    const fetchImpl = async (u, o) => { body = JSON.parse(o.body); return metaOk(JSON.stringify(validGen())); };
    await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl, contract: "eligible-plan" });
    const promptStr = JSON.stringify(body.messages);
    assert.ok(!promptStr.includes("tool_choice"));
    assert.ok(promptStr.length < 5000);
    assert.ok(JSON.stringify(body).length < 20000);
  } finally { restore(s); }
});

test("M1.5 live eligible-plan loopback authorizes and executes 110 vs 40", async () => {
  const s = snap(); clear(); withMetaEnv();
  let capturedBody = null;
  const mockFetch = async (u, o) => { capturedBody = JSON.parse(o.body); return metaOk(JSON.stringify(validGen())); };
  const { generateTestPlan: realGen } = await import("../src/planner.js");
  const gen = (args) => realGen({ businessRequirement: args.businessRequirement, fetchImpl: mockFetch, contract: "eligible-plan" });
  const started = await startSrv({ generateTestPlan: gen });
  try {
    clearRateLimitStore();
    const r = await httpPost(started.port, "/api/interpret", JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT }));
    assert.equal(r.statusCode, 200);
    const j = jparse(r);
    assert.equal(j.status, "VALID");
    assert.ok(j.approvalToken);
    assert.equal(j.plan.operations.length, 7);
    assert.equal(j.live, true);
    assert.deepEqual(capturedBody.response_format.json_schema.schema.required, ["interpretedRule", "operations"]);
    assert.equal(capturedBody.reasoning_effort, "low");
    const rr = await httpPost(started.port, "/api/run", JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT, plan: j.plan, approvalToken: j.approvalToken }));
    assert.equal(rr.statusCode, 200);
    const rep = jparse(rr);
    assert.equal(rep.results.buggy.finalState.orders[0].totalAcceptedCents, 11000);
    assert.equal(rep.results.correct.finalState.orders[0].totalAcceptedCents, 4000);
  } finally { await closeSrv(started.server); restore(s); }
});

test("M1.5 refusal empty malformed policy omit extra fail closed no retry", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    const uni = { version: "1.0" }; uni["ruleIdnocen \u00ed"] = "refund-cap"; uni["operations ll"] = validOps();
    const cases = [
      { name: "refusal", fetch: async () => ({ ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "stop", message: { refusal: "no", content: "" } }], usage: {} }) }) },
      { name: "empty", fetch: async () => ({ ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "stop", message: { content: "" } }], usage: { completion_tokens: 10 } }) }) },
      { name: "malformed-unicode", fetch: async () => metaOk(JSON.stringify(uni)) },
      { name: "policy-text", fetch: async () => metaOk("I cannot comply because tools unavailable.") },
      { name: "omit-ops", fetch: async () => metaOk(JSON.stringify({ interpretedRule: "The sum must not exceed captured." })) },
    ];
    for (const c of cases) {
      let calls = 0;
      const counting = async (u, o) => { calls += 1; return c.fetch(u, o); };
      const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: counting, contract: "eligible-plan" });
      assert.equal(out.__modelError, true, c.name);
      assert.equal(calls, 1, c.name + " no retry");
    }
    let ec = 0;
    const extra = async (u, o) => { ec += 1; return metaOk(JSON.stringify({ interpretedRule: "x", operations: validOps(), version: "9.9", extra: 1 })); };
    const eo = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: extra, contract: "eligible-plan" });
    assert.equal(eo.__modelError, true);
    assert.equal(ec, 1);
    const cand = { version: "1.0", ruleId: "refund-cap", businessRequirement: BUSINESS_REQUIREMENT, interpretedRule: "placeholder", operations: validOps() };
    assert.equal(checkSemanticEligibility({ businessRequirement: BUSINESS_REQUIREMENT, interpretedRule: "placeholder", plan: cand }).eligible, false);
  } finally { restore(s); }
});

test("M1.5 invalid refs cross-order contradiction blocked with no auth", async () => {
  const s = snap(); clear(); withMetaEnv();
  const { generateTestPlan: realGen } = await import("../src/planner.js");
  async function liveWith(genObj) {
    const mf = async () => metaOk(JSON.stringify(genObj));
    const gen = (args) => realGen({ businessRequirement: args.businessRequirement, fetchImpl: mf, contract: "eligible-plan" });
    const started = await startSrv({ generateTestPlan: gen });
    try {
      clearRateLimitStore();
      const r = await httpPost(started.port, "/api/interpret", JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT }));
      return jparse(r);
    } finally { await closeSrv(started.server); }
  }
  try {
    const badRef = { interpretedRule: "The sum must not exceed captured.", operations: [{ op: "createOrder", orderId: "order-1", capturedCents: 10000 }, { op: "requestRefund", orderId: "order-unknown", amountCents: 100, refundId: "r1" }] };
    assert.ok(!(await liveWith(badRef)).approvalToken);
    const cross = { interpretedRule: "The sum for an order must not exceed captured.", operations: [{ op: "createOrder", orderId: "order-1", capturedCents: 10000 }, { op: "createOrder", orderId: "order-2", capturedCents: 10000 }, { op: "requestRefund", orderId: "order-1", amountCents: 6000, refundId: "r1" }, { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" }, { op: "requestRefund", orderId: "order-2", amountCents: 6000, refundId: "r2" }, { op: "assertRefundStatus", refundId: "r2", expectedStatus: "accepted" }, { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 6000 }] };
    assert.ok(!(await liveWith(cross)).approvalToken);
    const contra = { interpretedRule: "Process refunds quickly.", operations: validOps() };
    assert.ok(!(await liveWith(contra)).approvalToken);
  } finally { restore(s); }
});

test("M1.5 truncation retry succeeds once with identical handling", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let n = 0;
    const f = async (u, o) => {
      n += 1;
      const b = JSON.parse(o.body);
      if (n === 1) return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "length", message: { content: "" } }], usage: { completion_tokens: b.max_completion_tokens - 1 } }) };
      return metaOk(JSON.stringify(validGen()));
    };
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, maxTokens: 4096, fetchImpl: f, contract: "eligible-plan" });
    assert.equal(n, 2);
    assert.equal(out.operations.length, 7);
    let m = 0;
    const f2 = async (u, o) => { m += 1; const b2 = JSON.parse(o.body); if (m === 1) return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "length", message: { content: "" } }], usage: { completion_tokens: b2.max_completion_tokens - 1 } }) }; return metaOk("not json {"); };
    const out2 = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, maxTokens: 4096, fetchImpl: f2, contract: "eligible-plan" });
    assert.equal(m, 2);
    assert.equal(out2.__modelError, true);
  } finally { restore(s); }
});

test("M1.5 stop heavy reasoning no retry and browser cannot select contract", async () => {
  const s = snap(); clear(); withMetaEnv();
  try {
    let calls = 0;
    const f = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "stop", message: { content: "not json {" } }], usage: { completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 3950 } } }) }; };
    const out = await generateTestPlan({ businessRequirement: BUSINESS_REQUIREMENT, fetchImpl: f, contract: "eligible-plan" });
    assert.equal(out.__modelError, true);
    assert.equal(calls, 1);
    let capBody = null;
    const mf = async (u, o) => { capBody = JSON.parse(o.body); return metaOk(JSON.stringify(validGen())); };
    const { generateTestPlan: realGen } = await import("../src/planner.js");
    const gen = (args) => realGen({ businessRequirement: args.businessRequirement, fetchImpl: mf, contract: "eligible-plan" });
    const started = await startSrv({ generateTestPlan: gen });
    try {
      clearRateLimitStore();
      const evil = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT, contract: "refund-plan", provider: "BASETEN" });
      const r = await httpPost(started.port, "/api/interpret", evil);
      assert.equal(jparse(r).status, "VALID");
      assert.deepEqual(capBody.response_format.json_schema.schema.required, ["interpretedRule", "operations"]);
      assert.equal(capBody.reasoning_effort, "low");
    } finally { await closeSrv(started.server); }
  } finally { restore(s); }
});

test("M1.5 six supported pass others blocked without provider", async () => {
  for (const c of FIXTURES.cases.filter((x) => x.expectedClassification === "supported")) assert.equal(checkSemanticEligibility({ businessRequirement: c.requirement }).eligible, true, c.id);
  for (const c of FIXTURES.cases.filter((x) => x.expectedClassification !== "supported")) assert.equal(checkSemanticEligibility({ businessRequirement: c.requirement }).eligible, false, c.id);
  const s = snap(); clear(); withMetaEnv();
  const started = await startSrv({ generateTestPlan: async () => { throw new Error("SHOULD_NOT_RUN"); } });
  try {
    clearRateLimitStore();
    for (const c of FIXTURES.cases.filter((x) => x.expectedClassification !== "supported")) {
      const r = await httpPost(started.port, "/api/interpret", JSON.stringify({ businessRequirement: c.requirement }));
      const j = jparse(r);
      assert.ok(j.status !== "VALID", c.id);
      assert.ok(!j.approvalToken, c.id);
    }
  } finally { await closeSrv(started.server); restore(s); }
});

test("M1.5 baseten recorded applicant preserved", async () => {
  const s = snap(); clear();
  try {
    process.env.MODEL_PROVIDER = "BASETEN"; process.env.BASETEN_API_KEY = "k";
    let b = {};
    await generateTestPlan({ businessRequirement: "x", fetchImpl: async (u, o) => { b = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ version: "1.0", ruleId: "refund-cap", businessRequirement: "x", interpretedRule: "The sum must not exceed captured.", operations: [{ op: "createOrder", orderId: "order-1", capturedCents: 10000 }] }) } }], usage: {} }) }; } });
    assert.equal(b.temperature, 0);
    assert.equal(b.response_format.type, "json_object");
  } finally { restore(s); }
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/recordedResponse.json"), "utf8"));
  assert.equal(validateTestPlan(normalizePlan(rec.plan)).ok, true);
  const buggy = executePlan({ plan: normalizePlan(rec.plan), approved: true, variant: "buggy" });
  const correct = executePlan({ plan: normalizePlan(rec.plan), approved: true, variant: "correct" });
  assert.equal(buggy.finalState.orders[0].totalAcceptedCents, 11000);
  assert.equal(correct.finalState.orders[0].totalAcceptedCents, 4000);
  const mod = await import("../src/metaClient.js");
  let abody = null;
  const out = await mod.interpretWithMeta({ question: { id: "q1", text: "x" }, profile: {}, fetchImpl: async (u, o) => { abody = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ model: "m", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ questionId: "q1", interpretation: "x", proposedAnswer: "", evidenceKeys: [], confidence: 0 }) } }], usage: {} }) }; } });
  assert.ok(!out.__modelError);
  assert.equal(abody.response_format.type, "json_object");
});
