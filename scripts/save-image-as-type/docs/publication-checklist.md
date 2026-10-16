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

## Owner decisions (cannot be inferred)

### 1. Repository URL
Needed for: the raw install link, `repository`/`homepage`/`bugs` fields in
`package.json`, `@updateURL`/`@downloadURL` (deliberately absent today), badge
URLs, and the release asset links.
**Decision:** publish as e.g. `github.com/<OWNER>/<REPO>`. Until then, the README
uses a repository-relative path and marks the raw URL as a placeholder. Do not
publish a guessed URL.

### 2. Copyright holder
`LICENSE` currently reads *“Copyright (c) 2026 Save Image as Type userscript
contributors”*. **Decision:** keep the collective line, or replace it with the
legal entity that will actually own the project. No third-party code is bundled,
so no additional attribution is required by the current dependency set.

### 3. Security contact
`SECURITY.md` instructs reporters to use GitHub's private vulnerability
reporting, **and explicitly records that the feature must be enabled by the
owner**. **Decision:** enable *Settings → Security → Private vulnerability
reporting* after publishing, or supply a monitored contact address to add to that
file. No address is invented.

### 4. Whether to publish `audit/`
`audit/` (about 6 MB) contains the executed verification evidence, harnesses and
the ordered engineering record. Publishing it makes the claims auditable; it also
adds noise and includes local `127.0.0.1` fixtures.
**Decision:** publish as-is (recommended, keeps the claims checkable), or move it
to a `verification/` GitHub Release asset and keep only `audit/README.md` +
`audit/engineering-report.md` in the tree.

### 5. Release acceptance level for this repository snapshot
`release/release-manifest.json` has `releaseAccepted: false` because the
project's own acceptance brief still has open items (broad S1 work, Tampermonkey
verification, whole-interface localisation). **Decision:** either publish this as
a **pre-release / community preview** (recommended, with the limitations listed
in `docs/compatibility.md`), or hold publication until those items are closed.

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
