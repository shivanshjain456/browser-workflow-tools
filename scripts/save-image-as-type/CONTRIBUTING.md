# Contributing

Thanks for helping. This project favours **small, reviewable, evidence-backed
changes** over large rewrites: the script is installed in people's browsers and
its encoder bytes are contractually pinned.

## Ways to help

* **Bug reports** — use the *Bug report* issue form. Include the script version,
  browser and manager versions, the page context, steps, expected vs. observed
  behaviour, and the Diagnostics panel contents (redact anything private).
* **Feature requests** — use the *Feature request* form. Explain the workflow you
  are trying to complete, not just the feature name; a request that describes the
  problem can often be solved more simply than the proposed mechanism.
* **Compatibility reports** — "works/does not work on browser X, manager Y" with
  the diagnostics output is genuinely useful, even without a code change.
* **Documentation fixes** — most welcome; outdated docs are a bug.

## Before you start on code

* Read [docs/architecture.md](docs/architecture.md) for the module map and the
  invariants your change must preserve.
* Check the open issues to avoid duplicate work, and open one to discuss anything
  non-trivial *before* writing a large patch.
* Changes to encoder bytes, permissions (`@grant`/`@connect`), the storage schema
  or the metadata block are **breaking-surface changes**: describe the impact in
  the issue and expect a longer review.

## Development setup

```sh
npm ci                       # exact locked dev dependencies
node audit/preflight.mjs     # fails fast if a tool is missing
npm run build                # regenerate release/save-image-as-type.user.js
npm test                     # unit + contract tests
npm run test:browser         # browser scenarios (headless)
npm run lint
npm run verify:release       # version/metadata/docs/checksum gates
```

Python plus `Pillow`/`pypdf` are needed for the independent decoder checks:
`python3 -m pip install --user -r audit/requirements.txt`.

## Making a change

1. **Branch** from `main` (`feat/…`, `fix/…`, `docs/…`).
2. **Edit `src/`**, never the built file by hand. `release/` is generated.
3. **Add or update tests.** Pure logic → `test/unit/`. Anything needing layout,
   real input or a download → `test/browser/`. New user-supplied input should
   also get a case in `test/corpus/` if it opens a new code path.
4. **Run the checks** listed above. If you touched settings, also run
   `npm run docs:settings` and commit the regenerated reference.
5. **Rebuild the artifact** with `npm run build` and commit it together with the
   source change (`npm run build:check` fails if they disagree).
6. **Update the docs** that describe what you changed, and add a `CHANGELOG.md`
   entry under *Unreleased*.
7. **Open a pull request** using the template. Keep unrelated changes out of the
   PR; review is much faster with one coherent change.

## Conventions

* **Style:** 2-space indentation, semicolons, single quotes, LF endings (see
  `.editorconfig`). No transpiler, no minifier, no bundler framework — the
  installed file must stay human-readable.
* **No new runtime dependency.** The artifact is one self-contained file. A
  development-only dependency needs a clear justification and an exact pin.
* **Do not weaken an invariant to make a test pass.** If a check blocks your
  change, the discussion belongs in the issue, not in a modified assertion.
* **Byte goldens:** do not regenerate `test/golden/` to make a failure disappear.
  A byte change is either a bug or a deliberate, documented contract change.
* **Localisation:** every new interface string goes into *all* catalogues in
  `src/core/messages.js`; the unit suite fails on an incomplete catalogue.
* **Site-specific behaviour:** generalise it where possible (host rules, filters)
  instead of hard-coding a site. A hard-coded site fix needs a reproduction and
  an explanation of why a general rule cannot work.
* **Commits/PRs:** explain *why* in the description, keep the diff focused, and
  state what you actually ran ("`npm test`, `npm run test:browser` on Chrome 155
  headless") rather than "tests pass".

## Review expectations

* A reviewer will check: invariants preserved, tests added, artifact rebuilt,
  docs updated, no new permissions, no secret/PII in fixtures or screenshots.
* Evidence beats assertion. "It works" becomes "here is the command and the
  output".
* Expect follow-up questions on anything that changes `@grant`, `@connect`,
  storage schema, filename rules or encoder bytes.

## Reporting conduct problems

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SUPPORT.md](SUPPORT.md).

## Licensing of contributions

By submitting a change you agree it is licensed under the project's
[MIT License](LICENSE). Only contribute code you have the right to submit; do not
copy code from another userscript or extension (including the browser extension
this project is a port of) without a compatible licence and explicit
attribution.
