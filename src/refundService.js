// Fictional refund service with buggy and corrected variants.
// Invariant: total accepted refunds for an order cannot exceed captured payment.
// No DB, no payment APIs, deterministic in-memory only.

class RefundService {
  constructor({ correct }) {
    this.correct = correct;
    this.orders = new Map(); // orderId -> { capturedCents, refunds: [{refundId, amountCents, status}] }
    this.refundIndex = new Map(); // refundId -> { orderId, amountCents, status }
  }

  createOrder({ orderId, capturedCents }) {
    if (this.orders.has(orderId)) throw new Error(`ORDER_EXISTS: ${orderId}`);
    this.orders.set(orderId, { capturedCents, refunds: [] });
    return { orderId, capturedCents, status: "created" };
  }

  totalAccepted(orderId) {
    const o = this.orders.get(orderId);
    if (!o) return 0;
    return o.refunds.filter((r) => r.status === "accepted").reduce((s, r) => s + r.amountCents, 0);
  }

  requestRefund({ orderId, amountCents, refundId }) {
    const order = this.orders.get(orderId);
    if (!order) {
      return { refundId, orderId, amountCents, status: "rejected", reason: "UNKNOWN_ORDER" };
    }
    if (this.refundIndex.has(refundId)) {
      return { refundId, orderId, amountCents, status: "rejected", reason: "DUPLICATE_REFUND_ID" };
    }
    let status;
    let reason = null;
    if (this.correct) {
      const total = this.totalAccepted(orderId);
      if (total + amountCents > order.capturedCents) {
        status = "rejected";
        reason = "EXCEEDS_CAPTURED";
      } else {
        status = "accepted";
      }
    } else {
      // BUGGY: only checks single amount against captured, ignores cumulative total.
      // This allows two refunds to collectively exceed captured.
      if (amountCents > order.capturedCents) {
        status = "rejected";
        reason = "EXCEEDS_CAPTURED";
      } else {
        status = "accepted";
      }
    }
    const rec = { refundId, orderId, amountCents, status, reason };
    order.refunds.push(rec);
    this.refundIndex.set(refundId, rec);
    return rec;
  }

  getState() {
    const orders = [];
    for (const [orderId, o] of this.orders.entries()) {
      orders.push({
        orderId,
        capturedCents: o.capturedCents,
        totalAcceptedCents: this.totalAccepted(orderId),
        refunds: o.refunds.map((r) => ({ refundId: r.refundId, amountCents: r.amountCents, status: r.status })),
        invariantViolated: this.totalAccepted(orderId) > o.capturedCents,
      });
    }
    return { orders };
  }
}

export function createBuggyService() {
  return new RefundService({ correct: false });
}

export function createCorrectService() {
  return new RefundService({ correct: true });
}

export function invariantViolations(state) {
  return state.orders.filter((o) => o.invariantViolated);
}
