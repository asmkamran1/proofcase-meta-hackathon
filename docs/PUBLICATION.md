# Manual GitHub Publication -- Step by Step

> Do not commit, push, or publish automatically. All steps require your
> action. Stop if any verification fails.
>
> IMPORTANT: this repository is ALREADY initialized and published:
> remote `origin` is https://github.com/asmkamran1/proofcase-meta-hackathon
> at base commit `2879d70` (later work continued to the current HEAD; verify with git log). Do NOT run `git init`, `git remote add`,
> or any command that deletes/recreates the repository. The steps below
> review, stage, commit, and push incremental documentation changes only.
> No force-push.

## Preconditions

- Deadline: Nov 4, 2026 9 PM ET.
- You have rotated any exposed API key for the affected provider (see SECURITY_AUDIT.md).
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
git status --short   # review: expect documentation files only; src/, public/, scripts/, test/, package.json, and .gitignore must be unchanged
git diff --stat
# Confirm .env.local is NOT staged; confirm no key material in diff:
git diff -- docs README.md NEW_WORK.md
git add docs README.md NEW_WORK.md
git status   # review -- .env.local and node_modules must NOT be staged
git commit -m "D1: documentation consistency cleanup only (no code changes)"
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
  (live; local documentation changes still to push manually via Section 3-4 above.
  Use the actual current commit/branch only where relevant.)
- Demo Video: PLACEHOLDER until you supply the actual video link
  (unlisted YouTube per docs/DEMO_SCRIPT.md; never invent a video URL)
- Meta Products Used, Why Meta Models Matter, feedback fields

Do not invent URLs; only paste real ones after steps 4-5 and video upload.
Do not claim the project has already been submitted until the form is
actually filed. Normal commits and pushes are manual user actions.

## 7. Do Not

- Do not push .env.local, node_modules, or private Work Cadence code.
- Do not upload the video as public before checking audio/labels.
- Do not submit the hackathon entry until verification checklist in docs/VERIFICATION.md passes.
- Do not create a new repository, run `git init` again, replace the
  remote, force-push, rewrite Git history, or overwrite local secrets.
- Do not commit, push, deploy, or submit automatically from an agent run.
