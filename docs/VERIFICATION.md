# Final Verification Checklist -- PowerShell Commands

> Run only targeted checks; do not push or submit automatically.
> All commands assume PowerShell from C:\Repo\proofcase-meta-hackathon.

## 0. Location and Node

```powershell
cd C:\Repo\proofcase-meta-hackathon
node --version   # >=20
npm --version
```

## 1. Full Test Suite

```powershell
node --test test/
# expect: all suites green (validator, planner, executor, sprint2, evaluation, sprint3.1, timeline, refundService)
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

## 4. Git Status and History

```powershell
# Before init, expect: not a git repository
git status

# After init + commit (see docs/PUBLICATION.md):
git status --short
git status --ignored
git log --oneline -20
git log --stat -1
git check-ignore -v .env.local
```

## 5. Secret Scan

```powershell
# No key should appear in tracked sources
Select-String -Path src\*,public\*,fixtures\*,docs\*.json,docs\*.md -Pattern "b10_|sk-|AKIA|ghp_" | Format-Table Path,LineNumber,Line

# Heuristic: search for key assignment with value
Select-String -Path .env.example,src\*,public\*,docs\* -Pattern "BASETEN_API_KEY" | Format-Table Path,Line

# Confirm .env.local is ignored (before publication)
git check-ignore -v .env.local
Select-String -Path .env.local -Pattern "BASETEN_API_KEY" -ErrorAction SilentlyContinue | ForEach-Object { Write-Warning "Key present on disk -- rotate before publication; never paste value" }
```

## 6. Local Application Startup

```powershell
# Requires .env.local with BASETEN_API_KEY for live; recorded needs no key
Copy-Item .env.example .env.local -ErrorAction SilentlyContinue
# set BASETEN_API_KEY in .env.local if testing live

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
