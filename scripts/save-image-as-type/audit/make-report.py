import sys
if '--recreate-obsolete-checkpoint' not in sys.argv:
    raise SystemExit('OBSOLETE historical generator. Refusing to overwrite the current engineering record; see audit/README.md.')
import json,hashlib,platform,re,statistics,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
a=root/'audit'
rows=json.loads((a/'triage-data.json').read_text())
b=(a/'baseline/v2.0.0.user.js').read_bytes()
p=json.loads((a/'evidence/baseline-production.json').read_text())
text='''# Save Image as Type — remediation engineering record

**Status: work in progress; NOT a completed superset release or a claim that the brief’s Definition of Done is met.**

This is the single ordered master document. Evidence paths are relative to the source-package root. A deferred release number is a planning boundary, not a delivery promise. Claims about real managers, public sites, Windows filesystems, colour fidelity, or assistive technology are unverified unless explicitly marked otherwise. Nothing in this record substitutes fixture emulation for actual manager testing.

## 1. Phase 0 — verified baseline

Attachment `save-image-as-type (2).user.js` is byte-identical to the repository’s v2.0.0 artifact. Measured with Python hashlib, md5sum, wc, Node tests and Chrome CDP:

'''
text+=f'- Bytes **{len(b):,}**; newline count **{b.count(bytes([10])):,}**; MD5 **{hashlib.md5(b).hexdigest()}**; SHA-256 **{hashlib.sha256(b).hexdigest()}**. Fingerprint prerequisite passed.\n'
text+='''- Node 20.20.2; Python 3.13.16; Puppeteer 23.11.1; Chrome 131.0.6778.204, headless Linux. Pillow/pypdf versions are captured in the final evidence inventory.
- `npm ci`, then `npm test`: first run produced only 488 tests because missing pypdf silently omitted independent suites; after installing pypdf the full **513/90 suites passed**, zero failures/cancellations/skips. This is a newly reproduced infrastructure defect, not a lower baseline accepted as equivalent.
- `node lint.mjs`: **23/23**. `node build.mjs --check`: artifact in sync.
- `npm run test:browser`: **57/57** fixture scenarios; no skips. Reports: `audit/evidence/baseline-{unit-full,lint,build,browser}.txt`, `baseline-browser.json`.
- Dedicated production probe: `node audit/probe-production.mjs audit/baseline/v2.0.0.user.js audit/evidence/baseline-production.json`. Clean HTTP origin registers 8 commands, exposes privileged API on four roots; page code successfully writes through API. Preseed, global flag and DOM attribute each yield zero commands. These are executed attacks in a shared CDP world with a fake manager, NOT live TM/VM exploits.
- Ten same-origin child frames yield 11 boots / 88 registered commands. This establishes multiplication, not a duplicate-download exploit.
- A real local HTTP response with `Content-Security-Policy: default-src 'none'; img-src 'self'; ...` blocks the test data image and emits `img-src` / `data`. This is an actual browser-enforced strict-CSP origin, not a public bank/social-site compatibility result.
- Existing tests independently parse BMP, GIF, PDF and ZIP and validate metadata strips. Boot/no-page-storage and no-extra-origin assertions in the browser suite are fixture-scoped. Initial storage wrappers in the production probe do not intercept every possible Storage prototype call; they are supplementary, not proof of universal absence.

### Performance baseline (same sandbox, three repeated runs)

'''
for size in [512,1024]:
 v=[x['encodeMs'] for x in p['performance'] if x['size']==size]
 text+=f'- GIF {size}×{size}: mean {statistics.mean(v):.2f} ms, range {min(v):.2f}–{max(v):.2f} ms, population SD {statistics.pstdev(v):.2f} ms. Synchronous encode plus delayed zero-timer evidence in `baseline-production.json`. These are small synthetic images, not 60 MP mobile tests.\n'
text+='''
### Disagreements and qualifications

Batch confirmation is already implemented, including Alt+Shift+A → preview/Start; G-72’s no-confirmation account is wrong. `srcset` candidates are inventory entries selectable through the picker. The source repository has the cited build/lint/tests and a changelog, but they were not delivered as a public verification capsule. Source readers cannot infer that native decode ignores ICC: that part of G-07/G-11 is not established. G-01’s preseed object is returned before API construction; it suppresses boot, but the claim it receives newly defined privileged methods is disproved by control flow and the executed preseed result. `sandboxed` is not displayed by the panel at all. Eight manager commands are static workflow commands, NOT eight format commands, so format toggling does not leave stale format command entries.

## 2. Phase 1 — triage register (baseline, not resolution status)

Search scope: original attachment plus all `.js` under `src/`, not `node_modules`. Located by module exports/call graph and case-insensitive capability term searches; `audit/evidence/search-index.json` records query patterns and line hits. A zero-hit search only supports absence with the documented scope and call-graph reading; it is not a proof of absence by itself. Execution evidence uses the full baseline unit/browser logs unless a dedicated probe is named. “Confirmed” can establish a static missing path; it does NOT mean an impact magnitude was measured. Where a source claim and a live-compatibility claim differ, the latter remains unverified.

| ID | Classification | Location | Evidence / disproof | Planned boundary |
|---|---|---|---|---|
'''
for n,c,loc,e,release in rows:text+=f'| G-{n:02} | {c} | `{loc}` | {e} | {release} |\n'
text+='''
## 3. Own additions

| ID | Observed / evidence | Impact | Resolution bar | Severity / reach |
|---|---|---|---|---|
| G-76 | `sanitizePathComponent('CONvoy',{maxChars:3})` returns `CON` (executed Node). Device-name test precedes truncation. | Truncation resurrects a Windows-reserved name. | Check final component after all length operations; matrix fails if protection removed. | S2/R2 |
| G-77 | `buildFilename({base:'é',ext:'png',maxLength:4})` returns `.png` (executed Node). | Empty stem despite nonempty valid input. | Nonempty safe stem at the minimum byte budget, no invalid UTF-8. | S3/R3 |
| G-78 | `normalizeSettings(Object.create({filenamePrefix:'inherited'}))` accepts inherited prefix; v2 JSON own `__proto__` changes migrated prototype (executed Node). No mutation of global Object.prototype demonstrated. | External configuration can affect values without own schema fields. | Own-data-only neutralisation across store/import/remote/save/presets, bounded traversal. | S2/R3 |
| G-79 | First baseline test run passes 488 tests; after pypdf install it passes 513. Zero reported skips in both. | Missing independent decoders look like green verification. | Release verifier must fail preflight when required decoders are missing. | S1/R1 |
| G-80 | `bootstrap` is async; final synchronous try/catch never awaits it. | A rejected startup promise escapes failure containment. | Inject a rejecting startup task; owned error funnel receives it. | S2/R2 |

| G-81 | Golden PDF comparison differed only in CreationDate; original `encodePdf` reads current time without injection (executed byte diff). | Cross-run golden assertion is not deterministic despite the brief’s premise. | Pin an injected/frozen verification clock while preserving current-time default output. | S2/R2 |
| G-82 | Settings chooser calls `file.text()` before its existing 200000-character limit (source); fake oversized File read test constructed. | A huge file can allocate before refusal. | Refuse by size before reading and prove the read function is not called. | S2/R3 |
| G-83 | Page-authored `contextmenu` plus `.click()` reaches GM request with no public handle (executed exact candidate, synthetic-action.json). | DOM events become another unattended privileged-action route. | Owned UI entrypoints reject synthetic interaction; real pointer/keyboard paths must still save. | S1/R2 |

## 4. Phase 2 — threat model and invariants

### Trust boundaries

| Boundary | Data/direction and controller | Required treatment |
|---|---|---|
| page → script | DOM nodes, URL strings, image pixels, dimensions, titles, filenames; page-controlled | Treat as hostile; validate, cap, render as text; never accept privileged API roots or boot flags from page. |
| user → script | Genuine menu/keyboard/button actions, settings/import file | Preview high-volume writes; imported data remains untrusted; intent must not imply arbitrary program execution. Synthetic DOM input is not reliable proof of human identity. |
| script ↔ manager | Granted storage, requests, saves, notifications, callback payloads | Capability detection, bounded requests, explicit outcome certainty; no automatic repeat after uncertain write. Actual manager implementation is a trusted dependency with untested variants. |
| script ↔ network | Only user-selected image URL and acquisition fallbacks, remote host controls bytes/redirects | No startup traffic, executable resources, uploads or telemetry; cross-origin consent; validate image/container and size. Redirect destinations require trail in future. |
| script ↔ storage | Manager-private settings and remote change notifications | No page Storage/DB/cookie APIs; own-data-only schema validation; no persisted images or URLs added by this patch. |
| frame ↔ frame | Same-origin inventory only, browser denies cross-origin access | Bounded reads, no bypass or remote frame privilege bridge; avoid duplicate actions. Full frame boot still unresolved. |
| manager ↔ manager | Separate trusted worlds on shared untrusted DOM | No authenticated common registry exists in current architecture. Do not claim DOM markers arbitrate different managers. No privileged pointers on DOM to attempt this. |
| verifier ↔ production | Offline source imports / explicit locally constructed test build | Verifier can call internal functions; installed file has no test flag/export hook. Instrumented browser runs must carry a different hash and never be reported as exact production runs. |

### Invariants a contributor must preserve

1. Single readable distribution; no runtime imports, remote code, obfuscation or mangling. Build readability/freshness checked.
2. No network at boot, no telemetry, no uploads. Requests derive only from explicit image actions; no permissions bypass.
3. Manager storage only. No page-visible persisted settings/log/history. New persistent records require explicit disclosure/defaults/migration.
4. No DOM/window capability publication, page-writable boot gate, or untrusted object adoption. No claim of fingerprint invisibility: the UI itself is visible to the page.
5. No dynamic code or HTML parsing sinks; hostile labels use textContent. Test-only tools may evaluate local trusted code but never ship that evaluation path.
6. Bounded hostile input traversal. Ignore inherited fields, accessors, dangerous prototype keys; cap bytes/depth/nodes/list lengths before schema coercion.
7. Never claim native encoder losslessness/availability from MIME request alone; inspect actual result. Deterministic encoders retain golden bytes.
8. Unknown isolation is unknown, not true. Manager metadata is not an independently measured security boundary.
9. Cancellation releases resources; uncertain download never retried automatically. Source image is not modified by transforms.
10. Evidence labels distinguish source tests, instrumented fixture browser, exact production browser, actual manager and public-site testing.

## 5. Phase 3 — specification conformance matrix

**Study status: partial, NOT a complete specification audit.** Official documents were retrieved (titles/revisions below); the initial PDF tool exposes only the first 30 pages, which do not contain the necessary normative PDF sections. Listing a clause here is a study target unless its bytes are backed by the executed independent suite. No new binary format will ship from an unread specification. No whole copyrighted PKWARE/Adobe specifications are redistributed. URLs are documentation references, never runtime destinations.

| Format / API | Official revision / source | Implemented subset & test | Omissions / user consequence / study status |
|---|---|---|---|
| BMP | Microsoft BITMAPV5HEADER, BITMAPINFOHEADER / bitmap file layout; https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header | V5 BGRA masks, sRGB tag, V3 BGR/padding; existing independent Pillow + offset tests | No compression/ICC embed. Official V5 field definitions retrieved; broader Windows file-name semantics not executed on Windows. |
| GIF | CompuServe GIF89a, 31 July 1990; https://www.w3.org/Graphics/GIF/spec-gif89a.txt | Header/LSD/tables/image data/GCE/application/trailer; LZW Appendix F; independent Pillow tests | Global palette, 1-bit alpha, quantisation, full frames. Official document retrieved partially; full normative review remains. |
| ZIP | PKWARE APPNOTE 6.3.10 FINAL, 2022-11-01; https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT | §4.3 local/central/end records; §4.4 CRC/time; store method, UTF-8 flag; Python zipfile/zlib | No ZIP64, encryption, streaming, compression. Explicit caps. Full field-by-field spec review pending; golden bytes can still pin current correctness. |
| PDF | Adobe PDF Reference 1.7, sixth ed, Oct 2006; https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf | Current PDF1.4 subset: indirect objects, xref, trailer, page tree, image XObject/DCT. pypdf strict plus raw xref tests | §3.4/3.6/4.8/7 planned study; single-page JPEG, no alpha, ICC or PDF/A. Tool’s 30-page PDF ceiling blocks claim of normative review. Multipage/lossless design deferred. |
| PNG/APNG | W3C PNG Third Edition REC 2025-06-24; https://www.w3.org/TR/2025/REC-png-3-20250624/ | Native static encode; metadata chunk walk; animation acTL detect | Chunk CRC/ordering/timing study for acTL/fcTL/fdAT pending. No own PNG/APNG output yet. Browser bytes not cross-browser deterministic. |
| WebP | Google WebP Container Specification; https://developers.google.com/speed/webp/docs/riff_container | RIFF/VP8X/ANIM/ANMF/container metadata walk; native encode | No own codec, lossless switch or animated output. Container specification retrieved partially; codec bitstream spec not studied. |
| JPEG/JFIF, Exif/TIFF | ITU T.81 / JFIF; CIPA Exif and TIFF IFD specs needed | Native JPEG; APP segment/IFD read and strip tests, not complete codec | No write-back. Normative originals not yet read in this work: do not claim conformance matrix complete. |
| ICC | ICC.1 profile specification required | Recognise/remove container profile fields, not validate profile internals | No colour-preserving pipeline; profile copying after transforms would be unsafe without proof of pixel-space match. Study pending. |
| AVIF/HEIF/JXL | AOM AVIF / ISO BMFF / JPEG XL normative specs required | Native AVIF encode MIME probe; no own codec | All codec semantics delegated; no HEIC/JXL decode guarantee. Study pending before broader identification promises. |
| SVG, ICO, TIFF | SVG spec, Microsoft icon-container convention, TIFF6 required | SVG browser decode/serialisation; ICO/TIFF input MIME recognition only | No ICO/TIFF output. Icon-raster ZIP does not claim ICO conformance. Study pending. |
| Clipboard | W3C Clipboard API editor draft 2026-06-24; https://w3c.github.io/clipboard-apis/ | Explicit image write, supported MIME/permission/timeout tests | Intake proposed, not implemented; per-browser permission policy remains actual-manager/browser test requirement. |
| File/Blob | W3C File API WD 2026-09-12; https://www.w3.org/TR/FileAPI/ | Blob acquisition/object URLs; settings File input | Local-media intake proposed; no File System Access grant necessary for basic user file picker. Normative sections not fully read yet. |
| QR | ISO/IEC18004 | None | Declined: peripheral generator, no approximate encoder will be added. |

## 6. Phase 4 — design: alternatives and decisions

A security/verification candidate comes first. None of the large-format or new-intake work is slipped into a patch under an unverified assumption.

| Items | Approach A | Approach B | Decision / constraints / residual |
|---|---|---|---|
| G-01/03/30/40 | Hide a capability marker behind a symbol/DOM property; keep flag for tests | Private module WeakMap, separate production entry module, source ESM verification; offline instrumentation separate from release | B removes privileged pointer and page kill switches by construction. Private registry dedupes repeated bootstrap calls from same module only. Separate artifact executions/cross-manager arbitration remains unresolved and blocks full acceptance; DO NOT substitute an attacker-writable marker just to keep old test green. |
| G-02 | Infer sandbox boolean from manager name/injectInto | Report null/unknown until isolation independently observed | B: no manufactured guarantee; raw injectInto retained. C3 no new grant. |
| G-05/78 | JSON stringify/parse round trip, then merge | Bounded own-data descriptor walker to null-prototype records; deny magic keys/accessors; schema validates normalised copies | B avoids getters/inherited toJSON/deep-stack processing; scalar only from own data; limits configurable internally, no user setting. Hostile Proxies cannot be made safe within JS, not an accepted manager-JSON input. |
| G-12/76/77 | Patch only anchored regex | Device stem rules before first dot, recheck AFTER all truncation; nonempty UTF-8 fallback | B covers dotted names and independently found truncation/empty-stem defects. No encoder byte changes. Windows runtime validation still blocked. |
| G-06/29/31/79 | Embed all tests/corpus into runtime | Distribute one readable userscript plus offline source/test capsule, pinned golden corpus and fail-closed preflight | B satisfies single installed file/size; offline package is not runtime dependency. Hashes are checksums, not signatures. |
| G-22/23 | Retain px and rely on browser zoom vs relative type sizes with a readable minimum plus shared preference rules | Choose relative font scale, minimum 12px fallback, reduced-motion/forced-colour/contrast CSS appended after all component rules. Observe actual CDP preferences and doubled root font in browser; no claim of screen-reader or all-OS coverage. |
| G-83 | Close shadow roots only (does not authenticate document contextmenu/keyboard events) vs native trusted-interaction gate on all owned UI callbacks | Choose gate, not a global handler that changes page behaviour. Offline unit/fixture transforms can bypass this ONLY in the separately compiled verifier; no page input enables it. Exact production attack and real mouse-save must both be re-run. Same-world intrinsic replacement remains a documented trust assumption. |
| G-25/28 | Add fabricated support links and manual duplicate versions | Correct description, build-stamped version, distributed changelog/freshness gate; no fictional URL | B. G-26 remains blocked on actual maintainer support destination. |
| G-33/80 | Global error/rejection listeners capture whole host page | Catch owned bootstrap promise and existing owned tasks without collecting page errors | B fixes startup only; full async funnel/log awaits 3.0.0. No console spam on successful boot. |

### Coupled larger design (planned, not implemented)

| Coupling | Two approaches and chosen direction | Acceptance gate |
|---|---|---|
| G-20/21 + all new UI | Extract catalog first vs grow another English-only layer | Extract first, English fallback visibly labelled; locale/RTL tests before feature strings; exact semantic string inventory required. No claim 52×29 covers full tool. |
| G-14/15/18 + G-55/60/61 | Cooperative chunking only vs local dedicated Worker + bitmap/OffscreenCanvas with cooperative fallback | Prefer worker for custom encoders with CSP-aware refusal/fallback. Explicit memory preflight, owned cancellation, interruption disclosure. Benchmark before/after, prohibit timer-only 'yield' claims for synchronous loops. |
| G-07/10/11 | Copy ICC/EXIF blindly vs explicit sRGB conversion policy + orientation-normalised selective metadata writer | Choose explicit policy until empirically proven gamut pipeline. Never embed source ICC over sRGB pixels or stale orientation after rotation. Privacy-safe default drop disclosed; technical/authorship optional, GPS separate. Need P3 reference corpus. |
| G-08/31/38/49/50 | Inline third-party codecs vs authored readable PNG/APNG container + browser JPEG/WebP with honest flags | Own PNG only after spec and two-decoder corpus; budget and main-thread tests first. TIFF/ICO/animated WebP/lossless WebP remain named later gates. |
| G-43/48/57/63/64 | Independent dialogs with divergent conversion paths vs shared bounded intake/selection/action registry | Shared core descriptors and queue; tray feeds PDF/sheet/dedupe. History opt-in/default-off activity record (privacy); completed/failed/uncertain distinct. Palette is discovery, not new privileged global API. |
| G-66/67 + presets | Add arbitrary unvalidated overlays/profiles vs schema-allowlisted site rules over workflow defaults and existing conversion presets | Choose validated subset/overrides, not capability/grant overrides. Precedence: defaults → saved global → matched enabled site rules (least→most specific, declaration order ties) → explicit preset → per-action edit. No recursive rules/profiles; explicit user format wins memory. B's output-profile duplicates existing presets; A's full config snapshots can be user backup rather than third config layer. |
| G-61 watcher | Unlimited observer auto-save vs hard-cap armed session with preview/filter/always-visible Stop and uncertain-write stop | Second only, release 3.2.0 after history/worker/tray; no persistence across navigation, no forced authentication/CAPTCHA handling. |

### Layering and dependency graph

`src/encoders`: binary writers only, no DOM/GM/network. `src/core`: input/config security, bounded state, history, worker protocol, image operations. `src/ui`: catalogued rendering and events, never network privileges. `src/main`: intent orchestration and owned error handling. `src/entry.js`: production-only boot; tools/test imports main directly. Offline build instrumentation is never a production mode toggled by page input.

```
private entry + input discipline → reproducible verification capsule + goldens
catalog/RTL → action registry/palette → intake + tray → multipage PDF/contact sheet
worker + memory preflight → budget search / dedupe → armed watcher
selective metadata + explicit colour policy → lossless PDF / safe preservation
history (off by default) → saved badges / per-host format memory
validated global settings + site rules → explicit preset/per-action override
```

## 7. Phase 5 — prioritised plan and release boundaries

| Rank / boundary | Items | Expected residual severity after completed work | Effort / risk / dependencies | What regresses if wrong |
|---|---|---|---|---|
| 1: 2.0.1 candidate | 01–03,05,06,12,22,23,25,28–31,40,76–80; owned startup part of 33 | API publication/flags and config prototype acceptance neutralised; cross-execution duplicate coordination remains S2; S1 suite omission closed only with preflight | medium; private-entry build/test separation risky; no codec edits | Privilege containment, duplicate actions, boot containment, import/migration compatibility |
| 2: 3.0.0 foundation | 04,07,09–11,13–24,26,27,32–37,39,41–48,56,57,59,63,64,66,68–75 | S1 colour/metadata/responsiveness/local-input/PDF/history expected addressed with honest fallback; actual results required | very high; catalogs/workers before new UI or multiplied encodes; real manager lab required | Silent fidelity loss, memory exhaustion, unintended disk writes, confusing setting precedence |
| 3: 3.1.0 assets | 08,38,49–52,54,55,58,60,62 | Remaining breadth S2/S3 reduced, not assumed | high; worker/catalog/spec studies/tray/history prerequisites | Invalid files, alpha/timing loss, false duplicate matches |
| 4: 3.2.0 automation | 61 | S2 runaway risk controlled with hard stops, explicit session | high; all preceding safety gates | Runaway requests/disk use, repeated uncertain writes |

**Not doing:** no telemetry, page storage, remote codecs, runtime library fetching, cloud processing, minification, invented support URL, access-control bypass, approximate QR, or second configuration tier justified merely by two competitors using the same noun. Slideshow declined as nonessential review UI; the picker/transform previews remain. No fake 'absorbed' status for a deferred capability. No claim that this candidate meets all S1 gates.

## 8. Superset disposition table (G-41…G-75)

Every capability has a deliberate disposition. “Deferred” means absent in the patch, not implicitly absorbed. Re-evaluate at the named release; this work order is NOT complete until required S1 acceptance and actual implementation/evidence exist.

| ID | Disposition | Reason / modified scope | Constraints | Dependencies |
|---|---|---|---|---|
'''
for n,c,loc,e,release in rows:
 if n<41:continue
 reason={53:'Declined: generator outside conversion/privacy workflows; independent QR conformance burden not justified.',65:'Declined: peripheral timed review; enlarges navigation/motion surface without helping core conversion.',67:'Declined as separate tier: B format/resize/pack duplicates own presets; A values snapshots are backup/workflow state. Prefer allowlisted site overrides plus existing presets, not three competing layers.'}.get(n, e)
 deps='catalog + action registry + owned-task/worker foundations'
 if n in [48,51,52,60]:deps+='; tray; format-spec/independent decoders'
 if n in [58,59,60,61]:deps+='; opt-in history'
 disposition='Declined' if release=='Declined' else f'Deferred to {release}'
 text+=f'| G-{n:02} | {disposition} | {reason} | C1–C3, C5–C8 | {deps} |\n'
text+='''
## 9. Phase 6 — modified artifact and per-item change record

Implementation/evidence to be appended after the preflight decisions above. This document was first written before source modifications. The scope remains candidate-only until gates pass.

## 10. Phase 7 — verification report

Pending final evidence appendix. Baseline results are not final results.

## 11. Phase 8 — test and corpus suite

Source ESM imports are the intentional headless verification entry, never a production global. `audit/README.md` documents clean-machine requirements; golden generation pins trusted bytes and normal verification never rewrites hashes. Instrumented fixture browser builds must be identified separately. Production probes exercise the exact installable file.

## 12. Phase 9 — release package, compliance, migration and rollback

Pending final evidence appendix. No hosted support path or real-manager acceptance can be claimed without actual infrastructure/testing.

## 13. Phase 10 — residual risk register

This record is deliberately non-empty; severity ranks refer to the remaining brief, not just patch diff.

1. **S1 / release-blocking:** wide-gamut and metadata fidelity, responsiveness/preflight, broad frame policy, local-media intake, multipage document and private activity history are not implemented/verified by a security-only patch. No claim of strict functional superset.
2. **S2 / release-blocking:** removing public capability markers trades unauthenticated shared-state dedupe for private module lifetime. Separate production executions/two managers remain unarbitrated. Same-module repeat boot can be verified, not relabelled cross-manager support.
3. **S1 / infrastructure:** lack of actual public repository/distribution URL is mitigated with downloadable source capsule, but external publication/serviceability is outside this workspace. Decoders/toolchain availability can silently reduce tests without fail-closed preflight.
4. **S2:** real TM/VM/other managers, namespace-only grants, actual filesystem save completion, real restricted sites, browser policy, file access, DRM/video/clipboard intake remain unverified.
5. **S2:** complete locale/RTL extraction, low-vision/forced-colour/assistive technology observations and memory-pressure/discard tests remain incomplete. CSS or prose is not substitute evidence.
6. **S2:** main async ownership audit/logging not yet complete. Global page error listeners intentionally not used to collect someone else’s errors.
7. **S2:** prototype hardening cannot protect JS against a hostile same-world party that replaces built-in intrinsics, intercepts actual granted globals or passes a Proxy with arbitrary traps. Supported external data is manager JSON/file JSON, not hostile executable objects.
8. **S3:** eight high development-only dependency findings from v2 toolchain remain unremediated pending audit recheck. No runtime npm dependencies or third-party inlined library added.
9. **S3:** no maintainer-owned support URL supplied; none will be invented. Golden hashes prove regression consistency, not absence of baseline bugs or authenticity.
'''
(a/'engineering-report.md').write_text(text)
print('wrote',len(text),'characters',len(rows),'triage rows')
