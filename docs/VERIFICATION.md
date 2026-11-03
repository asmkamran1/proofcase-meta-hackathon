# Final Verification Checklist -- PowerShell Commands

> Run only targeted checks; do not push or submit automatically.
> All commands assume PowerShell from C:\Repo\proofcase-meta-hackathon.
> Documentation changes only: no code, test, package, secret, or recorded-evidence edits.

## 0. Location and Node

```powershell
cd C:\Repo\proofcase-meta-hackathon
node --version   # >=20
npm --version
```

## 1. Full Test Suite (151 tests, all green per 2026-11-03 M1.1 run)

```powershell
npm test
# expect: 151/151 pass, 0 fail, 0 skipped, 0 cancelled.
# Command enumerates every test file with the guard preloaded:
# node --import ./test/helpers/offline-guard.js --test <15 files>
# (explicit file list because PowerShell does not expand test/*.test.js
# and bare `test/` also picked up the helper as a phantom entry).
# The --import preloads test/helpers/offline-guard.js, which throws
# OFFLINE_GUARD_BLOCKED on any non-loopback fetch/http/dns provider call
# while allowing 127.0.0.1 loopback test servers. This is
# application-level protection, not an OS-level network sandbox.
# Manually running alternate Node test commands without the guard may
# bypass that protection.
# Breakdown: approval-security 18, evaluation 10, executor 4,
# hardening-regression (H3) 5, http-security 16, meta-provider 26,
# offline-guard 4, planner 3, provider-config 10, recorded-gate 16,
# refundService 2, sprint2 11, sprint3.1 14, timeline 8, validator 4.
# Prior H3 baseline was 111; M1 added 36 provider tests (26 meta-provider
# + 10 provider-config) and M1.1 added 4 offline-guard tests.
# 111 + 36 + 4 = 151. The http-security rate-limit test was repaired in
# place (still 16 in that file) to use an injected mock and assert
# 10x200 + recorded replay + 1x429 with mock-call accounting.
# Suite completes in ~1s offline; any live provider call throws
# OFFLINE_GUARD_BLOCKED and fails instead of spending credits.
# These 151 tests are software-regression evidence, not 151 successful
# AI-generated plans. No CI execution is claimed.
```

## 2. Syntax and Package Checks

```powershell
# syntax (skip node --check on JSX -- none here; server uses plain JS)
Get-ChildItem src\*.js,scripts\*.mjs | ForEach-Object { node --check $_.FullName; if($LASTEXITCODE -ne 0){ Write-Error "syntax fail $($_.Name)" } }

# package sanity
Get-Content package.json | ConvertFrom-Json | Format-List
npm list 2>&1       # expect empty (zero prod dependencies)
npm test 2>&1       # guarded command; do NOT use bare node --test test/ as the normal command
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
# Recorded replay needs no key. Live mode needs the key for the selected provider.
# Create .env.local ONLY if absent; never overwrite it:
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
# set MODEL_API_KEY for META default, or BASETEN_API_KEY with MODEL_PROVIDER=BASETEN for legacy Baseten (never print it)

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
# Paid; capped 20 requests; requires selected provider key
# (MODEL_API_KEY for META default; BASETEN_API_KEY with MODEL_PROVIDER=BASETEN)
# No live calls were made during the M1/M1.1 migration; default evaluation stays offline.
node --env-file=.env.local scripts/runFeasibility.js  # single canonical requirement; paid live run (writes docs/MODEL_RUN.md only when run)
node --env-file=.env.local scripts/evaluate.mjs --live  # 10-case suite, archives prior live to docs/archive/
node --env-file=.env.local scripts/evaluate.mjs --live --verbose
# Inspect result:
Get-Content docs\evaluation-report.json -Head 80
Get-Content docs\evaluation-report.md.fragment
```

## 9. Publication (manual only)

See docs/PUBLICATION.md for secret re-scan and manual add/commit, without git init/remote replacement,
push, and tag steps. Do not run push commands unless you have completed
secret rotation and local verification above.
