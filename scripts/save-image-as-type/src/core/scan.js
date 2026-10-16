/**
 * Page image inventory.
 *
 * Discovers the images a page actually has — `<img>` (including lazy ones that
 * only carry `data-src`), CSS background images, inline `<svg>`, `<video
 * poster>`, and the alternative sizes a `srcset` offers — and describes each one
 * without changing the page.
 *
 * Two rules shape this module:
 *
 *   1. **No network traffic.** Scanning must never cause a request. Lazy images
 *      are reported as not-loaded, thumbnails are drawn from already-decoded
 *      pixels, and a preview that would need a fetch is an explicit user action.
 *   2. **Bounded work.** A page can have thousands of nodes; the walk stops at
 *      documented caps and says so, instead of freezing the tab.
 */

import { absolutize, isSameOrigin, mimeFromUrl, safeHost } from './source.js';

export const SCAN_LIMITS = Object.freeze({
  /** Nodes visited while looking for background images. */
  maxStyleScan: 2500,
  /** Inventory entries kept. */
  maxEntries: 1000,
  /** Same-origin iframes descended into. */
  maxFrames: 8,
  /** Elements inside one iframe. */
  maxFrameElements: 200,
  /** srcset candidates kept per image. */
  maxCandidates: 12,
});

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);
const TINY_AREA = 64 * 64;

/**
 * @param {Document|Element} root
 * @param {object} [options]
 * @param {boolean} [options.includeBackgrounds]
 * @param {boolean} [options.includeSvg]
 * @param {boolean} [options.includePosters]
 * @param {boolean} [options.includeFrames]
 * @param {number} [options.maxEntries]
 * @returns {{entries: object[], scanned: number, truncated: boolean, notes: string[], durationMs: number, frames: {scanned: number, blocked: number}}}
 */
export function scanImages(root, options = {}) {
  const started = Date.now();
  const opts = Object.assign(
    {
      includeBackgrounds: true,
      includeSvg: true,
      includePosters: true,
      includeFrames: true,
      maxEntries: SCAN_LIMITS.maxEntries,
      maxStyleScan: SCAN_LIMITS.maxStyleScan,
    },
    options,
  );

  opts.maxEntries = Math.max(1, Math.min(SCAN_LIMITS.maxEntries, Number(opts.maxEntries) || SCAN_LIMITS.maxEntries));
  opts.maxStyleScan = Math.max(1, Math.min(SCAN_LIMITS.maxStyleScan, Number(opts.maxStyleScan) || SCAN_LIMITS.maxStyleScan));
  const doc = root && root.ownerDocument ? root.ownerDocument : root;
  const entries = [];
  const notes = [];
  let scanned = 0;
  let truncated = false;
  let sequence = 0;
  const frames = { scanned: 0, blocked: 0 };

  if (!doc || typeof doc.querySelectorAll !== 'function') {
    return { entries, scanned: 0, truncated: false, notes: ['There is no document to scan.'], durationMs: 0, frames };
  }

  const push = (entry) => {
    if (entries.length >= opts.maxEntries) {
      truncated = true;
      return false;
    }
    sequence += 1;
    entry.id = `image-${sequence}`;
    entry.index = sequence - 1;
    entries.push(entry);
    return true;
  };

  // ── <img> elements (live collection: cheap and complete) ────────────────
  const images = doc.images || doc.querySelectorAll('img');
  for (let index = 0; index < images.length; index += 1) {
    scanned += 1;
    const element = images[index];
    if (!push(describeImg(element, doc, index))) {
      notes.push(`Stopped at ${opts.maxEntries} images; this page has more.`);
      break;
    }
  }

  // ── inline <svg> ───────────────────────────────────────────────────────
  if (opts.includeSvg) {
    const svgs = doc.querySelectorAll('svg');
    for (let index = 0; index < svgs.length; index += 1) {
      scanned += 1;
      const element = svgs[index];
      // An <svg> inside an <img> is already covered by the img entry.
      if (element.closest && element.closest('img,svg image')) continue;
      if (!push(describeSvg(element, doc))) break;
    }
  }

  // ── <video poster> ─────────────────────────────────────────────────────
  if (opts.includePosters) {
    const videos = doc.querySelectorAll('video[poster]');
    for (let index = 0; index < videos.length; index += 1) {
      scanned += 1;
      const element = videos[index];
      const url = absolutize(element.getAttribute('poster') || '', doc);
      if (!url) continue;
      if (!push(describeUrlEntry(element, url, doc, 'poster'))) break;
    }
  }

  // ── CSS background images (bounded walk) ───────────────────────────────
  if (opts.includeBackgrounds) {
    const walk = walkForBackgrounds(doc, opts, notes);
    scanned += walk.scanned;
    for (const found of walk.found) {
      if (!push(found)) break;
    }
    if (walk.truncated) truncated = true;
  } else {
    // The background walk is also what finds images inside open shadow roots, so
    // with backgrounds off they are collected here instead: turning one setting
    // off must not make web-component images disappear from the inventory.
    for (const entry of collectShadowImages(doc, opts)) {
      if (!push(entry)) break;
    }
  }

  // ── same-origin iframes ────────────────────────────────────────────────
  if (opts.includeFrames) {
    const frameElements = doc.querySelectorAll('iframe');
    for (let index = 0; index < Math.min(frameElements.length, SCAN_LIMITS.maxFrames); index += 1) {
      const frame = frameElements[index];
      let inner = null;
      try {
        inner = frame.contentDocument;
      } catch {
        inner = null;
      }
      if (!inner) {
        frames.blocked += 1;
        continue;
      }
      frames.scanned += 1;
      const innerImages = inner.images || [];
      for (let inner_index = 0; inner_index < Math.min(innerImages.length, SCAN_LIMITS.maxFrameElements); inner_index += 1) {
        scanned += 1;
        const entry = describeImg(innerImages[inner_index], inner, inner_index);
        entry.frame = describeFrame(frame, index);
        if (!push(entry)) break;
      }
    }
    if (frameElements.length > SCAN_LIMITS.maxFrames) {
      truncated = true;
      notes.push(`Frame scanning stopped after ${SCAN_LIMITS.maxFrames} frames.`);
    }
    if (frames.blocked) {
      notes.push(
        `${frames.blocked} cross-origin frame${frames.blocked === 1 ? '' : 's'} could not be inspected from this page. ` +
          'The script runs inside those frames too, so right-clicking an image there still works.',
      );
    }
  }

  if (truncated && !notes.some((note) => note.includes('Stopped at'))) {
    notes.push(`The scan was limited to ${opts.maxEntries} entries or ${opts.maxStyleScan} styled elements; some images may not be listed.`);
  }

  return { entries, scanned, truncated, notes, durationMs: Date.now() - started, frames };
}

function walkForBackgrounds(doc, opts, notes) {
  const found = [];
  let scanned = 0;
  let truncated = false;
  const roots = [doc.body || doc.documentElement];
  // Open shadow roots are scanned too, so a web-component gallery is not missed.
  const shadowQueue = [];

  for (const root of roots) {
    if (!root) continue;
    const walker = doc.createTreeWalker(root, 0x01 /* SHOW_ELEMENT */, null);
    let node = walker.currentNode;
    while (node) {
      if (scanned >= opts.maxStyleScan) {
        truncated = true;
        notes.push(`Background scanning stopped after ${opts.maxStyleScan} elements; a very large page may hide some background images.`);
        break;
      }
      scanned += 1;
      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (SKIP_TAGS.has(tag)) {
        node = skipSubtree(walker, node);
        continue;
      }
      if (node.shadowRoot) shadowQueue.push(node.shadowRoot);

      // Cheap pre-filter: only elements that mention a background inline, or
      // that are reasonably small in number, pay for getComputedStyle.
      const inline = node.getAttribute ? node.getAttribute('style') || '' : '';
      const candidate = /background/i.test(inline) || inline === '' ? true : false;
      if (candidate) {
        const url = backgroundUrlOf(node, doc, inline);
        if (url) {
          found.push(describeUrlEntry(node, url, doc, 'background'));
          if (found.length >= opts.maxEntries) {
            truncated = true;
            break;
          }
        }
      }
      node = walker.nextNode();
    }
  }

  for (const shadow of shadowQueue.slice(0, 20)) {
    const shadowImages = shadow.querySelectorAll ? shadow.querySelectorAll('img') : [];
    for (let index = 0; index < shadowImages.length; index += 1) {
      const entry = describeImg(shadowImages[index], doc, index);
      entry.inShadowRoot = true;
      found.push(entry);
    }
  }

  return { found, scanned, truncated };
}

/**
 * Images inside open shadow roots, which `document.images` does not include.
 *
 * Bounded like the background walk (element cap, at most 20 shadow roots) so a
 * component-heavy page cannot turn the inventory into a full DOM crawl.
 */
function collectShadowImages(doc, opts) {
  const found = [];
  const root = doc.body || doc.documentElement;
  if (!root || typeof doc.createTreeWalker !== 'function') return found;
  let walker = null;
  try {
    walker = doc.createTreeWalker(root, 0x01 /* SHOW_ELEMENT */, null);
  } catch {
    return found;
  }
  const hosts = [];
  let node = walker.currentNode;
  let scanned = 0;
  while (node) {
    if (scanned >= opts.maxStyleScan) break;
    scanned += 1;
    const tag = node.tagName ? node.tagName.toUpperCase() : '';
    if (SKIP_TAGS.has(tag)) {
      node = skipSubtree(walker, node);
      continue;
    }
    if (node.shadowRoot) hosts.push(node.shadowRoot);
    node = walker.nextNode();
  }
  for (const shadow of hosts.slice(0, 20)) {
    const images = shadow.querySelectorAll ? shadow.querySelectorAll('img') : [];
    for (let index = 0; index < images.length; index += 1) {
      const entry = describeImg(images[index], doc, index);
      entry.inShadowRoot = true;
      found.push(entry);
    }
  }
  return found;
}

function skipSubtree(walker, node) {
  // TreeWalker has no "skip children", so descend and climb back out.
  let next = walker.nextNode();
  while (next && node.contains && node.contains(next)) next = walker.nextNode();
  return next;
}

function backgroundUrlOf(element, doc, inlineStyle) {
  const inlineMatch = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(inlineStyle || '');
  if (inlineMatch && inlineMatch[1] && !/^(none|inherit|initial)$/i.test(inlineMatch[1])) {
    return absolutize(inlineMatch[1], doc);
  }
  if (typeof doc.defaultView !== 'object' || !doc.defaultView || typeof doc.defaultView.getComputedStyle !== 'function') return '';
  let value = '';
  try {
    const style = doc.defaultView.getComputedStyle(element);
    value = style.backgroundImage || style.getPropertyValue('background-image') || '';
  } catch {
    return '';
  }
  const match = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(value);
  if (!match || !match[1]) return '';
  if (/^(none|inherit|initial)$/i.test(match[1])) return '';
  return absolutize(match[1], doc);
}

function describeImg(element, doc, index) {
  const rawSrc = element.getAttribute('src') || '';
  const lazySrc =
    element.getAttribute('data-src') ||
    element.getAttribute('data-original') ||
    element.getAttribute('data-lazy-src') ||
    element.getAttribute('data-srcset') ||
    '';
  const currentSrc = element.currentSrc || rawSrc;
  const url = absolutize(currentSrc || rawSrc || (element.getAttribute('srcset') ? firstSrcsetUrl(element.getAttribute('srcset')) : ''), doc);
  const natural = { width: element.naturalWidth || 0, height: element.naturalHeight || 0 };
  const box = rectOf(element);
  const complete = Boolean(element.complete);
  const candidates = parseSrcset(element.getAttribute('srcset') || '', doc).concat(pictureCandidates(element, doc));

  let state = 'loaded';
  if (!url && !lazySrc) state = 'empty';
  else if (lazySrc && !rawSrc) state = 'lazy';
  else if (!complete) state = 'pending';
  else if (natural.width === 0 || natural.height === 0) state = 'broken';

  return {
    kind: 'img',
    element,
    url: url || absolutize(lazySrc, doc) || '',
    loadedUrl: url || '',
    lazyUrl: lazySrc ? absolutize(firstSrcsetUrl(lazySrc) || lazySrc, doc) : '',
    alt: (element.getAttribute('alt') || '').slice(0, 200),
    title: (element.getAttribute('title') || '').slice(0, 200),
    natural,
    displayed: { width: Math.round(box.width), height: Math.round(box.height) },
    mime: mimeFromUrl(url || lazySrc || ''),
    host: safeHost(url || lazySrc || ''),
    sameOrigin: url ? isSameOrigin(url) : false,
    protocol: protocolOf(url || lazySrc || ''),
    state,
    visible: box.width > 0 && box.height > 0,
    area: Math.round(box.width * box.height),
    tiny: (natural.width && natural.height && natural.width * natural.height < TINY_AREA) || (box.width > 0 && box.width * box.height < TINY_AREA),
    candidates: candidates.slice(0, SCAN_LIMITS.maxCandidates),
    largest: largestCandidate(candidates, natural),
    decoding: element.getAttribute('decoding') || '',
    loading: element.getAttribute('loading') || '',
    inShadowRoot: Boolean(element.getRootNode && element.getRootNode() !== doc),
    frame: 'this page',
  };
}

function describeSvg(element, doc) {
  const box = rectOf(element);
  const viewBox = (element.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const natural = {
    width: Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? Math.round(viewBox[2]) : Math.round(box.width),
    height: Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? Math.round(viewBox[3]) : Math.round(box.height),
  };
  return {
    kind: 'svg',
    element,
    url: '',
    loadedUrl: '',
    lazyUrl: '',
    alt: (element.getAttribute('aria-label') || element.getAttribute('title') || '').slice(0, 200),
    title: '',
    natural,
    displayed: { width: Math.round(box.width), height: Math.round(box.height) },
    mime: 'image/svg+xml',
    host: safeHost(doc.location ? doc.location.href : ''),
    sameOrigin: true,
    protocol: 'inline',
    state: box.width > 0 || box.height > 0 ? 'loaded' : 'pending',
    visible: box.width > 0 && box.height > 0,
    area: Math.round(box.width * box.height),
    tiny: natural.width * natural.height < TINY_AREA,
    candidates: [],
    largest: null,
    inline: true,
    frame: 'this page',
  };
}

function describeUrlEntry(element, url, doc, kind) {
  const box = rectOf(element);
  return {
    kind,
    element,
    url,
    loadedUrl: '',
    lazyUrl: '',
    alt: kind === 'poster' ? element.getAttribute('aria-label') || '' : '',
    title: '',
    natural: { width: 0, height: 0 },
    displayed: { width: Math.round(box.width), height: Math.round(box.height) },
    mime: mimeFromUrl(url),
    host: safeHost(url),
    sameOrigin: isSameOrigin(url),
    protocol: protocolOf(url),
    state: 'not-loaded',
    visible: box.width > 0 && box.height > 0,
    area: Math.round(box.width * box.height),
    tiny: false,
    candidates: [],
    largest: null,
    needsFetch: true,
    frame: 'this page',
  };
}

function pictureCandidates(imgElement, doc) {
  const picture = imgElement.parentNode;
  if (!picture || picture.tagName !== 'PICTURE') return [];
  const sources = picture.querySelectorAll('source');
  const out = [];
  for (let index = 0; index < sources.length; index += 1) {
    const value = sources[index].getAttribute('srcset') || '';
    for (const candidate of parseSrcset(value, doc)) out.push(candidate);
  }
  return out;
}

/**
 * Parse a `srcset` attribute into candidates.
 *
 * Deliberately tolerant: real-world srcsets contain stray commas, missing
 * descriptors and relative URLs. Nothing is evaluated — only split, trimmed and
 * absolutised.
 */
export function parseSrcset(value, doc) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return [];
  const out = [];
  for (const part of text.split(',')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const url = absolutize(tokens[0], doc);
    if (!url) continue;
    let width = 0;
    let density = 0;
    for (const token of tokens.slice(1)) {
      const w = /^(\d+(?:\.\d+)?)w$/.exec(token);
      const d = /^(\d+(?:\.\d+)?)x$/.exec(token);
      if (w) width = Number(w[1]);
      if (d) density = Number(d[1]);
    }
    out.push({ url, width, density });
  }
  return out;
}

function firstSrcsetUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.split(',')[0].trim().split(/\s+/)[0] || '';
}

function largestCandidate(candidates, natural) {
  if (!candidates.length) return null;
  let best = null;
  for (const candidate of candidates) {
    if (!candidate.width) continue;
    if (!best || candidate.width > best.width) best = candidate;
  }
  if (!best) return null;
  if (natural && natural.width && best.width <= natural.width) return null;
  return { url: best.url, width: best.width };
}

/** Remove duplicate URLs, keeping the first (usually the displayed) entry. */
export function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries || []) {
    const key = entry.url || `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Filter an inventory. All bounds are inclusive and "0 or empty" means "off".
 */
export function filterEntries(entries, filter = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const query = String(filter.query || '').trim().toLowerCase();
  const minWidth = Number(filter.minWidth) || 0;
  const minHeight = Number(filter.minHeight) || 0;
  const kinds = Array.isArray(filter.kinds) && filter.kinds.length ? filter.kinds : null;
  return list.filter((entry) => {
    if (kinds && !kinds.includes(entry.kind)) return false;
    if (filter.sameOriginOnly && !entry.sameOrigin) return false;
    if (filter.loadedOnly && entry.state !== 'loaded') return false;
    if (filter.excludeTiny && entry.tiny) return false;
    if (minWidth && (entry.natural.width || entry.displayed.width || 0) < minWidth) return false;
    if (minHeight && (entry.natural.height || entry.displayed.height || 0) < minHeight) return false;
    if (query) {
      const haystack = `${entry.url} ${entry.alt} ${entry.title} ${entry.host}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function sortEntries(entries, key = 'area-desc') {
  const list = (Array.isArray(entries) ? entries : []).slice();
  const size = (entry) => (entry.natural.width || entry.displayed.width || 0) * (entry.natural.height || entry.displayed.height || 0) || entry.area || 0;
  const comparators = {
    'area-desc': (a, b) => size(b) - size(a),
    'area-asc': (a, b) => size(a) - size(b),
    name: (a, b) => String(a.url || a.alt || a.id).localeCompare(String(b.url || b.alt || b.id)),
    type: (a, b) => String(a.mime || a.kind).localeCompare(String(b.mime || b.kind)) || size(b) - size(a),
    state: (a, b) => String(a.state).localeCompare(String(b.state)),
    order: () => 0,
  };
  list.sort(comparators[key] || comparators['area-desc']);
  return list;
}

/** Aggregate numbers for the picker header and the batch confirmation dialog. */
export function summarizeInventory(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const summary = {
    total: list.length,
    loaded: 0,
    notLoaded: 0,
    broken: 0,
    tiny: 0,
    crossOrigin: 0,
    uniqueUrls: 0,
    svg: 0,
    background: 0,
    poster: 0,
    withLargerVariant: 0,
    pixels: 0,
  };
  const urls = new Set();
  for (const entry of list) {
    if (entry.state === 'loaded') summary.loaded += 1;
    else if (entry.state === 'broken') summary.broken += 1;
    else summary.notLoaded += 1;
    if (entry.tiny) summary.tiny += 1;
    if (!entry.sameOrigin && entry.kind !== 'svg') summary.crossOrigin += 1;
    if (entry.kind === 'svg') summary.svg += 1;
    if (entry.kind === 'background') summary.background += 1;
    if (entry.kind === 'poster') summary.poster += 1;
    if (entry.largest) summary.withLargerVariant += 1;
    if (entry.url) urls.add(entry.url);
    summary.pixels += (entry.natural.width || 0) * (entry.natural.height || 0);
  }
  summary.uniqueUrls = urls.size;
  summary.megapixels = Number((summary.pixels / 1000000).toFixed(1));
  return summary;
}

/**
 * Thumbnail for one entry, drawn from pixels the page already decoded.
 *
 * Returns `null` with a reason rather than issuing a request: a cross-origin
 * image without CORS headers cannot be read (the canvas would be tainted), and
 * a background image was never decoded as an element.
 *
 * @returns {Promise<{dataUrl: string}|{dataUrl: null, reason: string}>}
 */
export async function createThumbnail(entry, { size = 96, createCanvas, svgToObjectUrl, loadImage, timeout = 8000 } = {}) {
  if (!entry) return { dataUrl: null, reason: 'No image.' };
  const box = Math.max(16, Math.min(256, Math.round(size) || 96));

  if (entry.kind === 'svg' && entry.element && typeof svgToObjectUrl === 'function' && typeof loadImage === 'function') {
    let objectUrl = null;
    try {
      objectUrl = svgToObjectUrl(entry.element);
      const image = await loadImage(objectUrl, { timeout });
      const drawn = drawThumb(image, box, createCanvas);
      return drawn;
    } catch (err) {
      return { dataUrl: null, reason: err && err.message ? err.message : 'The SVG could not be rendered.' };
    } finally {
      if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch { /* noop */ } }
    }
  }

  if (entry.kind === 'img' && entry.element && entry.state === 'loaded') {
    return drawThumb(entry.element, box, createCanvas);
  }

  // A painted background has no decoded element to draw from, so it gets its own
  // explanation before the generic "not loaded" one (its state is never
  // 'loaded', which made the specific reason unreachable).
  if (entry.kind === 'background') {
    return { dataUrl: null, reason: 'Background images are painted by the page; a preview would need one download.' };
  }
  if (entry.state !== 'loaded') {
    return { dataUrl: null, reason: 'This image has not been loaded by the page, so no preview exists without downloading it.' };
  }
  return { dataUrl: null, reason: 'No preview available.' };
}

function drawThumb(source, box, createCanvas) {
  if (typeof createCanvas !== 'function') return { dataUrl: null, reason: 'Canvas is not available in this browser.' };
  const width = source.naturalWidth || source.width || box;
  const height = source.naturalHeight || source.height || box;
  if (!(width > 0) || !(height > 0)) return { dataUrl: null, reason: 'The image has no pixel dimensions yet.' };
  const scale = Math.min(box / width, box / height, 1);
  const target = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  try {
    target.ctx.drawImage(source, 0, 0, target.canvas.width, target.canvas.height);
    return { dataUrl: target.canvas.toDataURL('image/png') };
  } catch (err) {
    // Tainted canvas (cross-origin without CORS) — reading pixels is blocked.
    return {
      dataUrl: null,
      reason: err && err.name === 'SecurityError' ? 'Cross-origin image: the browser blocks reading its pixels for a preview.' : 'The preview could not be drawn.',
    };
  }
}

/**
 * Watch the inventory for changes while a dialog is open.
 *
 * Scoped to the document body with attribute filtering, debounced, and capped:
 * an infinite-scroll page mutates constantly, and re-scanning on every mutation
 * would burn CPU for nothing.
 */
export function observeInventory(root, onChange, { debounceMs = 400, maxNotifications = 50 } = {}) {
  const doc = root && root.ownerDocument ? root.ownerDocument : root;
  if (!doc || typeof doc.defaultView === 'undefined' || !doc.defaultView || typeof doc.defaultView.MutationObserver !== 'function') {
    return { disconnect() {}, supported: false };
  }
  let timer = null;
  let notifications = 0;
  let stopped = false;
  const observer = new doc.defaultView.MutationObserver((mutations) => {
    if (stopped || notifications >= maxNotifications) return;
    // Ignore mutations that cannot introduce an image.
    let relevant = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes && mutation.addedNodes.length) {
        relevant = true;
        break;
      }
      if (mutation.type === 'attributes') {
        relevant = true;
        break;
      }
    }
    if (!relevant) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      notifications += 1;
      onChange({ notifications });
    }, Math.max(50, debounceMs));
  });

  try {
    observer.observe(doc.body || doc.documentElement || doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'data-src', 'style', 'poster'],
    });
  } catch {
    return { disconnect() {}, supported: false };
  }

  return {
    supported: true,
    disconnect() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        observer.disconnect();
      } catch {
        /* noop */
      }
    },
    get notifications() {
      return notifications;
    },
  };
}

/** Plain-language state for the UI (never interpolated as HTML). */
export function describeEntryState(entry) {
  if (!entry) return 'unknown';
  const labels = {
    loaded: 'loaded',
    pending: 'still loading',
    lazy: 'not loaded yet (lazy)',
    broken: 'failed to load',
    empty: 'no source',
    'not-loaded': 'not loaded (page-painted)',
  };
  return labels[entry.state] || entry.state;
}

function rectOf(element) {
  try {
    if (typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) return { width: rect.width, height: rect.height };
    }
  } catch {
    /* fall through */
  }
  return { width: Number(element.width) || 0, height: Number(element.height) || 0 };
}

function protocolOf(url) {
  const text = String(url || '');
  if (text.startsWith('data:')) return 'data';
  if (text.startsWith('blob:')) return 'blob';
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  return match ? match[1].toLowerCase() : '';
}

function describeFrame(frame, index) {
  const id = frame.getAttribute('id') || frame.getAttribute('name') || `#${index + 1}`;
  return `frame ${String(id).slice(0, 40)}`;
}
