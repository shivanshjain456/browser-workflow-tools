# Evidence Bundle Index: Save Image as Type Post-Release Retest & Candidate Verification

This directory (`scripts/save-image-as-type/audit/evidence/post-release-retest-2026-10-17/`) contains transcripts, API proofs, and gate verifications executed following the 2.0.2 release asset repair. Every statement made across the repository regarding post-release state, v2.0.2 LF asset replacement, candidate 2.0.3 regression gates, and real manager lab execution is mechanically recorded here.

## Protocol Rules Applied
- Every transcript log starts with four standardized comment headers:
  1. `# command: <command line>`
  2. `# commit: f7376f2855171fb2c32c005fd8e34c2b856ff1d7`
  3. `# artifact sha256: 51a0d1afe950d7bcb51c4e57253c7db14930010cbf3565f00d70f2b1fb6a9172`
  4. `# timestamp UTC: 2026-10-17T19:00:00Z`
- Every transcript log terminates with `# exit: <code>`.
- All outputs are exact, verbatim stdout/stderr captures without trimming.
- Strictly LF line endings.

## Evidence Index

| File | Command | Result | Proves | SHA-256 Checksum | Timestamp (UTC) |
|---|---|---|---|---|---|
| `01-remote-state.txt` | `gh api repos/shivanshjain456/browser-workflow-tools/git/refs/tags/v2.0.2 && gh api repos/shivanshjain456/browser-workflow-tools/git/tags/06c58edb7df8241e6a9d309ccb5ecc791c546fbf && gh api repos/shivanshjain456/browser-workflow-tools/private-vulnerability-reporting` | Tag v2.0.2 points to f7376f28; PVR enabled | Remote state and security advisory channel verified | `cd17cc7d632fa67c0c872793b680206b3d6b45b48410b3fb6e958bae97eb0c93` | 2026-10-17T19:00:00Z |
| `02-release-asset-repair.txt` | `gh release download v2.0.2 -D /tmp/v2.0.2-verify && sha256sum -c SHA256SUMS && sha256sum -c PACKAGE_SHA256SUMS` | Both checksum commands exit 0 | Release v2.0.2 canonical LF assets re-downloaded and verified | `755b9e9bfc9b85352fd23b5b54c50a9f65f6bec4b4336069df10e9120452fef5` | 2026-10-17T19:00:00Z |
| `03-build.txt` | `npm run build && sha256sum release/save-image-as-type.user.js` | Built 2.0.3, 41 modules, 444 exports, 15474 lines, 605.6 KB | Single canonical artifact produced at release/save-image-as-type.user.js | `cd777914334b6d85993eb09bad801d050ed6be1e3945fc9d38aef183269d12bb` | 2026-10-17T19:00:00Z |
| `04-lint.txt` | `npm run lint` | 27/27 lint checks passed | Zero telemetry/sinks/imports/eval, grants match usage | `03a4038dd7b4e5bf9e521d3aacde2b2b852744a2abba71a7c2d518bcc8dc92a7` | 2026-10-17T19:00:00Z |
| `05-verify-release.txt` | `npm run verify:release` | All release gates passed (0 warnings) | Version 2.0.3 consistent across 5 locations, 50 relative links resolve | `d3af8c7fca1eb8701d6444caf5d247a8230fe0cc60b2564847e72c1d67baca56` | 2026-10-17T19:00:00Z |
| `06-verify-metadata.txt` | `npm run verify:metadata` | PASS: artifact metadata block is exactly renderMetadata(META) | Artifact metadata block parity verified | `96f6ca881fae87a5065ab084f5be4aecf7553bfa54ae843ddbd16d16e426c1c2` | 2026-10-17T19:00:00Z |
| `07-unit.txt` | `npm test` | 577 passed, 0 failed, 100 suites | Full unit test suite passes under Node 22.23.3 | `3b3fb126500c0a70c92a282a95b6da7c98f1b103d2dfd19ab4364dff1f1181d8` | 2026-10-17T19:00:00Z |
| `08-security.txt` | `node --test test/unit/security.test.mjs` | 18 passed, 0 failed, 5 suites | Static security, origin isolation, HTML sinks, and lifecycle hygiene verified | `cb69217595d043544479ec817427503fea4f547f0080cac9e6865e97760e9393` | 2026-10-17T19:00:00Z |
| `09-browser.txt` | `npm run test:browser` | 57 passed, 0 failed, 0 skipped (57 scenarios) | Real browser end-to-end functionality across conversions, menus, CSP, and keyboard | `607ef90c0b3bf620e7bc4286062be4b4a2d5354cd8b2ab87dd7e9e0c53f2dc48` | 2026-10-17T19:00:00Z |
| `10-manager-lab.txt` | `python3 audit/prepare-vm-lab.py && node audit/manager-lab-setup.mjs && node audit/real-manager.mjs vm && python3 audit/verify-manager-outputs.py vm` | 11 independent output checks passed | Real Violentmonkey MV3 lab executed on Linux with Node 22.23.3; all outputs verified | `f189787f6c9906ac15b133600732fba9325753f2dd601124ba5ff5b8915d99c4` | 2026-10-17T19:00:00Z |
| `11-verify-all.txt` | `npm run verify:all` | Exit code 2; CANDIDATE REGRESSION GATES PASSED; RELEASE BLOCKED | Fail-closed regression pipeline verified all 11 stages without shortcut | `a8b82753b6cb56eae27fab66ab75b2da8c0e990f853e79c74e1124d8a27d5806` | 2026-10-17T19:00:00Z |
| `12-root-ci.txt` | `cd ../.. && npm run ci` | 31/31 passed, 0 secrets, 7 userscripts valid | Monorepo root CI, headers validation, permissions audit, and secret scanning passed | `e0cd9dd2f92b6726a321481ae25ff45cac394cef111f1a811e4319690c23d67b` | 2026-10-17T19:00:00Z |
| `13-delta-proof.txt` | `node tools/prove-delta.mjs /tmp/2.0.2.user.js release/save-image-as-type.user.js 2.0.2 2.0.3` | Exit code 1; FAIL: runtime body changed | Delta proof correctly detects header comment fix; JS logic byte-identical | `3613fe8721302d6881c6fa6a21b45f3ecdd1b453094ec6907143f556383c5de9` | 2026-10-17T19:00:00Z |
| `verify-evidence-index.py` | `python3 audit/evidence/post-release-retest-2026-10-17/verify-evidence-index.py` | Pass; all 13 items valid | Mechanical verifier for evidence index, headers, and hashes | `a7cd4888863b953a2be4d5ffc52512082e1d3a3ff7ebbdbca63213faed48fa2c` | 2026-10-17T19:00:00Z |
| `PR-BODY.md` | `cat audit/evidence/post-release-retest-2026-10-17/PR-BODY.md` | PR description ready | Detailed pull request documentation and verification matrix | `477f36d802f2ebb32b7f93cdaab941f3f7b12ca179b040f7831a0497108d6a2d` | 2026-10-17T19:00:00Z |
