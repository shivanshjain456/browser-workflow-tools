# Configuration

All settings live in **one** manager-stored key, `siat.settings.v3`, as schema-3
JSON. Nothing is written to the page (`localStorage`, cookies, `IndexedDB` are
never touched).

* **Defaults:** every setting has a safe default; see the generated
  [settings reference](reference/settings.md) for the exact list and values.
* **Validation:** every value read from storage or imported from a file passes
  the same validator. Numbers are clamped into range, unknown ids fall back to
  defaults, strings are length-limited, and anything unexpected is replaced with
  a warning rather than trusted.
* **Persistence:** changes are staged in the dialog draft and written only when
  you press **Save**. *Cancel* discards them. Changes apply to all open tabs
  once saved.
* **Reset:** *Reset defaults* restores the documented defaults; your file is not
  touched.
* **Import/Export:** *Export JSON* writes the complete configuration (including
  presets and profiles). *Import JSON* validates the file before anything
  reaches a control; files above 256 KB of text are refused before reading, and
  hostile shapes (inherited values, accessors, prototype manipulation) are
  neutralised rather than executed.
* **Migration:** v1 and v2 keys are read and migrated once, then written back as
  schema 3. Older builds ignore keys they do not know, so downgrading does not
  corrupt the file.

## Where each setting lives in the interface

| Dialog section | Purpose |
|---|---|
| Formats | Which formats the menu offers and in what order. |
| File naming | Prefix, sub-folder, template with tokens, length cap, collision suffix. |
| Quality | JPEG/WebP quality, PDF page size, background flattening colour. |
| Animation | GIF frame cap, memory ceiling, animation handling. |
| Batch | Concurrency, per-run cap, filters (minimum size, icon skipping, duplicates, not-yet-loaded images), destination, archive size ceiling. |
| Presets | Conversion presets and their host rules. |
| Configuration profiles | Whole-configuration snapshots (new in 2.0.1). |
| Keyboard shortcuts | Rebindable chords for every keyboard action. |
| Behaviour | Context-menu interception, long-press, cross-origin fetching, background-image scanning, job bar, remembered format, notifications. |
| Privacy | What is stored and what is never sent. |
| Diagnostics | Probed manager/browser capabilities, storage state, encoder availability. |

## Naming template tokens

The file-name template accepts `{name}`, `{host}`, `{date}`, `{time}`, `{w}`,
`{h}`, `{ext}`, `{index}`, `{index3}`, `{preset}` and alt/title-based tokens;
invalid templates are rejected in the dialog and never reach a file name.
Windows-reserved device names (`CON`, `NUL`, `COM1`…), control characters and
path separators are handled by the sanitiser regardless of the template.

## Importing a profile from another machine

*Export JSON* on machine A, *Import JSON* on machine B. Configuration profiles
inside that file are re-validated on import: names are length-capped and
deduplicated, and each profile's values are clamped exactly like live settings.
A profile can never contain another profile list, so importing cannot recurse.
