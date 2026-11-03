import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, MAX_BODY_BYTES, clearRateLimitStore } from "../src/server.js";
import { BUSINESS_REQUIREMENT } from "../src/catalog.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
function startServer(opts = {}) {
  const server = createServer({ port: 0, ...opts });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, address: addr.address, family: addr.family });
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
function httpReq({ port, method = "GET", path = "/", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const opts = { host: "127.0.0.1", port, method, path, headers };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function rawReq(port, raw) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: "127.0.0.1", port }, () => sock.write(raw));
    let data = "";
    sock.on("data", (c) => (data += c.toString()));
    sock.on("end", () => {
      const m = data.match(/HTTP\/1\.1 (\d+)/);
      resolve({ statusCode: m ? parseInt(m[1], 10) : null, raw: data, headers: data });
    });
    sock.on("error", reject);
    sock.setTimeout(2000, () => sock.end());
  });
}
function parseJsonRes(r) { try { return JSON.parse(r.body); } catch { return null; } }
test("server binds only to IPv4 loopback and starts/stops cleanly", async () => {
  const { server, port, address, family } = await startServer();
  try {
    assert.equal(address, "127.0.0.1");
    assert.equal(family, "IPv4");
    const r = await httpReq({ port, path: "/api/config", headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["x-content-type-options"], /nosniff/i);
  } finally { await closeServer(server); }
});
test("local GET /api/config, /api/recorded, /, /app.js, /style.css succeed", async () => {
  const { server, port } = await startServer();
  try {
    let r = await httpReq({ port, path: "/api/config", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 200);
    const j = parseJsonRes(r);
    assert.ok(j.businessRequirement);
    assert.ok(j.model);
    r = await httpReq({ port, path: "/api/recorded", headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(r.statusCode, 200);
    assert.ok(parseJsonRes(r).recorded);
    r = await httpReq({ port, path: "/", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["content-type"], /text\/html/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.ok(r.body.includes("<!doctype html") || r.body.includes("<html"));
    r = await httpReq({ port, path: "/app.js", headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["content-type"], /javascript/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    r = await httpReq({ port, path: "/style.css", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["content-type"], /css/);
  } finally { await closeServer(server); }
});
test("valid same-origin recorded POST is processed", async () => {
  const { server, port } = await startServer();
  try {
    const body = JSON.stringify({ businessRequirement: "Total accepted refunds for an order cannot exceed captured payment.", useRecorded: true });
    const r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 200);
    const j = parseJsonRes(r);
    assert.equal(j.status, "VALID");
    assert.equal(j.live, false);
    assert.ok(j.plan.operations.length === 7);
    assert.ok(j.approvalToken);
  } finally { await closeServer(server); }
});
test("valid JSON with charset is accepted", async () => {
  const { server, port } = await startServer();
  try {
    const body = JSON.stringify({ businessRequirement: "Total accepted refunds for an order cannot exceed captured payment.", useRecorded: true });
    const r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(parseJsonRes(r).status, "VALID");
  } finally { await closeServer(server); }
});
test("existing normal API error responses remain compatible", async () => {
  const { server, port } = await startServer();
  try {
    let body = JSON.stringify({ useRecorded: true });
    let r = await httpReq({ port, method: "POST", path: "/api/interpret", headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
    assert.equal(parseJsonRes(r).code, "INVALID_REQUEST");
    body = JSON.stringify({ businessRequirement: "x" });
    r = await httpReq({ port, method: "POST", path: "/api/run", headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, body });
    assert.equal(r.statusCode, 400);
    r = await httpReq({ port, path: "/api/unknown", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 404);
    r = await httpReq({ port, method: "DELETE", path: "/api/config", headers: { Host: `localhost:${port}` } });
    assert.ok([404, 405].includes(r.statusCode));
  } finally { await closeServer(server); }
});
test("foreign Host, incorrect port, suffix attack, malformed Host rejected", async () => {
  const { server, port } = await startServer();
  try {
    let r = await httpReq({ port, path: "/api/config", headers: { Host: `evil.com:${port}` } });
    assert.equal(r.statusCode, 403);
    r = await httpReq({ port, path: "/api/config", headers: { Host: `127.0.0.1:${port + 1}` } });
    assert.equal(r.statusCode, 403);
    r = await httpReq({ port, path: "/api/config", headers: { Host: `localhost.evil.com:${port}` } });
    assert.equal(r.statusCode, 403);
    r = await httpReq({ port, path: "/api/config", headers: { Host: `[::1]:${port}` } });
    assert.equal(r.statusCode, 403);
    r = await rawReq(port, `GET /api/config HTTP/1.1\r\nHost: localhost:${port}, evil.com\r\nConnection: close\r\n\r\n`);
    assert.ok([400, 403].includes(r.statusCode));
    r = await rawReq(port, `GET /api/config HTTP/1.1\r\nHost: localhost:${port}\r\nHost: evil.com\r\nConnection: close\r\n\r\n`);
    assert.equal(r.statusCode, 400);
  } finally { await closeServer(server); }
});
test("foreign Origin, null origin, cross-site fetch rejected and preflight grants no access", async () => {
  const { server, port } = await startServer();
  try {
    const body = JSON.stringify({ businessRequirement: "Total accepted refunds for an order cannot exceed captured payment.", useRecorded: true });
    let r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: "http://evil.com", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 403);
    r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: "null", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 403);
    r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 403);
    r = await httpReq({
      port, method: "OPTIONS", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: "http://evil.com", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(r.statusCode, 204);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
    r = await httpReq({ port, path: "/api/config", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 200);
  } finally { await closeServer(server); }
});
test("unsupported Content-Type rejected with 415", async () => {
  const { server, port } = await startServer();
  try {
    const body = JSON.stringify({ businessRequirement: "x" });
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const r = await httpReq({
        port, method: "POST", path: "/api/interpret",
        headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": ct, "Content-Length": Buffer.byteLength(body) },
        body,
      });
      assert.equal(r.statusCode, 415);
      assert.equal(parseJsonRes(r).code, "UNSUPPORTED_MEDIA_TYPE");
    }
  } finally { await closeServer(server); }
});
test("malformed JSON rejected with 400", async () => {
  const { server, port } = await startServer();
  try {
    const body = '{"businessRequirement": "hi",';
    const r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 400);
    assert.equal(parseJsonRes(r).code, "INVALID_REQUEST");
  } finally { await closeServer(server); }
});
test("oversized Content-Length and chunked body rejected with 413", async () => {
  const { server, port } = await startServer();
  try {
    const smallBody = JSON.stringify({ businessRequirement: "x".repeat(100) });
    const bigLen = MAX_BODY_BYTES + 1000;
    let r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json", "Content-Length": String(bigLen) },
      body: smallBody,
    });
    assert.equal(r.statusCode, 413);
    assert.equal(parseJsonRes(r).code, "PAYLOAD_TOO_LARGE");
    const large = "a".repeat(MAX_BODY_BYTES + 5000);
    const largeBody = JSON.stringify({ businessRequirement: large });
    assert.ok(Buffer.byteLength(largeBody) > MAX_BODY_BYTES);
    const chunkSizeHex = largeBody.length.toString(16);
    const raw = `POST /api/interpret HTTP/1.1\r\nHost: localhost:${port}\r\nOrigin: http://localhost:${port}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${chunkSizeHex}\r\n${largeBody}\r\n0\r\n\r\n`;
    const rawRes = await rawReq(port, raw);
    assert.equal(rawRes.statusCode, 413);
  } finally { await closeServer(server); }
});
test("malformed Content-Length safely handled", async () => {
  const { server, port } = await startServer();
  try {
    const body = JSON.stringify({ businessRequirement: "test" });
    let r = await rawReq(port, `POST /api/interpret HTTP/1.1\r\nHost: localhost:${port}\r\nOrigin: http://localhost:${port}\r\nContent-Type: application/json\r\nContent-Length: abc\r\nConnection: close\r\n\r\n${body}`);
    assert.equal(r.statusCode, 400);
    r = await rawReq(port, `POST /api/interpret HTTP/1.1\r\nHost: localhost:${port}\r\nOrigin: http://localhost:${port}\r\nContent-Type: application/json\r\nContent-Length: 12, 12\r\nConnection: close\r\n\r\n${body}`);
    assert.ok([400, 403].includes(r.statusCode));
  } finally { await closeServer(server); }
});
test("aborted upload does not crash process", async () => {
  const { server, port } = await startServer();
  try {
    await new Promise((resolve) => {
      const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
        sock.write(`POST /api/interpret HTTP/1.1\r\nHost: localhost:${port}\r\nOrigin: http://localhost:${port}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"businessRequirement": "test"`);
        setTimeout(() => { sock.destroy(); resolve(); }, 100);
      });
      sock.on("error", () => resolve());
    });
    await new Promise((r) => setTimeout(r, 200));
    const r = await httpReq({ port, path: "/api/config", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 200);
  } finally { await closeServer(server); }
});
test("static traversal, encoded slash/backslash, malformed encoding, Windows escape rejected", async () => {
  const { server, port } = await startServer();
  try {
    const expectBlocked = async (p) => {
      const r = await httpReq({ port, path: p, headers: { Host: `localhost:${port}` } });
      assert.ok([400, 403, 404].includes(r.statusCode), `path ${p} should be blocked got ${r.statusCode}`);
      assert.ok(!r.body.includes("BASETEN_API_KEY"));
    };
    await expectBlocked("/../package.json");
    await expectBlocked("/..%2fpackage.json");
    await expectBlocked("/%2e%2e/package.json");
    await expectBlocked("/%252e%252e/package.json");
    await expectBlocked("/public/../src/server.js");
    await expectBlocked("/%2fetc/passwd");
    await expectBlocked("/%5c..\\..\\secret");
    await expectBlocked("/..\\..\\secret");
    await expectBlocked("/C:/Windows/win.ini");
    await expectBlocked("/C:\\Windows\\win.ini");
    await expectBlocked("/C|/Windows/win.ini");
    await expectBlocked("//evil");
    await expectBlocked("/%00/index.html");
    await expectBlocked("/.env");
    await expectBlocked("/.git/config");
    await expectBlocked("/package.json");
    const rMal = await httpReq({ port, path: "/%ZZ", headers: { Host: `localhost:${port}` } });
    assert.equal(rMal.statusCode, 400);
    const rOk = await httpReq({ port, path: "/index.html", headers: { Host: `localhost:${port}` } });
    assert.equal(rOk.statusCode, 200);
  } finally { await closeServer(server); }
});
test("symbolic-link escape blocked when supported", async () => {
  const linkPath = path.join(PUBLIC, "link-test-symlink");
  let created = false;
  try {
    if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    fs.symlinkSync("..", linkPath, "dir");
    created = true;
  } catch (e) {
    console.log("Skipping symlink test: " + e.message);
    return;
  }
  const { server, port } = await startServer();
  try {
    const r = await httpReq({ port, path: "/link-test-symlink/package.json", headers: { Host: `localhost:${port}` } });
    assert.ok([400, 403, 404].includes(r.statusCode), "symlink escape should be blocked");
  } finally {
    await closeServer(server);
    if (created) try { fs.unlinkSync(linkPath); } catch {}
  }
});
test("unknown API route rejected and no unauthorized request invokes live inference", async () => {
  const { server, port } = await startServer();
  try {
    clearRateLimitStore();
    let r = await httpReq({ port, path: "/api/unknown", headers: { Host: `localhost:${port}` } });
    assert.equal(r.statusCode, 404);
    const body = JSON.stringify({ businessRequirement: "Total accepted refunds for an order cannot exceed captured payment." });
    r = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: "http://evil.com", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(r.statusCode, 403);
    const j = parseJsonRes(r);
    assert.equal(j.code, "FORBIDDEN");
    assert.ok(!j.status || j.status !== "MODEL_ERROR");
  } finally { await closeServer(server); }
});
test("rate limiting for live inference is enforced after security validation", async () => {
  let mockCalls = 0;
  const livePlanFor = (req) => ({
    version: "1.0",
    ruleId: "refund-cap",
    businessRequirement: req,
    interpretedRule: "The sum of all accepted refunds for an order must never exceed its captured payment amount.",
    operations: [
      { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 4000, refundId: "r1" },
      { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 7000, refundId: "r2" },
      { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 4000 },
    ],
    _diag: { modelId: "muse-spark-1.3", finishReason: "stop" },
  });
  const mockGenerate = async ({ businessRequirement }) => {
    mockCalls += 1;
    return livePlanFor(businessRequirement);
  };
  const { server, port } = await startServer({ generateTestPlan: mockGenerate });
  try {
    clearRateLimitStore();
    mockCalls = 0;
    const liveBody = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT });
    const liveHeaders = () => ({
      Host: `localhost:${port}`,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(liveBody),
    });
    // Ten permitted live requests reach the injected mock provider.
    for (let i = 0; i < 10; i++) {
      const r = await httpReq({ port, method: "POST", path: "/api/interpret", headers: liveHeaders(), body: liveBody });
      assert.equal(r.statusCode, 200, `live request ${i + 1} should succeed`);
      const j = parseJsonRes(r);
      assert.equal(j.status, "VALID");
      assert.equal(j.live, true);
      assert.equal(mockCalls, i + 1, "each permitted live request must invoke mock once");
    }
    assert.equal(mockCalls, 10);
    // Recorded replay does not consume the live request allowance.
    const recordedBody = JSON.stringify({ businessRequirement: BUSINESS_REQUIREMENT, useRecorded: true });
    const rr = await httpReq({
      port, method: "POST", path: "/api/interpret",
      headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(recordedBody) },
      body: recordedBody,
    });
    assert.equal(rr.statusCode, 200);
    assert.equal(parseJsonRes(rr).live, false);
    assert.equal(mockCalls, 10, "recorded replay must not invoke mock provider");
    // Eleventh live request is rejected without invoking the mock provider.
    const blocked = await httpReq({ port, method: "POST", path: "/api/interpret", headers: liveHeaders(), body: liveBody });
    assert.equal(blocked.statusCode, 429);
    assert.equal(parseJsonRes(blocked).code, "RATE_LIMITED");
    assert.equal(mockCalls, 10, "rejected request must not invoke mock provider");
  } finally {
    clearRateLimitStore();
    await closeServer(server);
  }
});
