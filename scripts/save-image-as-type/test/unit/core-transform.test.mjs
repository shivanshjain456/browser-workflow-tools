import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESIZE_MODES,
  RESIZE_PRESETS,
  ROTATIONS,
  TRANSFORM_DEFAULTS,
  MAX_TRANSFORM_PIXELS,
  isTransformActive,
  normalizeTransform,
  validateTransform,
  planTransform,
  applyTransform,
  transformImageData,
  describeTransform,
} from '../../src/core/transform.js';

/**
 * Feature: transform before save.
 *
 * The geometry is planned in pure numbers (`planTransform`) and only then drawn
 * (`applyTransform`), so the plan can be tested exactly — including the
 * documented acceptance case, 200×140 resized to 100×70. The drawing itself is
 * tested against a recording canvas: it proves the drawImage geometry (source
 * rect, destination rect, rotation, flip) without pretending to be a rasteriser.
 * Real pixels are verified in the browser suite with Pillow.
 */

/** A canvas that records what was drawn instead of drawing it. */
function recordingCanvasFactory() {
  const calls = [];
  const canvases = [];
  const makeCtx = (canvas) => {
    const ctx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      save: () => calls.push(['save', canvas]),
      restore: () => calls.push(['restore', canvas]),
      translate: (x, y) => calls.push(['translate', canvas, x, y]),
      rotate: (radians) => calls.push(['rotate', canvas, radians]),
      scale: (x, y) => calls.push(['scale', canvas, x, y]),
      drawImage: (...args) => calls.push(['drawImage', canvas, ...args]),
      putImageData: (data, x, y) => calls.push(['putImageData', canvas, data, x, y]),
      getImageData: (x, y, w, h) => {
        calls.push(['getImageData', canvas, x, y, w, h]);
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      },
    };
    return ctx;
  };
  // Same shape as core/raster.js createCanvas(): { canvas, ctx }.
  const createCanvas = (width, height) => {
    const canvas = { tagName: 'CANVAS', width, height };
    const ctx = makeCtx(canvas);
    canvases.push(canvas);
    return { canvas, ctx };
  };
  const of = (name) => calls.filter((call) => call[0] === name);
  return { createCanvas, calls, canvases, of };
}

const spec = (over = {}) => Object.assign({ resize: { mode: 'none', width: 0, height: 0, keepAspect: true }, crop: null, rotate: 0, flipH: false, flipV: false }, over);

describe('transform — spec handling', () => {
  test('the defaults are a no-op and every resize preset maps to a real mode', () => {
    assert.equal(isTransformActive(TRANSFORM_DEFAULTS), false);
    assert.equal(isTransformActive(null), false);
    assert.equal(isTransformActive(undefined), false);
    assert.equal(new Set(RESIZE_PRESETS.map((entry) => entry.id)).size, RESIZE_PRESETS.length, 'preset ids are unique');
    for (const entry of RESIZE_PRESETS) {
      assert.ok(RESIZE_MODES.includes(entry.mode), `preset "${entry.id}" uses a real mode (${entry.mode})`);
      assert.ok(entry.label, `preset "${entry.id}" has a label`);
      if (entry.mode !== 'none') assert.ok(Number(entry.width) > 0, `preset "${entry.id}" carries a size`);
    }
    assert.deepEqual(ROTATIONS, [0, 90, 180, 270]);
  });

  test('isTransformActive notices every kind of change and ignores inert ones', () => {
    assert.equal(isTransformActive(spec({ resize: { mode: 'percent', width: 50 } })), true);
    assert.equal(isTransformActive(spec({ resize: { mode: 'exact', width: 0, height: 0 } })), false, 'exact 0×0 is inert');
    assert.equal(isTransformActive(spec({ crop: { x: 0, y: 0, width: 10, height: 10 } })), true);
    assert.equal(isTransformActive(spec({ rotate: 90 })), true);
    assert.equal(isTransformActive(spec({ rotate: 0 })), false);
    assert.equal(isTransformActive(spec({ flipH: true })), true);
    assert.equal(isTransformActive(spec({ flipV: true })), true);
  });

  test('untrusted specs are coerced into range, never trusted', () => {
    const bad = normalizeTransform({ resize: { mode: 'shrink', width: -5, height: 1e9 }, rotate: 100, flipH: 'yes', crop: { x: -3, y: 0, width: 60, height: 0 } });
    assert.equal(bad.transform.resize.mode, 'none', 'an unknown mode turns resizing off');
    assert.ok(bad.warnings.some((w) => /not supported/.test(w)), 'and the user is told');
    assert.equal(bad.transform.resize.width, 0);
    assert.equal(bad.transform.resize.height, 20000, 'an absurd size is clamped');
    assert.equal(bad.transform.rotate, 90, '100° snaps to the nearest supported step');
    assert.ok(bad.warnings.some((w) => /rounded to 90/.test(w)));
    assert.equal(bad.transform.flipH, true, 'truthy strings become booleans');
    assert.equal(bad.transform.crop, null, 'a zero-size crop is dropped');
    assert.ok(bad.warnings.some((w) => /crop region had no size/.test(w)));
  });

  test('a crop is clipped to the source when the source size is known', () => {
    const result = normalizeTransform({ crop: { x: 150, y: 100, width: 200, height: 200 } }, { sourceWidth: 200, sourceHeight: 140 });
    assert.deepEqual(result.transform.crop, { x: 150, y: 100, width: 50, height: 40 });
  });

  test('non-object input yields the defaults instead of throwing', () => {
    for (const value of [null, undefined, 7, 'resize', []]) {
      const result = normalizeTransform(value);
      assert.deepEqual(result.transform, TRANSFORM_DEFAULTS, `${JSON.stringify(value)} is normalised`);
      assert.deepEqual(result.warnings, []);
    }
  });
});

describe('transform — the plan (pure geometry)', () => {
  test('no transform keeps the source size and adds no steps', () => {
    const plan = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: TRANSFORM_DEFAULTS });
    assert.equal(plan.width, 200);
    assert.equal(plan.height, 140);
    assert.equal(plan.scale, 1);
    assert.deepEqual(plan.steps, []);
    assert.equal(plan.swapped, false);
  });

  test('the documented case: 200×140 at 50% becomes exactly 100×70', () => {
    const plan = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'percent', width: 50, keepAspect: true } }) });
    assert.equal(plan.width, 100);
    assert.equal(plan.height, 70);
    assert.equal(plan.scale, 0.5);
    assert.ok(plan.steps.some((step) => /50% → 100×70/.test(step)), `steps: ${plan.steps.join(' | ')}`);
  });

  test('exact, fit and max resizing all produce the planned size', () => {
    const exact = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'exact', width: 100, height: 70, keepAspect: false } }) });
    assert.equal([exact.width, exact.height].join('x'), '100x70');

    const fit = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'fit', width: 100, height: 100, keepAspect: true } }) });
    assert.equal([fit.width, fit.height].join('x'), '100x70', 'fit keeps the aspect ratio inside the box');

    const max = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'max', width: 100, keepAspect: true } }) });
    assert.equal([max.width, max.height].join('x'), '100x70', 'the longest edge is limited, the other follows');

    const noOp = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'max', width: 500, keepAspect: true } }) });
    assert.equal([noOp.width, noOp.height].join('x'), '200x140', 'a limit above the source size changes nothing');
    assert.ok(noOp.steps.some((step) => /already/.test(step)), 'and says so');
  });

  test('resizing never upscales by accident in fit mode', () => {
    const plan = planTransform({ sourceWidth: 100, sourceHeight: 80, transform: spec({ resize: { mode: 'fit', width: 4000, height: 4000, keepAspect: true } }) });
    assert.equal([plan.width, plan.height].join('x'), '100x80');
    assert.equal(plan.scale, 1);
  });

  test('a 90° or 270° rotation swaps the planned dimensions', () => {
    for (const rotate of [90, 270]) {
      const plan = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ rotate }) });
      assert.equal(plan.swapped, true);
      assert.equal([plan.width, plan.height].join('x'), '140x200', `rotate ${rotate}`);
    }
    for (const rotate of [0, 180]) {
      const plan = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ rotate }) });
      assert.equal(plan.swapped, false);
      assert.equal([plan.width, plan.height].join('x'), '200x140', `rotate ${rotate}`);
    }
  });

  test('crop is applied before rotation, and the plan reports both', () => {
    const plan = planTransform({
      sourceWidth: 200,
      sourceHeight: 140,
      transform: spec({ crop: { x: 10, y: 20, width: 100, height: 70 }, rotate: 90 }),
    });
    assert.equal(plan.cropX, 10);
    assert.equal(plan.cropY, 20);
    assert.equal(plan.cropWidth, 100);
    assert.equal(plan.cropHeight, 70);
    assert.equal([plan.width, plan.height].join('x'), '70x100', 'the cropped box is what rotates');
    assert.deepEqual(plan.steps, ['crop to 100×70 at (10, 20)', 'rotate 90°']);
  });

  test('a crop past the edge is clipped with a warning, not an error', () => {
    const warnings = [];
    const plan = planTransform({
      sourceWidth: 200,
      sourceHeight: 140,
      transform: spec({ crop: { x: 180, y: 130, width: 500, height: 500 } }),
      warnings,
    });
    assert.equal(plan.cropWidth, 20);
    assert.equal(plan.cropHeight, 10);
    assert.ok(warnings.some((w) => /clipped/.test(w)));
  });

  test('an incomplete exact resize is an error the dialog can show', () => {
    const errors = [];
    const plan = planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'exact', width: 100, height: 0, keepAspect: false } }), errors });
    assert.ok(errors.some((e) => /needs both a width and a height/.test(e)));
    assert.equal([plan.width, plan.height].join('x'), '200x140', 'the size falls back to the source');
  });

  test('"keep aspect ratio" is explained for the modes that ignore it', () => {
    const warnings = [];
    planTransform({ sourceWidth: 200, sourceHeight: 140, transform: spec({ resize: { mode: 'fit', width: 100, height: 100, keepAspect: false } }), warnings });
    assert.ok(warnings.some((w) => /only applies to exact resizing/.test(w)));
  });

  test('validateTransform refuses a source with no size and a result above the ceiling', () => {
    const noSize = validateTransform(spec({ resize: { mode: 'percent', width: 50 } }), { sourceWidth: 0, sourceHeight: 0 });
    assert.equal(noSize.ok, false);
    assert.ok(noSize.errors.some((e) => /no pixel dimensions/.test(e)));

    const huge = validateTransform(spec({ resize: { mode: 'exact', width: 20000, height: 20000, keepAspect: false } }), { sourceWidth: 200, sourceHeight: 140 });
    assert.equal(huge.ok, false);
    assert.ok(huge.errors.some((e) => /ceiling/.test(e)), `errors: ${huge.errors.join(' | ')}`);
    assert.ok(20000 * 20000 > MAX_TRANSFORM_PIXELS, 'the case really is above the ceiling');

    const fine = validateTransform(spec({ resize: { mode: 'percent', width: 50 } }), { sourceWidth: 200, sourceHeight: 140 });
    assert.equal(fine.ok, true);
    assert.deepEqual(fine.errors, []);
    assert.equal(fine.plan.width, 100);
  });
});

describe('transform — drawing geometry', () => {
  test('a 50% resize draws the whole source into a 100×70 canvas', () => {
    const fake = recordingCanvasFactory();
    const source = { tagName: 'IMG', width: 200, height: 140 };
    const result = applyTransform({
      source,
      transform: spec({ resize: { mode: 'percent', width: 50, keepAspect: true } }),
      createCanvas: fake.createCanvas,
    });
    assert.equal(result.width, 100);
    assert.equal(result.height, 70);
    assert.equal(fake.canvases.length, 1, 'one output canvas, no crop pass');
    assert.equal(fake.canvases[0].width, 100);
    assert.equal(fake.canvases[0].height, 70);

    const draws = fake.of('drawImage');
    assert.equal(draws.length, 1);
    assert.deepEqual(draws[0].slice(2), [source, 0, 0, 200, 140, -50, -35, 100, 70], 'source rect then destination rect, centred');
    assert.deepEqual(fake.of('translate')[0].slice(2), [50, 35], 'drawn around the centre so rotation is centred');
    assert.equal(fake.of('rotate').length, 0, 'no rotation was requested');
    assert.ok(result.notes.some((note) => /50% → 100×70/.test(note)), 'the report says what happened');
  });

  test('a crop runs as its own pass with the exact source rectangle', () => {
    const fake = recordingCanvasFactory();
    const source = { tagName: 'IMG', width: 200, height: 140 };
    const result = applyTransform({
      source,
      transform: spec({ crop: { x: 10, y: 20, width: 100, height: 70 } }),
      createCanvas: fake.createCanvas,
    });
    assert.equal(fake.canvases.length, 2, 'a scratch canvas for the crop, then the output');
    assert.equal([fake.canvases[0].width, fake.canvases[0].height].join('x'), '100x70');
    const cropDraw = fake.of('drawImage')[0];
    assert.deepEqual(cropDraw.slice(2), [source, 10, 20, 100, 70, 0, 0, 100, 70]);
    assert.equal([result.width, result.height].join('x'), '100x70');
  });

  test('rotation and flips are applied as context transforms, centred', () => {
    const fake = recordingCanvasFactory();
    const source = { tagName: 'IMG', width: 200, height: 140 };
    applyTransform({ source, transform: spec({ rotate: 90, flipH: true }), createCanvas: fake.createCanvas });
    assert.deepEqual(fake.of('translate')[0].slice(2), [70, 100], 'the output centre for a 140×200 result');
    assert.ok(Math.abs(fake.of('rotate')[0][2] - Math.PI / 2) < 1e-9, 'rotate is in radians');
    assert.deepEqual(fake.of('scale')[0].slice(2), [-1, 1], 'flipH mirrors on x only');
    const draw = fake.of('drawImage')[0];
    assert.deepEqual(draw.slice(2), [source, 0, 0, 200, 140, -100, -70, 200, 140], 'the unrotated box is drawn, then rotated');
    assert.equal(fake.of('save').length, 1);
    assert.equal(fake.of('restore').length, 1, 'the context state is restored');
  });

  test('flipV mirrors on y only', () => {
    const fake = recordingCanvasFactory();
    applyTransform({ source: { width: 40, height: 30 }, transform: spec({ flipV: true }), createCanvas: fake.createCanvas });
    assert.deepEqual(fake.of('scale')[0].slice(2), [1, -1]);
  });

  test('a large reduction is stepped down instead of jumped in one pass', () => {
    const fake = recordingCanvasFactory();
    const result = applyTransform({
      source: { width: 1000, height: 1000 },
      transform: spec({ resize: { mode: 'max', width: 100, keepAspect: true } }),
      createCanvas: fake.createCanvas,
    });
    assert.equal([result.width, result.height].join('x'), '100x100');
    assert.ok(fake.canvases.length >= 3, `intermediate canvases were used (${fake.canvases.length})`);
    assert.ok(result.notes.some((note) => /Reduced in steps/.test(note)));
    // The output canvas is created first (100×100); the intermediates follow and
    // must shrink monotonically towards it.
    const sizes = fake.canvases.slice(1).map((canvas) => canvas.width);
    assert.ok(sizes.length >= 2, `at least two intermediate steps (${sizes.join(' → ')})`);
    for (let i = 1; i < sizes.length; i += 1) {
      assert.ok(sizes[i] < sizes[i - 1], `each step is smaller (${sizes.join(' → ')})`);
    }
    assert.ok(sizes[sizes.length - 1] >= 100, 'the last step is never below the target size');
  });

  test('the source dimensions are read from the source when not given', () => {
    const fake = recordingCanvasFactory();
    const result = applyTransform({ source: { naturalWidth: 640, naturalHeight: 480 }, transform: TRANSFORM_DEFAULTS, createCanvas: fake.createCanvas });
    assert.equal([result.width, result.height].join('x'), '640x480');
  });

  test('failure modes are errors with codes, never silent no-ops', () => {
    const fake = recordingCanvasFactory();
    const cases = [
      [{ source: null, transform: TRANSFORM_DEFAULTS, createCanvas: fake.createCanvas }, 'transform-no-source'],
      [{ source: { width: 10, height: 10 }, transform: TRANSFORM_DEFAULTS }, 'transform-no-canvas'],
      [{ source: { width: 0, height: 0 }, transform: TRANSFORM_DEFAULTS, createCanvas: fake.createCanvas }, 'transform-no-size'],
      [
        {
          source: { width: 200, height: 140 },
          transform: spec({ resize: { mode: 'exact', width: 20000, height: 20000, keepAspect: false } }),
          createCanvas: fake.createCanvas,
        },
        'transform-invalid',
      ],
    ];
    for (const [params, code] of cases) {
      assert.throws(() => applyTransform(params), (err) => err.code === code, `${code} is reported`);
    }
    assert.throws(
      () => applyTransform({ source: { width: 200, height: 140 }, transform: spec({ resize: { mode: 'percent', width: 100 } }), createCanvas: fake.createCanvas, maxPixels: 100 }),
      (err) => err.code === 'transform-too-large',
      'a caller-supplied pixel ceiling is honoured',
    );
  });

  test('animation frames go through the same geometry', () => {
    const fake = recordingCanvasFactory();
    const frame = { width: 20, height: 10, data: new Uint8ClampedArray(20 * 10 * 4) };
    const inert = transformImageData(frame, TRANSFORM_DEFAULTS, fake.createCanvas);
    assert.equal(inert.imageData, frame, 'a no-op transform returns the very same buffer (no copy, no work)');
    assert.deepEqual(inert.notes, []);
    assert.equal(fake.canvases.length, 0);

    const turned = transformImageData(frame, spec({ rotate: 90 }), fake.createCanvas);
    assert.equal([turned.width, turned.height].join('x'), '10x20', 'the frame is rotated like any other source');
    assert.equal(fake.of('putImageData').length, 1, 'the frame was put into a scratch canvas');
    assert.equal(fake.of('getImageData').length, 1, 'and read back out');
    assert.equal(fake.of('getImageData')[0].slice(2)[2], 10);
    assert.equal(turned.imageData.data.length, 10 * 20 * 4, 'the returned buffer matches the new size');

    assert.throws(() => transformImageData(null, spec({ rotate: 90 }), fake.createCanvas), (err) => err.code === 'transform-no-pixels');
    assert.throws(() => transformImageData(frame, spec({ rotate: 90 })), (err) => err.code === 'transform-no-canvas');
  });
});

describe('transform — reporting', () => {
  test('describeTransform reads like the settings panel and the toast note', () => {
    assert.equal(describeTransform(null), 'no transform');
    assert.equal(describeTransform(TRANSFORM_DEFAULTS), 'no transform');
    assert.equal(describeTransform(spec({ resize: { mode: 'percent', width: 50 } })), 'resize to 50%');
    assert.equal(describeTransform(spec({ resize: { mode: 'exact', width: 100, height: 70 } })), 'resize to 100×70');
    assert.equal(describeTransform(spec({ resize: { mode: 'max', width: 1920 } })), 'longest edge ≤ 1920px');
    assert.equal(describeTransform(spec({ resize: { mode: 'fit', width: 800, height: 600 } })), 'fit 800×600');
    assert.equal(
      describeTransform(spec({ crop: { x: 0, y: 0, width: 50, height: 40 }, rotate: 180, flipH: true, flipV: true })),
      'crop 50×40, rotate 180°, flip horizontal, flip vertical',
    );
  });
});
