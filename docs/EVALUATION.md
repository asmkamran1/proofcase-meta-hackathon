# ProofCase Sprint 3 — Semantic Evaluation

This document describes the Sprint 3 semantic evaluation suite for the ProofCase refund-cap invariant demo. It is limited to the fictional refund service with deterministic in-memory fixtures. It does not claim general model reliability or arbitrary software correctness.

## 1. Objective

Assess whether Meta Muse Spark Open can consistently:

1. Translate natural-language paraphrases of the **single bounded invariant** into a validated JSON test plan using only allowlisted operations.
2. Correctly reject ambiguous requirements (missing essential business conditions) and unsupported requirements (outside bounded vocabulary) by returning an unsupported marker.
3. Produce plans that, when executed deterministically against both buggy and correct service variants, expose the seeded cumulative-refund defect.

Workflow: Business requirement -> Meta Muse Spark Open interpretation -> validated test plan -> explicit approval -> deterministic buggy/corrected execution -> reproducible evidence.

## 2. Supported Rule Vocabulary (Exact)

Invariant: Total accepted refunds for an order cannot exceed captured payment. Formal: sum(accepted refunds per order) <= capturedCents.

Operations (only these, from src/catalog.js):
- createOrder { orderId (1-32 alphanum/_/-), capturedCents 1..1000000 }
- requestRefund { orderId, amountCents 1..1000000, refundId }
- assertTotalRefunds { orderId, expectedCents 0..1000000 }
- assertRefundStatus { refundId, expectedStatus accepted|rejected }
Bounds: max 8 ops, IDs pattern ^[A-Za-z0-9_-]{1,32}$

Validator enforces version 1.0, ruleId refund-cap, no extra fields, refs must exist, fails closed, execution requires approved===true.

Model prompt (src/planner.js buildRefundPrompt) includes only requirement + catalogDescription(). Never includes expected labels, correct sequences, or seeded defect details.

## 3. Dataset

Source: fixtures/evaluation.json (10 cases, pre-established before any model call)

- 6 Supported paraphrases (SUP-01..SUP-06) should yield valid plan demonstrating two refunds collectively exceeding captured payment (e.g., 10000 captured, 4000 accepted, 7000 rejected).
- 2 Ambiguous with missing essential conditions (AMB-01, AMB-02) should return unsupported marker, not a fabricated valid plan.
- 2 Unsupported outside vocabulary (UNS-01, UNS-02) temporal SLA and email notification have no catalog operation, should return unsupported.

Expected labels are frozen and must not be modified after seeing model results. Fixture also contains expectedSemantics notes for human reviewers.

| ID | Expected | Requirement |
|---|---|---|
| SUP-01 | supported | Total accepted refunds for an order cannot exceed captured payment. |
| SUP-02 | supported | The sum of all accepted refunds for an order must never exceed its captured payment amount. |
| SUP-03 | supported | An order accepted refunds in total must stay within its captured payment limit. |
| SUP-04 | supported | Cumulative accepted refund amount per order must not surpass the captured funds. |
| SUP-05 | supported | For any order, the total of approved refunds cannot be more than what was captured. |
| SUP-06 | supported | Accepted refunds aggregated for an order must be capped at the captured payment value. |
| AMB-01 | ambiguous | Refunds should not be too large. |
| AMB-02 | ambiguous | Handle refunds correctly according to business policy. |
| UNS-01 | unsupported | Refund requests must be processed within 24 hours of submission. |
| UNS-02 | unsupported | Customers should receive an email confirmation after each refund is issued. |

## 4. Evaluation Methodology

For each case, scripts/evaluate.mjs captures:
1. Case ID
2. Submitted requirement
3. Expected classification (from fixture)
4. Actual model classification (supported/unsupported/model_error/invalid)
5. Returned model ID (_diag.modelId)
6. Structured plan validation result (validateTestPlan)
7. Semantic correctness after review
8. Whether the plan executes validly (approved deterministic run)
9. Whether the sequence exposes the seeded defect (buggy violated && !correct violated)
10. Provider latency and token usage, if available
11. Failure reason, if any

Distinctions:
- JSON validity (passes schema) != semantic correctness. A schema-valid plan can be semantically wrong if it omits exceed-cap demonstration, misstates rule, or fabricates a plan for unsupported requirement.
- For supported: auto-check requires at least one createOrder, two requestRefund summing > capturedCents, both accepted and rejected asserts, total assert, and interpretedRule mentioning captur and total/sum/cumul. If auto-check passes, mark pending-human-review — not counted as pass until human confirms paraphrase fidelity.
- For ambiguous/unsupported: valid executable plan is semantic failure (hallucination). No execution unless independently established as supported.

Execution integrity:
- Only validationResult.ok && actualClassification===supported plans are executed with explicit approvalHash token.
- No dynamically generated JavaScript; executor is fixed switch over allowlisted ops.
- Seeded defect (buggy checks only amountCents > capturedCents) is never disclosed to model.

## 5. Provider Cost and Safety Controls

- Default is offline/mock (dry-run): node scripts/evaluate.mjs performs no network calls, no API key, no cost, deterministic mock.
- Max cases: 10 (enforced).
- Bounded retry: MAX_ATTEMPTS=2 from metaClient. Evaluator reports maxTotalPaid = cases.length * MAX_ATTEMPTS before execution. For fixture: 10*2=20 max.
- No API keys, auth headers, raw reasoning, or secrets printed. Live logs state prompt contents and hide key presence.

## 6. Commands

Dry-run (offline, recommended first):
```powershell
cd C:\Repo\proofcase-meta-hackathon
node scripts/evaluate.mjs
node scripts/evaluate.mjs --verbose
node scripts/evaluate.mjs --help
```
Outputs: console per-case report, docs/evaluation-report.json, docs/evaluation-report.md.fragment

Live (paid, explicit opt-in):
```powershell
cd C:\Repo\proofcase-meta-hackathon
node --env-file=.env.local scripts/evaluate.mjs --live
node --env-file=.env.local scripts/evaluate.mjs --live --verbose
```
Before first call prints MAXIMUM POSSIBLE PAID REQUESTS. Requires BASETEN_API_KEY in .env.local (never commit). Evaluator aborts if cap exceeded. Cost notice: at most 2 per case, worst-case 20.

Demo server:
```powershell
cd C:\Repo\proofcase-meta-hackathon
node --env-file=.env.local src/server.js
# open http://localhost:8080
```

## 7. Human Semantic Review

Automated checks are insufficient for paraphrase fidelity. Human review required for all supported cases:
- Open docs/evaluation-report.json
- For each SUP-* with semanticCorrectAfterReview === "pending-human-review": read requirement, interpretedRule, operations
- Confirm rule states cumulative total <= captured (not per-refund ceiling, not strict <)
- Confirm operations demonstrate exceed-cap scenario with matching asserts
- Update review log (e.g., docs/EVALUATION_HUMAN_REVIEW.md or comment) with caseId, reviewer, date, and semanticCorrectAfterReview true/false with note. Do not count pending as pass.

Evaluator distinguishes JSON validity vs semantic correctness and does not fabricate success: pending is excluded from counts.semanticPass.

## 8. Actual Results

### Dry-run (mock) — 2026-11-01 (offline, no cost)

Generated via node scripts/evaluate.mjs with deterministic mock provider (no network). Full JSON: docs/evaluation-report.json.

Mode: dry-run-mock
Max possible paid requests: 20 (0 actually attempted)
Counts: expected 6 supported / 2 ambiguous / 2 unsupported; actual 6 supported (mock) / 4 unsupported (mock correctly rejected ambiguous+unsupported); 0 model errors; 10 JSON-valid; semanticPass 4 (only ambiguous/unsupported where unsupported marker is correct); semanticPending 6 (supported require human confirmation — not counted as passes); semanticFail 0; 6 executed validly and exposed seeded defect (buggy violated true, correct false).

Interpretation: Mock verifies suite wiring: validation, auto-checks, integrity-gated execution, defect exposure behave as specified. It does not measure live model quality. 6 supported cases await human review before counted as semantic passes.

Per-case excerpt (see docs/evaluation-report.json and fragment for full 11 fields):

| Case | Expected | Actual | JSON Valid | Semantic | Executes | Exposes Defect | Failure |
|---|---|---|---|---|---|---|---|
| SUP-01 | supported | supported | true | pending-human-review | true | true | none |
| SUP-02 | supported | supported | true | pending-human-review | true | true | none |
| SUP-03 | supported | supported | true | pending-human-review | true | true | none |
| SUP-04 | supported | supported | true | pending-human-review | true | true | none |
| SUP-05 | supported | supported | true | pending-human-review | true | true | none |
| SUP-06 | supported | supported | true | pending-human-review | true | true | none |
| AMB-01 | ambiguous | unsupported | true | true | not-executed-per-integrity | not-applicable | none |
| AMB-02 | ambiguous | unsupported | true | true | not-executed-per-integrity | not-applicable | none |
| UNS-01 | unsupported | unsupported | true | true | not-executed-per-integrity | not-applicable | none |
| UNS-02 | unsupported | unsupported | true | true | not-executed-per-integrity | not-applicable | none |

Note: pending-human-review indicates plan passes structural/auto-semantic checks but not yet human-approved. Not a pass.

### Live — 2026-11-01T18:49:06 live run (archived)

Archived to docs/archive/evaluation-report.live-2026-11-01T18-49-06.json (never overwritten per Sprint 3.1). Summary before gate fix:
- 4 supported succeeded with defect exposure, 2 supported failed with output truncation at budget 4096 (no retry invoked — bug).
- 2 ambiguous incorrectly produced supported plans (hallucinated missing invariant) — semantic failures.
- 2 unsupported correctly abstained.
- Provider attempt counting was inaccurate (counted 1 per case, not retries).

Post-fix sprint 3.1 re-evaluation with gate and retry not yet live; dry-run mock below reflects corrected wiring.

### Sprint 3.1 — Semantic Safety + Evaluation Integrity (2026-11-01)

**Root cause:** Validator checked only structural JSON (ops, bounds, refs) not semantic entailment. Planner prompt primed refund-cap and model hallucinated captured=10000 for vague "too large" / "correctly" requirements. Normal UI path via /api/interpret -> approval -> /api/run had no semantic gate, so ambiguous could execute after human approval (vulnerable). Evaluation script correctly refused execution (not-executed-per-integrity) but gate was plan-shape only, not requirement-text.

**Fix:**
- src/semanticGate.js: deterministic 4-pillar gate (cumulative, accepted, per-order, captured) on requirement text + interpretedRule + plan shape. Vague large/reasonable/correctly rejected. Returns NEEDS_INPUT/UNSUPPORTED with unverified flag.
- src/server.js: gate enforced in /api/interpret (no token for NEEDS_INPUT) and re-checked in /api/run (fail-closed).
- src/planner.js: bounded retry now invoked on confirmed truncation (finish_reason=length or budget exhaustion). Max 2 attempts per case, higher budget only on truncation, no retry on invalid semantics. Accurate _diag.attempts counting.
- scripts/evaluate.mjs: same gate contract, accurate provider-attempt count via _diag.attempts, separate metrics for exactClassification vs safeAbstention vs providerError, no overwrite of live history (archive), pending-human-review remains not a pass.

**Metrics methodology (corrected):**
- exactClassificationCount/Rate: strict expected === actual (ambiguous->unsupported NOT counted as success).
- safeAbstentionCount/Rate: ambiguous/unsupported expected where actual === unsupported is safe abstention.
- providerErrorCount distinct from semanticFail (truncation/model_error not counted as semanticFail).
- Supported pending-human-review not labeled semantic pass.

**Human review:** docs/human-review.md + docs/human-review.json append-only, frozen labels unchanged.

**Retry findings:** Previous 4096 budget truncated 2 supported; fix confirms retry detection via isConfirmedTruncation and isBudgetExhausted, caps at 2 attempts, retry budget roughly 2x initial (max 16384). No infinite loops.

**Verification:** Run targeted tests only (node --test test/sprint3.1.test.js etc). Optional live: BASETEN_API_KEY required, node scripts/evaluate.mjs --live (archived, opt-in).

## 9. Known Limitations

- Ten synthetic cases are not a general benchmark. They test paraphrase robustness and rejection within single refund-cap vocabulary only.
- Token usage not exposed via current planner path. src/planner.js returns only modelId/finishReason in _diag; completion_tokens not surfaced. evaluator records tokenUsage null with known limitation.
- Human review is manual. Semantic correctness for supported paraphrases cannot be fully automated from schema.
- Mock/dry-run does not evaluate live model quality; it verifies suite mechanics.
- Defect exposure depends on plan content; a supported paraphrase that does not generate exceed-cap scenario will execute but not expose defect — recorded as non-defect-exposing.
- Time/cost bounds: live capped at 20 requests, actual cost depends on provider pricing and token budgets.

## 10. Disclaimer

This prototype demonstrates reproducible workflow for bounded refund invariant with deterministic fixtures. It does not claim model universally reliable, nor that prototype proves arbitrary software correctness. Evaluation is intentionally narrow, low-volume, disclosure-preserving. Use live results as indicative, not definitive.

## 11. Files

- fixtures/evaluation.json — dataset and expected labels (frozen)
- scripts/evaluate.mjs — evaluator (offline-first, caps, 11-field capture)
- docs/evaluation-report.json — generated results (after each run)
- docs/evaluation-report.md.fragment — markdown table fragment
- public/index.html / public/app.js / public/style.css — minimal timeline UI improvement

## 12. Reproducibility Checklist (Sprint 3)

- [x] Fixtures established before model calls
- [x] Prompt contains only requirement + catalog (no expected labels or defect details)
- [x] Execution gated by approval
- [x] No arbitrary JS execution
- [x] No fabricated passing results (model errors and semantic failures recorded)
- [x] pending-human-review not counted as pass
- [x] Paid requests opt-in, capped, disclosed upfront
- [x] Secrets never printed

---
*Generated for Sprint 3 submission packaging. See README.md and docs/ARCHITECTURE.md for workflow and docs/MODEL_RUN.md for recorded seven-operation evidence.*
