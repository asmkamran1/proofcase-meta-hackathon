import test from "node:test";
import assert from "node:assert/strict";
import { generateTestPlan, BUSINESS_REQUIREMENT } from "../src/planner.js";
import { validateTestPlan } from "../src/testPlanValidator.js";

// Snapshot every provider-related key so local .env.local contents,
// stale PowerShell exports, and parallel test files cannot leak into
// assertions. Each test clears then sets an explicit META test env.
const KEYS = [
  "MODEL_PROVIDER",
  "MODEL_API_KEY",
  "META_MODEL",
  "META_BASE_URL",
  "META_MAX_TOKENS",
  "META_RETRY_MAX_TOKENS",
  "MODEL_MAX_TOKENS",
  "MODEL_RETRY_MAX_TOKENS",
  "BASETEN_API_KEY",
  "BASETEN_BASE_URL",
  "BASETEN_MODEL",
  "BASETEN_MAX_TOKENS",
  "BASETEN_RETRY_MAX_TOKENS",
];
const snapEnv = () => {
  const s = {};
  for (const k of KEYS) s[k] = process.env[k];
  return s;
};
const restoreEnv = (s) => {
  for (const k of KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
};
const clearEnv = () => {
  for (const k of KEYS) delete process.env[k];
};
function withMetaTestEnv() {
  process.env.MODEL_PROVIDER = "META";
  process.env.MODEL_API_KEY = "test-key";
}

function mockFetchForValidPlan() {
  const plan = {
    version: "1.0",
    ruleId: "refund-cap",
    businessRequirement: BUSINESS_REQUIREMENT,
    interpretedRule: "Total accepted refunds must not exceed captured payment.",
    operations: [
      { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
      { op: "requestRefund", orderId: "order-1", amountCents: 6000, refundId: "r1" },
      { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
      { op: "requestRefund", orderId: "order-1", amountCents: 5000, refundId: "r2" },
      { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },
      { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 6000 },
    ],
  };
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "meta-models/muse-spark-open-1026",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }],
      usage: { completion_tokens: 300 },
    }),
  });
}

test("planner sends requirement and catalog, parses valid plan (mocked, no bug disclosed)", async () => {
  const s = snapEnv(); clearEnv(); withMetaTestEnv();
  try {
    let sentBody = null;
    const fetchImpl = async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return mockFetchForValidPlan()();
    };
    const out = await generateTestPlan({ fetchImpl });
    assert.equal(out.version, "1.0");
    assert.equal(out.ruleId, "refund-cap");
    const v = validateTestPlan(out);
    assert.equal(v.ok, true);
    // Ensure prompt does not contain bug hints
    const promptStr = JSON.stringify(sentBody.messages);
    assert.ok(!promptStr.toLowerCase().includes("buggy"));
    assert.ok(!promptStr.toLowerCase().includes("seeded"));
  } finally {
    restoreEnv(s);
  }
});

test("malformed model output handled as model error", async () => {
  const s = snapEnv(); clearEnv(); withMetaTestEnv();
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "m",
        choices: [{ finish_reason: "stop", message: { content: "not json at all {" } }],
        usage: {},
      }),
    });
    const out = await generateTestPlan({ fetchImpl });
    assert.equal(out.__modelError, true);
    assert.match(out.message, /malformed JSON/);
  } finally {
    restoreEnv(s);
  }
});

test("unsupported requirement returns marker", async () => {
  const s = snapEnv(); clearEnv(); withMetaTestEnv();
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "m",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ unsupported: true, reason: "cannot express with catalog" }) } }],
        usage: {},
      }),
    });
    const out = await generateTestPlan({ businessRequirement: "Refunds must be processed within 24 hours", fetchImpl });
    const v = validateTestPlan(out);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "UNSUPPORTED_REQUIREMENT");
  } finally {
    restoreEnv(s);
  }
});
