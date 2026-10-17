# Save Image as Type

A userscript that adds a **Save image as** menu to every website: right-click any image and save it
as **PNG, JPG, WebP, GIF, BMP, PDF**, as **AVIF** when your browser can really encode it, or as the
**original file byte for byte** — without uploading anything anywhere.

Everything happens inside your browser. There is no server, no account, no analytics and no
third-party code downloaded at run time.

> **Release status — 2.0.2.** The installable file is
> [`release/save-image-as-type.user.js`](release/save-image-as-type.user.js). It passes this
> repository's regression suite (577 unit tests, 27 static checks, 57 browser scenarios, byte-exact
> encoder goldens) and a Violentmonkey installation test. Tampermonkey is **unverified**; Firefox is
> **untested**. Known limitations are listed in
> [Compatibility](docs/compatibility.md#known-limitations). Nothing here is a security guarantee.

## What it does

| I want to… | What you get |
|---|---|
| Save one image in another format | Right-click → the **Save image as** menu → pick a format. Digits `1`–`9` pick a format while the menu is open. |
| Keep the exact original file | **Original** re-saves the untouched bytes (useful for animated GIF/WebP or archival). |
| Save every image on a page | **Save all images on this page…** lists what it found, then converts with progress, Cancel and safe recovery. |
| Get one file instead of twenty | Choose **A single .zip archive** as the destination. Names are UTF-8, entries are stored (not deflated) and CRC32-checked. |
| Resize/crop/rotate before saving | **Transform and save…** with aspect-locked resize, crop, 90° rotation and horizontal/vertical flips, plus *Make default*. |
| Find the smallest format | **Compare formats…** shows real encoded sizes, then *Save smallest*. |
| Strip GPS/EXIF before sharing | **Inspect metadata** shows EXIF/XMP/ICC and GPS risk; **Save original without metadata** removes supported container fields without touching pixels. |
| Paste an image into another app | **Copy image to clipboard**. |
| Switch between whole setups | **Settings → Configuration profiles**: name the current configuration and re-apply it later. |
| Work by keyboard | `Alt+Shift+S` save, `Alt+Shift+C` copy, `Alt+Shift+P` picker, `Alt+Shift+A` batch, `Alt+Shift+X` cancel — all rebindable. |

Full behaviour with expected outcomes: [User guide](docs/user-guide.md).

## Requirements

* **A userscript manager.** Tested with **Violentmonkey 2.49.0** (MV3, Chromium).
  Tampermonkey 5.5.1 installs but its runtime behaviour was not observed in this repository's lab;
  treat it as unverified.
* **A Chromium-based browser.** Automated checks ran on Chrome 131 and Chrome 155 for Testing
  (headless, Linux). Other Chromium browsers and Firefox are expected to work but are not verified.
* **Node.js ≥ 22.22.2 and Python 3** are needed only to build and verify from source. The installed
  userscript has no runtime dependencies.

## Install

1. Install a userscript manager (Violentmonkey or Tampermonkey).
2. On Chrome/Edge, enable the browser's user-script permission for the manager:
   `chrome://extensions` → manager **Details** → **Allow User Scripts**.
3. Open the raw file and let the manager intercept it:

   ```
   https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js
   ```

   Or install from a checkout: **Violentmonkey** `+` → *Install from file*;
   **Tampermonkey** *Utilities* → *Import from file*.
4. Confirm the prompt. The script asks for exactly ten `GM_*` grants and a wildcard `@connect`;
   the reasons are in [Privacy and permissions](docs/privacy-and-permissions.md).

Do not install two copies: independent installations do not coordinate, and both will register the
same manager commands.

## First run

1. Open any page with an image.
2. Right-click the image. The **Save image as** menu opens. Hold **Shift** while right-clicking to
   get the browser's own menu instead.
3. Pick a format, or press `1` for PNG.
4. A toast reports `Saved <file name>` with the byte size.

If nothing appears, read [Troubleshooting](docs/troubleshooting.md). The most common cause is the
*Allow User Scripts* switch being off.

## Updates, disabling, uninstalling

| Action | How |
|---|---|
| Automatic update | The metadata declares `@updateURL`/`@downloadURL` pointing at the canonical file above. Whether and how often to check is your **manager's** setting; the script itself never performs an update request. |
| Manual update | Install the newer `.user.js` over the old one. Settings survive (schema-3 migration runs automatically). |
| Check which version you have | The manager dashboard shows the version; *Settings → Diagnostics* reports the same value from inside the script. |
| Rollback | Keep the previous file, remove the script, install the older file. Unknown settings keys are ignored. |
| Disable | Toggle the script off in the manager dashboard. No page state needs cleaning. |
| Uninstall | Remove it from the dashboard; optionally clear the manager key `siat.settings.v3`. |

## Documentation

| Document | What it covers |
|---|---|
| [Installation](docs/installation.md) | Manager setup, install paths, first run, removal |
| [User guide](docs/user-guide.md) | Every command, dialog and outcome |
| [Configuration](docs/configuration.md) | The 49 settings and what they change |
| [Settings reference](docs/reference/settings.md) | Generated table of every key, default and range |
| [Advanced usage](docs/advanced-usage.md) | Profiles, batch/ZIP, metadata, manager commands, diagnostics |
| [Compatibility](docs/compatibility.md) | What was actually tested, and the known limitations |
| [Privacy and permissions](docs/privacy-and-permissions.md) | Every grant, every destination, every stored key |
| [Troubleshooting](docs/troubleshooting.md) | Symptom → cause → fix, diagnostics, safe reset |
| [Architecture](docs/architecture.md) | Module map and data flow |
| [Development](docs/development.md) | Build, test, verification harnesses |
| [Release process](docs/release-process.md) | Versioning, gates, tagging, assets |

## Verification status

Measured in this repository, on the current artifact:

| Check | Result |
|---|---|
| Unit suite | 577 tests, 0 failures |
| Static checks (`lint.mjs`) | 27/27 |
| Browser scenarios (real Chromium, built artifact) | 57/57 |
| Security tests | 18/18 |
| Encoder goldens | Byte-exact against pinned independent outputs |
| Real manager (Violentmonkey 2.49.0 MV3, Chrome 155) | Installs and converts; 11/11 independent output checks |

Not verified: Tampermonkey runtime behavior, Firefox, real remote sites, and update-polling timing.
See [Compatibility](docs/compatibility.md).

## Privacy in one paragraph

Your images never leave your machine. The script stores one settings key in your manager, makes no
telemetry, and performs no network request except a `GET` for an image you explicitly asked to
convert when the page's own CORS policy blocks reading its pixels. Installing it does not fetch an
icon; updating is your manager's job, not the script's. Details:
[Privacy and permissions](docs/privacy-and-permissions.md).

## Contributing, support, security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending a patch.
Questions and bugs: [SUPPORT.md](SUPPORT.md) and [issues](https://github.com/shivanshjain456/browser-workflow-tools/issues).
Security reports: [SECURITY.md](SECURITY.md) — please use private reporting, not a public issue.

## License

MIT — see [LICENSE](LICENSE).
