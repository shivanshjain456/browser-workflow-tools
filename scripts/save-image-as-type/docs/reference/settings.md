<!-- GENERATED FILE — do not edit by hand. Run `npm run docs:settings`. -->

# Settings reference

Generated from `src/core/settings.js` (schema version 3). The script stores these 49 keys in the single manager-storage key `siat.settings.v3`; nothing is written to the page.

Every value below is validated on load: numbers are clamped into range, unknown ids fall back to defaults, strings are length-capped, and a rejected value produces a warning that the dialog shows under *“Some stored settings needed attention”*.

| Setting | Default | Meaning (from the schema comment) |
|---|---|---|
| `activePresetId` | `""` | Preset currently forced on, or empty for none. |
| `allowCrossOriginFetch` | `true` | Fetch cross-origin image bytes through the manager (the CORS bypass). |
| `autoApplyPresetByHost` | `true` | Apply the most specific host-matching preset automatically. |
| `batchConcurrency` | `2` | How many images convert at once. |
| `batchDedupe` | `true` | One output per distinct source URL. |
| `batchDestination` | `"files"` | 'files' = one download each; 'zip' = a single archive. |
| `batchFormats` | `[]` | Extra formats to write per image (empty = only the chosen format). |
| `batchIncludeNotLoaded` | `false` | Force-load images the page has not loaded yet. |
| `batchMaxImages` | `200` | Upper bound for one batch run; the rest are reported as skipped. |
| `batchMinHeight` | `0` | Minimum image height a batch run will convert (0 = off). |
| `batchMinWidth` | `0` | Ignore images smaller than these (0 = off). |
| `batchSkipTiny` | `true` | Skip icon-sized images in batch runs. |
| `compareFormats` | `["png","jpg","webp"]` | Formats measured by "Compare formats…". |
| `copyFormat` | `"png"` | 'png' = re-encode for the clipboard; 'original' = try the source bytes first. |
| `defaultTransform` | `null` | Transform applied unless the dialog overrides it. |
| `downloadBehavior` | `"instant"` | 'instant' = save without a dialog where the manager allows it; 'ask' = request Save As. |
| `downscaleAboveMegapixels` | `40` | Downscale very large images before encoding, to keep the tab alive. |
| `dropIccWhenStripping` | `false` | Also drop the ICC colour profile (changes how colours may look). |
| `enableBackgroundImages` | `true` | Include CSS background images when looking for something to convert. |
| `enableLongPress` | `true` | Open the menu by holding a finger on an image (touch devices). |
| `enableShortcuts` | `true` | Master switch for the keyboard chords. |
| `filenameCollisionSuffix` | `true` | Add -2, -3 … when one run would otherwise overwrite a name. |
| `filenamePrefix` | `""` | Text joined to the front of every file name; path separators are removed. |
| `filenameTemplate` | `""` | '' keeps the classic "{prefix}-{base}" naming. |
| `flattenBackground` | `"white"` | Background used when a format cannot store transparency (JPG, PDF, GIF-without-alpha). |
| `formats` | `["png","jpg","webp","gif","bmp","pdf","original"]` | Which formats appear in the right-click menu, in this order. |
| `gifMaxFrames` | `100` | How many frames of an animated source are kept; extra frames are dropped evenly. |
| `gifMemoryLimitMB` | `512` | Refuse a GIF conversion above this many MB of raw frame pixels (crash guard). |
| `interceptContextMenu` | `true` | Replace the browser context menu over images with the conversion menu. |
| `jpegQuality` | `0.92` | JPEG quality (0.5–1.0) for JPG output and the image inside a PDF. |
| `keepAnimation` | `true` | Animated sources: try to keep every frame when the browser can decode them. |
| `maxFilenameLength` | `64` | Upper bound for the file-name stem; the extension always fits. |
| `menuActions` | `["copy","transform","compare","inspect","browse","batch"]` | Which extra actions the right-click menu shows. |
| `notifyOnError` | `true` | Raise a manager notification when a background action fails. |
| `pdfPageFit` | `"a4"` | PDF page geometry: 'a4' \| 'letter' (fit, keep aspect) \| 'pixel' (1px = 0.75pt). |
| `presets` | `[]` | Conversion presets (per-conversion overlays with optional host rules). |
| `profiles` | `[]` | Whole-configuration snapshots the user names and switches between. |
| `rememberLastFormat` | `true` | Pre-select the format used last in this page session. |
| `requireShift` | `false` | Power option: only open our menu when Shift is held, leaving the native menu as default. |
| `scanBackgrounds` | `true` | Scan page elements for CSS background images during the picker scan. |
| `scanElementCap` | `2500` | Elements inspected while looking for CSS background images. |
| `schemaVersion` | `3` | Storage schema this build writes; older keys are migrated forward, never silently discarded. |
| `shortcuts` | `{"quickSave":"Alt+Shift+S","copyImage":"Alt+Shift+C","openPicker":"Alt+Shift+P","saveAll":"Alt+Shift+A","cancelJob":"Alt+Shift+X"}` | User-bindable chords; see src/core/shortcuts.js for the action list. |
| `showJobBar` | `true` | Show the small progress bar while a batch runs. |
| `stripMetadataOnOriginal` | `false` | Drop EXIF/XMP when re-saving the *original* file. |
| `subfolder` | `""` | Optional relative download sub-folder (browser download mode only). |
| `warnAboutGps` | `true` | Warn when inspected metadata contains GPS coordinates. |
| `webpQuality` | `0.9` | WebP quality (0.1–1.0). |
| `zipMaxMB` | `512` | Refuse to build an archive above this many MB in memory. |

## Formats offered by the menu

| Id | Label | Output | Transparency | Engine |
|---|---|---|---|---|
| `png` | PNG | `.png` | yes | browser encoder (verified by MIME check) |
| `jpg` | JPG | `.jpg` | flattened onto the background colour | browser encoder (verified by MIME check) |
| `webp` | WebP | `.webp` | yes | browser encoder (verified by MIME check) |
| `gif` | GIF | `.gif` | yes | hand-written `gif` writer |
| `bmp` | BMP | `.bmp` | yes | hand-written `bmp` writer |
| `pdf` | PDF | `.pdf` | flattened onto the background colour | hand-written `pdf` writer |
| `avif` | AVIF | `.avif` | yes | browser encoder (verified by MIME check) |
| `original` | Original file | `.` | yes | hand-written `passthrough` writer |

## Default keyboard shortcuts

| Action | Default chord |
|---|---|
| `quickSave` — Save the image under the pointer in the last-used format | `Alt+Shift+S` |
| `copyImage` — Copy the image under the pointer to the clipboard | `Alt+Shift+C` |
| `openPicker` — Open the page image picker | `Alt+Shift+P` |
| `saveAll` — Convert every image on this page | `Alt+Shift+A` |
| `cancelJob` — Cancel the running batch job | `Alt+Shift+X` |

Chords always require Ctrl, Alt or Meta. Every action is rebindable in *Settings → Keyboard shortcuts*, and clearing a field disables that action.

## Limits

| Limit | Value |
|---|---|
| Conversion presets | 12 |
| Host rules per preset | 8 |
| Configuration profiles | 8 |
| Configuration-profile name length | 40 characters |
| Settings import size | 256 KB of text, refused before reading the file |

## Localised strings

The strings added by the configuration-profile feature ship in 3 languages (en, ar, hi), with right-to-left layout for Arabic. The rest of the interface is currently English-only — see [Compatibility](../compatibility.md#known-limitations).

