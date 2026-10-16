import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBatchDialog } from '../../src/ui/batch-dialog.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

/**
 * Feature: batch conversion — the confirmation dialog.
 *
 * The dialog is the "preview and confirm" step of a multistep automation, so the
 * contract tested here is: every option change re-plans *before* anything runs,
 * the plan on screen is the plan that will be executed, a run with nothing in it
 * cannot be started, and the options handed to the runner are exactly the ones
 * the user sees.
 */

let JSDOM = null;
let SKIP_DOM = false;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (err) {
  SKIP_DOM = `jsdom unavailable (${err.code || err.message}) — run \`npm install\` to enable the DOM tests`;
}

let dom = null;
let doc = null;
let pageCalls = null;
let api = null;
let plans = null;
let computed = null;
let started = null;
let pickerOpened = null;

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

const planFor = (options) => ({
  found: 42,
  eligible: 30,
  files: 30 * (1 + (options.extraFormats || []).length),
  skippedTiny: 8,
  skippedNotLoaded: 3,
  skippedBroken: 1,
  skippedDuplicate: 0,
  skippedTooSmall: options.minWidth ? 4 : 0,
  skippedLimit: 0,
  crossOrigin: 5,
  destination: options.destination === 'zip' ? 'zip' : 'files',
  concurrency: 2,
  formatIds: [options.formatId].concat(options.extraFormats || []),
  entries: Array.from({ length: 30 }, (_, i) => ({ id: `image-${i + 1}` })),
  estimateLabel: `${30 * (1 + (options.extraFormats || []).length)} files at 2 at a time`,
  notes: ['5 images come from another origin and will be fetched through your userscript manager.'],
  megapixels: 12.4,
});

function installDialog({ settings = {}, planThrows = false, emptyPlan = false } = {}) {
  plans = [];
  computed = [];
  started = [];
  pickerOpened = 0;
  api = createBatchDialog({
    document: doc,
    settings: () => Object.assign({}, DEFAULT_SETTINGS, { activeFormatId: 'png' }, settings),
    formats: () => [
      { id: 'png', label: 'PNG', ext: 'png', disabled: '' },
      { id: 'jpg', label: 'JPG', ext: 'jpg', disabled: '' },
      { id: 'webp', label: 'WebP', ext: 'webp', disabled: '' },
      { id: 'avif', label: 'AVIF', ext: 'avif', disabled: 'Not supported by this browser' },
      { id: 'original', label: 'Original file', ext: '', disabled: '' },
    ],
    plan: (options) => {
      plans.push(options);
      if (planThrows) throw new Error('the page changed while scanning');
      const result = emptyPlan
        ? Object.assign(planFor(options), { found: 0, eligible: 0, files: 0, entries: [], notes: ['No image on this page matched the filters.'] })
        : planFor(options);
      computed.push(result);
      return result;
    },
    onStart: (options) => started.push(options),
    onOpenPicker: () => {
      pickerOpened += 1;
    },
  });
}

const root = () => api.shadowRoot;
const byId = (id) => root().getElementById(id);
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (element) => element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const input = (element) => element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
const check = (id, value = true) => {
  const box = byId(id);
  box.checked = value;
  change(box);
};
const planTable = () => byId('siat-batch-plan').textContent;
const lastPlan = () => plans[plans.length - 1];
const lastComputed = () => computed[computed.length - 1];

describe('batch dialog — the plan the user confirms', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installDialog();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('opening seeds the options from settings and plans once before anything runs', () => {
    assert.equal(doc.getElementById('siat-batch-host'), null, 'nothing is in the page before opening');
    api.open();
    assert.equal(plans.length, 1, 'the plan was computed on open');
    assert.deepEqual(started, [], 'and nothing was started');
    assert.equal(lastPlan().formatId, 'png', 'the effective default format is preselected');
    assert.equal(lastPlan().destination, 'files');
    assert.equal(lastPlan().skipTiny, true, 'the stored defaults are used');
    assert.equal(lastPlan().dedupe, true);
    assert.equal(lastPlan().includeNotLoaded, false);
    assert.equal(doc.querySelectorAll('#siat-batch-host').length, 1);
  });

  test('the stored batch settings are honoured, including a ZIP destination', () => {
    api.destroy();
    installDialog({ settings: { batchDestination: 'zip', batchFormats: ['webp'], batchSkipTiny: false, batchDedupe: false, batchIncludeNotLoaded: true, batchMinWidth: 200, batchMinHeight: 100, activeFormatId: 'jpg' } });
    api.open();
    const options = lastPlan();
    assert.equal(options.formatId, 'jpg');
    assert.deepEqual(options.extraFormats, ['webp']);
    assert.equal(options.destination, 'zip');
    assert.equal(options.skipTiny, false);
    assert.equal(options.dedupe, false);
    assert.equal(options.includeNotLoaded, true);
    assert.equal(options.minWidth, 200);
    assert.equal(options.minHeight, 100);
    assert.equal(byId('siat-batch-zip').checked, true, 'the controls show the stored values');
    assert.equal(byId('siat-batch-format').value, 'jpg');
  });

  test('the table states exactly what the run will do', () => {
    api.open();
    const text = planTable();
    for (const expected of ['Images found', '42', 'Will be converted', '30', 'Files that produces', '30', 'Skipped: icon-sized', '8', 'Skipped: not loaded yet', '3', 'Skipped: broken source', '1', 'Cross-origin', '5', 'one file per image', 'Concurrency', '2']) {
      assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the plan shows "${expected}"`);
    }
    assert.match(root().textContent, /fetched through your userscript manager/, 'the scan notes are shown');
    assert.match(byId('siat-batch-note').textContent, /30 files at 2 at a time/, 'the estimate is stated');
    assert.match(byId('siat-batch-note').textContent, /cancel at any time/i, 'and so is how to stop');
    assert.equal(byId('siat-batch-start').disabled, false);
    assert.match(byId('siat-batch-start').textContent, /Start \(30 files\)/);
  });

  test('every option change re-plans before the run, with the option the user set', () => {
    api.open();
    const before = plans.length;

    byId('siat-batch-format').value = 'webp';
    change(byId('siat-batch-format'));
    assert.equal(plans.length, before + 1);
    assert.equal(lastPlan().formatId, 'webp');

    check('siat-batch-also-jpg');
    assert.deepEqual(lastPlan().extraFormats, ['jpg'], 'an extra format is added');
    assert.equal(lastComputed().files, 60, 'the file count doubles');
    check('siat-batch-also-jpg', false);
    assert.deepEqual(lastPlan().extraFormats, [], 'and removed again');

    check('siat-batch-zip');
    assert.equal(lastPlan().destination, 'zip');
    assert.match(planTable(), /one \.zip archive/);
    check('siat-batch-zip', false);
    assert.equal(lastPlan().destination, 'files');

    check('siat-batch-notloaded');
    assert.equal(lastPlan().includeNotLoaded, true);
    check('siat-batch-skiptiny', false);
    assert.equal(lastPlan().skipTiny, false);
    check('siat-batch-dedupe', false);
    assert.equal(lastPlan().dedupe, false);

    byId('siat-batch-minw').value = '800';
    input(byId('siat-batch-minw'));
    assert.equal(lastPlan().minWidth, 800);
    assert.match(planTable(), /below the minimum size/, 'the size filter is reflected in the plan');

    byId('siat-batch-minh').value = 'not-a-number';
    input(byId('siat-batch-minh'));
    assert.equal(lastPlan().minHeight, 0, 'junk in a number field means "off", never NaN');

    assert.deepEqual(started, [], 're-planning never starts a run');
  });

  test('"Original file" is not offered as an extra format, and a disabled encoder cannot be picked', () => {
    api.open();
    assert.equal(byId('siat-batch-also-original'), null, 'no "also Original file" checkbox');
    const avif = byId('siat-batch-also-avif');
    assert.ok(avif, 'AVIF has a checkbox');
    const option = Array.from(byId('siat-batch-format').options).find((entry) => entry.value === 'avif');
    assert.equal(option.disabled, true, 'an unsupported encoder is disabled in the format list');
  });

  test('Start hands over exactly the visible options, then closes', () => {
    api.open();
    byId('siat-batch-format').value = 'jpg';
    change(byId('siat-batch-format'));
    check('siat-batch-also-webp');
    check('siat-batch-zip');
    byId('siat-batch-minw').value = '640';
    input(byId('siat-batch-minw'));

    click(byId('siat-batch-start'));
    assert.equal(started.length, 1, 'one run was started');
    assert.equal(started[0].formatId, 'jpg');
    assert.deepEqual(started[0].extraFormats, ['webp']);
    assert.equal(started[0].destination, 'zip');
    assert.equal(started[0].minWidth, 640);
    assert.equal(started[0].skipTiny, true);
    assert.equal(api.isOpen, false, 'the dialog closes so the progress bar is visible');
    assert.equal(pageCalls.close, 0, 'the page window.close() was not used to do it');

    // The payload is a copy: mutating it afterwards cannot change the dialog.
    started[0].formatId = 'bmp';
    api.open();
    assert.equal(api.state().options.formatId, 'jpg', 'reopening shows the same options');
  });

  test('a plan with nothing in it cannot be started, and says why', () => {
    api.destroy();
    installDialog({ emptyPlan: true });
    api.open();
    assert.equal(byId('siat-batch-start').disabled, true);
    assert.match(byId('siat-batch-start').textContent, /Nothing to do/);
    assert.match(root().textContent, /Nothing to convert/);
    assert.match(root().textContent, /No image on this page matched the filters/);
    click(byId('siat-batch-start'));
    assert.deepEqual(started, [], 'a disabled Start cannot be clicked into a run');
  });

  test('a plan that throws is reported, and still cannot be started', () => {
    api.destroy();
    installDialog({ planThrows: true });
    api.open();
    assert.match(root().textContent, /could not be scanned|the page changed while scanning/i, 'the failure is visible');
    assert.equal(byId('siat-batch-start').disabled, true);
    assert.equal(api.isOpen, true, 'the dialog stays usable instead of vanishing');
  });

  test('"Choose images instead" hands over to the picker', () => {
    api.open();
    click(byId('siat-batch-open-picker'));
    assert.equal(pickerOpened, 1);
    assert.equal(api.isOpen, false);
  });

  test('Cancel and Escape close without starting anything', async () => {
    api.open();
    const buttons = Array.from(root().querySelectorAll('button'));
    const cancel = buttons.find((button) => button.textContent.trim() === 'Cancel');
    assert.ok(cancel, 'there is a Cancel button');
    click(cancel);
    assert.equal(api.isOpen, false);
    assert.deepEqual(started, []);

    api.open();
    const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (doc.activeElement || doc.body).dispatchEvent(escape);
    await Promise.resolve();
    assert.equal(api.isOpen, false, 'Escape closes it');
    assert.deepEqual(pageCalls, { close: 0, open: 0 });
  });

  test('open(options) can preselect a format for a picker-driven run', () => {
    api.open({ formatId: 'webp', destination: 'zip' });
    assert.equal(lastPlan().formatId, 'webp');
    assert.equal(lastPlan().destination, 'zip');
    assert.equal(byId('siat-batch-format').value, 'webp');
    assert.equal(byId('siat-batch-zip').checked, true);
  });

  test('state() reports the options and the plan for support and automation', () => {
    api.open();
    const state = api.state();
    assert.equal(state.options.formatId, 'png');
    assert.equal(state.plan.eligible, 30);
    assert.equal(state.plan.files, 30);
    assert.equal(computed.length, plans.length, 'every plan request produced a plan');
    check('siat-batch-zip');
    assert.equal(api.state().options.destination, 'zip');
  });

  test('destroy() removes the host, and a second instance does not stack', () => {
    api.open();
    const second = createBatchDialog({ document: doc, formats: () => [], plan: () => ({ eligible: 0, found: 0, files: 0, entries: [], notes: [] }), onStart: () => {} });
    second.open();
    assert.equal(doc.querySelectorAll('#siat-batch-host').length, 1, 'one host on screen');
    second.destroy();
    assert.equal(doc.getElementById('siat-batch-host'), null);
    api.destroy();
    assert.equal(doc.getElementById('siat-batch-host'), null);
  });
});
