# Security and Publication Audit -- Sprint 4 (2026-11-01)

> Task A -- Repository Audit findings for the standalone
> `C:\Repo\proofcase-meta-hackathon` submission. No private Work Cadence
> repository was accessed. No historical evidence was deleted.

## 1. Secret Exposure -- CRITICAL

- **[CRITICAL] `.env.local` present on disk with a real Baseten API key**
  at `C:\Repo\proofcase-meta-hackathon\.env.local` containing
  `BASETEN_API_KEY=b10_...` (long-lived, still valid at time of audit).
  File is matched by `.gitignore` but exists on disk; if a git repo is
  initialized and `git add .` is used without noticing, a future force-add
  (`-f`) or a `.gitignore` regression could publish it.
  **Action required before publication:** rotate the key in the Baseten
  dashboard, remove the old key from `.env.local`, and re-create the file
  locally only from `.env.example` on contributor machines. Never commit,
  print, or paste the key. The audit does not reproduce the full value.
- **Verification:** `Select-String -Pattern b10_` over `docs/*`, `src/*`,
  `public/*`, `fixtures/*` returned no matches -- no key leaked into
  generated reports, fixtures, or code.
- **`.env.example` is clean:** contains `BASETEN_API_KEY=` empty value
  plus commented guidance; safe to publish.
- **Provider hints truncated:** `metaClient.js` and `planner.js` truncate
  provider error messages to 200 chars on 4xx/5xx and never include the
  key or prompt.

## 2. .gitignore Coverage

- **Before fix:** file began with a corrupted first line `.gitignore` and
  covered only `.env.local` and `node_modules/`.
- **After fix (Sprint 4):** expanded to cover `.env.local`, `.env`,
  `.env.*.local`, `*.pem`, `*.key`, `node_modules/`, `*.log`, `.tmp/`,
  `temp/`, `.DS_Store`, `Thumbs.db`, `.vscode/`, `.idea/`, `*.swp`.
  Verified as plain UTF-8.
- **Recommendation:** after `git init`, run `git check-ignore -v .env.local`
  to confirm ignored.

## 3. Environment File Handling

- `src/server.js:loadEnv()` and `scripts/runFeasibility.js:loadEnv()`
  both read `.env.local` then `.env` with `if (!(k in process.env))` --
  env already set externally takes precedence. Correct for Baseten key
  injection in hosted demos.
- `scripts/evaluate.mjs` relies on `process.env` only; it does not load
  `.env.local` itself -- live mode requires external env setup. Documented
  in `docs/EVALUATION.md` and `docs/VERIFICATION.md`.
- No key is ever rendered to `/api/config` (only `hasKey: !!apiKey`) or
  to client-side JS.

## 4. Private Code or Project References

- **No private commercial code present.** `src/metaClient.js` header states
  adaptation from the in-window hackathon prototype
  `C:\Repo\workcadence-meta-hackathon\src\metaClient.js` (same author,
  same window). That file was inspected: it shares transport/retry only;
  no Work Cadence tenant logic, DB schemas, or ATS routing is present.
- **Absolute path in disclosure:** `HACKATHON_DISCLOSURE.md` previously
  contained `C:\Repo\workcadence-meta-hackathon` -- acceptable as local
  provenance for a solo author; for public GitHub, it is documented as a
  companion hackathon prototype path that will not exist on reviewers'
  machines. No secret leaked.
- **No private repo access:** audit was limited to `proofcase-meta-hackathon`.

## 5. Temporary Files and Logs

- No `node_modules/`, `dist/`, `build/`, `.DS_Store`, `*.log`, or `*.tmp`
  files found. Repository is small (< 100 KB excluding archive reports).
- `docs/archive/` contains two timestamped live reports (~20 KB each) --
  intentionally preserved per Sprint 3.1 "never overwrite" rule. Not temp
  files; kept as evidence.

## 6. Large Unnecessary Artifacts

- No large artifacts. Largest files are JSON reports. No bundled model
  weights, no `package-lock.json` bloat beyond minimal (no prod deps).
- `package.json` has zero dependencies; `npm install` is near-instant.

## 7. Generated Evaluation Reports for Sensitive Data

- `docs/evaluation-report.json` (dry-run mock) -- no secrets.
- `docs/archive/evaluation-report.live-*.json` -- contain `_diag` with
  `modelId`, `finishReason`, `hasContent` but no key, email, or PII.
- `docs/MODEL_RUN.md` and `docs/recordedResponse.json` -- fictional order
  `order-1` and refund `r1/r2` only; no user data.
- `docs/human-review.md/.json` -- synthetic case IDs only.

## 8. Dependency Licenses and Attribution

- Zero production npm dependencies; `engines: node >=20` only.
- Node built-ins (`node:http`, `fs`, `path`, `url`, `crypto`, `test`) are MIT.
- Model via Baseten: no weights bundled; attribution in THIRD_PARTY_NOTICES.md.
- `THIRD_PARTY_NOTICES.md` (new Sprint 4) and `LICENSE` (MIT) added.

## 9. New-Work Provenance

- Documented in `NEW_WORK.md` (new Sprint 4) and `docs/HACKATHON_DISCLOSURE.md`
  (updated Sprint 4) with file-level table, window Oct 26 -- Nov 4, and
  explicit reused-vs-new distinction.
- Evaluation fixtures `fixtures/evaluation.json` carry `createdAt` and
  `disclaimer: Ten synthetic cases are NOT a general benchmark`.

## 10. Remaining Actions Before Publication

1. **Rotate the Baseten API key** (critical) and delete the old value from
   disk; new value only in local `.env.local`.
2. `git init` in `proofcase-meta-hackathon` (it is not yet a git repo;
   `C:\Repo` is not a git repo either) -- see `docs/PUBLICATION.md`.
3. `git add` only tracked sources; verify `git status` does not list
   `.env.local`.
4. Push to a new public GitHub repo; confirm no secrets via GitHub secret
   scanning after push.
5. Publish unlisted YouTube demo video with required labels; add link to
   submission form.

## 11. Audit Command Used

See `docs/VERIFICATION.md` for the secret-scan PowerShell one-liners.
