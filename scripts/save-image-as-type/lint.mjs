#!/usr/bin/env node
/**
 * Static gate: the checks that must never regress, runnable as `npm run lint`
 * and asserted by test/unit/security.test.mjs.
 *
 * It enforces three project invariants:
 *   1. no dynamic-code or HTML sinks anywhere in the shipped script,
 *   2. no unpinned remote executable dependency (@require/@resource),
 *   3. the declared @grant list is exactly the set of GM_* APIs the code uses —
 *      no more (least privilege), no fewer (would break at runtime).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { META, renderMetadata, SCRIPT_VERSION } from './src/meta.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      yield* walk(full);
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      yield full;
    }
  }
}

const FORBIDDEN = [
  { id: 'public-capability-handle', pattern: /__saveImageAsTypeInitialised/, why: 'privileged test handles must never ship' },
  { id: 'page-boot-switch', pattern: /__SIAT_NO_AUTOBOOT|data-siat-no-autoboot/, why: 'production boot is not page-configurable' },
  { id: 'page-persistence', pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/, why: 'persistence belongs only in manager storage' },
  { id: 'telemetry-channels', pattern: /\bsendBeacon\s*\(|\bnew\s+WebSocket\s*\(/, why: 'no beacon or socket destinations' },
  { id: 'eval', pattern: /\beval\s*\(/, why: 'dynamic code execution' },
  { id: 'new-function', pattern: /new\s+Function\s*\(/, why: 'dynamic code execution' },
  { id: 'innerhtml', pattern: /\.innerHTML\s*=/, why: 'HTML sink reachable by page text' },
  { id: 'outerhtml', pattern: /\.outerHTML\s*=/, why: 'HTML sink reachable by page text' },
  { id: 'insert-adjacent-html', pattern: /\.insertAdjacentHTML\s*\(/, why: 'HTML sink reachable by page text' },
  { id: 'document-write', pattern: /document\.write\s*\(/, why: 'document rewriting' },
  { id: 'string-timer', pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/, why: 'string timers are eval in disguise' },
  { id: 'unsafeWindow', pattern: /\bunsafeWindow\b/, why: 'page-world access is not needed by this script' },
  { id: 'debugger', pattern: /^\s*debugger\s*$/m, why: 'debug statement left in source' },
  { id: 'javascript-url', pattern: /['"`]javascript:/, why: 'script URL sink' },
  { id: 'remote-require', pattern: /^\s*\/\/\s*@require\b/m, why: 'unpinned remote executable dependency' },
  { id: 'remote-resource', pattern: /^\s*\/\/\s*@resource\b/m, why: 'unpinned remote dependency' },
  { id: 'gm-add-element-src', pattern: /GM_addElement\s*\(\s*['"]script['"]/i, why: 'remote script injection' },
];

export function runLintChecks() {
  const results = [];
  const push = (id, ok, detail) => results.push({ id, ok, detail });

  const srcFiles = [...walk(join(ROOT, 'src'))];
  const distPath = join(ROOT, 'release/save-image-as-type.user.js');
  const dist = existsSync(distPath) ? readFileSync(distPath, 'utf8') : null;

  // 1. forbidden constructs, in sources and in the shipped artifact
  for (const rule of FORBIDDEN) {
    const hits = [];
    for (const file of srcFiles) {
      const code = readFileSync(file, 'utf8');
      if (rule.pattern.test(code)) hits.push(relative(ROOT, file));
    }
    if (dist && rule.pattern.test(dist)) hits.push('release/save-image-as-type.user.js');
    push(
      `no-${rule.id}`,
      hits.length === 0,
      hits.length ? `${rule.why} — found in: ${hits.join(', ')}` : `${rule.why}: absent from all ${srcFiles.length} sources and the artifact`,
    );
  }

  // 2. Declared grants vs. GM_* APIs actually referenced.
  //    Only names in the documented GM_* vocabulary count: `GM_NS` is a local
  //    variable in src/core/gm.js, not a permission, and a bare /GM_\w+/ match
  //    used to flag it.
  const GM_VOCABULARY = new Set([
    'GM_info', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues',
    'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_xmlhttpRequest',
    'GM_download', 'GM_registerMenuCommand', 'GM_unregisterMenuCommand',
    'GM_notification', 'GM_openInTab', 'GM_setClipboard', 'GM_addStyle',
    'GM_addElement', 'GM_getResourceText', 'GM_getResourceURL', 'unsafeWindow',
  ]);
  //    Comments are blanked first: a doc comment explaining why an API is *not*
  //    used (e.g. "the manager's clipboard grant is text-only") must not read as
  //    a usage. Strings are kept, because gm.js lists lookup paths as strings.
  const stripComments = (code) => code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const declared = new Set(META.grant);
  const used = new Set();
  for (const file of srcFiles) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/\b(GM_[A-Za-z]+|unsafeWindow)\b/g)) {
      if (GM_VOCABULARY.has(match[1])) used.add(match[1]);
    }
  }
  const undeclared = [...used].filter((name) => !declared.has(name));
  const unused = [...declared].filter((name) => !used.has(name));
  push('grants-match-usage', undeclared.length === 0 && unused.length === 0,
    undeclared.length || unused.length
      ? `used-but-not-declared: [${undeclared.join(', ')}]; declared-but-unused: [${unused.join(', ')}]`
      : `${declared.size} grants, all used: ${[...declared].join(', ')}`);

  // 3. @connect scope is the documented wildcard and nothing sneakier
  push('connect-scope', JSON.stringify(META.connect) === JSON.stringify(['*']),
    `@connect = ${JSON.stringify(META.connect)} (wildcard required: images are hosted on arbitrary CDNs; documented in README)`);

  // 4. match scope is http/https everywhere, no privileged schemes
  const matchOk = META.match.every((pattern) => /^\*:\/\/\*\/\*$/.test(pattern));
  push('match-scope', matchOk, `@match = ${JSON.stringify(META.match)}; no file://, chrome://, or extension origins`);

  // 5. artifact integrity
  if (!dist) {
    push('artifact-exists', false, 'release/save-image-as-type.user.js is missing — run npm run build');
  } else {
    push('artifact-exists', true, `${(Buffer.byteLength(dist) / 1024).toFixed(1)} KB, sha256 ${createHash('sha256').update(dist).digest('hex').slice(0, 16)}`);
    const header = renderMetadata();
    push('artifact-header-matches-meta', dist.startsWith(header),
      dist.startsWith(header) ? 'metadata block in release/ is byte-identical to src/meta.js' : 'release metadata block differs from renderMetadata(META)');
    push('no-build-placeholder', !dist.includes('__SIAT_BUILD_VERSION__'), 'version placeholder was replaced at build time');
    push('no-runtime-imports', !/^\s*(?:import|require)\s*[({\s'"]/.test(dist.replace(/^\/\/.*$/gm, '')),
      'no import/require statements survive into the artifact');
    const versionPattern = new RegExp(`^// @version\\s+${SCRIPT_VERSION.replace(/\\./g, '\\.')}$`, 'm');
    push('version-consistent', versionPattern.test(dist) && dist.includes(`SCRIPT_VERSION_REPORTED = '${SCRIPT_VERSION}'`),
      `metadata @version and in-script version are both ${SCRIPT_VERSION}`);

    // 6. no remote URLs other than the non-executable metadata identifiers
    const urls = new Set();
    for (const match of dist.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) urls.add(match[0]);
    // Allowed: (a) inert metadata identifiers and XML namespace URIs (never
    // fetched — a namespace URI is a name, not a location), and (b) RFC 2606 /
    // RFC 6761 reserved hosts that cannot resolve, used only as a base argument
    // to `new URL()` so relative image URLs can be parsed.
    const allowed = new Set([
      META.namespace, META.homepageURL, META.supportURL, META.downloadURL, META.updateURL,
      'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml',
    ].filter(Boolean));
    const isReservedHost = (url) => /https?:\/\/[^/]*\.(invalid|test|example|localhost|local)\b/i.test(url);
    const unexpected = [...urls].filter((u) => {
      const clean = u.replace(/[.,;]$/, '');
      return !allowed.has(clean) && !isReservedHost(clean);
    });
    // Reserved hosts must only ever appear as a parse base, never as a request.
    const fetched = [...dist.matchAll(/(?:fetch|GM_xmlhttpRequest|xhrBlob|downloadBlobUrl)\s*\(([^)]{0,160})/g)]
      .map((m) => m[1])
      .filter((args) => /https?:\/\//.test(args));
    push('no-remote-endpoints', unexpected.length === 0 && fetched.length === 0,
      unexpected.length
        ? `unexpected remote URLs baked into the artifact: ${unexpected.join(', ')}`
        : fetched.length
          ? `a hardcoded URL is passed to a network call: ${fetched.join(' | ')}`
          : `only inert identifiers/reserved parse bases appear: ${[...urls].join(', ')}`);
  }

  // 7. No accidental calls into the page's window globals.
  //    Inside a module, a bare `close()` or `open()` does not fail to compile —
  //    it resolves to the page's `window.close()` / `window.open()`. That is how
  //    the settings dialog shipped once in a state where no button could dismiss
  //    it and "Reset defaults" opened a blank popup tab. This rule flags bare
  //    calls to window-owned names that the file never declares itself.
  const PAGE_GLOBAL_CALLS = new Set([
    'open', 'close', 'focus', 'blur', 'print', 'stop', 'alert', 'confirm', 'prompt',
    'scrollTo', 'scrollBy', 'moveTo', 'moveBy', 'resizeTo', 'resizeBy', 'find',
    'postMessage', 'match', 'select', 'submit', 'reset', 'click', 'captureEvents',
    'releaseEvents', 'showModalDialog', 'getComputedStyle', 'requestAnimationFrame',
  ]);
  // Blank out comments and string/template *contents* (keeping `${...}` code) so
  // prose like "cannot read individual frames (" is not mistaken for a call.
  const stripNonCode = (code) => code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^${}\n]/g, ' ')); // keep newlines: reported line numbers must be real
  const declaredNames = (code) => {
    const names = new Set();
    for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) names.add(part.split(':').pop().trim());
    }
    for (const m of code.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) names.add(part.split(/\s+as\s+/).pop().trim());
    }
    for (const m of code.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]);
    // Parameter names shadow globals legitimately (`(close) => close()`).
    for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
      for (const part of m[1].split(',')) names.add(part.replace(/[={}.]/g, ' ').trim().split(' ')[0]);
    }
    names.delete('');
    return names;
  };
  const globalCallHits = [];
  for (const file of srcFiles) {
    const code = stripNonCode(readFileSync(file, 'utf8'));
    const declared = declaredNames(code);
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      // Lookarounds (not consuming groups) so two calls on one line are both
      // seen; a trailing `{` means it is a method *definition*, not a call.
      for (const m of line.matchAll(/(?<![.\w$'"`])(?<name>[A-Za-z_$][\w$]*)\s*\([^()]*\)(?!\s*\{)/g)) {
        const name = m.groups.name;
        if (!PAGE_GLOBAL_CALLS.has(name) || declared.has(name)) continue;
        globalCallHits.push(`${relative(ROOT, file)}:${index + 1} ${name}()`);
      }
    });
  }
  push('no-implicit-page-globals', globalCallHits.length === 0,
    globalCallHits.length
      ? `bare call resolves to a page window global instead of local code: ${globalCallHits.join(', ')}`
      : `no bare calls to window-owned names (${PAGE_GLOBAL_CALLS.size} checked) across ${srcFiles.length} sources`);

  return results;
}

// Guard the CLI so tests can import runLintChecks() without exiting the runner.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

const results = invokedDirectly ? runLintChecks() : [];
let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.id}\n      ${result.detail}`);
}
if (invokedDirectly) {
  console.log(`\n${results.length - failed}/${results.length} lint checks passed`);
  process.exit(failed ? 1 : 0);
}
