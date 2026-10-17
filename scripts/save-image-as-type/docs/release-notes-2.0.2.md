# Save Image as Type 2.0.2

Save Image as Type 2.0.2 is an integrity and consistency remediation release that establishes a single canonical release artifact, restores truthful metadata permissions, provides verifiable provenance, and synchronizes all documentation with real runtime behavior.

The runtime logic is byte-identical to the baseline release (commit `88fff69b`); all changes strictly affect metadata definitions, documentation truth, build verification, and repository CI gates.

## Highlights

- **Restored `@connect *`**: Aligns userscript header with the documented architecture requiring cross-origin image retrieval across arbitrary content delivery networks.
- **Inline SVG Icon**: Replaced external remote icon link with an inline SVG data URI, ensuring installation makes zero network requests.
- **Single Canonical Artifact**: Standardized distribution on `release/save-image-as-type.user.js` and removed duplicate unverified root userscript.
- **Stable Identity Namespace**: Restored RFC 2606 reserved namespace `https://siat.invalid/save-image-as-type` to protect script storage and avoid duplicate installations.
- **Derived-Only Manifest**: Refactored `release-manifest.json` to retain only deterministic facts produced by `build.mjs`.
- **Complete Verification Evidence**: All 27 lint checks, 577 unit tests, 18 security assertions, 57 browser scenarios, and clean clone executions are recorded under `audit/evidence/remediation-2.0.2/`.

## Distribution Files & Verification Hashes

| File | SHA-256 Checksum | Description |
|---|---|---|
| `save-image-as-type.user.js` | `182f7854e0f225a07a5979d0f3f2783bbcec796851283aef612af205c4c0c8ab` | Canonical userscript artifact |
| `save-image-as-type-2.0.2-source.zip` | `ce6a633c54dbf1e1cc50955de3ab7a863d84ba4e9ba101596aac678c45ddd100` | Complete verifiable source capsule |
| `SHA256SUMS` | `ca6221b659e7fbb82028347d33bfdfa344e34846edfba2968ef5ff57c53ad22f` | Checksum file for artifact |
| `PACKAGE_SHA256SUMS` | `8e4150576552563a7bf5b3367b82584d20a5d59179a3b7db5fc68c520d3915f6` | Checksum file for source package |

## Verification Command
```bash
sha256sum -c SHA256SUMS
sha256sum -c PACKAGE_SHA256SUMS
```

> **Integrity Erratum & Asset Repair Note (2026-10-17)**: The `save-image-as-type.user.js`, `SHA256SUMS`, and `PACKAGE_SHA256SUMS` attachments were re-uploaded to replace CRLF line-ending artifacts with the exact canonical LF bytes from Git tag `v2.0.2` (blob `f4b4e1b0`). The checksum table has been updated to reflect the true published LF hashes. Tag `v2.0.2` and commit `f7376f28` were not modified.
