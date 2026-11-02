# Demo Video Script -- ProofCase 3-Minute Demonstration

Exact narration, UI actions, and recording checklist for the required
3-minute demo. Prioritizes requirement, Meta interpretation, approval,
buggy vs corrected, evidence export, and safety behavior.

## Constraints

- Duration: 180 seconds (hard stop 185s).
- Resolution: 1920x1080, Chrome, 100-110% zoom, maximized, bookmarks off.
- Label live vs recorded on screen. RECORDED is primary; LIVE is optional.
- Backup procedure at end.

## Labels Required

- RECORDED: "RECORDED Muse Spark response 2026-10-29" (amber badge + caption)
- LIVE: "LIVE Muse Spark via Baseten -- date" (green badge + caption)
- At least once: "Seeded fictional defect -- not production"
- Closing: "New work Oct 26 -- Nov 4, 2026"

## Browser Prep

1. Copy only if absent; never overwrite: if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local } and set BASETEN_API_KEY if doing live.
2. node --env-file=.env.local src/server.js -- open http://localhost:8080 (loopback only).
3. Refresh, confirm default requirement visible.
4. Have recordedResponse.json tab ready as backup.
5. Do Not Disturb on, mic tested.

## Timestamped Script

### 0:00-0:20 -- Title and Problem (20s)

Show: header "ProofCase -- Refund Invariant Demo with Muse Spark Open".

Narrate: "Business requirements live in natural language. ProofCase shows
how Meta Muse Spark Open turns one refund rule into a validated, human-
approved test sequence that exposes a seeded defect -- without executing
arbitrary model code."

Action: no clicks, hold title.

### 0:20-0:45 -- Requirement (25s)

Show: Section 1 textarea highlighted.

Narrate: "One sentence: Total accepted refunds cannot exceed captured
payment. Bounded catalog: four operations, eight steps max, cents values.
No bug hints are ever sent."

Action: hover textarea, hover /api/config badge model name.

### 0:45-1:15 -- Meta Interpretation (30s)

Show: click Use Recorded Response (primary).

Narrate (RECORDED): "Recorded Muse Spark response from October 29,
preserved verbatim. Restates: The sum of all accepted refunds must never
exceed captured payment. Proposes seven steps."

Action: click Use Recorded, wait for interpretationBox + planBox + timeline.
Read interpretedRule. Point to numbered timeline.
Ensure badge shows RECORDED META RESPONSE amber.
Caption: RECORDED -- same validation as live.

LIVE alternative (optional 15s): click Interpret with Meta, show LIVE green.
If it errors, say so and cut -- no fabrication.

### 1:15-1:35 -- Test Sequence (20s)

Show: numbered timeline + collapsed raw plan.

Narrate: "Creates order with $100 captured, accepts $40 refund, asserts
total, requests $70 second refund exceeding cap, expects rejection."

Action: read 7 steps from timeline. Optionally expand raw plan 1s.

Steps:
1. Create order-1 $100 captured.
2. Request $40 r1.
3. Verify r1 accepted.
4. Verify total $40.
5. Request $70 r2.
6. Verify r2 rejected.
7. Verify total $40.

### 1:35-1:55 -- Human Approval (20s)

Show: approvalHint + Approve & Run.

Narrate: "Nothing executes until a human clicks Approve & Run. The
server issues an HMAC execution authorization bound to the exact
requirement, normalized plan, and recorded/live provenance after the
semantic gate passes. Changing a word invalidates it; authorization
expires after 15 minutes. This authorizes one local run -- it does
not authenticate a human identity."

Action: hover approvalHint, click Approve & Run, show Running.

### 1:55-2:25 -- Buggy vs Corrected (30s)

Show: Section 2 side-by-side + invariant banner.

Narrate: "Buggy accepts both refunds -- $110 against $100, violation.
Corrected rejects second refund, total stays $40, no violation."

Action: point buggyChart over-bar red, read banner step, point correctChart.
Scroll traces if time.

### 2:25-2:40 -- Evidence and Export (15s)

Show: Download JSON Report.

Narrate: "Every run produces JSON with requirement, interpreted rule,
plan, both traces, timestamps. Downloadable here."

Action: click Download, show proofcase-report.json in download bar.

### 2:40-2:55 -- Safety Behavior (15s)

Show: change requirement or still of gate response.

Narrate: "If ambiguous like 'Refunds should not be too large', the
semantic gate blocks it. Needs cumulative, accepted, per-order, captured
before any execution."

Action: type "Refunds should not be too large.", click Interpret,
show NEEDS_INPUT with pillars missing, unverified, no Approve button.
Or show docs/human-review.md AMB-01 row as still.

### 2:55-3:00 -- Closing (5s)

Show: footer.

Narrate: "ProofCase. Fictional defect, real Meta inference. New work
Oct 26 through Nov 4, transport adapted with disclosure."

Stop at 3:00.

## Recording Checklist

- [ ] 100-110% zoom, maximized, bookmarks off, DND on.
- [ ] http://localhost:8080 default requirement visible.
- [ ] RECORDED badge will show; LIVE green if used.
- [ ] Timeline readable at 1080p.
- [ ] Download works.
- [ ] Ambiguous still ready.
- [ ] Timer off-camera (phone stopwatch).
- [ ] Re-watch for audio + labels.

## Labeling Rules

- Every model output must carry visible LIVE or RECORDED label.
- Never present RECORDED as live; never fabricate live results.
- If live fails on camera, narrate error correctly.

## Backup Procedure

1. Fall back to RECORDED only (no network needed).
2. If UI fails: terminal -- node scripts/runFeasibility.js, cat MODEL_RUN.md, node --test test/
3. If recorder fails: phone capture fallback, re-record later.
4. Keep evaluation-report.json and MODEL_RUN.md as secondary tabs.

## Do Not Show

- .env.local, API keys, env exports with key.
- Claims of general reliability or production discovery.
- Private Work Cadence data.
