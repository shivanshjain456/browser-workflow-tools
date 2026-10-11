# YouTube Search Command

> Power-user control plane for YouTube search & channel results. Features multi-signal weighted ranking, channel policies, fuzzy series/duplicate clustering, and keyboard navigation.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/youtube-search-command/youtube-search-command.user.js)

---

## 1. Problem It Solves
Default YouTube search results are heavily diluted with algorithmic recommendations, unrelated "People also watched" carousels, clickbait shorts, near-duplicate re-uploads, and repetitive low-quality channels, making serious technical research and educational discovery frustrating.

## 2. Why the Workflow Exists
Power users, software engineers, and researchers need deterministic control over YouTube search: the ability to promote trusted educational creators, hide low-effort content farms permanently, cluster repetitive series, filter by precise duration or view velocity, and navigate results entirely via keyboard.

## 3. Feature List
- **Deterministic Multi-Signal Ranking:** Re-scores and re-orders search result cards using customizable weights for views, freshness, verified channel badges, and duration.
- **Per-Channel Policy Rules:** Pin, Boost, Demote, or Hide specific channels keyed by their immutable canonical channel ID.
- **Context Profiles:** Switch between custom search contexts (e.g. "Deep Work / Technical", "Casual", "Music") with distinct filtering rules.
- **Fuzzy Clustering:** Detects and groups repetitive near-duplicate videos and episodic series under a single collapsible parent card.
- **Control Plane Overlay:** Press `Shift+?` or click the toolbar indicator to open the keyboard-navigable configuration panel.
- **Zero Third-Party Telemetry:** Operates 100% on the client-side DOM with zero network requests.

## 4. Supported Routes & Exclusions
- **Supported:**
  - `https://www.youtube.com/*` (Allocates active observers specifically on `/results` search pages).
- **Exclusions:**
  - Explicitly excluded from embeds (`/embed/*`), live chats (`/live_chat*`), and smart TV views (`/tv*`).
  - Mobile web (`m.youtube.com`) is excluded due to differing DOM architectures.

## 5. Install & Update Instructions
- **Direct Install:** Click [youtube-search-command.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/youtube-search-command/youtube-search-command.user.js) with Tampermonkey or Violentmonkey installed.
- **Updates:** Automatically tracked via raw GitHub release.

## 6. Example Workflow
1. Search for a technical topic on YouTube (e.g., "PostgreSQL indexing internals").
2. YouTube Search Command re-orders the video cards: verified deep-dive tutorials rise to the top; spam content is demoted or hidden.
3. Hover over any channel tag to instantly click "Boost" or "Hide".
4. Open the Control Plane (`Shift+?`) to fine-tune your duration filters and channel policies.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue` / `GM_deleteValue`: Persists channel rules and ranking profiles.
- `GM_addValueChangeListener`: Synchronizes rule modifications across active tabs.
- `GM_registerMenuCommand`: Provides quick menu access to the Control Plane.
- `window.onurlchange`: Reacts immediately to YouTube SPA client-side search transitions.

## 8. Outbound Network Hosts & Payload Categories
- **None:** The script operates completely offline. No external HTTP requests are made.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** User channel rules, blocked channel IDs, and ranking weight profiles.
- **Storage Location:** Browser userscript storage (`GM_setValue`).
- **Deletion:** Click "Clear All Rules" in the Control Plane settings modal.

## 10. Security & Privacy Considerations
- **No Third-Party Communication:** All processing is performed strictly inside the page DOM.
- **DOM Safety:** UI badges and overlays are created using standard DOM elements with textContent; zero innerHTML sinks.

## 11. Browser & Manager Compatibility
- **Chrome / Firefox / Edge:** Verified on Tampermonkey and Violentmonkey.
- **Greasemonkey 4:** Supported via async `GM.` API fallbacks.

## 12. Known Limitations & Breakage Points
- If YouTube alters internal Polymer custom element tag names, the script falls back to generic structural video renderer classes.

## 13. Troubleshooting
- *Reranking not activating:* Make sure you are on a desktop `/results` search page and that the script is enabled in Tampermonkey.

## 14. Test Status
- Tested in Node.js test runner (`tests/youtube-search-command/youtube-search-command.test.mjs`).
- 4/4 passing unit tests covering view count abbreviation parsing, duration calculations, multi-signal scoring, and policy rule precedence.

## 15. License & Attribution
- Licensed under the [MIT License](LICENSE).
- Created and maintained by **Shivansh Jain**.
