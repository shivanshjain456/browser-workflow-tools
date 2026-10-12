# Browser Workflow Tools

> Production-grade browser userscripts engineered for developer productivity, AI context packing, web archive resiliency, and digital privacy.

[![CI](https://github.com/shivanshjain456/browser-workflow-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/shivanshjain456/browser-workflow-tools/actions/workflows/ci.yml)
[![License: Mixed](https://img.shields.io/badge/License-MIT%20%7C%20AGPL--3.0-blue.svg)](LICENSES/)
[![Compatibility](https://img.shields.io/badge/Tampermonkey-Verified-brightgreen.svg)](SMOKE_MATRIX.md)
[![Tests](https://img.shields.io/badge/Tests-29%20Passing-success.svg)](tests/)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/svg/browser-workflow-tools-primary-dark.svg">
    <img src="assets/brand/svg/browser-workflow-tools-primary.svg" alt="Browser Workflow Tools — modular, zero-dependency browser userscripts" width="480">
  </picture>
</p>

---

## Overview

Modern web workflows often suffer from interface friction, fragile browser interactions, aggressive link tracking, and vendor lock-in. **Browser Workflow Tools** is a curated suite of modular, zero-dependency browser userscripts built to solve these challenges directly within the browser runtime.

Every tool in this collection is built to production standards:
- **Zero Wildcard Network Scope:** No `@connect *` grants. All remote requests are strictly confined to explicit, auditable origin allowlists.
- **Client-Side Privacy:** All computation, text transformation, file packaging, and filtering executes locally inside your browser engine.
- **Audited Manifests:** Every artifact declares canonical semver versioning, SPDX license headers, and reproducible installation targets.
- **Comprehensive Automated CI:** Enforced by continuous integration with 29 automated unit tests, secret scanning, syntax validation, and privilege auditing.

---

## The Userscript Collection

| Script | Version | License | Direct Install | Key Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **[Clip LeetCode](scripts/clip-leetcode/)** | `v3.0.0` | [MIT](scripts/clip-leetcode/LICENSE) | [Install .user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/clip-leetcode/clip-leetcode.user.js) | Copies problems to clipboard in Markdown, HTML, JSON, or custom templates with SPA route tracking. |
| **[Codebase Uploader](scripts/codebase-uploader/)** | `v2.0.2` | [MIT](scripts/codebase-uploader/LICENSE) | [Install .user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/codebase-uploader/codebase-uploader.user.js) | Packages codebases into structured Markdown chunks for 20+ AI chats with .gitignore filtering and token budgeting. |
| **[ChatGPT Conversation Bridge](scripts/chatgpt-conversation-bridge/)** | `v1.0.0` | [MIT](scripts/chatgpt-conversation-bridge/LICENSE) | [Install .user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/chatgpt-conversation-bridge/chatgpt-conversation-bridge.user.js) | Archives conversations into permanent ZIPs and styled DOCX documents; stages seamless conversation continuations. |
| **[Web Archives](scripts/web-archives/)** | `v8.0.0` | [MIT](scripts/web-archives/LICENSE) | [Install .user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/web-archives/web-archives.user.js) | Universal keyboard-driven archive launcher querying Wayback Machine, Archive.today, Perma.cc, and Software Heritage. |
| **[YouTube Search Command](scripts/youtube-search-command/)** | `v2.1.0` | [MIT](scripts/youtube-search-command/LICENSE) | [Install .user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/youtube-search-command/youtube-search-command.user.js) | Power-user search control plane with multi-signal weighted ranking, channel policies, and fuzzy series clustering. |
| **[YTShareAntiTrack](scripts/yt-share-antitrack/)** | `v2.0.0` | [AGPL-3.0-or-later](scripts/yt-share-antitrack/LICENSE) | [Install .user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/yt-share-antitrack/yt-share-antitrack.user.js) | Intercepts and purges tracking fingerprints (`si`, `feature`, `utm_*`) from YouTube share links on desktop, mobile, and Music. |

---

## Architectural & Privacy Matrix

The table below summarizes permissions and data flows across the suite. See [PERMISSIONS.md](PERMISSIONS.md) and [PRIVACY.md](PRIVACY.md) for complete audits.

| Script | Matched Sites | Grants | Cross-Origin Hosts | Authenticated? | Data Persisted | Clipboard Behavior | Automatic Actions | User-Visible Disclosure |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Clip LeetCode** | `leetcode.com`, `leetcode.cn` | Storage, Clipboard, Menu, Observers | None (Offline) | No | Format options, clip history buffer | Writes formatted problem text upon user action | Optional auto-copy on acceptance (disabled by default) | In-page action bar, settings modal, toast notifications |
| **Codebase Uploader** | 20+ AI chat domains (Claude, ChatGPT, Gemini, etc.) | Storage, Clipboard, Menu, Info | None (Offline) | No | Token budgets, ignore rule presets | Writes packaged code chunks upon explicit click | None (Executes only on file selection) | Shadow DOM modal, status indicators, file count |
| **ChatGPT Conversation Bridge** | `chatgpt.com`, `chat.openai.com` | Storage, GM_xmlhttpRequest | `chatgpt.com` | Yes (Active session cookies) | Export preferences, continuation prompt prefix | Writes continuation prompts | None (Export is exclusively user-triggered) | Floating Action Button (FAB), progress bar, error toasts |
| **Web Archives** | `*://*/*` (excluding `.pdf`) | Storage, Tabs, Clipboard, Notification, GM_xmlhttpRequest | 13 verified archive hosts (No `*`) | No | Engine toggles, theme, search options | Writes resolved archive URLs | Optional auto-fallback on HTTP 404/DNS error | Keyboard launcher dialog, snapshot picker, context menu |
| **YouTube Search Command** | `youtube.com/*` | Storage, Menu, URL change | None (Offline) | No | Channel ranking rules, context weights | None | Live re-ordering on `/results` search navigation | Inline filter controls, Control Plane dialog |
| **YTShareAntiTrack** | `youtube.com`, `m.youtube.com`, `music.youtube.com` | Storage, Clipboard, Menu | None (Offline) | No | Parameter allowlist, cleaned counter | Intercepts and sanitizes share link clipboard writes | Real-time parameter stripping on share button clicks | Menu command for configuration, optional log |

---

## Browser & Userscript Manager Compatibility

Tested across desktop browser environments. See [SMOKE_MATRIX.md](SMOKE_MATRIX.md) for empirical test logs.

- **Google Chrome (v128+):** Tampermonkey (Recommended), Violentmonkey.
- **Mozilla Firefox (v129+):** Tampermonkey, Violentmonkey.
- **Microsoft Edge (v128+):** Tampermonkey, Violentmonkey.
- **Apple Safari (v17+):** Tampermonkey (Safari Userscripts extension has partial compatibility due to sandbox constraints).

---

## Security & Verification

This repository maintains zero external runtime dependencies. Automated checks run on every commit and pull request:

```bash
# 1. Syntax check across all 6 userscript artifacts
npm run check:syntax

# 2. Strict metadata and semver parser
npm run check:meta

# 3. Privilege audit (enforcing 0 wildcard @connect entries)
npm run check:perm

# 4. Repository secret and credential scanner
npm run check:secrets

# 5. Full unit test suite (29 tests)
npm run test

# Run all checks at once
npm run ci
```

---

## License & Attribution

This repository uses a dual-license architecture clearly delineated by script directory:
- Scripts 1–5 ([clip-leetcode](scripts/clip-leetcode/), [codebase-uploader](scripts/codebase-uploader/), [chatgpt-conversation-bridge](scripts/chatgpt-conversation-bridge/), [web-archives](scripts/web-archives/), [youtube-search-command](scripts/youtube-search-command/)) are licensed under the **[MIT License](LICENSES/MIT.txt)**.
- Script 6 ([yt-share-antitrack](scripts/yt-share-antitrack/)) is licensed under the **[GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)](LICENSES/AGPL-3.0-or-later.txt)**.

---

## Disclaimer

These scripts are personal workflow tools created and published for inspection, review, and personal reuse. They are independent open-source tools and are not officially affiliated with, endorsed by, or sponsored by LeetCode, OpenAI, YouTube, Google, Anthropic, or the Internet Archive.
