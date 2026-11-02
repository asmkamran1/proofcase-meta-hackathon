# Human Review Log — ProofCase Semantic Gate (Sprint 3.1)

This file records human review outcomes for evaluation cases WITHOUT altering frozen original labels in `fixtures/evaluation.json` or historical reports in `docs/archive/`.

## Policy
- `fixtures/evaluation.json` expectedClassification is frozen pre-model and never modified after seeing results.
- `docs/evaluation-report.json` is generated per run; live history is archived to `docs/archive/` and never overwritten to imply correction was always present.
- Supported interpretations with `pending-human-review` are NOT semantic passes until human confirms `interpretedRule` accurately restates cumulative cap.
- Ambiguous (`AMB-01`, `AMB-02`) classified as `unsupported` by model is safe-abstention but NOT exact-classification success.
- Provider errors (`model_error` e.g., truncation at 4096) are reported separately from semantic failures.

## Review File Format
Each entry is append-only: reviewer, timestamp, case, decision, rationale. Do NOT edit past entries to rewrite history; add new row if re-reviewed.

## Cases (as of 2026-11-01 Sprint 3.1 gate)

| Case | Requirement | Expected (frozen) | Model Actual (live 2026-11-01) | Gate Result | Human Review Status | Reviewer | Date | Notes |
|------|-------------|-------------------|-------------------------------|-------------|---------------------|----------|------|-------|
| SUP-01 | Total accepted refunds for an order cannot exceed captured payment. | supported | supported | VALID (pillars present) | pending-human-review | — | — | Auto gate passed; needs human confirm of interpretedRule |
| SUP-02 | The sum of all accepted refunds for an order must never exceed its captured payment amount. | supported | supported | VALID | pending-human-review | — | — | Paraphrase sum/never exceed |
| SUP-03 | An order accepted refunds in total must stay within its captured payment limit. | supported | supported | VALID | pending-human-review | — | — | Paraphrase within/limit |
| SUP-04 | Cumulative accepted refund amount per order must not surpass the captured funds. | supported | supported | VALID | pending-human-review | — | — | Cumulative/per order |
| SUP-05 | For any order, the total of approved refunds cannot be more than what was captured. | supported | model_error (truncation 4096) | VALID pillars but provider truncation | model_error | — | — | Bounded retry would retry with 8192; live run at 4096 truncated without retry (pre-fix) |
| SUP-06 | Accepted refunds aggregated for an order must be capped at the captured payment value. | supported | model_error (truncation 4096) | VALID pillars but truncation | model_error | — | — | Same as SUP-05 |
| AMB-01 | Refunds should not be too large. | ambiguous | supported (hallucinated) | NEEDS_INPUT (missing cumulative, per-order, captured) | semantic_fail | system gate | 2026-11-01 | Gate blocks: missing cumulative_scope, per_order_scope, captured_payment_bound; vague large not sufficient |
| AMB-02 | Handle refunds correctly according to business policy. | ambiguous | supported (hallucinated) | NEEDS_INPUT (missing all pillars) | semantic_fail | system gate | 2026-11-01 | Gate blocks: no complete invariant; correctly refused in evaluator but UI previously vulnerable |
| UNS-01 | Refund requests must be processed within 24 hours of submission. | unsupported | unsupported | UNSUPPORTED | pass (safe abstention) | system | 2026-11-01 | Out-of-vocabulary temporal SLA, correctly abstained |
| UNS-02 | Customers should receive an email confirmation after each refund is issued. | unsupported | unsupported | UNSUPPORTED | pass (safe abstention) | system | 2026-11-01 | Out-of-vocabulary email, correctly abstained |

## Gate Audit Details (semanticGate.js)
- Checks requirement text for 4 pillars: cumulative (total/sum/cumulative/aggregated), accepted (accepted/approved), per-order (order), captured (captured).
- Vague words large/reasonable/correctly do NOT satisfy gate.
- Checks interpretedRule preserves captured + cumulative language.
- Checks plan demonstrates exceed-cap (sum refunds > captured, has accepted+rejected).
- If missing, returns NEEDS_INPUT/UNSUPPORTED with unverified flag; server blocks execution and requires confirmation.
- Same gate applied in `/api/interpret`, `/api/run`, and `scripts/evaluate.mjs`.

## How to Record New Reviews
1. Do not edit `fixtures/evaluation.json` or `docs/archive/*`.
2. Append row to table above or to `docs/human-review.json` with fields: caseId, reviewedAt, reviewer, decision (approve/reject/pending), interpretedRule, rationale.
3. For supported `pending-human-review`, human must confirm interpretedRule mentions cumulative/total/sum and captured payment and plan exceeds cap. Example: SUP-01 interpretedRule "The sum of all accepted refunds for an order must never exceed its captured payment amount." => approve.

## Optional Minimal Live Verification
Requires user opt-in; no auto cost.
```powershell
$env:BASETEN_API_KEY="your-key"
node scripts/evaluate.mjs --live
```
Check `docs/evaluation-report.json` metrics: exactClassification, safeAbstention, providerError distinct.

## Unresolved Limitations
- Human review of interpretedRule semantics remains manual; gate catches missing pillars but not subtle paraphrase errors (e.g., strict < vs <=).
- Token usage not exposed via planner path beyond _diag.completionTokens; evaluator shows tokenUsage n/a known limitation.
- Unsupported requirements that mention refunds but also include vague pillars may still be caught by gate but not by generic theorem prover.
