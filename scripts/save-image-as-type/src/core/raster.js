/**
 * Raster plumbing: canvas creation, decoding, alpha detection, flattening and
 * native (canvas.toBlob) encoding.
 *
 * The single most important line in this module is inside `encodeNative`:
 * canvas.toBlob() does NOT fail for an unsupported MIME type — per spec it
 * quietly returns a PNG. Measured on Chrome 131 (see test/browser/report):
 * requesting image/avif, image/gif or image/bmp all return a blob whose
 * `.type` is "image/png" and whose bytes are identical to a PNG encode. Any
 * script that only checks `blob !== null` would hand the user a PNG named
 * .avif and report success. So every native encode is verified against the
 * requested MIME type, and formats that need a real encoder (BMP, GIF, PDF)
 * have one written from the format specification instead.
 */

export class ConversionError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.detail = detail || null;
  }
}

export function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ConversionError('timeout', `${label} timed out after ${Math.round(ms / 1000)}s.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function createCanvas(width, height, { willReadFrequently = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new ConversionError('no-2d-context', 'This browser refused to create a 2D drawing context.');
  return { canvas, ctx };
}

/** Decode any blob/URL into an HTMLImageElement that is ready to draw. */
export function loadImage(src, { timeout = 20000, crossOrigin = null } = {}) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const image = new Image();
      if (crossOrigin) image.crossOrigin = crossOrigin;
      image.decoding = 'sync';
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
      };
      image.onload = () => {
        cleanup();
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new ConversionError('empty-image', 'The image decoded but has zero dimensions.'));
          return;
        }
        resolve(image);
      };
      image.onerror = () => {
        cleanup();
        reject(new ConversionError('decode-failed', `The browser could not decode ${crossOrigin ? 'a cross-origin ' : ''}image data.`));
      };
      image.src = src;
    }),
    timeout,
    'Image decode',
  );
}

/**
 * Decode already-owned bytes without weakening the document's CSP. Retain the
 * legacy image path first; Bitmap fallback is only for a failed image decode.
 * The returned lease owns its URL/bitmap and must be disposed by the acquirer.
 */
export async function loadBlobImage(blob, { timeout = 20000, signal = null, bitmapOnly = false } = {}) {
  const cancelled = () => new ConversionError('aborted', 'Cancelled.');
  if (signal && signal.aborted) throw cancelled();
  let originalError = new ConversionError('decode-failed', 'The browser could not decode image data.');
  if (!bitmapOnly) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await loadImage(objectUrl, { timeout });
      if (signal && signal.aborted) throw cancelled();
      let disposed = false;
      return { image, objectUrl, dispose() {
        if (disposed) return;
        disposed = true;
        URL.revokeObjectURL(objectUrl);
      } };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      if (error.code !== 'decode-failed') throw error;
      originalError = error;
    }
  }
  if (typeof createImageBitmap !== 'function') throw originalError;
  let abandoned = false;
  let received = null;
  let closed = false;
  const close = () => {
    if (!received || closed) return;
    closed = true;
    received.close();
  };
  const pending = Promise.resolve().then(() => createImageBitmap(blob));
  // A timeout/abort cannot cancel a native decode. Reclaim any late bitmap.
  pending.then((bitmap) => {
    received = bitmap;
    if (abandoned) close();
  }, () => {});
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(cancelled());
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
  try {
    const image = await withTimeout(Promise.race([pending, aborted]), timeout, 'Image decode');
    if (signal && signal.aborted) throw cancelled();
    return { image, objectUrl: null, dispose: close };
  } catch (error) {
    abandoned = true;
    close();
    if (error && (error.code === 'timeout' || error.code === 'aborted')) throw error;
    throw originalError;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** RFC2397 payload decoding; no network or CSP-dependent fetch(data:) needed. */
export function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (!/^data:/i.test(url) || comma < 0) throw new ConversionError('decode-failed', 'The browser could not decode image data.');
  const header = url.slice(5, comma);
  const mime = (header.split(';')[0] || 'text/plain').toLowerCase();
  const payload = url.slice(comma + 1);
  let bytes;
  if (/;base64$/i.test(header)) {
    // Percent-escaped base64 is legal as a URL payload, too.
    const binary = atob(decodeURIComponent(payload));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else {
    const encoded = new TextEncoder().encode(payload);
    const decoded = new Uint8Array(encoded.length);
    let used = 0;
    for (let i = 0; i < encoded.length; i += 1) {
      if (encoded[i] === 37) {
        const pair = String.fromCharCode(encoded[i + 1], encoded[i + 2]);
        if (!/^[a-f0-9]{2}$/i.test(pair)) throw new ConversionError('decode-failed', 'The browser could not decode image data.');
        decoded[used++] = parseInt(pair, 16);
        i += 2;
      } else decoded[used++] = encoded[i];
    }
    bytes = decoded.subarray(0, used);
  }
  return { bytes, mime };
}

/** Draw any image-like source into a fresh canvas, optionally downscaling. */
export function drawToCanvas(source, { maxPixels = 0, willReadFrequently = false } = {}) {
  const width = source.naturalWidth || source.width || 0;
  const height = source.naturalHeight || source.height || 0;
  if (!width || !height) throw new ConversionError('no-dimensions', 'Could not determine the image dimensions.');

  let targetW = width;
  let targetH = height;
  let scaled = false;
  if (maxPixels > 0 && width * height > maxPixels) {
    const ratio = Math.sqrt(maxPixels / (width * height));
    targetW = Math.max(1, Math.round(width * ratio));
    targetH = Math.max(1, Math.round(height * ratio));
    scaled = true;
  }

  const { canvas, ctx } = createCanvas(targetW, targetH, { willReadFrequently });
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetW, targetH);
  return { canvas, ctx, width: targetW, height: targetH, scaled, originalWidth: width, originalHeight: height };
}

export function canvasToImageData(canvas, ctx) {
  const context = ctx || canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new ConversionError('no-2d-context', 'Lost the 2D context while reading pixels.');
  try {
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch (err) {
    // SecurityError here means the canvas is tainted — the caller must know,
    // because that is the signal to retry the fetch through the manager.
    if (err && (err.name === 'SecurityError' || /tainted|origin/i.test(String(err.message)))) {
      throw new ConversionError('tainted-canvas', 'The canvas is tainted by cross-origin data, so its pixels cannot be read.', err);
    }
    throw new ConversionError('read-pixels-failed', err && err.message ? err.message : String(err), err);
  }
}

export function imageDataToCanvas(imageData) {
  const { canvas, ctx } = createCanvas(imageData.width, imageData.height, { willReadFrequently: true });
  ctx.putImageData(imageData, 0, 0);
  return { canvas, ctx };
}

/** Scan for any non-opaque pixel. Early-exits, so opaque photos are cheap. */
export function detectAlpha(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return { hasAlpha: true, sampleIndex: (i - 3) / 4 };
  }
  return { hasAlpha: false, sampleIndex: -1 };
}

const BACKGROUND_COLORS = {
  white: '#ffffff',
  black: '#000000',
  checker: null,
};

/** Composite a canvas over an opaque background (needed for JPG/PDF/GIF-no-alpha). */
export function flattenCanvas(sourceCanvas, background = 'white') {
  const { canvas, ctx } = createCanvas(sourceCanvas.width, sourceCanvas.height);
  if (background === 'checker') {
    const size = 8;
    for (let y = 0; y < canvas.height; y += size) {
      for (let x = 0; x < canvas.width; x += size) {
        ctx.fillStyle = ((x / size + y / size) | 0) % 2 === 0 ? '#ffffff' : '#cccccc';
        ctx.fillRect(x, y, Math.min(size, canvas.width - x), Math.min(size, canvas.height - y));
      }
    }
  } else {
    ctx.fillStyle = BACKGROUND_COLORS[background] || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(sourceCanvas, 0, 0);
  return { canvas, ctx };
}

/**
 * canvas.toBlob with a verification step. Rejects with code 'encoder-fallback'
 * if the browser silently substituted another format (e.g. AVIF → PNG).
 */
export function encodeNative(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    let done = false;
    try {
      const args = quality === undefined || quality === null ? [cb, mime] : [cb, mime, quality];
      function cb(blob) {
        if (done) return;
        done = true;
        if (!blob) {
          reject(new ConversionError('encode-failed', `The browser produced no data for ${mime}.`));
          return;
        }
        if (blob.type && blob.type !== mime) {
          reject(
            new ConversionError(
              'encoder-fallback',
              `This browser cannot encode ${mime} (it returned ${blob.type} instead).`,
              { requested: mime, returned: blob.type },
            ),
          );
          return;
        }
        resolve(blob);
      }
      canvas.toBlob(...args);
    } catch (err) {
      if (done) return;
      done = true;
      reject(new ConversionError('encode-threw', err && err.message ? err.message : String(err), err));
    }
  });
}

const encoderProbeCache = new Map();

/**
 * True when this browser can genuinely encode `mime`. Cached: the probe costs
 * one 1x1 toBlob and runs at most once per format per page.
 */
export async function canEncode(mime) {
  if (encoderProbeCache.has(mime)) return encoderProbeCache.get(mime);
  const promise = (async () => {
    try {
      const { canvas } = createCanvas(1, 1);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.8));
      return Boolean(blob && blob.type === mime);
    } catch {
      return false;
    }
  })();
  encoderProbeCache.set(mime, promise);
  return promise;
}

export function blobFromBytes(bytes, mime) {
  return new Blob([bytes instanceof Uint8Array ? bytes.slice().buffer : bytes], { type: mime });
}

export function objectUrlFor(blob) {
  return URL.createObjectURL(blob);
}

/** Revoke an object URL later without leaking it if the page unloads first. */
const pendingRevocations = new Set();
export function revokeLater(objectUrl, delay = 60000) {
  if (!objectUrl || !objectUrl.startsWith('blob:')) return;
  pendingRevocations.add(objectUrl);
  setTimeout(() => {
    pendingRevocations.delete(objectUrl);
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* already revoked */
    }
  }, delay);
}

export function revokeAllPending() {
  for (const url of pendingRevocations) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  }
  pendingRevocations.clear();
}

/** Serialise an inline <svg> element so it can be rasterised through an Image. */
export function svgElementToBlob(svgElement) {
  const clone = svgElement.cloneNode(true);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const box = svgElement.getBoundingClientRect();
  const viewBox = clone.getAttribute('viewBox');
  if (!clone.getAttribute('width') && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0) clone.setAttribute('width', String(Math.round(parts[2])));
    if (parts.length === 4 && parts[3] > 0) clone.setAttribute('height', String(Math.round(parts[3])));
  }
  if (!clone.getAttribute('width') && box.width > 0) clone.setAttribute('width', String(Math.round(box.width)));
  if (!clone.getAttribute('height') && box.height > 0) clone.setAttribute('height', String(Math.round(box.height)));
  const text = new XMLSerializer().serializeToString(clone);
  return new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
}

/** Legacy URL helper retained for thumbnail/preview callers. */
export function svgElementToObjectUrl(svgElement) {
  return URL.createObjectURL(svgElementToBlob(svgElement));
}

/** Format a byte count for the UI without pulling in a locale library. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
