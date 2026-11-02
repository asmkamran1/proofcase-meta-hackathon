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

- Create `.env.local` ONLY when absent; never overwrite an existing
  file: `if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }`.
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

## 12. H1 Hardening -- Local HTTP Server (2026-11-01, FAIL-CLOSED)

H1 implements fail-closed hardening for the local-only server (`src/server.js`) via a clean factory (`createServer({port})`) bound strictly to `127.0.0.1` (no `0.0.0.0`/`::`/HOST override). Importing the module does not auto-listen; tests use ephemeral `port 0`.

**Network binding:** `DEFAULT_PORT 8080` preserved; `BIND_HOST 127.0.0.1`; `server.address()` verified in tests as IPv4 loopback only. Available at `http://localhost:8080` and `http://127.0.0.1:8080`.

**Host validation:** exact match against `localhost:<actual-port>` and `127.0.0.1:<actual-port>` (case-normalized). Rejects foreign domains, suffix tricks (`localhost.evil.com`), incorrect ports, malformed Host, duplicate Host (via `rawHeaders`), IPv6 (`[::1]`), DNS rebinding. No naive `split(":")`.

**Origin protection:** no wildcard CORS. POST requires valid `Origin` matching `http(s)://localhost|127.0.0.1:<actual-port>` (rejects `null`, malformed, foreign). Respects `Sec-Fetch-Site: cross-site` as 403. Missing Origin allowed for non-browser clients when Host passes. `text/plain`/`form-encoded` rejected with 415.

**OPTIONS:** 204 with `Allow: GET, POST, OPTIONS`, no `Access-Control-Allow-Origin`, no inference.

**Body safety:** 64 KiB limit (`MAX_BODY_BYTES`) enforced incrementally while streaming; `Content-Type` must be `application/json` (charset allowed); malformed `Content-Length` 400; oversized declared 413 before buffering; chunked oversized 413; malformed JSON 400 `INVALID_REQUEST`; oversized 413 `PAYLOAD_TOO_LARGE`; unsupported media 415; aborted connections handled via `close`/`error` without crash; double-response guarded via `writableEnded`; `req.destroy()` not assumed to deliver 413 -- bounded drain (`MAX_DRAIN_BYTES`) with `resume()` then limited destroy; receive timeout 15s with 408 where writable; global timeouts: `headersTimeout 10s`, `requestTimeout 0` (disabled to preserve live inference), `keepAliveTimeout 5s`.

**Static files:** only `public/` with Windows-safe handling. Rejects malformed encoding (400), NUL, traversal (`..`), backslashes (`\`, `%5c`, `%2f`), double-encoding (`%25`), drive prefixes (`C:`/`|`), dotfiles, sensitive exts (allow only `.html/.css/.js`), sibling prefix collisions via `path.relative`, and symlink escape via `realpathSync` containment against `PUBLIC_REAL`. No exclusive reliance on `URL.pathname`. Serves `/`, `/index.html`, `/app.js`, `/style.css` with correct MIME and `X-Content-Type-Options: nosniff`.

**Routing:** exact pathname matching via `new URL(...).pathname`, query strings ignored. Preserves `GET /api/config`, `GET /api/recorded`, `POST /api/interpret`, `POST /api/run`; unknown 404, unsupported method 405, no unexpected route invokes paid inference.

**Paid-inference protection:** origin/host before inference; in-memory rate limit (`LIVE_INFERENCE_LIMIT 10` per 60s, per-IP, lazy prune at >100 entries, no timers, injectable clock via `Date.now()` param) applied only after security and only for live inference (recorded replay not counted); 429 `RATE_LIMITED`.

**Tests:** `test/http-security.test.js` exercises real HTTP on ephemeral port (no mocks), covering positive/negative cases, 413 observable (not socket reset), abort handling, symlink attempt, and compatibility of recorded 7-op plan ($100 captured, $110 buggy, $40 correct).

**Remaining local-process limitation:** same-machine processes can still reach `127.0.0.1:8080`; origin/host checks do not authenticate arbitrary local processes.

**Verification:** `node --check src/server.js` and `node --test test/http-security.test.js` (16/16 pass) plus targeted `validator/sprint2/executor/timeline` (27/27 pass).

## 13. H3 Audit Evidence (2026-11-02)

H1 and H2 were verified against actual code and live test runs:

- `test/http-security.test.js`: 16/16 pass (real HTTP on ephemeral
  port; loopback bind, same-origin POST, Host/Origin/rate-limit
  boundary, 64-KiB limit with observable 413, traversal/symlink
  fail-closed).
- `test/approval-security.test.js`: 18/18 pass (server-issued HMAC
  tokens; requirement/plan mismatch, expiry, cross-instance,
  malformed, legacy unsigned hash rejection, provenance trust).
- `test/recorded-gate.test.js`: 16/16 pass (all 6 supported eligible;
  both ambiguous and both unsupported blocked; reversed/strict/
  equality rejected; recorded replay + live-mismatch fail-closed).
- `test/hardening-regression.test.js` (H3, new): 5/5 pass --
  rejected authorization runs no engine; missing authorization leaks
  no secrets; recorded mismatch yields no token and cannot replay;
  client-forged provenance/model fields cannot affect the report;
  HTTP inputs cannot inject the model factory.
- Full suite at H3 close: 111/111 pass, 0 fail, 0 skipped,
  0 cancelled.
- Test-count reconciliation: the prior H2 report mixed file
  subtotals (18+16+16+59=109 vs stated 93 targeted/106 full).
  Actual per-file counts: approval-security 18, evaluation 10,
  executor 4, hardening-regression 5, http-security 16, planner 3,
  recorded-gate 16, refundService 2, sprint2 11, sprint3.1 14,
  timeline 8, validator 4 = 111. Prior full suite was 106;
  H3 added 5. No tests were weakened to reach these totals.
- Secret-scan note: the `b10_` prefix appears in this file and
  VERIFICATION/PUBLICATION only as a scan pattern and disclosure
  note -- no full key is stored in any tracked file. `.env.local`
  exists on disk (untracked, gitignored) and must be rotated
  before publication.


