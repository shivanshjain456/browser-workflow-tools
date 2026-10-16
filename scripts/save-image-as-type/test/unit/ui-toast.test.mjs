import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createToaster } from '../../src/ui/toast.js';

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
 * Toasts sit on top of somebody else's page, so two properties matter and are
 * easy to lose silently:
 *
 *  1. The stack is bounded. A notification area that grows without limit ends up
 *     covering the content the user came for.
 *  2. The bound still holds when the stack is *shared*. The host element is
 *     adopted rather than duplicated (a person can have this script installed in
 *     Tampermonkey and Violentmonkey at the same time), so two instances write
 *     into one stack and each one's own bookkeeping is not enough.
 */

let dom = null;
let doc = null;

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
}

function teardownDom() {
  if (dom) dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
    delete globalThis[key];
  }
}

const host = () => doc.getElementById('siat-toast-host');
const nodes = () => [...host().shadowRoot.querySelectorAll('.siat-toast')];
const titles = () => nodes().map((node) => node.querySelector('.siat-title').textContent);

describe('toast stack — bounds and sharing', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('the stack never holds more than four toasts, oldest dropped first', (t) => {
    const toaster = createToaster(doc);
    t.after(() => toaster.destroy());
    for (let i = 0; i < 6; i += 1) {
      toaster.success(`toast-${i}`, `Saved example-${i}.png`, 'Image · 12 KB', ['a note'], [], 60000);
    }
    assert.equal(nodes().length, 4, `four on screen, got ${nodes().length}`);
    assert.deepEqual(titles(), ['Saved example-2.png', 'Saved example-3.png', 'Saved example-4.png', 'Saved example-5.png'], 'the newest four survive');
  });

  test('a re-rendered id keeps its place in the stack and does not add a node', (t) => {
    const toaster = createToaster(doc);
    t.after(() => toaster.destroy());
    toaster.progress('siat-job', 'Saving as PNG…', 'locating image');
    toaster.progress('siat-job', 'Saving as PNG…', 'encoding');
    toaster.success('siat-job', 'Saved photo.png', 'Image · 35 KB');
    assert.equal(nodes().length, 1, 'progress → success for one job is one toast');
    assert.deepEqual(titles(), ['Saved photo.png']);
  });

  test('two instances sharing one host still respect the bound', (t) => {
    const first = createToaster(doc);
    const second = createToaster(doc);
    t.after(() => first.destroy());
    t.after(() => second.destroy());
    for (let i = 0; i < 3; i += 1) first.success(`a-${i}`, `From first ${i}`, 'meta', [], [], 60000);
    for (let i = 0; i < 3; i += 1) second.success(`b-${i}`, `From second ${i}`, 'meta', [], [], 60000);
    assert.equal(doc.querySelectorAll('#siat-toast-host').length, 1, 'the host is adopted, not duplicated');
    assert.equal(nodes().length, 4, `the shared stack is bounded across instances, got ${nodes().length}`);
    assert.deepEqual(titles(), ['From first 2', 'From second 0', 'From second 1', 'From second 2'], 'the oldest node on screen was dropped even though another instance owned it');
  });

  test('dismissAll() clears this instance\'s toasts', (t) => {
    const toaster = createToaster(doc);
    t.after(() => toaster.destroy());
    toaster.error('e1', 'Could not save as PNG', 'The image could not be read.', ['help'], []);
    toaster.success('s1', 'Saved photo.png', 'Image · 35 KB');
    assert.equal(nodes().length, 2);
    toaster.dismissAll();
    assert.equal(nodes().length, 0);
    assert.equal(host().shadowRoot.querySelectorAll('.siat-toast-stack').length, 1, 'the stack container itself stays, so later toasts still work');
    toaster.success('s2', 'Saved again.png', 'Image · 35 KB');
    assert.equal(nodes().length, 1);
  });

  test('failures are assertive, progress and success are polite, and text is never parsed as HTML', (t) => {
    const toaster = createToaster(doc);
    t.after(() => toaster.destroy());
    toaster.progress('p', 'Saving as PNG…', 'locating image');
    toaster.error('e', 'Could not save as <img src=x onerror=alert(1)>', 'meta');
    const [progress, error] = nodes();
    assert.equal(progress.getAttribute('role'), 'status');
    assert.equal(progress.getAttribute('aria-live'), 'polite');
    assert.equal(error.getAttribute('role'), 'alert');
    assert.equal(error.getAttribute('aria-live'), 'assertive');
    assert.equal(error.querySelector('.siat-title').textContent, 'Could not save as <img src=x onerror=alert(1)>', 'the hostile title is shown as text');
    assert.equal(host().shadowRoot.querySelectorAll('img').length, 0, 'no element was created from page-controlled text');
  });
});
