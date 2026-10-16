import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCAN_LIMITS,
  scanImages,
  parseSrcset,
  dedupeEntries,
  filterEntries,
  sortEntries,
  summarizeInventory,
  describeEntryState,
  createThumbnail,
  observeInventory,
} from '../../src/core/scan.js';

/**
 * Feature: page image inventory (the picker's data source).
 *
 * Two rules are tested here because they are the ones a user would notice:
 *   1. scanning never touches the network — a preview that would need a
 *      download is reported as unavailable instead of being fetched;
 *   2. the work is bounded — a page with thousands of nodes cannot turn the
 *      inventory into a full crawl, and the truncation is reported.
 */

let JSDOM = null;
let SKIP_DOM = false;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (err) {
  SKIP_DOM = `jsdom unavailable (${err.code || err.message}) — run \`npm install\` to enable the DOM tests`;
}

const PAGE = `<!doctype html><html><head><title>Gallery</title></head><body>
  <img id="loaded" src="/fixtures/opaque.png" alt="Opaque red" width="200" height="140">
  <img id="lazy" data-src="https://cdn.example/deferred.jpg" alt="Deferred">
  <img id="broken" src="/missing.png" alt="Missing">
  <img id="empty" alt="No source at all">
  <img id="cross" src="https://cdn.example/photo.jpg" alt="Cross origin">
  <img id="set" src="/fixtures/small.png" srcset="/fixtures/small.png 200w, /fixtures/big.png 1600w" alt="Srcset">
  <div id="bg" style="background-image:url('/assets/painted.png')">painted</div>
  <svg id="inline" viewBox="0 0 64 48"><rect width="64" height="48" fill="red"/></svg>
  <video id="vid" poster="/fixtures/poster.jpg"></video>
  <div id="host-el"></div>
  <iframe id="frame" src="/frame.html"></iframe>
</body></html>`;

let dom = null;
let doc = null;
let network = null;

/** Simulate what a browser would report for each image, without loading any. */
function simulateLoading() {
  const states = {
    loaded: { natural: [200, 140], complete: true, rect: [200, 140] },
    lazy: { natural: [0, 0], complete: false, rect: [0, 0] },
    broken: { natural: [0, 0], complete: true, rect: [16, 16] },
    empty: { natural: [0, 0], complete: true, rect: [0, 0] },
    cross: { natural: [800, 600], complete: true, rect: [400, 300] },
    set: { natural: [200, 150], complete: true, rect: [200, 150] },
    'shadow-img': { natural: [320, 240], complete: true, rect: [320, 240] },
  };
  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const state = states[image.id] || { natural: [0, 0], complete: false, rect: [0, 0] };
    Object.defineProperty(image, 'naturalWidth', { value: state.natural[0], configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: state.natural[1], configurable: true });
    Object.defineProperty(image, 'complete', { value: state.complete, configurable: true });
    image.getBoundingClientRect = () => ({ width: state.rect[0], height: state.rect[1], top: 0, left: 0, bottom: state.rect[1], right: state.rect[0] });
  }
  const svg = doc.getElementById('inline');
  if (svg) svg.getBoundingClientRect = () => ({ width: 64, height: 48, top: 0, left: 0, bottom: 48, right: 64 });
  const bg = doc.getElementById('bg');
  if (bg) bg.getBoundingClientRect = () => ({ width: 300, height: 200, top: 0, left: 0, bottom: 200, right: 300 });
}

function installDom({ withShadow = true } = {}) {
  dom = new JSDOM(PAGE, { url: 'https://page.example/gallery', pretendToBeVisual: true });
  doc = dom.window.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.URL = dom.window.URL;

  // Count every route out of the page, so "no network" is an observed fact.
  network = { fetch: 0, xhr: 0, imageLoads: 0 };
  dom.window.fetch = () => {
    network.fetch += 1;
    return Promise.reject(new Error('network use during a scan is a test failure'));
  };
  dom.window.XMLHttpRequest = class {
    open() {
      network.xhr += 1;
    }
    send() {
      network.xhr += 1;
    }
  };
  const srcDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLImageElement.prototype, 'src');
  Object.defineProperty(dom.window.HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() {
      return srcDescriptor.get.call(this);
    },
    set(value) {
      network.imageLoads += 1;
      srcDescriptor.set.call(this, value);
    },
  });

  if (withShadow) {
    const host = doc.getElementById('host-el');
    const shadow = host.attachShadow({ mode: 'open' });
    const image = doc.createElement('img');
    image.id = 'shadow-img';
    image.setAttribute('src', '/fixtures/in-component.png');
    image.setAttribute('alt', 'Inside a web component');
    shadow.appendChild(image);
  }
  simulateLoading();
}

function teardownDom() {
  if (!dom) return;
  dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element']) delete globalThis[key];
}

const byId = (entries, id) => entries.find((entry) => entry.element && entry.element.id === id);
const scan = (options) => scanImages(doc, Object.assign({ includeBackgrounds: true, maxStyleScan: 500, maxEntries: 100 }, options));

describe('scan — the inventory of a mixed page', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('every kind of image source is found and described', () => {
    const result = scan();
    const kinds = result.entries.map((entry) => entry.kind);
    assert.ok(kinds.filter((kind) => kind === 'img').length >= 6, `<img> elements: ${kinds.filter((k) => k === 'img').length}`);
    assert.ok(kinds.includes('background'), 'a CSS background image is listed');
    assert.ok(kinds.includes('svg'), 'an inline <svg> is listed');
    assert.ok(kinds.includes('poster'), 'a <video poster> is listed');
    assert.ok(typeof result.scanned === 'number' && result.scanned > 0);
    assert.equal(result.truncated, false);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.frames && typeof result.frames.scanned === 'number');

    const loaded = byId(result.entries, 'loaded');
    assert.equal(loaded.state, 'loaded');
    assert.equal(loaded.natural.width, 200);
    assert.equal(loaded.displayed.width, 200);
    assert.equal(loaded.alt, 'Opaque red');
    assert.equal(loaded.mime, 'image/png');
    assert.equal(loaded.sameOrigin, true);
    assert.equal(loaded.tiny, false);
    assert.equal(loaded.visible, true);

    assert.equal(byId(result.entries, 'lazy').state, 'lazy', 'a data-src image is reported as not loaded');
    assert.equal(byId(result.entries, 'broken').state, 'broken');
    assert.equal(byId(result.entries, 'empty').state, 'empty');
    assert.equal(byId(result.entries, 'cross').sameOrigin, false, 'a CDN image is marked cross-origin');
  });

  test('URLs are absolute, so the host column and de-duplication are meaningful', () => {
    const result = scan();
    const loaded = byId(result.entries, 'loaded');
    assert.equal(loaded.url, 'https://page.example/fixtures/opaque.png', 'a root-relative src is resolved against the document');
    assert.equal(loaded.host, 'page.example');
    assert.equal(loaded.protocol, 'https');
    const background = result.entries.find((entry) => entry.kind === 'background');
    assert.equal(background.url, 'https://page.example/assets/painted.png');
    assert.equal(byId(result.entries, 'cross').host, 'cdn.example');
  });

  test('ids are sequential and identical across re-scans of an unchanged page', () => {
    const first = scan();
    const second = scan();
    assert.deepEqual(
      first.entries.map((entry) => entry.id),
      second.entries.map((entry) => entry.id),
      'a re-scan cannot renumber the inventory',
    );
    assert.deepEqual(first.entries.map((entry) => entry.id), first.entries.map((_, index) => `image-${index + 1}`));
    assert.deepEqual(
      first.entries.map((entry) => entry.url),
      second.entries.map((entry) => entry.url),
    );
  });

  test('REGRESSION: images inside an open shadow root are inventoried with backgrounds on and off', () => {
    for (const includeBackgrounds of [true, false]) {
      const result = scan({ includeBackgrounds });
      const inside = result.entries.find((entry) => entry.inShadowRoot);
      assert.ok(inside, `the component image is listed (includeBackgrounds=${includeBackgrounds})`);
      assert.equal(inside.url, 'https://page.example/fixtures/in-component.png');
      assert.equal(inside.alt, 'Inside a web component');
    }
    const withoutShadow = (() => {
      teardownDom();
      installDom({ withShadow: false });
      return scan();
    })();
    assert.equal(withoutShadow.entries.some((entry) => entry.inShadowRoot), false, 'no phantom entries when there is no shadow root');
  });

  test('srcset candidates are parsed and the largest variant is reported', () => {
    const result = scan();
    const entry = byId(result.entries, 'set');
    assert.ok(entry.candidates.length >= 2, `candidates: ${JSON.stringify(entry.candidates)}`);
    assert.ok(entry.largest, 'a larger variant is offered');
    assert.match(entry.largest.url, /big\.png$/);
    assert.equal(entry.largest.width, 1600);

    const parsed = parseSrcset('/a.png 100w, /b.png 2x, /c.png', doc);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].width, 100);
    assert.equal(parsed[1].density, 2);
    assert.deepEqual(parseSrcset('', doc), []);
    assert.deepEqual(parseSrcset(null, doc), []);
  });

  test('the scan does not modify the page', () => {
    const before = doc.documentElement.outerHTML;
    scan();
    scan({ includeBackgrounds: false });
    assert.equal(doc.documentElement.outerHTML, before, 'no attribute, node or style was added');
    assert.deepEqual(network, { fetch: 0, xhr: 0, imageLoads: 0 }, 'and nothing was requested');
  });

  test('work is bounded and the truncation is reported', () => {
    const capped = scan({ maxEntries: 3 });
    assert.equal(capped.entries.length, 3);
    assert.equal(capped.truncated, true);
    assert.ok(capped.notes.some((note) => /Stopped at 3|limited to 3/.test(note)), capped.notes.join(' | '));

    const styleCapped = scan({ maxStyleScan: 2, includeBackgrounds: true });
    assert.ok(styleCapped.notes.some((note) => /Background scanning stopped after 2/.test(note)), styleCapped.notes.join(' | '));

    assert.equal(SCAN_LIMITS.maxEntries, 1000);
    assert.equal(SCAN_LIMITS.maxStyleScan, 2500);
    assert.ok(SCAN_LIMITS.maxFrames <= 16, 'iframe descent is capped');
  });

  test('a document with no body, or no document at all, yields an honest empty result', () => {
    assert.deepEqual(scanImages(null).entries, []);
    assert.ok(scanImages(null).notes.some((note) => /no document/.test(note)));
    assert.deepEqual(scanImages({}).entries, []);
    const empty = new JSDOM('<!doctype html><html><head></head></html>', { url: 'https://page.example/' });
    const result = scanImages(empty.window.document, { includeBackgrounds: true });
    assert.deepEqual(result.entries, []);
    assert.equal(result.truncated, false);
    empty.window.close();
  });
});

describe('scan — filtering, de-duplication, sorting and totals', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('filters combine, and "0 or empty" always means off', () => {
    const entries = scan().entries;
    assert.equal(filterEntries(entries, {}).length, entries.length, 'an empty filter changes nothing');
    assert.equal(filterEntries(entries, { minWidth: 0, minHeight: 0 }).length, entries.length);

    const loadedOnly = filterEntries(entries, { loadedOnly: true });
    assert.ok(loadedOnly.every((entry) => entry.state === 'loaded'));
    assert.ok(loadedOnly.length < entries.length, 'the lazy/broken/empty rows are gone');

    const sameOrigin = filterEntries(entries, { sameOriginOnly: true });
    assert.ok(sameOrigin.every((entry) => entry.sameOrigin));
    assert.equal(sameOrigin.some((entry) => entry.host === 'cdn.example'), false);

    const big = filterEntries(entries, { minWidth: 300 });
    assert.ok(big.every((entry) => (entry.natural.width || entry.displayed.width) >= 300));
    assert.ok(big.some((entry) => entry.element && entry.element.id === 'cross'));

    const kinds = filterEntries(entries, { kinds: ['svg', 'poster'] });
    assert.deepEqual(kinds.map((entry) => entry.kind).sort(), ['poster', 'svg']);

    const query = filterEntries(entries, { query: 'deferred' });
    assert.equal(query.length, 1);
    assert.equal(query[0].element.id, 'lazy');
    assert.equal(filterEntries(entries, { query: 'NOTHING MATCHES THIS' }).length, 0);
    assert.equal(filterEntries(entries, { query: 'OPAQUE' }).length, 1, 'the query is case-insensitive');
    assert.deepEqual(filterEntries(null, {}), []);
  });

  test('tiny images are flagged and can be excluded', () => {
    const entries = scan().entries;
    // jsdom reports the broken image as 16×16 on screen: icon-sized.
    const tiny = filterEntries(entries, { excludeTiny: true });
    assert.ok(tiny.every((entry) => !entry.tiny));
    assert.ok(tiny.length < entries.length, 'something was excluded');
  });

  test('de-duplication merges identical URLs but keeps distinct sources', () => {
    const entries = scan().entries;
    const doubled = entries.concat(entries.slice(0, 2));
    const unique = dedupeEntries(doubled);
    assert.equal(unique.length, entries.length, 'the duplicates were merged');
    const urls = unique.map((entry) => entry.url).filter(Boolean);
    assert.equal(new Set(urls).size, urls.length, 'every listed URL appears once');
    assert.deepEqual(dedupeEntries(null), []);
    // Entries with no URL (an inline <svg>) are keyed by identity, not merged.
    const svgs = [entries.find((entry) => entry.kind === 'svg')];
    assert.equal(dedupeEntries(svgs.concat(svgs)).length, 1, 'the same element is still one entry');
  });

  test('sorting is stable and every key is supported', () => {
    const entries = scan().entries;
    for (const key of ['area-desc', 'area-asc', 'name', 'type', 'state', 'order', 'nonsense']) {
      const sorted = sortEntries(entries, key);
      assert.equal(sorted.length, entries.length, `${key} keeps every entry`);
      assert.notEqual(sorted, entries, `${key} returns a copy, not the scanned array`);
    }
    const byArea = sortEntries(entries, 'area-desc');
    const areas = byArea.map((entry) => (entry.natural.width || entry.displayed.width) * (entry.natural.height || entry.displayed.height));
    for (let i = 1; i < areas.length; i += 1) assert.ok(areas[i] <= areas[i - 1], 'descending by pixel area');
    const byName = sortEntries(entries, 'name');
    const names = byName.map((entry) => String(entry.url || entry.alt || entry.id));
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(sortEntries(null), []);
  });

  test('the summary counts what the picker header shows', () => {
    const entries = scan().entries;
    const summary = summarizeInventory(entries);
    assert.equal(summary.total, entries.length);
    assert.equal(summary.loaded + summary.notLoaded + summary.broken, summary.total, 'every entry is accounted for');
    assert.ok(summary.crossOrigin >= 1, 'the CDN image is counted as cross-origin');
    assert.ok(summary.svg >= 1);
    assert.ok(summary.background >= 1);
    assert.ok(summary.poster >= 1);
    assert.ok(summary.uniqueUrls >= 1);
    assert.equal(summary.uniqueUrls, new Set(entries.map((e) => e.url).filter(Boolean)).size);
    assert.ok(summary.megapixels >= 0);
    assert.equal(summary.pixels, entries.reduce((total, e) => total + (e.natural.width || 0) * (e.natural.height || 0), 0));
    assert.deepEqual(summarizeInventory([]), summarizeInventory([]), 'deterministic');
    assert.equal(summarizeInventory(null).total, 0);
  });

  test('entry states are described in words a user can act on', () => {
    assert.equal(describeEntryState({ state: 'loaded' }), 'loaded');
    assert.equal(describeEntryState({ state: 'lazy' }), 'not loaded yet (lazy)');
    assert.equal(describeEntryState({ state: 'broken' }), 'failed to load');
    assert.equal(describeEntryState({ state: 'pending' }), 'still loading');
    assert.equal(describeEntryState({ state: 'empty' }), 'no source');
    assert.equal(describeEntryState({ state: 'weird' }), 'weird', 'an unknown state is passed through, not hidden');
    assert.equal(describeEntryState(null), 'unknown');
  });
});

describe('scan — thumbnails without touching the network', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  /** A canvas that pretends to work, so no real rasteriser is needed. */
  const fakeCanvas = (failWith = null) => (width, height) => ({
    canvas: {
      width,
      height,
      toDataURL: () => 'data:image/png;base64,THUMB',
    },
    ctx: {
      drawImage() {
        if (failWith) throw failWith;
      },
    },
  });

  test('a loaded image gets a thumbnail drawn from pixels the page already decoded', async () => {
    const entries = scan().entries;
    const result = await createThumbnail(byId(entries, 'loaded'), { size: 64, createCanvas: fakeCanvas() });
    assert.equal(result.dataUrl, 'data:image/png;base64,THUMB');
    assert.deepEqual(network, { fetch: 0, xhr: 0, imageLoads: 0 }, 'no request was made for the preview');
  });

  test('the thumbnail keeps the aspect ratio and never upscales', async () => {
    let created = null;
    const spy = (width, height) => {
      created = { width, height };
      return fakeCanvas()(width, height);
    };
    const entries = scan().entries;
    await createThumbnail(byId(entries, 'loaded'), { size: 100, createCanvas: spy });
    assert.deepEqual(created, { width: 100, height: 70 }, '200×140 scaled into a 100px box');
    await createThumbnail(byId(entries, 'loaded'), { size: 400, createCanvas: spy });
    assert.deepEqual(created, { width: 200, height: 140 }, 'a bigger box does not upscale the source');
  });

  test('an image the page has not loaded gets a reason instead of a download', async () => {
    const entries = scan().entries;
    for (const id of ['lazy', 'broken', 'empty']) {
      const result = await createThumbnail(byId(entries, id), { size: 64, createCanvas: fakeCanvas() });
      assert.equal(result.dataUrl, null, `${id}: no thumbnail`);
      assert.match(result.reason, /not been loaded|no pixel dimensions|no preview/i, `${id}: ${result.reason}`);
    }
    assert.deepEqual(network, { fetch: 0, xhr: 0, imageLoads: 0 }, 'nothing was fetched for a preview');
  });

  test('a background image explains that a preview would cost a download', async () => {
    const entries = scan().entries;
    const background = entries.find((entry) => entry.kind === 'background');
    const result = await createThumbnail(background, { size: 64, createCanvas: fakeCanvas() });
    assert.equal(result.dataUrl, null);
    assert.match(result.reason, /painted by the page/, 'the background-specific reason, not the generic one');
    assert.deepEqual(network, { fetch: 0, xhr: 0, imageLoads: 0 });
  });

  test('a cross-origin image whose pixels cannot be read reports that honestly', async () => {
    const security = new Error('tainted canvas');
    security.name = 'SecurityError';
    const entries = scan().entries;
    const result = await createThumbnail(byId(entries, 'cross'), { size: 64, createCanvas: fakeCanvas(security) });
    assert.equal(result.dataUrl, null);
    assert.match(result.reason, /Cross-origin image/);
  });

  test('without a canvas, or without an entry, the answer is a reason, not a crash', async () => {
    const entries = scan().entries;
    assert.match((await createThumbnail(byId(entries, 'loaded'), {})).reason, /Canvas is not available/);
    assert.equal((await createThumbnail(null, { createCanvas: fakeCanvas() })).reason, 'No image.');
  });

  test('an inline SVG is rasterised locally through an object URL, never fetched', async () => {
    const entries = scan().entries;
    const svg = entries.find((entry) => entry.kind === 'svg');
    const seen = [];
    const result = await createThumbnail(svg, {
      size: 64,
      createCanvas: fakeCanvas(),
      svgToObjectUrl: (element) => {
        seen.push(element.tagName);
        return 'blob:local-svg';
      },
      loadImage: async (url) => {
        seen.push(url);
        return { naturalWidth: 64, naturalHeight: 48, width: 64, height: 48 };
      },
    });
    assert.equal(result.dataUrl, 'data:image/png;base64,THUMB');
    assert.deepEqual(seen, ['svg', 'blob:local-svg'], 'the local markup was used, not a URL fetch');
    assert.deepEqual(network, { fetch: 0, xhr: 0, imageLoads: 0 });

    // Without the SVG helpers the answer is a reason, and still no request.
    const plain = await createThumbnail(svg, { size: 64, createCanvas: fakeCanvas() });
    assert.equal(plain.dataUrl, null);
    assert.deepEqual(network, { fetch: 0, xhr: 0, imageLoads: 0 });
  });

  test('the module source itself contains no network call', () => {
    const code = readFileSync(new URL('../../src/core/scan.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    assert.equal(/\bfetch\s*\(/.test(code), false, 'no fetch()');
    assert.equal(/XMLHttpRequest/.test(code), false, 'no XHR');
    assert.equal(/\.src\s*=[^=]/.test(code), false, 'no src assignment (which would start a load)');
    assert.equal(/GM_xmlhttpRequest/.test(code), false, 'no manager request');
  });
});

describe('scan — watching the inventory', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test('mutations are debounced into one notification', async () => {
    let notifications = 0;
    const observer = observeInventory(doc, () => {
      notifications += 1;
    }, { debounceMs: 60 });
    assert.equal(observer.supported, true);
    for (let i = 0; i < 5; i += 1) {
      const image = doc.createElement('img');
      image.setAttribute('src', `/added-${i}.png`);
      doc.body.appendChild(image);
    }
    await wait(30);
    assert.equal(notifications, 0, 'nothing fires while mutations keep arriving');
    await wait(120);
    assert.equal(notifications, 1, 'five mutations became one notification');
    observer.disconnect();
  });

  test('the notification cap stops an infinite-scroll page from re-scanning forever', async () => {
    let notifications = 0;
    const observer = observeInventory(doc, () => {
      notifications += 1;
    }, { debounceMs: 50, maxNotifications: 2 });
    for (let round = 0; round < 6; round += 1) {
      const image = doc.createElement('img');
      image.setAttribute('src', `/scroll-${round}.png`);
      doc.body.appendChild(image);
      await wait(70);
    }
    assert.equal(notifications, 2, `capped at 2 (got ${notifications})`);
    observer.disconnect();
  });

  test('disconnect stops notifications, and text-only changes are ignored', async () => {
    let notifications = 0;
    const observer = observeInventory(doc, () => {
      notifications += 1;
    }, { debounceMs: 50 });
    // `class` is not in the observed attribute filter, so a style-only rename
    // must not cost a re-scan.
    doc.getElementById('bg').setAttribute('class', 'renamed');
    doc.getElementById('loaded').setAttribute('title', 'a tooltip');
    await wait(120);
    assert.equal(notifications, 0, 'an unobserved attribute change cannot introduce an image');

    const image = doc.createElement('img');
    doc.body.appendChild(image);
    await wait(120);
    assert.equal(notifications, 1);

    observer.disconnect();
    const another = doc.createElement('img');
    doc.body.appendChild(another);
    await wait(120);
    assert.equal(notifications, 1, 'nothing after disconnect');
  });

  test('an attribute change on src/srcset/style/poster is relevant', async () => {
    let notifications = 0;
    const observer = observeInventory(doc, () => {
      notifications += 1;
    }, { debounceMs: 50 });
    doc.getElementById('loaded').setAttribute('src', '/fixtures/other.png');
    await wait(120);
    assert.equal(notifications, 1, 'a src swap is worth a re-scan');
    observer.disconnect();
  });

  test('without a MutationObserver the answer is "unsupported", not a crash', () => {
    const observer = observeInventory({ defaultView: {} }, () => {});
    assert.equal(observer.supported, false);
    observer.disconnect();
    assert.equal(observeInventory(null, () => {}).supported, false);
  });
});

describe('scan — hard-bound and cleanup regressions', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('a skipped subtree does not skip its later siblings', () => {
    const script = doc.createElement('script');
    doc.body.prepend(script);
    const result = scan();
    assert.ok(result.entries.some((e) => e.kind === 'background'), 'background after script still found');
    assert.ok(result.entries.some((e) => e.inShadowRoot), 'shadow host after script still found');
  });

  test('frame descent stops at the hard limit and announces truncation', () => {
    for (let i = 0; i < 12; i++) doc.body.appendChild(doc.createElement('iframe'));
    const result = scan({ includeFrames: true });
    assert.equal(result.frames.scanned, SCAN_LIMITS.maxFrames);
    assert.equal(result.truncated, true);
    assert.ok(result.notes.some((x) => /Frame scanning stopped/.test(x)));
  });

  test('an SVG preview failure still revokes the local object URL', async () => {
    const revoked = [];
    dom.window.URL.revokeObjectURL = (url) => revoked.push(url);
    const svg = scan().entries.find((e) => e.kind === 'svg');
    const result = await createThumbnail(svg, {
      svgToObjectUrl: () => 'blob:failed-preview',
      loadImage: async () => { throw new Error('decode failed'); },
    });
    assert.equal(result.dataUrl, null);
    assert.deepEqual(revoked, ['blob:failed-preview']);
  });
});
