/**
 * ZIP archive writer (store method, no compression).
 *
 * Why hand-rolled: the images this script archives are already compressed
 * (JPEG/PNG/WebP/GIF), so DEFLATE would spend CPU for ~0% saving, and a
 * dependency-free "store" archive is a few hundred bytes of well-specified
 * structure that can be verified against Python's `zipfile` in tests.
 *
 * Layout written per entry:
 *   local file header + name + raw bytes
 * then the central directory (one record per entry) and the end-of-central-
 * directory record. Names are UTF-8 with general-purpose bit 11 set, so
 * non-ASCII file names survive.
 *
 * Nothing here touches the network or the DOM.
 */

import { sanitizePathComponent } from '../core/filename.js';
import { ScriptError } from '../core/errors.js';

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 — enough for store + UTF-8 names
const VERSION_MADE_BY = 0x031e; // UNIX, zip 3.0 (so mode bits are honoured)
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const EXTERNAL_ATTR_FILE = 0o644 << 16;

/** Hard bounds: an archive is built in memory, so it must stay predictable. */
export const ZIP_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GB
  maxNameBytes: 200,
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the checksum ZIP requires. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * DOS time/date pair for an entry. ZIP has no timezone or sub-second field, and
 * cannot represent years before 1980, so the value is clamped rather than
 * wrapped (a wrong-but-plausible timestamp beats a corrupt archive).
 */
export function dosDateTime(date) {
  const safe = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.max(1980, Math.min(2107, safe.getFullYear()));
  const month = Math.max(1, Math.min(12, safe.getMonth() + 1));
  const day = Math.max(1, Math.min(31, safe.getDate()));
  const time = (safe.getHours() << 11) | (safe.getMinutes() << 5) | (Math.floor(safe.getSeconds() / 2) & 0x1f);
  const dateField = ((year - 1980) << 9) | (month << 5) | day;
  return { time: time & 0xffff, date: dateField & 0xffff };
}

/**
 * Build an archive-safe entry name.
 *
 * Rejects absolute paths, drive letters and `..` segments (zip-slip: a reader
 * that trusts the name would write outside the target directory), collapses
 * duplicate slashes, and applies the same character sanitisation used for
 * ordinary downloads. Collisions are resolved by the caller.
 *
 * @returns {{name: string, changed: boolean}}
 */
export function sanitizeEntryName(input, { maxBytes = ZIP_LIMITS.maxNameBytes } = {}) {
  const raw = typeof input === 'string' ? input : String(input == null ? '' : input);
  const trimmed = raw.replace(/\\/g, '/').trim();
  const withoutDrive = trimmed.replace(/^[A-Za-z]:/, '');
  const segments = [];
  for (const segment of withoutDrive.split('/')) {
    const clean = sanitizePathComponent(segment, { maxChars: 80 });
    if (!clean || clean === '.' || clean === '..') continue;
    segments.push(clean);
  }
  let name = segments.join('/');
  if (!name) name = 'image';
  if (zipByteLength(name) > maxBytes) name = truncateBytes(name, maxBytes);
  return { name, changed: name !== raw };
}

/**
 * Encode a list of entries into a ZIP archive.
 *
 * @param {Array<{name: string, bytes: Uint8Array|ArrayBuffer|number[], mtime?: Date}>} entries
 * @param {{comment?: string, now?: () => Date, dedupe?: boolean}} [options]
 * @returns {{bytes: Uint8Array, entries: Array<{name: string, size: number, crc: number}>, notes: string[]}}
 */
export function encodeZip(entries, { comment = '', now = () => new Date(), dedupe = true } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) throw new ScriptError('zip-empty', 'Nothing to archive: the selection produced no files.');

  const notes = [];
  const prepared = [];
  const seen = new Set();
  let total = 0;

  for (const entry of list) {
    if (!entry) continue;
    const data = zipToBytes(entry.bytes);
    if (!data || !data.length) {
      notes.push(`Skipped "${shortName(entry.name)}": it had no bytes to archive.`);
      continue;
    }
    const sanitized = sanitizeEntryName(entry.name);
    let name = sanitized.name;
    if (sanitized.changed) notes.push(`Renamed "${shortName(entry.name)}" to "${name}" so it is safe inside an archive.`);
    if (seen.has(name)) {
      if (!dedupe) throw new ScriptError('zip-duplicate', `Two files would be called "${name}".`);
      name = uniqueName(name, seen);
      notes.push(`A file was already called "${name.replace(/-\d+(\.[^.\/]+)$/, '$1')}", so this one was renamed to "${name}".`);
    }
    seen.add(name);
    total += data.length;
    if (prepared.length >= ZIP_LIMITS.maxEntries) {
      notes.push(`Stopped at ${ZIP_LIMITS.maxEntries} entries; the rest were left out.`);
      break;
    }
    if (total > ZIP_LIMITS.maxTotalBytes) {
      notes.push(`Stopped after ${zipFormatBytes(total)}: the archive would exceed the ${zipFormatBytes(ZIP_LIMITS.maxTotalBytes)} in-memory limit.`);
      total -= data.length;
      break;
    }
    prepared.push({ name, data, crc: crc32(data), stamp: dosDateTime(entry.mtime || now()) });
  }

  if (!prepared.length) {
    throw new ScriptError('zip-empty', 'Nothing to archive: every selected file was empty.');
  }

  const nameBytes = prepared.map((entry) => encodeUtf8(entry.name));
  const commentBytes = encodeUtf8(String(comment || '').slice(0, 500));

  let size = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    size += 30 + nameBytes[index].length + prepared[index].data.length;
  }
  const centralOffset = size;
  for (let index = 0; index < prepared.length; index += 1) size += 46 + nameBytes[index].length;
  size += 22 + commentBytes.length;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;

  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    const name = nameBytes[index];
    const localOffset = offset;
    view.setUint32(offset, LOCAL_HEADER_SIG, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, METHOD_STORE, true);
    view.setUint16(offset + 10, entry.stamp.time, true);
    view.setUint16(offset + 12, entry.stamp.date, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, name.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;
    out.set(name, offset);
    offset += name.length;
    out.set(entry.data, offset);
    offset += entry.data.length;
    entry.localOffset = localOffset;
  }

  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    const name = nameBytes[index];
    view.setUint32(offset, CENTRAL_HEADER_SIG, true);
    view.setUint16(offset + 4, VERSION_MADE_BY, true);
    view.setUint16(offset + 6, VERSION_NEEDED, true);
    view.setUint16(offset + 8, FLAG_UTF8, true);
    view.setUint16(offset + 10, METHOD_STORE, true);
    view.setUint16(offset + 12, entry.stamp.time, true);
    view.setUint16(offset + 14, entry.stamp.date, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, name.length, true);
    view.setUint16(offset + 30, 0, true); // extra length
    view.setUint16(offset + 32, 0, true); // comment length
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, EXTERNAL_ATTR_FILE, true);
    view.setUint32(offset + 42, entry.localOffset, true);
    offset += 46;
    out.set(name, offset);
    offset += name.length;
  }

  view.setUint32(offset, EOCD_SIG, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, size - centralOffset - 22 - commentBytes.length, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, commentBytes.length, true);
  offset += 22;
  if (commentBytes.length) {
    out.set(commentBytes, offset);
    offset += commentBytes.length;
  }

  return {
    bytes: out,
    entries: prepared.map((entry) => ({ name: entry.name, size: entry.data.length, crc: entry.crc })),
    notes,
  };
}

/** Total archive size for a set of entries, without building it (for warnings). */
export function estimateZipSize(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let payload = 0;
  for (const entry of list) {
    const data = zipToBytes(entry && entry.bytes);
    payload += data ? data.length : 0;
  }
  const perEntry = 30 + 46 + 40; // headers plus a typical name
  return payload + list.length * perEntry + 22;
}

function uniqueName(name, taken) {
  const dot = name.lastIndexOf('.');
  const slash = name.lastIndexOf('/');
  const hasExt = dot > slash + 1 && dot < name.length - 1;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let counter = 2; counter < 10000; counter += 1) {
    const candidate = `${stem}-${counter}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function zipToBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function encodeUtf8(text) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
  const out = [];
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

function zipByteLength(text) {
  return encodeUtf8(text).length;
}

function truncateBytes(text, maxBytes) {
  const chars = [...String(text)];
  let out = '';
  for (const char of chars) {
    if (zipByteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out || 'image';
}

function shortName(name) {
  const text = String(name == null ? '' : name);
  return text.length > 40 ? `…${text.slice(-39)}` : text;
}

function zipFormatBytes(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
