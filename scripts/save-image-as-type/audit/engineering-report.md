# Save Image as Type — remediation engineering record

**Status: work in progress; NOT a completed superset release or a claim that the brief’s Definition of Done is met.**

This is the single ordered master document. Evidence paths are relative to the source-package root. A deferred release number is a planning boundary, not a delivery promise. Claims about real managers, public sites, Windows filesystems, colour fidelity, or assistive technology are unverified unless explicitly marked otherwise. Nothing in this record substitutes fixture emulation for actual manager testing.

## 1. Phase 0 — verified baseline

Attachment `save-image-as-type (2).user.js` is byte-identical to the repository’s v2.0.0 artifact. Measured with Python hashlib, md5sum, wc, Node tests and Chrome CDP:

- Bytes **573,476**; newline count **14,641**; MD5 **ed285e423b3e85b5da38e9798423581c**; SHA-256 **2eb8851b422393ebe9d14ef5a0bd11874abac03fd76a28328d6fae6ff280daed**. Fingerprint prerequisite passed.
- Node 20.20.2; Python 3.13.16; Puppeteer 23.11.1; Chrome 131.0.6778.204, headless Linux. Pillow/pypdf versions are captured in the final evidence inventory.
- `npm ci`, then `npm test`: first run produced only 488 tests because missing pypdf silently omitted independent suites; after installing pypdf the full **513/90 suites passed**, zero failures/cancellations/skips. This is a newly reproduced infrastructure defect, not a lower baseline accepted as equivalent.
- `node lint.mjs`: **23/23**. `node build.mjs --check`: artifact in sync.
- `npm run test:browser`: **57/57** fixture scenarios; no skips. Reports: `audit/evidence/baseline-{unit-full,lint,build,browser}.txt`, `baseline-browser.json`.
- Dedicated production probe: `node audit/probe-production.mjs audit/baseline/v2.0.0.user.js audit/evidence/baseline-production.json`. Clean HTTP origin registers 8 commands, exposes privileged API on four roots; page code successfully writes through API. Preseed, global flag and DOM attribute each yield zero commands. These are executed attacks in a shared CDP world with a fake manager, NOT live TM/VM exploits.
- Ten same-origin child frames yield 11 boots / 88 registered commands. This establishes multiplication, not a duplicate-download exploit.
- A real local HTTP response with `Content-Security-Policy: default-src 'none'; img-src 'self'; ...` blocks the test data image and emits `img-src` / `data`. This is an actual browser-enforced strict-CSP origin, not a public bank/social-site compatibility result.
- Existing tests independently parse BMP, GIF, PDF and ZIP and validate metadata strips. Boot/no-page-storage and no-extra-origin assertions in the browser suite are fixture-scoped. Initial storage wrappers in the production probe do not intercept every possible Storage prototype call; they are supplementary, not proof of universal absence.

### Performance baseline (refreshed Chrome155 probe; original unit/browser baseline above remains historical)

The original MD5-verified bytes were re-probed under Node22.22.2 / Puppeteer25.14.0 / Chrome155.0.8059.79 to match the current candidate toolchain. See Section10 for paired repeat/variance results. The original 513-unit /57-browser suite logs above remain the initial Node20/Chrome131 baseline, not a freshly claimed rerun.

### Disagreements and qualifications

Batch confirmation is already implemented, including Alt+Shift+A → preview/Start; G-72’s no-confirmation account is wrong. `srcset` candidates are inventory entries selectable through the picker. The source repository has the cited build/lint/tests and a changelog, but they were not delivered as a public verification capsule. Source readers cannot infer that native decode ignores ICC: that part of G-07/G-11 is not established. G-01’s preseed object is returned before API construction; it suppresses boot, but the claim it receives newly defined privileged methods is disproved by control flow and the executed preseed result. `sandboxed` is not displayed by the panel at all. Eight manager commands are static workflow commands, NOT eight format commands, so format toggling does not leave stale format command entries.

## 2. Phase 1 — triage register (baseline, not resolution status)

Search scope: original attachment plus all `.js` under `src/`, not `node_modules`. Located by module exports/call graph and case-insensitive capability term searches; `audit/evidence/search-index.json` records query patterns and line hits. A zero-hit search only supports absence with the documented scope and call-graph reading; it is not a proof of absence by itself. Execution evidence uses the full baseline unit/browser logs unless a dedicated probe is named. “Confirmed” can establish a static missing path; it does NOT mean an impact magnitude was measured. Where a source claim and a live-compatibility claim differ, the latter remains unverified.

| ID | Classification | Location | Evidence / disproof | Planned boundary |
|---|---|---|---|---|
| G-01 | Partially confirmed | `src/main.js: bootstrap markerRoots / API publication` | Executed clean same-world page can invoke gm.setValue; preseed returns fake and suppresses boot. Refuted subclaim: no privileged methods are copied onto the preseeded object, because bootstrap returns before constructing them. Real managers not tested. | 2.0.1 |
| G-02 | Partially confirmed | `src/core/gm.js: sandboxed; src/ui/panel.js: diagnostics` | Expression is tautological with info. sandboxed is not used by panel or main diagnostics; false assurance in the displayed panel is not reproduced. | 2.0.1 |
| G-03 | Confirmed | `src/main.js: isTestHarness` | Executed flag and DOM attribute attacks suppress boot. Node imports currently depend on the flag. | 2.0.1 |
| G-04 | Partially confirmed | `src/meta.js: connect; src/core/source.js: acquisition` | Wildcard and consent confirmed. Narrowing breaks arbitrary-CDN tool. Justification already exists in src/meta.js and README, but not origin trail. | 3.0.0 |
| G-05 | Partially confirmed | `src/core/settings.js: migrate/normalize/import/store; src/core/presets.js: normalizePreset` | Unguarded merges confirmed; field validation does not equate to demonstrated global pollution exploit. Inherited values can be accepted. Hostile-channel tests required. | 2.0.1 |
| G-06 | Partially confirmed | `src/core/filename.js header; lint.mjs; build.mjs header` | There is already a filename threat model and runnable invariant lint in repository. Standalone distribution lacks the complete model and lint. | 2.0.1 |
| G-07 | Partially confirmed | `src/core/raster.js:createCanvas; src/core/transform.js` | No explicit canvas gamut policy. Actual P3 conversion/clipping magnitude not measured; browser decoding may honour ICC on input, so 'neither honoured' is not established. | 3.0.0 |
| G-08 | Partially confirmed | `src/core/formats.js; src/core/compare.js` | Native encoding/control gaps confirmed; comparison already says actual bytes and near-tie rationale. Browser-specific labelling needs work. Size wins quoted in brief unmeasured. | 3.0.0 |
| G-09 | Partially confirmed | `src/core/raster.js:drawToCanvas; src/core/transform.js` | Single high-smoothing path confirmed. Quantified visual loss versus reference not established. | 3.0.0 |
| G-10 | Confirmed | `src/encoders/pdf.js; src/core/convert.js` | Single-page JPEG DeviceRGB writer confirmed; existing independent PDF tests pass. Transparency/lossless PDF not offered. | 3.0.0 |
| G-11 | Confirmed | `src/core/metadata.js; src/core/convert.js` | Readers and strip path present, re-encode metadata writer absent. Existing metadata tests demonstrate strip, not preservation. | 3.0.0 |
| G-12 | Confirmed | `src/core/filename.js:WINDOWS_RESERVED` | Dotted device stems survive anchored whole-string test. Actual Windows filesystem not available; acceptance limited to published reserved-name rules. | 2.0.1 |
| G-13 | Partially confirmed | `src/main.js:waitForPendingImages; src/ui/picker.js; raster.loadImage` | Real local HTTP origin with strict CSP emits img-src violation for data image. preload conflates error/load; raster.loadImage already rejects errors. Public strict-CSP site not tested. | 3.0.0 |
| G-14 | Partially confirmed | `src/encoders/gif.js; src/core/raster.js; src/core/queue.js` | Browser repeated GIF timings show main-thread stalls (raw production probe). No worker pipeline. Native encoding may run browser-internal threads; claim all decoding is synchronously on main thread too broad. | 3.0.0 |
| G-15 | Confirmed | `src/core/transform.js:MAX_TRANSFORM_PIXELS; src/core/raster.js` | Hard ceiling but no general preflight budget tiers. Memory pressure/tab kills not induced. | 3.0.0 |
| G-16 | Partially confirmed | `src/meta.js:noframes/runAt; src/main.js` | Executed 10-child fixture boots 11 instances and registers 88 commands. Frames deliberately supported and documented, so 'no policy' overstated; duplicate conversion across nested frames not reproduced. | 3.0.0 |
| G-17 | Cannot determine | `src/main.js:markers` | Different-world marker visibility is manager-specific. No actual dual-manager installation available. Existing same-world fixture does not establish cross-manager arbitration. | 3.0.0 |
| G-18 | Partially confirmed | `src/main.js:onPageHide; README limits` | Cancel/revoke on navigation and no durable queue confirmed. Files already downloaded are not thrown away. Actual discard/crash not tested. | 3.0.0 |
| G-19 | Partially confirmed | `src/ui/menu.js; src/core/scan.js; src/main.js:destroy` | Call-site imbalance is not a leak proof. Existing teardown tests pass but full lifetime inventory absent. | 3.0.0 |
| G-20 | Confirmed | `src/ui/*; src/core/settings.js` | Inline English and no message catalogue. Exact distinct user-facing string count requires semantic extraction; raw literal count is not a truthful substitute. | 3.0.0 |
| G-21 | Confirmed | `src/ui/* CSS` | No explicit dir/logical layout strategy. No translated RTL UI available to observe. | 3.0.0 |
| G-22 | Partially confirmed | `src/ui/* CSS` | Pixel font sizes confirmed. Shadow DOM does not inherently defeat all browser zoom/minimum-font mechanisms; actual override behaviour unmeasured at triage. | 2.0.1 |
| G-23 | Partially confirmed | `src/ui/toast.js; src/ui/* CSS` | Forced-color rules missing, reduced-motion coverage limited. Claim hex always overrides forced system palette is not generally true; actual rendering must be observed. | 2.0.1 |
| G-24 | Confirmed | `src/core/presets.js; src/main.js:pause command` | Page-session pause exists, persisted host disable does not. | 3.0.0 |
| G-25 | Partially confirmed | `src/meta.js:description; README format table` | Description omits AVIF/original; long README covers them. Platform compliance verdict not established by an actual moderator. | 2.0.1 |
| G-26 | Confirmed | `src/meta.js:identity comment` | No maintained public support/homepage supplied. Cannot invent a serviceable URL; offline evidence/report path feasible but not equivalent to maintainer support. | 3.0.0 |
| G-27 | Partially confirmed | `src/meta.js:grant; src/core/gm.js` | Only legacy declarations and dual runtime probes confirmed. Actual namespace-only manager grant behaviour not tested; blanket compatibility claim withheld. | 3.0.0 |
| G-28 | Partially confirmed | `build.mjs; src/meta.js; CHANGELOG.md` | Repository has changelog and executable version freshness tests. Single standalone file does not include or link them. Duplication is build-stamped, not independent manual constants. | 2.0.1 |
| G-29 | Partially confirmed | `build.mjs; lint.mjs; test/unit/*` | All referenced infrastructure exists and ran locally, refuting absence from repository. It was not packaged beside standalone deliverable; distribute runnable source capsule. | 2.0.1 |
| G-30 | Partially confirmed | `src/main.js final block; src/core/* module exports` | Production seam exists. Source ESM already supports headless import directly, so not the only route when repository is provided. | 2.0.1 |
| G-31 | Partially confirmed | `test/unit/encoders.test.mjs; encoders-zip.test.mjs` | Independent structural tests already exist and pass. No pinned golden-byte corpus found. Pin before modifying encoders. | 2.0.1 |
| G-32 | Confirmed | `src/encoders/* headers; docs` | Comments exist but spec/omission matrix absent. | 3.0.0 |
| G-33 | Partially confirmed | `src/main.js:ensureSettings().then / idle / bootstrap` | Many async paths catch/report errors, but final try/catch cannot catch rejected async bootstrap. Global host-page error handlers would wrongly capture site failures; use owned-task funnel. | 2.0.1 |
| G-34 | Confirmed | `src/ui/panel.js:buildDiagnosticsSection` | Diagnostics table only; settings export exists but is not diagnostics export. | 3.0.0 |
| G-35 | Partially confirmed | `src/main.js:ensureCapabilities; src/ui/panel.js` | Per-use messages confirmed; eager settings-repair notices already exist. No once-per-environment missing-storage warning. | 3.0.0 |
| G-36 | Partially confirmed | `src/ui/transform-dialog.js; src/core/transform.js` | No undo stack. Source pixels are not destructively modified and preview rebuilds from original; 'destructive' refers output/default choice, not loss of source. | 3.0.0 |
| G-37 | Confirmed | `src/core/transform.js; src/ui/transform-dialog.js` | No pixel redaction modes. Need established by commission, not independently studied user population. | 3.0.0 |
| G-38 | Partially confirmed | `src/core/formats.js; src/core/frames.js` | Listed extra formats absent as outputs. Evidence of actual population demand not supplied beyond brief; distinguish needed icon rasters from ICO container. | 3.1.0 |
| G-39 | Confirmed | `src/ui/compare-dialog.js; src/ui/inspector.js` | Findings and comparison result have no portable report export. | 3.0.0 |
| G-40 | Partially confirmed | `src/core exports; docs` | ESM exports discoverable via source and JSDoc but no stable external ABI promised. A count of top-level bindings is not a public API. | 2.0.1 |
| G-41 | Confirmed | `src/core/source.js:resolveImageTarget` | No VIDEO target path. Poster discovery exists in scan. Cross-origin/DRM behaviour not tested because no live capture implementation. | 3.0.0 |
| G-42 | Confirmed | `src/core/clipboard.js` | Clipboard writes only, no read or paste intake. Browser clipboard write tests pass, not intake tests. | 3.0.0 |
| G-43 | Confirmed | `src/ui/panel.js file input; src/main.js` | File input imports settings only, no media intake. | 3.0.0 |
| G-44 | Confirmed | `src/main.js; src/core/source.js` | No user-entered URL action; internal URL acquisition already works for DOM-derived sources. | 3.0.0 |
| G-45 | Confirmed | `src/meta.js:match` | HTTP(S)-only metadata. Injecting via CDP into file page would not test real manager matching; actual file manager test unavailable. | 3.0.0 |
| G-46 | Partially confirmed | `src/core/source.js:resolveImageTarget; src/core/scan.js` | Input-image/link actions absent. Scanner srcset variants are inventory entries and can be selected through picker, so categorical nonselectability refuted. | 3.0.0 |
| G-47 | Partially confirmed | `src/core/scan.js; src/main.js:batch path` | Explicit scan 'materialise' action absent; known URLs of not-loaded entries can already be acquired when included in batch. Not equivalent to forcing site's JS lazy loader. | 3.0.0 |
| G-48 | Confirmed | `src/encoders/pdf.js; src/ui/batch-dialog.js` | No PDF batch destination or multipage page tree writer. Existing writer is one page. | 3.0.0 |
| G-49 | Partially confirmed | `src/core/frames.js; src/core/formats.js` | APNG detection exists, native frame decode browser-gated. Not full independent APNG decode. APNG output absent. | 3.1.0 |
| G-50 | Partially confirmed | `src/core/formats.js registry; convert native path` | Own-PNG missing, but engine/transparency/quality fields already are machine-readable; registry idea not entirely absent. | 3.1.0 |
| G-51 | Confirmed | `src/core/formats.js; src/encoders/zip.js` | No icon-size set action, although resize and ZIP primitives exist. ICO writer and PNG raster ZIP are different capabilities. | 3.1.0 |
| G-52 | Confirmed | `src/ui/batch-dialog.js; src/main.js` | No contact sheet action or encoder path. | 3.1.0 |
| G-53 | Confirmed | `runtime full-source search` | No QR encoder/action found. Peripheral generation explicitly eligible for decline. | Declined |
| G-54 | Partially confirmed | `src/core/frames.js; src/core/convert.js` | No average-frame policy. Existing report.notes already disclose some animation degradation, so 'every loss silent' false. | 3.1.0 |
| G-55 | Confirmed | `src/core/compare.js; src/core/convert.js` | Comparison measures bytes but no bounded target-budget search. | 3.1.0 |
| G-56 | Confirmed | `src/core/source.js:mimeFromUrl; frames detection` | HEIC/HEIF/JXL identification absent; universal decoding not promised by browsers. | 3.0.0 |
| G-57 | Confirmed | `src/main.js:state; src/core/settings.js` | No persisted conversion history. Queue snapshots are transient, not history. | 3.0.0 |
| G-58 | Confirmed | `src/ui/*; src/main.js` | Dialog badge styles only; no saved-on-page marker layer. | 3.1.0 |
| G-59 | Confirmed | `src/main.js:lastFormat; src/core/settings.js` | lastFormat is page-session only. Presets can carry site format but aren't learned per-host memory or fixed order. | 3.0.0 |
| G-60 | Partially confirmed | `src/core/scan.js:dedupeEntries; src/main.js` | URL dedupe exists; byte identity/perceptual preview absent. Similarity not evidence of interchangeable content. | 3.1.0 |
| G-61 | Confirmed | `src/core/scan.js:observeInventory; src/main.js` | Inventory observation only; no armed capture watcher. | 3.2.0 |
| G-62 | Confirmed | `src/ui/menu.js:hoveredTarget; src/main.js` | Hover tracking exists; no quick-save button or peek card. Not the only entry point: keyboard and manager commands already work. | 3.1.0 |
| G-63 | Confirmed | `src/ui/picker.js selection state` | Selection exists only within dialog, no persistent page-session tray. | 3.0.0 |
| G-64 | Confirmed | `src/core/shortcuts.js; src/ui/help.js` | Shortcut help is not searchable action palette; no palette found. | 3.0.0 |
| G-65 | Confirmed | `runtime full-source search` | No timed review/slideshow. Peripheral and eligible for decline. | Declined |
| G-66 | Confirmed | `src/core/presets.js; src/main.js:resolveSettings` | Host preset overlays only selected conversion fields. No arbitrary validated site setting overlay or host disable. | 3.0.0 |
| G-67 | Partially confirmed | `competitor B normalizeProfile; A profiles extraction; own presets` | Hash-verified pure-function execution now distinguishes B output profiles from A named global snapshots (language/hotkeys/site rules). Current presets do NOT subsume A. Workflow analysis exists; no user interviews. Keep investigation open, not permanently declined. | 3.0.0 investigation |
| G-68 | Confirmed | `src/ui/panel.js; src/main.js` | No internal log ring or redacted diagnostics export. No telemetry added to solve it. | 3.0.0 |
| G-69 | Confirmed | `src/main.js:ensureCapabilities; test/unit/encoders.test.mjs` | Native MIME capability probe exists, own-encoder on-demand self-test UI absent. | 3.0.0 |
| G-70 | Partially confirmed | `src/core/compare.js; src/ui/compare-dialog.js` | Explicit recommendation exists inside comparison; proactive auto save mode absent. No need to rebuild comparison. | 3.0.0 |
| G-71 | Confirmed | `src/ui/menu.js; src/core/clipboard.js` | No open/copy source address/copy data URI actions. Grant-free window.open/Clipboard API plausible but manager/browser behaviour untested. | 3.0.0 |
| G-72 | Partially confirmed | `src/main.js:handleShortcut saveAll; src/ui/batch-dialog.js` | Refuted high-volume unconfirmed shortcut claim: saveAll calls openBatchDialog, preview then Start. Filename edit and crop ratios absent; plain save preview absent. | 3.0.0 |
| G-73 | Partially confirmed | `src/main.js:gm.registerMenuCommand` | Eight commands do not include per-format entries; disabling formats therefore does NOT leave eight stale format commands. Labels static and callbacks read current settings; dynamic expansion is absent, not a reproduced defect. | 3.0.0 |
| G-74 | Partially confirmed | `src/meta.js; src/main.js` | Same root as G-16; document-start/frame multiplicity confirmed. Timing trade-off needs measured design, not automatic adoption of competitor's idle choice. | 3.0.0 |
| G-75 | Partially confirmed | `src/meta.js:match/exclude; bootstrap` | No sensitive-host precheck; actual store injection restrictions manager-specific and not tested. Claimed inertness of all exclusions not independently verified. | 3.0.0 |

## 3. Own additions

| ID | Observed / evidence | Impact | Resolution bar | Severity / reach |
|---|---|---|---|---|
| G-76 | `sanitizePathComponent('CONvoy',{maxChars:3})` returns `CON` (executed Node). Device-name test precedes truncation. | Truncation resurrects a Windows-reserved name. | Check final component after all length operations; matrix fails if protection removed. | S2/R2 |
| G-77 | `buildFilename({base:'é',ext:'png',maxLength:4})` returns `.png` (executed Node). | Empty stem despite nonempty valid input. | Nonempty safe stem at the minimum byte budget, no invalid UTF-8. | S3/R3 |
| G-78 | `normalizeSettings(Object.create({filenamePrefix:'inherited'}))` accepts inherited prefix; v2 JSON own `__proto__` changes migrated prototype (executed Node). No mutation of global Object.prototype demonstrated. | External configuration can affect values without own schema fields. | Own-data-only neutralisation across store/import/remote/save/presets, bounded traversal. | S2/R3 |
| G-79 | First baseline test run passes 488 tests; after pypdf install it passes 513. Zero reported skips in both. | Missing independent decoders look like green verification. | Release verifier must fail preflight when required decoders are missing. | S1/R1 |
| G-80 | `bootstrap` is async; final synchronous try/catch never awaits it. | A rejected startup promise escapes failure containment. | Inject a rejecting startup task; owned error funnel receives it. | S2/R2 |
| G-81 | Golden PDF comparison differed only in CreationDate; original `encodePdf` reads current time without injection (executed byte diff). | Cross-run golden assertion is not deterministic despite the brief’s premise. | Pin an injected/frozen verification clock while preserving current-time default output. | S2/R2 |
| G-82 | Settings chooser calls `file.text()` before its existing 200000-character limit (source); fake oversized File read test constructed. | A huge file can allocate before refusal. | Refuse by size before reading and prove the read function is not called. | S2/R3 |
| G-83 | Page-authored `contextmenu` plus `.click()` reaches GM request with no public handle (executed exact candidate, synthetic-action.json). | DOM events become another unattended privileged-action route. | Owned UI entrypoints reject synthetic interaction; real pointer/keyboard paths must still save. | S1/R2 |
| G-84 | Extracted source package ran548/549: module-marker test splits an absolute path on `/save-image-as-type/`, so another extraction directory misidentifies the marker (executed). | Public verification fails outside the original checkout name. | Use relative paths from detected package root; run complete suite from a renamed extraction. | S2/R1 |
| G-85 | Actual VM cross-origin Original failed; acquired cache contains raw Uint8Array, while getBytes()/convert consumers require a `{bytes,mime}` record. | Already fetched original bytes ignored, breaking original/inspection paths. | Honour one structured cache contract, reuse held bytes without refetch; execute actual-manager Original and byte equality. | S1/R2 |

## 4. Phase 2 — threat model and invariants

### Trust boundaries

| Boundary | Data/direction and controller | Required treatment |
|---|---|---|
| page → script | DOM nodes, URL strings, image pixels, dimensions, titles, filenames; page-controlled | Treat as hostile; validate, cap, render as text; never accept privileged API roots or boot flags from page. |
| user → script | Genuine menu/keyboard/button actions, settings/import file | Preview high-volume writes; imported data remains untrusted; intent must not imply arbitrary program execution. Synthetic DOM input is not reliable proof of human identity. |
| script ↔ manager | Granted storage, requests, saves, notifications, callback payloads | Capability detection, bounded requests, explicit outcome certainty; no automatic repeat after uncertain write. Actual manager implementation is a trusted dependency with untested variants. |
| script ↔ network | Only user-selected image URL and acquisition fallbacks, remote host controls bytes/redirects | No startup traffic, executable resources, uploads or telemetry; cross-origin consent; validate image/container and size. Redirect destinations require trail in future. |
| script ↔ storage | Manager-private settings and remote change notifications | No page Storage/DB/cookie APIs; own-data-only schema validation; no persisted images or URLs added by this patch. |
| frame ↔ frame | Same-origin inventory only, browser denies cross-origin access | Bounded reads, no bypass or remote frame privilege bridge; avoid duplicate actions. Full frame boot still unresolved. |
| manager ↔ manager | Separate trusted worlds on shared untrusted DOM | No authenticated common registry exists in current architecture. Do not claim DOM markers arbitrate different managers. No privileged pointers on DOM to attempt this. |
| verifier ↔ production | Offline source imports / explicit locally constructed test build | Verifier can call internal functions; installed file has no test flag/export hook. Instrumented browser runs must carry a different hash and never be reported as exact production runs. |

### Invariants a contributor must preserve

1. Single readable distribution; no runtime imports, remote code, obfuscation or mangling. Build readability/freshness checked.
2. No network at boot, no telemetry, no uploads. Requests derive only from explicit image actions; no permissions bypass.
3. Manager storage only. No page-visible persisted settings/log/history. New persistent records require explicit disclosure/defaults/migration.
4. No DOM/window capability publication, page-writable boot gate, or untrusted object adoption. No claim of fingerprint invisibility: the UI itself is visible to the page.
5. No dynamic code or HTML parsing sinks; hostile labels use textContent. Test-only tools may evaluate local trusted code but never ship that evaluation path.
6. Bounded hostile input traversal. Ignore inherited fields, accessors, dangerous prototype keys; cap bytes/depth/nodes/list lengths before schema coercion.
7. Never claim native encoder losslessness/availability from MIME request alone; inspect actual result. Deterministic encoders retain golden bytes.
8. Unknown isolation is unknown, not true. Manager metadata is not an independently measured security boundary.
9. Cancellation releases resources; uncertain download never retried automatically. Source image is not modified by transforms.
10. Evidence labels distinguish source tests, instrumented fixture browser, exact production browser, actual manager and public-site testing.

## 5. Phase 3 — specification conformance matrix

**Study status: partial, NOT a complete specification audit.** Official documents were retrieved (titles/revisions below); the initial PDF tool exposes only the first 30 pages, which do not contain the necessary normative PDF sections. Listing a clause here is a study target unless its bytes are backed by the executed independent suite. No new binary format will ship from an unread specification. No whole copyrighted PKWARE/Adobe specifications are redistributed. URLs are documentation references, never runtime destinations.

| Format / API | Official revision / source | Implemented subset & test | Omissions / user consequence / study status |
|---|---|---|---|
| BMP | Microsoft BITMAPV5HEADER, BITMAPINFOHEADER / bitmap file layout; https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header | V5 BGRA masks, sRGB tag, V3 BGR/padding; existing independent Pillow + offset tests | No compression/ICC embed. Official V5 field definitions retrieved; broader Windows file-name semantics not executed on Windows. |
| GIF | CompuServe GIF89a, 31 July 1990; https://www.w3.org/Graphics/GIF/spec-gif89a.txt | Header/LSD/tables/image data/GCE/application/trailer; LZW Appendix F; independent Pillow tests | Global palette, 1-bit alpha, quantisation, full frames. Official document retrieved partially; full normative review remains. |
| ZIP | PKWARE APPNOTE 6.3.10 FINAL, 2022-11-01; https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT | §4.3 local/central/end records; §4.4 CRC/time; store method, UTF-8 flag; Python zipfile/zlib | No ZIP64, encryption, streaming, compression. Explicit caps. Full field-by-field spec review pending; golden bytes can still pin current correctness. |
| PDF | Adobe PDF Reference 1.7, sixth ed, Oct 2006; https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf | Current PDF1.4 subset: indirect objects, xref, trailer, page tree, image XObject/DCT. pypdf strict plus raw xref tests | §3.4/3.6/4.8/7 planned study; single-page JPEG, no alpha, ICC or PDF/A. Tool’s 30-page PDF ceiling blocks claim of normative review. Multipage/lossless design deferred. |
| PNG/APNG | W3C PNG Third Edition REC 2025-06-24; https://www.w3.org/TR/2025/REC-png-3-20250624/ | Native static encode; metadata chunk walk; animation acTL detect | Chunk CRC/ordering/timing study for acTL/fcTL/fdAT pending. No own PNG/APNG output yet. Browser bytes not cross-browser deterministic. |
| WebP | Google WebP Container Specification; https://developers.google.com/speed/webp/docs/riff_container | RIFF/VP8X/ANIM/ANMF/container metadata walk; native encode | No own codec, lossless switch or animated output. Container specification retrieved partially; codec bitstream spec not studied. |
| JPEG/JFIF, Exif/TIFF | ITU T.81 / JFIF; CIPA Exif and TIFF IFD specs needed | Native JPEG; APP segment/IFD read and strip tests, not complete codec | No write-back. Normative originals not yet read in this work: do not claim conformance matrix complete. |
| ICC | ICC.1 profile specification required | Recognise/remove container profile fields, not validate profile internals | No colour-preserving pipeline; profile copying after transforms would be unsafe without proof of pixel-space match. Study pending. |
| AVIF/HEIF/JXL | AOM AVIF / ISO BMFF / JPEG XL normative specs required | Native AVIF encode MIME probe; no own codec | All codec semantics delegated; no HEIC/JXL decode guarantee. Study pending before broader identification promises. |
| SVG, ICO, TIFF | SVG spec, Microsoft icon-container convention, TIFF6 required | SVG browser decode/serialisation; ICO/TIFF input MIME recognition only | No ICO/TIFF output. Icon-raster ZIP does not claim ICO conformance. Study pending. |
| Clipboard | W3C Clipboard API editor draft 2026-06-24; https://w3c.github.io/clipboard-apis/ | Explicit image write, supported MIME/permission/timeout tests | Intake proposed, not implemented; per-browser permission policy remains actual-manager/browser test requirement. |
| File/Blob | W3C File API WD 2026-09-12; https://www.w3.org/TR/FileAPI/ | Blob acquisition/object URLs; settings File input | Local-media intake proposed; no File System Access grant necessary for basic user file picker. Normative sections not fully read yet. |
| QR | ISO/IEC18004 | None | Declined: peripheral generator, no approximate encoder will be added. |

## 6. Phase 4 — design: alternatives and decisions

A security/verification candidate comes first. None of the large-format or new-intake work is slipped into a patch under an unverified assumption.

| Items | Approach A | Approach B | Decision / constraints / residual |
|---|---|---|---|
| G-01/03/30/40 | Hide a capability marker behind a symbol/DOM property; keep flag for tests | Private module WeakMap, separate production entry module, source ESM verification; offline instrumentation separate from release | B removes privileged pointer and page kill switches by construction. Private registry dedupes repeated bootstrap calls from same module only. Separate artifact executions/cross-manager arbitration remains unresolved and blocks full acceptance; DO NOT substitute an attacker-writable marker just to keep old test green. |
| G-02 | Infer sandbox boolean from manager name/injectInto | Report null/unknown until isolation independently observed | B: no manufactured guarantee; raw injectInto retained. C3 no new grant. |
| G-05/78 | JSON stringify/parse round trip, then merge | Bounded own-data descriptor walker to null-prototype records; deny magic keys/accessors; schema validates normalised copies | B avoids getters/inherited toJSON/deep-stack processing; scalar only from own data; limits configurable internally, no user setting. Hostile Proxies cannot be made safe within JS, not an accepted manager-JSON input. |
| G-12/76/77 | Patch only anchored regex | Device stem rules before first dot, recheck AFTER all truncation; nonempty UTF-8 fallback | B covers dotted names and independently found truncation/empty-stem defects. No encoder byte changes. Windows runtime validation still blocked. |
| G-06/29/31/79 | Embed all tests/corpus into runtime | Distribute one readable userscript plus offline source/test capsule, pinned golden corpus and fail-closed preflight | B satisfies single installed file/size; offline package is not runtime dependency. Hashes are checksums, not signatures. |
| G-22/23 | Retain px and rely on browser zoom | Relative type sizes with readable minimum plus shared preference rules | B: 12px fallback, preference CSS last; actual CDP/root-size observations, not screen-reader/OS certification. |
| G-83 | Close shadow roots only | Native trusted-interaction gate on owned UI callbacks | B: roots alone do not authenticate document contextmenu. No global page behaviour change or page bypass; offline transforms explicitly separate. Native-event integrity assumed. Production attack and real mouse/key saves executed. |
| G-84 | Require extraction under exact checkout name | Derive markers with node:path.relative(ROOT,file) | B: no runtime change, renamed extraction now549/549. |
| G-81 | Strip date bytes before golden comparison | Inject optional PDF clock and freeze original Date | B preserves byte-exact metadata comparison and unchanged current-time default. |
| G-82 | Read selected settings file and check length afterwards | Blob.size preflight plus existing bounded JSON/schema validation; alternative streaming reader | Choose preflight: no new browser API/privilege; >200000 bytes rejected before read, including some formerly accepted large multibyte files. |
| G-25/28 | Add fabricated support links and manual duplicate versions | Correct description, build-stamped version, distributed changelog/freshness gate; no fictional URL | B. G-26 remains blocked on actual maintainer support destination. |
| G-33/80 | Global error/rejection listeners capture whole host page | Catch owned bootstrap promise and existing owned tasks without collecting page errors | B fixes startup only; full async funnel/log awaits 3.0.0. No console spam on successful boot. |

### Coupled larger design (planned, not implemented)

| Coupling | Two approaches and chosen direction | Acceptance gate |
|---|---|---|
| G-20/21 + all new UI | Extract catalog first vs grow another English-only layer | Extract first, English fallback visibly labelled; locale/RTL tests before feature strings; exact semantic string inventory required. No claim 52×29 covers full tool. |
| G-14/15/18 + G-55/60/61 | Cooperative chunking only vs local dedicated Worker + bitmap/OffscreenCanvas with cooperative fallback | Prefer worker for custom encoders with CSP-aware refusal/fallback. Explicit memory preflight, owned cancellation, interruption disclosure. Benchmark before/after, prohibit timer-only 'yield' claims for synchronous loops. |
| G-07/10/11 | Copy ICC/EXIF blindly vs explicit sRGB conversion policy + orientation-normalised selective metadata writer | Choose explicit policy until empirically proven gamut pipeline. Never embed source ICC over sRGB pixels or stale orientation after rotation. Privacy-safe default drop disclosed; technical/authorship optional, GPS separate. Need P3 reference corpus. |
| G-08/31/38/49/50 | Inline third-party codecs vs authored readable PNG/APNG container + browser JPEG/WebP with honest flags | Own PNG only after spec and two-decoder corpus; budget and main-thread tests first. TIFF/ICO/animated WebP/lossless WebP remain named later gates. |
| G-43/48/57/63/64 | Independent dialogs with divergent conversion paths vs shared bounded intake/selection/action registry | Shared core descriptors and queue; tray feeds PDF/sheet/dedupe. History opt-in/default-off activity record (privacy); completed/failed/uncertain distinct. Palette is discovery, not new privileged global API. |
| G-66/67 + presets | Add arbitrary unvalidated overlays/profiles vs schema-allowlisted site rules over workflow defaults and existing conversion presets | Choose validated subset/overrides, not capability/grant overrides. Precedence: defaults → saved global → matched enabled site rules (least→most specific, declaration order ties) → explicit preset → per-action edit. No recursive rules/profiles; explicit user format wins memory. B output choices substantially overlap presets, but automatic-format/PDF packing remain separate missing capabilities. Executed A capture/export/apply preserves global language/hotkeys/rules and is NOT subsumed by current presets. Backup import is a partial workflow alternative, not equivalent one-click named snapshots; keep G-67 open pending demand/UX research. |
| G-61 watcher | Unlimited observer auto-save vs hard-cap armed session with preview/filter/always-visible Stop and uncertain-write stop | Second only, release 3.2.0 after history/worker/tray; no persistence across navigation, no forced authentication/CAPTCHA handling. |

### Layering and dependency graph

`src/encoders`: binary writers only, no DOM/GM/network. `src/core`: input/config security, bounded state, history, worker protocol, image operations. `src/ui`: catalogued rendering and events, never network privileges. `src/main`: intent orchestration and owned error handling. `src/entry.js`: production-only boot; tools/test imports main directly. Offline build instrumentation is never a production mode toggled by page input.

```
private entry + input discipline → reproducible verification capsule + goldens
catalog/RTL → action registry/palette → intake + tray → multipage PDF/contact sheet
worker + memory preflight → budget search / dedupe → armed watcher
selective metadata + explicit colour policy → lossless PDF / safe preservation
history (off by default) → saved badges / per-host format memory
validated global settings + site rules → explicit preset/per-action override
```

### Subsequent measured designs (separate source groups)

| Addressed item | Approach A | Chosen approach B / trade-off |
|---|---|---|
| G-13 /85 | Weaken CSP or teach every consumer ambiguous byte-or-record data | Preserve successful HTML decode; bitmap fallback on already-held data, owned close/release; one structured byte cache. SVG bitmap unavailability remains explicit. No grants/CSP changes. `changes/csp-acquisition-design.md`. |
| G-19 | Replace listener system with AbortControllers everywhere | Retain current disposer pattern, own exactly one long-press release closure; completion/replacement/dismiss/detach clear it. Smaller compatibility surface. `changes/ui-lifetime-design.md`. |
| G-16 /74 frame commands | @noframes suppresses embedded-document interaction | Eight manager commands in top document only; retain native same/cross-origin child conversions. Broader idle scheduling/duplicate-copy policy remains open. |
| Development dependencies | Override FTP and replace/patch abandoned ZIP extractor; unsafe automatic downgrade | Puppeteer25.14.0 modern installer tree, Node>=22.22.2; explicitly pin directly imported dev tools. Runtime unchanged. `changes/toolchain-design.md`. |

`check-rollbacks.py` reverses each of the three new runtime groups separately in source clones, removes only that group's own regression tests, builds/lints, and executes every remaining unit including original byte goldens. See Section9. It does NOT certify reversibility of every earlier change. No feature is claimed present in its intentionally reversed variant.

## 7. Phase 5 — prioritised plan and release boundaries

| Rank / boundary | Items | Expected residual severity after completed work | Effort / risk / dependencies | What regresses if wrong |
|---|---|---|---|---|
| 1: 2.0.1 candidate | 01–03,05,06,12,22,23,25,28–31,40,76–80; owned startup part of 33 | API publication/flags and config prototype acceptance neutralised; cross-execution duplicate coordination remains S2; S1 suite omission closed only with preflight | medium; private-entry build/test separation risky; no codec edits | Privilege containment, duplicate actions, boot containment, import/migration compatibility |
| 2: 3.0.0 foundation | 04,07,09–11,13–24,26,27,32–37,39,41–48,56,57,59,63,64,66,68–75 | S1 colour/metadata/responsiveness/local-input/PDF/history expected addressed with honest fallback; actual results required | very high; catalogs/workers before new UI or multiplied encodes; real manager lab required | Silent fidelity loss, memory exhaustion, unintended disk writes, confusing setting precedence |
| 3: 3.1.0 assets | 08,38,49–52,54,55,58,60,62 | Remaining breadth S2/S3 reduced, not assumed | high; worker/catalog/spec studies/tray/history prerequisites | Invalid files, alpha/timing loss, false duplicate matches |
| 4: 3.2.0 automation | 61 | S2 runaway risk controlled with hard stops, explicit session | high; all preceding safety gates | Runaway requests/disk use, repeated uncertain writes |

**Not doing:** no telemetry, page storage, remote codecs, runtime library fetching, cloud processing, minification, invented support URL, access-control bypass, approximate QR, or second configuration tier justified merely by two competitors using the same noun. Slideshow declined as nonessential review UI; the picker/transform previews remain. No fake 'absorbed' status for a deferred capability. No claim that this candidate meets all S1 gates.

## 8. Superset disposition table (G-41…G-75)

Every capability has a deliberate disposition. “Deferred” means absent in the patch, not implicitly absorbed. Re-evaluate at the named release; this work order is NOT complete until required S1 acceptance and actual implementation/evidence exist.

| ID | Disposition | Reason / modified scope | Constraints | Dependencies |
|---|---|---|---|---|
| G-41 | Deferred to 3.0.0 | No VIDEO target path. Poster discovery exists in scan. Cross-origin/DRM behaviour not tested because no live capture implementation. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-42 | Deferred to 3.0.0 | Clipboard writes only, no read or paste intake. Browser clipboard write tests pass, not intake tests. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-43 | Deferred to 3.0.0 | File input imports settings only, no media intake. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-44 | Deferred to 3.0.0 | No user-entered URL action; internal URL acquisition already works for DOM-derived sources. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-45 | Deferred to 3.0.0 | HTTP(S)-only metadata. Injecting via CDP into file page would not test real manager matching; actual file manager test unavailable. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-46 | Deferred to 3.0.0 | Input-image/link actions absent. Scanner srcset variants are inventory entries and can be selected through picker, so categorical nonselectability refuted. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-47 | Deferred to 3.0.0 | Explicit scan 'materialise' action absent; known URLs of not-loaded entries can already be acquired when included in batch. Not equivalent to forcing site's JS lazy loader. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-48 | Deferred to 3.0.0 | No PDF batch destination or multipage page tree writer. Existing writer is one page. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; tray; format-spec/independent decoders |
| G-49 | Deferred to 3.1.0 | APNG detection exists, native frame decode browser-gated. Not full independent APNG decode. APNG output absent. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-50 | Deferred to 3.1.0 | Own-PNG missing, but engine/transparency/quality fields already are machine-readable; registry idea not entirely absent. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-51 | Deferred to 3.1.0 | No icon-size set action, although resize and ZIP primitives exist. ICO writer and PNG raster ZIP are different capabilities. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; tray; format-spec/independent decoders |
| G-52 | Deferred to 3.1.0 | No contact sheet action or encoder path. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; tray; format-spec/independent decoders |
| G-53 | Declined | Declined: generator outside conversion/privacy workflows; independent QR conformance burden not justified. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-54 | Deferred to 3.1.0 | No average-frame policy. Existing report.notes already disclose some animation degradation, so 'every loss silent' false. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-55 | Deferred to 3.1.0 | Comparison measures bytes but no bounded target-budget search. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-56 | Deferred to 3.0.0 | HEIC/HEIF/JXL identification absent; universal decoding not promised by browsers. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-57 | Deferred to 3.0.0 | No persisted conversion history. Queue snapshots are transient, not history. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-58 | Deferred to 3.1.0 | Dialog badge styles only; no saved-on-page marker layer. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; opt-in history |
| G-59 | Deferred to 3.0.0 | lastFormat is page-session only. Presets can carry site format but aren't learned per-host memory or fixed order. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; opt-in history |
| G-60 | Deferred to 3.1.0 | URL dedupe exists; byte identity/perceptual preview absent. Similarity not evidence of interchangeable content. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; tray; format-spec/independent decoders; opt-in history |
| G-61 | Deferred to 3.2.0 | Inventory observation only; no armed capture watcher. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations; opt-in history |
| G-62 | Deferred to 3.1.0 | Hover tracking exists; no quick-save button or peek card. Not the only entry point: keyboard and manager commands already work. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-63 | Deferred to 3.0.0 | Selection exists only within dialog, no persistent page-session tray. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-64 | Deferred to 3.0.0 | Shortcut help is not searchable action palette; no palette found. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-65 | Declined | Declined: peripheral timed review; enlarges navigation/motion surface without helping core conversion. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-66 | Deferred to 3.0.0 | Host preset overlays only selected conversion fields. No arbitrary validated site setting overlay or host disable. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-67 | 3.0.0 investigation | Executed semantic/workflow study: B output profiles mostly overlap presets; A named global snapshots are distinct, including language/hotkeys/rules. No permanent decline; demand/UX investigation remains incomplete. See profile-semantics.json and study-profiles.mjs. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-68 | Deferred to 3.0.0 | No internal log ring or redacted diagnostics export. No telemetry added to solve it. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-69 | Deferred to 3.0.0 | Native MIME capability probe exists, own-encoder on-demand self-test UI absent. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-70 | Deferred to 3.0.0 | Explicit recommendation exists inside comparison; proactive auto save mode absent. No need to rebuild comparison. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-71 | Deferred to 3.0.0 | No open/copy source address/copy data URI actions. Grant-free window.open/Clipboard API plausible but manager/browser behaviour untested. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-72 | Deferred to 3.0.0 | Refuted high-volume unconfirmed shortcut claim: saveAll calls openBatchDialog, preview then Start. Filename edit and crop ratios absent; plain save preview absent. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-73 | Deferred to 3.0.0 | Eight commands do not include per-format entries; disabling formats therefore does NOT leave eight stale format commands. Labels static and callbacks read current settings; dynamic expansion is absent, not a reproduced defect. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-74 | Deferred to 3.0.0 | Same root as G-16; document-start/frame multiplicity confirmed. Timing trade-off needs measured design, not automatic adoption of competitor's idle choice. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |
| G-75 | Deferred to 3.0.0 | No sensitive-host precheck; actual store injection restrictions manager-specific and not tested. Claimed inertness of all exclusions not independently verified. | C1–C3, C5–C8 | catalog + action registry + owned-task/worker foundations |

## 9. Phase 6 — modified artifact and per-item change record

**Engineering candidate only; NOT publish-ready.** `release/save-image-as-type.user.js`, metadata version **2.0.1**, **619,527 bytes** (605.0 KiB), **41 runtime modules**, **444 named top-level bindings**, **15,468 newline-delimited lines** (build split count15,469). No minification, mangling, third-party runtime library, new grant, new persistent key or new default setting.

- MD5: `686093a66a232aaa52c6761d4674d37d`
- SHA-256: `2e994164334133f8b5901e6649c96ec8e90931975b4faf59ca1c8877e91edbd4`
- Original MD5 `ed285e423b3e85b5da38e9798423581c` retained at `audit/baseline/v2.0.0.user.js`; original modular snapshot `audit/baseline/source-v2.0.0.tar.gz`.

### Implemented change record

| Items | Actual change | Executed result / remaining limit |
|---|---|---|
| G-01/03/30/40 | Private WeakMap lifetime, separate always-on entry, no public privileged handle/page kill switches; offline API separate | Current exact-source blank/preseed/flag cases boot8 commands with no API. Same-module repeat is idempotent. Independent evaluations still8→16; cross-manager arbitration NOT solved. |
| G-02 | Unknown sandbox verdict, raw metadata retained | Five metadata shapes report unknown; no fabricated isolation guarantee. |
| G-05/78 | Bounded own-data descriptor clone, magic-key/accessor/inherited rejection and primitive-only scalar handling | Hostile corpus passes; removed-boundary negative mutant archived. Hostile Proxies/replaced intrinsics not accepted JSON transports. |
| G-12/76/77 | Windows device stems after truncation; dotted/superscript rules; nonempty UTF-8 stem | Matrix passes; no actual Windows filesystem claim. Minimum usable filename may exceed impossible requested tiny budget. |
| G-22/23 | Relative type floor and shared owned preference overrides | Current browser-emulated font scale12→24px, reduced motion/forced colours/contrast active. Screen-reader/mobile/OS matrix not done. |
| G-06/25/28/29 | Verification header, AVIF/original description, source/lint/build/changelog capsule |27 static gates and build freshness pass. No fabricated support URL; G-26 open. |
| G-31/79/81 | Six original-pinned byte goldens, independent parsers, fail-closed prerequisite check; optional PDF clock | Original PDF date nondeterminism discovered rather than hidden; frozen verification clock, unchanged current-time default. Six outputs still exactly match original. |
| G-33/80 | Awaited owned startup error funnel and failed-construction cleanup | Rejection contained once; retry works. Not a complete async/lifetime/logging audit. |
| G-82 | Import size checked before File.text | Oversized input read counter stays0; deliberate >200000-byte refusal before allocation. |
| G-83 | Trusted native UI boundary, stable removal wrappers, direct owned keyboard callbacks | Exact production synthetic menu rejected; actual mouse/digit/Enter/Space each save1. Actual VM five-case attack also yields no menu/new requests. Native integrity and broad worlds still scoped limits. |
| G-84 | Checkout-relative module marker paths | Historical extraction defect fixed. New rollback clones run under three unrelated paths; all remaining suites pass. |
| G-13 /85 | CSP acquisition fallback with owned bitmap leases; local data URL parsing; structured byte cache | Actual VM same/cross/strict-CSP/data PNG and Original each1; original raster bytes exact. Strict-CSP SVG PNG explicitly fails; OriginalSVG succeeds. No CSP weakening, no extra request for held bytes. |
| G-19 | One retained long-press disposer for completion/replacement/end/move/dismiss/detach | Three tests first red, now green; focused43/43 before toolchain migration, full577 green afterward. Not all-modal/SPA heap proof. |
| G-16 /74 | Eight manager commands only in top frame, child interaction retained | Current exact source top8 +ten child0; actual VM same/cross child PNG each1 and popup8 commands. Independent-copy duplication remains. |
| G-67 (implemented) | Named whole-configuration snapshots: `src/core/profiles.js` plus a settings-panel section, localised through `src/core/messages.js` (en/ar/hi, RTL-aware). A profile is a complete validated settings object; presets stay per-conversion; "Export JSON" remains the file interchange. Added default `profiles: []` is inert (49 keys total). | Pure unit corpus covers capture/apply/limits/hostile input/storage round trip; exact production drives capture→apply with real trusted input (1 row, store write seen); actual Violentmonkey lab captures, reloads, applies and deletes through real buttons and manager storage. Demand was resolved by the user delegating the choice; no interview evidence is invented. |

### Independent rollback execution of the three recent groups

`python3 audit/check-rollbacks.py`: reverse each source+test patch separately in disposable clones, all other groups retained. Acquisition reversal **569/569**, long-press reversal **574/574**, frame-command reversal **576/576**; each build fresh and lint27/27, zero skipped/cancelled/todo. Remaining tests include original byte goldens. Reports/commands: `evidence/independent-rollbacks.json`, `evidence/rollback-*.txt`; patches `patches/group-*.patch`. This is actual limited rollback verification, not certification that ALL earlier hardening changes have independent release commits. Reversal deliberately removes the feature/tests; it is not a safe release recommendation.

No Domain9 capability is claimed absorbed merely by a patch, design or renamed preset.

## 10. Phase 7 — verification report

### Executed current gates

`node audit/verify-all.mjs` ran under **Node22.22.2 / Puppeteer25.14.0 / Chrome155.0.8059.79** and exited **2 (measured regression gates passed; RELEASE BLOCKED)**. `pipeline-summary.json` binds all steps to the current artifact SHA. Exit1 is failure; exit2 is NOT acceptance. Exact-production evidence assertions reject source/manifest hash drift and a reduced/failed/skipped unit count.

| Claim | Command / evidence | Actual result and scope |
|---|---|---|
| Prerequisites | `node audit/preflight.mjs`; `pipeline-preflight.txt` | Supported Node, Python3.13.16/Pillow12.3.0/pypdf6.21.0/file5.46 and default Chrome libraries present. Older negative missing-decoder test retained. |
| Unit/core/UI | `npm test` / `node test/run-unit.mjs`; `candidate-unit-current.txt`, `pipeline-unit.txt` | **{m['gates']['unit']['total']}/{m['gates']['unit']['total']},{m['gates']['unit']['suites']} suites;0 fail/skipped/cancelled/todo**. Explicit offline synthetic-event loader, not manager authentication proof. |
| Static/build | `node lint.mjs`; `node build.mjs --check` | **27/27**, artifact equals source; no runtime imports/resources. |
| Full fixture browser | `node test/browser/run.mjs`, twice through combined runner | **57/57 twice**; separately hashed offline instrumented source with fake GM. NOT exact production or real manager. |
| Exact production blank-origin boot | `audit/probe-production.mjs`; current `candidate-production.json` | Four boot/attack cases8 commands; no public API, privileged writes, page-storage calls or measured non-navigation/non-favicon boot requests. Eleven documents register `[8,0×10]`. Page CSP still rejects its own data img; user-initiated conversion fallback is tested separately below. |
| Exact production real input | `audit/browser-checks.mjs`; current browser-check JSON | Native mouse PNG1; native digit1/Enter/Space each1. Fake GM transport. Saved PNG489B,64×48. `python3 audit/verify-production-pixels.py`: Pillow full RGBA equal to input; report bound to source SHA. |
| Synthetic DOM attack | `node audit/synthetic-action-probe.mjs` | No candidate menu/privileged request. Old original/before-fix exploit records preserved, labelled fake transport. Actual VM scoped negative also below. |
| Accessibility preferences | Browser-check CDP media emulation and root-font scaling | Reduced-motion, forced-colours, more-contrast, dark/default/large-type computed styles/screenshots. 12px floor; doubled root24px; reduced motion none/0s, forced focus3px. Not OS/AT/RTL/mobile certification. |
| Original pure-data contract | `node audit/verify-contract.mjs` | Current48 default keys/values, all8 full format definitions,6 action definitions, shortcuts and10 grants deep-equal original. New persistent keys0; schema3 retained; migrations in full units. |
| Encoder bytes/structure | Full units; `node audit/independent-goldens.mjs` | Six original-pinned outputs byte-exact. Independent Pillow/strict pypdf/zipfile/zlib plus owned raw offset/CRC helpers pass. No repinning. PDF4650B/xref4434/all6 offsets correct; embedded200×140 JPEG on A4. |
| Actual Violentmonkey | `node audit/real-manager.mjs vm`; `manager-lab/vm-production.json` | Official VM2.49.0 MV3 unchanged/unpacked, isolated normal file install; Chrome155.0.8059.84, new Node22/Puppeteer25 driver. Stored script SHA=current artifact. All five cases plus settings reload/restore and native same/cross frames completed. This is actual manager, not shim; not signed-store/public-site/other-OS certification. |
| Actual-manager downloads | `python3 audit/verify-manager-outputs.py vm` | **11** completed snapshots independently checked. Same/cross/CSP/data PNG1+Original1 each; all raster RGBA exact and all original rasters byte-exact. SVG PNG0 explicit decode error+OriginalSVG1 valid XML. Two child PNGs pixel-exact. Settings prefix survived reload then restored blank; popup8 entries with frames. |
| Tampermonkey | Archived actual TM5.5.1 lab/control records | Official unchanged unpacked CRX normally installed with exact code, but production AND minimal control failed injection. **Inconclusive**, not a compatibility pass or proof of product incompatibility. Chrome131 control attempt timed out. |
| Recent independent rollback groups | `python3 audit/check-rollbacks.py` |553/558/560 remaining units, respective feature tests removed with source;27 lint/build each. Earlier groups still not certified. |
| Development dependency audit | `npm audit --json`; `npm-audit-remediated.json` | **0 vulnerabilities**, down8 high. Node minimum22.22.2; Puppeteer25.14.0, jsdom25.0.1, esprima4.0.1, js-tokens4.0.0 pinned. Runtime unchanged. Audit is time-specific, not a security guarantee. |
| G-67 semantic exercise | `study-profiles.mjs <A attachment> <B attachment>`; `profile-semantics.json` | Hash-verified selected pure competitor functions, no GM/DOM or runtime copying. A global snapshot/export/apply differs from B output profiles and own presets. Constructed workflow analysis, NOT user interviews; no permanent decline asserted. |

Historical negative mutation (boundary removal fails3 tests), changed-golden checksum failure, initial488→513 missing-decoder issue, first548/549 extraction failure and pre-upgrade suites remain archived; they are NOT current totals. Initial three long-press failures also remain (`touch-before.txt`).

### Current comparative performance — not evidence of a jank fix

- original synchronous startup, n=5 (external marks, excludes full compile/parse): mean 5.560ms, population SD 0.824, range 4.400–6.800.
- candidate synchronous startup, n=5 (external marks, excludes full compile/parse): mean 5.440ms, population SD 1.106, range 4.300–7.500.
- original GIF512×512, n=3: mean 196.47ms, population SD 27.25, range 177.00–235.00.
- original GIF1024×1024, n=3: mean 260.00ms, population SD 22.51, range 229.70–283.60.
- candidate GIF512×512, n=3: mean 150.27ms, population SD 13.33, range 131.60–161.90.
- candidate GIF1024×1024, n=3: mean 215.03ms, population SD 20.30, range 188.70–238.10.

Both artifacts re-probed with the same new Node22/Puppeteer25/Chrome155.0.8059.79 toolchain in the shared Linux x86_64 sandbox. Machine contention is uncontrolled; small n and sequential measurements do not establish an optimisation or confidence interval. Raw encode and delayed-timer samples are in `baseline-production.json` / `candidate-production.json`. GIF remains synchronous/main-thread blocking. G-14/G-15 worker/preflight/memory-pressure/discard obligations are NOT resolved by these numbers. The actual-manager Chrome155.0.8059.84 is a separate explicitly versioned lab.

### Readability (disclosed comparable tokenizer)

- `audit/baseline/v2.0.0.user.js`: 2162 distinct names; ≤2-character share3.099%; comment characters14.474%; comment-touched lines11.277%.
- `release/save-image-as-type.user.js`: 2198 distinct names; ≤2-character share3.094%; comment characters14.690%; comment-touched lines11.477%.

`node audit/readability.mjs`: explicitly pinned js-tokens4.0.0; keywords excluded, template interpolation identifiers not extracted. This is NOT the auditor's undisclosed identifier/comment taxonomy. No minification/mangling or material comparative comment loss; not a human-understandability certification.

### Retained upgrade failure

Node22 plus the explicit loader rejected the old `--test test/unit/` directory import before suites (ERR_UNSUPPORTED_DIR_IMPORT). Archived `node22-directory-negative.txt`. The portable `test/run-unit.mjs` now enumerates every .test.mjs file explicitly, refuses empty discovery, forwards filter arguments and propagates child failure/signal. All{m['gates']['unit']['total']} current tests then passed. No tests were suppressed to repair the launcher.

### Extraction boundary

The earlier renamed capsule549-pass check is historical. New three independent rollback clones verify unrelated checkout names with current tooling. A refreshed final source capsule must still be re-extracted and verified; its log is stored separately, not inferred from the root checkout.

## 11. Phase 8 — test and corpus suite

The runnable offline source/corpus is distributed with the candidate source ZIP, never fetched by the installed script. `audit/README.md` specifies setup/commands and distinguishes production, verifier and actual manager evidence.

- Pure source API: `audit/verify-api.mjs`, contract1; writer/schema inputs documented; no installed-page access.
- Unit entry: `test/run-unit.mjs`; every `test/unit/*.test.mjs` explicitly discovered. Node fixture event policy is deliberately bypassed only in the offline loader. Browser fixture source is separately instrumented/hashed. Production attacks/native input do NOT bypass it.
- Six original-pinned golden files: `test/golden/manifest.json`. Creation tool requires original MD5, never part of normal verification. Verification must not repin on failure. Fixed PDF clock/date and ZIP DOS-wall-clock rules documented.
- Hostile config/filename corpus: `test/corpus/`, generated accessor/cyclic/type-confusion/limit fixtures and pre-read File-size counter; independent parsers under `test/helpers/`.
- Acquisition regressions: `test/unit/core-acquisition.test.mjs`: lease release, timeout/late close/abort, local data parser and structured-byte/no-refetch contract. Real-manager outputs checked by `verify-manager-outputs.py`, not merely a fake transport count.
- Three touch lifetime regressions + child boot/interaction regression; full subscription/modal/SPA/heap inventory remains incomplete.
- `verify-contract.mjs` independently compares current pure defaults/registry/actions/shortcuts/grants to MD5-pinned original. `verify-production-pixels.py` checks full saved raster pixels, independently of native encoder bytes.
- Exact production/local frame/CSP/security and browser preference matrices: `probe-production.mjs`, `browser-checks.mjs`, `synthetic-action-probe.mjs`. Broad public-site/all-manager/OS/AT matrices still open.
- Actual VM lab: `manager-lab-setup.mjs`, `real-manager.mjs vm`, `verify-manager-outputs.py vm`; isolated official-manager assets/profile are development prerequisites, not redistributed extensions or userscript dependencies. Real TM results remain inconclusive.
- Recent-group rollback verifier and readable unified patches: `check-rollbacks.py`, `patches/group-*.patch`. Results scoped as Section9 explains.
- Optional G-67 input study needs the original two competitor attachments, verifies their MD5 before executing only selected pure functions, and records byte offsets/digests. They are NOT inlined/redistributed in the runtime. This optional investigation is not a mandatory baseline regression dependency or a user survey.

The package's test prerequisites may download development dependencies. That is not runtime network. Screenshots show browser-emulated settings only. A partial spec matrix is not full normative conformance and fixture semantics are not actual manager certification.

## 12. Phase 9 — release package, compliance, migration and rollback

### Identity and distribution boundary

- One readable strict IIFE: `release/save-image-as-type.user.js` (version2.0.1 candidate; hash in Section9/manifest). Source ZIP is a verification companion, NOT a split runtime.
- `release/save-image-as-type-2.0.1-candidate-source.zip`, outside-archive `PACKAGE_SHA256SUMS` and runtime `SHA256SUMS`. Archive checksum external avoids a self-hash cycle.
- `releaseAccepted:false`. No public repository/store publication, platform approval, maintainer URL or signed authenticity claim invented. Downloadable source is not a substitute for completing the work order.

| Constraint / acceptance gate | Executed status / limit |
|---|---|
| C1 readable single runtime | Build/lint/readability pass; no minification/mangling. |
| C2 private/local behaviour | No new persistence or runtime network destination/dependency; measured blank boot quiet; owned synthetic UI attack rejected; manager-only settings round trip. Not universal hostile-intrinsic proof. |
| C3 privileges | Same10 grants; wildcard connect retained solely for explicitly user-initiated arbitrary image hosts. Origin trail/namespace grant matrix remain open. |
| C4 encoder contract | Six original byte goldens+independent parsers/offsets/checksums; current raster RGBA exact, originals exact. Not exhaustive all-input/spec certification. |
| C5 behaviour/storage | All48 defaults/all8 format definitions/6 actions/shortcuts/grants deep-equal original; schema3,8 top commands. Independent-copy8→16 regression unresolved. |
| C6 size |619527bytes (605.0KiB), below2MB; no size shortcut via minification. |
| C7 attribution | No competitor/other third-party implementation inlined into runtime. Development tools named/licensed in capsule README; full proprietary manager extensions not redistributed. |
| C8 proof scope | Current source-hash-bound exact-source and actual-VM evidence plus independent parsing. TM inconclusive; missing broad scope never relabelled green. |
| Every S1 resolved / accepted mitigation | **FAIL / not complete**. Named future release is not acceptance of an S1 waiver. |
| Every Domain9 capability absorbed/discoverable/localised | **NOT delivered**. All35 dispositions retained, G-67 explicitly open. |
| Complete normative study, l10n/RTL/AT/OS/memory/lifecycle matrix | **Incomplete**. |
| Independent rollback of every earlier change | Three recent groups verified, earlier groups still incomplete. |

### Migration / rollback

Schema3, primary `siat.settings.v3` and v2/legacy read order unchanged; identical48 default settings. No history/image/contact/job key added. Ordinary JSON needs no new-field migration; inherited/accessor/prototype-control inputs are deliberately neutralised and >200000-byte import is refused before read. v1/v2→v3 migration tests pass in current suite.

Downgrade to2.0.0 uses the same ordinary schema3 data; export settings first. Source snapshot allows full rollback but reintroduces known exposed-handle/kill-switch/synthetic-input weaknesses. Recent patches can be reversed independently as tested in Section9; this does not mean all prior source/test changes have release commits. Do not install old/candidate copies simultaneously. Native manager setting write/reload/restore was tested; a full native upgrade/downgrade installation flow was NOT.

Development Node>=22.22.2 is a build/test requirement, not a userscript browser requirement. npm/Python/browser assets are development-only. Audit0 is the executed locked-tree snapshot; no promise that future advisories cannot appear. No `@updateURL`, `@downloadURL`, `@require` or remote executable resource added.

## 13. Phase 10 — residual risk register

**Ranked, nonempty, unresolved acceptance register — not silently accepted waivers.**

1. **S1 / release blocking:** wide-gamut/metadata fidelity, worker responsiveness and pre-decode/resource admission, local media/clipboard/video intake, multipage output and opt-in private history remain absent or unverified. Future3.0.0 labels do NOT satisfy this brief. No strict functional superset delivered.
2. **S2 / release blocking:** independent artifact evaluations still register8→16 fake-manager callbacks. Private module idempotency/top-frame8 are not authenticated cross-copy/cross-manager ownership. Actual VM popup8 with frames is scoped, not dual-manager proof. Never restore page-writable capability markers as a shortcut.
3. **S1 security scope:** exact-source synthetic attack and actual VM local-case attack are rejected, but native intrinsic integrity and full manager/world/UI activation matrices remain assumptions. G-83 showed that removing a public handle alone was insufficient.
4. **S2 compatibility:** VM2.49.0 local headless lab now genuinely exercised; TM5.5.1 production AND minimal control inert, so inconclusive. Firefox/other managers, signed-store installs, actual file paths, restricted public sites, policy/permissions/DRM/clipboard intake and upgrade/downgrade still unverified.
5. **S2 lifetime/memory:** three long-press defects fixed and fresh frame policy tested; this is not complete SPA/BFCache/pressure/discard/modal ownership proof. Large CodeMirror installer paste exhausted the2GB lab; native file import avoids that lab path, not a runtime memory-safety certification.
6. **S2 / fidelity fallback:** strict-CSP same/cross/data raster and originals work in measured VM lab; inlineSVG raster bitmap decode remains unavailable with explicit error, while OriginalSVG works. Do not claim all strict-CSP/SVG issues resolved or weaken site policy.
7. **S2 acceptance breadth:** catalogue/RTL, real AT/OS preference observations, complete normative study, own async logging/ownership inventory and earlier independent release-commit reversibility remain incomplete. Three rollback clones and CSS/emulation are not substitutes.
8. **S2 G-67:** executed source semantics show A named global snapshots are distinct from own presets. Actual user-demand/UX research unperformed; no permanent decline justified by mere naming overlap. Do not invent interview evidence or silently mark absorbed.
9. **S2 boundary:** own-data hardening accepts JSON-like manager/file data, not executable hostile Proxies or replacements of native intrinsics/granted globals. Same-world JavaScript cannot fully isolate against code with equivalent execution authority.
10. **S3 serviceability:** no maintainer-owned support/distribution URL supplied; no fake URL or public publication. Source capsule enables independent review but does not establish authenticity, ownership or general release approval. Golden hashes prove consistency, not absence of original codec defects.

The former eight-high development audit residual is **closed in the measured dependency snapshot** (now0 after supported-toolchain upgrade); it is not falsely retained as a current blocker. This does not close the functional/security acceptance items above. Combined regression verifier deliberately exits2 while any full-release acceptance remains unfulfilled.
