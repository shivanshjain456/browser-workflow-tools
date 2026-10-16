from pathlib import Path
import subprocess
root=Path('.')
def change(file, fn):
 p=Path(file); before=p.read_text(); after=fn(before); assert after!=before,file;p.write_text(after)
 diff=subprocess.run(['diff','-u','--label',file+' (before)','--label',file+' (after)','/dev/stdin',str(p)],input=before,text=True,capture_output=True).stdout
 (Path('audit/patches')/(file.replace('/','__')+'.patch')).write_text(diff)
# Private registry; no publication or adoption of page roots.
def main(s):
 s=s.replace("const INIT_FLAG = '__saveImageAsTypeInitialised';",'''// Private ownership: never put manager capabilities on page-controlled roots.
// This registry deduplicates callers of THIS module, not independently evaluated
// copies or different managers. Those are explicitly unverified configurations.
const bootstrapInstances = new WeakMap();''')
 a=s.index('  // Idempotency: exactly one instance per document')
 b=s.index('  const gm = options.gm',a)
 s=s[:a]+'''  const existing = bootstrapInstances.get(doc);
  if (existing) return existing;
  const api = { ready: false };
  bootstrapInstances.set(doc, api);

'''+s[b:]
 s=s.replace('      for (const markerRoot of markerRoots()) delete markerRoot[INIT_FLAG];','      bootstrapInstances.delete(doc);')
 a=s.index('  // Copy the API onto the object that was published before boot')
 b=s.index('  for (const key of Reflect.ownKeys(instance))',a)
 s=s[:a]+'''  // This API is returned only to trusted source-module callers. Production
  // entry discards it; offline verification imports this module explicitly.
'''+s[b:]
 s=s.replace('  for (const root of markerRoots()) root[INIT_FLAG] = api; // same-world handle for tests and support\n','')
 a=s.index('/* Self-start unless a test harness')
 s=s[:a]+'''/**
 * Owned startup funnel. Catch the async result, not just synchronous throws.
 * An injected reporter is a trusted verifier dependency; production uses the
 * local console only on startup failure. Host-page errors are never collected.
 */
export async function startProduction(start = bootstrap, report = reportStartupFailure) {
  try {
    return await start();
  } catch (error) {
    try { report(error); } catch { /* a reporter must not reject into the page */ }
    return null;
  }
}
function reportStartupFailure(error) {
  try {
    console.error('[Save Image as Type] failed to start:', error && error.message ? error.message : error);
  } catch { /* console may not exist in a manager sandbox */ }
}
'''
 s=s.replace(' * cost to page load,',' * heavy pixel work to page load,')
 s=s.replace('so the script adds no measurable\n * heavy pixel work to page load,','so it does not intentionally add\n * heavy pixel work to page load,')
 s=s.replace(' * Injection is idempotent: a manager can legitimately inject twice (page +\n * iframe reuse, or a manual re-run), and the guard below makes the second run a\n * no-op instead of a second menu.',' * Repeated bootstrap calls within one module are idempotent. Independently\n * evaluated copies / multiple managers are not authenticated peers: a shared\n * DOM marker is deliberately not trusted for ownership or privileged APIs.')
 return s
change('src/main.js',main)
Path('src/entry.js').write_text('''/**
 * Production entry. No page-writable flags, test hooks or privileged exports.
 * Verification: import src/main.js and core/encoder ES modules offline; see
 * audit/README.md in the accompanying source capsule. The installed IIFE never
 * exposes its internals. No isolation claim is inferred from GM_info metadata.
 *
 * Privacy/security invariants: manager-only persistence; zero boot network;
 * image-only user-initiated fetches, no telemetry/uploads/executable downloads;
 * no dynamic code/HTML sinks; no capability handles on DOM/window. lint.mjs
 * checks forbidden sinks and scope, tests pin deterministic encoder bytes.
 * Frame policy remains document-local interaction (including subframes), not
 * cross-manager arbitration. See engineering report for the unresolved cost.
 */
import { startProduction } from './main.js';
startProduction();
''')
change('build.mjs',lambda s:s.replace("const ENTRY = resolve(ROOT, 'src/main.js');","const ENTRY = resolve(ROOT, 'src/entry.js');").replace('from src/main.js (entry)','from src/entry.js (entry)'))
# Explicit unknown, not manager-name guess.
change('src/core/gm.js',lambda s:s.replace("    sandboxed: Boolean(info && info.script && info.script['run-at'] !== undefined) || Boolean(info),",'''    // A manager's injection label is not proof of an isolation boundary.
    // null means not independently observed; never manufacture a reassuring yes.
    sandboxed: null,'''))
# Ingress through every settings channel, before merge/coercion.
def settings(s):
 s="import { cleanConfigData, parseConfigJson } from './config-data.js';\n"+s
 s=s.replace('export function migrateSettings(raw) {','export function migrateSettings(raw) {\n  raw = cleanConfigData(raw);')
 s=s.replace('export function normalizeSettings(raw) {','export function normalizeSettings(raw) {\n  raw = cleanConfigData(raw);')
 s=s.replace('JSON.parse(String(text))',"parseConfigJson(typeof text === 'string' ? text : '')")
 s=s.replace('JSON.parse(value)','parseConfigJson(value)').replace('JSON.parse(next)','parseConfigJson(next)')
 s=s.replace('Object.assign({}, cached, patch || {})','Object.assign(Object.create(null), cached, cleanConfigData(patch) || {})')
 s=s.replace('Object.assign({}, raw, { schemaVersion:', 'Object.assign(Object.create(null), raw, { schemaVersion:')
 return s
change('src/core/settings.js',settings)
change('src/core/presets.js',lambda s:"import { cleanConfigData } from './config-data.js';\n"+s.replace('export function normalizePreset(raw, { index = 0, allowedFormats = PRESET_FORMAT_IDS } = {}) {','export function normalizePreset(raw, { index = 0, allowedFormats = PRESET_FORMAT_IDS } = {}) {\n  raw = cleanConfigData(raw);'))
def filename(s):
 s=s.replace('const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;', '''// Windows interprets device names before any extension, including dotted bases.
// Superscript 1/2/3 are also device digits. Console pseudo-files are disallowed.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\\$|conout\\$)(?:[. ]|$)/i;''')
 s=s.replace('  if (WINDOWS_RESERVED.test(text)) text = `_${text}`;\n','')
 s=s.replace('  return text;\n}', '''  // Truncation itself can turn an innocent stem such as CONvoy into CON.
  if (WINDOWS_RESERVED.test(text)) text = `_${text}`.slice(0, Math.max(1, maxChars));
  return text;
}''',1)
 s=s.replace('  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`;', '''  if (!stem) stem = 'i'; // a multibyte character may not fit a one-byte budget
  if (WINDOWS_RESERVED.test(stem)) stem = truncateToBytes(`_${stem}`, budget) || 'i';''')
 return s
change('src/core/filename.js',filename)
# Metadata changed only to report delivered behaviour, no new permission.
change('src/meta.js',lambda s:s.replace("SCRIPT_VERSION = '2.0.0'","SCRIPT_VERSION = '2.0.1'").replace('PNG, JPG, WebP, GIF, BMP or PDF.','PNG, JPG, WebP, GIF, BMP, PDF, probe-gated AVIF or original bytes.'))
import json
for name in ['package.json','package-lock.json']:
 p=Path(name);data=json.loads(p.read_text());data['version']='2.0.1'
 if name=='package-lock.json':data['packages']['']['version']='2.0.1'
 p.write_text(json.dumps(data,indent=2)+'\n')
