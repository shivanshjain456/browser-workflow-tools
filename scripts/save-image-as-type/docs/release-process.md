# Release process

## Versioning

Semantic versioning on the userscript's `@version`. One version number appears
in four places and must agree everywhere — `npm run verify:release` fails the
build if they drift:

1. `package.json` → `version`
2. `src/meta.js` → `SCRIPT_VERSION`
3. the built artifact's metadata block (`@version`)
4. the newest heading in `CHANGELOG.md`

## What a release contains

| Asset | Notes |
|---|---|
| `release/save-image-as-type.user.js` | The installable file. **Committed** to the repository *and* attached to the GitHub Release. |
| `save-image-as-type-<version>-source.zip` | Rebuilt by `python3 audit/make-package.py`; contains sources, tests, docs and the evidence capsule. Attached to the Release only, not committed (see `.gitignore`). |
| `SHA256SUMS` / `PACKAGE_SHA256SUMS` | Checksums for the two artifacts above, written by the packaging step. |

## Gating a release

```sh
npm ci
node audit/preflight.mjs            # prerequisites exist; fails closed
npm run verify:release              # version/metadata/checksum/doc-link gates
npm test                            # unit + contract tests
npm run test:browser                # browser scenarios
node audit/verify-all.mjs           # full offline regression pipeline
python3 audit/check-rollbacks.py    # the recent change groups reverse cleanly
```

`audit/verify-all.mjs` deliberately exits **2** while any release-level
acceptance item is still open: exit 2 means *measured regression gates passed,
release still blocked*. Exit 1 is a real failure. Do not publish on exit 2
without the checklist below being satisfied.

The manager lab (`python3 audit/prepare-vm-lab.py`, `node
audit/manager-lab-setup.mjs`, `node audit/real-manager.mjs vm`) exercises the
built artifact in an actual Violentmonkey installation. It requires network
access for the pinned manager/Chrome assets and is therefore not part of CI.

## Steps to cut a release

1. Update the version in `package.json`, `src/meta.js` and `CHANGELOG.md`.
2. `npm run build` and commit the regenerated `release/save-image-as-type.user.js`.
3. Run the gate list above; all must pass (and, for a full release, every item in
   the acceptance checklist must be genuinely satisfied).
4. `python3 audit/make-package.py` to rebuild the source capsule and checksums.
5. Tag `v<version>` and create a GitHub Release from that tag.
6. Attach the userscript, the source ZIP and the checksum files.
7. Paste the changelog section as the release notes, adding upgrade notes for
   settings/schema changes and any newly *verified* compatibility result.
8. Verify the published download twice: install it in a throwaway profile and
   confirm the version in the manager dashboard matches the tag.

## Repository snapshot versus release asset

Two archives exist, on purpose:

* `python3 audit/make-package.py` → `release/save-image-as-type-<version>-source.zip`
  (release asset: sources, tests, docs, audit evidence and the built artifact,
  with `release/PACKAGE_SHA256SUMS`).
* `python3 scripts/make-repository-zip.py` → a complete repository snapshot you can
  review or push as the initial commit (everything a `git push` would include, and
  nothing that `.gitignore` excludes).

`package.json` has `"private": true` on purpose: this project is distributed as a
userscript, so an accidental `npm publish` would be a mistake, not a feature.

## Post-release checks

* The raw install URL resolves to the tagged file.
* `sha256sum -c SHA256SUMS` passes on the downloaded artifacts.
* The issue templates still render and point at the right version.
* No stale "unreleased" section is left in `CHANGELOG.md`.

## Automation

`.github/workflows/ci.yml` runs the static/unit/browser checks for pull requests
and pushes, with read-only permissions and no secrets. It builds the artifact and
fails if the committed file is stale. `.github/workflows/release.yml` runs on an
explicit `v*` tag that is already published as a Release: it re-runs the gates,
rebuilds the sources archive, writes checksums, and uploads the assets to that
Release. Neither workflow needs repository secrets. Both workflows must be
enabled by the owner after the repository is pushed; a workflow file existing
locally is not evidence that CI has run.

## Owner decisions required before publishing

See [Publication checklist](publication-checklist.md) — repository URL
(affects the install link, `homepage`/`repository` fields and any future
`@updateURL`), copyright holder, security contact, and whether the `audit/`
evidence tree is published as-is.
