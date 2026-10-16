import { cleanConfigData, configString, configNumber } from './config-data.js';
/**
 * Named configuration profiles (G-67).
 *
 * What a profile is here, decided after reading both competitors rather than by
 * copying a noun:
 *   - a profile is a **named snapshot of the whole validated settings object**,
 *     captured from the current configuration and applied back in one step;
 *   - a conversion **preset** (src/core/presets.js) keeps its narrower job as a
 *     per-conversion overlay: it never carries language, shortcuts, batch or
 *     site behaviour, so the two features do not compete;
 *   - "Export JSON" already moved a whole configuration between browsers. That
 *     stays the interchange format; profiles are the same values kept *inside*
 *     the plugin, so switching does not require a file.
 *
 * Bounded and hostile-input-safe by construction: names are sanitised, the list
 * is capped, ids are unique, and the values inside a profile go back through the
 * settings validator — a profile is an import that never touches the disk. The
 * reserved key below can never appear inside a profile's values, which makes the
 * "profile that contains profiles" recursion impossible rather than merely
 * unlikely.
 */

export const PROFILE_LIMITS = Object.freeze({
  max: 8,
  nameChars: 40,
  idChars: 64,
});

/** Never copied into or out of a profile snapshot. */
export const PROFILE_RESERVED_KEYS = Object.freeze(['profiles']);

/** Control characters and bidi overrides are stripped: a name is shown, not run. */
export function sanitizeProfileName(value, fallback = '') {
  const text = configString(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, PROFILE_LIMITS.nameChars) || fallback;
}

function sanitizeProfileId(value, index) {
  const text = configString(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, PROFILE_LIMITS.idChars);
  return text || `profile-${index + 1}`;
}

/** A copy of the settings that may live inside a profile. */
export function profileValuesFrom(settings) {
  const source = cleanConfigData(settings);
  const values = {};
  if (!source || typeof source !== 'object') return values;
  for (const key of Object.keys(source)) {
    if (PROFILE_RESERVED_KEYS.includes(key)) continue;
    values[key] = source[key];
  }
  return values;
}

/**
 * One untrusted profile → validated profile.
 * @param {object} raw
 * @param {{index?:number, validateValues?:(values:object)=>{values:object,warnings:string[]}, now?:()=>number}} options
 */
export function normalizeProfile(raw, { index = 0, validateValues, now = () => Date.now() } = {}) {
  const source = cleanConfigData(raw);
  const warnings = [];
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { profile: null, warnings: [`Entry ${index + 1} was not an object and was dropped.`] };
  }
  const name = sanitizeProfileName(source.name);
  if (!name) return { profile: null, warnings: [`Entry ${index + 1} had no usable name and was dropped.`] };
  const values = profileValuesFrom(source.values);
  const checked = validateValues ? validateValues(values) : { values, warnings: [] };
  for (const warning of checked.warnings || []) warnings.push(`Profile “${name}”: ${warning}`);
  const createdAt = configNumber(source.createdAt, 0);
  return {
    profile: {
      id: sanitizeProfileId(source.id, index),
      name,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now(),
      values: checked.values && typeof checked.values === 'object' ? checked.values : {},
    },
    warnings,
  };
}

/** Whole list: cap, unique ids, unique names (case-insensitive), stable order. */
export function validateProfiles(list, options = {}) {
  const warnings = [];
  const profiles = [];
  const ids = new Set();
  const names = new Set();
  const incoming = Array.isArray(list) ? list : [];
  if (incoming.length > PROFILE_LIMITS.max) {
    warnings.push(`Only the first ${PROFILE_LIMITS.max} profiles were kept (${incoming.length} were stored).`);
  }
  for (let index = 0; index < Math.min(incoming.length, PROFILE_LIMITS.max); index += 1) {
    const { profile, warnings: itemWarnings } = normalizeProfile(incoming[index], { ...options, index });
    for (const warning of itemWarnings) warnings.push(warning);
    if (!profile) continue;
    let id = profile.id;
    if (ids.has(id)) {
      id = `${id}-${index + 1}`;
      warnings.push(`Two profiles shared an id, so one was renamed to “${id}”.`);
    }
    profile.id = id;
    ids.add(id);
    let name = profile.name;
    if (names.has(name.toLowerCase())) {
      name = sanitizeProfileName(`${profile.name} (${index + 1})`, profile.name);
      warnings.push(`Two profiles were both called “${profile.name}”, so one is now “${name}”.`);
    }
    profile.name = name;
    names.add(name.toLowerCase());
    profiles.push(profile);
  }
  return { profiles, warnings };
}

/** Storage form: plain own data only, fixed key order, no functions. */
export function serializeProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
    id: String(profile.id || ''),
    name: String(profile.name || ''),
    createdAt: Number(profile.createdAt) || 0,
    values: profileValuesFrom(profile.values),
  }));
}

/**
 * Capture the current configuration as a new profile.
 * @returns {{profiles:object[],profile:object|null,warnings:string[]}}
 */
export function captureProfile(settings, name, { now = () => Date.now(), id } = {}) {
  const profiles = Array.isArray(settings && settings.profiles) ? settings.profiles : [];
  if (profiles.length >= PROFILE_LIMITS.max) {
    return { profiles, profile: null, warnings: [`Only ${PROFILE_LIMITS.max} profiles are kept; delete one first.`] };
  }
  const cleanName = sanitizeProfileName(name);
  if (!cleanName) return { profiles, profile: null, warnings: ['Give the profile a name first.'] };
  const taken = profiles.some((profile) => profile.name.toLowerCase() === cleanName.toLowerCase());
  const uniqueName = taken ? sanitizeProfileName(`${cleanName} (${profiles.length + 1})`, cleanName) : cleanName;
  const profile = {
    id: sanitizeProfileId(id, profiles.length),
    name: uniqueName,
    createdAt: now(),
    values: profileValuesFrom(settings),
  };
  return { profiles: profiles.concat([profile]), profile, warnings: taken ? [`A profile already used the name “${cleanName}”; this one is “${uniqueName}”.`] : [] };
}

/**
 * Settings with a profile's values applied.
 *
 * Whole-value replacement per key, not a deep merge: a profile is a complete
 * validated configuration, and half-merging two configurations is exactly the
 * confusing precedence this design avoids. The profile list itself is never
 * taken from the snapshot, so applying cannot duplicate or delete profiles.
 */
export function applyProfile(settings, values) {
  const base = Object.assign({}, cleanConfigData(settings) || {});
  const source = profileValuesFrom(values);
  for (const key of Object.keys(source)) base[key] = source[key];
  return base;
}

/** Remove one profile by id. */
export function removeProfile(settings, id) {
  const profiles = Array.isArray(settings && settings.profiles) ? settings.profiles : [];
  return profiles.filter((profile) => profile.id !== id);
}

/** One-line description for the list, so a profile is identifiable before use. */
export function profileSummary(profile) {
  const values = profile && profile.values ? profile.values : {};
  const parts = [];
  if (Array.isArray(values.formats) && values.formats.length) parts.push(values.formats.map((id) => String(id).toUpperCase()).join('/'));
  if (values.subfolder) parts.push(`subfolder ${values.subfolder}`);
  if (values.filenameTemplate) parts.push(`template ${values.filenameTemplate}`);
  if (Array.isArray(values.presets) && values.presets.length) parts.push(`${values.presets.length} preset${values.presets.length === 1 ? '' : 's'}`);
  if (values.shortcuts && typeof values.shortcuts === 'object') {
    const count = Object.keys(values.shortcuts).length;
    if (count) parts.push(`${count} shortcut${count === 1 ? '' : 's'}`);
  }
  return parts.length ? parts.join(' · ') : 'no notable overrides recorded';
}
