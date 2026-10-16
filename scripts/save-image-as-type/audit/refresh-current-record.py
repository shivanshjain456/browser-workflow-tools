#!/usr/bin/env python3
"""Refresh this measured checkpoint without rerunning historical generators."""
from pathlib import Path
import json,hashlib,re,statistics
r=Path(__file__).resolve().parent.parent
a=r/'audit'; text=(a/'engineering-report.md').read_text()
m=json.loads((r/'release/release-manifest.json').read_text())
sha=m['sha256']; raw=(r/'release/save-image-as-type.user.js').read_bytes();assert hashlib.sha256(raw).hexdigest()==sha
perf=json.loads((a/'evidence/candidate-production.json').read_text()); baseperf=json.loads((a/'evidence/baseline-production.json').read_text())
checks=json.loads((a/'evidence/candidate-browser-checks.json').read_text()); basechecks=json.loads((a/'evidence/baseline-browser-checks.json').read_text())
for item in [perf,checks]:assert item['sha256']==sha
unit=(a/'evidence/candidate-unit-current.txt').read_text()
units=m['gates']['unit']['total'];assert re.search(rf'^# tests {units}$',unit,re.M) and re.search(rf'^# pass {units}$',unit,re.M)
for key in ['fail','skipped','cancelled','todo']:assert re.search('^# '+key+' 0$',unit,re.M)
pipeline=json.loads((a/'evidence/pipeline-summary.json').read_text());assert pipeline['artifactSha256']==sha and pipeline['exitCode']==2 and all(x['status']==0 for x in pipeline['steps'])
vm=json.loads((a/'evidence/manager-lab/vm-production.json').read_text()); assert vm['artifactSha256']==sha and vm['completed']

def section(n,body):
 global text
 start=text.index(f'## {n}. ');end=text.find(f'\n## {n+1}. ',start) if n<13 else -1
 title=text[start:text.index('\n',start)]
 text=text[:start]+title+'\n\n'+body.rstrip()+'\n'+(text[end:] if end>=0 else '')
# Preserve the baseline chronology; distinguish newly repeated probes from it.
text=text.replace('### Performance baseline (same sandbox, three repeated runs)','### Performance baseline (refreshed Chrome155 probe; original unit/browser baseline above remains historical)')
start=text.index('### Performance baseline');end=text.index('### Disagreements',start)
lines=['### Performance baseline (refreshed Chrome155 probe; original unit/browser baseline above remains historical)','', 'The original MD5-verified bytes were re-probed under Node22.22.2 / Puppeteer25.14.0 / Chrome155.0.8059.79 to match the current candidate toolchain. See Section10 for paired repeat/variance results. The original 513-unit /57-browser suite logs above remain the initial Node20/Chrome131 baseline, not a freshly claimed rerun.','']
text=text[:start]+'\n'.join(lines)+'\n'+text[end:]
# Add own finding once; G-19/G-16 stay their existing IDs.
if '| G-85 |' not in text:
 pos=text.index('\n## 4. ')
 text=text[:pos]+'\n| G-85 | Actual VM cross-origin Original failed; acquired cache contains raw Uint8Array, while getBytes()/convert consumers require a `{bytes,mime}` record. | Already fetched original bytes ignored, breaking original/inspection paths. | Honour one structured cache contract, reuse held bytes without refetch; execute actual-manager Original and byte equality. | S1/R2 |\n'+text[pos:]
text=text.replace("B substantially overlaps format/resize/pack presets; A snapshots differ. Actual user-demand investigation not executed. A permanent decline would be premature.","Hash-verified pure-function execution now distinguishes B output profiles from A named global snapshots (language/hotkeys/site rules). Current presets do NOT subsume A. Workflow analysis exists; no user interviews. Keep investigation open, not permanently declined.")
text=text.replace("B's output-profile duplicates existing presets; A's full config snapshots can be user backup rather than third config layer.","B output choices substantially overlap presets, but automatic-format/PDF packing remain separate missing capabilities. Executed A capture/export/apply preserves global language/hotkeys/rules and is NOT subsumed by current presets. Backup import is a partial workflow alternative, not equivalent one-click named snapshots; keep G-67 open pending demand/UX research.")
text=text.replace('Provisional preference for site overrides+presets, not three layers: B overlaps format/resize/pack; A snapshots are workflow state. Semantic code inspection exists but actual demand investigation is incomplete, so NOT a final reasoned decline.','Executed semantic/workflow study: B output profiles mostly overlap presets; A named global snapshots are distinct, including language/hotkeys/rules. No permanent decline; demand/UX investigation remains incomplete. See profile-semantics.json and study-profiles.mjs.')
# New design evidence remains inside Phase4, not an extra top-level section.
rollbacks=json.loads((a/'evidence/independent-rollbacks.json').read_text());rb={x['group']:x['remainingTestsPassed'] for x in rollbacks['groups']}
assert set(rb)=={'acquisition-contract','long-press-lifetime','top-frame-commands'} and all(v>0 for v in rb.values())
if '### Subsequent measured designs' not in text:
 pos=text.index('\n## 7. ')
 text=text[:pos]+'''\n### Subsequent measured designs (separate source groups)

| Addressed item | Approach A | Chosen approach B / trade-off |
|---|---|---|
| G-13 /85 | Weaken CSP or teach every consumer ambiguous byte-or-record data | Preserve successful HTML decode; bitmap fallback on already-held data, owned close/release; one structured byte cache. SVG bitmap unavailability remains explicit. No grants/CSP changes. `changes/csp-acquisition-design.md`. |
| G-19 | Replace listener system with AbortControllers everywhere | Retain current disposer pattern, own exactly one long-press release closure; completion/replacement/dismiss/detach clear it. Smaller compatibility surface. `changes/ui-lifetime-design.md`. |
| G-16 /74 frame commands | @noframes suppresses embedded-document interaction | Eight manager commands in top document only; retain native same/cross-origin child conversions. Broader idle scheduling/duplicate-copy policy remains open. |
| Development dependencies | Override FTP and replace/patch abandoned ZIP extractor; unsafe automatic downgrade | Puppeteer25.14.0 modern installer tree, Node>=22.22.2; explicitly pin directly imported dev tools. Runtime unchanged. `changes/toolchain-design.md`. |

`check-rollbacks.py` reverses each of the three new runtime groups separately in source clones, removes only that group's own regression tests, builds/lints, and executes every remaining unit including original byte goldens. See Section9. It does NOT certify reversibility of every earlier change. No feature is claimed present in its intentionally reversed variant.
''' +text[pos:]
section(9,f'''**Engineering candidate only; NOT publish-ready.** `release/save-image-as-type.user.js`, metadata version **{m['version']}**, **{m['bytes']:,} bytes** ({m['bytes']/1024:.1f} KiB), **{m['build']['modules']} runtime modules**, **{m['build']['namedTopLevelBindings']} named top-level bindings**, **{m['build']['splitLines']-1:,} newline-delimited lines** (build split count{m['build']['splitLines']:,}). No minification, mangling, third-party runtime library, new grant, new persistent key or new default setting.

- MD5: `{m['md5']}`
- SHA-256: `{sha}`
- Original MD5 `ed285e423b3e85b5da38e9798423581c` retained at `audit/baseline/v2.0.0.user.js`; original modular snapshot `audit/baseline/source-v2.0.0.tar.gz`.

### Implemented change record

| Items | Actual change | Executed result / remaining limit |
|---|---|---|
| G-01/03/30/40 | Private WeakMap lifetime, separate always-on entry, no public privileged handle/page kill switches; offline API separate | Current exact-source blank/preseed/flag cases boot8 commands with no API. Same-module repeat is idempotent. Independent evaluations still8→16; cross-manager arbitration NOT solved. |
| G-02 | Unknown sandbox verdict, raw metadata retained | Five metadata shapes report unknown; no fabricated isolation guarantee. |
| G-05/78 | Bounded own-data descriptor clone, magic-key/accessor/inherited rejection and primitive-only scalar handling | Hostile corpus passes; removed-boundary negative mutant archived. Hostile Proxies/replaced intrinsics not accepted JSON transports. |
| G-12/76/77 | Windows device stems after truncation; dotted/superscript rules; nonempty UTF-8 stem | Matrix passes; no actual Windows filesystem claim. Minimum usable filename may exceed impossible requested tiny budget. |
| G-22/23 | Relative type floor and shared owned preference overrides | Current browser-emulated font scale12→24px, reduced motion/forced colours/contrast active. Screen-reader/mobile/OS matrix not done. |
| G-06/25/28/29 | Verification header, AVIF/original description, source/lint/build/changelog capsule |27 static gates and build freshness pass. No fabricated support URL; G-26 open. |
| G-31/79/81 | Six original-pinned byte goldens, independent parsers, fail-closed prerequisite check; optional PDF clock | Original PDF date nondeterminism discovered rather than hidden; frozen verification clock, unchanged current-time default. Six outputs still exactly match original. |
| G-33/80 | Awaited owned startup error funnel and failed-construction cleanup | Rejection contained once; retry works. Not a complete async/lifetime/logging audit. |
| G-82 | Import size checked before File.text | Oversized input read counter stays0; deliberate >200000-byte refusal before allocation. |
| G-83 | Trusted native UI boundary, stable removal wrappers, direct owned keyboard callbacks | Exact production synthetic menu rejected; actual mouse/digit/Enter/Space each save1. Actual VM five-case attack also yields no menu/new requests. Native integrity and broad worlds still scoped limits. |
| G-84 | Checkout-relative module marker paths | Historical extraction defect fixed. New rollback clones run under three unrelated paths; all remaining suites pass. |
| G-13 /85 | CSP acquisition fallback with owned bitmap leases; local data URL parsing; structured byte cache | Actual VM same/cross/strict-CSP/data PNG and Original each1; original raster bytes exact. Strict-CSP SVG PNG explicitly fails; OriginalSVG succeeds. No CSP weakening, no extra request for held bytes. |
| G-19 | One retained long-press disposer for completion/replacement/end/move/dismiss/detach | Three tests first red, now green; focused43/43 before toolchain migration, full577 green afterward. Not all-modal/SPA heap proof. |
| G-16 /74 | Eight manager commands only in top frame, child interaction retained | Current exact source top8 +ten child0; actual VM same/cross child PNG each1 and popup8 commands. Independent-copy duplication remains. |
| G-67 (implemented) | Named whole-configuration snapshots: `src/core/profiles.js` plus a settings-panel section, localised through `src/core/messages.js` (en/ar/hi, RTL-aware). A profile is a complete validated settings object; presets stay per-conversion; "Export JSON" remains the file interchange. Added default `profiles: []` is inert ({m['defaultSettingsKeys']} keys total). | Pure unit corpus covers capture/apply/limits/hostile input/storage round trip; exact production drives capture→apply with real trusted input (1 row, store write seen); actual Violentmonkey lab captures, reloads, applies and deletes through real buttons and manager storage. Demand was resolved by the user delegating the choice; no interview evidence is invented. |

### Independent rollback execution of the three recent groups

`python3 audit/check-rollbacks.py`: reverse each source+test patch separately in disposable clones, all other groups retained. Acquisition reversal **{rb['acquisition-contract']}/{rb['acquisition-contract']}**, long-press reversal **{rb['long-press-lifetime']}/{rb['long-press-lifetime']}**, frame-command reversal **{rb['top-frame-commands']}/{rb['top-frame-commands']}**; each build fresh and lint27/27, zero skipped/cancelled/todo. Remaining tests include original byte goldens. Reports/commands: `evidence/independent-rollbacks.json`, `evidence/rollback-*.txt`; patches `patches/group-*.patch`. This is actual limited rollback verification, not certification that ALL earlier hardening changes have independent release commits. Reversal deliberately removes the feature/tests; it is not a safe release recommendation.

No Domain9 capability is claimed absorbed merely by a patch, design or renamed preset.
''')
performance=[]
for label,data in [('original',basechecks),('candidate',checks)]:
 values=[x['syncStartupMs'] for x in data['boot']]
 performance.append(f'- {label} synchronous startup, n={len(values)} (external marks, excludes full compile/parse): mean {statistics.mean(values):.3f}ms, population SD {statistics.pstdev(values):.3f}, range {min(values):.3f}–{max(values):.3f}.')
for label,data in [('original',baseperf),('candidate',perf)]:
 for size in [512,1024]:
  values=[x['encodeMs'] for x in data['performance'] if x['size']==size]
  performance.append(f'- {label} GIF{size}×{size}, n={len(values)}: mean {statistics.mean(values):.2f}ms, population SD {statistics.pstdev(values):.2f}, range {min(values):.2f}–{max(values):.2f}.')
readability=json.loads((a/'evidence/readability.json').read_text())
lex='\n'.join(f"- `{x['path']}`: {x['uniqueNames']} distinct names; ≤2-character share{x['shortNamePercent']:.3f}%; comment characters{x['commentCharacterPercent']:.3f}%; comment-touched lines{x['commentLinePercent']:.3f}%." for x in readability['files'])
section(10,'''### Executed current gates

`node audit/verify-all.mjs` ran under **Node22.22.2 / Puppeteer25.14.0 / Chrome155.0.8059.79** and exited **2 (measured regression gates passed; RELEASE BLOCKED)**. `pipeline-summary.json` binds all steps to the current artifact SHA. Exit1 is failure; exit2 is NOT acceptance. Exact-production evidence assertions reject source/manifest hash drift and a reduced/failed/skipped unit count.

| Claim | Command / evidence | Actual result and scope |
|---|---|---|
| Prerequisites | `node audit/preflight.mjs`; `pipeline-preflight.txt` | Supported Node, Python3.13.16/Pillow12.3.0/pypdf6.21.0/file5.46 and default Chrome libraries present. Older negative missing-decoder test retained. |
| Unit/core/UI | `npm test` / `node test/run-unit.mjs`; `candidate-unit-current.txt`, `pipeline-unit.txt` | **{m['gates']['unit']['total']}/{m['gates']['unit']['total']},{m['gates']['unit']['suites']} suites;0 fail/skipped/cancelled/todo**. Explicit offline synthetic-event loader, not manager authentication proof. |
| Static/build | `node lint.mjs`; `node build.mjs --check` | **27/27**, artifact equals source; no runtime imports/resources. |
| Full fixture browser | `node test/browser/run.mjs`, twice through combined runner | **57/57 twice**; separately hashed offline instrumented source with fake GM. NOT exact production or real manager. |
| Exact production blank-origin boot | `audit/probe-production.mjs`; current `candidate-production.json` | Four boot/attack cases8 commands; no public API, privileged writes, page-storage calls or measured non-navigation/non-favicon boot requests. Eleven documents register `[8,0×10]`. Page CSP still rejects its own data img; user-initiated conversion fallback is tested separately below. |
| Exact production real input | `audit/browser-checks.mjs`; current browser-check JSON | Native mouse PNG1; native digit1/Enter/Space each1. Fake GM transport. Saved PNG489B,64×48. `python3 audit/verify-production-pixels.py`: Pillow full RGBA equal to input; report bound to source SHA. |
| Synthetic DOM attack | `node audit/synthetic-action-probe.mjs` | No candidate menu/privileged request. Old original/before-fix exploit records preserved, labelled fake transport. Actual VM scoped negative also below. |
| Accessibility preferences | Browser-check CDP media emulation and root-font scaling | Reduced-motion, forced-colours, more-contrast, dark/default/large-type computed styles/screenshots. 12px floor; doubled root24px; reduced motion none/0s, forced focus3px. Not OS/AT/RTL/mobile certification. |
| Original pure-data contract | `node audit/verify-contract.mjs` | Current48 default keys/values, all8 full format definitions,6 action definitions, shortcuts and10 grants deep-equal original. New persistent keys0; schema3 retained; migrations in full units. |
| Encoder bytes/structure | Full units; `node audit/independent-goldens.mjs` | Six original-pinned outputs byte-exact. Independent Pillow/strict pypdf/zipfile/zlib plus owned raw offset/CRC helpers pass. No repinning. PDF4650B/xref4434/all6 offsets correct; embedded200×140 JPEG on A4. |
| Actual Violentmonkey | `node audit/real-manager.mjs vm`; `manager-lab/vm-production.json` | Official VM2.49.0 MV3 unchanged/unpacked, isolated normal file install; Chrome155.0.8059.84, new Node22/Puppeteer25 driver. Stored script SHA=current artifact. All five cases plus settings reload/restore and native same/cross frames completed. This is actual manager, not shim; not signed-store/public-site/other-OS certification. |
| Actual-manager downloads | `python3 audit/verify-manager-outputs.py vm` | **11** completed snapshots independently checked. Same/cross/CSP/data PNG1+Original1 each; all raster RGBA exact and all original rasters byte-exact. SVG PNG0 explicit decode error+OriginalSVG1 valid XML. Two child PNGs pixel-exact. Settings prefix survived reload then restored blank; popup8 entries with frames. |
| Tampermonkey | Archived actual TM5.5.1 lab/control records | Official unchanged unpacked CRX normally installed with exact code, but production AND minimal control failed injection. **Inconclusive**, not a compatibility pass or proof of product incompatibility. Chrome131 control attempt timed out. |
| Recent independent rollback groups | `python3 audit/check-rollbacks.py` |553/558/560 remaining units, respective feature tests removed with source;27 lint/build each. Earlier groups still not certified. |
| Development dependency audit | `npm audit --json`; `npm-audit-remediated.json` | **0 vulnerabilities**, down8 high. Node minimum22.22.2; Puppeteer25.14.0, jsdom25.0.1, esprima4.0.1, js-tokens4.0.0 pinned. Runtime unchanged. Audit is time-specific, not a security guarantee. |
| G-67 semantic exercise | `study-profiles.mjs <A attachment> <B attachment>`; `profile-semantics.json` | Hash-verified selected pure competitor functions, no GM/DOM or runtime copying. A global snapshot/export/apply differs from B output profiles and own presets. Constructed workflow analysis, NOT user interviews; no permanent decline asserted. |

Historical negative mutation (boundary removal fails3 tests), changed-golden checksum failure, initial488→513 missing-decoder issue, first548/549 extraction failure and pre-upgrade suites remain archived; they are NOT current totals. Initial three long-press failures also remain (`touch-before.txt`).

### Current comparative performance — not evidence of a jank fix

'''+'\n'.join(performance)+'''

Both artifacts re-probed with the same new Node22/Puppeteer25/Chrome155.0.8059.79 toolchain in the shared Linux x86_64 sandbox. Machine contention is uncontrolled; small n and sequential measurements do not establish an optimisation or confidence interval. Raw encode and delayed-timer samples are in `baseline-production.json` / `candidate-production.json`. GIF remains synchronous/main-thread blocking. G-14/G-15 worker/preflight/memory-pressure/discard obligations are NOT resolved by these numbers. The actual-manager Chrome155.0.8059.84 is a separate explicitly versioned lab.

### Readability (disclosed comparable tokenizer)

'''+lex+'''

`node audit/readability.mjs`: explicitly pinned js-tokens4.0.0; keywords excluded, template interpolation identifiers not extracted. This is NOT the auditor's undisclosed identifier/comment taxonomy. No minification/mangling or material comparative comment loss; not a human-understandability certification.

### Retained upgrade failure

Node22 plus the explicit loader rejected the old `--test test/unit/` directory import before suites (ERR_UNSUPPORTED_DIR_IMPORT). Archived `node22-directory-negative.txt`. The portable `test/run-unit.mjs` now enumerates every .test.mjs file explicitly, refuses empty discovery, forwards filter arguments and propagates child failure/signal. All{m['gates']['unit']['total']} current tests then passed. No tests were suppressed to repair the launcher.

### Extraction boundary

The earlier renamed capsule549-pass check is historical. New three independent rollback clones verify unrelated checkout names with current tooling. A refreshed final source capsule must still be re-extracted and verified; its log is stored separately, not inferred from the root checkout.
''')
section(11,'''The runnable offline source/corpus is distributed with the candidate source ZIP, never fetched by the installed script. `audit/README.md` specifies setup/commands and distinguishes production, verifier and actual manager evidence.

- Pure source API: `audit/verify-api.mjs`, contract1; writer/schema inputs documented; no installed-page access.
- Unit entry: `test/run-unit.mjs`; every `test/unit/*.test.mjs` explicitly discovered. Node fixture event policy is deliberately bypassed only in the offline loader. Browser fixture source is separately instrumented/hashed. Production attacks/native input do NOT bypass it.
- Six original-pinned golden files: `test/golden/manifest.json`. Creation tool requires original MD5, never part of normal verification. Verification must not repin on failure. Fixed PDF clock/date and ZIP DOS-wall-clock rules documented.
- Hostile config/filename corpus: `test/corpus/`, generated accessor/cyclic/type-confusion/limit fixtures and pre-read File-size counter; independent parsers under `test/helpers/`.
- Acquisition regressions: `test/unit/core-acquisition.test.mjs`: lease release, timeout/late close/abort, local data parser and structured-byte/no-refetch contract. Real-manager outputs checked by `verify-manager-outputs.py`, not merely a fake transport count.
- Three touch lifetime regressions + child boot/interaction regression; full subscription/modal/SPA/heap inventory remains incomplete.
- `verify-contract.mjs` independently compares current pure defaults/registry/actions/shortcuts/grants to MD5-pinned original. `verify-production-pixels.py` checks full saved raster pixels, independently of native encoder bytes.
- Exact production/local frame/CSP/security and browser preference matrices: `probe-production.mjs`, `browser-checks.mjs`, `synthetic-action-probe.mjs`. Broad public-site/all-manager/OS/AT matrices still open.
- Actual VM lab: `manager-lab-setup.mjs`, `real-manager.mjs vm`, `verify-manager-outputs.py vm`; isolated official-manager assets/profile are development prerequisites, not redistributed extensions or userscript dependencies. Real TM results remain inconclusive.
- Recent-group rollback verifier and readable unified patches: `check-rollbacks.py`, `patches/group-*.patch`. Results scoped as Section9 explains.
- Optional G-67 input study needs the original two competitor attachments, verifies their MD5 before executing only selected pure functions, and records byte offsets/digests. They are NOT inlined/redistributed in the runtime. This optional investigation is not a mandatory baseline regression dependency or a user survey.

The package's test prerequisites may download development dependencies. That is not runtime network. Screenshots show browser-emulated settings only. A partial spec matrix is not full normative conformance and fixture semantics are not actual manager certification.
''')
section(12,f'''### Identity and distribution boundary

- One readable strict IIFE: `release/save-image-as-type.user.js` (version2.0.1 candidate; hash in Section9/manifest). Source ZIP is a verification companion, NOT a split runtime.
- `release/save-image-as-type-2.0.1-candidate-source.zip`, outside-archive `PACKAGE_SHA256SUMS` and runtime `SHA256SUMS`. Archive checksum external avoids a self-hash cycle.
- `releaseAccepted:false`. No public repository/store publication, platform approval, maintainer URL or signed authenticity claim invented. Downloadable source is not a substitute for completing the work order.

| Constraint / acceptance gate | Executed status / limit |
|---|---|
| C1 readable single runtime | Build/lint/readability pass; no minification/mangling. |
| C2 private/local behaviour | No new persistence or runtime network destination/dependency; measured blank boot quiet; owned synthetic UI attack rejected; manager-only settings round trip. Not universal hostile-intrinsic proof. |
| C3 privileges | Same10 grants; wildcard connect retained solely for explicitly user-initiated arbitrary image hosts. Origin trail/namespace grant matrix remain open. |
| C4 encoder contract | Six original byte goldens+independent parsers/offsets/checksums; current raster RGBA exact, originals exact. Not exhaustive all-input/spec certification. |
| C5 behaviour/storage | All48 defaults/all8 format definitions/6 actions/shortcuts/grants deep-equal original; schema3,8 top commands. Independent-copy8→16 regression unresolved. |
| C6 size |{m['bytes']}bytes ({m['bytes']/1024:.1f}KiB), below2MB; no size shortcut via minification. |
| C7 attribution | No competitor/other third-party implementation inlined into runtime. Development tools named/licensed in capsule README; full proprietary manager extensions not redistributed. |
| C8 proof scope | Current source-hash-bound exact-source and actual-VM evidence plus independent parsing. TM inconclusive; missing broad scope never relabelled green. |
| Every S1 resolved / accepted mitigation | **FAIL / not complete**. Named future release is not acceptance of an S1 waiver. |
| Every Domain9 capability absorbed/discoverable/localised | **NOT delivered**. All35 dispositions retained, G-67 explicitly open. |
| Complete normative study, l10n/RTL/AT/OS/memory/lifecycle matrix | **Incomplete**. |
| Independent rollback of every earlier change | Three recent groups verified, earlier groups still incomplete. |

### Migration / rollback

Schema3, primary `siat.settings.v3` and v2/legacy read order unchanged; identical48 default settings. No history/image/contact/job key added. Ordinary JSON needs no new-field migration; inherited/accessor/prototype-control inputs are deliberately neutralised and >200000-byte import is refused before read. v1/v2→v3 migration tests pass in current suite.

Downgrade to2.0.0 uses the same ordinary schema3 data; export settings first. Source snapshot allows full rollback but reintroduces known exposed-handle/kill-switch/synthetic-input weaknesses. Recent patches can be reversed independently as tested in Section9; this does not mean all prior source/test changes have release commits. Do not install old/candidate copies simultaneously. Native manager setting write/reload/restore was tested; a full native upgrade/downgrade installation flow was NOT.

Development Node>=22.22.2 is a build/test requirement, not a userscript browser requirement. npm/Python/browser assets are development-only. Audit0 is the executed locked-tree snapshot; no promise that future advisories cannot appear. No `@updateURL`, `@downloadURL`, `@require` or remote executable resource added.
''')
section(13,'''**Ranked, nonempty, unresolved acceptance register — not silently accepted waivers.**

1. **S1 / release blocking:** wide-gamut/metadata fidelity, worker responsiveness and pre-decode/resource admission, local media/clipboard/video intake, multipage output and opt-in private history remain absent or unverified. Future3.0.0 labels do NOT satisfy this brief. No strict functional superset delivered.
2. **S2 / release blocking:** independent artifact evaluations still register8→16 fake-manager callbacks. Private module idempotency/top-frame8 are not authenticated cross-copy/cross-manager ownership. Actual VM popup8 with frames is scoped, not dual-manager proof. Never restore page-writable capability markers as a shortcut.
3. **S1 security scope:** exact-source synthetic attack and actual VM local-case attack are rejected, but native intrinsic integrity and full manager/world/UI activation matrices remain assumptions. G-83 showed that removing a public handle alone was insufficient.
4. **S2 compatibility:** VM2.49.0 local headless lab now genuinely exercised; TM5.5.1 production AND minimal control inert, so inconclusive. Firefox/other managers, signed-store installs, actual file paths, restricted public sites, policy/permissions/DRM/clipboard intake and upgrade/downgrade still unverified.
5. **S2 lifetime/memory:** three long-press defects fixed and fresh frame policy tested; this is not complete SPA/BFCache/pressure/discard/modal ownership proof. Large CodeMirror installer paste exhausted the2GB lab; native file import avoids that lab path, not a runtime memory-safety certification.
6. **S2 / fidelity fallback:** strict-CSP same/cross/data raster and originals work in measured VM lab; inlineSVG raster bitmap decode remains unavailable with explicit error, while OriginalSVG works. Do not claim all strict-CSP/SVG issues resolved or weaken site policy.
7. **S2 acceptance breadth:** catalogue/RTL, real AT/OS preference observations, complete normative study, own async logging/ownership inventory and earlier independent release-commit reversibility remain incomplete. Three rollback clones and CSS/emulation are not substitutes.
8. **S2 G-67:** executed source semantics show A named global snapshots are distinct from own presets. Actual user-demand/UX research unperformed; no permanent decline justified by mere naming overlap. Do not invent interview evidence or silently mark absorbed.
9. **S2 boundary:** own-data hardening accepts JSON-like manager/file data, not executable hostile Proxies or replacements of native intrinsics/granted globals. Same-world JavaScript cannot fully isolate against code with equivalent execution authority.
10. **S3 serviceability:** no maintainer-owned support/distribution URL supplied; no fake URL or public publication. Source capsule enables independent review but does not establish authenticity, ownership or general release approval. Golden hashes prove consistency, not absence of original codec defects.

The former eight-high development audit residual is **closed in the measured dependency snapshot** (now0 after supported-toolchain upgrade); it is not falsely retained as a current blocker. This does not close the functional/security acceptance items above. Combined regression verifier deliberately exits2 while any full-release acceptance remains unfulfilled.
''')
text=re.sub(r'\n{2,}(?=\| G-85 \|)', '\n', text)
(a/'engineering-report.md').write_text(text)
print('Updated ordered 13-section record for',sha)
