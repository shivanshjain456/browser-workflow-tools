import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_LIMITS,
  PROFILE_RESERVED_KEYS,
  applyProfile,
  captureProfile,
  normalizeProfile,
  profileSummary,
  profileValuesFrom,
  removeProfile,
  sanitizeProfileName,
  serializeProfiles,
  validateProfiles,
} from '../../src/core/profiles.js';
import { DEFAULT_SETTINGS, cloneDefaults, normalizeSettings, validateImportedSettings } from '../../src/core/settings.js';
import { UI_MESSAGES, catalogueKeys, createTranslator, directionFor, languageFromDocument, resolveLanguage } from '../../src/core/messages.js';

const validator = (values) => {
  const nested = Object.assign({}, values);
  for (const key of PROFILE_RESERVED_KEYS) delete nested[key];
  const result = normalizeSettings(nested);
  return { values: result.settings, warnings: result.warnings };
};

describe('configuration profiles — capture and apply', () => {
  test('a captured profile restores the whole configuration but never its own list', () => {
    const before = Object.assign(cloneDefaults(), { subfolder: 'shots', formats: ['webp'], jpegQuality: 0.5, destination: 'zip', shortcuts: { quickSave: 'Alt+Shift+W' } });
    const captured = captureProfile(before, 'Arabic web', { now: () => 1700000000000 });
    assert.equal(captured.profile.name, 'Arabic web');
    assert.equal(captured.profile.createdAt, 1700000000000);
    assert.equal(captured.profile.values.profiles, undefined, 'a profile must not contain profiles');
    assert.equal(captured.profile.values.jpegQuality, 0.5);
    assert.equal(captured.profile.values.subfolder, 'shots');

    const changed = Object.assign(cloneDefaults(), { subfolder: '', formats: ['png'], jpegQuality: 0.92 });
    const withProfiles = Object.assign(changed, { profiles: captured.profiles });
    const applied = applyProfile(withProfiles, captured.profile.values);
    assert.equal(applied.jpegQuality, 0.5);
    assert.equal(applied.subfolder, 'shots');
    assert.deepEqual(applied.formats, ['webp']);
    assert.deepEqual({ ...applied.shortcuts }, { quickSave: 'Alt+Shift+W' }, 'shortcuts come back as a hardened own-data record with the same values');
    assert.equal(applied.profiles.length, 1, 'applying must not drop the profile that was applied');
    assert.notEqual(applied, withProfiles, 'apply returns a new object; the stored settings are not mutated in place');
    assert.equal(withProfiles.subfolder, '', 'the object passed in is left alone');
  });

  test('applying does not resurrect a profile-list snapshot taken earlier', () => {
    const first = captureProfile(cloneDefaults(), 'One', { now: () => 1 });
    const second = captureProfile(Object.assign(cloneDefaults(), { profiles: first.profiles }), 'Two', { now: () => 2 });
    const applied = applyProfile(Object.assign(cloneDefaults(), { profiles: second.profiles }), first.profile.values);
    assert.deepEqual(applied.profiles.map((profile) => profile.name), ['One', 'Two'], 'the live list is kept, not the snapshot inside the older profile');
  });

  test('names are sanitised, unique, capped and never carry control or bidi characters', () => {
    assert.equal(sanitizeProfileName('  Work\u202elaptop\u0007  '), 'Worklaptop');
    assert.equal(sanitizeProfileName('\u0000\u0007', 'fallback'), 'fallback');
    assert.equal(sanitizeProfileName('x'.repeat(200)).length, PROFILE_LIMITS.nameChars);

    let settings = cloneDefaults();
    const names = [];
    for (let index = 0; index < PROFILE_LIMITS.max; index += 1) {
      const captured = captureProfile(settings, 'Same name');
      settings = Object.assign(settings, { profiles: captured.profiles });
      names.push(captured.profile.name);
    }
    assert.equal(new Set(names).size, PROFILE_LIMITS.max, 'each capture got a distinct stored name');
    const overflow = captureProfile(settings, 'One too many');
    assert.equal(overflow.profile, null);
    assert.equal(overflow.profiles.length, PROFILE_LIMITS.max);
    assert.match(overflow.warnings[0], /delete one first/i);
  });

  test('removing a profile keeps the others in order', () => {
    let settings = cloneDefaults();
    for (const name of ['A', 'B', 'C']) {
      const captured = captureProfile(settings, name);
      settings = Object.assign(settings, { profiles: captured.profiles });
    }
    const removed = removeProfile(settings, settings.profiles[1].id);
    assert.deepEqual(removed.map((profile) => profile.name), ['A', 'C']);
  });
});

describe('configuration profiles — hostile and malformed input', () => {
  test('inherited, accessor and prototype-control values never reach a profile', () => {
    const hostile = Object.create({ subfolder: 'inherited' });
    hostile.name = 'Sneaky';
    Object.defineProperty(hostile, 'values', { enumerable: true, get() { throw new Error('getter must not run'); } });
    const result = normalizeProfile(hostile, { validateValues: validator });
    assert.equal(result.profile.name, 'Sneaky');
    assert.equal(result.profile.values.subfolder, DEFAULT_SETTINGS.subfolder, 'neither the throwing accessor nor the inherited value reached the profile');
    assert.equal('inherited' === result.profile.values.subfolder, false);

    const polluted = JSON.parse('{"name":"Polluted","values":{"__proto__":{"subfolder":"pwned"},"subfolder":"ok"}}');
    const cleaned = normalizeProfile(polluted, { validateValues: validator });
    assert.equal(cleaned.profile.values.subfolder, 'ok');
    assert.equal(Object.getPrototypeOf(cleaned.profile.values.subfolder === 'ok' ? cleaned.profile.values : {}), Object.prototype);
    assert.equal(({}).subfolder, undefined, 'Object.prototype was not modified');

    const thrown = normalizeProfile({ name: 'Angry', values: { get language() { throw new Error('boom'); } } }, { validateValues: validator });
    assert.equal(thrown.profile.values.language, DEFAULT_SETTINGS.language);
  });

  test('malformed entries are dropped with a warning instead of failing the load', () => {
    const { profiles, warnings } = validateProfiles([null, 'text', { values: {} }, { name: '\u0000' }, { name: 'Good', values: { subfolder: 'kept' } }], { validateValues: validator });
    assert.deepEqual(profiles.map((profile) => profile.name), ['Good']);
    assert.equal(warnings.filter((warning) => /dropped/.test(warning)).length, 4);
    assert.equal(profiles[0].values.subfolder, 'kept', 'the valid entry still carried its value through');
  });

  test('duplicate ids and names are made unique deterministically', () => {
    const { profiles, warnings } = validateProfiles(
      [
        { id: 'same', name: 'Alpha', values: {} },
        { id: 'same', name: 'alpha', values: {} },
      ],
      { validateValues: validator },
    );
    assert.equal(new Set(profiles.map((profile) => profile.id)).size, 2);
    assert.equal(new Set(profiles.map((profile) => profile.name.toLowerCase())).size, 2);
    assert.equal(warnings.length, 2);
  });

  test('the stored list is capped even when a huge array is supplied', () => {
    const huge = Array.from({ length: 400 }, (unused, index) => ({ id: `p${index}`, name: `P${index}`, values: {} }));
    const { profiles, warnings } = validateProfiles(huge, { validateValues: validator });
    assert.equal(profiles.length, PROFILE_LIMITS.max);
    assert.match(warnings[0], /Only the first 8 profiles/);
  });

  test('profileSummary describes what a profile changes', () => {
    const text = profileSummary({ values: { formats: ['png', 'webp'], subfolder: 'shots', shortcuts: { quickSave: 'Alt+Shift+S' }, presets: [{}] } });
    assert.match(text, /PNG\/WEBP/);
    assert.match(text, /subfolder shots/);
    assert.match(text, /1 shortcut/);
    assert.match(text, /1 preset/);
    assert.equal(profileSummary({ values: {} }), 'no notable overrides recorded');
  });
});

describe('configuration profiles — storage, export and import', () => {
  test('defaults gain the profiles key without changing any existing default', () => {
    assert.deepEqual(DEFAULT_SETTINGS.profiles, []);
    const keys = Object.keys(DEFAULT_SETTINGS);
    assert.equal(keys.length, 49, '48 original settings plus the profiles list');
    assert.deepEqual(cloneDefaults().profiles, []);
  });

  test('a stored profile survives normalized reload, storage serialisation and JSON export/import', () => {
    const settings = Object.assign(cloneDefaults(), { subfolder: 'docs', jpegQuality: 0.61, profiles: [] });
    const captured = captureProfile(settings, 'Hindi docs', { now: () => 42 });
    const stored = Object.assign(settings, { profiles: serializeProfiles(captured.profiles) });
    const reloaded = normalizeSettings(JSON.parse(JSON.stringify(stored)));
    assert.equal(reloaded.settings.profiles.length, 1);
    assert.equal(reloaded.settings.profiles[0].name, 'Hindi docs');
    assert.equal(reloaded.settings.profiles[0].values.jpegQuality, 0.61, 'a valid quality survives the profile validator unchanged');
    assert.deepEqual(reloaded.settings.profiles[0].values.profiles, undefined);

    const imported = validateImportedSettings(JSON.stringify(JSON.parse(JSON.stringify(reloaded.settings))));
    assert.equal(imported.ok, true);
    assert.equal(imported.settings.profiles.length, 1);
    assert.equal(imported.settings.profiles[0].values.subfolder, 'docs');
  });

  test('a value a profile may not hold is clamped by the same rules as the live setting', () => {
    const stored = normalizeSettings(Object.assign(cloneDefaults(), {
      profiles: [{ id: 'q', name: 'Odd quality', values: { jpegQuality: 4, subfolder: 'ok' } }],
    }));
    assert.equal(stored.settings.profiles[0].values.jpegQuality, 1, 'out-of-range input is clamped into the schema range, with a warning');
    assert.equal(stored.settings.profiles[0].values.subfolder, 'ok');
    assert.ok(stored.warnings.some((warning) => /jpegQuality/.test(warning)), 'the clamp is reported, not silent');
  });

  test('a stale or hostile profiles field is reported, not silently trusted', () => {
    const notAList = normalizeSettings(Object.assign(cloneDefaults(), { profiles: 'nope' }));
    assert.deepEqual(notAList.settings.profiles, []);
    assert.ok(notAList.warnings.some((warning) => /profiles was not a list/.test(warning)));
    const nested = normalizeSettings({ profiles: [{ name: 'Loop', values: { profiles: [{ name: 'Inner' }], language: 'en' } }] });
    assert.equal(nested.settings.profiles.length, 1);
    assert.equal(nested.settings.profiles[0].values.profiles, undefined, 'nested profile lists are dropped by construction');
  });
});

describe('message catalogue for the new strings', () => {
  test('every catalogue defines exactly the same keys, with no empty string', () => {
    const keys = catalogueKeys();
    const reference = keys.en;
    for (const [language, list] of Object.entries(keys)) {
      assert.deepEqual(list, reference, `${language} must match the English key set`);
      for (const key of list) assert.ok(UI_MESSAGES[language][key].trim().length > 0, `${language}.${key} is not empty`);
    }
    assert.ok(Object.keys(keys).length >= 3);
  });

  test('translation looks up, substitutes and fails loudly on an unknown key', () => {
    const arabic = createTranslator('ar-EG');
    assert.equal(arabic.language, 'ar');
    assert.equal(arabic.direction, 'rtl');
    assert.match(arabic.t('profileLimit', { max: 8 }), /8/);
    const hindi = createTranslator('hi-IN');
    assert.equal(hindi.direction, 'ltr');
    assert.match(hindi.t('profileSaved', { name: 'ऑफ़िस' }), /ऑफ़िस/);
    assert.throws(() => createTranslator('en').t('definitelyNotAKey'), /Unknown message key/);
  });

  test('language resolution falls back to English and never throws on odd input', () => {
    assert.equal(resolveLanguage(['xx-YY', 'de', 'ar']), 'ar');
    assert.equal(resolveLanguage([undefined, null, 42]), 'en');
    assert.equal(resolveLanguage('en-GB'), 'en');
    assert.equal(directionFor('ur-PK'), 'rtl');
    assert.equal(directionFor('nonsense'), 'ltr');
    assert.equal(languageFromDocument({ documentElement: { lang: 'ar' }, defaultView: { navigator: { languages: ['en-US'] } } }), 'ar');
    assert.equal(languageFromDocument({ documentElement: {}, defaultView: { navigator: { languages: ['hi'] } } }), 'hi');
    assert.equal(languageFromDocument({}), 'en');
  });
});
