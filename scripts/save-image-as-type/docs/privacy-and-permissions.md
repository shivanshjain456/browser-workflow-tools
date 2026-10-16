# Privacy and permissions

Short version: **your images never leave your machine.** The script has no
server, no analytics and no remote configuration.

## What is stored

| Where | What | Why |
|---|---|---|
| Manager storage, key `siat.settings.v3` | Your settings, presets and configuration profiles (schema-3 JSON) | So your configuration survives reloads and can be exported. |
| Manager storage, legacy keys `siat.settings.v2`, `siat.settings`, `saveImageAsType.settings` | Read once for migration, then superseded | Upgrading must not reset your configuration. |

Nothing else is persisted. The script never touches `localStorage`,
`sessionStorage`, `IndexedDB` or cookies — that is enforced by a static lint
rule and by a measured boot check on a blank origin.

## What is transmitted

| Destination | When | What |
|---|---|---|
| The image's own host | Only when you ask for an image whose pixels the page cannot hand over (cross-origin read blocked by the page's CORS policy) | A plain `GET` for that image through `GM_xmlhttpRequest`. |
| Your download folder | When you save | The converted or original bytes, through `GM_download` or the browser's download API. |

There are **no** other requests. No start-up request, no update check
(there is no `@updateURL`), no telemetry, no crash reporting, no remote code, and
no third-party scripts, fonts or stylesheets at run time.

## Every permission and why it exists

| Declaration | Purpose | Could it be narrower? |
|---|---|---|
| `@match *://*/*` | The script's purpose is to convert an image on *whatever* page you are reading. | Per-site includes would break the main use case. |
| `@run-at document-start` | Intercept the context menu and keyboard before the page can swallow them. | Later injection loses some pages. |
| `@grant GM_info` | Report the real manager/browser capabilities in Diagnostics. | — |
| `@grant GM_getValue` / `GM_setValue` / `GM_deleteValue` | Read/write the settings key above. | — |
| `@grant GM_addValueChangeListener` / `GM_removeValueChangeListener` | Apply a settings change in every open tab. | — |
| `@grant GM_xmlhttpRequest` | Fetch an image whose pixels the page blocks; the only network call the script makes. | Turn it off with *Allow fetching cross-origin images* in settings. |
| `@grant GM_download` | Save files through the manager's download path (needed for reliable naming/sub-folders). | Falls back to the browser's download API when unavailable. |
| `@grant GM_registerMenuCommand` | The eight manager commands. | — |
| `@grant GM_notification` | Tell you when a long batch has finished while the tab is in the background. | — |
| `@connect *` | The manager must be allowed to fetch images from arbitrary CDNs. | Wildcard is inherent to a site-agnostic image tool; the request only happens on your explicit action. |

No permission is requested that the code does not use; `lint.mjs` fails the
build if a grant appears in the metadata without a matching use, or vice versa.

## What is never done

* No reading of page text, form fields, keystrokes outside the script's own
  shortcuts, or other tabs.
* No uploads, no image data in any request body, no base64 of your images sent
  anywhere.
* No writing to the page's DOM: every UI element lives in a closed shadow root
  attached to a namespaced host element, and all text is set with `textContent`.
* No `eval`, `new Function`, `innerHTML`, `document.write`, or remote `@require`.
* No page-visible privileged handle: page scripts cannot reach the script's
  manager capabilities.

## Export and deletion

*Export JSON* writes your settings (including profiles and presets) to a file
you choose. Deleting the manager key — or uninstalling the script and clearing
its storage — removes everything the script ever stored.

## Reporting a privacy or security problem

See [SECURITY.md](../SECURITY.md). Please do not open a public issue for
security reports.
