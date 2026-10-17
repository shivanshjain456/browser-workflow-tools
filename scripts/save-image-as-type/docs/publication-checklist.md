# Publication checklist

Two kinds of item appear here: ones **already resolved by implementation** (with
the evidence), and **owner decisions** that cannot be inferred from the code and
must be answered before the repository is published.

## Resolved by implementation

| Item | Status / evidence |
|---|---|
| Installable artifact exists, is valid and is committed | `release/save-image-as-type.user.js`, metadata block verified by `npm run verify:release` |
| Version is consistent across package, metadata, artifact and changelog | Enforced by `npm run verify:release` |
| Clean checkout can install, build and test | `npm ci`, `npm run build:check`, `npm test`, `npm run test:browser` (see the handoff summary for the executed results) |
| Runtime permissions documented, no undeclared destination | `docs/privacy-and-permissions.md`; `lint.mjs` grant-vs-usage rule |
| License file present and valid | `LICENSE` (MIT), referenced by `@license` and by `package.json` |
| Third-party obligations reviewed | No runtime dependency, no inlined third-party code, no bundled fonts/icons; dev-only tools attributed in `docs/development.md` and `audit/README.md` |
| Contributor, security and support routes documented | `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md` |
| Issue forms + PR template exist with valid fields | `.github/ISSUE_TEMPLATE/*.yml`, `.github/PULL_REQUEST_TEMPLATE.md` (YAML validated locally) |
| CI and release automation written with minimal permissions | `.github/workflows/ci.yml`, `.github/workflows/release.yml` (validated locally; see the caveat below) |
| Screenshots are genuine and current | Three screenshots in `docs/assets/` were produced by the project's own harness (settings panel, configuration-profile section, manager command list) and are referenced from README/documentation. |
| No scratch state is committed | Found by the clean-checkout run and fixed: generated metadata fixtures (EXIF/GPS/XMP/ICC) were being written into `test/fixtures/` and their bytes vary with the local Pillow/lcms build; they are now generated into the ignored `.tmp-browser/fixtures/` and served from there (`GENERATED_FIXTURE_DIR`). Audit scratch output lives under `.tmp-test/` (gitignored, never packaged). The shipped snapshot is compared file-by-file with the verified extraction in `audit/evidence/clean-checkout.txt` — 406/406 packaged files byte-identical after a full run — with per-file hashes in `audit/evidence/repository-zip-verified-inputs.json`. |
| Secrets/PII scan of the tree | `npm run verify:release` scans sources, artifact and docs for credential-shaped strings; no secrets or personal data are committed |
| Generated documentation matches the code | `docs/reference/settings.md` is generated from `src/core/settings.js` by `npm run docs:settings`; the release gate fails if it is stale. The gate also fails if the eight registered manager-command labels or the six menu-action labels are not present verbatim in the user documents — an earlier draft of the docs described invented labels and is corrected in `docs/advanced-usage.md` and `docs/user-guide.md`. |
| `.gitignore` excludes local outputs but keeps source/tests/lockfile/artifact | `.gitignore` |
| Environment: Node/Browser/Python requirements pinned and documented | `package.json` (`engines`, exact dev pins), `docs/development.md` |
| Installation and development paths walked end-to-end | The repository snapshot was extracted to an unrelated directory, `npm ci` was run there, and lint + release gates + `build:check` + 577 unit tests + 57 browser scenarios + independent decoder checks all passed: `audit/evidence/clean-checkout.txt`. Browser/manager behaviour of the same bytes is recorded in `audit/evidence/manager-lab/`. |

## Owner decisions (resolved for this publication)

| Decision | Resolution | Date |
|---|---|---|
| Repository URL | `https://github.com/shivanshjain456/browser-workflow-tools` (package: `scripts/save-image-as-type`) | 2026-10-17 |
| Copyright holder | Shivansh Jain (matches `@author` and `LICENSES/MIT.txt`) | 2026-10-17 |
| Security contact | GitHub private vulnerability reporting, enabled and verified | 2026-10-17 |
| `audit/` publication | Published as-is; no secrets, no personal data | 2026-10-17 |
| Update channel | `@updateURL`/`@downloadURL` kept, pointing at the single canonical artifact | 2026-10-17 |

### 6. Packaging note discovered by this check

The first repository snapshot excluded `*.zip`, which also removed the golden
fixture `test/golden/unicode.zip` and made a fresh checkout fail one test. The
packaging script now excludes only release archives and asserts that the golden
fixtures, generated settings reference and release tooling are present. This is
exactly the class of defect the clean-checkout walkthrough exists to catch.

### 7. GitHub features to switch on after publishing
Issue forms, Discussions (if wanted for Q&A), branch protection on `main`, and
Dependabot alerts. Documented here because they cannot be enabled from the
repository contents alone.

## Caveat on CI status

The workflow files in this repository were **validated locally** (YAML parse,
command review); they have **not** run on GitHub. Do not describe CI as passing
until the owner pushes the repository and the runs are green.
