#!/usr/bin/env node
/**
 * Release gate: everything that must agree before this repository may be
 * published or tagged. It is deliberately dependency-free and offline.
 *
 * Checks
 *   1. Version agreement: package.json, src/meta.js, built @version, changelog,
 *      release manifest.
 *   2. Artifact validity: metadata block usable by a manager, no unresolved
 *      imports, no development-only globals, no source-map references, no
 *      credential-shaped strings, size ceiling.
 *   3. Permissions: metadata grants === manifest grants === actually used grants.
 *   4. Checksums: release/SHA256SUMS matches the committed artifact.
 *   5. Generated docs are current (docs/reference/settings.md).
 *   6. Internal links: every relative Markdown link in README/docs resolves to a
 *      file that exists in the repository.
 *   7. Unfilled owner placeholders are reported (warnings, not failures) so a
 *      publish step cannot silently ship "<OWNER>/<REPO>".
 *
 * Exit 1 on any failed check. Warnings never change the exit code.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SCRIPT_VERSION, META } from '../src/meta.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const info = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);
const ok = (message) => info.push(message);
const read = (path) => readFileSync(resolve(root, path), 'utf8');

/* 1. version agreement ---------------------------------------------------- */
const pkg = JSON.parse(read('package.json'));
const changelog = read('CHANGELOG.md');
const artifactPath = 'release/save-image-as-type.user.js';
const artifactText = read(artifactPath);
const artifactBytes = readFileSync(resolve(root, artifactPath));
const manifestPath = 'release/release-manifest.json';
const manifest = JSON.parse(read(manifestPath));
const metaVersion = artifactText.match(/^\/\/ @version\s+(\S+)/m)?.[1];
const changelogTop = changelog.match(/^## (\d+\.\d+\.\d+)/m)?.[1];
for (const [label, value] of [['package.json', pkg.version], ['src/meta.js', SCRIPT_VERSION], ['artifact @version', metaVersion], ['CHANGELOG.md', changelogTop], ['release-manifest.json', manifest.version]]) {
  if (value !== SCRIPT_VERSION) fail(`version disagreement: ${label} is ${value}, expected ${SCRIPT_VERSION}`);
}
if (!/^2\.0\.2$/.test(SCRIPT_VERSION)) warn(`version ${SCRIPT_VERSION}: this repository snapshot is a pre-release; see docs/publication-checklist.md`);
ok(`version ${SCRIPT_VERSION} consistent across 5 locations`);

/* 2. artifact validity ---------------------------------------------------- */
const block = artifactText.match(/^\/\/ ==UserScript==\n([\s\S]*?)^\/\/ ==\/UserScript==$/m);
if (!block) fail('artifact has no userscript metadata block');
for (const required of ['@name', '@namespace', '@version', '@description', '@match', '@run-at', '@grant', '@connect', '@license']) {
  if (!new RegExp(`^// ${required}\\s`, 'm').test(block ? block[1] : '')) fail(`artifact metadata is missing ${required}`);
}
// Comments are stripped first: the artifact's own documentation mentions the
// words "import"/"require", which is not the same as shipping module syntax.
const artifactCode = artifactText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
if (/(^|\n)\s*(import|export)\s+[{\w*]/.test(artifactCode) || /\brequire\s*\(/.test(artifactCode)) fail('artifact still contains import/export/require module syntax');
if (/sourceMappingURL|sourceURL=/.test(artifactText)) fail('artifact references a source map or private source path');
for (const marker of ['__SIAT_TEST__', '__audit', 'testHook', 'devProbe']) if (artifactText.includes(marker)) fail(`artifact contains development-only marker ${marker}`);
if (/(api[_-]?key|password|bearer\s+[A-Za-z0-9]|sk-[A-Za-z0-9]{10})/i.test(artifactText)) fail('artifact contains a credential-shaped string');
if (/AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(artifactText)) fail('artifact contains key material');
const sizeLimit = 2 * 1024 * 1024;
if (artifactBytes.length > sizeLimit) fail(`artifact is ${(artifactBytes.length / 1024).toFixed(1)} KiB, over the ${sizeLimit / 1024 / 1024} MB ceiling`);
if (artifactBytes.length < 100 * 1024) fail('artifact looks truncated (under 100 KiB)');
const distHash = createHash('sha256').update(artifactBytes).digest('hex');
ok(`artifact ${(artifactBytes.length / 1024).toFixed(1)} KiB, sha256 ${distHash.slice(0, 16)}…, metadata complete`);

/* 3. permissions ---------------------------------------------------------- */
const grants = [...(block ? block[1] : '').matchAll(/^\/\/ @grant\s+(\S+)/gm)].map((match) => match[1]);
const usedGrants = ['GM_info', 'GM_getValue', 'GM_setValue', 'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_download', 'GM_registerMenuCommand', 'GM_notification'];
if (JSON.stringify(grants) !== JSON.stringify(usedGrants)) fail(`grant set changed: metadata ${grants.join(', ')} vs expected ${usedGrants.join(', ')} — update src/meta.js, docs/privacy-and-permissions.md and this gate together`);
if (JSON.stringify(manifest.grants) !== JSON.stringify(grants)) fail('release manifest grants disagree with the artifact metadata');
if (!/^\/\/ @connect\s+\*$/m.test(block ? block[1] : '')) warn('@connect is no longer the wildcard; update docs/privacy-and-permissions.md');
ok(`${grants.length} grants and @connect * documented and unchanged`);

/* 4. checksums ------------------------------------------------------------ */
const sumsPath = 'release/SHA256SUMS';
if (!existsSync(resolve(root, sumsPath))) fail('release/SHA256SUMS is missing');
else {
  const line = read(sumsPath).trim().split('\n')[0];
  const [hash, name] = line.split(/\s+/);
  if (name !== 'save-image-as-type.user.js') fail(`SHA256SUMS points at ${name}`);
  if (hash !== distHash) fail('release/SHA256SUMS does not match the committed artifact');
  else ok('release/SHA256SUMS matches the artifact');
}
if (manifest.sha256 !== distHash) fail('release-manifest.json sha256 does not match the artifact');
if (manifest.bytes !== artifactBytes.length) fail('release-manifest.json byte count does not match the artifact');
const moduleMarkers = (artifactText.match(/^\/\* ── src\/.*$/gm) || []).length;
if (manifest.build && manifest.build.modules !== moduleMarkers) fail(`release-manifest.json module count (${manifest.build.modules}) disagrees with the artifact's ${moduleMarkers} module sections`);
if (manifest.build && manifest.build.splitLines !== artifactText.split('\n').length) fail('release-manifest.json line count disagrees with the artifact');

/* 5. generated docs ------------------------------------------------------- */
try {
  const output = execFileSync(process.execPath, ['scripts/gen-settings-doc.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  ok(output.trim().split('\n').pop());
} catch (error) {
  fail(`generated settings reference is stale: ${(error.stdout || error.message).trim()}`);
}

/* 6. internal links ------------------------------------------------------- */
const markdownFiles = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'];
const walk = (dir) => readdirSync(resolve(root, dir)).flatMap((entry) => {
  const rel = `${dir}/${entry}`;
  return statSync(resolve(root, rel)).isDirectory() ? walk(rel) : [rel];
});
for (const folder of ['docs', '.github']) if (existsSync(resolve(root, folder))) markdownFiles.push(...walk(folder).filter((file) => extname(file) === '.md'));
let linkCount = 0;
const brokenLinks = [];
for (const file of markdownFiles) {
  const text = read(file);
  const base = dirname(resolve(root, file));
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    linkCount += 1;
    const [pathPart] = target.split('#');
    if (!pathPart) continue;
    const resolved = resolve(base, pathPart);
    if (!existsSync(resolved)) brokenLinks.push(`${file} → ${target}`);
  }
}
if (brokenLinks.length) fail(`broken relative links:\n  ${brokenLinks.join('\n  ')}`);
else ok(`${linkCount} relative documentation links resolve`);

/* 7. user-facing labels documented exactly as the code registers them ------- */
const mainSource = read('src/main.js');
const commands = [...mainSource.matchAll(/registerMenuCommand\(\s*'([^']+)'/g)].map((match) => match[1]);
if (commands.length !== 8) fail(`expected 8 manager commands, found ${commands.length} in src/main.js`);
const advanced = read('docs/advanced-usage.md');
const missingCommands = commands.filter((label) => !advanced.includes(label));
if (missingCommands.length) fail(`docs/advanced-usage.md does not list the registered command(s):\n  ${missingCommands.join('\n  ')}`);
else ok(`${commands.length} manager command labels documented exactly as registered`);
const actionLabels = Object.values(JSON.parse(read('audit/evidence/compatibility-contract.json')).actions).map((entry) => entry.label);
const guide = read('docs/user-guide.md');
const missingActions = actionLabels.filter((label) => !guide.includes(label));
if (missingActions.length) fail(`docs/user-guide.md does not mention the menu action(s): ${missingActions.join(', ')}`);
else ok(`${actionLabels.length} menu action labels documented in the user guide`);

/* 8. metadata ↔ documentation parity -------------------------------------- */
const header = block ? block[1] : '';
const tagValues = (name) => [...header.matchAll(new RegExp(`^// @${name}\\s+(\\S+)$`, 'gm'))].map((m) => m[1]);
const connect = tagValues('connect');
if (JSON.stringify(connect) !== JSON.stringify(['*'])) {
  fail(`artifact must declare exactly "@connect *"; found ${JSON.stringify(connect)}`);
}
const CANONICAL = 'https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js';
for (const key of ['downloadURL', 'updateURL']) {
  if (tagValues(key)[0] !== CANONICAL) fail(`@${key} must equal the canonical artifact URL`);
}
if (tagValues('icon')[0] && !tagValues('icon')[0].startsWith('data:image/svg+xml,')) {
  fail('@icon must be a self-contained data URI (no install-time network request)');
}
if (tagValues('icon64').length) fail('@icon64 must not be declared (duplicate remote icon)');
const banned = [
  [/there is no `?@updateURL`?/i, ['docs/installation.md', 'docs/privacy-and-permissions.md', 'README.md', 'SECURITY.md']],
  [/automatic update channel by design/i, ['docs/installation.md']],
  [/deliberately absent today/i, ['docs/publication-checklist.md']],
  [/webcodecs encoders/i, ['README.md']],
  [/DEFLATE compression/i, ['README.md']],
  [/grayscale, or invert/i, ['README.md']],
  [/`C` to copy/i, ['README.md']],
  [/no update check/i, ['SECURITY.md', 'docs/privacy-and-permissions.md']],
];
for (const [pattern, files] of banned) {
  for (const file of files) {
    if (existsSync(resolve(root, file)) && pattern.test(read(file))) {
      fail(`${file} contains a claim the artifact contradicts: ${pattern}`);
    }
  }
}
for (const [file, needle] of [
  ['README.md', CANONICAL],
  ['docs/installation.md', CANONICAL],
  ['docs/privacy-and-permissions.md', '@connect *'],
]) {
  if (!read(file).includes(needle)) fail(`${file} must contain ${needle}`);
}
ok('artifact metadata, documentation and links agree');

/* 9. no owner placeholders anywhere --------------------------------------- */
const allMarkdown = ['README.md', 'docs/installation.md', 'docs/publication-checklist.md', '.github/ISSUE_TEMPLATE/config.yml']
  .filter((file) => existsSync(resolve(root, file)));
const leftovers = allMarkdown.filter((file) => /<OWNER>|<REPO>|OWNER\/REPO/.test(read(file)));
if (leftovers.length) fail(`unfilled owner placeholders remain in: ${leftovers.join(', ')}`);

/* 10. release manifest is derived-only ------------------------------------ */
for (const key of ['gates', 'status', 'blockers', 'combinedVerification', 'exactProductionChecks']) {
  if (key in manifest) fail(`release-manifest.json must not contain the evidence claim "${key}"`);
}
if (!manifest.evidence || !existsSync(resolve(root, manifest.evidence))) {
  fail('release-manifest.json must point at an existing evidence file');
}

/* summary ----------------------------------------------------------------- */
console.log('');
for (const line of info) console.log(`PASS ${line}`);
for (const line of warnings) console.log(`WARN ${line}`);
if (failures.length) {
  for (const line of failures) console.log(`FAIL ${line}`);
  console.log(`\n${failures.length} release gate(s) failed.`);
  process.exit(1);
}
console.log(`\nAll release gates passed (${warnings.length} warning${warnings.length === 1 ? '' : 's'}; warnings are owner decisions, not defects).`);
