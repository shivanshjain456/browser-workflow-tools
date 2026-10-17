# Browser & Userscript Manager Compatibility Matrix

This document records the empirical testing matrix for the tools in this collection.
Any platform not verified is explicitly marked as **Not Tested**.

> **Scope.** The environment rows below were measured on 2026-10-12 against the six scripts that
> existed then (clip-leetcode, codebase-uploader, chatgpt-conversation-bridge, web-archives,
> youtube-search-command, yt-share-antitrack). `save-image-as-type` was added on 2026-10-16 and is
> **not covered by these rows**; its measured status is in
> [`scripts/save-image-as-type/docs/compatibility.md`](scripts/save-image-as-type/docs/compatibility.md)
> (Violentmonkey 2.49.0 verified; Tampermonkey unverified; Firefox untested).

---

## Environment Matrix

| Browser | Userscript Manager | Manager Version | Operating System | Support Status | Last Tested Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Chrome (v128+)** | Tampermonkey | v5.1+ | Windows 11 / macOS | **Verified Working** | 2026-10-12 |
| **Mozilla Firefox (v129+)** | Tampermonkey | v5.1+ | Windows 11 / Linux | **Verified Working** | 2026-10-12 |
| **Mozilla Firefox (v129+)** | Violentmonkey | v2.18+ | Windows 11 / Linux | **Verified Working** | 2026-10-12 |
| **Microsoft Edge (v128+)** | Tampermonkey | v5.1+ | Windows 11 | **Verified Working** | 2026-10-12 |
| **Apple Safari (v17+)** | Userscripts for Safari | v2.0+ | macOS | *Partially Compatible* (GM_xmlhttpRequest restricted) | 2026-10-12 |
| **Opera (v112+)** | Tampermonkey | v5.1+ | Windows 11 | *Not Tested* | — |
| **Orion Browser** | Built-in Userscripts | — | iOS / macOS | *Not Tested* | — |

---

## Detailed Functional Smoke Test Log

| Test Case | Tool | Expected Behavior | Observed Behavior | Environment | Date | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **First Install & Update** | All 6 scripts (not save-image-as-type) | Manager prompts 1-click install; recognizes metadata, grants, and matches | Instant installation with proper icon, description, and requested permissions | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Unsupported Route Inertness** | `clip-leetcode` | On non-problem route (`/explore`), script allocates 0 UI buttons or watchers | Script exits early; zero DOM modifications or errors | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Unsupported Route Inertness** | `youtube-search-command` | On YouTube homepage (`/`), script remains dormant until `/results` is entered | Script runs zero ranking algorithms; DOM untouched | Firefox / Violentmonkey | 2026-10-12 | **Pass** |
| **Missing GM Grants Fallback** | `clip-leetcode` | If `GM_setClipboard` fails or is blocked, falls back gracefully | Uses DOM execCommand fallback; logs diagnostics | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Volatile Storage Fallback** | `web-archives` | When GM storage is wiped, resets cleanly to built-in defaults | Applies built-in defaults without crashing or throwing errors | Edge / Tampermonkey | 2026-10-12 | **Pass** |
| **Settings Migration & Reset** | All 6 Scripts | Clicking "Reset Settings" restores pristine defaults | Stored GM values deleted and default schemas re-applied | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Keyboard Accessibility & Focus** | `web-archives` | Pressing `Ctrl+Shift+A` opens launcher dialog; `Esc` closes; arrow keys navigate | Focus trapped cleanly within dialog; input focused on open | Firefox / Violentmonkey | 2026-10-12 | **Pass** |
| **Dual Script Coexistence** | `youtube-search-command` + `yt-share-antitrack` | Both scripts run simultaneously on YouTube without interference | Search command re-ranks results while share anti-track cleans URLs | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Network Blocked / Offline** | `web-archives` | When network is offline, archive probe displays clean error state | Reports "network unreachable" in UI without unhandled promise rejection | Firefox / Violentmonkey | 2026-10-12 | **Pass** |
| **Special Characters & Unicode** | `clip-leetcode` | Problems with math notation, Chinese characters, and emoji copy accurately | Markdown and JSON exports preserve complete UTF-8 code points | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Malformed Server Response** | `chatgpt-conversation-bridge` | If ChatGPT returns non-JSON or HTML 502, displays readable toast error | Catches parse error; displays notification rather than freezing | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Private/Local URL Defense** | `web-archives` | Probing `http://localhost:8080` or `192.168.1.1` is blocked immediately | Validation flags local address and prevents cross-origin probe | Edge / Tampermonkey | 2026-10-12 | **Pass** |
| **Secret File Alert** | `codebase-uploader` | Selecting directory with `.env` and `id_rsa` flags them with warning | UI warns user and marks sensitive files for exclusion | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Large ZIP Member Assembly** | `chatgpt-conversation-bridge` | 200+ message chat with 10 image attachments exports without memory leak | Generates 15MB ZIP + DOCX within 2.5s; triggers download | Chrome / Tampermonkey | 2026-10-12 | **Pass** |
| **Clipboard Denial Fallback** | `yt-share-antitrack` | If clipboard write permission denied, gracefully aborts with warning | Logs warning in console; no broken user experience | Firefox / Violentmonkey | 2026-10-12 | **Pass** |

---

## Known Limitations

1. **Safari WebExtension GM_xmlhttpRequest:** On Safari (via Userscripts extension), cross-origin requests to certain archive domains may be blocked by Safari's stricter App Sandbox. Users should install via Tampermonkey for full support.
2. **Dynamic YouTube Polymer Shell:** YouTube occasionally experiments with varying internal element tag names for the share modal. `yt-share-antitrack` uses multiple redundant hook strategies (event capture + DOM observation + clipboard interception) to remain resilient.
