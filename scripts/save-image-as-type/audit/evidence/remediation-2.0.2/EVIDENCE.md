# Evidence Bundle Index: Save Image as Type 2.0.2 Remediation

This directory (`scripts/save-image-as-type/audit/evidence/remediation-2.0.2/`) contains command transcripts, patches, matrices, and configuration snapshots verifying the 2.0.2 remediation release. Every statement made across the repository is mechanically verified by transcripts recorded here or explicitly labeled as unverified.

## Protocol Rules Applied
- Every transcript log starts with three comment headers:
  1. `# command: <command line>`
  2. `# commit: <commit hash>`
  3. `# artifact sha256: 182f7854e0f225a07a5979d0f3f2783bbcec796851283aef612af205c4c0c8ab`
- Every transcript log terminates with `# exit: 0`.
- All outputs are exact, verbatim stdout/stderr captures without trimming.

## Evidence Index

| File | Command | Result | Proves | SHA-256 Checksum | Timestamp (UTC) |
|---|---|---|---|---|---|
| `01-environment.txt` | Environment probe script | Platform versions recorded | Reproducibility environment baseline (Windows, Node v22.23.1, npm 10.9.8, Python 3.12.11) | `4032af5195c7b425b137ee42b0ce31b250d9315446c80fe93f375ed7f09d5cdf` | 2026-10-17T13:41:16Z |
| `02-baseline-gates-before.txt` | Baseline verification commands | 5 gates failing as documented | Reproduces un-remediated defects D1–D5 at baseline commit `88fff69b` | `cdffac2d9448719dd2154862721420aa3c205d67ee43268319529664059ee970` | 2026-10-17T05:58:40Z |
| `03-source-diff.patch` | `git diff --stat 88fff69b && git diff 88fff69b` | 43 files changed (+703, -16200) | Zero changes under `src/core`, `encoders`, `ui`, `main.js`, `entry.js` | `5563f2d1b677f1a9d65a0e7f63f126fb189f322e35e63213aae58945f64a75d9` | 2026-10-17T13:47:42Z |
| `04-build.txt` | `npm run build && sha256sum release/save-image-as-type.user.js` | Built 2.0.2, 41 modules, 444 exports, 15474 lines | Single canonical artifact produced at `release/save-image-as-type.user.js` | `96f31eba432ee6086e630e55337dc348d1ae3b28c6a726ce722c0774e97bdbfb` | 2026-10-17T13:47:42Z |
| `05-lint.txt` | `npm run lint` | 27/27 lint checks passed | D1, D2, D7 fixed; grants match usage; no remote endpoints or URL drift | `49fa8ce67b988345704b615faedf0ec3300af7112ff943c1a8e259c51468d2cb` | 2026-10-17T13:47:42Z |
| `06-verify-release.txt` | `npm run verify:release` | All release gates passed (0 warnings) | D1–D5, D7, D10 fixed; version 2.0.2 consistent across 5 locations; 50 links resolve | `4e9eb05db44ebe7c91086b9f4d248dcbf18d63bfd13c40dabca31d545b7b2bc7` | 2026-10-17T13:47:42Z |
| `07-unit.txt` | `npm test` | 577 passed, 0 failed, 100 suites | Full unit test suite passes including image decoders, PDF, ZIP, and UI lifetime | `dcec2446425678b1443fb40938a967dd5eb11c206bf699716f4480d76a69fc91` | 2026-10-17T13:47:42Z |
| `08-browser.txt` | `npm run test:browser` | 57 passed, 0 failed, 0 skipped (57 scenarios) | Real browser end-to-end functionality across conversions, menus, CSP, and keyboard | `39dd5f16a89e50551d821dddaaee454454ab0d9a52cba41a5292a2cd9a7ba275` | 2026-10-17T13:47:42Z |
| `09-security.txt` | `node --test test/unit/security.test.mjs` | 18 passed, 0 failed, 5 suites | Static security, origin isolation, HTML sinks, and lifecycle hygiene verified | `c37551fcbd75a1629d4c77865bf234ce4d6acfc518710c42f198d4b07e326bff` | 2026-10-17T13:47:42Z |
| `10-build-check.txt` | `npm run build:check && npm run docs:settings:check` | In sync with 41 modules; 49 settings, 8 formats, 5 shortcuts | Artifact reproducibility and settings documentation synchronization | `cf4d52259b1c5a703486a49ce9200c35c2434b1a281b5a40beefb9345b3412c4` | 2026-10-17T13:47:42Z |
| `11-manager-lab.txt` | `audit/prepare-vm-lab.py` (protocol fallback) | Labeled `INHERITED — delta proof only` | Records lab results from baseline with explicit Windows fallback disclosure | `32ba78b678a7eea3d682fb975a046ab0020e93fabba2854022c48bbb24e1c56b` | 2026-10-17T13:47:42Z |
| `12-delta-proof.txt` | `node tools/prove-delta.mjs ...` | `PASS: runtime body identical; only metadata and version differ.` | Byte-level delta proof: runtime logic identical to commit `88fff69b` baseline | `772dee9ebbc291ee79df7bb6b524836192cd854efe14064a03dd400d48cada4f` | 2026-10-17T13:47:42Z |
| `13-clean-checkout.txt` | `scratch clone && npm ci && S2-S8` | All clean: S2–S8 pass in fresh clone | Proves clone from zero works cleanly without local uncommitted dependencies | `bf486ac1d4be668b476a79574c214d53b4be37e9ae9521b8726d3b8383422e0b` | 2026-10-17T13:58:50Z |
| `14-consistency-matrix.md` | Public claim consistency audit | All claims verified or explicitly labeled | Matrix proving claim-by-claim parity between docs, metadata, and code | `6da3e868552208b0761b032802639deefd81195801577deb8e9f4185170ff441` | 2026-10-17T13:59:20Z |
| `decisions.md` | Decision record (§10 Phase 1) | Frozen architectural decisions | Records non-negotiable architectural invariants for 2.0.2 release | `694d8054cca4982bb1875fdbfd2e796b7e5691692dcfe22230c17aa58e497d01` | 2026-10-17T05:59:46Z |
| `PR-BODY.md` | Pull request description document | Defect resolution, outputs, checklist | Formatted PR markdown body matching §15.3 | `fce257202fd6868728bf9267619542445f8785126e2696c1cd550530e0bf7a60` | 2026-10-17T14:01:02Z |
| `research-log.md` | Standards & RFC research log | Citations and findings recorded | Complete record of consulted external RFCs, specifications, and APIs | `d03ff8063ca5c2dd8ca71ccb98fcc8c34cfcdb7f828140dd338a0a1b15898563` | 2026-10-17T13:59:38Z |
| `vm-production.json` | Baseline manager lab run result | 11/11 checks passed | Baseline manager output checks retained for inheritance verification | `59208d2f55ccb1637592638a76e6702379aa2b5938f6b72eac1d647ed59b34b0` | 2025-12-31T18:30:00Z |
