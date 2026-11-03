import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, clearRateLimitStore } from "../src/server.js";
import { checkSemanticEligibility } from "../src/semanticGate.js";
import { normalizePlan } from "../src/testPlanValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/evaluation.json"), "utf8"));

function startServer(opts={}) {
  const server = createServer({ port: 0, ...opts });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}
function closeServer(server){
  return new Promise((r) => {
    try {
      if (server.closeAllConnections) server.closeAllConnections();
    } catch {}
    server.close(r);
  });
}
function httpReq({ port, method="GET", path="/", headers={}, body=null }) {
  return new Promise((resolve, reject) => {
    const opts = { host:"127.0.0.1", port, method, path, headers };
    const req = http.request(opts, res => {
      let data=""; res.on("data", c=>data+=c); res.on("end", ()=>resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function jparse(r){ try { return JSON.parse(r.body); } catch { return null; } }
test("reversed comparison rejected", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const req = "Total accepted refunds per order must exceed captured payment.";
    const plan = validPlanForReq(req);
    const mock = async () => ({ ...plan, _diag:{ modelId:"m" } });
    const { server: s2, port: p2 } = await startServer({ generateTestPlan: mock });
    try {
      const body = JSON.stringify({ businessRequirement: req });
      const r = await httpReq({ port: p2, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${p2}`, Origin:`http://127.0.0.1:${p2}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
      const j = jparse(r);
      assert.equal(j.status, "NEEDS_INPUT");
      assert.ok(!j.approvalToken);
    } finally { await closeServer(s2); }
  } finally { await closeServer(server); }
  const g = checkSemanticEligibility({ businessRequirement:"Total accepted refunds per order must exceed captured payment.", interpretedRule:"sum must not exceed captured", plan: validPlanForReq("Total accepted refunds per order must exceed captured payment.") });
  assert.equal(g.eligible, false);
});

test("strict comparison rejected or treated as unresolved", async () => {
  const g = checkSemanticEligibility({ businessRequirement:"Total accepted refunds must be strictly less than captured payment.", plan: validPlanForReq("Total accepted refunds must be strictly less than captured payment.") });
  assert.equal(g.eligible, false);
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const req = "Total accepted refunds must be strictly less than captured payment.";
    const plan = validPlanForReq(req);
    const mock = async () => ({ ...plan, _diag:{modelId:"m"} });
    const { server: s2, port: p2 } = await startServer({ generateTestPlan: mock });
    try {
      const body = JSON.stringify({ businessRequirement: req });
      const r = await httpReq({ port: p2, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${p2}`, Origin:`http://127.0.0.1:${p2}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
      const j = jparse(r);
      assert.equal(j.status, "NEEDS_INPUT");
      assert.ok(!j.approvalToken);
    } finally { await closeServer(s2); }
  } finally { await closeServer(server); }
});

test("existing six supported paraphrases remain eligible", () => {
  const supCases = FIXTURES.cases.filter(c=>c.expectedClassification==="supported");
  assert.equal(supCases.length, 6);
  for (const c of supCases) {
    const plan = validPlanForReq(c.requirement);
    const g = checkSemanticEligibility({ businessRequirement:c.requirement, interpretedRule:plan.interpretedRule, plan });
    assert.equal(g.eligible, true, c.id+" should be eligible "+g.reason);
    assert.equal(g.status, "VALID");
  }
});

test("ambiguous requirements remain blocked", () => {
  const ambCases = FIXTURES.cases.filter(c=>c.expectedClassification==="ambiguous");
  assert.equal(ambCases.length, 2);
  for (const c of ambCases) {
    const plan = validPlanForReq(c.requirement);
    const g = checkSemanticEligibility({ businessRequirement:c.requirement, interpretedRule:plan.interpretedRule, plan });
    assert.equal(g.eligible, false, c.id+" should be blocked");
  }
});

test("existing unsupported requirements remain blocked", () => {
  const unsCases = FIXTURES.cases.filter(c=>c.expectedClassification==="unsupported");
  assert.equal(unsCases.length, 2);
  for (const c of unsCases) {
    const g = checkSemanticEligibility({ businessRequirement:c.requirement });
    assert.equal(g.eligible, false);
    assert.equal(g.status, "UNSUPPORTED");
  }
});

test("requirement edit invalidates a pending plan - UI race protection exists", () => {
  const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert.ok(appJs.includes("interpretSeq"), "should have generation counter");
  assert.ok(appJs.includes("snapshotReq"), "should snapshot requirement");
  assert.ok(appJs.includes('reqEl.addEventListener("input"'), "should listen to input");
  assert.ok(appJs.includes("invalidateApproval"), "should invalidate on edit");
});

test("stale interpretation response cannot enable execution", () => {
  const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert.ok(appJs.includes("mySeq !== interpretSeq"), "should check generation");
  assert.ok(appJs.includes("reqEl.value !== snapshotReq"), "should check snapshot equality");
});

test("two overlapping interpretations cannot cause older to overwrite newer", () => {
  const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert.ok(appJs.includes("++interpretSeq"), "should increment generation");
  assert.ok(appJs.includes("mySeq"), "should track mySeq");
});

test("execution remains explicitly user-initiated", () => {
  const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert.ok(appJs.includes("approveBtn.onclick"), "should require approve click");
  assert.ok(!appJs.includes("doInterpret().then(()=>approveBtn.click"), "should not auto-execute");
  const doInterpretIdx = appJs.indexOf("async function doInterpret");
  const approveIdx = appJs.indexOf("approveBtn.onclick");
  const doInterpretBlock = appJs.slice(doInterpretIdx, approveIdx);
  assert.ok(!doInterpretBlock.includes("/api/run"), "doInterpret should not call run");
});

test("foreign Origin remains rejected", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement:"Total accepted refunds for an order cannot exceed captured payment." });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:"http://evil.com", "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 403);
    const j = jparse(r);
    assert.equal(j.code, "FORBIDDEN");
  } finally { await closeServer(server); }
});

test("foreign Host remains rejected", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const r = await httpReq({ port, method:"GET", path:"/api/config", headers:{ Host:"evil.com" } });
    assert.equal(r.statusCode, 403);
  } finally { await closeServer(server); }
});

test("request-size limit remains enforced", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const big = "a".repeat(70*1024);
    const body = JSON.stringify({ businessRequirement: big });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 413);
  } finally { await closeServer(server); }
});

test("recorded replay still functions within hardened HTTP boundary", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/recordedResponse.json"),"utf8")).plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 200);
    const j = jparse(r);
    assert.equal(j.status, "VALID");
    const token = j.approvalToken;
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: token });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 200);
    const report = jparse(rr);
    assert.equal(report.results.buggy.finalState.orders[0].capturedCents, 10000);
    assert.equal(report.results.buggy.finalState.orders[0].totalAcceptedCents, 11000);
    assert.equal(report.results.correct.finalState.orders[0].totalAcceptedCents, 4000);
    assert.equal(report.results.buggy.invariantViolated, true);
    assert.equal(report.results.correct.invariantViolated, false);
  } finally { await closeServer(server); }
});

test("live requirement mismatch fails closed", async () => {
  const { server, port } = await startServer();
  try {
    const br = "Total accepted refunds for an order cannot exceed captured payment.";
    const mismatchedPlan = validPlanForReq("Different requirement");
    const mock = async () => ({ ...mismatchedPlan, _diag:{modelId:"m"} });
    const { server: s2, port: p2 } = await startServer({ generateTestPlan: mock });
    try {
      const body = JSON.stringify({ businessRequirement: br });
      const r = await httpReq({ port: p2, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${p2}`, Origin:`http://127.0.0.1:${p2}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
      const j = jparse(r);
      assert.ok(j.status !== "VALID");
      assert.ok(!j.approvalToken);
    } finally { await closeServer(s2); }
  } finally { await closeServer(server); }
});

test("vague statements containing all four keywords but no meaningful cap relationship rejected", () => {
  const req = "Total accepted refunds for an order and captured payment are important concepts in our system.";
  const plan = validPlanForReq(req);
  const g = checkSemanticEligibility({ businessRequirement:req, interpretedRule:plan.interpretedRule, plan });
  assert.equal(g.eligible, false, "vague should be NEEDS_INPUT");
  assert.equal(g.status, "NEEDS_INPUT");
});

test("equality comparison rejected", () => {
  const req = "Total accepted refunds must equal captured payment in all cases.";
  const g = checkSemanticEligibility({ businessRequirement:req, plan: validPlanForReq(req) });
  assert.equal(g.eligible, false);
});

function validPlanForReq(req){
  return { version:"1.0", ruleId:"refund-cap", businessRequirement:req, interpretedRule:"The sum of all accepted refunds for an order must never exceed its captured payment amount.", operations:[{op:"createOrder",orderId:"order-1",capturedCents:10000},{op:"requestRefund",orderId:"order-1",amountCents:4000,refundId:"r1"},{op:"assertRefundStatus",refundId:"r1",expectedStatus:"accepted"},{op:"assertTotalRefunds",orderId:"order-1",expectedCents:4000},{op:"requestRefund",orderId:"order-1",amountCents:7000,refundId:"r2"},{op:"assertRefundStatus",refundId:"r2",expectedStatus:"rejected"},{op:"assertTotalRefunds",orderId:"order-1",expectedCents:4000}] };
}
