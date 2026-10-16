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

import { getFormat } from './formats.js';

export const COMPARE_LIMITS = Object.freeze({
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
export function comparableFormats(settings, { includePdf = false, includeOriginal = false } = {}) {
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
export async function compareFormats({ formatIds, convert, signal, onProgress = () => {}, sequential = true }) {
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
export function pickSmallest(results, { sourceAlpha = false, requireAlpha = false, tolerance = 0.02 } = {}) {
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
export function comparisonRows(results, recommended) {
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
