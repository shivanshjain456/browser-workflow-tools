# ChatGPT Conversation Bridge

> Archive any ChatGPT conversation into a permanent ZIP and formatted DOCX, then seamlessly continue it in a new chat. Validates message chains, downloads assets, and renders tables/code/math into Word.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/chatgpt-conversation-bridge/chatgpt-conversation-bridge.user.js)

---

## 1. Problem It Solves
Long ChatGPT conversations eventually hit context truncation, degradation, and sluggish browser rendering. Furthermore, when users want to preserve their work, built-in browser printing creates broken formatting, unreadable code snippets, and lacks structured export of conversation images and metadata.

## 2. Why the Workflow Exists
Engineers and researchers need a reliable, client-side tool to convert entire ChatGPT conversation DAG trees into permanent, formatted Microsoft Word (`.docx`) documents, download all embedded images into a standalone `.zip` archive, and generate a succinct continuation prompt to pick up right where the conversation left off in a fresh context window.

## 3. Feature List
- **Full DAG Tree Traversal:** Accurately reconstructs multi-turn conversational branches from root to leaf.
- **Client-Side DOCX Engine:** Generates true OpenXML Word documents with styled headers, code fences, inline formatting, and tables without external web services.
- **Pure JavaScript ZIP/DEFLATE:** Employs an in-memory ZIP builder with raw DEFLATE compression and CRC32 verification.
- **Image Preservation:** Fetches and bundles high-resolution generated and uploaded images into the ZIP archive.
- **Chat Continuation Flow:** Prepares and stages a concise, structured recap prompt in a fresh chat session so you can continue working without losing context.
- **Share & Private Chat Support:** Works on both public shared links (`chatgpt.com/share/...`) and private authenticated chats (`chatgpt.com/c/...`).

## 4. Supported Routes & Exclusions
- **Supported:**
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`
- **Exclusions:**
  - Non-chat surfaces (account settings, login screens) are ignored.

## 5. Install & Update Instructions
- **Direct Install:** Click [chatgpt-conversation-bridge.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/chatgpt-conversation-bridge/chatgpt-conversation-bridge.user.js) with Tampermonkey or Violentmonkey installed.
- **Updates:** Tracked via raw GitHub main branch release.

## 6. Example Workflow
1. Open any long ChatGPT conversation.
2. Click the floating "Archive & Continue" button in the lower corner.
3. Review the export options (Include Images, Include Code Blocks, Generate Continuation).
4. Click "Export Archive".
5. The browser immediately downloads a `.zip` file containing:
   - `conversation.docx`: Fully styled Microsoft Word document.
   - `conversation.json`: Raw verified JSON payload.
   - `images/`: High-resolution attachments.
6. Click "Continue in New Chat" to automatically open a fresh chat with the continuation prompt ready.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue`: Stores user export format preferences.
- `GM_xmlhttpRequest`: Used as a fallback cross-origin bridge when downloading conversation assets across ChatGPT origin domains.
- `@connect chatgpt.com`: Confines network requests exclusively to ChatGPT's verified domain.

## 8. Outbound Network Hosts & Payload Categories
- `chatgpt.com` / `chat.openai.com`: Only requests conversation metadata and image assets necessary for building the document. Zero third-party endpoints contacted.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** User export configuration flags (e.g., whether to download images).
- **Blob Retention:** All generated DOCX and ZIP blobs are created in memory and released immediately upon browser download.

## 10. Security & Privacy Considerations
- **XML Escaping:** All user and assistant messages are rigorously XML-escaped (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) to prevent OOXML document corruption or parser injection.
- **Zero Third-Party Telemetry:** Conversations are processed strictly within your browser; nothing is transmitted to any analytics or external logging server.

## 11. Browser & Manager Compatibility
- **Chrome / Firefox / Edge:** Verified on Tampermonkey and Violentmonkey.

## 12. Known Limitations & Breakage Points
- Private chat exports require an active, logged-in session on `chatgpt.com`.

## 13. Troubleshooting
- *Export button not visible:* Wait for the chat messages to finish streaming; the button activates once the conversation tree settles.

## 14. Test Status
- Tested in Node.js test runner (`tests/chatgpt-conversation-bridge/chatgpt-conversation-bridge.test.mjs`).
- 5/5 passing unit tests covering URL validation, XML escaping, filename sanitization, DAG reconstruction, and CRC32 verification.

## 15. License & Attribution
- Licensed under the [MIT License](LICENSE).
- Created and maintained by **Shivansh Jain**.
