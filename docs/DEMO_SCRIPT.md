# Demo Video Script -- ProofCase (about 2:30-2:45, solo recording)

Use plain English, short sentences, and a natural speaking pace. This
script is for one developer recording a screen with AI-generated
narration. No camera appearance is needed. No paid inference is needed:
the default path uses recorded replay.

Total target: about 2 minutes 30 seconds to 2 minutes 45 seconds.
Read at a calm pace. Pause briefly between scenes.

## Constraints

- Resolution: 1920x1080, Chrome, 100-110% zoom, maximized, bookmarks off.
- Label live versus recorded on screen. RECORDED is primary; LIVE is optional.
- Never describe recorded output as live inference.
- Backup procedure at end.


## Labels Required

- RECORDED: "RECORDED Muse Spark Open response via Baseten, 2026-10-29" (amber badge + caption)
- LIVE, only if actually used: "LIVE Muse Spark response, date shown on screen" (green badge + caption; name the selected provider)
- At least once: "Seeded fictional defect -- not production"
- Closing: "New work Oct 26 -- Nov 4, 2026"

## Browser Prep

1. Copy only if absent; never overwrite: if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }. Recorded replay needs no key.
2. node --env-file=.env.local src/server.js -- open http://localhost:8080 (loopback only).
3. Refresh, confirm default requirement visible.
4. Have recordedResponse.json tab ready as backup.
5. Do Not Disturb on, mic tested (or narration track ready).

## Timestamped Script

### 0:00-0:20 -- Title and Problem (20s)

Show: header "ProofCase -- AI-Powered Refund Rule Testing with Meta Muse Spark".

Narrate: "Refund rules live in plain English. Testing them by hand is slow. ProofCase shows how Meta Muse Spark turns one refund rule into a checked test. The defect here is seeded. It is fictional."

Action: no clicks, hold title.

### 0:20-0:45 -- Requirement (25s)

Show: Section 1 textarea highlighted.

Narrate: "Our rule is simple. Total accepted refunds cannot exceed captured payment. The app sends only this rule plus a small catalog. Four actions. Eight steps max. No bug hints are sent."

Action: hover textarea, hover /api/config badge model name.

### 0:45-1:10 -- What the Model Contributes (25s)

Show: click Use Recorded Response (primary).

Narrate: "This is a previously captured Muse Spark Open response via Baseten. It restates the rule in its own words. It proposes seven steps. This is recorded replay. It is free. It is not live inference."

Action: click Use Recorded, wait for interpretationBox + planBox + timeline.
Read interpretedRule. Point to numbered timeline.
Ensure badge shows RECORDED META RESPONSE amber.
Caption: RECORDED -- same validation as live.

LIVE is optional and not needed for this demo. If shown, label the provider and date, and narrate any error honestly.

### 1:10-1:30 -- The Generated Test Plan (20s)

Show: numbered timeline + collapsed raw plan.

Narrate: "The plan creates order one with one hundred dollars captured. It accepts a forty dollar refund. It checks the total. Then it requests a seventy dollar second refund. That exceeds the cap. The plan expects rejection."

Action: read 7 steps from timeline. Optionally expand raw plan 1s.

Steps:
1. Create order-1 $100 captured.
2. Request $40 r1.
3. Verify r1 accepted.
4. Verify total $40.
5. Request $70 r2.
6. Verify r2 rejected.
7. Verify total $40.

### 1:30-1:50 -- Why Validation and Approval Are Required (20s)

Show: approvalHint + Approve & Run.

Narrate: "Nothing runs yet. The app validates the plan first. Then it checks the wording. Then it needs your click. Approval authorizes one local run. It does not prove who you are."

Action: hover approvalHint, click Approve & Run, show Running.

### 1:50-2:15 -- Buggy Versus Corrected (25s)

Show: Section 2 side-by-side + invariant banner.

Narrate: "Now the same plan runs twice. The buggy service accepts both refunds. That is one hundred ten dollars against one hundred. It breaks the rule. The corrected service rejects the second refund. The total stays forty dollars."

Action: point buggyChart over-bar red, read banner step, point correctChart.
Scroll traces if time.

### 2:15-2:30 -- Downloadable Report (15s)

Show: Download JSON Report.

Narrate: "Every run produces a JSON report. It has the rule, the plan, both traces, and timestamps. You can download it here."

Action: click Download, show proofcase-report.json in download bar.

### 2:30-2:45 -- What Was Newly Built (15s)

Show: footer.

Narrate: "What is new? The bounded refund service. Validation and approval. Side-by-side runs. The recorded replay. And the ten-case evaluation. This demo used a recorded Muse Spark Open response. The defect is seeded and fictional."

## Recording Checklist

- [ ] 100-110% zoom, maximized, bookmarks off, DND on.
- [ ] http://localhost:8080 default requirement visible.
- [ ] RECORDED badge will show; LIVE green only if live inference is actually used.
- [ ] Timeline readable at 1080p.
- [ ] Download works.
- [ ] Timer off-camera (phone stopwatch).
- [ ] Re-watch for audio + labels.

## Labeling Rules

- Every model output must carry visible LIVE or RECORDED label.
- Never present RECORDED as live; never fabricate live results.
- If live fails on camera, narrate error correctly.

## Backup Procedure

1. Fall back to RECORDED only (no network needed).
2. If UI fails: terminal -- node scripts/runFeasibility.js (needs selected provider key for live), cat MODEL_RUN.md, npm test.
3. If recorder fails: phone capture fallback, re-record later.
4. Keep evaluation-report.json and MODEL_RUN.md as secondary tabs.

## Do Not Show

- .env.local, API keys, env exports with key.
- Claims of general reliability or production discovery.
- Private Work Cadence data.
