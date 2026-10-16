#!/usr/bin/env node
/**
 * Generate docs/reference/settings.md from the settings schema and the panel UI.
 *
 * The page is derived, never hand-written: a setting that exists in the code but
 * not in the document (or a stale default) would otherwise be a documentation
 * bug. `npm run verify:release` fails when the committed page is stale, so this
 * script runs in CI (check mode) as well as locally (write mode).
 *
 * Usage: node scripts/gen-settings-doc.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { FORMATS } from '../src/core/formats.js';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from '../src/core/shortcuts.js';
import { UI_MESSAGES } from '../src/core/messages.js';
import { PRESET_LIMITS } from '../src/core/presets.js';
import { PROFILE_LIMITS } from '../src/core/profiles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'docs/reference/settings.md');
const check = process.argv.includes('--check');
const source = readFileSync(resolve(root, 'src/core/settings.js'), 'utf8');

/**
 * One-line description for a key, taken from the doc comment directly above it in
 * `DEFAULT_SETTINGS`. Derived rather than hand-maintained so the reference cannot
 * drift from the schema; keys without a comment show "—" instead of an invention.
 */
function describeOf(key) {
  const start = source.indexOf('export const DEFAULT_SETTINGS');
  const end = source.indexOf(`  ${key}:`, start);
  if (end < 0) return '—';
  const before = source.slice(start, end);
  const match = before.match(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/[\s\n]*$/);
  if (!match) return '—';
  const text = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '—';
  const first = text.split(/(?<=\.)\s/)[0];
  return first.replace(/\|/g, '\\|');
}
const cell = (value) => {
  if (Array.isArray(value)) return `\`${JSON.stringify(value)}\``;
  if (value && typeof value === 'object') return `\`${JSON.stringify(value)}\``;
  if (typeof value === 'string') return `\`"${value}"\``;
  return `\`${String(value)}\``;
};
const rows = Object.keys(DEFAULT_SETTINGS).slice().sort().map((key) => [key, cell(DEFAULT_SETTINGS[key]), describeOf(key)]);
const omitted = rows.filter((row) => row[2] === '—').map((row) => row[0]);

const lines = [];
lines.push('<!-- GENERATED FILE — do not edit by hand. Run `npm run docs:settings`. -->');
lines.push('');
lines.push('# Settings reference');
lines.push('');
lines.push(`Generated from \`src/core/settings.js\` (schema version 3). The script stores these ${rows.length} keys in the single manager-storage key \`siat.settings.v3\`; nothing is written to the page.`);
lines.push('');
lines.push('Every value below is validated on load: numbers are clamped into range, unknown ids fall back to defaults, strings are length-capped, and a rejected value produces a warning that the dialog shows under *“Some stored settings needed attention”*.');
lines.push('');
lines.push('| Setting | Default | Meaning (from the schema comment) |');
lines.push('|---|---|---|');
for (const [key, value, description] of rows) lines.push(`| \`${key}\` | ${value} | ${description} |`);
lines.push('');
lines.push('## Formats offered by the menu');
lines.push('');
lines.push(`| Id | Label | Output | Transparency | Engine |`);
lines.push('|---|---|---|---|---|');
for (const format of FORMATS) {
  const engine = format.engine === 'native' ? 'browser encoder (verified by MIME check)' : `hand-written \`${format.engine}\` writer`;
  lines.push(`| \`${format.id}\` | ${format.label} | \`.${format.ext}\` | ${format.transparency ? 'yes' : 'flattened onto the background colour'} | ${engine} |`);
}
lines.push('');
lines.push('## Default keyboard shortcuts');
lines.push('');
lines.push('| Action | Default chord |');
lines.push('|---|---|');
for (const action of SHORTCUT_ACTIONS) lines.push(`| \`${action.id}\` — ${action.label} | \`${DEFAULT_SHORTCUTS[action.id] || 'unbound'}\` |`);
lines.push('');
lines.push(`Chords always require Ctrl, Alt or Meta. Every action is rebindable in *Settings → Keyboard shortcuts*, and clearing a field disables that action.`);
lines.push('');
lines.push('## Limits');
lines.push('');
lines.push('| Limit | Value |');
lines.push('|---|---|');
lines.push(`| Conversion presets | ${PRESET_LIMITS.max} |`);
lines.push(`| Host rules per preset | ${PRESET_LIMITS.maxHosts} |`);
lines.push(`| Configuration profiles | ${PROFILE_LIMITS.max} |`);
lines.push(`| Configuration-profile name length | ${PROFILE_LIMITS.nameChars} characters |`);
lines.push(`| Settings import size | 256 KB of text, refused before reading the file |`);
lines.push('');
lines.push('## Localised strings');
lines.push('');
lines.push(`The strings added by the configuration-profile feature ship in ${Object.keys(UI_MESSAGES).length} languages (${Object.keys(UI_MESSAGES).join(', ')}), with right-to-left layout for Arabic. The rest of the interface is currently English-only — see [Compatibility](../compatibility.md#known-limitations).`);
lines.push('');
const text = `${lines.join('\n')}\n`;

if (check) {
  const current = (() => { try { return readFileSync(target, 'utf8'); } catch { return ''; } })();
  if (current !== text) {
    console.error(`docs/reference/settings.md is stale (${rows.length} settings). Run: npm run docs:settings`);
    process.exit(1);
  }
  console.log(`settings reference is current (${rows.length} settings, ${FORMATS.length} formats, ${SHORTCUT_ACTIONS.length} shortcuts)`);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote docs/reference/settings.md — ${rows.length} settings, ${FORMATS.length} formats, ${SHORTCUT_ACTIONS.length} shortcuts${omitted.length ? ` (no schema comment: ${omitted.join(', ')})` : ''}`);
}
