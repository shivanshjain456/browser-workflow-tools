# Verification report — Save Image as Type v2.0.0

Release verification date: **2026-10-16**. Deliverable: `release/save-image-as-type.user.js`.

**Scope:** this is verification of the complete built userscript in a real browser on locally served fixtures,
with an **emulated userscript-manager API**. It is not evidence of a real Tampermonkey/Violentmonkey installation
or a public website working. All ten feature sets are integrated; no feature substitution or stub was used.

## 1. Final release gates

| Gate | Result | What it establishes |
|---|---|---|
| `node build.mjs` | v2.0.0; 35 runtime modules; 405 exports; 14642 lines; approximately 560 KiB | Single self-contained installable userscript generated from source |
| `node build.mjs --check` | In sync | Committed artifact is byte-identical to a fresh build |
| `node lint.mjs` | **23/23 PASS** | Metadata/source consistency, grant usage, no remote executable dependencies/endpoints, safe rendering constructs and other project static rules |
| `npm test` | **513 tests / 90 suites; 0 failed, 0 cancelled, 0 skipped** | Expanded regression/unit/DOM and independent encoder verification; see reproducibility note below |
| `npm run test:browser` | **57/57 PASS**, twice on the final artifact; **0 skips, 0 transport retries** | Built artifact's externally visible flows in Chrome with real encoders, canvas, clipboard and fixture HTTP origins |
| Independent media checks | Pillow, pypdf, Python zipfile, zlib CRC-32 | Output container validity, dimensions, sampled pixels/animation, ZIP members, metadata removal and pixel identity |

Artifact SHA-256:

```text
2eb8851b422393ebe9d14ef5a0bd11874abac03fd76a28328d6fae6ff280daed
```

The two raw final browser reports are `docs/e2e-report-v2-run1.json` and `docs/e2e-report-v2-run2.json`.
They include the script version, exact artifact hash, scenario evidence, browser/API facts and result counts.
Historical v1 results are kept separately in `verification-v1.0.0.md` and `e2e-report-run{1,2,3}.json`;
they are not counted as v2 runs.

**No skipped-dependency shortcut:** jsdom, Chrome and independent Python verifiers were installed and used.
Some unit suites deliberately skip when dependencies are absent; a smaller green count is not equivalent to this
release verification. The 19 new browser scenarios require the Python verification environment, rather than
silently claiming ZIP/metadata byte checks passed without it.

## 2. Environment actually exercised

| Component | Version / scope |
|---|---|
| Node.js | v20.20.2 |
| Browser | Chrome/131.0.6778.204, headless Linux x86_64 |
| Browser driver / DOM implementation | Puppeteer 23.11.1 / jsdom 25.0.1 |
| Python / Pillow / pypdf | 3.13.16 / 12.3.0 / 6.20.1 |
| Userscript manager | **EmulatedMonkey 0.0.0-e2e**, project fixture shim, not a released manager |
| HTTP | Two loopback origins; one genuine no-CORS CDN route and one ACAO route |
| Clipboard | Actual Chromium Async Clipboard write and readback; permissions explicitly controlled using CDP |
| Grants | Same ten grants as v1; no new grant or `@require` / `@resource` / remote update URL |

WebCodecs/clipboard are probed per context. The fixture HTTP loopback origin is a secure context; ordinary HTTP
sites need not be. The raw reports retain both about:blank and fixture-origin API probe results.

## 3. Fixture-based browser evidence — ten features

The compact design/decision table, including interaction, approach, edge case and acceptance criterion, is in
[v2-feature-decisions.md](v2-feature-decisions.md). Observed final-run evidence:

1. **Batch:** confirmation preview said 3 images/3 files; no download during preview; exactly 3 independently
   decoded outputs after Start. Queue concurrency is additionally measured with active/peak counters in unit tests.
   A 12-item queue cancelled during its first write allowed only that already-started write to land; 11 were not
   scheduled. With the job bar hidden, the toast Cancel still stopped the run.
2. **Inventory/picker:** 12 mixed sources found; 4 locally drawn data-URL thumbnails; searching and re-scanning
   generated **zero additional image requests**. The picker “This one” action saved one BMP of the requested row,
   not the rest of the selection. Unit tests cover caps, shadow images, frame descent, observer disposal and sorting.
3. **ZIP:** selection produced a single archive with 2 members. A 2-image × 2-format batch produced 4 members,
   including distinct `same-name.png`, `same-name.bmp`, `same-name-2.png`, `same-name-2.bmp` collision resolution.
   Python zipfile parsed the central directory and verified CRCs; zlib independently recomputed member CRC-32;
   Pillow decoded each image. Unit fixtures include UTF-8 names, hostile paths and a 300-member archive.
4. **Transforms:** dialog aspect-locked 200×140 → 100×70, then Pillow decoded that size from the actual download.
   A real 4×2 red/blue canvas travelled through conversion → PNG → ImageBitmap → pixel readback: 90° rotation put
   red at top and blue at bottom; horizontal flip swapped left/right; crop selected the expected red/blue edges.
   Stored defaults reached ordinary and batch saves. Units also verify crop/rotation aspect-lock interaction,
   invalid plans, late preview cleanup and out-of-order source loads.
5. **Clipboard:** actual Chromium clipboard write and readback yielded an **image/png, 64×48, 8187-byte** image.
   Explicit real browser permission denial produced an actionable message and **no unsolicited fallback download**.
   User gesture, focus and permission variability in other environments remain unverified.
6. **Templates:** the manager received `127.0.0.1-200x140.png`, rendered from `{host}-{w}x{h}`. The template replaced
   the prefix as documented. Unit tests cover sanitisation, malformed/unknown tokens, dates, limits, counters and
   collisions; the multi-format ZIP scenario verifies collisions in a real output workflow.
7. **Presets:** a page-host rule auto-applied a WebP + 50% resize + template preset without a manual selection;
   real output `Archive-100x70.webp` decoded at 100×70. Reload retained the preset and the zero-quality “inherit”
   sentinel. Pure tests cover wildcard/exact specificity and non-mutation of global settings.
8. **Comparison:** real PNG/JPG/WebP measurements were **35341 / 3416 / 1562 bytes** for the photo fixture.
   No output was saved before confirmation. Save smallest selected WebP and its downloaded bytes decoded.
   Unit/DOM tests cover failing encoders, transparent sources, cancellation, progress and all-flattening warnings.
9. **Metadata:** Pillow-generated camera EXIF/GPS/ICC fixture showed its camera/location warning in the inspector.
   Save original without metadata yielded **no EXIF/GPS** according to Pillow, and the decoded stored-pixel hash
   remained `8d17165d9417df92db9412813df3e58ec5c771ed3eb80d03a8d9bf2d5777e5cb` before/after. Separate
   unit fixtures verify JPEG ICC retention/drop, PNG text/XMP removal and WebP EXIF removal without pixel changes.
10. **Keyboard:** real hover + Alt+Shift+S saved one image; ordinary typing made no save; Alt+Shift+P opened the
    picker. Existing menu keyboard operation and idempotent reinjection scenarios still pass. Binding/help units
    cover reserved browser chords, duplicates, disabled/custom actions and editable targets.

## 4. Regression, failure and interaction evidence

The 38 existing scenarios remain part of the 57-scenario final suite: real context-menu clicks, Shift escape,
keyboard navigation, viewport clamping, shadow isolation, multiple formats, alpha flattening, animation,
iframe targeting, CORS vs manager XHR, missing grants, 404 handling, lazy loading, SPA node replacement,
settings persistence, filename/subfolder behaviour, anchor fallback, repeated injection and page-global/storage
hygiene. These are **local fixture tests**, not observations of third-party sites.

New safety checks specifically cover:

- Actual bounded-concurrency execution, queue timeouts, pause/resume/cancel, failure isolation and destroyed-queue
  inertness in units; no automatic retries of batch writes.
- Partial multi-format output: PNG saved, unavailable AVIF failed. Retry refused to replay the already-saved PNG,
  with manual recovery instructions. The intentionally unsupported AVIF branch is a Chrome-131 fixture assumption.
- **Simulated manager timeout:** one manager call, an uncertainty warning, zero anchor fallback downloads and no
  silent second write. The timeout outcome is emulated, not evidence about a real manager's timeout semantics.
- Definite manager extension/permission/capability refusals retain the documented browser fallback.
- Non-idempotent saves already started may still land after Cancel; cancellation does not claim to undo downloads.
- Cleanup of observers, shadow hosts, object URLs and late/out-of-order preview results; no untrusted HTML sink.

## 5. Security, privacy and architecture assessment

The shipped runtime is dependency-free and uses the **same ten grants** as v1. Broad `@match *://*/*` and
`@connect *` remain necessary for arbitrary user-selected images; each grant/destination rationale is in the
README and metadata source. No remote executable asset, update service or conversion upload is added.

The queue separates item/job states; conversion acquires pixels once per batch image and reuses them for output
formats; comparison encodes candidates sequentially from a single acquisition. A shared dialog primitive provides
labels, focus containment/return and Escape handling. Rendering uses DOM text APIs, not untrusted HTML; parser
walks and scans have hard bounds. These controls have test evidence, but are not a blanket “secure” or
“production-ready” certification.

Settings schema v3 preserves v2 choices, adds defaults, validates imports, and leaves old keys as downgrade backups.
Only configuration (including explicitly entered preset-host rules) is persisted; image bytes, metadata findings,
queue state and browsing history are not. Clipboard data goes to the system clipboard only on request.
Network reads are restricted to the selected/confirmed image sources and their normal redirects. Full details and
limits are in README §6; cookie/authentication behaviour remains the browser/manager's responsibility.

### Dependency audit

`npm audit --json` was actually run. The recorded result is **8 high, 0 critical**, all in the development-only
Puppeteer browser-download/proxy chain (`extract-zip`, `basic-ftp`, and their dependants). The release has no runtime
npm dependencies and none of these modules appear in the userscript bundle.

The audit snapshot is `docs/dependency-audit-v2.json`. This is a **known unresolved development-tooling risk**, not
a clean audit. In the checked registry, `extract-zip` had no fixed version beyond 2.0.1; the latest Puppeteer 25
requires Node >=22.12 while this project retains its tested Node-20/Puppeteer-23 toolchain. No untested major-version
replacement or audit-suppression override was installed to hide findings. Avoid feeding untrusted browser archives,
FTP listings or proxy configurations to this development toolchain; use isolated tooling when reproducing tests.
A future toolchain migration and repeat of its browser matrix is recommended separately from this runtime release.

## 6. Live checks and unverified behaviour — explicitly separate

**Live browser checks performed:** real Chrome/canvas/encoders, actual local HTTP+CORS behaviour, actual clipboard
permission/write/readback, and actual anchor downloads on the fixture origins. These are included above as
fixture-based E2E, not “live website compatibility.”

**Public live-site compatibility checks performed:** **none** in this release verification. No selectors,
authenticated endpoints, CAPTCHA flows or site-specific behaviour are claimed to have been observed.

**Not performed / material limitations:**

- No actual Tampermonkey or Violentmonkey version was installed/tested; no Firefox, Safari, mobile or assistive-
  technology manual testing. Pointer/keyboard/ARIA DOM tests do not prove screen-reader or touch-device usability.
- No real manager whitelist prompt, native Save As UI, real cross-tab manager storage synchronisation or download
  completion semantics; emulation cannot settle those questions. An anchor click means initiated, not disk-confirmed.
- No browser-permission bypass or authentication/access-control bypass. Clipboard may fail on another site's
  insecure context, policy, focus or gesture rules. Shortcuts may be intercepted by the OS/site.
- Inventory cannot see cross-origin frame DOM, closed shadow roots or every virtualised/lazy scheme; scanning is
  intentionally capped. Rerender/navigation safety is fixture-tested, not guaranteed for every SPA.
- ZIP is memory-buffered and store-only, not streaming or resumable. Target limit is checked between images with
  8 MiB grace; a single large output can overshoot before the writer's 1 GiB ceiling. Large jobs can pause the UI.
- Metadata support is limited to implemented container fields. Unknown proprietary fields, visible content and
  server-side records are not a privacy sanitisation guarantee. Stripping EXIF can change displayed orientation;
  keeping/removing ICC can affect colour. Inspect warnings before sharing.
- Comparison Save re-encodes the selected format; changed source/settings can change the saved result. GIF remains
  palette/1-bit-alpha limited; smallest bytes is not a perceptual quality or animation fidelity guarantee.
- Jobs are in-memory only. Reload/tab close loses queued work and archive buffers; there is no persistent recovery.
- AVIF encoding unavailable in tested Chrome 131 and honestly gated. No AVIF-enabled browser was exercised.

## 7. Reproduce

```bash
npm ci
pip3 install --user Pillow pypdf
# Install Chrome system libraries if needed (see Puppeteer's Linux requirements).
npm run build
npm run lint
npm run build:check
npm test                   # expected full environment: 513 tests, 90 suites, no skips
npm run test:browser        # expected tested browser: 57 scenarios, no failures/skips
sha256sum release/save-image-as-type.user.js
```

Puppeteer downloads its browser for development only; normal users install the single `.user.js` through their
manager and need no Node, Python or npm packages. `npm ci` uses the recorded lockfile; byte-identical artifact
rebuilds require no external bundler. Raw browser reports are regenerated under `.tmp-browser/report.json`.
