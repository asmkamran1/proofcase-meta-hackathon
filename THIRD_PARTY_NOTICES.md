# Third-Party Notices

This project uses the following third-party components. Their licenses are
retained by their respective owners. Dependency license information was
verified on 2026-11-01.

## Runtime Dependencies

None — the project has zero npm production dependencies (`package.json`
`dependencies` is empty). The only external service is the Meta model via
Baseten inference, called server-side.

## Development / Node Built-ins

- Node.js 20+ built-ins used directly: `node:http`, `node:fs`, `node:path`,
  `node:url`, `node:crypto`, `node:assert`, `node:test` (no separate package).
- License for Node.js: MIT.

## Model and Provider Attribution

- Model: **meta-models/muse-spark-open-1026** by Meta (via Baseten).
  Model weights and API are governed by Meta's and Baseten's terms.
  See: https://ai.meta.com/ and https://www.baseten.co/
- No model weights are bundled in this repository. Inference is via HTTPS
  to `https://inference.baseten.co/v1` using a user-supplied API key.

## Reused Code Provenance

- `src/metaClient.js` was adapted from a separately developed in-window
  Form Intelligence prototype at `C:\Repo\workcadence-meta-hackathon\src\metaClient.js`.
  That prototype was also built 2026-10-26 through 2026-11-04 for the same
  hackathon, using the same Muse Spark model. The client establishes the
  Baseten transport, budget/retry contract, and diagnostics. Work Cadence
  product logic (profile intake, ATS routing, multi-tenant DB, etc.) was
  intentionally **not** imported. See `NEW_WORK.md` and
  `docs/HACKATHON_DISCLOSURE.md`.

## No Other Copied Code

- No snippets from Stack Overflow, GitHub Copilot, or LLM-generated
  libraries beyond the normal Meta API transport boilerplate.
- `public/`, `src/catalog.js`, `src/planner.js`, `src/testPlanValidator.js`,
  `src/refundService.js`, `src/executor.js`, `src/semanticGate.js`,
  `src/server.js`, `src/approval.js`, `scripts/*`, `test/*`, `fixtures/*`,
  and `docs/*` are new work for ProofCase (see `NEW_WORK.md`).

## Verification

Run `npm list` — with zero dependencies it returns empty, confirming no
hidden license obligations beyond Node itself.

```powershell
cd C:\Repo\proofcase-meta-hackathon
npm list
```
