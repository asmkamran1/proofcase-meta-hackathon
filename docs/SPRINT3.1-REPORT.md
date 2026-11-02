# Sprint 3.1 — Semantic Safety + Evaluation Integrity Report
Date: 2026-11-01 Mode: ACT (bounded corrective sprint)

## 1. Root Cause
- Validator only structural (ops/bounds/refs). No check that requirement entailed refund-cap invariant.
- Planner prompt primed refund-cap exceed-cap scenario; model hallucinated captured=10000 for vague "too large" / "correctly".
- No semantic gate in server (/api/interpret) or evaluator; they judged plan shape only, not requirement text pillars.
- Result: AMB-01/AMB-02 produced executable plans that passed structural validation. Evaluator refused execution via not-executed-per-integrity, but UI was vulnerable.

## 2. Was Normal UI Path Vulnerable?
Yes. Before fix, /api/interpret returned VALID with approvalToken for ambiguous. /api/run only verified hash, not semantics, so executePlan could run with approved:true. After fix, /api/interpret returns NEEDS_INPUT with unverified:true and no token; /api/run re-checks gate and fails closed with 400 and missing list.

## 3. Exact Files Modified
- src/semanticGate.js (new) — 4-pillar gate (cumulative, accepted, per-order, captured) + interpretedRule + plan exceed-cap check. Returns VALID vs NEEDS_INPUT/UNSUPPORTED.
- src/planner.js (modified) — retry with isConfirmedTruncation, max 2 attempts, higher budget only on truncation, accurate _diag.attempts.
- src/server.js (modified) — gate in /api/interpret (no token if ineligible) and /api/run (400 if ineligible).
- scripts/evaluate.mjs (modified) — same gate, accurate counting via _diag.attempts, separate metrics, archive live history.
- docs/EVALUATION.md (modified) — added Sprint 3.1 gate/retry/metrics/human-review docs, archived live 2026-11-01T18:49:06.
- docs/human-review.md/json (new) — append-only log, frozen labels unchanged.
- test/sprint3.1.test.js (new) — 9 categories targeted tests.
- docs/evaluation-report.json (regenerated dry-run with metrics) and docs/archive/* preserved.

## 4. Fail-Closed Safeguards
- 4-pillar requirement check: cumulative (total/sum/cumulative/aggregated/capped), accepted/approved, per-order (order), captured. Vague large/reasonable/correctly rejected. Also checks interpretedRule and plan exceed-cap (sum refunds > captured, hasAccepted+rejected). Missing => NEEDS_INPUT/UNSUPPORTED with unverified:true.
- Same contract in UI and evaluator via shared import.
- Human approval still required; hash bound to requirement+plan, invalidated on change.
- Unverified cannot execute: no token issued; /api/run re-validates gate before execute.

## 5. Targeted Test Results
Ran node --test test/sprint3.1.test.js (14 tests) — all pass:
ambiguous blocked, six supported pass, unsupported UNSUPPORTED, browser/evaluator consistency, no execution of unresolved, approval invalidation, truncation retry, max 2 attempts, provider counting, exact vs safe abstention (exact 8/10, safe 4/4), no auto paid calls, no retry on invalid semantics, higher budget only on truncation, metrics+archive.

Existing targeted: validator 4 pass, planner 3 pass, sprint2 11 pass, evaluation 10 pass after dry-run regen.

## 6. Retry and Provider-Attempt Findings
- Previous bug: single-attempt, no retry at 4096 -> 2 truncations (SUP-05/06) finish_reason length empty. No retry.
- Fix: isConfirmedTruncation (!hasContent && (length || budgetExhausted)), retryAfterTruncation with higher budget (~2x initial, max 16384), max 2 attempts, no retry on stop/malformed/validation.
- Counting: _diag.attempts (1 or 2) summed per live case via evaluator, logs Provider attempts used. Cap 20 enforced before live call.

## 7. Exact Updated Evaluation Metrics Methodology
- counts unchanged for compat: expectedSupported 6 etc., semanticPass only true, semanticFail only false (model_error separate).
- New metrics: exactClassificationCount/Rate = strict expected===actual (ambiguous->unsupported not exact, 8/10 dry-run), safeAbstentionCount/Rate = ambiguous|unsupported expected where actual==unsupported (4/4), providerErrorCount separate, semanticPendingNotPass true.
- Live history archived to docs/archive/ never overwritten; human-review.md/json append-only.

## 8. Optional Minimal Live Verification (opt-in)
```powershell
Copy-Item .env.example .env.local
# set BASETEN_API_KEY
node scripts/evaluate.mjs --live   # archives previous live, caps 20, shows metrics
node scripts/evaluate.mjs          # dry-run default offline
node --test test/sprint3.1.test.js # targeted verification
```

## 9. Unresolved Limitations
- Human review of interpretedRule still manual; gate checks captured+cumulative presence not strict < vs <=.
- Token usage via _diag.completionTokens only if provider returns; evaluator tokenUsage n/a known limitation.
- Unsupported mentioning refunds but containing all pillars could pass gate; narrow to refund-cap only.
- 10 synthetic cases not general benchmark; mock verifies wiring not live quality.

---
Generated for Sprint 3.1. No git commits/pushes/deployments/full suite by agent.
