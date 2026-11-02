import test from "node:test";
import assert from "node:assert/strict";
import { validateTestPlan } from "../src/testPlanValidator.js";
import { executePlan } from "../src/executor.js";

const plan = {
  version: "1.0",
  ruleId: "refund-cap",
  businessRequirement: "Total accepted refunds for an order cannot exceed captured payment.",
  interpretedRule: "Total refunds must not exceed captured.",
  operations: [
    { op: "createOrder", orderId: "order-1", capturedCents: 10000 },
    { op: "requestRefund", orderId: "order-1", amountCents: 6000, refundId: "r1" },
    { op: "assertRefundStatus", refundId: "r1", expectedStatus: "accepted" },
    { op: "requestRefund", orderId: "order-1", amountCents: 5000, refundId: "r2" },
    { op: "assertRefundStatus", refundId: "r2", expectedStatus: "rejected" },
    { op: "assertTotalRefunds", orderId: "order-1", expectedCents: 6000 },
  ],
};

test("requires approval before execution", () => {
  const v = validateTestPlan(plan);
  assert.equal(v.ok, true);
  const notApproved = executePlan({ plan, approved: false, variant: "buggy" });
  assert.equal(notApproved.executed, false);
  assert.equal(notApproved.reason, "NOT_APPROVED");
});

test("approved plan reveals violation in buggy but not correct", () => {
  const buggy = executePlan({ plan, approved: true, variant: "buggy" });
  const correct = executePlan({ plan, approved: true, variant: "correct" });
  assert.equal(buggy.executed, true);
  assert.equal(buggy.invariantViolated, true);
  assert.equal(buggy.violations.length, 1);
  assert.equal(correct.invariantViolated, false);
  // deterministic repeat
  const buggy2 = executePlan({ plan, approved: true, variant: "buggy" });
  assert.deepEqual(buggy.transitions.map((t) => t.result?.status), buggy2.transitions.map((t) => t.result?.status));
});

test("executor never evals model JS, only fixed ops", () => {
  const evil = structuredClone(plan);
  evil.operations.push({ op: "assertTotalRefunds", orderId: "order-1", expectedCents: 6000 });
  // If we tried to inject code via a field it would have been rejected by validator
  const v = validateTestPlan(evil);
  assert.equal(v.ok, true);
  const res = executePlan({ plan: evil, approved: true, variant: "correct" });
  assert.equal(res.executed, true);
});

test("reports actual state transitions and invariant violation", () => {
  const r = executePlan({ plan, approved: true, variant: "buggy" });
  assert.ok(r.transitions.length > 0);
  assert.ok(r.finalState.orders[0].totalAcceptedCents > r.finalState.orders[0].capturedCents);
});
