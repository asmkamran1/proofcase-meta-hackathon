// Offline safety proof: external provider calls are blocked, loopback works.
// This file is part of the normal `npm test` run.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import "./helpers/offline-guard.js";

function localServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
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

test("offline guard blocks Meta provider fetch without network", async () => {
  let msg = "";
  try {
    await fetch("https://api.meta.ai/v1/chat/completions", { method: "POST" });
  } catch (e) {
    msg = String(e && e.message ? e.message : e);
  }
  assert.match(msg, /OFFLINE_GUARD_BLOCKED/);
  assert.ok(!msg.includes("api.meta.ai") || msg.includes("OFFLINE_GUARD_BLOCKED"));
});

test("offline guard blocks Baseten provider fetch without network", async () => {
  await assert.rejects(
    () => fetch("https://inference.baseten.co/v1/chat/completions", { method: "POST" }),
    /OFFLINE_GUARD_BLOCKED/
  );
});

test("offline guard blocks non-loopback http without provider substring", async () => {
  // Fail-closed: any non-loopback destination is rejected in tests.
  assert.throws(
    () => http.request({ host: "example.com", port: 80, path: "/", method: "GET" }),
    /OFFLINE_GUARD_BLOCKED/
  );
});

test("offline guard allows loopback test-server traffic", async () => {
  const { server, port } = await localServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  } finally {
    await closeServer(server);
  }
});
