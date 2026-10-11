# Third-Party Services Inventory

This document enumerates every external service, archive provider, and platform contacted, queried, or opened by the tools in this collection.

---

## Service Catalog

| Service | Used By | Purpose | Data Transmitted | Authentication | Optional? | Privacy & Terms |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Internet Archive (Wayback Machine)** (`archive.org`, `web.archive.org`) | `web-archives` | Probing historical snapshot availability via the Wayback JSON API and CDX server; navigating to archived web pages. | Target web URL queried in the request path/query string. | None (Public API) | Yes (User triggers search or probe) | [Archive.org Terms & Privacy](https://archive.org/about/terms.php) |
| **Archive.today / Archive.is** (`archive.is`, `archive.today`, `archive.ph`, `archive.li`, `archive.vn`, `archive.fo`, `archive.md`) | `web-archives` | Memento TimeMap resolution to check for captured web page snapshots. | Target web URL queried. | None (Public Memento endpoint) | Yes (User selects Archive.today engine) | [Archive.today Terms](https://archive.today/) |
| **Perma.cc** (`api.perma.cc`) | `web-archives` | Querying legal and academic preservation archives via the Perma.cc public API. | Target web URL queried. | None (Public read API) | Yes (User selects Perma.cc engine) | [Perma.cc Terms & Privacy](https://perma.cc/terms-of-service) |
| **Software Heritage** (`archive.softwareheritage.org`) | `web-archives` | Checking for software repository archival records. | Target repository URL queried. | None (Public Web API) | Yes (User selects Software Heritage engine) | [Software Heritage Terms](https://www.softwareheritage.org/legal/) |
| **Ghostarchive** (`ghostarchive.org`) | `web-archives` | Direct browser navigation to archived news, social media, and video snapshots. | Target web URL passed in navigation URL. | None | Yes (User clicks Ghostarchive button) | [Ghostarchive Policy](https://ghostarchive.org/) |
| **Megalodon** (`megalodon.jp`) | `web-archives` | Direct browser navigation to Japanese and global web snapshots. | Target web URL passed in navigation URL. | None | Yes (User clicks Megalodon button) | [Megalodon Terms](https://megalodon.jp/) |
| **WebCite** (`webcite.org`) | `web-archives` | Historical reference lookup for archived academic citations. | Target web URL passed in navigation URL. | None | Yes (User clicks WebCite button) | [WebCite Terms](https://www.webcite.com/) |
| **OpenAI / ChatGPT** (`chatgpt.com`, `chat.openai.com`) | `chatgpt-conversation-bridge` | Fetching conversation JSON hierarchies, message attachments, and staging continuation prompts. | Conversation IDs, same-origin API requests for message text and images. | Yes (User's active ChatGPT session cookies) | No (Script runs exclusively on ChatGPT) | [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/) |
| **AI Chat Providers** (Claude, Gemini, Grok, DeepSeek, Mistral, Perplexity, etc.) | `codebase-uploader` | Target web surfaces for inserting packaged codebase Markdown chunks into composer textareas. | User-selected file contents (code and text chunks) inserted into the web composer. | User's active session on each respective platform | Yes (Runs on supported AI chat domains upon user action) | Subject to respective provider's terms and privacy policies |
| **LeetCode & LeetCode CN** (`leetcode.com`, `leetcode.cn`) | `clip-leetcode` | Host platform from which problem titles, descriptions, and test case structures are extracted. | Reads page DOM locally; no external transmission. | Local in-session DOM | No (Runs on LeetCode problem pages) | [LeetCode Terms](https://leetcode.com/terms/) |
| **YouTube** (`youtube.com`, `m.youtube.com`, `music.youtube.com`) | `youtube-search-command`, `yt-share-antitrack` | Target platform for search result re-ranking and share link tracking parameter sanitization. | Reads search DOM; intercepts share URLs. Zero external transmission. | In-session page DOM | No (Runs on YouTube domains) | [YouTube Terms](https://www.youtube.com/t/terms) |

---

## Network Isolation Guarantees

1. **No Third-Party Intermediaries:** When `web-archives` probes an archive service, it communicates directly with the designated archive provider via `GM_xmlhttpRequest`. No intermediate proxy, relay server, or logging backend is employed.
2. **No Secret or Token Transmission:** No cookies, bearer tokens, or user credentials are transmitted to any archive endpoint.
3. **No Wildcard Network Grants:** Wildcard network access (`@connect *`) is strictly prohibited across the entire codebase. Every remote endpoint is constrained by an explicit host manifest.
