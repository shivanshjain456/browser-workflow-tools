# Save Image as Type

> Convert and save any web image locally in PNG, JPG, WebP, GIF, BMP, AVIF, or PDF, or re-save untouched original bytes, with batch extraction, ZIP archives, image transforms, and metadata stripping.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Install](https://img.shields.io/badge/Install-Userscript-green.svg)](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/save-image-as-type.user.js)

---

## 1. Problem It Solves
Modern web platforms serve images wrapped in opaque containers, complex `<picture>`/`srcset` hierarchies, CSS pseudo-elements (`::before`/`::after`), canvas renderings, and modern formats like WebP or AVIF that third-party desktop tools or image viewers cannot open. Additionally, browsers offer minimal native control when saving images, forcing users into tedious multi-step conversion workflows or insecure cloud converters.

## 2. Why the Workflow Exists
Existing browser extensions for image conversion require aggressive permissions (such as `<all_urls>` with background service workers), upload image bytes to cloud APIs for conversion, inject third-party trackers, or break on single-page applications. This userscript runs 100% locally in your browser memory using the HTML5 Canvas API and WebCodecs encoders, providing immediate, zero-telemetry conversion and privacy-first metadata cleaning.

## 3. Feature List
- **Universal Format Conversion:** Right-click any image to convert and save as PNG, JPG, WebP, GIF, BMP, PDF, or probe-gated AVIF.
- **Original Byte Preservation:** Re-save untouched image bytes byte-for-byte to keep animations, transparency layers, and original bitstreams.
- **Batch Image Downloader:** Extract and convert all images across any webpage with real-time preview, selection filtering, and failure recovery.
- **Single ZIP Packaging:** Bundle batch-downloaded images into a single zip archive with clean UTF-8 filenames, DEFLATE compression, and CRC32 verification.
- **Interactive Transform Suite:** Rotate (90° steps), flip horizontally/vertically, crop, resize with aspect-ratio locking, grayscale, or invert before saving.
- **Format Size Comparison:** Compare real encoded sizes across all supported output formats in a live inspector and automatically pick the smallest.
- **EXIF & Privacy Sanitization:** Inspect EXIF, XMP, ICC profiles, and GPS location markers; strip tracking metadata before saving.
- **Clipboard Workflows:** Copy converted image blobs or data URLs directly to the OS clipboard for pasting into Photoshop, Discord, or office tools.
- **Keyboard-Driven Shortcuts:** Quick-access shortcuts (`Alt+Shift+S` to save, number keys to pick format, `C` to copy, `A` for batch).
- **Settings & Profiles:** Custom filename templates (`{title}`, `{origin}`, `{date}`, `{w}x{h}`), quality sliders, and reusable preset profiles.

## 4. Supported Routes & Exclusions
- **Supported:**
  - `*://*/*` (All HTTP and HTTPS web pages, HTML documents, and iframe containers).
- **Exclusions:**
  - Privileged browser internal schemes (`chrome://`, `edge://`, `about:`, `moz-extension://`) and local file schemes (`file://`) are excluded by sandbox policies.

## 5. Install & Update Instructions
- **Direct Install:** Click [save-image-as-type.user.js](https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/save-image-as-type.user.js) with Tampermonkey or Violentmonkey installed.
- **Automatic Updates:** The script header includes `@updateURL` pointing directly to the canonical raw release in `browser-workflow-tools`.

## 6. Example Workflow
1. Browse to any web page containing images (e.g. photography portfolio, e-commerce catalog, social post).
2. Right-click on any image element (including background images or CSS pseudo-elements).
3. In the custom context menu, select **Save as WebP** or press key `3`.
4. The userscript processes the image locally, applies quality settings and filename templating, and initiates a clean local download.

## 7. Permissions & Why Each Is Required
- `GM_getValue` / `GM_setValue` / `GM_deleteValue`: Persists format preferences, quality levels, batch settings, and keyboard bindings.
- `GM_addValueChangeListener` / `GM_removeValueChangeListener`: Synchronizes user settings and active profiles across open browser tabs.
- `GM_registerMenuCommand`: Registers quick commands in the userscript manager popup menu (Settings, Diagnostics, Reset).
- `GM_notification`: Displays non-intrusive notifications when conversions finish or when downloads require user attention.
- `GM_download`: Triggers browser downloads with custom filenames, bypassing browser navigation hooks.
- `GM_info`: Detects userscript manager capabilities and execution environment.
- `GM_xmlhttpRequest`: Used as an optional, fallback-only mechanism to fetch cross-origin image bytes when canvas cross-origin taint prevents local pixel reads.

## 8. Outbound Network Hosts & Payload Categories
- **Zero Remote Scope:** Operates with zero tracking servers, zero analytics endpoints, and zero unauthenticated telemetry.
- **Strict Network Isolation:** All image transformations, encoding, compression, and metadata sanitization occur entirely within local browser memory.

## 9. Stored Data, Retention & Deletion
- **Stored Data:** User configuration JSON object containing export format preferences, quality levels, batch presets, and keyboard bindings.
- **Retention:** Stored locally in the browser's userscript storage until modified or cleared.
- **Deletion:** Click "Reset to defaults" in the settings panel or delete the script storage via your userscript manager.

## 10. Security & Privacy Considerations
- **Sandboxed DOM Injection:** All UI dialogs (context menu, transform modal, batch picker, settings) use strict Shadow DOM encapsulation to prevent stylesheet leakage and host page DOM interference.
- **Defensive Image Decoding:** Employs defensive timeouts and size probes to prevent canvas allocation crashes or memory exhaustion on malicious image bombs.
- **Zero Analytics:** Contains no network beacons, telemetry calls, external CDN dependencies, or dynamic code execution (`eval` / `new Function` sinks).
