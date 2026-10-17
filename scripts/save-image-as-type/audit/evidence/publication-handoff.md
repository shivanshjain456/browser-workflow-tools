# Publication handoff — Save Image as Type 2.0.1 repository package

Everything in this document was executed in this workspace or lives in a file
listed here. Nothing is projected, and no step below claims GitHub CI has run:
the workflows in `.github/workflows/` were validated locally (YAML parsing,
action pins, permissions, trigger review) only.

## 1. What the package is

A publishable repository around an existing single-file userscript that adds a
right-click **Save image as** menu (PNG/JPG/WebP/GIF/BMP/PDF + original bytes),
batch conversion, a page image picker, metadata inspection, clipboard copy and
image transforms — all encoded locally in the page, with no server, no telemetry
and no network access except fetching image bytes the user asked for.

* Artifact to install: `release/save-image-as-type.user.js` — version 2.0.1,
  605.0 KiB, sha256 `2e994164334133f8b5901e6649c96ec8e90931975b4faf59ca1c8877e91edbd4`
  (`release/SHA256SUMS`, `release/release-manifest.json`).
* The artifact is **committed** to the repository (it is the distributable, not a
  build output of the repository); archives are attached to GitHub Releases and
  are gitignored.
* No `@updateURL`/`@downloadURL` and no update check: users update by
  reinstalling the file, and settings survive because the storage schema is
  versioned (`siat.settings.v3` + migration from v1/v2).
* `releaseAccepted` is **false** by design: the artifact is an engineering
  candidate. The remaining acceptance work (S1 pre-existing-bug list, the
  TM 5.5.1 injection route, Firefox matrix, localisation and AT matrices) is
  recorded in `audit/engineering-report.md`; this repository package does not
  claim otherwise.

## 2. Package contents (407 files in the ZIP)

| Group | Files | Contents |
|---|---|---|
| Root | 13 | `README.md`, `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `.editorconfig`, `.gitignore`, `package.json`, `package-lock.json`, `build.mjs`, `lint.mjs` |
| `src/` | 42 | 41 auditable ES modules + `meta.js` (see `docs/architecture.md`) |
| `test/` | 63 | unit suites (577 tests), 57 Chromium scenarios, helpers, committed fixtures |
| `release/` | 4 | installable `.user.js`, `SHA256SUMS`, `release-manifest.json`, candidate source capsule |
| `docs/` | 27 | product docs (10), generated `reference/settings.md`, screenshots, and the legacy verification reports kept as historical evidence |
| `scripts/` | 3 | `verify-release.mjs` (release gate), `gen-settings-doc.mjs`, `make-repository-zip.py` |
| `.github/` | 7 | `ci.yml`, `release.yml`, `dependabot.yml`, three issue forms, PR template |
| `audit/` | 245 | verifiers, evidence, golden inputs, patches, rollback checkpoints, engineering report |
| `tools/` | 2 | standalone developer utilities |

The ZIP excludes `node_modules/`, `.tmp-*`, `.local/`, `dist/`, `__pycache__/`,
`.git/` and `release/*.zip`.

## 3. Commands executed, with actual results

Run in this workspace (Linux, Node v22.22.2, Python 3.13.16, Pillow 12.3.0,
pypdf 6.21.0, file 5.46):

| Command | Result |
|---|---|
| `node build.mjs` | rebuilt `release/save-image-as-type.user.js` at 2.0.1, 605.0 KiB, 15 469 lines, 41 modules; refreshed `release/release-manifest.json` + `release/SHA256SUMS` |
| `npm run build:check` | `OK: release/save-image-as-type.user.js is in sync with 41 source modules` |
| `npm run lint` | 27/27 |
| `npm test` | 577 tests / 100 suites / 0 fail |
| `npm run test:browser` | 57 passed / 0 failed (real Chromium, built artifact) |
| `node audit/verify-api.mjs`, `node audit/verify-contract.mjs` | PASS |
| `node audit/check-rollbacks.py` (via `verify-all`) | 569 / 574 / 576 PASS |
| `node audit/verify-all.mjs` | exit **2 RELEASE BLOCKED** (by design) |
| `node audit/real-manager.mjs vm` + `verify-manager-outputs.py vm` + `verify-production-pixels.py` | Violentmonkey 2.49.0 MV3 lab: 11 checks PASS, production pixels PASS |
| `node audit/assert-evidence.mjs` | PASS, then prints RELEASE BLOCKED |
| `npm run verify:release` | PASS (8 groups; 2 warnings = owner placeholders, no repository URL) |
| `npm run docs:settings:check` | current (49 settings, 8 formats, 5 shortcuts) |
| `node audit/preflight.mjs` | all tools ok |
| `node audit/independent-goldens.mjs` | independent decoders parse every golden output |
| `node --test test/unit/security.test.mjs` | 18/18 |

**Clean-checkout proof** (`audit/evidence/clean-checkout.txt`): the shipped ZIP
was extracted to `/tmp/clean4`, and in that unrelated directory with no git
history: `npm ci` (added 88 packages) → preflight (6/6 tools ok) → lint 27/27 →
`verify:release` PASS → `build:check` → `docs:settings:check` → 577/577 unit →
57/57 browser → independent goldens → security 18/18. Every command exited 0.
A post-run tree audit compared all 407 packaged files: **407/407 byte-identical
— the suite creates, modifies and deletes nothing outside gitignored
`node_modules/` and `.tmp-browser/`**.

`audit/evidence/repository-zip-verified-inputs.json` lists the sha256 of every
packaged file that is byte-identical between the verified extraction and the
archive, and names the only two files written after the extraction (this
package's verification log and that receipt).

## 4. Supported paths

**Installing the userscript (no tooling needed):** Violentmonkey 2.49.0 is
verified by execution in this workspace; Tampermonkey 5.5.1 installed but its
userscript injection was not exercised (its API docs are not treated as proof).
Detailed steps: `docs/installation.md`.

**Developing:** Node 22 (only Node 22.22.2 was exercised), `npm ci`, then
`npm run build` / `build:check` / `lint` / `test` / `test:browser`. The browser
suite needs Puppeteer's own Chrome download; the unit suite needs nothing but
Node. CONTRIBUTING.md documents the same commands.

**Packaging a release:** `npm run verify:release`, then follow
`docs/release-process.md` (build, checksums, tag, attach the ZIP + `.user.js`,
paste the CHANGELOG section).

## 5. Owner decisions still required

1. **Repository URL** — resolved to `https://github.com/shivanshjain456/browser-workflow-tools` in
   `README.md`, `docs/installation.md`, `.github/ISSUE_TEMPLATE/config.yml` and
   `docs/publication-checklist.md`, and add `repository`/`homepage` to
   `package.json`. Until then the install link is repository-relative.
2. **Copyright holder** — `LICENSE` currently reads "Save Image as Type
   userscript contributors" (MIT kept as-is). Confirm the legal name if you must.
3. **Private security-reporting route** — `SECURITY.md` uses a placeholder
   because no verified private channel exists. Fill in *one* route: GitHub
   private vulnerability reporting, a dedicated address, or a monitored inbox.
   No address is invented anywhere in the package.
4. **`audit/` visibility** — publish the evidence tree as shipped (it contains
   absolute `/home/user/...` labels and lab logs, no secrets; a PII scan of the
   ZIP found none) or attach it to a Release instead.
5. **GitHub Actions** — confirm the workflows may run on your account. They are
   fork-safe (read-only `GITHUB_TOKEN`, no secrets, no write permissions) but
   have not run on GitHub.

## 6. Publish steps

1. Decide items 1–5 above; apply the URL/packaging edits (a one-line `sed` per
   file, or re-word `README.md`).
2. `npm run verify:release` — expect PASS and zero warnings after the URL exists.
3. `git init`, commit the tree as shipped (the ZIP's contents), tag `v2.0.1`.
4. Push and enable Actions; watch `ci.yml` on that tag. It re-runs lint,
   `verify:release`, `build:check`, unit tests and (where Chrome is available)
   the browser suite — if a check fails there, it fails for a real environment
   reason; no step here claims it already passed.
5. Attach the release assets: `save-image-as-type.user.js`, `SHA256SUMS`, and the
   source capsule rebuilt with `python3 audit/make-package.py`. The capsule is
   deliberately *not* committed (see `.gitignore`); the rebuild is deterministic
   — two consecutive runs in this workspace both produced
   `save-image-as-type-2.0.1-candidate-source.zip` = 3 749 619 bytes,
   sha256 `9c4e33c958afe724c5e9c2f995b43f55392d5266ced435d41a21f6818921b5da`,
   which is exactly what the committed `release/PACKAGE_SHA256SUMS` records.
   Paste the 2.0.1 section of `CHANGELOG.md` as the release notes.
6. Verify the published install path end-to-end once more in a browser profile
   that has the manager installed: install from the release asset and run the
   first-use walkthrough in `README.md`.
