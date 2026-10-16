/**
 * Conversion orchestration.
 *
 * Explicit pipeline, because each stage can fail in its own way and the user is
 * entitled to know which one did:
 *
 *   resolve target -> acquire pixels (CORS-safe) -> optional downscale
 *   -> optional animation decode -> encode -> name the file -> report
 *
 * Every stage checks the cancellation token, and the function returns a report
 * object describing what actually happened (which acquisition strategy worked,
 * whether frames were dropped, whether transparency was flattened, whether the
 * image was downscaled). The UI shows that report rather than a bare "saved".
 *
 * A dispatched encode is not proof of anything until bytes exist, so the return
 * value always contains a Blob with a verified size, or it throws.
 */

import { getFormat, extensionForFormat } from './formats.js';
import { acquireImage, isSameOrigin, TARGET_KINDS, mimeFromUrl, describeTarget, safeHost } from './source.js';
import {
  ConversionError,
  canvasToImageData,
  createCanvas,
  detectAlpha,
  drawToCanvas,
  encodeNative,
  flattenCanvas,
  blobFromBytes,
  canEncode,
  formatBytes,
  revokeLater,
} from './raster.js';
import { detectAnimation, decodeFrames, sniffMime } from './frames.js';
import { encodeBmp } from '../encoders/bmp.js';
import { encodeGif, subsampleFrames, fitFramesToMemory } from '../encoders/gif.js';
import { encodePdf } from '../encoders/pdf.js';
import { buildFilename, baseNameFromSource } from './filename.js';
import { renderTemplate } from './template.js';
import { applyTransform, describeTransform, isTransformActive, transformImageData } from './transform.js';
import { stripMetadata } from './metadata.js';

/** Above this many pixels an alpha *probe* is done on a reduced copy. */
const ALPHA_PROBE_PIXEL_BUDGET = 8000000;

export class CancelledError extends Error {
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'CancelledError';
    this.code = 'aborted';
  }
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) throw new CancelledError();
}

/**
 * @param {object} params
 * @param {object} params.target        from resolveImageTarget()
 * @param {string} params.formatId
 * @param {object} params.settings      normalised settings
 * @param {object} params.gm            manager adapter
 * @param {string} [params.downloadMode] GM_info.downloadMode ("native"|"browser"|"disabled"|"unknown")
 * @param {object} [params.preacquired]  pixels/bytes already acquired for this target. Batch runs and
 *        format comparisons pass one acquisition in so N outputs cost one request, not N.
 *        The caller owns it: `convertImage` will not release it.
 * @param {object} [params.transform]    resize/crop/rotate/flip spec (see core/transform.js)
 * @param {boolean} [params.stripEmbeddedMetadata] override settings.stripMetadataOnOriginal
 * @param {object} [params.naming]       {index, preset, template, formatId, taken} for template naming
 * @returns {Promise<{blob:Blob, filename:string, path:string, report:object}>}
 */
export async function convertImage({
  target,
  formatId,
  settings,
  gm,
  downloadMode = 'unknown',
  signal,
  onProgress = () => {},
  timeout = 45000,
  preacquired = null,
  transform = null,
  stripEmbeddedMetadata = null,
  naming = null,
}) {
  const started = nowMs();
  const format = getFormat(formatId);
  if (!format) throw new ConversionError('unknown-format', `Unknown output format "${formatId}".`);
  const notes = [];
  const progress = (stage) => {
    throwIfCancelled(signal);
    onProgress(stage, { format: format.label });
  };

  progress('locating image');

  /* ---------- 0. "Original file" of an inline SVG is its own markup ---------- */
  if (format.id === 'original' && target.kind === TARGET_KINDS.INLINE_SVG) {
    progress('serialising SVG');
    const text = svgSerialize(target.element);
    const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
    if (isTransformActive(transform)) {
      throw new ConversionError(
        'transform-needs-format',
        'Transforming needs re-encoding, so it cannot be combined with "Original file". Pick PNG, JPEG or WebP instead.',
      );
    }
    const named = nameFor({ target, settings, ext: 'svg', downloadMode, notes, sourceUrl: '', naming, formatId: format.id, bytes: blob.size });
    return finish({
      blob,
      named,
      notes,
      started,
      target,
      extra: {
        strategy: 'inline-svg-source',
        kind: target.kind,
        passthrough: true,
        formatId: format.id,
        dimensions: { width: 0, height: 0 },
        metadataRemoved: [],
      },
    });
  }

  /* ---------- 1. Acquire pixels ---------- */
  progress('reading image');
  const acquired = preacquired || (await acquireImage(target, { settings, gm, signal, onProgress: progress, timeout }));
  // Whoever acquired it owns its lifetime: a batch or a comparison releases once,
  // after every output that shares those pixels has been produced.
  const release = () => {
    if (preacquired) return;
    try {
      release();
    } catch {
      /* revoking twice is harmless, but never fail a conversion over it */
    }
  };
  throwIfCancelled(signal);

  const sourceUrl = acquired.finalUrl || acquired.url || target.url || '';
  let sourceMime = acquired.mimeHint || mimeFromUrl(sourceUrl) || '';

  /* ---------- 2. "Original file" needs the source bytes ---------- */
  if (format.engine === 'passthrough') {
    if (isTransformActive(transform)) {
      release();
      throw new ConversionError(
        'transform-needs-format',
        'Transforming needs re-encoding, so it cannot be combined with "Original file". Pick PNG, JPEG or WebP instead.',
      );
    }
    progress('reading original bytes');
    const bytes = await getOriginalBytes(acquired, { gm, settings, timeout });
    if (!bytes || !bytes.bytes || !bytes.bytes.length) {
      release();
      throw new ConversionError(
        'no-original-bytes',
        'There is no original file to re-save (canvas and generated images have none). Pick a converted format instead.',
      );
    }
    const sniffed = sniffMime(bytes.bytes);
    if (sniffed) sourceMime = sniffed;

    let outBytes = bytes.bytes;
    const metadataRemoved = [];
    const wantStrip = stripEmbeddedMetadata === null ? Boolean(settings.stripMetadataOnOriginal) : Boolean(stripEmbeddedMetadata);
    if (wantStrip) {
      progress('removing embedded metadata');
      const stripped = stripMetadata(outBytes, sourceMime, { dropIcc: Boolean(settings.dropIccWhenStripping) });
      for (const noteText of stripped.notes) notes.push(noteText);
      if (stripped.changed && stripped.removed.length) {
        outBytes = stripped.bytes;
        metadataRemoved.push(...stripped.removed);
        notes.push(`Embedded metadata removed (${stripped.removed.join(', ')}). The image data itself was not re-encoded.`);
      } else if (!stripped.notes.length) {
        notes.push('No removable metadata was found in this file, so it is byte-identical to the source.');
      }
    }

    const blob = new Blob([outBytes.slice().buffer], { type: sourceMime || 'application/octet-stream' });
    const ext = extensionForFormat(format, sourceMime, sourceUrl);
    const animation = detectAnimation(outBytes, sourceMime);
    if (animation.animated) notes.push(`Animation preserved untouched: ${animation.frameCount || 'multiple'} frames, no re-encoding.`);
    const named = nameFor({ target, settings, ext, downloadMode, notes, sourceUrl, naming, formatId: format.id, bytes: blob.size });
    release();
    return finish({
      blob,
      named,
      notes,
      started,
      target,
      extra: {
        strategy: acquired.strategy,
        kind: acquired.kind,
        passthrough: true,
        animation,
        formatId: format.id,
        sourceMime,
        sourceBytes: outBytes.length,
        dimensions: { width: 0, height: 0 },
        metadataRemoved,
        metadataStripped: wantStrip,
      },
    });
  }

  /* ---------- 3. Rasterise into a canvas ---------- */
  progress('decoding pixels');
  const maxPixels = settings.downscaleAboveMegapixels > 0 ? settings.downscaleAboveMegapixels * 1000000 : 0;
  const needsPixels = format.engine !== 'native'; // bmp / gif / pdf read pixel buffers
  const needsAlpha = needsPixels || format.transparency === false; // jpg / pdf must flatten
  const source = acquired.image || acquired.canvas;
  const drawn = drawToCanvas(source, { maxPixels, willReadFrequently: needsPixels || needsAlpha });
  if (drawn.scaled) {
    notes.push(
      `Downscaled from ${drawn.originalWidth}×${drawn.originalHeight} to ${drawn.width}×${drawn.height} ` +
        `(above your ${settings.downscaleAboveMegapixels} MP limit) to keep the tab responsive.`,
    );
  }
  let workingCanvas = drawn.canvas;
  let workingCtx = drawn.ctx;
  let outWidth = drawn.width;
  let outHeight = drawn.height;
  let flattened = false;
  let transformPlan = null;

  /* ---------- 3b. Optional transform (crop -> rotate/flip -> resize) ---------- */
  if (isTransformActive(transform)) {
    progress('applying crop/resize/rotation');
    const applied = applyTransform({
      source: workingCanvas,
      transform,
      createCanvas,
      sourceWidth: drawn.width,
      sourceHeight: drawn.height,
    });
    workingCanvas = applied.canvas;
    workingCtx = applied.ctx;
    outWidth = applied.width;
    outHeight = applied.height;
    transformPlan = applied.plan;
    notes.push(`Transform applied: ${describeTransform(transform)} → ${outWidth}×${outHeight}px.`);
    for (const noteText of applied.notes) notes.push(noteText);
  }

  const imageData = needsPixels ? canvasToImageData(workingCanvas, workingCtx) : null;
  const alpha = needsAlpha ? probeAlpha(workingCanvas, workingCtx, imageData) : { hasAlpha: false };

  /* ---------- 4. Encode ---------- */
  let blob = null;

  if (format.engine === 'native') {
    if (format.requiresEncodeProbe && !(await canEncode(format.mime))) {
      throw new ConversionError('encoder-unavailable', `${format.label} encoding is not available in this browser (canvas silently falls back to PNG here).`);
    }
    progress(`encoding ${format.label}`);
    if (format.transparency === false && alpha.hasAlpha) {
      const flat = flattenCanvas(workingCanvas, settings.flattenBackground);
      notes.push(`Transparency was flattened onto ${labelBackground(settings.flattenBackground)} because ${format.label} cannot store it.`);
      workingCanvas = flat.canvas;
      workingCtx = flat.ctx;
      flattened = true;
    }
    blob = await encodeNative(workingCanvas, format.mime, qualityFor(format.id, settings));
  } else if (format.engine === 'bmp') {
    progress('encoding BMP');
    if (!alpha.hasAlpha) notes.push('No transparency in this image, so a 24-bit BMP was written (smaller, and readable by everything).');
    else notes.push('Alpha channel preserved: 32-bit BMP with a BITMAPV5 alpha mask.');
    const bytes = encodeBmp(imageData, { alpha: alpha.hasAlpha ? 'always' : 'never' });
    blob = blobFromBytes(bytes, 'image/bmp');
  } else if (format.engine === 'gif') {
    blob = await encodeGifOutput({ acquired, imageData, settings, signal, notes, progress, alpha, sourceMime, gm, timeout, transform, createCanvas });
  } else if (format.engine === 'pdf') {
    progress('encoding PDF');
    let jpegBytes = null;
    // The source JPEG can only be embedded verbatim when the pixels are untouched.
    const embedOriginalJpeg = !drawn.scaled && !transformPlan && sourceMime === 'image/jpeg' && Boolean(acquired.bytes && acquired.bytes.length > 4);
    if (embedOriginalJpeg) {
      jpegBytes = acquired.bytes;
      notes.push('The source JPEG was embedded as-is, so no quality was lost to re-compression.');
    } else {
      let pdfCanvas = workingCanvas;
      if (alpha.hasAlpha) {
        pdfCanvas = flattenCanvas(workingCanvas, settings.flattenBackground).canvas;
        notes.push(`Transparency was flattened onto ${labelBackground(settings.flattenBackground)} because the PDF embeds a JPEG.`);
        flattened = true;
      }
      const jpegBlob = await encodeNative(pdfCanvas, 'image/jpeg', settings.jpegQuality);
      jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    }
    const pdfBytes = encodePdf({
      jpegBytes,
      width: outWidth,
      height: outHeight,
      pageFit: settings.pdfPageFit,
      title: baseNameForTitle({ target, sourceUrl }),
    });
    notes.push(
      settings.pdfPageFit === 'pixel'
        ? `Page size: the image itself (${drawn.width}×${drawn.height}px at 0.75pt per pixel).`
        : `Page size: ${settings.pdfPageFit.toUpperCase()}, image fitted with 24pt margins.`,
    );
    blob = blobFromBytes(pdfBytes, 'application/pdf');
  }

  if (!blob || !(blob.size > 0)) throw new ConversionError('encode-failed', `Encoding to ${format.label} produced no data.`);
  throwIfCancelled(signal);

  const ext = extensionForFormat(format, sourceMime, sourceUrl) || format.ext;
  const named = nameFor({
    target,
    settings,
    ext,
    downloadMode,
    notes,
    sourceUrl,
    naming,
    formatId: format.id,
    width: outWidth,
    height: outHeight,
    bytes: blob.size,
    mime: blob.type,
  });
  if (acquired.objectUrl && !preacquired) revokeLater(acquired.objectUrl, 10000);
  release();

  return finish({
    blob,
    named,
    notes,
    started,
    target,
    extra: {
      strategy: acquired.strategy,
      kind: acquired.kind,
      width: outWidth,
      height: outHeight,
      originalWidth: drawn.originalWidth,
      originalHeight: drawn.originalHeight,
      hadAlpha: alpha.hasAlpha,
      flattened,
      transformed: transformPlan ? describeTransform(transform) : '',
      transformPlan,
      formatId: format.id,
      quality: qualityFor(format.id, settings),
      metadataRemoved: [],
      sourceMime,
    },
  });
}

function finish({ blob, named, notes, started, target, extra }) {
  const report = Object.assign(
    {
      kind: target.kind,
      kindLabel: describeTarget(target),
      bytes: blob.size,
      sizeLabel: formatBytes(blob.size),
      filename: named.filename,
      path: named.path,
      durationMs: Math.max(0, Math.round(nowMs() - started)),
      notes,
      mime: blob.type,
    },
    extra,
  );
  return { blob, filename: named.filename, path: named.path, report };
}

/**
 * Alpha detection. Formats that cannot store transparency (JPG, PDF) must know
 * whether flattening is needed, but a full getImageData on a 40-megapixel image
 * is a needless stall, so above 8 MP the probe runs on a reduced copy. Detecting
 * *any* alpha below 255 in the probe is conclusive; a fully opaque probe result
 * is treated as opaque, which matches how JPEG/PDF output would look anyway.
 */
function probeAlpha(canvas, ctx, alreadyRead) {
  if (alreadyRead) return detectAlpha(alreadyRead);
  const pixels = canvas.width * canvas.height;
  if (pixels <= ALPHA_PROBE_PIXEL_BUDGET) return detectAlpha(canvasToImageData(canvas, ctx));
  const scale = Math.sqrt(ALPHA_PROBE_PIXEL_BUDGET / pixels);
  const probe = createCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)), { willReadFrequently: true });
  probe.ctx.drawImage(canvas, 0, 0, probe.canvas.width, probe.canvas.height);
  return detectAlpha(canvasToImageData(probe.canvas, probe.ctx));
}

async function encodeGifOutput({ acquired, imageData, settings, signal, notes, progress, alpha, sourceMime, gm, timeout, transform = null, createCanvas }) {
  // Frames can only be read from the *encoded* bytes. A same-origin image is
  // normally acquired as pixels (no second request needed), so when animation is
  // wanted the bytes are read here: same-origin through fetch(), cross-origin
  // only through the manager and only if the user left that switch on.
  let bytes = acquired.bytes && acquired.bytes.length ? acquired.bytes : null;
  if (!bytes && settings.keepAnimation) {
    progress('reading the source file to keep its animation');
    try {
      const original = await getOriginalBytes(acquired, { gm, settings, timeout });
      if (original && original.bytes && original.bytes.length) bytes = original.bytes;
    } catch {
      bytes = null; // reported below; the conversion still produces a still frame
    }
    if (!bytes) {
      notes.push(
        'The source file could not be re-read, so any animation could not be checked and the GIF holds the first frame only. ' +
          'Choose "Original file" to keep the animation intact.',
      );
    }
  }
  const animation = bytes ? detectAnimation(bytes, sourceMime) : { animated: false, frameCount: null };

  if (animation.animated && settings.keepAnimation) {
    progress('decoding animation');
    const decoded = await decodeFrames({
      bytes,
      mime: sourceMime || animation.format,
      maxFrames: settings.gifMaxFrames,
      memoryLimitMB: settings.gifMemoryLimitMB,
      signal,
    });
    for (const note of decoded.notes) notes.push(note);
    if (decoded.frames && decoded.frames.length > 1) {
      progress('encoding animated GIF');
      let frames = decoded.frames;
      let width = decoded.width;
      let height = decoded.height;
      if (isTransformActive(transform)) {
        progress('transforming every animation frame');
        frames = frames.map((frame) => {
          const changed = transformImageData(frame.imageData, transform, createCanvas);
          return { imageData: changed.imageData, delayMs: frame.delayMs };
        });
        width = frames[0].imageData.width;
        height = frames[0].imageData.height;
        notes.push(`Transform applied to all ${frames.length} animation frames → ${width}×${height}px.`);
      }
      notes.push(`Animated GIF written with ${frames.length} frames at ${width}×${height}.`);
      return encodeGifBlob(frames, notes, settings);
    }
    notes.push(
      'This image is animated, but this browser could not extract its frames, so the GIF holds the first frame only. ' +
        'Choose "Original file" to keep the animation intact.',
    );
  } else if (animation.animated) {
    notes.push('Animation conversion is off in your settings, so the GIF holds the first frame only.');
  }

  progress('encoding GIF');
  const memoryMB = (imageData.width * imageData.height * 4) / 1048576;
  if (settings.gifMemoryLimitMB > 0 && memoryMB > settings.gifMemoryLimitMB) {
    throw new ConversionError(
      'memory-limit',
      `A GIF at ${imageData.width}×${imageData.height} needs about ${memoryMB.toFixed(0)} MB of pixel memory, above your ` +
        `${settings.gifMemoryLimitMB} MB safety limit. Raise the limit in settings or pick another format.`,
    );
  }
  if (alpha.hasAlpha) notes.push('GIF transparency is binary: partially transparent pixels became fully transparent.');
  return encodeGifBlob([{ imageData, delayMs: 0 }], notes, settings);
}

function encodeGifBlob(frames, notes, settings) {
  const prepared = subsampleFrames(frames, Math.max(1, settings.gifMaxFrames));
  if (prepared.dropped > 0) notes.push(`${prepared.dropped} frames were dropped to respect the ${settings.gifMaxFrames}-frame limit.`);

  const fitted = fitFramesToMemory(prepared.frames, settings.gifMemoryLimitMB);
  if (fitted.overLimitWithOneFrame) {
    const single = fitted.frames[0].imageData;
    throw new ConversionError(
      'memory-limit',
      `A single ${single.width}×${single.height} GIF frame needs about ${(fitted.bytes / 1048576).toFixed(0)} MB of pixel memory, above your ` +
        `${settings.gifMemoryLimitMB} MB safety limit. Raise the limit in settings or pick another format.`,
    );
  }
  if (fitted.dropped > 0) {
    notes.push(
      `${fitted.dropped} more frame${fitted.dropped === 1 ? '' : 's'} were dropped to stay inside the ${settings.gifMemoryLimitMB} MB animation ` +
        `memory limit (${fitted.frames.length} frames ≈ ${(fitted.bytes / 1048576).toFixed(1)} MB).`,
    );
  }
  return blobFromBytes(encodeGif(fitted.frames, { loop: 0 }), 'image/gif');
}

/**
 * Original file bytes for an already-acquired image.
 *
 * Exported so the metadata inspector and the clipboard path reuse the *same*
 * audited read instead of opening a second network choke point: same-origin
 * images are fetched with same-origin credentials only, cross-origin bytes come
 * through the manager and only when the user left that switch on.
 */
export async function getOriginalBytes(acquired, { gm, settings, timeout }) {
  if (acquired.bytes && acquired.bytes.length) return { bytes: acquired.bytes, mime: acquired.mimeHint };
  const url = acquired.url;
  if (!url) return null;

  if (isSameOrigin(url)) {
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller && timeout ? setTimeout(() => controller.abort(), timeout) : null;
      const response = await fetch(url, { credentials: 'same-origin', signal: controller ? controller.signal : undefined });
      if (timer) clearTimeout(timer);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength) {
          return { bytes: new Uint8Array(buffer), mime: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
        }
      }
    } catch {
      /* fall through to the manager fetch */
    }
  }
  if (settings.allowCrossOriginFetch && gm && gm.capabilities.xhr) {
    const fetched = await acquired.getBytes();
    if (fetched && fetched.bytes && fetched.bytes.length) return fetched;
  }
  return null;
}

/**
 * Build the output name.
 *
 * A file-name template, when set, replaces the prefix (having both would produce
 * "prefix-prefix-name"), which is reported once per run rather than once per
 * file. Template tokens are filled from the page and the image, both untrusted,
 * so every value is sanitised by renderTemplate/buildFilename before use.
 */
function nameFor({ target, settings, ext, downloadMode, notes, sourceUrl, naming = null, formatId = '', width = 0, height = 0, bytes = 0, mime = '' }) {
  const base = baseNameForTitle({ target, sourceUrl });
  const template = String((naming && naming.template !== undefined ? naming.template : settings.filenameTemplate) || '');
  let stem = base;
  let prefix = settings.filenamePrefix;

  if (template) {
    const rendered = renderTemplate(
      template,
      {
        base,
        path: base,
        host: safeHost(sourceUrl || target.url || ''),
        origin: safePageHost(),
        title: safeTitle(),
        alt: target.altText || '',
        w: width || 0,
        h: height || 0,
        format: formatId || ext,
        ext,
        mime: subtypeOf(mime || ext),
        bytes: bytes || 0,
      },
      {
        counter: naming && Number(naming.index) > 0 ? Number(naming.index) : 1,
        preset: (naming && naming.preset) || settings.activePresetName || '',
      },
    );
    const first = !naming || naming.index === undefined || Number(naming.index) === 1;
    for (const warning of rendered.warnings) {
      if (first) notes.push(warning);
    }
    if (rendered.text) {
      stem = rendered.text;
      if (settings.filenamePrefix) {
        if (first) notes.push('The file-name template replaced the prefix setting, so the prefix was not added.');
        prefix = '';
      }
    }
  }

  const includeSubfolder = managerSupportsSubfolder(downloadMode) && Boolean(settings.subfolder);
  const result = buildFilename({
    base: stem,
    ext,
    prefix,
    subfolder: settings.subfolder,
    maxLength: settings.maxFilenameLength,
    includeSubfolder,
  });
  if (result.droppedSubfolder) {
    notes.push(
      `Your sub-folder setting ("${result.path === result.filename ? settings.subfolder : ''}") was ignored: this manager saves through the ` +
        `${describeDownloadMode(downloadMode)}, which cannot pick a folder.`,
    );
  }
  if (result.truncated) notes.push(`File name shortened to your ${settings.maxFilenameLength}-character limit.`);
  return result;
}

function baseNameForTitle({ target, sourceUrl }) {
  return baseNameFromSource({
    sourceUrl: sourceUrl || target.url || '',
    altText: target.altText,
    documentTitle: safeTitle(),
    hostName: safeHost(sourceUrl || target.url || ''),
  });
}

/**
 * Sub-folders only work when the manager delegates to the browser download API
 * (Tampermonkey: downloadMode "browser"). Violentmonkey documents that folders
 * and subpaths in GM_download names are not supported, and "native" mode is a
 * plain <a download> click, where the browser strips path separators. Claiming
 * otherwise would be a lie in the file name, so the setting is honoured only
 * where it can actually work and explained where it cannot.
 */
export function managerSupportsSubfolder(downloadMode) {
  return downloadMode === 'browser';
}

function describeDownloadMode(downloadMode) {
  if (downloadMode === 'native') return "browser's native anchor-download path";
  if (downloadMode === 'disabled') return 'manager with downloads disabled';
  if (downloadMode === 'browser') return 'browser download API';
  return 'default download path';
}

function qualityFor(formatId, settings) {
  if (formatId === 'jpg' || formatId === 'pdf') return settings.jpegQuality;
  if (formatId === 'webp' || formatId === 'avif') return settings.webpQuality;
  return undefined;
}

function labelBackground(value) {
  if (value === 'black') return 'black';
  if (value === 'checker') return 'a light-grey checkerboard';
  return 'white';
}

function safeTitle() {
  try {
    return document.title || '';
  } catch {
    return '';
  }
}

function safePageHost() {
  try {
    return (typeof location !== 'undefined' && location.hostname) || '';
  } catch {
    return '';
  }
}

function subtypeOf(mime) {
  const text = String(mime || '');
  const slash = text.indexOf('/');
  return slash >= 0 ? text.slice(slash + 1).split(';')[0].trim() : text;
}

function nowMs() {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

/** Serialise an inline <svg> without mutating the live element. */
function svgSerialize(svgElement) {
  const clone = svgElement.cloneNode(true);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const viewBox = clone.getAttribute('viewBox');
  const box = typeof svgElement.getBoundingClientRect === 'function' ? svgElement.getBoundingClientRect() : null;
  if (viewBox && (!clone.getAttribute('width') || !clone.getAttribute('height'))) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      if (!clone.getAttribute('width') && parts[2] > 0) clone.setAttribute('width', String(Math.round(parts[2])));
      if (!clone.getAttribute('height') && parts[3] > 0) clone.setAttribute('height', String(Math.round(parts[3])));
    }
  }
  if (box) {
    if (!clone.getAttribute('width') && box.width > 0) clone.setAttribute('width', String(Math.round(box.width)));
    if (!clone.getAttribute('height') && box.height > 0) clone.setAttribute('height', String(Math.round(box.height)));
  }
  return new XMLSerializer().serializeToString(clone);
}
