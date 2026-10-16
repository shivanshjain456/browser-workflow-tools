import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESET_LIMITS,
  PRESET_DESTINATIONS,
  normalizePreset,
  validatePresets,
  sanitizeHostPattern,
  hostMatches,
  presetForHost,
  effectiveSettings,
  presetSummary,
  serializePresets,
} from '../../src/core/presets.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

/**
 * Feature: presets with per-host auto-apply.
 *
 * Presets arrive from storage or from an imported JSON file — both untrusted.
 * The properties that matter: nothing out of range survives normalisation, host
 * rules cannot be aimed at a path or a signed URL, auto-apply precedence is
 * deterministic (importing the same file twice changes nothing), and applying a
 * preset never mutates the stored settings.
 */

const base = () => Object.assign({}, DEFAULT_SETTINGS);

describe('presets — normalisation of untrusted input', () => {
  test('a complete preset round-trips with every field in range', () => {
    const { preset, warnings } = normalizePreset({
      id: 'archive-png',
      name: 'Archive PNG',
      formatId: 'png',
      jpegQuality: 0.9,
      webpQuality: 0.8,
      filenameTemplate: '{host}-{base}-{w}x{h}',
      subfolder: 'archive/2026',
      destination: 'zip',
      stripMetadata: true,
      transform: { resize: { mode: 'max', width: 1920 }, rotate: 90, flipH: true },
      hosts: ['example.com', '*.cdn.example.com'],
    });
    assert.deepEqual(warnings, []);
    assert.equal(preset.id, 'archive-png');
    assert.equal(preset.name, 'Archive PNG');
    assert.equal(preset.formatId, 'png');
    assert.equal(preset.jpegQuality, 0.9);
    assert.equal(preset.webpQuality, 0.8);
    assert.equal(preset.filenameTemplate, '{host}-{base}-{w}x{h}');
    assert.equal(preset.subfolder, 'archive/2026', 'nested sub-folders are kept (up to three segments)');
    assert.equal(preset.destination, 'zip');
    assert.equal(preset.stripMetadata, true);
    assert.equal(preset.transform.resize.mode, 'max');
    assert.equal(preset.transform.rotate, 90);
    assert.deepEqual(preset.hosts, ['example.com', '*.cdn.example.com']);
  });

  test('missing or junk values fall back to safe defaults', () => {
    const { preset } = normalizePreset({});
    assert.equal(preset.name, 'Preset 1', 'an unnamed preset gets a numbered name');
    assert.equal(preset.formatId, '', 'no format means "keep the user\'s choice"');
    assert.equal(preset.destination, 'file');
    assert.equal(preset.stripMetadata, false);
    assert.equal(preset.transform.resize.mode, 'none');
    assert.deepEqual(preset.hosts, []);
    assert.ok(preset.id.length > 0, 'an id is derived so the preset can be selected');

    for (const value of [null, undefined, 7, 'preset', []]) {
      const result = normalizePreset(value, { index: 3 });
      assert.equal(result.preset.name, 'Preset 4', `${JSON.stringify(value)} normalises`);
      assert.equal(result.preset.destination, 'file');
    }
  });

  test('out-of-range numbers are clamped, not accepted', () => {
    const { preset } = normalizePreset({ name: 'Q', jpegQuality: 42, webpQuality: -3 });
    assert.equal(preset.jpegQuality, 1, 'quality is clamped to 1');
    assert.equal(preset.webpQuality, 0, 'a negative quality means "use the global setting"');
    const text = normalizePreset({ name: 'Q', jpegQuality: 'high', webpQuality: 'high' }).preset;
    assert.equal(text.jpegQuality, 0, 'a non-numeric quality means "leave it alone"');
    assert.equal(text.webpQuality, 0);
  });

  test('a format this browser does not have is dropped with a warning', () => {
    const { preset, warnings } = normalizePreset({ name: 'AVIF only', formatId: 'heic' });
    assert.equal(preset.formatId, '');
    assert.ok(warnings.some((w) => /not available here and was dropped/.test(w)), warnings.join(' | '));

    const limited = normalizePreset({ name: 'AVIF', formatId: 'avif' }, { allowedFormats: ['png', 'jpg'] });
    assert.equal(limited.preset.formatId, '', 'the allowed-format list is honoured');
    assert.equal(limited.warnings.length, 1);
  });

  test('REGRESSION: an unset quality stays unset through export and re-import', () => {
    // Clamping a stored 0 up to the 0.5 floor used to give every preset its own
    // JPEG quality on the next load, overriding the user's global setting.
    const first = validatePresets([{ id: 'a', name: 'A', formatId: 'jpg' }]).presets;
    assert.equal(first[0].jpegQuality, 0);
    const second = validatePresets(serializePresets(first)).presets;
    assert.equal(second[0].jpegQuality, 0, 'still unset after a round-trip');
    assert.equal(second[0].webpQuality, 0);
    const third = validatePresets(serializePresets(second)).presets;
    assert.equal(third[0].jpegQuality, 0, 'and after another one');
    const explicit = validatePresets([{ id: 'b', name: 'B', jpegQuality: 0.62 }]).presets;
    assert.equal(explicit[0].jpegQuality, 0.62, 'a real value survives unchanged');
    assert.equal(validatePresets(serializePresets(explicit)).presets[0].jpegQuality, 0.62);
  });

  test('an invalid filename template is dropped rather than stored', () => {
    const bad = normalizePreset({ name: 'T', filenameTemplate: '{base}-{nope}' });
    assert.equal(bad.preset.filenameTemplate, '');
    assert.ok(bad.warnings.some((w) => /template was invalid/.test(w)), bad.warnings.join(' | '));

    const empty = normalizePreset({ name: 'T', filenameTemplate: '   ' });
    assert.equal(empty.preset.filenameTemplate, '');
    assert.deepEqual(empty.warnings, [], 'an empty template is simply "not set"');

    const good = normalizePreset({ name: 'T', filenameTemplate: '  {host}-{base}  ' });
    assert.equal(good.preset.filenameTemplate, '{host}-{base}', 'a valid template is trimmed');
  });

  test('names, ids and host lists are capped and de-duplicated', () => {
    const long = normalizePreset({ name: 'n'.repeat(200), hosts: ['a.example.com', 'a.example.com', 'b.example.com'] });
    assert.equal(long.preset.name.length, PRESET_LIMITS.nameChars);
    assert.deepEqual(long.preset.hosts, ['a.example.com', 'b.example.com'], 'duplicate host rules are merged');

    const many = Array.from({ length: PRESET_LIMITS.maxHosts + 5 }, (_, i) => `h${i}.example.com`);
    const capped = normalizePreset({ name: 'H', hosts: many });
    assert.equal(capped.preset.hosts.length, PRESET_LIMITS.maxHosts);
    assert.ok(capped.warnings.some((w) => /only the first/.test(w)), 'the user is told rules were dropped');

    const weirdId = normalizePreset({ id: '../../etc/passwd', name: 'X' });
    assert.equal(/[/\\]/.test(weirdId.preset.id), false, 'an id cannot carry a path separator');
    assert.ok(weirdId.preset.id.length > 0);
  });

  test('validatePresets caps the list and resolves duplicate ids and names deterministically', () => {
    const many = Array.from({ length: PRESET_LIMITS.max + 4 }, (_, i) => ({ name: `P${i}`, id: 'same-id' }));
    const { presets, warnings } = validatePresets(many);
    assert.equal(presets.length, PRESET_LIMITS.max, 'the list is capped');
    assert.ok(warnings.some((w) => /Only the first/.test(w)));
    assert.equal(new Set(presets.map((p) => p.id)).size, presets.length, 'every id is unique after validation');
    assert.equal(new Set(presets.map((p) => p.name.toLowerCase())).size, presets.length, 'every name is unique after validation');

    // The same input validates to the same output, twice: importing a file
    // repeatedly cannot reshuffle which preset wins on a host.
    const again = validatePresets(many);
    assert.deepEqual(serializePresets(again.presets), serializePresets(presets));

    assert.deepEqual(validatePresets(null).presets, [], 'a non-list yields no presets');
    assert.deepEqual(validatePresets('nope').presets, []);
  });
});

describe('presets — host rules', () => {
  test('a rule is a host only: schemes, ports, paths and queries are stripped', () => {
    assert.equal(sanitizeHostPattern('https://Example.COM:8443/gallery/img?token=abc#top'), 'example.com');
    assert.equal(sanitizeHostPattern('//cdn.example.com/a/b'), 'cdn.example.com');
    assert.equal(sanitizeHostPattern('  *.Example.com  '), '*.example.com');
    assert.equal(sanitizeHostPattern('sub.domain.example.co.uk'), 'sub.domain.example.co.uk');
  });

  test('rules that would match too much, or nothing, are refused', () => {
    for (const value of ['', '   ', null, undefined, '*', '*.', '.com', '*.com', 'com', 'localhost', 'a', 'https://', 'exa mple.com', 'exämple.com', '../../etc']) {
      assert.equal(sanitizeHostPattern(value), '', `${JSON.stringify(value)} is refused`);
    }
    // A rule must have at least two labels, so it cannot auto-apply to a TLD.
    assert.equal(sanitizeHostPattern('*.example'), '');
    assert.equal(sanitizeHostPattern('example.co'), 'example.co');
  });

  test('a long rule is truncated rather than stored whole', () => {
    const long = sanitizeHostPattern(`${'a'.repeat(200)}.example.com`);
    assert.ok(long.length <= PRESET_LIMITS.hostChars, `length ${long.length}`);
  });

  test('matching covers the apex and subdomains, and never a substring of a label', () => {
    assert.equal(hostMatches('example.com', 'example.com'), true);
    assert.equal(hostMatches('example.com', 'www.example.com'), false, 'an exact rule does not match subdomains');
    assert.equal(hostMatches('*.example.com', 'example.com'), true, 'a wildcard rule covers the apex');
    assert.equal(hostMatches('*.example.com', 'cdn.example.com'), true);
    assert.equal(hostMatches('*.example.com', 'a.b.cdn.example.com'), true, 'deep subdomains match');
    assert.equal(hostMatches('*.example.com', 'notexample.com'), false, 'no substring matching');
    assert.equal(hostMatches('*.example.com', 'example.com.evil.net'), false, 'a lookalike host does not match');
    assert.equal(hostMatches('cdn.example.com', 'CDN.Example.COM'), true, 'matching is case-insensitive');
    assert.equal(hostMatches('example.com', 'example.com:8443'), true, 'a port on the target is ignored');
    assert.equal(hostMatches('', 'example.com'), false);
    assert.equal(hostMatches('example.com', ''), false);
    assert.equal(hostMatches(null, null), false);
  });

  test('auto-apply picks the most specific rule, ties broken by declaration order', () => {
    const broad = { id: 'broad', name: 'Broad', hosts: ['*.example.com'] };
    const exact = { id: 'exact', name: 'Exact', hosts: ['cdn.example.com'] };
    const deeper = { id: 'deeper', name: 'Deeper', hosts: ['img.cdn.example.net'] };
    const list = [broad, exact, deeper];

    assert.equal(presetForHost(list, 'cdn.example.com'), exact, 'an exact rule beats a wildcard');
    assert.equal(presetForHost(list, 'cdn.example.com'), presetForHost([exact, broad], 'cdn.example.com'), 'order does not change the winner');
    assert.equal(presetForHost(list, 'other.example.com'), broad);
    assert.equal(presetForHost(list, 'img.cdn.example.net'), deeper, 'more labels win');
    assert.equal(presetForHost(list, 'unrelated.test'), null);
    assert.equal(presetForHost(list, ''), null, 'no host means no auto-apply');
    assert.equal(presetForHost(null, 'example.com'), null);
    assert.equal(presetForHost([{ id: 'x', name: 'X' }, null, { id: 'y', name: 'Y', hosts: 'example.com' }], 'example.com'), null, 'a preset without a host list never auto-applies');

    // Two rules of equal specificity: the first declared wins, always.
    const tie = [{ id: 'first', name: 'First', hosts: ['a.example.com'] }, { id: 'second', name: 'Second', hosts: ['a.example.com'] }];
    assert.equal(presetForHost(tie, 'a.example.com').id, 'first');
  });
});

describe('presets — applying one to the settings in force', () => {
  test('the documented acceptance case: a preset changes the format and the file name', () => {
    const preset = { id: 'p1', name: 'Archive', formatId: 'webp', filenameTemplate: '{host}-{base}-{w}x{h}', subfolder: 'archive', destination: 'zip' };
    const settings = base();
    const effective = effectiveSettings(settings, preset);
    assert.equal(effective.presetFormatId, 'webp');
    assert.equal(effective.filenameTemplate, '{host}-{base}-{w}x{h}');
    assert.equal(effective.subfolder, 'archive');
    assert.equal(effective.presetDestination, 'zip');
    assert.equal(effective.activePresetId, 'p1');
    assert.equal(effective.activePresetName, 'Archive');
  });

  test('the stored settings are never mutated, so turning a preset off restores them', () => {
    const settings = base();
    const before = JSON.stringify(settings);
    const preset = { id: 'p1', name: 'A', formatId: 'jpg', jpegQuality: 0.7, subfolder: 'x', filenameTemplate: '{base}', stripMetadata: true, transform: { resize: { mode: 'percent', width: 50 } } };
    const effective = effectiveSettings(settings, preset);
    assert.equal(JSON.stringify(settings), before, 'the stored object is untouched');
    assert.notEqual(effective, settings, 'a new object is returned');

    assert.equal(effective.jpegQuality, 0.7);
    assert.equal(effective.stripMetadataOnOriginal, true);
    assert.equal(effective.presetTransform.resize.mode, 'percent');

    const off = effectiveSettings(settings, null);
    assert.equal(off.presetFormatId, undefined, 'with no preset there is no preset format');
    assert.equal(off.jpegQuality, settings.jpegQuality, 'the user quality is back');
    assert.equal(off.stripMetadataOnOriginal, settings.stripMetadataOnOriginal);
    assert.equal(off.activePresetName, undefined);
  });

  test('a preset that sets nothing changes nothing but still records itself', () => {
    const settings = base();
    const effective = effectiveSettings(settings, { id: 'p9', name: 'Empty' });
    assert.equal(effective.activePresetId, 'p9');
    assert.equal(effective.activePresetName, 'Empty');
    assert.equal(effective.filenameTemplate, settings.filenameTemplate);
    assert.equal(effective.subfolder, settings.subfolder);
    assert.equal(effective.presetDestination, undefined, 'a preset with no destination does not invent one');
  });

  test('an explicit empty sub-folder in a preset clears the user sub-folder', () => {
    const settings = Object.assign(base(), { subfolder: 'downloads' });
    const effective = effectiveSettings(settings, { id: 'p', name: 'P', subfolder: '' });
    assert.equal(effective.subfolder, '', 'a preset can mean "no sub-folder"');
  });

  test('effectiveSettings survives junk input', () => {
    assert.equal(typeof effectiveSettings(null, null), 'object');
    assert.equal(effectiveSettings(undefined, undefined).activePresetId, undefined);
    assert.equal(effectiveSettings(base(), 'not-a-preset').activePresetId, '');
  });

  test('the one-line summary says what the preset does', () => {
    assert.equal(presetSummary(null), '');
    assert.equal(presetSummary({ id: 'p', name: 'P' }), '', 'an empty preset has nothing to summarise');
    const full = presetSummary({
      id: 'p',
      name: 'P',
      formatId: 'webp',
      destination: 'zip',
      transform: { resize: { mode: 'max', width: 1920 } },
      filenameTemplate: '{base}',
      subfolder: 'archive',
      hosts: ['a.example.com', 'b.example.com', 'c.example.com'],
    });
    assert.match(full, /WEBP/);
    assert.match(full, /ZIP/);
    assert.match(full, /transform/);
    assert.match(full, /template/);
    assert.match(full, /→ archive/);
    assert.match(full, /auto on a\.example\.com, b\.example\.com \+1/);
    assert.equal(presetSummary({ id: 'p', name: 'P', transform: { resize: { mode: 'none' }, crop: null, rotate: 0 } }).includes('transform'), false, 'an inert transform is not advertised');
  });

  test('serialise → validate → serialise is stable (settings export round-trips)', () => {
    const original = [
      { id: 'a', name: 'A', formatId: 'png', filenameTemplate: '{base}-{w}x{h}', subfolder: 'a', destination: 'file', hosts: ['example.com'] },
      { id: 'b', name: 'B', formatId: 'jpg', jpegQuality: 0.8, destination: 'zip', hosts: ['*.cdn.example.com'], transform: { resize: { mode: 'percent', width: 50 } } },
    ];
    const once = serializePresets(validatePresets(original).presets);
    const twice = serializePresets(validatePresets(once).presets);
    assert.deepEqual(twice, once, 'exporting and re-importing changes nothing');
    assert.equal(once.length, 2);
    assert.deepEqual(once[0].hosts, ['example.com']);
    assert.equal(once[1].jpegQuality, 0.8);
    assert.deepEqual(serializePresets(null), []);
    assert.deepEqual(PRESET_DESTINATIONS, ['file', 'zip']);
  });
});
