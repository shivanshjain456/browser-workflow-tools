import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import tokenizer from 'js-tokens';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLintChecks } from '../../lint.mjs';
import { META } from '../../src/meta.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

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

const sources = [...walk(join(ROOT, 'src'))].map((file) => ({ file: relative(ROOT, file).replace(/\\/g, '/'), code: readFileSync(file, 'utf8') }));
const DIST = readFileSync(join(ROOT, 'release/save-image-as-type.user.js'), 'utf8');

describe('static security gate (lint.mjs)', () => {
  const results = runLintChecks();

  test('every lint rule passes', () => {
    const failures = results.filter((result) => !result.ok);
    assert.deepEqual(
      failures.map((failure) => `${failure.id}: ${failure.detail}`),
      [],
      'lint failures',
    );
    assert.ok(results.length >= 18, `a meaningful number of rules ran (${results.length})`);
  });

  test('the rule set actually covers the risky constructs', () => {
    const ids = results.map((result) => result.id);
    for (const expected of ['no-eval', 'no-new-function', 'no-innerhtml', 'no-insert-adjacent-html', 'no-document-write', 'no-string-timer', 'no-unsafeWindow', 'no-remote-require', 'no-remote-resource', 'grants-match-usage', 'connect-scope', 'match-scope', 'no-remote-endpoints']) {
      assert.ok(ids.includes(expected), `${expected} is checked`);
    }
  });
});

describe('network access is a single auditable choke point', () => {
  test('only core/gm.js can reach the raw manager XHR API', () => {
    const RAW = /GM_xmlhttpRequest|GM_xmlHttpRequest|GM\.xmlHttpRequest/;
    // meta.js declares the grant; gm.js resolves the binding. Everywhere else
    // the identifier may only appear inside a comment or a user-facing string,
    // never as code that could issue a request.
    const codeUsers = [];
    for (const source of sources) {
      if (source.file === 'src/meta.js') continue;
      const offending = source.code
        .split('\n')
        .map((line, index) => [index + 1, line])
        .filter(([, line]) => RAW.test(line))
        .filter(([, line]) => {
          const trimmed = line.trim();
          const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
          const isString = /['"`][^'"`]*GM_xmlhttpRequest[^'"`]*['"`]/.test(line) || /['"`][^'"`]*GM_xmlHttpRequest[^'"`]*['"`]/.test(line);
          return !(isComment || isString);
        });
      if (offending.length) codeUsers.push(`${source.file}:${offending.map(([n]) => n).join(',')}`);
    }
    const codeUserFiles = [...new Set(codeUsers.map((entry) => entry.split(':')[0]))];
    assert.deepEqual(codeUserFiles, ['src/core/gm.js'], `modules with executable references to the raw API: ${codeUsers.join(' ') || '(none)'}`);

    // The adapter resolves the binding once and only exposes xhrBlob()/downloadBlobUrl().
    const gmSource = sources.find((source) => source.file === 'src/core/gm.js');
    assert.match(gmSource.code, /typeof GM_xmlhttpRequest !== 'undefined'/, 'gm.js feature-detects the classic spelling');
    assert.match(gmSource.code, /'GM_xmlhttpRequest', 'GM_xmlHttpRequest'/, 'gm.js accepts both spellings');
    assert.equal(/\bGM_xmlhttpRequest\s*\(/.test(gmSource.code), false, 'the resolved reference is called, never the global by name');

    const viaAdapter = sources.filter((source) => /\bgm\.xhrBlob\s*\(/.test(source.code)).map((source) => source.file);
    assert.ok(viaAdapter.includes('src/core/source.js'), `image fetching goes through the adapter: ${viaAdapter.join(', ')}`);
    assert.equal(viaAdapter.includes('src/core/gm.js'), false, 'the adapter does not call itself');
    // Every manager-grant name is declared, so nothing is used un-granted.
    const declared = new Set((gmSource.code.match(/'GM_[A-Za-z]+'/g) || []).map((s) => s.replace(/'/g, '')));
    assert.ok(declared.has('GM_xmlhttpRequest') && declared.has('GM_download'), 'grant names are spelled out in the adapter too');
  });

  test('the only fetch() call sites are same-origin, credential-limited reads of the image itself', () => {
    // Comments are stripped first: this rule is about call sites, and prose that
    // mentions "fetch()" is not one.
    const withoutComments = (code) => {
      let cleaned = '';
      for (const match of code.matchAll(new RegExp(tokenizer.default.source, 'g'))) {
        const token = tokenizer.matchToToken(match);
        cleaned += token.type === 'comment' ? token.value.replace(/[^\n]/g, ' ') : token.value;
      }
      return cleaned;
    };
    const lexicalProbe = withoutComments("/* fetch('not-code') */ fetch('/image', { credentials: 'same-origin' });");
    assert.equal([...lexicalProbe.matchAll(/fetch\s*\(/g)].length, 1, 'block-comment prose is not a network site');
    assert.match(lexicalProbe, /credentials:/, 'the real call remains visible');
    const sites = [];
    for (const source of sources) {
      for (const match of withoutComments(source.code).matchAll(/fetch\s*\(([^;]{0,220})/g)) sites.push({ file: source.file, call: match[1] });
    }
    assert.ok(sites.length >= 1, 'fetch is used somewhere');
    for (const site of sites) {
      assert.match(site.call, /credentials:\s*'same-origin'/, `${site.file}: fetch is restricted to same-origin credentials`);
      assert.ok(!/https?:\/\//.test(site.call), `${site.file}: no hardcoded remote endpoint`);
    }
  });

  test('no reachable remote endpoint is baked into the shipped artifact', () => {
    const urls = [...new Set([...DIST.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map((m) => m[0].replace(/[.,;]$/, '')))];
    const metadataLinks = new Set([
      META.namespace,
      META.homepageURL,
      META.supportURL,
      META.downloadURL,
      META.updateURL,
    ].filter(Boolean));
    const inert = new Set([
      'http://www.w3.org/2000/svg', // XML namespace URI: a name, not a location
      'http://www.w3.org/1999/xhtml',
      'https://siat.invalid/', // base argument for `new URL()` so relative image URLs can be parsed
    ]);
    for (const url of urls) {
      assert.ok(metadataLinks.has(url) || inert.has(url), `unexpected URL in artifact: ${url}`);
    }
    // And none of them is ever handed to a network call.
    const networkArgs = [...DIST.matchAll(/(?:fetch|GM_xmlhttpRequest|xhrBlob|downloadBlobUrl)\s*\(([^)]{0,160})/g)].map((m) => m[1]);
    for (const args of networkArgs) assert.ok(!/https?:\/\//.test(args), `hardcoded URL passed to a network call: ${args}`);
  });
});

describe('no page-storage or privilege escalation', () => {
  test('the script never reads or writes page-visible storage', () => {
    for (const pattern of [/\blocalStorage\b/, /\bsessionStorage\b/, /document\.cookie/, /\bindexedDB\b/, /\bunsafeWindow\b/]) {
      for (const source of sources) {
        assert.equal(pattern.test(source.code), false, `${pattern} must not appear in ${source.file}`);
      }
      assert.equal(pattern.test(DIST), false, `${pattern} must not appear in the artifact`);
    }
  });

  test('settings live only in manager storage (namespaced, versioned keys)', () => {
    const settings = sources.find((source) => source.file === 'src/core/settings.js');
    assert.match(settings.code, /SETTINGS_STORAGE_KEYS = \['siat\.settings\.v3'/, 'keys are namespaced and versioned');
    assert.match(settings.code, /'siat\.settings\.v2'/, 'the previous schema key is still read, so an upgrade migrates instead of resetting');
    assert.match(settings.code, /schemaVersion/, 'the schema is versioned');
    assert.match(settings.code, /SETTINGS_SCHEMA_VERSION = 3/, 'the schema version constant matches the storage key');
  });

  test('no postMessage listener (an untrusted-page attack surface) is registered', () => {
    for (const source of sources) {
      assert.equal(/addEventListener\(\s*['"]message['"]/.test(source.code), false, `${source.file} must not listen for page messages`);
    }
  });

  test('production publishes no capability handles or page-writable boot switches', () => {
    const assignments = [...DIST.matchAll(/(?:^|[^\w.$])(?:window|win|globalThis|root)(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=(?!=)/gm)];
    assert.equal(assignments.length, 0, 'no global/root assignments');
    for (const marker of ['__saveImageAsTypeInitialised', '__SIAT_NO_AUTOBOOT', 'data-siat-no-autoboot']) assert.equal(DIST.includes(marker), false, marker);
  });

  test('no credential-shaped strings are embedded', () => {
    assert.equal(/(api[_-]?key|secret|password|bearer\s+[A-Za-z0-9]|sk-[A-Za-z0-9]{10})/i.test(DIST), false, 'no secrets in the artifact');
  });
});

describe('UI isolation and safe rendering', () => {
  test('every UI surface renders into a shadow root', () => {
    // Derived from the tree: a new dialog cannot skip this check by not being
    // listed here. A module either owns its shadow root or builds on dialog.js,
    // which owns one — there is no third option that touches the page DOM.
    const uiModules = sources.filter((entry) => entry.file.startsWith('src/ui/') && entry.file !== 'src/ui/accessibility.js' && entry.file !== 'src/ui/events.js');
    assert.ok(uiModules.length >= 10, `every UI module is checked (${uiModules.length} found)`);
    const owners = [];
    const delegates = [];
    for (const source of uiModules) {
      const owns = /attachShadow\(\{ mode: 'open' \}\)/.test(source.code);
      const usesKit = /createDialog/.test(source.code) && /from '\.\/dialog\.js'/.test(source.code);
      assert.ok(owns || usesKit, `${source.file} renders into a shadow root (its own or dialog.js's)`);
      if (owns) {
        owners.push(source.file);
        assert.match(source.code, /all: initial/, `${source.file} resets inherited page styles`);
        assert.match(source.code, /z-index: 21474836\d\d/, `${source.file} stays above page content`);
      } else {
        delegates.push(source.file);
      }
    }
    // The shared modal primitive and the two always-on surfaces must own theirs.
    for (const file of ['src/ui/dialog.js', 'src/ui/menu.js', 'src/ui/toast.js', 'src/ui/jobbar.js']) {
      assert.ok(owners.includes(file), `${file} creates its own shadow root`);
    }
    assert.ok(delegates.includes('src/ui/panel.js'), 'the settings panel builds on the shared dialog');
  });

  test('untrusted strings (URLs, alt text, file names, notes) reach the DOM only via textContent', () => {
    const textContentUses = sources.filter((source) => source.code.includes('.textContent =')).length;
    assert.ok(textContentUses >= 3, `textContent is the rendering primitive (${textContentUses} modules use it)`);
    for (const source of sources) {
      assert.equal(/\.innerHTML\s*=/.test(source.code), false, `${source.file} has no innerHTML sink`);
      assert.equal(/\.outerHTML\s*=/.test(source.code), false, `${source.file} has no outerHTML sink`);
      assert.equal(/insertAdjacentHTML/.test(source.code), false, `${source.file} has no insertAdjacentHTML sink`);
      assert.equal(/document\.write/.test(source.code), false, `${source.file} does not write to the document`);
    }
  });

  test('SVG icons are built with createElementNS, never parsed from a string', () => {
    const toast = sources.find((source) => source.file === 'src/ui/toast.js');
    assert.match(toast.code, /createElementNS\(SVG_NS/, 'icons use DOM construction');
  });

  test('the context menu and dialog expose ARIA semantics and keyboard handling', () => {
    const menu = sources.find((source) => source.file === 'src/ui/menu.js');
    for (const token of ["role', 'menu'", "'menuitem'", 'aria-label', 'aria-disabled', "'Escape'", "'ArrowDown'", "'ArrowUp'", "'Home'", "'End'", "'Tab'"]) {
      assert.ok(menu.code.includes(token), `menu.js handles ${token}`);
    }
    // The modal semantics live in the shared primitive every dialog is built on,
    // so that is where they are asserted — once, for all eight dialogs.
    const dialog = sources.find((source) => source.file === 'src/ui/dialog.js');
    for (const token of ["'dialog'", "'true'", 'aria-labelledby', 'aria-describedby', "'Escape'", "'Tab'", 'fieldset', 'legend']) {
      assert.ok(dialog.code.includes(token), `dialog.js includes ${token}`);
    }
    const panel = sources.find((source) => source.file === 'src/ui/panel.js');
    for (const token of ['fieldset', 'legend', 'titleId']) {
      assert.ok(panel.code.includes(token), `panel.js includes ${token}`);
    }
    // Every dialog passes a title id, so aria-labelledby always resolves.
    const dialogUsers = sources.filter(
      (entry) => entry.file.startsWith('src/ui/') && entry.file !== 'src/ui/accessibility.js' && entry.file !== 'src/ui/events.js' && entry.file !== 'src/ui/dialog.js' && /createDialog\(/.test(entry.code),
    );
    assert.equal(dialogUsers.length, 7, `seven dialogs are built on the kit (${dialogUsers.length} found)`);
    for (const source of dialogUsers) {
      assert.match(source.code, /titleId: 'siat-[a-z-]+-title'/, `${source.file} labels its dialog`);
    }
  });

  test('user-visible styles adapt to dark mode, narrow screens and reduced motion', () => {
    const combined = sources.filter((source) => source.file.startsWith('src/ui/') && source.file !== 'src/ui/accessibility.js' && source.file !== 'src/ui/events.js').map((source) => source.code).join('\n');
    assert.match(combined, /prefers-color-scheme: dark/);
    assert.match(combined, /@media \(max-width:/);
    assert.match(combined, /prefers-reduced-motion: reduce/);
    assert.match(combined, /:focus-visible/);
  });
});

describe('lifecycle hygiene', () => {
  test('timers, listeners and object URLs are cleaned up', () => {
    const combined = sources.map((source) => source.code).join('\n');
    assert.match(combined, /revokeObjectURL/, 'object URLs are revoked');
    assert.match(combined, /revokeAllPending/, 'pending revocations are flushed on unload');
    assert.match(combined, /removeEventListener/, 'listeners are removable');
    assert.match(combined, /clearTimeout/, 'timers are cleared');
    assert.match(combined, /pagehide/, 'the script reacts to page teardown');
    assert.match(combined, /AbortController/, 'in-flight work is cancellable');
  });

  test('same-module initialisation owns its private registry before starting work', () => {
    const main = sources.find((source) => source.file === 'src/main.js').code;
    assert.match(main, /const bootstrapInstances = new WeakMap/);
    const guard = main.indexOf('const existing = bootstrapInstances.get(doc)');
    const register = main.indexOf('bootstrapInstances.set(doc, api)');
    const manager = main.indexOf('const gm = options.gm');
    assert.ok(guard < register && register < manager);
    assert.match(main, /bootstrapInstances.delete\(doc\)/);
  });

  test('startup contains the awaited promise and catches reporter errors', () => {
    const main = sources.find((source) => source.file === 'src/main.js').code;
    assert.match(main, /return await start\(\)/);
    assert.match(main, /try \{ report\(error\); \} catch/);
    assert.match(DIST, /startProduction\(\);/);
  });
});
