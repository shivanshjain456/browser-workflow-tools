# v2.0.0 — exactly ten user-facing feature sets

The inspected baseline was the working v1 userscript, not just its extension description:
16 runtime modules, 204 passing unit tests, 38 browser scenarios, local conversion in eight
menu formats (AVIF feature-gated), settings import/export, animation decoding, keyboard
navigation *inside* the right-click menu, and manager download fallbacks. Those are not
counted again as new features. The original baseline findings and the decision table were
presented before implementation; this file records the shipped scope and observable checks.

These ten were selected for repeated-use value, distinctness, feasibility without remote
services or executable dependencies, bounded cost, and cohesion around local image saving.
There were no externally blocked features requiring substitution.

| # | Feature / practical benefit | Interaction | Implementation and cost | Important edge | Observable acceptance / evidence |
|---|---|---|---|---|---|
| 1 | **Batch conversion** — avoids repeated right-click saves | Save all → review counts/options → Start; progress, Cancel, safe retry | Inventory → explicit queue states; 1–4 workers; one acquisition per image; multiple outputs optional | Cancel cannot retract an in-flight disk write; partial/unconfirmed saves never replay | `v2-batch-preview-files`, `v2-batch-cancel`, `v2-partial-failure-no-replay`, `v2-cancel-without-jobbar`; queue concurrency measured in units |
| 2 | **Page inventory and picker** — find and select the images worth saving | Browse page images; search/filter/sort, select or “This one” | Bounded DOM/style/frame scan; local thumbnails; live observer only while open | Lazy/CORS/closed-shadow/frame limitations; scanning must not fetch | `v2-inventory-local`: mixed sources, local thumbnails and zero new image requests; `v2-picker-single-routing` |
| 3 | **ZIP export** — one download instead of browser multi-download prompts | Save as ZIP, or ZIP destination in batch dialog | Dependency-free ZIP store writer, UTF-8 paths and CRC-32; buffered, capped | Already-compressed images gain little from DEFLATE; limit overflow switches later outputs to separate files | `v2-zip-multiple-formats`, `v2-multiformat-zip-collisions`; Python zipfile/zlib validate every member and Pillow decodes them |
| 4 | **Transform before save** — get the size/orientation/crop needed immediately | Transform and save; aspect lock, presets, crop, rotate/flip, preview, Make default | Pure geometry plan + canvas draw; reduced preview; per-frame GIF transforms | Original-byte copies cannot include transforms; pixel ceiling, invalid specs and stale async previews guarded | `v2-transform-save`: 200×140 → independently decoded 100×70; `v2-transform-pixel-geometry`: exact red/blue crop, flip and rotation readback; `v2-default-transform` |
| 5 | **Image clipboard** — paste into another app without a temporary file | Copy action or shortcut | Browser Async Clipboard API; explicit MIME probe and PNG re-encode; bounded write timeout | Secure context, page focus, user gesture and permission required; never bypassed | `v2-clipboard-real`: actual Chromium PNG write/readback; `v2-clipboard-denied`: actual denied permission gives explanation |
| 6 | **Filename templates** — useful consistent names in single and batch saves | Settings template with preview; tokens for image/page/output/index/preset | Validated token renderer + existing path sanitation + collision suffix | Untrusted alt/title/URL, missing tokens and length limits | `v2-template-download`: actual saved `127.0.0.1-200x140.png`; multi-format archive collision check; pure rendering tests |
| 7 | **Presets with per-host auto-apply** — repeat a workflow without re-entering settings | Create/select preset; optional exact or wildcard page hosts | Validated bounded data; effective settings overlay, deterministic most-specific host precedence | Global settings must not mutate; zero quality means inherit and must survive reload | `v2-preset-host-roundtrip`: automatic page-host preset transforms and names real WebP output, then survives reload; host specificity/unit round-trips |
| 8 | **Format comparison / smallest-good** — choose using actual encoded sizes | Compare formats → inspect table → Save row or Save smallest | Single acquisition, up to six sequential in-memory encodes; transparency-aware recommendation, lossless near-tie preference | One encoder may fail; no download before confirmation; all-flattening set warns explicitly | `v2-comparison-save`: real byte counts, no pre-confirm save, recommended format independently decoded; cancellation/failure unit coverage |
| 9 | **Metadata inspector and sanitizer** — see and remove embedded camera/location data | Inspect → findings and GPS warning → Save original without metadata | Bounds-checked JPEG/PNG/WebP/GIF container walkers; EXIF parser; XMP is opaque, never XML executed | Orientation/ICC affect display; unsupported/malformed containers retained with notes, not claimed clean | `v2-metadata-inspect-strip`: Pillow-produced GPS fixture → UI warning → EXIF absent and pixel SHA256 identical in independent Pillow verification |
| 10 | **Global keyboard workflow and help** — save/copy/open picker/batch without the menu | Hover + configurable modifier chord; help from manager menu; digits inside menu | Validated physical-key bindings, duplicate/reserved-key checks, typing guard | OS/site shortcuts may win; no plain letter capture | `v2-keyboard-workflow`: real key events save and open picker; ordinary typing makes no save; shortcut/help unit coverage |

## Foundations, in addition to the ten

Shared accessible modal primitive; idempotent bootstrap and disposal; versioned v3 migration;
non-idempotent-save uncertainty handling; bounded queue/observer/scan/preview ownership;
no new userscript grants or executable dependencies; reproducible bundle/freshness/security
gates; independent metadata and ZIP verifiers; source-aligned release metadata and documentation.
These are quality work, not additional counted feature sets.
