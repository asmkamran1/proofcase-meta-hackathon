# Manual GitHub Publication -- Step by Step

> Do not commit, push, or publish automatically. All steps require your
> action. Stop if any verification fails.
>
> IMPORTANT: this repository is ALREADY initialized and published:
> remote `origin` is https://github.com/asmkamran1/proofcase-meta-hackathon
> at base commit `2879d70`. Do NOT run `git init`, `git remote add`,
> or any command that deletes/recreates the repository. The steps below
> review, stage, commit, and push incremental H1/H2/H3 changes only.
> No force-push.

## Preconditions

- Deadline: Nov 4, 2026 9 PM ET.
- You have rotated the exposed Baseten API key (see SECURITY_AUDIT.md).
- You have created a public YouTube unlisted video per DEMO_SCRIPT.md.
- You have replaced SUBMISSION.md PLACEHOLDERS mentally (links added after).

## 1. Review Existing Repository State (Do NOT Re-initialize)

```powershell
cd C:\Repo\proofcase-meta-hackathon
git status --short
git log --oneline -5        # expect base 2879d70 plus prior work
git remote -v               # expect origin https://github.com/asmkamran1/proofcase-meta-hackathon.git
git check-ignore -v .env.local
# should print: .gitignore:2:.env.local  .env.local
```

## 2. Verify Secret Scan Passes

```powershell
Select-String -Path src\*,public\*,fixtures\*,docs\*.json,docs\*.md -Pattern "b10_|sk-|AKIA|ghp_|BASETEN_API_KEY\s*=\s*['\"\"]?\w+" | Format-Table Path,Line
# Known benign matches ONLY (scan patterns and disclosure notes, not key values):

git status --ignored
# .env.local should appear under Ignored, not Staged
```

If .env.local appears as not ignored, stop and re-apply .gitignore.

## 3. Stage, Commit, and Push Incremental Changes

```powershell
git status --short   # review: expect H1/H2/H3 hardening files only
git diff --stat
# Confirm .env.local is NOT staged; confirm no key material in diff:
git diff -- docs src public test fixtures scripts
git add docs README.md NEW_WORK.md THIRD_PARTY_NOTICES.md public src test fixtures scripts package.json .gitignore
git status   # review -- .env.local and node_modules must NOT be staged
git commit -m "H3: hardening regression audit and release-doc corrections"
git log --oneline -5
git show --stat HEAD
```

## 4. Push to the Existing Public GitHub Repo

The repository already exists at
https://github.com/asmkamran1/proofcase-meta-hackathon
with `origin` already configured. Do NOT create a new repository and
do NOT run `git remote add` (it will fail because `origin` exists).

```powershell
git pull --rebase origin main
git push origin main
```

Verify on GitHub web: README renders, no .env.local visible, Actions secret scanning clean.

## 5. Tag Submission Commit

```powershell
git tag submission-v0.1.0
git push origin submission-v0.1.0
```

## 6. Submission Form

Copy entries from docs/SUBMISSION.md, replacing:

- Team Name, Indie Developer Track
- Problem Statement: Build for Your World
- Project Description
- Public GitHub Repository: https://github.com/asmkamran1/proofcase-meta-hackathon
  (live; H1/H2/H3 review-commit still to push via Section 3-4 above)
- Demo Video: https://www.youtube.com/watch?v=YOUR_VIDEO_ID (unlisted)
- Meta Products Used, Why Meta Models Matter, feedback fields

Do not invent URLs; only paste real ones after steps 4-5 and video upload.

## 7. Do Not

- Do not push .env.local, node_modules, or private Work Cadence code.
- Do not upload the video as public before checking audio/labels.
- Do not submit the hackathon entry until verification checklist in docs/VERIFICATION.md passes.
