import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createJobBar } from '../../src/ui/jobbar.js';

/**
 * Feature: batch progress (the job bar).
 *
 * The job bar is the only place a running batch can be stopped, so the properties
 * that matter are: it reflects the queue exactly (percent, per-item state, byte
 * totals), Cancel is reachable while running and gone afterwards, "Retry failed"
 * appears only when something failed, an uncertain save is labelled "unknown"
 * rather than "failed" (so the user checks the download folder), and it lives in
 * a shadow root the page can neither style nor read.
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

  // The classic panel bug: a bare close()/open() resolves to window.close().
  pageCalls = { close: 0, open: 0, focus: 0 };
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

const stats = (over = {}) =>
  Object.assign({ state: 'running', total: 4, attempted: 2, queued: 1, running: 1, done: 2, failed: 0, skipped: 0, cancelled: 0, bytes: 0, uncertain: 0, concurrency: 2, startedAt: 0, endedAt: 0, durationMs: 1200, complete: false }, over);

const items = (list) => list;

const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

describe('job bar — progress reporting', { skip: SKIP_DOM || false }, () => {
  let api = null;
  let calls = null;

  beforeEach(() => {
    installDom();
    calls = { cancel: 0, retry: 0, close: 0 };
    api = createJobBar({
      document: doc,
      onCancel: () => {
        calls.cancel += 1;
      },
      onRetry: () => {
        calls.retry += 1;
      },
      onClose: () => {
        calls.close += 1;
      },
    });
  });

  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  const root = () => api.shadowRoot;
  const byId = (id) => root().getElementById(id);
  // The title and the fill are styled by class, not addressable by id.
  const title = () => root().querySelector('.siat-jobbar-title');
  const fill = () => root().querySelector('.siat-jobbar-fill');

  test('nothing is added to the page until a run starts', () => {
    assert.equal(api.isOpen, false);
    assert.equal(doc.getElementById('siat-jobbar-host'), null, 'no host element in the page yet');
    assert.equal(doc.body.children.length, 1, 'the page body is untouched');
  });

  test('show() creates one shadow host and announces the run', () => {
    api.show('Batch conversion');
    const host = doc.getElementById('siat-jobbar-host');
    assert.ok(host, 'the host exists');
    assert.ok(host.shadowRoot, 'and it is a shadow root, so the page cannot style or read it');
    assert.equal(host.shadowRoot, api.shadowRoot);
    assert.equal(api.isOpen, true);
    assert.equal(title().textContent, 'Batch conversion');
    assert.equal(byId('siat-jobbar-status').getAttribute('aria-live'), 'polite', 'progress is announced politely');
    assert.equal(byId('siat-jobbar-status').getAttribute('role'), 'status');
    assert.equal(doc.querySelectorAll('#siat-jobbar-host').length, 1, 'exactly one host in the page');

    api.show('Second run');
    assert.equal(doc.querySelectorAll('#siat-jobbar-host').length, 1, 'a second run does not stack a second bar');
    assert.equal(title().textContent, 'Second run');
  });

  test('update() reports percent, counts, bytes and ARIA progress values', () => {
    api.show('Batch conversion');
    api.update(stats({ total: 4, done: 1, running: 1, queued: 2 }), items([
      { id: 'a', label: 'photo.jpg', state: 'done', result: { bytes: 10 } },
      { id: 'b', label: 'logo.png', state: 'running' },
      { id: 'c', label: 'icon.gif', state: 'queued' },
    ]));
    const progress = root().querySelector('[role="progressbar"]');
    assert.ok(progress, 'the track is a progressbar');
    assert.equal(progress.getAttribute('aria-valuemax'), '4');
    assert.equal(progress.getAttribute('aria-valuenow'), '1', 'finished = done + failed + skipped + cancelled (a running item has not finished)');
    assert.equal(progress.getAttribute('aria-valuemin'), '0');
    assert.equal(progress.getAttribute('aria-labelledby'), 'siat-jobbar-status');
    assert.match(byId('siat-jobbar-status').textContent, /1\/4/, 'finished/total');
    assert.match(byId('siat-jobbar-status').textContent, /1 saved/);
    assert.match(byId('siat-jobbar-status').textContent, /1 running/);

    api.update(stats({ total: 4, done: 3, failed: 1, bytes: 3 * 1024 * 1024, complete: true, state: 'done' }), []);
    assert.match(byId('siat-jobbar-status').textContent, /3 saved/);
    assert.match(byId('siat-jobbar-status').textContent, /1 failed/);
    assert.match(byId('siat-jobbar-status').textContent, /3\.0 MB/);
    assert.equal(fill().style.width, '100%');
  });

  test('queued items are not listed, and the list is capped', () => {
    api.show('Batch conversion');
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `i${i}`, label: `image ${i}.png`, state: i < 380 ? 'done' : 'queued' }));
    api.update(stats({ total: 400, done: 380, queued: 20, running: 0 }), items(many));
    api.update(stats({ total: 400, done: 380, queued: 20, running: 0 }), items(many));
    const rows = Array.from(byId('siat-jobbar-list').children);
    assert.equal(rows.length, 40, 'the list is capped at the most recent 40 items');
    assert.match(rows[0].textContent, /image 340\.png/, 'the visible slice is the tail of the run');
    assert.match(rows[39].textContent, /image 379\.png/);
    assert.ok(rows.every((row) => !/queued/.test(row.textContent)), 'queued items are not rendered as rows');
    assert.equal(rows.length, byId('siat-jobbar-list').children.length, 'the list was rewritten, not appended to');
    assert.match(byId('siat-jobbar-summary').textContent, /380 saved/, 'the collapsed summary carries the counts');
    assert.match(byId('siat-jobbar-summary').textContent, /20 to go/);
  });

  test('an uncertain save is labelled "unknown", not "failed"', () => {
    api.show('Batch conversion');
    api.update(stats({ total: 2, done: 1, failed: 1, uncertain: 1 }), items([
      { id: 'a', label: 'ok.png', state: 'done' },
      { id: 'b', label: 'maybe.png', state: 'failed', uncertain: true, error: 'The manager did not confirm the download.' },
    ]));
    const rows = Array.from(byId('siat-jobbar-list').children);
    const uncertainRow = rows.find((row) => row.textContent.includes('maybe.png'));
    assert.match(uncertainRow.textContent, /unknown/, 'the user is told the outcome is unknown');
    assert.equal(/failed/.test(uncertainRow.textContent), false, 'and not told it definitely failed');
    assert.match(uncertainRow.querySelector('.siat-jobbar-item-name').title, /did not confirm/, 'the reason is available on hover');
  });

  test('Cancel is available while running and hidden once the run settles', () => {
    api.show('Batch conversion');
    api.update(stats({ state: 'running' }), []);
    const cancel = byId('siat-jobbar-cancel');
    assert.equal(cancel.disabled, false);
    assert.equal(cancel.style.display, '');
    click(cancel);
    assert.equal(calls.cancel, 1, 'Cancel reaches the owner');

    api.update(stats({ state: 'done', complete: true, done: 4, queued: 0, running: 0 }), []);
    assert.equal(cancel.style.display, 'none', 'nothing left to cancel');
    assert.equal(byId('siat-jobbar-close').style.display, '', 'Close appears instead');

    click(byId('siat-jobbar-close'));
    assert.equal(calls.close, 1);
    assert.equal(api.isOpen, false, 'the bar is hidden');
    assert.equal(pageCalls.close, 0, 'the page window.close() was never called');
  });

  test('"Retry failed" appears only when something failed, and only re-runs on click', () => {
    api.show('Batch conversion');
    api.update(stats({ total: 3, done: 3, complete: true, state: 'done' }), []);
    const retry = byId('siat-jobbar-retry');
    assert.equal(retry.style.display, 'none', 'an all-success run offers no retry');
    assert.equal(retry.disabled, true);

    api.update(stats({ total: 3, done: 2, failed: 1, complete: true, state: 'done' }), []);
    assert.equal(retry.style.display, '');
    assert.equal(retry.disabled, false);
    click(retry);
    assert.equal(calls.retry, 1);
  });

  test('finish() replaces the status with the summary and disables Cancel', () => {
    api.show('Batch conversion');
    api.update(stats({ state: 'running' }), []);
    api.finish('12 files saved — 12/12 images converted · 4.1s', { failed: 0 });
    assert.equal(byId('siat-jobbar-status').textContent, '12 files saved — 12/12 images converted · 4.1s');
    assert.equal(byId('siat-jobbar-cancel').disabled, true);
    assert.equal(byId('siat-jobbar-cancel').style.display, 'none');
    assert.equal(byId('siat-jobbar-close').style.display, '');
    assert.equal(byId('siat-jobbar-retry').style.display, 'none');

    api.finish('2 files saved', { failed: 2 });
    assert.equal(byId('siat-jobbar-retry').disabled, false, 'a failed run can be retried from the summary');
  });

  test('the bar can be collapsed without losing the run', () => {
    api.show('Batch conversion');
    const collapse = root().querySelector('[aria-label="Collapse progress panel"]');
    assert.equal(collapse.getAttribute('aria-expanded'), 'true');
    click(collapse);
    assert.equal(root().querySelector('.siat-jobbar').dataset.collapsed, 'true');
    assert.equal(collapse.getAttribute('aria-expanded'), 'false');
    assert.equal(collapse.getAttribute('aria-label'), 'Expand progress panel');
    click(collapse);
    assert.equal(root().querySelector('.siat-jobbar').dataset.collapsed, 'false');
    assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  });

  test('update() before show() is a no-op, and hide() then update() stays quiet', () => {
    api.update(stats({}), []);
    assert.equal(doc.getElementById('siat-jobbar-host'), null, 'no bar was created by a stray update');
    api.show('Run');
    api.hide();
    assert.equal(api.isOpen, false);
    api.update(stats({ done: 1 }), []);
    assert.equal(api.isOpen, false, 'a hidden bar is not re-shown by progress events');
  });

  test('destroy() removes the host from the page entirely', () => {
    api.show('Batch conversion');
    assert.ok(doc.getElementById('siat-jobbar-host'));
    api.destroy();
    assert.equal(doc.getElementById('siat-jobbar-host'), null, 'the host is gone');
    assert.equal(api.isOpen, false);
    assert.deepEqual(pageCalls, { close: 0, open: 0, focus: 0 }, 'no page-level window calls at any point');
  });

  test('a second instance adopts the existing host instead of stacking', () => {
    api.show('First');
    const second = createJobBar({ document: doc });
    second.show('Second');
    assert.equal(doc.querySelectorAll('#siat-jobbar-host').length, 1, 'one host on screen');
    second.destroy();
    assert.equal(doc.getElementById('siat-jobbar-host'), null);
  });
});
