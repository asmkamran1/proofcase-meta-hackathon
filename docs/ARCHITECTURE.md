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
- planner.js -- builds prompt with requirement + catalog only, never
  discloses bug. Extracts JSON, unwraps wrapped ops, attaches _diag.
- testPlanValidator.js -- bounded contract: version, ruleId, 2..8 ops,
  allowlist + bounds + refs, alias normalization. Fails closed.
- semanticGate.js -- 4-pillar eligibility: cumulative,
  accepted, per-order, captured. Checks requirement, interpretedRule,
  and plan exceed-cap shape. Hardened fail-closed: reversed exceed,
  strict less-than, equality, and vague cap language rejected.
  Returns VALID vs NEEDS_INPUT/UNSUPPORTED.
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
  /api/interpret (validate + gate + HMAC authorization),
  /api/run (re-gate + verify + dual execute). Static public/
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
2. normalize + validate (structural: version, ruleId, 2..8 ops, allowlist + bounds + refs)
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
