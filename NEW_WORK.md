# NEW_WORK.md — What Was Built Oct 26 - Nov 4 for ProofCase

Required by the Meta Global AI Developer Hackathon 2026 to distinguish
new hackathon work from related prior work.

## Hackathon Window

October 26, 2026 00:00 UTC through November 4, 2026 21:00 ET.

All files in this standalone repo were created inside that window
unless noted as reused under disclosure.

## Summary

ProofCase is a narrow demo that a natural-language refund rule can be
turned by Meta Muse Spark Open into a validated, human-approved,
deterministically executable test sequence exposing a seeded cumulative-
refund defect in a fictional service. It adds a bounded invariant,
controlled vocabulary, fail-closed validation, side-by-side executor
(buggy vs corrected), human approval + semantic safety gating, and a
10-case evaluation with recorded evidence.

It does NOT claim to find bugs in production software — the defect is
seeded and fictional.

## Reused Code (Disclosed)

- `src/metaClient.js` — Baseten transport + budget/retry contract copied
  verbatim from the companion Form Intelligence prototype at
  `C:\Repo\workcadence-meta-hackathon\src\metaClient.js`, built in the same
  window for the same Muse Spark model. Only the generic HTTPS client,
  budget caps, truncation detection, and diagnostics are shared. No product
  logic reused. Header in file preserves provenance. See
  `docs/HACKATHON_DISCLOSURE.md`.

## New Files for ProofCase

- `src/catalog.js` — refund-cap catalog, bounds, BUSINESS_REQUIREMENT,
  catalogDescription() sent to the model.
- `src/planner.js` — buildRefundPrompt() (requirement + catalog only),
  JSON extraction, bounded retry wrapper from metaClient.
- `src/testPlanValidator.js` — allowlist validation: version, ruleId, ops,
  fields, bounds, refs, max 8, no eval. Includes wrapped-op unwrap and
  alias/conflict handling. Fails closed.
- `src/refundService.js` — fictional in-memory refund service with buggy
  (per-refund check only) and corrected (cumulative) variants.
- `src/executor.js` — deterministic switch on allowlisted ops only;
  requires approved===true; never evals model JS.
- `src/semanticGate.js` — (Sprint 3.1) 4-pillar gate: cumulative, accepted,
  per-order, captured. Checks requirement, interpretedRule, and plan
  exceed-cap shape. Enforced in server + evaluator.
- `src/approval.js` — (Sprint 2) SHA-256 approvalHash over requirement+plan
  and verifyApproval to invalidate stale tokens.
- `src/server.js` — (Sprint 2/3.1) Node http server: /api/config,
  /api/recorded, /api/interpret (gate + token), /api/run (re-gate +
  verify + dual execution + JSON report), static public/.
- `public/` — Minimal UI: requirement textarea, Interpret/Recorded,
  interpreted rule, sequential timeline, buggy vs corrected traces +
  invariant banner, currency formatting, approval hint, JSON export.
- `fixtures/evaluation.json` — (Sprint 3) 10 frozen cases: 6 supported
  paraphrases, 2 ambiguous (pillars missing), 2 unsupported (SLA, email).
  Labels set before any model call.
- `scripts/evaluate.mjs` — (Sprint 3/3.1) Offline-first evaluator: dry-run
  default, capped --live opt-in, accurate _diag.attempts, separate metrics
  (exact vs safe-abstention vs providerError), archive of prior live.
- `scripts/runFeasibility.js` — (Sprint 1) Feasibility runner: real Meta
  call -> validate -> approve -> dual execution -> docs/MODEL_RUN.md.
- `test/` (7 files) — validator, planner, refundService, executor,
  sprint2, evaluation, sprint3.1, timeline.
- `docs/MODEL_RUN.md` — verbatim model output + dual execution evidence.
- `docs/recordedResponse.json` — 7-op Muse Spark plan + _diag captured
  2026-10-29, served as reproducible recorded replay.
- `docs/EVALUATION.md` — methodology, vocabulary, dataset, metrics,
  retry findings, limitations.
- `docs/ARCHITECTURE.md` — flow, components, and safety.
- `docs/HACKATHON_DISCLOSURE.md` — event, provenance, scope, timeline.
- `docs/human-review.md/.json` — (Sprint 3.1) append-only human review log.
- `docs/SPRINT3.1-REPORT.md` — semantic safety root-cause and verification.
- `docs/archive/*.json` — timestamped prior live evaluation(s), preserved.
- `package.json`, `.env.example`, `.gitignore`, `README.md`, `LICENSE`,
  `THIRD_PARTY_NOTICES.md` — packaging (Sprint 4).

## Companion Project

Work Cadence / Form Intelligence at `C:\Repo\workcadence-meta-hackathon`
is a parallel hackathon entry by the same author, built in the same
window for a different problem (applicant form interpretation, ATS
routing). The only shared artifact is the low-level Baseten transport.
ProofCase's requirement, catalog, validator, refund service, executor,
gate, approval, evaluation dataset, and UI are all disjoint.

## No Private Commercial Code

No code from the private commercial Work Cadence repository outside the
hackathon prototype was copied. No proprietary credentials or tenant data
were accessed.
