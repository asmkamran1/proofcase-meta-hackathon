# ProofCase -- Refund Invariant Demo with Meta Muse Spark Open

> Meta Global AI Developer Hackathon 2026 -- Indie Developer Submission
> Synthetic seeded defects are not discoveries in production software.

## 1. Problem

Business requirements are written in natural language. Translating
"total accepted refunds cannot exceed captured payment" into a
repeatable, auditable test sequence is manual, ambiguous, and hard to
trust when a model is involved.

## 2. What ProofCase Does

Given one refund rule, ProofCase:

1. Sends only requirement + bounded catalog to Muse Spark 1.3 via the
   native Meta Model API (`muse-spark-1.3`), or to Muse Spark Open via
   Baseten (`meta-models/muse-spark-open-1026`) when `MODEL_PROVIDER=BASETEN`.
2. Receives STRICT JSON: version, ruleId, businessRequirement,
   interpretedRule, operations (allowlisted, max 8).
3. Validates structurally and semantically (4-pillar gate: cumulative,
   accepted, per-order, captured; plan must demonstrate exceed-cap).
4. Requires explicit human approval (hash-bound token).
5. Executes deterministically on buggy vs corrected in-memory fixtures.
6. Renders side-by-side results and downloadable JSON report.

## 3. Why Meta Muse Spark Open Matters

The test-plan translation including interpretedRule paraphrase is
produced by Muse Spark Open. No template or fallback exists. The model
preserves cumulative business semantics and proposes a scenario that
collectively exceeds the cap across two refunds. Truncation is handled
with bounded retry (4096 default, capped 16384, max 2 attempts).

## 4. Installation and Execution

Requires Node 20+.

```powershell
cd C:\Repo\proofcase-meta-hackathon
npm install   # zero prod dependencies; verifies package manifest only
# Create .env.local ONLY if absent; never overwrite an existing file:
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
# set MODEL_API_KEY in .env.local for META live (never commit it; never print it)
# or set BASETEN_API_KEY with MODEL_PROVIDER=BASETEN for legacy Baseten live

# tests (no API key needed)
node --test test/

# app (recorded replay needs no key; live inference needs selected provider key)
node --env-file=.env.local src/server.js
# open http://localhost:8080


# feasibility gate (real inference)
node scripts/runFeasibility.js

# evaluation
node scripts/evaluate.mjs              # dry-run mock (offline)
node scripts/evaluate.mjs --live       # real inference (capped 20)
```

## 5. Live Inference vs Recorded Replay

| Mode | Label | Source | Cost |
|---|---|---|---|
| LIVE | LIVE META RESPONSE (green) | POST /api/interpret via native Meta Model API (muse-spark-1.3), or Baseten legacy when selected | Paid |
| RECORDED | RECORDED META RESPONSE (amber) | docs/recordedResponse.json 2026-10-29 (historical Muse Spark Open via Baseten) | Free |

Both paths share validation, gate, approval, and executor.
The demo video uses Recorded as primary and labels it on screen.

## 6. Deterministic Execution Engine

- `refundService.js`: Map(orderId -> {capturedCents, refunds[]}), no DB.
- `executor.js`: fixed switch over 4 allowlisted ops, requires approved.
- Never evals model JS; invariant: sum(accepted) <= capturedCents.

## 7. Supported Vocabulary

Single invariant refund-cap: sum(accepted per order) <= capturedCents.

Allowed ops:
- createOrder {orderId 1-32 alphanum/_/-, capturedCents 1..1M}
- requestRefund {orderId, amountCents 1..1M, refundId 1-32}
- assertTotalRefunds {orderId, expectedCents 0..1M}
- assertRefundStatus {refundId, expectedStatus accepted|rejected}
Max 8 ops, IDs ^[A-Za-z0-9_-]{1,32}$.

## 8. Human Approval and Safety

- Authorization: server-issued HMAC token (per-instance random 32-byte key,
  15-minute TTL, constant-time signature check). Binds canonical
  requirement hash + normalized plan hash + provenance + modelId.
  Legacy unsigned SHA-256 hashes cannot authorize `/api/run`.
  This is server-issued execution authorization, not human identity
  authentication.
- Explicit human step: UI requires Approve & Run click; `doInterpret`
  never calls `/api/run`. Requirement edits invalidate approval;
  stale/overlapping interpretation responses are discarded via
  generation counter (`interpretSeq`) and requirement snapshot.
- Semantic gate: bounded keyword eligibility (cumulative, accepted,
  per-order, captured) plus reversed/strict/equality/vague-cap
  fail-closed checks, plus `interpretedRule` and plan exceed-cap shape.
  Enforced in `/api/interpret` (no token when ineligible) and re-checked
  in `/api/run` (400 when ineligible). Unverified means no execution.
- Fail-closed, no arbitrary code, no Playwright, no DB.

## 9. Evaluation Results and Limitations

Dataset: fixtures/evaluation.json — 10 synthetic cases (6 supported,
2 ambiguous, 2 unsupported), labels frozen before any model call.

Do not invent stats — see docs/EVALUATION.md and
docs/evaluation-report.json. Recorded references:
- Dry-run 2026-11-01 mock: exact 8/10, safeAbstention 4/4, providerError 0.
- Live archive 2026-11-01 (10 paid attempts): 2 supported truncated at
  4096 (model_error), 4 supported valid; ambiguous handling now blocked
  by Sprint 3.1 gate.
- docs/archive/ holds preserved history; docs/human-review.md log.

Limitations: 10 cases are not a general benchmark; semantic review is
manual; gate is narrow to refund-cap.

## 10. What Was Built Oct 26 - Nov 4

Sprint 1: Feasibility gate with real Muse Spark plan (docs/MODEL_RUN.md).
Sprint 2: Browser demo with approval, side-by-side, JSON export, recorded.
Sprint 3: 10-case evaluation with real inference.
Sprint 3.1: Safety correction, bounded retries, corrected metrics, archive.
Sprint 4: Audit, docs, submission readiness.

See NEW_WORK.md, docs/HACKATHON_DISCLOSURE.md, docs/SPRINT3.1-REPORT.md.

## 11. Reused Code Disclosure

src/metaClient.js adapted from the in-window Form Intelligence prototype
at C:\Repo\workcadence-meta-hackathon\src\metaClient.js (same author,
same model, same Oct 26-Nov 4 window). Only generic Baseten transport
shared. See NEW_WORK.md and docs/HACKATHON_DISCLOSURE.md.

## 12. Known Limitations and Future Work

Single invariant only; 10 cases not general; gate checks pillar presence
not <= vs < semantics; token reporting provider-dependent. Future:
additional vocabularies, stricter theorem checks, cost tracing.

## 13. Security

Never commit .env.local (see .gitignore). Rotate any exposed key via
Baseten dashboard. See docs/SECURITY_AUDIT.md for audit findings.

## License

MIT -- see LICENSE. Attributions in THIRD_PARTY_NOTICES.md.
