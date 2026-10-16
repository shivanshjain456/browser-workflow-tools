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

import { ScriptError } from './errors.js';

export const CLIPBOARD_TIMEOUT_MS = 10000;

/** What this browser can do, and why not if it cannot. */
export function clipboardCapability(win) {
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
export async function mimeSupported(mime, win) {
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
export async function copyImageToClipboard({ blob, mime = 'image/png', win, doc, toPng }) {
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
