import { cleanConfigData, configNumber, configString } from './config-data.js';
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

import { TRANSFORM_DEFAULTS, normalizeTransform } from './transform.js';
import { validateTemplate } from './template.js';
import { sanitizeSubfolder } from './filename.js';

export const PRESET_LIMITS = Object.freeze({
  max: 12,
  maxHosts: 8,
  nameChars: 40,
  hostChars: 60,
});

export const PRESET_DESTINATIONS = Object.freeze(['file', 'zip']);

const PRESET_FORMAT_IDS = ['png', 'jpg', 'webp', 'gif', 'bmp', 'avif', 'pdf', 'original'];

/** Turn one untrusted object into a usable preset. */
export function normalizePreset(raw, { index = 0, allowedFormats = PRESET_FORMAT_IDS } = {}) {
  raw = cleanConfigData(raw);
  const warnings = [];
  const source = raw && typeof raw === 'object' ? raw : {};

  const name = configString(source.name || '').trim().slice(0, PRESET_LIMITS.nameChars) || `Preset ${index + 1}`;
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
    warnings.push(`Preset "${name}": format "${configString(source.formatId).slice(0, 12)}" is not available here and was dropped.`);
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
export function validatePresets(list, { allowedFormats = PRESET_FORMAT_IDS } = {}) {
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
export function sanitizeHostPattern(value) {
  const raw = configString(value == null ? '' : value).trim().toLowerCase();
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
export function hostMatches(pattern, host) {
  const rule = configString(pattern || '').toLowerCase().trim();
  const target = configString(host || '').toLowerCase().trim().replace(/:\d+$/, '');
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
export function presetForHost(presets, host) {
  const list = Array.isArray(presets) ? presets : [];
  if (!host) return null;
  let best = null;
  let bestScore = -1;
  for (let index = 0; index < list.length; index += 1) {
    const preset = list[index];
    if (!preset || !Array.isArray(preset.hosts)) continue;
    for (const pattern of preset.hosts) {
      if (!hostMatches(pattern, host)) continue;
      const labels = configString(pattern).replace(/^\*\./, '').split('.').filter(Boolean).length;
      const exact = configString(pattern).startsWith('*.') ? 0 : 1;
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
export function effectiveSettings(settings, preset) {
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
export function presetSummary(preset) {
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
export function serializePresets(presets) {
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
  const text = configString(value == null ? '' : value).trim().toLowerCase();
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
  const number = configNumber(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(min, Math.min(1, number));
}
