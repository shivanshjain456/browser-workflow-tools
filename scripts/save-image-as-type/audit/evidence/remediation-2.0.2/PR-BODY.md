## Summary

This pull request remediates the `save-image-as-type` userscript from an inconsistent, gate-failing state to an internally consistent, fully verified, single-canonical-artifact release at version `2.0.2`.

Zero changes were made to the runtime logic under `src/core/`, `src/encoders/`, `src/ui/`, `src/main.js`, or `src/entry.js`. The runtime body is mechanically proven 100% byte-identical to the baseline commit `88fff69b`.

---

## Defect Resolutions (D1–D10)

- **D1 (`@connect *` restored)**: Restored `@connect *` in `src/meta.js`. Documented why arbitrary CDN domains must be reachable for cross-origin image acquisition. Updated `lint.mjs`, `security.test.mjs`, and root `PERMISSIONS.md`.
- **D2 (Inline SVG Icon)**: Restored inline SVG data URI for `@icon` in `src/meta.js`. Removed external `@icon64` to fulfill the privacy guarantee of zero external network requests on install.
- **D3 (Single Canonical Artifact)**: Deleted duplicate unverified root userscript `scripts/save-image-as-type/save-image-as-type.user.js`. Standardized all build scripts, gates, checksums, and docs on `scripts/save-image-as-type/release/save-image-as-type.user.js`.
- **D4 (Derived-Only Manifest)**: Stripped non-derived gate claims from `release/release-manifest.json`. Relocated historical verification claims to `audit/evidence/release-evidence.json` and linked via manifest `evidence` field.
- **D5 (Documentation Truth)**: Completely corrected `docs/installation.md`, `docs/privacy-and-permissions.md`, `docs/publication-checklist.md`, `docs/release-process.md`, and `SECURITY.md`. All relative links verified and resolve.
- **D6 (README Overhaul)**: Replaced `README.md` with accurate, honest documentation reflecting single artifact, 10 grants, update channels, and shortcut controls.
- **D7 (Consistent Version 2.0.2)**: Bumped version to `2.0.2` across all 5 canonical locations (`meta.js`, `package.json`, `package-lock.json`, `build.mjs`, `release-manifest.json`). Documented in `CHANGELOG.md`.
- **D8 (Root CI Workflow)**: Removed inert nested `.github` directory. Added `.github/workflows/save-image-as-type.yml` at repository root with path filtering, minimal permissions (`contents: read`), actionlint validation, and full test gates.
- **D9 (Monorepo Integration)**: Updated root `README.md`, `SMOKE_MATRIX.md`, `PERMISSIONS.md`, root `LICENSE` (MIT), root `package.json` `check:syntax` script, and issue templates.
- **D10 (Evidence Bundle)**: Produced comprehensive 14-transcript evidence bundle under `audit/evidence/remediation-2.0.2/` with SHA-256 hashes, timestamps, delta proof, and fresh clone validation.

---

## Verification Matrix (§13.1 Observed Outputs)

| # | Command | Real Observed Output | Exit |
|---|---|---|---|
| **V1** | `npm run build` | `built release/save-image-as-type.user.js — v2.0.2, 41 modules, 444 exports, 15474 lines, 605.6 KB` | `0` |
| **V2** | `npm run build:check` | `OK: release/save-image-as-type.user.js is in sync with 41 source modules.` | `0` |
| **V3** | `npm run docs:settings:check` | `settings reference is current (49 settings, 8 formats, 5 shortcuts)` | `0` |
| **V4** | `npm run lint` | `27/27 lint checks passed` | `0` |
| **V5** | `npm run verify:release` | `All release gates passed (0 warnings; warnings are owner decisions, not defects).` | `0` |
| **V6** | `npm run verify:metadata` | `PASS: artifact metadata block is exactly renderMetadata(META)` | `0` |
| **V7** | `npm test` | `# tests 577`, `# pass 577`, `# fail 0`, 100 suites | `0` |
| **V8** | `node --test test/unit/security.test.mjs` | `# tests 18`, `# pass 18`, `# fail 0`, 5 suites | `0` |
| **V9** | `npm run test:browser` | `57 passed, 0 failed, 0 skipped (57 scenarios)` | `0` |
| **V10** | `node tools/prove-delta.mjs ...` | `PASS: runtime body identical; only metadata and version differ.` | `0` |
| **V11** | Manager lab / fallback | `INHERITED — delta proof only` (Windows environment fallback per §10 Phase 8) | `0` |
| **V12** | `npx --yes github-actionlint ...` | `actionlint: 0 errors` (silent exit 0) | `0` |
| **V13** | Placeholders scan | No unpopulated template placeholders found | `1` |
| **V14** | `Get-ChildItem -Filter *.user.js` | Only `./release/save-image-as-type.user.js` (+ 2 audit fixtures) | `0` |

---

## Artifact Hashes & Delta Proof

- **Artifact Path**: `scripts/save-image-as-type/release/save-image-as-type.user.js`
- **Artifact SHA-256**: `182f7854e0f225a07a5979d0f3f2783bbcec796851283aef612af205c4c0c8ab`
- **Source Capsule**: `release/save-image-as-type-2.0.2-source.zip` (SHA-256: `ce6a633c54dbf1e1cc50955de3ab7a863d84ba4e9ba101596aac678c45ddd100`)
- **Runtime Body Delta**:
  - Baseline commit `88fff69b` stripped body SHA-256: `1629950dc58490a82d7a61c31aca2c8da1b26d4eb47b8aaecd7b54c63c8082eb`
  - Version 2.0.2 stripped body SHA-256: `1629950dc58490a82d7a61c31aca2c8da1b26d4eb47b8aaecd7b54c63c8082eb`
  - **Result**: Byte-for-byte identical runtime logic.

---

## Evidence Directory

All command transcripts, hashes, and matrices are recorded in:
`scripts/save-image-as-type/audit/evidence/remediation-2.0.2/`
Index: `scripts/save-image-as-type/audit/evidence/remediation-2.0.2/EVIDENCE.md`

---

## Reviewer Spot-Check List

1. [ ] Inspect `scripts/save-image-as-type/release/save-image-as-type.user.js`: verify `@connect *` and inline SVG data URI `@icon`.
2. [ ] Check `git diff 88fff69b --stat`: confirm zero edits under `src/core/`, `src/encoders/`, `src/ui/`, `src/main.js`, and `src/entry.js`.
3. [ ] Run `npm run verify:release` in `scripts/save-image-as-type`: confirm exit code `0` with `0 warnings`.
4. [ ] Inspect `12-delta-proof.txt`: verify that the stripped runtime bodies match hash `1629950dc58490a82d7a61c31aca2c8da1b26d4eb47b8aaecd7b54c63c8082eb`.
5. [ ] Run placeholders check: confirm 0 unpopulated repository placeholders in markdown or workflow files.
