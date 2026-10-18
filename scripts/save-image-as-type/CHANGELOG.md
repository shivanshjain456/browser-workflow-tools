# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses semantic versioning.

## 2.0.3 — integrity and verifier follow-up, 2026-10-17

### Fixed

- **Verifier crash resolved:** `audit/assert-evidence.mjs` reads verified test totals from `release-evidence.json` instead of a non-existent `manifest.gates` object, keeping `release-manifest.json` strictly derived-only.
- **Truthful permission statement:** Corrected the generated build comment in `build.mjs` to accurately explain that `@connect *` is used exclusively for user-initiated cross-origin image retrieval when page CORS blocks reading canvas pixels, removing the false "zero-wildcard" phrasing.
- **Audit documentation updated:** `audit/README.md` clarifies that canonical `@updateURL` and `@downloadURL` are declared for manager-level updates with zero in-script background checks, and clearly bounds historical 2.0.1 audit records.
- **Release notes corrected:** Synchronized tracked `docs/release-notes-2.0.2.md` and public Release notes with true published LF checksums.
- **Evidence provenance:** Re-ran actual Violentmonkey manager lab on the exact candidate artifact, eliminating stale SHA discrepancies in `vm-production.json` and `release-evidence.json`.

## 2.0.2 — consistency and release-engineering fixes, 2026-10-17

### Fixed

- **Permission metadata restored.** `@connect *` is declared again, matching the documented model,
  `lint.mjs`, the release gate, the security tests and the in-product explanation. No runtime
  behavior changed.
- **One canonical artifact.** The duplicate root-level `save-image-as-type.user.js` is removed.
  `@downloadURL`/`@updateURL` now point at `release/save-image-as-type.user.js`, the file that every
  gate, checksum and document already describes.
- **Icons are inline again.** `@icon` is a self-contained SVG data URI; installing the script no
  longer fetches an image, so "no network except the image you asked for" is literally true.
- **Namespace restored** to the stable `https://siat.invalid/save-image-as-type` identity so an
  upgrade cannot register a second copy of the script.
- **Release manifest is derived-only.** Verification claims moved to
  `audit/evidence/release-evidence.json`; a rebuild can no longer leave stale gate results next to
  fresh bytes.
- **Documentation corrected:** README no longer claims WebCodecs encoders, DEFLATE ZIP compression,
  grayscale/invert transforms or bare `C`/`A` shortcuts; installation, privacy and security pages
  describe the real update channel and the restored `@connect`; all owner/repo placeholders
  and the stale install path are gone.
- **Repository-level statements corrected:** the compatibility matrix scopes its rows to the six
  scripts that were actually tested, the root README/PERMISSIONS matrix no longer reports this
  script as offline-only, and a root `LICENSE` (MIT) was added.
- **CI now tests this package.** A path-filtered workflow runs lint, the release gate, the build
  check, the generated-doc check, the unit suite and the browser suite for
  `scripts/save-image-as-type/`. The inert nested `.github/` tree was removed.
- **Evidence re-bound** to the 2.0.2 artifact hash.

## 2.0.1 — unreleased engineering candidate, 2026-10-16

### Added — repository and release engineering (publication package)

- **Public repository scaffolding:** README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, CODEOWNERS-free issue forms, pull-request template, Dependabot configuration, `.editorconfig`, `.gitignore`.
- **Documentation set:** installation, user guide, configuration, settings reference (generated), advanced usage, compatibility, privacy and permissions, troubleshooting, development, architecture, release process and a publication checklist. Every relative link is checked by the release gate.
- **Release gates in code:** `npm run verify:release` (version agreement across five locations, metadata validity, grant parity, checksums, generated-doc freshness, internal links, owner-decision report), `npm run docs:settings` (regenerates the settings reference from `src/core/settings.js`), and `build.mjs` now keeps `release/release-manifest.json` and `release/SHA256SUMS` in step with the bytes it writes.
- **CI workflows:** `.github/workflows/ci.yml` (lint, release gates, staleness, unit, browser, independent decoders on PRs and `main`) and `.github/workflows/release.yml` (manual, tag-named; re-runs the gates and attaches the userscript, source capsule and checksums to an existing GitHub Release). Actions are pinned to commit SHAs; PR jobs are read-only and secret-free.
- **Source clarity:** doc comments added above the settings that lacked them, so the generated settings reference explains every key.
- **Test hygiene:** metadata fixtures (EXIF/GPS/XMP/ICC) are now generated into the gitignored `.tmp-browser/fixtures/` directory instead of `test/fixtures/`, so a test run cannot dirty a fresh checkout; the browser harness serves generated fixtures first and falls back to committed ones.
- **Documentation accuracy gate:** the release gate now also verifies that the eight manager-command labels and six menu-action labels appear verbatim in the user-facing docs, after a review of `docs/assets/manager-commands.png` (captured from the actual-manager lab) showed an earlier draft used paraphrased command names.

### Added

- **Configuration profiles (G-67).** Named snapshots of the whole configuration (formats, quality, naming, shortcuts, batch/site behaviour) captured from the current setup and re-applied with one button in Settings. A profile is a complete validated settings object: it cannot contain profiles, cannot widen the schema, and is clamped by the same rules as the live settings. New strings live in `src/core/messages.js` with complete English, Arabic and Hindi catalogues plus RTL direction; the pre-existing interface is still English-only and is not claimed as localised. One new default (`profiles: []`) keeps behaviour unchanged, is carried in the existing schema-3 storage key and JSON export, and is ignored by older builds.

**Release blocked:** the full 75-item work order is not complete. Removing the public privileged marker means two independent script evaluations register duplicate commands. No claim of cross-manager arbitration or completed strict functional superset.

- Removed production DOM/window capability publication and both page-writable autoboot switches; trusted source imports and private same-module ownership replace them. Startup promise failures are contained; failed construction clears ownership.
- Added an owned UI event boundary rejecting page-synthesised interaction events. Keyboard menu activation invokes the owned action directly instead of emitting `.click()`. Explicit offline verifier transforms preserve synthetic-event logic tests without shipping a runtime bypass.
- Isolation now reports unknown (`null`) rather than an unconditional true.
- Added own-data-only bounded settings/preset ingress before migration/merge/import/remote sync; no accessor execution or inherited fields; schema scalar coercion never invokes external object conversion hooks.
- Fixed dotted and superscript Windows device stems, post-truncation reserved names and empty multibyte stems. Actual Windows filesystem tests remain unavailable.
- Relative typography with 12px floor and shared reduced-motion/forced-colours/contrast styles, observed under Chrome-emulated preferences; no screen-reader certification.
- Corrected description to include probe-gated AVIF and Original. No new grants, network destinations, storage keys or default settings.
- Added fingerprinted original, six pinned encoder outputs, independent decode/structural evidence, fail-closed tool preflight, hostile/mutation tests, documented offline verification API, complete baseline triage and named superset dispositions. PDF optional `now()` clock retains existing default current-time output behaviour and permits byte-exact verification.
- Fixed G-85 structured acquisition-byte cache so held manager bytes serve Original/inspection without a redundant request; added CSP fallback using owned bitmap leases and local data URL decoding. Strict-CSP SVG raster remains explicitly unsupported in the measured lab; OriginalSVG succeeds. No CSP weakening or new privilege.
- Fixed pending/completed/replaced long-press ownership; register eight manager commands only in the top document while retaining child image interaction.
- Remediated eight high development dependency findings to0 with Puppeteer25.14.0 and Node>=22.22.2; pinned direct maintainer imports. Node22 test entry enumerates explicit files, refuses empty discovery, and propagates failures. No runtime third-party library added.
- Re-executed561 units/96 suites,27 lint,57 fixture-browser scenarios twice, six original byte goldens, exact-source security/native input/preference probes, actual VM2.49.0 canonical five/settings/frames and11 independent downloads. TM5.5.1 remains inconclusive. Recent three source/test groups reversed separately and remaining553/558/560 units passed.
- G-67 source/workflow exercise confirms A named global snapshots are not subsumed by existing presets; no user-demand evidence or final decline invented. Full engineering acceptance remains blocked.

## 2.0.0 — 2026-10-16

### Exactly ten added feature sets

1. **Batch conversion:** preview/confirm, multi-format outputs, bounded concurrency, progress, cancel and safe retry.
2. **Page inventory/picker:** dimensions/type/origin/state, search/filter/sort, local thumbnails and selection.
3. **ZIP export:** one download for a selection/batch; UTF-8 names, collision suffixes, CRC-32 and buffer limits.
4. **Transform before save:** resize, aspect lock, presets, crop, 90° rotation, flips, preview and stored defaults.
5. **Image clipboard:** browser capability/MIME detection, PNG re-encoding and actionable permission failures.
6. **Filename templates:** validated tokens, live settings preview, counters and per-run collision handling.
7. **Presets + per-host auto-apply:** reusable format/quality/naming/transform/destination choices with explicit rules.
8. **Format comparison:** actual encoded byte counts, transparency-aware smallest-good choice and save confirmation.
9. **Metadata inspector/sanitizer:** EXIF/GPS/XMP/ICC findings and supported metadata stripping without pixel re-encoding.
10. **Keyboard workflow/help:** hover-target modifier chords, custom binding validation, help and digit menu selection.

### Foundations and fixes (not counted as features)

- Shared labelled shadow-DOM modal primitive, focus/Escape lifecycle, bounded scan/preview/observer ownership.
- True concurrent queue dispatch (tested with peak-active counters), timeout classification and destroyed-queue guards.
- Preset quality 0 retains “inherit” through import/reload; default transforms reach single and batch conversions.
- Correct EXIF string/byte marker detection and WebP size reads; independent Pillow fixtures verify GPS removal
  and pixel identity, rather than testing a reader against its own writer.
- Correct picker single-row argument routing, transform format IDs/readout, aspect lock after crop/rotation,
  stale/out-of-order preview release, and batch-dialog option overrides/Start guards.
- Bounded frame/style scans and proper sibling traversal; SVG thumbnail URLs released even on preview failure.
- GIF no longer labelled lossless in near-size comparison preference (palette quantisation is lossy).
- Reproducible source-synced v2 metadata/package version, expanded units, 19 new browser scenarios and independent
  Python metadata/ZIP verifiers. Raw final evidence and limitations documented in `docs/verification-report.md`.

### Deliberate behaviour and storage changes

- Schema v3 at **`siat.settings.v3`** reads/migrates v2 and legacy shapes without resetting valid existing choices;
  old keys remain downgrade backups. New presets, host rules, bindings and defaults are configuration only; no
  image bytes, metadata findings, browsing history or persistent job state are stored.
- Six extra right-click actions and four extra manager commands (eight total); new shared dialogs and job bar.
  Batch Cancel remains available in a toast when the job bar is hidden.
- **Safer non-idempotent recovery:** timeout, thrown, `not_succeeded` and unknown download outcomes now report
  uncertainty rather than silently starting a second browser download. Definite refusals still have the old fallback.
  Retry excludes partial/unconfirmed batch saves; check downloads and manually select missing outputs instead.
- Same ten grants and broad any-image match/connect scope as v1, with documented justifications. **No new grant,
  runtime dependency, remote executable resource or automatic update URL.** Reinstall the file manually.
- Dev-only dependency audit is not clean: eight high findings in the pinned Puppeteer download/proxy chain are
  disclosed, not suppressed; they are absent from the self-contained runtime. Real managers/public sites and
  browsers beyond the recorded headless Chrome environment remain unverified.

## 1.0.0 — first release

Userscript port of the "Save Image as Type" Chrome extension: right-click any image and save it locally in another
format. Single self-contained artifact (`release/save-image-as-type.user.js`), no `@require`, no remote code, no
telemetry.

### Added

* **Targets:** `<img>` (including `srcset`), inline `<svg>`, CSS `background-image` elements, and images inside
  iframes (no `@noframes`). Long-press (550 ms, 12 px jitter tolerance) for touch. Shift+right-click always yields
  the browser's own menu.
* **Formats:** PNG, JPG, WebP (native `canvas.toBlob`, with the returned `blob.type` verified), GIF, BMP and PDF
  (hand-written encoders), *Original file* (byte-exact passthrough), and AVIF gated behind a runtime encode probe.
* **Animated GIF** output through WebCodecs `ImageDecoder`, bounded by a frame count and a raw-memory budget, with
  honest reporting when frames cannot be read.
* **Settings** (shadow-DOM modal, keyboard operable, export/import/reset): menu formats, instant download vs. Save
  As, file-name prefix, sub-folder, max name length, flatten background, JPEG/WebP quality, PDF page fit, animation
  and memory limits, downscale threshold, cross-origin fetch switch, background-image and long-press toggles,
  Shift-only mode, remember-last-format, error notifications. Stored under `siat.settings.v2` with a migration from
  the pre-schema (v1) shape.
* **Manager integration:** four `GM_registerMenuCommand` entries (Settings, Convert last hovered image, Capability
  report, Pause on this page); download strategy chosen from `GM_info.downloadMode` with fallbacks to a browser
  `<a download>`; `GM_notification` for failures.
* **UI hygiene:** all UI lives in shadow roots, text is written only via `textContent`, the toast stack is capped at
  four and lets clicks through, the menu is clamped inside the viewport and dismissed on scroll/resize/blur.
* **Tooling:** dependency-free bundler with a staleness gate (`build.mjs --check`), 23 static lint checks
  (`lint.mjs`), 204 unit tests, 38 browser end-to-end scenarios over two local origins, and independent media
  verification with Pillow/pypdf (`test/helpers/verify_media.py`).

### Fixed during development (each found by a test, not by inspection)

These are recorded because they are the failure modes most likely to return:

* **Settings dialog could not be dismissed** — `panel.js` defined `open()`/`close()` only as methods of the returned
  object, so the internal calls resolved to the page's `window.close()`/`window.open()`: Cancel, Escape, the ✕ and a
  successful Save all did nothing (leaving a full-screen backdrop swallowing every click), and *Reset defaults*
  opened a blank popup tab. Fixed by hoisting both into real closure functions; a lint rule
  (`no-implicit-page-globals`) and 10 unit tests now guard the class of bug.
* **A second instance per page** — the idempotency marker was written to `document.documentElement` when it existed
  and to the `Document` otherwise, but only ever read back from one of them. Booting at `document-start` (no `<html>`
  yet) meant a later injection could not see the first instance and started a second: duplicate listeners, duplicate
  manager menu commands, and toasts from two owners in one stack. Fixed by reading/writing the marker on every root
  (`document`, `<html>`, `<body>`, `window`) before the first `await`, with a `ready` flag for callers; verified with
  CDP `DOMDebugger.getEventListeners` counts in the browser suite.
* **Menu vanished when the page was still settling** — any `scroll` event dismissed the menu, including the one a
  page emits right after `scrollIntoView`/smooth scrolling, so the menu flashed open and shut. Fixed with a 150 ms
  grace window that applies to `scroll` only (resize, blur and pagehide still dismiss immediately).
* **Animated GIF silently lost its animation** — frames can only be read from the encoded bytes, but same-origin
  images are acquired as pixels, so `keepAnimation` had nothing to work with and no note explained the loss. The
  source file is now re-read for the animation path (same-origin via `fetch`, cross-origin only through the manager
  and only when the user left that switch on), and a failure to read it is disclosed in the toast.
* **Chromium reports `0×0` on a GIF `ImageDecoder` track** until a frame is decoded, which made the script give up
  and write a single frame. Frame 0 is now decoded to learn the real dimensions and then reused.
* **`ImageDecoder` was handed a whole allocation pool** — `bytes.slice().buffer` on an offset view (a Node `Buffer`,
  or a subarray of a larger fetch) passes unrelated memory to the decoder. Replaced with an exact-size copy.
* **Toast stack bound was per-instance** — with the shared host adopted by a second instance (two managers installed
  at once), each capped its own entries and the visible stack could exceed four. The bound is now enforced on the
  nodes actually on screen.
* **"Settings were repaired" on every page load** — a manager without a storage grant was reported as a *recovery*,
  which triggered the repair toast everywhere. It is now reported honestly as a limitation (memory-only storage) in
  the settings panel and diagnostics, without claiming damage.
* **`menu.attach()` stacked listeners** — it was called after every settings save with no idempotence guard.
* Earlier fixes from the encoder and core work: GIF `expandChannel >> 5` darkened saturated colours; the GIF frame
  delay was read one byte early; percent-decoding destroyed multi-byte UTF-8 and `data:`/`blob:` base names; the
  classic-API override probed only the capital-H `GM_xmlHttpRequest` spelling; unversioned current-schema settings
  were routed through the v1 migration and lost keys; a first run was reported as a recovery; long-press accumulated
  three document listeners per touch-down; `ensureHost()` duplicated the menu host; and a missing `GM_xmlhttpRequest`
  grant was blamed on the cross-origin *setting* instead of naming the grant.

### Known limitations

See README §7. In short: not verified inside a real Tampermonkey/Violentmonkey installation; AVIF hidden where the
browser cannot encode it; GIF animation requires a secure context; sub-folder and forced Save As require
browser-API download mode; PDF output is a single JPEG-embedded page.
