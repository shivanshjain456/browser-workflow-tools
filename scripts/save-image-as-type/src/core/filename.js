/**
 * Filename construction.
 *
 * Everything here is pure and synchronous, because it is the part of the script
 * that touches user-visible output on every single save and must never produce
 * an illegal, empty, colliding or path-escaping name.
 *
 * Threat model: the base name comes from an attacker-controllable page (URL
 * path, `alt` attribute, `<title>`), and the prefix/sub-folder come from the
 * user's own settings which may themselves have been imported from a JSON file.
 * So every string is treated as hostile input: control characters, path
 * separators, Windows-reserved device names, trailing dots/spaces and
 * over-long values are all neutralised.
 */

const ILLEGAL_CHARS = /[\u0000-\u001f\u007f\\/:*?"<>|\u200e\u200f\u202a-\u202e\ufeff]/g;
// Windows interprets device names before any extension, including dotted bases.
// Superscript 1/2/3 are also device digits. Console pseudo-files are disallowed.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:[. ]|$)/i;
const ABSOLUTE_MAX_BYTES = 200; // keep room for the extension + manager suffixes

/** Strip everything that is not safe in a single path component. */
export function sanitizePathComponent(input, { maxChars = 100 } = {}) {
  if (typeof input !== 'string') return '';
  let text = input;
  try {
    text = text.normalize('NFC');
  } catch {
    /* very old engines: keep as-is */
  }
  text = text
    // Decode each *run* of escapes as a unit so multi-byte UTF-8 sequences
    // survive: "%C3%A9" is one character (é) and decoding it escape-by-escape
    // would throw and delete it. A malformed run falls back to per-escape
    // decoding, keeping the bytes that are valid on their own. Decoding happens
    // exactly once, so a double-encoded "%252F" can never become a separator.
    .replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        let kept = '';
        for (const single of run.matchAll(/%[0-9a-f]{2}/gi)) {
          try {
            kept += decodeURIComponent(single[0]);
          } catch {
            /* undecodable byte: drop it rather than emit mojibake */
          }
        }
        return kept;
      }
    })
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  // Never allow a component to become empty-looking or to re-introduce a path.
  text = text.replace(/[.]+$/, '');
  if (text.length > maxChars) text = text.slice(0, maxChars).replace(/[.\s]+$/, '');
  // Truncation itself can turn an innocent stem such as CONvoy into CON.
  if (WINDOWS_RESERVED.test(text)) text = `_${text}`.slice(0, Math.max(1, maxChars));
  return text;
}

/**
 * Build a download path from a user-supplied sub-folder setting.
 * Returns "" when the setting is empty or unsafe. At most 3 segments, each
 * ≤ 40 chars, ".." and absolute paths rejected.
 */
export function sanitizeSubfolder(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.replace(/\\/g, '/').trim();
  if (!trimmed) return '';
  const segments = trimmed
    .split('/')
    .map((part) => sanitizePathComponent(part, { maxChars: 40 }))
    .filter((part) => part && part !== '.' && part !== '..');
  if (!segments.length) return '';
  return segments.slice(0, 3).join('/');
}

/** Best-effort human name for an image, from the most to the least specific clue. */
export function baseNameFromSource({ sourceUrl, altText, documentTitle, hostName } = {}) {
  const candidates = [];

  if (typeof sourceUrl === 'string' && sourceUrl) {
    // data:, blob: and filesystem: URLs carry no human-readable basename — a
    // blob UUID or the literal "image" is worse than the page's own alt text or
    // title, so they contribute no candidate and the later clues (and the final
    // "image" fallback) win.
    if (/^(?:data|blob|filesystem|about|javascript):/i.test(sourceUrl)) {
      /* no usable name in the URL itself */
    } else {
      let path = sourceUrl;
      try {
        // Reserved non-resolvable base: parse-only, never fetched.
        path = new URL(sourceUrl, 'https://siat.invalid/').pathname;
      } catch {
        /* keep raw */
      }
      const last = path.split('/').filter(Boolean).pop() || '';
      let decoded = last;
      try {
        decoded = decodeURIComponent(last);
      } catch {
        /* malformed escapes: keep the encoded form */
      }
      const withoutExt = decoded.replace(/\.[A-Za-z0-9]{1,5}$/, '');
      if (withoutExt) candidates.push(withoutExt);
    }
  }
  if (typeof altText === 'string' && altText.trim()) candidates.push(altText.trim());
  if (typeof documentTitle === 'string' && documentTitle.trim()) {
    candidates.push(documentTitle.trim().split(/\s*[|–—-]\s*/)[0]);
  }
  if (typeof hostName === 'string' && hostName.trim()) candidates.push(hostName.trim());

  for (const candidate of candidates) {
    const clean = sanitizePathComponent(candidate, { maxChars: 100 });
    if (clean && clean.length >= 1) return clean;
  }
  return 'image';
}

/**
 * @param {object} opts
 * @param {string} opts.base          name without extension (already sanitised or not)
 * @param {string} opts.ext           extension without dot
 * @param {string} [opts.prefix]      user prefix, joined with "-"
 * @param {string} [opts.subfolder]   user sub-folder (only honoured by managers in browser download mode)
 * @param {number} [opts.maxLength]   maximum length of the file name itself (extension included)
 * @param {boolean} [opts.includeSubfolder]
 * @returns {{filename: string, path: string, truncated: boolean, subfolderApplied: boolean}}
 */
export function buildFilename({
  base,
  ext,
  prefix = '',
  subfolder = '',
  maxLength = 64,
  includeSubfolder = false,
}) {
  const safeExt = String(ext || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toLowerCase();
  const cleanBase = sanitizePathComponent(base, { maxChars: 150 }) || 'image';
  const cleanPrefix = sanitizePathComponent(prefix, { maxChars: 40 });

  const limit = clampInt(maxLength, 4, ABSOLUTE_MAX_BYTES);
  const suffix = safeExt ? `.${safeExt}` : '';

  let stem = cleanPrefix ? `${cleanPrefix}-${cleanBase}` : cleanBase;
  let truncated = false;
  const budget = Math.max(1, limit - suffix.length);
  if (byteLength(stem) > budget) {
    stem = truncateToBytes(stem, budget);
    truncated = true;
  }
  if (!stem) stem = 'i'; // a multibyte character may not fit a one-byte budget
  if (WINDOWS_RESERVED.test(stem)) stem = truncateToBytes(`_${stem}`, budget) || 'i';

  const filename = `${stem}${suffix}`;
  const folder = sanitizeSubfolder(subfolder);
  const subfolderApplied = Boolean(folder && includeSubfolder);
  return {
    filename,
    path: subfolderApplied ? `${folder}/${filename}` : filename,
    truncated,
    subfolderApplied,
    droppedSubfolder: Boolean(folder && !includeSubfolder),
  };
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function byteLength(text) {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

/** Truncate on a UTF-8 boundary, never splitting a multi-byte character. */
function truncateToBytes(text, maxBytes) {
  if (byteLength(text) <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const char of text) {
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out.replace(/[.\s\-_]+$/, '');
}
