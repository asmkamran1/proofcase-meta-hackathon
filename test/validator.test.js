import test from "node:test";
import assert from "node:assert/strict";
import { validateTestPlan } from "../src/testPlanValidator.js";

const validPlan = {
  version: "1.0",
  ruleId: "refund-cap",
  businessRequirement: "Total accepted refunds for an order cannot exceed captured payment.",
  interpretedRule: "Sum of accepted refunds must not exceed captured.",
  operations: [
    { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
    { op: "requestRefund", orderId: "order-1", amountCents: 3000, refundId: "r1" },
    { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
    { op: "requestRefund", orderId: "order-1", amountCents: 8000, refundId: "r2" },
    { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },
    { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 3000 },
  ],
};

test("valid single refund + exceed scenario passes validation", () => {
  const v = validateTestPlan(validPlan);
  assert.equal(v.ok, true);
});

test("invalid or missing operation fails closed", () => {
  const badOp = structuredClone(validPlan);
  badOp.operations[1].op = "dropTable";
  assert.throws(() => validateTestPlan(badOp), /INVALID_OP/);

  const missingOrder = structuredClone(validPlan);
  missingOrder.operations = [{ op: "requestRefund", orderId: "nope", amountCents: 100, refundId: "r1" }];
  assert.throws(() => validateTestPlan(missingOrder), /INVALID_REF/);

  const extraField = structuredClone(validPlan);
  extraField.operations[0].evil = "x";
  assert.throws(() => validateTestPlan(extraField), /INVALID_FIELD/);

  const outOfBounds = structuredClone(validPlan);
  outOfBounds.operations[0].capturedCents = 9999999;
  assert.throws(() => validateTestPlan(outOfBounds), /INVALID_VALUE/);
});

test("unsupported business requirement fails closed with marker", () => {
  const unsupported = { unsupported: true, reason: "Requirement about 24h processing not in catalog" };
  const v = validateTestPlan(unsupported);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "UNSUPPORTED_REQUIREMENT");
  assert.equal(v.unsupported, true);
});

test("malformed or truncated model output fails", () => {
  assert.throws(() => validateTestPlan(null), /MALFORMED_PLAN/);
  assert.throws(() => validateTestPlan({ version: "1.0" }), /MALFORMED_PLAN/);
  const trunc = { version: "1.0", ruleId: "refund-cap", businessRequirement: "x", interpretedRule: "x", operations: [] };
  assert.throws(() => validateTestPlan(trunc), /cannot be empty/);
  const tooMany = structuredClone(validPlan);
  tooMany.operations = Array.from({ length: 20 }, () => ({ op: "createOrder", orderId: "o", capturedCents: 100 }));
  assert.throws(() => validateTestPlan(tooMany), /too many ops/);

  const modelError = { __modelError: true, message: "Model HTTP 500" };
  const v2 = validateTestPlan(modelError);
  assert.equal(v2.ok, false);
  assert.equal(v2.reason, "MODEL_ERROR");
});
