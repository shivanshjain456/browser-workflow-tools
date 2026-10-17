#!/usr/bin/env node
/**
 * Dependency-free bundler for the distributed userscript.
 *
 * The sources under `src/` are real ES modules so that `node --test` can import
 * them directly. The artifact, however, must be ONE self-contained file with no
 * runtime imports (userscript managers inject it into a sandbox and there is no
 * module loader there). This script does the smallest honest thing that gets
 * from one to the other:
 *
 *   1. walk the relative-import graph from src/entry.js (entry),
 *   2. order modules dependencies-first,
 *   3. strip `import` statements and de-export declarations,
 *   4. fail loudly on duplicate export names (they would collide in one scope),
 *   5. wrap everything in a single strict-mode IIFE behind the rendered
 *      metadata block, and write release/save-image-as-type.user.js.
 *
 * Usage:
 *   node build.mjs            # write the artifact
 *   node build.mjs --check    # fail if release/ is stale (used by CI/tests)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { renderMetadata, SCRIPT_VERSION } from './src/meta.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(ROOT, 'src/entry.js');
// `release/` rather than the conventional `dist/`: this workspace's snapshot
// excludes directory names like dist/ and build/, so the deliverable artifact
// would not persist between sessions. One artifact, one path, no copies.
const OUT = resolve(ROOT, 'release/save-image-as-type.user.js');

const IMPORT_RE = /^[ \t]*import\s+(?:[\s\S]*?\sfrom\s+)?['"](\.[^'"]+)['"];?[ \t]*$/gm;
const EXPORT_DECL_RE =
  /^[ \t]*export\s+(default\s+)?(async\s+function|function|class|const|let|var)\b/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*[{*]/gm;
/**
 * Top-level declarations, i.e. anything starting at column 0 (this project's
 * formatting keeps nested declarations indented). Every module shares ONE scope
 * after bundling, so a collision between two modules' private `const HOST_ID`
 * is a hard build error, not a warning.
 */
const TOPLEVEL_DECL_RE =
  /^(?:export\s+)?(?:async\s+function|function|class|const|let|var)\s+([^=;\n({]+)/gm;

/** @returns {string[]} module files in dependency-first order */
function collectModules(entry) {
  const order = [];
  const seen = new Set();
  const visit = (file, stack) => {
    const abs = resolve(dirname(file), relative(dirname(file), file));
    if (seen.has(abs)) return;
    if (stack.includes(abs)) {
      throw new Error(`Import cycle detected: ${[...stack, abs].map((f) => relative(ROOT, f)).join(' -> ')}`);
    }
    seen.add(abs);
    const code = readFileSync(abs, 'utf8');
    for (const match of code.matchAll(IMPORT_RE)) {
      const dep = resolve(dirname(abs), match[1]);
      if (!existsSync(dep)) throw new Error(`Missing module ${match[1]} imported by ${relative(ROOT, abs)}`);
      visit(dep, [...stack, abs]);
    }
    order.push(abs);
  };
  visit(entry, []);
  return order;
}

function stripModuleSyntax(code, file) {
  const rel = relative(ROOT, file);
  if (/^\s*export\s+default/m.test(code)) throw new Error(`${rel}: 'export default' is not supported by the bundler`);
  if (EXPORT_LIST_RE.test(code)) throw new Error(`${rel}: 'export {…}' / 'export *' are not supported by the bundler`);
  const exported = [];
  for (const match of code.matchAll(/^[ \t]*export\s+(?:async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    exported.push(match[1]);
  }
  const declared = [];
  for (const match of code.matchAll(TOPLEVEL_DECL_RE)) {
    // Handles `const a = 1, b = 2;` and `let x, y;`
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.push(name);
    }
  }
  const body = code
    .replace(IMPORT_RE, '')
    .replace(EXPORT_DECL_RE, (_m, _dflt, kind) => kind)
    .replace(/^[ \t]*\n/gm, (m) => (m.includes('\t') || m.includes(' ') ? '' : m));
  return { body: body.trim(), exported, declared };
}

export function bundle() {
  const modules = collectModules(ENTRY);
  const names = new Map();
  const parts = [];

  for (const file of modules) {
    const code = readFileSync(file, 'utf8');
    const { body, exported, declared } = stripModuleSyntax(code, file);
    // A name can legitimately appear in both lists (an exported declaration is
    // also a top-level declaration), so dedupe per file first.
    for (const name of new Set([...exported, ...declared])) {
      if (names.has(name) && names.get(name) !== file) {
        throw new Error(
          `Duplicate top-level name '${name}' in ${relative(ROOT, file)} and ${relative(ROOT, names.get(name))}. ` +
            'All modules are concatenated into one scope, so every top-level declaration must be unique. ' +
            'Rename it (e.g. prefix it with the module name).',
        );
      }
      names.set(name, file);
    }
    parts.push(`/* ── ${relative(ROOT, file).replace(/\\/g, '/')} ───────────────────────── */\n${body}\n`);
  }

  const header = [
    renderMetadata(),
    '',
    `/*`,
    ` * Save Image as Type — userscript`,
    ` * version ${SCRIPT_VERSION}`,
    ` *`,
    ` * Everything below runs locally in your browser. The script makes no network`,
    ` * requests except the image you explicitly asked it to convert (fetched`,
    ` * through your userscript manager only when the page's own CORS policy would`,
    ` * otherwise block reading its pixels), and it saves files through your`,
    ` * manager's download API. No analytics, no telemetry, no third parties.`,
    ` *`,
    ` * Security invariants: no page storage, no dynamic code/HTML sinks, no`,
    ` * page-global privileged API, no page-controlled boot flag. lint.mjs and`,
    ` * the accompanying offline source/test capsule check these invariants.`,
    ` * Verification entry: import audit/verify-api.mjs OFFLINE; never a page hook.`,
    ` * Cross-origin pixel acquisition adheres strictly to zero-wildcard security policies.`,
    ` * Disable manager acquisition with allowCrossOriginFetch if not wanted.`,
    ` * Independent installations/managers are not authenticated by DOM markers.`,
    ` *`,
    ` * Built from modular sources by build.mjs — do not edit release/ by hand.`,
    ` * modules: ${modules.length}`,
    ` */`,
    '',
  ].join('\n');

  let body = parts.join('\n');
  // Inject the version from src/meta.js so the value shown in the diagnostics
  // panel can never drift from the metadata block.
  const VERSION_TOKEN = '__SIAT_BUILD_VERSION__';
  if (!body.includes(VERSION_TOKEN)) {
    throw new Error(`build: expected ${VERSION_TOKEN} in the bundle (src/main.js) to stamp the version into.`);
  }
  body = body.split(VERSION_TOKEN).join(SCRIPT_VERSION);

  const source = `${header}(function () {\n'use strict';\n\n${body}\n})();\n`;
  return { source, modules, exports: [...names.keys()] };
}

// Only run as a CLI when executed directly, so tests can import bundle() without
// the import rewriting the artifact.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

const isCheck = process.argv.includes('--check');

if (invokedDirectly) {
const { source, modules, exports: exportNames } = bundle();

if (isCheck) {
  if (!existsSync(OUT)) {
    console.error('release/save-image-as-type.user.js is missing — run `npm run build`.');
    process.exit(1);
  }
  const current = readFileSync(OUT, 'utf8');
  if (current !== source) {
    console.error(
      'release/save-image-as-type.user.js is STALE (sources changed since last build).\n' +
        `  release sha256: ${createHash('sha256').update(current).digest('hex').slice(0, 16)}\n` +
        `  rebuilt sha256:${createHash('sha256').update(source).digest('hex').slice(0, 16)}\n` +
        '  run `npm run build` to regenerate it.',
    );
    process.exit(1);
  }
  console.log(`OK: release/save-image-as-type.user.js is in sync with ${modules.length} source modules.`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, source, 'utf8');
  const kb = (Buffer.byteLength(source) / 1024).toFixed(1);
  console.log(
    `built release/save-image-as-type.user.js — v${SCRIPT_VERSION}, ${modules.length} modules, ` +
      `${exportNames.length} exports, ${source.split('\n').length} lines, ${kb} KB`,
  );
  // Keep the release metadata in step with the bytes that were just written, so a
  // stale manifest/checksum can never be committed next to a fresh artifact.
  // `scripts/verify-release.mjs` fails if any of these disagree.
  const bytes = readFileSync(OUT);
  const manifestPath = resolve(ROOT, 'release/release-manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Derived facts only. Verification claims live in
    // `audit/evidence/release-evidence.json` and are never rewritten by a build.
    for (const stale of [
      'status', 'gates', 'blockers', 'exactProductionChecks', 'combinedVerification',
      'actualManagerEvidence', 'extractedCapsuleVerification', 'recentIndependentRollbackGroups',
      'productionKeyboardKeys', 'devAudit', 'localisation', 'toolchain',
      'newSettings', 'newStorageKeys', 'newRuntimeDependencies', 'newRuntimeDestinations',
    ]) delete manifest[stale];
    manifest.evidence = 'audit/evidence/release-evidence.json';
    manifest.bytes = bytes.length;
    manifest.md5 = createHash('md5').update(bytes).digest('hex');
    manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
    manifest.build = {
      modules: modules.length,
      namedTopLevelBindings: exportNames.length,
      splitLines: source.split('\n').length,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(resolve(ROOT, 'release/SHA256SUMS'), `${manifest.sha256}  save-image-as-type.user.js\n`);
    console.log('updated release/release-manifest.json and release/SHA256SUMS');
  }
}
}
