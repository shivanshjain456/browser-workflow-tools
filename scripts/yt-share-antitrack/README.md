# YTShareAntiTrack

> Removes tracking parameters (si, feature, utm_*, fbclid, etc.) from YouTube share links across desktop, mobile web, and YouTube Music. Local execution with zero telemetry.

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/yt-share-antitrack/yt-share-antitrack.user.js)

---

## 1. Problem It Solves
When you click "Share" on YouTube, the generated links contain opaque tracking parameters (such as `?si=...` which encodes user session identifiers, recommendation graph fingerprints, and cross-user referral tracking, alongside generic UTM tags and `feature=shared`). Sharing these links inadvertently leaks your identity and browsing session to recipients and tracking networks.

## 2. Why the Workflow Exists
Privacy-conscious users need an invisible, reliable background tool that intercepts share button actions and automatically cleanses links before they ever touch the system clipboard, without breaking playback timestamps (`?t=...`), playlist IDs (`&list=...`), or video identifiers (`?v=...`).

## 3. Feature List
- **Comprehensive Platform Coverage:** Works on desktop YouTube (`youtube.com`), mobile web (`m.youtube.com`), and YouTube Music (`music.youtube.com`).
- **Real-Time Clipboard Interception:** Sanitizes links copied via the native "Copy" button in YouTube's share dialog or standard clipboard copy events.
- **Deep Tracking Removal:** Strips `si`, `feature`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `fbclid`, `gclid`, and `igshid`.
- **Preserves Media Parameters:** Strictly preserves essential playback query arguments including `v` (video ID), `t` (timestamp), `list` (playlist), `index`, `start`, `end`, and `clip`.
- **Shortlink Normalization:** Cleans `youtu.be` shortlinks and full canonical watch URLs alike.
- **Zero Telemetry & Local Execution:** Operates 100% offline with zero external network access.

## 4. Supported Routes & Exclusions
- **Supported:**
  - `https://www.youtube.com/*`
  - `https://m.youtube.com/*`
  - `https://music.youtube.com/*`
- **Exclusions:**
  - Non-share URLs and navigation routes are unaffected.

## 5. Install & Update Instructions
- **Direct Install:** Click [yt-share-antitrack.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/yt-share-antitrack/yt-share-antitrack.user.js) with Tampermonkey, Violentmonkey, or Greasemonkey installed.
- **Updates:** Tracked via raw GitHub main branch release.

## 6. Example Workflow
1. Watch any video on YouTube or listen to a track on YouTube Music.
2. Click the native "Share" button and click "Copy Link".
3. Paste the URL anywhere:
   - *Original link:* `https://youtu.be/dQw4w9WgXcQ?si=aBcDeF123456&feature=shared&t=30s`
   - *Sanitized link:* `https://youtu.be/dQw4w9WgXcQ?t=30s`
4. The tracking fingerprint is gone; the media timestamp remains perfectly intact.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue` / `GM.getValue` / `GM.setValue`: Stores cleaned link counters and user configuration.
- `GM_setClipboard` / `GM.setClipboard`: Writes the sanitized URL to the system clipboard upon share action.
- `GM_registerMenuCommand` / `GM.registerMenuCommand`: Adds options menu to the extension popup.

## 8. Outbound Network Hosts & Payload Categories
- **None:** The script never opens any network connections. Zero bytes leave your browser.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** Sanitized link count and custom parameter rules.
- **Storage Location:** Browser userscript storage (`GM_setValue`).
- **Deletion:** Reset via the extension menu.

## 10. Security & Privacy Considerations
- **Transparent Privacy:** Does not monitor or record your clipboard history. It only intercepts clipboard writes originating from YouTube share actions.
- **No Third-Party Access:** All string manipulation is local and synchronous.

## 11. Browser & Manager Compatibility
- **Chrome / Edge / Firefox:** Verified on Tampermonkey, Violentmonkey, and Greasemonkey.

## 12. Known Limitations & Breakage Points
- YouTube occasionally updates dialog button markup; the script employs multiple fallback event interceptors (`copy` listener, click delegator, input observer) to ensure continuous operation.

## 13. Troubleshooting
- *Share links still have si:* Check that Tampermonkey has permission to access the clipboard for YouTube.

## 14. Test Status
- Tested in Node.js test runner (`tests/yt-share-antitrack/yt-share-antitrack.test.mjs`).
- 4/4 passing unit tests covering parameter stripping, timestamp preservation, youtu.be shortlink cleaning, and mobile/music domain handling.

## 15. License & Attribution
- Licensed under the [GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)](LICENSE).
- Created and maintained by **Shivansh Jain**.
