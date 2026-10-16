# Troubleshooting

Work through the symptoms in order; each one names the likely cause and what to
collect if it is still broken.

## The menu never appears

1. Is the script enabled in the manager dashboard?
2. Is the manager's user-script permission on? Chrome: `chrome://extensions` →
   the manager's **Details** → **Allow User Scripts**. Chrome 120+ blocks
   userscripts without it.
3. Are you right-clicking an actual image (`<img>`, `<picture>`, CSS background
   image when background scanning is on, or an inline `<svg>`), rather than
   text or empty space?
4. Is *Only open with Shift held* enabled in settings? If yes, the browser's
   menu is the default and Shift gives you the script's.
5. Open the **Capability report** from the manager popup (or *Settings → Diagnostics*). If it does not open either, the
   manager is not running the script at all — reinstall the file.

## The menu appears but saving fails

* The toast states the reason. `The image request failed` means the host refused
  the manager's request: that host may need an explicit permission in the
  manager, or cross-origin fetching may be disabled in settings.
* `The download did not finish in time` usually means a large file on a slow
  connection. Check Downloads before retrying: the script deliberately does not
  repeat an uncertain save.
* `This browser cannot encode …` means the browser refused that format (AVIF is
  the usual case). Choose another format.

## A strict-CSP page refuses conversion

Pages that forbid `img-src` data URLs can block the fallback decode path. The
script reports the failure instead of pretending to succeed; **Original file**
usually still works because it does not need a decoded bitmap. Inline SVG saved
as a raster format is a known limitation — see
[Compatibility](compatibility.md#known-limitations).

## Batch run stopped early

Read the summary: it distinguishes *cancelled* from *failed* and lists how many
files were written. Use **Retry the failed ones** for retryable failures only.
Nothing is replayed automatically when a write's outcome is unknown.

## Settings did not stick

* Confirm you pressed **Save** (Cancel discards the draft).
* If the manager reports storage as unavailable in *Diagnostics*, the script is
  running with an in-memory store for that page — nothing can be saved.
* If a stored value was invalid, the dialog shows *Some stored settings needed
  attention* with the reason and the value that was used instead.

## Collecting diagnostics for a bug report

1. Script version (manager dashboard) and manager name + version.
2. Browser name and version.
3. Diagnostics/Capability report contents (redact anything you consider private — the panel
   contains no URLs you visited other than the manager/browser strings).
4. The exact toast text, and whether the menu opened.
5. A minimal reproduction: page URL pattern (or a local file), image type, and
   the steps you took.

## Safe reset

1. *Settings → Export JSON* first if you want a backup.
2. *Settings → Reset defaults* restores defaults.
3. Full reset: remove the script from the manager, delete the manager's stored
   `siat.settings.v3` key, reinstall. Nothing outside manager storage needs
   cleaning, because the script never writes to pages.
