import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, clearRateLimitStore } from "../src/server.js";
import { approvalHash, issueAuthorization, verifyAuthorization, createSigningKey, canonicalRequirement, canonicalPlanHash, canonicalRequirementHash, TOKEN_TTL_MS, MAX_TOKEN_LENGTH } from "../src/approval.js";
import { BUSINESS_REQUIREMENT } from "../src/catalog.js";
import { normalizePlan } from "../src/testPlanValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
function startServer(opts = {}) {
  const server = createServer({ port: 0, ...opts });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}
function closeServer(server) {
  return new Promise((r) => {
    try {
      if (server.closeAllConnections) server.closeAllConnections();
    } catch {}
    server.close(r);
  });
}
function httpReq({ port, method="GET", path="/", headers={}, body=null }) {
  return new Promise((resolve, reject) => {
    const opts = { host: "127.0.0.1", port, method, path, headers };
    const req = http.request(opts, res => {
      let data=""; res.on("data", c=>data+=c); res.on("end", ()=>resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function jparse(r){ try { return JSON.parse(r.body); } catch { return null; } }
function validPlanForReq(req){
  return { version:"1.0", ruleId:"refund-cap", businessRequirement:req, interpretedRule:"The sum of all accepted refunds for an order must never exceed its captured payment amount.", operations:[{op:"createOrder",orderId:"order-1",capturedCents:10000},{op:"requestRefund",orderId:"order-1",amountCents:4000,refundId:"r1"},{op:"assertRefundStatus",refundId:"r1",expectedStatus:"accepted"},{op:"assertTotalRefunds",orderId:"order-1",expectedCents:4000},{op:"requestRefund",orderId:"order-1",amountCents:7000,refundId:"r2"},{op:"assertRefundStatus",refundId:"r2",expectedStatus:"rejected"},{op:"assertTotalRefunds",orderId:"order-1",expectedCents:4000}] };
}

const RECORDED = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/recordedResponse.json"), "utf8"));

test("recorded matching requirement returns VALID and server authorization", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 200);
    const j = jparse(r);
    assert.equal(j.status, "VALID");
    assert.ok(typeof j.approvalToken === "string" && j.approvalToken.length > 20);
    assert.ok(j.approvalToken.includes("."), "token should be HMAC format");
    assert.equal(j.live, false);
    assert.equal(j.modelLabel, "RECORDED META RESPONSE");
  } finally { await closeServer(server); }
});

test("recorded mismatching requirement returns no token with RECORDED_REQUIREMENT_MISMATCH", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: "Different requirement that does not match", useRecorded: true });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
    const j = jparse(r);
    assert.equal(j.code, "RECORDED_REQUIREMENT_MISMATCH");
    assert.ok(!j.approvalToken);
  } finally { await closeServer(server); }
});

test("ambiguous recorded request returns no token", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: "Refunds should not be too large.", useRecorded: true });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    assert.ok(!j.approvalToken, "ambiguous should not issue token");
    if (r.statusCode === 400) assert.equal(j.code, "RECORDED_REQUIREMENT_MISMATCH");
    else assert.ok(["NEEDS_INPUT","UNSUPPORTED"].includes(j.status));
  } finally { await closeServer(server); }
});

test("recorded response never invokes Meta", async () => {
  let called = false;
  const mockPlanner = async () => { called = true; throw new Error("should not be called"); };
  const { server, port } = await startServer({ generateTestPlan: mockPlanner });
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 200);
    assert.equal(called, false, "generateTestPlan should not be called for recorded");
  } finally { await closeServer(server); }
});

test("valid recorded plan executes against both variants", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    assert.equal(j.status, "VALID");
    const token = j.approvalToken;
    const plan = j.plan;
    body = JSON.stringify({ businessRequirement: br, plan, approvalToken: token });
    r = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 200);
    const report = jparse(r);
    assert.equal(report.results.buggy.finalState.orders[0].capturedCents, 10000);
    assert.equal(report.results.buggy.finalState.orders[0].totalAcceptedCents, 11000);
    assert.equal(report.results.correct.finalState.orders[0].totalAcceptedCents, 4000);
    assert.equal(report.results.buggy.invariantViolated, true);
    assert.equal(report.results.correct.invariantViolated, false);
  } finally { await closeServer(server); }
});

test("correct token succeeds", async () => {
  const br = BUSINESS_REQUIREMENT;
  const plan = validPlanForReq(br);
  const mock = async () => ({ ...plan, _diag: { modelId: "test-model" } });
  const { server, port } = await startServer({ generateTestPlan: mock });
  try {
    clearRateLimitStore();
    const body = JSON.stringify({ businessRequirement: br });
    const r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    assert.equal(j.status, "VALID");
    const token = j.approvalToken;
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: token });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 200);
  } finally { await closeServer(server); }
});

test("old unsigned checksum fails", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const norm = normalizePlan(RECORDED.plan);
    const oldToken = approvalHash({ businessRequirement: br, plan: norm });
    const body = JSON.stringify({ businessRequirement: br, plan: norm, approvalToken: oldToken });
    const r = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
    const j = jparse(r);
    assert.equal(j.code, "APPROVAL_INVALID");
  } finally { await closeServer(server); }
});

test("forged token fails", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const forged = token.slice(0, -2) + (token.slice(-2) === "ab" ? "cd" : "ab");
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: forged });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 400);
  } finally { await closeServer(server); }
});

test("modified requirement fails", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const tamperedReq = br + " tampered";
    const runBody = JSON.stringify({ businessRequirement: tamperedReq, plan: j.plan, approvalToken: token });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 400);
  } finally { await closeServer(server); }
});

test("modified plan fails", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const modPlan = JSON.parse(JSON.stringify(j.plan));
    modPlan.operations[0].capturedCents = 9999;
    const runBody = JSON.stringify({ businessRequirement: br, plan: modPlan, approvalToken: token });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 400);
  } finally { await closeServer(server); }
});

test("expired token fails using controlled clock", async () => {
  const key = createSigningKey();
  let fakeNow = Date.now();
  const { server, port } = await startServer({ signingKey: key, now: () => fakeNow });
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const norm = normalizePlan(RECORDED.plan);
    const token = issueAuthorization({ businessRequirement: br, plan: norm, provenance: "RECORDED", modelId: "recorded", now: fakeNow }, { key });
    fakeNow += TOKEN_TTL_MS + 1000;
    const body = JSON.stringify({ businessRequirement: br, plan: norm, approvalToken: token });
    const r = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
    const j = jparse(r);
    assert.equal(j.code, "APPROVAL_EXPIRED");
  } finally { await closeServer(server); }
});

test("token from another server instance fails", async () => {
  const { server: s1, port: p1 } = await startServer();
  const { server: s2, port: p2 } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port: p1, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${p1}`, Origin:`http://127.0.0.1:${p1}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: token });
    const rr = await httpReq({ port: p2, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${p2}`, Origin:`http://127.0.0.1:${p2}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 400);
  } finally { await closeServer(s1); await closeServer(s2); }
});

test("malformed, oversized, and incomplete token formats fail", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const norm = normalizePlan(RECORDED.plan);
    const cases = [
      "not-a-token",
      "onlyonepart",
      "a.b.c",
      "",
      " ",
      "a." + "b".repeat(5000),
      Buffer.from(JSON.stringify({v:1})).toString("base64url") + ".invalidsig",
      "x".repeat(MAX_TOKEN_LENGTH + 10),
    ];
    for (const tok of cases) {
      const body = JSON.stringify({ businessRequirement: br, plan: norm, approvalToken: tok });
      const r = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
      assert.equal(r.statusCode, 400, `token ${tok.slice(0,20)} should be rejected`);
    }
  } finally { await closeServer(server); }
});

test("missing authorization fails", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const norm = normalizePlan(RECORDED.plan);
    const body = JSON.stringify({ businessRequirement: br, plan: norm });
    const r = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
  } finally { await closeServer(server); }
});

test("authorization does not bypass semantic validation", async () => {
  const key = createSigningKey();
  const fakeNow = Date.now();
  const { server, port } = await startServer({ signingKey: key, now: () => fakeNow });
  try {
    clearRateLimitStore();
    const ambiguousReq = "Refunds should not be too large.";
    const plan = validPlanForReq(ambiguousReq);
    const token = issueAuthorization({ businessRequirement: ambiguousReq, plan, provenance: "LIVE", modelId: "test-model", now: fakeNow }, { key });
    const body = JSON.stringify({ businessRequirement: ambiguousReq, plan, approvalToken: token });
    const r = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
  } finally { await closeServer(server); }
});

test("client-supplied LIVE label cannot relabel recorded inference", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: token, modelLabel: "LIVE META RESPONSE", live: true, modelId: "evil-model" });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 200);
    const report = jparse(rr);
    assert.equal(report.modelLabel, "RECORDED META RESPONSE");
    assert.equal(report.live, false);
  } finally { await closeServer(server); }
});

test("client-supplied model ID cannot replace trusted model ID", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: token, modelId: "evil-model", modelLabel: "LIVE META RESPONSE" });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 200);
    const report = jparse(rr);
    assert.notEqual(report.modelId, "evil-model");
    assert.equal(report.modelId, RECORDED._diag.modelId);
  } finally { await closeServer(server); }
});

test("result export retains correct server-trusted label", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    let body = JSON.stringify({ businessRequirement: br, useRecorded: true });
    let r = await httpReq({ port, method:"POST", path:"/api/interpret", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) }, body });
    const j = jparse(r);
    const token = j.approvalToken;
    const runBody = JSON.stringify({ businessRequirement: br, plan: j.plan, approvalToken: token });
    const rr = await httpReq({ port, method:"POST", path:"/api/run", headers:{ Host:`127.0.0.1:${port}`, Origin:`http://127.0.0.1:${port}`, "Content-Type":"application/json", "Content-Length": Buffer.byteLength(runBody) }, body: runBody });
    assert.equal(rr.statusCode, 200);
    const report = jparse(rr);
    assert.equal(report.modelLabel, "RECORDED META RESPONSE");
    assert.ok(report.executedAt);
    assert.ok(report.results.buggy);
    assert.ok(!JSON.stringify(report).includes("BASETEN_API_KEY"));
    assert.ok(!JSON.stringify(report).includes("signingKey"));
  } finally { await closeServer(server); }
});
