# Manual GitHub Publication -- Step by Step

> Do not commit, push, or publish automatically. All steps require your
> action. Stop if any verification fails.

## Preconditions

- Deadline: Nov 4, 2026 9 PM ET.
- You have rotated the exposed Baseten API key (see SECURITY_AUDIT.md).
- You have created a public YouTube unlisted video per DEMO_SCRIPT.md.
- You have replaced SUBMISSION.md PLACEHOLDERS mentally (links added after).

## 1. Initialize Git in the Standalone Repo

```powershell
cd C:\Repo\proofcase-meta-hackathon
git init
git config user.name "Your Name"
git config user.email "you@example.com"
```

Verify .gitignore covers secrets:

```powershell
git check-ignore -v .env.local
# should print: .gitignore:2:.env.local  .env.local
```

## 2. Verify Secret Scan Passes

```powershell
Select-String -Path src\*,public\*,fixtures\*,docs\*.json,docs\*.md -Pattern "b10_|sk-|AKIA|ghp_|BASETEN_API_KEY\s*=\s*['\"\"]?\w+" | Format-Table Path,Line
# expect no output (no key in tracked files)

git status --ignored
# .env.local should appear under Ignored, not Staged
```

If .env.local appears as not ignored, stop and re-apply .gitignore.

## 3. Add and Commit Tracked Files

```powershell
git add .gitignore package.json README.md LICENSE THIRD_PARTY_NOTICES.md NEW_WORK.md fixtures docs public scripts src test
git status   # review -- .env.local and node_modules must NOT be staged
git log --oneline  # should be empty (first commit)
git commit -m "ProofCase: Meta Muse Spark refund invariant demo (Oct 26-Nov 4) -- submission"
git log --oneline --stat
git show --stat HEAD
```

## 4. Create and Push Public GitHub Repo

On github.com: New repository -> name `proofcase-meta-hackathon` -> Public -> no README/license/gitignore (we already have them) -> Create.

```powershell
git remote add origin https://github.com/YOUR_USERNAME/proofcase-meta-hackathon.git
git branch -M main
git push -u origin main
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
- Public GitHub Repository: https://github.com/YOUR_USERNAME/proofcase-meta-hackathon
- Demo Video: https://www.youtube.com/watch?v=YOUR_VIDEO_ID (unlisted)
- Meta Products Used, Why Meta Models Matter, feedback fields

Do not invent URLs; only paste real ones after steps 4-5 and video upload.

## 7. Do Not

- Do not push .env.local, node_modules, or private Work Cadence code.
- Do not upload the video as public before checking audio/labels.
- Do not submit the hackathon entry until verification checklist in docs/VERIFICATION.md passes.
