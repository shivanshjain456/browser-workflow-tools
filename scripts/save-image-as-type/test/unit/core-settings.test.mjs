import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEYS,
  normalizeSettings,
  migrateSettings,
  validateImportedSettings,
  createSettingsStore,
} from '../../src/core/settings.js';
import { createGmAdapter } from '../../src/core/gm.js';
import { FORMAT_IDS } from '../../src/core/formats.js';

/** Minimal in-memory userscript manager for storage tests. */
function fakeManager({ initial = {}, async = false, readOnly = false } = {}) {
  const store = new Map(Object.entries(initial));
  const calls = [];
  const wrap = (value) => (async ? Promise.resolve(value) : value);
  return {
    store,
    calls,
    GM_info: { scriptHandler: 'FakeMonkey', version: '9.9', downloadMode: 'native', script: { version: '1.0.0' } },
    GM_getValue: (key, fallback) => {
      calls.push(['get', key]);
      return wrap(store.has(key) ? store.get(key) : fallback);
    },
    GM_setValue: (key, value) => {
      calls.push(['set', key]);
      if (readOnly) throw new Error('storage is read-only');
      store.set(key, value);
      return wrap(true);
    },
    GM_deleteValue: (key) => {
      store.delete(key);
      return wrap(true);
    },
  };
}

describe('normalizeSettings — validation and clamping', () => {
  test('returns complete defaults for missing or corrupt storage', () => {
    const corrupt = ['garbage', 42, [], { settings: true }, [1, 2, 3]];
    for (const input of corrupt) {
      const { settings, recovered, warnings } = normalizeSettings(input);
      assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULT_SETTINGS).sort(), `complete shape for ${JSON.stringify(input)}`);
      assert.equal(settings.schemaVersion, SETTINGS_SCHEMA_VERSION);
      assert.equal(recovered, true, `recovery flagged for ${JSON.stringify(input)}`);
      assert.ok(warnings.length >= 1, `the user is told: ${JSON.stringify(input)}`);
    }
    // `null`/`undefined` still count as a substitution at *function* level (the
    // caller decides whether that is a first run or a loss) ...
    for (const input of [null, undefined]) {
      const { settings, recovered } = normalizeSettings(input);
      assert.deepEqual(settings.formats, DEFAULT_SETTINGS.formats);
      assert.equal(recovered, true, `defaults substituted for ${JSON.stringify(input)}`);
    }
    // ... but an empty object is simply "no fields set", not damage.
    const empty = normalizeSettings({});
    assert.deepEqual(empty.settings.formats, DEFAULT_SETTINGS.formats);
    assert.equal(empty.recovered, false, 'an empty object is not a recovery');
    assert.deepEqual(empty.warnings, []);
  });

  test('numbers are clamped into range, with a note', () => {
    const { settings, warnings } = normalizeSettings({
      maxFilenameLength: 99999,
      jpegQuality: 42,
      webpQuality: -3,
      gifMaxFrames: 0,
      gifMemoryLimitMB: 1,
      downscaleAboveMegapixels: 'abc',
    });
    assert.equal(settings.maxFilenameLength, 120);
    assert.equal(settings.jpegQuality, 1);
    assert.equal(settings.webpQuality, 0.1);
    assert.equal(settings.gifMaxFrames, 2);
    assert.equal(settings.gifMemoryLimitMB, 16);
    assert.equal(settings.downscaleAboveMegapixels, DEFAULT_SETTINGS.downscaleAboveMegapixels, 'non-numeric keeps the default');
    assert.ok(warnings.length >= 5, `each clamp is reported (${warnings.length} warnings)`);
  });

  test('enums reject unknown values and keep a usable default', () => {
    assert.equal(normalizeSettings({ downloadBehavior: 'maybe' }).settings.downloadBehavior, 'instant');
    assert.equal(normalizeSettings({ pdfPageFit: 'tabloid' }).settings.pdfPageFit, 'a4');
    assert.equal(normalizeSettings({ flattenBackground: 'chartreuse' }).settings.flattenBackground, 'white');
    assert.equal(normalizeSettings({ downloadBehavior: 'ask' }).settings.downloadBehavior, 'ask');
  });

  test('booleans reject truthy non-booleans rather than coercing them', () => {
    for (const value of ['yes', 1, {}, null]) {
      const { settings, warnings } = normalizeSettings({ allowCrossOriginFetch: value });
      assert.equal(settings.allowCrossOriginFetch, DEFAULT_SETTINGS.allowCrossOriginFetch);
      assert.ok(warnings.some((w) => w.includes('allowCrossOriginFetch')), `warned for ${JSON.stringify(value)}`);
    }
    assert.equal(normalizeSettings({ allowCrossOriginFetch: false }).settings.allowCrossOriginFetch, false);
  });

  test('format list: unknown ids are dropped, an empty result restores defaults', () => {
    const { settings, warnings } = normalizeSettings({ formats: ['png', 'totally-fake', 'png', 42, 'bmp'] });
    assert.deepEqual(settings.formats, ['png', 'bmp'], 'duplicates and unknown ids removed, order kept');
    assert.ok(warnings.some((w) => w.includes('totally-fake')));

    const empty = normalizeSettings({ formats: [] });
    assert.deepEqual(empty.settings.formats, DEFAULT_SETTINGS.formats, 'an empty menu would look like a bug, so defaults are restored');
    assert.ok(empty.recovered);
  });

  test('strings are sanitised, so a settings file cannot inject a path', () => {
    const { settings } = normalizeSettings({ filenamePrefix: '../../evil/prefix', subfolder: 'a/../../b' });
    assert.ok(!settings.filenamePrefix.includes('/'), `"${settings.filenamePrefix}"`);
    assert.equal(settings.subfolder, 'a/b');
    assert.ok(settings.filenamePrefix.length <= 40);
  });

  test('unknown keys are dropped and reported, never carried through', () => {
    const { settings, warnings } = normalizeSettings({ png: true, evilScriptUrl: 'https://x.example/a.js', formats: ['png'] });
    assert.equal('evilScriptUrl' in settings, false);
    assert.ok(warnings.some((w) => w.includes('evilScriptUrl')));
  });

  test('every declared default is a valid setting (self-consistency)', () => {
    const { settings, warnings, recovered } = normalizeSettings(DEFAULT_SETTINGS);
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.deepEqual(warnings, []);
    assert.equal(recovered, false);
    for (const id of DEFAULT_SETTINGS.formats) assert.ok(FORMAT_IDS.includes(id), `default format ${id} exists`);
  });
});

describe('migrateSettings — upgrades and downgrades', () => {
  test('v1 shape maps onto the current schema', () => {
    const { value, from } = migrateSettings({
      schemaVersion: 1,
      enabledFormats: ['jpg', 'png'],
      instant: false,
      prefix: 'web',
      folder: 'saved-images',
      maxLen: 40,
      quality: 0.7,
      background: 'black',
      gifMemory: 256,
    });
    assert.equal(from, 1);
    const { settings } = normalizeSettings(value);
    assert.deepEqual(settings.formats, ['jpg', 'png']);
    assert.equal(settings.downloadBehavior, 'ask', 'instant:false means "ask where to save"');
    assert.equal(settings.filenamePrefix, 'web');
    assert.equal(settings.subfolder, 'saved-images');
    assert.equal(settings.maxFilenameLength, 40);
    assert.equal(settings.jpegQuality, 0.7);
    assert.equal(settings.flattenBackground, 'black');
    assert.equal(settings.gifMemoryLimitMB, 256);
  });

  test('an unversioned legacy object is treated as v1', () => {
    const { value, from } = migrateSettings({ formats: ['png'], prefix: 'old' });
    assert.equal(from, 0);
    assert.deepEqual(value.formats, ['png']);
    assert.equal(value.filenamePrefix, 'old');
  });

  test('a newer schema keeps only known fields and is reported', () => {
    const { value, from, downgraded } = migrateSettings({
      schemaVersion: 99,
      formats: ['png'],
      maxFilenameLength: 30,
      futureFeature: { nested: true },
    });
    assert.equal(from, 99);
    assert.equal(downgraded, true);
    assert.equal('futureFeature' in value, false, 'unknown future field dropped');
    assert.deepEqual(value.formats, ['png']);
    assert.equal(value.maxFilenameLength, 30);
  });

  test('current-schema data passes through untouched', () => {
    const { value, from } = migrateSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION, formats: ['bmp'] });
    assert.equal(from, SETTINGS_SCHEMA_VERSION);
    assert.deepEqual(value.formats, ['bmp']);
  });
});

describe('validateImportedSettings — user-supplied JSON', () => {
  test('rejects invalid JSON with a readable error', () => {
    const result = validateImportedSettings('{not json');
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /Not valid JSON/);
  });

  test('accepts a valid file and normalises it', () => {
    const result = validateImportedSettings(JSON.stringify({ formats: ['png', 'gif'], filenamePrefix: 'x', maxFilenameLength: 500 }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.settings.formats, ['png', 'gif']);
    assert.equal(result.settings.maxFilenameLength, 120, 'clamped');
    assert.ok(result.warnings.length >= 1);
  });

  test('a hostile import cannot smuggle a path, a URL or an oversized payload', () => {
    const hostile = {
      filenamePrefix: '<img src=x onerror=alert(1)>',
      subfolder: '../../../../../../tmp',
      formats: ['png", "evil'],
      maxFilenameLength: 1e9,
      gifMemoryLimitMB: -5,
    };
    const result = validateImportedSettings(JSON.stringify(hostile));
    assert.equal(result.ok, true, 'it is still a settings object, just a bad one');
    // Markup delimiters are gone, so nothing here can ever be interpreted as
    // HTML; the remaining words are inert because the prefix only ever reaches
    // a file name and textContent, never an HTML sink.
    assert.ok(!/[<>]/.test(result.settings.filenamePrefix), `markup delimiters stripped: ${result.settings.filenamePrefix}`);
    assert.equal(result.settings.subfolder, 'tmp');
    // The single hostile id sanitises to something that is not a known format,
    // so the list ends up empty — and an empty list would render an empty menu,
    // which is why normalizeSettings restores the defaults and flags a recovery.
    assert.deepEqual(result.settings.formats, DEFAULT_SETTINGS.formats);
    assert.equal(result.recovered === undefined || result.recovered === true, true);
    assert.ok(result.settings.formats.every((id) => FORMAT_IDS.includes(id)), 'only real format ids survive');
    assert.equal(result.settings.maxFilenameLength, 120);
    assert.equal(result.settings.gifMemoryLimitMB, 16);
  });

  test('non-object JSON is rejected back to defaults', () => {
    for (const text of ['[]', '"hello"', '42', 'true', 'null']) {
      const result = validateImportedSettings(text);
      assert.equal(result.ok, true, `${text} parses`);
      assert.deepEqual(result.settings.formats, DEFAULT_SETTINGS.formats, `${text} falls back to defaults`);
      assert.equal(result.settings.schemaVersion, SETTINGS_SCHEMA_VERSION);
    }
  });
});

describe('createSettingsStore — persistence behaviour', () => {
  test('loads defaults when nothing is stored, without claiming a recovery', async () => {
    const gm = createGmAdapter(fakeManager());
    const store = createSettingsStore({ gm });
    const settings = await store.load();
    assert.deepEqual(settings.formats, DEFAULT_SETTINGS.formats);
    assert.equal(store.info().storage, 'gm');
    assert.equal(store.info().recovered, false, 'a first run is not damage');
    assert.deepEqual(store.info().warnings, [], 'nothing to warn about on a fresh install');
    assert.equal(store.info().migratedFrom, null);
  });

  test('round-trips a save through manager storage', async () => {
    const manager = fakeManager();
    const gm = createGmAdapter(manager);
    const store = createSettingsStore({ gm });
    await store.load();
    const result = await store.save({ filenamePrefix: 'saved', formats: ['bmp'] });
    assert.equal(result.ok, true);
    const raw = manager.store.get(SETTINGS_STORAGE_KEYS[0]);
    assert.equal(typeof raw, 'string', 'stored as JSON text');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.filenamePrefix, 'saved');
    assert.deepEqual(parsed.formats, ['bmp']);
    assert.equal(parsed.schemaVersion, SETTINGS_SCHEMA_VERSION);
    // A fresh store reads it back identically.
    const second = createSettingsStore({ gm: createGmAdapter(fakeManager({ initial: { [SETTINGS_STORAGE_KEYS[0]]: raw } })) });
    const reloaded = await second.load();
    assert.equal(reloaded.filenamePrefix, 'saved');
  });

  test('no storage permission is reported as a limitation, not as damage', async () => {
    // Without GM_getValue/GM_setValue the store keeps settings in memory. That
    // is not a recovery: nothing stored was lost. Reporting it as one used to
    // make main.js show a "Settings were repaired" toast on every page load.
    // A manager object with no GM_getValue/GM_setValue at all: this is what
    // `@grant none`-style or a manager without the storage APIs looks like.
    const store = createSettingsStore({ gm: createGmAdapter({ GM_info: { scriptHandler: 'FakeMonkey', version: '9.9' } }) });
    const settings = await store.load();
    assert.deepEqual(settings.formats, DEFAULT_SETTINGS.formats, 'defaults are in use');
    assert.equal(store.info().recovered, false, 'not flagged as a recovery');
    assert.equal(store.info().storage, 'memory', 'storage backend is reported honestly');
    assert.ok(store.info().warnings.some((w) => /No storage permission/i.test(w)), store.info().warnings.join('|'));
  });

  test('corrupt stored JSON recovers to defaults and says so', async () => {
    const manager = fakeManager({ initial: { [SETTINGS_STORAGE_KEYS[0]]: '{broken json' } });
    const store = createSettingsStore({ gm: createGmAdapter(manager) });
    const settings = await store.load();
    assert.deepEqual(settings.formats, DEFAULT_SETTINGS.formats);
    assert.equal(store.info().recovered, true);
    assert.ok(store.info().warnings.some((w) => /corrupt/i.test(w)), store.info().warnings.join('|'));
  });

  test('migrates a legacy key and rewrites it under the current key', async () => {
    const manager = fakeManager({ initial: { 'saveImageAsType.settings': JSON.stringify({ enabledFormats: ['png'], instant: true, prefix: 'legacy' }) } });
    const store = createSettingsStore({ gm: createGmAdapter(manager) });
    const settings = await store.load();
    assert.deepEqual(settings.formats, ['png']);
    assert.equal(settings.filenamePrefix, 'legacy');
    assert.ok(store.info().warnings.some((w) => /Migrated/i.test(w)), store.info().warnings.join('|'));
    assert.ok(manager.store.has(SETTINGS_STORAGE_KEYS[0]), 'normalised settings written under the current key');
  });

  test('reset restores defaults and persists them', async () => {
    const manager = fakeManager({ initial: { [SETTINGS_STORAGE_KEYS[0]]: JSON.stringify({ filenamePrefix: 'x' }) } });
    const store = createSettingsStore({ gm: createGmAdapter(manager) });
    await store.load();
    const result = await store.reset();
    assert.equal(result.settings.filenamePrefix, '');
    assert.equal(JSON.parse(manager.store.get(SETTINGS_STORAGE_KEYS[0])).filenamePrefix, '');
  });

  test('a read-only or absent storage degrades to memory without breaking', async () => {
    const readOnly = createSettingsStore({ gm: createGmAdapter(fakeManager({ readOnly: true })) });
    const settings = await readOnly.load();
    const saved = await readOnly.save({ filenamePrefix: 'nope' });
    assert.equal(saved.ok, false, 'failure is reported, not swallowed');
    assert.equal(readOnly.get().filenamePrefix, 'nope', 'still applied for this page load');

    const noGrant = createGmAdapter({});
    const memory = createSettingsStore({ gm: noGrant });
    const memorySettings = await memory.load();
    assert.equal(memory.info().storage, 'memory');
    assert.deepEqual(memorySettings.formats, DEFAULT_SETTINGS.formats);
    assert.ok(memory.info().warnings.some((w) => /memory|storage/i.test(w)));
  });

  test('subscribers are notified and a throwing subscriber cannot break the store', async () => {
    const gm = createGmAdapter(fakeManager());
    const store = createSettingsStore({ gm });
    const seen = [];
    store.subscribe(() => {
      throw new Error('bad listener');
    });
    store.subscribe((settings, reason) => seen.push(reason));
    await store.load();
    await store.save({ filenamePrefix: 'z' });
    assert.deepEqual(seen, ['load', 'save']);
    const unsubscribe = store.subscribe(() => seen.push('extra'));
    unsubscribe();
    await store.save({ filenamePrefix: 'y' });
    assert.deepEqual(seen, ['load', 'save', 'save']);
  });

  test('remote changes from another tab are applied through the value-change listener', async () => {
    let listener = null;
    const manager = fakeManager();
    manager.GM_addValueChangeListener = (key, handler) => {
      listener = handler;
      return 1;
    };
    manager.GM_removeValueChangeListener = () => {
      listener = null;
    };
    const gm = createGmAdapter(manager);
    const store = createSettingsStore({ gm });
    const seen = [];
    store.subscribe((settings, reason) => seen.push([reason, settings.filenamePrefix]));
    await store.load();
    assert.ok(listener, 'listener registered');
    listener(SETTINGS_STORAGE_KEYS[0], '{}', JSON.stringify({ filenamePrefix: 'from-other-tab', formats: ['png'] }));
    assert.deepEqual(seen[seen.length - 1], ['remote', 'from-other-tab']);
    assert.equal(store.get().formats.length, 1);
    // Corrupt remote payload must be ignored, not applied.
    listener(SETTINGS_STORAGE_KEYS[0], '{}', '{oops');
    assert.equal(store.get().filenamePrefix, 'from-other-tab', 'unchanged after corrupt payload');
    store.dispose();
    assert.equal(listener, null, 'listener removed on dispose');
  });
});
