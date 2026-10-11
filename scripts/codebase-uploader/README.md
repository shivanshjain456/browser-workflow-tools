# Codebase Uploader

> Package any directory or codebase into structured Markdown chunks and raw attachments for AI chats. Features .gitignore-aware filtering, virtualized file tree, token budgeting, and shadow DOM UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/codebase-uploader/codebase-uploader.user.js)

---

## 1. Problem It Solves
Modern LLMs (Claude, ChatGPT, Gemini, Grok, DeepSeek) have large context windows, but developers struggle to provide repository-wide context effectively. Manually dragging dozens of files into web chats often results in hitches, unformatted text blobs, accidental inclusion of binary files or `.env` secrets, and exceeding LLM context token limits.

## 2. Why the Workflow Exists
Developers need a clean, structured way to select a local project directory in the browser, filter it automatically using `.gitignore` rules, review files in a lightweight virtual tree, monitor token budgets, and inject formatted Markdown chunks straight into the AI chat prompt input without uploading their code to any third-party intermediary.

## 3. Feature List
- **Universal Provider Support:** Works out-of-the-box across 20+ AI chat interfaces (ChatGPT, Claude.ai, Google Gemini, Google AI Studio, DeepSeek, Grok, Mistral, Perplexity, OpenRouter, LMSYS Arena, etc.).
- **Gitignore Engine:** Evaluates `.gitignore` syntax including folder patterns, negations (`!pattern`), and wildcards.
- **Virtualized Tree View:** Seamlessly navigates repositories with thousands of files without UI freezing.
- **Token Budgeting:** Real-time token estimations and warning indicators when selections exceed context limits.
- **Secret File Detection:** Flags sensitive files (`.env`, `id_rsa`, `*.pem`, `secrets.json`) with prominent warnings before packing.
- **Shadow DOM Isolation:** Renders inside an encapsulated Shadow DOM to prevent host page CSS conflicts.
- **Direct Insertion & Clipboard:** Injects directly into the host prompt input or copies formatted Markdown chunks to your clipboard.

## 4. Supported Routes & Exclusions
- **Supported:**
  - `*://chatgpt.com/*`, `*://claude.ai/*`, `*://gemini.google.com/*`, `*://aistudio.google.com/*`
  - `*://*.deepseek.com/*`, `*://*.perplexity.ai/*`, `*://*.meta.ai/*`, `*://*.grok.com/*`
  - `*://arena.lmsys.org/*`, `*://*.lmarena.ai/*`, `*://chat.mistral.ai/*`, `*://copilot.microsoft.com/*`
  - `*://openrouter.ai/*`, `*://huggingface.co/chat/*`, `*://*.qwen.ai/*`, `*://*.kimi.com/*`
- **Exclusions:**
  - Script allocates observers only when active on supported chat routes.

## 5. Install & Update Instructions
- **Direct Install:** Click [codebase-uploader.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/codebase-uploader/codebase-uploader.user.js) with Tampermonkey or Violentmonkey installed.
- **Updates:** Automatically tracked via raw GitHub release URL.

## 6. Example Workflow
1. Open Claude.ai or ChatGPT.
2. Click the floating "Upload Codebase" button or use the keyboard trigger.
3. Select your local project directory.
4. Review the file tree: `.gitignore` and binary files are filtered automatically; token counts update live.
5. Click "Insert into Chat" or "Copy Markdown". The structured repository manifest and code blocks are placed into the composer.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue` / `GM_deleteValue` / `GM_listValues`: Stores user preferences (token budgets, custom ignore rules, themes).
- `GM_addValueChangeListener` / `GM_removeValueChangeListener`: Synchronizes configuration across multiple AI chat tabs.
- `GM_setClipboard`: Copies selected codebase markdown chunks to the OS clipboard.
- `GM_registerMenuCommand` / `GM_unregisterMenuCommand`: Adds launcher command to userscript manager menu.
- `GM_info`: Queries script version and manager metadata for diagnostics.

## 8. Outbound Network Hosts & Payload Categories
- **None:** The script makes 0 external network requests. Selected file contents are processed entirely in browser memory.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** User configuration (token thresholds, custom ignore patterns).
- **File Retention:** Selected files are held in memory only during the active modal session and are discarded on page close or refresh.
- **Deletion:** Click "Reset Defaults" in the settings pane to clear all persisted values.

## 10. Security & Privacy Considerations
- **Path Traversal Defense:** All paths are normalized; path traversal sequences (`..`) are stripped to prevent directory escape.
- **No Third-Party Transmission:** Files are never sent to any intermediary server. They are only inserted into the user's active AI chat composer when explicitly requested.

## 11. Browser & Manager Compatibility
- **Chrome / Edge / Brave / Firefox:** Fully compatible with Tampermonkey v5.1+ and Violentmonkey v2.18+.

## 12. Known Limitations & Breakage Points
- Large repositories with >50,000 files may take a few seconds to parse through the browser's directory reader.
- AI provider DOM updates to the chat input element can occasionally require a selector refresh.

## 13. Troubleshooting
- *Directory picker does not open:* Ensure your browser supports the File System Access API or standard directory input.

## 14. Test Status
- Tested in Node.js test runner (`tests/codebase-uploader/codebase-uploader.test.mjs`).
- 5/5 passing unit tests covering binary extension detection, secret file warnings, path traversal stripping, token estimation, and gitignore rule matching.

## 15. License & Attribution
- Licensed under the [MIT License](LICENSE).
- Created and maintained by **Shivansh Jain**.
