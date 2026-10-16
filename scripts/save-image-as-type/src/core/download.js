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

import { revokeLater } from './raster.js';

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
export async function saveBlob({ blob, filename, path, settings, gm, downloadMode = 'unknown' }) {
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
export function describeDownloadCapability(gm, downloadMode) {
  if (!gm || !gm.capabilities.download) return 'GM_download not granted — the script saves through the browser instead.';
  if (downloadMode === 'browser') return 'Manager uses the browser download API: Save As dialog and sub-folders both work.';
  if (downloadMode === 'native') return 'Manager uses a native <a download> click: file names work, sub-folders and forced Save As do not.';
  if (downloadMode === 'disabled') return 'Downloads are disabled in your manager settings — the script falls back to the browser.';
  return 'Manager download mode not reported; the script tries GM_download first and falls back to the browser.';
}
