## Summary

This pull request completes the remediation follow-up for `Save Image as Type` following an independent re-test of the merged 2.0.2 release.

It accomplishes four primary goals:
1. **Verified v2.0.2 Release Asset Repair**: Replaced corrupted CRLF release assets on GitHub Release `v2.0.2` with exact canonical LF blobs extracted directly from Git tag `v2.0.2` (`save-image-as-type.user.js` `f4b4e1b0`, `SHA256SUMS` `78af1a7d`, `PACKAGE_SHA256SUMS` `6a092130`). Both `sha256sum -c` commands pass with exit code `0` on re-downloaded assets. Tag `v2.0.2` and commit `f7376f28` remain completely untouched.
2. **Fixed Verifier Crash & Strengthened Release Gates**: Resolved crash in `audit/assert-evidence.mjs` by reading test totals from `audit/evidence/release-evidence.json` instead of the derived-only `release/release-manifest.json`. Added forbidden phrase checks (`/zero-wildcard/i`, `/no update URL/i`) to `scripts/verify-release.mjs`.
3. **Truthful Documentation & Comment Correction**: Replaced the inaccurate "zero-wildcard" phrase in `build.mjs` with an honest statement explaining `@connect *` (cross-origin fetch required for arbitrary image host acquisition). Updated `audit/README.md` to reflect historical 2.0.1 audit scope and clarify manager-level `@updateURL` behavior.
4. **Candidate Verification & Real Manager Lab in WSL**: Executed full test suite and manager lab on Linux x86_64 with Node 22.23.3 and Violentmonkey MV3 v2.49.0. All 11 independent output checks passed on the candidate artifact (`51a0d1afe950d7bcb51c4e57253c7db14930010cbf3565f00d70f2b1fb6a9172`). `npm run verify:all` passed all 11 regression stages and exited with code `2` as designed. Monorepo root `npm run ci` passed cleanly (31/31 tests, 0 secrets).

Candidate version is bumped to `2.0.3` across all 5 canonical locations. Per project invariants, `releaseAccepted: false` is strictly maintained and no 2.0.3 tag or release is published.

---

## Defect Resolutions

- **R1 (Release Asset Repair)**: Replaced release assets on GitHub Release `v2.0.2` without altering the Git tag or commit. Preserved full rollback evidence in `scratch/release-v2.0.2-rollback/`. Updated release notes and description with LF checksums and erratum note.
- **R2 (Verifier Crash Fix)**: `audit/assert-evidence.mjs` was attempting to read `manifest.gates.unit.total`, which was intentionally stripped from the derived manifest. It now reads test totals from `audit/evidence/release-evidence.json`.
- **R3 (Browser Download Race Fix)**: In `test/browser/run.mjs`, `waitForCdpDownload` now ensures non-zero file bytes are written before returning, preventing occasional CDP file-flush race conditions during browser test suites.
- **R4 (Truthful Header Comment)**: Removed false "zero-wildcard" comment in `build.mjs` and replaced it with truthful explanation of `@connect *`. Added forbidden string scanners to `scripts/verify-release.mjs`.
- **R5 (Audit Documentation Parity)**: Updated `audit/README.md` to clarify the 2.0.1 audit scope is historical and document the exact `@updateURL` manager update behavior.
- **R6 (Real Manager Lab)**: Executed the actual Violentmonkey MV3 lab in WSL (Node 22.23.3, Chrome 155.0.8059.84). Verified all 11 output checks, including exact raster byte parity and settings restoration.
- **R7 (Standard-Compliant Evidence Bundle)**: Populated `audit/evidence/post-release-retest-2026-10-17/` with 13 standard-compliant transcripts, `verify-evidence-index.py`, and `EVIDENCE.md`.

---

## Verification Matrix

| # | Command | Real Observed Output | Exit |
|---|---|---|---|
| **V1** | `gh api refs/tags/v2.0.2` & `private-vulnerability-reporting` | Tag `v2.0.2` points to `f7376f28`; PVR enabled (`{"enabled":true}`) | `0` |
| **V2** | `gh release download v2.0.2` & `sha256sum -c` | `save-image-as-type.user.js: OK`, `source.zip: OK` | `0` |
| **V3** | `npm run build && sha256sum` | `built release/save-image-as-type.user.js — v2.0.3, 41 modules, 444 exports, 15474 lines, 605.6 KB` | `0` |
| **V4** | `npm run lint` | `27/27 lint checks passed` | `0` |
| **V5** | `npm run verify:release` | `All release gates passed (0 warnings)` | `0` |
| **V6** | `npm run verify:metadata` | `PASS: artifact metadata block is exactly renderMetadata(META)` | `0` |
| **V7** | `npm test` | `# tests 577`, `# pass 577`, `# fail 0`, 100 suites | `0` |
| **V8** | `node --test test/unit/security.test.mjs` | `# tests 18`, `# pass 18`, `# fail 0`, 5 suites | `0` |
| **V9** | `npm run test:browser` | `57 passed, 0 failed, 0 skipped (57 scenarios)` | `0` |
| **V10** | Manager lab pipeline in WSL | `11 independent output checks passed; original raster bytes exact` | `0` |
| **V11** | `npm run verify:all` | `CANDIDATE REGRESSION GATES PASSED; RELEASE BLOCKED.` | `2` |
| **V12** | Monorepo root `npm run ci` | `31/31 passed`, `0 secrets detected`, `7 scripts valid` | `0` |
| **V13** | `node tools/prove-delta.mjs ...` | `FAIL: runtime body changed; behavior must be re-verified end to end.` (Header comment fixed; executable JS byte-identical) | `1` |
| **V14** | `python3 verify-evidence-index.py` | `PASS: Verified 14 evidence items successfully.` | `0` |

---

## Artifact Hashes & Delta Proof

- **Candidate Artifact Path**: `scripts/save-image-as-type/release/save-image-as-type.user.js`
- **Candidate Artifact SHA-256**: `51a0d1afe950d7bcb51c4e57253c7db14930010cbf3565f00d70f2b1fb6a9172`
- **Candidate Size**: 620,098 bytes (605.6 KB)
- **Delta Analysis**:
  - Across all 15,474 lines, the **only** difference between the 2.0.2 and 2.0.3 candidate stripped bodies is line 14:
    - Old: ` *   - zero-wildcard grants; explicit origin connect permissions`
    - New: ` *   - @connect * (explicit cross-origin fetch capability required for web images)`
  - Executable JavaScript logic is 100% byte-for-byte identical.
  - `tools/prove-delta.mjs` correctly exits `1` due to this comment change, and was intentionally not weakened.

---

## Evidence Directory

All command transcripts, SHA-256 hashes, timestamps, and mechanical verifiers are recorded in:
`scripts/save-image-as-type/audit/evidence/post-release-retest-2026-10-17/`
Verified mechanically via:
`python3 scripts/save-image-as-type/audit/evidence/post-release-retest-2026-10-17/verify-evidence-index.py`

---

## Release Status

- `releaseAccepted`: `false` in `release/release-manifest.json`.
- Tag `v2.0.2` and commit `f7376f28` are preserved and immutable.
- No new tag or release has been created or published.
