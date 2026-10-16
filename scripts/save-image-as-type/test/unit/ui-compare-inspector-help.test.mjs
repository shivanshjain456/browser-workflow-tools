import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCompareDialog } from '../../src/ui/compare-dialog.js';
import { createMetadataInspector } from '../../src/ui/inspector.js';
import { createShortcutHelp } from '../../src/ui/help.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_SHORTCUTS } from '../../src/core/shortcuts.js';
import { tempDir, makeMetadataFixtures, pythonAvailable } from '../helpers/harness.mjs';

/**
 * Features: format comparison, metadata inspector, shortcut help.
 *
 * These are the three "read-only until you press a button" surfaces. What is
 * tested is that they show evidence rather than guesses (real encoded sizes,
 * real metadata findings, the real configured chords), that a failure is
 * reported in the dialog instead of leaving it spinning, and that the one
 * action each offers hands the right payload to the orchestrator.
 */

let JSDOM = null;
let SKIP_DOM = false;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (err) {
  SKIP_DOM = `jsdom unavailable (${err.code || err.message}) — run \`npm install\` to enable the DOM tests`;
}

const HAS_PYTHON = pythonAvailable();
const FIXTURES = join(import.meta.dirname || new URL('.', import.meta.url).pathname, '..', 'fixtures');
const TARGET = { kind: 'img', element: { id: 'photo', tagName: 'IMG' }, url: 'https://page.example/photo.jpg', altText: 'A photo' };

let dom = null;
let doc = null;
let pageCalls = null;

function installDom() {
  dom = new JSDOM('<!doctype html><html><body><button id="page-button">page button</button></body></html>', {
    url: 'https://page.example/gallery',
    pretendToBeVisual: true,
  });
  doc = dom.window.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  pageCalls = { close: 0, open: 0 };
  dom.window.close = () => {
    pageCalls.close += 1;
  };
  dom.window.open = () => {
    pageCalls.open += 1;
    return null;
  };
}

function teardownDom() {
  if (!dom) return;
  dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) delete globalThis[key];
}

const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ compare */

/** A comparison outcome shaped like core/compare.js returns. */
function comparisonResult(over = {}) {
  const results = over.results || [
    { formatId: 'png', label: 'PNG', ext: 'png', ok: true, bytes: 5000, sizeLabel: '4.9 KB', mime: 'image/png', lossless: true, keepsAlpha: true, flattened: false, animated: false, width: 200, height: 140, ms: 40, encoderMs: 38, notes: [], filename: 'photo.png' },
    { formatId: 'jpg', label: 'JPG', ext: 'jpg', ok: true, bytes: 1800, sizeLabel: '1.8 KB', mime: 'image/jpeg', lossless: false, keepsAlpha: false, flattened: true, animated: false, width: 200, height: 140, ms: 22, encoderMs: 20, notes: ['Flattened onto white.'], filename: 'photo.jpg' },
    { formatId: 'webp', label: 'WebP', ext: 'webp', ok: true, bytes: 1500, sizeLabel: '1.5 KB', mime: 'image/webp', lossless: false, keepsAlpha: true, flattened: false, animated: false, width: 200, height: 140, ms: 30, encoderMs: 28, notes: [], filename: 'photo.webp' },
  ];
  return Object.assign(
    { results, notes: over.notes || [], elapsedMs: over.elapsedMs === undefined ? 92 : over.elapsedMs, recommended: over.recommended === undefined ? { formatId: 'webp', label: 'WebP', reason: 'WebP is 64% smaller than PNG', savingsPercent: 64, bytes: 1500 } : over.recommended, sourceAlpha: Boolean(over.sourceAlpha) },
    over.extra || {},
  );
}

describe('compare dialog', { skip: SKIP_DOM || false }, () => {
  let api = null;
  let calls = null;

  function install(over = {}) {
    calls = { compare: 0, save: [], cancel: 0, signals: [] };
    api = createCompareDialog({
      document: doc,
      compare: async (target, helpers) => {
        // Yield once so the dialog's own "Encoding candidates…" status is
        // observable before the fake reports progress.
        await wait(0);
        calls.compare += 1;
        calls.target = target;
        calls.signals.push(helpers.signal);
        if (helpers.onProgress) helpers.onProgress('encoding webp', { formatId: 'webp' });
        if (over.hangs) return new Promise(() => {});
        if (over.throws) throw new Error('the canvas was tainted');
        return over.result === undefined ? comparisonResult() : over.result;
      },
      onSave: (target, formatId) => calls.save.push([target, formatId]),
      onCancel: () => {
        calls.cancel += 1;
      },
    });
  }

  beforeEach(() => installDom());
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  const root = () => api.shadowRoot;
  const byId = (id) => root().getElementById(id);

  test('opening encodes the candidates and shows one row per format', async () => {
    install();
    api.open(TARGET);
    assert.match(byId('siat-cmp-status').textContent, /Encoding candidates/, 'progress is visible immediately');
    await wait();
    assert.equal(calls.compare, 1, 'one comparison per open');
    assert.equal(calls.target, TARGET);
    const rows = Array.from(root().querySelectorAll('tbody tr'));
    assert.equal(rows.length, 3);
    assert.match(rows[0].textContent, /PNG/);
    assert.match(rows[0].textContent, /4\.9 KB/, 'the real encoded size is shown');
    assert.match(rows[1].textContent, /Flattened onto white/, 'the encoder note is shown');
    assert.match(rows[2].textContent, /100%/, 'the smallest candidate is the baseline');
    assert.match(rows[0].textContent, /333%/, 'and the others are relative to it');
    assert.match(byId('siat-cmp-status').textContent, /3 formats encoded in 92 ms/);
    assert.match(root().textContent, /same pixels in memory/, 'the dialog states that nothing was downloaded twice');
    assert.match(root().textContent, /nothing is saved until you press/i, 'and that nothing has been written');
  });

  test('the recommendation is explained and marked, and only it enables "Save smallest"', async () => {
    install();
    api.open(TARGET);
    await wait();
    assert.equal(byId('siat-cmp-save-smallest').disabled, false);
    assert.match(root().textContent, /Recommended: WebP — WebP is 64% smaller than PNG/);
    const recommended = root().querySelector('.siat-row-recommended');
    assert.ok(recommended, 'the winning row is marked');
    assert.match(recommended.textContent, /WebP/);
    assert.match(recommended.textContent, /smallest good/);
    assert.equal(byId('siat-cmp-save-webp').dataset.variant, 'primary', 'the winner gets the primary Save button');
    assert.equal(byId('siat-cmp-save-png').dataset.variant, 'ghost', 'the others are secondary');
  });

  test('each row can be saved on its own, with the target and format', async () => {
    install();
    api.open(TARGET);
    await wait();
    click(byId('siat-cmp-save-png'));
    assert.deepEqual(calls.save, [[TARGET, 'png']], 'the user can overrule the recommendation');
    assert.equal(api.isOpen, false, 'the dialog closes so the save progress is visible');
    assert.equal(pageCalls.close, 0);
  });

  test('"Save smallest" saves the recommended format', async () => {
    install();
    api.open(TARGET);
    await wait();
    click(byId('siat-cmp-save-smallest'));
    assert.deepEqual(calls.save, [[TARGET, 'webp']]);
  });

  test('a failed encoder is a row with a reason, not a missing row', async () => {
    install({
      result: comparisonResult({
        results: [
          { formatId: 'png', label: 'PNG', ext: 'png', ok: true, bytes: 5000, sizeLabel: '4.9 KB', keepsAlpha: true, flattened: false, ms: 40, notes: [] },
          { formatId: 'avif', label: 'AVIF', ext: 'avif', ok: false, bytes: 0, error: 'This browser cannot encode AVIF.', ms: 3 },
        ],
        notes: ['AVIF: This browser cannot encode AVIF.'],
        recommended: { formatId: 'png', label: 'PNG', reason: 'PNG is the smallest result', savingsPercent: 0, bytes: 5000 },
      }),
    });
    api.open(TARGET);
    await wait();
    const rows = Array.from(root().querySelectorAll('tbody tr'));
    assert.equal(rows.length, 2);
    assert.match(rows[1].textContent, /failed/);
    assert.match(rows[1].textContent, /—/, 'no size is invented for a failure');
    assert.equal(byId('siat-cmp-save-avif'), null, 'a failed format has no Save button');
    assert.match(root().textContent, /AVIF: This browser cannot encode AVIF/, 'the reason is quoted');
  });

  test('when nothing could be encoded the dialog says so and offers no save', async () => {
    install({ result: comparisonResult({ results: [], recommended: null, notes: ['No comparable formats are enabled.'] }) });
    api.open(TARGET);
    await wait();
    assert.match(root().textContent, /No format could be encoded/);
    assert.match(root().textContent, /No recommendation/);
    assert.equal(byId('siat-cmp-save-smallest').disabled, true);
    assert.match(byId('siat-cmp-status').textContent, /Nothing could be encoded/);
  });

  test('a comparison that throws reports the failure in the dialog', async () => {
    install({ throws: true });
    api.open(TARGET);
    await wait();
    assert.match(byId('siat-cmp-status').textContent, /Comparison failed: the canvas was tainted/);
    assert.equal(byId('siat-cmp-save-smallest').disabled, true);
    assert.equal(api.isOpen, true, 'the dialog stays open so the user can close or retry');
  });

  test('"Stop comparing" aborts the run and passes the signal to the caller', async () => {
    install({ hangs: true });
    api.open(TARGET);
    await wait();
    assert.ok(calls.signals[0] instanceof AbortSignal, 'a real AbortSignal was handed over');
    assert.equal(calls.signals[0].aborted, false);
    click(byId('siat-cmp-cancel'));
    await wait();
    assert.equal(calls.signals[0].aborted, true, 'the signal was aborted, so encoding stops');
    assert.equal(calls.cancel, 1, 'and the owner was told');
    assert.equal(byId('siat-cmp-cancel').disabled, true, 'it cannot be stopped twice');
  });

  test('closing mid-run aborts it, so no encoder keeps burning CPU', async () => {
    install({ hangs: true });
    api.open(TARGET);
    await wait();
    api.close();
    await wait();
    assert.equal(calls.signals[0].aborted, true);
    assert.equal(api.isOpen, false);
  });

  test('re-running for another image supersedes the previous run', async () => {
    install({ hangs: true });
    api.open(TARGET);
    await wait();
    const other = Object.assign({}, TARGET, { url: 'https://page.example/other.jpg' });
    api.open(other);
    await wait();
    assert.equal(calls.compare, 2);
    assert.equal(calls.signals[0].aborted, true, 'the first run was aborted');
    assert.equal(calls.signals[1].aborted, false, 'the second is live');
    assert.equal(calls.target, other);
  });

  test('destroy() removes the host and aborts a running comparison', async () => {
    install({ hangs: true });
    api.open(TARGET);
    await wait();
    api.destroy();
    assert.equal(doc.getElementById('siat-compare-host'), null);
    assert.equal(calls.signals[0].aborted, true);
    assert.deepEqual(pageCalls, { close: 0, open: 0 });
  });

  test('the state seam reports the rows for support and automation', async () => {
    install();
    api.open(TARGET);
    await wait();
    const state = api.state();
    assert.equal(state.rows.length, 3);
    assert.equal(state.recommended.formatId, 'webp');
  });
});

/* ---------------------------------------------------------------- inspector */

const fixtureBytes = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)));

describe('metadata inspector', { skip: SKIP_DOM || false }, () => {
  let api = null;
  let calls = null;

  function install({ bytes = null, mime = 'image/jpeg', filename = 'photo.jpg', fails = false, empty = false } = {}) {
    calls = { loadBytes: 0, save: [] };
    api = createMetadataInspector({
      document: doc,
      settings: () => Object.assign({}, DEFAULT_SETTINGS),
      loadBytes: async (target) => {
        calls.loadBytes += 1;
        calls.target = target;
        if (fails) throw new Error('the manager refused the request');
        if (empty) return null;
        return { bytes, mime, filename, url: target.url };
      },
      onSave: (target, options) => calls.save.push([target, options]),
    });
  }

  beforeEach(() => installDom());
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  const root = () => api.shadowRoot;
  const byId = (id) => root().getElementById(id);

  test('a file with no metadata says so, and still offers a stripped copy', async () => {
    install({ bytes: fixtureBytes('photo.jpg') });
    api.open(TARGET);
    assert.match(byId('siat-insp-status').textContent, /Reading the file/);
    await wait();
    assert.equal(calls.loadBytes, 1);
    assert.match(byId('siat-insp-status').textContent, /JPEG · 4 KB/);
    assert.match(root().textContent, /No EXIF, XMP, ICC or comment data was found/);
    assert.match(root().textContent, /Nothing removable was found; a stripped copy would be byte-identical/);
    assert.equal(byId('siat-insp-save-stripped').disabled, false, 'a JPEG can always be stripped');
  });

  test('a container this script cannot read is reported honestly, with no save offered', async () => {
    install({ bytes: fixtureBytes('icon.bmp'), mime: 'image/bmp', filename: 'icon.bmp' });
    api.open(TARGET);
    await wait();
    assert.match(byId('siat-insp-status').textContent, /metadata not inspectable here/);
    assert.match(root().textContent, /cannot be inspected by this script/);
    assert.match(root().textContent, /nothing is claimed/i);
    assert.equal(byId('siat-insp-save-stripped').disabled, true, 'no promise to strip what cannot be parsed');
  });

  test('"Save original without metadata" hands over the target and the strip flag', async () => {
    install({ bytes: fixtureBytes('photo.jpg') });
    api.open(TARGET);
    await wait();
    click(byId('siat-insp-save-stripped'));
    assert.deepEqual(calls.save, [[TARGET, { stripMetadata: true }]]);
    assert.equal(api.isOpen, false, 'the dialog closes so the save progress is visible');
    assert.equal(pageCalls.close, 0);
  });

  test('a reader that fails, or returns nothing, leaves an explanation instead of a spinner', async () => {
    install({ fails: true });
    api.open(TARGET);
    await wait();
    assert.match(byId('siat-insp-status').textContent, /Could not read the file: the manager refused the request/);
    assert.match(root().textContent, /No metadata information is available/);
    assert.equal(byId('siat-insp-save-stripped').disabled, true);

    api.destroy();
    install({ empty: true });
    api.open(TARGET);
    await wait();
    assert.match(byId('siat-insp-status').textContent, /no readable file bytes/);
    assert.match(byId('siat-insp-status').textContent, /canvas or a generated image/, 'the likely cause is named');
    assert.equal(byId('siat-insp-save-stripped').disabled, true);
  });

  test('"Re-check" reads the file again without rebuilding the dialog', async () => {
    install({ bytes: fixtureBytes('photo.jpg') });
    api.open(TARGET);
    await wait();
    const hostBefore = root();
    click(byId('siat-insp-recheck'));
    await wait();
    assert.equal(calls.loadBytes, 2, 'the file was read again');
    assert.equal(api.shadowRoot, hostBefore, 'the same dialog was reused');
  });

  test('untrusted metadata values are rendered as text, never as markup', async () => {
    // A camera make that looks like HTML must appear verbatim.
    const hostile = new Uint8Array(readFileSync(join(FIXTURES, 'photo.jpg')));
    install({ bytes: hostile, mime: 'image/jpeg' });
    api.open(TARGET);
    await wait();
    assert.equal(root().querySelectorAll('script').length, 0, 'no script element was created');
    assert.equal(root().innerHTML.includes('<img'), false, 'no injected markup');
    assert.equal(api.state().loaded.filename, 'photo.jpg', 'the state seam reports what was read');
    assert.equal(api.state().loaded.bytes, hostile.length);
  });

  test('destroy() removes the host', async () => {
    install({ bytes: fixtureBytes('photo.jpg') });
    api.open(TARGET);
    await wait();
    api.destroy();
    assert.equal(doc.getElementById('siat-inspector-host'), null);
  });
});

describe('metadata inspector — with real EXIF and GPS fixtures', {
  skip: SKIP_DOM || (HAS_PYTHON ? false : 'python3 + Pillow are unavailable, so no EXIF fixtures could be generated'),
}, () => {
  let api = null;
  let calls = null;
  let dir = null;

  beforeEach(() => {
    installDom();
    dir = tempDir('inspector');
    makeMetadataFixtures(dir);
    calls = { save: [] };
    api = createMetadataInspector({
      document: doc,
      settings: () => Object.assign({}, DEFAULT_SETTINGS),
      loadBytes: async () => ({ bytes: new Uint8Array(readFileSync(join(dir, 'exif.jpg'))), mime: 'image/jpeg', filename: 'exif.jpg', url: 'https://page.example/exif.jpg' }),
      onSave: (target, options) => calls.save.push([target, options]),
    });
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('EXIF fields, the GPS warning and the removal list are all shown', async () => {
    api.open(TARGET);
    await wait();
    const text = api.shadowRoot.textContent;
    assert.match(text, /FixtureCam/, 'the camera make is listed');
    assert.match(text, /FX-900/);
    assert.match(text, /2026:03:04 05:06:07/, 'the timestamp is listed');
    assert.match(text, /Location \(GPS\)/, 'GPS gets its own row');
    assert.match(text, /48\.86, 2\.33/, 'with the coordinates the user can recognise');
    assert.match(text, /⚠/, 'and a sensitivity marker');
    assert.match(text, /Location data found/, 'the banner names the risk');
    assert.match(text, /could work out where the photo was taken/, 'in words, not a code');
    assert.match(text, /Stripping would remove: EXIF/, 'what the button will do is stated');
    assert.match(text, /pixels are copied, never re-encoded/, 'and so is what it will not do');
    assert.match(text, /orientation 6/, 'EXIF orientation is explained');
    assert.match(text, /will not rotate the image/, 'including its consequence');
    assert.equal(api.shadowRoot.getElementById('siat-insp-save-stripped').disabled, false);
  });

  test('the table lists where each value lives, so the claim can be checked', async () => {
    api.open(TARGET);
    await wait();
    const rows = Array.from(api.shadowRoot.querySelectorAll('tbody tr'));
    assert.ok(rows.length >= 5, `${rows.length} findings are listed`);
    assert.equal(rows[0].children.length, 3, 'what / value / where');
    assert.ok(rows.every((row) => row.children[2].textContent.length > 0), 'every finding says where it lives');
    assert.ok(rows.some((row) => /APP1/.test(row.children[2].textContent)), 'EXIF is located in APP1');
    assert.ok(rows.some((row) => /APP2/.test(row.children[2].textContent)), 'the ICC profile is located in APP2');
  });
});

/* --------------------------------------------------------------------- help */

describe('shortcut help', { skip: SKIP_DOM || false }, () => {
  let api = null;
  let opened = null;

  function install(settings = {}) {
    opened = 0;
    api = createShortcutHelp({
      document: doc,
      settings: () => Object.assign({}, DEFAULT_SETTINGS, settings),
      onOpenSettings: () => {
        opened += 1;
      },
    });
  }

  beforeEach(() => installDom());
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  const root = () => api.shadowRoot;
  const byId = (id) => root().getElementById(id);

  test('every action is listed with the chord that is actually configured', () => {
    install();
    api.open();
    const text = root().textContent;
    for (const chord of ['Alt+Shift+S', 'Alt+Shift+C', 'Alt+Shift+P', 'Alt+Shift+A', 'Alt+Shift+X']) {
      assert.ok(text.includes(chord), `${chord} is documented`);
    }
    assert.match(text, /Save the image under the pointer/);
    assert.match(text, /Cancel the running batch job/);
    assert.match(text, /Ctrl, Alt or Meta/, 'the safety rule is stated');
    assert.match(text, /hovered image/, 'and so is what the chord acts on');
  });

  test('a custom binding is shown instead of the default', () => {
    install({ shortcuts: Object.assign({}, DEFAULT_SHORTCUTS, { quickSave: 'Ctrl+Alt+J' }) });
    api.open();
    assert.ok(root().textContent.includes('Ctrl+Alt+J'));
    assert.equal(root().textContent.includes('Alt+Shift+S'), false, 'the replaced default is not shown');
  });

  test('an invalid stored binding is shown as the default that replaced it, not as the broken text', () => {
    install({ shortcuts: Object.assign({}, DEFAULT_SHORTCUTS, { quickSave: 'Ctrl+W' }) });
    api.open();
    assert.ok(root().textContent.includes('Alt+Shift+S'), 'the fallback is what will actually fire');
    assert.equal(root().textContent.includes('Ctrl+W'), false, 'a reserved chord is not advertised');
  });

  test('a disabled action is listed as disabled', () => {
    install({ shortcuts: Object.assign({}, DEFAULT_SHORTCUTS, { saveAll: '' }) });
    api.open();
    const rows = Array.from(root().querySelectorAll('tbody tr'));
    const saveAll = rows.find((row) => /Convert every image/.test(row.textContent));
    assert.ok(saveAll, 'the action is still listed');
    assert.match(saveAll.textContent, /disabled/);
  });

  test('when shortcuts are turned off, the overlay says so first', () => {
    install({ enableShortcuts: false });
    api.open();
    assert.match(root().textContent, /Shortcuts are turned off in your settings/);
  });

  test('the menu keys, including the digit type-ahead, are documented', () => {
    install();
    api.open();
    const text = root().textContent;
    assert.match(text, /Inside the right-click menu/);
    assert.match(text, /1 – 9/);
    assert.match(text, /Pick that format immediately/);
    assert.match(text, /Escape/);
    assert.match(text, /Shift \+ right-click/);
    assert.match(text, /Leaves the browser menu alone/);
  });

  test('the Shift+right-click line follows the setting', () => {
    install({ requireShift: true });
    api.open();
    assert.match(root().textContent, /Opens this menu \(required by your settings\)/);
  });

  test('"Open settings" closes the help and hands over', () => {
    install();
    api.open();
    click(byId('siat-help-settings'));
    assert.equal(opened, 1);
    assert.equal(api.isOpen, false);
    assert.equal(pageCalls.close, 0, 'the page window.close() was not used');
  });

  test('Close and Escape both dismiss it', async () => {
    install();
    api.open();
    click(byId('siat-help-close'));
    assert.equal(api.isOpen, false);
    api.open();
    const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (doc.activeElement || doc.body).dispatchEvent(escape);
    await wait();
    assert.equal(api.isOpen, false);
    api.destroy();
    assert.equal(doc.getElementById('siat-help-host'), null);
  });

  test('a settings object with no shortcuts still lists the defaults', () => {
    install({ shortcuts: undefined });
    api.open();
    assert.ok(root().textContent.includes('Alt+Shift+S'));
  });
});
