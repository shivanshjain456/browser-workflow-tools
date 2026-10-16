import { cleanConfigData, parseConfigJson, configNumber, configString } from './config-data.js';
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

import { FORMAT_IDS, defaultEnabledFormats } from './formats.js';
import { sanitizePathComponent, sanitizeSubfolder } from './filename.js';
import { validateTemplate, MAX_TEMPLATE_LENGTH } from './template.js';
import { validatePresets, serializePresets } from './presets.js';
import { validateProfiles, serializeProfiles } from './profiles.js';
import { validateShortcuts, formatBinding, DEFAULT_SHORTCUTS } from './shortcuts.js';
import { normalizeTransform, TRANSFORM_DEFAULTS } from './transform.js';

/**
 * v3 adds the batch/picker, template, preset, clipboard, metadata, transform,
 * comparison and shortcut settings. The storage key moved with the version so a
 * downgrade to v1.x keeps working from its own key instead of choking on fields
 * it does not know; v2 keys are read and migrated.
 */
export const SETTINGS_SCHEMA_VERSION = 3;
export const SETTINGS_STORAGE_KEYS = ['siat.settings.v3', 'siat.settings.v2', 'siat.settings', 'saveImageAsType.settings'];

export const DEFAULT_SETTINGS = Object.freeze({
  /** Storage schema this build writes; older keys are migrated forward, never silently discarded. */
  schemaVersion: SETTINGS_SCHEMA_VERSION,

  /** Which formats appear in the right-click menu, in this order. */
  formats: defaultEnabledFormats().filter((id) => id !== 'avif'),

  /** 'instant' = save without a dialog where the manager allows it; 'ask' = request Save As. */
  downloadBehavior: 'instant',

  /** Text joined to the front of every file name; path separators are removed. */
  filenamePrefix: '',
  /** Optional relative download sub-folder (browser download mode only). */
  subfolder: '',
  /** Upper bound for the file-name stem; the extension always fits. */
  maxFilenameLength: 64,

  /** Background used when a format cannot store transparency (JPG, PDF, GIF-without-alpha). */
  flattenBackground: 'white',

  /** JPEG quality (0.5–1.0) for JPG output and the image inside a PDF. */
  jpegQuality: 0.92,
  /** WebP quality (0.1–1.0). */
  webpQuality: 0.9,

  /** PDF page geometry: 'a4' | 'letter' (fit, keep aspect) | 'pixel' (1px = 0.75pt). */
  pdfPageFit: 'a4',

  /** Animated sources: try to keep every frame when the browser can decode them. */
  keepAnimation: true,
  /** How many frames of an animated source are kept; extra frames are dropped evenly. */
  gifMaxFrames: 100,
  /** Refuse a GIF conversion above this many MB of raw frame pixels (crash guard). */
  gifMemoryLimitMB: 512,

  /** Downscale very large images before encoding, to keep the tab alive. 0 = never. */
  downscaleAboveMegapixels: 40,

  /** Fetch cross-origin image bytes through the manager (the CORS bypass). */
  allowCrossOriginFetch: true,

  /** Include CSS background images when looking for something to convert. */
  enableBackgroundImages: true,
  /** Open the menu by holding a finger on an image (touch devices). */
  enableLongPress: true,
  /** Replace the browser context menu over images with the conversion menu. */
  interceptContextMenu: true,
  /** Power option: only open our menu when Shift is held, leaving the native menu as default. */
  requireShift: false,

  /** Pre-select the format used last in this page session. */
  rememberLastFormat: true,
  /** Raise a manager notification when a background action fails. */
  notifyOnError: true,

  /* ── v3: batch conversion and archives ─────────────────────────────── */

  /** How many images convert at once. Bounded: a 500-image page must not open 500 fetches. */
  batchConcurrency: 2,
  /** Upper bound for one batch run; the rest are reported as skipped. */
  batchMaxImages: 200,
  /** Ignore images smaller than these (0 = off). Keeps icons and tracking pixels out. */
  batchMinWidth: 0,
  /** Minimum image height a batch run will convert (0 = off). */
  batchMinHeight: 0,
  /** Skip icon-sized images in batch runs. */
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

  /** Conversion presets (per-conversion overlays with optional host rules). */
  presets: [],
  /** Preset currently forced on, or empty for none. */
  activePresetId: '',
  /** Apply the most specific host-matching preset automatically. */
  autoApplyPresetByHost: true,

  /* ── v3: clipboard, metadata, transform, comparison ────────────────── */

  /** 'png' = re-encode for the clipboard; 'original' = try the source bytes first. */
  copyFormat: 'png',
  /** Drop EXIF/XMP when re-saving the *original* file. */
  stripMetadataOnOriginal: false,
  /** Also drop the ICC colour profile (changes how colours may look). */
  dropIccWhenStripping: false,
  /** Warn when inspected metadata contains GPS coordinates. */
  warnAboutGps: true,
  /** Transform applied unless the dialog overrides it. null = none. */
  defaultTransform: null,
  /** Formats measured by "Compare formats…". */
  compareFormats: ['png', 'jpg', 'webp'],

  /* ── v3: keyboard and scanning ─────────────────────────────────────── */

  /** Master switch for the keyboard chords. */
  enableShortcuts: true,
  /** User-bindable chords; see src/core/shortcuts.js for the action list. */
  shortcuts: Object.assign({}, DEFAULT_SHORTCUTS),
  /** Which extra actions the right-click menu shows. */
  menuActions: ['copy', 'transform', 'compare', 'inspect', 'browse', 'batch'],
  /** Scan page elements for CSS background images during the picker scan. */
  scanBackgrounds: true,
  /** Elements inspected while looking for CSS background images. */
  scanElementCap: 2500,
  /** Show the small progress bar while a batch runs. */
  showJobBar: true,

  /* ── v3: named configuration profiles (G-67) ────────────────────────── */

  /**
   * Whole-configuration snapshots the user names and switches between. Empty by
   * default, so an existing installation behaves exactly as before; carried
   * inside the same schema-3 object and storage key as every other setting, so
   * export/import, migration and downgrade keep working without a new file,
   * credential or storage location. Values inside each profile are validated by
   * this same module.
   */
  profiles: [],
});

/** Menu action ids that may appear in `menuActions`. */
export const MENU_ACTION_IDS = Object.freeze(['copy', 'transform', 'compare', 'inspect', 'browse', 'batch']);

/** What each extra menu action does, for the settings panel. */
export const MENU_ACTION_LABELS = Object.freeze({
  copy: { label: 'Copy image to clipboard', hint: 'Copies a PNG (or the original bytes) for pasting into another app.' },
  transform: { label: 'Transform and save…', hint: 'Resize, crop, rotate or flip before saving.' },
  compare: { label: 'Compare formats…', hint: 'Encodes the image several ways and shows which file is smallest.' },
  inspect: { label: 'Inspect metadata', hint: 'Shows embedded EXIF/XMP/ICC data, including any GPS coordinates.' },
  browse: { label: 'Browse page images…', hint: 'Lists every image on the page with size, type and state.' },
  batch: { label: 'Save all images on this page…', hint: 'Converts the whole page in one run, with progress and cancel.' },
});

/** Deep-copied defaults: nested arrays/objects must never be shared with the frozen template. */
export function cloneDefaults() {
  return {
    ...DEFAULT_SETTINGS,
    formats: DEFAULT_SETTINGS.formats.slice(),
    batchFormats: DEFAULT_SETTINGS.batchFormats.slice(),
    compareFormats: DEFAULT_SETTINGS.compareFormats.slice(),
    menuActions: DEFAULT_SETTINGS.menuActions.slice(),
    presets: [],
    profiles: [],
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
export function migrateSettings(raw) {
  raw = cleanConfigData(raw);
  if (!raw || typeof raw !== 'object') return { value: null, from: null };
  const version = configNumber(raw.schemaVersion);
  if (version === SETTINGS_SCHEMA_VERSION) return { value: raw, from: version };

  const migrated = {};

  // v2 -> v3 only *adds* settings; nothing was renamed. Every stored value is
  // carried over untouched and normalizeSettings() fills in the new defaults.
  if (version === 2) {
    return { value: Object.assign(Object.create(null), raw, { schemaVersion: SETTINGS_SCHEMA_VERSION }), from: 2 };
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
    return { value: Object.assign(Object.create(null), raw, { schemaVersion: SETTINGS_SCHEMA_VERSION }), from: version };
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
export function normalizeSettings(raw) {
  raw = cleanConfigData(raw);
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
      else if (id !== undefined) note(`Ignored unknown format "${configString(id).slice(0, 20)}".`);
    }
    // An empty menu would make the script unusable and look like a bug.
    out.formats = clean.length ? clean : DEFAULT_SETTINGS.formats.slice();
    if (!clean.length) note('No valid formats were enabled — restored the default list.');
  } else if (raw.formats !== undefined) {
    note('formats was not a list — restored the default list.');
  }

  if (raw.downloadBehavior !== undefined) {
    if (raw.downloadBehavior === 'instant' || raw.downloadBehavior === 'ask') out.downloadBehavior = raw.downloadBehavior;
    else note(`downloadBehavior "${configString(raw.downloadBehavior).slice(0, 20)}" is not valid — using "instant".`);
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
    else note(`pdfPageFit "${configString(raw.pdfPageFit).slice(0, 20)}" is not valid — using "a4".`);
  }

  if (raw.flattenBackground !== undefined) {
    if (['white', 'black', 'checker'].includes(raw.flattenBackground)) out.flattenBackground = raw.flattenBackground;
    else note(`flattenBackground "${configString(raw.flattenBackground).slice(0, 20)}" is not valid — using "white".`);
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
    else note(`batchDestination "${configString(raw.batchDestination).slice(0, 20)}" is not valid — using "files".`);
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

  /* ── v3: named configuration profiles ──────────────────────────────── */
  if (raw.profiles !== undefined) {
    if (!Array.isArray(raw.profiles)) {
      note('profiles was not a list — profiles were cleared.');
    } else {
      // A profile's values are an import that never touched the disk, so they
      // go through the same validator as the rest of this object. The reserved
      // `profiles` key is removed first: that makes the recursion structurally
      // impossible instead of relying on a depth limit.
      const validated = validateProfiles(raw.profiles, {
        validateValues(values) {
          const nested = Object.assign({}, values);
          delete nested.profiles;
          const result = normalizeSettings(nested);
          return { values: result.settings, warnings: result.warnings };
        },
      });
      out.profiles = serializeProfiles(validated.profiles);
      for (const warning of validated.warnings) note(warning);
    }
  }

  /* ── v3: clipboard and metadata ────────────────────────────────────── */
  if (raw.copyFormat !== undefined) {
    if (raw.copyFormat === 'png' || raw.copyFormat === 'original') out.copyFormat = raw.copyFormat;
    else note(`copyFormat "${configString(raw.copyFormat).slice(0, 20)}" is not valid — using "png".`);
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
      note(`Ignored unknown setting "${configString(key).slice(0, 30)}".`);
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
  const n = configNumber(raw[key]);
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
  const n = configNumber(raw[key]);
  if (!Number.isFinite(n)) {
    note(`${key} was not a number — using ${out[key]}.`);
    return out[key];
  }
  if (n < min || n > max) note(`${key} ${n} is outside ${min}–${max} — clamped.`);
  return Math.min(max, Math.max(min, n));
}

/** Used by the settings panel's "Import JSON" action. */
export function validateImportedSettings(text) {
  let parsed;
  try {
    parsed = parseConfigJson(typeof text === 'string' ? text : '');
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
export function createSettingsStore(deps) {
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
          raw = parseConfigJson(value);
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
          parsed = parseConfigJson(next);
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
    const merged = Object.assign(Object.create(null), cached, cleanConfigData(patch) || {});
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
