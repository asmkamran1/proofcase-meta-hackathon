# Architecture -- ProofCase

## 1. Invariant

Total accepted refunds for an order cannot exceed captured payment.
Formal: sum(accepted refunds per order) <= capturedCents.
Defect is intentionally seeded and fictional.

## 2. Components

- catalog.js -- allowlisted ops/fields/bounds, BUSINESS_REQUIREMENT,
  catalogDescription() sent to Meta. Single ruleId refund-cap.
- metaClient.js -- server-side Baseten Muse Spark Open client, no
  fallback. Provides resolveBudgets(), postChat(), retry, _diag.
  Default 4096, retry ~2x capped 16384, max 2 attempts.
- planner.js -- builds prompt with requirement + catalog only, never
  discloses bug. Extracts JSON, unwraps wrapped ops, attaches _diag.
- testPlanValidator.js -- bounded contract: version, ruleId, 2..8 ops,
  allowlist + bounds + refs, alias normalization. Fails closed.
- semanticGate.js -- (Sprint 3.1) 4-pillar eligibility: cumulative,
  accepted, per-order, captured. Checks requirement, interpretedRule,
  and plan exceed-cap shape. VALID vs NEEDS_INPUT/UNSUPPORTED.
- approval.js -- SHA-256 canonical hash over requirement+plan.
- refundService.js -- in-memory fictional service. Buggy: per-refund
  check only. Corrected: cumulative check. No DB.
- executor.js -- fixed deterministic switch on allowlisted ops;
  requires approved===true; never evals model JS.
- server.js -- Node http server: /api/config, /api/recorded,
  /api/interpret (validate+gate+token), /api/run (re-gate+verify+
  dual execute). Static public/. Sanitizes paths.
- public/ -- Minimal proof UI: textarea, Interpret + Use Recorded,
  interpreted rule, numbered timeline, raw plan, Approve & Run,
  buggy vs corrected charts+traces, invariant banner, JSON export.
- fixtures/evaluation.json -- 10-case dataset, labels frozen pre-model.
- scripts/evaluate.mjs, scripts/runFeasibility.js -- evaluation and
  feasibility runners.

## 3. Flow

1. Requirement + catalog -> Muse Spark (or recordedResponse.json)
2. normalize + validate (structural)
3. semantic gate (pillars + interpretedRule + plan shape)
4. approval hash (token bound to requirement+plan)
5. human click Approve & Run
6. /api/run re-validates, re-gates, verifies hash
7. executePlan buggy + correct (deterministic)
8. invariant banner + charts + JSON report

## 4. Safety

No DB, no auth, no payment APIs, no browser automation, no Playwright.
No arbitrary code: fixed switch only. Approval invalidated on change.
Gate enforced twice. Requirement capped 2000, ops capped 8. Secrets
never printed. .env.local never committed.

## 5. Prompt Discipline

buildRefundPrompt() includes only requirement + catalogDescription() +
"No bug hints" constraint. Never includes expected labels or defect.

## 6. Provenance

metaClient.js adapted from companion workcadence-meta-hackathon; see
docs/HACKATHON_DISCLOSURE.md and NEW_WORK.md. All else new for ProofCase.

## 7. Deployment

Not deployed. Local only. node --env-file=.env.local src/server.js
