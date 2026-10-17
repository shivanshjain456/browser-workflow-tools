import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { bundle } from '../../build.mjs';
import { META, renderMetadata, SCRIPT_VERSION } from '../../src/meta.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'release/save-image-as-type.user.js');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Parse a userscript metadata block the way a manager does. */
function parseMetadata(source) {
  const lines = source.split('\n');
  assert.equal(lines[0].trim(), '// SPDX-License-Identifier: MIT', 'the file starts with SPDX identifier');
  assert.equal(lines[1].trim(), '// ==UserScript==', 'the file contains the metadata block');
  const end = lines.findIndex((line) => line.trim() === '// ==/UserScript==');
  assert.ok(end > 0, 'the metadata block is closed');
  const fields = {};
  for (const line of lines.slice(2, end)) {
    const match = /^\/\/\s*@(\S+)\s*(.*)$/.exec(line.trim());
    assert.ok(match, `every line inside the block is a directive: "${line}"`);
    const key = match[1];
    const value = match[2].trim();
    if (!(key in fields)) fields[key] = [];
    fields[key].push(value);
  }
  return fields;
}

describe('metadata block', () => {
  const fields = parseMetadata(renderMetadata());

  test('declares the identity fields a manager requires', () => {
    assert.equal(fields.name[0], 'Save Image as Type');
    assert.match(fields.namespace[0], /^https?:\/\//, 'namespace is a stable URL-shaped identifier');
    assert.match(fields.version[0], /^\d+\.\d+\.\d+$/, 'semver version');
    assert.equal(fields.version[0], SCRIPT_VERSION);
    assert.equal(fields.version[0], PACKAGE.version, 'metadata version matches package.json');
    assert.ok(fields.description[0].length > 40, 'description explains what the script does');
    assert.ok(fields.description[0].length < 300, 'description fits a manager listing');
    assert.equal(fields.license[0], 'MIT');
    assert.equal(fields.author[0], 'Shivansh Jain');
  });

  test('runs at document-start and inside frames, deliberately', () => {
    assert.deepEqual(fields['run-at'], ['document-start'], 'the contextmenu listener must exist before the first right-click');
    assert.equal('noframes' in fields, false, 'frames are allowed: right-clicking an image inside an iframe must work');
  });

  test('match scope is http/https everywhere and nothing privileged', () => {
    assert.deepEqual(fields.match, ['*://*/*']);
    for (const pattern of fields.match) {
      assert.ok(!/^file:/i.test(pattern), 'no file:// (managers require an explicit user opt-in for that)');
      assert.ok(!/^(chrome|about|moz-extension|chrome-extension|edge|devtools):/i.test(pattern), 'no privileged schemes');
    }
    assert.equal('exclude' in fields, false, 'no exclusions needed');
    assert.equal('include' in fields, false, '@include is not mixed with @match');
  });

  test('grants are explicit and each one is justified in src/meta.js', () => {
    const grants = fields.grant;
    assert.deepEqual(grants, META.grant);
    assert.equal(grants.includes('none'), false);
    assert.equal(grants.includes('unsafeWindow'), false, 'no page-world access is needed');
    assert.equal(grants.includes('GM_addStyle'), false, 'styles live in a shadow root, so no grant is needed');
    for (const grant of grants) {
      assert.match(grant, /^GM_[A-Za-z]+$/, `classic GM_* spelling for maximum manager compatibility: ${grant}`);
    }
    // Each grant must have a written justification next to it in the source.
    const metaSource = readFileSync(join(ROOT, 'src/meta.js'), 'utf8');
    for (const grant of grants) {
      const index = metaSource.indexOf(`'${grant}'`);
      assert.ok(index > 0, `${grant} declared in src/meta.js`);
      const rest = metaSource.slice(index, index + 200);
      assert.match(rest, /\/\/|\/\*/, `${grant} carries an inline justification comment`);
    }
  });

  test('no remote code or untracked resources are pulled in', () => {
    assert.equal('require' in fields, false, 'no @require: an unpinned remote script would run with our permissions');
    assert.equal('resource' in fields, false, 'no @resource');
    assert.ok(fields.updateURL[0].startsWith('https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js'));
    assert.ok(fields.downloadURL[0].startsWith('https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/save-image-as-type/release/save-image-as-type.user.js'));
  });

  test('@connect is the documented wildcard and is explained at the declaration', () => {
    assert.deepEqual(fields.connect, ['*']);
    const metaSource = readFileSync(join(ROOT, 'src/meta.js'), 'utf8');
    const index = metaSource.indexOf('connect: [');
    const before = metaSource.slice(Math.max(0, index - 700), index);
    assert.match(before, /CDN|cross-origin|CORS/i, 'the wildcard is justified where it is declared');
    assert.match(before, /allowCrossOriginFetch/, 'and the user-facing kill switch is named');
  });

  test('the icon is a self-contained data URI (no network fetch)', () => {
    assert.equal(fields.icon.length, 1);
    assert.match(fields.icon[0], /^data:image\/svg\+xml,/);
    // The only URL-shaped text allowed inside the payload is the SVG namespace
    // URI, which is a name and is never fetched; anything else would mean the
    // icon depends on the network.
    const payload = fields.icon[0].replace(/^data:[^,]*,/, '');
    const inside = [...payload.matchAll(/https?%3A%2F%2F[^%'"]*|https?:\/\/[^\s'"]*/gi)].map((m) => decodeURIComponent(m[0]));
    assert.deepEqual(inside, ['http://www.w3.org/2000/svg'], `icon payload references only the SVG namespace: ${inside.join(', ')}`);
    assert.equal(/%3Cscript|onerror|javascript:/i.test(payload), false, 'no executable content in the icon');
    assert.ok(fields.icon[0].length < 1200, 'icon stays small');
  });
});

describe('build and artifact integrity', () => {
  const built = bundle();

  test('the artifact exists and starts with the rendered metadata block', () => {
    assert.ok(existsSync(DIST), 'release/save-image-as-type.user.js exists');
    const dist = readFileSync(DIST, 'utf8');
    assert.ok(dist.startsWith(renderMetadata()), 'dist header is byte-identical to renderMetadata()');
    assert.equal(dist, built.source, 'the artifact is in sync with a fresh bundle of src/');
  });

  test('bundling is reproducible and includes every module', () => {
    const again = bundle();
    assert.equal(again.source, built.source, 'two builds produce identical bytes');

    // Derived from the tree, not hardcoded: a module that exists in src/ but is
    // unreachable from main.js is unintegrated code, which this project forbids.
    const sourceModules = [];
    const walkSrc = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walkSrc(full);
        else if (entry.endsWith('.js')) sourceModules.push(full);
      }
    };
    walkSrc(join(ROOT, 'src'));
    // src/meta.js is the only module that is not part of the runtime graph: it
    // describes the userscript header and is consumed by build.mjs (and asserted
    // directly in this file), so it is intentionally absent from the bundle.
    const buildTimeOnly = sourceModules.filter((file) => file.replace(/\\/g, '/').endsWith('src/meta.js'));
    assert.equal(buildTimeOnly.length, 1, 'exactly one build-time-only module (src/meta.js)');
    const runtimeModules = sourceModules.filter((file) => !buildTimeOnly.includes(file));
    const missing = runtimeModules.filter((file) => !built.modules.includes(file));
    assert.deepEqual(missing.map((file) => relative(ROOT, file).replace(/\\/g, '/')), [], 'every src/ module is reachable from main.js');
    assert.equal(built.modules.length, runtimeModules.length, 'the bundle contains exactly the runtime modules in src/');
    for (const file of built.modules) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      assert.ok(built.source.includes(`── ${rel} `), `module marker for ${rel} present in the artifact`);
    }
    for (const expected of ['src/main.js', 'src/core/gm.js', 'src/core/settings.js', 'src/core/source.js', 'src/core/convert.js', 'src/core/download.js', 'src/encoders/bmp.js', 'src/encoders/gif.js', 'src/encoders/pdf.js', 'src/ui/menu.js', 'src/ui/panel.js', 'src/ui/toast.js']) {
      assert.ok(built.modules.some((m) => m.replace(/\\/g, '/').endsWith(expected)), `${expected} is in the graph`);
    }
  });

  test('the artifact is one self-contained strict-mode IIFE', () => {
    const dist = readFileSync(DIST, 'utf8');
    assert.match(dist, /\n\(function \(\) \{\n'use strict';\n/);
    assert.ok(dist.trimEnd().endsWith('})();'), 'the IIFE is closed');
    assert.equal(dist.includes('__SIAT_BUILD_VERSION__'), false, 'version placeholder was replaced');
    assert.match(dist, new RegExp(`SCRIPT_VERSION_REPORTED = '${SCRIPT_VERSION}'`), 'version stamped from src/meta.js');
    assert.equal(/^\s*(import|export)\s/m.test(dist.replace(/^\/\/.*$/gm, '')), false, 'no ESM syntax survives bundling');
    assert.equal(/\brequire\s*\(/.test(dist), false, 'no CommonJS require');
  });

  test('the artifact parses as JavaScript and stays a sane size', () => {
    const check = spawnSync(process.execPath, ['--check', DIST], { encoding: 'utf8' });
    assert.equal(check.status, 0, `node --check: ${check.stderr}`);
    const bytes = Buffer.byteLength(readFileSync(DIST, 'utf8'));
    assert.ok(bytes > 40 * 1024, `artifact is not suspiciously small (${bytes} bytes)`);
    // v1.0.0 was 214.9 KB with 16 modules; v2.0.0 adds ten feature sets (batch
    // queue, page inventory, ZIP, transforms, clipboard, templates, presets,
    // comparison, metadata, keyboard) plus a shared dialog kit: 35 modules.
    // The ceiling exists to catch runaway bundling (an embedded fixture or a
    // library), not to cap legitimate feature growth.
    assert.ok(bytes < 700 * 1024, `artifact stays lightweight (${(bytes / 1024).toFixed(1)} KB)`);
  });

  test('build --check passes for the committed artifact', () => {
    const result = spawnSync(process.execPath, ['build.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, `build --check: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /in sync/);
  });

  test('the bundler refuses a name collision instead of emitting broken code', () => {
    // Verified directly: HOST_ID used to exist in three UI modules and produced
    // "Identifier 'HOST_ID' has already been declared" in the artifact.
    const dist = readFileSync(DIST, 'utf8');
    const names = ['HOST_ID', 'STYLE', 'ascii(', 'safeHost'];
    for (const name of names) {
      const declarations = dist.match(new RegExp(`^(?:const|let|var|function) ${name.replace('(', '\\(')}`, 'gm')) || [];
      assert.ok(declarations.length <= 1, `"${name}" is declared at most once in the artifact (found ${declarations.length})`);
    }
  });
});
