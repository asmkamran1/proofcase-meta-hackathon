# Architecture -- ProofCase

## 1. Invariant

Total accepted refunds for an order cannot exceed captured payment.
Formal: sum(accepted refunds per order) <= capturedCents.
Defect is intentionally seeded and fictional.

## 2. Components

- catalog.js -- allowlisted ops/fields/bounds, BUSINESS_REQUIREMENT,
  catalogDescription() sent to Meta. Single ruleId refund-cap.
- metaClient.js -- server-side multi-provider model client (META native
  Model API default `muse-spark-1.3`; BASETEN legacy Muse Spark Open),
  no fallback. Provides modelConfig(), resolveBudgets(), postChat(),
  retry, _diag. Default 4096, retry ~2x capped 16384, max 2 attempts.
  META uses strict JSON Schema (`strict:true`) with a discriminated
  envelope `{ result: { outcome: "supported"|"unsupported", ... } }`
  converted by fromMetaEnvelope() to the existing flat contract; local
  validation remains authoritative. M1.5 adds an internal `eligible-plan`
  contract for already-eligible live UI requests: exactly
  `{ interpretedRule, operations }` via ELIGIBLE_PLAN_JSON_SCHEMA
  (no outcome/unsupported branch), `reasoning_effort:"low"` on META only,
  concise prompt via buildEligiblePlanPrompt(), server-owned
  version/ruleId/businessRequirement attached after validation by
  toCanonicalEligiblePlan(); legacy/Baseten/applicant paths unchanged.
  M1.4: AbortController deadline covers
  headers + body (no early clear), sanitized hints/codes
  (MODEL_TIMEOUT/MODEL_HTTP_ERROR/MODEL_REFUSAL/MODEL_INVALID_OUTPUT/
  MODEL_ABSTAINED), active-budget-only exhaustion (legacy 2048 is
  diagnostic-only), identical initial/retry conversion, refund-plan vs
  applicant-interpretation contract isolation (never refund schema for
  applicant helper; no tools/tool_choice ever sent).
- planner.js -- builds prompt with requirement + catalog only, never
  discloses bug. Extracts JSON, converts the META strict envelope via
  fromMetaEnvelope(), unwraps wrapped ops, attaches _diag. M1.5: eligible
  live UI path uses buildEligiblePlanPrompt() + fromEligiblePlan() with
  server-owned metadata; legacy conversion preserved for other callers.
- testPlanValidator.js -- bounded contract: version, ruleId, 2..8 ops,
  allowlist + bounds + refs, alias normalization. Fails closed.
- semanticGate.js -- 4-pillar eligibility: cumulative,
  accepted, per-order, captured. Checks requirement, interpretedRule,
  and plan exceed-cap shape. Hardened fail-closed: reversed exceed,
  strict less-than, equality, and vague cap language rejected.
  M1.4: per-order exceed-cap groups refunds by orderId (2+ refunds in
  the same order must exceed that order's capturedCents; cross-order
  sums never qualify). Returns VALID vs NEEDS_INPUT/UNSUPPORTED.
- approval.js -- server-issued HMAC-SHA256 execution authorization
  (per-instance random 32-byte key, 15-minute TTL, constant-time
  signature and digest comparison). Binds the requirement plus the
  normalized plan plus provenance plus modelId. Legacy unsigned
  hashes cannot authorize /api/run. Authorization is not human
  identity authentication and does not prove a specific person
  approved the plan.
- refundService.js -- in-memory fictional service. Buggy: per-refund
  check only. Corrected: cumulative check. No DB.
- executor.js -- fixed deterministic switch on allowlisted ops;
  requires approved===true; never evals model JS.
- server.js -- Node http server bound strictly to 127.0.0.1
  (no public bind, no HOST override): /api/config, /api/recorded,
  /api/interpret (requirement-only preflight + validate + gate + HMAC authorization),
  /api/run (re-gate + verify + dual execute). M1.5 eligible live path:
  preflight stays deterministic, then invokes Meta with the internal
  eligible-plan contract (never browser-selectable). M1.4 live path:
  deterministic checkSemanticEligibility({businessRequirement}) before any
  provider call (ineligible never invokes provider/charges/authorization);
  eligible-request unsupported/refusal/malformed maps to MODEL_ERROR with
  MODEL_ABSTAINED/MODEL_REFUSAL/MODEL_INVALID_OUTPUT (never
  UNSUPPORTED_REQUIREMENT, never raw reason/policy reflection, never
  recorded fallback, never fabricated plan). Static public/
  with traversal/symlink fail-closed handling. Host/Origin
  checks before paid inference; in-memory live-inference rate
  limit (not a durable spending cap); no wildcard CORS.
- public/ -- Minimal proof UI: textarea, Interpret + Use Recorded,
  interpreted rule, numbered timeline, raw plan, Approve & Run,
  buggy vs corrected charts+traces, invariant banner, JSON export.
- fixtures/evaluation.json -- 10-case dataset, labels frozen pre-model.
- scripts/evaluate.mjs, scripts/runFeasibility.js -- evaluation and
  feasibility runners.

## 3. Flow

Business Requirement
-> Selected Meta Model Provider
-> AI-Generated Test Plan
-> Structural Validation
-> Semantic Eligibility Gate
-> Server-Issued Authorization
-> Explicit User Approval
-> Deterministic Execution
-> Buggy/Corrected Comparison
-> JSON Report

1. Requirement + catalog -> selected Meta Muse Spark provider by default (native Meta Model API, `muse-spark-1.3`; Muse Spark Open via Baseten only when `MODEL_PROVIDER=BASETEN`; or recordedResponse.json)
2. requirement-only preflight (M1.4 live path): checkSemanticEligibility({businessRequirement}) before any provider call. Ineligible returns NEEDS_INPUT/UNSUPPORTED with deterministic local reason, no provider, no credits, no authorization.
3. normalize + validate (structural: version, ruleId, 2..8 ops, allowlist + bounds + refs). Eligible-request model abstention maps to MODEL_ERROR/MODEL_ABSTAINED (never UNSUPPORTED_REQUIREMENT).
3. semantic gate (bounded keyword eligibility: cumulative + accepted + per-order + captured; reversed/strict/equality/vague-cap fail-closed; plus interpretedRule + plan exceed-cap shape)
4. server-issued HMAC-SHA256 execution authorization (per-instance key, 15-min TTL; binds requirement + normalized plan + provenance + modelId)
5. explicit human click Approve & Run submits that authorization (UI never auto-runs; edits invalidate approval; stale/overlapping responses discarded)
6. on execution request, /api/run re-validates, re-gates, verifies HMAC (fail-closed 400; legacy unsigned hashes rejected)
7. executePlan buggy + correct (deterministic, allowlisted ops only)
8. invariant banner + charts + JSON report (server-trusted provenance/modelId; client labels ignored)

Token issuance precedes the browser approval click, and the server
validates the token when the user requests execution. This order does
not mean the browser click is cryptographically authenticated as an
identity assertion.

## 4. Safety

No DB, no human identity authentication, no payment APIs, no browser
automation, no Playwright. Provenance and rate limiting are server-side
controls, not cross-machine security boundaries: loopback-only binding
plus Host/Origin checks do not authenticate arbitrary local processes,
and the in-memory rate limit is not a durable spending cap.
No arbitrary code: fixed switch only. The model proposes a bounded
plan but never executes code. The planner prompt explicitly requests a
cumulative refund-cap violation scenario using predefined operations,
so the model did not independently discover an unknown defect.
Server-issued authorization is invalidated on requirement/plan change
and expires after 15 minutes.
Gate enforced twice (interpret + run). JSON bodies capped at 64 KiB.
Secrets never printed. .env.local never committed.

## 5. Prompt Discipline

buildRefundPrompt() includes only requirement + catalogDescription() +
"No bug hints" constraint. Never includes expected labels or defect.

## 6. Provenance

metaClient.js adapted from companion workcadence-meta-hackathon; see
docs/HACKATHON_DISCLOSURE.md and NEW_WORK.md. All else new for ProofCase.
Current META provider support was added during the M1/M1.1 migration;
recorded evidence remains historical Muse Spark Open via Baseten.

## 7. Deployment

Not deployed. Local only. node --env-file=.env.local src/server.js
