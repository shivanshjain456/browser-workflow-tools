/**
 * Finding the image the user actually meant, and getting its pixels legally.
 *
 * Two hard problems live here:
 *
 * 1. "Any image on the page" is more than <img>. Real pages use srcset/<picture>
 *    (the browser picks a candidate — `currentSrc` tells us which one is on
 *    screen), inline <svg>, <svg><image href>, <canvas>, and CSS
 *    background-image / list-style-image (including ::before and ::after, which
 *    is how most icon systems work). Each gets its own resolution path.
 *
 * 2. Cross-origin pixel access. The browser extension this is ported from needs
 *    "<all_urls>" for exactly this reason: without CORS permission, drawing a
 *    CDN-hosted image into a canvas *taints* it and getImageData() throws, so no
 *    conversion is possible at all. A userscript's equivalent is
 *    GM_xmlhttpRequest, which is why @connect * is declared. The strategy chain
 *    below tries the cheapest legal route first (same-origin → CORS-enabled
 *    image load → manager fetch) and *verifies* cleanliness with a real
 *    getImageData probe instead of assuming, because a same-origin URL that
 *    redirects to another origin taints the canvas just the same.
 */

import { ConversionError, createCanvas, loadImage, canvasToImageData, svgElementToBlob, loadBlobImage, decodeDataUrl, withTimeout } from './raster.js';

export const TARGET_KINDS = {
  IMG: 'img',
  SVG_IMAGE: 'svg-image',
  INLINE_SVG: 'inline-svg',
  CANVAS: 'canvas',
  BACKGROUND: 'background',
};

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]+))\s*\)/g;
const MAX_ANCESTORS = 12;

/**
 * @param {Element} element the element the pointer was over
 * @returns {object|null} target descriptor
 */
export function resolveImageTarget(element, { enableBackgroundImages = true } = {}) {
  if (!element || element.nodeType !== 1) return null;
  const doc = element.ownerDocument || document;
  const baseURI = doc.baseURI || (doc.location && doc.location.href) || '';

  // 1. <img>, <input type=image>
  if (element.tagName === 'IMG' || (element.tagName === 'INPUT' && element.getAttribute('type') === 'image')) {
    const url = element.currentSrc || element.src || element.getAttribute('src') || '';
    return {
      kind: TARGET_KINDS.IMG,
      element,
      url: absolutize(url, baseURI),
      altText: element.getAttribute('alt') || '',
      naturalWidth: element.naturalWidth || 0,
      naturalHeight: element.naturalHeight || 0,
      hasSrcset: Boolean(element.getAttribute('srcset') || closestPictureSource(element)),
    };
  }

  // 2. <image> inside an <svg>
  if (element.tagName === 'image' || element.localName === 'image') {
    const href = element.getAttribute('href') || element.getAttribute('xlink:href') || '';
    if (href) {
      return {
        kind: TARGET_KINDS.SVG_IMAGE,
        element,
        url: absolutize(href, baseURI),
        altText: '',
        insideSvg: true,
      };
    }
  }

  // 3. Inline <svg> (or a child of one) → rasterise the whole vector graphic
  const svgRoot = element.closest ? element.closest('svg') : null;
  if (svgRoot) {
    const nested = svgRoot.querySelector('image');
    if (nested) {
      const href = nested.getAttribute('href') || nested.getAttribute('xlink:href') || '';
      if (href) {
        return { kind: TARGET_KINDS.SVG_IMAGE, element: nested, url: absolutize(href, baseURI), altText: '', insideSvg: true };
      }
    }
    return { kind: TARGET_KINDS.INLINE_SVG, element: svgRoot, url: '', altText: svgRoot.getAttribute('aria-label') || '', inlineSvg: true };
  }

  // 4. <canvas>
  if (element.tagName === 'CANVAS') {
    return { kind: TARGET_KINDS.CANVAS, element, url: '', altText: element.getAttribute('aria-label') || '', canvasElement: element };
  }

  // 5. CSS background / list-style image on the element or a nearby ancestor
  if (enableBackgroundImages) {
    const found = findBackgroundImage(element, baseURI);
    if (found) return found;
  }

  return null;
}

function closestPictureSource(img) {
  const picture = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
  if (!picture) return null;
  return picture.querySelector('source[srcset]');
}

function findBackgroundImage(startElement, baseURI) {
  let node = startElement;
  for (let depth = 0; node && depth < MAX_ANCESTORS; depth += 1, node = node.parentElement) {
    const candidates = ['', '::before', '::after'];
    for (const pseudo of candidates) {
      let style = null;
      try {
        style = window.getComputedStyle(node, pseudo || null);
      } catch {
        continue;
      }
      if (!style) continue;
      const value = style.backgroundImage || style.getPropertyValue('background-image') || '';
      const url = firstImageUrl(value);
      if (url) {
        return {
          kind: TARGET_KINDS.BACKGROUND,
          element: node,
          url: absolutize(url, baseURI),
          altText: node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title')) || '',
          pseudo,
          cssText: value.slice(0, 120),
          boxWidth: node.clientWidth || 0,
          boxHeight: node.clientHeight || 0,
        };
      }
      const listValue = pseudo === '' ? style.listStyleImage || '' : '';
      const listUrl = firstImageUrl(listValue);
      if (listUrl) {
        return {
          kind: TARGET_KINDS.BACKGROUND,
          element: node,
          url: absolutize(listUrl, baseURI),
          altText: '',
          pseudo: 'list-style',
          cssText: listValue.slice(0, 120),
        };
      }
    }
  }
  return null;
}

/** First real image url() in a CSS value; gradients have no url() and are rejected. */
export function firstImageUrl(cssValue) {
  if (typeof cssValue !== 'string' || !cssValue || cssValue === 'none') return '';
  URL_RE.lastIndex = 0;
  let match;
  while ((match = URL_RE.exec(cssValue))) {
    const raw = (match[1] || match[2] || match[3] || '').trim();
    if (!raw) continue;
    if (/^linear-gradient|^radial-gradient|^conic-gradient|^repeating-|^image-set\(/i.test(raw)) continue;
    // CSS escapes (e.g. \201C) are rare in url(); decode the common ones safely.
    return raw.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
  }
  return '';
}

export function absolutize(url, base) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^(data:|blob:)/i.test(trimmed)) return trimmed;
  // Callers pass a base URI string, a Document or an Element; a node has to be
  // turned into its baseURI first, because `new URL(x, document)` stringifies
  // the document to "[object HTMLDocument]" and silently fails.
  const baseUri =
    typeof base === 'string' && base ? base : (base && (base.baseURI || (base.ownerDocument && base.ownerDocument.baseURI))) || undefined;
  try {
    return new URL(trimmed, baseUri).href;
  } catch {
    return trimmed;
  }
}

/** True when the URL is same-origin with the current document. */
export function isSameOrigin(url) {
  if (!url) return false;
  if (/^(data:|blob:)/i.test(url)) return true; // decodable without any network at all
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Acquire decodable pixels for a resolved target.
 *
 * @returns {Promise<Acquired>} where Acquired = {
 *   kind, url, image|canvas, objectUrl?, strategy, mimeHint, width, height,
 *   getBytes(): Promise<{bytes, mime}|null>,  // lazy: only fetched if a format needs the originals
 * }
 */
export async function acquireImage(target, { settings, gm, signal, onProgress = () => {}, timeout = 25000 } = {}) {
  if (!target) throw new ConversionError('no-target', 'No image was found at that position.');
  const progress = (stage, detail) => onProgress(stage, detail);

  // Inline SVG: serialise and rasterise. No network, no taint.
  if (target.kind === TARGET_KINDS.INLINE_SVG) {
    progress('serialising SVG');
    const decoded = await loadBlobImage(svgElementToBlob(target.element), { timeout, signal });
    try {
      return acquired({
        kind: target.kind, url: '', image: decoded.image,
        objectUrl: decoded.objectUrl, dispose: decoded.dispose,
        strategy: 'inline-svg', mimeHint: 'image/svg+xml', altText: target.altText,
        width: decoded.image.naturalWidth || decoded.image.width,
        height: decoded.image.naturalHeight || decoded.image.height,
      });
    } catch (error) {
      decoded.dispose();
      throw error;
    }
  }

  // <canvas>: copy the pixels, then verify they are readable.
  if (target.kind === TARGET_KINDS.CANVAS) {
    progress('reading canvas');
    const source = target.canvasElement || target.element;
    if (!source.width || !source.height) throw new ConversionError('empty-canvas', 'That canvas has no pixels yet.');
    const { canvas, ctx } = createCanvas(source.width, source.height, { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    try {
      canvasToImageData(canvas, ctx);
    } catch (err) {
      if (err && err.code === 'tainted-canvas') {
        throw new ConversionError(
          'tainted-canvas',
          'That canvas contains cross-origin data the page is not allowed to read, so its pixels cannot be exported. This is a browser security restriction, not a bug in the script.',
        );
      }
      throw err;
    }
    return acquired({
      kind: target.kind,
      url: '',
      canvas,
      strategy: 'canvas-copy',
      mimeHint: '',
      altText: target.altText,
      width: canvas.width,
      height: canvas.height,
    });
  }

  const url = target.url;
  if (!url) throw new ConversionError('no-source', 'That image has no source URL (it may still be loading, or it failed to load).');
  if (/^blob:/i.test(url) && !isSameOriginBlob(url)) {
    // Blob URLs are only meaningful inside the document that created them.
    progress('reading blob URL');
  }

  // Route 1: no network needed at all.
  if (/^data:/i.test(url)) {
    progress('decoding data URL');
    try {
      const image = await loadImage(url, { timeout });
      return acquired({
        kind: target.kind, url, image, strategy: 'data-url',
        mimeHint: dataUrlMime(url), altText: target.altText,
        width: image.naturalWidth, height: image.naturalHeight,
      });
    } catch (error) {
      if (error.code !== 'decode-failed') throw error;
      const data = decodeDataUrl(url);
      const decoded = await loadBlobImage(new Blob([data.bytes], { type: data.mime }), { timeout, signal, bitmapOnly: true });
      return acquired({
        kind: target.kind, url, image: decoded.image, dispose: decoded.dispose,
        strategy: 'data-url', mimeHint: data.mime, bytes: data.bytes,
        width: decoded.image.width, height: decoded.image.height, altText: target.altText,
      });
    }
  }

  // Route 2: same-origin (or a blob URL from this document) — plain decode.
  if (isSameOrigin(url)) {
    progress('decoding image');
    try {
      const image = await loadImage(url, { timeout });
      const probe = await verifyReadable(image);
      return acquired({
        kind: target.kind, url, image, strategy: 'same-origin',
        mimeHint: probe.mimeHint || mimeFromUrl(url), altText: target.altText,
        width: image.naturalWidth, height: image.naturalHeight,
        byteSource: () => fetchBytes(url, gm, settings, signal, timeout),
      });
    } catch (err) {
      if (!(err && err.code === 'tainted-canvas')) throw err;
      // A same-origin URL redirected to another origin. Fall through to CORS.
    }
  }

  // Route 3: cross-origin, but the server may allow anonymous reads.
  progress('requesting CORS-enabled copy');
  try {
    const image = await loadImage(url, { timeout, crossOrigin: 'anonymous' });
    await verifyReadable(image);
    return acquired({
      kind: target.kind, url, image, strategy: 'cors-anonymous',
      mimeHint: mimeFromUrl(url), altText: target.altText,
      width: image.naturalWidth, height: image.naturalHeight,
      byteSource: () => fetchBytes(url, gm, settings, signal, timeout),
    });
  } catch (err) {
    if (err && err.code === 'timeout') throw err;
    /* fall through to the manager fetch */
  }

  // Route 4: fetch the bytes through the userscript manager (the CORS bypass).
  // The grant is checked first: if the manager never gave us GM_xmlhttpRequest,
  // telling the user to flip a setting that cannot work would send them in the
  // wrong direction.
  if (!gm || !gm.capabilities.xhr) {
    throw new ConversionError(
      'xhr-unavailable',
      `This image is cross-origin (${safeHost(url)}) and your userscript manager did not grant GM_xmlhttpRequest, so its pixels cannot be read.` +
        (settings && settings.allowCrossOriginFetch === false ? ' (Cross-origin fetching is also turned off in your settings.)' : ''),
    );
  }
  if (!settings || settings.allowCrossOriginFetch === false) {
    throw new ConversionError(
      'cors-blocked',
      `This image is hosted on another origin (${safeHost(url)}) which does not permit cross-origin reading, and "Fetch cross-origin images" is turned off in settings. Turn it on to convert this image.`,
    );
  }

  progress('fetching image data');
  const fetched = await fetchBytes(url, gm, settings, signal, timeout);
  if (!fetched) throw new ConversionError('fetch-failed', `Could not fetch ${safeHost(url)} image data.`);
  const blob = new Blob([fetched.bytes], { type: fetched.mime || mimeFromUrl(url) || 'application/octet-stream' });
  const decoded = await loadBlobImage(blob, { timeout, signal });
  try {
    await verifyReadable(decoded.image);
    return acquired({
      kind: target.kind, url, image: decoded.image,
      objectUrl: decoded.objectUrl, dispose: decoded.dispose, strategy: 'manager-fetch',
      mimeHint: fetched.mime || mimeFromUrl(url), altText: target.altText,
      width: decoded.image.naturalWidth || decoded.image.width,
      height: decoded.image.naturalHeight || decoded.image.height,
      bytes: fetched.bytes, finalUrl: fetched.finalUrl,
    });
  } catch (error) {
    decoded.dispose();
    throw error;
  }
}

function acquired(spec) {
  let cachedBytes = spec.bytes ? { bytes: spec.bytes, mime: spec.mimeHint || '', finalUrl: spec.finalUrl || spec.url || '' } : null;
  let released = false;
  return {
    kind: spec.kind,
    url: spec.url,
    image: spec.image || null,
    bytes: spec.bytes || null,
    canvas: spec.canvas || null,
    objectUrl: spec.objectUrl || null,
    strategy: spec.strategy,
    mimeHint: spec.mimeHint || '',
    altText: spec.altText || '',
    width: spec.width || 0,
    height: spec.height || 0,
    finalUrl: spec.finalUrl || spec.url || '',
    release() {
      if (released) return;
      released = true;
      if (spec.dispose) { spec.dispose(); return; }
      if (spec.objectUrl) revokeObjectUrlNow(spec.objectUrl);
    },
    /** Original file bytes, fetched only when a format needs them (e.g. "Original file"). */
    async getBytes() {
      if (cachedBytes) return cachedBytes;
      if (typeof spec.byteSource === 'function') {
        const result = await spec.byteSource();
        cachedBytes = result;
        return result;
      }
      return null;
    },
  };
}

/** Draw the image and prove the canvas is readable. Returns a mime hint when known. */
async function verifyReadable(image) {
  const { canvas, ctx } = createCanvas(Math.min(image.naturalWidth || image.width, 4), Math.min(image.naturalHeight || image.height, 4), { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  canvasToImageData(canvas, ctx); // throws ConversionError('tainted-canvas') when not allowed
  return { mimeHint: '' };
}

async function fetchBytes(url, gm, settings, signal, timeout) {
  if (!gm || !gm.capabilities.xhr) return null;
  try {
    const res = await withTimeout(gm.xhrBlob(url, { timeout, signal }), timeout + 2000, 'Image fetch');
    if (res.status && (res.status < 200 || res.status >= 300)) {
      throw new ConversionError('http-status', `The image server responded HTTP ${res.status}.`);
    }
    const bytes = await toUint8Array(res.response);
    if (!bytes || !bytes.length) throw new ConversionError('empty-response', 'The image server returned no data.');
    const mime = contentTypeFromHeaders(res.responseHeaders) || (res.response && res.response.type) || '';
    return { bytes, mime, finalUrl: res.finalUrl || url };
  } catch (err) {
    if (err && err.code === 'http-status') throw err;
    if (err && err.reason === 'aborted') throw err;
    if (err && err.code === 'empty-response') throw err;
    throw new ConversionError('fetch-failed', describeFetchFailure(err, url), err);
  }
}

function describeFetchFailure(err, url) {
  const reason = err && err.reason;
  if (reason === 'timeout') return `Fetching ${safeHost(url)} timed out — the server may be rate-limiting or offline.`;
  if (reason === 'network') return `Could not reach ${safeHost(url)} (network error, or the manager blocked this domain).`;
  if (reason === 'xhr-unavailable') return 'Your userscript manager did not grant GM_xmlhttpRequest.';
  return `Could not fetch ${safeHost(url)}: ${err && err.message ? err.message : 'unknown error'}`;
}

async function toUint8Array(response) {
  if (response instanceof Uint8Array) return response;
  if (typeof Blob !== 'undefined' && response instanceof Blob) return new Uint8Array(await response.arrayBuffer());
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  if (typeof response === 'string') {
    // Last resort: some managers hand back base64 or text when responseType is ignored.
    if (/^[A-Za-z0-9+/=\s]+$/.test(response) && response.length % 4 === 0) {
      try {
        const binary = atob(response.replace(/\s/g, ''));
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
        return out;
      } catch {
        /* not base64 */
      }
    }
    const out = new Uint8Array(response.length);
    for (let i = 0; i < response.length; i += 1) out[i] = response.charCodeAt(i) & 0xff;
    return out;
  }
  if (response && typeof response.arrayBuffer === 'function') return new Uint8Array(await response.arrayBuffer());
  return null;
}

function contentTypeFromHeaders(headers) {
  if (typeof headers !== 'string' || !headers) return '';
  const match = /^content-type:\s*([^\r\n;]+)/im.exec(headers);
  return match ? match[1].trim().toLowerCase() : '';
}

export function dataUrlMime(url) {
  const match = /^data:([^;,]+)/i.exec(url || '');
  return match ? match[1].toLowerCase() : '';
}

export function mimeFromUrl(url) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const match = /\.([a-z0-9]{2,5})$/i.exec(clean);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', apng: 'image/apng' };
  return map[ext] || '';
}

export function safeHost(url) {
  try {
    return new URL(url, window.location.href).hostname || 'the other origin';
  } catch {
    return 'the other origin';
  }
}

function isSameOriginBlob(url) {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function revokeObjectUrlNow(objectUrl) {
  try {
    URL.revokeObjectURL(objectUrl);
  } catch {
    /* noop */
  }
}

/** Human-readable one-liner about the target, for the menu header. */
export function describeTarget(target) {
  if (!target) return '';
  switch (target.kind) {
    case TARGET_KINDS.INLINE_SVG:
      return 'Inline SVG graphic';
    case TARGET_KINDS.CANVAS:
      return 'Canvas element';
    case TARGET_KINDS.BACKGROUND:
      return `CSS background${target.pseudo ? ` (${target.pseudo})` : ''}`;
    case TARGET_KINDS.SVG_IMAGE:
      return 'Image inside SVG';
    default:
      return target.hasSrcset ? 'Image (responsive srcset)' : 'Image';
  }
}

