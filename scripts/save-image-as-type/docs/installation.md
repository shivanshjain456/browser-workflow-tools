# Installation

The installable file is [`release/save-image-as-type.user.js`](../release/save-image-as-type.user.js).
It is a single, readable, non-minified file with a valid userscript metadata block. It is the only
distributable copy in this repository.

## 1. Choose and prepare a manager

| Manager | Status in this project |
|---|---|
| **Violentmonkey 2.49.0 (MV3, Chromium)** | Installed and exercised end to end in this repository's manager lab (see [Compatibility](compatibility.md)). |
| **Tampermonkey 5.5.1** | Installation and permissions were checked with the official extension, but no runtime execution could be observed in the lab. Treat as unverified. |
| Firefox-based managers | Not tested. The script uses only standard `GM_*` APIs plus `GM.download`, which Firefox managers normally provide. |
| Chrome Web Store / Edge / Brave / Vivaldi | Chromium-based browsers are expected to work (Chrome 131 and 155 were used for verification); only those two builds were actually run. |

On Chromium, a manager needs the browser's user-script permission:

1. Open `chrome://extensions`.
2. Open the manager's **Details** page.
3. Enable **Allow User Scripts** (Chrome 120+). Without it the manager installs the script but cannot
   run it; the manager will usually warn you.

## 2. Install the script

**From GitHub (normal path):** open this raw URL and let the manager intercept it:

```
https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js
```

The same URL is what `@downloadURL` and `@updateURL` name, so an install from it can be updated by
your manager later.

**From a checkout or downloaded file:**

1. Open the manager dashboard.
2. **Violentmonkey:** `+` → *Install from file* → pick
   `release/save-image-as-type.user.js` → **Install**.
   **Tampermonkey:** *Utilities* → *Import from file* → pick the same file → **Install**.
3. Confirm the prompt. The manager lists the ten `@grant`s and the `@connect` wildcard; see
   [Privacy and permissions](privacy-and-permissions.md) for why each one is needed.
4. The script is now active on `http(s)://*/*` pages.

**Do not install two copies.** Independent installations of this script do not coordinate (see
[Known limitations](compatibility.md#known-limitations)); two enabled copies register duplicate
manager commands.

## 3. First run

1. Open any page that has an image.
2. Right-click the image. The *Save image as* menu opens (hold **Shift** while right-clicking for the
   browser's own menu).
3. Pick a format, or press `1` for PNG.
4. Look for the toast: `Saved <file name>` with the byte size.

If nothing appears, read [Troubleshooting](troubleshooting.md). The most common cause is the
browser's *Allow User Scripts* switch being off.

## 4. Permissions you will be asked about

* Ten `GM_*` grants (storage, downloads, requests, menu commands, notification).
* `@connect *` — needed because images live on arbitrary CDNs. The script only uses it when you ask
  for an image whose pixels the page itself cannot hand over. You can turn manager-based fetching
  off entirely in *Settings → Behaviour → Allow fetching cross-origin images*.

Every item is documented in [Privacy and permissions](privacy-and-permissions.md).

## 5. Updates, rollback, removal

| Action | Steps |
|---|---|
| Automatic update | The metadata declares `@updateURL`/`@downloadURL` pointing at the raw file above. Your manager decides whether and how often to check; the script itself never makes an update request. |
| Manual update | Download the newer `.user.js` and install it over the old one. Settings are preserved (schema-3 migration runs automatically). |
| Check the update is the current one | The manager dashboard shows the script version (`2.0.2`). The file's `@version` and the value reported in *Settings → Diagnostics* agree. |
| Rollback | Keep the previous `.user.js`, remove the script, then install the older file. Settings written by the newer version stay in storage; older builds ignore keys they do not know. |
| Disable | Toggle the script off in the dashboard. No page state needs cleaning. |
| Uninstall | Remove it from the dashboard. Optionally clear the manager's stored settings (one key, `siat.settings.v3`). |

There is no update server operated by this project: the update URL is a static file in this
repository, and the check is performed by your userscript manager.
