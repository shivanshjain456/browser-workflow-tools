# Frozen Decisions for Save Image as Type 2.0.2 Release

| Decision | Value | Why |
|---|---|---|
| `@connect` | `*` (restored) | Documented product model; removing it is a separate, tested product change |
| `@namespace` | `https://siat.invalid/save-image-as-type` (restored) | Namespace is an opaque identity; changing it creates a second installed copy |
| `@icon` | inline SVG data URI (restored); no `@icon64` | Keeps "no network except your image" literally true |
| update channel | kept (`@updateURL` + `@downloadURL`), pointing at the single canonical artifact | Owner intent; must be documented, not hidden |
| canonical artifact | `release/save-image-as-type.user.js` | Every existing gate, checksum and doc already points there |
| version | `2.0.2` | Metadata/permission-model change with live auto-update |
| copyright | `Shivansh Jain` | Matches `@author`, `LICENSES/MIT.txt`, and repository ownership |
| `audit/` publication | keep as-is | Already public; contains no secrets |
