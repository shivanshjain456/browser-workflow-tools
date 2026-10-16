# Development

## Prerequisites

* **Node.js ≥ 22.22.2** (the toolchain is pinned to the Puppeteer 25 line; the
  system Node of the machine used for verification was 22.22.2).
* **Python 3** with `Pillow` and `pypdf`, plus `file(1)`, only for the
  independent decoder checks:
  `python3 -m pip install --user -r audit/requirements.txt`.
* Chromium shared libraries for the headless browser (the fixtures use
  Puppeteer's bundled Chrome).
* Linux x86_64 is what the manager lab targets; the unit and browser suites run
  anywhere the above exist.

## Clean setup

```sh
git clone <this repository>            # or unpack the source archive
cd save-image-as-type
npm ci                                 # exact locked dev dependencies
node audit/preflight.mjs               # fails fast if a tool is missing
```

`npm ci` installs **development** dependencies only. The installed userscript
never downloads anything.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run build` | Regenerates `release/save-image-as-type.user.js` from `src/`. |
| `npm run build:check` | Fails if the committed artifact is stale (used by CI). |
| `npm test` | Unit + contract tests (577) via `test/run-unit.mjs`. |
| `npm run test:browser` | 57 browser scenarios against an instrumented fixture build. |
| `npm run lint` | 27 static repository/artifact checks. |
| `npm run verify:release` | Release gate: version alignment, metadata, checksums, doc links, generated reference freshness, forbidden patterns. |
| `npm run docs:settings` | Regenerates `docs/reference/settings.md` from the code. |
| `node audit/verify-all.mjs` | The full offline regression pipeline (preflight → build/lint → unit → browser ×2 → production probes → goldens → assertions). |
| `npm run probe:encoders`, `npm run probe:codecs` | Encoder/structural probes with no browser. |

## Project layout

```
src/            ES modules; src/entry.js is the production entry point
src/core/       settings, conversion, acquisition, filename rules, presets, profiles
src/encoders/   BMP / GIF / PDF / ZIP writers (hand-written, byte-golden tested)
src/ui/         shadow-DOM UI: menu, dialogs, toasts, job bar, settings panel
build.mjs       dependency-free bundler (modules → one readable IIFE)
lint.mjs        static rules over the sources and the built artifact
test/unit/      Node tests (fast, no browser)
test/browser/   Puppeteer scenarios with a fake manager
test/golden/    six byte-exact encoder outputs pinned to v2.0.0
test/corpus/    hostile configuration/filename inputs
test/fixtures/  small images used by tests (all synthetic)
audit/          verification harnesses, evidence and the ordered engineering record
docs/           user, developer and release documentation
scripts/        release verification + documentation generation
release/        the committed, installable artifact
```

## How source becomes the artifact

`build.mjs` walks the import graph from `src/entry.js`, orders modules
dependencies-first, strips `import`/`export` syntax, and wraps everything in one
strict-mode IIFE behind the rendered metadata block. It fails on missing modules,
import cycles, duplicate top-level names, and stale output (`--check`). There is
no minification, bundling framework or transpiler, so the installed file stays
readable and reviewable — that is a hard project requirement, not an accident.

## Fixtures

Two kinds of fixture exist, and the difference matters when you add tests:

| Kind | Where | Rule |
|---|---|---|
| Committed | `test/fixtures/**` | Stable bytes: sample photo, icons, animation, golden encoder inputs/outputs (including `test/golden/unicode.zip`). Reviewable and hashable; never written by a test run. |
| Generated | `.tmp-browser/fixtures/**` (gitignored) | Built by the test run with Pillow/lcms (`make_metadata_fixtures.py`). Their bytes depend on the local library build, so committing them would dirty the tree and make the input ambiguous. The browser harness serves this directory first and falls back to the committed fixtures (`GENERATED_FIXTURE_DIR` in `test/browser/harness.mjs`). |

## Testing conventions

* **New behaviour needs a test in the same change.** Pure logic → `test/unit/`;
  anything that needs layout, real events or a download → `test/browser/`.
* **Byte contracts are pinned.** BMP/GIF/PDF/ZIP writers are compared against
  `test/golden/`; changing those bytes is a deliberate, reviewed act. Never
  regenerate goldens to make a failing test pass.
* **Hostile input is expected.** New user-supplied data (settings, imports,
  filenames, manager responses) should go through the existing validators and
  gain a corpus case if it opens a new path.
* **No new runtime dependency** without a strong, documented reason: the
  artifact must remain a single self-contained file.
* Tests must fail loudly. A skipped or missing prerequisite is an error, not a
  smaller green suite — `audit/preflight.mjs` enforces this.

## Debugging a page

1. Run `npm run build` and install `release/save-image-as-type.user.js` in a
   throwaway browser profile.
2. Open *Diagnostics* from the manager popup: it reports the probed manager,
   storage verdict and encoder availability.
3. For encoder questions, use the offline probes — they are faster and give
   byte-level answers without a browser.
4. Never install a modified build "just for testing" from a profile you also use
   for real browsing.

## Verification record

`audit/` holds the executed evidence for every claim this repository makes:
harness scripts, raw JSON/text logs, the golden corpus, the manager-lab runs and
the ordered engineering record (`audit/engineering-report.md`). Two habits keep it
trustworthy:

* Numbers in the docs and the report come from those logs, not from memory.
  `npm run verify:release` re-checks the version/metadata/checksum/doc-link
  consistency that documentation depends on.
* A failed or superseded run is kept, not deleted (`*negative*`, `*first-failure*`
  files). If you change a measurement, add the new log and update the sentence
  that quotes it.

`audit/verify-all.mjs` deliberately exits `2` while the project's own acceptance
brief has open items: exit 2 means *measured regression gates passed, release
still requires review*. Treat exit 0/1/2 accordingly.

## Fixtures and privacy

Every fixture is synthetic (generated rectangles and gradients). The audit
evidence contains local `127.0.0.1` URLs only. Never commit screenshots or
fixtures taken from a real account or a third-party site.
