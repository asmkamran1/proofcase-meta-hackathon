# Hackathon Disclosure

## Event

Meta Global AI Developer Hackathon 2026 -- Indie Developer Track.
Problem statement: Build for Your World.
Team: solo indie developer.
Project: ProofCase -- Refund Invariant Demo with Meta Muse Spark.
New live inference: Meta Model API, Muse Spark 1.3 (`muse-spark-1.3`).
Historical evidence: Muse Spark Open via Baseten
(`meta-models/muse-spark-open-1026`). No new paid evaluations were
performed during M1 migration; demo may run entirely offline in recorded mode.
Window: October 26 -- November 4, 2026.

## Provenance

- `src/metaClient.js` was adapted from the companion Form Intelligence
  prototype at `C:\Repo\workcadence-meta-hackathon\src\metaClient.js`,
  the Baseten Muse Spark Open client created fresh during the same
  hackathon window for the same model. It provides the generic HTTPS
  transport, budget/retry contract (4096 default, 8192 retry, 16384 max,
  2 attempts), truncation detection, and _diag plumbing. No private
  pre-hackathon Work Cadence product code was imported. Header in the
  file preserves provenance.

- All other files in this repository are newly created for ProofCase
  inside the Oct 26 -- Nov 4 window. See NEW_WORK.md for the full table.

- ProofCase and the companion Work Cadence/ Form Intelligence project are
  distinct hackathon prototypes by the same author, built in parallel,
  targeting different problems. The only shared artifact is the low-level
  transport in metaClient.js.

## Scope

One bounded QA demonstration for the refund-cap invariant:
sum(accepted refunds per order) <= capturedCents. The seeded defect is
fictional (buggy variant checks per-refund only; corrected checks
cumulative). Sprint 1 proved the core loop works with a real model;
Sprint 2 added browser approval and recorded replay; Sprint 3 added
10-case evaluation; Sprint 3.1 added safety gating and corrected metrics.

No UI redesign, no new models, no Playwright, no production integrations
in Sprint 4 -- documentation, audit, and submission readiness only.

## Safety and Limitations

- Fictional data only. No real payments, no production database, no
  external code execution. Deterministic in-memory fixtures only.
- Seeded defect is not a discovery in production software -- stated
  explicitly in README, evaluation docs, and video script.
- Ten synthetic evaluation cases are not a general benchmark.
- Evaluation labels established before any model call and never modified
  after seeing results; prior live reports archived, not overwritten.
- Ambiguous requirements are refused via bounded semantic gate, not
  hallucinated. The gate checks keyword eligibility only; it does not
  prove formal semantic equivalence. Double-negation and exotic
  paraphrases outside the documented vocabulary are unverified.
- Server-issued execution authorization is not human identity
  authentication. Loopback + Host/Origin checks do not authenticate
  arbitrary local processes.

## Licensing

Original code in this repo is MIT (see LICENSE). Companion project code
is separate and not distributed with this submission.

## Contact

For provenance questions, refer to git history of the companion repo and
to the archive docs/evaluation-report.live-*.json timestamps.
