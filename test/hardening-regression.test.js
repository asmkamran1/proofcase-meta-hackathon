import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, clearRateLimitStore } from "../src/server.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RECORDED = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "recordedResponse.json"), "utf8"));
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
function closeServer(server) { return new Promise((r) => server.close(r)); }
function httpReq(o) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: o.port, method: o.method || "GET", path: o.path || "/", headers: o.headers || {} }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}
function jparse(r) { try { return JSON.parse(r.body); } catch { return null; } }
function ph(port, body) {
  return { Host: "127.0.0.1:" + port, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) };
}
async function getValid(port) {
  const br = RECORDED.plan.businessRequirement;
  const body = JSON.stringify({ businessRequirement: br, useRecorded: true });
  const r = await httpReq({ port, method: "POST", path: "/api/interpret", headers: ph(port, body), body });
  assert.equal(r.statusCode, 200);
  const j = jparse(r);
  assert.equal(j.status, "VALID");
  return { br, plan: j.plan, token: j.approvalToken };
}

test("rejected forged authorization executes no refund engine", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const v = await getValid(port);
    const tampered = JSON.parse(JSON.stringify(v.plan));
    tampered.operations[1].amountCents = 99999;
    const rb = JSON.stringify({ businessRequirement: v.br, plan: tampered, approvalToken: v.token });
    const rr = await httpReq({ port, method: "POST", path: "/api/run", headers: ph(port, rb), body: rb });
    assert.equal(rr.statusCode, 400);
    const j = jparse(rr);
    assert.ok(j.code === "APPROVAL_INVALID" || j.code === "APPROVAL_EXPIRED");
    assert.ok(!("results" in j));
  } finally { await closeServer(server); }
});
test("missing authorization executes nothing and leaks no secrets", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const v = await getValid(port);
    const rb = JSON.stringify({ businessRequirement: v.br, plan: v.plan });
    const rr = await httpReq({ port, method: "POST", path: "/api/run", headers: ph(port, rb), body: rb });
    assert.equal(rr.statusCode, 400);
    const j = jparse(rr);
    assert.equal(j.code, "INVALID_REQUEST");
    assert.ok(!("results" in j));
    assert.ok(!String(rr.body).includes("BASETEN_API_KEY"));
  } finally { await closeServer(server); }
});
test("mismatch yields no token and cannot replay into execution", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const bad = JSON.stringify({ businessRequirement: "Totally different.", useRecorded: true });
    const r = await httpReq({ port, method: "POST", path: "/api/interpret", headers: ph(port, bad), body: bad });
    assert.equal(r.statusCode, 400);
    const j = jparse(r);
    assert.equal(j.code, "RECORDED_REQUIREMENT_MISMATCH");
    assert.ok(!j.approvalToken);
    const rb = JSON.stringify({ businessRequirement: "Totally different.", plan: RECORDED.plan });
    const rr = await httpReq({ port, method: "POST", path: "/api/run", headers: ph(port, rb), body: rb });
    assert.equal(rr.statusCode, 400);
    assert.ok(!("results" in jparse(rr)));
  } finally { await closeServer(server); }
});
test("forged provenance and model fields cannot affect report", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    const v = await getValid(port);
    const rb = JSON.stringify({ businessRequirement: v.br, plan: v.plan, approvalToken: v.token, live: true, modelLabel: "LIVE META RESPONSE", modelId: "evil-model", provenance: "LIVE" });
    const rr = await httpReq({ port, method: "POST", path: "/api/run", headers: ph(port, rb), body: rb });
    assert.equal(rr.statusCode, 200);
    const report = jparse(rr);
    assert.equal(report.live, false);
    assert.equal(report.modelLabel, "RECORDED META RESPONSE");
    assert.equal(report.modelId, RECORDED._diag.modelId);
    assert.ok(!JSON.stringify(report).includes("evil-model"));
  } finally { await closeServer(server); }
});
test("HTTP inputs cannot inject model factory", async () => {
  let liveCalls = 0;
  const mockGenerate = async () => { liveCalls += 1; throw new Error("SHOULD_NOT_RUN"); };
  const { server, port } = await startServer({ generateTestPlan: mockGenerate });
  try {
    clearRateLimitStore();
    const br = RECORDED.plan.businessRequirement;
    const body = JSON.stringify({ businessRequirement: br, useRecorded: true, generateTestPlan: "evil" });
    const r = await httpReq({ port, method: "POST", path: "/api/interpret", headers: ph(port, body), body });
    assert.equal(r.statusCode, 200);
    const j = jparse(r);
    assert.equal(j.status, "VALID");
    assert.equal(j.live, false);
    assert.equal(liveCalls, 0);
  } finally { await closeServer(server); }
});