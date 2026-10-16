import sys
if '--recreate-obsolete-checkpoint' not in sys.argv:
    raise SystemExit('OBSOLETE historical generator. Refusing to overwrite the current engineering record; see audit/README.md.')
import pathlib,json,hashlib,statistics,re
r=pathlib.Path(__file__).resolve().parent.parent
a=r/'audit'
text=(a/'engineering-report.md').read_text()
manifest=json.loads((r/'release/release-manifest.json').read_text())
readability=json.loads((a/'evidence/readability.json').read_text())
browser=json.loads((a/'evidence/candidate-browser-checks.json').read_text())
basebrowser=json.loads((a/'evidence/baseline-browser-checks.json').read_text())
perf=json.loads((a/'evidence/candidate-production.json').read_text())
baseperf=json.loads((a/'evidence/baseline-production.json').read_text())
def replace_section(number,body):
 global text
 start=text.index(f'## {number}. ');end=text.find(f'\n## {number+1}. ',start) if number<13 else -1
 title=text[start:text.index('\n',start)]
 text=text[:start]+title+'\n\n'+body.rstrip()+'\n'+(text[end:] if end>=0 else '')
body=f'''**Engineering candidate only.** `release/save-image-as-type.user.js`, metadata version **{manifest['version']}**, **{manifest['bytes']:,} bytes**, **{manifest['build']['modules']} runtime modules**, **{manifest['build']['namedTopLevelBindings']} named top-level bindings**, **{manifest['build']['splitLines']-1:,} newline-delimited lines**. Build’s split-line count includes the trailing empty element. No minification, mangling, third-party runtime library, grant or storage key added.

- MD5: `{manifest['md5']}`
- SHA-256: `{manifest['sha256']}`
- Original is retained at `audit/baseline/v2.0.0.user.js` with the brief’s exact MD5. Original modular source/test snapshot: `audit/baseline/source-v2.0.0.tar.gz`.

### Implemented change record

| Items | Actual change | Observable result / remaining scope |
|---|---|---|
| G-01/03/30/40 | Private WeakMap ownership, importable main, separate always-on entry, no published privileged handle / page switches; documented offline API | Exact production flag/preseed cases all register 8 commands and expose no API. Same-module bootstrap idempotent; independent executions **regress 8→16 commands**. Candidate remains blocked, not advertised safe in every manager/configuration. |
| G-02 | `sandboxed: null`; raw injection label retained | Five metadata shapes all report unknown, not reassurance. Panel never used old sandboxed flag (baseline subclaim refuted). |
| G-05/78 | Own-data descriptor clone to null-prototype records, dangerous-key/accessor/inheritance rejection, bounded graph/text traversal; primitive coercion without external toString/valueOf | Import/storage/remote/save/presets and all default field type-confusion cases pass; removed-boundary mutant fails. Proxies/native-intrinsic replacement are not a supported JSON transport. |
| G-12/76/77 | First-stem Windows device rules including dotted extensions and superscript digits; final post-truncation recheck; nonempty multibyte fallback | Corpus matrix passes. Windows filesystem not available. If requested length cannot hold extension+one-character stem, minimum usable length wins (`i.png` is 5 bytes for a requested 4); real settings’ minimum is larger. |
| G-22/23 | Relative type scale with 12px floor; shared last-in-shadow preference overrides | Settings min 11.5→12px; doubled root scales candidate to24px vs baseline11.5px. Actual browser-emulated reduced motion disables test animation/transition; forced-colour focus outline3px. Not screen-reader/all-OS certification. |
| G-06/25/28/29 | Artifact invariant/verification header; description includes AVIF/original; source/lint/build/changelog packaged | 27 static rules; version/freshness/source checks pass. No fabricated support URL; G-26 remains open. |
| G-31/79/81 | Six original-pinned golden outputs; independent parsing and negative checks; fail-closed prerequisites; optional PDF clock | All six candidate outputs equal original golden bytes. Original PDF was NOT cross-run deterministic: date-only difference discovered, baseline clock frozen, candidate explicit clock added. Default current-time PDF behaviour unchanged. |
| G-33/80 | Awaited owned startup funnel, reporter containment and failed-construction ownership cleanup | Forced rejected startup reported once; failed constructor can retry. NOT a completed rejection funnel/log for all async tasks. |
| G-82 | File-size check before settings File.text | Fake oversized file’s read counter stays zero. Chooser now refuses >200000 bytes before read; this deliberately tightens old character-only post-read rule for unusually large multibyte imports. |
| G-83 (own S1 finding) | Owned UI callbacks require trusted native interaction; removal wrapper identity cached; keyboard directly activates owned action instead of synthetic.click | Before: page-authored events reach fake GM request without API handle. After: menu does not open and no request attempted. Exact production real mouse and real digit each save once. Native-event integrity / actual manager worlds remain unverified. |
| G-19 (partial evidence only) | Static subscription-site inventory, twenty repeated construct/destroy cycles | No accumulated owned main-document listeners across20 cycles. Not a full touch/SPA/modal lifetime proof; retained 3.0.0 disposition. |

The code is modular/readable; no rewrite of codecs. `audit/patches/` records early source deltas and original snapshot permits full rollback. These are engineering checkpoints, NOT a claim that every coupled change already has an independently reversible release commit. That Phase6 requirement remains a release gate. No deferred Domain9 feature is labelled absorbed.
'''
replace_section(9,body)
body='''### Final executed gates and exact commands

| Claim | Command / tool | Executed result / scope |
|---|---|---|
| Required independent environment exists | `node audit/preflight.mjs` | Node20.20.2, Python3.13.16, Pillow12.3.0, pypdf6.21.0, file5.46; Chrome131 Linux libraries resolved. `preflight.json`. |
| Missing decoder fails closed | Temporarily remove installed pypdf directory, run preflight, restore in finally | Exit1; archived `preflight-negative.txt`; missing decoder not accepted as a reduced green suite. |
| Unit/UI/core regression | `npm test` | **549 passed /94 suites /0 failed/cancelled/skipped**. Includes offline Node event-policy transform for synthetic DOM fixtures; not a real-browser event-authentication proof. `candidate-unit-final.txt`. |
| Static gates | `node lint.mjs` | **27/27** including no public test handle, boot switch, page persistence or beacon/socket channel. `candidate-lint-final.txt`. |
| Reproducible readable artifact | `node build.mjs --check` | Exact source match; no runtime imports/version placeholder; metadata matches. `candidate-build-final.txt`. |
| Full fixture browser regression | `npm run test:browser`, twice; preserve report after EACH run | **57/57 twice**, zero skips/retries in archived reports. Fixture API and synthetic-event policy bypass are explicitly compiled offline; separate hash is reported. `candidate-browser-final{,-run2}.json`. |
| Exact production boot/attacks | `node audit/probe-production.mjs release/save-image-as-type.user.js audit/evidence/candidate-production.json` | Clean/preseed/flag/attribute each boot8 commands; no API publication or privileged write, no page errors. No non-navigation/non-favicon requests in measured blank-origin boot window. Main frame+10 children still11 boots. CSP data-image error persists. |
| Exact production UI/keyboard | `node audit/browser-checks.mjs release/save-image-as-type.user.js candidate` | Registered-manager callback opens settings; actual mouse PNG save1 and actual digit-key save1; native event gate enabled. Output350-byte PNG64×48 independently decoded and full RGBA bytes equal source. Fake GM transport, NOT actual manager. |
| Privileged synthetic-event attack | `node audit/synthetic-action-probe.mjs` and baseline argument | Baseline reaches fake GM request; final production rejects before menu opens. No API handle used by attack. `synthetic-action-baseline.json`, `synthetic-action-before.json`, `synthetic-action-after.json`. No live manager exploitability claim. |
| Native accessibility preferences | `audit/browser-checks.mjs`, CDP Emulation.setEmulatedMedia | Default/large-type/reduced-motion/forced-colours/more-contrast/dark snapshots and computed styles archived. Screenshots visually inspected for forced-colour focus and large text; only Chrome browser emulation, not OS screen-reader testing. |
| Deterministic bytes | Golden subtests in `npm test` | BMPalpha618B, BMPodd102B, static/animatedGIF, PDF and ZIP equal fingerprinted original corpus under fixed clocks. ANY byte difference fails. |
| Independent structural/codec checks | `node audit/independent-goldens.mjs`; `file test/golden/*` | Pillow+strict pypdf, zipfile/zlib; raw BMP/GIF/PDF/ZIP offsets/checksums. No independent parser errors in filtered golden media output. `golden-{media,zip,file}.json/txt`. |
| PDF xref | strict pypdf plus raw structure helper | Pinned4650-byte PDF: startxref4434 points at xref; all6 in-use offsets valid; one200×140 JPEG on A4. `golden-media.json`. Raw helper is ours, independent parser is pypdf. |
| Hostile discipline actually matters | Replace cleanConfigData with identity in disposable source clone; run hardening tests | Negative mutant fails3 own-data tests, not an import/tool failure. `own-data-mutation-negative.txt`. |
| Altered golden fails loudly | Flip one byte of disposable BMP; sha256sum-c | Nonzero exit and FAILED, `golden-negative.txt`. Original corpus unchanged. |
| Original contract retained | Offline original VM expose JSON defaults vs source imports; deepEqual | Exactly48 default keys/values,8 format ids,6 action definitions and default shortcuts equal; no new grants (10). `compatibility-contract.json`; migration tests included in full suite. |
| Private data record tests | Hardening corpus tests, loader does not alter schema code | Unknown/malformed/inherited/accessor/prototype/deep/large/cyclic/symbol inputs neutralised; numeric/string object conversion does not run external hooks. |
| Resource lifecycle (limited) | Main bootstrap unit tests, twenty cycles | Owned page listeners return to zero after each destroy; no claim for all UI gestures or cross-manager subscriptions. |
| Package-independent assertions | `node audit/assert-evidence.mjs` | Candidate safety assertions PASS, then explicitly prints RELEASE BLOCKED. Not Definition-of-Done acceptance. |

### Measured performance — do not infer a jank fix

'''
for label,d in [('original',basebrowser),('candidate',browser)]:
 v=[x['syncStartupMs'] for x in d['boot']]
 body+=f'- {label} synchronous startup (5 runs; external timing marks, excludes full compile/parse): mean {statistics.mean(v):.3f}ms, SD {statistics.pstdev(v):.3f}, range {min(v):.3f}–{max(v):.3f}.\n'
for label,d in [('original',baseperf),('candidate',perf)]:
 for size in [512,1024]:
  v=[x['encodeMs'] for x in d['performance'] if x['size']==size]
  body+=f'- {label} GIF{size}×{size},3 runs: mean {statistics.mean(v):.2f}ms, SD {statistics.pstdev(v):.2f}, range {min(v):.2f}–{max(v):.2f}. Timer-delay facts are in the raw JSON.\n'
body+='''
Shared virtual sandbox, Linux x86_64, Chrome131 headless; machine contention is not controlled. Small startup differences are not evidence of a general speed improvement. GIF still blocks the main thread for approximately0.1–0.2s even for these synthetic sizes. G-14/G-15 are unresolved, not “fixed by async”. No large/mobile memory-pressure/discard trial has been completed.

### Readability profile (comparable tokenizer, not the auditor’s metric)

'''
for d in readability['files']:
 body+=f"- `{d['path']}`: {d['uniqueNames']} distinct name tokens, ≤2-character share{d['shortNamePercent']:.3f}%, comment characters{d['commentCharacterPercent']:.3f}%, comment-touched lines{d['commentLinePercent']:.3f}%.\n"
body+='''
`node audit/readability.mjs` uses already-installed js-tokens4.0.0. Keywords filtered; template interpolation names not extracted. Hence baseline differs from auditor’s1619/2.7%/10.29%—method disclosed, no numerical match invented. No material shortening/comment loss observed with the same method. This is not a code-understandability certification.

### Failures retained, not hidden

- First baseline run488 tests lacked pypdf; restored environment yielded513. Negative preflight now refuses that state.
- First candidate unit run failed old tests requiring a public API marker; tests were replaced by stronger no-publication/private-lifetime assertions. This intentionally does NOT preserve the old independent-reinjection guarantee.
- First instrumented browser run56/57 failed a verifier-global whitelist after adding an offline bootstrap handle; whitelist now explicitly enumerates verifier globals, while exact production probes assert no privileged handle.
- First golden PDF comparison differed in CreationDate; fixed clock construction is recorded rather than pretending date bytes were deterministic.
- Untrusted-event boundary initially would reject the menu’s own programmatic keyboard.click; source now invokes the owned action directly, and exact production real digit-key save was executed.
- **Still failing acceptance:** separate production evaluation registers8→16 commands. Gamut/metadata/worker/intake/document/history and other named future work not implemented. Broad declaration “every S1 resolved” would be false.
'''
replace_section(10,body)
replace_section(11,'''The complete offline test/corpus source is in the companion source ZIP, not a remote runtime dependency. See `audit/README.md` for clean-machine requirements and exact commands.

- Stable offline verification facade: `audit/verify-api.mjs` (contract1, signatures in its header). Other internal names may change.
- Original fingerprint: `audit/baseline/v2.0.0.user.js`; original source snapshot tarball. Do not reinstall a known older exposure as a security workaround.
- Golden corpus: `test/golden/manifest.json` plus6 binary files; creation tool requires original MD5; normal checks never repin. Baseline PDF Date is frozen, ZIP wall clock injected.
- Hostile config/filename corpus: `test/corpus/`; generated limits/cycles/type-confusion cases in `test/unit/audit-hardening.test.mjs`. UI oversized-file read prevention test is in `ui-panel.test.mjs`.
- Actual-production attacks/preferences/boot/mouse/keyboard: `audit/{probe-production,browser-checks,synthetic-action-probe}.mjs`. Fixture transport and public-site/manager limits documented.
- Fail-closed preflight: `audit/preflight.mjs`; negative decoder/mutation/checksum evidence retained.
- Static subscription sites: `audit/evidence/subscription-sites.json`; twenty-cycle teardown evidence. A complete target/lifetime/disposer inventory and all modal/touch paths remain unfinished.
- Frame topology and strict-CSP local server are real browser fixtures, not actual dual-manager or public strict-CSP website tests. Cross-origin manager isolation matrix still absent.
- Accessibility screenshots/JSON cover browser preferences and root scaling. Screen readers, OS font preference UI, mobile and forced-colour variants beyond Chrome remain unverified.

Third parties who possess only the distributed package can run the code without reverse-engineering production hooks. Installing dev dependencies can require internet access; installed userscript execution never downloads those dependencies. No claim of a maintained publicly hosted repository is made.''')
replace_section(12,'''### Package identity and distribution boundary

- Runtime: `release/save-image-as-type.user.js` — one readable strict-mode IIFE, no runtime imports/resources. Header version2.0.1; exact bytes/hash in Section9 and `release/release-manifest.json`.
- Companion package: `release/save-image-as-type-2.0.1-candidate-source.zip`. ZIP holds sources, build/lint, tests/corpus, this ordered document, evidence, changelog and original checkpoint; it is NOT a split runtime.
- Runtime checksum: `release/SHA256SUMS`. Archive checksum is outside the archive at `release/PACKAGE_SHA256SUMS` to avoid a self-hash cycle.
- `releaseAccepted:false` is explicit in manifest. No publication to GreasyFork or a public repository performed. No support/homepage URL fabricated. No platform moderator approval claimed.

### Compliance / acceptance checklist

| Constraint / gate | Evidence | Status |
|---|---|---|
| C1 single readable runtime, no mangling/minification | Header/build/freshness, readable sources, comparative tokenizer profile, source ZIP | Candidate passes format/readability checks; not platform-certified |
| C2 no telemetry/page persistence/new runtime network |27-rule lint, blank-origin measured boot, storage snapshots,10 unchanged grants; synthetic fetch attack blocked | Scoped checks pass; arbitrary hostile-native/pageworld configurations unverified |
| C3 least privilege/connect |Same10 grants; wildcard necessity and consent named in artifact header; no new destination | Grant budget preserved; origin trail/actual manager spelling matrix deferred |
| C4 deterministic encoder byte contracts |6 pinned outputs + raw structural tests + independent decoders; PDF clock default retained | Pinned corpus and existing independent suite pass; not all possible inputs/spec clauses certified |
| C5 existing settings/formats/actions/shortcuts/migration |Deep equality against original48-default object;8 ids/6 action definitions; migration suites;8 commands per normal boot | Defaults/storage path preserved; independent-copy registration regression blocks full acceptance |
| C6 size |588238bytes (about574.5KiB), well below2MB ceiling | Pass for candidate |
| C7 no unattributed inlined third-party code |No runtime library added, no require/resource; dev tools named in README | Pass for inspected diff; no competitor implementation copied |
| C8 execution claims bounded by scope |Commands, raw reports, screenshots, known negative outcomes | No real-manager/full-site/all-S1 acceptance claim |
| Every S1 resolved |Remaining entries and residual register | **FAIL / not complete** |
| Every absorbed capability discoverable/localised |No Domain9 feature is claimed absorbed in this patch; all35 dispositions explicit | Full superset **not delivered** |
| Full spec study, every lifetime proof, independent per-item revertibility |Partial matrix, source checkpoint/early deltas only | **Incomplete** |

### Migration and rollback

Schema remains3, with identical48 default settings keys and unchanged `siat.settings.v3` primary key / v2/legacy read order. No history, image bytes, contact log, new secret or persistent job record is added. Existing normal settings need no migration; hostile inherited/accessor/prototype-control data is intentionally dropped. Very large imports are explicitly refused; valid schema scalar values still normalise as before.

Downgrade2.0.1→2.0.0 uses the same ordinary schema3 JSON. Older v1/v2 keys remain untouched as downgrade snapshots per existing design. No new field needs back-porting. Export settings before changes. Restoring `audit/baseline/source-v2.0.0.tar.gz` and rebuilding is a full code rollback, but reintroduces the known public-handle/boot-switch/synthetic-event exposures. Do not install old and candidate copies simultaneously. A real manager’s update/downgrade install flow has NOT been tested here.

Each coupled source/test change must receive a reviewable independent release commit before acceptance; present snapshots/early per-file patches are not represented as fulfilling that final operational gate. The candidate is evidence for continued work, not a general-release recommendation.''')
old=text[text.index('## 13. '):]
extra='''**Current ranked residuals are release blockers, not waiver requests.**

0. **S1 security:** exact-production synthetic DOM request route is now rejected in Chrome emulation, but native Event/EventTarget integrity is assumed. Actual manager worlds/configurations, hostile intrinsic replacement and all UI activation edge cases are not certified. The private handle removal alone was insufficient; G-83 was discovered and fixed during this work.

'''
start=old.index('\n\n')+2
text=text[:text.index('## 13. ')]+old[:start]+extra+old[start:]
text=text.replace('Candidate scope remains candidate-only until gates pass.','Candidate remains blocked until all acceptance gates pass.')
(a/'engineering-report.md').write_text(text)
print('Finalized ordered report:',len(text),'characters')
