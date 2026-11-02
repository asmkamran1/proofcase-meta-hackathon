# Final Verification Checklist -- PowerShell Commands

> Run only targeted checks; do not push or submit automatically.
> All commands assume PowerShell from C:\Repo\proofcase-meta-hackathon.

## 0. Location and Node

```powershell
cd C:\Repo\proofcase-meta-hackathon
node --version   # >=20
npm --version
```

## 1. Full Test Suite (111 tests, all green per 2026-11-02 H3 run)

```powershell
node --test test/
# expect: 111/111 pass, 0 fail, 0 skipped, 0 cancelled.
# Breakdown: approval-security 18, evaluation 10, executor 4,
# hardening-regression (H3) 5, http-security 16, planner 3,
# recorded-gate 16, refundService 2, sprint2 11, sprint3.1 14,
# timeline 8, validator 4.
# Reconciles the prior H2 "93/106" inconsistency: that report mixed
# file subtotals and omitted the evaluator/planner/executor/validator/
# refundService/timeline/sprint2/sprint3.1 files. Full-suite evidence is 111.
```

## 2. Syntax and Package Checks

```powershell
# syntax (skip node --check on JSX -- none here; server uses plain JS)
Get-ChildItem src\*.js,scripts\*.mjs | ForEach-Object { node --check $_.FullName; if($LASTEXITCODE -ne 0){ Write-Error "syntax fail $($_.Name)" } }

# package sanity
Get-Content package.json | ConvertFrom-Json | Format-List
npm list 2>&1       # expect empty (zero prod dependencies)
npm run test 2>&1   # alias for node --test test/
```

## 3. Clean Install

```powershell
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
npm install
# or: npm ci  (with lockfile if present)
Get-ChildItem node_modules -ErrorAction SilentlyContinue | Measure-Object
# expect 0 or minimal (no prod deps)
```

## 4. Git Status and History (Repository Already Initialized)

```powershell
git status --short
git status --ignored
git log --oneline -5        # expect base 2879d70 plus H1/H2/H3 review work
git log --stat -1
git remote -v               # expect origin https://github.com/asmkamran1/proofcase-meta-hackathon.git
git check-ignore -v .env.local
```

## 5. Secret Scan

```powershell
# No full key should appear in tracked sources.
# Known benign matches ONLY: scan patterns/disclosure notes mentioning the
# "b10_" prefix in SECURITY_AUDIT.md / VERIFICATION.md / PUBLICATION.md.
Select-String -Path src\*,public\*,fixtures\*,docs\*.json,docs\*.md -Pattern "b10_" | Format-Table Path,LineNumber,Line
# Confirm each match is a pattern/disclosure note, never a full key value.

# Heuristic: search for key assignment with value
Select-String -Path .env.example,src\*,public\*,docs\* -Pattern "BASETEN_API_KEY" | Format-Table Path,Line

# Confirm .env.local is ignored (before publication)
git check-ignore -v .env.local
Select-String -Path .env.local -Pattern "BASETEN_API_KEY" -ErrorAction SilentlyContinue | ForEach-Object { Write-Warning "Key present on disk -- rotate before publication; never paste value" }
```

## 6. Local Application Startup

```powershell
# Requires .env.local with BASETEN_API_KEY for live; recorded needs no key.
# Create .env.local ONLY if absent; never overwrite it:
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
# set BASETEN_API_KEY in .env.local if testing live (never print it)

node --env-file=.env.local src/server.js
# open another terminal:
Invoke-RestMethod http://localhost:8080/api/config | Format-List
Invoke-RestMethod http://localhost:8080/api/recorded | ConvertTo-Json -Depth 10 | Out-String | Select-Object -First 40
# Ctrl+C to stop
```

## 7. Recorded Replay (offline, no cost)

```powershell
# From browser: Use Recorded Response -> Approve & Run -> Download JSON
# From terminal: validate recorded plan directly
node -e "import fs from 'node:fs'; import {validateTestPlan,normalizePlan} from './src/testPlanValidator.js'; const r=JSON.parse(fs.readFileSync('docs/recordedResponse.json','utf8')); console.log(validateTestPlan(normalizePlan(r.plan)));"
```

## 8. Optional Live Inference

```powershell
# Paid; capped 20 requests; requires BASETEN_API_KEY
node scripts/runFeasibility.js            # single canonical requirement, writes docs/MODEL_RUN.md
node scripts/evaluate.mjs --live          # 10-case suite, archives prior live to docs/archive/
node scripts/evaluate.mjs --live --verbose
# Inspect result:
Get-Content docs\evaluation-report.json -Head 80
Get-Content docs\evaluation-report.md.fragment
```

## 9. Publication (manual only)

See docs/PUBLICATION.md for git init, secret re-scan, add/commit, remote,
push, and tag steps. Do not run push commands unless you have completed
secret rotation and local verification above.
