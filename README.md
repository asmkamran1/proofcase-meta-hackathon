# ProofCase -- AI-Powered Refund Rule Testing with Meta Muse Spark

> Meta Global AI Developer Hackathon 2026 -- Indie Developer Submission
> Synthetic seeded defects are not discoveries in production software.

## 1. Problem

Business requirements are written in natural language. Translating
"total accepted refunds cannot exceed captured payment" into a
repeatable, auditable test sequence is manual, ambiguous, and hard to
trust when a model is involved.

## 2. What ProofCase Does

ProofCase tests one plain-English refund rule with help from Meta Muse Spark.

Given one refund rule, ProofCase:

1. Accepts a plain-English refund rule for a single invariant: total accepted refunds cannot exceed captured payment.
2. Sends only the requirement plus a bounded operation catalog to the selected Meta Muse Spark provider.
3. Receives a proposed bounded test sequence as STRICT JSON (max 8 allowlisted operations).
4. Validates the plan structurally and checks semantic eligibility before anything can run.
5. Requires an explicit Approve & Run action in the UI plus a server-issued authorization token before execution.
6. Runs the approved plan deterministically against simulated buggy and corrected refund services, then shows side-by-side results with a downloadable JSON report.

The refund defect is intentionally seeded for demonstration. The buggy
simulated service checks only each single refund, while the corrected
service checks the cumulative total. This demo does not claim discovery
of a real production payment defect, and it does not support arbitrary
business rules outside the single refund-cap invariant.

## 3. What Meta Muse Spark Contributes

The model proposes the test plan within an intentionally bounded
specification. There is no template or fallback plan: the
`interpretedRule` paraphrase and the exceed-cap scenario come from the
model, but the planner prompt explicitly requests a cumulative
refund-cap violation scenario using only the predefined operations.
The model does not execute code and did not independently discover an
unknown defect.

Two inference configurations are supported:

- META (current default): native Meta Model API,
  default model `muse-spark-1.3`, key `MODEL_API_KEY`,
  base URL `https://api.meta.ai/v1`.
- BASETEN (legacy support): Baseten inference,
  historical model `meta-models/muse-spark-open-1026`,
  key `BASETEN_API_KEY`,
  base URL `https://inference.baseten.co/v1`.

Changing the provider selects where new live inference runs. It does
not change historical evaluation results.

Historical evidence: the recorded response in
`docs/recordedResponse.json` was generated using Muse Spark Open
through Baseten on 2026-10-29. The current live default may use Muse
Spark 1.3, but that recorded output retains its original model
identity. This repository does not claim a verified live Muse Spark
1.3 demonstration beyond what is recorded in code and tests.

Truncation is handled with bounded retry (4096 default, capped 16384,
max 2 attempts).

## 4. Installation and Execution

Requires Node 20+.

The normal supported test command is:

```powershell
npm test
```

It preloads `test/helpers/offline-guard.js` and explicitly enumerates
the 15 test files listed in `package.json`. Do not use unguarded
`node --test test/` as the normal regression command: it bypasses the
application-level network protection and can pick up the helper as an
extra entry. New test files must be added to the `npm test` command
until automatic guarded discovery is implemented.

Current verified result (local run, November 3, 2026): 151 tests,
151 passed, 0 failed, 0 skipped, 0 cancelled. These are
software-regression tests, not 151 successful AI-generated plans, and
no CI execution is claimed here.

### Provider configuration

The intended native Meta configuration is:

```powershell
MODEL_PROVIDER=META
MODEL_API_KEY=<your-key>
META_MODEL=muse-spark-1.3
META_BASE_URL=https://api.meta.ai/v1
```

Use placeholders only. Never paste a real key, partial key, or
sample credential that resembles a production secret.

Setup rules:

- `.env.local` must never be committed (it is gitignored).
- Create `.env.local` only if absent; never overwrite an existing file:

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

- Previously exported PowerShell environment variables take precedence
  over values loaded from the file, so unset stale exports first.
- Replacing the API key alone does not switch providers; the provider
  is selected by `MODEL_PROVIDER`.
- Recorded replay works without any API key. Live inference requires
  credentials for the selected provider plus available provider capacity.
- For legacy Baseten live runs only, set `MODEL_PROVIDER=BASETEN` with
  `BASETEN_API_KEY` and the Baseten base URL and model from
  `.env.example`.

### Run the app and evaluation

```powershell
cd C:\Repo\proofcase-meta-hackathon
npm install   # zero prod dependencies; verifies package manifest only

# app (recorded replay needs no key; live inference needs selected provider key)
node --env-file=.env.local src/server.js
# open http://localhost:8080

# feasibility gate (real inference, paid, requires selected provider key)
node --env-file=.env.local scripts/runFeasibility.js

# evaluation
node scripts/evaluate.mjs              # dry-run mock (offline)
node --env-file=.env.local scripts/evaluate.mjs --live       # real inference (capped 20)
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

Execution requires an explicit approval action in the UI and a
server-issued HMAC-SHA256 authorization token.

- Authorization: server-issued HMAC token (per-instance random 32-byte key,
  15-minute TTL, constant-time signature check). Tokens bind the
  requirement, the normalized plan, and provenance. Signing keys are
  generated per server instance. Tokens do not authenticate human
  identity. Legacy unsigned hashes cannot authorize `/api/run`.
  This is server-issued execution authorization, not human identity
  authentication, and it does not prove a specific person approved the plan.
- Token order: the server issues the token after validation and the
  semantic gate pass; the browser's Approve & Run click then submits it.
  The server validates the token when the user requests execution.
  The browser click is not cryptographically authenticated as an
  identity assertion.
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
manual; gate is narrow to refund-cap and uses bounded heuristics, not
formal proof. The repository's 151 passing software tests are
regression evidence, not a benchmark of 151 successful AI-generated
plans.

## 10. What Was Built Oct 26 - Nov 4

Sprint 1: Feasibility gate with a real Muse Spark Open plan via Baseten
(docs/MODEL_RUN.md; no new paid Muse Spark 1.3 evaluation was run
during the later native Meta migration).
Sprint 2: Browser demo with approval, side-by-side, JSON export, recorded.
Sprint 3: 10-case evaluation with real inference.
Sprint 3.1: Safety correction, bounded retries, corrected metrics, archive.
Sprint 4: Audit, docs, submission readiness.

See NEW_WORK.md, docs/HACKATHON_DISCLOSURE.md, docs/SPRINT3.1-REPORT.md.

## 11. Reused Code Disclosure

src/metaClient.js adapted from the in-window Form Intelligence prototype
at C:\Repo\workcadence-meta-hackathon\src\metaClient.js (same author,
same Oct 26-Nov 4 window). Only the generic HTTPS transport, budget
and retry contract, and diagnostics are shared; no product logic was
reused. See NEW_WORK.md and docs/HACKATHON_DISCLOSURE.md.

## 12. Known Limitations and Future Work

Single invariant only; 10 cases not general; gate checks pillar presence
not <= vs < semantics; token reporting provider-dependent. Future:
additional vocabularies, stricter theorem checks, cost tracing.

## 13. Security

Never commit .env.local (see .gitignore). Rotate any exposed key via
the dashboard for the affected provider. The offline test guard is
application-level network protection activated by `npm test`; it is
not an OS-level network sandbox. See docs/SECURITY_AUDIT.md for
resolved versus open findings; remaining engineering findings are
still open and this app is not approved as a public multi-user
production service.

## License

MIT -- see LICENSE. Attributions in THIRD_PARTY_NOTICES.md.
