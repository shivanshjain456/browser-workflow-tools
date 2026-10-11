# Privacy Policy & Data-Flow Disclosures

This repository contains personal browser workflow tools built for local productivity, LLM context packing, archive lookups, and web privacy. This document provides clear, honest, and auditable descriptions of all data flows, persistence mechanisms, and third-party interactions across the suite.

---

## Global Privacy Principles

1. **No External Telemetry or Analytics:** None of the scripts contain tracking beacons, Google Analytics, telemetry pings, or background usage beacons.
2. **Local-First Execution:** Computation (HTML-to-Markdown conversion, .gitignore parsing, ZIP compression, OOXML rendering, query parsing, URL parameter cleaning) is performed strictly inside your browser.
3. **Explicit User Initiation:** Privileged actions (reading directories, copying to clipboard, triggering archive probes, or inserting prompt text) require explicit user interaction (clicking a button, dragging files, or pressing a hotkey).
4. **No Hidden Encryption Claims:** Data persisted in browser storage (`GM_setValue` / `localStorage`) is stored unencrypted in plain JSON. Users sharing computer profiles should clear their settings via the provided reset buttons.
5. **No Telemetry in Diagnostics:** When diagnostic logs are enabled for troubleshooting, all tokens, keys, and authorization headers are masked and redacted.

---

## Detailed Per-Script Privacy Disclosures

### 1. Clip LeetCode (`scripts/clip-leetcode`)
- **Data Read:** Problem title, problem body HTML, tags, difficulty, and example test cases from the active LeetCode webpage DOM.
- **Data Transformed:** HTML parsed and transformed into clean Markdown, plain text, HTML, or JSON using an in-memory compiler.
- **Data Stored:** User export format preference, history buffer (last N copied problem titles and slugs for duplicate tracking), and custom templates.
- **Storage Location:** Browser-managed Tampermonkey/Violentmonkey storage (`GM_setValue`).
- **Retention & Deletion:** Retained until overwritten, truncated by the history limit (default: 50 items), or deleted via the "Clear History" button in settings.
- **Third-Party Data Flow:** Zero third-party network access. Data never leaves the browser.
- **Clipboard Behavior:** Writes formatted problem text to your system clipboard upon button click or hotkey. It does **not** read clipboard history.
- **Cookies & Credentials:** None accessed.
- **Capability Degradation:** If `GM_setClipboard` is blocked, falls back to a DOM execCommand copy or displays a modal textarea for manual copy.

### 2. Codebase Uploader (`scripts/codebase-uploader`)
- **Data Read:** File paths, filenames, and text content of directories selected by the user via the HTML5 File System Access API or directory file input.
- **Data Transformed:** Token count estimation, .gitignore rule compilation, binary filtering, and packaging into structured Markdown blocks.
- **Data Stored:** Custom .gitignore rules, token budget limit presets, theme preferences.
- **Storage Location:** Browser userscript storage (`GM_setValue`).
- **Retention & Deletion:** User settings persist until cleared via the settings modal. File contents are held in memory only during the active tab session and are discarded upon page reload or modal close.
- **Target Page Disclosure:** When the user clicks "Insert into Chat", selected code chunks are inserted directly into the active AI provider's composer input (ChatGPT, Claude, Gemini, etc.). When the user submits their prompt to the AI provider, those file contents are transmitted to that provider according to that provider's own terms of service.
- **Third-Party Data Flow:** Zero background network requests. The script itself communicates with no remote servers.
- **Clipboard Behavior:** Writes packaged Markdown chunks to the clipboard only when the user explicitly clicks the "Copy" action.
- **Cookies & Credentials:** None accessed or transmitted.

### 3. ChatGPT Conversation Bridge (`scripts/chatgpt-conversation-bridge`)
- **Data Read:** Public share payload or active conversation message tree (via internal same-origin ChatGPT API fetch or DOM mapping).
- **Data Transformed:** Traverses conversation DAG, downloads referenced image attachments, generates an OpenXML DOCX document in browser memory, compiles a standard ZIP archive with CRC32 verification.
- **Data Stored:** Export preference flags (include images, include thinking process, continuation prompt prefix).
- **Storage Location:** Browser userscript storage (`GM_setValue`).
- **Retention & Deletion:** Generated ZIP/DOCX blobs are discarded from browser memory immediately after triggering the browser's download prompt. Settings persist until reset.
- **Target Page Disclosure:** When continuing a conversation, the script navigates to `https://chatgpt.com/` and pastes the continuation prompt into the new chat composer.
- **Third-Party Data Flow:** Requests are made exclusively to `chatgpt.com` / `chat.openai.com` to retrieve conversation JSON and message images. No external analytics or third-party servers are contacted.
- **Cookies & Credentials:** Uses the user's active same-origin ChatGPT session cookies to fetch private conversation threads when requested by the user.

### 4. Web Archives (`scripts/web-archives`)
- **Data Read:** Current page URL (`location.href`) or user-highlighted link URL.
- **Data Transformed:** URL normalization, tracking parameter stripping, construction of archive lookup queries and Memento TimeMap endpoints.
- **Data Stored:** Active archive engine toggle states, theme preference, snapshot view settings.
- **Storage Location:** Browser userscript storage (`GM_setValue`).
- **Retention & Deletion:** Cached snapshot metadata (timestamp and status) is stored in volatile memory with a short cache TTL and clears on reload. Settings persist until reset.
- **Third-Party Data Flow:** When a user initiates an archive lookup or probe, the script issues cross-origin HTTP GET requests to the chosen archive service (`archive.org`, `archive.is`, `api.perma.cc`, `archive.softwareheritage.org`, `ghostarchive.org`, `megalodon.jp`). Only the target URL being queried is transmitted in the request query string.
- **Clipboard Behavior:** Copies resolved snapshot URLs or original recovered URLs upon explicit user action.
- **Cookies & Credentials:** Cross-origin archive probe requests are unauthenticated (`credentials: omit`); no cookies or credentials are sent to archive providers.

### 5. YouTube Search Command (`scripts/youtube-search-command`)
- **Data Read:** Search query, search result video cards, channel names, view counts, upload dates, and video duration from the active YouTube search results DOM.
- **Data Transformed:** Multi-signal weighted ranking score calculations, fuzzy series/duplicate grouping, title character classification.
- **Data Stored:** Channel ranking rules, category exclusion lists, context weight profiles, hidden channel IDs.
- **Storage Location:** Browser userscript storage (`GM_setValue`).
- **Retention & Deletion:** Channel verdicts and settings persist locally until edited or deleted in the Control Plane dialog.
- **Third-Party Data Flow:** Zero network requests. Operates 100% on the rendered YouTube DOM.
- **Clipboard Behavior:** None.
- **Cookies & Credentials:** None accessed.

### 6. YTShareAntiTrack (`scripts/yt-share-antitrack`)
- **Data Read:** Intercepts YouTube share URLs generated by clicking the "Share" or "Copy Link" buttons on YouTube, m.youtube.com, and music.youtube.com.
- **Data Transformed:** Strips tracking parameters (`si`, `feature`, `utm_*`, `fbclid`, etc.) while strictly preserving functional parameters (`v`, `t`, `list`, `index`).
- **Data Stored:** Parameter allowlist and blocklist settings, cleaned link counter.
- **Storage Location:** Browser userscript storage (`GM_setValue` / `GM.setValue`).
- **Retention & Deletion:** Settings persist until reset.
- **Third-Party Data Flow:** Zero network access. Operates 100% offline.
- **Clipboard Behavior:** Writes the sanitized URL to the clipboard in place of the original tracking-laden URL.
- **Cookies & Credentials:** None accessed.
