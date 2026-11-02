import test from "node:test";
import assert from "node:assert/strict";
import { createBuggyService, createCorrectService } from "../src/refundService.js";

test("valid single refund accepted in both variants", () => {
  for (const svc of [createBuggyService(), createCorrectService()]) {
    svc.createOrder({ orderId: "o1", capturedCents: 10000 });
    const r = svc.requestRefund({ orderId: "o1", amountCents: 3000, refundId: "r1" });
    assert.equal(r.status, "accepted");
    assert.equal(svc.totalAccepted("o1"), 3000);
  }
});

test("two refunds collectively exceed captured: buggy violates, correct rejects", () => {
  const buggy = createBuggyService();
  buggy.createOrder({ orderId: "o1", capturedCents: 10000 });
  const b1 = buggy.requestRefund({ orderId: "o1", amountCents: 6000, refundId: "r1" });
  const b2 = buggy.requestRefund({ orderId: "o1", amountCents: 5000, refundId: "r2" });
  assert.equal(b1.status, "accepted");
  assert.equal(b2.status, "accepted"); // bug: should have been rejected
  const bState = buggy.getState();
  assert.equal(bState.orders[0].invariantViolated, true);
  assert.equal(bState.orders[0].totalAcceptedCents, 11000);

  const correct = createCorrectService();
  correct.createOrder({ orderId: "o1", capturedCents: 10000 });
  const c1 = correct.requestRefund({ orderId: "o1", amountCents: 6000, refundId: "r1" });
  const c2 = correct.requestRefund({ orderId: "o1", amountCents: 5000, refundId: "r2" });
  assert.equal(c1.status, "accepted");
  assert.equal(c2.status, "rejected");
  assert.equal(c2.reason, "EXCEEDS_CAPTURED");
  const cState = correct.getState();
  assert.equal(cState.orders[0].invariantViolated, false);
  assert.equal(cState.orders[0].totalAcceptedCents, 6000);
});
