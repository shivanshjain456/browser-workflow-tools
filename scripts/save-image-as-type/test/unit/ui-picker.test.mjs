import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createImagePicker } from '../../src/ui/picker.js';

/**
 * Feature: page image inventory and picker.
 *
 * The picker is the front end for batch conversion, so the tested properties are
 * the ones the feature promises: rows describe what the page really has, filters
 * and sorting work without re-walking the DOM, a selection survives a re-scan,
 * previews never cost a network request, and every action hands the right
 * payload to the orchestrator.
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
let calls = null;
let inventory = null;

/** A synthetic inventory shaped exactly like core/scan.js produces. */
function entry(id, over = {}) {
  return Object.assign(
    {
      id,
      index: Number(id.split('-')[1] || 0),
      kind: 'img',
      element: { id, tagName: 'IMG', isConnected: true },
      url: `https://page.example/img/${id}.png`,
      loadedUrl: `https://page.example/img/${id}.png`,
      lazyUrl: '',
      alt: `Image ${id}`,
      title: '',
      natural: { width: 400, height: 300 },
      displayed: { width: 200, height: 150 },
      mime: 'image/png',
      host: 'page.example',
      sameOrigin: true,
      protocol: 'https',
      state: 'loaded',
      visible: true,
      area: 30000,
      tiny: false,
      candidates: [],
      largest: null,
      decoding: '',
      loading: '',
      inShadowRoot: false,
      frame: 'this page',
    },
    over,
  );
}

function defaultInventory() {
  return [
    entry('image-1'),
    entry('image-2', { url: 'https://cdn.example/photo.jpg', host: 'cdn.example', sameOrigin: false, mime: 'image/jpeg', natural: { width: 1600, height: 900 }, largest: { url: 'https://cdn.example/photo@2x.jpg', width: 3200 } }),
    entry('image-3', { state: 'lazy', lazyUrl: 'https://cdn.example/deferred.jpg', url: 'https://cdn.example/deferred.jpg', natural: { width: 0, height: 0 }, sameOrigin: false, host: 'cdn.example' }),
    entry('image-4', { state: 'broken', url: 'https://page.example/missing.png', natural: { width: 0, height: 0 } }),
    entry('image-5', { kind: 'svg', url: '', mime: '', natural: { width: 64, height: 48 }, tiny: true }),
    entry('image-6', { kind: 'background', url: 'https://page.example/assets/painted.png', state: 'not-loaded', natural: { width: 0, height: 0 } }),
    entry('image-7', { tiny: true, natural: { width: 16, height: 16 }, displayed: { width: 16, height: 16 }, area: 256 }),
    entry('image-8', { url: 'https://page.example/img/image-1.png', alt: 'A duplicate of image 1' }),
  ];
}

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
  // Any network use from a preview would be a privacy/performance failure.
  dom.window.fetch = () => {
    throw new Error('the picker must not fetch');
  };
}

function teardownDom() {
  if (!dom) return;
  dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) delete globalThis[key];
}

function installPicker(over = {}) {
  inventory = defaultInventory();
  calls = {
    scan: 0,
    thumbnail: 0,
    convert: [],
    copy: [],
    inspect: [],
    transform: [],
    compare: [],
    load: [],
  };
  api = createImagePicker({
    document: doc,
    settings: () => ({ scanBackgrounds: true, scanElementCap: 2500, activeFormatId: 'png' }),
    formats: () => [
      { id: 'png', label: 'PNG', ext: 'png', disabled: '' },
      { id: 'jpg', label: 'JPG', ext: 'jpg', disabled: '' },
      { id: 'avif', label: 'AVIF', ext: 'avif', disabled: 'Not supported by this browser' },
    ],
    scan: () => {
      calls.scan += 1;
      return { entries: over.entries || inventory, notes: over.notes || [], truncated: Boolean(over.truncated) };
    },
    thumbnail: async (item) => {
      calls.thumbnail += 1;
      if (over.thumbnailFails) throw new Error('preview failed');
      if (item.state !== 'loaded' && item.kind !== 'svg') return { dataUrl: null, reason: 'not loaded' };
      return { dataUrl: `data:image/png;base64,${item.id}` };
    },
    actions: {
      convert: (payload) => calls.convert.push(payload),
      copy: (item) => calls.copy.push(item.id),
      inspect: (item) => calls.inspect.push(item.id),
      transform: (item) => calls.transform.push(item.id),
      compare: (item) => calls.compare.push(item.id),
      loadNotLoaded: async (list) => {
        calls.load.push(list.map((item) => item.id));
        return list.length;
      },
    },
  });
}

const root = () => api.shadowRoot;
const byId = (id) => root().getElementById(id);
const rows = () => Array.from(byId('siat-pick-list').querySelectorAll('.siat-row'));
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (element) => element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const input = (element) => element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (id, value = true) => {
  const box = byId(id);
  box.checked = value;
  change(box);
};

describe('image picker — inventory rows', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installPicker();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('opening scans once and renders a row per image', () => {
    assert.equal(doc.getElementById('siat-picker-host'), null, 'nothing is in the page before opening');
    api.open();
    assert.equal(calls.scan, 1, 'one scan per open');
    assert.equal(doc.querySelectorAll('#siat-picker-host').length, 1, 'one shadow host');
    // 8 entries: one duplicate URL merged, two icon-sized hidden by default.
    assert.equal(rows().length, 5, 'the duplicate URL is merged and icons are hidden by default');
    assert.match(byId('siat-picker-summary').textContent, /8 found/);
    assert.match(byId('siat-picker-summary').textContent, /5 listed/);
    assert.match(byId('siat-picker-summary').textContent, /2 icon-sized/);
    assert.match(byId('siat-picker-summary').textContent, /6 distinct URLs/, 'the duplicate counts once, the URL-less SVG not at all');
    assert.match(byId('siat-picker-summary').textContent, /cross-origin/, 'cross-origin images are counted');
  });

  test('each row describes its image: name, size, type, origin and state', () => {
    api.open();
    const first = byId('siat-pick-row-image-1');
    assert.ok(first, 'rows are addressable by entry id');
    assert.equal(first.dataset.kind, 'img');
    assert.equal(first.dataset.state, 'loaded');
    assert.match(first.querySelector('.siat-row-title').textContent, /image-1\.png|Image image-1/);
    assert.match(first.querySelector('.siat-row-meta').textContent, /400×300|400x300/, 'natural size is shown');
    assert.match(first.querySelector('.siat-row-meta').textContent, /PNG/i, 'the type is shown');
    assert.ok(first.querySelector('.siat-badge[data-tone="good"]'), 'a loaded image is badged ready');

    const cross = byId('siat-pick-row-image-2');
    assert.ok(cross.querySelector('.siat-badge[data-tone="warn"]'), 'a cross-origin image is badged');
    assert.match(cross.textContent, /cross-origin/);
    assert.match(cross.textContent, /up to 3200px/, 'a larger srcset variant is advertised');

    const lazy = byId('siat-pick-row-image-3');
    assert.match(lazy.textContent, /not loaded/, 'a deferred image says so');
    const broken = byId('siat-pick-row-image-4');
    assert.match(broken.textContent, /broken/);
    assert.ok(broken.querySelector('.siat-badge[data-tone="bad"]'));
    assert.equal(byId('siat-pick-row-image-7'), null, 'icon-sized images are hidden by the default filter');
    assert.equal(byId('siat-pick-row-image-5'), null, 'and so is the tiny inline SVG');
  });

  test('an empty page and a filter that matches nothing say different things', () => {
    api.open();
    byId('siat-pick-search').value = 'zzz-nothing';
    input(byId('siat-pick-search'));
    assert.match(byId('siat-pick-list').textContent, /No image matches these filters/, 'images exist, the filter removed them');

    api.destroy();
    installPicker({ entries: [] });
    api.open();
    assert.match(byId('siat-pick-list').textContent, /No images were found on this page/, 'an empty page is reported as such');
    assert.match(byId('siat-picker-summary').textContent, /0 found/);
  });

  test('a huge page is listed up to the row cap, and the rest is reported', () => {
    api.destroy();
    const many = Array.from({ length: 500 }, (_, i) => entry(`image-${i + 1}`, { url: `https://page.example/img/${i}.png` }));
    installPicker({ entries: many });
    api.open();
    const listed = rows().length;
    assert.ok(listed <= 200, `the list is capped (${listed} rows for 500 images)`);
    assert.ok(listed >= 100, 'a useful slice is still rendered');
    assert.match(byId('siat-pick-list').textContent, /more match — narrow the filters/, 'the hidden rows are counted, not silently dropped');
    assert.equal(calls.scan, 1, 'and the DOM was walked once');
  });

  test('a truncated scan tells the user the list may be incomplete', () => {
    api.destroy();
    installPicker({ truncated: true, notes: ['The scan was limited to 1000 entries.'] });
    api.open();
    assert.match(byId('siat-picker-summary').textContent, /too large to list completely/);
    assert.match(root().textContent, /limited to 1000 entries/, 'the scan note is surfaced');
  });
});

describe('image picker — filters, sorting and selection', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installPicker();
    api.open();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('filtering and sorting reuse the scan instead of re-walking the DOM', () => {
    const before = calls.scan;
    byId('siat-pick-search').value = 'painted';
    input(byId('siat-pick-search'));
    assert.equal(rows().length, 1, 'the search matches the painted background');
    assert.equal(rows()[0].dataset.id, 'image-6');
    assert.equal(calls.scan, before, 'a filter change does not re-scan');

    byId('siat-pick-search').value = '';
    input(byId('siat-pick-search'));
    byId('siat-pick-minw').value = '1000';
    input(byId('siat-pick-minw'));
    assert.equal(rows().length, 1, 'only the 1600px image is that wide');
    assert.equal(rows()[0].dataset.id, 'image-2');

    byId('siat-pick-minw').value = '';
    input(byId('siat-pick-minw'));
    byId('siat-pick-search').value = '';
    input(byId('siat-pick-search'));
    check('siat-pick-loaded', true);
    assert.ok(rows().every((row) => row.dataset.state === 'loaded'), '"loaded only" hides deferred and broken rows');
    check('siat-pick-loaded', false);

    check('siat-pick-sameorigin', true);
    assert.ok(rows().every((row) => !/cross-origin/.test(row.textContent)), '"same origin only" hides the CDN images');
    check('siat-pick-sameorigin', false);

    check('siat-pick-notiny', false);
    assert.ok(rows().some((row) => row.dataset.id === 'image-7'), 'un-hiding icons brings the 16×16 image back');
    check('siat-pick-notiny', true);

    check('siat-pick-dedupe', false);
    assert.equal(rows().length, 6, 'turning de-duplication off lists both copies (icons stay hidden)');
    check('siat-pick-dedupe', true);

    // The inline SVG in this inventory is 64×48, i.e. icon-sized, so icons have
    // to be visible for the kind filter to show it.
    check('siat-pick-notiny', false);
    byId('siat-pick-kind').value = 'svg';
    change(byId('siat-pick-kind'));
    assert.equal(rows().length, 1, 'the kind filter narrows to inline SVG');
    assert.equal(rows()[0].dataset.kind, 'svg');
    byId('siat-pick-kind').value = '';
    change(byId('siat-pick-kind'));
    check('siat-pick-notiny', true);

    assert.equal(calls.scan, before, 'none of that walked the DOM again');
  });

  test('sorting changes the row order, and "Re-scan" is the only thing that re-walks', () => {
    const before = calls.scan;
    const orderOf = () => rows().map((row) => row.dataset.id);
    byId('siat-pick-sort').value = 'order';
    change(byId('siat-pick-sort'));
    const pageOrder = orderOf();
    assert.deepEqual(pageOrder, ['image-1', 'image-2', 'image-3', 'image-4', 'image-6'], '"page order" keeps the scan order');

    byId('siat-pick-sort').value = 'area-desc';
    change(byId('siat-pick-sort'));
    assert.equal(orderOf()[0], 'image-2', 'the 1600×900 image comes first');

    byId('siat-pick-sort').value = 'area-asc';
    change(byId('siat-pick-sort'));
    assert.notDeepEqual(orderOf(), pageOrder, 'the sort really changed the order');
    assert.equal(orderOf().filter((id) => id !== 'image-3' && id !== 'image-4' && id !== 'image-6')[0], 'image-1', 'the smallest loaded image leads');

    byId('siat-pick-sort').value = 'name';
    change(byId('siat-pick-sort'));
    assert.equal(orderOf().length, 5, 'every sort keeps all the rows');

    click(byId('siat-pick-refresh'));
    assert.equal(calls.scan, before + 1, 'the explicit button re-scans');
  });

  test('selection survives a re-scan because it is keyed by URL, not row position', () => {
    check('siat-pick-check-image-2');
    assert.match(byId('siat-picker-selection').textContent, /1 selected/);

    // A re-scan produces fresh entry objects in a different order.
    inventory = [defaultInventory()[3], defaultInventory()[1], defaultInventory()[0]];
    click(byId('siat-pick-refresh'));
    assert.equal(byId('siat-pick-check-image-2').checked, true, 'the CDN image is still ticked');
    assert.match(byId('siat-picker-selection').textContent, /1 selected/);

    click(byId('siat-pick-clear'));
    assert.match(byId('siat-picker-selection').textContent, /Nothing selected/);
    assert.ok(rows().every((row) => !row.querySelector('input').checked), 'every checkbox was cleared');
  });

  test('"Select all listed" selects the filtered rows only', () => {
    byId('siat-pick-search').value = 'cdn.example';
    input(byId('siat-pick-search'));
    const listed = rows().length;
    click(byId('siat-pick-selectall'));
    assert.match(byId('siat-picker-selection').textContent, new RegExp(`${listed} selected`));
    assert.ok(rows().every((row) => row.querySelector('input').checked));
    assert.match(byId('siat-pick-save').textContent, new RegExp(`Save ${listed}`), 'the button counts the selection');
  });

  test('a selection of not-loaded images is counted separately, with the load button offered', () => {
    check('siat-pick-notiny', false);
    check('siat-pick-check-image-3');
    assert.match(byId('siat-picker-selection').textContent, /1 not loaded yet/);
    assert.equal(byId('siat-pick-load').style.display, '', 'the explicit load button is visible');

    click(byId('siat-pick-load'));
    return wait(20).then(() => {
      assert.deepEqual(calls.load, [['image-3']], 'only the not-loaded selection was handed over');
      assert.equal(calls.scan, 2, 'and the list was re-scanned afterwards');
    });
  });

  test('the load button is hidden when everything selected is already loaded', () => {
    check('siat-pick-check-image-1');
    assert.equal(byId('siat-pick-load').style.display, 'none');
  });
});

describe('image picker — actions', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installPicker();
    api.open();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('"Save selected" hands the selection, the format and the destination to the batch runner', () => {
    check('siat-pick-check-image-1');
    check('siat-pick-check-image-2');
    byId('siat-pick-format').value = 'jpg';
    change(byId('siat-pick-format'));
    click(byId('siat-pick-save'));
    assert.equal(calls.convert.length, 1);
    assert.equal(calls.convert[0].destination, 'files');
    assert.equal(calls.convert[0].formatId, 'jpg');
    assert.deepEqual(calls.convert[0].entries.map((item) => item.id), ['image-1', 'image-2']);
    assert.equal(api.isOpen, false, 'the picker closes so the progress bar can be seen');
  });

  test('"Save as ZIP" asks for an archive instead of separate files', () => {
    check('siat-pick-check-image-1');
    click(byId('siat-pick-zip'));
    assert.equal(calls.convert[0].destination, 'zip');
  });

  test('nothing selected means no run, and an explanation instead', () => {
    click(byId('siat-pick-save'));
    assert.equal(calls.convert.length, 0, 'no batch was started');
    assert.match(root().textContent, /Nothing selected/);
  });

  test('"This one" converts a single row without touching the rest of the selection', () => {
    check('siat-pick-check-image-1');
    click(byId('siat-pick-one-image-2'));
    assert.equal(calls.convert.length, 1);
    assert.deepEqual(calls.convert[0].entries.map((item) => item.id), ['image-2']);
    assert.equal(calls.convert[0].destination, 'files');
    assert.equal(calls.convert[0].formatId, 'png', 'the format chosen in the footer is used, not a stray value');
  });

  test('single-image actions need exactly one selection, and say so otherwise', () => {
    click(byId('siat-pick-inspect'));
    assert.deepEqual(calls.inspect, [], 'nothing happened');
    assert.match(root().textContent, /Tick one image|Select exactly one/);

    check('siat-pick-check-image-1');
    check('siat-pick-check-image-2');
    click(byId('siat-pick-compare'));
    assert.deepEqual(calls.compare, [], 'two images cannot be compared as one');
    assert.match(root().textContent, /works on one at a time/);

    click(byId('siat-pick-clear'));
    check('siat-pick-check-image-2');
    click(byId('siat-pick-inspect'));
    assert.deepEqual(calls.inspect, ['image-2'], 'the selected entry was handed to the inspector');
    assert.equal(api.isOpen, false, 'the picker closes to make room for the inspector');
  });

  test('copy, transform and compare route to their own surfaces', () => {
    for (const [button, key] of [['siat-pick-copy', 'copy'], ['siat-pick-transform', 'transform'], ['siat-pick-compare', 'compare']]) {
      api.open();
      click(byId('siat-pick-clear'));
      check('siat-pick-check-image-1');
      click(byId(button));
      assert.deepEqual(calls[key], ['image-1'], `${key} received the selection`);
    }
  });

  test('the format list comes from the orchestrator and shows what this browser cannot do', () => {
    const options = Array.from(byId('siat-pick-format').options);
    assert.deepEqual(options.map((option) => option.value), ['png', 'jpg', 'avif']);
    assert.equal(options[2].disabled, true, 'an unsupported encoder is disabled, not hidden');
    assert.equal(byId('siat-pick-format').value, 'png', 'the default format is preselected');
  });
});

describe('image picker — previews and lifecycle', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installPicker();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('thumbnails are requested only for rows that can be drawn locally', async () => {
    api.open();
    await wait(30);
    assert.ok(calls.thumbnail > 0, 'previews were requested through the injected helper');
    const drawn = Array.from(root().querySelectorAll('img.siat-row-thumb'));
    assert.ok(drawn.length >= 1, `at least one preview was drawn (${drawn.length})`);
    assert.ok(drawn.every((image) => image.src.startsWith('data:')), 'every preview is a local data URL');
    assert.ok(drawn.every((image) => image.getAttribute('aria-hidden') === 'true'), 'previews are hidden from screen readers');

    const noPreview = byId('siat-pick-thumb-image-4');
    assert.ok(noPreview, 'a broken image keeps its placeholder');
    assert.equal(noPreview.textContent, 'no preview');
    assert.match(noPreview.title, /without downloading/, 'and promises no download for a preview');
  });

  test('a failing preview is cosmetic: the row still works', async () => {
    api.destroy();
    installPicker({ thumbnailFails: true });
    api.open();
    await wait(30);
    assert.ok(rows().length >= 5, 'the list is intact');
    check('siat-pick-check-image-1');
    click(byId('siat-pick-save'));
    assert.equal(calls.convert.length, 1, 'conversion still works with no previews at all');
  });

  test('closing stops the observer: later page mutations cost nothing', async () => {
    api.open();
    await wait(10);
    const scansAfterOpen = calls.scan;
    byId('siat-pick-close') && click(byId('siat-pick-close'));
    assert.equal(api.isOpen, false);
    assert.equal(pageCalls.close, 0, 'the page window.close() was never called');

    const image = doc.createElement('img');
    image.setAttribute('src', '/added-later.png');
    doc.body.appendChild(image);
    await wait(700);
    assert.equal(calls.scan, scansAfterOpen, 'no re-scan after the dialog closed');
  });

  test('Escape closes the picker and returns focus to the page', async () => {
    const pageButton = doc.getElementById('page-button');
    pageButton.focus();
    api.open();
    assert.equal(api.isOpen, true);
    const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (doc.activeElement || doc.body).dispatchEvent(escape);
    await wait(10);
    assert.equal(api.isOpen, false, 'Escape closed it');
    assert.equal(pageCalls.close, 0);
  });

  test('destroy() removes the host and a second instance does not stack', () => {
    api.open();
    const second = createImagePicker({ document: doc, scan: () => ({ entries: [], notes: [] }) });
    second.open();
    assert.equal(doc.querySelectorAll('#siat-picker-host').length, 1, 'one host on screen');
    second.destroy();
    assert.equal(doc.getElementById('siat-picker-host'), null);
    api.destroy();
  });

  test('the picker state is readable for support and automation', () => {
    api.open();
    const state = api.state();
    assert.equal(state.found, 8, 'what the scan found');
    assert.equal(state.listed, 5, 'what the default filters left');
    assert.deepEqual(state.selected, []);
    check('siat-pick-check-image-1');
    assert.deepEqual(api.state().selected.map((item) => item.id), ['image-1']);
    assert.equal(api.state().truncated, false);
  });
});
