import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveBlob, describeDownloadCapability } from '../../src/core/download.js';
import { createGmAdapter } from '../../src/core/gm.js';

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
 * saveBlob() decides *how* a file reaches the disk, and every branch is a
 * documented manager difference. These tests run the real module against a DOM
 * (jsdom) and a fake manager, so the fallback logic and its reporting are
 * exercised rather than reasoned about.
 */

let dom = null;
let clicks = [];
let objectUrls = [];

function installDom() {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://page.example/gallery' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  let counter = 0;
  dom.window.URL.createObjectURL = () => {
    counter += 1;
    const url = `blob:https://page.example/${counter}`;
    objectUrls.push(url);
    return url;
  };
  dom.window.URL.revokeObjectURL = () => {};
  globalThis.URL = dom.window.URL;
  // Record anchor clicks instead of navigating (jsdom cannot download).
  clicks = [];
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    clicks.push({ download: this.download, href: this.href, parent: this.parentElement && this.parentElement.tagName });
  };
}

function managerWith(overrides = {}) {
  const base = {
    GM_info: { scriptHandler: 'TestMonkey', version: '1.0', downloadMode: 'browser', script: { version: '1.0.0' } },
    GM_getValue: () => null,
    GM_setValue: () => true,
  };
  return createGmAdapter(Object.assign(base, overrides));
}

const blob = (size = 32, type = 'image/png') => new Blob([new Uint8Array(size)], { type });
const SETTINGS = { downloadBehavior: 'instant', subfolder: '' };

describe('saveBlob — manager download path', { skip: SKIP_DOM }, () => {
  before(installDom);
  after(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.URL;
  });

  test('uses GM_download when the manager supports it and reports it truthfully', async () => {
    clicks = [];
    const requests = [];
    const gm = managerWith({
      GM_download: (details) => {
        requests.push(details);
        details.onload();
        return { abort() {} };
      },
    });
    const result = await saveBlob({ blob: blob(), filename: 'photo.png', path: 'photo.png', settings: SETTINGS, gm, downloadMode: 'browser' });
    assert.equal(result.ok, true);
    assert.equal(result.via, 'gm');
    assert.equal(result.fallbackReason, '');
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^blob:/, 'the blob is handed over as an object URL');
    assert.equal(requests[0].name, 'photo.png');
    assert.equal(requests[0].saveAs, false);
    assert.equal(clicks.length, 0, 'no anchor fallback was needed');
    assert.match(result.message, /userscript manager/);
  });

  test('passes the sub-folder to the manager but never to the anchor', async () => {
    clicks = [];
    const requests = [];
    const gm = managerWith({
      GM_download: (details) => {
        requests.push(details);
        details.onload();
        return { abort() {} };
      },
    });
    const result = await saveBlob({
      blob: blob(),
      filename: 'photo.png',
      path: 'refs/2026/photo.png',
      settings: Object.assign({}, SETTINGS, { subfolder: 'refs/2026' }),
      gm,
      downloadMode: 'browser',
    });
    assert.equal(requests[0].name, 'refs/2026/photo.png', 'manager receives the folder path');
    assert.equal(result.subfolderApplied, true);
    assert.equal(result.via, 'gm');
  });

  test('Save As is only claimed as honoured in browser download mode', async () => {
    const ok = managerWith({ GM_download: (d) => { d.onload(); return { abort() {} }; } });
    const asked = Object.assign({}, SETTINGS, { downloadBehavior: 'ask' });

    const browserMode = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: asked, gm: ok, downloadMode: 'browser' });
    assert.equal(browserMode.saveAsRequested, true);
    assert.equal(browserMode.saveAsHonoured, true);

    const nativeMode = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: asked, gm: ok, downloadMode: 'native' });
    assert.equal(nativeMode.saveAsRequested, true);
    assert.equal(nativeMode.saveAsHonoured, false);
    assert.match(nativeMode.message, /ask where to save/i, 'the user is told why no dialog appeared');
  });
});

describe('saveBlob — fallback to the browser', { skip: SKIP_DOM }, () => {
  before(installDom);

  test('a whitelisted-extension rejection falls back to an anchor download and says so', async () => {
    clicks = [];
    const gm = managerWith({ GM_download: (d) => { d.onerror({ error: 'not_whitelisted' }); return { abort() {} }; } });
    const result = await saveBlob({ blob: blob(10, 'image/bmp'), filename: 'icon.bmp', path: 'icon.bmp', settings: SETTINGS, gm, downloadMode: 'browser' });
    assert.equal(result.ok, true, 'the file was still saved');
    assert.equal(result.via, 'anchor');
    assert.equal(result.fallbackReason, 'not_whitelisted');
    assert.equal(clicks.length, 1, 'exactly one anchor click');
    assert.equal(clicks[0].download, 'icon.bmp');
    assert.match(clicks[0].href, /^blob:/);
    assert.equal(clicks[0].parent, 'HTML', 'the anchor was attached to the document, not left detached');
    assert.match(result.message, /manager download unavailable \(not_whitelisted\)/, 'the report explains the fallback');
  });

  test('every recoverable manager failure falls back; an unknown one does not', async () => {
    for (const reason of ['not_enabled', 'not_permitted', 'not_supported']) {
      clicks = [];
      const gm = managerWith({ GM_download: (d) => { d.onerror({ error: reason }); return { abort() {} }; } });
      const result = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'browser' });
      assert.equal(result.ok, true, `${reason}: recovered`);
      assert.equal(result.via, 'anchor', reason);
      assert.equal(result.fallbackReason, reason);
      assert.equal(clicks.length, 1, reason);
    }
    clicks = [];
    const gm = managerWith({ GM_download: (d) => { d.onerror({ error: 'disk-full-weirdness' }); return { abort() {} }; } });
    const result = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'browser' });
    assert.equal(result.ok, false, 'an unrecognised failure is not papered over');
    assert.equal(result.via, null);
    assert.equal(clicks.length, 0);
    assert.match(result.message, /disk-full-weirdness|failed/i);
  });

  test('timeout, thrown and ambiguous failures never repeat an uncertain save', async () => {
    for (const reason of ['timeout', 'threw', 'not_succeeded']) {
      clicks = [];
      const gm = managerWith({ GM_download: (d) => { d.onerror({ error: reason }); return { abort() {} }; } });
      const result = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'browser' });
      assert.equal(result.ok, false, reason);
      assert.equal(result.uncertain, true, reason);
      assert.equal(clicks.length, 0, 'no implicit second write');
      assert.match(result.message, /Check your downloads folder/);
    }
  });

  test('downloadMode "disabled" goes straight to the browser without trying GM_download', async () => {
    clicks = [];
    let attempted = 0;
    const gm = managerWith({ GM_download: (d) => { attempted += 1; d.onload(); return { abort() {} }; } });
    const result = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'disabled' });
    assert.equal(attempted, 0, 'no pointless manager call');
    assert.equal(result.ok, true);
    assert.equal(result.via, 'anchor');
    assert.equal(result.fallbackReason, 'download-mode-disabled');
  });

  test('without the GM_download grant the browser path is used', async () => {
    clicks = [];
    const gm = managerWith({});
    delete gm.capabilities.download;
    gm.capabilities.download = false;
    const result = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'unknown' });
    assert.equal(result.ok, true);
    assert.equal(result.via, 'anchor');
    assert.equal(result.fallbackReason, 'no-grant');
    assert.equal(clicks.length, 1);
  });

  test('the sub-folder is dropped on the anchor path and reported as dropped', async () => {
    clicks = [];
    const gm = managerWith({ GM_download: (d) => { d.onerror({ error: 'not_enabled' }); return { abort() {} }; } });
    const result = await saveBlob({
      blob: blob(),
      filename: 'a.png',
      path: 'refs/a.png',
      settings: Object.assign({}, SETTINGS, { subfolder: 'refs' }),
      gm,
      downloadMode: 'browser',
    });
    assert.equal(result.via, 'anchor');
    assert.equal(result.subfolderApplied, false, 'the folder cannot survive an anchor download, so it is not claimed');
    assert.equal(clicks[0].download, 'a.png', 'the anchor gets the bare file name, never a path');
    assert.ok(!clicks[0].download.includes('/'));
  });

  test('an empty blob is refused rather than downloading a 0-byte surprise', async () => {
    clicks = [];
    const gm = managerWith({ GM_download: (d) => { d.onload(); return { abort() {} }; } });
    const result = await saveBlob({ blob: new Blob([]), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'browser' });
    assert.equal(result.ok, false);
    assert.equal(result.via, null);
    assert.equal(clicks.length, 0);
    assert.match(result.message, /Nothing was produced/);
  });

  test('a throwing anchor click is reported as a failure', async () => {
    const gm = managerWith({});
    gm.capabilities.download = false;
    const original = dom.window.HTMLAnchorElement.prototype.click;
    dom.window.HTMLAnchorElement.prototype.click = function click() {
      throw new Error('blocked by the page');
    };
    const result = await saveBlob({ blob: blob(), filename: 'a.png', path: 'a.png', settings: SETTINGS, gm, downloadMode: 'unknown' });
    dom.window.HTMLAnchorElement.prototype.click = original;
    assert.equal(result.ok, false);
    assert.match(result.message, /blocked by the page/);
  });
});

describe('describeDownloadCapability — the wording shown in diagnostics', { skip: SKIP_DOM }, () => {
  test('explains each mode and what it means for folders and dialogs', () => {
    const gm = managerWith({ GM_download: (details) => { details.onload(); return { abort() {} }; } });
    assert.equal(gm.capabilities.download, true, 'precondition: the grant exists');
    assert.match(describeDownloadCapability(gm, 'browser'), /sub-folders both work/);
    assert.match(describeDownloadCapability(gm, 'native'), /sub-folders and forced Save As do not/);
    assert.match(describeDownloadCapability(gm, 'disabled'), /disabled/);
    assert.match(describeDownloadCapability(gm, 'unknown'), /falls back/);
    const noGrant = managerWith({});
    assert.equal(noGrant.capabilities.download, false);
    assert.match(describeDownloadCapability(noGrant, 'browser'), /not granted/);
  });
});
