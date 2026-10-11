# Clip LeetCode

> Browser userscript to copy any LeetCode problem directly to your clipboard in Markdown, plain text, HTML, JSON, or custom template formats.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/clip-leetcode/clip-leetcode.user.js)

---

## 1. Problem It Solves
When practicing coding problems on LeetCode or preparing for technical interviews, engineers frequently copy problem descriptions into personal note-taking systems (Obsidian, Notion, Logseq), GitHub repositories, or local IDE workspaces. Manually copying raw text results in mangled formatting, missing code blocks, broken mathematical equations, and lost example test cases.

## 2. Why the Workflow Exists
Existing browser extensions for LeetCode frequently stop working due to LeetCode's dynamic single-page application (SPA) updates, inject bloated third-party analytics, or lack format customization. This userscript runs 100% locally with zero external network dependencies and provides immediate, customizable clipboard exports.

## 3. Feature List
- **One-Click Export:** "Copy" / "Copy Markdown" buttons injected seamlessly next to the problem title.
- **Multiple Formats:** Instant export to Markdown, Plain Text, HTML, JSON, or a custom user-defined template.
- **SPA Route Observers:** Dynamically tracks Next.js / React client-side route transitions without requiring a page reload.
- **Keyboard Shortcuts:** Configurable global hotkeys (`Alt+C`, customizable in settings).
- **History Buffer:** Maintains an in-memory & persisted buffer of previously clipped problems to track daily problem sets.
- **Settings Panel:** Full UI modal for configuring default formats, template strings, hotkeys, and history retention.

## 4. Supported Routes & Exclusions
- **Supported:**
  - `*://*.leetcode.com/problems/*`
  - `*://*.leetcode.com/contest/*/problems/*`
  - `*://*.leetcode.cn/problems/*`
  - `*://*.leetcode.cn/contest/*/problems/*`
- **Exclusions:**
  - Non-problem surfaces (`/explore`, `/problemset`, `/contest` overview pages) are matched for navigation observation but the script exits early before allocating UI buttons or memory.

## 5. Install & Update Instructions
- **Direct Install:** Click [clip-leetcode.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/clip-leetcode/clip-leetcode.user.js) with Tampermonkey or Violentmonkey installed.
- **Automatic Updates:** The script header includes `@updateURL` pointing to the main branch raw release artifact.

## 6. Example Workflow
1. Navigate to any LeetCode problem (e.g., `https://leetcode.com/problems/two-sum/`).
2. Notice the "Copy Markdown" button adjacent to the problem title.
3. Click the button or press `Alt+C`.
4. Open your markdown notes (e.g. Obsidian) and press `Ctrl+V` / `Cmd+V`. The problem title, difficulty badge, problem statement, and code examples are pasted with clean formatting.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue` / `GM_deleteValue`: Persists user settings, default export format, and history buffer.
- `GM_setClipboard`: Writes formatted problem text to the operating system clipboard.
- `GM_registerMenuCommand` / `GM_unregisterMenuCommand`: Adds "Settings" and "Clip Current Problem" to the userscript manager popup menu.
- `GM_addValueChangeListener` / `GM_removeValueChangeListener`: Synchronizes settings in real-time across multiple open browser tabs.

## 8. Outbound Network Hosts & Payload Categories
- **None:** The script communicates with 0 remote servers. There is no telemetry, no analytics, and no background fetching.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** User configuration JSON object containing export format preferences, hotkey preferences, and a list of clipped problem slugs/titles.
- **Retention:** Stored locally in the browser's userscript storage until cleared.
- **Deletion:** Click "Clear History" or "Reset Settings" in the Clip LeetCode settings panel.

## 10. Security & Privacy Considerations
- **DOM Injection:** Uses strict DOM element creation (`document.createElement`) and attribute assignment. Untrusted HTML from the problem DOM is converted to Markdown using tokenized string escaping.
- **Clipboard Safety:** The script only writes to the clipboard on explicit user action; it never inspects or reads existing clipboard data.

## 11. Browser & Manager Compatibility
- **Chrome / Edge / Brave:** Verified on Tampermonkey v5.1+ and Violentmonkey v2.18+.
- **Firefox:** Verified on Tampermonkey and Violentmonkey.
- **Safari:** Compatible via Tampermonkey.

## 12. Known Limitations & Breakage Points
- If LeetCode deploys a major frontend rewrite changing core problem title class names or DOM hierarchies, the script may take an extra second to fall back to generic heading selectors.

## 13. Troubleshooting
- *Buttons not appearing:* Refresh the page or check that Tampermonkey is enabled on `leetcode.com`.
- *Clipboard not updating:* Ensure browser permissions allow clipboard writes for the current domain.

## 14. Test Status
- Tested in Node.js test runner (`tests/clip-leetcode/clip-leetcode.test.mjs`).
- 4/4 passing unit tests covering route parsing, HTML-to-markdown conversion, template substitution, and settings schema.

## 15. License & Attribution
- Licensed under the [MIT License](LICENSE).
- Created and maintained by **Shivansh Jain**.
