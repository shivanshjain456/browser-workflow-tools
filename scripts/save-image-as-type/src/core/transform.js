import { configNumber, configString } from './config-data.js';
/**
 * Image transforms: resize, crop, rotate, flip.
 *
 * Applied to the canvas the converter already produced, so every format that
 * goes through the raster pipeline (PNG/JPEG/WebP/GIF/BMP/PDF/AVIF) inherits the
 * same behaviour, and "Original file" is correctly refused — raw bytes cannot be
 * cropped without re-encoding, and pretending otherwise would silently produce a
 * file that is not what the preview showed.
 *
 * Order of operations is fixed and documented in the UI:
 *   crop → rotate/flip → resize.
 *
 * `planTransform()` computes the resulting dimensions without drawing anything,
 * which is what the dialog previews on every keystroke; `applyTransform()` does
 * the real work and is the only place a canvas is allocated.
 */

import { ConversionError } from './raster.js';

export const RESIZE_MODES = Object.freeze(['none', 'exact', 'fit', 'percent', 'max']);
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);
export const MAX_TRANSFORM_PIXELS = 120000000; // 120 MP hard ceiling

export const RESIZE_PRESETS = Object.freeze([
  { id: 'none', label: 'Keep original size', mode: 'none' },
  { id: 'max-1920', label: 'Longest edge ≤ 1920 px', mode: 'max', width: 1920 },
  { id: 'max-1024', label: 'Longest edge ≤ 1024 px', mode: 'max', width: 1024 },
  { id: 'max-512', label: 'Longest edge ≤ 512 px', mode: 'max', width: 512 },
  { id: 'half', label: 'Half size', mode: 'percent', width: 50 },
  { id: 'quarter', label: 'Quarter size', mode: 'percent', width: 25 },
]);

export const TRANSFORM_DEFAULTS = Object.freeze({
  resize: { mode: 'none', width: 0, height: 0, keepAspect: true },
  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
});

/** Is this transform a no-op? Used to skip work and to warn about "original". */
export function isTransformActive(transform) {
  if (!transform) return false;
  const resize = transform.resize || {};
  return Boolean(
    (resize.mode && resize.mode !== 'none' && (configNumber(resize.width) > 0 || configNumber(resize.height) > 0)) ||
      transform.crop ||
      (configNumber(transform.rotate) || 0) !== 0 ||
      transform.flipH ||
      transform.flipV,
  );
}

/** Coerce untrusted input (settings import, preset, dialog) into a valid spec. */
export function normalizeTransform(raw, { sourceWidth = 0, sourceHeight = 0 } = {}) {
  const warnings = [];
  const out = {
    resize: { mode: 'none', width: 0, height: 0, keepAspect: true },
    crop: null,
    rotate: 0,
    flipH: false,
    flipV: false,
  };
  if (!raw || typeof raw !== 'object') return { transform: out, warnings };

  const resize = raw.resize && typeof raw.resize === 'object' ? raw.resize : {};
  if (resize.mode !== undefined) {
    if (RESIZE_MODES.includes(resize.mode)) out.resize.mode = resize.mode;
    else warnings.push(`Resize mode "${configString(resize.mode).slice(0, 20)}" is not supported — resizing was turned off.`);
  }
  out.resize.width = clampTransformInt(resize.width, 0, 20000);
  out.resize.height = clampTransformInt(resize.height, 0, 20000);
  if (out.resize.mode === 'percent') out.resize.width = clampTransformInt(resize.width, 1, 1000);
  out.resize.keepAspect = resize.keepAspect === undefined ? true : Boolean(resize.keepAspect);

  if (raw.crop && typeof raw.crop === 'object') {
    const crop = {
      x: clampTransformInt(raw.crop.x, 0, 100000),
      y: clampTransformInt(raw.crop.y, 0, 100000),
      width: clampTransformInt(raw.crop.width, 0, 100000),
      height: clampTransformInt(raw.crop.height, 0, 100000),
    };
    if (crop.width > 0 && crop.height > 0) {
      if (sourceWidth && sourceHeight) {
        crop.x = Math.min(crop.x, sourceWidth - 1);
        crop.y = Math.min(crop.y, sourceHeight - 1);
        crop.width = Math.min(crop.width, sourceWidth - crop.x);
        crop.height = Math.min(crop.height, sourceHeight - crop.y);
      }
      out.crop = crop;
    } else if (raw.crop.width || raw.crop.height) {
      warnings.push('The crop region had no size, so cropping was turned off.');
    }
  }

  const rotate = configNumber(raw.rotate) || 0;
  if (ROTATIONS.includes(rotate)) out.rotate = rotate;
  else {
    const snapped = ROTATIONS.reduce((best, value) => (Math.abs(value - rotate) < Math.abs(best - rotate) ? value : best), 0);
    out.rotate = snapped;
    warnings.push(`Only 90° steps are supported; ${rotate}° was rounded to ${snapped}°.`);
  }

  out.flipH = Boolean(raw.flipH);
  out.flipV = Boolean(raw.flipV);
  return { transform: out, warnings };
}

/**
 * Validate against the real source size and produce the exact plan.
 *
 * @returns {{ok: boolean, errors: string[], warnings: string[], plan: object}}
 */
export function validateTransform(transform, { sourceWidth = 0, sourceHeight = 0 } = {}) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeTransform(transform, { sourceWidth, sourceHeight });
  for (const warning of normalized.warnings) warnings.push(warning);
  const plan = planTransform({ sourceWidth, sourceHeight, transform: normalized.transform, errors, warnings });
  if (!sourceWidth || !sourceHeight) errors.push('The source image has no pixel dimensions, so it cannot be transformed.');
  if (plan.width * plan.height > MAX_TRANSFORM_PIXELS) {
    errors.push(`The result would be ${plan.width}×${plan.height} (${((plan.width * plan.height) / 1000000).toFixed(0)} MP), above the ${MAX_TRANSFORM_PIXELS / 1000000} MP ceiling.`);
  }
  return { ok: errors.length === 0, errors, warnings, plan, transform: normalized.transform };
}

/**
 * Compute crop/rotate/resize results without touching a canvas.
 *
 * @returns {{cropX:number, cropY:number, cropWidth:number, cropHeight:number, rotate:number, flipH:boolean, flipV:boolean, width:number, height:number, scale:number, steps:string[]}}
 */
export function planTransform({ sourceWidth, sourceHeight, transform, errors = [], warnings = [] }) {
  const spec = transform || TRANSFORM_DEFAULTS;
  const srcW = Math.max(1, Math.round(configNumber(sourceWidth) || 1));
  const srcH = Math.max(1, Math.round(configNumber(sourceHeight) || 1));
  const steps = [];

  let cropX = 0;
  let cropY = 0;
  let cropWidth = srcW;
  let cropHeight = srcH;
  if (spec.crop) {
    cropX = clampTransformInt(spec.crop.x, 0, srcW - 1);
    cropY = clampTransformInt(spec.crop.y, 0, srcH - 1);
    cropWidth = clampTransformInt(spec.crop.width, 1, srcW - cropX);
    cropHeight = clampTransformInt(spec.crop.height, 1, srcH - cropY);
    if (spec.crop.width > cropWidth || spec.crop.height > cropHeight) {
      warnings.push('The crop region extended past the image edge and was clipped.');
    }
    steps.push(`crop to ${cropWidth}×${cropHeight} at (${cropX}, ${cropY})`);
  }

  const rotate = ROTATIONS.includes(configNumber(spec.rotate)) ? configNumber(spec.rotate) : 0;
  const flipH = Boolean(spec.flipH);
  const flipV = Boolean(spec.flipV);
  const swapped = rotate === 90 || rotate === 270;
  let baseW = swapped ? cropHeight : cropWidth;
  let baseH = swapped ? cropWidth : cropHeight;
  if (rotate) steps.push(`rotate ${rotate}°`);
  if (flipH) steps.push('flip horizontally');
  if (flipV) steps.push('flip vertically');

  const resize = spec.resize || { mode: 'none' };
  let width = baseW;
  let height = baseH;
  let scale = 1;

  if (resize.mode === 'exact') {
    const targetW = clampTransformInt(resize.width, 0, 20000);
    const targetH = clampTransformInt(resize.height, 0, 20000);
    if (targetW > 0 && targetH > 0) {
      width = targetW;
      height = targetH;
      steps.push(`resize to exactly ${width}×${height}`);
    } else {
      errors.push('Exact resizing needs both a width and a height above zero.');
    }
  } else if (resize.mode === 'fit') {
    const boxW = clampTransformInt(resize.width, 1, 20000);
    const boxH = clampTransformInt(resize.height, 1, 20000);
    scale = Math.min(boxW / baseW, boxH / baseH, 1);
    width = Math.max(1, Math.round(baseW * scale));
    height = Math.max(1, Math.round(baseH * scale));
    steps.push(`fit inside ${boxW}×${boxH} → ${width}×${height}`);
  } else if (resize.mode === 'percent') {
    const percent = clampTransformInt(resize.width, 1, 1000);
    scale = percent / 100;
    width = Math.max(1, Math.round(baseW * scale));
    height = Math.max(1, Math.round(baseH * scale));
    steps.push(`resize to ${percent}% → ${width}×${height}`);
  } else if (resize.mode === 'max') {
    const longest = clampTransformInt(resize.width, 1, 20000);
    const currentLongest = Math.max(baseW, baseH);
    if (currentLongest > longest) {
      scale = longest / currentLongest;
      width = Math.max(1, Math.round(baseW * scale));
      height = Math.max(1, Math.round(baseH * scale));
      steps.push(`limit longest edge to ${longest}px → ${width}×${height}`);
    } else {
      steps.push(`longest edge is already ≤ ${longest}px — size unchanged`);
    }
  }

  if (!resize.keepAspect && resize.mode !== 'exact' && (resize.mode === 'fit' || resize.mode === 'max')) {
    warnings.push('"Keep aspect ratio" only applies to exact resizing; other modes always keep it.');
  }

  return {
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    rotate,
    flipH,
    flipV,
    width,
    height,
    scale,
    steps,
    swapped,
  };
}

/**
 * Apply a transform to a drawable source.
 *
 * @param {object} params
 * @param {CanvasImageSource} params.source   canvas, image or bitmap to read from
 * @param {object} params.transform
 * @param {(w:number,h:number,opts?:object)=>{canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D}} params.createCanvas
 * @param {number} [params.sourceWidth]      defaults to the source's own size
 * @param {number} [params.sourceHeight]
 * @returns {{canvas:HTMLCanvasElement, ctx:CanvasRenderingContext2D, width:number, height:number, notes:string[], plan:object}}
 */
export function applyTransform({ source, transform, createCanvas, sourceWidth = 0, sourceHeight = 0, maxPixels = MAX_TRANSFORM_PIXELS }) {
  if (!source) throw new ConversionError('transform-no-source', 'There is no image data to transform.');
  if (typeof createCanvas !== 'function') throw new ConversionError('transform-no-canvas', 'This browser cannot create a canvas to transform into.');

  const srcW = Math.round(configNumber(sourceWidth) || configNumber(source.width) || configNumber(source.naturalWidth) || 0);
  const srcH = Math.round(configNumber(sourceHeight) || configNumber(source.height) || configNumber(source.naturalHeight) || 0);
  if (!(srcW > 0) || !(srcH > 0)) throw new ConversionError('transform-no-size', 'The image has no pixel size, so it cannot be transformed.');

  const checked = validateTransform(transform, { sourceWidth: srcW, sourceHeight: srcH });
  if (!checked.ok) throw new ConversionError('transform-invalid', checked.errors.join(' '));
  const plan = checked.plan;
  const notes = checked.warnings.slice();

  if (plan.width * plan.height > maxPixels) {
    throw new ConversionError(
      'transform-too-large',
      `The result would need ${((plan.width * plan.height) / 1000000).toFixed(0)} MP of canvas memory, above the ${Math.round(maxPixels / 1000000)} MP limit.`,
    );
  }

  // Step 1: crop (a straight copy when nothing was cropped).
  let current = source;
  let currentW = srcW;
  let currentH = srcH;
  const needsCrop = plan.cropWidth !== srcW || plan.cropHeight !== srcH || plan.cropX !== 0 || plan.cropY !== 0;
  if (needsCrop) {
    const cropped = createCanvas(plan.cropWidth, plan.cropHeight, { willReadFrequently: true });
    cropped.ctx.drawImage(source, plan.cropX, plan.cropY, plan.cropWidth, plan.cropHeight, 0, 0, plan.cropWidth, plan.cropHeight);
    current = cropped.canvas;
    currentW = plan.cropWidth;
    currentH = plan.cropHeight;
  }

  // Step 2: rotate + flip + resize in one draw, using the exact planned size.
  const output = createCanvas(plan.width, plan.height);
  const ctx = output.ctx;
  try {
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  } catch {
    /* older engines: defaults are fine */
  }

  // Large reductions look better stepped down than jumped in one pass.
  let work = current;
  let workW = currentW;
  let workH = currentH;
  const rotatedBox = plan.swapped ? { width: plan.height, height: plan.width } : { width: plan.width, height: plan.height };
  while (workW > rotatedBox.width * 2 && workH > rotatedBox.height * 2) {
    const half = createCanvas(Math.max(rotatedBox.width, Math.round(workW / 2)), Math.max(rotatedBox.height, Math.round(workH / 2)));
    half.ctx.drawImage(work, 0, 0, workW, workH, 0, 0, half.canvas.width, half.canvas.height);
    work = half.canvas;
    workW = half.canvas.width;
    workH = half.canvas.height;
    notes.push('Reduced in steps to keep detail while shrinking.');
    if (notes.length > 6) break;
  }

  ctx.save();
  ctx.translate(plan.width / 2, plan.height / 2);
  if (plan.rotate) ctx.rotate((plan.rotate * Math.PI) / 180);
  if (plan.flipH || plan.flipV) ctx.scale(plan.flipH ? -1 : 1, plan.flipV ? -1 : 1);
  ctx.drawImage(work, 0, 0, workW, workH, -rotatedBox.width / 2, -rotatedBox.height / 2, rotatedBox.width, rotatedBox.height);
  ctx.restore();

  for (const step of plan.steps) notes.push(step);
  return { canvas: output.canvas, ctx, width: plan.width, height: plan.height, notes, plan };
}

/**
 * Apply a transform to raw pixel data.
 *
 * Used for animation frames: a GIF is encoded from ImageData buffers, not from a
 * canvas, so each frame is put into a scratch canvas, transformed and read back.
 * Returns the same shape `decodeFrames` produces, so frames stay interchangeable.
 */
export function transformImageData(imageData, transform, createCanvas) {
  if (!imageData || !imageData.width || !imageData.height) {
    throw new ConversionError('transform-no-pixels', 'There is no pixel data to transform.');
  }
  if (typeof createCanvas !== 'function') {
    throw new ConversionError('transform-no-canvas', 'This browser cannot create a canvas to transform into.');
  }
  if (!isTransformActive(transform)) return { imageData, width: imageData.width, height: imageData.height, notes: [] };

  const scratch = createCanvas(imageData.width, imageData.height, { willReadFrequently: true });
  scratch.ctx.putImageData(imageData, 0, 0);
  const applied = applyTransform({
    source: scratch.canvas,
    transform,
    createCanvas,
    sourceWidth: imageData.width,
    sourceHeight: imageData.height,
  });
  const out = applied.ctx.getImageData(0, 0, applied.width, applied.height);
  return { imageData: out, width: applied.width, height: applied.height, notes: applied.notes };
}

/** One-line summary for reports, toasts and the settings panel. */
export function describeTransform(transform) {
  if (!isTransformActive(transform)) return 'no transform';
  const parts = [];
  const resize = transform.resize || {};
  if (resize.mode === 'exact') parts.push(`resize to ${resize.width}×${resize.height}`);
  else if (resize.mode === 'percent') parts.push(`resize to ${resize.width}%`);
  else if (resize.mode === 'max') parts.push(`longest edge ≤ ${resize.width}px`);
  else if (resize.mode === 'fit') parts.push(`fit ${resize.width}×${resize.height}`);
  if (transform.crop) parts.push(`crop ${transform.crop.width}×${transform.crop.height}`);
  if (transform.rotate) parts.push(`rotate ${transform.rotate}°`);
  if (transform.flipH) parts.push('flip horizontal');
  if (transform.flipV) parts.push('flip vertical');
  return parts.join(', ') || 'no transform';
}

function clampTransformInt(value, min, max) {
  const number = Math.round(configNumber(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}
