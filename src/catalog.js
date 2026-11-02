// Bounded operation catalog for the refund invariant demo.
// Only these operations and fields are ever allowed.
export const ALLOWED_OPS = ["createOrder", "requestRefund", "assertTotalRefunds", "assertRefundStatus"];

export const BOUNDS = {
  maxOps: 8,
  capturedCents: { min: 1, max: 1_000_000 },
  amountCents: { min: 1, max: 1_000_000 },
  orderIdPattern: /^[A-Za-z0-9_-]{1,32}$/,
  refundIdPattern: /^[A-Za-z0-9_-]{1,32}$/,
  expectedStatus: ["accepted", "rejected"],
};

export const BUSINESS_REQUIREMENT = "Total accepted refunds for an order cannot exceed captured payment.";

// Human-readable catalog sent to the model (no bug disclosure).
export function catalogDescription() {
  return `Allowed operations:
- createOrder { orderId: string (1-32 alphanum/_/-), capturedCents: 1..1000000 }
- requestRefund { orderId: string, amountCents: 1..1000000, refundId: string }
- assertTotalRefunds { orderId: string, expectedCents: number }
- assertRefundStatus { refundId: string, expectedStatus: \"accepted\"|\"rejected\" }

Bounds: capturedCents 1..1000000, amountCents 1..1000000, max ${BOUNDS.maxOps} operations, IDs match ^[A-Za-z0-9_-]{1,32}$.
Invariant: sum of accepted refunds for an order must never exceed its captured payment.`;
}

export const ALLOWED_FIELDS = {
  createOrder: ["op", "orderId", "capturedCents"],
  requestRefund: ["op", "orderId", "amountCents", "refundId"],
  assertTotalRefunds: ["op", "orderId", "expectedCents"],
  assertRefundStatus: ["op", "refundId", "expectedStatus"],
};
