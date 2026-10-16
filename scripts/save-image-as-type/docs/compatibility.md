# Compatibility

This page separates **what was actually executed** from what is merely expected.
Anything not listed as tested is unverified.

## Verified in this repository

| Area | Environment | Result |
|---|---|---|
| Unit/contract tests | Node 22.22.2 | **577 tests, 100 suites, 0 failures/skips** |
| Static checks | `lint.mjs` | **27/27** (no page storage, no dynamic code sinks, no page-visible privileged handle, grant usage matches metadata, artifact freshness, …) |
| Browser scenarios | Headless Chrome 155.0.8059.79 via the offline harness with a fake manager | **57/57** twice |
| Exact production artifact | Chrome 155.0.8059.79, blank origin + 10 child frames | Boots once per document; 8 manager commands in the top frame, 0 in children; no public privileged handle; no page-storage calls; no network at boot |
| Native input | Chrome 155.0.8059.79 | Real right-click + real digit/Enter/Space each save exactly once; decoded output pixels equal the source |
| Encoder bytes | Independent Pillow/pypdf/zipfile/zlib + raw offset checks | Six golden outputs byte-identical to the v2.0.0 baseline |
| Actual manager | **Violentmonkey 2.49.0 MV3**, unchanged official build, headless Chrome 155.0.8059.84, local HTTP pages | Same-origin, cross-origin, strict-CSP and data-URL conversions; Original file; settings persistence across a reload; configuration profile capture → reload → apply → delete; 8 popup commands |
| Manager outputs | Pillow/XML on 11 saved files | Raster RGBA exact, original bytes exact, SVG structure valid |

Version numbers above are the exact builds used; they are not a claim of support
for anything else.

## Expected but unverified

* Firefox + Greasemonkey/Violentmonkey (standard `GM_*` APIs are used; no
  Firefox run has been performed).
* Other Chromium browsers (Edge, Brave, Opera, Vivaldi) and Chrome versions
  other than 131 and 155.
* macOS and Windows filesystems. Windows-specific filename hardening is unit
  tested, never executed on Windows.
* Mobile browsers with userscript support.

## Tampermonkey

The official Tampermonkey 5.5.1 extension was installed in the lab and the
script installed normally with the correct permissions, but **no injection
could be observed** — a minimal installed control script was equally inert, so
this is a lab/injection limitation rather than a demonstrated incompatibility.
Until a Tampermonkey run succeeds, treat Tampermonkey as unverified.

## Target scope

`@match *://*/*` with `@run-at document-start`, `http`/`https` only. `file://`,
browser-internal pages and extension pages are out of scope, and the script
does not run there.

## Known limitations

1. **Strict-CSP SVG:** saving an inline SVG as a raster format can fail when the
   page's own policy blocks the decode path; the failure is explicit and
   *Original file* still works.
2. **AVIF** depends on the browser's encoder; the menu marks it unavailable
   rather than writing a mislabelled file.
3. **Independent installations do not coordinate.** Two copies (or two managers
   running the same script) register duplicate commands. Userscript managers do
   not provide a way to arbitrate this safely, and the project refuses to use a
   page-writable marker for it.
4. **No wide-gamut/ICC colour management:** pixel values pass through the
   browser's decoder; the script does not convert colour spaces.
5. **No multipage PDF or document export** — PDF output is a single image page.
6. **No automatic updates** by design (no `@updateURL`).
7. **Accessibility:** typography, reduced-motion, forced-colours and
   more-contrast behaviour were measured through browser preference emulation,
   not with assistive technology or an OS-level setting.
8. **Performance:** GIF encoding is synchronous and can block the main thread for
   around 0.1–0.2 s on the synthetic 512²/1024² test images. Worker offloading
   is not implemented.

## Reporting a compatibility result

If you run the script on a combination that is not listed, a bug report with the
diagnostics panel contents and the outcome is genuinely useful: see
[SUPPORT.md](../SUPPORT.md).
