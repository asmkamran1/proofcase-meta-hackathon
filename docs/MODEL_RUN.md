# Model Run 2026-10-29T03:58:40.221Z

## Business requirement
Total accepted refunds for an order cannot exceed captured payment.

## Interpreted rule
The sum of all accepted refunds for an order must never exceed its captured payment amount.

## Raw plan
```json
{
  "version": "1.0",
  "ruleId": "refund-cap",
  "businessRequirement": "Total accepted refunds for an order cannot exceed captured payment.",
  "interpretedRule": "The sum of all accepted refunds for an order must never exceed its captured payment amount.",
  "operations": [
    {
      "op": "createOrder",
      "orderId": "order-1",
      "capturedCents": 10000
    },
    {
      "op": "requestRefund",
      "orderId": "order-1",
      "amountCents": 4000,
      "refundId": "r1"
    },
    {
      "op": "assertRefundStatus",
      "refundId": "r1",
      "expectedStatus": "accepted"
    },
    {
      "op": "assertTotalRefunds",
      "orderId": "order-1",
      "expectedCents": 4000
    },
    {
      "op": "requestRefund",
      "orderId": "order-1",
      "amountCents": 7000,
      "refundId": "r2"
    },
    {
      "op": "assertRefundStatus",
      "refundId": "r2",
      "expectedStatus": "rejected"
    },
    {
      "op": "assertTotalRefunds",
      "orderId": "order-1",
      "expectedCents": 4000
    }
  ],
  "_diag": {
    "modelId": "meta-models/muse-spark-open-1026",
    "finishReason": "stop"
  }
}
```

## Validation
```json
{
  "ok": true,
  "reason": "VALID",
  "unsupported": false
}
```

## Buggy transitions
```json
[
  {
    "op": "createOrder",
    "orderId": "order-1",
    "capturedCents": 10000,
    "result": {
      "orderId": "order-1",
      "capturedCents": 10000,
      "status": "created"
    },
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 0,
          "refunds": [],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "requestRefund",
    "refundId": "r1",
    "orderId": "order-1",
    "amountCents": 4000,
    "result": {
      "refundId": "r1",
      "orderId": "order-1",
      "amountCents": 4000,
      "status": "accepted",
      "reason": null
    },
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "assertRefundStatus",
    "refundId": "r1",
    "expectedStatus": "accepted",
    "actualStatus": "accepted",
    "pass": true,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "assertTotalRefunds",
    "orderId": "order-1",
    "expectedCents": 4000,
    "actualCents": 4000,
    "pass": true,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "requestRefund",
    "refundId": "r2",
    "orderId": "order-1",
    "amountCents": 7000,
    "result": {
      "refundId": "r2",
      "orderId": "order-1",
      "amountCents": 7000,
      "status": "accepted",
      "reason": null
    },
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 11000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            },
            {
              "refundId": "r2",
              "amountCents": 7000,
              "status": "accepted"
            }
          ],
          "invariantViolated": true
        }
      ]
    }
  },
  {
    "op": "assertRefundStatus",
    "refundId": "r2",
    "expectedStatus": "rejected",
    "actualStatus": "accepted",
    "pass": false,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 11000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            },
            {
              "refundId": "r2",
              "amountCents": 7000,
              "status": "accepted"
            }
          ],
          "invariantViolated": true
        }
      ]
    }
  },
  {
    "op": "assertTotalRefunds",
    "orderId": "order-1",
    "expectedCents": 4000,
    "actualCents": 11000,
    "pass": false,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 11000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            },
            {
              "refundId": "r2",
              "amountCents": 7000,
              "status": "accepted"
            }
          ],
          "invariantViolated": true
        }
      ]
    }
  }
]
```
Violations: [
  {
    "orderId": "order-1",
    "capturedCents": 10000,
    "totalAcceptedCents": 11000,
    "refunds": [
      {
        "refundId": "r1",
        "amountCents": 4000,
        "status": "accepted"
      },
      {
        "refundId": "r2",
        "amountCents": 7000,
        "status": "accepted"
      }
    ],
    "invariantViolated": true
  }
]

## Correct transitions
```json
[
  {
    "op": "createOrder",
    "orderId": "order-1",
    "capturedCents": 10000,
    "result": {
      "orderId": "order-1",
      "capturedCents": 10000,
      "status": "created"
    },
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 0,
          "refunds": [],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "requestRefund",
    "refundId": "r1",
    "orderId": "order-1",
    "amountCents": 4000,
    "result": {
      "refundId": "r1",
      "orderId": "order-1",
      "amountCents": 4000,
      "status": "accepted",
      "reason": null
    },
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "assertRefundStatus",
    "refundId": "r1",
    "expectedStatus": "accepted",
    "actualStatus": "accepted",
    "pass": true,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "assertTotalRefunds",
    "orderId": "order-1",
    "expectedCents": 4000,
    "actualCents": 4000,
    "pass": true,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "requestRefund",
    "refundId": "r2",
    "orderId": "order-1",
    "amountCents": 7000,
    "result": {
      "refundId": "r2",
      "orderId": "order-1",
      "amountCents": 7000,
      "status": "rejected",
      "reason": "EXCEEDS_CAPTURED"
    },
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            },
            {
              "refundId": "r2",
              "amountCents": 7000,
              "status": "rejected"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "assertRefundStatus",
    "refundId": "r2",
    "expectedStatus": "rejected",
    "actualStatus": "rejected",
    "pass": true,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            },
            {
              "refundId": "r2",
              "amountCents": 7000,
              "status": "rejected"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  },
  {
    "op": "assertTotalRefunds",
    "orderId": "order-1",
    "expectedCents": 4000,
    "actualCents": 4000,
    "pass": true,
    "state": {
      "orders": [
        {
          "orderId": "order-1",
          "capturedCents": 10000,
          "totalAcceptedCents": 4000,
          "refunds": [
            {
              "refundId": "r1",
              "amountCents": 4000,
              "status": "accepted"
            },
            {
              "refundId": "r2",
              "amountCents": 7000,
              "status": "rejected"
            }
          ],
          "invariantViolated": false
        }
      ]
    }
  }
]
```
Violations: []

## Verdict
- Buggy violated: true
- Correct violated: false
- Deterministic: yes (fixed fixture, no randomness)
