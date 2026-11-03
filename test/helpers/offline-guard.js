// Offline test safety guard. Loaded via `node --import` in `npm test`.
// Blocks unintended external provider calls while allowing loopback
// test-server traffic. Never imported by production code.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost", "::ffff:127.0.0.1"]);
const BLOCKED_SUBSTRINGS = ["api.meta.ai", "inference.baseten.co"];

function getState() {
  if (!globalThis.__OFFLINE_GUARD__) {
    globalThis.__OFFLINE_GUARD__ = { blocks: [], installed: false };
  }
  return globalThis.__OFFLINE_GUARD__;
}

function normHost(h) {
  return String(h || "").trim().toLowerCase().replace(/^\[|\]$/g, "").split(":")[0].split(",")[0].trim();
}

function isLoopback(host) {
  return LOOPBACK.has(normHost(host)) || normHost(host) === "";
}

function haystackHasProvider(s) {
  const t = String(s || "").toLowerCase();
  return BLOCKED_SUBSTRINGS.some((b) => t.includes(b));
}

function hostnameOf(input) {
  try {
    if (typeof input === "string") return new URL(input).hostname.toLowerCase();
    if (input instanceof URL) return input.hostname.toLowerCase();
    if (input && typeof input.url === "string") return new URL(input.url).hostname.toLowerCase();
    if (input && typeof input.href === "string") return new URL(input.href).hostname.toLowerCase();
  } catch {
    return "";
  }
  return "";
}

function recordAndThrow(kind, target) {
  const state = getState();
  state.blocks.push({ kind, target: String(target).slice(0, 256), at: Date.now() });
  throw new Error(`OFFLINE_GUARD_BLOCKED: ${kind} to ${String(target).slice(0, 120)} blocked in tests`);
}

export function offlineGuardStats() {
  const s = getState();
  return { blocks: [...s.blocks], blockCount: s.blocks.length };
}

function install() {
  const state = getState();
  if (state.installed) return state;
  state.installed = true;

  const origFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
  if (typeof origFetch === "function") {
    globalThis.fetch = async (input, init) => {
      const raw = typeof input === "string" ? input : (input?.url ?? input?.href ?? String(input));
      const host = hostnameOf(typeof input === "string" ? input : (input?.url ?? input?.href ?? input));
      if (host && haystackHasProvider(host)) recordAndThrow("fetch", raw);
      if (host && haystackHasProvider(raw)) recordAndThrow("fetch", raw);
      if (host && !isLoopback(host)) recordAndThrow("fetch", raw);
      if (!host && haystackHasProvider(raw)) recordAndThrow("fetch", raw);
      return origFetch(input, init);
    };
  }

  try {
    const http = require("node:http");
    const https = require("node:https");
    const net = require("node:net");
    const dns = require("node:dns");

    const wrapHttp = (mod, name) => {
      const orig = mod[name];
      if (typeof orig !== "function" || orig.__offlineGuardWrapped) return;
      const wrapped = function (...args) {
        let host = "";
        let hay = "";
        try {
          const a0 = args[0];
          if (typeof a0 === "string" || a0 instanceof URL) {
            const u = new URL(String(a0));
            host = u.hostname.toLowerCase();
            hay = String(a0);
            const a1 = args[1] || {};
            if (a1 && typeof a1 === "object" && (a1.hostname || a1.host)) {
              host = normHost(a1.hostname || a1.host) || host;
            }
          } else if (a0 && typeof a0 === "object") {
            host = normHost(a0.hostname || a0.host || a0.path || "");
            // http.request({ port }) with no host defaults to localhost: allow.
            if (!a0.hostname && !a0.host) host = "";
            hay = `${a0.hostname || a0.host || ""} ${a0.path || ""} ${a0.href || ""}`;
          }
        } catch {
          host = "";
        }
        if (haystackHasProvider(hay) || (host && haystackHasProvider(host))) recordAndThrow(`http.${name}`, (hay || host).slice(0, 200));
        if (host && !isLoopback(host)) recordAndThrow(`http.${name}`, host);
        return orig.apply(this, args);
      };
      wrapped.__offlineGuardWrapped = true;
      mod[name] = wrapped;
    };
    wrapHttp(http, "request");
    wrapHttp(http, "get");
    wrapHttp(https, "request");
    wrapHttp(https, "get");

    // Defense in depth: block raw TCP connects to non-loopback hosts.
    const SocketProto = net.Socket && net.Socket.prototype;
    if (SocketProto && !SocketProto.connect.__offlineGuardWrapped) {
      const origConnect = SocketProto.connect;
      const wrappedConnect = function (...args) {
        let host = "";
        if (args[0] && typeof args[0] === "object") {
          host = normHost(args[0].host || args[0].hostname || "");
        } else if (typeof args[1] === "string") {
          host = normHost(args[1]);
        }
        if (host && haystackHasProvider(host)) recordAndThrow("net.connect", host);
        if (host && !isLoopback(host)) recordAndThrow("net.connect", host);
        return origConnect.apply(this, args);
      };
      wrappedConnect.__offlineGuardWrapped = true;
      SocketProto.connect = wrappedConnect;
    }

    // Block DNS resolution of provider hostnames even before connect.
    const origLookup = dns.lookup;
    if (typeof origLookup === "function" && !origLookup.__offlineGuardWrapped) {
      const wrappedLookup = function (hostname, ...rest) {
        if (haystackHasProvider(hostname)) recordAndThrow("dns.lookup", hostname);
        return origLookup.call(this, hostname, ...rest);
      };
      wrappedLookup.__offlineGuardWrapped = true;
      dns.lookup = wrappedLookup;
    }
  } catch {
    // Guard must never crash test startup; fetch patch above still applies.
  }
  return state;
}

install();
