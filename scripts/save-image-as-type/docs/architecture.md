# Architecture

## Shape of the product

One readable file is installed; it is built from 41 ES modules in `src/`. The
bundle is a single strict-mode IIFE with no runtime imports, no dynamic code and
no global state on the page.

```
src/entry.js ──► src/main.js ──► UI (src/ui/*) ──► core services
                      │                              ├─ core/gm.js       manager adapter (capability probing)
                      │                              ├─ core/settings.js schema, validation, migration, storage
                      │                              ├─ core/source.js   acquire the image (bytes or decoded bitmap)
                      │                              ├─ core/convert.js  decode → transform → encode
                      │                              ├─ core/download.js save through the manager or the browser
                      │                              ├─ core/presets.js  per-conversion overlays + host rules
                      │                              └─ core/profiles.js whole-configuration snapshots
                      └─ encoders/  bmp.js · gif.js · pdf.js · zip.js   hand-written, byte-golden tested
```

## Data flow for one save

1. **Acquisition** — `targetFor(element)` decides what the user pointed at
   (`<img>`, `<picture>`, background image, inline `<svg>`), then
   `acquireImage()` gets pixels: the page's own decoded image when readable, a
   local data-URL parse, or a single manager `GET` when CORS blocks the read.
   Every decode is leased: timeout, abort and late completion all close their
   resources exactly once.
2. **Conversion** — `convertImage()` draws to a canvas, applies the transform
   (crop → rotate/flip → resize), then encodes with the browser (`canvas.toBlob`,
   verified against the requested MIME type) or with the hand-written encoder.
3. **Saving** — `saveBlob()` uses `GM_download` when available and falls back to
   the browser download API. Failures carry a certainty flag: a *definite*
   refusal is retryable, an *uncertain* outcome never is, because the file may
   already be on disk.

## Invariants the code and checks preserve

1. **No page storage.** Settings live only in manager storage.
2. **No privileged handle on the page.** No `window`/DOM expando gives page
   scripts access to `GM_*` capabilities; there is no page-controlled boot flag.
3. **No dynamic code or HTML sinks.** No `eval`, `new Function`, `innerHTML`,
   `document.write`; all UI text goes through `textContent` in a shadow root.
4. **Untrusted input is data, never behaviour.** Settings, imports, manager
   responses and file names pass through own-data-only validation before use.
5. **UI events must be real user interaction.** Synthetic `contextmenu`/`click`
   events from page scripts do not open the menu or trigger privileged work.
6. **Byte contracts hold.** Six encoder outputs are pinned to the v2.0.0
   baseline; any byte change fails the suite.
7. **Frame policy is explicit.** Interaction is document-local; the eight
   manager commands are registered in the top frame only.
8. **Uncertain writes are never repeated automatically.**

`lint.mjs` enforces 1–3 and 7 statically over every source file and the built
artifact; `test/unit` and the browser/production probes enforce the rest.

## Why `release/` instead of `dist/`

The artifact is generated but *committed*, because installing straight from the
repository is the primary installation path for a userscript: a raw link to a
committed file works, whereas a build-time-only artifact does not exist until CI
runs. `dist/` would also be excluded from the workspace snapshots used during
development of this project, so the deliverable could silently disappear between
builds. `build.mjs --check` guarantees the committed file matches `src/`, so the
familiar risk of a committed build going stale is covered by CI (`npm run
build:check`) and by `npm run verify:release`.

## Extension points

* **New output format:** add an entry to `src/core/formats.js` (id, label, mime,
  engine) and, for a non-native engine, an encoder module plus golden bytes.
* **New setting:** add it to `DEFAULT_SETTINGS`, validate it in
  `normalizeSettings`, expose it in `src/ui/panel.js`; the generated settings
  reference picks it up automatically.
* **New interface string:** add it to `src/core/messages.js` in **every**
  catalogue (the unit suite fails if a catalogue is incomplete).
