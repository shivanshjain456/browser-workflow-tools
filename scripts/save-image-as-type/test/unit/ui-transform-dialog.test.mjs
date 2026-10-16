import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTransformDialog } from '../../src/ui/transform-dialog.js';
import { TRANSFORM_DEFAULTS } from '../../src/core/transform.js';

/**
 * Feature: transform before save.
 *
 * The dialog is the interactive half of the feature, so what is tested here is
 * the interaction contract: the numbers on screen come from the real plan (not
 * from the preview), the aspect lock works, cropping is reachable by mouse *and*
 * keyboard, an image that will not load says so and blocks the save, and closing
 * the dialog releases the pixels it borrowed. The pixels themselves are verified
 * in the browser suite with Pillow.
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
let drawCalls = null;

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
  // jsdom has no 2D context; a recording stub keeps the preview path honest.
  drawCalls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = function stub() {
    return {
      clearRect: () => drawCalls.push('clearRect'),
      drawImage: (source) => drawCalls.push(`drawImage:${source && source.width}x${source && source.height}`),
      imageSmoothingEnabled: true,
    };
  };
}

function teardownDom() {
  if (!dom) return;
  dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) delete globalThis[key];
}

/** The documented test image: 200×140. */
const TARGET = { kind: 'img', element: { id: 'photo', tagName: 'IMG' }, url: 'https://page.example/photo.png', altText: 'A photo', naturalWidth: 200, naturalHeight: 140 };

/** `0` is a meaningful size here, so only undefined falls back. */
const size = (value, fallback) => (value === undefined ? fallback : value);

function installDialog(over = {}) {
  calls = { loadPreview: 0, submit: [], released: 0 };
  api = createTransformDialog({
    document: doc,
    settings: () => over.settings || { activeFormatId: 'png' },
    formats: () => [
      { id: 'png', label: 'PNG', ext: 'png', disabled: '' },
      { id: 'jpg', label: 'JPG', ext: 'jpg', disabled: '' },
      { id: 'webp', label: 'WebP', ext: 'webp', disabled: '' },
      { id: 'original', label: 'Original file', ext: '', disabled: '' },
      { id: 'avif', label: 'AVIF', ext: 'avif', disabled: 'Not supported by this browser' },
    ],
    createCanvas: (width, height) => ({
      canvas: { width, height, tagName: 'CANVAS' },
      ctx: {
        drawImage: () => drawCalls.push(`canvas:${width}x${height}`),
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        imageSmoothingEnabled: true,
      },
    }),
    loadPreview: async (target) => {
      calls.loadPreview += 1;
      calls.target = target;
      if (over.loadFails) throw new Error('The image could not be decoded.');
      return {
        drawable: { width: size(over.width, 200), height: size(over.height, 140), naturalWidth: size(over.width, 200), naturalHeight: size(over.height, 140) },
        width: size(over.width, 200),
        height: size(over.height, 140),
        release() {
          calls.released += 1;
        },
      };
    },
    onSubmit: (payload) => calls.submit.push(payload),
  });
}

const root = () => api.shadowRoot;
const byId = (id) => root().getElementById(id);
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (element) => element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const input = (element) => element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const output = () => byId('siat-tf-output').textContent;
const warnings = () => byId('siat-tf-warn').textContent;

const check = (id, value = true) => {
  const box = byId(id);
  box.checked = value;
  change(box);
};
const setNumber = (id, value) => {
  byId(id).value = String(value);
  input(byId(id));
};
const key = (id, keyName, mods = {}) => {
  byId(id).dispatchEvent(new dom.window.KeyboardEvent('keydown', Object.assign({ key: keyName, bubbles: true, cancelable: true }, mods)));
};

describe('transform dialog — preview and readout', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installDialog();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('opening loads the image once and reports the real source size', async () => {
    assert.equal(doc.getElementById('siat-transform-host'), null, 'nothing in the page before opening');
    api.open(TARGET);
    await wait();
    assert.equal(calls.loadPreview, 1, 'one preview load');
    assert.equal(calls.target, TARGET, 'for the image the user acted on');
    assert.match(output(), /200×140 → 200×140 px/, 'the readout starts from the source size');
    assert.match(output(), /no transform/);
    assert.match(warnings(), /No transform selected/, 'the user is told nothing will change yet');
    assert.equal(doc.querySelectorAll('#siat-transform-host').length, 1);
    assert.ok(byId('siat-tf-canvas'), 'a preview canvas exists');
    assert.equal(byId('siat-tf-canvas').getAttribute('role'), 'img', 'and it is exposed as an image');
    assert.ok(drawCalls.some((call) => call.startsWith('drawImage')), 'the preview was drawn');
  });

  test('the documented case: typing 100 wide yields exactly 100×70 with the aspect lock on', async () => {
    api.open(TARGET);
    await wait();
    setNumber('siat-tf-width', 100);
    assert.match(output(), /200×140 → 100×70 px/);
    assert.equal(byId('siat-tf-height').value, '70', 'the height was filled in');
    assert.equal(api.currentSpec().resize.mode, 'exact');
    assert.equal(api.currentPlan().width, 100);
    assert.equal(api.currentPlan().height, 70);
    assert.equal(warnings(), '', 'no warning for a valid transform');

    setNumber('siat-tf-height', 35);
    assert.equal(byId('siat-tf-width').value, '50', 'and the other way round');
    assert.match(output(), /→ 50×35 px/);
  });

  test('the aspect lock uses cropped and rotated dimensions, not the original ratio', async () => {
    api.open(TARGET);
    await wait();
    click(byId('siat-tf-rot-right'));
    setNumber('siat-tf-width', 70);
    assert.equal(byId('siat-tf-height').value, '100', '140×200 rotated source gives 70×100');
    setNumber('siat-tf-crop-x', 0);
    setNumber('siat-tf-crop-y', 0);
    setNumber('siat-tf-crop-width', 100);
    setNumber('siat-tf-crop-height', 100);
    setNumber('siat-tf-width', 50);
    assert.equal(byId('siat-tf-height').value, '50', 'a square crop stays square after rotation');
  });

  test('turning the aspect lock off lets the two dimensions differ', async () => {
    api.open(TARGET);
    await wait();
    check('siat-tf-aspect', false);
    setNumber('siat-tf-width', 100);
    setNumber('siat-tf-height', 100);
    assert.equal(api.currentSpec().resize.keepAspect, false);
    assert.match(output(), /→ 100×100 px/, 'a deliberate distortion is allowed and shown');
  });

  test('resize presets set the mode and the readout follows', async () => {
    api.open(TARGET);
    await wait();
    const preset = byId('siat-tf-resize-preset');
    const values = Array.from(preset.options).map((option) => option.value);
    assert.deepEqual(values, ['none', 'max-1920', 'max-1024', 'max-512', 'half', 'quarter'], 'the documented presets');

    preset.value = 'half';
    change(preset);
    assert.match(output(), /→ 100×70 px/);
    assert.equal(api.currentSpec().resize.mode, 'percent');
    assert.equal(preset.value, 'half', 'the preset stays selected after the readout updates');

    preset.value = 'quarter';
    change(preset);
    assert.match(output(), /→ 50×35 px/);

    preset.value = 'max-512';
    change(preset);
    assert.match(output(), /→ 200×140 px/, 'a limit above the source size changes nothing');
    assert.match(output(), /already ≤ 512px/, 'and the readout says why');
  });

  test('rotation swaps the dimensions and the label follows, in 90° steps only', async () => {
    api.open(TARGET);
    await wait();
    assert.equal(byId('siat-tf-rotate-label').textContent, '0°');
    click(byId('siat-tf-rot-right'));
    assert.equal(byId('siat-tf-rotate-label').textContent, '90°');
    assert.match(output(), /→ 140×200 px/, 'a quarter turn swaps width and height');
    assert.equal(api.currentSpec().rotate, 90);
    click(byId('siat-tf-rot-right'));
    click(byId('siat-tf-rot-right'));
    click(byId('siat-tf-rot-right'));
    assert.equal(api.currentSpec().rotate, 0, 'four right turns are back to 0, not 360');
    assert.match(output(), /→ 200×140 px/);
    click(byId('siat-tf-rot-left'));
    assert.equal(api.currentSpec().rotate, 270, 'left from 0 wraps to 270');
  });

  test('flips are independent of rotation and appear in the summary', async () => {
    api.open(TARGET);
    await wait();
    check('siat-tf-fliph');
    assert.equal(api.currentSpec().flipH, true);
    assert.match(output(), /flip horizontal/);
    check('siat-tf-flipv');
    assert.match(output(), /flip vertical/);
    check('siat-tf-fliph', false);
    assert.equal(api.currentSpec().flipH, false);
    assert.match(output(), /flip vertical/);
    assert.equal(/flip horizontal/.test(output()), false);
  });

  test('"Original file" and unsupported encoders are not offered as output', async () => {
    api.open(TARGET);
    await wait();
    const options = Array.from(byId('siat-tf-format').options).map((option) => option.value);
    assert.deepEqual(options, ['png', 'jpg', 'webp'], 're-encoding formats only');
    assert.equal(byId('siat-tf-format').value, 'png', 'the effective default format is preselected');
    byId('siat-tf-format').value = 'webp';
    change(byId('siat-tf-format'));
    assert.match(output(), /saved as WEBP/, 'the readout follows the format');
  });

  test('a stored default transform is applied on open', async () => {
    api.destroy();
    installDialog({ settings: { activeFormatId: 'jpg', defaultTransform: { resize: { mode: 'percent', width: 50, height: 0, keepAspect: true }, crop: null, rotate: 180, flipH: true, flipV: false } } });
    api.open(TARGET);
    await wait();
    assert.equal(api.currentSpec().rotate, 180, 'the stored transform was loaded');
    assert.equal(api.currentSpec().flipH, true);
    assert.match(output(), /→ 100×70 px/);
    assert.equal(byId('siat-tf-fliph').checked, true, 'the controls show it');
    assert.equal(byId('siat-tf-resize-preset').value, 'half');
  });
});

describe('transform dialog — cropping', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installDialog();
    api.open(TARGET);
  });
  afterEach(async () => {
    await wait();
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('enabling the crop starts from a sensible region and is reflected everywhere', async () => {
    await wait();
    assert.equal(byId('siat-tf-crop-enable').checked, false);
    check('siat-tf-crop-enable');
    await wait();
    const crop = api.currentSpec().crop;
    assert.deepEqual(crop, { x: 20, y: 14, width: 160, height: 112 }, 'an 80% region centred on the image');
    assert.equal(byId('siat-tf-crop-x').value, '20');
    assert.equal(byId('siat-tf-crop-width').value, '160');
    assert.match(output(), /→ 160×112 px/);
    assert.match(output(), /crop 160×112/);
    assert.match(output(), /crop to 160×112 at \(20, 14\)/, 'the plan steps are shown');
  });

  test('crop numbers can be typed, and are clamped to the image', async () => {
    await wait();
    setNumber('siat-tf-crop-x', 10);
    setNumber('siat-tf-crop-y', 10);
    setNumber('siat-tf-crop-width', 500);
    setNumber('siat-tf-crop-height', 40);
    const crop = api.currentPlan();
    assert.equal(crop.cropX, 10);
    assert.equal(crop.cropWidth, 190, 'clipped to the right edge');
    assert.equal(crop.cropHeight, 40);
    assert.match(output(), /→ 190×40 px/);
    assert.equal(byId('siat-tf-crop-enable').checked, true, 'typing a crop turns cropping on');
  });

  test('arrow keys move the crop box and Shift+arrow resizes it', async () => {
    await wait();
    check('siat-tf-crop-enable');
    await wait();
    const start = Object.assign({}, api.currentSpec().crop);
    key('siat-tf-cropwrap', 'ArrowRight');
    assert.equal(api.currentSpec().crop.x, start.x + 1, 'one pixel right');
    assert.equal(api.currentSpec().crop.width, start.width, 'moving does not resize');
    key('siat-tf-cropwrap', 'ArrowDown');
    assert.equal(api.currentSpec().crop.y, start.y + 1);
    key('siat-tf-cropwrap', 'ArrowLeft', { shiftKey: true });
    assert.equal(api.currentSpec().crop.width, start.width - 10, 'Shift resizes by ten');
    key('siat-tf-cropwrap', 'ArrowUp', { shiftKey: true });
    assert.equal(api.currentSpec().crop.height, start.height - 10);

    // The crop can never be dragged off the image or below the minimum.
    for (let i = 0; i < 400; i += 1) key('siat-tf-cropwrap', 'ArrowLeft', { shiftKey: true });
    const crop = api.currentSpec().crop;
    assert.ok(crop.width >= 8, `the minimum width is kept (${crop.width})`);
    assert.ok(crop.x >= 0, 'and it never goes negative');
    assert.equal(byId('siat-tf-crop-x').value, String(crop.x), 'the inputs follow the keyboard');
  });

  test('pointer drags move and resize the crop box', async () => {
    await wait();
    check('siat-tf-crop-enable');
    await wait();
    const wrap = byId('siat-tf-cropwrap');
    const box = root().querySelector('.siat-cropbox');
    const start = Object.assign({}, api.currentSpec().crop);

    const pointer = (type, target, x, y) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      event.clientX = x;
      event.clientY = y;
      event.pointerId = 1;
      target.dispatchEvent(event);
    };
    // jsdom has no layout, so previewRatio() is 0 and one displayed pixel equals
    // one natural pixel: the drag maths is still exercised end to end.
    pointer('pointerdown', box, 0, 0);
    pointer('pointermove', box, 15, 5);
    pointer('pointerup', box, 15, 5);
    assert.equal(api.currentSpec().crop.x, Math.min(start.x + 15, 200 - start.width), 'the region moved with the pointer');
    assert.equal(api.currentSpec().crop.width, start.width, 'moving keeps the size');

    const beforeResize = Object.assign({}, api.currentSpec().crop);
    pointer('pointerdown', root().querySelector('.siat-crophandle'), 0, 0);
    pointer('pointermove', root().querySelector('.siat-crophandle'), -20, -10);
    pointer('pointerup', root().querySelector('.siat-crophandle'), -20, -10);
    assert.ok(api.currentSpec().crop.width !== beforeResize.width || api.currentSpec().crop.height !== beforeResize.height, 'dragging the handle resizes');
    assert.ok(wrap.getAttribute('aria-label').includes('Arrow keys'), 'the keyboard route is advertised');
  });

  test('disabling the crop removes it from the spec, and Reset clears everything', async () => {
    await wait();
    check('siat-tf-crop-enable');
    setNumber('siat-tf-width', 100);
    click(byId('siat-tf-rot-right'));
    await wait();
    assert.equal(api.currentSpec().crop !== null, true);

    check('siat-tf-crop-enable', false);
    assert.equal(api.currentSpec().crop, null, 'the crop is dropped, not left at zero size');
    assert.match(output(), /→ 100×70 px/);

    click(byId('siat-tf-reset'));
    await wait();
    assert.deepEqual(api.currentSpec(), TRANSFORM_DEFAULTS, 'Reset restores the defaults exactly');
    assert.match(output(), /200×140 → 200×140 px/);
    assert.equal(byId('siat-tf-crop-enable').checked, false);
    assert.equal(byId('siat-tf-rotate-label').textContent, '0°');
    assert.equal(byId('siat-tf-width').value, '200');
  });
});

describe('transform dialog — saving, failure and cleanup', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => {
    installDom();
    installDialog();
  });
  afterEach(() => {
    if (api) api.destroy();
    api = null;
    teardownDom();
  });

  test('Save hands over the target, the exact spec and the chosen format, then closes', async () => {
    api.open(TARGET);
    await wait();
    setNumber('siat-tf-width', 100);
    byId('siat-tf-format').value = 'webp';
    change(byId('siat-tf-format'));
    click(byId('siat-tf-save'));

    assert.equal(calls.submit.length, 1);
    const payload = calls.submit[0];
    assert.equal(payload.target, TARGET);
    assert.equal(payload.formatId, 'webp');
    assert.equal(payload.makeDefault, false);
    assert.deepEqual(payload.transform.resize, { mode: 'exact', width: 100, height: 70, keepAspect: true });
    assert.equal(payload.transform.crop, null);
    assert.equal(api.isOpen, false, 'the dialog closes so the progress toast is visible');
    assert.equal(pageCalls.close, 0, 'the page window.close() was not used');
    assert.equal(calls.released, 1, 'the borrowed pixels were released');
  });

  test('the spec handed over is a copy: later edits cannot change it', async () => {
    api.open(TARGET);
    await wait();
    setNumber('siat-tf-width', 100);
    click(byId('siat-tf-save'));
    const payload = calls.submit[0];
    api.open(TARGET);
    await wait();
    setNumber('siat-tf-width', 42);
    assert.equal(payload.transform.resize.width, 100, 'the submitted spec did not change');
  });

  test('"Make default" says so in the payload', async () => {
    api.open(TARGET);
    await wait();
    check('siat-tf-fliph');
    click(byId('siat-tf-makedefault'));
    assert.equal(calls.submit.length, 1);
    assert.equal(calls.submit[0].makeDefault, true);
    assert.equal(calls.submit[0].transform.flipH, true);
  });

  test('Cancel closes, releases the source and submits nothing', async () => {
    api.open(TARGET);
    await wait();
    const cancel = Array.from(root().querySelectorAll('button')).find((button) => button.textContent.trim() === 'Cancel');
    click(cancel);
    await wait();
    assert.deepEqual(calls.submit, []);
    assert.equal(api.isOpen, false);
    assert.equal(calls.released, 1, 'closing gives the pixels back');
  });

  test('an image that cannot be loaded says so and refuses to save', async () => {
    api.destroy();
    installDialog({ loadFails: true });
    api.open(TARGET);
    await wait();
    assert.match(output(), /could not be loaded for preview/);
    assert.match(warnings(), /could not be decoded/);
    click(byId('siat-tf-save'));
    assert.deepEqual(calls.submit, [], 'nothing was submitted');
    assert.match(warnings(), /still loading|could not be decoded/, 'the reason stays visible');
    assert.equal(api.isOpen, true, 'the dialog stays open so the user can cancel');
  });

  test('opening for a second image releases the first and loads the new one', async () => {
    api.open(TARGET);
    await wait();
    assert.equal(calls.loadPreview, 1);
    const other = Object.assign({}, TARGET, { url: 'https://page.example/other.png' });
    api.open(other);
    await wait();
    assert.equal(calls.loadPreview, 2, 'the new image was loaded');
    assert.equal(calls.released, 1, 'and the previous source was released');
    assert.equal(calls.target, other);
  });

  test('destroy() releases the source and removes the host', async () => {
    api.open(TARGET);
    await wait();
    api.destroy();
    assert.equal(calls.released, 1);
    assert.equal(doc.getElementById('siat-transform-host'), null);
    assert.deepEqual(pageCalls, { close: 0, open: 0 });
  });

  test('a source with no size is reported instead of producing a 0×0 file', async () => {
    api.destroy();
    installDialog({ width: 0, height: 0 });
    api.open(TARGET);
    await wait();
    assert.match(warnings(), /no pixel size/i);
    assert.match(output(), /0×0 → 1×1 px|no transform/, 'the readout stays honest');
    click(byId('siat-tf-save'));
    assert.equal(calls.submit.length, 0, 'a zero-size source cannot be submitted');
  });
});

describe('transform dialog — asynchronous ownership regressions', { skip: SKIP_DOM || false }, () => {
  beforeEach(() => installDom());
  afterEach(() => { if (api) api.destroy(); api = null; teardownDom(); });

  test('a preview finishing after close is released instead of retained', async () => {
    let resolvePreview;
    let released = 0;
    const pending = new Promise((resolve) => { resolvePreview = resolve; });
    api = createTransformDialog({ document: doc, formats: () => [{id:'png',label:'PNG'}], loadPreview: () => pending });
    api.open(TARGET);
    api.close();
    resolvePreview({ drawable: {}, width: 200, height: 140, release() { released++; } });
    await wait();
    assert.equal(released, 1);
    assert.equal(api.isOpen, false);
  });

  test('out-of-order previews cannot overwrite the newly selected image', async () => {
    let firstResolve;
    let released = 0;
    let loads = 0;
    api = createTransformDialog({
      document: doc, formats: () => [{id:'png',label:'PNG'}],
      loadPreview: () => {
        loads++;
        if (loads === 1) return new Promise((resolve) => { firstResolve = resolve; });
        return Promise.resolve({ drawable: {}, width: 80, height: 60, release() {} });
      },
    });
    api.open(TARGET);
    api.open({ ...TARGET, url: 'https://page.example/new.png' });
    await wait();
    assert.equal(api.currentPlan().width, 80);
    firstResolve({ drawable: {}, width: 200, height: 140, release() { released++; } });
    await wait();
    assert.equal(api.currentPlan().width, 80, 'newer source still owns the dialog');
    assert.equal(released, 1, 'stale source released');
  });
});
