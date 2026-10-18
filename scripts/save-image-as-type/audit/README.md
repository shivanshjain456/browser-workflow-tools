# Verification capsule — historical 2.0.1 audit record (current candidate: 2.0.3)

**NOT publish-ready.** [The ordered master record](engineering-report.md) is the current authority. Broad S1 functionality/fidelity/resource requirements, normative study and other acceptance obligations remain unfinished. Passing regression gates is not acceptance of the 75-item brief. All 35 Domain9 dispositions remain explicit; a future release number is not an accepted S1 waiver.

## Supported development setup

- **Node >=22.22.2** (executed22.22.2), npm; Python3 (executed3.13.16), `file(1)`.
- `npm ci` installs only development dependencies. Puppeteer25.14.0 downloads the development Chrome; no such dependency exists in the installed userscript. Direct imports jsdom25.0.1, esprima4.0.1 and js-tokens4.0.0 are explicitly pinned.
- `python3 -m pip install --user -r audit/requirements.txt`, or an isolated environment containing those pinned packages: Pillow12.3.0, pypdf6.21.0.
- Linux Chrome libraries must be installed (NSS/NSPR, ATK/AT-SPI, CUPS, Xdamage, xkbcommon, ALSA in the tested environment). Distro names differ; missing libraries fail preflight. To locate the default executable with the asynchronous Puppeteer25 API:

```sh
CHROME=$(node --input-type=module -e "import p from 'puppeteer'; console.log(await p.executablePath())")
ldd "$CHROME"
node audit/preflight.mjs
```

The default fixture browser is **Chrome155.0.8059.79**. The actual-manager lab below deliberately uses **155.0.8059.84**; do not conflate them. Historical Node20/Chrome131 records are retained and labelled, not relabelled as new runs. The remediated locked development tree's measured npm audit is **0 vulnerabilities**, down8 high (`npm-audit-remediated.json` versus historical `npm-audit-current.json`). New advisories can change this; rerun `npm audit` rather than treating the receipt as a perpetual guarantee.

## Repository-level gates

The published repository adds user-facing gates on top of this capsule:

```sh
npm run verify:release        # version/metadata/grant/checksum/doc-link agreement
npm run docs:settings         # regenerate docs/reference/settings.md from the schema
python3 scripts/make-repository-zip.py   # publishable repository snapshot
```

`audit/evidence/clean-checkout.txt` is the log of those gates plus 577 unit tests,
57 browser scenarios and independent decoder checks run from a fresh extraction of
the repository snapshot in an unrelated directory.

## Combined regression command

```sh
node audit/verify-all.mjs
```

Runs preflight, build/lint, all units, two fixture-browser runs, exact-source boot/UI/attack probes, independent goldens and source-hash-bound evidence assertions. It never installs/downloads prerequisites. Logs are under `audit/evidence/pipeline-*`. Unit count must match the manifest with zero failures/skips/cancellations/todos; an empty discovery is an error. Exact-source reports and manifest must identify the current runtime; the runner also detects an artifact changed during verification.

**Current expected exit is2: measured regression gates passed; full release blocked.** Exit1 is a prerequisite/test/evidence failure. Neither exit2 nor 577 passing tests means the entire brief is done. Actual manager reruns, limited rollback and optional semantic study are separate commands, not silently emulated stages in this runner.

Current executed gates: **577 units /100 suites**, **27 lint**, **57 instrumented browser scenarios twice**, six original-pinned golden outputs independently parsed and byte-exact. `test/run-unit.mjs` enumerates explicit file paths because Node22+the explicit loader rejects the former test-directory import. Failure receipt is retained; no tests were suppressed to fix it.

## Individual checks

From the package root, after setup:

```sh
node build.mjs --check
node lint.mjs
npm test
npm run test:browser
node audit/verify-contract.mjs
node audit/independent-goldens.mjs
python3 audit/verify-production-pixels.py
```

The last command checks the saved PNG from the most recent exact-production browser probe, not the fixture build. To regenerate the complete current report set, use the combined runner rather than invoking assertions against stale files. `node build.mjs` regenerates the single readable runtime; `--check` never rewrites it.

## Actual Violentmonkey lab — separate, Linux x86_64

```sh
python3 audit/prepare-vm-lab.py
node audit/manager-lab-setup.mjs
node audit/real-manager.mjs vm
python3 audit/verify-manager-outputs.py vm
```

These are explicit **development** operations. Preparation downloads the official VM2.49.0 MV3 ZIP, verifies its fixed SHA256 before safe extraction, and installs the pinned Chrome155.0.8059.84 development binary via the locked Puppeteer browser installer. No extension/browser binary or personal profile is distributed. The lab lives under ignored `.local/manager-lab/`; do not point it at a personal browser profile. OS dependencies still apply.

The native setup uses Chrome's normal **Allow User Scripts** switch and the manager's **New from file / Save & Close** UI. It does not write manager storage to install the script, paste a giant editor document, bypass permissions, or inject fake GM APIs. A fresh source-hash-derived profile avoids duplicate imports. Current report checks the installed source SHA against the distributed artifact. VM is an unchanged official distribution loaded unpacked for testing, NOT a claim of signed-store installation identity.

Measured full matrix: `/same`, `/cross`, `/csp`, `/data-csp`, `/svg-csp`; converted PNG + Original; owned manager setting persisted through reload and restored; a configuration profile captured, reloaded, applied and deleted through real buttons and manager storage; native same/cross-origin child conversions; eight actual popup commands with frames. Independent verifier requires all canonical cases and both frames, checks **11** complete snapshots, exact full RGBA for rasters, exact original raster bytes, SVG XML fixture structure, and current artifact/installed hashes. SVG raster under strict CSP fails explicitly; OriginalSVG works. This is not an all-site/OS/manager certification.

Tampermonkey5.5.1's exact-source installation and a minimal control were tried separately; neither injected in the measured lab. This remains **inconclusive**, not a pass or proof of product incompatibility. Do not present fake-manager fixtures as resolving it.

## Reversal and G-67 investigation

```sh
python3 audit/check-rollbacks.py
```

Reverses each of three new source+regression-test groups separately in disposable clones, retaining the other groups. Acquisition reversal569 tests; long-press reversal574; frame-command reversal576; each builds fresh and passes27 lint. Original byte goldens stay checked. Feature tests are removed only with the intentionally removed feature; no claim that a reversed feature still works. Reports and readable unified patches are retained. Earlier hardening groups are NOT certified by this tool.

Optional original-attachment semantic exercise:

```sh
node audit/study-profiles.mjs /path/to/competitor-A.user.js /path/to/competitor-B.user.js
```

Requires A MD5 `2bdcd447318a9b576d2184c7647fb574` and B `5772b531f84325987730792cb6435ba4`; refuses changed inputs. Only selected pure functions run with no GM/DOM; byte offsets/digests recorded. No competitor implementation is inlined into runtime. Output profiles largely overlap existing presets; A's named global snapshots of language/hotkeys/rules do not. Constructed workflow analysis is NOT a user interview or demand survey, and G-67 is not permanently declined. Original competitors are not redistributed as runtime dependencies.

## Evidence boundaries

- Production `src/entry.js` always boots; no page flags/hooks or public privileged handle. `src/main.js` is side-effect-free on import; module-private ownership is NOT cross-copy arbitration. Independent source evaluations still yield8→16 fake-manager registrations.
- `audit/verify-api.mjs` is offline API contract1, not an installed-page interface.
- Unit loader explicitly bypasses event authentication for synthetic DOM fixtures. Browser harness also instruments/exposes its own separately hashed verifier build. **57 fixture passes do not validate production event authentication.** Exact-source native mouse/keyboard and synthetic attacks are separate, as is actual VM.
- CDP media preferences/root font scaling are real browser emulation. They are not OS screen-reader, RTL, mobile or all-accessibility certification. Full modal/SPA/memory-pressure/discard ownership remains open.
- Six goldens were created from MD5-verified original. PDF baseline freezes verification date; optional candidate clock leaves current-time default unchanged. ZIP uses local DOS wall time. Normal checks never rewrite goldens. No lossy native JPEG/WebP byte-golden claim.
- Independent implementations: Pillow, strict pypdf, Python zipfile/zlib, `file(1)`. Owned raw-offset/CRC helpers are not additional independent codecs. Negative missing-decoder, boundary-mutation, altered-golden, checkout-name and initial long-press/Node22-launch failures are archived.
- Current source-capsule extraction passed577/577,27lint,build freshness and independent checks from a differently named checkout. `capsule-tested-inputs.json` binds its executed code/corpus to current files; documentation/evidence receipts can be added without a self-hash cycle. Shared installed dependencies are disclosed; this is not a clean-OS installation trial or a second extracted-directory manager/browser GUI run.

## Distribution, licensing and safety

One `.user.js`, no runtime dependencies/resources/telemetry, no extra grant/persistent key/default setting. Manager-only storage. Declares canonical @updateURL and @downloadURL for manager-level updates (the script itself executes no background update checks or telemetry). Existing wildcard connect retained for consented user-selected arbitrary image hosts; detailed origin trail remains open. Source ZIP includes original/evidence checkpoints for review, not recommendations to install known older vulnerabilities or multiple copies.

Development tools are not inlined: Puppeteer (Apache-2.0), jsdom (MIT), esprima (BSD-2-Clause), js-tokens (MIT), Pillow and pypdf (their distribution licences). GIF/Graphics Interchange Format is the copyright property of CompuServe Incorporated; GIF is its service mark. Referenced specifications are not redistributed wholesale. Proprietary managers/browser binaries are not in the capsule.

`make-report.py` / `finalize-report.py` are obsolete checkpoint generators, not verification commands; running them can overwrite reviewed text with old results. `refresh-current-record.py` is specific to this measured checkpoint, not an acceptance generator. `make-package.py` only packages existing files. Runtime/ZIP checksums must be verified from `release/`; hashes establish consistency, not authenticity.
