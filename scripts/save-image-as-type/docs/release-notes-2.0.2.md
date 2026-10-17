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
| `SHA256SUMS` | `7a16709778dd28a4aa50190ee01b225bf4e377fa2c0353c9f2b86c2e35e98585` | Checksum file for artifact |
| `PACKAGE_SHA256SUMS` | `b3d368e73ee0a90575d506bc1dff63f8546b41fe3db1fef67e9f4544755106d7` | Checksum file for source package |

## Verification Command
```bash
sha256sum -c SHA256SUMS
sha256sum -c PACKAGE_SHA256SUMS
```
