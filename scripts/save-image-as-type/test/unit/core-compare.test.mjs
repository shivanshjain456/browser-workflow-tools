import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMPARE_LIMITS, comparableFormats, compareFormats, pickSmallest, comparisonRows } from '../../src/core/compare.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

/**
 * Feature: format comparison / "save the smallest good one".
 *
 * The comparison must never write to disk, must survive one encoder failing,
 * must stop when the user cancels, and must explain *why* a candidate is
 * recommended — including refusing to recommend a format that would silently
 * throw away transparency the source has.
 */

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** A converter that produces a predictable size per format. */
function fakeConverter(sizes, options = {}) {
  const calls = [];
  const convert = async (formatId) => {
    calls.push({ formatId, at: Date.now() });
    if (options.delayMs) await tick(options.delayMs);
    if (!(formatId in sizes)) {
      const error = new Error(`no encoder for ${formatId}`);
      error.code = 'encode-failed';
      throw error;
    }
    const bytes = sizes[formatId];
    if (options.throwFor && options.throwFor.includes(formatId)) {
      const error = new Error(`${formatId} encoder exploded`);
      error.code = 'encode-threw';
      throw error;
    }
    const zeroed = Boolean(options.zeroBytesFor && options.zeroBytesFor.includes(formatId));
    return {
      blob: { size: zeroed ? 0 : bytes, type: `image/${formatId}` },
      filename: `image.${formatId}`,
      report: {
        bytes: zeroed ? 0 : bytes,
        filename: `image.${formatId}`,
        sizeLabel: `${bytes} B`,
        mime: `image/${formatId}`,
        hadAlpha: Boolean(options.alphaSource),
        flattened: Boolean(options.flattenedFor && options.flattenedFor.includes(formatId)),
        width: 200,
        height: 140,
        durationMs: 12,
        notes: options.notesFor && options.notesFor[formatId] ? options.notesFor[formatId] : [],
        animation: { animated: Boolean(options.animatedFor && options.animatedFor.includes(formatId)) },
      },
    };
  };
  return { convert, calls };
}

describe('compare — which formats are candidates', () => {
  test('PDF and "original file" are left out unless asked for', () => {
    const settings = Object.assign({}, DEFAULT_SETTINGS, { formats: ['png', 'jpg', 'webp', 'gif', 'bmp', 'pdf', 'original'] });
    assert.deepEqual(comparableFormats(settings), ['png', 'jpg', 'webp', 'gif', 'bmp'], 'pdf and original are excluded');
    assert.deepEqual(comparableFormats(settings, { includePdf: true, includeOriginal: false }).includes('pdf'), true);
    assert.deepEqual(comparableFormats(settings, { includeOriginal: true }).includes('original'), true);
  });

  test('the candidate list is capped and falls back to a sensible default', () => {
    const many = ['png', 'jpg', 'webp', 'gif', 'bmp', 'avif', 'pdf'];
    const capped = comparableFormats({ formats: many }, { includePdf: true });
    assert.equal(capped.length, COMPARE_LIMITS.maxCandidates, `capped at ${COMPARE_LIMITS.maxCandidates}`);

    assert.deepEqual(comparableFormats({ formats: [] }), COMPARE_LIMITS.defaultCandidates, 'nothing enabled falls back to the defaults');
    assert.deepEqual(comparableFormats({}), COMPARE_LIMITS.defaultCandidates);
    assert.deepEqual(comparableFormats(null), COMPARE_LIMITS.defaultCandidates);
    assert.deepEqual(comparableFormats({ formats: ['nope', 'png'] }), ['png'], 'unknown ids are ignored');
    assert.deepEqual(comparableFormats({ formats: ['nope'] }), COMPARE_LIMITS.defaultCandidates, 'only unknown ids falls back too');
  });

  test('the user\'s own format order is preserved', () => {
    assert.deepEqual(comparableFormats({ formats: ['webp', 'png'] }), ['webp', 'png']);
  });
});

describe('compare — running the comparison', () => {
  test('every candidate is encoded in memory and nothing is saved', async () => {
    const { convert, calls } = fakeConverter({ png: 5000, jpg: 1800, webp: 1500 });
    const outcome = await compareFormats({ formatIds: ['png', 'jpg', 'webp'], convert });
    assert.equal(calls.length, 3, 'three encodes');
    assert.deepEqual(calls.map((call) => call.formatId), ['png', 'jpg', 'webp'], 'in the requested order');
    assert.equal(outcome.results.length, 3);
    assert.deepEqual(
      outcome.results.map((result) => [result.formatId, result.bytes]),
      [['png', 5000], ['jpg', 1800], ['webp', 1500]],
    );
    assert.equal(outcome.recommended.formatId, 'webp');
    assert.ok(outcome.elapsedMs >= 0);
    assert.deepEqual(outcome.notes, []);
  });

  test('candidates run one at a time by default, so a big image cannot spike memory', async () => {
    let active = 0;
    let peak = 0;
    const convert = async (formatId) => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(8);
      active -= 1;
      return { blob: { size: 100 }, report: { bytes: 100, filename: `${formatId}.png` } };
    };
    await compareFormats({ formatIds: ['png', 'jpg', 'webp', 'gif'], convert });
    assert.equal(peak, 1, `sequential by default (peak ${peak})`);

    peak = 0;
    await compareFormats({ formatIds: ['png', 'jpg', 'webp', 'gif'], convert, sequential: false });
    assert.ok(peak > 1, `parallel when the caller asks for it (peak ${peak})`);
  });

  test('one encoder failing is reported, and the others still count', async () => {
    const { convert } = fakeConverter({ png: 5000, jpg: 1800, webp: 1500 }, { throwFor: ['jpg'] });
    const outcome = await compareFormats({ formatIds: ['png', 'jpg', 'webp'], convert });
    assert.equal(outcome.results.length, 3, 'the failure is shown, not hidden');
    const failed = outcome.results.find((result) => result.formatId === 'jpg');
    assert.equal(failed.ok, false);
    assert.equal(failed.bytes, 0);
    assert.match(failed.error, /exploded/);
    assert.equal(failed.errorCode, 'encode-threw');
    assert.ok(outcome.notes.some((note) => /JPG|jpg/.test(note) && /exploded/.test(note)), `notes: ${outcome.notes.join(' | ')}`);
    assert.equal(outcome.recommended.formatId, 'webp', 'the recommendation ignores the failure');
  });

  test('an encoder that produces no bytes is a failure, not a 0-byte winner', async () => {
    const { convert } = fakeConverter({ png: 5000, jpg: 0 }, { zeroBytesFor: ['jpg'] });
    const outcome = await compareFormats({ formatIds: ['png', 'jpg'], convert });
    const jpg = outcome.results.find((result) => result.formatId === 'jpg');
    assert.equal(jpg.ok, false);
    assert.match(jpg.error, /produced no data/);
    assert.equal(outcome.recommended.formatId, 'png');
  });

  test('transparency in the source is detected and carried into the choice', async () => {
    const { convert } = fakeConverter({ png: 5000, jpg: 900, webp: 1400 }, { alphaSource: true, flattenedFor: ['jpg'] });
    const outcome = await compareFormats({ formatIds: ['png', 'jpg', 'webp'], convert });
    assert.equal(outcome.sourceAlpha, true);
    assert.equal(outcome.recommended.formatId, 'webp', 'the smaller alpha-capable format wins over a bigger PNG');
    assert.match(outcome.recommended.reason, /transparency/);
  });

  test('cancellation stops the run and reports what did finish', async () => {
    const controller = new AbortController();
    const { convert, calls } = fakeConverter({ png: 5000, jpg: 1800, webp: 1500, gif: 2000 }, { delayMs: 5 });
    const promise = compareFormats({ formatIds: ['png', 'jpg', 'webp', 'gif'], convert, signal: controller.signal });
    await tick(8);
    controller.abort();
    const outcome = await promise;
    assert.ok(calls.length < 4, `encoding stopped early (${calls.length} of 4 started)`);
    assert.ok(outcome.notes.some((note) => /cancelled/i.test(note)), 'the user is told it was cancelled');
    assert.ok(outcome.results.every((result) => !result.cancelled), 'cancelled candidates are not shown as rows');
  });

  test('an already-aborted signal encodes nothing at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const { convert, calls } = fakeConverter({ png: 5000 });
    const outcome = await compareFormats({ formatIds: ['png'], convert, signal: controller.signal });
    assert.equal(calls.length, 0, 'no encoder was called');
    assert.deepEqual(outcome.results, []);
    assert.equal(outcome.recommended, null);
  });

  test('progress is reported per candidate, so the dialog can show what is happening', async () => {
    const stages = [];
    const { convert } = fakeConverter({ png: 5000, jpg: 1800 });
    await compareFormats({ formatIds: ['png', 'jpg'], convert, onProgress: (stage, detail) => stages.push([stage, detail && detail.formatId]) });
    assert.equal(stages.length, 2);
    assert.deepEqual(stages[0][1], 'png');
    assert.match(stages[0][0], /encoding/i);
  });

  test('junk arguments are refused honestly instead of throwing', async () => {
    const noIds = await compareFormats({ formatIds: [], convert: async () => ({}) });
    assert.deepEqual(noIds.results, []);
    assert.ok(noIds.notes.some((note) => /No comparable formats/.test(note)));

    const noConvert = await compareFormats({ formatIds: ['png'] });
    assert.ok(noConvert.notes.some((note) => /needs a converter/.test(note)), 'a missing converter is reported, not crashed');

    const junk = await compareFormats({ formatIds: 'png', convert: async () => ({ blob: { size: 5 }, report: { bytes: 5 } }) });
    assert.deepEqual(junk.results, [], 'a non-list of ids encodes nothing');

    const unknown = await compareFormats({ formatIds: ['png', 'tiff'], convert: async () => ({ blob: { size: 5 }, report: { bytes: 5, filename: 'x.png' } }) });
    assert.equal(unknown.results.length, 1, 'an unknown format id is dropped');
  });

  test('a converter that returns a bare blob still yields a size', async () => {
    const outcome = await compareFormats({ formatIds: ['png'], convert: async () => ({ blob: { size: 4242, type: 'image/png' } }) });
    assert.equal(outcome.results[0].bytes, 4242, 'the blob size is used when the report has none');
    assert.equal(outcome.results[0].ok, true);
  });
});

describe('compare — choosing the smallest good candidate', () => {
  const row = (formatId, bytes, extra = {}) =>
    Object.assign({ formatId, label: formatId.toUpperCase(), ext: formatId, ok: true, bytes, lossless: false, keepsAlpha: false, flattened: false, ms: 5 }, extra);

  test('the smallest candidate wins and the saving is measured against the largest', () => {
    const picked = pickSmallest([row('png', 5000, { lossless: true, keepsAlpha: true }), row('jpg', 1000), row('webp', 800)]);
    assert.equal(picked.formatId, 'webp');
    assert.equal(picked.bytes, 800);
    assert.equal(picked.savingsPercent, 84, 'against the 5000-byte PNG');
    assert.match(picked.reason, /84% smaller than PNG/);
  });

  test('a lossless format within the tolerance is preferred over a marginal win', () => {
    const picked = pickSmallest([row('png', 1000, { lossless: true }), row('jpg', 990)], { tolerance: 0.02 });
    assert.equal(picked.formatId, 'png', '1% larger but lossless');
    assert.match(picked.reason, /lossless/);
    const clear = pickSmallest([row('png', 1000, { lossless: true }), row('jpg', 500)]);
    assert.equal(clear.formatId, 'jpg', 'a 50% saving is not given up for losslessness');
  });

  test('a source with transparency is never recommended into a flattening format', () => {
    const results = [row('png', 5000, { lossless: true, keepsAlpha: true }), row('jpg', 900, { flattened: true }), row('webp', 4800, { keepsAlpha: true })];
    const picked = pickSmallest(results, { sourceAlpha: true });
    assert.equal(picked.formatId, 'webp', 'the smaller alpha-capable candidate');
    assert.match(picked.reason, /transparency is preserved/);
    assert.match(picked.reason, /JPG cannot store transparency/);

    const explicit = pickSmallest([row('png', 5000, { keepsAlpha: true }), row('jpg', 900)], { requireAlpha: true });
    assert.equal(explicit.formatId, 'png', 'requireAlpha works without a detected source alpha');
  });

  test('when every candidate would flatten, the user is told rather than misled', () => {
    const picked = pickSmallest([row('jpg', 900, { flattened: true }), row('pdf', 1200, { flattened: true })], { sourceAlpha: true });
    assert.equal(picked.formatId, 'jpg', 'a recommendation is still made');
    assert.match(picked.reason, /every candidate flattens transparency/);
  });

  test('failed and empty results are ignored, and no candidates means no recommendation', () => {
    assert.equal(pickSmallest([]), null);
    assert.equal(pickSmallest(null), null);
    assert.equal(pickSmallest([row('jpg', 0, { ok: false }), null, row('png', 0)]), null, 'a 0-byte result is not a candidate');
    const one = pickSmallest([row('jpg', 0, { ok: false }), row('png', 3000, { lossless: true })]);
    assert.equal(one.formatId, 'png');
    assert.equal(one.savingsPercent, 0, 'with one candidate there is no saving to claim');
    assert.match(one.reason, /smallest result/);
  });
});

describe('compare — the table the dialog renders', () => {
  test('rows carry size, relative size, transparency, animation and the recommendation', async () => {
    const { convert } = fakeConverter({ png: 5000, jpg: 1800, webp: 1500 }, { alphaSource: true, flattenedFor: ['jpg'], animatedFor: ['webp'], notesFor: { png: ['Lossless.'] } });
    const outcome = await compareFormats({ formatIds: ['png', 'jpg', 'webp'], convert });
    const rows = comparisonRows(outcome.results, outcome.recommended);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.formatId), ['png', 'jpg', 'webp'], 'the display order follows the input order');

    const png = rows[0];
    assert.equal(png.relative, 333, 'relative to the smallest candidate');
    assert.equal(png.alpha, 'kept');
    assert.equal(png.note, 'Lossless.');
    assert.equal(png.dimensions, '200×140');
    assert.equal(png.recommended, false);

    const jpg = rows[1];
    assert.equal(jpg.alpha, 'flattened');
    assert.equal(jpg.relative, 120);

    const webp = rows[2];
    assert.equal(webp.recommended, true, 'exactly one row is flagged');
    assert.equal(webp.animated, 'yes');
    assert.equal(rows.filter((r) => r.recommended).length, 1);
  });

  test('a failed candidate shows a dash and its error, and is never "smallest"', async () => {
    const { convert } = fakeConverter({ png: 5000, jpg: 1800 }, { throwFor: ['jpg'] });
    const outcome = await compareFormats({ formatIds: ['png', 'jpg'], convert });
    const rows = comparisonRows(outcome.results, outcome.recommended);
    const failed = rows.find((row) => row.formatId === 'jpg');
    assert.equal(failed.ok, false);
    assert.equal(failed.sizeLabel, '—');
    assert.equal(failed.bytes, 0);
    assert.equal(failed.relative, 0);
    assert.equal(failed.alpha, '—');
    assert.match(failed.note, /exploded/);
    assert.equal(rows.find((row) => row.formatId === 'png').relative, 100, 'the surviving candidate is the baseline');
  });

  test('rows survive junk input', () => {
    assert.deepEqual(comparisonRows(null, null), []);
    assert.deepEqual(comparisonRows([], { formatId: 'png' }), []);
    const rows = comparisonRows([{ formatId: 'png', label: 'PNG', ok: true, bytes: 10, notes: [] }], null);
    assert.equal(rows[0].recommended, false);
    assert.equal(rows[0].relative, 100);
  });
});
