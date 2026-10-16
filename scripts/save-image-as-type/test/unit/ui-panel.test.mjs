import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsPanel } from '../../src/ui/panel.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

// jsdom is a dev dependency; if it is missing the DOM tests report a skip with
// the reason instead of failing, so the suite never claims a result it did not get.
let JSDOM = null;
let SKIP_DOM = false;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (err) {
  SKIP_DOM = `jsdom unavailable (${err.code || err.message}) — run \`npm install\` to enable the DOM tests`;
}

/**
 * The settings dialog is a modal that takes over the page, so "it can always be
 * dismissed again" is a safety property, not a nicety: a dialog that cannot be
 * closed leaves a full-screen backdrop swallowing every click on the site.
 *
 * These tests exist because of a real bug the browser suite caught: panel.js
 * defined open()/close() only as methods of the returned object, so the
 * internal calls in onSave/onReset/onKeydown/the Cancel button resolved to the
 * page's window.close() and window.open() — the dialog never closed and
 * "Reset defaults" opened a blank popup tab. Every test below therefore also
 * asserts that the page-level window.close/window.open spies were never called.
 */

let dom = null;
let doc = null;
let windowCalls = null;

const DIAGNOSTICS = {
  handler: 'TestMonkey',
  managerVersion: '5.3.0',
  scriptVersion: '1.0.0',
  injectInto: 'page',
  downloadMode: 'browser',
  storage: 'gm',
  encoders: { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/avif': false },
  encoderNotes: { 'image/avif': 'canvas.toBlob falls back to PNG in this browser' },
  animation: { decoderAvailable: false, supportedTypes: [], reason: 'no WebCodecs ImageDecoder' },
};

function installDom() {
  dom = new JSDOM('<!doctype html><html><body><button id="page-button">page button</button></body></html>', {
    url: 'https://page.example/gallery',
    pretendToBeVisual: true,
  });
  doc = dom.window.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.Blob = dom.window.Blob;
  globalThis.File = dom.window.File;

  // Spy on the page-level window functions. A bare close()/open() inside a
  // module resolves here in a browser, so these must stay untouched.
  windowCalls = [];
  for (const name of ['close', 'open']) {
    const spy = (...args) => {
      windowCalls.push({ name, args: args.length });
      return name === 'open' ? null : undefined;
    };
    dom.window[name] = spy;
    globalThis[name] = spy;
  }
}

function teardownDom() {
  if (dom) dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'getComputedStyle', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'Blob', 'File', 'close', 'open']) {
    delete globalThis[key];
  }
}

function makePanel({ settings = {}, saveResult = { ok: true, warnings: [] }, warnings = [] } = {}) {
  const calls = { saves: [], resets: 0 };
  let stored = Object.assign({}, DEFAULT_SETTINGS, settings);
  stored.formats = stored.formats.slice();
  const api = createSettingsPanel({
    document: doc,
    getSettings: () => stored,
    saveSettings: async (patch) => {
      calls.saves.push(patch);
      if (saveResult.ok !== false) stored = Object.assign({}, stored, patch);
      return saveResult;
    },
    resetSettings: async () => {
      calls.resets += 1;
      stored = Object.assign({}, DEFAULT_SETTINGS, { formats: DEFAULT_SETTINGS.formats.slice() });
      return stored;
    },
    diagnostics: () => DIAGNOSTICS,
    settingsWarnings: () => warnings,
    gm: () => ({ capabilities: { download: true }, info: { downloadMode: 'browser', scriptHandler: 'TestMonkey', version: '5.3.0' } }),
    capabilityReport: () => 'handler=TestMonkey download=browser',
  });
  return { api, calls, get stored() { return stored; } };
}

const host = () => doc.getElementById('siat-panel-host');
const root = () => (host() ? host().shadowRoot : null);
const dialog = () => root().querySelector('[role="dialog"]');
const backdrop = () => root().querySelector('.siat-backdrop');
const buttonByText = (text) => [...root().querySelectorAll('button')].find((el) => el.textContent.trim() === text);
const footerButton = (text) => [...root().querySelectorAll('.siat-foot .siat-btn')].find((el) => el.textContent.trim() === text);
const banner = () => root().querySelector('.siat-banner');
const shadowText = () => (root() ? root().innerHTML.length : -1);

function mouse(element, type, { bubbles = true } = {}) {
  element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles, cancelable: true, composed: true }));
}

function key(name) {
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings panel — modal structure', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('open() builds an accessible modal dialog in a shadow host', async (t) => {
    const { api } = makePanel();
    t.after(() => api.destroy());
    api.open();
    await tick();
    assert.equal(api.isOpen, true);
    assert.equal(host().getAttribute('data-siat'), 'panel');
    assert.equal(doc.querySelectorAll('#siat-panel-host').length, 1);
    const d = dialog();
    assert.equal(d.getAttribute('role'), 'dialog');
    assert.equal(d.getAttribute('aria-modal'), 'true');
    assert.equal(d.getAttribute('aria-labelledby'), 'siat-panel-title');
    assert.equal(root().getElementById('siat-panel-title').textContent, 'Save Image as Type — settings');
    assert.equal(root().activeElement, footerButton('Save'), 'focus moves into the dialog (Save is the primary action)');
    assert.equal(doc.activeElement, host(), 'the host holds document focus, so the page cannot tab into the modal');
  });

  test('opening twice reuses one host and rebuilds the content', async (t) => {
    const { api } = makePanel();
    t.after(() => api.destroy());
    api.open();
    await tick();
    const first = shadowText();
    api.open();
    await tick();
    assert.equal(doc.querySelectorAll('#siat-panel-host').length, 1, 'no duplicate modal hosts');
    assert.equal(api.isOpen, true);
    assert.ok(shadowText() > 1000, `content was rebuilt (${shadowText()} chars, first build ${first})`);
  });

  test('stored-settings warnings are announced in a status banner', async (t) => {
    const { api } = makePanel({ warnings: ['A stored value was outside its allowed range and was reset.'] });
    t.after(() => api.destroy());
    api.open();
    await tick();
    assert.equal(banner().getAttribute('role'), 'status');
    assert.match(banner().textContent, /Some stored settings needed attention/);
    assert.match(banner().textContent, /outside its allowed range/);
  });
});

describe('settings panel — dismissal (regression: window.close/window.open)', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('Save persists the draft and closes the dialog', async (t) => {
    const { api, calls } = makePanel();
    t.after(() => api.destroy());
    api.open();
    await tick();
    const opened = shadowText();
    root().getElementById('siat-fmt-bmp').click(); // uncheck BMP
    footerButton('Save').click();
    await tick();
    await tick();
    assert.equal(calls.saves.length, 1, 'the draft was handed to the store exactly once');
    assert.equal(calls.saves[0].formats.includes('bmp'), false, 'BMP was removed from the enabled formats');
    assert.equal(api.isOpen, false, 'the dialog closed after a successful save');
    assert.equal(shadowText(), 0, 'the modal DOM was removed, so no backdrop is left swallowing clicks');
    assert.ok(opened > 1000, 'sanity: the panel really was built before saving');
    assert.deepEqual(windowCalls, [], 'the page window was never closed or opened');
  });

  test('a failed save keeps the dialog open and explains why', async (t) => {
    const { api, calls } = makePanel({ saveResult: { ok: false } });
    t.after(() => api.destroy());
    api.open();
    await tick();
    footerButton('Save').click();
    await tick();
    await tick();
    assert.equal(calls.saves.length, 1);
    assert.equal(api.isOpen, true, 'the user keeps their edits when the write failed');
    assert.equal(banner().getAttribute('role'), 'alert');
    assert.match(banner().textContent, /Settings could not be saved/);
    assert.deepEqual(windowCalls, []);
  });

  test('Cancel, the × button and Escape all close without saving', async (t) => {
    const { api, calls } = makePanel();
    t.after(() => api.destroy());

    api.open();
    await tick();
    footerButton('Cancel').click();
    await tick();
    assert.equal(api.isOpen, false, 'Cancel closes');
    assert.deepEqual(calls.saves, [], 'Cancel does not save');

    api.open();
    await tick();
    root().querySelector('.siat-icon-btn[aria-label="Close settings"]').click();
    await tick();
    assert.equal(api.isOpen, false, 'the × button closes');

    api.open();
    await tick();
    key('Escape');
    await tick();
    assert.equal(api.isOpen, false, 'Escape closes');
    assert.deepEqual(calls.saves, [], 'Escape does not save');
    assert.deepEqual(windowCalls, [], 'the page window was never closed or opened');
  });

  test('a backdrop click closes; a click inside the dialog does not', async (t) => {
    const { api } = makePanel();
    t.after(() => api.destroy());
    api.open();
    await tick();
    mouse(dialog(), 'mousedown');
    assert.equal(api.isOpen, true, 'clicking inside the dialog keeps it open');
    mouse(backdrop(), 'mousedown');
    assert.equal(api.isOpen, false, 'clicking the backdrop closes it');
    assert.deepEqual(windowCalls, []);
  });

  test('Reset defaults resets the store and rebuilds the dialog — without a popup', async (t) => {
    const { api, calls } = makePanel({ settings: { filenamePrefix: 'weird-', formats: ['png'] } });
    t.after(() => api.destroy());
    api.open();
    await tick();
    assert.equal(root().getElementById('siat-prefix').value, 'weird-');
    footerButton('Reset defaults').click();
    await tick();
    await tick();
    assert.equal(calls.resets, 1);
    assert.equal(api.isOpen, true, 'the panel stays open so the user can review the defaults');
    assert.equal(root().getElementById('siat-prefix').value, DEFAULT_SETTINGS.filenamePrefix, 'the form shows the restored defaults');
    assert.equal(root().getElementById('siat-fmt-bmp').checked, true, 'formats were restored too');
    assert.deepEqual(windowCalls, [], 'Reset must not call window.open() (it used to open a blank tab)');
  });

  test('oversized settings file is rejected before reading its contents', async (t) => {
    const { api } = makePanel(); t.after(() => api.destroy());
    api.open(); await tick();
    let reads = 0;
    const input = root().querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 200001, text: async () => { reads += 1; throw Error('must not read'); } }] });
    input.dispatchEvent(new dom.window.Event('change'));
    await tick();
    assert.equal(reads, 0, 'allocation preflight precedes File.text');
    assert.match(banner().textContent, /too large/);
    assert.equal(api.isOpen, true);
  });

  test('destroy() removes the host entirely', async (t) => {
    const { api } = makePanel();
    api.open();
    await tick();
    api.destroy();
    assert.equal(api.isOpen, false);
    assert.equal(doc.getElementById('siat-panel-host'), null, 'no leftover modal host');
    assert.deepEqual(windowCalls, []);
  });

  test('focus returns to the page element that opened the dialog', async (t) => {
    const { api } = makePanel();
    t.after(() => api.destroy());
    const pageButton = doc.getElementById('page-button');
    pageButton.focus();
    assert.equal(doc.activeElement, pageButton);
    api.open();
    await tick();
    assert.equal(doc.activeElement, host(), 'focus moved into the modal');
    api.close();
    await tick();
    assert.equal(doc.activeElement, pageButton, 'focus is restored, so keyboard users are not dropped at the top of the page');
  });
});
