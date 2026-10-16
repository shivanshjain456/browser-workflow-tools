# Advanced usage

This page is for people who want the script to do more than convert one image.

## Batch automation

* **Presets with host rules** — a preset can carry host patterns
  (`example.com`, `*.photos.example.com`). When *Apply a preset automatically on
  the hosts it lists* is on, the most specific matching rule wins and the menu
  shows which preset is in effect. Rules match the page host only, never a path
  or query string.
* **Filters** — minimum width/height, skip icon-sized images, merge duplicate
  URLs, and *Also download images the page has not loaded yet* (this one costs
  bandwidth and is off by default).
* **Concurrency and caps** — batch concurrency 1–4, per-run image cap up to
  2000, archive size ceiling; anything beyond a cap is reported as skipped, not
  silently dropped.
* **ZIP destination** — one archive with UTF-8 names, collision suffixes and
  CRC-32 per entry. If the archive would exceed its ceiling, the run switches to
  individual files and says so.

## Manager commands

Eight commands are registered, in this order, and **only in the top frame** (so
embedded frames cannot multiply them):

1. `Save Image as Type — Settings…`
2. `Save Image as Type — Convert the last image I pointed at…`
3. `Save Image as Type — Browse page images…`
4. `Save Image as Type — Convert every image on this page…`
5. `Save Image as Type — Copy the last image I pointed at`
6. `Save Image as Type — Keyboard shortcut help`
7. `Save Image as Type — Capability report`
8. `Save Image as Type — Pause on this page`

The labels are the ones the manager shows verbatim (see
`docs/assets/manager-commands.png`, captured from the actual-manager lab).
Embedded frames keep their own right-click menu and shortcut handling, but they
register no commands of their own.

## Diagnostics

*Settings → Diagnostics* reports probed facts: manager name and version,
download mode, storage verdict, which encoders the browser really has (AVIF is
probe-gated), animated-frame decoding, and where settings are stored. It is the
first thing to include in a bug report — see [Troubleshooting](troubleshooting.md).

## Keyboard-first workflow

Rebind every action in *Settings → Keyboard shortcuts*. Chords always require
Ctrl, Alt or Meta; clearing a binding disables that action. `Alt+Shift+A` opens
the batch dialog, `Alt+Shift+P` the picker, `Alt+Shift+X` cancels a run.

## Working with animated images

Animated GIF/WebP sources are handled by the *Animation* settings: keep the
animation (when the target format supports it), take a snapshot, or average
frames. GIF re-encoding is bounded by a frame cap and a memory ceiling; a single
frame above the ceiling is refused rather than crashing the tab.

## Clipboard and transforms without the menu

The clipboard and transform actions are also exposed through the manager menu
and keyboard chords, so they can be used without opening the right-click menu.

## Reproducing a conversion outside the browser

For debugging encoders there are two offline probes:

```sh
npm run probe:encoders   # BMP/GIF/PDF/ZIP writers on fixture data
npm run probe:codecs     # decode-independent structural checks
```

They import `src/encoders/*` directly and need no browser. See
[Development](development.md).
