// Validates bounded JSON test-plan contract. Fails closed on any violation.
// No execution, no model calls, deterministic.
// Strengthened: explicit allowlist of operation shapes, alias normalization, duplicate/conflicting field rejection.

import { ALLOWED_OPS, ALLOWED_FIELDS, BOUNDS } from "./catalog.js";

// Only these canonical + explicitly mapped alias forms are supported.
const FIELD_ALIASES = {
  createOrder: { capturedCents: ["captured", "captured_cents", "captureCents"] },
  requestRefund: { amountCents: ["amount", "amount_cents", "refundAmount"], refundId: ["id", "refund_id"] },
  assertTotalRefunds: { expectedCents: ["expected", "expected_cents", "expectedAmount"] },
  assertRefundStatus: { expectedStatus: ["status", "expected_status"] },
};

export function normalizePlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.operations)) return plan;
  const normOps = plan.operations.map((raw) => {
    let cur = raw;
    // Unwrap { createOrder: { ... } } form
    if (cur && typeof cur === "object" && !cur.op) {
      const keys = Object.keys(cur);
      if (keys.length === 1 && ALLOWED_OPS.includes(keys[0]) && typeof cur[keys[0]] === "object" && cur[keys[0]] !== null) {
        cur = { op: keys[0], ...cur[keys[0]] };
      } else {
        return cur; // will fail validation as invalid op
      }
    }
    if (!cur || typeof cur !== "object" || typeof cur.op !== "string" || !ALLOWED_OPS.includes(cur.op)) return cur;
    // Alias normalization: map known aliases to canonical, detect duplicates/conflicts
    const aliasMap = FIELD_ALIASES[cur.op] || {};
    // Build reverse lookup: alias -> canonical
    const reverse = {};
    for (const [canon, aliases] of Object.entries(aliasMap)) {
      for (const a of aliases) reverse[a] = canon;
    }
    const out = { op: cur.op };
    const seenCanonical = new Map(); // canon -> source key
    for (const [k, v] of Object.entries(cur)) {
      if (k === "op") continue;
      let canon = k;
      if (reverse[k]) canon = reverse[k];
      // Track if canonical already set via different key => duplicate/conflicting
      if (Object.prototype.hasOwnProperty.call(out, canon)) {
        const prevKey = seenCanonical.get(canon);
        // If same value, still considered duplicate field (explicit requirement to reject)
        // We mark conflict for validator to throw with clear message
        out[`__conflict_${canon}`] = { prevKey, currKey: k, prevVal: out[canon], currVal: v };
        // Keep original; validator will detect __conflict_
        continue;
      }
      // Only allow alias-mapped or canonical allowed fields; unknown will be caught in validation but preserve for error
      out[canon] = v;
      seenCanonical.set(canon, k);
    }
    return out;
  });
  return { ...plan, operations: normOps };
}

export function validateTestPlan(plan) {
  if (plan === null || plan === undefined) throw new Error("MALFORMED_PLAN: null or undefined");
  if (plan?.__modelError === true) {
    return { ok: false, reason: "MODEL_ERROR", message: plan.message, unsupported: false };
  }
  if (typeof plan !== "object" || Array.isArray(plan)) throw new Error("MALFORMED_PLAN: expected object");

  // Unsupported marker: model declares requirement cannot be expressed with catalog.
  if (plan.unsupported === true) {
    if (typeof plan.reason !== "string" || !plan.reason.trim()) throw new Error("MALFORMED_PLAN: unsupported needs reason");
    return { ok: false, reason: "UNSUPPORTED_REQUIREMENT", message: plan.reason, unsupported: true };
  }

  const { version, ruleId, businessRequirement, interpretedRule, operations } = plan;

  if (version !== "1.0") throw new Error("MALFORMED_PLAN: version must be 1.0");
  if (typeof ruleId !== "string" || !ruleId.trim()) throw new Error("MALFORMED_PLAN: ruleId required");
  if (typeof businessRequirement !== "string" || !businessRequirement.trim()) throw new Error("MALFORMED_PLAN: businessRequirement required");
  if (typeof interpretedRule !== "string" || !interpretedRule.trim()) throw new Error("MALFORMED_PLAN: interpretedRule required");
  if (!Array.isArray(operations)) throw new Error("MALFORMED_PLAN: operations must be array");
  if (operations.length === 0) throw new Error("MALFORMED_PLAN: operations cannot be empty");
  if (operations.length > BOUNDS.maxOps) throw new Error(`MALFORMED_PLAN: too many ops (max ${BOUNDS.maxOps})`);

  const seenRefundIds = new Set();
  const createdOrders = new Set();

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (typeof op !== "object" || op === null || Array.isArray(op)) throw new Error(`MALFORMED_PLAN: op[${i}] must be object`);
    if (typeof op.op !== "string" || !ALLOWED_OPS.includes(op.op)) throw new Error(`INVALID_OP: op[${i}].op must be one of ${ALLOWED_OPS.join(",")}`);

    // Detect duplicate/conflicting alias usage captured during normalization
    for (const k of Object.keys(op)) {
      if (k.startsWith("__conflict_")) {
        const canon = k.slice("__conflict_".length);
        throw new Error(`DUPLICATE_FIELD: op[${i}] has duplicate/conflicting field for '${canon}' (${op[k].prevKey} vs ${op[k].currKey})`);
      }
    }
    const allowed = ALLOWED_FIELDS[op.op];
    for (const k of Object.keys(op)) {
      if (!allowed.includes(k)) throw new Error(`INVALID_FIELD: op[${i}] has disallowed field '${k}'`);
    }

    if (op.op === "createOrder") {
      if (typeof op.orderId !== "string" || !BOUNDS.orderIdPattern.test(op.orderId)) throw new Error(`INVALID_VALUE: op[${i}].orderId`);
      if (typeof op.capturedCents !== "number" || !Number.isInteger(op.capturedCents) || op.capturedCents < BOUNDS.capturedCents.min || op.capturedCents > BOUNDS.capturedCents.max) throw new Error(`INVALID_VALUE: op[${i}].capturedCents out of bounds`);
      if (createdOrders.has(op.orderId)) throw new Error(`INVALID_REF: duplicate createOrder for ${op.orderId}`);
      createdOrders.add(op.orderId);
    } else if (op.op === "requestRefund") {
      if (typeof op.orderId !== "string" || !BOUNDS.orderIdPattern.test(op.orderId)) throw new Error(`INVALID_VALUE: op[${i}].orderId`);
      if (typeof op.amountCents !== "number" || !Number.isInteger(op.amountCents) || op.amountCents < BOUNDS.amountCents.min || op.amountCents > BOUNDS.amountCents.max) throw new Error(`INVALID_VALUE: op[${i}].amountCents out of bounds`);
      if (typeof op.refundId !== "string" || !BOUNDS.refundIdPattern.test(op.refundId)) throw new Error(`INVALID_VALUE: op[${i}].refundId`);
      if (seenRefundIds.has(op.refundId)) throw new Error(`INVALID_REF: duplicate refundId ${op.refundId}`);
      seenRefundIds.add(op.refundId);
      // Reference check: order must have been created earlier in plan
      if (!createdOrders.has(op.orderId)) throw new Error(`INVALID_REF: op[${i}] references unknown orderId ${op.orderId}`);
    } else if (op.op === "assertTotalRefunds") {
      if (typeof op.orderId !== "string" || !BOUNDS.orderIdPattern.test(op.orderId)) throw new Error(`INVALID_VALUE: op[${i}].orderId`);
      if (typeof op.expectedCents !== "number" || !Number.isInteger(op.expectedCents) || op.expectedCents < 0 || op.expectedCents > BOUNDS.capturedCents.max) throw new Error(`INVALID_VALUE: op[${i}].expectedCents`);
      if (!createdOrders.has(op.orderId)) throw new Error(`INVALID_REF: op[${i}] references unknown orderId`);
    } else if (op.op === "assertRefundStatus") {
      if (typeof op.refundId !== "string" || !BOUNDS.refundIdPattern.test(op.refundId)) throw new Error(`INVALID_VALUE: op[${i}].refundId`);
      if (typeof op.expectedStatus !== "string" || !BOUNDS.expectedStatus.includes(op.expectedStatus)) throw new Error(`INVALID_VALUE: op[${i}].expectedStatus`);
      if (!seenRefundIds.has(op.refundId)) throw new Error(`INVALID_REF: op[${i}] references unknown refundId ${op.refundId}`);
    }
  }

  return { ok: true, reason: "VALID", unsupported: false };
}
