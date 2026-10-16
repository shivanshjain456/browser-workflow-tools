# User guide

Everything here is reachable from the right-click menu, the keyboard, or the
eight manager commands — no configuration file is required.

## 1. The right-click menu

Right-click an image. The menu is titled **Save <what you pointed at> as** and
contains, in order:

| Item | What happens |
|---|---|
| **PNG / JPG / WebP / GIF / BMP / PDF** | The image is decoded locally and re-encoded in that format, then saved through the manager. Digits `1`–`9` pick a format directly. |
| **Original** | The untouched bytes are saved. For the page's own image this is a plain download; for a cross-origin image the script fetches the bytes once through the manager and reuses them. |
| *(separator)* | |
| **Copy image to clipboard** | PNG (or the original bytes, per your setting) goes to the system clipboard. |
| **Transform and save…** | Resize, crop, rotate and flip before saving. |
| **Compare formats…** | Encodes several ways and shows the real sizes. |
| **Inspect metadata** | EXIF/XMP/ICC and GPS risk, with the option to strip container metadata. |
| **Browse page images…** | The page picker. |
| **Save all images on this page…** | The batch dialog. |
| **Settings** | Opens the settings dialog (*Formats, file names, quality, privacy*). |
| **Cancel the running conversion** | Appears only while a conversion or batch is running. |

Which of the six action items appear is configurable in *Settings → Behaviour →
Extra menu actions*. Right-clicking anything that is not an image is left
completely alone: the browser's own menu appears.

## 2. Saving one image

1. Right-click the image → choose a format (or press a digit).
2. Watch the toast. It reports the file name, format, byte size and which
   transport was used (*saved through your userscript manager* vs. a plain
   browser download).
3. Failures are explained in the toast with a *What to do* line where a fix
   exists (for example, retry after opening the image in its own tab).

Transparency is preserved for PNG/WebP/GIF/BMP; JPG and PDF flatten onto the
background colour you choose in settings.

## 3. Saving many images (batch)

**Save all images on this page…** in the menu, or `Alt+Shift+A`.

1. The dialog previews what was found: counts by state, cross-origin warnings,
   skipped icons, duplicates, and the formats that will be produced.
2. Choose one or more extra formats, the naming, and the destination
   (*one file per image* or *one .zip archive*).
3. **Start**. A progress toast plus an optional job bar show
   `finished / running`, with **Cancel** always reachable.
4. When it ends you get a summary, including a **Retry the failed ones** action
   for the images that failed for a retryable reason. An uncertain save is never
   retried automatically — the file might already be on disk.

Interrupted runs: cancelling stops new items, finishes the current one, and
reports how many files were already written. Nothing is replayed.

## 4. Picking one image from a busy page

**Browse page images…** (`Alt+Shift+P`) lists every candidate with dimensions,
type, origin and loading state, with search, filter and sort. Select a row, or
use **This one** to convert the image you right-clicked. No image is downloaded
to build the list; entries the page has not loaded yet are marked as such and
are only fetched if you tick the corresponding batch option.

## 5. Transforming before saving

**Transform and save…** (menu or shortcut) offers aspect-locked resize (with presets), crop
(drag a selection or type a rectangle), 90° rotation and flips. The preview
updates as you type. **Make default** stores the transform for future saves.
Order of operations is fixed and shown in the dialog: crop → rotate/flip →
resize. **Original file** is refused while a transform is active, because raw
bytes cannot be cropped without re-encoding.

## 6. Comparing formats

**Compare formats…** encodes the image several ways and shows the real file
size of each result, with transparency effects called out. **Save smallest**
saves the winner; individual formats can be saved too. Comparison is bounded by
the same memory ceilings as a normal save.

## 7. Inspecting and stripping metadata

**Inspect metadata** shows EXIF, XMP and ICC presence, including GPS
coordinates and a risk note. **Save original without metadata** removes the
supported container fields (EXIF/XMP/GPS/ICC segments) while keeping the pixel
data untouched — it is a container edit, not a re-encode.

## 8. Clipboard

**Copy image to clipboard** writes PNG (or the original bytes when the format
allows) to the system clipboard. Browsers only allow this from a user gesture
and some contexts refuse it; the script explains which case you hit instead of
failing silently.

## 9. Keyboard workflow

| Default chord | Action |
|---|---|
| `Alt+Shift+S` | Save the last hovered image |
| `Alt+Shift+C` | Copy the last hovered image |
| `Alt+Shift+P` | Open the page picker |
| `Alt+Shift+A` | Open the batch dialog |
| `Alt+Shift+X` | Cancel the running job |

While the menu is open: digits pick a format, `Enter`/`Space` activate the
focused item, arrow keys move, `Esc` closes. Every chord can be rebound in
*Settings → Keyboard shortcuts*, and each requires Ctrl, Alt or Meta so plain
typing is never intercepted. On Windows, `Alt+Shift` is also the language
switch chord — rebind if your system grabs it first.

## 10. Profiles and presets

* **Conversion presets** (*Settings → Presets*) bundle format, quality, naming,
  destination and transform for repeated conversion work, optionally
  auto-applied on host patterns you list.
* **Configuration profiles** (*Settings → Configuration profiles*) are named
  snapshots of your *whole* configuration, applied with one button. They are
  stored with your settings and travel in *Export JSON*.

## 11. Recovery

| Situation | What to do |
|---|---|
| A batch stopped halfway | The summary says how many files were written. Use **Retry the failed ones** — already-written files are not repeated. |
| A save reported "not confirmed" | Check your Downloads folder before retrying; the script will not retry an uncertain write on its own. |
| The menu does not appear | Check the manager is enabled and *Allow User Scripts* is on; see [Troubleshooting](troubleshooting.md). |
| A strict-CSP page refuses a conversion | The page's own policy blocked the image pipeline. *Original file* usually still works. SVG-as-raster is a known limitation. |
| Settings look wrong | *Settings → Reset defaults*, or import a previously exported JSON file. |
