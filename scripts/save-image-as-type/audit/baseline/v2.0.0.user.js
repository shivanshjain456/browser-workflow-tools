// ==UserScript==
// @name        Save Image as Type
// @namespace   https://siat.invalid/save-image-as-type
// @version     2.0.0
// @description Convert images locally: PNG, JPG, WebP, GIF, BMP or PDF. Batch, ZIP, transforms, clipboard, metadata and keyboard workflows. No servers or tracking.
// @author      Save Image as Type userscript contributors
// @license     MIT
// @icon        data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%232563eb'/%3E%3Cpath d='M32 14v24m0 0-9-9m9 9 9-9' stroke='white' stroke-width='5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M16 46h32' stroke='white' stroke-width='5' stroke-linecap='round'/%3E%3C/svg%3E
// @match       *://*/*
// @run-at      document-start
// @grant       GM_info
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_addValueChangeListener
// @grant       GM_removeValueChangeListener
// @grant       GM_deleteValue
// @grant       GM_xmlhttpRequest
// @grant       GM_download
// @grant       GM_registerMenuCommand
// @grant       GM_notification
// @connect     *
// ==/UserScript==

/*
 * Save Image as Type — userscript
 * version 2.0.0
 *
 * Everything below runs locally in your browser. The script makes no network
 * requests except the image you explicitly asked it to convert (fetched
 * through your userscript manager only when the page's own CORS policy would
 * otherwise block reading its pixels), and it saves files through your
 * manager's download API. No analytics, no telemetry, no third parties.
 *
 * Built from modular sources by build.mjs — do not edit release/ by hand.
 * modules: 35
 */
(function () {
'use strict';

/* ── src/core/gm.js ───────────────────────── */
/**
 * Userscript-manager adapter.
 *
 * Tampermonkey and Violentmonkey both expose the classic `GM_*` functions and
 * the Greasemonkey-4 style `GM.*` namespace, but they differ in details that
 * matter here:
 *
 *   - `GM.getValue`/`GM.setValue`/`GM.download`/`GM.xmlHttpRequest` are async
 *     in Violentmonkey (VM2.18.3+) and Greasemonkey 4, while `GM_*` is sync in
 *     Tampermonkey. This adapter normalises everything to promises.
 *   - `GM_info.downloadMode` is "native" | "browser" | "disabled" in
 *     Tampermonkey and "native" | "browser" in Violentmonkey (VM2.45.2+).
 *     "native" means the manager implements GM_download with a plain
 *     <a download> click, which cannot honour `saveAs` or a sub-folder.
 *   - Tampermonkey refuses `GM_download` names whose extension is not on its
 *     whitelist (error reasons `not_whitelisted`, `not_enabled`,
 *     `not_permitted`, `not_supported`). Every one of those is recoverable by
 *     falling back to our own anchor download, so `saveBlob()` does that and
 *     reports which path actually ran.
 *
 * Nothing in this module assumes an API exists: every capability is probed.
 */

const GM_NS = (() => {
  try {
    // eslint-disable-next-line no-undef
    return typeof GM !== 'undefined' && GM ? GM : null;
  } catch {
    return null;
  }
})();

/** Static lookups — `typeof X` cannot be built from a dynamic name without eval. */
const GLOBALS = {
  info: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_info !== 'undefined' ? GM_info : undefined;
    } catch {
      return undefined;
    }
  },
  getValue: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_getValue !== 'undefined' ? GM_getValue : undefined;
    } catch {
      return undefined;
    }
  },
  setValue: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_setValue !== 'undefined' ? GM_setValue : undefined;
    } catch {
      return undefined;
    }
  },
  deleteValue: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_deleteValue !== 'undefined' ? GM_deleteValue : undefined;
    } catch {
      return undefined;
    }
  },
  addValueChangeListener: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_addValueChangeListener !== 'undefined' ? GM_addValueChangeListener : undefined;
    } catch {
      return undefined;
    }
  },
  removeValueChangeListener: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_removeValueChangeListener !== 'undefined' ? GM_removeValueChangeListener : undefined;
    } catch {
      return undefined;
    }
  },
  xmlHttpRequest: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : undefined;
    } catch {
      return undefined;
    }
  },
  download: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_download !== 'undefined' ? GM_download : undefined;
    } catch {
      return undefined;
    }
  },
  registerMenuCommand: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_registerMenuCommand !== 'undefined' ? GM_registerMenuCommand : undefined;
    } catch {
      return undefined;
    }
  },
  notification: () => {
    try {
      // eslint-disable-next-line no-undef
      return typeof GM_notification !== 'undefined' ? GM_notification : undefined;
    } catch {
      return undefined;
    }
  },
};

function asPromise(value) {
  if (value && typeof value.then === 'function') return value;
  return Promise.resolve(value);
}

/**
 * @param {Record<string, Function|object|undefined>} [override]
 *   Test/dependency-injection seam: pass an object shaped like the GM_*
 *   globals to exercise the adapter without a real manager.
 */
function createGmAdapter(override) {
  /**
   * Both spellings of every API, because the managers disagree:
   * the classic global is `GM_xmlhttpRequest` (lower-case "http") while the
   * GM.* namespace uses `GM.xmlHttpRequest` (capital H), and GM4-era scripts
   * sometimes see `GM.xmlhttpRequest`. Probing only one spelling silently
   * loses the capability, so all accepted spellings are tried in order.
   */
  const SPELLINGS = {
    info: { classic: ['GM_info'], ns: ['info'] },
    getValue: { classic: ['GM_getValue'], ns: ['getValue'] },
    setValue: { classic: ['GM_setValue'], ns: ['setValue'] },
    deleteValue: { classic: ['GM_deleteValue', 'GM_delete_value'], ns: ['deleteValue'] },
    addValueChangeListener: { classic: ['GM_addValueChangeListener'], ns: ['addValueChangeListener'] },
    removeValueChangeListener: { classic: ['GM_removeValueChangeListener'], ns: ['removeValueChangeListener'] },
    xmlHttpRequest: { classic: ['GM_xmlhttpRequest', 'GM_xmlHttpRequest'], ns: ['xmlHttpRequest', 'xmlhttpRequest'] },
    download: { classic: ['GM_download'], ns: ['download'] },
    registerMenuCommand: { classic: ['GM_registerMenuCommand'], ns: ['registerMenuCommand'] },
    notification: { classic: ['GM_notification'], ns: ['notification'] },
  };

  const pick = (name) => {
    const spellings = SPELLINGS[name] || { classic: [`GM_${name}`], ns: [name] };
    // 1. an explicit override (tests, shims, embedding pages) — classic spellings first
    for (const key of spellings.classic) {
      if (override && typeof override[key] !== 'undefined') return override[key];
    }
    // 2. the override's GM.* namespace
    for (const key of spellings.ns) {
      if (override && override.GM && typeof override.GM[key] !== 'undefined') return override.GM[key];
    }
    // 3. the real granted classic global
    const classic = GLOBALS[name] ? GLOBALS[name]() : undefined;
    if (typeof classic === 'function') return classic;
    if (name === 'info' && classic) return classic;
    // 4. the real GM.* namespace object
    for (const key of spellings.ns) {
      if (GM_NS && typeof GM_NS[key] === 'function') return GM_NS[key].bind(GM_NS);
    }
    if (name === 'info' && GM_NS && GM_NS.info) return GM_NS.info;
    return undefined;
  };

  const info = pick('info') || null;
  const getValue = pick('getValue');
  const setValue = pick('setValue');
  const deleteValue = pick('deleteValue');
  const addListener = pick('addValueChangeListener');
  const removeListener = pick('removeValueChangeListener');
  const xhr = pick('xmlHttpRequest');
  const download = pick('download');
  const menuCommand = pick('registerMenuCommand');
  const notification = pick('notification');

  return {
    /** Which manager we are running under, for the diagnostics panel. */
    handler: String((info && (info.scriptHandler || (info.script && info.script.handler))) || 'unknown'),
    managerVersion: String((info && info.version) || ''),
    /** "native" | "browser" | "disabled" | "unknown" */
    downloadMode: String((info && info.downloadMode) || 'unknown'),
    scriptVersion: String((info && info.script && info.script.version) || ''),
    injectInto: String((info && (info.injectInto || (info.script && info.script.injectInto))) || ''),
    sandboxed: Boolean(info && info.script && info.script['run-at'] !== undefined) || Boolean(info),
    capabilities: {
      storage: typeof getValue === 'function' && typeof setValue === 'function',
      xhr: typeof xhr === 'function',
      download: typeof download === 'function',
      menuCommand: typeof menuCommand === 'function',
      notification: typeof notification === 'function',
      valueChangeSync: typeof addListener === 'function',
    },

    async getValue(key, fallback) {
      if (typeof getValue !== 'function') return fallback;
      try {
        const value = await asPromise(getValue(key, fallback));
        return value === undefined ? fallback : value;
      } catch {
        return fallback;
      }
    },

    async setValue(key, value) {
      if (typeof setValue !== 'function') return false;
      try {
        await asPromise(setValue(key, value));
        return true;
      } catch {
        return false;
      }
    },

    async deleteValue(key) {
      if (typeof deleteValue !== 'function') return false;
      try {
        await asPromise(deleteValue(key));
        return true;
      } catch {
        return false;
      }
    },

    onValueChanged(key, handler) {
      if (typeof addListener !== 'function') return null;
      try {
        const id = addListener(key, handler);
        return {
          dispose() {
            if (typeof removeListener === 'function') removeListener(id);
          },
        };
      } catch {
        return null;
      }
    },

    /**
     * Cross-origin-capable fetch. Resolves with {status, response, responseHeaders, finalUrl}.
     * The returned object also carries `abort()` so callers can cancel stale work.
     */
    xhrBlob(url, { timeout = 30000, headers = {}, signal } = {}) {
      return new Promise((resolvePromise, rejectPromise) => {
        if (typeof xhr !== 'function') {
          rejectPromise(new GmError('xhr-unavailable', 'Your userscript manager did not grant GM_xmlhttpRequest.'));
          return;
        }
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          try {
            if (signal) signal.removeEventListener('abort', onAbort);
          } catch {
            /* noop */
          }
          fn(arg);
        };
        let control = null;
        const onAbort = () => {
          try {
            if (control && typeof control.abort === 'function') control.abort();
          } catch {
            /* noop */
          }
          finish(rejectPromise, new GmError('aborted', 'Request cancelled.'));
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
          control = xhr({
            method: 'GET',
            url,
            // 'blob' keeps memory bounded and avoids base64 round-trips; TM and
            // VM both support it, and we fall back to arraybuffer below if the
            // manager hands us nothing usable.
            responseType: 'blob',
            timeout,
            headers: Object.assign({ Accept: 'image/*,*/*' }, headers),
            onload: (res) => {
              const response = res && (res.response !== undefined ? res.response : res.responseText);
              if (!response) {
                finish(rejectPromise, new GmError('empty-response', 'The manager returned an empty response.'));
                return;
              }
              finish(resolvePromise, {
                status: res.status,
                response,
                responseHeaders: res.responseHeaders || '',
                finalUrl: res.finalUrl || url,
              });
            },
            onerror: (res) =>
              finish(rejectPromise, new GmError('network', `Network error${res && res.status ? ` (HTTP ${res.status})` : ''}.`, res)),
            ontimeout: () => finish(rejectPromise, new GmError('timeout', `Timed out after ${Math.round(timeout / 1000)}s.`)),
          });
        } catch (err) {
          finish(rejectPromise, new GmError('threw', err && err.message ? err.message : String(err)));
        }
      });
    },

    /**
     * Manager download. Resolves with {via:'gm', saveAs, subfolderApplied}.
     * Rejects with a GmError whose `reason` is the manager's own error string
     * (not_enabled / not_whitelisted / not_permitted / not_supported / …) so the
     * caller can decide whether a fallback is worthwhile and tell the user why.
     */
    downloadBlobUrl(objectUrl, name, { saveAs = false, timeout = 60000 } = {}) {
      return new Promise((resolvePromise, rejectPromise) => {
        if (typeof download !== 'function') {
          rejectPromise(new GmError('unsupported', 'GM_download is not available in this manager.'));
          return;
        }
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          fn(arg);
        };
        try {
          const details = { url: objectUrl, name, saveAs: Boolean(saveAs), timeout };
          details.onload = () => finish(resolvePromise, { via: 'gm', name });
          details.onerror = (err) => {
            const reason = (err && (err.error || err.reason)) || 'unknown';
            finish(rejectPromise, new GmError(String(reason), describeDownloadError(reason), err));
          };
          details.ontimeout = () => finish(rejectPromise, new GmError('timeout', 'The download timed out.'));
          download(details);
        } catch (err) {
          finish(rejectPromise, new GmError('threw', err && err.message ? err.message : String(err)));
        }
      });
    },

    registerMenuCommand(label, handler, accessKey) {
      if (typeof menuCommand !== 'function') return null;
      try {
        return menuCommand(label, handler, accessKey);
      } catch {
        return null;
      }
    },

    notify(text, title, { timeout = 6000, silent = false } = {}) {
      if (typeof notification !== 'function' || silent) return false;
      try {
        notification({ text: String(text).slice(0, 400), title: String(title || 'Save Image as Type'), timeout });
        return true;
      } catch {
        try {
          notification(String(text).slice(0, 400), String(title || 'Save Image as Type'));
          return true;
        } catch {
          return false;
        }
      }
    },
  };
}

class GmError extends Error {
  constructor(reason, message, detail) {
    super(message);
    this.name = 'GmError';
    this.reason = reason;
    this.detail = detail || null;
  }
}

function describeDownloadError(reason) {
  switch (reason) {
    case 'not_enabled':
      return 'Downloads are disabled in your userscript manager settings.';
    case 'not_whitelisted':
      return 'Your userscript manager blocked this file extension (Tampermonkey: Settings → Download → file extension whitelist).';
    case 'not_permitted':
      return 'Your userscript manager is missing the browser "downloads" permission.';
    case 'not_supported':
      return 'This browser/manager combination does not support GM_download.';
    case 'not_succeeded':
      return 'The manager reported the download did not start.';
    default:
      return `The manager download failed (${reason}).`;
  }
}

/** Lazily created singleton used by the shipped script. */
let gmSingleton = null;
function getGm() {
  if (!gmSingleton) gmSingleton = createGmAdapter();
  return gmSingleton;
}

/** Test seam: reset the singleton (used when a fake manager is installed). */
function resetGmForTest(adapter) {
  gmSingleton = adapter || null;
}

/* ── src/core/formats.js ───────────────────────── */
/**
 * Format registry.
 *
 * `engine` decides how the output bytes are produced:
 *   - "native"      : canvas.toBlob(), verified by checking the returned
 *                     blob.type. Verified on Chrome 131 that PNG/JPEG/WebP
 *                     encode natively while AVIF/GIF/BMP silently fall back to
 *                     PNG — which is exactly why this check exists and why the
 *                     remaining engines are hand-written encoders.
 *   - "bmp"         : src/encoders/bmp.js  (BITMAPV5 / 24-bit V3 writer)
 *   - "gif"         : src/encoders/gif.js  (GIF89a + median-cut + LZW)
 *   - "pdf"         : src/encoders/pdf.js  (single-page PDF, DCTDecode JPEG)
 *   - "passthrough" : the original file bytes, unchanged (keeps animation and
 *                     the source's own quality; only possible when we actually
 *                     hold the bytes).
 */

const FORMATS = [
  {
    id: 'png',
    label: 'PNG',
    ext: 'png',
    mime: 'image/png',
    engine: 'native',
    quality: false,
    transparency: true,
    hint: 'Lossless · keeps transparency',
    enabledByDefault: true,
  },
  {
    id: 'jpg',
    label: 'JPG',
    ext: 'jpg',
    mime: 'image/jpeg',
    engine: 'native',
    quality: true,
    transparency: false,
    hint: 'Small photos · transparency is flattened',
    enabledByDefault: true,
  },
  {
    id: 'webp',
    label: 'WebP',
    ext: 'webp',
    mime: 'image/webp',
    engine: 'native',
    quality: true,
    transparency: true,
    hint: 'Modern · small files, keeps transparency',
    enabledByDefault: true,
  },
  {
    id: 'gif',
    label: 'GIF',
    ext: 'gif',
    mime: 'image/gif',
    engine: 'gif',
    quality: false,
    transparency: 'indexed',
    hint: '256 colours · animation when the browser can read the frames',
    enabledByDefault: true,
  },
  {
    id: 'bmp',
    label: 'BMP',
    ext: 'bmp',
    mime: 'image/bmp',
    engine: 'bmp',
    quality: false,
    transparency: true,
    hint: 'Uncompressed · 32-bit with alpha when needed',
    enabledByDefault: true,
  },
  {
    id: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    mime: 'application/pdf',
    engine: 'pdf',
    quality: true,
    transparency: false,
    hint: 'One page, JPEG-compressed, ready to print or attach',
    enabledByDefault: true,
  },
  {
    id: 'avif',
    label: 'AVIF',
    ext: 'avif',
    mime: 'image/avif',
    engine: 'native',
    quality: true,
    transparency: true,
    hint: 'Only offered where your browser can really encode AVIF',
    enabledByDefault: false,
    /** Hidden entirely unless the runtime probe proves the encoder exists. */
    requiresEncodeProbe: 'image/avif',
  },
  {
    id: 'original',
    label: 'Original file',
    ext: '',
    mime: '',
    engine: 'passthrough',
    quality: false,
    transparency: true,
    hint: 'Re-save the source file untouched (animation and quality preserved)',
    enabledByDefault: true,
    alwaysLast: true,
  },
];

const FORMAT_IDS = FORMATS.map((f) => f.id);

function getFormat(id) {
  return FORMATS.find((f) => f.id === id) || null;
}

function defaultEnabledFormats() {
  return FORMATS.filter((f) => f.enabledByDefault).map((f) => f.id);
}

/** Extension to use for a given format + source (only `original` depends on the source). */
function extensionForFormat(format, sourceMime, sourceUrl) {
  if (format.id !== 'original') return format.ext;
  const fromMime = MIME_TO_EXT[sourceMime] || '';
  if (fromMime) return fromMime;
  const fromUrl = extFromUrl(sourceUrl);
  return fromUrl || 'img';
}

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/apng': 'apng',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

function extFromUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  let clean = url;
  try {
    // `https://siat.invalid/` is an RFC 2606 reserved host used only as a base
    // so `new URL()` can resolve a relative path; it is never requested.
    clean = new URL(url, 'https://siat.invalid/').pathname;
  } catch {
    /* keep the raw string */
  }
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(clean);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  return MIME_TO_EXT[`image/${ext}`] || ext;
}

function mimeFromExt(ext) {
  const lower = String(ext || '').toLowerCase();
  for (const [mime, value] of Object.entries(MIME_TO_EXT)) {
    if (value === lower) return mime;
  }
  return '';
}

/* ── src/core/filename.js ───────────────────────── */
/**
 * Filename construction.
 *
 * Everything here is pure and synchronous, because it is the part of the script
 * that touches user-visible output on every single save and must never produce
 * an illegal, empty, colliding or path-escaping name.
 *
 * Threat model: the base name comes from an attacker-controllable page (URL
 * path, `alt` attribute, `<title>`), and the prefix/sub-folder come from the
 * user's own settings which may themselves have been imported from a JSON file.
 * So every string is treated as hostile input: control characters, path
 * separators, Windows-reserved device names, trailing dots/spaces and
 * over-long values are all neutralised.
 */

const ILLEGAL_CHARS = /[\u0000-\u001f\u007f\\/:*?"<>|\u200e\u200f\u202a-\u202e\ufeff]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ABSOLUTE_MAX_BYTES = 200; // keep room for the extension + manager suffixes

/** Strip everything that is not safe in a single path component. */
function sanitizePathComponent(input, { maxChars = 100 } = {}) {
  if (typeof input !== 'string') return '';
  let text = input;
  try {
    text = text.normalize('NFC');
  } catch {
    /* very old engines: keep as-is */
  }
  text = text
    // Decode each *run* of escapes as a unit so multi-byte UTF-8 sequences
    // survive: "%C3%A9" is one character (é) and decoding it escape-by-escape
    // would throw and delete it. A malformed run falls back to per-escape
    // decoding, keeping the bytes that are valid on their own. Decoding happens
    // exactly once, so a double-encoded "%252F" can never become a separator.
    .replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        let kept = '';
        for (const single of run.matchAll(/%[0-9a-f]{2}/gi)) {
          try {
            kept += decodeURIComponent(single[0]);
          } catch {
            /* undecodable byte: drop it rather than emit mojibake */
          }
        }
        return kept;
      }
    })
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  if (WINDOWS_RESERVED.test(text)) text = `_${text}`;
  // Never allow a component to become empty-looking or to re-introduce a path.
  text = text.replace(/[.]+$/, '');
  if (text.length > maxChars) text = text.slice(0, maxChars).replace(/[.\s]+$/, '');
  return text;
}

/**
 * Build a download path from a user-supplied sub-folder setting.
 * Returns "" when the setting is empty or unsafe. At most 3 segments, each
 * ≤ 40 chars, ".." and absolute paths rejected.
 */
function sanitizeSubfolder(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.replace(/\\/g, '/').trim();
  if (!trimmed) return '';
  const segments = trimmed
    .split('/')
    .map((part) => sanitizePathComponent(part, { maxChars: 40 }))
    .filter((part) => part && part !== '.' && part !== '..');
  if (!segments.length) return '';
  return segments.slice(0, 3).join('/');
}

/** Best-effort human name for an image, from the most to the least specific clue. */
function baseNameFromSource({ sourceUrl, altText, documentTitle, hostName } = {}) {
  const candidates = [];

  if (typeof sourceUrl === 'string' && sourceUrl) {
    // data:, blob: and filesystem: URLs carry no human-readable basename — a
    // blob UUID or the literal "image" is worse than the page's own alt text or
    // title, so they contribute no candidate and the later clues (and the final
    // "image" fallback) win.
    if (/^(?:data|blob|filesystem|about|javascript):/i.test(sourceUrl)) {
      /* no usable name in the URL itself */
    } else {
      let path = sourceUrl;
      try {
        // Reserved non-resolvable base: parse-only, never fetched.
        path = new URL(sourceUrl, 'https://siat.invalid/').pathname;
      } catch {
        /* keep raw */
      }
      const last = path.split('/').filter(Boolean).pop() || '';
      let decoded = last;
      try {
        decoded = decodeURIComponent(last);
      } catch {
        /* malformed escapes: keep the encoded form */
      }
      const withoutExt = decoded.replace(/\.[A-Za-z0-9]{1,5}$/, '');
      if (withoutExt) candidates.push(withoutExt);
    }
  }
  if (typeof altText === 'string' && altText.trim()) candidates.push(altText.trim());
  if (typeof documentTitle === 'string' && documentTitle.trim()) {
    candidates.push(documentTitle.trim().split(/\s*[|–—-]\s*/)[0]);
  }
  if (typeof hostName === 'string' && hostName.trim()) candidates.push(hostName.trim());

  for (const candidate of candidates) {
    const clean = sanitizePathComponent(candidate, { maxChars: 100 });
    if (clean && clean.length >= 1) return clean;
  }
  return 'image';
}

/**
 * @param {object} opts
 * @param {string} opts.base          name without extension (already sanitised or not)
 * @param {string} opts.ext           extension without dot
 * @param {string} [opts.prefix]      user prefix, joined with "-"
 * @param {string} [opts.subfolder]   user sub-folder (only honoured by managers in browser download mode)
 * @param {number} [opts.maxLength]   maximum length of the file name itself (extension included)
 * @param {boolean} [opts.includeSubfolder]
 * @returns {{filename: string, path: string, truncated: boolean, subfolderApplied: boolean}}
 */
function buildFilename({
  base,
  ext,
  prefix = '',
  subfolder = '',
  maxLength = 64,
  includeSubfolder = false,
}) {
  const safeExt = String(ext || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toLowerCase();
  const cleanBase = sanitizePathComponent(base, { maxChars: 150 }) || 'image';
  const cleanPrefix = sanitizePathComponent(prefix, { maxChars: 40 });

  const limit = clampInt(maxLength, 4, ABSOLUTE_MAX_BYTES);
  const suffix = safeExt ? `.${safeExt}` : '';

  let stem = cleanPrefix ? `${cleanPrefix}-${cleanBase}` : cleanBase;
  let truncated = false;
  const budget = Math.max(1, limit - suffix.length);
  if (byteLength(stem) > budget) {
    stem = truncateToBytes(stem, budget);
    truncated = true;
  }
  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`;

  const filename = `${stem}${suffix}`;
  const folder = sanitizeSubfolder(subfolder);
  const subfolderApplied = Boolean(folder && includeSubfolder);
  return {
    filename,
    path: subfolderApplied ? `${folder}/${filename}` : filename,
    truncated,
    subfolderApplied,
    droppedSubfolder: Boolean(folder && !includeSubfolder),
  };
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function byteLength(text) {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

/** Truncate on a UTF-8 boundary, never splitting a multi-byte character. */
function truncateToBytes(text, maxBytes) {
  if (byteLength(text) <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out.replace(/[.\s\-_]+$/, '');
}

/* ── src/core/template.js ───────────────────────── */
/**
 * Filename templates.
 *
 * A template is a string of literal text and `{token}` placeholders, e.g.
 *
 *     {host}-{date}-{w}x{h}-{index3}.{ext}
 *
 * Rendering is total: unknown tokens are reported and dropped (never executed,
 * never left in the name), every substituted value is passed through the same
 * path-component sanitiser used for ordinary downloads, and the result is
 * byte-clamped by `buildFilename` afterwards. Context values come from the page
 * and the image (untrusted), so nothing here may treat them as markup.
 */



const TEMPLATE_TOKENS = Object.freeze([
  { token: 'base', label: 'Source file name', example: 'photo-0142' },
  { token: 'path', label: 'Last URL segment', example: 'photo-0142' },
  { token: 'host', label: 'Image host', example: 'cdn.example.com' },
  { token: 'origin', label: 'Page host', example: 'example.com' },
  { token: 'title', label: 'Page title', example: 'Gallery' },
  { token: 'alt', label: 'Image alt text', example: 'Red fox' },
  { token: 'w', label: 'Output width (px)', example: '1920' },
  { token: 'h', label: 'Output height (px)', example: '1080' },
  { token: 'format', label: 'Format id', example: 'jpg' },
  { token: 'ext', label: 'File extension', example: 'jpeg' },
  { token: 'mime', label: 'MIME subtype', example: 'jpeg' },
  { token: 'bytes', label: 'Output size (bytes)', example: '284193' },
  { token: 'date', label: 'Date (YYYY-MM-DD)', example: '2026-10-16' },
  { token: 'time', label: 'Time (HH-MM-SS)', example: '14-05-09' },
  { token: 'datetime', label: 'Date and time', example: '2026-10-16-14-05-09' },
  { token: 'index', label: 'Counter in this run', example: '7' },
  { token: 'index3', label: 'Counter, zero-padded to 3', example: '007' },
  { token: 'preset', label: 'Active preset name', example: 'Archive PNG' },
]);

const TOKEN_NAMES = TEMPLATE_TOKENS.map((entry) => entry.token);
const TOKEN_PATTERN = /\{([a-z0-9]+)\}/g;
const MAX_TEMPLATE_LENGTH = 200;

/** Tokens referenced by a template, in order of first appearance. */
function tokensIn(template) {
  const text = typeof template === 'string' ? template : '';
  const found = [];
  let match;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Check a template before it is stored.
 *
 * @returns {{ok: boolean, errors: string[], warnings: string[], tokens: string[]}}
 */
function validateTemplate(template) {
  const errors = [];
  const warnings = [];
  const text = typeof template === 'string' ? template : '';

  if (!text.trim()) errors.push('A template cannot be empty.');
  if (text.length > MAX_TEMPLATE_LENGTH) errors.push(`A template cannot exceed ${MAX_TEMPLATE_LENGTH} characters.`);

  const tokens = tokensIn(text);
  const unknown = tokens.filter((token) => !TOKEN_NAMES.includes(token));
  if (unknown.length) {
    errors.push(`Unknown token${unknown.length > 1 ? 's' : ''}: ${unknown.map((token) => `{${token}}`).join(', ')}.`);
  }

  // Unbalanced braces are almost always a typo the user will want to see.
  const open = (text.match(/\{/g) || []).length;
  const close = (text.match(/\}/g) || []).length;
  if (open !== close) warnings.push('The braces do not balance — check for a missing { or }.');
  if (!tokens.length) warnings.push('This template has no tokens, so every file gets the same name.');
  if (/[\\/:*?"<>|]/.test(text.replace(TOKEN_PATTERN, ''))) {
    warnings.push('Some characters (\\ / : * ? " < > |) are not allowed in file names and will be replaced.');
  }
  if (!tokens.includes('base') && !tokens.includes('path') && !tokens.includes('alt') && !tokens.includes('title')) {
    warnings.push('Without {base}, {path}, {alt} or {title} names may collide; a counter is added automatically.');
  }

  return { ok: errors.length === 0, errors, warnings, tokens };
}

/**
 * Render a template.
 *
 * @param {string} template
 * @param {Record<string, string|number|undefined>} context
 * @param {{counter?: number, now?: Date, preset?: string}} [options]
 * @returns {{text: string, warnings: string[], values: Record<string, string>}}
 */
function renderTemplate(template, context = {}, { counter = 1, now = new Date(), preset = '' } = {}) {
  const text = typeof template === 'string' ? template : '';
  const warnings = [];
  const values = {};
  const stamp = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();

  const ctx = Object.assign({}, context);
  ctx.index = counter;
  ctx.index3 = String(counter).padStart(3, '0');
  ctx.preset = preset;
  ctx.date = formatDate(stamp);
  ctx.time = formatTime(stamp);
  ctx.datetime = `${ctx.date}-${ctx.time}`;

  const rendered = text.replace(TOKEN_PATTERN, (whole, token) => {
    if (!TOKEN_NAMES.includes(token)) {
      warnings.push(`Removed unknown token ${whole}.`);
      return '';
    }
    const raw = ctx[token];
    const value = raw === undefined || raw === null ? '' : sanitizePathComponent(String(raw), { maxChars: 60 });
    values[token] = value;
    return value;
  });

  // Trim both ends: a dropped token or an empty value would otherwise leave a
  // name like "photo-" behind, and Windows rejects trailing dots and spaces.
  const cleaned = sanitizePathComponent(rendered, { maxChars: 150 }).replace(/^[-_. ]+/, '').replace(/[-_. ]+$/, '');
  if (!cleaned) warnings.push('The template produced an empty name; the source file name was used instead.');
  return { text: cleaned, warnings, values };
}

/**
 * A name that no other file in this run already uses.
 *
 * Batches produce many files at once, and two identical names would silently
 * overwrite each other in the download folder — so collisions get a counter
 * rather than being reported after the fact.
 */
function uniqueFilename(filename, taken) {
  const name = String(filename || 'image');
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let counter = 2; counter < 100000; counter += 1) {
    const candidate = `${stem}-${counter}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}-${minutes}-${seconds}`;
}

/* ── src/core/raster.js ───────────────────────── */
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

class ConversionError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.detail = detail || null;
  }
}

function withTimeout(promise, ms, label) {
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

function createCanvas(width, height, { willReadFrequently = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new ConversionError('no-2d-context', 'This browser refused to create a 2D drawing context.');
  return { canvas, ctx };
}

/** Decode any blob/URL into an HTMLImageElement that is ready to draw. */
function loadImage(src, { timeout = 20000, crossOrigin = null } = {}) {
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

/** Draw any image-like source into a fresh canvas, optionally downscaling. */
function drawToCanvas(source, { maxPixels = 0, willReadFrequently = false } = {}) {
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

function canvasToImageData(canvas, ctx) {
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

function imageDataToCanvas(imageData) {
  const { canvas, ctx } = createCanvas(imageData.width, imageData.height, { willReadFrequently: true });
  ctx.putImageData(imageData, 0, 0);
  return { canvas, ctx };
}

/** Scan for any non-opaque pixel. Early-exits, so opaque photos are cheap. */
function detectAlpha(imageData) {
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
function flattenCanvas(sourceCanvas, background = 'white') {
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
function encodeNative(canvas, mime, quality) {
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
async function canEncode(mime) {
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

function blobFromBytes(bytes, mime) {
  return new Blob([bytes instanceof Uint8Array ? bytes.slice().buffer : bytes], { type: mime });
}

function objectUrlFor(blob) {
  return URL.createObjectURL(blob);
}

/** Revoke an object URL later without leaking it if the page unloads first. */
const pendingRevocations = new Set();
function revokeLater(objectUrl, delay = 60000) {
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

function revokeAllPending() {
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
function svgElementToObjectUrl(svgElement) {
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
  return URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
}

/** Format a byte count for the UI without pulling in a locale library. */
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/* ── src/core/transform.js ───────────────────────── */
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



const RESIZE_MODES = Object.freeze(['none', 'exact', 'fit', 'percent', 'max']);
const ROTATIONS = Object.freeze([0, 90, 180, 270]);
const MAX_TRANSFORM_PIXELS = 120000000; // 120 MP hard ceiling

const RESIZE_PRESETS = Object.freeze([
  { id: 'none', label: 'Keep original size', mode: 'none' },
  { id: 'max-1920', label: 'Longest edge ≤ 1920 px', mode: 'max', width: 1920 },
  { id: 'max-1024', label: 'Longest edge ≤ 1024 px', mode: 'max', width: 1024 },
  { id: 'max-512', label: 'Longest edge ≤ 512 px', mode: 'max', width: 512 },
  { id: 'half', label: 'Half size', mode: 'percent', width: 50 },
  { id: 'quarter', label: 'Quarter size', mode: 'percent', width: 25 },
]);

const TRANSFORM_DEFAULTS = Object.freeze({
  resize: { mode: 'none', width: 0, height: 0, keepAspect: true },
  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
});

/** Is this transform a no-op? Used to skip work and to warn about "original". */
function isTransformActive(transform) {
  if (!transform) return false;
  const resize = transform.resize || {};
  return Boolean(
    (resize.mode && resize.mode !== 'none' && (Number(resize.width) > 0 || Number(resize.height) > 0)) ||
      transform.crop ||
      (Number(transform.rotate) || 0) !== 0 ||
      transform.flipH ||
      transform.flipV,
  );
}

/** Coerce untrusted input (settings import, preset, dialog) into a valid spec. */
function normalizeTransform(raw, { sourceWidth = 0, sourceHeight = 0 } = {}) {
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
    else warnings.push(`Resize mode "${String(resize.mode).slice(0, 20)}" is not supported — resizing was turned off.`);
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

  const rotate = Number(raw.rotate) || 0;
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
function validateTransform(transform, { sourceWidth = 0, sourceHeight = 0 } = {}) {
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
function planTransform({ sourceWidth, sourceHeight, transform, errors = [], warnings = [] }) {
  const spec = transform || TRANSFORM_DEFAULTS;
  const srcW = Math.max(1, Math.round(Number(sourceWidth) || 1));
  const srcH = Math.max(1, Math.round(Number(sourceHeight) || 1));
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

  const rotate = ROTATIONS.includes(Number(spec.rotate)) ? Number(spec.rotate) : 0;
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
function applyTransform({ source, transform, createCanvas, sourceWidth = 0, sourceHeight = 0, maxPixels = MAX_TRANSFORM_PIXELS }) {
  if (!source) throw new ConversionError('transform-no-source', 'There is no image data to transform.');
  if (typeof createCanvas !== 'function') throw new ConversionError('transform-no-canvas', 'This browser cannot create a canvas to transform into.');

  const srcW = Math.round(Number(sourceWidth) || Number(source.width) || Number(source.naturalWidth) || 0);
  const srcH = Math.round(Number(sourceHeight) || Number(source.height) || Number(source.naturalHeight) || 0);
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
function transformImageData(imageData, transform, createCanvas) {
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
function describeTransform(transform) {
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
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

/* ── src/core/presets.js ───────────────────────── */
/**
 * Conversion presets.
 *
 * A preset bundles the choices a user repeats: output format, quality, filename
 * template, sub-folder, destination (single files or a ZIP archive), an optional
 * transform, and — uniquely — the hosts it should apply to automatically.
 *
 * Everything here is pure data handling. Presets arrive from storage or from an
 * imported JSON file, so they are treated as untrusted: unknown fields are
 * dropped, values are coerced into range, host patterns are sanitised, and the
 * list is capped.
 */





const PRESET_LIMITS = Object.freeze({
  max: 12,
  maxHosts: 8,
  nameChars: 40,
  hostChars: 60,
});

const PRESET_DESTINATIONS = Object.freeze(['file', 'zip']);

const PRESET_FORMAT_IDS = ['png', 'jpg', 'webp', 'gif', 'bmp', 'avif', 'pdf', 'original'];

/** Turn one untrusted object into a usable preset. */
function normalizePreset(raw, { index = 0, allowedFormats = PRESET_FORMAT_IDS } = {}) {
  const warnings = [];
  const source = raw && typeof raw === 'object' ? raw : {};

  const name = String(source.name || '').trim().slice(0, PRESET_LIMITS.nameChars) || `Preset ${index + 1}`;
  const id = sanitizeId(source.id) || `preset-${index + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`;

  const preset = {
    id,
    name,
    formatId: allowedFormats.includes(source.formatId) ? source.formatId : '',
    jpegQuality: clampQuality(source.jpegQuality, 0.5),
    webpQuality: clampQuality(source.webpQuality, 0.1),
    filenameTemplate: '',
    subfolder: sanitizeSubfolder(source.subfolder),
    destination: PRESET_DESTINATIONS.includes(source.destination) ? source.destination : 'file',
    stripMetadata: Boolean(source.stripMetadata),
    transform: TRANSFORM_DEFAULTS,
    hosts: [],
  };

  if (source.formatId && !preset.formatId) {
    warnings.push(`Preset "${name}": format "${String(source.formatId).slice(0, 12)}" is not available here and was dropped.`);
  }

  if (typeof source.filenameTemplate === 'string' && source.filenameTemplate.trim()) {
    const checked = validateTemplate(source.filenameTemplate);
    if (checked.ok) preset.filenameTemplate = source.filenameTemplate.trim().slice(0, 200);
    else warnings.push(`Preset "${name}": its filename template was invalid (${checked.errors[0]}) and was dropped.`);
  }

  if (source.transform) {
    const normalized = normalizeTransform(source.transform);
    preset.transform = normalized.transform;
    for (const warning of normalized.warnings) warnings.push(`Preset "${name}": ${warning}`);
  }

  if (Array.isArray(source.hosts)) {
    const seen = [];
    for (const value of source.hosts.slice(0, PRESET_LIMITS.maxHosts)) {
      const pattern = sanitizeHostPattern(value);
      if (!pattern) continue;
      if (seen.includes(pattern)) continue;
      seen.push(pattern);
    }
    preset.hosts = seen;
    if (source.hosts.length > PRESET_LIMITS.maxHosts) {
      warnings.push(`Preset "${name}": only the first ${PRESET_LIMITS.maxHosts} host rules were kept.`);
    }
  }

  return { preset, warnings };
}

/** Validate a whole list: caps, duplicate names/ids, deterministic order. */
function validatePresets(list, { allowedFormats = PRESET_FORMAT_IDS } = {}) {
  const warnings = [];
  const presets = [];
  const ids = new Set();
  const names = new Set();
  const incoming = Array.isArray(list) ? list : [];

  if (incoming.length > PRESET_LIMITS.max) {
    warnings.push(`Only the first ${PRESET_LIMITS.max} presets were kept (${incoming.length} were stored).`);
  }

  for (let index = 0; index < Math.min(incoming.length, PRESET_LIMITS.max); index += 1) {
    const { preset, warnings: itemWarnings } = normalizePreset(incoming[index], { index, allowedFormats });
    for (const warning of itemWarnings) warnings.push(warning);

    let id = preset.id;
    if (ids.has(id)) {
      id = `${id}-${index + 1}`;
      warnings.push(`Two presets shared an id, so one was renamed to "${id}".`);
    }
    preset.id = id;
    ids.add(id);

    let name = preset.name;
    if (names.has(name.toLowerCase())) {
      name = `${name} (${index + 1})`;
      warnings.push(`Two presets were both called "${preset.name}", so one is now "${name}".`);
    }
    preset.name = name;
    names.add(name.toLowerCase());

    presets.push(preset);
  }

  return { presets, warnings };
}

/**
 * Sanitise a host rule.
 *
 * Accepts `example.com` and `*.example.com`; strips schemes, ports, paths and
 * anything that is not a hostname character. Rules are matched against the page
 * host only — never against a path or query string, so a rule cannot be used to
 * target a signed URL.
 */
function sanitizeHostPattern(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return '';
  // A host rule must be a plain ASCII hostname (Punycode for an IDN). Silently
  // repairing "exa mple.com" or "exämple.com" would aim the preset at a host
  // the user never typed, so such input is refused instead of cleaned.
  if (/\s/.test(raw) || /[^\u0000-\u007f]/.test(raw)) return '';
  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  const hostOnly = withoutScheme.split('/')[0].split('?')[0].split('#')[0].replace(/:\d+$/, '');
  const cleaned = hostOnly.replace(/[^a-z0-9.*-]/g, '').slice(0, PRESET_LIMITS.hostChars);
  if (!cleaned || cleaned === '*' || !/[a-z0-9]/.test(cleaned)) return '';
  // "*.com" would auto-apply to half the internet; require at least two labels.
  const labels = cleaned.replace(/^\*\./, '').split('.').filter(Boolean);
  if (labels.length < 2) return '';
  return cleaned;
}

/** Does a host rule match a host? Longest rule wins when several match. */
function hostMatches(pattern, host) {
  const rule = String(pattern || '').toLowerCase().trim();
  const target = String(host || '').toLowerCase().trim().replace(/:\d+$/, '');
  if (!rule || !target) return false;
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(2);
    return target === suffix || target.endsWith(`.${suffix}`);
  }
  if (rule.startsWith('*')) {
    const suffix = rule.slice(1);
    return target.endsWith(suffix);
  }
  return target === rule;
}

/**
 * Pick the preset that should auto-apply on a host.
 *
 * Precedence is deterministic: the most specific rule (most labels, then exact
 * over wildcard) wins; ties break on declaration order, so importing presets
 * twice cannot change behaviour.
 */
function presetForHost(presets, host) {
  const list = Array.isArray(presets) ? presets : [];
  if (!host) return null;
  let best = null;
  let bestScore = -1;
  for (let index = 0; index < list.length; index += 1) {
    const preset = list[index];
    if (!preset || !Array.isArray(preset.hosts)) continue;
    for (const pattern of preset.hosts) {
      if (!hostMatches(pattern, host)) continue;
      const labels = String(pattern).replace(/^\*\./, '').split('.').filter(Boolean).length;
      const exact = String(pattern).startsWith('*.') ? 0 : 1;
      const score = labels * 10 + exact;
      if (score > bestScore) {
        bestScore = score;
        best = preset;
      }
    }
  }
  return best;
}

/**
 * Apply a preset to settings, producing the effective settings for one run.
 *
 * The stored settings object is never mutated: a preset is a view, and turning
 * it off must restore exactly what the user had.
 */
function effectiveSettings(settings, preset) {
  const base = Object.assign({}, settings || {});
  if (!preset) return base;

  if (preset.formatId) base.presetFormatId = preset.formatId;
  if (preset.jpegQuality) base.jpegQuality = preset.jpegQuality;
  if (preset.webpQuality) base.webpQuality = preset.webpQuality;
  if (preset.filenameTemplate) base.filenameTemplate = preset.filenameTemplate;
  if (preset.subfolder !== undefined) base.subfolder = preset.subfolder;
  if (preset.destination) base.presetDestination = preset.destination;
  if (preset.stripMetadata) base.stripMetadataOnOriginal = true;
  if (preset.transform) base.presetTransform = preset.transform;
  base.activePresetId = preset.id || '';
  base.activePresetName = preset.name || '';
  return base;
}

/** One-line description for the menu and the preset list. */
function presetSummary(preset) {
  if (!preset) return '';
  const parts = [];
  if (preset.formatId) parts.push(preset.formatId.toUpperCase());
  if (preset.destination === 'zip') parts.push('ZIP');
  if (preset.transform && (preset.transform.resize.mode !== 'none' || preset.transform.crop || preset.transform.rotate)) parts.push('transform');
  if (preset.filenameTemplate) parts.push('template');
  if (preset.subfolder) parts.push(`→ ${preset.subfolder}`);
  if (preset.hosts && preset.hosts.length) parts.push(`auto on ${preset.hosts.slice(0, 2).join(', ')}${preset.hosts.length > 2 ? ` +${preset.hosts.length - 2}` : ''}`);
  return parts.join(' · ');
}

/** Stable text form for settings export (round-trips through normalizePreset). */
function serializePresets(presets) {
  const list = Array.isArray(presets) ? presets : [];
  return list.map((preset) => ({
    id: preset.id,
    name: preset.name,
    formatId: preset.formatId || '',
    jpegQuality: preset.jpegQuality || 0,
    webpQuality: preset.webpQuality || 0,
    filenameTemplate: preset.filenameTemplate || '',
    subfolder: preset.subfolder || '',
    destination: preset.destination || 'file',
    stripMetadata: Boolean(preset.stripMetadata),
    transform: preset.transform || TRANSFORM_DEFAULTS,
    hosts: Array.isArray(preset.hosts) ? preset.hosts.slice() : [],
  }));
}

function sanitizeId(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';
  return text.replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').slice(0, 40);
}

/**
 * Quality for a preset, where 0 means "use the global quality setting".
 *
 * Clamping a stored 0 up to the floor would silently give every preset its own
 * quality on the first re-import (or the next settings load), overriding the
 * user's global choice — so "not set" stays "not set".
 */
function clampQuality(value, min) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(min, Math.min(1, number));
}

/* ── src/core/shortcuts.js ───────────────────────── */
/**
 * Keyboard shortcuts.
 *
 * Rules that keep this from breaking the pages it runs on:
 *
 *   - a binding must include Ctrl, Alt or Meta, or be a function key. Plain
 *     letters are never captured, so typing in a page's own search box is safe;
 *   - chords the browser reserves (Ctrl+W, Ctrl+T, F5, …) are refused with an
 *     explanation, because the browser will win and the user would see a
 *     shortcut that appears to do nothing;
 *   - no two actions may share a binding;
 *   - keys are matched on `event.code` where available, so the binding means the
 *     same physical key regardless of layout or shift-produced symbols.
 */

const SHORTCUT_ACTIONS = Object.freeze([
  { id: 'quickSave', label: 'Save the image under the pointer in the last-used format', default: 'Alt+Shift+S' },
  { id: 'copyImage', label: 'Copy the image under the pointer to the clipboard', default: 'Alt+Shift+C' },
  { id: 'openPicker', label: 'Open the page image picker', default: 'Alt+Shift+P' },
  { id: 'saveAll', label: 'Convert every image on this page', default: 'Alt+Shift+A' },
  { id: 'cancelJob', label: 'Cancel the running batch job', default: 'Alt+Shift+X' },
]);

const DEFAULT_SHORTCUTS = SHORTCUT_ACTIONS.reduce((map, action) => {
  map[action.id] = action.default;
  return map;
}, {});

const MODIFIER_NAMES = Object.freeze(['ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command', 'win']);
const RESERVED = Object.freeze([
  'ctrl+w',
  'ctrl+t',
  'ctrl+n',
  'ctrl+shift+w',
  'ctrl+shift+t',
  'ctrl+shift+n',
  'ctrl+tab',
  'ctrl+shift+tab',
  'ctrl+l',
  'ctrl+f',
  'ctrl+p',
  'ctrl+r',
  'ctrl+d',
  'ctrl+k',
  'ctrl+u',
  'ctrl+s',
  'ctrl+shift+s',
  'alt+tab',
  'alt+f4',
  'f5',
  'f11',
  'f12',
]);

const CODE_MAP = {
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Delete: 'delete',
  Insert: 'insert',
};

/** Parse "Alt+Shift+S" into a normalised binding object. Returns null if unusable. */
function parseBinding(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;

  const binding = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (let index = 0; index < parts.length - 1; index += 1) {
    const name = parts[index].toLowerCase();
    if (!MODIFIER_NAMES.includes(name)) return null; // a modifier slot held a key
    if (name === 'ctrl' || name === 'control') binding.ctrl = true;
    else if (name === 'alt' || name === 'option') binding.alt = true;
    else if (name === 'shift') binding.shift = true;
    else binding.meta = true;
  }

  const key = normalizeKeyName(parts[parts.length - 1]);
  if (!key) return null;
  binding.key = key;
  return binding;
}

function normalizeKeyName(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  if (CODE_MAP[text]) return CODE_MAP[text];
  const lower = text.toLowerCase();
  if (/^[a-z]$/.test(lower)) return lower;
  if (/^[0-9]$/.test(lower)) return lower;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower;
  if (CODE_MAP[text.charAt(0).toUpperCase() + text.slice(1)]) return CODE_MAP[text.charAt(0).toUpperCase() + text.slice(1)];
  if (['space', 'enter', 'escape', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'].includes(lower)) return lower;
  if (['-', '=', '[', ']', ';', "'", '`', '\\', ',', '.', '/'].includes(lower)) return lower;
  return '';
}

/** Canonical id used for duplicate/conflict checks: "alt+shift+s". */
function bindingId(binding) {
  if (!binding || !binding.key) return '';
  const parts = [];
  if (binding.ctrl) parts.push('ctrl');
  if (binding.alt) parts.push('alt');
  if (binding.shift) parts.push('shift');
  if (binding.meta) parts.push('meta');
  parts.push(binding.key);
  return parts.join('+');
}

/** Display text: "Alt+Shift+S". */
function formatBinding(binding) {
  if (typeof binding === 'string') return binding;
  if (!binding || !binding.key) return '';
  const parts = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  if (binding.meta) parts.push('Meta');
  parts.push(displayKey(binding.key));
  return parts.join('+');
}

// Multi-word key names need their own casing: capitalising the first letter
// only would show "Arrowleft" and "Pageup" in the help overlay and the settings
// panel, which reads like a bug to the user.
const DISPLAY_KEY_NAMES = Object.freeze({
  space: 'Space',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  delete: 'Delete',
  insert: 'Insert',
});

function displayKey(key) {
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  if (DISPLAY_KEY_NAMES[key]) return DISPLAY_KEY_NAMES[key];
  return key.length ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

/** Normalise a live keyboard event into the same shape as a parsed binding. */
function bindingFromEvent(event) {
  if (!event) return null;
  const code = typeof event.code === 'string' ? event.code : '';
  let key = '';
  if (code) {
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F\d{1,2}$/.test(code)) key = code.toLowerCase();
    else if (CODE_MAP[code]) key = CODE_MAP[code];
  }
  if (!key && typeof event.key === 'string') key = normalizeKeyName(event.key);
  if (!key) return null;
  return {
    ctrl: Boolean(event.ctrlKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
    meta: Boolean(event.metaKey),
    key,
  };
}

/** Does a keyboard event match a binding? Exact on modifiers and key. */
function matchesBinding(event, binding) {
  const fromEvent = bindingFromEvent(event);
  if (!fromEvent || !binding || !binding.key) return false;
  return (
    fromEvent.ctrl === Boolean(binding.ctrl) &&
    fromEvent.alt === Boolean(binding.alt) &&
    fromEvent.shift === Boolean(binding.shift) &&
    fromEvent.meta === Boolean(binding.meta) &&
    fromEvent.key === binding.key
  );
}

/**
 * Validate a shortcut map.
 *
 * @param {Record<string,string>} raw
 * @returns {{ok: boolean, shortcuts: Record<string,object>, errors: string[], warnings: string[], disabled: string[]}}
 */
function validateShortcuts(raw) {
  const errors = [];
  const warnings = [];
  const shortcuts = {};
  const disabled = [];
  const taken = new Map();

  for (const action of SHORTCUT_ACTIONS) {
    const value = raw && typeof raw === 'object' ? raw[action.id] : undefined;
    if (value === '' || value === 'off' || value === null) {
      disabled.push(action.id);
      continue;
    }
    const text = value === undefined ? action.default : value;
    const binding = parseBinding(text);
    if (!binding) {
      if (value === undefined) continue;
      warnings.push(`"${String(text).slice(0, 30)}" is not a readable shortcut for ${action.label}; the default ${action.default} was kept.`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    const id = bindingId(binding);
    const hasModifier = binding.ctrl || binding.alt || binding.meta;
    const isFunctionKey = /^f\d{1,2}$/.test(binding.key);
    if (!hasModifier && !isFunctionKey) {
      errors.push(`${formatBinding(binding)} has no Ctrl/Alt/Meta modifier, so it would capture ordinary typing. It was not applied.`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    if (RESERVED.includes(id)) {
      errors.push(`${formatBinding(binding)} is reserved by the browser and cannot be used here. The default ${action.default} was kept for "${action.label}".`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    if (taken.has(id)) {
      warnings.push(`${formatBinding(binding)} was already used for another action, so "${action.label}" keeps the default ${action.default}.`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    taken.set(id, action.id);
    shortcuts[action.id] = binding;
  }

  return { ok: errors.length === 0, shortcuts, errors, warnings, disabled };
}

/** Rows for the help overlay, in a stable order. */
function describeShortcuts(shortcuts, { disabled = [] } = {}) {
  return SHORTCUT_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    binding: shortcuts && shortcuts[action.id] ? formatBinding(shortcuts[action.id]) : '',
    disabled: disabled.includes(action.id),
  }));
}

/** Is this element one where the page expects raw keystrokes? */
function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (typeof target.getAttribute === 'function') {
    const role = target.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  }
  return false;
}

/* ── src/core/settings.js ───────────────────────── */
/**
 * Settings: schema, validation, migration and persistence.
 *
 * Rules this module enforces:
 *   - every value read back from storage (or imported from a JSON file the user
 *     hands us) is validated and clamped before anything else in the script
 *     sees it. Storage can be corrupted by hand, downgraded versions or a
 *     hostile import file; none of that may reach the DOM or a filename.
 *   - the schema is versioned and old shapes are migrated rather than dropped,
 *     so an upgrade preserves the user's configuration.
 *   - when no storage capability is granted the script still runs, using an
 *     in-memory store, and says so in the diagnostics panel.
 */








/**
 * v3 adds the batch/picker, template, preset, clipboard, metadata, transform,
 * comparison and shortcut settings. The storage key moved with the version so a
 * downgrade to v1.x keeps working from its own key instead of choking on fields
 * it does not know; v2 keys are read and migrated.
 */
const SETTINGS_SCHEMA_VERSION = 3;
const SETTINGS_STORAGE_KEYS = ['siat.settings.v3', 'siat.settings.v2', 'siat.settings', 'saveImageAsType.settings'];

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,

  /** Which formats appear in the right-click menu, in this order. */
  formats: defaultEnabledFormats().filter((id) => id !== 'avif'),

  /** 'instant' = save without a dialog where the manager allows it; 'ask' = request Save As. */
  downloadBehavior: 'instant',

  filenamePrefix: '',
  subfolder: '',
  maxFilenameLength: 64,

  /** Background used when a format cannot store transparency (JPG, PDF, GIF-without-alpha). */
  flattenBackground: 'white',

  jpegQuality: 0.92,
  webpQuality: 0.9,

  /** PDF page geometry: 'a4' | 'letter' (fit, keep aspect) | 'pixel' (1px = 0.75pt). */
  pdfPageFit: 'a4',

  /** Animated sources: try to keep every frame when the browser can decode them. */
  keepAnimation: true,
  gifMaxFrames: 100,
  /** Refuse a GIF conversion above this many MB of raw frame pixels (crash guard). */
  gifMemoryLimitMB: 512,

  /** Downscale very large images before encoding, to keep the tab alive. 0 = never. */
  downscaleAboveMegapixels: 40,

  /** Fetch cross-origin image bytes through the manager (the CORS bypass). */
  allowCrossOriginFetch: true,

  enableBackgroundImages: true,
  enableLongPress: true,
  interceptContextMenu: true,
  /** Power option: only open our menu when Shift is held, leaving the native menu as default. */
  requireShift: false,

  rememberLastFormat: true,
  notifyOnError: true,

  /* ── v3: batch conversion and archives ─────────────────────────────── */

  /** How many images convert at once. Bounded: a 500-image page must not open 500 fetches. */
  batchConcurrency: 2,
  /** Upper bound for one batch run; the rest are reported as skipped. */
  batchMaxImages: 200,
  /** Ignore images smaller than these (0 = off). Keeps icons and tracking pixels out. */
  batchMinWidth: 0,
  batchMinHeight: 0,
  batchSkipTiny: true,
  /** One output per distinct source URL. */
  batchDedupe: true,
  /** Force-load images the page has not loaded yet. Costs bandwidth, so off by default. */
  batchIncludeNotLoaded: false,
  /** 'files' = one download each; 'zip' = a single archive. */
  batchDestination: 'files',
  /** Extra formats to write per image (empty = only the chosen format). */
  batchFormats: [],
  /** Refuse to build an archive above this many MB in memory. */
  zipMaxMB: 512,

  /* ── v3: file-name templates ───────────────────────────────────────── */

  /** '' keeps the classic "{prefix}-{base}" naming. */
  filenameTemplate: '',
  /** Add -2, -3 … when one run would otherwise overwrite a name. */
  filenameCollisionSuffix: true,

  /* ── v3: presets ───────────────────────────────────────────────────── */

  presets: [],
  activePresetId: '',
  autoApplyPresetByHost: true,

  /* ── v3: clipboard, metadata, transform, comparison ────────────────── */

  /** 'png' = re-encode for the clipboard; 'original' = try the source bytes first. */
  copyFormat: 'png',
  /** Drop EXIF/XMP when re-saving the *original* file. */
  stripMetadataOnOriginal: false,
  /** Also drop the ICC colour profile (changes how colours may look). */
  dropIccWhenStripping: false,
  warnAboutGps: true,
  /** Transform applied unless the dialog overrides it. null = none. */
  defaultTransform: null,
  compareFormats: ['png', 'jpg', 'webp'],

  /* ── v3: keyboard and scanning ─────────────────────────────────────── */

  enableShortcuts: true,
  shortcuts: Object.assign({}, DEFAULT_SHORTCUTS),
  /** Which extra actions the right-click menu shows. */
  menuActions: ['copy', 'transform', 'compare', 'inspect', 'browse', 'batch'],
  scanBackgrounds: true,
  /** Elements inspected while looking for CSS background images. */
  scanElementCap: 2500,
  showJobBar: true,
});

/** Menu action ids that may appear in `menuActions`. */
const MENU_ACTION_IDS = Object.freeze(['copy', 'transform', 'compare', 'inspect', 'browse', 'batch']);

/** What each extra menu action does, for the settings panel. */
const MENU_ACTION_LABELS = Object.freeze({
  copy: { label: 'Copy image to clipboard', hint: 'Copies a PNG (or the original bytes) for pasting into another app.' },
  transform: { label: 'Transform and save…', hint: 'Resize, crop, rotate or flip before saving.' },
  compare: { label: 'Compare formats…', hint: 'Encodes the image several ways and shows which file is smallest.' },
  inspect: { label: 'Inspect metadata', hint: 'Shows embedded EXIF/XMP/ICC data, including any GPS coordinates.' },
  browse: { label: 'Browse page images…', hint: 'Lists every image on the page with size, type and state.' },
  batch: { label: 'Save all images on this page…', hint: 'Converts the whole page in one run, with progress and cancel.' },
});

/** Deep-copied defaults: nested arrays/objects must never be shared with the frozen template. */
function cloneDefaults() {
  return {
    ...DEFAULT_SETTINGS,
    formats: DEFAULT_SETTINGS.formats.slice(),
    batchFormats: DEFAULT_SETTINGS.batchFormats.slice(),
    compareFormats: DEFAULT_SETTINGS.compareFormats.slice(),
    menuActions: DEFAULT_SETTINGS.menuActions.slice(),
    presets: [],
    shortcuts: Object.assign({}, DEFAULT_SETTINGS.shortcuts),
    defaultTransform: DEFAULT_SETTINGS.defaultTransform ? normalizeTransform(DEFAULT_SETTINGS.defaultTransform).transform : null,
  };
}

const BOOL_KEYS = [
  'keepAnimation',
  'allowCrossOriginFetch',
  'enableBackgroundImages',
  'enableLongPress',
  'interceptContextMenu',
  'requireShift',
  'rememberLastFormat',
  'notifyOnError',
  'batchSkipTiny',
  'batchDedupe',
  'batchIncludeNotLoaded',
  'filenameCollisionSuffix',
  'autoApplyPresetByHost',
  'stripMetadataOnOriginal',
  'dropIccWhenStripping',
  'warnAboutGps',
  'enableShortcuts',
  'scanBackgrounds',
  'showJobBar',
];

/**
 * v1 (pre-schema) stored a flatter shape. Kept explicit so an upgrade never
 * silently resets somebody's configuration.
 */
function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') return { value: null, from: null };
  const version = Number(raw.schemaVersion);
  if (version === SETTINGS_SCHEMA_VERSION) return { value: raw, from: version };

  const migrated = {};

  // v2 -> v3 only *adds* settings; nothing was renamed. Every stored value is
  // carried over untouched and normalizeSettings() fills in the new defaults.
  if (version === 2) {
    return { value: Object.assign({}, raw, { schemaVersion: SETTINGS_SCHEMA_VERSION }), from: 2 };
  }

  // Keys that only ever existed in the flat v1 shape. Their presence is what
  // proves an unversioned object is v1; without them an unversioned object is
  // current-schema data that merely lost its stamp (hand-edited or imported
  // from a partial export), and mapping it through the v1 table would drop
  // every field the v1 table does not know about.
  const LEGACY_ONLY_KEYS = ['enabledFormats', 'instant', 'askBeforeSave', 'prefix', 'folder', 'maxLen', 'quality', 'background', 'gifMemory'];
  const looksLegacy = LEGACY_ONLY_KEYS.some((key) => raw[key] !== undefined);
  if (version === 1 || (Number.isNaN(version) && looksLegacy)) {
    const list = raw.enabledFormats || raw.formats;
    if (Array.isArray(list)) migrated.formats = list;
    if (typeof raw.instant === 'boolean') migrated.downloadBehavior = raw.instant ? 'instant' : 'ask';
    if (typeof raw.askBeforeSave === 'boolean') migrated.downloadBehavior = raw.askBeforeSave ? 'ask' : 'instant';
    if (typeof raw.prefix === 'string') migrated.filenamePrefix = raw.prefix;
    if (typeof raw.folder === 'string' || typeof raw.subfolder === 'string') {
      migrated.subfolder = raw.folder || raw.subfolder;
    }
    if (raw.maxLen !== undefined) migrated.maxFilenameLength = raw.maxLen;
    if (raw.quality !== undefined) migrated.jpegQuality = raw.quality;
    if (raw.background !== undefined) migrated.flattenBackground = raw.background;
    if (raw.gifMemory !== undefined) migrated.gifMemoryLimitMB = raw.gifMemory;
    return { value: migrated, from: version === 1 ? 1 : 0 };
  }
  if (Number.isNaN(version)) {
    // Unversioned but written in the current shape: keep it as-is and let
    // normalizeSettings() clamp and validate every field.
    return { value: raw, from: 0 };
  }

  // A *newer* schema than we understand: keep only keys we recognise so that a
  // downgrade does not explode, and report it.
  if (version < SETTINGS_SCHEMA_VERSION) {
    // Older but not a shape this build maps explicitly: keep the values.
    return { value: Object.assign({}, raw, { schemaVersion: SETTINGS_SCHEMA_VERSION }), from: version };
  }
  const known = Object.keys(DEFAULT_SETTINGS);
  for (const key of known) {
    if (raw[key] !== undefined) migrated[key] = raw[key];
  }
  return { value: migrated, from: version, downgraded: true };
}

/**
 * Validate + clamp an arbitrary object into a complete, safe settings object.
 * @returns {{settings: object, warnings: string[], recovered: boolean}}
 */
function normalizeSettings(raw) {
  const out = cloneDefaults();
  const warnings = [];
  let recovered = false;

  if (raw === null || raw === undefined) {
    return { settings: out, warnings: ['No stored settings found — using defaults.'], recovered: true };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { settings: out, warnings: ['Stored settings were not an object — reset to defaults.'], recovered: true };
  }

  const note = (message) => {
    warnings.push(message);
    recovered = true;
  };

  if (Array.isArray(raw.formats)) {
    const clean = [];
    for (const id of raw.formats) {
      if (typeof id === 'string' && FORMAT_IDS.includes(id) && !clean.includes(id)) clean.push(id);
      else if (id !== undefined) note(`Ignored unknown format "${String(id).slice(0, 20)}".`);
    }
    // An empty menu would make the script unusable and look like a bug.
    out.formats = clean.length ? clean : DEFAULT_SETTINGS.formats.slice();
    if (!clean.length) note('No valid formats were enabled — restored the default list.');
  } else if (raw.formats !== undefined) {
    note('formats was not a list — restored the default list.');
  }

  if (raw.downloadBehavior !== undefined) {
    if (raw.downloadBehavior === 'instant' || raw.downloadBehavior === 'ask') out.downloadBehavior = raw.downloadBehavior;
    else note(`downloadBehavior "${String(raw.downloadBehavior).slice(0, 20)}" is not valid — using "instant".`);
  }

  out.filenamePrefix = coerceString(raw, 'filenamePrefix', out, note, (v) => sanitizePathComponent(v, { maxChars: 40 }));
  out.subfolder = coerceString(raw, 'subfolder', out, note, sanitizeSubfolder);

  out.maxFilenameLength = coerceInt(raw, 'maxFilenameLength', out, note, 8, 120);
  out.gifMaxFrames = coerceInt(raw, 'gifMaxFrames', out, note, 2, 200);
  out.gifMemoryLimitMB = coerceInt(raw, 'gifMemoryLimitMB', out, note, 16, 4096);
  out.downscaleAboveMegapixels = coerceInt(raw, 'downscaleAboveMegapixels', out, note, 0, 400);

  out.jpegQuality = coerceFloat(raw, 'jpegQuality', out, note, 0.5, 1);
  out.webpQuality = coerceFloat(raw, 'webpQuality', out, note, 0.1, 1);

  if (raw.pdfPageFit !== undefined) {
    if (['a4', 'letter', 'pixel'].includes(raw.pdfPageFit)) out.pdfPageFit = raw.pdfPageFit;
    else note(`pdfPageFit "${String(raw.pdfPageFit).slice(0, 20)}" is not valid — using "a4".`);
  }

  if (raw.flattenBackground !== undefined) {
    if (['white', 'black', 'checker'].includes(raw.flattenBackground)) out.flattenBackground = raw.flattenBackground;
    else note(`flattenBackground "${String(raw.flattenBackground).slice(0, 20)}" is not valid — using "white".`);
  }

  for (const key of BOOL_KEYS) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
    else note(`${key} was not true/false — using ${DEFAULT_SETTINGS[key]}.`);
  }

  /* ── v3: batch and archive ─────────────────────────────────────────── */
  out.batchConcurrency = coerceInt(raw, 'batchConcurrency', out, note, 1, 4);
  out.batchMaxImages = coerceInt(raw, 'batchMaxImages', out, note, 1, 2000);
  out.batchMinWidth = coerceInt(raw, 'batchMinWidth', out, note, 0, 20000);
  out.batchMinHeight = coerceInt(raw, 'batchMinHeight', out, note, 0, 20000);
  out.zipMaxMB = coerceInt(raw, 'zipMaxMB', out, note, 1, 4096);
  out.scanElementCap = coerceInt(raw, 'scanElementCap', out, note, 100, 20000);

  if (raw.batchDestination !== undefined) {
    if (raw.batchDestination === 'files' || raw.batchDestination === 'zip') out.batchDestination = raw.batchDestination;
    else note(`batchDestination "${String(raw.batchDestination).slice(0, 20)}" is not valid — using "files".`);
  }
  out.batchFormats = coerceIdList(raw, 'batchFormats', out, note, FORMAT_IDS, 6);
  out.compareFormats = coerceIdList(raw, 'compareFormats', out, note, FORMAT_IDS, 6);
  out.menuActions = coerceIdList(raw, 'menuActions', out, note, MENU_ACTION_IDS, MENU_ACTION_IDS.length);

  /* ── v3: filename template ─────────────────────────────────────────── */
  if (raw.filenameTemplate !== undefined) {
    if (typeof raw.filenameTemplate !== 'string') {
      note('filenameTemplate was not text — templates were turned off.');
    } else {
      const text = raw.filenameTemplate.trim();
      if (!text) out.filenameTemplate = '';
      else if (text.length > MAX_TEMPLATE_LENGTH) {
        note(`filenameTemplate was longer than ${MAX_TEMPLATE_LENGTH} characters — templates were turned off.`);
        out.filenameTemplate = '';
      } else {
        const checked = validateTemplate(text);
        if (checked.ok) out.filenameTemplate = text;
        else {
          note(`filenameTemplate was invalid (${checked.errors[0]}) — templates were turned off.`);
          out.filenameTemplate = '';
        }
      }
    }
  }

  /* ── v3: presets ───────────────────────────────────────────────────── */
  if (raw.presets !== undefined) {
    if (!Array.isArray(raw.presets)) {
      note('presets was not a list — presets were cleared.');
    } else {
      const validated = validatePresets(raw.presets, { allowedFormats: FORMAT_IDS });
      out.presets = serializePresets(validated.presets);
      for (const warning of validated.warnings) note(warning);
    }
  }
  if (raw.activePresetId !== undefined) {
    const id = typeof raw.activePresetId === 'string' ? raw.activePresetId.trim() : '';
    const exists = id && out.presets.some((preset) => preset.id === id);
    out.activePresetId = exists ? id : '';
    if (id && !exists) note(`No preset with id "${id.slice(0, 30)}" exists, so no preset is active.`);
  }

  /* ── v3: clipboard and metadata ────────────────────────────────────── */
  if (raw.copyFormat !== undefined) {
    if (raw.copyFormat === 'png' || raw.copyFormat === 'original') out.copyFormat = raw.copyFormat;
    else note(`copyFormat "${String(raw.copyFormat).slice(0, 20)}" is not valid — using "png".`);
  }

  /* ── v3: transform ─────────────────────────────────────────────────── */
  if (raw.defaultTransform !== undefined) {
    if (raw.defaultTransform === null) out.defaultTransform = null;
    else if (typeof raw.defaultTransform !== 'object') note('defaultTransform was not an object — the default transform was cleared.');
    else {
      const normalized = normalizeTransform(raw.defaultTransform);
      out.defaultTransform = normalized.transform;
      for (const warning of normalized.warnings) note(warning);
    }
  }

  /* ── v3: shortcuts ─────────────────────────────────────────────────── */
  if (raw.shortcuts !== undefined) {
    if (typeof raw.shortcuts !== 'object' || raw.shortcuts === null || Array.isArray(raw.shortcuts)) {
      note('shortcuts was not an object — the default shortcuts were restored.');
    } else {
      const checked = validateShortcuts(raw.shortcuts);
      const map = Object.assign({}, DEFAULT_SETTINGS.shortcuts);
      for (const [action, binding] of Object.entries(checked.shortcuts)) map[action] = formatBinding(binding);
      for (const action of checked.disabled) map[action] = '';
      out.shortcuts = map;
      for (const error of checked.errors) note(error);
      for (const warning of checked.warnings) note(warning);
    }
  }

  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULT_SETTINGS) && key !== 'schemaVersion') {
      // Unknown keys are dropped, not executed. Say so once.
      note(`Ignored unknown setting "${String(key).slice(0, 30)}".`);
    }
  }

  out.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return { settings: out, warnings, recovered };
}

function coerceString(raw, key, out, note, transform) {
  if (raw[key] === undefined) return out[key];
  if (typeof raw[key] !== 'string') {
    note(`${key} was not text — ignored.`);
    return out[key];
  }
  return transform(raw[key]);
}

function coerceInt(raw, key, out, note, min, max) {
  if (raw[key] === undefined) return out[key];
  const n = Number(raw[key]);
  if (!Number.isFinite(n)) {
    note(`${key} was not a number — using ${out[key]}.`);
    return out[key];
  }
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) note(`${key} ${rounded} is outside ${min}–${max} — clamped.`);
  return Math.min(max, Math.max(min, rounded));
}

/** Validate a list of ids (formats, menu actions) into a clean, capped array. */
function coerceIdList(raw, key, out, note, allowed, cap = 32) {
  if (raw[key] === undefined) return out[key];
  if (!Array.isArray(raw[key])) {
    note(`${key} was not a list — the default was kept.`);
    return out[key];
  }
  const clean = [];
  for (const value of raw[key]) {
    if (typeof value !== 'string') continue;
    if (!allowed.includes(value)) {
      note(`Ignored unknown ${key} entry "${value.slice(0, 20)}".`);
      continue;
    }
    if (clean.includes(value)) continue;
    if (clean.length >= cap) {
      note(`${key} was capped at ${cap} entries.`);
      break;
    }
    clean.push(value);
  }
  return clean;
}

function coerceFloat(raw, key, out, note, min, max) {
  if (raw[key] === undefined) return out[key];
  const n = Number(raw[key]);
  if (!Number.isFinite(n)) {
    note(`${key} was not a number — using ${out[key]}.`);
    return out[key];
  }
  if (n < min || n > max) note(`${key} ${n} is outside ${min}–${max} — clamped.`);
  return Math.min(max, Math.max(min, n));
}

/** Used by the settings panel's "Import JSON" action. */
function validateImportedSettings(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON: ${err.message}`], settings: null };
  }
  const migrated = migrateSettings(parsed);
  const { settings, warnings } = normalizeSettings(migrated.value === null ? parsed : migrated.value);
  return { ok: true, errors: [], settings, warnings, migratedFrom: migrated.from };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./gm.js').createGmAdapter>} deps.gm
 */
function createSettingsStore(deps) {
  const gm = deps.gm;
  let cached = cloneDefaults();
  let loadInfo = { recovered: false, warnings: [], storage: 'memory', migratedFrom: null };
  const listeners = new Set();
  let changeSubscription = null;

  function emit(reason) {
    for (const fn of listeners) {
      try {
        fn(cached, reason);
      } catch {
        /* a broken listener must not break the script */
      }
    }
  }

  async function load() {
    if (!gm.capabilities.storage) {
      // Not a recovery: nothing stored was lost or repaired, the manager simply
      // has no storage grant. Flagging it as one made the script announce
      // "Settings were repaired" on every page load. The limitation is still
      // reported — in the settings panel banner and in diagnostics().
      loadInfo = { recovered: false, warnings: ['No storage permission — settings apply to this page load only.'], storage: 'memory', migratedFrom: null };
      return cached;
    }
    let raw = null;
    let usedKey = SETTINGS_STORAGE_KEYS[0];
    let foundVersion = null;
    let sawStoredValue = false;
    for (const key of SETTINGS_STORAGE_KEYS) {
      const value = await gm.getValue(key, null);
      if (value === null || value === undefined || value === '') continue;
      sawStoredValue = true;
      usedKey = key;
      if (typeof value === 'string') {
        try {
          raw = JSON.parse(value);
        } catch {
          raw = null;
          loadInfo.warnings = [`Stored settings under "${key}" were corrupt — reset to defaults.`];
          loadInfo.recovered = true;
        }
      } else if (typeof value === 'object') {
        raw = value;
      }
      if (raw) break;
    }

    if (raw) {
      const migrated = migrateSettings(raw);
      foundVersion = migrated.from;
      const normalized = normalizeSettings(migrated.value === null ? raw : migrated.value);
      cached = normalized.settings;
      loadInfo = {
        recovered: normalized.recovered,
        warnings: [
          ...(migrated.downgraded ? [`Stored settings came from a newer version (v${foundVersion}); kept the fields this build understands.`] : []),
          ...(foundVersion !== null && foundVersion !== SETTINGS_SCHEMA_VERSION && !migrated.downgraded
            ? [`Migrated settings from schema v${foundVersion} to v${SETTINGS_SCHEMA_VERSION}.`]
            : []),
          ...normalized.warnings,
          ...loadInfo.warnings,
        ],
        storage: 'gm',
        migratedFrom: foundVersion === SETTINGS_SCHEMA_VERSION ? null : foundVersion,
      };
      // Persist the normalised form once so future loads are cheap and stable.
      await persist(cached, usedKey === SETTINGS_STORAGE_KEYS[0] ? usedKey : SETTINGS_STORAGE_KEYS[0]);
    } else if (sawStoredValue) {
      // Something was stored but is unusable; the corrupt-JSON branch above has
      // already recorded the reason.
      const normalized = normalizeSettings(null);
      cached = normalized.settings;
      loadInfo = { recovered: true, warnings: loadInfo.warnings.length ? loadInfo.warnings : normalized.warnings, storage: 'gm', migratedFrom: null };
    } else {
      // First run in this browser: nothing stored, defaults in use. That is a
      // normal state, not a recovery, and must not be reported as one.
      cached = cloneDefaults();
      loadInfo = { recovered: false, warnings: [], storage: 'gm', migratedFrom: null };
    }

    if (gm.capabilities.valueChangeSync && !changeSubscription) {
      changeSubscription = gm.onValueChanged(SETTINGS_STORAGE_KEYS[0], (_key, _old, next) => {
        if (typeof next !== 'string') return;
        let parsed = null;
        try {
          parsed = JSON.parse(next);
        } catch {
          return;
        }
        const normalized = normalizeSettings(parsed);
        cached = normalized.settings;
        emit('remote');
      });
    }
    emit('load');
    return cached;
  }

  async function persist(settings, key = SETTINGS_STORAGE_KEYS[0]) {
    if (!gm.capabilities.storage) return false;
    return gm.setValue(key, JSON.stringify(settings));
  }

  async function save(patch) {
    const merged = Object.assign({}, cached, patch || {});
    const normalized = normalizeSettings(merged);
    cached = normalized.settings;
    const ok = await persist(cached);
    emit('save');
    return { ok, settings: cached, warnings: normalized.warnings };
  }

  async function reset() {
    cached = cloneDefaults();
    const ok = await persist(cached);
    emit('reset');
    return { ok, settings: cached };
  }

  return {
    load,
    save,
    reset,
    get: () => cached,
    info: () => loadInfo,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      listeners.clear();
      if (changeSubscription) changeSubscription.dispose();
      changeSubscription = null;
    },
  };
}

/* ── src/core/source.js ───────────────────────── */
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



const TARGET_KINDS = {
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
function resolveImageTarget(element, { enableBackgroundImages = true } = {}) {
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
function firstImageUrl(cssValue) {
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

function absolutize(url, base) {
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
function isSameOrigin(url) {
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
async function acquireImage(target, { settings, gm, signal, onProgress = () => {}, timeout = 25000 } = {}) {
  if (!target) throw new ConversionError('no-target', 'No image was found at that position.');
  const progress = (stage, detail) => onProgress(stage, detail);

  // Inline SVG: serialise and rasterise. No network, no taint.
  if (target.kind === TARGET_KINDS.INLINE_SVG) {
    progress('serialising SVG');
    const objectUrl = svgElementToObjectUrl(target.element);
    try {
      const image = await loadImage(objectUrl, { timeout, crossOrigin: null });
      return acquired({
        kind: target.kind,
        url: '',
        image,
        objectUrl,
        strategy: 'inline-svg',
        mimeHint: 'image/svg+xml',
        altText: target.altText,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    } catch (err) {
      revokeObjectUrlNow(objectUrl);
      throw err;
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
    const image = await loadImage(url, { timeout });
    return acquired({
      kind: target.kind, url, image, strategy: 'data-url',
      mimeHint: dataUrlMime(url), altText: target.altText,
      width: image.naturalWidth, height: image.naturalHeight,
    });
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
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl, { timeout });
    await verifyReadable(image);
    return acquired({
      kind: target.kind, url, image, objectUrl, strategy: 'manager-fetch',
      mimeHint: fetched.mime || mimeFromUrl(url), altText: target.altText,
      width: image.naturalWidth, height: image.naturalHeight,
      bytes: fetched.bytes,
      finalUrl: fetched.finalUrl,
    });
  } catch (err) {
    revokeObjectUrlNow(objectUrl);
    throw err;
  }
}

function acquired(spec) {
  let cachedBytes = spec.bytes || null;
  return {
    kind: spec.kind,
    url: spec.url,
    image: spec.image || null,
    canvas: spec.canvas || null,
    objectUrl: spec.objectUrl || null,
    strategy: spec.strategy,
    mimeHint: spec.mimeHint || '',
    altText: spec.altText || '',
    width: spec.width || 0,
    height: spec.height || 0,
    finalUrl: spec.finalUrl || spec.url || '',
    release() {
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
  const { canvas, ctx } = createCanvas(Math.min(image.naturalWidth, 4), Math.min(image.naturalHeight, 4), { willReadFrequently: true });
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

function dataUrlMime(url) {
  const match = /^data:([^;,]+)/i.exec(url || '');
  return match ? match[1].toLowerCase() : '';
}

function mimeFromUrl(url) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const match = /\.([a-z0-9]{2,5})$/i.exec(clean);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', apng: 'image/apng' };
  return map[ext] || '';
}

function safeHost(url) {
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
function describeTarget(target) {
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

/* ── src/encoders/gif.js ───────────────────────── */
/**
 * GIF89a encoder (written from the GIF89a specification).
 *
 * Why hand-written: `canvas.toBlob(blob, 'image/gif')` returns a PNG in Chrome
 * (verified on Chrome 131 — same bytes as the PNG encode), so there is no
 * native path. Bundling a third-party encoder via @require was rejected on
 * supply-chain grounds: an unpinned remote script would run with this script's
 * permissions on every page. This file is ~350 lines, has no dependencies, and
 * is verified byte-for-byte by decoding its output with Pillow in the test
 * suite.
 *
 * What it does:
 *   - median-cut colour quantisation to ≤256 colours, shared as one global
 *     palette across all frames (a single palette keeps animated output small
 *     and avoids per-frame palette flicker),
 *   - one reserved palette entry for binary transparency (GIF has no partial
 *     alpha; pixels below the alpha threshold become fully transparent),
 *   - spec-correct LZW with variable code size, clear-code resets at 12 bits
 *     and ≤255-byte sub-blocks,
 *   - Netscape 2.0 loop extension and per-frame Graphic Control Extensions with
 *     delays clamped to the 2..65535 centisecond range browsers honour.
 *
 * Known limitations (documented in the README, not hidden):
 *   - no dithering (photos show contouring),
 *   - one global palette rather than per-frame local palettes,
 *   - full frames rather than inter-frame diffing (larger files).
 */

const ALPHA_THRESHOLD = 128;
const MAX_COLORS = 256;
const REDUCED_BITS = 5; // 5 bits/channel => at most 32768 distinct histogram entries
const REDUCED_SIZE = 1 << (REDUCED_BITS * 3);

/**
 * @param {Array<{imageData:{width:number,height:number,data:Uint8ClampedArray}, delayMs:number}>} frames
 * @param {{loop?:number, maxColors?:number, alphaThreshold?:number}} [options]
 * @returns {Uint8Array}
 */
function encodeGif(frames, options = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('encodeGif: no frames');
  const width = frames[0].imageData.width | 0;
  const height = frames[0].imageData.height | 0;
  if (width <= 0 || height <= 0) throw new Error('encodeGif: invalid dimensions');
  for (const frame of frames) {
    if (frame.imageData.width !== width || frame.imageData.height !== height) {
      throw new Error('encodeGif: all frames must share dimensions');
    }
  }

  const maxColors = Math.min(MAX_COLORS, Math.max(2, options.maxColors || MAX_COLORS));
  const alphaThreshold = options.alphaThreshold === undefined ? ALPHA_THRESHOLD : options.alphaThreshold;

  // 1. Histogram over reduced-precision colours, across every frame.
  const counts = new Int32Array(REDUCED_SIZE);
  let transparentSeen = false;
  for (const frame of frames) {
    const data = frame.imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < alphaThreshold) {
        transparentSeen = true;
        continue;
      }
      const key = reduceKey(data[i], data[i + 1], data[i + 2]);
      counts[key] += 1;
    }
  }

  const present = [];
  for (let key = 0; key < REDUCED_SIZE; key += 1) if (counts[key] > 0) present.push(key);
  if (!present.length && !transparentSeen) throw new Error('encodeGif: frame has no pixels');
  if (!present.length) present.push(reduceKey(255, 255, 255)); // fully transparent image

  // 2. Median cut.
  const budget = transparentSeen ? maxColors - 1 : maxColors;
  const boxes = medianCut(present, counts, Math.max(1, budget));
  const palette = boxes.map((box) => boxAverage(box, counts));

  // 3. Reserve the transparency index, then pad to a power of two.
  let transparentIndex = -1;
  if (transparentSeen) {
    transparentIndex = palette.length;
    palette.push([0, 0, 0]);
  }
  const tableBits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const tableSize = 1 << tableBits;
  while (palette.length < tableSize) palette.push([0, 0, 0]);

  // 4. Reduced-colour -> palette-index lookup table.
  const lut = new Uint16Array(REDUCED_SIZE);
  for (let key = 0; key < REDUCED_SIZE; key += 1) lut[key] = nearestPaletteIndex(key, palette);

  // 5. Assemble the file.
  const parts = [];
  parts.push(str('GIF89a'));
  parts.push(u16(width), u16(height));
  // packed: global colour table flag | colour resolution | sort | table size bits
  parts.push(u8(0x80 | ((tableBits - 1) << 4) | (tableBits - 1)));
  parts.push(u8(0)); // background colour index
  parts.push(u8(0)); // pixel aspect ratio
  const tableBytes = new Uint8Array(tableSize * 3);
  for (let i = 0; i < tableSize; i += 1) {
    tableBytes[i * 3] = palette[i][0];
    tableBytes[i * 3 + 1] = palette[i][1];
    tableBytes[i * 3 + 2] = palette[i][2];
  }
  parts.push(tableBytes);

  // Netscape 2.0 looping extension (0 = loop forever)
  const loop = options.loop === undefined ? 0 : options.loop;
  parts.push(u8(0x21), u8(0xff), u8(0x0b), str('NETSCAPE2.0'), u8(0x03), u8(0x01), u16(loop & 0xffff), u8(0x00));

  const minCodeSize = Math.max(2, tableBits);
  for (const frame of frames) {
    const indices = mapFrameToIndices(frame.imageData, lut, alphaThreshold, transparentIndex);
    // Graphic Control Extension: disposal method 1 (do not dispose) because we
    // always write complete frames.
    const gcePacked = (1 << 2) | (transparentIndex >= 0 ? 1 : 0);
    const delayCs = clampDelay(frame.delayMs);
    parts.push(u8(0x21), u8(0xf9), u8(0x04), u8(gcePacked), u16(delayCs), u8(transparentIndex >= 0 ? transparentIndex : 0), u8(0x00));
    // Image Descriptor
    parts.push(u8(0x2c), u16(0), u16(0), u16(width), u16(height), u8(0x00));
    parts.push(u8(minCodeSize));
    parts.push(lzwEncode(indices, minCodeSize));
    parts.push(u8(0x00)); // block terminator
  }
  parts.push(u8(0x3b)); // trailer

  return concat(parts);
}

function clampDelay(delayMs) {
  const value = Number(delayMs);
  if (!Number.isFinite(value) || value <= 0) return 10; // 100ms, a sane default
  // Browsers historically clamp delays below 2cs to 10cs, so never go lower.
  return Math.min(65535, Math.max(2, Math.round(value / 10)));
}

function reduceKey(r, g, b) {
  return ((r >> (8 - REDUCED_BITS)) << (REDUCED_BITS * 2)) | ((g >> (8 - REDUCED_BITS)) << REDUCED_BITS) | (b >> (8 - REDUCED_BITS));
}

/**
 * Expand a REDUCED_BITS channel back to 8 bits by replicating the high bits into
 * the low ones — (v << 3) | (v >> 2) for 5 bits — so that 0 maps to 0 and the
 * maximum maps to 255 instead of 248. A plain left shift would darken every
 * saturated colour, which is exactly what the reference-delta test caught.
 */
function expandChannel(value) {
  const shift = 8 - REDUCED_BITS;
  return (value << shift) | (value >> Math.max(0, REDUCED_BITS - shift));
}

function keyChannels(key) {
  const mask = (1 << REDUCED_BITS) - 1;
  return [(key >> (REDUCED_BITS * 2)) & mask, (key >> REDUCED_BITS) & mask, key & mask];
}

/** Classic median cut: repeatedly split the box with the widest channel range at its population median. */
function medianCut(keys, counts, targetBoxes) {
  let boxes = [keys.slice()];
  while (boxes.length < targetBoxes) {
    let bestIndex = -1;
    let bestRange = 0;
    let bestAxis = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.length < 2) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        const range = axisRange(box, axis);
        if (range > bestRange) {
          bestRange = range;
          bestIndex = i;
          bestAxis = axis;
        }
      }
    }
    if (bestIndex < 0 || bestRange === 0) break;
    const box = boxes[bestIndex];
    const sorted = box.slice().sort((a, b) => keyChannels(a)[bestAxis] - keyChannels(b)[bestAxis]);
    let total = 0;
    for (const key of sorted) total += counts[key];
    let running = 0;
    let splitAt = 1;
    for (let i = 0; i < sorted.length; i += 1) {
      running += counts[sorted[i]];
      if (running >= total / 2) {
        splitAt = i + 1;
        break;
      }
    }
    splitAt = Math.min(Math.max(1, splitAt), sorted.length - 1);
    boxes.splice(bestIndex, 1, sorted.slice(0, splitAt), sorted.slice(splitAt));
  }
  return boxes;
}

function axisRange(box, axis) {
  let min = 255;
  let max = 0;
  for (const key of box) {
    const value = keyChannels(key)[axis];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function boxAverage(box, counts) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const key of box) {
    const count = counts[key] || 0;
    if (!count) continue;
    const [cr, cg, cb] = keyChannels(key);
    r += expandChannel(cr) * count;
    g += expandChannel(cg) * count;
    b += expandChannel(cb) * count;
    total += count;
  }
  if (!total) {
    const [cr, cg, cb] = keyChannels(box[0]);
    return [expandChannel(cr), expandChannel(cg), expandChannel(cb)];
  }
  return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
}

/** Fill the lookup table: every reduced colour maps to its nearest palette entry. */
function nearestPaletteIndex(key, palette) {
  const [r, g, b] = keyChannels(key).map(expandChannel);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const dr = palette[i][0] - r;
    const dg = palette[i][1] - g;
    const db = palette[i][2] - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
      if (distance === 0) break;
    }
  }
  return best;
}

function mapFrameToIndices(imageData, lut, alphaThreshold, transparentIndex) {
  const data = imageData.data;
  const count = imageData.width * imageData.height;
  const out = new Uint8Array(count);
  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    if (transparentIndex >= 0 && data[i + 3] < alphaThreshold) out[p] = transparentIndex;
    else out[p] = lut[reduceKey(data[i], data[i + 1], data[i + 2])] & 0xff;
  }
  return out;
}

/**
 * GIF LZW compression. Emits variable-width codes LSB-first, packed into
 * ≤255-byte sub-blocks.
 */
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bits = [];
  let codeSize = minCodeSize + 1;
  let dictionary = new Map();
  let nextCode = eoiCode + 1;

  const writeCode = (code, size) => {
    for (let i = 0; i < size; i += 1) bits.push((code >> i) & 1);
  };

  writeCode(clearCode, codeSize);

  if (indices.length === 0) {
    writeCode(eoiCode, codeSize);
    return packBitsIntoBlocks(bits);
  }

  let current = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const next = indices[i];
    const key = (current << 8) | next;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      current = existing;
      continue;
    }
    writeCode(current, codeSize);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      // Table full at 12 bits: the format's only reset mechanism.
      writeCode(clearCode, codeSize);
      dictionary = new Map();
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    current = next;
  }
  writeCode(current, codeSize);
  writeCode(eoiCode, codeSize);
  return packBitsIntoBlocks(bits);
}

function packBitsIntoBlocks(bits) {
  const byteCount = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  const blocks = [];
  let offset = 0;
  while (offset < bytes.length) {
    const size = Math.min(255, bytes.length - offset);
    const block = new Uint8Array(size + 1);
    block[0] = size;
    block.set(bytes.subarray(offset, offset + size), 1);
    blocks.push(block);
    offset += size;
  }
  if (!blocks.length) blocks.push(new Uint8Array([0]));
  return concat(blocks);
}

/* ---- byte helpers ---- */

function u8(value) {
  return new Uint8Array([value & 0xff]);
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function str(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Estimate the raw pixel memory an animated GIF conversion would need, so the
 * caller can enforce the user's memory limit *before* decoding every frame
 * (the crash guard the original extension exposes as an option).
 */
function estimateAnimationMemory(frameCount, width, height) {
  return frameCount * width * height * 4; // RGBA
}

/**
 * Enforce an RGBA memory budget on a frame set.
 *
 * A frame *count* limit and a memory limit are different constraints: 20 small
 * frames can be cheaper than 3 huge ones. Dropping frames is preferred over
 * failing — a slightly choppy animation still saves — and the caller reports
 * exactly how many were dropped. Only a single frame that is already over the
 * budget is reported back as unrecoverable.
 *
 * @param {Array<{imageData: {width: number, height: number}}>} frames
 * @param {number} limitMB 0 (or a non-number) disables the check
 * @returns {{frames: Array, dropped: number, bytes: number, overLimitWithOneFrame: boolean}}
 */
function fitFramesToMemory(frames, limitMB) {
  const list = Array.isArray(frames) ? frames.slice() : [];
  const footprint = (items) => items.reduce((total, frame) => total + estimateAnimationMemory(1, frame.imageData.width, frame.imageData.height), 0);
  const limit = Number(limitMB);
  const limitBytes = Number.isFinite(limit) && limit > 0 ? limit * 1048576 : 0;
  if (!limitBytes || list.length === 0) {
    return { frames: list, dropped: 0, bytes: footprint(list), overLimitWithOneFrame: false };
  }
  let kept = list;
  while (kept.length > 1 && footprint(kept) > limitBytes) {
    kept = subsampleFrames(kept, kept.length - 1).frames;
  }
  return {
    frames: kept,
    dropped: list.length - kept.length,
    bytes: footprint(kept),
    overLimitWithOneFrame: kept.length === 1 && footprint(kept) > limitBytes,
  };
}

/**
 * Uniformly subsample frames when there are too many, scaling the delays so the
 * animation keeps its original total duration instead of silently speeding up.
 */
function subsampleFrames(frames, maxFrames) {
  if (frames.length <= maxFrames) return { frames, dropped: 0 };
  const keep = [];
  const stride = frames.length / maxFrames;
  for (let i = 0; i < maxFrames; i += 1) {
    const index = Math.min(frames.length - 1, Math.floor(i * stride));
    const frame = frames[index];
    const delayMs = Math.min(655350, Math.round((frame.delayMs || 100) * stride));
    keep.push(Object.assign({}, frame, { delayMs }));
  }
  return { frames: keep, dropped: frames.length - keep.length };
}

/* ── src/core/frames.js ───────────────────────── */
/**
 * Animation: detection and frame extraction.
 *
 * Two independent halves, because the honest answer differs per browser:
 *
 * 1. `detectAnimation()` parses the file's own container (GIF block walk, WebP
 *    RIFF chunks, PNG acTL/fcTL). It is pure, dependency-free and needs no
 *    browser support at all, so the script can *tell the user* "this is an
 *    animated WebP" even where frames cannot be decoded.
 *
 * 2. `decodeFrames()` uses WebCodecs `ImageDecoder`, the only browser API that
 *    exposes individual frames of an animated image. It is entirely optional and
 *    probed at runtime: `ImageDecoder` is undefined in the sandbox Chrome 131
 *    used for this project's browser tests, and older Safari/Firefox lack it
 *    too. When it is missing the caller falls back to the first frame and says
 *    so, instead of pretending an animated GIF was produced.
 *
 * Nothing here re-encodes animation the browser already decoded correctly:
 * "Original file" in the menu exists precisely so animation is never lost.
 */




/**
 * @param {Uint8Array} bytes
 * @param {string} [mimeHint]
 * @returns {{format:string, animated:boolean, frameCount:number|null, totalDelayMs:number|null}}
 */
function detectAnimation(bytes, mimeHint = '') {
  if (!bytes || bytes.length < 12) return { format: mimeHint || 'unknown', animated: false, frameCount: null, totalDelayMs: null };

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return parseGif(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return parsePng(bytes);
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return parseWebp(bytes);

  return { format: mimeHint || sniffMime(bytes) || 'unknown', animated: false, frameCount: null, totalDelayMs: null };
}

function parseGif(bytes) {
  let i = 6;
  // Logical Screen Descriptor
  if (i + 7 > bytes.length) return { format: 'image/gif', animated: false, frameCount: 0, totalDelayMs: 0 };
  const packed = bytes[i + 4];
  i += 7;
  if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1)); // global colour table

  let frames = 0;
  let totalDelay = 0;
  let pendingDelay = 0;
  while (i < bytes.length) {
    const marker = bytes[i];
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      // extension
      const label = bytes[i + 1];
      let j = i + 2;
      // GCE = 0x21 0xF9 <blockSize=4> <packed flags> <delayLo> <delayHi> <transparentIndex> <0x00>
      // `j` points at the block-size byte, so the delay is at j+2 / j+3.
      if (label === 0xf9 && bytes[j] >= 4 && j + 4 <= bytes.length) {
        const delay = bytes[j + 2] | (bytes[j + 3] << 8);
        pendingDelay = delay * 10; // centiseconds -> ms
      }
      while (j < bytes.length && bytes[j] !== 0) j += bytes[j] + 1; // skip sub-blocks
      i = j + 1;
      continue;
    }
    if (marker === 0x2c) {
      // image descriptor
      if (i + 10 > bytes.length) break;
      const descriptorPacked = bytes[i + 9];
      let j = i + 10;
      if (descriptorPacked & 0x80) j += 3 * (1 << ((descriptorPacked & 0x07) + 1)); // local colour table
      j += 1; // LZW minimum code size
      while (j < bytes.length && bytes[j] !== 0) j += bytes[j] + 1;
      i = j + 1;
      frames += 1;
      totalDelay += pendingDelay;
      pendingDelay = 0;
      continue;
    }
    break; // corrupt
  }
  return { format: 'image/gif', animated: frames > 1, frameCount: frames, totalDelayMs: totalDelay };
}

function parsePng(bytes) {
  let i = 8;
  let acTLFrames = null;
  let fcTLCount = 0;
  while (i + 8 <= bytes.length) {
    const length = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = asciiAt(bytes, i + 4, 4);
    if (type === 'acTL' && i + 12 <= bytes.length) {
      acTLFrames = (bytes[i + 8] << 24) | (bytes[i + 9] << 16) | (bytes[i + 10] << 8) | bytes[i + 11];
    } else if (type === 'fcTL') {
      fcTLCount += 1;
    } else if (type === 'IEND') {
      break;
    }
    if (!Number.isFinite(length) || length < 0 || length > bytes.length) break;
    i += 12 + length; // length + type + data + CRC
  }
  const frames = acTLFrames !== null ? acTLFrames : fcTLCount;
  return { format: 'image/png', animated: Boolean(frames && frames > 1), frameCount: frames || null, totalDelayMs: null };
}

function parseWebp(bytes) {
  let i = 12;
  let animated = false;
  let frameChunks = 0;
  while (i + 8 <= bytes.length) {
    const fourCC = asciiAt(bytes, i, 4);
    const size = (bytes[i + 4]) | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    if (fourCC === 'VP8X' && i + 12 <= bytes.length) {
      const flags = bytes[i + 8];
      animated = Boolean(flags & 0x02); // bit 1 = animation
    } else if (fourCC === 'ANMF') {
      frameChunks += 1;
      animated = true;
    } else if (fourCC === 'ANIM') {
      animated = true;
    }
    i += 8 + size + (size % 2); // chunks are padded to an even size
  }
  return {
    format: 'image/webp',
    animated: animated && frameChunks !== 1,
    frameCount: frameChunks || null,
    totalDelayMs: null,
  };
}

function sniffMime(bytes) {
  if (!bytes || bytes.length < 4) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (asciiAt(bytes, 0, 3) === 'GIF') return 'image/gif';
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return 'image/avif';
  }
  return '';
}

function asciiAt(bytes, start, length) {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** What this browser can do with animated images, probed once and cached. */
let capabilityCache = null;
/**
 * Test hook: the capability probe is memoised for the lifetime of the page (a
 * browser does not gain or lose WebCodecs mid-session), so tests that stub
 * `ImageDecoder` need a way to clear the memo. Not used by the script itself.
 */
function resetAnimationCapabilityForTest() {
  capabilityCache = null;
}

async function animationCapability() {
  if (capabilityCache) return capabilityCache;
  const result = {
    decoderAvailable: typeof ImageDecoder === 'function',
    types: {},
    reason: '',
  };
  if (!result.decoderAvailable) {
    result.reason = 'This browser has no WebCodecs ImageDecoder, so individual frames of an animated image cannot be read.';
    capabilityCache = result;
    return result;
  }
  for (const type of ['image/gif', 'image/webp', 'image/png', 'image/avif']) {
    try {
      result.types[type] = await ImageDecoder.isTypeSupported(type);
    } catch {
      result.types[type] = false;
    }
  }
  capabilityCache = result;
  return result;
}

/** ImageDecoder's `type` for a given source MIME (APNG is decoded as PNG). */
function decoderTypeFor(mime) {
  const lower = String(mime || '').toLowerCase();
  if (lower === 'image/apng') return 'image/png';
  if (['image/gif', 'image/webp', 'image/png', 'image/avif', 'image/jpeg'].includes(lower)) return lower;
  return '';
}

/**
 * Decode every frame of an animated image.
 *
 * @returns {Promise<{frames: Array<{imageData:object, delayMs:number}>, notes: string[], animated: boolean, frameCount: number}>}
 *   Resolves with `frames: []` (plus a note) when the browser cannot do it, so
 *   the caller can degrade to a single frame without inventing a failure.
 */
async function decodeFrames({ bytes, mime, maxFrames = 100, memoryLimitMB = 512, signal } = {}) {
  const notes = [];
  const capability = await animationCapability();
  const type = decoderTypeFor(mime);
  if (!capability.decoderAvailable || !type || !capability.types[type]) {
    return { frames: [], notes: [capability.reason || `This browser cannot decode ${mime || 'this format'} frame by frame.`], animated: false, frameCount: 0 };
  }

  let decoder = null;
  try {
    // ImageDecoder wants a buffer it can own (it may be detached while
    // decoding), so hand it an exact-size copy and keep the caller's bytes
    // intact — the "Original file" path still needs them. Building the copy
    // explicitly also avoids handing over a whole allocation pool when `bytes`
    // is a view with an offset (a Node Buffer, or a subarray of a larger fetch).
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    decoder = new ImageDecoder({ data: copy.buffer, type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track ? track.frameCount : 0;
    if (!frameCount || frameCount < 2) {
      return { frames: [], notes: ['The image has a single frame.'], animated: false, frameCount };
    }

    let naturalWidth = track.codedWidth || track.displayWidth || 0;
    let naturalHeight = track.codedHeight || track.displayHeight || 0;
    // Chromium reports 0x0 on a GIF track until a frame has actually been
    // decoded, so give up only after asking the decoder for the first frame.
    let probed = null;
    if (!naturalWidth || !naturalHeight) {
      const first = await decoder.decode({ frameIndex: 0 });
      probed = first.image;
      naturalWidth = probed.displayWidth || probed.codedWidth || 0;
      naturalHeight = probed.displayHeight || probed.codedHeight || 0;
    }
    if (!naturalWidth || !naturalHeight) {
      if (probed) probed.close();
      return { frames: [], notes: ['The browser could not report the frame dimensions.'], animated: false, frameCount };
    }

    // Crash guard: bound raw RGBA memory before decoding anything.
    const limitBytes = Math.max(1, memoryLimitMB) * 1024 * 1024;
    const plan = subsampleFrames(
      Array.from({ length: frameCount }, (_, i) => ({ index: i, delayMs: 0 })),
      Math.max(2, maxFrames),
    );
    let scale = 1;
    const wanted = plan.frames.length;
    const rawMemory = wanted * naturalWidth * naturalHeight * 4;
    if (rawMemory > limitBytes) {
      scale = Math.sqrt(limitBytes / rawMemory);
      notes.push(
        `Frames were scaled to ${Math.round(scale * 100)}% to stay inside your ${memoryLimitMB} MB GIF memory limit ` +
          `(${Math.round(rawMemory / 1048576)} MB needed at full size).`,
      );
    }
    if (plan.dropped > 0) {
      notes.push(`${plan.dropped} of ${frameCount} frames were skipped to respect the ${maxFrames}-frame limit; delays were stretched to keep the original duration.`);
    }

    const targetW = Math.max(1, Math.round(naturalWidth * scale));
    const targetH = Math.max(1, Math.round(naturalHeight * scale));
    const { canvas, ctx } = createCanvas(targetW, targetH, { willReadFrequently: true });
    const frames = [];
    let previousTimestamp = 0;

    for (const placeholder of plan.frames) {
      if (signal && signal.aborted) throw new ConversionError('aborted', 'Conversion cancelled.');
      let image = null;
      if (probed && placeholder.index === 0) {
        image = probed; // already decoded while measuring the frame size
        probed = null;
      } else {
        const decodedFrame = await decoder.decode({ frameIndex: placeholder.index });
        image = decodedFrame.image;
      }
      let delayMs = 0;
      if (typeof image.duration === 'number' && image.duration > 0) delayMs = image.duration / 1000; // microseconds
      else if (image.timestamp > previousTimestamp) delayMs = (image.timestamp - previousTimestamp) / 1000;
      previousTimestamp = image.timestamp || previousTimestamp;
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(image, 0, 0, targetW, targetH);
      frames.push({ imageData: canvasToImageData(canvas, ctx), delayMs: delayMs || 100 });
      image.close();
    }
    if (probed) probed.close(); // frame 0 was not part of the plan
    return { frames, notes, animated: true, frameCount, width: targetW, height: targetH };
  } catch (err) {
    if (err && err.code === 'aborted') throw err;
    notes.push(`Frame decoding failed (${err && err.message ? err.message : 'unknown error'}) — the first frame was used instead.`);
    return { frames: [], notes, animated: false, frameCount: 0 };
  } finally {
    try {
      if (decoder) decoder.close();
    } catch {
      /* noop */
    }
  }
}

/* ── src/encoders/bmp.js ───────────────────────── */
/**
 * BMP encoder (written from the Microsoft bitmap specification).
 *
 * Why hand-written: `canvas.toBlob(blob, 'image/bmp')` does not exist — Chrome
 * returns a PNG instead (verified: blob.type === "image/png", bytes identical to
 * the PNG encode). The browser extension this is ported from writes its own BMP
 * too, for the same reason.
 *
 * Two variants are produced:
 *   - 32-bit BITMAPV5HEADER with an explicit alpha mask and LCS_sRGB colour
 *     space, when the image actually contains transparency. V5 is the header
 *     that lets a BMP carry meaningful alpha (V3 32-bit alpha is ignored by
 *     several viewers).
 *   - 24-bit BITMAPINFOHEADER (V3, BI_RGB) otherwise, because it is the most
 *     universally readable BMP there is and it is 25% smaller than 32-bit.
 *
 * Rows are bottom-up and padded to a 4-byte boundary, as the format requires.
 */

const V5_HEADER_SIZE = 124;
const V3_HEADER_SIZE = 40;
const FILE_HEADER_SIZE = 14;
const BI_RGB = 0;
const BI_BITFIELDS = 3;
const LCS_SRGB = 0x73524742; // 'sRGB'
const LCS_GM_IMAGES = 4;
const PIXELS_PER_METER_72DPI = 2835;

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData RGBA pixels
 * @param {{alpha?: 'auto'|'always'|'never', hasAlpha?: boolean}} [options]
 * @returns {Uint8Array} the complete .bmp file
 */
function encodeBmp(imageData, options = {}) {
  const width = imageData.width | 0;
  const height = imageData.height | 0;
  if (width <= 0 || height <= 0) throw new Error('encodeBmp: invalid dimensions');
  const pixels = imageData.data;
  if (!pixels || pixels.length < width * height * 4) throw new Error('encodeBmp: pixel buffer too small');

  const alphaMode = options.alpha || 'auto';
  const hasAlpha = alphaMode === 'always' ? true : alphaMode === 'never' ? false : options.hasAlpha !== undefined ? options.hasAlpha : scanForAlpha(pixels);

  return hasAlpha ? encodeBmp32(imageData, width, height) : encodeBmp24(imageData, width, height);
}

function scanForAlpha(pixels) {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) return true;
  }
  return false;
}

function encodeBmp32(imageData, width, height) {
  const rowBytes = width * 4; // 32bpp rows are already 4-byte aligned
  const imageSize = rowBytes * height;
  const pixelOffset = FILE_HEADER_SIZE + V5_HEADER_SIZE;
  const fileSize = pixelOffset + imageSize;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  // BITMAPFILEHEADER
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true); // reserved
  view.setUint16(8, 0, true); // reserved
  view.setUint32(10, pixelOffset, true);

  // BITMAPV5HEADER
  let o = FILE_HEADER_SIZE;
  view.setUint32(o, V5_HEADER_SIZE, true); o += 4;
  view.setInt32(o, width, true); o += 4;
  view.setInt32(o, height, true); o += 4; // positive => bottom-up
  view.setUint16(o, 1, true); o += 2; // planes
  view.setUint16(o, 32, true); o += 2; // bit count
  view.setUint32(o, BI_BITFIELDS, true); o += 4;
  view.setUint32(o, imageSize, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setUint32(o, 0, true); o += 4; // clrUsed
  view.setUint32(o, 0, true); o += 4; // clrImportant
  view.setUint32(o, 0x00ff0000, true); o += 4; // red mask
  view.setUint32(o, 0x0000ff00, true); o += 4; // green mask
  view.setUint32(o, 0x000000ff, true); o += 4; // blue mask
  view.setUint32(o, 0xff000000, true); o += 4; // alpha mask
  view.setUint32(o, LCS_SRGB, true); o += 4;
  o += 36; // CIEXYZTRIPLE endpoints: unused for LCS_sRGB, must be zero
  view.setUint32(o, 0, true); o += 4; // gammaRed
  view.setUint32(o, 0, true); o += 4; // gammaGreen
  view.setUint32(o, 0, true); o += 4; // gammaBlue
  view.setUint32(o, LCS_GM_IMAGES, true); o += 4; // intent
  view.setUint32(o, 0, true); o += 4; // profileData
  view.setUint32(o, 0, true); o += 4; // profileSize
  view.setUint32(o, 0, true); o += 4; // reserved

  // Pixel data, bottom-up, BGRA order
  const src = imageData.data;
  let p = pixelOffset;
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * 4;
      out[p] = src[i + 2]; // B
      out[p + 1] = src[i + 1]; // G
      out[p + 2] = src[i]; // R
      out[p + 3] = src[i + 3]; // A
      p += 4;
    }
  }
  return out;
}

function encodeBmp24(imageData, width, height) {
  const rowStride = (width * 3 + 3) & ~3; // pad each row to 4 bytes
  const imageSize = rowStride * height;
  const pixelOffset = FILE_HEADER_SIZE + V3_HEADER_SIZE;
  const fileSize = pixelOffset + imageSize;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, pixelOffset, true);

  let o = FILE_HEADER_SIZE;
  view.setUint32(o, V3_HEADER_SIZE, true); o += 4;
  view.setInt32(o, width, true); o += 4;
  view.setInt32(o, height, true); o += 4;
  view.setUint16(o, 1, true); o += 2;
  view.setUint16(o, 24, true); o += 2;
  view.setUint32(o, BI_RGB, true); o += 4;
  view.setUint32(o, imageSize, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setUint32(o, 0, true); o += 4;
  view.setUint32(o, 0, true); o += 4;

  const src = imageData.data;
  let p = pixelOffset;
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowStart = y * width * 4;
    const rowEnd = p + rowStride;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * 4;
      // 24-bit BMP has no alpha: composite over white so partially transparent
      // pixels do not come out black. Callers that care flatten first.
      const a = src[i + 3] / 255;
      out[p] = Math.round(src[i + 2] * a + 255 * (1 - a)); // B
      out[p + 1] = Math.round(src[i + 1] * a + 255 * (1 - a)); // G
      out[p + 2] = Math.round(src[i] * a + 255 * (1 - a)); // R
      p += 3;
    }
    while (p < rowEnd) out[p++] = 0; // row padding
  }
  return out;
}

/** Exposed for tests: the exact header field offsets a reader must agree on. */
const BMP_LAYOUT = Object.freeze({
  FILE_HEADER_SIZE,
  V3_HEADER_SIZE,
  V5_HEADER_SIZE,
  offset24: FILE_HEADER_SIZE + V3_HEADER_SIZE,
  offset32: FILE_HEADER_SIZE + V5_HEADER_SIZE,
});

/* ── src/encoders/pdf.js ───────────────────────── */
/**
 * Minimal single-page PDF writer.
 *
 * "Save as PDF" is the one requested output that no browser API can produce, so
 * the file is assembled here directly. The image is embedded as a JPEG with the
 * DCTDecode filter, which means:
 *
 *   - no deflate/zlib implementation is needed (JPEG streams are stored as-is),
 *   - the PDF stays small (it is the same bytes the browser's own JPEG encoder
 *     produced),
 *   - every PDF reader in existence can open it (DCTDecode is PDF 1.2+).
 *
 * Transparency is flattened before encoding, because JPEG has no alpha channel.
 * The cross-reference table is written with exact byte offsets, which is the
 * part hand-rolled PDF writers usually get wrong; test/unit/pdf.test.mjs parses
 * the produced bytes back and asserts every offset, and pypdf (independent
 * implementation) opens the result.
 */

const PAGE_SIZES = {
  a4: [595.276, 841.89],
  letter: [612, 792],
};
const DEFAULT_MARGIN = 24; // points

/**
 * @param {object} input
 * @param {Uint8Array} input.jpegBytes   complete JPEG file (must start FFD8, end FFD9)
 * @param {number} input.width           image width in pixels
 * @param {number} input.height          image height in pixels
 * @param {'a4'|'letter'|'pixel'} [input.pageFit='a4']
 * @param {number} [input.margin]
 * @param {string} [input.title]
 * @returns {Uint8Array} a complete PDF file
 */
function encodePdf({ jpegBytes, width, height, pageFit = 'a4', margin = DEFAULT_MARGIN, title = '' }) {
  if (!jpegBytes || jpegBytes.length < 4) throw new Error('encodePdf: no JPEG data supplied');
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) throw new Error('encodePdf: data is not a JPEG (missing SOI marker)');
  const tail = jpegBytes.subarray(Math.max(0, jpegBytes.length - 2));
  if (tail[0] !== 0xff || tail[1] !== 0xd9) throw new Error('encodePdf: data is not a complete JPEG (missing EOI marker)');
  if (!(width > 0) || !(height > 0)) throw new Error('encodePdf: invalid image dimensions');

  const layout = pdfLayout({ width, height, pageFit, margin });
  const content = `q\n${num(layout.drawWidth)} 0 0 ${num(layout.drawHeight)} ${num(layout.x)} ${num(layout.y)} cm\n/Im0 Do\nQ\n`;
  const contentBytes = asciiBytes(content);
  const infoDate = pdfDate(new Date());

  const objects = [];
  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = asciiBytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects[3] = asciiBytes(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(layout.pageWidth)} ${num(layout.pageHeight)}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>',
  );
  objects[4] = [
    asciiBytes(
      `<< /Type /XObject /Subtype /Image /Width ${width | 0} /Height ${height | 0} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    ),
    jpegBytes,
    asciiBytes('\nendstream'),
  ];
  objects[5] = [asciiBytes(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, asciiBytes('\nendstream')];
  objects[6] = asciiBytes(
    `<< /Producer (Save Image as Type userscript) /Creator (Save Image as Type userscript)` +
      `${title ? ` /Title (${escapePdfString(title)})` : ''} /CreationDate (${infoDate}) >>`,
  );

  const chunks = [];
  const offsets = new Array(objects.length).fill(0);
  let position = 0;
  const push = (bytes) => {
    chunks.push(bytes);
    position += bytes.length;
  };

  push(asciiBytes('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = position;
    push(asciiBytes(`${i} 0 obj\n`));
    const body = objects[i];
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push(asciiBytes('\nendobj\n'));
  }

  const xrefPosition = position;
  const entries = [`0000000000 65535 f \n`];
  for (let i = 1; i < objects.length; i += 1) {
    entries.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  push(asciiBytes(`xref\n0 ${objects.length}\n${entries.join('')}`));
  push(asciiBytes(`trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`));

  return joinChunks(chunks);
}

/** Page + placement geometry, exported so tests can assert it independently. */
function pdfLayout({ width, height, pageFit = 'a4', margin = DEFAULT_MARGIN }) {
  if (pageFit === 'pixel') {
    const pageWidth = width * 0.75;
    const pageHeight = height * 0.75;
    return { pageWidth, pageHeight, drawWidth: pageWidth, drawHeight: pageHeight, x: 0, y: 0, scale: 0.75 };
  }
  const [pageWidth, pageHeight] = PAGE_SIZES[pageFit] || PAGE_SIZES.a4;
  const usableWidth = Math.max(1, pageWidth - margin * 2);
  const usableHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(usableWidth / width, usableHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    drawWidth,
    drawHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    scale,
  };
}

function num(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return String(rounded);
}

function asciiBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** PDF literal strings are limited to Latin-1; anything else is escaped or dropped. */
function escapePdfString(text) {
  return String(text)
    .replace(/[\\()]/g, (m) => `\\${m}`)
    .replace(/[^\x20-\x7e]/g, (ch) => {
      const code = ch.codePointAt(0);
      return code < 256 ? `\\${code.toString(8).padStart(3, '0')}` : '';
    })
    .slice(0, 200);
}

function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function joinChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ── src/core/errors.js ───────────────────────── */
/**
 * Small shared error type.
 *
 * Every failure this script reports to a user carries a stable `code` so the UI
 * can pick an explanation (and so tests can assert on the reason rather than on
 * prose that may be reworded). `detail` holds structured context that must never
 * be interpolated into HTML — it is only ever rendered as text.
 */

class ScriptError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ScriptError';
    this.code = String(code || 'error');
    this.detail = detail;
  }
}

/** True for anything thrown by this script with a stable code. */
function isCodedError(err) {
  return Boolean(err && typeof err.code === 'string' && err.code.length > 0);
}

/** Human text for any thrown value, never empty and never a stack trace. */
function messageOf(err, fallback = 'Something went wrong.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const text = err.message || err.reason || '';
  return typeof text === 'string' && text.trim() ? text.trim() : fallback;
}

/* ── src/core/metadata.js ───────────────────────── */
/**
 * Embedded-metadata inspection and removal.
 *
 * "Save original" currently copies the source file byte-for-byte — including
 * EXIF (camera, timestamps, sometimes GPS), XMP and ICC profiles. Users who
 * publish those files elsewhere leak that data. This module
 *
 *   1. reports what a file carries, with an explicit GPS warning, and
 *   2. removes metadata segments while leaving the image data untouched.
 *
 * Safety rules: every read is bounds-checked; malformed structures degrade to
 * "unknown" rather than throwing; XMP is treated as opaque text (never parsed
 * as XML, so entity expansion cannot be triggered); and if a container cannot be
 * walked with certainty the original bytes are returned unchanged with a note —
 * a corrupt file is worse than an un-stripped one.
 */



const EXIF_TAGS = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  copyright: 0x8298,
  gpsIfd: 0x8825,
  exifIfd: 0x8769,
};

const EXIF_IFD_TAGS = {
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  iso: 0x8827,
  focalLength35: 0xa405,
  lensModel: 0xa434,
};

const GPS_TAGS = { latitudeRef: 1, latitude: 2, longitudeRef: 3, longitude: 4, altitude: 6 };

const ORIENTATION_LABELS = Object.freeze({
  1: 'Normal',
  2: 'Mirrored horizontally',
  3: 'Rotated 180°',
  4: 'Mirrored vertically',
  5: 'Mirrored horizontally then rotated 270°',
  6: 'Rotated 90° clockwise',
  7: 'Mirrored horizontally then rotated 90°',
  8: 'Rotated 270° clockwise',
});

/** Which containers can be inspected/stripped, and which cannot (honest limits). */
const METADATA_SUPPORT = Object.freeze({
  'image/jpeg': { inspect: true, strip: true },
  'image/png': { inspect: true, strip: true },
  'image/webp': { inspect: true, strip: true },
  'image/gif': { inspect: true, strip: true },
  'image/avif': { inspect: false, strip: false },
  'image/bmp': { inspect: false, strip: false },
});

const MAX_IFD_ENTRIES = 256;
const MAX_SEGMENTS = 512;
const MAX_COMMENT_TEXT = 400;

/**
 * Inspect a file's metadata.
 *
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @returns {{supported: boolean, container: string, mime: string, findings: object[], exif: object, xmp: object, icc: object, gps: object, warnings: string[], strippable: boolean, removes: string[]}}
 */
function inspectMetadata(bytes, mime) {
  const data = metaToBytes(bytes);
  const type = String(mime || detectContainerMime(data) || '').toLowerCase();
  const support = METADATA_SUPPORT[type] || { inspect: false, strip: false };
  const base = {
    supported: support.inspect,
    container: containerOf(type),
    mime: type || 'unknown',
    findings: [],
    exif: { present: false, orientation: 0, fields: {} },
    xmp: { present: false, bytes: 0, fields: {} },
    icc: { present: false, bytes: 0 },
    gps: { present: false, lat: null, lon: null },
    warnings: [],
    strippable: support.strip,
    removes: [],
  };

  if (!data || data.length < 12) {
    base.warnings.push('The file is too small to inspect.');
    return base;
  }
  if (!support.inspect) {
    base.warnings.push(
      type
        ? `${containerOf(type)} metadata cannot be inspected by this script; nothing is claimed about it.`
        : 'The file type was not recognised, so its metadata was not inspected.',
    );
    return base;
  }

  try {
    if (type === 'image/jpeg') inspectJpeg(data, base);
    else if (type === 'image/png') inspectPng(data, base);
    else if (type === 'image/webp') inspectWebp(data, base);
    else if (type === 'image/gif') inspectGif(data, base);
  } catch (err) {
    base.warnings.push(`Inspection stopped early: ${err && err.message ? err.message : 'unreadable structure'}. What was found so far is still listed.`);
  }

  summarise(base);
  return base;
}

/**
 * Remove metadata segments from a file.
 *
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @param {{dropIcc?: boolean}} [options]
 * @returns {{bytes: Uint8Array, changed: boolean, removed: string[], notes: string[], mime: string}}
 */
function stripMetadata(bytes, mime, { dropIcc = false } = {}) {
  const data = metaToBytes(bytes);
  const type = String(mime || detectContainerMime(data) || '').toLowerCase();
  const support = METADATA_SUPPORT[type] || { inspect: false, strip: false };
  const result = { bytes: data, changed: false, removed: [], notes: [], mime: type };

  if (!data || !data.length) throw new ScriptError('metadata-empty', 'There are no file bytes to strip.');
  if (!support.strip) {
    result.notes.push(
      type
        ? `${containerOf(type)} files cannot be stripped by this script, so the original bytes were kept.`
        : 'The file type was not recognised, so the original bytes were kept.',
    );
    return result;
  }

  let out;
  try {
    if (type === 'image/jpeg') out = stripJpeg(data, { dropIcc });
    else if (type === 'image/png') out = stripPng(data, { dropIcc });
    else if (type === 'image/webp') out = stripWebp(data, { dropIcc });
    else out = stripGif(data);
  } catch (err) {
    result.notes.push(`Stripping was abandoned (${err && err.message ? err.message : 'unreadable structure'}); the original file was kept instead.`);
    return result;
  }

  if (!out || !out.bytes || !out.bytes.length) {
    result.notes.push('Stripping produced no output, so the original file was kept.');
    return result;
  }
  result.bytes = out.bytes;
  result.changed = out.bytes.length !== data.length || out.removed.length > 0;
  result.removed = out.removed;
  result.notes = out.notes || [];
  return result;
}

// ── JPEG ────────────────────────────────────────────────────────────────────

function inspectJpeg(data, out) {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new ScriptError('metadata-bad-jpeg', 'Not a JPEG (missing SOI).');
  let offset = 2;
  let segments = 0;
  while (offset + 4 <= data.length && segments < MAX_SEGMENTS) {
    segments += 1;
    if (data[offset] !== 0xff) {
      // Fill bytes are legal before a marker; anything else ends the walk.
      while (offset < data.length && data[offset] === 0xff) offset += 1;
      if (data[offset] !== 0xff) break;
    }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda) break; // start of scan: the rest is entropy-coded data
    if (offset + 2 > data.length) break;
    const length = (data[offset] << 8) | data[offset + 1];
    if (length < 2) break;
    const payloadStart = offset + 2;
    const payloadEnd = Math.min(data.length, offset + length);
    const payload = data.subarray(payloadStart, payloadEnd);
    offset = offset + length;

    if (marker === 0xe1 && startsWith(payload, 'Exif\0\0')) {
      readExif(payload.subarray(6), out, 'JPEG APP1 (EXIF)');
    } else if (marker === 0xe1 && looksLikeXmp(payload)) {
      readXmp(payload, out, 'JPEG APP1 (XMP)');
    } else if (marker === 0xe2 && startsWith(payload, 'ICC_PROFILE')) {
      out.icc = { present: true, bytes: payload.length, where: 'JPEG APP2 (ICC profile)' };
      out.findings.push({ kind: 'icc', label: 'Colour profile (ICC)', detail: `${payload.length} bytes`, where: 'APP2' });
    } else if (marker === 0xed && startsWith(payload, 'Photoshop 3.0')) {
      out.findings.push({ kind: 'iptc', label: 'IPTC / Photoshop data', detail: `${payload.length} bytes`, where: 'APP13' });
    } else if (marker === 0xfe) {
      const text = printable(payload).slice(0, MAX_COMMENT_TEXT);
      out.findings.push({ kind: 'comment', label: 'Comment', detail: text || `${payload.length} bytes`, where: 'COM' });
    } else if (marker === 0xe0) {
      out.findings.push({ kind: 'jfif', label: 'JFIF header', detail: startsWith(payload, 'JFIF') ? 'density/units only' : `${payload.length} bytes`, where: 'APP0' });
    }
  }
}

function stripJpeg(data, { dropIcc }) {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new ScriptError('metadata-bad-jpeg', 'Not a JPEG (missing SOI).');
  const kept = [data.subarray(0, 2)];
  const removed = [];
  let offset = 2;
  let segments = 0;
  let sawScan = false;

  while (offset + 4 <= data.length && segments < MAX_SEGMENTS && !sawScan) {
    segments += 1;
    while (offset < data.length && data[offset] === 0xff && data[offset + 1] === 0xff) offset += 1;
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];
    if (marker === 0xda) {
      kept.push(data.subarray(offset));
      sawScan = true;
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (data[offset + 2] << 8) | data[offset + 3];
    if (length < 2 || offset + 2 + length > data.length) throw new ScriptError('metadata-bad-jpeg', 'A JPEG segment length points outside the file.');
    const segment = data.subarray(offset, offset + 2 + length);
    const payload = data.subarray(offset + 4, offset + 2 + length);
    offset += 2 + length;

    const drop =
      (marker === 0xe1 && (startsWith(payload, 'Exif\0\0') || looksLikeXmp(payload))) ||
      (marker === 0xe3 && startsWith(payload, 'Meta\0\0')) ||
      (marker === 0xed && startsWith(payload, 'Photoshop 3.0')) ||
      (marker === 0xfe) ||
      (marker === 0xe2 && dropIcc && startsWith(payload, 'ICC_PROFILE'));

    if (drop) {
      if (marker === 0xe1 && startsWith(payload, 'Exif\0\0')) removed.push('EXIF');
      else if (marker === 0xe1) removed.push('XMP');
      else if (marker === 0xed) removed.push('IPTC');
      else if (marker === 0xfe) removed.push('comment');
      else if (marker === 0xe3) removed.push('EXIF-Meta');
      else removed.push('ICC profile');
      continue;
    }
    // APP0 (JFIF) and APP14 (Adobe colour transform) affect how the file is
    // decoded, so they are always kept.
    kept.push(segment);
  }

  if (!sawScan) throw new ScriptError('metadata-bad-jpeg', 'No image data was found after the JPEG headers.');
  const dropped = dedupeList(removed);
  // Only worth a second walk when EXIF really went: the note tells the user that
  // orientation lives in metadata, not in pixels.
  return { bytes: metaConcat(kept), removed: dropped, notes: dropped.includes('EXIF') ? jpegOrientationNote(data) : [] };
}

function jpegOrientationNote(data) {
  const info = inspectMetadata(data, 'image/jpeg');
  const orientation = info.exif.orientation;
  if (orientation && orientation !== 1) {
    return [
      `This file carries EXIF orientation ${orientation} (${ORIENTATION_LABELS[orientation] || 'rotated'}). Removing metadata does not rotate the pixels, so it may display differently. Use Transform → rotate to bake the rotation in instead.`,
    ];
  }
  return [];
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunks(data) {
  if (!startsWith(data, Uint8Array.from(PNG_SIGNATURE))) throw new ScriptError('metadata-bad-png', 'Not a PNG (bad signature).');
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= data.length && chunks.length < MAX_SEGMENTS) {
    const length = readU32BE(data, offset);
    const type = latin1(data, offset + 4, 4);
    if (length < 0 || offset + 12 + length > data.length) throw new ScriptError('metadata-bad-png', 'A PNG chunk length points outside the file.');
    chunks.push({ type, start: offset, dataStart: offset + 8, length, end: offset + 12 + length });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function inspectPng(data, out) {
  for (const chunk of pngChunks(data)) {
    const payload = data.subarray(chunk.dataStart, chunk.dataStart + chunk.length);
    if (chunk.type === 'eXIf') readExif(payload, out, 'PNG eXIf');
    else if (chunk.type === 'iCCP') {
      out.icc = { present: true, bytes: chunk.length, where: 'PNG iCCP' };
      out.findings.push({ kind: 'icc', label: 'Colour profile (ICC)', detail: `${chunk.length} bytes`, where: 'iCCP' });
    } else if (chunk.type === 'tEXt' || chunk.type === 'iTXt' || chunk.type === 'zTXt') {
      const text = printable(payload).slice(0, MAX_COMMENT_TEXT);
      if (looksLikeXmp(payload)) readXmp(payload, out, `PNG ${chunk.type} (XMP)`);
      else out.findings.push({ kind: 'text', label: `Text chunk (${chunk.type})`, detail: text || `${chunk.length} bytes`, where: chunk.type });
    } else if (chunk.type === 'tIME') {
      const when = chunk.length >= 7 ? `${readU16BE(data, chunk.dataStart)}-${pad(data[chunk.dataStart + 2])}-${pad(data[chunk.dataStart + 3])} ${pad(data[chunk.dataStart + 4])}:${pad(data[chunk.dataStart + 5])}:${pad(data[chunk.dataStart + 6])} UTC` : '';
      out.findings.push({ kind: 'time', label: 'Last-modified time', detail: when, where: 'tIME' });
    }
  }
}

function stripPng(data, { dropIcc }) {
  const chunks = pngChunks(data);
  const kept = [data.subarray(0, 8)];
  const removed = [];
  for (const chunk of chunks) {
    const drop =
      chunk.type === 'eXIf' ||
      chunk.type === 'tEXt' ||
      chunk.type === 'zTXt' ||
      chunk.type === 'iTXt' ||
      chunk.type === 'tIME' ||
      (chunk.type === 'iCCP' && dropIcc);
    if (drop) {
      if (chunk.type === 'eXIf') removed.push('EXIF');
      else if (chunk.type === 'tIME') removed.push('modification time');
      else if (chunk.type === 'iCCP') removed.push('ICC profile');
      else removed.push('text chunk');
      continue;
    }
    // sRGB/gAMA/cHRM/bKGD/pHYs and all image data are kept: they change how
    // the picture is rendered, not what is known about the photographer.
    kept.push(data.subarray(chunk.start, chunk.end));
  }
  return { bytes: metaConcat(kept), removed: dedupeList(removed), notes: [] };
}

// ── WebP ────────────────────────────────────────────────────────────────────

function riffChunks(data) {
  if (latin1(data, 0, 4) !== 'RIFF' || latin1(data, 8, 4) !== 'WEBP') {
    throw new ScriptError('metadata-bad-webp', 'Not a WebP (bad RIFF header).');
  }
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= data.length && chunks.length < MAX_SEGMENTS) {
    const fourcc = latin1(data, offset, 4);
    const size = readU32(data, offset + 4, true);
    if (size < 0 || offset + 8 + size > data.length) throw new ScriptError('metadata-bad-webp', 'A WebP chunk size points outside the file.');
    chunks.push({ fourcc, start: offset, dataStart: offset + 8, size, end: offset + 8 + size + (size % 2) });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

function inspectWebp(data, out) {
  for (const chunk of riffChunks(data)) {
    const payload = data.subarray(chunk.dataStart, chunk.dataStart + chunk.size);
    if (chunk.fourcc === 'EXIF') readExif(payload, out, 'WebP EXIF chunk');
    else if (chunk.fourcc === 'XMP ') readXmp(payload, out, 'WebP XMP chunk');
    else if (chunk.fourcc === 'ICCP') {
      out.icc = { present: true, bytes: chunk.size, where: 'WebP ICCP' };
      out.findings.push({ kind: 'icc', label: 'Colour profile (ICC)', detail: `${chunk.size} bytes`, where: 'ICCP' });
    }
  }
}

function stripWebp(data, { dropIcc }) {
  const chunks = riffChunks(data);
  const kept = [];
  const removed = [];
  for (const chunk of chunks) {
    const drop = chunk.fourcc === 'EXIF' || chunk.fourcc === 'XMP ' || (chunk.fourcc === 'ICCP' && dropIcc);
    if (drop) {
      removed.push(chunk.fourcc === 'EXIF' ? 'EXIF' : chunk.fourcc === 'XMP ' ? 'XMP' : 'ICC profile');
      continue;
    }
    kept.push(data.subarray(chunk.start, chunk.end));
  }
  const body = metaConcat(kept);
  const header = new Uint8Array(12);
  writeAscii(header, 0, 'RIFF');
  writeU32LE(header, 4, 4 + body.length);
  writeAscii(header, 8, 'WEBP');
  return { bytes: metaConcat([header, body]), removed: dedupeList(removed), notes: [] };
}

// ── GIF ─────────────────────────────────────────────────────────────────────

function gifBlocks(data) {
  if (latin1(data, 0, 3) !== 'GIF') throw new ScriptError('metadata-bad-gif', 'Not a GIF.');
  const blocks = [];
  let offset = 13;
  const flags = data[10] || 0;
  if (flags & 0x80) offset += 3 * (2 << (flags & 0x07)); // global colour table
  while (offset < data.length && blocks.length < MAX_SEGMENTS * 4) {
    const marker = data[offset];
    if (marker === 0x3b) {
      blocks.push({ kind: 'trailer', start: offset, end: offset + 1 });
      break;
    }
    if (marker === 0x21) {
      const label = data[offset + 1];
      let cursor = offset + 2;
      let payloadStart = cursor;
      let applicationId = '';
      while (cursor < data.length && data[cursor] !== 0) {
        if (label === 0xff && cursor === payloadStart) {
          applicationId = latin1(data, cursor + 1, Math.min(11, data[cursor]));
        }
        cursor += 1 + data[cursor];
      }
      cursor += 1;
      blocks.push({ kind: 'extension', label, applicationId, start: offset, end: cursor, payload: data.subarray(payloadStart, cursor - 1) });
      offset = cursor;
      continue;
    }
    if (marker === 0x2c) {
      let cursor = offset + 10;
      const flags = data[offset + 9] || 0;
      if (flags & 0x80) cursor += 3 * (2 << (flags & 0x07)); // local colour table
      while (cursor < data.length && data[cursor] !== 0) cursor += 1 + data[cursor];
      cursor += 1;
      blocks.push({ kind: 'image', start: offset, end: cursor });
      offset = cursor;
      continue;
    }
    throw new ScriptError('metadata-bad-gif', 'Unexpected byte where a GIF block should start.');
  }
  return blocks;
}

function inspectGif(data, out) {
  for (const block of gifBlocks(data)) {
    if (block.kind !== 'extension') continue;
    if (block.label === 0xfe) {
      out.findings.push({ kind: 'comment', label: 'Comment extension', detail: printable(block.payload || new Uint8Array(0)).slice(0, MAX_COMMENT_TEXT), where: 'GIF 0x21FE' });
    } else if (block.label === 0x01) {
      out.findings.push({ kind: 'text', label: 'Plain-text extension', detail: printable(block.payload || new Uint8Array(0)).slice(0, MAX_COMMENT_TEXT), where: 'GIF 0x2101' });
    } else if (block.label === 0xff) {
      const id = block.applicationId || '';
      if (/^XMP DataXMP/i.test(id)) readXmp(block.payload || new Uint8Array(0), out, 'GIF XMP application extension');
      else out.findings.push({ kind: 'app', label: 'Application extension', detail: id || `${(block.payload || []).length} bytes`, where: 'GIF 0x21FF' });
    }
  }
}

function stripGif(data) {
  const blocks = gifBlocks(data);
  const kept = [data.subarray(0, blocks.length ? blocks[0].start : data.length)];
  const removed = [];
  for (const block of blocks) {
    if (block.kind === 'extension') {
      const id = block.applicationId || '';
      if (block.label === 0xfe) {
        removed.push('comment');
        continue;
      }
      if (block.label === 0x01) {
        removed.push('plain text');
        continue;
      }
      if (block.label === 0xff && /^XMP DataXMP/i.test(id)) {
        removed.push('XMP');
        continue;
      }
    }
    kept.push(data.subarray(block.start, block.end));
  }
  return { bytes: metaConcat(kept), removed: dedupeList(removed), notes: [] };
}

// ── EXIF / XMP readers ──────────────────────────────────────────────────────

function readExif(payload, out, where) {
  out.exif.present = true;
  out.findings.push({ kind: 'exif', label: 'EXIF block', detail: `${payload.length} bytes`, where });
  let text = payload;
  if (startsWith(text, 'Exif\0\0')) text = text.subarray(6);
  const parsed = parseTiff(text);
  if (!parsed) {
    out.warnings.push('An EXIF block was present but its structure could not be read; it is still removed when stripping.');
    return;
  }
  const fields = {};
  const orientation = parsed.ifd0[EXIF_TAGS.orientation];
  if (orientation) {
    out.exif.orientation = Number(orientation) || 0;
    fields.orientation = `${out.exif.orientation} (${ORIENTATION_LABELS[out.exif.orientation] || 'unknown'})`;
  }
  for (const [key, tag] of Object.entries(EXIF_TAGS)) {
    if (['gpsIfd', 'exifIfd', 'orientation'].includes(key)) continue;
    const value = parsed.ifd0[tag];
    if (typeof value === 'string' && value.trim()) fields[key] = value.trim().slice(0, 80);
  }
  for (const [key, tag] of Object.entries(EXIF_IFD_TAGS)) {
    const value = parsed.exif[tag];
    if (value === undefined) continue;
    fields[key] = typeof value === 'string' ? value.trim().slice(0, 80) : String(value);
  }
  if (parsed.gps) {
    out.gps.present = true;
    const lat = dmsToDecimal(parsed.gps[GPS_TAGS.latitude], parsed.gps[GPS_TAGS.latitudeRef]);
    const lon = dmsToDecimal(parsed.gps[GPS_TAGS.longitude], parsed.gps[GPS_TAGS.longitudeRef]);
    out.gps.lat = lat;
    out.gps.lon = lon;
    fields.gps = lat === null && lon === null ? 'present (coordinates not readable)' : `${lat === null ? '?' : lat.toFixed(2)}, ${lon === null ? '?' : lon.toFixed(2)}`;
  }
  out.exif.fields = fields;
  for (const [key, value] of Object.entries(fields)) {
    out.findings.push({ kind: 'exif-field', label: exifFieldLabel(key), detail: String(value), where: 'EXIF' });
  }
  if (out.gps.present) {
    out.findings.push({
      kind: 'gps',
      label: 'Location (GPS)',
      detail: fields.gps || 'present',
      where: 'EXIF GPS IFD',
      sensitive: true,
    });
  }
}

function exifFieldLabel(key) {
  const labels = {
    make: 'Camera make',
    model: 'Camera model',
    software: 'Software',
    dateTime: 'Modified date',
    dateTimeOriginal: 'Original date',
    dateTimeDigitized: 'Digitized date',
    artist: 'Artist',
    copyright: 'Copyright',
    iso: 'ISO',
    focalLength35: 'Focal length (35 mm equiv.)',
    lensModel: 'Lens',
    orientation: 'Orientation',
    gps: 'GPS coordinates',
  };
  return labels[key] || key;
}

function parseTiff(data) {
  if (data.length < 8) return null;
  const byteOrder = latin1(data, 0, 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const little = byteOrder === 'II';
  const magic = readU16(data, 2, little);
  if (magic !== 42) return null;
  const ifd0Offset = readU32(data, 4, little);
  const ifd0 = readIfd(data, ifd0Offset, little);
  if (!ifd0) return null;
  const result = { ifd0, exif: {}, gps: null };
  const exifPointer = ifd0[EXIF_TAGS.exifIfd];
  if (typeof exifPointer === 'number') result.exif = readIfd(data, exifPointer, little) || {};
  const gpsPointer = ifd0[EXIF_TAGS.gpsIfd];
  if (typeof gpsPointer === 'number') result.gps = readIfd(data, gpsPointer, little) || null;
  return result;
}

function readIfd(data, offset, little) {
  if (offset < 8 || offset + 2 > data.length) return null;
  const count = readU16(data, offset, little);
  if (!count || count > MAX_IFD_ENTRIES) return null;
  const entries = {};
  for (let index = 0; index < count; index += 1) {
    const start = offset + 2 + index * 12;
    if (start + 12 > data.length) break;
    const tag = readU16(data, start, little);
    const type = readU16(data, start + 2, little);
    const valueCount = readU32(data, start + 4, little);
    const size = typeSize(type) * valueCount;
    if (!Number.isFinite(size) || size < 0 || valueCount > 4096) continue;
    const valueOffset = size <= 4 ? start + 8 : readU32(data, start + 8, little);
    if (valueOffset + size > data.length) continue;
    entries[tag] = decodeTagValue(data, valueOffset, type, valueCount, little);
  }
  return entries;
}

function decodeTagValue(data, offset, type, count, little) {
  if (type === 2) return printable(data.subarray(offset, offset + count)).replace(/\0+$/, '').trim();
  if (type === 3) return count === 1 ? readU16(data, offset, little) : arrayFrom(data, offset, count, 2, little);
  if (type === 4) return count === 1 ? readU32(data, offset, little) : arrayFrom(data, offset, count, 4, little);
  if (type === 5 || type === 10) {
    const rationals = [];
    for (let index = 0; index < Math.min(count, 4); index += 1) {
      const at = offset + index * 8;
      const numerator = readU32(data, at, little);
      const denominator = readU32(data, at + 4, little);
      rationals.push(denominator ? numerator / denominator : null);
    }
    return count === 1 ? rationals[0] : rationals;
  }
  if (type === 1 || type === 7) return count === 1 ? data[offset] : null;
  return null;
}

function arrayFrom(data, offset, count, width, little) {
  const values = [];
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    values.push(width === 2 ? readU16(data, offset + index * 2, little) : readU32(data, offset + index * 4, little));
  }
  return values;
}

function typeSize(type) {
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  return sizes[type] === undefined ? 0 : sizes[type];
}

function dmsToDecimal(value, ref) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [degrees, minutes, seconds] = value;
  if (![degrees, minutes, seconds].every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  const direction = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (direction === 'S' || direction === 'W') decimal = -decimal;
  return decimal;
}

function readXmp(payload, out, where) {
  const text = printable(payload);
  out.xmp.present = true;
  out.xmp.bytes = payload.length;
  out.xmp.where = where;
  out.findings.push({ kind: 'xmp', label: 'XMP block', detail: `${payload.length} bytes`, where });

  // Opaque-text scanning only: no XML parsing, no entity handling.
  const fields = {};
  const grab = (pattern, key, transform) => {
    const match = pattern.exec(text);
    if (match && match[1]) fields[key] = transform ? transform(match[1]) : match[1].slice(0, 80);
  };
  grab(/<(?:xmp|photoshop|xmpMM):CreatorTool>([^<]{1,120})</, 'creatorTool');
  grab(/(?:xmp|photoshop|exif):CreateDate="([^"]{1,40})"/, 'createDate');
  grab(/(?:xmp|photoshop|exif):ModifyDate="([^"]{1,40})"/, 'modifyDate');
  grab(/<dc:creator>\s*<rdf:Seq>\s*<rdf:li>([^<]{1,80})</, 'author');
  grab(/<dc:description>[\s\S]{0,200}?<rdf:li[^>]*>([^<]{1,200})</, 'description');
  if (/exif:GPS|gps:latitude|GPSLatitude/i.test(text)) {
    out.gps.present = true;
    out.findings.push({ kind: 'gps', label: 'Location (GPS in XMP)', detail: 'coordinates present', where: 'XMP', sensitive: true });
    fields.gps = 'present';
  }
  out.xmp.fields = fields;
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'gps') continue;
    out.findings.push({ kind: 'xmp-field', label: xmpFieldLabel(key), detail: String(value), where: 'XMP' });
  }
}

function xmpFieldLabel(key) {
  const labels = {
    creatorTool: 'Editing software',
    createDate: 'Created',
    modifyDate: 'Modified',
    author: 'Author',
    description: 'Description',
  };
  return labels[key] || key;
}

// ── shared helpers ──────────────────────────────────────────────────────────

function summarise(out) {
  const removes = [];
  for (const finding of out.findings) {
    if (finding.kind === 'exif' || finding.kind === 'exif-field') pushOnce(removes, 'EXIF');
    else if (finding.kind === 'xmp' || finding.kind === 'xmp-field') pushOnce(removes, 'XMP');
    else if (finding.kind === 'icc') pushOnce(removes, 'ICC profile (optional)');
    else if (finding.kind === 'iptc') pushOnce(removes, 'IPTC');
    else if (finding.kind === 'comment' || finding.kind === 'text') pushOnce(removes, 'text/comments');
    else if (finding.kind === 'time') pushOnce(removes, 'modification time');
  }
  out.removes = removes;
  if (out.gps.present) {
    out.warnings.push(
      'This file contains GPS coordinates. Anyone who receives it could work out where the photo was taken — strip metadata before sharing.',
    );
  }
  if (out.exif.orientation && out.exif.orientation !== 1) {
    out.warnings.push(
      `EXIF orientation ${out.exif.orientation} (${ORIENTATION_LABELS[out.exif.orientation] || 'rotated'}) is stored as metadata, not in the pixels. Stripping metadata will not rotate the image.`,
    );
  }
  // A JFIF/structural marker is not metadata anybody cares about, so "nothing
  // was found" is decided on the findings that actually carry information.
  if (!out.findings.some((finding) => finding.kind !== 'jfif')) {
    out.warnings.push('No EXIF, XMP, ICC or comment data was found in this file.');
  }
}

function detectContainerMime(bytes) {
  const data = metaToBytes(bytes);
  if (!data || data.length < 12) return '';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (startsWith(data, Uint8Array.from(PNG_SIGNATURE))) return 'image/png';
  if (latin1(data, 0, 4) === 'RIFF' && latin1(data, 8, 4) === 'WEBP') return 'image/webp';
  if (latin1(data, 0, 3) === 'GIF') return 'image/gif';
  if (latin1(data, 0, 2) === 'BM') return 'image/bmp';
  if (latin1(data, 4, 8) === 'ftypavif' || latin1(data, 4, 8) === 'ftypavis' || latin1(data, 4, 8) === 'ftypmif1') return 'image/avif';
  if (latin1(data, 0, 4) === '%PDF') return 'application/pdf';
  return '';
}

function containerOf(mime) {
  const names = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'image/avif': 'AVIF',
    'image/bmp': 'BMP',
    'application/pdf': 'PDF',
  };
  return names[mime] || 'Unknown';
}

function metaToBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function metaConcat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Does `data` begin with `prefix`?
 *
 * `prefix` may be a byte array or a latin1 string: every marker this module
 * looks for ('Exif\0\0', 'ICC_PROFILE', 'Photoshop 3.0', …) is written as a
 * string at the call site. Comparing a byte against a one-character string is
 * always false, so the string is converted first — a comparison that silently
 * never matches would mean EXIF is neither reported nor removed.
 */
function startsWith(data, prefix) {
  if (!data || !prefix || !prefix.length) return false;
  const expected = typeof prefix === 'string' ? latin1Bytes(prefix) : prefix;
  if (data.length < expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (data[index] !== expected[index]) return false;
  }
  return true;
}

function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function latin1(data, offset, length) {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    const byte = data[offset + index];
    if (byte === undefined) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

function writeAscii(target, offset, text) {
  for (let index = 0; index < text.length; index += 1) target[offset + index] = text.charCodeAt(index) & 0xff;
}

/**
 * Is this segment an XMP packet?
 *
 * Matched on the packet markers rather than on the Adobe namespace URI, which
 * keeps a resolvable-looking http:// constant out of the artifact. Control bytes
 * are dropped by `printable`, so UTF-16-encoded packets match too.
 */
function looksLikeXmp(bytes) {
  const text = printable(bytes && bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes || new Uint8Array(0));
  return text.includes('<?xpacket') || text.includes('<x:xmpmeta') || text.includes('XML:com.adobe.xmp') || text.includes('adobe:ns:meta/');
}

function printable(data) {
  let out = '';
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];
    if (byte === 9 || byte === 10 || byte === 13) out += ' ';
    else if (byte >= 32 && byte < 127) out += String.fromCharCode(byte);
    else if (byte >= 128) out += '?';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function readU16(data, offset, little) {
  if (offset + 2 > data.length) return 0;
  return little ? data[offset] | (data[offset + 1] << 8) : (data[offset] << 8) | data[offset + 1];
}

function readU32(data, offset, little) {
  if (offset + 4 > data.length) return 0;
  return little
    ? (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
    : ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readU32BE(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readU16BE(data, offset) {
  return (data[offset] << 8) | data[offset + 1];
}

function writeU32LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dedupeList(list) {
  const out = [];
  for (const item of list) pushOnce(out, item);
  return out;
}

function pushOnce(list, item) {
  if (!list.includes(item)) list.push(item);
}

/* ── src/core/convert.js ───────────────────────── */
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













/** Above this many pixels an alpha *probe* is done on a reduced copy. */
const ALPHA_PROBE_PIXEL_BUDGET = 8000000;

class CancelledError extends Error {
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
async function convertImage({
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
async function getOriginalBytes(acquired, { gm, settings, timeout }) {
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
function managerSupportsSubfolder(downloadMode) {
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

/* ── src/core/download.js ───────────────────────── */
/**
 * Getting the bytes onto the user's disk, and being truthful about how.
 *
 * Three documented manager behaviours shape this module:
 *
 *   - Tampermonkey rejects `GM_download` names whose extension is not on its
 *     whitelist (error `not_whitelisted`), and rejects everything when the
 *     download feature is off (`not_enabled`) or the browser permission is
 *     missing (`not_permitted`). All of these are recoverable with a plain
 *     anchor download, so we fall back and say which path ran.
 *   - `saveAs: true` only works in "browser API mode" (Tampermonkey docs). In
 *     "native" mode the manager itself just clicks an <a download>, so the
 *     dialog only appears if the *browser* is set to ask where to save.
 *   - Violentmonkey documents that GM_download names cannot contain folders or
 *     subpaths, so a sub-folder is only attempted in browser API mode.
 *
 * The returned object therefore distinguishes "saved", "saved by fallback" and
 * "save-as requested but not honoured", which is what the UI reports.
 */



const RECOVERABLE_GM_ERRORS = new Set(['not_whitelisted', 'not_enabled', 'not_permitted', 'not_supported', 'unsupported']);

/**
 * @param {object} params
 * @param {Blob} params.blob
 * @param {string} params.filename  bare file name (used by the anchor path)
 * @param {string} params.path      file name, possibly with a sub-folder (used by GM_download)
 * @param {object} params.settings
 * @param {object} params.gm
 * @param {string} params.downloadMode
 * @returns {Promise<{ok:boolean, via:'gm'|'anchor'|null, saveAsRequested:boolean, saveAsHonoured:boolean, subfolderApplied:boolean, uncertain:boolean, fallbackReason:string, message:string}>}
 */
async function saveBlob({ blob, filename, path, settings, gm, downloadMode = 'unknown' }) {
  if (!blob || !(blob.size > 0)) {
    return {
      ok: false,
      via: null,
      saveAsRequested: false,
      saveAsHonoured: false,
      subfolderApplied: false,
      uncertain: false,
      fallbackReason: 'empty-blob',
      message: 'Nothing was produced to save.',
    };
  }
  const saveAsRequested = settings.downloadBehavior === 'ask';
  const objectUrl = URL.createObjectURL(blob);
  const result = {
    ok: false,
    via: null,
    saveAsRequested,
    saveAsHonoured: false,
    // True only when the manager reported a failure we cannot classify: the file
    // may already be on disk, so a caller must never repeat the save silently.
    uncertain: false,
    subfolderApplied: Boolean(path && path !== filename),
    fallbackReason: '',
    message: '',
  };

  const canUseManager =
    gm && gm.capabilities.download && downloadMode !== 'disabled' && downloadMode !== 'unknown-disabled';

  if (canUseManager) {
    try {
      await gm.downloadBlobUrl(objectUrl, path || filename, { saveAs: saveAsRequested, timeout: 60000 });
      result.ok = true;
      result.via = 'gm';
      result.saveAsHonoured = saveAsRequested && downloadMode === 'browser';
      result.message = describeSuccess(result, downloadMode);
      revokeLater(objectUrl, 30000);
      return result;
    } catch (err) {
      const reason = (err && err.reason) || 'unknown';
      if (!RECOVERABLE_GM_ERRORS.has(reason)) {
        revokeLater(objectUrl, 1000);
        result.uncertain = true;
        result.fallbackReason = reason;
        result.message = `The download outcome was not confirmed (${reason}). Check your downloads folder before trying again; no automatic fallback was attempted because it could duplicate the file.`;
        return result;
      }
      result.fallbackReason = reason;
    }
  } else {
    result.fallbackReason = gm && !gm.capabilities.download ? 'no-grant' : `download-mode-${downloadMode}`;
  }

  // Fallback: plain anchor download in the page.
  try {
    anchorDownload(objectUrl, filename);
    result.ok = true;
    result.via = 'anchor';
    result.subfolderApplied = false;
    result.saveAsHonoured = false;
    result.message = describeSuccess(result, downloadMode);
    revokeLater(objectUrl, 30000);
    return result;
  } catch (err) {
    revokeLater(objectUrl, 1000);
    result.message = `Could not start the download (${err && err.message ? err.message : 'unknown error'}).`;
    return result;
  }
}

function describeSuccess(result, downloadMode) {
  const parts = [];
  if (result.via === 'gm') parts.push('saved through your userscript manager');
  else parts.push('saved through the browser');
  if (result.fallbackReason && result.via === 'anchor') parts.push(`manager download unavailable (${result.fallbackReason})`);
  if (result.saveAsRequested && !result.saveAsHonoured) {
    parts.push(
      downloadMode === 'browser'
        ? 'no Save As dialog was shown'
        : 'the Save As dialog only appears if your browser is set to ask where to save files',
    );
  }
  return parts.join(' · ');
}

function anchorDownload(objectUrl, filename) {
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  const host = document.documentElement || document.body;
  if (!host) throw new Error('The document has no root element to trigger the download from.');
  host.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    // Remove on the next task so browsers that read the attribute lazily still see it.
    setTimeout(() => {
      try {
        anchor.remove();
      } catch {
        /* noop */
      }
    }, 0);
  }
}

/** One-line, user-facing explanation of the manager's download mode. */
function describeDownloadCapability(gm, downloadMode) {
  if (!gm || !gm.capabilities.download) return 'GM_download not granted — the script saves through the browser instead.';
  if (downloadMode === 'browser') return 'Manager uses the browser download API: Save As dialog and sub-folders both work.';
  if (downloadMode === 'native') return 'Manager uses a native <a download> click: file names work, sub-folders and forced Save As do not.';
  if (downloadMode === 'disabled') return 'Downloads are disabled in your manager settings — the script falls back to the browser.';
  return 'Manager download mode not reported; the script tries GM_download first and falls back to the browser.';
}

/* ── src/core/scan.js ───────────────────────── */
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



const SCAN_LIMITS = Object.freeze({
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
function scanImages(root, options = {}) {
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
function parseSrcset(value, doc) {
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
function dedupeEntries(entries) {
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
function filterEntries(entries, filter = {}) {
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

function sortEntries(entries, key = 'area-desc') {
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
function summarizeInventory(entries) {
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
async function createThumbnail(entry, { size = 96, createCanvas, svgToObjectUrl, loadImage, timeout = 8000 } = {}) {
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
function observeInventory(root, onChange, { debounceMs = 400, maxNotifications = 50 } = {}) {
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
function describeEntryState(entry) {
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

/* ── src/core/queue.js ───────────────────────── */
/**
 * Job queue for batch work.
 *
 * Batch conversion is the one place where the script performs many
 * non-idempotent actions (file saves) in a row, so the states are modelled
 * explicitly rather than implied by a counter:
 *
 *   queued → running → done
 *                    → failed   (with `retryable` / `uncertain` flags)
 *                    → skipped  (never attempted: filtered out, or no source)
 *   any queued item → cancelled (a cancel never leaves work half-claimed)
 *
 * Rules that matter for correctness:
 *   - bounded concurrency, so a 500-image page cannot open 500 fetches;
 *   - per-item isolation: one failure never aborts the run;
 *   - a save whose *outcome is unknown* is never retried automatically — the
 *     user is told to check the download folder first;
 *   - `retryFailed()` only re-queues FAILED items, so a finished save can never
 *     be repeated by accident;
 *   - cancel is synchronous in intent: running items get an AbortSignal and
 *     queued items are marked cancelled immediately.
 */



const JOB_STATES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  DONE: 'done',
  CANCELLED: 'cancelled',
});

const ITEM_STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});

const QUEUE_LIMITS = Object.freeze({
  maxItems: 5000,
  maxConcurrency: 4,
  defaultConcurrency: 2,
  defaultItemTimeoutMs: 60000,
});

let itemSequence = 0;

/**
 * @param {object} params
 * @param {(item: object, helpers: {signal: AbortSignal}) => Promise<any>} params.run
 *        Performs the work for one item. Resolve with a result object, or throw.
 *        A thrown error may carry `retryable` and `uncertain` booleans.
 * @param {number} [params.concurrency]
 * @param {number} [params.itemTimeoutMs]
 * @param {number} [params.autoRetries] automatic retries, retryable errors only
 * @param {(event: object) => void} [params.onEvent]
 * @param {() => number} [params.now]
 */
function createJobQueue({
  run,
  concurrency = QUEUE_LIMITS.defaultConcurrency,
  itemTimeoutMs = QUEUE_LIMITS.defaultItemTimeoutMs,
  autoRetries = 1,
  onEvent = () => {},
  now = () => Date.now(),
  label = 'job',
} = {}) {
  if (typeof run !== 'function') throw new ScriptError('queue-no-runner', 'A job queue needs a run function.');

  const items = [];
  const byId = new Map();
  const listeners = new Set([onEvent]);
  const controllers = new Map();
  let state = JOB_STATES.IDLE;
  let startedAt = 0;
  let endedAt = 0;
  let activeWorkers = 0;
  let destroyed = false;

  const limit = Math.max(1, Math.min(QUEUE_LIMITS.maxConcurrency, Math.round(concurrency) || QUEUE_LIMITS.defaultConcurrency));
  const retries = Math.max(0, Math.min(3, Math.round(autoRetries) || 0));
  const timeoutMs = Math.max(1000, Math.min(600000, Math.round(itemTimeoutMs) || QUEUE_LIMITS.defaultItemTimeoutMs));

  const emit = (event) => {
    if (destroyed) return;
    for (const listener of listeners) {
      try {
        listener(Object.assign({ jobLabel: label, stats: stats() }, event));
      } catch {
        /* a broken listener must not break the run */
      }
    }
  };

  /**
   * Add work. Items already known by id are ignored (a re-scan of a page must
   * not enqueue the same image twice).
   *
   * @param {Array<{id?: string, label?: string, payload?: any, skipReason?: string}>} list
   */
  function add(list) {
    if (destroyed) return { added: 0, duplicates: 0, overLimit: 0 };
    const incoming = Array.isArray(list) ? list : [];
    let added = 0;
    let duplicates = 0;
    let overLimit = 0;
    for (const raw of incoming) {
      if (!raw) continue;
      const id = String(raw.id || `item-${(itemSequence += 1)}`);
      if (byId.has(id)) {
        duplicates += 1;
        continue;
      }
      if (items.length >= QUEUE_LIMITS.maxItems) {
        overLimit += 1;
        continue;
      }
      const item = {
        id,
        label: String(raw.label || id).slice(0, 160),
        payload: raw.payload,
        state: raw.skipReason ? ITEM_STATES.SKIPPED : ITEM_STATES.QUEUED,
        attempts: 0,
        autoRetries: 0,
        result: null,
        error: null,
        errorCode: '',
        retryable: false,
        uncertain: false,
        skipReason: raw.skipReason ? String(raw.skipReason).slice(0, 200) : '',
        startedAt: 0,
        endedAt: 0,
        durationMs: 0,
      };
      items.push(item);
      byId.set(id, item);
      added += 1;
    }
    if (added || duplicates || overLimit) {
      emit({ type: 'added', added, duplicates, overLimit });
    }
    return { added, duplicates, overLimit };
  }

  /**
   * Fill the free worker slots.
   *
   * Deliberately not awaited per item: the slot count is what bounds
   * concurrency, and awaiting inside the loop would serialise the run (a
   * 200-image batch at "4 at a time" would take four times as long). Each
   * worker owns its own error handling, so a rejection cannot escape here.
   */
  function pump() {
    if (destroyed) return;
    while (state === JOB_STATES.RUNNING && activeWorkers < limit) {
      const item = items.find((candidate) => candidate.state === ITEM_STATES.QUEUED);
      if (!item) break;
      activeWorkers += 1;
      item.state = ITEM_STATES.RUNNING;
      item.startedAt = now();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) controllers.set(item.id, controller);
      emit({ type: 'item-start', item: snapshot(item) });

      const releaseSlot = () => {
        controllers.delete(item.id);
        activeWorkers -= 1;
        // Take the next item as soon as a slot frees, then check for the end.
        pump();
        maybeFinish();
      };
      Promise.resolve()
        .then(() => execute(item, controller))
        .then(releaseSlot, releaseSlot);
    }
    maybeFinish();
  }

  async function execute(item, controller) {
    item.attempts += 1;
    const timer = controller && timeoutMs ? setTimeout(() => controller.abort(new ScriptError('timeout', `Timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs) : null;
    try {
      const result = await run(item, { signal: controller ? controller.signal : null, attempt: item.attempts });
      item.state = ITEM_STATES.DONE;
      item.result = result === undefined ? null : result;
      item.error = null;
      item.errorCode = '';
      item.retryable = false;
      item.uncertain = false;
    } catch (err) {
      const cancelled = Boolean(controller && controller.signal && controller.signal.aborted) && state === JOB_STATES.CANCELLED;
      const timedOut = Boolean(controller && controller.signal && controller.signal.aborted) && !cancelled;
      if (cancelled) {
        item.state = ITEM_STATES.CANCELLED;
        item.error = null;
        item.errorCode = 'cancelled';
      } else {
        item.state = ITEM_STATES.FAILED;
        item.error = err && err.message ? err.message : String(err || 'unknown error');
        // A timeout is classified here, not by the runner: the runner only knows
        // its signal fired, and reporting that as "aborted" would hide the real
        // cause (and the advice that goes with it) from the user.
        item.errorCode = timedOut ? 'timeout' : (err && err.code) || 'error';
        // An uncertain outcome means the file may already be on disk: repeating
        // it silently could create duplicates, so it is never auto-retried.
        item.uncertain = Boolean(err && (err.uncertain || item.errorCode === 'timeout'));
        item.retryable = Boolean(err && err.retryable) && !item.uncertain;
        if (item.retryable && item.autoRetries < retries && state === JOB_STATES.RUNNING) {
          item.autoRetries += 1;
          item.state = ITEM_STATES.QUEUED;
          emit({ type: 'item-retry', item: snapshot(item), reason: item.error, autoRetry: item.autoRetries });
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      item.endedAt = now();
      item.durationMs = Math.max(0, item.endedAt - (item.startedAt || item.endedAt));
      emit({ type: 'item-end', item: snapshot(item) });
    }
  }

  function maybeFinish() {
    if (state !== JOB_STATES.RUNNING) return;
    const pending = items.some((item) => item.state === ITEM_STATES.QUEUED || item.state === ITEM_STATES.RUNNING);
    if (pending || activeWorkers > 0) return;
    state = JOB_STATES.DONE;
    endedAt = now();
    emit({ type: 'finished', stats: stats() });
  }

  function start() {
    if (destroyed) return { started: false, reason: 'destroyed' };
    if (state === JOB_STATES.RUNNING) return { started: false, reason: 'already-running' };
    const hasWork = items.some((item) => item.state === ITEM_STATES.QUEUED);
    if (!hasWork) return { started: false, reason: 'no-work' };
    if (!startedAt) startedAt = now();
    state = JOB_STATES.RUNNING;
    endedAt = 0;
    emit({ type: 'started', concurrency: limit });
    try {
      pump();
    } catch (err) {
      state = JOB_STATES.DONE;
      endedAt = now();
      emit({ type: 'error', message: err && err.message ? err.message : 'The job stopped unexpectedly.' });
    }
    return { started: true };
  }

  function pause() {
    if (destroyed) return false;
    if (state !== JOB_STATES.RUNNING) return false;
    state = JOB_STATES.PAUSED;
    emit({ type: 'paused' });
    return true;
  }

  function resume() {
    if (destroyed) return false;
    if (state !== JOB_STATES.PAUSED) return false;
    state = JOB_STATES.RUNNING;
    emit({ type: 'resumed' });
    pump();
    return true;
  }

  /**
   * Stop the run. Running items are aborted and marked cancelled; queued items
   * are cancelled without being touched. Finished items keep their results.
   */
  function cancel() {
    if (destroyed) return { cancelled: 0, state };
    if (state === JOB_STATES.CANCELLED) return { cancelled: 0, state };
    const wasActive = state === JOB_STATES.RUNNING || state === JOB_STATES.PAUSED;
    state = JOB_STATES.CANCELLED;
    let cancelled = 0;
    for (const item of items) {
      if (item.state === ITEM_STATES.QUEUED) {
        item.state = ITEM_STATES.CANCELLED;
        item.endedAt = now();
        cancelled += 1;
        emit({ type: 'item-end', item: snapshot(item) });
      }
    }
    for (const controller of controllers.values()) {
      try {
        controller.abort();
      } catch {
        /* noop */
      }
    }
    endedAt = now();
    emit({ type: 'cancelled', cancelled, wasActive });
    return { cancelled, state };
  }

  /**
   * Re-queue failed items only. Done items are never touched, so a retry cannot
   * produce a second copy of a file that already saved.
   */
  function retryFailed({ includeUncertain = false } = {}) {
    if (destroyed) return 0;
    let requeued = 0;
    for (const item of items) {
      if (item.state !== ITEM_STATES.FAILED) continue;
      if (item.uncertain && !includeUncertain) continue;
      item.state = ITEM_STATES.QUEUED;
      item.error = null;
      item.errorCode = '';
      item.result = null;
      item.autoRetries = 0;
      item.endedAt = 0;
      item.durationMs = 0;
      requeued += 1;
    }
    if (requeued) {
      emit({ type: 'requeued', count: requeued });
      if (state !== JOB_STATES.RUNNING && state !== JOB_STATES.PAUSED) {
        state = JOB_STATES.IDLE;
        start();
      } else if (state === JOB_STATES.RUNNING) {
        pump();
      }
    }
    return requeued;
  }

  function stats() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0, cancelled: 0 };
    let bytes = 0;
    let uncertain = 0;
    for (const item of items) {
      counts[item.state] = (counts[item.state] || 0) + 1;
      if (item.state === ITEM_STATES.DONE && item.result && typeof item.result.bytes === 'number') bytes += item.result.bytes;
      if (item.uncertain) uncertain += 1;
    }
    const attempted = counts.done + counts.failed + counts.cancelled + counts.running;
    return {
      state,
      total: items.length,
      attempted,
      ...counts,
      bytes,
      uncertain,
      concurrency: limit,
      startedAt,
      endedAt,
      durationMs: startedAt ? (endedAt || now()) - startedAt : 0,
      complete: counts.queued === 0 && counts.running === 0 && items.length > 0,
    };
  }

  function snapshot(item) {
    return {
      id: item.id,
      label: item.label,
      state: item.state,
      attempts: item.attempts,
      autoRetries: item.autoRetries,
      error: item.error,
      errorCode: item.errorCode,
      retryable: item.retryable,
      uncertain: item.uncertain,
      skipReason: item.skipReason,
      durationMs: item.durationMs,
      result: item.result,
    };
  }

  return {
    add,
    start,
    pause,
    resume,
    cancel,
    retryFailed,
    stats,
    items: () => items.map(snapshot),
    item: (id) => (byId.has(String(id)) ? snapshot(byId.get(String(id))) : null),
    subscribe(listener) {
      if (typeof listener === 'function') listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get state() {
      return state;
    },
    get concurrency() {
      return limit;
    },
    destroy() {
      destroyed = true;
      cancel();
      listeners.clear();
      controllers.clear();
      items.length = 0;
      byId.clear();
    },
  };
}

/* ── src/encoders/zip.js ───────────────────────── */
/**
 * ZIP archive writer (store method, no compression).
 *
 * Why hand-rolled: the images this script archives are already compressed
 * (JPEG/PNG/WebP/GIF), so DEFLATE would spend CPU for ~0% saving, and a
 * dependency-free "store" archive is a few hundred bytes of well-specified
 * structure that can be verified against Python's `zipfile` in tests.
 *
 * Layout written per entry:
 *   local file header + name + raw bytes
 * then the central directory (one record per entry) and the end-of-central-
 * directory record. Names are UTF-8 with general-purpose bit 11 set, so
 * non-ASCII file names survive.
 *
 * Nothing here touches the network or the DOM.
 */




const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 — enough for store + UTF-8 names
const VERSION_MADE_BY = 0x031e; // UNIX, zip 3.0 (so mode bits are honoured)
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const EXTERNAL_ATTR_FILE = 0o644 << 16;

/** Hard bounds: an archive is built in memory, so it must stay predictable. */
const ZIP_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GB
  maxNameBytes: 200,
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the checksum ZIP requires. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * DOS time/date pair for an entry. ZIP has no timezone or sub-second field, and
 * cannot represent years before 1980, so the value is clamped rather than
 * wrapped (a wrong-but-plausible timestamp beats a corrupt archive).
 */
function dosDateTime(date) {
  const safe = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.max(1980, Math.min(2107, safe.getFullYear()));
  const month = Math.max(1, Math.min(12, safe.getMonth() + 1));
  const day = Math.max(1, Math.min(31, safe.getDate()));
  const time = (safe.getHours() << 11) | (safe.getMinutes() << 5) | (Math.floor(safe.getSeconds() / 2) & 0x1f);
  const dateField = ((year - 1980) << 9) | (month << 5) | day;
  return { time: time & 0xffff, date: dateField & 0xffff };
}

/**
 * Build an archive-safe entry name.
 *
 * Rejects absolute paths, drive letters and `..` segments (zip-slip: a reader
 * that trusts the name would write outside the target directory), collapses
 * duplicate slashes, and applies the same character sanitisation used for
 * ordinary downloads. Collisions are resolved by the caller.
 *
 * @returns {{name: string, changed: boolean}}
 */
function sanitizeEntryName(input, { maxBytes = ZIP_LIMITS.maxNameBytes } = {}) {
  const raw = typeof input === 'string' ? input : String(input == null ? '' : input);
  const trimmed = raw.replace(/\\/g, '/').trim();
  const withoutDrive = trimmed.replace(/^[A-Za-z]:/, '');
  const segments = [];
  for (const segment of withoutDrive.split('/')) {
    const clean = sanitizePathComponent(segment, { maxChars: 80 });
    if (!clean || clean === '.' || clean === '..') continue;
    segments.push(clean);
  }
  let name = segments.join('/');
  if (!name) name = 'image';
  if (zipByteLength(name) > maxBytes) name = truncateBytes(name, maxBytes);
  return { name, changed: name !== raw };
}

/**
 * Encode a list of entries into a ZIP archive.
 *
 * @param {Array<{name: string, bytes: Uint8Array|ArrayBuffer|number[], mtime?: Date}>} entries
 * @param {{comment?: string, now?: () => Date, dedupe?: boolean}} [options]
 * @returns {{bytes: Uint8Array, entries: Array<{name: string, size: number, crc: number}>, notes: string[]}}
 */
function encodeZip(entries, { comment = '', now = () => new Date(), dedupe = true } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) throw new ScriptError('zip-empty', 'Nothing to archive: the selection produced no files.');

  const notes = [];
  const prepared = [];
  const seen = new Set();
  let total = 0;

  for (const entry of list) {
    if (!entry) continue;
    const data = zipToBytes(entry.bytes);
    if (!data || !data.length) {
      notes.push(`Skipped "${shortName(entry.name)}": it had no bytes to archive.`);
      continue;
    }
    const sanitized = sanitizeEntryName(entry.name);
    let name = sanitized.name;
    if (sanitized.changed) notes.push(`Renamed "${shortName(entry.name)}" to "${name}" so it is safe inside an archive.`);
    if (seen.has(name)) {
      if (!dedupe) throw new ScriptError('zip-duplicate', `Two files would be called "${name}".`);
      name = uniqueName(name, seen);
      notes.push(`A file was already called "${name.replace(/-\d+(\.[^.\/]+)$/, '$1')}", so this one was renamed to "${name}".`);
    }
    seen.add(name);
    total += data.length;
    if (prepared.length >= ZIP_LIMITS.maxEntries) {
      notes.push(`Stopped at ${ZIP_LIMITS.maxEntries} entries; the rest were left out.`);
      break;
    }
    if (total > ZIP_LIMITS.maxTotalBytes) {
      notes.push(`Stopped after ${zipFormatBytes(total)}: the archive would exceed the ${zipFormatBytes(ZIP_LIMITS.maxTotalBytes)} in-memory limit.`);
      total -= data.length;
      break;
    }
    prepared.push({ name, data, crc: crc32(data), stamp: dosDateTime(entry.mtime || now()) });
  }

  if (!prepared.length) {
    throw new ScriptError('zip-empty', 'Nothing to archive: every selected file was empty.');
  }

  const nameBytes = prepared.map((entry) => encodeUtf8(entry.name));
  const commentBytes = encodeUtf8(String(comment || '').slice(0, 500));

  let size = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    size += 30 + nameBytes[index].length + prepared[index].data.length;
  }
  const centralOffset = size;
  for (let index = 0; index < prepared.length; index += 1) size += 46 + nameBytes[index].length;
  size += 22 + commentBytes.length;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;

  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    const name = nameBytes[index];
    const localOffset = offset;
    view.setUint32(offset, LOCAL_HEADER_SIG, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, METHOD_STORE, true);
    view.setUint16(offset + 10, entry.stamp.time, true);
    view.setUint16(offset + 12, entry.stamp.date, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, name.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;
    out.set(name, offset);
    offset += name.length;
    out.set(entry.data, offset);
    offset += entry.data.length;
    entry.localOffset = localOffset;
  }

  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    const name = nameBytes[index];
    view.setUint32(offset, CENTRAL_HEADER_SIG, true);
    view.setUint16(offset + 4, VERSION_MADE_BY, true);
    view.setUint16(offset + 6, VERSION_NEEDED, true);
    view.setUint16(offset + 8, FLAG_UTF8, true);
    view.setUint16(offset + 10, METHOD_STORE, true);
    view.setUint16(offset + 12, entry.stamp.time, true);
    view.setUint16(offset + 14, entry.stamp.date, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, name.length, true);
    view.setUint16(offset + 30, 0, true); // extra length
    view.setUint16(offset + 32, 0, true); // comment length
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, EXTERNAL_ATTR_FILE, true);
    view.setUint32(offset + 42, entry.localOffset, true);
    offset += 46;
    out.set(name, offset);
    offset += name.length;
  }

  view.setUint32(offset, EOCD_SIG, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, size - centralOffset - 22 - commentBytes.length, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, commentBytes.length, true);
  offset += 22;
  if (commentBytes.length) {
    out.set(commentBytes, offset);
    offset += commentBytes.length;
  }

  return {
    bytes: out,
    entries: prepared.map((entry) => ({ name: entry.name, size: entry.data.length, crc: entry.crc })),
    notes,
  };
}

/** Total archive size for a set of entries, without building it (for warnings). */
function estimateZipSize(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let payload = 0;
  for (const entry of list) {
    const data = zipToBytes(entry && entry.bytes);
    payload += data ? data.length : 0;
  }
  const perEntry = 30 + 46 + 40; // headers plus a typical name
  return payload + list.length * perEntry + 22;
}

function uniqueName(name, taken) {
  const dot = name.lastIndexOf('.');
  const slash = name.lastIndexOf('/');
  const hasExt = dot > slash + 1 && dot < name.length - 1;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let counter = 2; counter < 10000; counter += 1) {
    const candidate = `${stem}-${counter}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function zipToBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function encodeUtf8(text) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
  const out = [];
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

function zipByteLength(text) {
  return encodeUtf8(text).length;
}

function truncateBytes(text, maxBytes) {
  const chars = [...String(text)];
  let out = '';
  for (const char of chars) {
    if (zipByteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out || 'image';
}

function shortName(name) {
  const text = String(name == null ? '' : name);
  return text.length > 40 ? `…${text.slice(-39)}` : text;
}

function zipFormatBytes(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/* ── src/core/compare.js ───────────────────────── */
/**
 * Format comparison — "which format is actually smallest here?"
 *
 * Encodes the same pixels into several formats in memory (one acquisition, many
 * encoders) and reports size, transparency, animation and time for each, so the
 * user can pick with evidence instead of guessing. Nothing is written to disk
 * until the user chooses.
 *
 * The chooser (`pickSmallest`) is a pure function over the results, which keeps
 * the rule testable and the UI honest: it explains *why* a candidate won, and it
 * refuses to recommend a format that would silently drop transparency when the
 * source has it.
 */



const COMPARE_LIMITS = Object.freeze({
  maxCandidates: 6,
  defaultCandidates: ['png', 'jpg', 'webp'],
});

/** Formats whose encoder keeps transparency. */
const ALPHA_CAPABLE = new Set(['png', 'webp', 'gif', 'bmp', 'avif', 'original']);
/** Lossless encoders, preferred when sizes are within a hair of each other. */
const LOSSLESS = new Set(['png', 'bmp', 'original']);

/**
 * Which formats can be compared for this settings object.
 *
 * "Original file" is excluded (it copies bytes, so its size is not an encoding
 * result) and PDF is excluded by default (a page container, not an image codec),
 * but both can be requested explicitly.
 */
function comparableFormats(settings, { includePdf = false, includeOriginal = false } = {}) {
  const enabled = Array.isArray(settings && settings.formats) ? settings.formats : [];
  const out = [];
  for (const id of enabled) {
    if (!getFormat(id)) continue;
    if (id === 'pdf' && !includePdf) continue;
    if (id === 'original' && !includeOriginal) continue;
    out.push(id);
    if (out.length >= COMPARE_LIMITS.maxCandidates) break;
  }
  if (!out.length) {
    for (const id of COMPARE_LIMITS.defaultCandidates) {
      if (getFormat(id)) out.push(id);
    }
  }
  return out.slice(0, COMPARE_LIMITS.maxCandidates);
}

/**
 * Run the comparison.
 *
 * @param {object} params
 * @param {string[]} params.formatIds
 * @param {(formatId: string) => Promise<{blob: Blob, filename: string, report: object}>} params.convert
 *        Injected so this module stays testable and so the caller can reuse one
 *        acquisition for every candidate.
 * @param {AbortSignal} [params.signal]
 * @param {(stage: string, detail?: object) => void} [params.onProgress]
 * @returns {Promise<{results: object[], notes: string[], elapsedMs: number, recommended: object|null, sourceAlpha: boolean}>}
 */
async function compareFormats({ formatIds, convert, signal, onProgress = () => {}, sequential = true }) {
  const ids = (Array.isArray(formatIds) ? formatIds : []).filter((id) => getFormat(id)).slice(0, COMPARE_LIMITS.maxCandidates);
  const results = [];
  const notes = [];
  const started = Date.now();
  let sourceAlpha = false;

  if (!ids.length) {
    return { results, notes: ['No comparable formats are enabled.'], elapsedMs: 0, recommended: null, sourceAlpha };
  }
  if (typeof convert !== 'function') {
    return { results, notes: ['Comparison needs a converter; nothing was encoded.'], elapsedMs: 0, recommended: null, sourceAlpha };
  }

  const runOne = async (formatId) => {
    if (signal && signal.aborted) return { formatId, ok: false, cancelled: true };
    const format = getFormat(formatId);
    const attemptStarted = Date.now();
    onProgress(`encoding ${format.label}`, { formatId });
    try {
      const converted = await convert(formatId);
      const report = converted && converted.report ? converted.report : {};
      const bytes = Number(report.bytes) || (converted && converted.blob ? converted.blob.size : 0);
      if (!(bytes > 0)) {
        return { formatId, label: format.label, ext: format.ext, ok: false, bytes: 0, error: 'The encoder produced no data.', errorCode: 'encode-failed', ms: Date.now() - attemptStarted };
      }
      if (report.hadAlpha) sourceAlpha = true;
      return {
        formatId,
        label: format.label,
        ext: report.filename ? report.filename.split('.').pop() : format.ext,
        ok: true,
        bytes,
        sizeLabel: report.sizeLabel || `${bytes} B`,
        mime: report.mime || format.mime,
        lossless: LOSSLESS.has(formatId),
        keepsAlpha: ALPHA_CAPABLE.has(formatId),
        flattened: Boolean(report.flattened),
        animated: Boolean(report.animation && report.animation.animated),
        width: Number(report.width) || 0,
        height: Number(report.height) || 0,
        ms: Math.max(0, Date.now() - attemptStarted),
        encoderMs: Number(report.durationMs) || 0,
        notes: Array.isArray(report.notes) ? report.notes.slice(0, 3) : [],
        filename: report.filename || '',
      };
    } catch (err) {
      const cancelled = Boolean(err && err.code === 'aborted') || Boolean(signal && signal.aborted);
      return {
        formatId,
        label: format.label,
        ext: format.ext,
        ok: false,
        bytes: 0,
        cancelled,
        error: err && err.message ? err.message : 'Encoding failed.',
        errorCode: (err && err.code) || 'encode-failed',
        ms: Date.now() - attemptStarted,
      };
    }
  };

  if (sequential) {
    // One encoder at a time: comparing four formats of a 20 MP image is already
    // heavy, and parallel canvases would spike memory and stall the tab.
    for (const id of ids) {
      if (signal && signal.aborted) break;
      results.push(await runOne(id));
    }
  } else {
    results.push(...(await Promise.all(ids.map((id) => runOne(id)))));
  }

  const failed = results.filter((result) => !result.ok && !result.cancelled);
  for (const failure of failed) {
    notes.push(`${failure.label}: ${failure.error}`);
  }
  if (signal && signal.aborted) notes.push('The comparison was cancelled; the results shown are the ones that finished.');

  const recommended = pickSmallest(results, { sourceAlpha });
  return {
    results: results.filter((result) => !result.cancelled),
    notes,
    elapsedMs: Date.now() - started,
    recommended,
    sourceAlpha,
  };
}

/**
 * Choose the smallest candidate that does not lose something the source has.
 *
 * @param {object[]} results
 * @param {{sourceAlpha?: boolean, requireAlpha?: boolean, tolerance?: number}} [options]
 * @returns {{formatId: string, reason: string, savingsPercent: number}|null}
 */
function pickSmallest(results, { sourceAlpha = false, requireAlpha = false, tolerance = 0.02 } = {}) {
  const candidates = (Array.isArray(results) ? results : []).filter((result) => result && result.ok && result.bytes > 0);
  if (!candidates.length) return null;

  const needsAlpha = Boolean(requireAlpha || sourceAlpha);
  const usable = needsAlpha ? candidates.filter((result) => result.keepsAlpha && !result.flattened) : candidates;
  const pool = usable.length ? usable : candidates;

  const sorted = pool.slice().sort((a, b) => a.bytes - b.bytes);
  const best = sorted[0];
  const largest = candidates.slice().sort((a, b) => b.bytes - a.bytes)[0];
  const savingsPercent = largest && largest.bytes > best.bytes ? Math.round(((largest.bytes - best.bytes) / largest.bytes) * 100) : 0;

  // Within `tolerance` of the smallest, prefer a lossless encoder: an equal-size
  // PNG is a better default than a lossy one.
  const near = sorted.filter((result) => result.bytes <= best.bytes * (1 + tolerance));
  const losslessNear = near.find((result) => result.lossless);
  const winner = losslessNear || best;

  const reasonParts = [];
  if (winner.formatId !== best.formatId) {
    reasonParts.push(
      `${winner.label} is lossless and only ${percentDelta(winner.bytes, best.bytes)} larger than the smallest result (${best.label})`,
    );
  } else if (savingsPercent > 0) {
    reasonParts.push(`${winner.label} is ${savingsPercent}% smaller than ${largest.label}`);
  } else {
    reasonParts.push(`${winner.label} is the smallest result`);
  }
  if (needsAlpha && !usable.length) {
    reasonParts.push('every candidate flattens transparency, which this image has');
  } else if (needsAlpha) {
    reasonParts.push('transparency is preserved');
  }
  const skipped = candidates.filter((result) => needsAlpha && !result.keepsAlpha);
  if (skipped.length) reasonParts.push(`${skipped.map((result) => result.label).join('/')} cannot store transparency`);

  return { formatId: winner.formatId, reason: reasonParts.join('; '), savingsPercent, bytes: winner.bytes, label: winner.label };
}

/** Rows for the comparison dialog, in a stable display order. */
function comparisonRows(results, recommended) {
  const list = Array.isArray(results) ? results : [];
  const smallest = list.filter((result) => result.ok).sort((a, b) => a.bytes - b.bytes)[0];
  return list.map((result) => ({
    formatId: result.formatId,
    label: result.label,
    ok: Boolean(result.ok),
    sizeLabel: result.ok ? result.sizeLabel : '—',
    bytes: result.bytes || 0,
    relative: result.ok && smallest && smallest.bytes ? Math.round((result.bytes / smallest.bytes) * 100) : 0,
    alpha: result.ok ? (result.keepsAlpha && !result.flattened ? 'kept' : result.flattened ? 'flattened' : 'no transparency') : '—',
    animated: result.ok && result.animated ? 'yes' : '',
    ms: result.ms || 0,
    note: result.ok ? result.notes.join(' ') : result.error || '',
    recommended: Boolean(recommended && recommended.formatId === result.formatId),
    dimensions: result.ok && result.width ? `${result.width}×${result.height}` : '',
  }));
}

function percentDelta(a, b) {
  if (!b) return '0%';
  const delta = ((a - b) / b) * 100;
  return `${delta.toFixed(delta < 10 ? 1 : 0)}%`;
}

/* ── src/core/clipboard.js ───────────────────────── */
/**
 * Copying an image to the system clipboard.
 *
 * The Async Clipboard API is the only supported route. There is no userscript
 * `@grant` that puts *image bytes* on the clipboard (`GM_setClipboard` handles
 * text only), so this feature is genuinely browser-dependent and must degrade
 * honestly: the capability is probed, the failure reason is named, and the user
 * is told what to do instead of being shown a silent no-op.
 *
 * Known real-world constraints handled here:
 *   - a secure context is required (http:// pages that are not localhost fail);
 *   - Chromium accepts only `image/png` (plus text) in a ClipboardItem, so a
 *     JPEG/WebP copy is re-encoded to PNG — and the user is told;
 *   - the document must be focused, and the write must happen in a user gesture;
 *   - `clipboard-write` permission may be denied by policy.
 */



const CLIPBOARD_TIMEOUT_MS = 10000;

/** What this browser can do, and why not if it cannot. */
function clipboardCapability(win) {
  const target = win || (typeof window !== 'undefined' ? window : undefined);
  const reasons = [];
  if (!target) return { supported: false, secureContext: false, hasClipboard: false, hasClipboardItem: false, reasons: ['There is no window to write to.'], pngOnly: false };

  const secureContext = Boolean(target.isSecureContext);
  const navigator = target.navigator || {};
  const clipboard = navigator.clipboard || null;
  const hasWrite = Boolean(clipboard && typeof clipboard.write === 'function');
  const hasClipboardItem = typeof target.ClipboardItem === 'function';

  if (!secureContext) reasons.push('The clipboard API needs a secure context (https, or http on localhost).');
  if (!clipboard) reasons.push('This browser does not expose navigator.clipboard.');
  else if (!hasWrite) reasons.push('navigator.clipboard.write is not available.');
  if (!hasClipboardItem) reasons.push('This browser has no ClipboardItem, so image bytes cannot be handed to the clipboard.');

  return {
    supported: secureContext && hasWrite && hasClipboardItem,
    secureContext,
    hasClipboard: Boolean(clipboard),
    hasWrite,
    hasClipboardItem,
    pngOnly: true, // Chromium's documented behaviour; probed per copy below
    reasons,
  };
}

/**
 * Ask the browser whether a MIME type is accepted. `ClipboardItem.isTypeSupported`
 * is async in Chromium and missing elsewhere, so the answer is best-effort.
 */
async function mimeSupported(mime, win) {
  const target = win || (typeof window !== 'undefined' ? window : undefined);
  if (!target || typeof target.ClipboardItem !== 'function') return false;
  const probe = target.ClipboardItem.isTypeSupported;
  if (typeof probe !== 'function') return mime === 'image/png';
  try {
    const result = probe.call(target.ClipboardItem, mime);
    return Boolean(await result);
  } catch {
    return mime === 'image/png';
  }
}

/**
 * Copy image bytes to the clipboard.
 *
 * @param {object} params
 * @param {Blob} params.blob
 * @param {string} [params.mime]
 * @param {Window} [params.win]
 * @param {Document} [params.doc]
 * @param {(blob: Blob) => Promise<Blob>} [params.toPng] re-encoder used when the browser accepts PNG only
 * @returns {Promise<{ok: boolean, mime: string, method: string, converted: boolean, reason: string, message: string}>}
 */
async function copyImageToClipboard({ blob, mime = 'image/png', win, doc, toPng }) {
  const target = win || (typeof window !== 'undefined' ? window : undefined);
  const documentRef = doc || (target && target.document) || (typeof document !== 'undefined' ? document : null);
  const base = { ok: false, mime: String(mime || 'image/png'), method: 'clipboard-item', converted: false, reason: '', message: '' };

  const capability = clipboardCapability(target);
  if (!capability.supported) {
    return Object.assign(base, {
      reason: 'unsupported',
      message: `Copying images to the clipboard is not available here${capability.reasons.length ? `: ${capability.reasons[0]}` : ''}. Use "Save" instead.`,
    });
  }
  if (!blob || !(blob.size > 0)) {
    return Object.assign(base, { reason: 'empty', message: 'There is no image data to copy.' });
  }

  const permission = await permissionState(target);
  if (permission === 'denied') {
    return Object.assign(base, {
      reason: 'denied',
      message: 'Clipboard access is blocked for this site (browser permission or policy). Allow it in the address-bar site settings, or save the file instead.',
    });
  }
  if (documentRef && typeof documentRef.hasFocus === 'function' && !documentRef.hasFocus()) {
    return Object.assign(base, {
      reason: 'unfocused',
      message: 'The browser only writes to the clipboard while the page has focus. Click the page once and try again.',
    });
  }

  let payload = blob;
  let usedMime = blob.type || base.mime;
  if (!(await mimeSupported(usedMime, target))) {
    if (typeof toPng === 'function') {
      try {
        payload = await toPng(blob);
        usedMime = 'image/png';
        base.converted = true;
      } catch (err) {
        return Object.assign(base, {
          reason: 'reencode-failed',
          message: `This browser accepts only PNG on the clipboard, and re-encoding failed (${err && err.message ? err.message : 'unknown'}). Save the file instead.`,
        });
      }
    } else {
      return Object.assign(base, {
        reason: 'mime-unsupported',
        message: `This browser does not accept ${usedMime} on the clipboard (PNG only), and no re-encoder was available.`,
      });
    }
  }
  base.mime = usedMime;

  try {
    const item = new target.ClipboardItem({ [usedMime]: Promise.resolve(payload) });
    await withClipboardTimeout(target.navigator.clipboard.write([item]), CLIPBOARD_TIMEOUT_MS, 'The clipboard write timed out.');
    return Object.assign(base, {
      ok: true,
      message: base.converted
        ? `Copied to the clipboard as PNG (${clipboardFormatBytes(payload.size)}) — this browser accepts PNG only.`
        : `Copied to the clipboard (${clipboardFormatBytes(payload.size)}, ${usedMime}).`,
    });
  } catch (err) {
    return Object.assign(base, {
      reason: classifyError(err),
      message: describeFailure(err),
    });
  }
}

function classifyError(err) {
  const name = String((err && err.name) || '');
  if (name === 'NotAllowedError') return 'not-allowed';
  if (name === 'NotSupportedError') return 'mime-unsupported';
  if (name === 'SecurityError') return 'insecure';
  if (err instanceof ScriptError && err.code === 'timeout') return 'timeout';
  return 'failed';
}

function describeFailure(err) {
  const name = String((err && err.name) || '');
  if (name === 'NotAllowedError') {
    return 'The browser refused the clipboard write. It must happen right after a click or key press, and the site needs clipboard permission.';
  }
  if (name === 'NotSupportedError') {
    return 'This browser does not accept that image type on the clipboard. PNG is the only widely supported image format there.';
  }
  if (name === 'SecurityError') return 'The clipboard is blocked in this context (the page is not a secure context).';
  if (err instanceof ScriptError && err.code === 'timeout') return 'The clipboard write timed out; the browser may be busy. Save the file instead.';
  return `The clipboard write failed (${err && err.message ? err.message : 'unknown error'}).`;
}

async function permissionState(win) {
  try {
    const permissions = win.navigator && win.navigator.permissions;
    if (!permissions || typeof permissions.query !== 'function') return 'unknown';
    const status = await permissions.query({ name: 'clipboard-write' });
    return status && status.state ? String(status.state) : 'unknown';
  } catch {
    // Firefox rejects the unknown permission name; that is not a denial.
    return 'unknown';
  }
}

function withClipboardTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ScriptError('timeout', message));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function clipboardFormatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ── src/ui/menu.js ───────────────────────── */
/**
 * The right-click menu.
 *
 * Design constraint, stated plainly because it changes the product: a userscript
 * has no access to `chrome.contextMenus`, so it cannot add an entry to the
 * browser's own right-click menu. What it can do is draw one. This module draws
 * a real menu (role="menu", arrow-key navigation, Escape, focus return) at the
 * pointer position, and only when the pointer is actually over an image — every
 * other right-click is left completely alone, so the browser's native menu still
 * appears everywhere else.
 *
 * Escape hatches for users who want the native menu on an image:
 *   - hold Shift while right-clicking (always available), or
 *   - turn on "Only open with Shift held" in settings, which inverts it.
 *
 * Isolation: the menu lives in a shadow root attached to a host element with a
 * namespaced id, so page CSS cannot restyle it and it cannot restyle the page.
 * All text goes through textContent.
 */




const MENU_HOST_ID = 'siat-menu-host';
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 12;
const DOUBLE_OPEN_GUARD_MS = 700;
// A page often fires one or two `scroll` events *after* a right-click (smooth
// scrolling, `scrollIntoView`, layout settling). Dismissing on those makes the
// menu flash open and shut, so scroll-origin dismissals are ignored for a short
// grace period after opening. Resize/blur/pagehide still dismiss immediately.
const SCROLL_GRACE_MS = 150;

const MENU_STYLE = `
:host { all: initial; }
.siat-menu {
  position: fixed; z-index: 2147483647; min-width: 232px; max-width: min(90vw, 320px);
  max-height: min(72vh, 520px); overflow: auto; overscroll-behavior: contain;
  background: #ffffff; color: #16181d;
  border: 1px solid rgba(0,0,0,.14); border-radius: 11px;
  box-shadow: 0 12px 34px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.14);
  padding: 5px; margin: 0;
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}
@media (prefers-color-scheme: dark) {
  .siat-menu { background: #22252c; color: #eef1f6; border-color: rgba(255,255,255,.16); }
}
.siat-head {
  padding: 6px 9px 7px; border-bottom: 1px solid rgba(127,127,127,.25); margin-bottom: 4px;
}
.siat-head-title { font-weight: 650; font-size: 12.5px; }
.siat-head-sub { color: #5c6472; font-size: 11.5px; margin-top: 2px; word-break: break-all; }
@media (prefers-color-scheme: dark) { .siat-head-sub { color: #a7b0bf; } }
.siat-item {
  display: flex; align-items: baseline; gap: 8px; width: 100%; box-sizing: border-box;
  padding: 7px 9px; border: 0; border-radius: 8px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.siat-item:hover:not([aria-disabled="true"]), .siat-item.siat-active { background: rgba(47,111,219,.16); }
.siat-item:focus-visible { outline: 2px solid #2f6fdb; outline-offset: -2px; }
.siat-item[aria-disabled="true"] { opacity: .5; cursor: default; }
.siat-ext {
  flex: 0 0 auto; min-width: 46px; font-weight: 680; letter-spacing: .2px; font-size: 12.5px;
}
.siat-hint { flex: 1 1 auto; color: #5c6472; font-size: 11.5px; }
@media (prefers-color-scheme: dark) { .siat-hint { color: #a7b0bf; } }
.siat-sep { height: 1px; background: rgba(127,127,127,.28); margin: 4px 6px; }
.siat-foot { padding: 6px 9px 3px; color: #6b7280; font-size: 11px; }
@media (prefers-color-scheme: dark) { .siat-foot { color: #9aa3b2; } }
.siat-busy { padding: 7px 9px; font-size: 12px; color: #2f6fdb; }
.siat-cancel {
  margin: 4px 6px 2px; width: calc(100% - 12px); padding: 6px 8px; border-radius: 8px;
  border: 1px solid rgba(180,35,42,.6); background: transparent; color: #b4232a;
  font: inherit; font-size: 12px; cursor: pointer;
}
.siat-cancel:hover { background: rgba(180,35,42,.12); }
.siat-cancel:focus-visible { outline: 2px solid #b4232a; outline-offset: 1px; }
`;

/**
 * @param {object} deps
 * @param {() => object} deps.getSettings          current normalised settings
 * @param {() => Array<{id:string,label:string,ext:string,hint:string,disabled?:string}>} deps.getMenuFormats
 * @param {(formatId:string, target:object) => void} deps.onPick
 * @param {() => Array<{id:string,label:string,hint?:string,disabled?:string}>} [deps.getMenuActions]
 *        Extra actions (copy, transform, compare, inspect, picker, batch). Which ones appear is a
 *        user setting, so the menu never grows past what somebody actually uses.
 * @param {(actionId:string, target:object) => void} [deps.onAction]
 * @param {() => void} deps.onOpenSettings
 * @param {() => void} [deps.onCancel]
 * @param {() => boolean} deps.isBusy
 */
function createContextMenu(deps) {
  const doc = deps.document || document;
  let host = null;
  let shadow = null;
  let menu = null;
  let openState = null; // {target, items:[HTMLElement], index, restoreFocus}
  let lastHoveredElement = null;
  /** The format entries of the currently open menu, for digit type-ahead. */
  let openStateFormatItems = [];
  let longPressTimer = 0;
  let longPressOpenedAt = 0;
  let openedAt = 0;
  let attached = false;
  const listeners = [];

  function ensureHost() {
    if (host && host.isConnected && shadow) return;
    const existing = doc.getElementById(MENU_HOST_ID);
    if (existing && existing.shadowRoot) {
      // A previous instance — or the same script running in a second execution
      // world — left a host behind. Adopt that element instead of appending a
      // duplicate with the same id, and rebuild the internals so no stale node
      // or stylesheet is reused.
      host = existing;
      shadow = existing.shadowRoot;
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    } else {
      if (existing) existing.remove(); // a host without a shadow root is unusable
      host = doc.createElement('div');
      host.id = MENU_HOST_ID;
      host.setAttribute('data-siat', 'menu');
      shadow = host.attachShadow({ mode: 'open' });
      (doc.documentElement || doc.body).appendChild(host);
    }
    const style = doc.createElement('style');
    style.textContent = MENU_STYLE;
    shadow.appendChild(style);
    menu = doc.createElement('div');
    menu.className = 'siat-menu';
    menu.hidden = true;
    shadow.appendChild(menu);
  }

  function addListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  }

  function itemElements() {
    return openState ? openState.items : [];
  }

  function setActive(index) {
    const items = itemElements();
    if (!items.length) return;
    const next = (index + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('siat-active', i === next));
    items[next].focus();
    if (openState) openState.index = next;
  }

  /**
   * Open the menu for a resolved target at viewport coordinates.
   * @returns {boolean} whether the menu is now open
   */
  function open(target, clientX, clientY, { trigger = 'contextmenu' } = {}) {
    const settings = deps.getSettings();
    if (!target) return false;
    ensureHost();
    close({ restoreFocus: false });

    const previousFocus = doc.activeElement;
    menu.textContent = '';
    menu.hidden = false;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Save image as');
    menu.setAttribute('aria-orientation', 'vertical');

    const head = doc.createElement('div');
    head.className = 'siat-head';
    const title = doc.createElement('div');
    title.className = 'siat-head-title';
    title.textContent = `Save ${describeTarget(target).toLowerCase()} as`;
    head.appendChild(title);
    const sub = doc.createElement('div');
    sub.className = 'siat-head-sub';
    sub.textContent = describeSource(target);
    head.appendChild(sub);
    menu.appendChild(head);

    const busy = Boolean(deps.isBusy && deps.isBusy());
    const formats = deps.getMenuFormats() || [];
    const items = [];

    if (busy) {
      const busyLine = doc.createElement('div');
      busyLine.className = 'siat-busy';
      busyLine.setAttribute('role', 'status');
      busyLine.textContent = 'Still converting the previous image…';
      menu.appendChild(busyLine);
    }

    for (const entry of formats) {
      const format = getFormat(entry.id);
      if (!format) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'siat-item';
      button.setAttribute('role', 'menuitem');
      const disabled = busy || Boolean(entry.disabled);
      if (disabled) button.setAttribute('aria-disabled', 'true');
      const ext = doc.createElement('span');
      ext.className = 'siat-ext';
      ext.textContent = format.id === 'original' ? 'Original' : format.label;
      button.appendChild(ext);
      const hint = doc.createElement('span');
      hint.className = 'siat-hint';
      hint.textContent = entry.disabled || format.hint;
      button.appendChild(hint);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        const picked = openState ? openState.target : target;
        close({ restoreFocus: true });
        deps.onPick(entry.id, picked);
      });
      menu.appendChild(button);
      items.push(button);
    }

    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'siat-foot';
      empty.textContent = 'No formats are enabled. Open Settings to choose at least one.';
      menu.appendChild(empty);
    }
    // Digit type-ahead addresses the format entries specifically, so they are
    // tracked separately from the whole item list.
    openStateFormatItems = items.slice();

    const actions = (typeof deps.getMenuActions === 'function' ? deps.getMenuActions() : []) || [];
    if (actions.length) {
      const actionSeparator = doc.createElement('div');
      actionSeparator.className = 'siat-sep';
      actionSeparator.setAttribute('role', 'separator');
      menu.appendChild(actionSeparator);
      for (const action of actions) {
        if (!action || !action.id) continue;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'siat-item';
        button.setAttribute('role', 'menuitem');
        button.dataset.action = action.id;
        const actionDisabled = busy || Boolean(action.disabled);
        if (actionDisabled) button.setAttribute('aria-disabled', 'true');
        const label = doc.createElement('span');
        label.className = 'siat-ext';
        label.textContent = action.label;
        button.appendChild(label);
        const actionHint = doc.createElement('span');
        actionHint.className = 'siat-hint';
        actionHint.textContent = action.disabled || action.hint || '';
        button.appendChild(actionHint);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (actionDisabled) return;
          const picked = openState ? openState.target : target;
          close({ restoreFocus: true });
          if (typeof deps.onAction === 'function') deps.onAction(action.id, picked);
        });
        menu.appendChild(button);
        items.push(button);
      }
    }

    const separator = doc.createElement('div');
    separator.className = 'siat-sep';
    separator.setAttribute('role', 'separator');
    menu.appendChild(separator);

    const settingsButton = doc.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'siat-item';
    settingsButton.setAttribute('role', 'menuitem');
    const settingsLabel = doc.createElement('span');
    settingsLabel.className = 'siat-ext';
    settingsLabel.textContent = 'Settings';
    settingsButton.appendChild(settingsLabel);
    const settingsHint = doc.createElement('span');
    settingsHint.className = 'siat-hint';
    settingsHint.textContent = 'Formats, file names, quality, privacy';
    settingsButton.appendChild(settingsHint);
    settingsButton.addEventListener('click', (event) => {
      event.preventDefault();
      close({ restoreFocus: true });
      deps.onOpenSettings();
    });
    menu.appendChild(settingsButton);
    items.push(settingsButton);

    if (busy && deps.onCancel) {
      const cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.className = 'siat-cancel';
      cancel.textContent = 'Cancel the running conversion';
      cancel.addEventListener('click', (event) => {
        event.preventDefault();
        close({ restoreFocus: true });
        deps.onCancel();
      });
      menu.appendChild(cancel);
      items.push(cancel);
    }

    const foot = doc.createElement('div');
    foot.className = 'siat-foot';
    foot.textContent = settings.requireShift
      ? 'Release Shift to use the browser menu · 1–9 pick a format'
      : 'Shift + right-click for the browser menu · 1–9 pick a format · Esc closes';
    menu.appendChild(foot);

    openState = { target, items, index: -1, restoreFocus: previousFocus, trigger, formatItems: openStateFormatItems };
    openedAt = Date.now();
    position(clientX, clientY);
    // Focus after layout so the first item is visible and announced.
    setActive(0);
    return true;
  }

  function position(clientX, clientY) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    const vw = (doc.defaultView && doc.defaultView.innerWidth) || 1024;
    const vh = (doc.defaultView && doc.defaultView.innerHeight) || 768;
    const margin = 8;
    let x = clientX;
    let y = clientY;
    if (x + rect.width + margin > vw) x = Math.max(margin, vw - rect.width - margin);
    if (y + rect.height + margin > vh) y = Math.max(margin, clientY - rect.height);
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
  }

  function close({ restoreFocus = true } = {}) {
    if (!openState) {
      if (menu) menu.hidden = true;
      return;
    }
    const state = openState;
    openState = null;
    openStateFormatItems = [];
    if (menu) menu.hidden = true;
    if (restoreFocus && state.restoreFocus && state.restoreFocus.isConnected !== false) {
      try {
        state.restoreFocus.focus({ preventScroll: true });
      } catch {
        /* element went away */
      }
    }
  }

  function onKeyDown(event) {
    if (!openState) return;
    const items = itemElements();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close({ restoreFocus: true });
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActive(openState.index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(openState.index - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(items.length - 1);
        break;
      case 'Tab':
        // Keep focus inside the menu while it is open; Escape is the way out.
        event.preventDefault();
        setActive(openState.index + (event.shiftKey ? -1 : 1));
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const current = items[openState.index];
        if (current) current.click();
        break;
      }
      default: {
        // Type-ahead: a digit picks that format immediately, which is the whole
        // point of a keyboard workflow (right-click, "2", done).
        if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const formatItems = openState.formatItems || [];
          const wanted = formatItems[Number(event.key) - 1];
          if (wanted) {
            event.preventDefault();
            event.stopPropagation();
            setActive(formatItems.indexOf(wanted));
            wanted.click();
          }
        }
        break;
      }
    }
  }

  function onContextMenu(event) {
    const settings = deps.getSettings();
    if (!settings.interceptContextMenu) return;
    if (Date.now() - longPressOpenedAt < DOUBLE_OPEN_GUARD_MS) return; // long-press already opened it
    if (settings.requireShift ? !event.shiftKey : event.shiftKey) return; // leave the native menu alone

    const target = resolveImageTarget(event.target, { enableBackgroundImages: settings.enableBackgroundImages });
    if (!target) return;
    event.preventDefault();
    open(target, event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    const settings = deps.getSettings();
    if (!settings.interceptContextMenu || !settings.enableLongPress) return;
    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (!isTouch) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const element = event.target;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      const target = resolveImageTarget(element, { enableBackgroundImages: settings.enableBackgroundImages });
      if (!target) return;
      longPressOpenedAt = Date.now();
      open(target, startX, startY, { trigger: 'longpress' });
    }, LONG_PRESS_MS);
    // One-shot local handlers that remove themselves. These must NOT go through
    // addListener(): that array lives as long as the page, and three entries per
    // touch-down would grow without bound on a touch device.
    const release = () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onEnd);
      doc.removeEventListener('pointercancel', onEnd);
    };
    const onMove = (moveEvent) => {
      // A finger never holds perfectly still, so only a move *beyond* the
      // tolerance cancels the long press; anything smaller is ignored.
      if (moveEvent && typeof moveEvent.clientX === 'number') {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
          clearTimeout(longPressTimer);
          release();
        }
      }
    };
    const onEnd = () => {
      clearTimeout(longPressTimer);
      release();
    };
    doc.addEventListener('pointermove', onMove, { passive: true });
    doc.addEventListener('pointerup', onEnd, { once: true });
    doc.addEventListener('pointercancel', onEnd, { once: true });
  }

  function onDocumentClick(event) {
    if (!openState) return;
    if (host && event.composedPath && event.composedPath().includes(host)) return;
    close({ restoreFocus: false });
  }

  function onDismiss(event) {
    if (!openState) return;
    if (event && event.type === 'scroll' && Date.now() - openedAt < SCROLL_GRACE_MS) return;
    close({ restoreFocus: false });
  }

  function onMouseOver(event) {
    // Cheap bookkeeping so the manager menu command can act on the last image
    // the user pointed at (no layout work here, just a reference).
    lastHoveredElement = event.target;
  }

  return {
    attach() {
      // Deliberately no ensureHost() here: at document-start the document may
      // not have a root element yet. The host is created on first open().
      if (attached) return; // re-applying settings must not stack duplicate listeners
      attached = true;
      addListener(doc, 'contextmenu', onContextMenu, true);
      addListener(doc, 'keydown', onKeyDown, true);
      addListener(doc, 'click', onDocumentClick, true);
      addListener(doc, 'pointerdown', onPointerDown, true);
      addListener(doc, 'mouseover', onMouseOver, { passive: true });
      if (doc.defaultView) {
        addListener(doc.defaultView, 'resize', onDismiss);
        addListener(doc.defaultView, 'blur', onDismiss);
        addListener(doc.defaultView, 'pagehide', onDismiss);
      }
      addListener(doc, 'scroll', onDismiss, { passive: true, capture: true });
    },
    detach() {
      for (const [target, type, handler, options] of listeners) {
        try {
          target.removeEventListener(type, handler, options);
        } catch {
          /* noop */
        }
      }
      listeners.length = 0;
      attached = false;
      close({ restoreFocus: false });
    },
    destroy() {
      this.detach();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      menu = null;
    },
    open,
    close,
    get isOpen() {
      return Boolean(openState);
    },
    /** Open for the last element the pointer rested on (manager menu command). */
    openForLastHovered() {
      const settings = deps.getSettings();
      const element = lastHoveredElement;
      if (!element || element.isConnected === false) return false;
      const target = resolveImageTarget(element, { enableBackgroundImages: settings.enableBackgroundImages });
      if (!target) return false;
      const box = element.getBoundingClientRect();
      const vw = (doc.defaultView && doc.defaultView.innerWidth) || 1024;
      const vh = (doc.defaultView && doc.defaultView.innerHeight) || 768;
      const x = Math.min(Math.max(12, box.left + box.width / 2), vw - 12);
      const y = Math.min(Math.max(12, box.top + box.height / 2), vh - 12);
      return open(target, x, y, { trigger: 'menu-command' });
    },
    /**
     * The image the pointer last rested on, resolved — used by the keyboard
     * shortcuts, which have no click coordinates to work from.
     */
    hoveredTarget() {
      const settings = deps.getSettings();
      const element = lastHoveredElement;
      if (!element || element.isConnected === false) return null;
      return resolveImageTarget(element, { enableBackgroundImages: settings.enableBackgroundImages });
    },
    get shadowRoot() {
      ensureHost();
      return shadow;
    },
    get element() {
      ensureHost();
      return menu;
    },
  };
}

function describeSource(target) {
  const parts = [];
  if (target.naturalWidth && target.naturalHeight) parts.push(`${target.naturalWidth}×${target.naturalHeight}`);
  else if (target.boxWidth && target.boxHeight) parts.push(`${target.boxWidth}×${target.boxHeight} box`);
  const url = target.url || '';
  if (url) {
    if (/^data:/i.test(url)) parts.push('data: URL');
    else if (/^blob:/i.test(url)) parts.push('blob: URL');
    else {
      try {
        const parsed = new URL(url);
        const tail = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
        parts.push(`${parsed.hostname}/${tail.length > 26 ? `…${tail.slice(-25)}` : tail}`);
      } catch {
        parts.push(url.slice(0, 42));
      }
    }
  }
  if (target.altText) parts.push(`“${target.altText.slice(0, 40)}”`);
  return parts.join(' · ') || 'image';
}

/* ── src/ui/dialog.js ───────────────────────── */
/**
 * Shared modal-dialog kit.
 *
 * Every dialog this script shows (settings, image picker, transform, format
 * comparison, metadata inspector, batch confirmation, shortcut help) needs the
 * same shell: a shadow
 * root the page cannot style or read, a backdrop, role="dialog" + aria-modal, a
 * focus trap, Escape to close, focus restored to whatever had it before, and the
 * same visual language. Building that five times is how dialogs drift apart, so
 * it lives here once.
 *
 * Isolation and safety rules, inherited from the settings panel:
 *   - one host element per dialog id; a second injection adopts (removes) the
 *     previous host rather than stacking listeners;
 *   - all content is created with createElement/textContent — page-derived
 *     strings (file names, alt text, EXIF values) are never parsed as markup;
 *   - listeners are tracked and removed on close, so a dialog opened and closed
 *     fifty times leaves nothing behind.
 */

const DIALOG_STYLE = `
:host { all: initial; }
.siat-backdrop {
  position: fixed; inset: 0; z-index: 2147483646; background: rgba(10,12,18,.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.siat-dialog {
  width: min(680px, 100%); max-height: min(88vh, 780px); overflow: auto; overscroll-behavior: contain;
  background: #fff; color: #16181d; border-radius: 14px;
  border: 1px solid rgba(0,0,0,.14); box-shadow: 0 24px 60px rgba(0,0,0,.4);
  font: 13.5px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.siat-dialog[data-width="wide"] { width: min(980px, 100%); }
.siat-dialog[data-width="narrow"] { width: min(460px, 100%); }
@media (prefers-color-scheme: dark) {
  .siat-dialog { background: #1e2128; color: #edf0f6; border-color: rgba(255,255,255,.14); }
}
.siat-dialog-head {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; background: inherit; border-bottom: 1px solid rgba(127,127,127,.25);
}
.siat-dialog-titles { flex: 1 1 auto; min-width: 0; }
.siat-dialog-title { font-size: 15px; font-weight: 680; margin: 0; }
.siat-dialog-subtitle { font-size: 12px; color: #5c6472; margin: 2px 0 0; overflow-wrap: anywhere; }
@media (prefers-color-scheme: dark) { .siat-dialog-subtitle { color: #a3acbb; } }
.siat-icon-btn {
  background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 20px;
  line-height: 1; padding: 4px 8px; border-radius: 8px; flex: 0 0 auto;
}
.siat-icon-btn:hover { background: rgba(127,127,127,.18); }
.siat-icon-btn:focus-visible, .siat-field input:focus-visible, .siat-field select:focus-visible,
.siat-check:focus-visible, .siat-btn:focus-visible, .siat-radio:focus-visible,
.siat-row:focus-visible, .siat-listbox:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid #2f6fdb; outline-offset: 2px;
}
.siat-body { padding: 4px 16px 16px; }
.siat-section { border: 0; padding: 12px 0 4px; margin: 0; border-bottom: 1px solid rgba(127,127,127,.2); }
.siat-section:last-of-type { border-bottom: 0; }
.siat-legend { font-weight: 680; font-size: 13px; padding: 0; margin-bottom: 8px; }
.siat-desc { color: #5c6472; font-size: 12px; margin: -4px 0 10px; }
@media (prefers-color-scheme: dark) { .siat-desc { color: #a3acbb; } }
.siat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 6px 14px; }
.siat-check {
  display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: 8px; cursor: pointer;
}
.siat-check:hover { background: rgba(127,127,127,.1); }
.siat-check input { margin-top: 2px; flex: 0 0 auto; }
.siat-check-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.siat-check-label { font-weight: 620; }
.siat-check-hint { color: #5c6472; font-size: 11.5px; }
@media (prefers-color-scheme: dark) { .siat-check-hint { color: #a3acbb; } }
.siat-check[data-unavailable="true"] { opacity: .55; }
.siat-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.siat-field > label { font-weight: 620; font-size: 12.5px; }
.siat-field input[type="text"], .siat-field input[type="number"], .siat-field input[type="search"], .siat-field select {
  font: inherit; padding: 7px 9px; border-radius: 8px; color: inherit;
  border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.06); max-width: 320px;
}
.siat-field small { color: #5c6472; font-size: 11.5px; }
@media (prefers-color-scheme: dark) { .siat-field small { color: #a3acbb; } }
.siat-radios { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.siat-radio { display: flex; gap: 6px; align-items: center; padding: 4px 6px; border-radius: 8px; cursor: pointer; }
.siat-radio:hover { background: rgba(127,127,127,.1); }
.siat-banner {
  margin: 10px 0 0; padding: 9px 11px; border-radius: 9px; font-size: 12.5px;
  background: rgba(214,158,46,.14); border: 1px solid rgba(214,158,46,.5);
}
.siat-banner[data-kind="error"] { background: rgba(180,35,42,.14); border-color: rgba(180,35,42,.55); }
.siat-banner[data-kind="ok"] { background: rgba(26,127,55,.14); border-color: rgba(26,127,55,.5); }
.siat-banner ul { margin: 6px 0 0; padding-left: 18px; }
.siat-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.siat-table th, .siat-table td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid rgba(127,127,127,.2); }
.siat-table th { font-weight: 620; color: #5c6472; }
.siat-table td[data-num="true"] { text-align: right; font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) { .siat-table th { color: #a3acbb; } }
.siat-yes { color: #1a7f37; font-weight: 650; }
.siat-no { color: #b4232a; font-weight: 650; }
@media (prefers-color-scheme: dark) { .siat-yes { color: #56d364; } .siat-no { color: #ff8f8f; } }
.siat-foot {
  position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 12px 16px; background: inherit; border-top: 1px solid rgba(127,127,127,.25);
}
.siat-spacer { flex: 1 1 auto; }
.siat-btn {
  font: inherit; font-size: 12.5px; padding: 8px 13px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.08); color: inherit;
}
.siat-btn[data-variant="primary"] { background: #2f6fdb; border-color: #2f6fdb; color: #fff; font-weight: 620; }
.siat-btn[data-variant="danger"] { background: rgba(180,35,42,.9); border-color: rgba(180,35,42,.9); color: #fff; font-weight: 620; }
.siat-btn:hover { filter: brightness(1.06); }
.siat-btn:disabled { opacity: .5; cursor: default; filter: none; }
.siat-note { font-size: 11.5px; color: #5c6472; }
@media (prefers-color-scheme: dark) { .siat-note { color: #a3acbb; } }
.siat-live { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.siat-listbox { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow: auto; }
.siat-row {
  display: flex; gap: 10px; align-items: center; padding: 7px 8px; border-radius: 9px;
  border-bottom: 1px solid rgba(127,127,127,.16); cursor: pointer;
}
.siat-row:hover { background: rgba(127,127,127,.1); }
.siat-row[data-selected="true"] { background: rgba(47,111,219,.16); }
.siat-row-thumb {
  width: 44px; height: 44px; flex: 0 0 auto; border-radius: 6px; object-fit: contain;
  background: repeating-conic-gradient(#d9dce2 0% 25%, #f4f5f8 0% 50%) 50% / 12px 12px;
  border: 1px solid rgba(127,127,127,.3);
}
@media (prefers-color-scheme: dark) {
  .siat-row-thumb { background: repeating-conic-gradient(#2b2f37 0% 25%, #23262d 0% 50%) 50% / 12px 12px; }
}
.siat-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.siat-row-title { font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.siat-row-meta { font-size: 11.5px; color: #5c6472; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-color-scheme: dark) { .siat-row-meta { color: #a3acbb; } }
.siat-badge {
  display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 10.5px; font-weight: 650;
  background: rgba(127,127,127,.18); border: 1px solid rgba(127,127,127,.3);
}
.siat-badge[data-tone="warn"] { background: rgba(214,158,46,.2); border-color: rgba(214,158,46,.55); }
.siat-badge[data-tone="bad"] { background: rgba(180,35,42,.18); border-color: rgba(180,35,42,.5); }
.siat-badge[data-tone="good"] { background: rgba(26,127,55,.18); border-color: rgba(26,127,55,.5); }
.siat-empty { padding: 26px 12px; text-align: center; color: #5c6472; font-size: 12.5px; }
@media (prefers-color-scheme: dark) { .siat-empty { color: #a3acbb; } }
.siat-preview {
  display: flex; align-items: center; justify-content: center; gap: 12px; padding: 10px;
  background: repeating-conic-gradient(#dfe2e8 0% 25%, #f6f7f9 0% 50%) 50% / 16px 16px;
  border: 1px solid rgba(127,127,127,.3); border-radius: 10px; min-height: 120px;
}
@media (prefers-color-scheme: dark) {
  .siat-preview { background: repeating-conic-gradient(#2b2f37 0% 25%, #23262d 0% 50%) 50% / 16px 16px; }
}
.siat-preview img, .siat-preview canvas { max-width: 100%; max-height: 34vh; display: block; }
.siat-cropwrap { position: relative; display: inline-block; line-height: 0; touch-action: none; }
.siat-cropbox {
  position: absolute; border: 2px solid #2f6fdb; background: rgba(47,111,219,.14);
  box-shadow: 0 0 0 9999px rgba(10,12,18,.42); cursor: move;
}
.siat-crophandle {
  position: absolute; width: 12px; height: 12px; background: #fff; border: 1px solid #2f6fdb; border-radius: 2px;
}
@media (max-width: 520px) {
  .siat-backdrop { padding: 0; align-items: flex-end; }
  .siat-dialog { border-radius: 14px 14px 0 0; max-height: 92vh; }
}
`;

/** Create an element with class/text/attributes in one call. */
function dialogEl(doc, tag, options = {}) {
  const node = doc.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  if (options.id) node.id = options.id;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === undefined || value === null || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (value === undefined || value === null) continue;
      node.dataset[key] = String(value);
    }
  }
  if (Array.isArray(options.children)) {
    for (const child of options.children) if (child) node.appendChild(child);
  }
  return node;
}

function dialogButton(doc, label, variant, handler, options = {}) {
  const node = dialogEl(doc, 'button', { className: 'siat-btn', text: label, attrs: { type: 'button' } });
  if (variant) node.dataset.variant = variant;
  if (options.title) node.title = options.title;
  if (options.disabled) node.disabled = true;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, String(value));
  }
  if (typeof handler === 'function') node.addEventListener('click', handler);
  return node;
}

function dialogSection(doc, legendText, description) {
  const fieldset = dialogEl(doc, 'fieldset', { className: 'siat-section' });
  fieldset.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: legendText }));
  if (description) fieldset.appendChild(dialogEl(doc, 'p', { className: 'siat-desc', text: description }));
  return fieldset;
}

function dialogCheckboxRow(doc, { id, label, hint, checked, unavailable, onChange }) {
  const wrapper = dialogEl(doc, 'label', { className: 'siat-check' });
  if (unavailable) wrapper.dataset.unavailable = 'true';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  if (id) input.id = id;
  input.checked = Boolean(checked);
  if (unavailable) input.disabled = true;
  if (typeof onChange === 'function') input.addEventListener('change', () => onChange(input.checked));
  wrapper.appendChild(input);
  const text = dialogEl(doc, 'span', { className: 'siat-check-text' });
  text.appendChild(dialogEl(doc, 'span', { className: 'siat-check-label', text: label }));
  if (hint) text.appendChild(dialogEl(doc, 'span', { className: 'siat-check-hint', text: hint }));
  wrapper.appendChild(text);
  return wrapper;
}

function dialogField(doc, { id, label, hint, control }) {
  const wrapper = dialogEl(doc, 'div', { className: 'siat-field' });
  const labelEl = dialogEl(doc, 'label', { text: label, attrs: { for: id } });
  if (id) control.id = id;
  wrapper.appendChild(labelEl);
  wrapper.appendChild(control);
  if (hint) {
    const hintEl = dialogEl(doc, 'small', { text: hint, id: `${id}-hint` });
    control.setAttribute('aria-describedby', `${id}-hint`);
    wrapper.appendChild(hintEl);
  }
  return wrapper;
}

function dialogTextControl(doc, value, attrs = {}) {
  const input = doc.createElement('input');
  input.type = attrs.type || 'text';
  input.value = value === undefined || value === null ? '' : String(value);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'type') continue;
    input.setAttribute(key, String(val));
  }
  return input;
}

function dialogSelectControl(doc, options, value, onChange) {
  const select = doc.createElement('select');
  for (const option of options) {
    const node = dialogEl(doc, 'option', { text: option.label, attrs: { value: option.value } });
    if (option.disabled) node.disabled = true;
    if (String(option.value) === String(value)) node.selected = true;
    select.appendChild(node);
  }
  if (typeof onChange === 'function') select.addEventListener('change', () => onChange(select.value));
  return select;
}

/**
 * A table built from plain strings. Rows are arrays of cells; a cell may be a
 * string or `{text, className, num}`. Never accepts HTML.
 */
function dialogTable(doc, { head, rows, emptyText = 'Nothing to show.', caption }) {
  const table = dialogEl(doc, 'table', { className: 'siat-table' });
  if (caption) table.appendChild(dialogEl(doc, 'caption', { className: 'siat-live', text: caption }));
  if (Array.isArray(head) && head.length) {
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    for (const cell of head) {
      headRow.appendChild(dialogEl(doc, 'th', { text: cell && cell.scope ? cell.label : cell, attrs: { scope: 'col' } }));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
  }
  const tbody = doc.createElement('tbody');
  if (!rows || !rows.length) {
    const tr = doc.createElement('tr');
    const td = dialogEl(doc, 'td', { className: 'siat-empty', text: emptyText, attrs: { colspan: Math.max(1, (head || []).length) } });
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = doc.createElement('tr');
      for (const cell of row) {
        const spec = typeof cell === 'object' && cell !== null ? cell : { text: cell };
        const td = dialogEl(doc, 'td', { text: spec.text === undefined || spec.text === null ? '' : String(spec.text), className: spec.className });
        if (spec.num) td.dataset.num = 'true';
        if (spec.attrs) {
          for (const [key, value] of Object.entries(spec.attrs)) td.setAttribute(key, String(value));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  return table;
}

/**
 * Build (or rebuild) a dialog shell.
 *
 * `build` runs on every open, so a dialog always reflects current state instead
 * of a stale snapshot; listeners registered through the returned `on` are torn
 * down on close.
 */
function createDialog(options = {}) {
  const doc = options.document || document;
  const hostId = options.hostId || 'siat-dialog-host';
  const marker = options.marker || 'dialog';
  const titleId = options.titleId || `${hostId}-title`;
  const describedId = options.describedBy || '';

  let host = null;
  let shadow = null;
  let backdrop = null;
  let dialog = null;
  let bannerHost = null;
  let liveRegion = null;
  let restoreFocus = null;
  let listeners = [];
  let openState = false;

  function on(target, type, handler, capture) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(type, handler, capture);
    listeners.push([target, type, handler, capture]);
    return () => {
      try {
        target.removeEventListener(type, handler, capture);
      } catch {
        /* noop */
      }
    };
  }

  function clearListeners() {
    for (const [target, type, handler, capture] of listeners) {
      try {
        target.removeEventListener(type, handler, capture);
      } catch {
        /* noop */
      }
    }
    listeners = [];
  }

  function ensureHost() {
    if (host && host.isConnected && shadow) return;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(hostId) : null;
    if (existing) existing.remove();
    host = doc.createElement('div');
    host.id = hostId;
    host.setAttribute('data-siat', marker);
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = DIALOG_STYLE + (options.extraStyle || '');
    shadow.appendChild(style);
    liveRegion = dialogEl(doc, 'div', { className: 'siat-live', attrs: { 'aria-live': 'polite', role: 'status' } });
    shadow.appendChild(liveRegion);
    const root = doc.documentElement || doc.body;
    if (root) root.appendChild(host);
  }

  function buildShell() {
    backdrop = dialogEl(doc, 'div', { className: 'siat-backdrop' });
    on(backdrop, 'mousedown', (event) => {
      if (event.target === backdrop && options.dismissOnBackdrop !== false) closeDialog();
    });

    dialog = dialogEl(doc, 'div', {
      className: 'siat-dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    });
    if (describedId) dialog.setAttribute('aria-describedby', describedId);
    if (options.width) dialog.dataset.width = options.width;

    const head = dialogEl(doc, 'div', { className: 'siat-dialog-head' });
    const titles = dialogEl(doc, 'div', { className: 'siat-dialog-titles' });
    titles.appendChild(dialogEl(doc, 'h2', { className: 'siat-dialog-title', id: titleId, text: options.title || '' }));
    if (options.subtitle !== undefined) {
      titles.appendChild(dialogEl(doc, 'p', { className: 'siat-dialog-subtitle', id: `${titleId}-sub`, text: options.subtitle }));
    }
    head.appendChild(titles);
    head.appendChild(
      dialogEl(doc, 'button', {
        className: 'siat-icon-btn',
        text: '×',
        attrs: { type: 'button', 'aria-label': options.closeLabel || 'Close' },
      }),
    );
    head.lastChild.addEventListener('click', () => closeDialog());
    dialog.appendChild(head);

    const body = dialogEl(doc, 'div', { className: 'siat-body' });
    bannerHost = dialogEl(doc, 'div', {});
    body.appendChild(bannerHost);
    dialog.appendChild(body);

    const foot = dialogEl(doc, 'div', { className: 'siat-foot' });
    dialog.appendChild(foot);

    backdrop.appendChild(dialog);
    shadow.appendChild(backdrop);

    return { head, titles, body, foot };
  }

  function showBanner(kind, title, lines) {
    if (!bannerHost) return;
    bannerHost.textContent = '';
    const messages = (Array.isArray(lines) ? lines : [lines]).filter((line) => line !== undefined && line !== null && String(line).trim() !== '');
    if (!title && !messages.length) return;
    const banner = dialogEl(doc, 'div', { className: 'siat-banner', attrs: { role: kind === 'error' ? 'alert' : 'status' } });
    banner.dataset.kind = String(kind || '');
    if (title) banner.appendChild(dialogEl(doc, 'strong', { text: title }));
    if (messages.length) {
      const list = dialogEl(doc, 'ul', {});
      for (const message of messages.slice(0, 12)) list.appendChild(dialogEl(doc, 'li', { text: message }));
      banner.appendChild(list);
    }
    bannerHost.appendChild(banner);
  }

  function announce(message) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    // A second write makes screen readers re-announce identical text.
    setTimeout(() => {
      if (liveRegion) liveRegion.textContent = String(message || '');
    }, 30);
  }

  function focusables() {
    if (!dialog) return [];
    const found = dialog.querySelectorAll('button, input, select, textarea, [href], summary, details, [tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(found, (node) => !node.disabled && node.offsetParent !== null);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = shadow && shadow.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog() {
    ensureHost();
    clearListeners();
    try {
      shadow.textContent = '';
    } catch {
      /* noop */
    }
    const style = doc.createElement('style');
    style.textContent = DIALOG_STYLE + (options.extraStyle || '');
    shadow.appendChild(style);
    liveRegion = dialogEl(doc, 'div', { className: 'siat-live', attrs: { 'aria-live': 'polite', role: 'status' } });
    shadow.appendChild(liveRegion);

    if (typeof options.beforeBuild === 'function') options.beforeBuild();
    const parts = buildShell();
    const context = {
      doc,
      body: parts.body,
      foot: parts.foot,
      head: parts.head,
      dialog,
      shadowRoot: shadow,
      showBanner,
      announce,
      on,
      close: closeDialog,
      api,
    };
    if (typeof options.build === 'function') options.build(context);
    openState = true;
    restoreFocus = doc.activeElement;
    on(doc, 'keydown', onKeydown, true);
    if (typeof options.afterBuild === 'function') options.afterBuild(context);

    const mode = options.focus === undefined ? 'primary' : options.focus;
    const target =
      mode === 'none'
        ? null
        : mode === 'first'
          ? focusables()[0] || dialog
          : typeof mode === 'object' && mode
            ? mode
            : dialog.querySelector('[data-variant="primary"]') || focusables()[0] || dialog;
    setTimeout(() => {
      try {
        if (target && typeof target.focus === 'function') target.focus();
      } catch {
        /* noop */
      }
    }, 0);
    return context;
  }

  function closeDialog() {
    if (!openState && !backdrop) return;
    clearListeners();
    openState = false;
    if (typeof options.onClose === 'function') {
      try {
        options.onClose();
      } catch {
        /* a failing callback must not leave the dialog stuck open */
      }
    }
    if (shadow) {
      try {
        shadow.textContent = '';
      } catch {
        /* noop */
      }
    }
    backdrop = null;
    dialog = null;
    bannerHost = null;
    liveRegion = null;
    if (restoreFocus && restoreFocus.isConnected !== false) {
      try {
        restoreFocus.focus({ preventScroll: true });
      } catch {
        /* noop */
      }
    }
    restoreFocus = null;
  }

  const api = {
    open: openDialog,
    close: closeDialog,
    showBanner,
    announce,
    on,
    get isOpen() {
      return openState;
    },
    get host() {
      return host;
    },
    get shadowRoot() {
      return shadow;
    },
    get element() {
      return dialog;
    },
    setTitle(text) {
      if (!dialog) return;
      const node = dialog.querySelector(`#${titleId}`);
      if (node) node.textContent = String(text);
    },
    setSubtitle(text) {
      if (!dialog) return;
      const node = dialog.querySelector(`#${titleId}-sub`);
      if (node) node.textContent = String(text);
      else if (text) {
        const titles = dialog.querySelector('.siat-dialog-titles');
        if (titles) titles.appendChild(dialogEl(doc, 'p', { className: 'siat-dialog-subtitle', id: `${titleId}-sub`, text }));
      }
    },
    destroy() {
      closeDialog();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      listeners = [];
    },
  };

  return api;
}

/* ── src/ui/panel.js ───────────────────────── */
/**
 * Settings dialog.
 *
 * A modal in a shadow root: role="dialog", aria-modal, real form controls with
 * labels, a focus trap, Escape to close and focus returned to whatever had it
 * before. Changes are staged in a draft and only written to storage on Save, so
 * "Cancel" means what it says.
 *
 * The diagnostics section exists because most support questions about this kind
 * of script are really "which of these browser/manager capabilities do I have?"
 * It reports the *probed* facts (manager name and version, GM download mode,
 * which encoders this browser really has, whether animated frames can be
 * decoded, where settings are stored) instead of a static compatibility claim.
 *
 * Everything is built with createElement/textContent; the imported JSON is
 * validated by core/settings.js before any of it reaches a control.
 */










const PANEL_HOST_ID = 'siat-panel-host';


/**
 * @param {object} deps
 * @param {() => object} deps.getSettings
 * @param {(patch:object) => Promise<{ok:boolean, warnings:string[]}>} deps.saveSettings
 * @param {() => Promise<object>} deps.resetSettings
 * @param {() => object} deps.diagnostics   see main.js buildDiagnostics()
 * @param {() => string[]} [deps.settingsWarnings]
 */
function createSettingsPanel(deps) {
  const doc = deps.document || document;
  let draft = null;
  let fileInput = null;

  // Thin wrappers so the fifty-odd call sites below keep reading the same way,
  // while the implementation lives once in ui/dialog.js.
  const button = (label, variant, handler) => dialogButton(doc, label, variant, handler);

  const dialog = createDialog({
    document: doc,
    hostId: PANEL_HOST_ID,
    marker: 'panel',
    titleId: 'siat-panel-title',
    title: 'Save Image as Type — settings',
    closeLabel: 'Close settings',
    beforeBuild() {
      draft = Object.assign({}, deps.getSettings());
      draft.formats = (draft.formats || []).slice();
      draft.presets = Array.isArray(draft.presets) ? draft.presets.slice() : [];
      draft.shortcuts = Object.assign({}, draft.shortcuts || {});
      draft.batchFormats = (draft.batchFormats || []).slice();
      draft.compareFormats = (draft.compareFormats || []).slice();
      draft.menuActions = (draft.menuActions || []).slice();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      body.appendChild(buildFormatsSection());
      body.appendChild(buildFilenameSection());
      body.appendChild(buildQualitySection());
      body.appendChild(buildAnimationSection());
      body.appendChild(buildBatchSection());
      body.appendChild(buildPresetsSection());
      body.appendChild(buildShortcutsSection());
      body.appendChild(buildBehaviourSection());
      body.appendChild(buildPrivacySection());
      body.appendChild(buildDiagnosticsSection());

      const note = doc.createElement('span');
      note.className = 'siat-note';
      note.textContent = 'Changes apply to every tab once saved.';
      foot.appendChild(note);
      const spacer = doc.createElement('span');
      spacer.className = 'siat-spacer';
      foot.appendChild(spacer);
      foot.appendChild(button('Reset defaults', 'ghost', onReset));
      foot.appendChild(button('Export JSON', 'ghost', onExport));
      foot.appendChild(button('Import JSON', 'ghost', onImportClick));
      foot.appendChild(button('Cancel', 'ghost', () => close()));
      foot.appendChild(button('Save', 'primary', onSave));

      fileInput = doc.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      fileInput.addEventListener('change', onImportFile);
      context.shadowRoot.appendChild(fileInput);
    },
    afterBuild() {
      const warnings = deps.settingsWarnings ? deps.settingsWarnings() : [];
      showBanner(warnings.length ? 'info' : '', warnings.length ? 'Some stored settings needed attention' : '', warnings);
    },
  });

  // Local bindings on purpose: a bare `close()` inside this module would
  // otherwise resolve to `window.close()` (lint rule no-implicit-page-globals).
  const open = () => dialog.open();
  const close = () => dialog.close();
  const showBanner = (kind, title, lines) => dialog.showBanner(kind, title, lines);

  const section = (legendText, description) => dialogSection(doc, legendText, description);


  const checkboxRow = (spec) => dialogCheckboxRow(doc, spec);
  const field = (spec) => dialogField(doc, spec);
  const textControl = (value, attrs) => dialogTextControl(doc, value, attrs);

  function buildFormatsSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section('Formats in the right-click menu', 'Tick the formats you want offered. Unticked formats stay available in Settings only.');
    const grid = doc.createElement('div');
    grid.className = 'siat-grid';
    for (const format of FORMATS) {
      const unavailable = Boolean(format.requiresEncodeProbe && !diagnostics.encoders[format.mime]);
      grid.appendChild(
        checkboxRow({
          id: `siat-fmt-${format.id}`,
          label: format.id === 'original' ? 'Original file' : format.label,
          hint: unavailable ? `Not available: ${diagnostics.encoderNotes[format.mime] || 'this browser cannot encode it'}` : format.hint,
          checked: draft.formats.includes(format.id),
          unavailable,
          onChange: (checked) => {
            const list = draft.formats.slice();
            const index = list.indexOf(format.id);
            if (checked && index < 0) list.splice(format.alwaysLast ? list.length : index + 1, 0, format.id);
            if (!checked && index >= 0) list.splice(index, 1);
            draft.formats = list;
          },
        }),
      );
    }
    fieldset.appendChild(grid);
    return fieldset;
  }

  function buildFilenameSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section(
      'File names',
      'Names are derived from the image URL, then its alt text, then the page title. Unsafe characters are always removed.',
    );
    const prefix = textControl(draft.filenamePrefix, { maxlength: 60, placeholder: 'e.g. reference' });
    prefix.addEventListener('input', () => {
      draft.filenamePrefix = prefix.value;
    });
    fieldset.appendChild(
      field({ id: 'siat-prefix', label: 'Prefix every file name with', hint: 'Joined with a hyphen. Path separators are removed, so a prefix can never change the folder.', control: prefix }),
    );

    const subfolder = textControl(draft.subfolder, { maxlength: 80, placeholder: 'e.g. images/references' });
    subfolder.addEventListener('input', () => {
      draft.subfolder = subfolder.value;
    });
    const subfolderWorks = diagnostics.downloadMode === 'browser';
    fieldset.appendChild(
      field({
        id: 'siat-subfolder',
        label: 'Save into this sub-folder of your downloads',
        hint: subfolderWorks
          ? 'Your manager uses the browser download API, so sub-folders work.'
          : `Not supported by your current setup (${describeDownloadCapability(deps.gm ? deps.gm() : null, diagnostics.downloadMode)}) — the file will be saved with its name only.`,
        control: subfolder,
      }),
    );

    const maxLen = textControl(draft.maxFilenameLength, { type: 'number', min: 8, max: 120, step: 1 });
    maxLen.addEventListener('input', () => {
      draft.maxFilenameLength = Number(maxLen.value);
    });
    fieldset.appendChild(
      field({ id: 'siat-maxlen', label: 'Maximum file name length', hint: 'Between 8 and 120 characters; the extension always fits.', control: maxLen }),
    );

    // Template naming. An empty template means the classic "prefix-source name"
    // behaviour, so upgrading changes nothing until one is typed in.
    const templateControl = textControl(draft.filenameTemplate, {
      maxlength: 200,
      placeholder: '{host}-{date}-{w}x{h}-{index3}',
      spellcheck: 'false',
      autocomplete: 'off',
    });
    const preview = doc.createElement('p');
    preview.className = 'siat-desc';
    preview.id = 'siat-template-preview';
    const sampleContext = {
      base: 'photo-0142',
      path: 'photo-0142',
      host: 'cdn.example.com',
      origin: 'example.com',
      title: 'Gallery',
      alt: 'Red fox',
      w: 1920,
      h: 1080,
      format: 'jpg',
      ext: 'jpeg',
      mime: 'jpeg',
      bytes: 284193,
    };
    const renderPreview = () => {
      const text = String(templateControl.value || '').trim();
      if (!text) {
        preview.textContent = 'No template: names stay "<prefix>-<source name>", exactly as before.';
        return;
      }
      const checked = validateTemplate(text);
      if (!checked.ok) {
        preview.textContent = `Not usable yet — ${checked.errors[0]}`;
        return;
      }
      const rendered = renderTemplate(text, sampleContext, { counter: 3, preset: 'Archive PNG' });
      preview.textContent = `Preview: ${rendered.text || '(empty)'}.jpeg${checked.warnings.length ? ` — ${checked.warnings[0]}` : ''}`;
    };
    templateControl.addEventListener('input', () => {
      draft.filenameTemplate = templateControl.value;
      renderPreview();
    });
    renderPreview();
    fieldset.appendChild(
      field({
        id: 'siat-template',
        label: 'File-name template (optional)',
        hint: 'Replaces the prefix above. {index3} counts within one run, so a 200-image batch keeps unique names.',
        control: templateControl,
      }),
    );
    fieldset.appendChild(preview);

    const tokenBox = doc.createElement('details');
    tokenBox.className = 'siat-desc';
    const tokenSummary = doc.createElement('summary');
    tokenSummary.textContent = `Available tokens (${TEMPLATE_TOKENS.length})`;
    tokenBox.appendChild(tokenSummary);
    const tokenList = doc.createElement('div');
    tokenList.id = 'siat-template-tokens';
    tokenList.textContent = TEMPLATE_TOKENS.map((entry) => `{${entry.token}} = ${entry.label} (e.g. ${entry.example})`).join(' · ');
    tokenBox.appendChild(tokenList);
    fieldset.appendChild(tokenBox);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-collision',
        label: 'Add a counter when two files in one run would share a name',
        hint: 'Stops a batch from silently overwriting its own output.',
        checked: draft.filenameCollisionSuffix,
        onChange: (checked) => {
          draft.filenameCollisionSuffix = checked;
        },
      }),
    );
    return fieldset;
  }

  function buildQualitySection() {
    const fieldset = section('Output quality');
    const jpeg = textControl(draft.jpegQuality, { type: 'number', min: 0.5, max: 1, step: 0.01 });
    jpeg.addEventListener('input', () => {
      draft.jpegQuality = Number(jpeg.value);
    });
    fieldset.appendChild(field({ id: 'siat-jpegq', label: 'JPG quality', hint: '0.5 – 1.0. Also used for the image inside a PDF.', control: jpeg }));

    const webp = textControl(draft.webpQuality, { type: 'number', min: 0.1, max: 1, step: 0.01 });
    webp.addEventListener('input', () => {
      draft.webpQuality = Number(webp.value);
    });
    fieldset.appendChild(field({ id: 'siat-webpq', label: 'WebP quality', hint: '0.1 – 1.0.', control: webp }));

    const pdfSelect = doc.createElement('select');
    for (const [value, label] of [['a4', 'A4 (fit with margins)'], ['letter', 'US Letter (fit with margins)'], ['pixel', 'Exactly the image size']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      if (draft.pdfPageFit === value) option.selected = true;
      pdfSelect.appendChild(option);
    }
    pdfSelect.addEventListener('change', () => {
      draft.pdfPageFit = pdfSelect.value;
    });
    fieldset.appendChild(field({ id: 'siat-pdffit', label: 'PDF page size', hint: 'A4 and Letter keep the aspect ratio and centre the image.', control: pdfSelect }));

    const bgSelect = doc.createElement('select');
    for (const [value, label] of [['white', 'White'], ['black', 'Black'], ['checker', 'Light grey checkerboard']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      if (draft.flattenBackground === value) option.selected = true;
      bgSelect.appendChild(option);
    }
    bgSelect.addEventListener('change', () => {
      draft.flattenBackground = bgSelect.value;
    });
    fieldset.appendChild(
      field({ id: 'siat-bg', label: 'Flatten transparency onto', hint: 'Used for JPG, PDF and 24-bit BMP, which cannot store alpha.', control: bgSelect }),
    );

    const downscale = textControl(draft.downscaleAboveMegapixels, { type: 'number', min: 0, max: 400, step: 1 });
    downscale.addEventListener('input', () => {
      draft.downscaleAboveMegapixels = Number(downscale.value);
    });
    fieldset.appendChild(
      field({ id: 'siat-downscale', label: 'Downscale images above (megapixels)', hint: '0 = never downscale. Keeps huge images from freezing the tab.', control: downscale }),
    );
    return fieldset;
  }

  function buildAnimationSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section('Animation and memory limits');
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-keepanim',
        label: 'Keep animation when converting to GIF',
        hint: diagnostics.animation.decoderAvailable
          ? `Frame decoding available for: ${diagnostics.animation.supportedTypes.join(', ') || 'none probed'}.`
          : 'This browser cannot read individual frames (no WebCodecs ImageDecoder), so GIF output is the first frame. "Original file" always keeps animation.',
        checked: draft.keepAnimation,
        onChange: (checked) => {
          draft.keepAnimation = checked;
        },
      }),
    );

    const maxFrames = textControl(draft.gifMaxFrames, { type: 'number', min: 2, max: 200, step: 1 });
    maxFrames.addEventListener('input', () => {
      draft.gifMaxFrames = Number(maxFrames.value);
    });
    fieldset.appendChild(field({ id: 'siat-maxframes', label: 'Maximum frames per GIF', hint: 'Extra frames are skipped evenly and delays stretched to keep the timing.', control: maxFrames }));

    const memLimit = textControl(draft.gifMemoryLimitMB, { type: 'number', min: 16, max: 4096, step: 16 });
    memLimit.addEventListener('input', () => {
      draft.gifMemoryLimitMB = Number(memLimit.value);
    });
    fieldset.appendChild(
      field({ id: 'siat-memlimit', label: 'GIF memory limit (MB)', hint: 'Frames are scaled down to stay under this; a single frame above it is refused rather than crashing the tab.', control: memLimit }),
    );
    return fieldset;
  }

  function buildBatchSection() {
    const fieldset = section(
      'Batch conversion and archives',
      'Applies to "Save all images on this page" and to selections in the image picker. Scanning a page never downloads anything; a run only fetches what you start.',
    );

    const concurrency = textControl(draft.batchConcurrency, { type: 'number', min: 1, max: 4, step: 1 });
    concurrency.addEventListener('input', () => {
      draft.batchConcurrency = Number(concurrency.value);
    });
    fieldset.appendChild(
      field({
        id: 'siat-batch-concurrency',
        label: 'Images converted at the same time',
        hint: '1–4. Higher is faster but uses more memory; browsers also throttle many simultaneous downloads.',
        control: concurrency,
      }),
    );

    const maxImages = textControl(draft.batchMaxImages, { type: 'number', min: 1, max: 2000, step: 10 });
    maxImages.addEventListener('input', () => {
      draft.batchMaxImages = Number(maxImages.value);
    });
    fieldset.appendChild(
      field({ id: 'siat-batch-max', label: 'Maximum images per run', hint: 'Anything above this is reported as skipped, not silently dropped.', control: maxImages }),
    );

    const grid = doc.createElement('div');
    grid.className = 'siat-grid';
    const minWidth = textControl(draft.batchMinWidth, { type: 'number', min: 0, max: 20000, step: 10 });
    minWidth.addEventListener('input', () => {
      draft.batchMinWidth = Number(minWidth.value);
    });
    grid.appendChild(field({ id: 'siat-batch-minw', label: 'Minimum width (px, 0 = off)', control: minWidth }));
    const minHeight = textControl(draft.batchMinHeight, { type: 'number', min: 0, max: 20000, step: 10 });
    minHeight.addEventListener('input', () => {
      draft.batchMinHeight = Number(minHeight.value);
    });
    grid.appendChild(field({ id: 'siat-batch-minh', label: 'Minimum height (px, 0 = off)', control: minHeight }));
    fieldset.appendChild(grid);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-batch-skiptiny',
        label: 'Skip icons and tracking pixels',
        hint: 'Leaves out images smaller than 64×64 px, which are usually UI chrome.',
        checked: draft.batchSkipTiny,
        onChange: (checked) => {
          draft.batchSkipTiny = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-batch-dedupe',
        label: 'Save each distinct image URL once',
        hint: 'A gallery showing one photo six times produces one file.',
        checked: draft.batchDedupe,
        onChange: (checked) => {
          draft.batchDedupe = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-batch-notloaded',
        label: 'Also convert images the page has not loaded yet',
        hint: 'Off by default: forcing lazy images to load costs bandwidth and can change what the page shows. The picker can load selected images on demand instead.',
        checked: draft.batchIncludeNotLoaded,
        onChange: (checked) => {
          draft.batchIncludeNotLoaded = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-jobbar',
        label: 'Show the batch progress bar',
        hint: 'Bottom-left overlay with per-image state, Cancel and Retry failed.',
        checked: draft.showJobBar,
        onChange: (checked) => {
          draft.showJobBar = checked;
        },
      }),
    );

    const destination = dialogSelectControl(
      doc,
      [
        { value: 'files', label: 'One file per image' },
        { value: 'zip', label: 'A single .zip archive' },
      ],
      draft.batchDestination,
      (value) => {
        draft.batchDestination = value;
      },
    );
    fieldset.appendChild(
      field({
        id: 'siat-batch-dest',
        label: 'Where a batch run puts its output',
        hint: 'Browsers block or throttle many automatic downloads; an archive avoids that and is built entirely in memory.',
        control: destination,
      }),
    );

    const zipMax = textControl(draft.zipMaxMB, { type: 'number', min: 1, max: 4096, step: 64 });
    zipMax.addEventListener('input', () => {
      draft.zipMaxMB = Number(zipMax.value);
    });
    fieldset.appendChild(
      field({
        id: 'siat-zip-max',
        label: 'Archive size limit (MB)',
        hint: 'If a run would exceed this, the remaining images are saved as separate files and the report says so.',
        control: zipMax,
      }),
    );

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-scan-backgrounds',
        label: 'Include CSS background images in the inventory',
        hint: 'Needs a computed-style read per element, so it is capped below.',
        checked: draft.scanBackgrounds,
        onChange: (checked) => {
          draft.scanBackgrounds = checked;
        },
      }),
    );

    const scanCap = textControl(draft.scanElementCap, { type: 'number', min: 100, max: 20000, step: 100 });
    scanCap.addEventListener('input', () => {
      draft.scanElementCap = Number(scanCap.value);
    });
    fieldset.appendChild(
      field({ id: 'siat-scan-cap', label: 'Elements inspected while scanning', hint: 'Very large pages are truncated rather than frozen; the picker says when that happened.', control: scanCap }),
    );

    const compareBox = section('Formats offered by "Compare formats…"', 'Each candidate is encoded in memory from the same pixels — one download of the source, never more.');
    const compareGrid = doc.createElement('div');
    compareGrid.className = 'siat-grid';
    for (const format of FORMATS) {
      if (format.id === 'original') continue;
      compareGrid.appendChild(
        checkboxRow({
          id: `siat-cmp-${format.id}`,
          label: format.label,
          checked: (draft.compareFormats || []).includes(format.id),
          onChange: (checked) => {
            const list = (draft.compareFormats || []).slice();
            const index = list.indexOf(format.id);
            if (checked && index < 0) list.push(format.id);
            if (!checked && index >= 0) list.splice(index, 1);
            draft.compareFormats = list;
          },
        }),
      );
    }
    compareBox.appendChild(compareGrid);
    fieldset.appendChild(compareBox);
    return fieldset;
  }

  function buildPresetsSection() {
    const fieldset = section(
      'Presets',
      `A preset bundles format, quality, resize, file-name template, destination and (optionally) the sites it applies to automatically. Up to ${PRESET_LIMITS.max} presets are stored.`,
    );

    const active = doc.createElement('p');
    active.className = 'siat-desc';
    active.id = 'siat-preset-active';
    const list = doc.createElement('div');
    list.id = 'siat-preset-list';

    const renderActive = () => {
      const preset = draft.presets.find((item) => item.id === draft.activePresetId);
      active.textContent = preset ? `Active preset: ${preset.name} — ${presetSummary(preset) || 'no overrides'}` : 'No preset is active; your normal settings are used.';
    };

    const renderList = () => {
      list.textContent = '';
      if (!draft.presets.length) {
        const empty = doc.createElement('p');
        empty.className = 'siat-empty';
        empty.textContent = 'No presets yet. Add one to capture the current settings.';
        list.appendChild(empty);
      }
      draft.presets.forEach((preset) => list.appendChild(presetRow(preset, renderList, renderActive)));
      renderActive();
    };

    fieldset.appendChild(active);
    fieldset.appendChild(list);

    const addButton = button(`Add preset from current settings`, 'ghost', () => {
      if (draft.presets.length >= PRESET_LIMITS.max) {
        showBanner('error', 'Preset limit reached', [`Delete one of the ${PRESET_LIMITS.max} presets first.`]);
        return;
      }
      const index = draft.presets.length + 1;
      draft.presets.push({
        id: `preset-${Date.now().toString(36)}-${index}`,
        name: `Preset ${index}`,
        formatId: (draft.formats && draft.formats[0]) || 'png',
        jpegQuality: draft.jpegQuality,
        webpQuality: draft.webpQuality,
        filenameTemplate: draft.filenameTemplate || '',
        subfolder: draft.subfolder || '',
        destination: draft.batchDestination === 'zip' ? 'zip' : 'file',
        stripMetadata: false,
        transform: draft.defaultTransform ? JSON.parse(JSON.stringify(draft.defaultTransform)) : null,
        hosts: [],
      });
      renderList();
      showBanner('info', 'Preset added', ['It is not saved until you press Save at the bottom.']);
    });
    addButton.id = 'siat-preset-new';
    const clearButton = button('Clear active preset', 'ghost', () => {
      draft.activePresetId = '';
      renderActive();
    });
    clearButton.id = 'siat-preset-clear';
    const row = doc.createElement('div');
    row.className = 'siat-foot';
    row.style.padding = '8px 0 0';
    row.appendChild(addButton);
    row.appendChild(clearButton);
    fieldset.appendChild(row);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-preset-autohost',
        label: 'Apply a preset automatically on the hosts it lists',
        hint: 'Matching happens on the page host only. The most specific rule wins; the menu still shows which preset is in effect.',
        checked: draft.autoApplyPresetByHost,
        onChange: (checked) => {
          draft.autoApplyPresetByHost = checked;
        },
      }),
    );

    renderList();
    return fieldset;
  }

  function presetRow(preset, renderList, renderActive) {
    const box = doc.createElement('fieldset');
    box.className = 'siat-section';
    box.id = `siat-preset-${preset.id}`;
    const legend = doc.createElement('legend');
    legend.className = 'siat-legend';
    legend.textContent = preset.name || 'Preset';
    box.appendChild(legend);

    const nameControl = textControl(preset.name, { maxlength: PRESET_LIMITS.nameChars });
    nameControl.addEventListener('input', () => {
      preset.name = nameControl.value;
      legend.textContent = preset.name || 'Preset';
    });
    box.appendChild(field({ id: `siat-preset-${preset.id}-name`, label: 'Name', control: nameControl }));

    const formatControl = dialogSelectControl(
      doc,
      FORMATS.map((format) => ({ value: format.id, label: format.id === 'original' ? 'Original file' : format.label })),
      preset.formatId,
      (value) => {
        preset.formatId = value;
      },
    );
    box.appendChild(field({ id: `siat-preset-${preset.id}-format`, label: 'Output format', control: formatControl }));

    const resizeControl = dialogSelectControl(
      doc,
      RESIZE_PRESETS.map((entry) => ({ value: entry.id, label: entry.label })),
      resizePresetIdOf(preset.transform),
      (value) => {
        const found = RESIZE_PRESETS.find((entry) => entry.id === value);
        preset.transform = found && found.mode !== 'none' ? { resize: { mode: found.mode, width: found.width || 0, height: 0, keepAspect: true }, crop: null, rotate: 0, flipH: false, flipV: false } : null;
      },
    );
    box.appendChild(field({ id: `siat-preset-${preset.id}-resize`, label: 'Resize', hint: 'Cropping and rotation stay one-off actions in the Transform dialog.', control: resizeControl }));

    const destControl = dialogSelectControl(
      doc,
      [
        { value: 'file', label: 'One file per image' },
        { value: 'zip', label: 'A single .zip archive' },
      ],
      preset.destination || 'file',
      (value) => {
        preset.destination = value;
      },
    );
    box.appendChild(field({ id: `siat-preset-${preset.id}-dest`, label: 'Destination', control: destControl }));

    const templateControl = textControl(preset.filenameTemplate, { maxlength: 200, placeholder: '{host}-{date}-{index3}' });
    templateControl.addEventListener('input', () => {
      preset.filenameTemplate = templateControl.value;
    });
    box.appendChild(field({ id: `siat-preset-${preset.id}-template`, label: 'File-name template', control: templateControl }));

    const hostsControl = textControl((preset.hosts || []).join(', '), { maxlength: 200, placeholder: 'example.com, *.photos.example.com' });
    hostsControl.addEventListener('input', () => {
      preset.hosts = hostsControl.value
        .split(',')
        .map((part) => sanitizeHostPattern(part))
        .filter(Boolean);
    });
    box.appendChild(
      field({
        id: `siat-preset-${preset.id}-hosts`,
        label: 'Apply automatically on these hosts (comma separated)',
        hint: 'Empty means the preset is only applied by hand, from the right-click menu.',
        control: hostsControl,
      }),
    );

    const actions = doc.createElement('div');
    actions.className = 'siat-radios';
    const useButton = button('Use now', 'ghost', () => {
      draft.activePresetId = preset.id;
      renderActive();
      showBanner('info', `Preset "${preset.name}" is active`, ['Press Save to keep it after this page.']);
    });
    useButton.id = `siat-preset-${preset.id}-activate`;
    const deleteButton = button('Delete', 'ghost', () => {
      const index = draft.presets.findIndex((item) => item.id === preset.id);
      if (index >= 0) draft.presets.splice(index, 1);
      if (draft.activePresetId === preset.id) draft.activePresetId = '';
      renderList();
    });
    deleteButton.id = `siat-preset-${preset.id}-delete`;
    actions.appendChild(useButton);
    actions.appendChild(deleteButton);
    box.appendChild(actions);
    return box;
  }

  function buildShortcutsSection() {
    const fieldset = section(
      'Keyboard shortcuts',
      'Every chord needs Ctrl, Alt or Meta, so plain typing on a page is never captured. Empty disables one action. On Windows, Alt+Shift is also the language-switch chord — rebind if your system grabs it first.',
    );

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-shortcuts-enable',
        label: 'Enable keyboard shortcuts',
        checked: draft.enableShortcuts,
        onChange: (checked) => {
          draft.enableShortcuts = checked;
        },
      }),
    );

    const feedback = doc.createElement('p');
    feedback.className = 'siat-desc';
    feedback.id = 'siat-shortcuts-feedback';
    const showFeedback = () => {
      const checked = validateShortcuts(draft.shortcuts);
      const problems = checked.errors.concat(checked.warnings);
      feedback.textContent = problems.length ? problems[0] : 'All shortcuts are valid.';
    };

    for (const action of SHORTCUT_ACTIONS) {
      const value = draft.shortcuts && draft.shortcuts[action.id] !== undefined ? draft.shortcuts[action.id] : DEFAULT_SHORTCUTS[action.id];
      const control = textControl(value, { placeholder: DEFAULT_SHORTCUTS[action.id], spellcheck: 'false', autocomplete: 'off', maxlength: 40 });
      control.addEventListener('input', () => {
        draft.shortcuts = Object.assign({}, draft.shortcuts, { [action.id]: control.value });
        showFeedback();
      });
      fieldset.appendChild(
        field({ id: `siat-sc-${action.id}`, label: action.label, hint: `Default ${DEFAULT_SHORTCUTS[action.id]}.`, control }),
      );
    }
    showFeedback();
    fieldset.appendChild(feedback);

    const helpNote = doc.createElement('p');
    helpNote.className = 'siat-desc';
    helpNote.textContent = 'In the right-click menu you can also press a digit (1–9) to pick that format directly, or Escape to close it. "Shortcut help" in your manager menu lists every binding.';
    fieldset.appendChild(helpNote);
    return fieldset;
  }

  /** Which resize preset (if any) a stored transform corresponds to. */
  function resizePresetIdOf(transform) {
    if (!transform || !transform.resize) return 'none';
    const mode = transform.resize.mode;
    if (!mode || mode === 'none') return 'none';
    const found = RESIZE_PRESETS.find(
      (entry) => entry.mode === mode && (entry.width || 0) === (Number(transform.resize.width) || 0),
    );
    return found ? found.id : 'none';
  }

  function buildBehaviourSection() {
    const fieldset = section('Menu and download behaviour');

    const radios = doc.createElement('div');
    radios.className = 'siat-radios';
    radios.setAttribute('role', 'radiogroup');
    radios.setAttribute('aria-label', 'Download behaviour');
    for (const [value, label, hint] of [
      ['instant', 'Save instantly', 'No dialog where the manager allows it'],
      ['ask', 'Ask where to save', 'Only honoured in browser download API mode'],
    ]) {
      const wrapper = doc.createElement('label');
      wrapper.className = 'siat-radio';
      const input = doc.createElement('input');
      input.type = 'radio';
      input.className = 'siat-radio-input';
      input.name = 'siat-download-behavior';
      input.value = value;
      input.checked = draft.downloadBehavior === value;
      input.addEventListener('change', () => {
        if (input.checked) draft.downloadBehavior = value;
      });
      wrapper.appendChild(input);
      const text = doc.createElement('span');
      text.textContent = label;
      wrapper.appendChild(text);
      const hintEl = doc.createElement('small');
      hintEl.className = 'siat-check-hint';
      hintEl.textContent = hint;
      wrapper.appendChild(hintEl);
      radios.appendChild(wrapper);
    }
    fieldset.appendChild(radios);
    const behaviourSpacer = doc.createElement('div');
    behaviourSpacer.style.height = '10px';
    fieldset.appendChild(behaviourSpacer);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-intercept',
        label: 'Replace the right-click menu on images',
        hint: 'Off = the script never touches right-click; use the manager menu command instead.',
        checked: draft.interceptContextMenu,
        onChange: (checked) => {
          draft.interceptContextMenu = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-shift',
        label: 'Only open when Shift is held',
        hint: 'Inverts the default: right-click gives the browser menu, Shift + right-click gives this one.',
        checked: draft.requireShift,
        onChange: (checked) => {
          draft.requireShift = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-bgimg',
        label: 'Also offer CSS background images',
        hint: 'Covers background-image, list-style-image and ::before/::after decorations.',
        checked: draft.enableBackgroundImages,
        onChange: (checked) => {
          draft.enableBackgroundImages = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-longpress',
        label: 'Open on long-press (touch)',
        hint: 'For phones and tablets, where there is no right-click.',
        checked: draft.enableLongPress,
        onChange: (checked) => {
          draft.enableLongPress = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-remember',
        label: 'Show the last format used first',
        checked: draft.rememberLastFormat,
        onChange: (checked) => {
          draft.rememberLastFormat = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-notify',
        label: 'Also raise a system notification on failure',
        hint: 'In addition to the on-page message.',
        checked: draft.notifyOnError,
        onChange: (checked) => {
          draft.notifyOnError = checked;
        },
      }),
    );

    const actionsBox = section(
      'Extra actions in the right-click menu',
      'Untick anything you do not use and the menu stays short. Formats are always listed.',
    );
    const actionsGrid = doc.createElement('div');
    actionsGrid.className = 'siat-grid';
    for (const id of MENU_ACTION_IDS) {
      const meta = MENU_ACTION_LABELS[id] || { label: id, hint: '' };
      actionsGrid.appendChild(
        checkboxRow({
          id: `siat-menuact-${id}`,
          label: meta.label,
          hint: meta.hint,
          checked: (draft.menuActions || []).includes(id),
          onChange: (checked) => {
            const list = (draft.menuActions || []).slice();
            const index = list.indexOf(id);
            if (checked && index < 0) list.push(id);
            if (!checked && index >= 0) list.splice(index, 1);
            draft.menuActions = list;
          },
        }),
      );
    }
    actionsBox.appendChild(actionsGrid);
    fieldset.appendChild(actionsBox);

    const copyControl = dialogSelectControl(
      doc,
      [
        { value: 'png', label: 'PNG (re-encoded, works everywhere)' },
        { value: 'original', label: 'Original bytes when the browser accepts them' },
      ],
      draft.copyFormat,
      (value) => {
        draft.copyFormat = value;
      },
    );
    fieldset.appendChild(
      field({
        id: 'siat-copy-format',
        label: 'What "Copy image" puts on the clipboard',
        hint: 'Most browsers only accept PNG there, so an original-bytes copy falls back to PNG and the toast says so.',
        control: copyControl,
      }),
    );
    return fieldset;
  }

  function buildPrivacySection() {
    const fieldset = section(
      'Privacy and network',
      'This script never uploads anything. The only network request it can make is a GET for the image you asked it to convert, issued through your userscript manager (that is what @connect * is for). Turn it off and cross-origin images whose servers send no CORS header can no longer be converted.',
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-cors',
        label: 'Fetch cross-origin images through the manager',
        hint: 'Needed for CDN-hosted images that block cross-origin canvas reads.',
        checked: draft.allowCrossOriginFetch,
        onChange: (checked) => {
          draft.allowCrossOriginFetch = checked;
        },
      }),
    );
    const storageNote = doc.createElement('p');
    storageNote.className = 'siat-desc';
    storageNote.textContent = `Stored on this device only: your settings (${deps.diagnostics().storage === 'gm' ? 'in your userscript manager' : 'in memory for this page load — no storage permission available'}). Images and page data are never stored or transmitted.`;
    fieldset.appendChild(storageNote);

    const metaBox = section(
      'Embedded metadata in saved originals',
      'Re-saving the original file copies it byte for byte — including EXIF (camera, timestamps, sometimes GPS), XMP and colour profiles. "Inspect metadata" on any image shows exactly what a file carries.',
    );
    metaBox.appendChild(
      checkboxRow({
        id: 'siat-strip-metadata',
        label: 'Strip EXIF/XMP when saving the original file',
        hint: 'Removes metadata segments only; the image data is never re-encoded, so quality is untouched.',
        checked: draft.stripMetadataOnOriginal,
        onChange: (checked) => {
          draft.stripMetadataOnOriginal = checked;
        },
      }),
    );
    metaBox.appendChild(
      checkboxRow({
        id: 'siat-drop-icc',
        label: 'Also remove the ICC colour profile',
        hint: 'Only with stripping on. Colours may shift slightly in apps that ignore the profile, so this is off by default.',
        checked: draft.dropIccWhenStripping,
        onChange: (checked) => {
          draft.dropIccWhenStripping = checked;
        },
      }),
    );
    metaBox.appendChild(
      checkboxRow({
        id: 'siat-warn-gps',
        label: 'Warn when a file contains GPS coordinates',
        hint: 'Shown in the inspector and in the save report. Coordinates are only ever displayed rounded to about 1 km, and never leave this device.',
        checked: draft.warnAboutGps,
        onChange: (checked) => {
          draft.warnAboutGps = checked;
        },
      }),
    );
    const metaNote = doc.createElement('p');
    metaNote.className = 'siat-desc';
    metaNote.textContent = 'Converted formats (PNG, JPG, WebP, GIF, BMP, PDF) are re-encoded from pixels, so they never carry the source metadata in the first place.';
    metaBox.appendChild(metaNote);
    fieldset.appendChild(metaBox);
    return fieldset;
  }

  function buildDiagnosticsSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section('Diagnostics (read-only)', 'Probed live in this browser and manager — useful when reporting a problem.');
    const table = doc.createElement('table');
    table.className = 'siat-table';
    const rows = [
      ['Userscript manager', `${diagnostics.handler} ${diagnostics.managerVersion}`.trim() || 'unknown'],
      ['Script version', diagnostics.scriptVersion || 'unknown'],
      ['Injection mode', diagnostics.injectInto || 'unknown'],
      ['GM download mode', `${diagnostics.downloadMode} — ${describeDownloadCapability(deps.gm ? deps.gm() : null, diagnostics.downloadMode)}`],
      ['Settings storage', diagnostics.storage === 'gm' ? 'manager storage (survives restarts)' : 'memory only (no GM_getValue grant)'],
      ['PNG / JPG / WebP encoders', encodersLabel(diagnostics, ['image/png', 'image/jpeg', 'image/webp'])],
      ['AVIF encoder', encodersLabel(diagnostics, ['image/avif'])],
      ['BMP / GIF / PDF encoders', 'built into this script (no browser support needed)'],
      ['Animated frame decoding', diagnostics.animation.decoderAvailable ? `available (${diagnostics.animation.supportedTypes.join(', ') || 'no formats probed'})` : 'unavailable in this browser'],
    ];
    for (const [label, value] of rows) {
      const tr = doc.createElement('tr');
      const th = doc.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      const td = doc.createElement('td');
      td.textContent = value;
      tr.appendChild(th);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    fieldset.appendChild(table);

    if (deps.capabilityReport) {
      const pre = doc.createElement('p');
      pre.className = 'siat-desc';
      pre.textContent = 'Copy this when reporting a problem: ' + deps.capabilityReport();
      fieldset.appendChild(pre);
    }
    return fieldset;
  }

  function encodersLabel(diagnostics, mimes) {
    const parts = mimes.map((mime) => `${mime.split('/')[1]}: ${diagnostics.encoders[mime] ? 'yes' : 'no'}`);
    return parts.join(' · ');
  }

  async function onSave() {
    const result = await deps.saveSettings(draft);
    if (result && result.ok === false) {
      showBanner('error', 'Settings could not be saved.', ['Your manager did not accept the write (storage may be unavailable). The changes apply to this page only.']);
      return;
    }
    close();
  }

  async function onReset() {
    draft = await deps.resetSettings();
    close();
    open();
  }

  function onExport() {
    const payload = JSON.stringify(Object.assign({}, draft, { exportedBy: 'save-image-as-type', exportedAt: new Date().toISOString() }), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = 'save-image-as-type-settings.json';
    anchor.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
    (doc.documentElement || doc.body).appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function onImportClick() {
    if (!fileInput) return;
    fileInput.value = '';
    fileInput.click();
  }

  async function onImportFile() {
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch (err) {
      showBanner('error', 'Could not read that file.', [err && err.message ? err.message : String(err)]);
      return;
    }
    if (text.length > 200000) {
      showBanner('error', 'That file is too large to be a settings file.', [`Received ${text.length.toLocaleString('en-US')} characters.`]);
      return;
    }
    const result = validateImportedSettings(text);
    if (!result.ok) {
      showBanner('error', 'Import rejected.', result.errors);
      return;
    }
    draft = result.settings;
    showBanner('info', 'Imported — review, then press Save.', result.warnings);
    close();
    open();
  }

  return {
    open,
    close,
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    destroy() {
      dialog.destroy();
      fileInput = null;
      draft = null;
    },
  };
}

/* ── src/ui/toast.js ───────────────────────── */
/**
 * Status/error toasts.
 *
 * Rendered inside a closed-by-default shadow root so hostile or aggressive page
 * CSS cannot restyle or hide it, and so our styles cannot leak into the page.
 * Text is only ever written with textContent — the file name, the image URL and
 * the page's own strings all pass through here, so an innerHTML sink would be an
 * injection hole.
 *
 * Accessibility: progress uses role="status" (polite), failures use role="alert"
 * (assertive), the details disclosure is a real <details>/<summary>, and the
 * toast never steals focus (it is supplementary to the menu the user just used).
 */

const TOAST_HOST_ID = 'siat-toast-host';
// Hard bound on how many toasts are on screen at once. Older ones are dropped
// rather than queued: a notification stack that grows covers the page.
const MAX_VISIBLE_TOASTS = 4;
const TOAST_STYLE = `
:host { all: initial; }
.siat-toast-stack {
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-width: min(92vw, 420px); pointer-events: none;
}
.siat-toast {
  pointer-events: auto; background: #1f2430; color: #f4f6fb;
  border: 1px solid rgba(255,255,255,.14); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.35); padding: 10px 12px;
  display: flex; gap: 10px; align-items: flex-start; min-width: 220px;
}
.siat-toast[data-kind="error"] { border-color: #b4232a; background: #2a1416; }
.siat-toast[data-kind="progress"] { border-color: #2c4a7c; }
.siat-badge { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; }
.siat-body { flex: 1 1 auto; min-width: 0; }
.siat-title { font-weight: 650; letter-spacing: .1px; }
.siat-meta { color: #c3cad8; font-size: 12px; margin-top: 2px; word-break: break-word; }
.siat-close {
  flex: 0 0 auto; background: transparent; border: 0; color: #c3cad8; cursor: pointer;
  font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 6px;
}
.siat-close:hover { background: rgba(255,255,255,.12); color: #fff; }
.siat-close:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 1px; }
.siat-details { margin-top: 6px; }
.siat-details summary { cursor: pointer; color: #9fb3d9; font-size: 12px; user-select: none; }
.siat-details ul { margin: 6px 0 0; padding-left: 18px; color: #d7dce6; font-size: 12px; }
.siat-details li { margin-bottom: 3px; }
.siat-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.siat-btn {
  background: #2f6fdb; color: #fff; border: 0; border-radius: 7px; padding: 5px 10px;
  font: inherit; font-size: 12px; cursor: pointer;
}
.siat-btn[data-variant="ghost"] { background: rgba(255,255,255,.1); color: #e8ecf5; }
.siat-btn:hover { filter: brightness(1.08); }
.siat-btn:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 2px; }
.siat-spinner { transform-origin: 50% 50%; animation: siat-spin 1s linear infinite; }
@keyframes siat-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .siat-spinner { animation: none; } }
@media (max-width: 560px) {
  .siat-toast-stack { left: 8px; right: 8px; bottom: 8px; align-items: stretch; max-width: none; }
}
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Icons are built with createElementNS rather than innerHTML: this script runs
 * on arbitrary pages and the project keeps a hard "no HTML sinks" rule (enforced
 * by lint.mjs), so there is no path by which page text could reach a parser.
 */
function svgIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'siat-badge');
  const add = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    svg.appendChild(el);
    return el;
  };
  if (kind === 'progress') {
    add('circle', {
      class: 'siat-spinner', cx: 9, cy: 9, r: 7, fill: 'none', stroke: '#7aa2f7',
      'stroke-width': 2.4, 'stroke-dasharray': '30 14', 'stroke-linecap': 'round',
    });
  } else if (kind === 'error') {
    add('path', { d: 'M9 2.6 16.2 15H1.8z', fill: 'none', stroke: '#ff8f8f', 'stroke-width': 1.7, 'stroke-linejoin': 'round' });
    add('path', { d: 'M9 7v3.4', stroke: '#ff8f8f', 'stroke-width': 1.8, 'stroke-linecap': 'round' });
    add('circle', { cx: 9, cy: 12.7, r: 0.95, fill: '#ff8f8f' });
  } else {
    add('path', { d: 'M3 9.5 7 13.5 15 4.5', fill: 'none', stroke: '#59d98a', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  }
  return svg;
}

function createToaster(rootDocument = document) {
  let host = null;
  let shadow = null;
  let stack = null;
  const active = new Map();

  function ensureHost() {
    if (host && host.isConnected) return;
    host = rootDocument.getElementById(TOAST_HOST_ID);
    if (!host) {
      host = rootDocument.createElement('div');
      host.id = TOAST_HOST_ID;
      shadow = host.attachShadow({ mode: 'open' });
      const style = rootDocument.createElement('style');
      style.textContent = TOAST_STYLE;
      stack = rootDocument.createElement('div');
      stack.className = 'siat-toast-stack';
      shadow.appendChild(style);
      shadow.appendChild(stack);
      (rootDocument.documentElement || rootDocument.body).appendChild(host);
    } else if (!shadow) {
      shadow = host.shadowRoot;
      stack = shadow.querySelector('.siat-toast-stack');
    }
  }

  function dismiss(id) {
    const entry = active.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    try {
      entry.node.remove();
    } catch {
      /* noop */
    }
    active.delete(id);
  }

  function render(id, { kind, title, meta, notes, actions, ttl }) {
    ensureHost();
    const existing = active.get(id);
    if (existing) {
      clearTimeout(existing.timer);
      existing.node.remove();
      active.delete(id);
    }
    const node = rootDocument.createElement('div');
    node.className = 'siat-toast';
    node.dataset.kind = kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');

    node.appendChild(svgIcon(kind));

    const body = rootDocument.createElement('div');
    body.className = 'siat-body';
    const titleNode = rootDocument.createElement('div');
    titleNode.className = 'siat-title';
    titleNode.textContent = title;
    body.appendChild(titleNode);

    if (meta) {
      const metaNode = rootDocument.createElement('div');
      metaNode.className = 'siat-meta';
      metaNode.textContent = meta;
      body.appendChild(metaNode);
    }
    if (notes && notes.length) {
      const details = rootDocument.createElement('details');
      details.className = 'siat-details';
      const summary = rootDocument.createElement('summary');
      summary.textContent = `${notes.length} detail${notes.length === 1 ? '' : 's'}`;
      const list = rootDocument.createElement('ul');
      for (const note of notes) {
        const li = rootDocument.createElement('li');
        li.textContent = String(note);
        list.appendChild(li);
      }
      details.appendChild(summary);
      details.appendChild(list);
      body.appendChild(details);
    }
    if (actions && actions.length) {
      const row = rootDocument.createElement('div');
      row.className = 'siat-actions';
      for (const action of actions) {
        const button = rootDocument.createElement('button');
        button.type = 'button';
        button.className = 'siat-btn';
        if (action.variant) button.dataset.variant = action.variant;
        button.textContent = action.label;
        button.addEventListener('click', () => {
          dismiss(id);
          try {
            action.onClick();
          } catch {
            /* a broken action must not break the toast */
          }
        });
        row.appendChild(button);
      }
      body.appendChild(row);
    }
    node.appendChild(body);

    const close = rootDocument.createElement('button');
    close.type = 'button';
    close.className = 'siat-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(id));
    node.appendChild(close);

    stack.appendChild(node);
    const entry = { node, timer: null };
    active.set(id, entry);
    if (ttl) entry.timer = setTimeout(() => dismiss(id), ttl);
    // Never let toasts pile up without bound. The stack element can be shared
    // with a second instance of this script (installed in two managers, or
    // re-injected), so the bound is enforced on the nodes actually on screen
    // rather than only on this instance's own entries: the oldest node goes,
    // whoever owns it.
    while (stack.children.length > MAX_VISIBLE_TOASTS) {
      const oldestNode = stack.firstElementChild;
      if (!oldestNode || oldestNode === node) break;
      const owner = [...active].find(([, candidate]) => candidate.node === oldestNode);
      if (owner) dismiss(owner[0]);
      else oldestNode.remove();
    }
    return id;
  }

  return {
    progress(id, title, meta, notes, actions, ttl = 0) {
      return render(id, { kind: 'progress', title, meta, notes, actions, ttl });
    },
    success(id, title, meta, notes, actions, ttl = 9000) {
      return render(id, { kind: 'success', title, meta, notes, actions, ttl });
    },
    error(id, title, meta, notes, actions, ttl = 14000) {
      return render(id, { kind: 'error', title, meta, notes, actions, ttl });
    },
    dismiss,
    dismissAll() {
      for (const id of [...active.keys()]) dismiss(id);
    },
    get element() {
      ensureHost();
      return host;
    },
    destroy() {
      this.dismissAll();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      stack = null;
    },
  };
}

/* ── src/ui/picker.js ───────────────────────── */
/**
 * Page image picker.
 *
 * Answers "what images does this page actually have?" and lets the user choose
 * which ones to convert — the batch runner's front end, and useful on its own
 * for spotting icons, duplicates, lazy placeholders and cross-origin sources.
 *
 * Privacy and performance rules, all visible in the UI rather than hidden:
 *   - opening the picker issues **no** network requests. Thumbnails are drawn
 *     from pixels the page already decoded; anything not loaded shows a
 *     placeholder, and loading it is an explicit button press.
 *   - the inventory is re-scanned only when the DOM actually changes (scoped,
 *     debounced, capped MutationObserver) or when the user asks.
 *   - rendering is bounded: a page with 3 000 images shows the first rows and
 *     says how many were left out, instead of building 3 000 nodes.
 *   - selection survives a re-scan because it is keyed by the source URL or the
 *     element itself, not by a row position.
 */




const PICKER_HOST_ID = 'siat-picker-host';
const PICKER_MAX_ROWS = 200;
const THUMBNAIL_BATCH = 48;

const PICKER_STYLE = `
.siat-toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; padding: 10px 0 4px; }
.siat-toolbar .siat-field { margin-bottom: 0; }
.siat-toolbar input[type="search"], .siat-toolbar input[type="number"] { max-width: 150px; }
.siat-filters { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 4px 0 8px; }
.siat-filters .siat-check { padding: 3px 6px; }
.siat-count { font-size: 12px; color: #5c6472; padding: 2px 0 8px; }
@media (prefers-color-scheme: dark) { .siat-count { color: #a3acbb; } }
.siat-row-thumb-empty { display: flex; align-items: center; justify-content: center; font-size: 9.5px; color: #5c6472; text-align: center; }
.siat-row-actions { display: flex; gap: 4px; flex: 0 0 auto; }
.siat-mini-btn {
  font: inherit; font-size: 11px; padding: 3px 7px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.08); color: inherit;
}
.siat-mini-btn:hover { filter: brightness(1.06); }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {(options: object) => object} deps.scan          core/scan.js scanImages bound to the document
 * @param {() => object} deps.settings
 * @param {() => Array<{id: string, label: string, ext: string, disabled?: boolean, hint?: string}>} deps.formats
 * @param {object} deps.actions   {convert, copy, inspect, transform, compare, loadNotLoaded}
 */
function createImagePicker(deps) {
  const doc = deps.document || document;
  const selected = new Map();
  let entries = [];
  let visible = [];
  let notes = [];
  let truncated = false;
  let observer = null;
  let generation = 0;
  let listEl = null;
  let summaryEl = null;
  let countEl = null;
  let formatSelect = null;
  let saveButton = null;
  let zipButton = null;
  let loadButton = null;
  let selectionLabel = null;
  let filterState = {
    query: '',
    minWidth: 0,
    minHeight: 0,
    kinds: [],
    sameOriginOnly: false,
    loadedOnly: false,
    excludeTiny: true,
    dedupe: true,
  };
  let sortKey = 'area-desc';

  const dialog = createDialog({
    document: doc,
    hostId: PICKER_HOST_ID,
    marker: 'picker',
    titleId: 'siat-picker-title',
    title: 'Images on this page',
    closeLabel: 'Close image picker',
    width: 'wide',
    extraStyle: PICKER_STYLE,
    focus: 'first',
    onClose() {
      stopObserving();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      generation += 1;

      summaryEl = dialogEl(doc, 'p', { className: 'siat-count', id: 'siat-picker-summary', text: 'Scanning…' });
      body.appendChild(summaryEl);
      body.appendChild(buildToolbar());
      body.appendChild(buildFilters());
      countEl = dialogEl(doc, 'p', { className: 'siat-count', id: 'siat-picker-count', text: '' });
      body.appendChild(countEl);

      listEl = dialogEl(doc, 'ul', { className: 'siat-listbox', id: 'siat-pick-list', attrs: { 'aria-label': 'Images found on this page' } });
      body.appendChild(listEl);

      selectionLabel = dialogEl(doc, 'span', { className: 'siat-note', id: 'siat-picker-selection', text: 'Nothing selected' });
      foot.appendChild(selectionLabel);
      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));

      const selectAll = dialogButton(doc, 'Select all listed', 'ghost', () => {
        for (const entry of visible) setSelected(entry, true);
        renderList();
      });
      selectAll.id = 'siat-pick-selectall';
      const clearAll = dialogButton(doc, 'Clear', 'ghost', () => {
        selected.clear();
        renderList();
      });
      clearAll.id = 'siat-pick-clear';
      foot.appendChild(selectAll);
      foot.appendChild(clearAll);

      loadButton = dialogButton(doc, 'Load selected images first', 'ghost', () => onLoadSelected());
      loadButton.id = 'siat-pick-load';
      loadButton.title = 'Downloads the selected images the page has not loaded yet, then lists them again.';
      foot.appendChild(loadButton);

      const inspectButton = dialogButton(doc, 'Inspect', 'ghost', () => singleAction('inspect'));
      inspectButton.id = 'siat-pick-inspect';
      const compareButton = dialogButton(doc, 'Compare', 'ghost', () => singleAction('compare'));
      compareButton.id = 'siat-pick-compare';
      const transformButton = dialogButton(doc, 'Transform…', 'ghost', () => singleAction('transform'));
      transformButton.id = 'siat-pick-transform';
      const copyButton = dialogButton(doc, 'Copy', 'ghost', () => singleAction('copy'));
      copyButton.id = 'siat-pick-copy';
      foot.appendChild(inspectButton);
      foot.appendChild(compareButton);
      foot.appendChild(transformButton);
      foot.appendChild(copyButton);

      formatSelect = dialogSelectControl(
        doc,
        (deps.formats ? deps.formats() : []).map((format) => ({ value: format.id, label: format.label, disabled: format.disabled })),
        defaultFormatId(),
      );
      formatSelect.id = 'siat-pick-format';
      formatSelect.setAttribute('aria-label', 'Output format for the selection');
      foot.appendChild(formatSelect);

      saveButton = dialogButton(doc, 'Save selected', 'primary', () => onConvert('files'));
      saveButton.id = 'siat-pick-save';
      zipButton = dialogButton(doc, 'Save as ZIP', 'ghost', () => onConvert('zip'));
      zipButton.id = 'siat-pick-zip';
      foot.appendChild(saveButton);
      foot.appendChild(zipButton);

      const cancelButton = dialogButton(doc, 'Close', 'ghost', () => dialog.close());
      cancelButton.id = 'siat-pick-close';
      foot.appendChild(cancelButton);

      rescan({ initial: true });
      startObserving();
    },
  });

  function buildToolbar() {
    const toolbar = dialogEl(doc, 'div', { className: 'siat-toolbar' });

    const search = dialogTextControl(doc, filterState.query, { type: 'search', placeholder: 'Filter by name, alt text or host', autocomplete: 'off' });
    search.addEventListener('input', () => {
      filterState.query = search.value;
      applyFilters();
    });
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-search', label: 'Search', control: search }));

    const minWidth = dialogTextControl(doc, filterState.minWidth || '', { type: 'number', min: 0, max: 20000, step: 10, placeholder: '0' });
    minWidth.addEventListener('input', () => {
      filterState.minWidth = Number(minWidth.value) || 0;
      applyFilters();
    });
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-minw', label: 'Min width', control: minWidth }));

    const minHeight = dialogTextControl(doc, filterState.minHeight || '', { type: 'number', min: 0, max: 20000, step: 10, placeholder: '0' });
    minHeight.addEventListener('input', () => {
      filterState.minHeight = Number(minHeight.value) || 0;
      applyFilters();
    });
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-minh', label: 'Min height', control: minHeight }));

    const kind = dialogSelectControl(
      doc,
      [
        { value: '', label: 'All kinds' },
        { value: 'img', label: '<img> elements' },
        { value: 'background', label: 'CSS backgrounds' },
        { value: 'svg', label: 'Inline SVG' },
        { value: 'poster', label: 'Video posters' },
      ],
      filterState.kinds.length ? filterState.kinds[0] : '',
      (value) => {
        filterState.kinds = value ? [value] : [];
        applyFilters();
      },
    );
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-kind', label: 'Kind', control: kind }));

    const sort = dialogSelectControl(
      doc,
      [
        { value: 'area-desc', label: 'Largest first' },
        { value: 'area-asc', label: 'Smallest first' },
        { value: 'name', label: 'By name' },
        { value: 'type', label: 'By type' },
        { value: 'state', label: 'By state' },
        { value: 'order', label: 'Page order' },
      ],
      sortKey,
      (value) => {
        sortKey = value;
        applyFilters();
      },
    );
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-sort', label: 'Sort', control: sort }));

    const refresh = dialogButton(doc, 'Re-scan', 'ghost', () => rescan({}));
    refresh.id = 'siat-pick-refresh';
    toolbar.appendChild(refresh);
    return toolbar;
  }

  function buildFilters() {
    const wrap = dialogEl(doc, 'div', { className: 'siat-filters' });
    const toggles = [
      { id: 'siat-pick-notiny', label: 'Hide icons', key: 'excludeTiny' },
      { id: 'siat-pick-dedupe', label: 'One row per URL', key: 'dedupe' },
      { id: 'siat-pick-loaded', label: 'Loaded only', key: 'loadedOnly' },
      { id: 'siat-pick-sameorigin', label: 'Same origin only', key: 'sameOriginOnly' },
    ];
    for (const toggle of toggles) {
      wrap.appendChild(
        dialogCheckboxRow(doc, {
          id: toggle.id,
          label: toggle.label,
          checked: filterState[toggle.key],
          onChange: (checked) => {
            filterState[toggle.key] = checked;
            applyFilters();
          },
        }),
      );
    }
    return wrap;
  }

  function rescan({ initial = false } = {}) {
    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const result = deps.scan({
      includeBackgrounds: settings.scanBackgrounds !== false,
      maxStyleScan: Number(settings.scanElementCap) || 2500,
      maxEntries: 1000,
    });
    entries = result.entries || [];
    notes = (result.notes || []).slice();
    truncated = Boolean(result.truncated);
    applyFilters();
    if (initial) {
      const settingsSummary = [];
      if (filterState.excludeTiny) settingsSummary.push('icons hidden');
      if (filterState.dedupe) settingsSummary.push('duplicates merged');
      if (settingsSummary.length && countEl) countEl.textContent = `Default view: ${settingsSummary.join(', ')}. Change the filters above to see more.`;
    }
  }

  function applyFilters() {
    let list = filterEntries(entries, filterState);
    if (filterState.dedupe !== false) list = dedupeEntries(list);
    visible = sortEntries(list, sortKey);
    renderSummary();
    renderList();
  }

  function renderSummary() {
    if (!summaryEl) return;
    const all = summarizeInventory(entries);
    const shown = summarizeInventory(visible);
    const parts = [`${all.total} found`, `${all.loaded} loaded`];
    if (all.notLoaded) parts.push(`${all.notLoaded} not loaded`);
    if (all.broken) parts.push(`${all.broken} broken`);
    if (all.crossOrigin) parts.push(`${all.crossOrigin} cross-origin`);
    if (all.tiny) parts.push(`${all.tiny} icon-sized`);
    if (all.uniqueUrls !== all.total) parts.push(`${all.uniqueUrls} distinct URLs`);
    parts.push(`${shown.total} listed`);
    if (selected.size) parts.push(`${selected.size} selected`);
    summaryEl.textContent = parts.join(' · ');
    if (truncated) summaryEl.textContent += ' — the page was too large to list completely.';
  }

  function renderList() {
    if (!listEl) return;
    const shown = generation;
    listEl.textContent = '';
    const slice = visible.slice(0, PICKER_MAX_ROWS);
    if (!slice.length) {
      const empty = dialogEl(doc, 'li', {
        className: 'siat-empty',
        text: entries.length ? 'No image matches these filters.' : 'No images were found on this page.',
      });
      listEl.appendChild(empty);
    }
    for (const entry of slice) listEl.appendChild(renderRow(entry));
    if (visible.length > slice.length) {
      listEl.appendChild(
        dialogEl(doc, 'li', {
          className: 'siat-empty',
          text: `${visible.length - slice.length} more match — narrow the filters to see them.`,
        }),
      );
    }
    if (notes.length) {
      dialog.showBanner('', 'About this scan', notes);
    }
    updateSelectionLabel();
    requestThumbnails(slice, shown);
  }

  function renderRow(entry) {
    const isSelected = selected.has(keyOf(entry));
    const row = dialogEl(doc, 'li', {
      className: 'siat-row',
      dataset: { selected: isSelected ? 'true' : 'false', id: entry.id, kind: entry.kind, state: entry.state },
    });
    row.id = `siat-pick-row-${entry.id}`;

    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isSelected;
    checkbox.id = `siat-pick-check-${entry.id}`;
    checkbox.setAttribute('aria-label', describeEntry(entry));
    checkbox.addEventListener('change', () => {
      setSelected(entry, checkbox.checked);
      row.dataset.selected = checkbox.checked ? 'true' : 'false';
      renderSummary();
    });
    row.appendChild(checkbox);

    const thumb = dialogEl(doc, 'span', {
      className: 'siat-row-thumb siat-row-thumb-empty',
      attrs: { 'aria-hidden': 'true', title: 'No preview without downloading the image' },
    });
    thumb.id = `siat-pick-thumb-${entry.id}`;
    thumb.textContent = entry.state === 'loaded' ? '…' : 'no preview';
    row.appendChild(thumb);

    const main = dialogEl(doc, 'span', { className: 'siat-row-main' });
    main.appendChild(dialogEl(doc, 'span', { className: 'siat-row-title', text: titleOf(entry) }));
    main.appendChild(dialogEl(doc, 'span', { className: 'siat-row-meta', text: metaOf(entry) }));
    row.appendChild(main);

    const badges = dialogEl(doc, 'span', { className: 'siat-row-actions' });
    if (!entry.sameOrigin && entry.kind !== 'svg') badges.appendChild(badge('cross-origin', 'warn'));
    if (entry.state === 'lazy' || entry.state === 'not-loaded') badges.appendChild(badge('not loaded', 'warn'));
    if (entry.state === 'broken') badges.appendChild(badge('broken', 'bad'));
    if (entry.state === 'loaded') badges.appendChild(badge('ready', 'good'));
    if (entry.largest) badges.appendChild(badge(`up to ${entry.largest.width}px`, 'good'));
    if (entry.tiny) badges.appendChild(badge('icon', ''));
    row.appendChild(badges);

    const openButton = dialogEl(doc, 'button', {
      className: 'siat-mini-btn',
      text: 'This one',
      attrs: { type: 'button', title: 'Convert just this image', 'aria-label': `Convert ${titleOf(entry)}` },
    });
    openButton.id = `siat-pick-one-${entry.id}`;
    openButton.addEventListener('click', () => {
      selected.clear();
      setSelected(entry, true);
      // onConvert(destination, explicitFormat): the row converts this one image
      // as separate files, in the format chosen in the footer.
      onConvert('files', formatSelect ? formatSelect.value : defaultFormatId());
    });
    row.appendChild(openButton);
    return row;
  }

  function badge(text, tone) {
    const node = dialogEl(doc, 'span', { className: 'siat-badge', text });
    if (tone) node.dataset.tone = tone;
    return node;
  }

  function requestThumbnails(slice, shown) {
    if (typeof deps.thumbnail !== 'function') return;
    const queue = slice.filter((entry) => entry.state === 'loaded' || entry.kind === 'svg');
    let index = 0;
    const next = async () => {
      while (index < queue.length && index < THUMBNAIL_BATCH) {
        const entry = queue[index];
        index += 1;
        if (generation !== shown || !dialog.isOpen) return;
        try {
          const result = await deps.thumbnail(entry);
          if (generation !== shown || !dialog.isOpen) return;
          const slot = listEl && listEl.querySelector(`#siat-pick-thumb-${cssEscape(entry.id)}`);
          if (!slot) return;
          if (result && result.dataUrl) {
            const image = doc.createElement('img');
            image.className = 'siat-row-thumb';
            image.src = result.dataUrl;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            slot.replaceWith(image);
            image.id = `siat-pick-thumb-${entry.id}`;
          } else {
            slot.textContent = 'no preview';
            slot.title = (result && result.reason) || 'No preview available.';
          }
        } catch {
          /* a failed preview is cosmetic; the row still works */
        }
      }
    };
    setTimeout(() => {
      next().catch(() => {});
    }, 0);
  }

  function setSelected(entry, value) {
    const key = keyOf(entry);
    if (value) selected.set(key, entry);
    else selected.delete(key);
    updateSelectionLabel();
  }

  function updateSelectionLabel() {
    if (!selectionLabel) return;
    const count = selected.size;
    const notLoaded = [...selected.values()].filter((entry) => entry.state !== 'loaded').length;
    selectionLabel.textContent = count
      ? `${count} selected${notLoaded ? ` (${notLoaded} not loaded yet)` : ''}`
      : 'Nothing selected';
    if (saveButton) saveButton.textContent = count ? `Save ${count}` : 'Save selected';
    if (zipButton) zipButton.textContent = count ? `ZIP ${count}` : 'Save as ZIP';
    if (loadButton) loadButton.style.display = notLoaded ? '' : 'none';
  }

  function selectedEntries() {
    return [...selected.values()];
  }

  function singleAction(name) {
    const list = selectedEntries();
    if (list.length !== 1) {
      dialog.showBanner('error', `Select exactly one image`, [
        list.length ? `${list.length} images are selected; "${name}" works on one at a time.` : 'Tick one image in the list first.',
      ]);
      return;
    }
    const action = deps.actions && deps.actions[name];
    if (typeof action !== 'function') return;
    dialog.close();
    action(list[0]);
  }

  function onConvert(destination, explicitFormat) {
    const list = selectedEntries();
    if (!list.length) {
      dialog.showBanner('error', 'Nothing selected', ['Tick at least one image, or press "Select all listed".']);
      return;
    }
    const formatId = explicitFormat || (formatSelect ? formatSelect.value : defaultFormatId());
    if (typeof deps.actions === 'object' && deps.actions && typeof deps.actions.convert === 'function') {
      dialog.close();
      deps.actions.convert({ entries: list, formatId, destination });
    }
  }

  async function onLoadSelected() {
    const list = selectedEntries().filter((entry) => entry.state !== 'loaded');
    if (!list.length || typeof deps.actions !== 'object' || !deps.actions || typeof deps.actions.loadNotLoaded !== 'function') return;
    loadButton.disabled = true;
    loadButton.textContent = 'Loading…';
    try {
      await deps.actions.loadNotLoaded(list);
    } finally {
      rescan({});
      if (loadButton) {
        loadButton.disabled = false;
        loadButton.textContent = 'Load selected images first';
      }
    }
  }

  function startObserving() {
    stopObserving();
    observer = observeInventory(doc, () => {
      if (!dialog.isOpen) return;
      rescan({});
    }, { debounceMs: 500, maxNotifications: 30 });
  }

  function stopObserving() {
    if (observer && typeof observer.disconnect === 'function') observer.disconnect();
    observer = null;
  }

  function defaultFormatId() {
    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const formats = deps.formats ? deps.formats() : [];
    const enabled = formats.filter((format) => !format.disabled);
    if (settings.activeFormatId && enabled.some((format) => format.id === settings.activeFormatId)) return settings.activeFormatId;
    const preferred = (settings.formats || []).find((id) => enabled.some((format) => format.id === id && id !== 'original'));
    return preferred || (enabled[0] ? enabled[0].id : 'png');
  }

  function keyOf(entry) {
    if (entry && entry.url) return `url:${entry.url}`;
    return entry && entry.element ? entry.element : `id:${entry ? entry.id : 'unknown'}`;
  }

  function titleOf(entry) {
    if (entry.kind === 'svg') return entry.alt || 'Inline SVG image';
    const fromUrl = String(entry.url || '').split('/').pop().split('?')[0];
    return fromUrl || entry.alt || entry.title || `${entry.kind} image`;
  }

  function metaOf(entry) {
    const parts = [];
    if (entry.natural && entry.natural.width) parts.push(`${entry.natural.width}×${entry.natural.height}px`);
    else if (entry.displayed && entry.displayed.width) parts.push(`${entry.displayed.width}×${entry.displayed.height} displayed`);
    if (entry.mime) parts.push(entry.mime.replace('image/', ''));
    parts.push(describeEntryState(entry));
    if (entry.host) parts.push(entry.host);
    if (entry.frame && entry.frame !== 'this page') parts.push(entry.frame);
    return parts.filter(Boolean).join(' · ');
  }

  function describeEntry(entry) {
    return `${titleOf(entry)}, ${metaOf(entry)}`;
  }

  return {
    open(options = {}) {
      if (options.filter) filterState = Object.assign({}, filterState, options.filter);
      if (options.sort) sortKey = options.sort;
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    refresh: () => rescan({}),
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Test/automation seam: the entries currently listed and selected. */
    state: () => ({
      found: entries.length,
      listed: visible.length,
      selected: selectedEntries().map((entry) => ({ id: entry.id, url: entry.url, kind: entry.kind, state: entry.state })),
      truncated,
      notes,
    }),
    destroy() {
      stopObserving();
      selected.clear();
      dialog.destroy();
    },
  };
}

function cssEscape(value) {
  const text = String(value || '');
  return typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function' ? CSS.escape(text) : text.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/* ── src/ui/jobbar.js ───────────────────────── */
/**
 * Batch job bar.
 *
 * A long-running, many-step action needs visible state: how far along it is,
 * which item failed and why, and a way to stop. This is that surface.
 *
 * Placement is bottom-left because toasts already own bottom-right; the bar is
 * collapsible so it cannot trap the user, and it never intercepts pointer events
 * outside its own box.
 *
 * Accessibility: the summary line is an aria-live region (polite — a batch of
 * 200 items must not become a machine-gun announcement), the progress element
 * carries real valuemin/valuemax/valuenow, and every control is a real button.
 * Per-item rows live in a disclosure so the DOM stays bounded.
 */



const JOBBAR_HOST_ID = 'siat-jobbar-host';
const MAX_ROWS = 40;

const JOBBAR_STYLE = `
.siat-jobbar {
  position: fixed; left: 14px; bottom: 14px; z-index: 2147483645;
  width: min(360px, calc(100vw - 28px)); max-height: min(60vh, 460px);
  display: flex; flex-direction: column;
  background: #fff; color: #16181d; border: 1px solid rgba(0,0,0,.16); border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0,0,0,.34); overflow: hidden;
  font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .siat-jobbar { background: #1e2128; color: #edf0f6; border-color: rgba(255,255,255,.16); }
}
.siat-jobbar[data-collapsed="true"] .siat-jobbar-body { display: none; }
.siat-jobbar-head { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-bottom: 1px solid rgba(127,127,127,.22); }
.siat-jobbar-title { font-weight: 680; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.siat-jobbar-body { padding: 9px 11px 11px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.siat-jobbar-bar { height: 7px; border-radius: 999px; background: rgba(127,127,127,.22); overflow: hidden; }
.siat-jobbar-fill { height: 100%; width: 0%; background: #2f6fdb; transition: width .18s ease; }
.siat-jobbar-fill[data-state="done"] { background: #1a7f37; }
.siat-jobbar-fill[data-state="cancelled"] { background: #b4232a; }
.siat-jobbar-status { color: #5c6472; font-size: 11.5px; }
@media (prefers-color-scheme: dark) { .siat-jobbar-status { color: #a3acbb; } }
.siat-jobbar-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.siat-jobbar-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.siat-jobbar-item { display: flex; gap: 7px; align-items: baseline; font-size: 11.5px; }
.siat-jobbar-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.siat-jobbar-item-state { flex: 0 0 auto; font-weight: 650; }
.siat-jobbar-item-state[data-state="done"] { color: #1a7f37; }
.siat-jobbar-item-state[data-state="failed"] { color: #b4232a; }
.siat-jobbar-item-state[data-state="running"] { color: #2f6fdb; }
.siat-jobbar-item-state[data-state="skipped"], .siat-jobbar-item-state[data-state="cancelled"] { color: #6b7280; }
@media (prefers-color-scheme: dark) {
  .siat-jobbar-item-state[data-state="done"] { color: #56d364; }
  .siat-jobbar-item-state[data-state="failed"] { color: #ff8f8f; }
}
.siat-jobbar details summary { cursor: pointer; font-size: 11.5px; color: #5c6472; }
@media (prefers-color-scheme: dark) { .siat-jobbar details summary { color: #a3acbb; } }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onCancel]
 * @param {() => void} [deps.onRetry]
 * @param {() => void} [deps.onClose]
 */
function createJobBar(deps = {}) {
  const doc = deps.document || document;
  let host = null;
  let shadow = null;
  let bar = null;
  let titleEl = null;
  let fillEl = null;
  let progressEl = null;
  let statusEl = null;
  let listEl = null;
  let listWrap = null;
  let summaryEl = null;
  let cancelButton = null;
  let retryButton = null;
  let closeButton = null;
  let collapseButton = null;
  let attached = false;
  let lastStats = null;

  function ensureHost() {
    if (host && host.isConnected && shadow) return;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(JOBBAR_HOST_ID) : null;
    if (existing) existing.remove();
    host = doc.createElement('div');
    host.id = JOBBAR_HOST_ID;
    host.setAttribute('data-siat', 'jobbar');
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = ':host { all: initial; }\n' + JOBBAR_STYLE;
    shadow.appendChild(style);
    const root = doc.documentElement || doc.body;
    if (root) root.appendChild(host);
    build();
  }

  function build() {
    bar = dialogEl(doc, 'div', { className: 'siat-jobbar', attrs: { role: 'group', 'aria-label': 'Batch conversion progress' } });

    const head = dialogEl(doc, 'div', { className: 'siat-jobbar-head' });
    titleEl = dialogEl(doc, 'span', { className: 'siat-jobbar-title', text: 'Batch conversion' });
    head.appendChild(titleEl);
    collapseButton = dialogEl(doc, 'button', {
      className: 'siat-icon-btn',
      text: '–',
      attrs: { type: 'button', 'aria-label': 'Collapse progress panel', 'aria-expanded': 'true' },
    });
    collapseButton.addEventListener('click', () => {
      const collapsed = bar.dataset.collapsed === 'true';
      bar.dataset.collapsed = collapsed ? 'false' : 'true';
      collapseButton.textContent = collapsed ? '–' : '+';
      collapseButton.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
      collapseButton.setAttribute('aria-label', collapsed ? 'Collapse progress panel' : 'Expand progress panel');
    });
    head.appendChild(collapseButton);
    bar.appendChild(head);

    const body = dialogEl(doc, 'div', { className: 'siat-jobbar-body' });

    const barTrack = dialogEl(doc, 'div', { className: 'siat-jobbar-bar' });
    fillEl = dialogEl(doc, 'div', { className: 'siat-jobbar-fill' });
    barTrack.appendChild(fillEl);
    progressEl = barTrack;
    body.appendChild(barTrack);

    statusEl = dialogEl(doc, 'div', { className: 'siat-jobbar-status', attrs: { role: 'status', 'aria-live': 'polite', id: 'siat-jobbar-status' } });
    statusEl.textContent = 'Preparing…';
    body.appendChild(statusEl);

    const actions = dialogEl(doc, 'div', { className: 'siat-jobbar-actions' });
    cancelButton = dialogButton(doc, 'Cancel', 'danger', () => {
      if (typeof deps.onCancel === 'function') deps.onCancel();
    });
    cancelButton.id = 'siat-jobbar-cancel';
    retryButton = dialogButton(doc, 'Retry failed', 'ghost', () => {
      if (typeof deps.onRetry === 'function') deps.onRetry();
    });
    retryButton.id = 'siat-jobbar-retry';
    retryButton.disabled = true;
    closeButton = dialogButton(doc, 'Close', 'ghost', () => {
      hide();
      if (typeof deps.onClose === 'function') deps.onClose();
    });
    closeButton.id = 'siat-jobbar-close';
    closeButton.style.display = 'none';
    actions.appendChild(cancelButton);
    actions.appendChild(retryButton);
    actions.appendChild(closeButton);
    body.appendChild(actions);

    listWrap = doc.createElement('details');
    summaryEl = doc.createElement('summary');
    summaryEl.textContent = 'Details';
    summaryEl.id = 'siat-jobbar-summary';
    listWrap.appendChild(summaryEl);
    listEl = dialogEl(doc, 'ul', { className: 'siat-jobbar-list', attrs: { 'aria-label': 'Per-image results' } });
    listEl.id = 'siat-jobbar-list';
    listWrap.appendChild(listEl);
    body.appendChild(listWrap);

    bar.appendChild(body);
    shadow.appendChild(bar);
  }

  /** Make the bar visible and reset it for a new run. */
  function show(title) {
    ensureHost();
    attached = true;
    host.style.display = '';
    bar.dataset.collapsed = 'false';
    if (collapseButton) collapseButton.textContent = '–';
    titleEl.textContent = String(title || 'Batch conversion');
    statusEl.textContent = 'Preparing…';
    fillEl.style.width = '0%';
    fillEl.dataset.state = 'running';
    listEl.textContent = '';
    listWrap.open = false;
    summaryEl.textContent = 'Details';
    cancelButton.disabled = false;
    cancelButton.style.display = '';
    retryButton.disabled = true;
    closeButton.style.display = 'none';
    return bar;
  }

  function summaryText() {
    if (!lastStats) return 'Details';
    const parts = [];
    if (lastStats.done) parts.push(`${lastStats.done} saved`);
    if (lastStats.failed) parts.push(`${lastStats.failed} failed`);
    if (lastStats.skipped) parts.push(`${lastStats.skipped} skipped`);
    if (lastStats.cancelled) parts.push(`${lastStats.cancelled} cancelled`);
    if (lastStats.queued || lastStats.running) parts.push(`${lastStats.queued + lastStats.running} to go`);
    return parts.length ? `Details (${parts.join(', ')})` : 'Details';
  }

  /**
   * Update from a queue snapshot. Cheap enough to call per item: rows are capped
   * and only the visible slice is rewritten.
   */
  function update(stats, items) {
    if (!attached || !bar) return;
    lastStats = stats;
    const total = Math.max(1, stats.total || 1);
    const finished = (stats.done || 0) + (stats.failed || 0) + (stats.skipped || 0) + (stats.cancelled || 0);
    const percent = Math.min(100, Math.round((finished / total) * 100));
    fillEl.style.width = `${percent}%`;
    progressEl.setAttribute('role', 'progressbar');
    progressEl.setAttribute('aria-valuemin', '0');
    progressEl.setAttribute('aria-valuemax', String(total));
    progressEl.setAttribute('aria-valuenow', String(finished));
    progressEl.setAttribute('aria-labelledby', 'siat-jobbar-status');

    const bits = [`${finished}/${total}`];
    if (stats.running) bits.push(`${stats.running} running`);
    if (stats.done) bits.push(`${stats.done} saved`);
    if (stats.failed) bits.push(`${stats.failed} failed`);
    if (stats.skipped) bits.push(`${stats.skipped} skipped`);
    if (stats.cancelled) bits.push(`${stats.cancelled} cancelled`);
    if (stats.bytes) bits.push(formatSize(stats.bytes));
    statusEl.textContent = `${titleEl.textContent}: ${bits.join(' · ')}`;

    if (summaryEl) summaryEl.textContent = summaryText();
    const interesting = (items || []).filter((item) => item.state !== 'queued').slice(-MAX_ROWS);
    listEl.textContent = '';
    for (const item of interesting) {
      const row = dialogEl(doc, 'li', { className: 'siat-jobbar-item' });
      const name = dialogEl(doc, 'span', { className: 'siat-jobbar-item-name', text: item.label });
      name.title = item.state === 'failed' ? `${item.label}: ${item.error || item.errorCode}` : item.label;
      row.appendChild(name);
      row.appendChild(
        dialogEl(doc, 'span', {
          className: 'siat-jobbar-item-state',
          dataset: { state: item.state },
          text: stateLabel(item),
        }),
      );
      listEl.appendChild(row);
    }

    const running = stats.state === 'running' || stats.state === 'paused';
    cancelButton.disabled = !running;
    cancelButton.style.display = running ? '' : 'none';
    retryButton.disabled = !(stats.failed > 0);
    retryButton.style.display = stats.failed > 0 ? '' : 'none';
    if (stats.complete || stats.state === 'cancelled' || stats.state === 'done') {
      closeButton.style.display = '';
      fillEl.dataset.state = stats.cancelled ? 'cancelled' : stats.failed ? 'done' : 'done';
    }
  }

  function stateLabel(item) {
    if (item.state === 'done') return 'saved';
    if (item.state === 'failed') return item.uncertain ? 'unknown' : 'failed';
    if (item.state === 'skipped') return 'skipped';
    if (item.state === 'cancelled') return 'cancelled';
    if (item.state === 'running') return 'working…';
    return 'queued';
  }

  /** Replace the status line with a final summary and show the Close button. */
  function finish(summaryTextValue, { failed = 0 } = {}) {
    if (!attached || !statusEl) return;
    statusEl.textContent = String(summaryTextValue || 'Finished.');
    cancelButton.style.display = 'none';
    cancelButton.disabled = true;
    closeButton.style.display = '';
    retryButton.disabled = !(failed > 0);
    retryButton.style.display = failed > 0 ? '' : 'none';
    fillEl.dataset.state = failed ? 'done' : 'done';
  }

  function hide() {
    attached = false;
    if (host) host.style.display = 'none';
  }

  return {
    show,
    update,
    finish,
    hide,
    get isOpen() {
      return attached;
    },
    get element() {
      return bar;
    },
    get shadowRoot() {
      return shadow;
    },
    get host() {
      return host;
    },
    destroy() {
      hide();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      bar = null;
      attached = false;
      lastStats = null;
    },
  };
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

/* ── src/ui/transform-dialog.js ───────────────────────── */
/**
 * Transform dialog: resize, crop, rotate, flip — with a live preview.
 *
 * The preview is drawn from a proportionally scaled copy of the source, so
 * dragging a crop box stays responsive on a 40-megapixel photo; the exact output
 * size shown next to it is computed from the real pixel dimensions by
 * `planTransform`, never from the preview. What you see is a scaled rendering of
 * what you get, and the numbers beside it are the truth.
 *
 * Interaction covers mouse, touch (pointer events) and keyboard: the crop box is
 * focusable and moves with the arrow keys (Shift = resize instead of move), and
 * every value also has a numeric field, so the dialog is usable without a
 * pointing device.
 */




const TRANSFORM_HOST_ID = 'siat-transform-host';
const PREVIEW_MAX = 420;
const PREVIEW_MAX_HEIGHT = 300;

const TRANSFORM_STYLE = `
.siat-tf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 14px; }
.siat-tf-output { font-size: 12.5px; padding: 8px 10px; border-radius: 9px; background: rgba(127,127,127,.1); margin: 8px 0; }
.siat-tf-warn { color: #b4232a; font-size: 12px; margin: 4px 0 0; }
@media (prefers-color-scheme: dark) { .siat-tf-warn { color: #ff8f8f; } }
.siat-tf-rotate { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.siat-cropwrap:focus-visible { outline: 2px solid #2f6fdb; outline-offset: 2px; }
.siat-cropdims { position: absolute; left: 4px; bottom: -18px; font-size: 10.5px; color: #edf0f6; background: rgba(10,12,18,.72); padding: 1px 5px; border-radius: 5px; line-height: 1.4; }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => object} deps.settings
 * @param {() => Array<{id: string, label: string, disabled?: boolean}>} deps.formats
 * @param {(target: object) => Promise<{drawable: object, width: number, height: number, release?: () => void}>} deps.loadPreview
 * @param {(payload: {target: object, transform: object, formatId: string, makeDefault: boolean}) => void} deps.onSubmit
 * @param {(w: number, h: number, options?: object) => {canvas: object, ctx: object}} [deps.createCanvas]
 */
function createTransformDialog(deps) {
  const doc = deps.document || document;
  let target = null;
  let source = null; // {drawable, width, height, release}
  let previewCanvas = null;
  let previewEl = null;
  let previewScale = 1;
  let spec = cloneSpec(TRANSFORM_DEFAULTS);
  let cropEnabled = false;
  let controls = {};
  let outputEl = null;
  let warnEl = null;
  let previewHost = null;
  let cropBox = null;
  let cropHandle = null;
  let cropDims = null;
  let loading = false;
  let previewGeneration = 0;

  const dialog = createDialog({
    document: doc,
    hostId: TRANSFORM_HOST_ID,
    marker: 'transform',
    titleId: 'siat-transform-title',
    title: 'Transform and save',
    closeLabel: 'Close transform dialog',
    width: 'wide',
    extraStyle: TRANSFORM_STYLE,
    focus: 'first',
    onClose() {
      previewGeneration += 1;
      loading = false;
      releaseSource();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      controls = {};

      const previewSection = dialogEl(doc, 'fieldset', { className: 'siat-section' });
      previewSection.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Preview' }));
      previewHost = dialogEl(doc, 'div', { className: 'siat-preview', id: 'siat-tf-preview', attrs: { 'aria-label': 'Transform preview' } });
      previewSection.appendChild(previewHost);
      outputEl = dialogEl(doc, 'div', { className: 'siat-tf-output', id: 'siat-tf-output', text: 'Loading image…' });
      previewSection.appendChild(outputEl);
      warnEl = dialogEl(doc, 'p', { className: 'siat-tf-warn', id: 'siat-tf-warn', text: '' });
      previewSection.appendChild(warnEl);
      body.appendChild(previewSection);

      body.appendChild(buildResizeSection());
      body.appendChild(buildCropSection());
      body.appendChild(buildRotateSection());
      body.appendChild(buildOutputSection());

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-note', text: 'Applied to pixels, so the saved file is re-encoded.' }));
      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      const resetButton = dialogButton(doc, 'Reset', 'ghost', () => {
        spec = cloneSpec(TRANSFORM_DEFAULTS);
        cropEnabled = false;
        syncControls();
        refresh();
      });
      resetButton.id = 'siat-tf-reset';
      foot.appendChild(resetButton);
      const defaultButton = dialogButton(doc, 'Make default', 'ghost', () => submit(true));
      defaultButton.id = 'siat-tf-makedefault';
      defaultButton.title = 'Use this transform for every conversion until you change it in settings.';
      foot.appendChild(defaultButton);
      foot.appendChild(dialogButton(doc, 'Cancel', 'ghost', () => dialog.close()));
      const saveButton = dialogButton(doc, 'Save', 'primary', () => submit(false));
      saveButton.id = 'siat-tf-save';
      foot.appendChild(saveButton);

      syncControls();
      loadSource();
    },
  });

  function buildResizeSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Resize' }));

    const preset = dialogSelectControl(
      doc,
      RESIZE_PRESETS.map((entry) => ({ value: entry.id, label: entry.label })),
      'none',
      (value) => {
        const found = RESIZE_PRESETS.find((entry) => entry.id === value);
        if (!found) return;
        spec.resize = { mode: found.mode, width: found.width || 0, height: found.height || 0, keepAspect: spec.resize.keepAspect };
        if (found.mode === 'exact') {
          spec.resize.width = Number(controls.width && controls.width.value) || sourceWidth();
          spec.resize.height = Number(controls.height && controls.height.value) || sourceHeight();
        }
        refresh();
      },
    );
    controls.preset = preset;
    section.appendChild(dialogField(doc, { id: 'siat-tf-resize-preset', label: 'Preset', control: preset }));

    const grid = dialogEl(doc, 'div', { className: 'siat-tf-grid' });
    const width = dialogTextControl(doc, '', { type: 'number', min: 1, max: 20000, step: 1 });
    width.addEventListener('input', () => {
      spec.resize.mode = 'exact';
      spec.resize.width = Number(width.value) || 0;
      if (spec.resize.keepAspect && sourceWidth() && sourceHeight()) {
        const aspect = aspectPlan();
        spec.resize.height = Math.max(1, Math.round((spec.resize.width * aspect.height) / aspect.width));
        if (controls.height) controls.height.value = String(spec.resize.height);
      }
      refresh();
    });
    controls.width = width;
    grid.appendChild(dialogField(doc, { id: 'siat-tf-width', label: 'Width (px)', control: width }));

    const height = dialogTextControl(doc, '', { type: 'number', min: 1, max: 20000, step: 1 });
    height.addEventListener('input', () => {
      spec.resize.mode = 'exact';
      spec.resize.height = Number(height.value) || 0;
      if (spec.resize.keepAspect && sourceWidth() && sourceHeight()) {
        const aspect = aspectPlan();
        spec.resize.width = Math.max(1, Math.round((spec.resize.height * aspect.width) / aspect.height));
        if (controls.width) controls.width.value = String(spec.resize.width);
      }
      refresh();
    });
    controls.height = height;
    grid.appendChild(dialogField(doc, { id: 'siat-tf-height', label: 'Height (px)', control: height }));
    section.appendChild(grid);

    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-aspect',
        label: 'Keep aspect ratio',
        hint: 'Typing one dimension fills in the other.',
        checked: true,
        onChange: (checked) => {
          spec.resize.keepAspect = checked;
        },
      }),
    );
    return section;
  }

  function buildCropSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Crop' }));
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-crop-enable',
        label: 'Crop to a region',
        hint: 'Drag the blue box on the preview, use the arrow keys when it has focus (Shift+arrow resizes), or type exact pixels below.',
        checked: false,
        onChange: (checked) => {
          cropEnabled = checked;
          if (checked && !spec.crop) {
            spec.crop = {
              x: Math.round(sourceWidth() * 0.1),
              y: Math.round(sourceHeight() * 0.1),
              width: Math.max(1, Math.round(sourceWidth() * 0.8)),
              height: Math.max(1, Math.round(sourceHeight() * 0.8)),
            };
          }
          if (!checked) spec.crop = null;
          syncControls();
          refresh();
        },
      }),
    );

    const grid = dialogEl(doc, 'div', { className: 'siat-tf-grid' });
    for (const [key, label] of [
      ['x', 'Left (px)'],
      ['y', 'Top (px)'],
      ['width', 'Width (px)'],
      ['height', 'Height (px)'],
    ]) {
      const input = dialogTextControl(doc, '', { type: 'number', min: 0, max: 100000, step: 1 });
      input.addEventListener('input', () => {
        if (!spec.crop) spec.crop = { x: 0, y: 0, width: sourceWidth(), height: sourceHeight() };
        spec.crop[key] = Number(input.value) || 0;
        cropEnabled = true;
        // Sync first: the "Crop to a region" checkbox has to show that typing a
        // region turned cropping on, or the UI contradicts the readout.
        syncControls();
        refresh();
      });
      controls[`crop-${key}`] = input;
      grid.appendChild(dialogField(doc, { id: `siat-tf-crop-${key}`, label, control: input }));
    }
    section.appendChild(grid);
    return section;
  }

  function buildRotateSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Rotate and flip' }));
    const row = dialogEl(doc, 'div', { className: 'siat-tf-rotate' });

    const left = dialogButton(doc, '⟲ Rotate left', 'ghost', () => {
      spec.rotate = (spec.rotate + 270) % 360;
      refresh();
    });
    left.id = 'siat-tf-rot-left';
    const right = dialogButton(doc, '⟳ Rotate right', 'ghost', () => {
      spec.rotate = (spec.rotate + 90) % 360;
      refresh();
    });
    right.id = 'siat-tf-rot-right';
    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-fliph',
        label: 'Flip horizontally',
        checked: false,
        onChange: (checked) => {
          spec.flipH = checked;
          refresh();
        },
      }),
    );
    row.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-flipv',
        label: 'Flip vertically',
        checked: false,
        onChange: (checked) => {
          spec.flipV = checked;
          refresh();
        },
      }),
    );
    controls.rotateLabel = dialogEl(doc, 'span', { className: 'siat-note', id: 'siat-tf-rotate-label', text: '0°' });
    row.appendChild(controls.rotateLabel);
    section.appendChild(row);
    return section;
  }

  function buildOutputSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Output' }));
    const formats = (deps.formats ? deps.formats() : []).filter((format) => format.id !== 'original' && !format.disabled);
    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const select = dialogSelectControl(
      doc,
      formats.map((format) => ({ value: format.id, label: format.label })),
      formats.some((format) => format.id === settings.activeFormatId) ? settings.activeFormatId : formats.length ? formats[0].id : 'png',
      // The readout names the format that will be written, so it has to follow
      // the select instead of showing the format that was selected on open.
      () => refresh(),
    );
    select.setAttribute('aria-label', 'Output format');
    controls.format = select;
    // dialogField owns the control's id (it is the label's `for` target), so the
    // id is given once, here, instead of being silently overwritten afterwards.
    section.appendChild(dialogField(doc, { id: 'siat-tf-format', label: 'Save as', hint: '"Original file" is not offered: cropping or resizing means re-encoding.', control: select }));
    return section;
  }

  async function loadSource() {
    if (loading) return;
    loading = true;
    const generation = ++previewGeneration;
    try {
      if (typeof deps.loadPreview !== 'function') throw new Error('No preview loader was provided.');
      const loadedSource = await deps.loadPreview(target);
      if (generation !== previewGeneration || !dialog.isOpen) {
        if (loadedSource && typeof loadedSource.release === 'function') loadedSource.release();
        return;
      }
      source = loadedSource;
      if (!source || !source.drawable) return;
      previewScale = buildPreviewCanvas();
      buildPreviewHost();
      if (deps.settings) {
        const settings = deps.settings();
        if (settings.defaultTransform && isTransformActive(settings.defaultTransform)) {
          spec = cloneSpec(settings.defaultTransform);
          cropEnabled = Boolean(spec.crop);
        }
      }
      syncControls();
      refresh();
    } catch (err) {
      if (generation !== previewGeneration || !dialog.isOpen) return;
      outputEl.textContent = 'The image could not be loaded for preview.';
      warnEl.textContent = err && err.message ? err.message : String(err);
    } finally {
      if (generation === previewGeneration) loading = false;
    }
  }

  function buildPreviewCanvas() {
    const create = deps.createCanvas;
    if (typeof create !== 'function') return 1;
    const width = sourceWidth();
    const height = sourceHeight();
    if (!(width > 0) || !(height > 0)) return 1;
    const scale = Math.min(PREVIEW_MAX / width, PREVIEW_MAX_HEIGHT / height, 1);
    const preview = create(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    try {
      preview.ctx.drawImage(source.drawable, 0, 0, preview.canvas.width, preview.canvas.height);
    } catch {
      return scale;
    }
    previewCanvas = preview.canvas;
    return scale;
  }

  function sourceWidth() {
    return (source && source.width) || 0;
  }

  function sourceHeight() {
    return (source && source.height) || 0;
  }

  /** Push the current spec into every control without re-rendering the dialog. */
  function syncControls() {
    if (!controls.width) return;
    const plan = currentPlan();
    controls.width.value = spec.resize.mode === 'exact' ? String(spec.resize.width || plan.width) : String(plan.width);
    controls.height.value = spec.resize.mode === 'exact' ? String(spec.resize.height || plan.height) : String(plan.height);
    if (controls.preset) controls.preset.value = presetIdFor(spec.resize);
    for (const key of ['x', 'y', 'width', 'height']) {
      const input = controls[`crop-${key}`];
      if (input) input.value = String(spec.crop ? spec.crop[key] || 0 : 0);
    }
    if (dialog.shadowRoot) {
      const cropInput = dialog.shadowRoot.querySelector('#siat-tf-crop-enable');
      if (cropInput) cropInput.checked = cropEnabled;
      const aspectInput = dialog.shadowRoot.querySelector('#siat-tf-aspect');
      if (aspectInput) aspectInput.checked = spec.resize.keepAspect !== false;
      const flipH = dialog.shadowRoot.querySelector('#siat-tf-fliph');
      if (flipH) flipH.checked = Boolean(spec.flipH);
      const flipV = dialog.shadowRoot.querySelector('#siat-tf-flipv');
      if (flipV) flipV.checked = Boolean(spec.flipV);
    }
    if (controls.rotateLabel) controls.rotateLabel.textContent = `${spec.rotate}°`;
  }

  function presetIdFor(resize) {
    const found = RESIZE_PRESETS.find((entry) => entry.mode === resize.mode && (entry.width || 0) === (Number(resize.width) || 0));
    return found ? found.id : 'none';
  }

  function aspectPlan() {
    return planTransform({ sourceWidth: sourceWidth(), sourceHeight: sourceHeight(), transform: { ...spec, resize: { mode: 'none' } } });
  }

  function currentPlan() {
    return planTransform({ sourceWidth: sourceWidth() || 1, sourceHeight: sourceHeight() || 1, transform: spec });
  }

  /**
   * Recompute the preview, the output readout and any warnings.
   *
   * The preview canvas is created once per image, so refreshing never rebuilds
   * the DOM: focus stays where the user put it and a pointer drag is not
   * interrupted by the element being replaced underneath.
   *
   * While cropping, the preview shows the whole image with the crop region
   * highlighted (the conventional crop UI); otherwise it shows the rotate/flip
   * result. Resize is never previewed at preview scale — the exact output size
   * is computed from the real pixels and printed beside it.
   */
  function refresh() {
    if (!dialog.isOpen) return;
    if (controls.rotateLabel) controls.rotateLabel.textContent = `${spec.rotate}°`;
    const plan = currentPlan();
    const active = isTransformActive(spec);

    if (previewCanvas && deps.createCanvas) {
      const previewSpec = {
        resize: { mode: 'none', width: 0, height: 0, keepAspect: true },
        crop: null,
        rotate: cropEnabled ? 0 : spec.rotate,
        flipH: cropEnabled ? false : spec.flipH,
        flipV: cropEnabled ? false : spec.flipV,
      };
      let drawable = previewCanvas;
      if (isTransformActive(previewSpec)) {
        try {
          drawable = applyTransform({
            source: previewCanvas,
            transform: previewSpec,
            createCanvas: deps.createCanvas,
            sourceWidth: previewCanvas.width,
            sourceHeight: previewCanvas.height,
          }).canvas;
        } catch {
          drawable = previewCanvas;
        }
      }
      drawPreview(drawable);
    }

    const checked = validateTransform(spec, { sourceWidth: sourceWidth(), sourceHeight: sourceHeight() });
    const problems = checked.errors.slice();
    if (!(sourceWidth() > 0)) problems.push('The source has no pixel size yet.');
    if (!active) problems.push('No transform selected — the image will be re-encoded and saved as-is.');
    warnEl.textContent = problems.join(' ');

    const format = controls.format ? controls.format.value : 'png';
    outputEl.textContent =
      `${sourceWidth()}×${sourceHeight()} → ${plan.width}×${plan.height} px` +
      ` · ${active ? describeTransform(spec) : 'no transform'}` +
      ` · saved as ${String(format).toUpperCase()}` +
      (plan.steps.length ? ` · steps: ${plan.steps.join(' → ')}` : '');
    renderCropBox();
    if (controls.preset) controls.preset.value = presetIdFor(spec.resize);
  }

  /** Create the preview structure once per loaded image. */
  function buildPreviewHost() {
    if (!previewHost) return;
    previewHost.textContent = '';
    const wrap = dialogEl(doc, 'div', {
      className: 'siat-cropwrap',
      attrs: { tabindex: '0', role: 'group', 'aria-label': 'Crop region. Arrow keys move it; Shift plus arrow keys resize it.' },
    });
    wrap.id = 'siat-tf-cropwrap';
    const canvas = doc.createElement('canvas');
    canvas.id = 'siat-tf-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Preview of the image');
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '34vh';
    canvas.style.display = 'block';
    wrap.appendChild(canvas);
    cropBox = dialogEl(doc, 'div', { className: 'siat-cropbox', attrs: { 'aria-hidden': 'true' } });
    cropHandle = dialogEl(doc, 'div', { className: 'siat-crophandle' });
    cropHandle.style.right = '-6px';
    cropHandle.style.bottom = '-6px';
    cropBox.appendChild(cropHandle);
    cropDims = dialogEl(doc, 'span', { className: 'siat-cropdims', text: '' });
    cropBox.appendChild(cropDims);
    wrap.appendChild(cropBox);
    previewHost.appendChild(wrap);
    previewEl = canvas;
    attachCropDrag(wrap);
    attachCropKeys(wrap);
  }

  function drawPreview(canvas) {
    if (!previewEl) buildPreviewHost();
    if (!previewEl) return;
    if (previewEl.width !== canvas.width || previewEl.height !== canvas.height) {
      previewEl.width = canvas.width;
      previewEl.height = canvas.height;
    }
    const ctx = previewEl.getContext ? previewEl.getContext('2d') : null;
    if (!ctx) return;
    try {
      ctx.clearRect(0, 0, previewEl.width, previewEl.height);
      ctx.drawImage(canvas, 0, 0);
    } catch {
      /* a preview failure is cosmetic; the numbers beside it are authoritative */
    }
  }

  /** Natural pixels → displayed pixels, for the crop overlay and drag maths. */
  function previewRatio() {
    if (!previewEl || !previewCanvas || !previewCanvas.width) return 0;
    const displayed = previewEl.clientWidth || previewEl.width || 0;
    if (!(displayed > 0)) return 0;
    return previewScale * (displayed / previewCanvas.width);
  }

  function renderCropBox() {
    if (!cropBox) return;
    cropBox.style.display = cropEnabled && spec.crop ? '' : 'none';
    if (!cropEnabled || !spec.crop) return;
    const ratio = previewRatio();
    if (!(ratio > 0)) return;
    cropBox.style.left = `${Math.round(spec.crop.x * ratio)}px`;
    cropBox.style.top = `${Math.round(spec.crop.y * ratio)}px`;
    cropBox.style.width = `${Math.max(4, Math.round(spec.crop.width * ratio))}px`;
    cropBox.style.height = `${Math.max(4, Math.round(spec.crop.height * ratio))}px`;
    if (cropDims) cropDims.textContent = `${spec.crop.width}×${spec.crop.height} at ${spec.crop.x},${spec.crop.y}`;
  }

  function attachCropDrag(wrap) {
    if (!cropBox) return;
    let mode = null;
    let startX = 0;
    let startY = 0;
    let startCrop = null;

    // Displayed pixels → natural pixels.
    const naturalPerPixel = () => {
      const ratio = previewRatio();
      return ratio > 0 ? 1 / ratio : 1;
    };

    const onDown = (event) => {
      if (!cropEnabled) return;
      mode = event.target === cropHandle ? 'resize' : 'move';
      startX = event.clientX;
      startY = event.clientY;
      startCrop = Object.assign({}, spec.crop);
      try {
        cropBox.setPointerCapture(event.pointerId);
      } catch {
        /* older engines: mouse events still work */
      }
      event.preventDefault();
    };
    const onMove = (event) => {
      if (!mode || !startCrop) return;
      const ratio = naturalPerPixel();
      const deltaX = Math.round((event.clientX - startX) * ratio);
      const deltaY = Math.round((event.clientY - startY) * ratio);
      const next = Object.assign({}, startCrop);
      if (mode === 'move') {
        next.x = clampTransformValue(startCrop.x + deltaX, 0, Math.max(0, sourceWidth() - startCrop.width));
        next.y = clampTransformValue(startCrop.y + deltaY, 0, Math.max(0, sourceHeight() - startCrop.height));
      } else {
        next.width = clampTransformValue(startCrop.width + deltaX, 8, sourceWidth() - startCrop.x);
        next.height = clampTransformValue(startCrop.height + deltaY, 8, sourceHeight() - startCrop.y);
      }
      spec.crop = next;
      syncControls();
      refresh();
    };
    const onUp = () => {
      mode = null;
      startCrop = null;
    };
    cropBox.addEventListener('pointerdown', onDown);
    cropBox.addEventListener('pointermove', onMove);
    cropBox.addEventListener('pointerup', onUp);
    cropBox.addEventListener('pointercancel', onUp);
    wrap.addEventListener('pointerdown', (event) => {
      if (event.target === cropBox || event.target === cropHandle) return;
      onDown(event);
    });
  }

  function attachCropKeys(wrap) {
    wrap.addEventListener('keydown', (event) => {
      if (!cropEnabled || !spec.crop) return;
      const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const delta = keys[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const next = Object.assign({}, spec.crop);
      if (event.shiftKey) {
        next.width = clampTransformValue(next.width + delta[0] * step, 8, sourceWidth() - next.x);
        next.height = clampTransformValue(next.height + delta[1] * step, 8, sourceHeight() - next.y);
      } else {
        next.x = clampTransformValue(next.x + delta[0] * step, 0, Math.max(0, sourceWidth() - next.width));
        next.y = clampTransformValue(next.y + delta[1] * step, 0, Math.max(0, sourceHeight() - next.height));
      }
      spec.crop = next;
      syncControls();
      refresh();
    });
  }

  function submit(makeDefault) {
    if (!source) {
      warnEl.textContent = 'The image is still loading — try again in a moment.';
      return;
    }
    const checked = validateTransform(spec, { sourceWidth: sourceWidth(), sourceHeight: sourceHeight() });
    if (!checked.ok) { warnEl.textContent = checked.errors.join(' '); return; }
    const formatId = controls.format ? controls.format.value : 'png';
    const payload = { target, transform: cloneSpec(spec), formatId, makeDefault: Boolean(makeDefault) };
    dialog.close();
    if (typeof deps.onSubmit === 'function') deps.onSubmit(payload);
  }

  function releaseSource() {
    if (source && typeof source.release === 'function') {
      try {
        source.release();
      } catch {
        /* noop */
      }
    }
    source = null;
    previewCanvas = null;
    previewEl = null;
  }

  return {
    open(nextTarget, options = {}) {
      previewGeneration += 1;
      loading = false;
      target = nextTarget || null;
      releaseSource();
      spec = cloneSpec(options.transform || TRANSFORM_DEFAULTS);
      cropEnabled = Boolean(spec.crop);
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Automation/test seam: the spec the dialog would submit right now. */
    currentSpec: () => cloneSpec(spec),
    currentPlan: () => currentPlan(),
    destroy() {
      releaseSource();
      dialog.destroy();
    },
  };
}

function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec || TRANSFORM_DEFAULTS));
}

function clampTransformValue(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.max(min, max), number));
}

/* ── src/ui/compare-dialog.js ───────────────────────── */
/**
 * Format-comparison dialog.
 *
 * Encodes the same image several ways in memory and shows what each costs, so
 * "which format should I use?" is answered with the actual numbers for *this*
 * image instead of a rule of thumb. Nothing is written to disk until a Save
 * button is pressed, and cancelling stops the encoders rather than letting them
 * finish in the background.
 */




const COMPARE_HOST_ID = 'siat-compare-host';

const COMPARE_STYLE = `
.siat-cmp-status { font-size: 12.5px; color: #5c6472; padding: 8px 0; min-height: 1.4em; }
@media (prefers-color-scheme: dark) { .siat-cmp-status { color: #a3acbb; } }
.siat-table td .siat-btn { padding: 4px 9px; font-size: 11.5px; }
.siat-row-recommended { background: rgba(47,111,219,.1); }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {(target: object, helpers: {onProgress: Function, signal: AbortSignal}) => Promise<object>} deps.compare
 * @param {(target: object, formatId: string) => void} deps.onSave
 * @param {() => void} [deps.onCancel]
 */
function createCompareDialog(deps) {
  const doc = deps.document || document;
  let target = null;
  let statusEl = null;
  let tableHost = null;
  let saveSmallestButton = null;
  let cancelButton = null;
  let controller = null;
  let recommended = null;
  let rows = [];
  let generation = 0;

  const dialog = createDialog({
    document: doc,
    hostId: COMPARE_HOST_ID,
    marker: 'compare',
    titleId: 'siat-compare-title',
    title: 'Compare formats',
    closeLabel: 'Close comparison',
    width: 'wide',
    extraStyle: COMPARE_STYLE,
    focus: 'first',
    onClose() {
      abortRun();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      generation += 1;

      statusEl = dialogEl(doc, 'p', { className: 'siat-cmp-status', id: 'siat-cmp-status', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Preparing…' });
      body.appendChild(statusEl);
      tableHost = dialogEl(doc, 'div', { id: 'siat-cmp-table' });
      body.appendChild(tableHost);
      const note = dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: 'Every candidate is encoded from the same pixels in memory. Sizes are the real encoded file sizes; nothing is saved until you press a Save button.',
      });
      body.appendChild(note);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      cancelButton = dialogButton(doc, 'Stop comparing', 'danger', () => abortRun());
      cancelButton.id = 'siat-cmp-cancel';
      foot.appendChild(cancelButton);
      saveSmallestButton = dialogButton(doc, 'Save smallest', 'primary', () => {
        if (recommended && typeof deps.onSave === 'function') {
          dialog.close();
          deps.onSave(target, recommended.formatId);
        }
      });
      saveSmallestButton.id = 'siat-cmp-save-smallest';
      saveSmallestButton.disabled = true;
      foot.appendChild(saveSmallestButton);
      foot.appendChild(dialogButton(doc, 'Close', 'ghost', () => dialog.close()));

      run();
    },
  });

  async function run() {
    // A new run supersedes the old one; that is not the user cancelling, so the
    // owner is not told (it would otherwise see a "cancel" for every re-open).
    abortRun(false);
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const thisRun = generation;
    rows = [];
    recommended = null;
    if (saveSmallestButton) saveSmallestButton.disabled = true;
    if (cancelButton) cancelButton.disabled = false;
    setStatus('Encoding candidates…');
    try {
      const result = await deps.compare(target, {
        signal: controller ? controller.signal : null,
        onProgress: (stage, detail) => {
          if (thisRun !== generation) return;
          setStatus(`${stage}${detail && detail.formatId ? ` (${detail.formatId})` : ''}…`);
        },
      });
      if (thisRun !== generation || !dialog.isOpen) return;
      rows = comparisonRows(result ? result.results : [], result ? result.recommended : null);
      recommended = result ? result.recommended : null;
      render(result);
    } catch (err) {
      if (thisRun !== generation) return;
      const cancelled = controller && controller.signal && controller.signal.aborted;
      setStatus(cancelled ? 'Comparison stopped.' : `Comparison failed: ${err && err.message ? err.message : 'unknown error'}`);
      if (cancelButton) cancelButton.disabled = true;
    }
  }

  function render(result) {
    if (!tableHost) return;
    tableHost.textContent = '';
    const succeeded = rows.filter((row) => row.ok);
    if (!succeeded.length) {
      tableHost.appendChild(
        dialogEl(doc, 'p', {
          className: 'siat-empty',
          text: 'No format could be encoded. The notes below say why.',
        }),
      );
    } else {
      const table = dialogTable(doc, {
        head: ['Format', 'Size', 'vs smallest', 'Transparency', 'Encode time', 'Notes', ''],
        caption: 'Encoded size comparison for this image',
        rows: rows.map((row) => [
          { text: row.label + (row.recommended ? ' ← smallest good' : '') },
          { text: row.ok ? row.sizeLabel : '—', num: true },
          { text: row.ok ? `${row.relative}%` : '—', num: true },
          { text: row.alpha },
          { text: row.ok ? `${row.ms} ms` : '—', num: true },
          { text: row.note || (row.dimensions ? row.dimensions : '') },
          { text: '' },
        ]),
      });
      // Save buttons are real elements, not table text.
      const actionCells = table.querySelectorAll('tbody tr td:last-child');
      rows.forEach((row, index) => {
        const cell = actionCells[index];
        if (!cell) return;
        if (!row.ok) {
          cell.appendChild(dialogEl(doc, 'span', { className: 'siat-no', text: 'failed' }));
          return;
        }
        const button = dialogButton(doc, 'Save', row.recommended ? 'primary' : 'ghost', () => {
          if (typeof deps.onSave === 'function') {
            dialog.close();
            deps.onSave(target, row.formatId);
          }
        });
        button.id = `siat-cmp-save-${row.formatId}`;
        button.setAttribute('aria-label', `Save as ${row.label}`);
        cell.appendChild(button);
        if (row.recommended) {
          const tr = cell.parentNode;
          if (tr) tr.className = 'siat-row-recommended';
        }
      });
      tableHost.appendChild(table);
    }

    const notes = (result && result.notes ? result.notes : []).slice();
    if (recommended) {
      notes.unshift(`Recommended: ${recommended.label} — ${recommended.reason}.`);
    }
    dialog.showBanner(recommended ? 'ok' : '', recommended ? '' : 'No recommendation', notes);
    setStatus(
      succeeded.length
        ? `${succeeded.length} format${succeeded.length === 1 ? '' : 's'} encoded in ${result && result.elapsedMs ? result.elapsedMs : 0} ms.`
        : 'Nothing could be encoded.',
    );
    if (saveSmallestButton) saveSmallestButton.disabled = !recommended;
    if (cancelButton) cancelButton.disabled = true;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = String(text || '');
  }

  function abortRun(notify = true) {
    generation += 1;
    const hadRun = Boolean(controller);
    if (controller) {
      try {
        controller.abort();
      } catch {
        /* noop */
      }
    }
    controller = null;
    // A run that was stopped has to look stopped: the button goes dead and the
    // status line says so, instead of leaving "Encoding candidates…" up forever.
    if (hadRun) {
      setStatus('Comparison stopped.');
      if (cancelButton) cancelButton.disabled = true;
    }
    if (notify && typeof deps.onCancel === 'function') {
      try {
        deps.onCancel();
      } catch {
        /* noop */
      }
    }
  }

  return {
    open(nextTarget) {
      target = nextTarget || null;
      dialog.open();
    },
    close: () => dialog.close(),
    rerun: () => run(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Automation seam: what the last run produced. */
    state: () => ({ rows, recommended }),
    destroy() {
      abortRun();
      dialog.destroy();
    },
  };
}

/* ── src/ui/inspector.js ───────────────────────── */
/**
 * Metadata inspector.
 *
 * Shows what a file actually carries — EXIF camera and timestamp fields, XMP,
 * ICC profiles, comments, and above all GPS coordinates — and offers to save the
 * original with that metadata removed.
 *
 * The values come from the file, which is untrusted input: everything is written
 * with textContent, long values are truncated by core/metadata.js, and GPS
 * coordinates are shown rounded to roughly a kilometre rather than at full
 * precision (enough to recognise a location, not enough to copy one out of a
 * dialog by hand).
 */




const INSPECTOR_HOST_ID = 'siat-inspector-host';

const INSPECTOR_STYLE = `
.siat-insp-status { font-size: 12.5px; color: #5c6472; padding: 6px 0; }
@media (prefers-color-scheme: dark) { .siat-insp-status { color: #a3acbb; } }
.siat-insp-thumb { max-width: 120px; max-height: 90px; border-radius: 8px; border: 1px solid rgba(127,127,127,.3); display: block; }
.siat-insp-head { display: flex; gap: 12px; align-items: flex-start; }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {(target: object) => Promise<{bytes: Uint8Array, mime: string, filename: string}>} deps.loadBytes
 * @param {(target: object, options: {stripMetadata: boolean}) => void} deps.onSave
 * @param {() => object} [deps.settings]
 */
function createMetadataInspector(deps) {
  const doc = deps.document || document;
  let target = null;
  let statusEl = null;
  let tableHost = null;
  let saveButton = null;
  let loaded = null;
  let generation = 0;

  const dialog = createDialog({
    document: doc,
    hostId: INSPECTOR_HOST_ID,
    marker: 'inspector',
    titleId: 'siat-inspector-title',
    title: 'Embedded metadata',
    closeLabel: 'Close metadata inspector',
    width: 'wide',
    extraStyle: INSPECTOR_STYLE,
    focus: 'first',
    build(context) {
      const body = context.body;
      const foot = context.foot;
      generation += 1;

      statusEl = dialogEl(doc, 'p', {
        className: 'siat-insp-status',
        id: 'siat-insp-status',
        attrs: { role: 'status', 'aria-live': 'polite' },
        text: 'Reading the file…',
      });
      body.appendChild(statusEl);
      tableHost = dialogEl(doc, 'div', { id: 'siat-insp-table' });
      body.appendChild(tableHost);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      saveButton = dialogButton(doc, 'Save original without metadata', 'primary', () => {
        if (typeof deps.onSave === 'function') {
          dialog.close();
          deps.onSave(target, { stripMetadata: true });
        }
      });
      saveButton.id = 'siat-insp-save-stripped';
      saveButton.disabled = true;
      foot.appendChild(saveButton);
      const recheck = dialogButton(doc, 'Re-check', 'ghost', () => inspect());
      recheck.id = 'siat-insp-recheck';
      foot.appendChild(recheck);
      foot.appendChild(dialogButton(doc, 'Close', 'ghost', () => dialog.close()));

      inspect();
    },
  });

  async function inspect() {
    const thisRun = generation;
    setStatus('Reading the file…');
    if (saveButton) saveButton.disabled = true;
    try {
      if (typeof deps.loadBytes !== 'function') throw new Error('No file reader was provided.');
      const file = await deps.loadBytes(target);
      if (thisRun !== generation || !dialog.isOpen) return;
      if (!file || !file.bytes || !file.bytes.length) {
        setStatus('This image has no readable file bytes (it may be a canvas or a generated image), so there is no metadata to inspect.');
        renderEmpty();
        return;
      }
      loaded = file;
      const info = inspectMetadata(file.bytes, file.mime);
      render(info, file);
      setStatus(`${info.container} · ${inspectorFormatSize(file.bytes.length)}${info.supported ? '' : ' · metadata not inspectable here'}`);
      if (saveButton) saveButton.disabled = !info.strippable;
    } catch (err) {
      if (thisRun !== generation) return;
      setStatus(`Could not read the file: ${err && err.message ? err.message : 'unknown error'}`);
      renderEmpty();
    }
  }

  function render(info, file) {
    if (!tableHost) return;
    tableHost.textContent = '';

    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const warnings = settings.warnAboutGps === false ? info.warnings.filter((line) => !line.includes('GPS coordinates')) : info.warnings;
    if (warnings.length) {
      const hasGps = settings.warnAboutGps !== false && info.gps && info.gps.present;
      dialog.showBanner(hasGps ? 'error' : '', hasGps ? 'Location data found' : '', warnings);
    } else {
      dialog.showBanner('', '', []);
    }

    const summary = dialogEl(doc, 'div', { className: 'siat-insp-head' });
    const facts = dialogEl(doc, 'div', {});
    facts.appendChild(
      dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: `File: ${file.filename || 'unknown'} · ${info.mime}${info.exif.orientation ? ` · EXIF orientation ${info.exif.orientation} (${ORIENTATION_LABELS[info.exif.orientation] || 'unknown'})` : ''}`,
      }),
    );
    facts.appendChild(
      dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: info.removes.length
          ? `Stripping would remove: ${info.removes.join(', ')}. Image pixels are copied, never re-encoded.`
          : 'Nothing removable was found; a stripped copy would be byte-identical.',
      }),
    );
    summary.appendChild(facts);
    tableHost.appendChild(summary);

    tableHost.appendChild(
      dialogTable(doc, {
        head: ['What', 'Value', 'Where it lives'],
        caption: 'Metadata found in this file',
        emptyText: 'No EXIF, XMP, ICC or comment data was found.',
        rows: info.findings.map((finding) => [
          { text: finding.label + (finding.sensitive ? ' ⚠' : '') },
          { text: truncate(String(finding.detail === undefined ? '' : finding.detail), 120) },
          { text: finding.where || '' },
        ]),
      }),
    );
  }

  function renderEmpty() {
    if (!tableHost) return;
    tableHost.textContent = '';
    tableHost.appendChild(dialogEl(doc, 'p', { className: 'siat-empty', text: 'No metadata information is available for this image.' }));
    dialog.showBanner('', '', []);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = String(text || '');
  }

  return {
    open(nextTarget) {
      target = nextTarget || null;
      loaded = null;
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Automation seam: the file bytes and MIME the inspector is showing. */
    state: () => ({ loaded: loaded ? { mime: loaded.mime, filename: loaded.filename, bytes: loaded.bytes.length } : null }),
    destroy() {
      generation += 1;
      loaded = null;
      dialog.destroy();
    },
  };
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function inspectorFormatSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ── src/ui/help.js ───────────────────────── */
/**
 * Shortcut help overlay.
 *
 * A short, honest reference: which chords do what, what the menu itself accepts
 * from the keyboard, and where to change any of it. Kept separate from the
 * settings dialog so it can be opened from a manager menu command in one step.
 */




const HELP_HOST_ID = 'siat-help-host';

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => object} deps.settings
 * @param {() => void} [deps.onOpenSettings]
 */
function createShortcutHelp(deps) {
  const doc = deps.document || document;

  const dialog = createDialog({
    document: doc,
    hostId: HELP_HOST_ID,
    marker: 'help',
    titleId: 'siat-help-title',
    title: 'Keyboard shortcuts',
    closeLabel: 'Close shortcut help',
    focus: 'first',
    build(context) {
      const body = context.body;
      const foot = context.foot;
      const settings = typeof deps.settings === 'function' ? deps.settings() : {};
      const checked = validateShortcuts(settings.shortcuts || {});
      const rows = describeShortcuts(checked.shortcuts, { disabled: checked.disabled });

      body.appendChild(
        dialogEl(doc, 'p', {
          className: 'siat-desc',
          text: settings.enableShortcuts === false
            ? 'Shortcuts are turned off in your settings, so none of these will fire.'
            : 'Every chord needs Ctrl, Alt or Meta, so plain typing on a page is never captured. The hovered image is the one the shortcut acts on.',
        }),
      );

      body.appendChild(
        dialogTable(doc, {
          head: ['Action', 'Keys'],
          caption: 'Configured shortcuts',
          emptyText: 'No shortcuts are configured.',
          rows: rows.map((row) => [{ text: row.label }, { text: row.disabled ? 'disabled' : row.binding || 'not set' }]),
        }),
      );

      const menuBox = dialogEl(doc, 'fieldset', { className: 'siat-section' });
      menuBox.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Inside the right-click menu' }));
      const tips = [
        ['Arrow keys', 'Move between entries'],
        ['1 – 9', 'Pick that format immediately'],
        ['Enter or Space', 'Activate the highlighted entry'],
        ['Escape', 'Close the menu without saving'],
        ['Tab', 'Moves through the menu only; focus is trapped while it is open'],
        ['Shift + right-click', settings.requireShift ? 'Opens this menu (required by your settings)' : 'Leaves the browser menu alone'],
      ];
      menuBox.appendChild(
        dialogTable(doc, {
          head: ['Key', 'Effect'],
          caption: 'Menu keyboard behaviour',
          rows: tips.map(([key, effect]) => [{ text: key }, { text: effect }]),
        }),
      );
      body.appendChild(menuBox);

      const note = dialogEl(doc, 'p', {
        className: 'siat-desc',
        // No hard-coded example chord: the table above lists the bindings that
        // are really configured, and an example would read like one of them.
        text: 'Shortcuts can be changed in Settings → Keyboard shortcuts. On Windows, Alt+Shift is also the system language-switch chord — rebind there if your system grabs it first.',
      });
      body.appendChild(note);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      if (typeof deps.onOpenSettings === 'function') {
        const settingsButton = dialogButton(doc, 'Open settings', 'ghost', () => {
          dialog.close();
          deps.onOpenSettings();
        });
        settingsButton.id = 'siat-help-settings';
        foot.appendChild(settingsButton);
      }
      const closeButton = dialogButton(doc, 'Close', 'primary', () => dialog.close());
      closeButton.id = 'siat-help-close';
      foot.appendChild(closeButton);
    },
  });

  return {
    open: () => dialog.open(),
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    destroy() {
      dialog.destroy();
    },
  };
}

/* ── src/ui/batch-dialog.js ───────────────────────── */
/**
 * Batch confirmation dialog.
 *
 * Converting a whole page writes many files at once, so it is a consequential
 * action: this dialog shows exactly what will happen — how many images qualify,
 * how many are skipped and why, which formats will be written, whether the
 * output lands as separate files or one archive — and only starts on an explicit
 * press. Options that change the plan re-plan it live, so the numbers shown are
 * the numbers acted on.
 */



const BATCH_HOST_ID = 'siat-batch-host';

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => object} deps.settings
 * @param {() => Array<{id: string, label: string, disabled?: boolean}>} deps.formats
 * @param {(options: object) => object} deps.plan      recompute the plan for the chosen options
 * @param {(options: object) => void} deps.onStart
 * @param {() => void} [deps.onOpenPicker]
 */
function createBatchDialog(deps) {
  const doc = deps.document || document;
  // Null until the first build seeds it from the stored settings, then kept: a
  // second "Convert every image" in the same page session should still show the
  // choices the user just made rather than silently resetting them.
  let options = null;
  let presetOptions = null;
  let plan = null;
  let tableHost = null;
  let startButton = null;
  let controls = {};

  const dialog = createDialog({
    document: doc,
    hostId: BATCH_HOST_ID,
    marker: 'batch',
    titleId: 'siat-batch-title',
    title: 'Convert every image on this page',
    closeLabel: 'Close batch dialog',
    width: 'wide',
    focus: 'first',
    build(context) {
      const body = context.body;
      const foot = context.foot;
      const settings = typeof deps.settings === 'function' ? deps.settings() : {};

      if (!options) {
        options = {
          formatId: settings.activeFormatId || firstFormatId(),
          extraFormats: (settings.batchFormats || []).slice(),
          destination: (settings.presetDestination || settings.batchDestination) === 'zip' ? 'zip' : 'files',
          includeNotLoaded: Boolean(settings.batchIncludeNotLoaded),
          minWidth: Number(settings.batchMinWidth) || 0,
          minHeight: Number(settings.batchMinHeight) || 0,
          skipTiny: settings.batchSkipTiny !== false,
          dedupe: settings.batchDedupe !== false,
        };
      }
      if (presetOptions) {
        options = Object.assign({}, options, presetOptions);
        presetOptions = null;
      }
      // Encoder support is probed after boot, so the list can change between
      // opens: never keep a choice this browser cannot honour.
      const available = (deps.formats ? deps.formats() : []).filter((entry) => !entry.disabled);
      if (!available.some((entry) => entry.id === options.formatId)) {
        options.formatId = firstFormatId();
      }
      options.extraFormats = (options.extraFormats || []).filter((id) => id !== options.formatId && available.some((entry) => entry.id === id));

      const intro = dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: 'Scanning reads what the page already has; nothing is downloaded until you press Start. Each image is converted independently, so one failure never stops the run.',
      });
      body.appendChild(intro);

      body.appendChild(buildOptionsSection());
      tableHost = dialogEl(doc, 'div', { id: 'siat-batch-plan' });
      body.appendChild(tableHost);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-note', id: 'siat-batch-note', text: '' }));
      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      if (typeof deps.onOpenPicker === 'function') {
        const pickerButton = dialogButton(doc, 'Choose images instead…', 'ghost', () => {
          dialog.close();
          deps.onOpenPicker();
        });
        pickerButton.id = 'siat-batch-open-picker';
        foot.appendChild(pickerButton);
      }
      foot.appendChild(dialogButton(doc, 'Cancel', 'ghost', () => dialog.close()));
      startButton = dialogButton(doc, 'Start', 'primary', () => {
        // `disabled` stops a mouse click, but not every activation path goes
        // through it, so the guard is in the handler too: an empty plan must
        // never reach the runner.
        if (!(plan && plan.eligible > 0)) return;
        dialog.close();
        deps.onStart(Object.assign({}, options));
      });
      startButton.id = 'siat-batch-start';
      foot.appendChild(startButton);

      replan();
    },
  });

  function buildOptionsSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'This run' }));

    const format = dialogSelectControl(
      doc,
      (deps.formats ? deps.formats() : []).map((entry) => ({ value: entry.id, label: entry.label, disabled: entry.disabled })),
      options.formatId,
      (value) => {
        options.formatId = value;
        replan();
      },
    );
    controls.format = format;
    section.appendChild(dialogField(doc, { id: 'siat-batch-format', label: 'Write every image as', control: format }));

    const extraBox = dialogEl(doc, 'div', { className: 'siat-grid' });
    for (const entry of deps.formats ? deps.formats() : []) {
      if (entry.id === 'original') continue;
      extraBox.appendChild(
        dialogCheckboxRow(doc, {
          id: `siat-batch-also-${entry.id}`,
          label: `also ${entry.label}`,
          unavailable: Boolean(entry.disabled),
          checked: options.extraFormats.includes(entry.id),
          onChange: (checked) => {
            const list = options.extraFormats.slice();
            const index = list.indexOf(entry.id);
            if (checked && index < 0) list.push(entry.id);
            if (!checked && index >= 0) list.splice(index, 1);
            options.extraFormats = list;
            replan();
          },
        }),
      );
    }
    section.appendChild(extraBox);

    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-zip',
        label: 'Put everything in one .zip archive',
        hint: 'Browsers throttle or block many automatic downloads; an archive is built in memory and saved as a single file.',
        checked: options.destination === 'zip',
        onChange: (checked) => {
          options.destination = checked ? 'zip' : 'files';
          replan();
        },
      }),
    );
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-notloaded',
        label: 'Also download images the page has not loaded yet',
        hint: 'Uses bandwidth and may change what the page shows (lazy galleries often load more as a result).',
        checked: options.includeNotLoaded,
        onChange: (checked) => {
          options.includeNotLoaded = checked;
          replan();
        },
      }),
    );
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-skiptiny',
        label: 'Skip icons and tracking pixels (under 64×64)',
        checked: options.skipTiny,
        onChange: (checked) => {
          options.skipTiny = checked;
          replan();
        },
      }),
    );
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-dedupe',
        label: 'Save each distinct URL once',
        checked: options.dedupe,
        onChange: (checked) => {
          options.dedupe = checked;
          replan();
        },
      }),
    );

    const sizes = dialogEl(doc, 'div', { className: 'siat-grid' });
    const minWidth = dialogTextControl(doc, options.minWidth || '', { type: 'number', min: 0, max: 20000, step: 10 });
    minWidth.addEventListener('input', () => {
      options.minWidth = Number(minWidth.value) || 0;
      replan();
    });
    sizes.appendChild(dialogField(doc, { id: 'siat-batch-minw', label: 'Minimum width (0 = off)', control: minWidth }));
    const minHeight = dialogTextControl(doc, options.minHeight || '', { type: 'number', min: 0, max: 20000, step: 10 });
    minHeight.addEventListener('input', () => {
      options.minHeight = Number(minHeight.value) || 0;
      replan();
    });
    sizes.appendChild(dialogField(doc, { id: 'siat-batch-minh', label: 'Minimum height (0 = off)', control: minHeight }));
    section.appendChild(sizes);
    return section;
  }

  function replan() {
    if (typeof deps.plan !== 'function') return;
    try {
      plan = deps.plan(Object.assign({}, options)) || {};
    } catch (err) {
      plan = { eligible: 0, notes: [`The page could not be scanned: ${err && err.message ? err.message : 'unknown error'}`] };
    }
    render();
  }

  function render() {
    if (!tableHost) return;
    tableHost.textContent = '';
    const rows = [
      ['Images found', String(plan.found || 0)],
      ['Will be converted', String(plan.eligible || 0)],
      ['Files that produces', String(plan.files || 0)],
    ];
    if (plan.skippedTiny) rows.push(['Skipped: icon-sized', String(plan.skippedTiny)]);
    if (plan.skippedNotLoaded) rows.push(['Skipped: not loaded yet', String(plan.skippedNotLoaded)]);
    if (plan.skippedBroken) rows.push(['Skipped: broken source', String(plan.skippedBroken)]);
    if (plan.skippedDuplicate) rows.push(['Skipped: duplicate URL', String(plan.skippedDuplicate)]);
    if (plan.skippedTooSmall) rows.push(['Skipped: below the minimum size', String(plan.skippedTooSmall)]);
    if (plan.skippedLimit) rows.push(['Skipped: over the per-run limit', String(plan.skippedLimit)]);
    if (plan.crossOrigin) rows.push(['Cross-origin (fetched through your manager)', String(plan.crossOrigin)]);
    rows.push(['Output', plan.destination === 'zip' ? 'one .zip archive' : 'one file per image']);
    rows.push(['Concurrency', String(plan.concurrency || 1)]);

    tableHost.appendChild(
      dialogTable(doc, {
        head: ['Plan', 'Count'],
        caption: 'What this run will do',
        rows: rows.map(([label, value]) => [{ text: label }, { text: value, num: true }]),
      }),
    );

    const notes = (plan.notes || []).slice(0, 8);
    dialog.showBanner(plan.eligible ? '' : 'error', plan.eligible ? '' : 'Nothing to convert', notes);
    if (startButton) {
      startButton.disabled = !(plan.eligible > 0);
      startButton.textContent = plan.eligible ? `Start (${plan.files || plan.eligible} file${(plan.files || plan.eligible) === 1 ? '' : 's'})` : 'Nothing to do';
    }
    const noteEl = dialog.shadowRoot ? dialog.shadowRoot.querySelector('#siat-batch-note') : null;
    if (noteEl) {
      noteEl.textContent = plan.estimateLabel
        ? `About ${plan.estimateLabel} of work · cancel at any time from the progress bar`
        : 'Cancel at any time from the progress bar.';
    }
  }

  function firstFormatId() {
    const formats = deps.formats ? deps.formats() : [];
    const usable = formats.filter((entry) => !entry.disabled && entry.id !== 'original');
    return usable.length ? usable[0].id : 'png';
  }

  return {
    open(nextOptions) {
      // One-shot overrides for this open (e.g. "convert these as WebP"), applied
      // after the dialog is built so a stored choice cannot swallow them.
      if (nextOptions && typeof nextOptions === 'object') presetOptions = Object.assign({}, presetOptions || {}, nextOptions);
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Automation seam: the plan currently on screen. */
    state: () => ({ options: Object.assign({}, options), plan: plan ? Object.assign({}, plan) : null }),
    destroy() {
      dialog.destroy();
    },
  };
}

/* ── src/main.js ───────────────────────── */
/**
 * Bootstrap and orchestration.
 *
 * Runs at document-start, which means almost nothing may happen eagerly: the
 * only work done before the first interaction is attaching listeners. Settings,
 * encoder probes and DOM creation are deferred, so the script adds no measurable
 * cost to page load, and the listeners live on `document` rather than on
 * elements, so SPA re-renders and route changes cannot orphan them.
 *
 * Injection is idempotent: a manager can legitimately inject twice (page +
 * iframe reuse, or a manual re-run), and the guard below makes the second run a
 * no-op instead of a second menu.
 *
 * This module is the only place that knows about both the manager adapter and
 * the UI: every feature (single conversion, batch run, picker, transform,
 * comparison, clipboard, metadata) is wired here, and each one reuses the same
 * acquisition/convert/save primitives rather than growing its own.
 */






























const INIT_FLAG = '__saveImageAsTypeInitialised';
const JOB_TOAST_ID = 'siat-job';
const BATCH_TOAST_ID = 'siat-batch';
/** Bytes buffered for an archive before the run falls back to separate files. */
const ZIP_FALLBACK_GRACE_BYTES = 8 * 1024 * 1024;

async function bootstrap(options = {}) {
  const doc = options.document || document;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!doc || !win) return null;

  // Idempotency: exactly one instance per document, however often the script is
  // injected (installed in two managers at once, re-run after a soft navigation,
  // or loaded twice). At `document-start` there is usually no <html> element
  // yet, so the marker has to be written to every root that exists *and* read
  // back from all of them: a marker written only on the Document was invisible
  // to a later injection, which then booted a second instance with a second set
  // of listeners — every right-click produced two conversions and two files.
  const markerRoots = () => [doc, doc.documentElement, doc.body, win].filter(Boolean);
  const existing = markerRoots().map((root) => root[INIT_FLAG]).find(Boolean);
  if (existing) {
    // Back-fill: <html>/<body> usually did not exist yet when the instance
    // booted at document-start, so a root added later gets the marker too.
    for (const root of markerRoots()) {
      if (!root[INIT_FLAG]) root[INIT_FLAG] = existing;
    }
    return existing;
  }

  // Published before any await so a second injection during boot sees it. The
  // real API is copied onto this object at the end; `ready` says when.
  const api = { ready: false };
  for (const root of markerRoots()) root[INIT_FLAG] = api;

  const gm = options.gm || getGm();
  const store = options.settingsStore || createSettingsStore({ gm });
  const toaster = createToaster(doc);

  const state = {
    settingsLoaded: false,
    capabilities: null,
    lastFormat: null,
    paused: false,
    job: null,
    batch: null,
    disposed: false,
    runCounter: 0,
    lastBatchOptions: null,
    shortcutCache: null,
  };
  const disposers = [];

  const getSettings = () => (state.settingsLoaded ? store.get() : DEFAULT_SETTINGS);

  async function ensureSettings() {
    if (state.settingsLoaded) return store.get();
    try {
      await store.load();
    } catch {
      /* keep defaults; the diagnostics panel reports the failure */
    }
    state.settingsLoaded = true;
    return store.get();
  }

  /** Probe once, lazily: which encoders this browser really has. */
  async function ensureCapabilities() {
    if (state.capabilities) return state.capabilities;
    const encoders = {};
    const encoderNotes = {};
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/avif']) {
      const ok = await canEncode(mime);
      encoders[mime] = ok;
      if (!ok) encoderNotes[mime] = 'canvas silently returns a PNG for this type in your browser';
    }
    const animation = await animationCapability();
    const clipboard = clipboardCapability(win);
    state.capabilities = {
      encoders,
      encoderNotes,
      animation: {
        decoderAvailable: animation.decoderAvailable,
        supportedTypes: Object.keys(animation.types || {}).filter((type) => animation.types[type]),
        reason: animation.reason || '',
      },
      clipboard: {
        supported: clipboard.supported,
        reasons: clipboard.reasons,
      },
    };
    return state.capabilities;
  }

  function diagnostics() {
    const capabilities = state.capabilities || {
      encoders: {},
      encoderNotes: {},
      animation: { decoderAvailable: false, supportedTypes: [] },
      clipboard: { supported: false, reasons: ['not probed yet'] },
    };
    return {
      handler: gm.handler,
      managerVersion: gm.managerVersion,
      scriptVersion: gm.scriptVersion || SCRIPT_VERSION_REPORTED,
      injectInto: gm.injectInto,
      downloadMode: gm.downloadMode,
      storage: store.info().storage,
      encoders: capabilities.encoders,
      encoderNotes: capabilities.encoderNotes,
      animation: capabilities.animation,
      clipboard: capabilities.clipboard,
      capabilities: gm.capabilities,
      batch: state.batch ? state.batch.stats() : null,
    };
  }

  function capabilityReport() {
    const d = diagnostics();
    return [
      `manager=${d.handler}/${d.managerVersion || '?'}`,
      `script=${d.scriptVersion || '?'}`,
      `downloadMode=${d.downloadMode}`,
      `storage=${d.storage}`,
      `encoders=${Object.keys(d.encoders).filter((k) => d.encoders[k]).map((k) => k.split('/')[1]).join(',') || 'none-probed'}`,
      `frames=${d.animation.decoderAvailable ? d.animation.supportedTypes.join(',') || 'decoder-present' : 'unavailable'}`,
      `clipboard=${d.clipboard.supported ? 'yes' : 'no'}`,
    ].join(' ');
  }

  /** Formats to show, with a `disabled` reason where the browser cannot deliver. */
  function getMenuFormats() {
    const settings = getSettings();
    const capabilities = state.capabilities;
    const wanted = (settings.formats && settings.formats.length ? settings.formats : defaultEnabledFormats()).filter((id) => getFormat(id));
    const ordered = [];
    if (settings.rememberLastFormat && state.lastFormat && wanted.includes(state.lastFormat)) {
      ordered.push(state.lastFormat);
    }
    for (const id of wanted) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    // "Original file" reads best at the bottom, whatever the stored order says.
    ordered.sort((a, b) => Number(a === 'original') - Number(b === 'original'));
    return ordered.map((id) => {
      const format = getFormat(id);
      let disabled = '';
      if (format.requiresEncodeProbe && capabilities && !capabilities.encoders[format.mime]) {
        disabled = `Not supported by this browser`;
      }
      if (state.paused) disabled = 'Paused on this page (see the manager menu)';
      return { id, label: format.label, ext: format.ext, hint: format.hint, disabled };
    });
  }

  /* ---------------- presets ---------------- */

  function pageHost() {
    try {
      return (win.location && win.location.hostname) || '';
    } catch {
      return '';
    }
  }

  /**
   * Settings with any active preset applied.
   *
   * A preset chosen by hand wins; otherwise a preset listing this host applies
   * automatically (most specific rule first). The stored settings are never
   * mutated, so turning a preset off restores exactly what the user had.
   */
  function resolveSettings() {
    const base = getSettings();
    const manual = (base.presets || []).find((preset) => preset.id === base.activePresetId) || null;
    const auto = !manual && base.autoApplyPresetByHost ? presetForHost(base.presets || [], pageHost()) : null;
    const preset = manual || auto;
    // Never hand out the stored object: callers read it as "the settings in
    // force right now", and a preset has to be visible without mutating storage.
    const effective = preset ? effectiveSettings(base, preset) : Object.assign({}, base);
    if (auto) effective.presetAutoApplied = true;
    effective.activeFormatId =
      effective.presetFormatId ||
      (base.rememberLastFormat && state.lastFormat ? state.lastFormat : '') ||
      (base.formats && base.formats.length ? base.formats[0] : '') ||
      'png';
    return effective;
  }

  function activePresetLabel() {
    const settings = resolveSettings();
    if (!settings.activePresetId) return '';
    const preset = (settings.presets || []).find((item) => item.id === settings.activePresetId);
    if (!preset) return '';
    return `${preset.name}${settings.presetAutoApplied ? ' (auto for this site)' : ''}`;
  }

  /* ---------------- extra menu actions ---------------- */

  function getMenuActions() {
    const settings = getSettings();
    const wanted = Array.isArray(settings.menuActions) ? settings.menuActions : [];
    const capabilities = state.capabilities;
    return wanted
      .filter((id) => MENU_ACTION_LABELS[id])
      .map((id) => {
        const meta = MENU_ACTION_LABELS[id];
        let disabled = '';
        if (state.paused) disabled = 'Paused on this page (see the manager menu)';
        else if (id === 'copy' && capabilities && !capabilities.clipboard.supported) {
          disabled = `Clipboard unavailable: ${capabilities.clipboard.reasons[0] || 'this browser cannot write images there'}`;
        }
        return { id, label: meta.label, hint: disabled ? '' : meta.hint, disabled };
      });
  }

  function onMenuAction(actionId, target) {
    switch (actionId) {
      case 'copy':
        copyImage(target);
        break;
      case 'transform':
        transformTarget(target);
        break;
      case 'compare':
        compareTarget(target);
        break;
      case 'inspect':
        inspectTarget(target);
        break;
      case 'browse':
        openPicker();
        break;
      case 'batch':
        openBatchDialog();
        break;
      default:
        break;
    }
  }

  /* ---------------- conversion job ---------------- */

  /**
   * Produce one output file (blob + name + report) without saving it.
   *
   * Both the single-image path and the batch path go through here, so naming,
   * transforms, presets and metadata handling behave identically everywhere.
   */
  async function produceOutput(target, formatId, runOptions = {}) {
    const settings = runOptions.settings || resolveSettings();
    const naming = Object.assign(
      {
        index: runOptions.index,
        preset: runOptions.preset || settings.activePresetName || '',
        template: runOptions.template !== undefined ? runOptions.template : settings.filenameTemplate,
        formatId,
      },
      runOptions.naming || {},
    );
    const produced = await convertImage({
      target,
      formatId,
      settings,
      gm,
      downloadMode: gm.downloadMode,
      signal: runOptions.signal,
      onProgress: runOptions.onProgress || (() => {}),
      timeout: runOptions.timeout,
      preacquired: runOptions.preacquired || null,
      transform: runOptions.transform !== undefined ? runOptions.transform : settings.presetTransform || settings.defaultTransform || null,
      stripEmbeddedMetadata: runOptions.stripMetadata === undefined ? null : runOptions.stripMetadata,
      naming,
    });
    // A batch writes many files at once: two identical names would silently
    // overwrite each other, so collisions get a counter.
    if (runOptions.taken && settings.filenameCollisionSuffix !== false) {
      const unique = uniqueFilename(produced.filename, runOptions.taken);
      if (unique !== produced.filename) {
        const renamed = rebuildPath(produced.path, produced.filename, unique);
        produced.report.notes.push(`Renamed to "${unique}" because another file in this run already had that name.`);
        return { blob: produced.blob, filename: unique, path: renamed, report: produced.report };
      }
    }
    return produced;
  }

  function rebuildPath(path, filename, newFilename) {
    const text = String(path || filename || '');
    if (text.endsWith(filename)) return `${text.slice(0, text.length - filename.length)}${newFilename}`;
    return newFilename;
  }

  async function runConversion(target, formatId, runOptions = {}) {
    await ensureSettings();
    const settings = runOptions.settings || resolveSettings();
    if (state.batch) {
      toaster.error('siat-busy', 'A batch run is in progress', 'Cancel it from the progress bar first, or wait for it to finish.');
      return null;
    }
    if (state.job) {
      toaster.error('siat-busy', 'A conversion is already running', 'Cancel it from the notification, or wait for it to finish.');
      return null;
    }
    const effectiveFormat = formatId || settings.presetFormatId || (settings.formats || [])[0] || 'png';
    const format = getFormat(effectiveFormat);
    if (!format) return null;
    const controller = makeController();
    state.job = { controller, formatId: effectiveFormat };
    state.lastFormat = effectiveFormat;

    const presetLabel = settings.activePresetName ? ` · preset ${settings.activePresetName}` : '';
    toaster.progress(JOB_TOAST_ID, `Saving as ${format.label}…${presetLabel}`, 'locating image', null, [
      { label: 'Cancel', variant: 'ghost', onClick: () => cancelJob() },
    ]);

    try {
      const produced = await produceOutput(target, effectiveFormat, Object.assign({}, runOptions, {
        settings,
        signal: controller.signal,
        onProgress: (stage) => {
          toaster.progress(JOB_TOAST_ID, `Saving as ${format.label}…${presetLabel}`, stage, null, [
            { label: 'Cancel', variant: 'ghost', onClick: () => cancelJob() },
          ]);
        },
      }));
      const { blob, filename, path, report } = produced;

      if (controller.signal.aborted) throw new CancelledError();

      toaster.progress(JOB_TOAST_ID, `Saving ${filename}`, 'writing file');
      const saved = await saveBlob({ blob, filename, path, settings, gm, downloadMode: gm.downloadMode });

      if (!saved.ok) {
        throw new ConversionError('save-failed', saved.message || 'The file could not be saved.', { fallbackReason: saved.fallbackReason });
      }

      const notes = (report.notes || []).slice();
      notes.push(`Output: ${report.mime}, ${report.sizeLabel}, ${report.durationMs} ms.`);
      if (report.width && report.height) notes.push(`Dimensions: ${report.width}×${report.height}px.`);
      if (report.transformed) notes.push(`Transform: ${report.transformed}.`);
      if (report.metadataRemoved && report.metadataRemoved.length) notes.push(`Metadata removed: ${report.metadataRemoved.join(', ')}.`);
      notes.push(`Saved ${saved.via === 'gm' ? 'through your userscript manager' : 'through the browser'}${saved.fallbackReason ? ` (manager download unavailable: ${saved.fallbackReason})` : ''}.`);
      if (saved.subfolderApplied) notes.push(`Sub-folder applied: ${path}`);
      if (settings.activePresetName) notes.unshift(`Preset "${settings.activePresetName}" was in effect.`);

      toaster.success(JOB_TOAST_ID, `Saved ${report.filename}`, `${report.kindLabel} · ${report.sizeLabel} · ${saved.message}`, notes, null, 10000);
      return { blob, filename, path, report, saved };
    } catch (err) {
      handleConversionError(err, format, settings);
      return null;
    } finally {
      state.job = null;
    }
  }

  function handleConversionError(err, format, settings) {
    if (err instanceof CancelledError || (err && err.code === 'aborted')) {
      toaster.progress(JOB_TOAST_ID, 'Conversion cancelled', `Nothing was written for the ${format.label} output.`);
      setTimeout(() => toaster.dismiss(JOB_TOAST_ID), 4000);
      return;
    }
    const message = messageOf(err, 'The conversion failed.');
    const help = helpForError(err, settings);
    const actions = [];
    if (help.opensSettings) actions.push({ label: 'Open settings', onClick: () => panel.open() });
    if (help.suggestFormat) {
      actions.push({
        label: `Save as ${getFormat(help.suggestFormat).label} instead`,
        onClick: () => {
          const target = lastTarget();
          if (target) runConversion(target, help.suggestFormat);
        },
      });
    }
    toaster.error(JOB_TOAST_ID, `Could not save as ${format.label}`, message, help.notes, actions, 16000);
    if (settings.notifyOnError) {
      gm.notify(message, `Save as ${format.label} failed`, { timeout: 8000 });
    }
  }

  function helpForError(err, settings) {
    const code = (err && err.code) || (err && err.reason) || '';
    const notes = [];
    switch (code) {
      case 'cors-blocked':
        return { opensSettings: true, notes: ['Turn on "Fetch cross-origin images through the manager" to convert images from other origins.'] };
      case 'xhr-unavailable':
        return { opensSettings: false, notes: ['Your manager did not grant GM_xmlhttpRequest, so cross-origin pixels are unreadable. Reinstall the script and accept the permissions.'] };
      case 'tainted-canvas':
        return { opensSettings: true, notes: ['The page drew cross-origin data into that canvas. Browsers forbid reading it back; this is a page-level restriction.'] };
      case 'memory-limit':
      case 'encoder-unavailable':
        return { opensSettings: true, suggestFormat: code === 'encoder-unavailable' ? 'png' : null, notes: [] };
      case 'no-original-bytes':
        return { opensSettings: false, suggestFormat: 'png', notes: [] };
      case 'transform-needs-format':
        return { opensSettings: false, suggestFormat: 'png', notes: [] };
      case 'transform-invalid':
      case 'transform-too-large':
        return { opensSettings: true, notes: ['Check the transform values: crop and resize must stay inside the image and inside the pixel ceiling.'] };
      case 'clipboard-unsupported':
        return { opensSettings: false, notes: ['This browser cannot put images on the clipboard. Saving a file works everywhere.'] };
      case 'save-failed':
        notes.push('The conversion succeeded but the file could not be handed to the browser. Check your manager’s download setting and your browser’s download permission.');
        if (err.detail && err.detail.fallbackReason === 'not_whitelisted') {
          notes.push('Tampermonkey: add this extension to Settings → Download → "File extension whitelist", or enable "Use browser API" for downloads.');
        }
        return { opensSettings: false, notes };
      case 'zip-empty':
      case 'zip-duplicate':
        return { opensSettings: false, notes: ['Nothing could be archived. The individual files were offered instead where possible.'] };
      case 'http-status':
      case 'fetch-failed':
      case 'timeout':
        return { opensSettings: false, notes: ['The image host refused or stalled the request. Try again; some CDNs rate-limit or require a referrer the manager does not send.'] };
      default:
        return { opensSettings: false, notes: settings.allowCrossOriginFetch ? [] : ['Cross-origin fetching is disabled in your settings.'] };
    }
  }

  function makeController() {
    return typeof AbortController === 'function'
      ? new AbortController()
      : { signal: { aborted: false, addEventListener() {}, removeEventListener() {} }, abort() {} };
  }

  function cancelJob() {
    if (!state.job) return false;
    try {
      state.job.controller.abort();
    } catch {
      /* noop */
    }
    return true;
  }

  /* ---------------- shared acquisition ---------------- */

  /**
   * Acquire one image and hand it to `work`, releasing it afterwards.
   *
   * Comparisons and multi-format batch items reuse a single acquisition, so N
   * outputs cost one request rather than N — which is also the privacy point:
   * the script fetches an image once, because the user asked for it once.
   */
  async function withAcquired(target, work, { signal, timeout = 45000, settings } = {}) {
    const effective = settings || resolveSettings();
    const acquired = await acquireImage(target, { settings: effective, gm, signal, timeout });
    try {
      return await work(acquired, effective);
    } finally {
      try {
        if (acquired.objectUrl) revokeLater(acquired.objectUrl, 1000);
        acquired.release();
      } catch {
        /* releasing is best-effort; a failure must not mask the real result */
      }
    }
  }

  /** Original bytes + MIME for the inspector and clipboard paths. */
  async function readBytesFor(target, { signal, timeout = 45000 } = {}) {
    const settings = await ensureSettings();
    return withAcquired(
      target,
      async (acquired) => {
        const have = acquired.bytes && acquired.bytes.length ? { bytes: acquired.bytes, mime: acquired.mimeHint } : null;
        const bytes = have || (await getOriginalBytes(acquired, { gm, settings, timeout }));
        if (!bytes || !bytes.bytes || !bytes.bytes.length) return null;
        const mime = bytes.mime || acquired.mimeHint || mimeFromUrl(acquired.url || target.url || '') || '';
        const name = baseNameFromSource({
          sourceUrl: acquired.finalUrl || acquired.url || target.url || '',
          altText: target.altText,
          documentTitle: safeTitle(),
          hostName: safeHost(acquired.url || target.url || ''),
        });
        return { bytes: bytes.bytes, mime, filename: name, url: acquired.url || target.url || '' };
      },
      { signal, timeout, settings },
    );
  }

  function safeTitle() {
    try {
      return doc.title || '';
    } catch {
      return '';
    }
  }

  /* ---------------- clipboard ---------------- */

  async function copyImage(target, runOptions = {}) {
    const settings = await ensureSettings();
    const capability = clipboardCapability(win);
    if (!capability.supported) {
      toaster.error(
        'siat-clipboard',
        'Clipboard is not available here',
        capability.reasons[0] || 'This browser cannot write images to the clipboard.',
        ['Saving a file works everywhere — right-click the image and pick a format.'],
        null,
        12000,
      );
      return { ok: false, reason: 'unsupported' };
    }
    const controller = makeController();
    const wantOriginal = (runOptions.format || settings.copyFormat) === 'original';
    toaster.progress('siat-clipboard', 'Copying image…', wantOriginal ? 'reading the original file' : 'encoding PNG', null, [
      { label: 'Cancel', variant: 'ghost', onClick: () => controller.abort() },
    ]);
    try {
      const result = await withAcquired(
        target,
        async (acquired) => {
          if (wantOriginal) {
            const bytes = acquired.bytes && acquired.bytes.length ? acquired.bytes : (await getOriginalBytes(acquired, { gm, settings, timeout: 30000 })) || null;
            if (bytes && bytes.bytes && bytes.bytes.length) {
              const mime = bytes.mime || acquired.mimeHint || 'image/png';
              return { blob: blobFromBytes(bytes.bytes, mime), mime, source: 'original' };
            }
          }
          // PNG is the only image type browsers reliably accept on a clipboard,
          // and canvas.toBlob is the only encoder available to a userscript.
          const blob = await encodeNative(canvasFor(acquired), 'image/png');
          return { blob, mime: 'image/png', source: 'png' };
        },
        { signal: controller.signal, settings },
      );

      const copied = await copyImageToClipboard({
        blob: result.blob,
        mime: result.mime,
        win,
        doc,
        toPng: async (blob) => encodeNative(drawToCanvas(await loadImageFromBlob(blob)).canvas, 'image/png'),
      });
      if (copied.ok) {
        toaster.success('siat-clipboard', 'Copied to the clipboard', copied.message, [copied.converted ? 'The browser accepts PNG only, so the image was re-encoded.' : `Source: ${result.source === 'original' ? 'the original file bytes' : 'a PNG render'}.`], null, 7000);
      } else {
        toaster.error('siat-clipboard', 'Could not copy the image', copied.message, [], null, 12000);
      }
      return copied;
    } catch (err) {
      const message = messageOf(err);
      toaster.error('siat-clipboard', 'Could not copy the image', message, [], null, 12000);
      return { ok: false, reason: (err && err.code) || 'failed', message };
    }
  }

  /** A canvas holding the acquired pixels; throws when there are none to read. */
  function canvasFor(acquired) {
    if (acquired.canvas) return acquired.canvas;
    if (acquired.image && (acquired.image.naturalWidth || acquired.image.width)) {
      return drawToCanvas(acquired.image).canvas;
    }
    throw new ConversionError('no-pixels', 'This image has no readable pixels to work with.');
  }

  /** Decode bytes already in memory, through the tracked object-URL helpers. */
  async function loadImageFromBlob(blob) {
    const url = objectUrlFor(blob);
    try {
      return await loadImage(url, { timeout: 20000 });
    } finally {
      revokeLater(url, 1000);
    }
  }

  /* ---------------- metadata inspector ---------------- */

  function inspectTarget(target) {
    ensureSettings().then(() => inspector.open(target));
  }

  /* ---------------- format comparison ---------------- */

  function compareTarget(target) {
    ensureSettings().then(() => compareDialog.open(target));
  }

  async function runComparison(target, { signal, onProgress }) {
    const settings = resolveSettings();
    const wanted = (settings.compareFormats && settings.compareFormats.length ? settings.compareFormats : comparableFormats(settings)).filter((id) => getFormat(id) && id !== 'original');
    const ids = wanted.length ? wanted.slice(0, 6) : ['png', 'jpg', 'webp'];
    return withAcquired(
      target,
      (acquired) =>
        compareFormats({
          formatIds: ids,
          signal,
          onProgress,
          convert: (formatId) =>
            produceOutput(target, formatId, {
              settings,
              signal,
              preacquired: acquired,
              onProgress,
              naming: { index: undefined },
            }),
        }),
      { signal, settings },
    );
  }

  /* ---------------- transform ---------------- */

  function transformTarget(target) {
    ensureSettings().then(() => transformDialog.open(target));
  }

  async function loadTransformPreview(target) {
    const settings = resolveSettings();
    const acquired = await acquireImage(target, { settings, gm, timeout: 45000 });
    const drawable = acquired.image || acquired.canvas;
    if (!drawable) {
      acquired.release();
      throw new ConversionError('no-pixels', 'This image has no readable pixels to transform.');
    }
    return {
      drawable,
      width: acquired.width || drawable.naturalWidth || drawable.width || 0,
      height: acquired.height || drawable.naturalHeight || drawable.height || 0,
      release() {
        try {
          if (acquired.objectUrl) revokeLater(acquired.objectUrl, 1000);
          acquired.release();
        } catch {
          /* noop */
        }
      },
    };
  }

  /* ---------------- page inventory and picker ---------------- */

  function scanPage(overrides = {}) {
    const settings = getSettings();
    return scanImages(doc, {
      includeBackgrounds: settings.scanBackgrounds !== false,
      maxStyleScan: Number(settings.scanElementCap) || 2500,
      maxEntries: 1000,
      ...overrides,
    });
  }

  function openPicker() {
    ensureSettings().then(() => picker.open());
  }

  /** Turn one inventory entry back into a conversion target. */
  function targetForEntry(entry) {
    if (!entry) return null;
    if (entry.element && entry.element.isConnected !== false) {
      const settings = getSettings();
      const resolved = resolveImageTarget(entry.element, { enableBackgroundImages: settings.enableBackgroundImages });
      if (resolved) return resolved;
    }
    if (entry.url) {
      return {
        kind: entry.kind === 'background' ? 'background' : 'img',
        element: entry.element || null,
        url: entry.url,
        altText: entry.alt || '',
        naturalWidth: entry.natural ? entry.natural.width : 0,
        naturalHeight: entry.natural ? entry.natural.height : 0,
      };
    }
    return null;
  }

  /**
   * Build the batch plan shown in the confirmation dialog.
   *
   * Pure computation over a scan: no downloads, no DOM changes, and every
   * skipped image is counted with a reason rather than disappearing.
   */
  function planBatch(runOptions = {}) {
    const settings = resolveSettings();
    // A picker-driven run already chose its entries: re-scanning would throw the
    // selection away and walk the DOM a second time for nothing.
    const scan =
      Array.isArray(runOptions.entries) && runOptions.entries.length ? { entries: runOptions.entries, notes: [] } : scanPage();
    const list = scan.entries.slice();
    const found = list.length;

    let skippedTiny = 0;
    let skippedNotLoaded = 0;
    let skippedBroken = 0;
    let skippedTooSmall = 0;
    const eligible = [];
    for (const entry of list) {
      if (entry.state === 'broken' || entry.state === 'empty') {
        skippedBroken += 1;
        continue;
      }
      if (runOptions.skipTiny !== false && entry.tiny) {
        skippedTiny += 1;
        continue;
      }
      if ((Number(runOptions.minWidth) || 0) > 0 || (Number(runOptions.minHeight) || 0) > 0) {
        const width = entry.natural.width || entry.displayed.width || 0;
        const height = entry.natural.height || entry.displayed.height || 0;
        if (width && height && (width < (Number(runOptions.minWidth) || 0) || height < (Number(runOptions.minHeight) || 0))) {
          skippedTooSmall += 1;
          continue;
        }
      }
      if (entry.state !== 'loaded') {
        if (runOptions.includeNotLoaded && entry.lazyUrl) {
          eligible.push(entry);
          continue;
        }
        skippedNotLoaded += 1;
        continue;
      }
      eligible.push(entry);
    }

    let skippedDuplicate = 0;
    let chosen = eligible;
    if (runOptions.dedupe !== false) {
      const before = eligible.length;
      chosen = dedupeEntries(eligible);
      skippedDuplicate = before - chosen.length;
    }

    const limit = Math.max(1, Math.min(2000, Number(settings.batchMaxImages) || 200));
    const skippedLimit = Math.max(0, chosen.length - limit);
    const items = chosen.slice(0, limit);

    const formatIds = formatListFor(runOptions, settings);
    const summary = summarizeInventory(items);
    const notes = scan.notes.slice();
    if (skippedNotLoaded) {
      notes.push(
        `${skippedNotLoaded} image${skippedNotLoaded === 1 ? '' : 's'} were skipped because the page has not loaded ${skippedNotLoaded === 1 ? 'it' : 'them'} yet. ` +
          'Tick "Also download images the page has not loaded yet" to include them (that costs bandwidth).',
      );
    }
    if (skippedBroken) notes.push(`${skippedBroken} image${skippedBroken === 1 ? '' : 's'} could not be loaded by the page at all and were skipped.`);
    if (skippedTiny) notes.push(`${skippedTiny} icon-sized image${skippedTiny === 1 ? '' : 's'} were skipped.`);
    if (skippedDuplicate) notes.push(`${skippedDuplicate} duplicate URL${skippedDuplicate === 1 ? '' : 's'} were merged into one output.`);
    if (skippedTooSmall) notes.push(`${skippedTooSmall} image${skippedTooSmall === 1 ? '' : 's'} were below the minimum size.`);
    if (skippedLimit) notes.push(`Only the first ${limit} images are converted per run (Settings → Batch); ${skippedLimit} were left out.`);
    if (summary.crossOrigin) {
      notes.push(
        settings.allowCrossOriginFetch
          ? `${summary.crossOrigin} image${summary.crossOrigin === 1 ? '' : 's'} come from another origin and will be fetched through your userscript manager.`
          : `${summary.crossOrigin} cross-origin image${summary.crossOrigin === 1 ? '' : 's'} may fail: cross-origin fetching is off in your settings.`,
      );
    }
    if (runOptions.destination === 'zip') {
      notes.push('Everything is buffered in memory to build one archive; if it grows past your limit the rest are saved as separate files.');
    }

    return {
      found,
      eligible: items.length,
      files: items.length * formatIds.length,
      skippedTiny,
      skippedNotLoaded,
      skippedBroken,
      skippedDuplicate,
      skippedTooSmall,
      skippedLimit,
      crossOrigin: summary.crossOrigin,
      destination: runOptions.destination === 'zip' ? 'zip' : 'files',
      concurrency: Math.max(1, Math.min(4, Number(settings.batchConcurrency) || 2)),
      formatIds,
      entries: items,
      estimateLabel: `${items.length * formatIds.length} file${items.length * formatIds.length === 1 ? '' : 's'} at ${Math.max(1, Math.min(4, Number(settings.batchConcurrency) || 2))} at a time`,
      notes,
      megapixels: summary.megapixels,
    };
  }

  function formatListFor(runOptions, settings) {
    const primary = runOptions.formatId && getFormat(runOptions.formatId) ? runOptions.formatId : settings.presetFormatId || (settings.formats || [])[0] || 'png';
    const extras = Array.isArray(runOptions.extraFormats) ? runOptions.extraFormats.filter((id) => getFormat(id) && id !== primary) : [];
    return [primary].concat(extras).slice(0, 6);
  }

  function openBatchDialog() {
    if (state.batch) {
      toaster.error('siat-busy', 'A batch run is already in progress', 'Cancel it from the progress bar first.');
      return;
    }
    ensureSettings().then(() => batchDialog.open());
  }

  /**
   * Run a batch.
   *
   * @param {object} runOptions same shape as the dialog's options, plus `entries`
   *        when the run comes from a picker selection instead of the whole page.
   */
  async function startBatch(runOptions = {}) {
    await ensureSettings();
    const settings = resolveSettings();
    if (state.batch) {
      toaster.error('siat-busy', 'A batch run is already in progress', 'Cancel it from the progress bar first.');
      return null;
    }
    if (state.job) {
      toaster.error('siat-busy', 'A conversion is already running', 'Wait for it to finish, then start the batch.');
      return null;
    }

    const plan = runOptions.plan || planBatch(runOptions);
    const entries = Array.isArray(runOptions.entries) && runOptions.entries.length ? runOptions.entries : plan.entries;
    if (!entries.length) {
      toaster.error(BATCH_TOAST_ID, 'Nothing to convert', (plan.notes && plan.notes[0]) || 'No image on this page matched the filters.', [], null, 10000);
      return null;
    }

    const formatIds = runOptions.formatIds || plan.formatIds || ['png'];
    const destination =
      runOptions.destination === 'zip' || (runOptions.destination === undefined && settings.presetDestination === 'zip') ? 'zip' : 'files';
    const controller = makeController();
    const taken = new Set();
    // One mutable record for the run: the queue workers, the archive check and
    // the summary all read the same object, so nothing can disagree about state.
    const runState = { archive: [], zipOverflow: false, index: 0 };
    const zipLimitBytes = Math.max(1, Number(settings.zipMaxMB) || 512) * 1024 * 1024;
    const showBar = settings.showJobBar !== false;
    state.runCounter += 1;
    const runId = state.runCounter;
    // Kept so "Retry the failed ones" replays the same run: by then the queue is
    // destroyed, and a fresh plan would silently lose the chosen formats.
    state.lastBatchOptions = {
      formatIds,
      destination,
      includeNotLoaded: Boolean(runOptions.includeNotLoaded),
      skipTiny: runOptions.skipTiny,
      dedupe: runOptions.dedupe,
      minWidth: Number(runOptions.minWidth) || 0,
      minHeight: Number(runOptions.minHeight) || 0,
    };

    const entriesById = new Map();
    const queue = createJobQueue({
      concurrency: plan.concurrency,
      itemTimeoutMs: 120000,
      // A save can reach the disk even when the manager reports failure, so
      // nothing is repeated automatically; the user retries explicitly.
      autoRetries: 0,
      label: destination === 'zip' ? 'Building archive' : 'Batch conversion',
      onEvent: (event) => {
        if (runId !== state.runCounter) return;
        if (event.type === 'item-start' || event.type === 'item-end') {
          const stats = queue.stats();
          toaster.progress(BATCH_TOAST_ID, destination === 'zip' ? 'Building ZIP archive…' : 'Converting images…', `${stats.done + stats.failed + stats.skipped}/${stats.total} finished · ${stats.running} running`, [], [{ label: 'Cancel', variant: 'ghost', onClick: () => cancelBatch() }]);
        }
        if (!showBar) return;
        if (event.type === 'item-end' || event.type === 'finished' || event.type === 'cancelled') {
          jobbar.update(queue.stats(), queue.items());
        }
      },
      run: (item, helpers) =>
        runBatchItem(item, {
          helpers,
          settings,
          formatIds,
          destination,
          taken,
          runState,
          zipLimitBytes,
          controller,
          runId,
          nextIndex: () => (runState.index += 1),
        }),
    });

    const items = entries.map((entry) => {
      const id = `entry:${entry.id}`;
      const label = entryLabel(entry);
      entriesById.set(id, entry);
      const target = targetForEntry(entry);
      if (!target) return { id, label, skipReason: 'The image is no longer on the page.' };
      if (entry.state !== 'loaded' && !runOptions.includeNotLoaded) {
        return { id, label, skipReason: 'Not loaded by the page yet — tick "Also download images the page has not loaded yet".' };
      }
      return { id, label, payload: { entry, target } };
    });

    state.batch = { queue, controller, destination, runId, startedAt: Date.now() };
    if (showBar) jobbar.show(destination === 'zip' ? 'Building ZIP archive' : 'Batch conversion');
    queue.add(items);
    queue.start();

    // The queue pumps asynchronously; wait for it to settle so the caller (and
    // the summary toast) sees the final state.
    await waitForQueue(queue, controller, entriesById);

    const stats = queue.stats();
    let archiveResult = null;
    if (destination === 'zip' && runState.archive.length) {
      archiveResult = await finishArchive({ archive: runState.archive, settings, taken });
    } else if (destination === 'zip' && runState.zipOverflow) {
      toaster.progress(BATCH_TOAST_ID, 'Archive limit reached', 'Files were saved individually instead.', [], null, 9000);
    }

    const summary = summariseBatch(stats, archiveResult, { zipOverflow: runState.zipOverflow, destination, queue });
    toaster.success(BATCH_TOAST_ID, summary.title, summary.detail, summary.notes, summary.actions, null, 16000);
    if (showBar) jobbar.finish(`${summary.title} — ${summary.detail}`, { failed: stats.failed });

    state.batch = null;
    queue.destroy();
    return { stats, archiveResult, summary };
  }

  function entryLabel(entry) {
    const fromUrl = String(entry.url || '').split('/').pop().split('?')[0];
    const text = fromUrl || entry.alt || `${entry.kind} image`;
    return text.length > 48 ? `…${text.slice(-47)}` : text;
  }

  async function runBatchItem(item, context) {
    const { helpers, settings, formatIds, destination, taken, runState, zipLimitBytes, controller, runId } = context;
    if (runId !== state.runCounter) throw new CancelledError('This run was replaced.');
    const payload = item.payload || {};
    const target = payload.target;
    if (!target) {
      const error = new ConversionError('no-target', 'The image is no longer on the page.');
      error.retryable = false;
      throw error;
    }

    const signal = helpers.signal;
    if (controller && controller.signal.aborted) throw new CancelledError();

    const written = [];
    const failures = [];
    let bytesTotal = 0;
    // Set only by a save whose outcome the manager could not confirm.
    let uncertain = false;

    await withAcquired(
      target,
      async (acquired) => {
        for (const formatId of formatIds) {
          if (signal && signal.aborted) throw new CancelledError();
          const index = context.nextIndex();
          try {
            const produced = await produceOutput(target, formatId, {
              settings,
              signal,
              preacquired: acquired,
              index,
              taken,
              timeout: 90000,
            });
            taken.add(produced.filename);
            bytesTotal += produced.blob.size;
            if (destination === 'zip') {
              const bytes = new Uint8Array(await produced.blob.arrayBuffer());
              if (runState.zipOverflow) {
                // Past the in-memory limit: keep working, but write to disk
                // instead of growing the buffer without bound.
                await saveSingle(produced, settings);
                written.push(`${produced.filename} (saved separately)`);
              } else {
                runState.archive.push({ name: produced.path || produced.filename, bytes });
                written.push(produced.filename);
              }
            } else {
              await saveSingle(produced, settings);
              written.push(produced.filename);
            }
          } catch (err) {
            if (err instanceof CancelledError || (err && err.code === 'aborted')) throw err;
            if (err && err.uncertain) uncertain = true;
            failures.push(`${getFormat(formatId) ? getFormat(formatId).label : formatId}: ${messageOf(err)}`);
          }
        }
      },
      { signal, settings },
    ).catch((err) => {
      failures.push(messageOf(err));
      if (err instanceof CancelledError || (err && err.code === 'aborted')) throw err;
    });

    // Archive growth is measured once per item, in one place, so the switch to
    // "save the rest individually" cannot flip back and forth mid-run.
    if (destination === 'zip' && !runState.zipOverflow) {
      const projected = estimateZipSize(runState.archive);
      if (projected > zipLimitBytes + ZIP_FALLBACK_GRACE_BYTES) runState.zipOverflow = true;
    }

    if (!written.length) {
      const error = new ConversionError('batch-item-failed', failures.join(' ') || 'Nothing could be produced from this image.');
      error.uncertain = uncertain;
      error.retryable = !uncertain;
      throw error;
    }
    if (failures.length) {
      // Partial success is reported as a failure with the detail attached, so
      // the user sees both what landed and what did not.
      const error = new ConversionError('batch-partial', `${written.length} of ${formatIds.length} outputs written. Failures: ${failures.join(' ')}`);
      error.uncertain = uncertain;
      error.retryable = false;
      throw error;
    }
    return { files: written, bytes: bytesTotal };
  }

  async function saveSingle(produced, settings) {
    const saved = await saveBlob({
      blob: produced.blob,
      filename: produced.filename,
      path: produced.path,
      settings,
      gm,
      downloadMode: gm.downloadMode,
    });
    if (!saved.ok) {
      const error = new ConversionError('save-failed', saved.message || 'The file could not be saved.', { fallbackReason: saved.fallbackReason });
      // `uncertain` comes from the download layer: it knows whether the manager
      // gave a definite refusal (nothing written, safe to retry) or an outcome
      // it could not confirm (the file may be on disk, so never repeat silently).
      error.uncertain = Boolean(saved.uncertain);
      error.retryable = !error.uncertain;
      throw error;
    }
    return saved;
  }

  async function finishArchive({ archive, settings, taken }) {
    const name = uniqueFilename(archiveName(), taken);
    let archiveBuilt = false;
    try {
      const built = encodeZip(archive, { comment: `Created by Save Image as Type ${SCRIPT_VERSION_REPORTED}` });
      const blob = blobFromBytes(built.bytes, 'application/zip');
      const named = buildFilename({
        base: name.replace(/\.zip$/i, ''),
        ext: 'zip',
        prefix: settings.filenamePrefix,
        subfolder: settings.subfolder,
        maxLength: settings.maxFilenameLength,
        includeSubfolder: settings.subfolder ? gm.downloadMode === 'browser' : false,
      });
      archiveBuilt = true;
      const saved = await saveBlob({ blob, filename: named.filename, path: named.path, settings, gm, downloadMode: gm.downloadMode });
      return {
        ok: saved.ok,
        filename: named.filename,
        entries: built.entries.length,
        bytes: built.bytes.length,
        notes: built.notes.concat(saved.ok ? [saved.message] : [saved.message || 'The archive could not be saved.']),
        via: saved.via,
      };
    } catch (err) {
      if (archiveBuilt) {
        return { ok: false, filename: name, entries: archive.length, bytes: 0, notes: [`Archive save was not confirmed (${messageOf(err)}). Check downloads before saving again; no outputs were replayed.`], uncertain: true };
      }
      // Fall back to writing the buffered files individually: the work is done,
      // only the container failed, and throwing it away would be worse.
      const notes = [`Building the archive failed (${messageOf(err)}); the files were saved individually instead.`];
      let savedCount = 0;
      for (const entry of archive) {
        try {
          const blob = blobFromBytes(entry.bytes, mimeFromUrl(entry.name) || 'application/octet-stream');
          const filename = uniqueFilename(String(entry.name).split('/').pop(), taken);
          taken.add(filename);
          const saved = await saveBlob({ blob, filename, path: filename, settings, gm, downloadMode: gm.downloadMode });
          if (saved.ok) savedCount += 1;
        } catch {
          /* reported in the summary count */
        }
      }
      notes.push(`${savedCount} of ${archive.length} files were saved individually.`);
      return { ok: savedCount > 0, filename: '', entries: archive.length, bytes: 0, notes, via: 'fallback-files', failed: true };
    }
  }

  function archiveName() {
    const host = pageHost() || 'page';
    const stamp = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${host}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.zip`;
  }

  function summariseBatch(stats, archiveResult, { zipOverflow, destination, queue }) {
    const notes = [];
    if (archiveResult) {
      for (const note of archiveResult.notes || []) notes.push(note);
      if (archiveResult.ok && archiveResult.filename) {
        notes.push(`${archiveResult.entries} file${archiveResult.entries === 1 ? '' : 's'} in ${archiveResult.filename} (${(archiveResult.bytes / 1048576).toFixed(1)} MB).`);
      }
    }
    if (zipOverflow) notes.push('The archive size limit was reached, so later images were saved as separate files.');
    if (stats.uncertain) {
      notes.push(
        `${stats.uncertain} save${stats.uncertain === 1 ? '' : 's'} ended with an unknown result. Check your downloads folder before retrying — retrying blindly could create duplicates.`,
      );
    }
    if (stats.failed) {
      const firstFailures = [];
      for (const item of queue ? queue.items() : []) {
        if (item.state === ITEM_STATES.FAILED && firstFailures.length < 3) firstFailures.push(`${item.label}: ${item.error || item.errorCode}`);
      }
      notes.push(...firstFailures);
    }
    if (stats.skipped) notes.push(`${stats.skipped} image${stats.skipped === 1 ? '' : 's'} were skipped without being attempted.`);
    if (stats.cancelled) notes.push(`${stats.cancelled} queued image${stats.cancelled === 1 ? '' : 's'} were cancelled before they started.`);

    const savedCount = archiveResult && archiveResult.ok ? archiveResult.entries : stats.done;
    const title =
      stats.cancelled > 0 && stats.done === 0
        ? 'Batch cancelled'
        : destination === 'zip' && archiveResult && archiveResult.ok
          ? `Saved ${archiveResult.filename}`
          : destination === 'zip' && archiveResult && !archiveResult.ok
            ? 'Archive save was not confirmed'
            : `${savedCount} file${savedCount === 1 ? '' : 's'} saved`;
    const detail = [
      `${stats.done}/${stats.total} images converted`,
      stats.failed ? `${stats.failed} failed` : '',
      stats.skipped ? `${stats.skipped} skipped` : '',
      stats.bytes ? `${(stats.bytes / 1048576).toFixed(1)} MB` : '',
      `${Math.round(stats.durationMs / 1000)}s`,
    ]
      .filter(Boolean)
      .join(' · ');

    const actions = [];
    if (stats.failed) {
      actions.push({
        label: 'Retry the failed ones',
        variant: 'ghost',
        onClick: () => retryFailedBatch(),
      });
    }
    return { title, detail, notes: notes.slice(0, 8), actions };
  }

  /**
   * Re-run only the images that failed.
   *
   * The previous run's queue is gone by the time the toast action is pressed, so
   * the failed entries are collected before the queue is destroyed and replayed
   * as a new run — which is still safe, because a file that saved successfully is
   * never in that list.
   */
  let lastFailedEntries = [];
  function retryFailedBatch() {
    if (!lastFailedEntries.length) {
      toaster.error(BATCH_TOAST_ID, 'Nothing to retry', 'No safely retryable items remain. Partial or unconfirmed saves are not replayed: check your downloads and select only the missing outputs manually.', [], null, 8000);
      return;
    }
    const entries = lastFailedEntries.slice();
    lastFailedEntries = [];
    // Replay with the original run's options: same formats, same destination.
    // Only entries that failed are included, so a file that already saved is
    // never written a second time.
    startBatch(Object.assign({}, state.lastBatchOptions || {}, { entries, retry: true }));
  }

  function waitForQueue(queue, controller, entriesById) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimeout(timer);
        // Collect the failures before the caller destroys the queue: item
        // snapshots carry no payload, so the entry lookup happens here.
        const byId = entriesById instanceof Map ? entriesById : new Map();
        lastFailedEntries = queue
          .items()
          .filter((item) => item.state === ITEM_STATES.FAILED && item.retryable && !item.uncertain)
          .map((item) => byId.get(item.id))
          .filter(Boolean);
        resolve();
      };
      const unsubscribe = queue.subscribe((event) => {
        if (event.type === 'finished' || event.type === 'cancelled') {
          // Give in-flight items a moment to record their final state.
          setTimeout(finish, 60);
        }
      });
      // Absolute ceiling: a wedged encoder must not keep the summary pending
      // forever. Cleared as soon as the run settles.
      const timer = setTimeout(finish, 30 * 60 * 1000);
      if (controller && controller.signal && typeof controller.signal.addEventListener === 'function') {
        controller.signal.addEventListener('abort', () => setTimeout(finish, 200), { once: true });
      }
      if (queue.stats().complete) finish();
    });
  }

  function cancelBatch() {
    if (!state.batch) return false;
    try {
      state.batch.controller.abort();
    } catch {
      /* noop */
    }
    state.batch.queue.cancel();
    jobbar.update(state.batch.queue.stats(), state.batch.queue.items());
    return true;
  }

  /* ---------------- target bookkeeping ---------------- */

  let rememberedTarget = null;
  function lastTarget() {
    return rememberedTarget && rememberedTarget.element && rememberedTarget.element.isConnected !== false ? rememberedTarget : null;
  }

  /* ---------------- UI wiring ---------------- */

  const panel = createSettingsPanel({
    document: doc,
    getSettings: () => store.get(),
    gm: () => gm,
    diagnostics,
    capabilityReport,
    settingsWarnings: () => store.info().warnings || [],
    saveSettings: async (patch) => {
      const result = await store.save(patch);
      applySettingsSideEffects(store.get());
      return result;
    },
    resetSettings: async () => {
      const result = await store.reset();
      applySettingsSideEffects(result.settings);
      return result.settings;
    },
  });

  const menu = createContextMenu({
    document: doc,
    getSettings,
    getMenuFormats,
    getMenuActions,
    isBusy: () => Boolean(state.job) || Boolean(state.batch),
    onCancel: () => (state.batch ? cancelBatch() : cancelJob()),
    onOpenSettings: () => {
      ensureSettings().then(() => panel.open());
    },
    onPick: (formatId, target) => {
      rememberedTarget = target;
      runConversion(target, formatId);
    },
    onAction: (actionId, target) => {
      rememberedTarget = target;
      onMenuAction(actionId, target);
    },
  });

  const jobbar = createJobBar({
    document: doc,
    onCancel: () => cancelBatch(),
    onRetry: () => {
      if (state.batch) {
        toaster.error('siat-retry-wait', 'Wait for this batch to finish', 'Retry is available after the run settles; partial and unconfirmed saves are never replayed.');
      } else retryFailedBatch();
    },
    onClose: () => jobbar.hide(),
  });

  const picker = createImagePicker({
    document: doc,
    settings: () => resolveSettings(),
    formats: getMenuFormats,
    scan: (overrides) => scanPage(overrides),
    thumbnail: (entry) =>
      createThumbnail(entry, {
        size: 88,
        createCanvas,
        // Both are local: an inline <svg> is serialised to a blob URL, never fetched.
        svgToObjectUrl: svgElementToObjectUrl,
        loadImage,
      }),
    actions: {
      convert: ({ entries, formatId, destination }) => {
        // The user ticked these rows, so a deferred image is fetched on purpose.
        startBatch({ entries, formatId, extraFormats: [], destination, includeNotLoaded: true, fromPicker: true });
      },
      copy: (entry) => {
        const target = targetForEntry(entry);
        if (target) copyImage(target);
      },
      inspect: (entry) => {
        const target = targetForEntry(entry);
        if (target) inspectTarget(target);
      },
      transform: (entry) => {
        const target = targetForEntry(entry);
        if (target) transformTarget(target);
      },
      compare: (entry) => {
        const target = targetForEntry(entry);
        if (target) compareTarget(target);
      },
      loadNotLoaded: async (entries) => {
        const targets = entries.filter((entry) => entry.lazyUrl && entry.element);
        for (const entry of targets.slice(0, 40)) {
          // Explicit user action: the page fetches an image it had deferred.
          try {
            entry.element.loading = 'eager';
            entry.element.src = entry.lazyUrl;
          } catch {
            /* a page that blocks this simply stays unloaded */
          }
        }
        await waitForImages(targets.slice(0, 40), 8000);
        return targets.length;
      },
    },
  });

  function waitForImages(entries, timeoutMs) {
    return new Promise((resolve) => {
      const pending = entries.filter((entry) => entry.element && entry.element.tagName === 'IMG');
      if (!pending.length) {
        resolve();
        return;
      }
      let remaining = pending.length;
      let settled = false;
      const timer = setTimeout(done, timeoutMs);
      function done() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      for (const entry of pending) {
        const image = entry.element;
        let counted = false;
        const settle = () => {
          if (counted) return;
          counted = true;
          remaining -= 1;
          image.removeEventListener('load', settle);
          image.removeEventListener('error', settle);
          if (remaining <= 0) done();
        };
        image.addEventListener('load', settle);
        image.addEventListener('error', settle);
        if (image.complete) settle();
      }
    });
  }

  const transformDialog = createTransformDialog({
    document: doc,
    settings: () => resolveSettings(),
    formats: getMenuFormats,
    createCanvas,
    loadPreview: loadTransformPreview,
    onSubmit: async ({ target, transform, formatId, makeDefault }) => {
      rememberedTarget = target;
      if (makeDefault) {
        const result = await store.save({ defaultTransform: transform });
        toaster.progress(
          'siat-transform',
          result && result.ok ? 'Transform saved as your default' : 'Transform applies to this save only',
          result && result.ok ? 'Every conversion now starts from it; clear it in Settings → Batch and transforms.' : 'Your settings could not be written, so it was not stored.',
          null,
          null,
        );
        setTimeout(() => toaster.dismiss('siat-transform'), 6000);
      }
      runConversion(target, formatId, { transform });
    },
  });

  const compareDialog = createCompareDialog({
    document: doc,
    compare: (target, helpers) => runComparison(target, helpers),
    onSave: (target, formatId) => {
      rememberedTarget = target;
      runConversion(target, formatId);
    },
  });

  const inspector = createMetadataInspector({
    document: doc,
    settings: () => resolveSettings(),
    loadBytes: (target) =>
      readBytesFor(target).then((file) => {
        if (!file) throw new ConversionError('no-original-bytes', 'This image has no original file to inspect (it may be generated in the page).');
        return file;
      }),
    onSave: (target, saveOptions) => {
      rememberedTarget = target;
      runConversion(target, 'original', { stripMetadata: Boolean(saveOptions && saveOptions.stripMetadata) });
    },
  });

  const shortcutHelp = createShortcutHelp({
    document: doc,
    settings: () => store.get(),
    onOpenSettings: () => panel.open(),
  });

  const batchDialog = createBatchDialog({
    document: doc,
    settings: () => resolveSettings(),
    formats: getMenuFormats,
    plan: (runOptions) => planBatch(runOptions),
    onStart: (runOptions) => {
      startBatch(runOptions);
    },
    onOpenPicker: () => picker.open(),
  });

  function applySettingsSideEffects(settings) {
    if (state.disposed) return;
    if (settings.interceptContextMenu && !state.paused) menu.attach();
    else menu.detach();
  }

  /* ---------------- keyboard shortcuts ---------------- */

  function onGlobalKeydown(event) {
    const settings = getSettings();
    if (settings.enableShortcuts === false) return;
    if (event.defaultPrevented) return;
    const checked = checkedShortcuts(settings);
    if (isTypingTarget(event.target) && !event.ctrlKey && !event.altKey && !event.metaKey) return;
    for (const action of SHORTCUT_ACTIONS) {
      const binding = checked.shortcuts[action.id];
      if (!binding) continue;
      if (!matchesBinding(event, binding)) continue;
      event.preventDefault();
      event.stopPropagation();
      handleShortcut(action.id);
      return;
    }
  }

  function handleShortcut(actionId) {
    switch (actionId) {
      case 'quickSave': {
        const target = menu.hoveredTarget() || lastTarget();
        if (!target) {
          noTargetToast('Point the mouse at an image first, then press the shortcut again.');
          return;
        }
        const settings = resolveSettings();
        rememberedTarget = target;
        runConversion(target, settings.presetFormatId || state.lastFormat || (settings.formats || [])[0] || 'png');
        break;
      }
      case 'copyImage': {
        const target = menu.hoveredTarget() || lastTarget();
        if (!target) {
          noTargetToast('Point the mouse at an image first, then press the shortcut again.');
          return;
        }
        rememberedTarget = target;
        copyImage(target);
        break;
      }
      case 'openPicker':
        openPicker();
        break;
      case 'saveAll':
        openBatchDialog();
        break;
      case 'cancelJob':
        if (!cancelBatch() && !cancelJob()) {
          toaster.progress('siat-cancel', 'Nothing is running', 'There is no conversion or batch to cancel.', null, null);
          setTimeout(() => toaster.dismiss('siat-cancel'), 4000);
        }
        break;
      default:
        break;
    }
  }

  function noTargetToast(detail) {
    toaster.error('siat-no-target', 'No image to act on', detail, [], null, 8000);
  }

  /**
   * Validated bindings, recomputed only when the stored settings object changes:
   * validating on every keypress would allocate a fresh binding map per key.
   */
  function checkedShortcuts(settings) {
    if (state.shortcutCache && state.shortcutCache.source === settings.shortcuts) return state.shortcutCache.checked;
    const checked = validateShortcuts(settings.shortcuts || {});
    state.shortcutCache = { source: settings.shortcuts, checked };
    return checked;
  }

  function attachShortcuts() {
    const handler = onGlobalKeydown;
    doc.addEventListener('keydown', handler, true);
    disposers.push(() => doc.removeEventListener('keydown', handler, true));
  }

  /* ---------------- manager menu commands ---------------- */

  gm.registerMenuCommand('Save Image as Type — Settings…', () => {
    ensureSettings().then(() => panel.open());
  });
  gm.registerMenuCommand('Save Image as Type — Convert the last image I pointed at…', () => {
    ensureSettings().then(() => {
      if (!menu.openForLastHovered()) {
        toaster.error('siat-no-target', 'No image to convert yet', 'Point at an image on the page first, then use this command (or right-click the image).');
      }
    });
  });
  gm.registerMenuCommand('Save Image as Type — Browse page images…', () => {
    ensureSettings().then(() => picker.open());
  });
  gm.registerMenuCommand('Save Image as Type — Convert every image on this page…', () => {
    ensureSettings().then(() => openBatchDialog());
  });
  gm.registerMenuCommand('Save Image as Type — Copy the last image I pointed at', () => {
    ensureSettings().then(() => {
      const target = menu.hoveredTarget();
      if (!target) {
        noTargetToast('Point at an image on the page first, then run this command.');
        return;
      }
      rememberedTarget = target;
      copyImage(target);
    });
  });
  gm.registerMenuCommand('Save Image as Type — Keyboard shortcut help', () => {
    ensureSettings().then(() => shortcutHelp.open());
  });
  gm.registerMenuCommand('Save Image as Type — Capability report', () => {
    ensureSettings()
      .then(ensureCapabilities)
      .then(() => {
        const d = diagnostics();
        const lines = [
          `Encoders: ${Object.keys(d.encoders).map((k) => `${k.split('/')[1]}=${d.encoders[k] ? 'yes' : 'no'}`).join(', ')}`,
          `Frame decoding: ${d.animation.decoderAvailable ? `yes (${d.animation.supportedTypes.join(', ') || 'none probed'})` : `no — ${d.animation.reason || 'unavailable'}`}`,
          `Clipboard images: ${d.clipboard.supported ? 'yes' : `no — ${d.clipboard.reasons[0] || 'unavailable'}`}`,
          describeDownloadCapability(gm, d.downloadMode),
          `Settings storage: ${d.storage === 'gm' ? 'userscript manager' : 'memory only'}`,
          `Presets: ${(getSettings().presets || []).length} stored${activePresetLabel() ? `, active: ${activePresetLabel()}` : ''}`,
          `Grants: ${Object.keys(d.capabilities).filter((k) => d.capabilities[k]).join(', ') || 'none'}`,
        ];
        if (store.info().warnings && store.info().warnings.length) lines.push(...store.info().warnings);
        toaster.success('siat-report', 'Capability report', capabilityReport(), lines, [{ label: 'Open settings', variant: 'ghost', onClick: () => panel.open() }], 20000);
      });
  });
  gm.registerMenuCommand('Save Image as Type — Pause on this page', () => {
    state.paused = !state.paused;
    if (state.paused) menu.detach();
    else applySettingsSideEffects(getSettings());
    toaster.progress('siat-pause', state.paused ? 'Paused on this page' : 'Resumed on this page', state.paused ? 'Right-click is untouched here until you resume from the manager menu.' : 'Right-click an image to save it again.', null, null);
    setTimeout(() => toaster.dismiss('siat-pause'), 5000);
  });

  /* ---------------- start ---------------- */

  const instance = {
    version: SCRIPT_VERSION_REPORTED,
    gm,
    store,
    menu,
    panel,
    toaster,
    picker,
    jobbar,
    transformDialog,
    compareDialog,
    inspector,
    shortcutHelp,
    batchDialog,
    diagnostics,
    capabilityReport,
    ensureSettings,
    ensureCapabilities,
    runConversion,
    produceOutput,
    copyImage,
    startBatch,
    planBatch,
    cancelBatch,
    cancelJob,
    scanPage,
    resolveSettings,
    resolveTarget: (element) => resolveImageTarget(element, { enableBackgroundImages: getSettings().enableBackgroundImages }),
    get paused() {
      return state.paused;
    },
    get batch() {
      return state.batch ? { stats: state.batch.queue.stats(), items: state.batch.queue.items(), state: state.batch.queue.state } : null;
    },
    get jobState() {
      return state.batch ? state.batch.queue.state : state.job ? JOB_STATES.RUNNING : JOB_STATES.IDLE;
    },
    destroy() {
      state.disposed = true;
      cancelBatch();
      cancelJob();
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* noop */
        }
      }
      disposers.length = 0;
      menu.destroy();
      panel.destroy();
      picker.destroy();
      jobbar.destroy();
      transformDialog.destroy();
      compareDialog.destroy();
      inspector.destroy();
      shortcutHelp.destroy();
      batchDialog.destroy();
      toaster.destroy();
      store.dispose();
      revokeAllPending();
      for (const markerRoot of markerRoots()) delete markerRoot[INIT_FLAG];
    },
  };

  // The only thing that must exist before a user can right-click is the
  // listener, so attach it now with defaults and reconcile once settings load.
  menu.attach();
  attachShortcuts();

  store.subscribe((settings, reason) => {
    if (reason === 'remote' || reason === 'save') applySettingsSideEffects(settings);
  });

  ensureSettings().then((settings) => {
    if (state.disposed) return;
    applySettingsSideEffects(settings);
    if (store.info().recovered && store.info().warnings.length) {
      toaster.progress('siat-settings', 'Settings were repaired', store.info().warnings.join(' '), store.info().warnings, [{ label: 'Open settings', variant: 'ghost', onClick: () => panel.open() }], 12000);
    } else if (store.info().migratedFrom !== null && store.info().migratedFrom !== undefined) {
      toaster.progress(
        'siat-settings',
        `Settings updated to version ${settings.schemaVersion}`,
        `Migrated from schema v${store.info().migratedFrom}; nothing was reset.`,
        store.info().warnings,
        [{ label: 'Open settings', variant: 'ghost', onClick: () => panel.open() }],
        10000,
      );
    }
  });

  const idle = win.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => {
    if (!state.disposed) ensureCapabilities();
  });

  const onPageHide = () => {
    cancelBatch();
    cancelJob();
    revokeAllPending();
  };
  win.addEventListener('pagehide', onPageHide, { once: true });
  disposers.push(() => win.removeEventListener('pagehide', onPageHide));

  // Copy the API onto the object that was published before boot, keeping
  // getters live (`paused` changes over time), then mark every root that exists
  // now — <html> and <body> were typically missing at document-start.
  for (const key of Reflect.ownKeys(instance)) {
    Object.defineProperty(api, key, Object.getOwnPropertyDescriptor(instance, key));
  }
  api.ready = true;
  for (const root of markerRoots()) root[INIT_FLAG] = api; // same-world handle for tests and support
  return api;
}

/**
 * Replaced with the real version by build.mjs from src/meta.js, so the version
 * shown in diagnostics can never drift from the metadata block. A test asserts
 * that no placeholder survives into the built artifact.
 */
const SCRIPT_VERSION_REPORTED = '2.0.0';

/* Self-start unless a test harness imports this module for its exports only. */
const isTestHarness =
  (typeof globalThis !== 'undefined' && globalThis.__SIAT_NO_AUTOBOOT) ||
  (typeof document !== 'undefined' && document.documentElement && document.documentElement.hasAttribute('data-siat-no-autoboot'));

if (!isTestHarness) {
  try {
    bootstrap();
  } catch (err) {
    // Never break the host page: report and stop.
    try {
      // eslint-disable-next-line no-console
      console.error('[Save Image as Type] failed to start:', err && err.message ? err.message : err);
    } catch {
      /* noop */
    }
  }
}

})();
