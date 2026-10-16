/**
 * Filename templates.
 *
 * A template is a string of literal text and `{token}` placeholders, e.g.
 *
 *     {host}-{date}-{w}x{h}-{index3}.{ext}
 *
 * Rendering is total: unknown tokens are reported and dropped (never executed,
 * never left in the name), every substituted value is passed through the same
 * path-component sanitiser used for ordinary downloads, and the result is
 * byte-clamped by `buildFilename` afterwards. Context values come from the page
 * and the image (untrusted), so nothing here may treat them as markup.
 */

import { sanitizePathComponent } from './filename.js';

export const TEMPLATE_TOKENS = Object.freeze([
  { token: 'base', label: 'Source file name', example: 'photo-0142' },
  { token: 'path', label: 'Last URL segment', example: 'photo-0142' },
  { token: 'host', label: 'Image host', example: 'cdn.example.com' },
  { token: 'origin', label: 'Page host', example: 'example.com' },
  { token: 'title', label: 'Page title', example: 'Gallery' },
  { token: 'alt', label: 'Image alt text', example: 'Red fox' },
  { token: 'w', label: 'Output width (px)', example: '1920' },
  { token: 'h', label: 'Output height (px)', example: '1080' },
  { token: 'format', label: 'Format id', example: 'jpg' },
  { token: 'ext', label: 'File extension', example: 'jpeg' },
  { token: 'mime', label: 'MIME subtype', example: 'jpeg' },
  { token: 'bytes', label: 'Output size (bytes)', example: '284193' },
  { token: 'date', label: 'Date (YYYY-MM-DD)', example: '2026-10-16' },
  { token: 'time', label: 'Time (HH-MM-SS)', example: '14-05-09' },
  { token: 'datetime', label: 'Date and time', example: '2026-10-16-14-05-09' },
  { token: 'index', label: 'Counter in this run', example: '7' },
  { token: 'index3', label: 'Counter, zero-padded to 3', example: '007' },
  { token: 'preset', label: 'Active preset name', example: 'Archive PNG' },
]);

const TOKEN_NAMES = TEMPLATE_TOKENS.map((entry) => entry.token);
const TOKEN_PATTERN = /\{([a-z0-9]+)\}/g;
export const MAX_TEMPLATE_LENGTH = 200;

/** Tokens referenced by a template, in order of first appearance. */
export function tokensIn(template) {
  const text = typeof template === 'string' ? template : '';
  const found = [];
  let match;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Check a template before it is stored.
 *
 * @returns {{ok: boolean, errors: string[], warnings: string[], tokens: string[]}}
 */
export function validateTemplate(template) {
  const errors = [];
  const warnings = [];
  const text = typeof template === 'string' ? template : '';

  if (!text.trim()) errors.push('A template cannot be empty.');
  if (text.length > MAX_TEMPLATE_LENGTH) errors.push(`A template cannot exceed ${MAX_TEMPLATE_LENGTH} characters.`);

  const tokens = tokensIn(text);
  const unknown = tokens.filter((token) => !TOKEN_NAMES.includes(token));
  if (unknown.length) {
    errors.push(`Unknown token${unknown.length > 1 ? 's' : ''}: ${unknown.map((token) => `{${token}}`).join(', ')}.`);
  }

  // Unbalanced braces are almost always a typo the user will want to see.
  const open = (text.match(/\{/g) || []).length;
  const close = (text.match(/\}/g) || []).length;
  if (open !== close) warnings.push('The braces do not balance — check for a missing { or }.');
  if (!tokens.length) warnings.push('This template has no tokens, so every file gets the same name.');
  if (/[\\/:*?"<>|]/.test(text.replace(TOKEN_PATTERN, ''))) {
    warnings.push('Some characters (\\ / : * ? " < > |) are not allowed in file names and will be replaced.');
  }
  if (!tokens.includes('base') && !tokens.includes('path') && !tokens.includes('alt') && !tokens.includes('title')) {
    warnings.push('Without {base}, {path}, {alt} or {title} names may collide; a counter is added automatically.');
  }

  return { ok: errors.length === 0, errors, warnings, tokens };
}

/**
 * Render a template.
 *
 * @param {string} template
 * @param {Record<string, string|number|undefined>} context
 * @param {{counter?: number, now?: Date, preset?: string}} [options]
 * @returns {{text: string, warnings: string[], values: Record<string, string>}}
 */
export function renderTemplate(template, context = {}, { counter = 1, now = new Date(), preset = '' } = {}) {
  const text = typeof template === 'string' ? template : '';
  const warnings = [];
  const values = {};
  const stamp = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();

  const ctx = Object.assign({}, context);
  ctx.index = counter;
  ctx.index3 = String(counter).padStart(3, '0');
  ctx.preset = preset;
  ctx.date = formatDate(stamp);
  ctx.time = formatTime(stamp);
  ctx.datetime = `${ctx.date}-${ctx.time}`;

  const rendered = text.replace(TOKEN_PATTERN, (whole, token) => {
    if (!TOKEN_NAMES.includes(token)) {
      warnings.push(`Removed unknown token ${whole}.`);
      return '';
    }
    const raw = ctx[token];
    const value = raw === undefined || raw === null ? '' : sanitizePathComponent(String(raw), { maxChars: 60 });
    values[token] = value;
    return value;
  });

  // Trim both ends: a dropped token or an empty value would otherwise leave a
  // name like "photo-" behind, and Windows rejects trailing dots and spaces.
  const cleaned = sanitizePathComponent(rendered, { maxChars: 150 }).replace(/^[-_. ]+/, '').replace(/[-_. ]+$/, '');
  if (!cleaned) warnings.push('The template produced an empty name; the source file name was used instead.');
  return { text: cleaned, warnings, values };
}

/**
 * A name that no other file in this run already uses.
 *
 * Batches produce many files at once, and two identical names would silently
 * overwrite each other in the download folder — so collisions get a counter
 * rather than being reported after the fact.
 */
export function uniqueFilename(filename, taken) {
  const name = String(filename || 'image');
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let counter = 2; counter < 100000; counter += 1) {
    const candidate = `${stem}-${counter}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}-${minutes}-${seconds}`;
}
