# Consistency Matrix for Save Image as Type 2.0.2

All public claims made across documentation, metadata, gate scripts, and release assets are indexed below against their source of truth and runtime verification proof.

| Claim | Where stated | Source of truth | Runtime proof | Verdict |
|---|---|---|---|---|
| Exactly 10 `@grant`s | `README.md`, `docs/privacy-and-permissions.md`, `release/save-image-as-type.user.js` | `src/meta.js:46-57` | `npm run lint` (`grants-match-usage` rule), `npm run verify:release`, `node tools/check-metadata-parity.mjs` (V4, V5, V6) | VERIFIED |
| `@connect *` restored | `README.md`, `docs/privacy-and-permissions.md`, `release/save-image-as-type.user.js` | `src/meta.js:44` | `npm run lint` (`connect-scope` rule), `npm run verify:release`, `node tools/check-metadata-parity.mjs` (V4, V5, V6) | VERIFIED |
| Update channel exists & points to canonical artifact | `README.md`, `docs/privacy-and-permissions.md`, `SECURITY.md`, `docs/release-process.md` | `src/meta.js:22-25` | `node tools/check-metadata-parity.mjs`, `npm run verify:release` (section 8) | VERIFIED |
| Icon is inline SVG data URI (no `@icon64`) | `docs/privacy-and-permissions.md`, `release/save-image-as-type.user.js` | `src/meta.js:31-41` | Artifact header inspection, `npm run lint` (`no-remote-endpoints`), `test/unit/security.test.mjs` (V4, V6, V8) | VERIFIED |
| Shortcuts `Alt+Shift+S/C/P/A/X` | `README.md`, `docs/user-guide.md` | `src/core/shortcuts.js:33-85` | `npm run test:browser` (`v2-keyboard-workflow`), `npm run docs:settings:check` (V3, V9) | VERIFIED |
| ZIP is stored, not deflated | `README.md`, `docs/user-guide.md` | `src/encoders/zip.js:48-52` (compression method 0) | `npm test` (`test/unit/zip.test.mjs` golden zip assertions) (V7) | VERIFIED |
| 57 browser scenarios | `README.md`, `docs/installation.md` | `test/browser/run.mjs` | `npm run test:browser` output: `57 passed, 0 failed, 0 skipped (57 scenarios)` (V9) | VERIFIED |
| Tampermonkey unverified | `SMOKE_MATRIX.md`, `docs/installation.md` | `audit/evidence/remediation-2.0.2/11-manager-lab.txt` | Explicit label `INHERITED — delta proof only` on Windows environment | VERIFIED (explicitly labeled unverified) |
| Runtime body identical to baseline 88fff69b | `audit/evidence/remediation-2.0.2/12-delta-proof.txt` | `release/save-image-as-type.user.js` | `node tools/prove-delta.mjs /tmp/88fff69b-artifact.user.js release/save-image-as-type.user.js 2.0.1 2.0.2` (V10) | VERIFIED |
| Single canonical release artifact | Root `package.json`, `build.mjs`, `docs/release-process.md` | `release/save-image-as-type.user.js` | `Get-ChildItem -Filter *.user.js`: only `release/` and 2 audit fixtures found (V14) | VERIFIED |
| Zero unpopulated repository placeholders | Repository-wide | Git tree | Verification rule 9 placeholder check returns 0 matches (V13) | VERIFIED |
| CI workflow hardened & valid | `.github/workflows/save-image-as-type.yml` | Workflow file | `npx --yes github-actionlint .github/workflows/save-image-as-type.yml` exits 0 (V12) | VERIFIED |
