// Executes ONLY allowlisted operations deterministically. Requires explicit approval.
// Never evaluates model-generated JavaScript.

import { createBuggyService, createCorrectService, invariantViolations } from "./refundService.js";

export function executePlan({ plan, approved, variant }) {
  if (!approved) {
    return { executed: false, reason: "NOT_APPROVED", transitions: [], violations: [] };
  }
  const service = variant === "correct" ? createCorrectService() : createBuggyService();
  const transitions = [];
  const errors = [];

  for (const op of plan.operations) {
    if (op.op === "createOrder") {
      try {
        const res = service.createOrder({ orderId: op.orderId, capturedCents: op.capturedCents });
        transitions.push({ op: "createOrder", orderId: op.orderId, capturedCents: op.capturedCents, result: res, state: service.getState() });
      } catch (e) {
        errors.push({ op, error: e.message });
        transitions.push({ op: "createOrder", orderId: op.orderId, error: e.message });
      }
    } else if (op.op === "requestRefund") {
      const res = service.requestRefund({ orderId: op.orderId, amountCents: op.amountCents, refundId: op.refundId });
      transitions.push({ op: "requestRefund", refundId: op.refundId, orderId: op.orderId, amountCents: op.amountCents, result: res, state: service.getState() });
    } else if (op.op === "assertTotalRefunds") {
      const total = service.totalAccepted(op.orderId);
      const pass = total === op.expectedCents;
      transitions.push({ op: "assertTotalRefunds", orderId: op.orderId, expectedCents: op.expectedCents, actualCents: total, pass, state: service.getState() });
      if (!pass) errors.push({ op, error: `assertTotalRefunds failed: expected ${op.expectedCents} got ${total}` });
    } else if (op.op === "assertRefundStatus") {
      const rec = service.refundIndex.get(op.refundId);
      const actual = rec ? rec.status : "unknown";
      const pass = actual === op.expectedStatus;
      transitions.push({ op: "assertRefundStatus", refundId: op.refundId, expectedStatus: op.expectedStatus, actualStatus: actual, pass, state: service.getState() });
      if (!pass) errors.push({ op, error: `assertRefundStatus failed: expected ${op.expectedStatus} got ${actual}` });
    }
  }

  const finalState = service.getState();
  const violations = invariantViolations(finalState);

  return {
    executed: true,
    variant,
    transitions,
    finalState,
    violations,
    assertionErrors: errors,
    invariantViolated: violations.length > 0,
  };
}
