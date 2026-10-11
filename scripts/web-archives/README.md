# Web Archives

> Find archived and cached versions of any web page across Wayback Machine, Archive.today, Perma.cc, Ghostarchive, Megalodon, WebCite, Software Heritage, and Yandex.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/web-archives/web-archives.user.js)

---

## 1. Problem It Solves
Link rot, paywalls, censorship, and server outages frequently make valuable online resources inaccessible. Finding historical snapshots manually requires visiting multiple independent web archives, re-typing or pasting URLs, and guessing which archive holds the closest capture.

## 2. Why the Workflow Exists
Journalists, researchers, developers, and power users need a fast, keyboard-driven launcher to instantly look up or automatically recover archived copies of dead links and broken pages across all major global web preservation services.

## 3. Feature List
- **Keyboard-Driven Launcher:** Open with `Ctrl+Shift+A` (or `Cmd+Shift+A`) to quickly search or navigate to snapshots.
- **Multi-Engine Resolution:** Integrates Wayback Machine, Archive.today / Archive.is, Perma.cc, Software Heritage, Ghostarchive, Megalodon, WebCite, and Yandex Cache.
- **Live Snapshot Probing:** Asynchronously queries archive availability APIs and Memento TimeMaps to show capture counts and latest dates before you open a tab.
- **Wayback Date Picker:** Browse and select historical captures by year, month, and day via the Wayback CDX index.
- **Automatic Fallback:** Optional setting to automatically trigger archive search when encountering HTTP 404, 502, or DNS resolution failures.
- **Right-Click Context Menu:** Look up any highlighted link directly via the context menu.
- **URL Canonicalization:** Automatically strips transient tracking tokens (`utm_*`, `fbclid`) to ensure historical matches are found.

## 4. Supported Routes & Exclusions
- **Supported:** Runs on all standard HTTP/HTTPS web pages (`*://*/*`).
- **Exclusions:**
  - PDF documents (`*://*/*.pdf*`) are explicitly excluded to prevent interfering with built-in browser PDF viewers.
  - Automatically ignores localhost, loopback (`127.0.0.1`), and private IPv4 ranges (`192.168.*`, `10.*`).

## 5. Install & Update Instructions
- **Direct Install:** Click [web-archives.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/web-archives/web-archives.user.js) with Tampermonkey or Violentmonkey installed.
- **Updates:** Tracked via raw GitHub main branch release.

## 6. Example Workflow
1. Encounter a broken article or 404 page error.
2. Press `Ctrl+Shift+A` (or right-click the page / link).
3. The Web Archives launcher modal appears with live status indicators next to each engine:
   - *Wayback Machine: 42 snapshots (Latest: 2024-03-12)*
   - *Archive.today: Available (2023-11-15)*
4. Press `Enter` or click to open the snapshot in a new tab.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue` / `GM_deleteValue` / `GM_listValues`: Stores active engine selections, theme, and search options.
- `GM_openInTab`: Opens archive snapshots in background or foreground tabs.
- `GM_setClipboard`: Copies resolved archive URLs to your clipboard.
- `GM_xmlhttpRequest`: Performs unauthenticated availability probes against official archive APIs.
- `@connect <domains>`: **Strictly constrained** to official archive endpoints (`archive.org`, `web.archive.org`, `api.perma.cc`, `archive.softwareheritage.org`, `archive.is`, `archive.today`, `archive.ph`, `ghostarchive.org`, `megalodon.jp`). **No wildcard `@connect *` is ever used.**

## 8. Outbound Network Hosts & Payload Categories
- Requests are sent exclusively to the archive hosts declared in the manifest. The only data transmitted is the target URL being checked. Zero personal information, cookies, or headers are transmitted.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** User UI preferences (enabled engines, theme, keyboard shortcuts).
- **Snapshot Cache:** Results are cached in volatile memory during the active session.
- **Deletion:** Reset settings via the options tab in the launcher dialog.

## 10. Security & Privacy Considerations
- **No Wildcard Connect:** Conforms strictly to static domain allowlisting.
- **Safe Navigation:** All outgoing links opened via `GM_openInTab` or anchor elements enforce `noopener` and `noreferrer`.
- **Target Sanitation:** Rejects `javascript:`, `data:`, and local network addresses to prevent SSRF or local port probing.

## 11. Browser & Manager Compatibility
- **Chrome / Firefox / Edge:** Verified on Tampermonkey and Violentmonkey.
- **Safari:** Supported with Tampermonkey. (Safari Userscripts extension has sandbox limitations for cross-origin probes).

## 12. Known Limitations & Breakage Points
- Archive.today / Archive.is periodically presents Cloudflare bot challenges, which may return a 403 status during automated background probes (handled gracefully as "Unknown status").

## 13. Troubleshooting
- *Shortcut does not open:* Check for hotkey conflicts in your browser settings, or trigger via the Tampermonkey extension menu.

## 14. Test Status
- Tested in Node.js test runner (`tests/web-archives/web-archives.test.mjs`).
- 4/4 passing unit tests covering target URL validation, Memento TimeMap parsing, static host allowlist enforcement, and target construction.

## 15. License & Attribution
- Licensed under the [MIT License](LICENSE).
- Created and maintained by **Shivansh Jain**.
