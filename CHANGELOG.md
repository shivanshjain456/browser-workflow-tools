# Changelog

All notable changes to the browser workflow tools collection are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - 2026-10-12

### Collection Architecture & Quality Gate
- **Restructured Repository Layout:** Organized into individual script directories (`scripts/<name>/`) with dedicated documentation, installable userscript artifacts, and explicit licenses.
- **Audited Manifests & Security Grants:**
  - Removed wildcard `@connect *` from `web-archives`; replaced with explicit static allowlist of 13 archive mirror domains.
  - Added unique, canonical `@namespace` URLs across all six userscripts under `https://github.com/shivanshjain456/browser-workflow-tools/`.
  - Added canonical raw release `@downloadURL` and `@updateURL` directives.
  - Added SPDX license identifiers (`MIT` for scripts 1–5, `AGPL-3.0-or-later` for script 6).
- **Automated Verification Pipeline:**
  - Added `tools/check-userscript-metadata.mjs` for rigorous metadata parsing and semver validation.
  - Added `tools/check-permissions.mjs` for continuous verification of zero wildcard network grants and automated permissions table generation.
  - Added `tools/check-secrets.mjs` for scanning high-entropy tokens and credentials across all repository files.
  - Added full unit test suite (`29 tests`) using Node's native test runner (`node --test`).
  - Added GitHub Actions workflow (`.github/workflows/ci.yml`) validating syntax, metadata, permissions, secrets, and tests across Node 20 and 22.

## [save-image-as-type v2.0.1] - 2026-10-17
### Added
- Integrated full `save-image-as-type` project suite into `scripts/save-image-as-type/`.
- Standardized userscript metadata headers with canonical `@namespace`, `@homepageURL`, `@supportURL`, `@downloadURL`, and `@updateURL` directives matching the repository standards.
- Added SPDX-License-Identifier header (`MIT`).
- Enforced zero-wildcard network grant policy with local-first image processing and memory-safe Canvas encoders.
- Added comprehensive unit test suite in `tests/save-image-as-type/save-image-as-type.test.mjs`.

---

## [clip-leetcode v3.0.0] - 2026-10-12
### Added
- Canonical `@namespace`, `@homepageURL`, and `@supportURL`.
- Multi-format exporter: Markdown, Plain Text, HTML, JSON, and custom template substitution.
- SPA URL listener supporting modern Next.js/React LeetCode route transitions without page reload.
- Full local history buffer and settings modal.

### Security & Privacy
- Strict DOM attribute assignment and zero dynamic `innerHTML` sinks.
- Operates 100% locally with zero external network access.

---

## [codebase-uploader v2.0.2] - 2026-10-12
### Added
- Support for 20+ major AI chat interfaces (ChatGPT, Claude, Gemini, Grok, DeepSeek, Mistral, Perplexity, OpenRouter, etc.).
- Defensive path normalization preventing directory traversal outside the selected root.
- Gitignore-aware parser supporting negations, directory-only patterns, and wildcards.
- Virtualized file tree allowing smooth browsing of repositories with thousands of files.
- Secret file detection highlighting `.env`, `id_rsa`, `*.pem`, and `secrets.json` before packing.

### Security & Privacy
- Qualified privacy disclosures confirming selected files are processed locally in memory before user-initiated insertion into the chat composer.

---

## [chatgpt-conversation-bridge v1.0.0] - 2026-10-12
### Added
- Complete conversation DAG tree reconstruction from ChatGPT public shares and private conversations.
- Client-side OpenXML DOCX document generation with styled headings, code fences, and tables.
- Pure JavaScript ZIP file generation with custom raw DEFLATE compression and CRC32 verification.
- Continuation prompt generator enabling seamless continuation of archived context in a new conversation.

### Security & Privacy
- Strict XML character escaping for all message content to prevent OOXML document corruption or injection.
- Endpoint validation restricting API fetching strictly to verified ChatGPT origin domains.

---

## [web-archives v8.0.0] - 2026-10-12
### Changed
- **Breaking Security Hardening:** Completely eliminated wildcard `@connect *` from manifest. Replaced with explicit static allowlist for verified archive domains.
- Standardized Memento TimeMap parsing with RFC 1123 date comma handling.
- Enhanced URL sanitizer rejecting private IP ranges, localhost, and non-HTTP protocols (`javascript:`, `data:`, `file:`).

### Added
- Keyboard launcher command palette (`Ctrl+Shift+A` / `Cmd+Shift+A`) for rapid archive searches.
- Date-based snapshot picker leveraging the Wayback Machine CDX server API.

---

## [youtube-search-command v2.1.0] - 2026-10-12
### Added
- Multi-signal ranking engine combining view velocity, freshness, verified channel authority, and video duration.
- Per-channel rule policies keyed by canonical channel ID (pin, boost, demote, hide).
- Fuzzy near-duplicate clustering and title typography analysis.
- Keyboard-accessible control plane overlay.

### Compatibility
- Dual grant declarations for Greasemonkey 4 (`GM.`) and Tampermonkey/Violentmonkey (`GM_`) with runtime capability probing.

---

## [yt-share-antitrack v2.0.0] - 2026-10-12
### Added
- Real-time clipboard interception on YouTube share buttons across desktop, mobile web (`m.youtube.com`), and YouTube Music (`music.youtube.com`).
- Parameter stripping for `si`, `feature`, `utm_*`, `fbclid`, and related telemetry query keys.
- Guaranteed preservation of functional parameters (`v`, `t`, `list`, `index`).
- Cleaned link counter with local persistence.
