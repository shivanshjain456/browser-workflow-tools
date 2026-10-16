# Verification report — Save Image as Type userscript v1.0.0

Date of the runs quoted below: **2026-10-15** (all in one session, on the artifact built from the current `src/`).
Raw machine-readable evidence: `docs/e2e-report-run1.json`, `docs/e2e-report-run2.json`, `docs/e2e-report-run3.json`.

> **Read this first — what "verified" means here.** The browser suite runs the *shipped artifact* in a real Chrome,
> but the userscript-manager API is an **emulation** written for this project
> (`test/browser/harness.mjs`, reporting itself as `handler: "EmulatedMonkey"` and recorded in every report as
> `manager API: emulated … not Tampermonkey/Violentmonkey`). Nothing in this document is evidence about a real
> Tampermonkey or Violentmonkey installation, about Firefox or Safari, or about any site on the public internet.
> §7 lists exactly what could not be performed.

---

## 1. Summary

| Gate | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` (`node --test test/unit/`) | **204 tests, 40 suites, 0 failed** |
| Static checks | `npm run lint` | **23/23 passed** |
| Build | `npm run build` | `release/save-image-as-type.user.js` — v1.0.0, **16 modules, 181 exports, 5699 lines, 214.9 KB**, sha256 `e7ee8f86792d1391…` |
| Artifact freshness | `npm run build:check` | **in sync** with 16 source modules |
| Browser end-to-end | `npm run test:browser` | **38/38 scenarios passed**, three consecutive runs, 0 retries (9.3 s / 9.0 s / 9.2 s) |
| Independent media decoding | Pillow 12.3.0 + pypdf 6.20.1 via `test/helpers/verify_media.py` | available and used — no byte-level check was skipped |

No check in this report was skipped for want of a dependency: jsdom 25.0.1, puppeteer 23.11.1, Pillow and pypdf were
all installed and exercised.

## 2. Environment

| Component | Version |
| --- | --- |
| Node.js | v20.20.2 |
| Chrome (puppeteer-bundled, headless) | Chrome/131.0.6778.204 |
| OS | Linux x86_64 (sandboxed container) |
| puppeteer / jsdom | 23.11.1 / 25.0.1 |
| Python / Pillow / pypdf | 3.13.16 / 12.3.0 / 6.20.1 |
| User-agent seen by the page | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36` |

Local origins used by the browser suite: a gallery page (origin A) and a second origin (B) acting as a CDN — the
same fixture served with and without `Access-Control-Allow-Origin`, so the CORS branches are real rather than
mocked.

## 3. Reproducing

```bash
npm install
pip3 install --user Pillow pypdf        # optional but used for every byte-level claim below
npm run build && npm run build:check
npm test
npm run lint
npm run test:browser                     # writes .tmp-browser/report.json
npm run test:browser -- --only=jpg-to-pdf,animation-capability-honest
```

Without Pillow/pypdf the affected tests **skip with an explicit reason** instead of passing silently.

## 4. Unit tests (204)

| File | Tests | Focus |
| --- | --- | --- |
| `encoders.test.mjs` | 24 | BMP header/mask/stride bytes, GIF container walk + an independent LZW decoder, PDF objects; Pillow/pypdf round-trips |
| `core-settings.test.mjs` | 25 | schema v2, v1 migration, first-run vs. corrupt, hostile import sanitisation, no-storage honesty |
| `core-filename.test.mjs` | 23 | percent-decoding, control/bidi characters, length limits, sub-folder paths, `data:`/`blob:` names |
| `core-gm.test.mjs` | 16 | both `GM_*` and `GM.*` spellings, capability detection, XHR/download error reasons |
| `security.test.mjs` | 18 | choke-points for raw manager APIs, `fetch` credential scope, no baked-in remote endpoints, idempotency markers |
| `core-frames.test.mjs` | 13 | animation detection in real GIF/WebP/APNG containers, truncated input, MIME sniffing |
| `build-and-metadata.test.mjs` | 13 | metadata rendering, grant list, artifact parses (`node --check`), staleness gate |
| `ui-download.test.mjs` | 11 | `GM_download` → anchor fallback matrix, capability description per `downloadMode` |
| `ui-menu.test.mjs` | 31 | opening rules, Shift bypass, keyboard operation, dismissal + scroll grace, listener hygiene |
| `ui-panel.test.mjs` | 10 | modal structure, every dismissal path, failed save, reset, focus restore — and that `window.close`/`window.open` are never called |
| `core-frames-decode.test.mjs` | 9 | WebCodecs path against a stubbed `ImageDecoder` (0×0 track quirk, delays, limits, failure handling) |
| `main-bootstrap.test.mjs` | 6 | boot, `ready`, marker on every root, double injection, destroy |
| `ui-toast.test.mjs` | 5 | stack bound (also across two instances sharing a host), roles/`aria-live`, text-only rendering |

## 5. Static checks (23/23)

```
no-eval / no-new-function / no-innerhtml / no-outerhtml / no-insert-adjacent-html / no-document-write /
no-string-timer / no-unsafeWindow / no-debugger / no-javascript-url / no-remote-require / no-remote-resource /
no-gm-add-element-src      absent from all 17 sources and from the shipped artifact
grants-match-usage         10 grants, all used: GM_info, GM_getValue, GM_setValue, GM_addValueChangeListener,
                           GM_removeValueChangeListener, GM_deleteValue, GM_xmlhttpRequest, GM_download,
                           GM_registerMenuCommand, GM_notification
connect-scope              @connect = ["*"] (wildcard required: images are hosted on arbitrary CDNs; documented)
match-scope                @match = ["*://*/*"]; no file://, chrome://, or extension origins
artifact-exists            214.9 KB, sha256 e7ee8f86792d1391
artifact-header-matches-meta   metadata block in release/ is byte-identical to src/meta.js
no-build-placeholder       version placeholder was replaced at build time
no-runtime-imports         no import/require statements survive into the artifact
version-consistent         metadata @version and in-script version are both 1.0.0
no-remote-endpoints        only inert identifiers/reserved parse bases appear:
                           https://siat.invalid/save-image-as-type, http://www.w3.org/2000/svg, https://siat.invalid/
no-implicit-page-globals   no bare calls to window-owned names (27 checked) across 17 sources
```

`no-implicit-page-globals` was added after a real defect (§8, row 1). Its detection was mutation-tested: with the
defect reintroduced it reports all ten offending call sites with correct line numbers
(`src/ui/panel.js:168, 189, 218, 668, 673, 674, 720, 721, 728, 802`).

## 6. Browser end-to-end (38/38)

Method: the **built artifact** is injected with `Page.addScriptToEvaluateOnNewDocument` (as a manager would at
`document-start`), against two local origins, with an emulated `GM_*` layer whose storage, XHR proxy and download
endpoints are server-side so the suite can assert on them. Saved files are written to per-page directories and then
decoded by **Pillow/pypdf**, never by the script's own encoders. Expected pixel values come from the fixture files
themselves (Pillow `Image.open(...).size`), not from hard-coded numbers. Console/page errors are collected: the two
deliberately broken fixtures (a 404 and a CORS-blocked image) are classified as expected noise, anything else fails
the scenario.

| # | Scenario | What it proves (with measured evidence from run 3) |
| --- | --- | --- |
| 1 | `boot-and-register` | Boots at `document-start`, registers exactly 4 manager commands, no unexpected page errors |
| 2 | `idle-capability-probe` | The script's encoder map matches an independent in-page `canvas.toBlob` probe: `png→png, jpeg→jpeg, webp→webp, avif→png, gif→png, bmp→png`; script map `{png:true, jpeg:true, webp:true, avif:false}`; AVIF therefore absent from the menu (`PNG, JPG, WebP, GIF, BMP, PDF, Original, Settings`) |
| 3 | `idempotent-double-injection` | Re-evaluating the artifact: hosts 1→1, toast hosts 0→0, manager commands 4→4, and CDP `DOMDebugger.getEventListeners` on `document` unchanged (`contextmenu:1, keydown:1, click:2, pointerdown:1, scroll:1, mouseover:1`); one right-click afterwards → **1 download, 1 toast** |
| 4 | `shadow-dom-isolation` | Menu styling is computed inside the shadow root despite hostile page CSS |
| 5 | `real-right-click-opens-menu` | A real `Input.dispatchMouseEvent` right-click opens a `role=menu` at `124,188 332×420` in a 1280×900 viewport |
| 6 | `keyboard-only-operation` | Full keyboard traversal: `PNG → JPG → WebP → GIF → BMP → PDF → Original → Settings` |
| 7 | `shift-yields-native-menu` | With Shift held the script does not call `preventDefault` |
| 8 | `menu-dismissal` | Escape, outside click and a settled scroll all close it; **a scroll 60 ms after opening does not** (the grace window) |
| 9 | `narrow-viewport-clamping` | In a 360×640 viewport the menu stays fully on screen (`20,207 332×420`) |
| 10 | `jpg-to-png` | Pillow: `PNG RGBA 200×140`, sampled pixel Δ0 |
| 11 | `png-to-jpg` | Pillow: `JPEG RGB 64×48`, Δ4 |
| 12 | `png-to-webp` | Pillow: `WEBP RGB 64×48`, Δ4 |
| 13 | `png-to-gif` | Pillow: `GIF P 64×48`, Δ8 (256-colour quantisation) |
| 14 | `png-to-bmp` | Pillow: `BMP RGB 64×48`, Δ0 |
| 15 | `alpha-to-bmp-lossless` | 32-bit BMP: **every sampled pixel bit-identical to the source PNG, alpha included** |
| 16 | `alpha-to-jpg-flattened` | Transparent PNG → JPEG composited onto white: `88,160,234` vs expected `89,160,230` (Δ4) |
| 17 | `jpg-to-pdf` | pypdf: 1 page, MediaBox `[0,0,595.276,841.89]`, embedded JPEG `200×140`, `xref_consistent=true` |
| 18 | `original-passthrough` | sha256 `572623b345b3244e…` **identical** to `test/fixtures/photo.jpg` (3723 bytes) |
| 19 | `cross-origin-no-cors` | A CORS-blocked image is fetched through the manager XHR (`GET …/fixtures/icon.bmp → 200, 1078 bytes`) and converts to `PNG RGBA 16×16`; exactly 1 network request for the conversion |
| 20 | `cross-origin-with-cors` | When the CDN sends `ACAO: *`, **zero** manager XHR calls — the cheaper path is preferred |
| 21 | `cross-origin-fetch-disabled` | With the setting off: error toast *"This image is hosted on another origin (127.0.0.1) which does not permit cross-origin reading, and 'Fetch cross-origin images' is turned off in settings."* — no broken file |
| 22 | `no-xhr-grant` | Without the `GM_xmlhttpRequest` grant the message names the **grant**, not the setting |
| 23 | `lazy-loaded-image` | An image whose `src` is set by an `IntersectionObserver` converts: Pillow `PNG 1200×900` |
| 24 | `spa-rerender` | After the page destroys and rebuilds the node, the replacement converts (`opaque.png`) with no re-initialisation |
| 25 | `toasts-do-not-obscure` | 4 toasts in a `246×359` box at `(1022,530)`; stack is `pointer-events:none`; a real click on a page button still lands |
| 26 | `iframe-image` | Same-origin iframe gets its own working menu (8 items) and saves `tiny.png` |
| 27 | `inline-svg-target` | Inline `<svg>` rasterised: Pillow `PNG RGBA 120×80`, `(0,0)=37,99,235`; name from `aria-label` → `Inline SVG target.png` |
| 28 | `css-background-target` | `background-image` element: header *"Save css background as"*, Pillow `PNG 64×48` |
| 29 | `broken-image-error` | A 404 image produces *"Could not save as PNG — The browser could not decode image data."* — no hang |
| 30 | `settings-panel-and-persistence` | Panel sections render; unchecking BMP and pressing Save persists (`png, jpg, webp, gif, pdf, original`) **and survives a reload** (menu then offers `PNG, JPG, WebP, GIF, PDF, Original, Settings`) |
| 31 | `filename-settings` | Prefix + sub-folder + length limit: manager received `refs/2026/shot-photo.png`, bare name 14 chars under a 16-char limit |
| 32 | `subfolder-needs-browser-mode` | In `downloadMode: "native"` the sub-folder is dropped and disclosed: *"Your sub-folder setting ("refs") was ignored…"* |
| 33 | `anchor-fallback-without-grant` | Without `GM_download` a **real Chrome download** lands on disk (`cdp-downloads/p9/photo.png`, Pillow `PNG 200×140`); toast says *"saved through the browser · manager download unavailable (no-grant)"* |
| 34 | `anchor-fallback-on-whitelist-error` | Manager error `not_whitelisted` → browser download succeeds and the reason is disclosed |
| 35 | `download-mode-disabled` | `downloadMode: "disabled"` → **zero** `GM_download` calls, browser path used |
| 36 | `animation-capability-honest` | Independent `ImageDecoder.isTypeSupported` probe matches the script's own report; animated GIF in → Pillow `GIF 50×40 n_frames=4`, **frame-by-frame comparison with the source: 4 frames, delays 100/100/100/100 ms, worst channel delta 7**; toast: *"Animated GIF written with 4 frames at 50×40."* |
| 37 | `no-network-beyond-the-image` | During a conversion, 10 requests — **all** to the two fixture origins |
| 38 | `page-untouched` | No unexpected page errors across the whole run; the only globals are `__siatE2E` (the harness) and `__saveImageAsTypeInitialised`; the only hosts are `siat-menu-host` and `siat-toast-host`; no page storage used |

Stability: three consecutive full runs, all 38 passing, no scenario needing the harness's one-shot retry for CDP
transport errors (`attempts: 1` everywhere in the reports).

## 7. Independent media verification

Fixtures (`test/fixtures/`, natural sizes measured with Pillow): `animated.apng` PNG RGBA 40×40 · `animated.gif`
GIF P 50×40 (4 frames) · `animated.webp` WEBP RGB 60×40 · `big.png` PNG RGB 1200×900 · `icon.bmp` BMP RGB 16×16 ·
`opaque.png` PNG RGB 64×48 · `photo.jpg` JPEG RGB 200×140 · `still.webp` WEBP RGB 100×80 · `tiny.png` PNG RGBA 4×4 ·
`transparent.png` PNG RGBA 64×48.

Encoder output decoded by Pillow/pypdf and compared against the exact source pixels (`encoders.test.mjs`, bounds
asserted, measured values in brackets):

* **BMP** — 24-bit and 32-bit, gradient / alpha / odd-width / 8-pixel cases: **mean channel delta 0.0, max 0**
  (lossless, including the alpha channel). Header fields asserted byte by byte: `BITMAPV5HEADER` size 124,
  `BI_BITFIELDS`, masks `00ff0000/0000ff00/000000ff/ff000000`, `bV5CSType = LCS_sRGB`, gamma and CIEXYZTRIPLE
  zeroed, bottom-up row order, 4-byte row padding for the 24-bit path.
* **GIF** — container walked block by block (never byte-searched): signature `GIF89a`, logical screen descriptor,
  global colour table, graphics-control blocks (disposal 1, delay in centiseconds), Netscape loop extension,
  image descriptors, sub-block lengths ≤ 255, trailer. An **independent LZW decoder** written for the test reads our
  streams back; the code-size bump rule was A/B-verified against Pillow's own `animated.gif`.
  Deltas against the exact source pixels, re-measured for this report: 64×64 random-colour image **mean 10.5292,
  max 41** (asserted < 16 / < 64 — bounds chosen so a channel swap (mean > 60) or a vertical flip (max > 200) would
  fail; worst pixel `192,184,121` → `179,225,114`); 8×8 four-flat-colour image **mean 3.1667, max 6** (5-bit channel
  expansion error; worst pixel `10,20,30` → `8,16,24`); 3-frame animation, frame 0 **mean 0, max 0** with saturated
  primaries reproduced exactly (`255,0,0` / `0,255,0` / `0,0,255`) and per-frame delays read back as
  **100 / 200 / 50 ms**.
  Half-transparent 10×10 source: alpha delta **0** (binary transparency exact, 50 of 100 pixels visible), visible
  pixels **mean 4.3333, max 6**, overall mean **129.6667 / max 255** — the overall figure is the format's own
  limitation (a fully transparent pixel's RGB is replaced by the reserved transparency index, e.g. `255,255,255,0`
  → `0,0,0,0`). That is asserted explicitly in the test rather than hidden behind the visible-pixel metric.
* **PDF** — pypdf opens the output in strict mode; `xref` table validated structurally (startxref → `xref` keyword,
  entry count, all entries exactly 20 bytes, `xref_consistent`), one page, MediaBox `[0,0,595.276,841.89]` for `a4`
  and `[0,0,150,105]` for `pixel` fit, the embedded image extracted and identified as JPEG 200×140, and string
  escaping verified with a title containing `(`, `)` and `\`.
* **Original file** — byte-identical passthrough, asserted by SHA-256 against the fixture.

Browser-side conversions (the E2E table above) were decoded the same way, with expected dimensions taken from the
fixtures rather than from the page's `width`/`height` attributes.

## 8. Measured browser capabilities (Chrome 131 headless)

| Probe | Result |
| --- | --- |
| `canvas.toBlob('image/png' \| 'image/jpeg' \| 'image/webp')` | encodes as requested |
| `canvas.toBlob('image/avif')` | **silently returns `image/png`** — hence the runtime `blob.type` verification and the hidden AVIF entry |
| `canvas.toBlob('image/gif' \| 'image/bmp')` | **silently returns `image/png`** — hence the built-in encoders |
| `ImageDecoder` on `http://127.0.0.1` (`isSecureContext: true`) | present; `isTypeSupported` true for `image/gif`, `image/webp`, `image/png`, `image/avif`; a 4-frame GIF decodes to 4 frames at 100 ms |
| `ImageDecoder` on `about:blank` (`isSecureContext: false`) | **absent** — WebCodecs needs a secure context, so animation support is origin-dependent and reported per page |
| `OffscreenCanvas`, `createImageBitmap`, `requestIdleCallback` | present |
| `GM_info.downloadMode` behaviours | `browser`, `native` and `disabled` all exercised through the emulation, plus the `not_whitelisted` error path |

## 9. Defects found by testing, and what now guards them

| # | Symptom (as observed) | Root cause | Caught by | Guard added |
| --- | --- | --- | --- | --- |
| 1 | Settings dialog could not be closed by Save/Cancel/Escape/✕; *Reset defaults* opened a blank tab | `panel.js` defined `open()`/`close()` only as methods of the returned object, so internal calls hit the page's `window.close()`/`window.open()` | E2E `settings-panel-and-persistence` (dialog still present after a successful save) | `ui-panel.test.mjs` (10 tests, incl. spies proving `window.close`/`window.open` are never called) + lint rule `no-implicit-page-globals`; mutation-tested: reintroducing the bug fails 10/10 tests and the lint check |
| 2 | Second live instance per page (duplicate listeners, duplicate manager commands, two toasts in one stack) | Idempotency marker written to `document.documentElement` **or** `Document` depending on what existed at `document-start`, but read back from only one | E2E: two simultaneous `Saved photo.png` toasts, then CDP listener counts | `main-bootstrap.test.mjs` (document-start hole reproduced by nulling `documentElement`), E2E asserts CDP `DOMDebugger.getEventListeners` deltas and one download per right-click |
| 3 | Menu flashed open and shut when the page was still settling a scroll | Every `scroll` event dismissed the menu | E2E `cross-origin-fetch-disabled`, `css-background-target` (both flaky: 7/8 immediate right-clicks survived) | 150 ms scroll-only grace window; `ui-menu.test.mjs` (grace + resize/blur/pagehide still immediate) and E2E `menu-dismissal` assert both halves |
| 4 | Animated GIF silently written with one frame even though the browser could decode four | Frames need the encoded bytes; same-origin images were acquired as pixels only, and no note explained the loss | E2E `animation-capability-honest` (Pillow `n_frames=1` while `isTypeSupported('image/gif')` was true) | Source bytes are re-read for the animation path; E2E now asserts output frame count, per-frame delays and per-frame pixels against the source |
| 5 | "The browser could not report the frame dimensions." | Chromium reports `codedWidth/Height = 0` on a GIF track until a frame is decoded | Same E2E scenario, after fix 4 | `core-frames-decode.test.mjs` reproduces the 0×0 track with a stub decoder and asserts frame 0 is decoded once and reused |
| 6 | `ImageDecoder` received 8192 bytes for an 891-byte file | `bytes.slice().buffer` on an offset view hands over the whole allocation pool | `core-frames-decode.test.mjs` | Exact-size copy; the test asserts `data.byteLength === bytes.byteLength` |
| 7 | Toast stack could exceed four on screen | The bound was per-instance while the host is shared | E2E `toasts-do-not-obscure` (5 visible) | Bound enforced on the nodes in the shared stack; `ui-toast.test.mjs` covers two instances in one host |
| 8 | "Settings were repaired" toast on every page load | A manager without a storage grant was flagged as a *recovery* | New `main-bootstrap.test.mjs` (a 12 s toast timer kept the test process alive, exposing it) | `core-settings.test.mjs` asserts `recovered: false` + `storage: 'memory'` + the honest warning |
| 9 | `menu.attach()` stacked duplicate listeners on every settings save | No idempotence guard | Code inspection while fixing #3, then a test | `ui-menu.test.mjs`: 5 extra `attach()` calls add zero `addEventListener` calls and one right-click is still handled once |

Earlier defects from the encoder/core work (GIF colour darkening, frame-delay off-by-one, percent-decoding of
multi-byte UTF-8, the capital-H `GM_xmlHttpRequest` spelling, v1 migration of current-schema settings, first run
reported as a recovery, long-press listener leak, duplicated menu host, misattributed missing-grant message) are
listed with their fixes in `CHANGELOG.md`; each has a passing regression test.

## 10. What could **not** be performed

Stated explicitly, because these are the gaps between "tested here" and "works for you":

1. **Real Tampermonkey / Violentmonkey.** Not installed in this environment. The manager API was emulated to match
   the documented behaviour of both (including TM's `not_whitelisted`/`not_enabled`/`not_permitted`/`not_supported`
   reasons and `GM_info.downloadMode` values, and VM's lack of sub-path support in `GM_download`). Real-manager
   confirmation — install prompts, TM's extension whitelist UI, VM's download-mode option — is outstanding.
2. **The native Save As dialog.** Headless Chrome has no interactive file dialog; `saveAs: true` is asserted only up
   to the manager call.
3. **Firefox and Safari.** No runs at all. The script uses only long-standing `GM_*` spellings plus `GM.*`
   fallbacks, but "parses elsewhere" is not compatibility evidence.
4. **Real websites.** Only the two local origins. Site-specific quirks (shadow-DOM-heavy pages, CSP that blocks
   `blob:` URLs, aggressive page CSS, service-worker-served images) were not sampled.
5. **Touch input.** Long-press is tested with synthesised `pointerdown/pointermove/pointerup` (mouse-driven), not a
   real touch device.
6. **Cross-origin iframes and cross-tab storage sync.** The iframe scenario uses a same-origin frame; the
   `GM_addValueChangeListener` sync path is unit-tested against a fake manager only (the emulation polls, it does not
   implement manager-side broadcasting between real tabs).
7. **Animated WebP/APNG output.** Frame *detection* is unit-tested on real containers and GIF frame extraction is
   verified end to end, but WebP/APNG → GIF conversion was not run in the browser suite; the output would be a
   single frame unless the decoder reports support, in which case the same code path as GIF applies.
8. **Partial-frame ("dirty rectangle") GIFs.** The verified fixture uses full-frame disposal. Chromium's
   compositing of GIF frames that only update a region was not exercised.
9. **Very large images / memory limits in practice.** The 40 MP downscale threshold and the 512 MB GIF budget are
   unit-tested with stubs (a 4000×3000 × 4-frame case), not with a genuinely huge image in the browser.
10. **Long-running stability.** The suite runs ~9 s per pass; no soak test, no measurement of memory growth over
    many conversions on one page.

## 11. Honest-labelling commitments kept

* Every capability claim in the UI comes from a runtime probe, and the probes were cross-checked against
  independent measurements in the same page (encoder map vs. `canvas.toBlob`; supported frame types vs.
  `ImageDecoder.isTypeSupported`).
* Where the script cannot do something, the user is told in the toast or the panel, and the tests assert the wording
  exists (sub-folder dropped, animation not extractable, cross-origin fetch disabled, missing grant, manager
  download refused, memory limit reached).
* No test asserts a value the product merely reports about itself: byte-level claims go through Pillow/pypdf, and
  listener claims go through CDP.
