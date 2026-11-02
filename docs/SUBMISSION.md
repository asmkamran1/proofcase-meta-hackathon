# Submission Form -- Draft (copy-ready)

For Meta Global AI Developer Hackathon 2026 -- Indie Developer Track.
Use verified facts only; do not invent URLs. Replace PLACEHOLDERS after
publication.

## Team Name

ProofCase -- Solo Indie Developer (use registered hackathon handle if required)

## Track

Indie Developer Track

## Problem Statement: Build for Your World

Your world runs on natural-language rules: "Total accepted refunds cannot
exceed captured payment" is easy to write and hard to reliably test.
Manual translation is slow and ambiguous; model help is untrusted without
audit. ProofCase makes the loop explicit: requirement -> Muse Spark
interpretation -> validated, human-approved, deterministically executed
evidence, bounded and reproducible. Ambiguous or out-of-scope requirements
are refused rather than hallucinated.

## Project Description

ProofCase turns one refund invariant into a validated, human-approved,
executable test sequence exposing a seeded defect.

Input: one sentence + bounded catalog (4 ops, 8 steps, cents bounds) sent
to Muse Spark Open via Baseten. Output: STRICT JSON with interpretedRule
and 7-step ops. The app validates structurally, checks the bounded
4-pillar semantic gate (cumulative, accepted, per-order, captured;
reversed/strict/equality/vague-cap rejected) and plan shape, requires
explicit human click (Approve & Run) plus server-issued HMAC execution
authorization (per-instance key, 15-minute TTL; binds requirement +
normalized plan + provenance + modelId -- not human identity login),
then executes side-by-side:
buggy variant accepts $40 + $70 vs $100 captured ($110 violation);
corrected rejects excess. Charts, banner, JSON report.

10 synthetic cases (6 supported, 2 ambiguous, 2 unsupported) form frozen
evaluation; Sprint 3.1 added safety gating, bounded retry, corrected
metrics (exact vs safe-abstention vs providerError) with archived history.
Defects are seeded fictional.

New work Oct 26 -- Nov 4; only Baseten transport adapted from companion
prototype (disclosed).

## Public GitHub Repository

https://github.com/asmkamran1/proofcase-meta-hackathon

Standalone, MIT, zero prod dependencies, live + recorded documented.
H1/H2/H3 review changes are local until pushed via docs/PUBLICATION.md.

## Three-Minute Demo Video

PLACEHOLDER -- do not invent URL.

See docs/DEMO_SCRIPT.md: title (0:00), requirement (0:20), Muse Spark
interpretation recorded 2026-10-29 primary + live optional (0:45),
sequence (1:15), approval (1:35), buggy $110 vs corrected (1:55),
export (2:25), safety (2:40), closing + disclosure (2:55). Labels:
RECORDED vs LIVE on screen; seeded defect disclaimer. Upload unlisted
to YouTube.

## Meta Products Used

- Meta Muse Spark Open -- meta-models/muse-spark-open-1026 (all plan
  generation via Baseten provider).
- Baseten Inference Platform as provider (server-side HTTPS only).

No other Meta products.

## Why Meta Models Matter

Without Muse Spark, ProofCase has no generation -- interpretedRule and
exceed-cap scenario (create $100, accept $40, reject $70) are model
outputs, not templates. Model preserves cumulative invariant across
paraphrases and selects only allowlisted ops. Reasoning/truncation is
handled via bounded retry; _diag preserved for audit.

## Meta Product Feedback

Strong at cumulative paraphrase + exceed-cap within tight allowlist.
Two frictions (both handled Sprint 3.1): truncation at 4096 for two
paraphrases requiring retry with ~2x budget capped 16384 (max 2);
occasional wrapped op shape requiring alias/wrapper normalizer. Schema
mode from provider would reduce glue. 10 cases narrow, not general claim.

## Baseten Partner Feedback

Baseten's OpenAI-compatible endpoint was simple with clear errors.
Reasoning tokens toward budget was initially opaque -- empty content
with length needed project heuristic. Once handled, reliable for capped
10-case runs. Suggest: consistent token surfacing + retry guidance for
Muse Spark-class models in docs.

## Checklist Before Submitting

- [ ] Video link pasted above (unlisted YouTube); repo link verified live.
- [ ] H1/H2/H3 local changes reviewed, committed, and pushed (no force-push).
- [ ] Label recordedResponse.json matches video caption.
- [ ] Label recordedResponse.json matches video caption.
- [ ] Re-run docs/VERIFICATION.md checklist.
- [ ] Do not commit .env.local; .gitignore covers it.
