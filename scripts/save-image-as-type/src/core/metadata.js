/**
 * Embedded-metadata inspection and removal.
 *
 * "Save original" currently copies the source file byte-for-byte — including
 * EXIF (camera, timestamps, sometimes GPS), XMP and ICC profiles. Users who
 * publish those files elsewhere leak that data. This module
 *
 *   1. reports what a file carries, with an explicit GPS warning, and
 *   2. removes metadata segments while leaving the image data untouched.
 *
 * Safety rules: every read is bounds-checked; malformed structures degrade to
 * "unknown" rather than throwing; XMP is treated as opaque text (never parsed
 * as XML, so entity expansion cannot be triggered); and if a container cannot be
 * walked with certainty the original bytes are returned unchanged with a note —
 * a corrupt file is worse than an un-stripped one.
 */

import { ScriptError } from './errors.js';

const EXIF_TAGS = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  copyright: 0x8298,
  gpsIfd: 0x8825,
  exifIfd: 0x8769,
};

const EXIF_IFD_TAGS = {
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  iso: 0x8827,
  focalLength35: 0xa405,
  lensModel: 0xa434,
};

const GPS_TAGS = { latitudeRef: 1, latitude: 2, longitudeRef: 3, longitude: 4, altitude: 6 };

export const ORIENTATION_LABELS = Object.freeze({
  1: 'Normal',
  2: 'Mirrored horizontally',
  3: 'Rotated 180°',
  4: 'Mirrored vertically',
  5: 'Mirrored horizontally then rotated 270°',
  6: 'Rotated 90° clockwise',
  7: 'Mirrored horizontally then rotated 90°',
  8: 'Rotated 270° clockwise',
});

/** Which containers can be inspected/stripped, and which cannot (honest limits). */
export const METADATA_SUPPORT = Object.freeze({
  'image/jpeg': { inspect: true, strip: true },
  'image/png': { inspect: true, strip: true },
  'image/webp': { inspect: true, strip: true },
  'image/gif': { inspect: true, strip: true },
  'image/avif': { inspect: false, strip: false },
  'image/bmp': { inspect: false, strip: false },
});

const MAX_IFD_ENTRIES = 256;
const MAX_SEGMENTS = 512;
const MAX_COMMENT_TEXT = 400;

/**
 * Inspect a file's metadata.
 *
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @returns {{supported: boolean, container: string, mime: string, findings: object[], exif: object, xmp: object, icc: object, gps: object, warnings: string[], strippable: boolean, removes: string[]}}
 */
export function inspectMetadata(bytes, mime) {
  const data = metaToBytes(bytes);
  const type = String(mime || detectContainerMime(data) || '').toLowerCase();
  const support = METADATA_SUPPORT[type] || { inspect: false, strip: false };
  const base = {
    supported: support.inspect,
    container: containerOf(type),
    mime: type || 'unknown',
    findings: [],
    exif: { present: false, orientation: 0, fields: {} },
    xmp: { present: false, bytes: 0, fields: {} },
    icc: { present: false, bytes: 0 },
    gps: { present: false, lat: null, lon: null },
    warnings: [],
    strippable: support.strip,
    removes: [],
  };

  if (!data || data.length < 12) {
    base.warnings.push('The file is too small to inspect.');
    return base;
  }
  if (!support.inspect) {
    base.warnings.push(
      type
        ? `${containerOf(type)} metadata cannot be inspected by this script; nothing is claimed about it.`
        : 'The file type was not recognised, so its metadata was not inspected.',
    );
    return base;
  }

  try {
    if (type === 'image/jpeg') inspectJpeg(data, base);
    else if (type === 'image/png') inspectPng(data, base);
    else if (type === 'image/webp') inspectWebp(data, base);
    else if (type === 'image/gif') inspectGif(data, base);
  } catch (err) {
    base.warnings.push(`Inspection stopped early: ${err && err.message ? err.message : 'unreadable structure'}. What was found so far is still listed.`);
  }

  summarise(base);
  return base;
}

/**
 * Remove metadata segments from a file.
 *
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @param {{dropIcc?: boolean}} [options]
 * @returns {{bytes: Uint8Array, changed: boolean, removed: string[], notes: string[], mime: string}}
 */
export function stripMetadata(bytes, mime, { dropIcc = false } = {}) {
  const data = metaToBytes(bytes);
  const type = String(mime || detectContainerMime(data) || '').toLowerCase();
  const support = METADATA_SUPPORT[type] || { inspect: false, strip: false };
  const result = { bytes: data, changed: false, removed: [], notes: [], mime: type };

  if (!data || !data.length) throw new ScriptError('metadata-empty', 'There are no file bytes to strip.');
  if (!support.strip) {
    result.notes.push(
      type
        ? `${containerOf(type)} files cannot be stripped by this script, so the original bytes were kept.`
        : 'The file type was not recognised, so the original bytes were kept.',
    );
    return result;
  }

  let out;
  try {
    if (type === 'image/jpeg') out = stripJpeg(data, { dropIcc });
    else if (type === 'image/png') out = stripPng(data, { dropIcc });
    else if (type === 'image/webp') out = stripWebp(data, { dropIcc });
    else out = stripGif(data);
  } catch (err) {
    result.notes.push(`Stripping was abandoned (${err && err.message ? err.message : 'unreadable structure'}); the original file was kept instead.`);
    return result;
  }

  if (!out || !out.bytes || !out.bytes.length) {
    result.notes.push('Stripping produced no output, so the original file was kept.');
    return result;
  }
  result.bytes = out.bytes;
  result.changed = out.bytes.length !== data.length || out.removed.length > 0;
  result.removed = out.removed;
  result.notes = out.notes || [];
  return result;
}

// ── JPEG ────────────────────────────────────────────────────────────────────

function inspectJpeg(data, out) {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new ScriptError('metadata-bad-jpeg', 'Not a JPEG (missing SOI).');
  let offset = 2;
  let segments = 0;
  while (offset + 4 <= data.length && segments < MAX_SEGMENTS) {
    segments += 1;
    if (data[offset] !== 0xff) {
      // Fill bytes are legal before a marker; anything else ends the walk.
      while (offset < data.length && data[offset] === 0xff) offset += 1;
      if (data[offset] !== 0xff) break;
    }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda) break; // start of scan: the rest is entropy-coded data
    if (offset + 2 > data.length) break;
    const length = (data[offset] << 8) | data[offset + 1];
    if (length < 2) break;
    const payloadStart = offset + 2;
    const payloadEnd = Math.min(data.length, offset + length);
    const payload = data.subarray(payloadStart, payloadEnd);
    offset = offset + length;

    if (marker === 0xe1 && startsWith(payload, 'Exif\0\0')) {
      readExif(payload.subarray(6), out, 'JPEG APP1 (EXIF)');
    } else if (marker === 0xe1 && looksLikeXmp(payload)) {
      readXmp(payload, out, 'JPEG APP1 (XMP)');
    } else if (marker === 0xe2 && startsWith(payload, 'ICC_PROFILE')) {
      out.icc = { present: true, bytes: payload.length, where: 'JPEG APP2 (ICC profile)' };
      out.findings.push({ kind: 'icc', label: 'Colour profile (ICC)', detail: `${payload.length} bytes`, where: 'APP2' });
    } else if (marker === 0xed && startsWith(payload, 'Photoshop 3.0')) {
      out.findings.push({ kind: 'iptc', label: 'IPTC / Photoshop data', detail: `${payload.length} bytes`, where: 'APP13' });
    } else if (marker === 0xfe) {
      const text = printable(payload).slice(0, MAX_COMMENT_TEXT);
      out.findings.push({ kind: 'comment', label: 'Comment', detail: text || `${payload.length} bytes`, where: 'COM' });
    } else if (marker === 0xe0) {
      out.findings.push({ kind: 'jfif', label: 'JFIF header', detail: startsWith(payload, 'JFIF') ? 'density/units only' : `${payload.length} bytes`, where: 'APP0' });
    }
  }
}

function stripJpeg(data, { dropIcc }) {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new ScriptError('metadata-bad-jpeg', 'Not a JPEG (missing SOI).');
  const kept = [data.subarray(0, 2)];
  const removed = [];
  let offset = 2;
  let segments = 0;
  let sawScan = false;

  while (offset + 4 <= data.length && segments < MAX_SEGMENTS && !sawScan) {
    segments += 1;
    while (offset < data.length && data[offset] === 0xff && data[offset + 1] === 0xff) offset += 1;
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];
    if (marker === 0xda) {
      kept.push(data.subarray(offset));
      sawScan = true;
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (data[offset + 2] << 8) | data[offset + 3];
    if (length < 2 || offset + 2 + length > data.length) throw new ScriptError('metadata-bad-jpeg', 'A JPEG segment length points outside the file.');
    const segment = data.subarray(offset, offset + 2 + length);
    const payload = data.subarray(offset + 4, offset + 2 + length);
    offset += 2 + length;

    const drop =
      (marker === 0xe1 && (startsWith(payload, 'Exif\0\0') || looksLikeXmp(payload))) ||
      (marker === 0xe3 && startsWith(payload, 'Meta\0\0')) ||
      (marker === 0xed && startsWith(payload, 'Photoshop 3.0')) ||
      (marker === 0xfe) ||
      (marker === 0xe2 && dropIcc && startsWith(payload, 'ICC_PROFILE'));

    if (drop) {
      if (marker === 0xe1 && startsWith(payload, 'Exif\0\0')) removed.push('EXIF');
      else if (marker === 0xe1) removed.push('XMP');
      else if (marker === 0xed) removed.push('IPTC');
      else if (marker === 0xfe) removed.push('comment');
      else if (marker === 0xe3) removed.push('EXIF-Meta');
      else removed.push('ICC profile');
      continue;
    }
    // APP0 (JFIF) and APP14 (Adobe colour transform) affect how the file is
    // decoded, so they are always kept.
    kept.push(segment);
  }

  if (!sawScan) throw new ScriptError('metadata-bad-jpeg', 'No image data was found after the JPEG headers.');
  const dropped = dedupeList(removed);
  // Only worth a second walk when EXIF really went: the note tells the user that
  // orientation lives in metadata, not in pixels.
  return { bytes: metaConcat(kept), removed: dropped, notes: dropped.includes('EXIF') ? jpegOrientationNote(data) : [] };
}

function jpegOrientationNote(data) {
  const info = inspectMetadata(data, 'image/jpeg');
  const orientation = info.exif.orientation;
  if (orientation && orientation !== 1) {
    return [
      `This file carries EXIF orientation ${orientation} (${ORIENTATION_LABELS[orientation] || 'rotated'}). Removing metadata does not rotate the pixels, so it may display differently. Use Transform → rotate to bake the rotation in instead.`,
    ];
  }
  return [];
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunks(data) {
  if (!startsWith(data, Uint8Array.from(PNG_SIGNATURE))) throw new ScriptError('metadata-bad-png', 'Not a PNG (bad signature).');
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= data.length && chunks.length < MAX_SEGMENTS) {
    const length = readU32BE(data, offset);
    const type = latin1(data, offset + 4, 4);
    if (length < 0 || offset + 12 + length > data.length) throw new ScriptError('metadata-bad-png', 'A PNG chunk length points outside the file.');
    chunks.push({ type, start: offset, dataStart: offset + 8, length, end: offset + 12 + length });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function inspectPng(data, out) {
  for (const chunk of pngChunks(data)) {
    const payload = data.subarray(chunk.dataStart, chunk.dataStart + chunk.length);
    if (chunk.type === 'eXIf') readExif(payload, out, 'PNG eXIf');
    else if (chunk.type === 'iCCP') {
      out.icc = { present: true, bytes: chunk.length, where: 'PNG iCCP' };
      out.findings.push({ kind: 'icc', label: 'Colour profile (ICC)', detail: `${chunk.length} bytes`, where: 'iCCP' });
    } else if (chunk.type === 'tEXt' || chunk.type === 'iTXt' || chunk.type === 'zTXt') {
      const text = printable(payload).slice(0, MAX_COMMENT_TEXT);
      if (looksLikeXmp(payload)) readXmp(payload, out, `PNG ${chunk.type} (XMP)`);
      else out.findings.push({ kind: 'text', label: `Text chunk (${chunk.type})`, detail: text || `${chunk.length} bytes`, where: chunk.type });
    } else if (chunk.type === 'tIME') {
      const when = chunk.length >= 7 ? `${readU16BE(data, chunk.dataStart)}-${pad(data[chunk.dataStart + 2])}-${pad(data[chunk.dataStart + 3])} ${pad(data[chunk.dataStart + 4])}:${pad(data[chunk.dataStart + 5])}:${pad(data[chunk.dataStart + 6])} UTC` : '';
      out.findings.push({ kind: 'time', label: 'Last-modified time', detail: when, where: 'tIME' });
    }
  }
}

function stripPng(data, { dropIcc }) {
  const chunks = pngChunks(data);
  const kept = [data.subarray(0, 8)];
  const removed = [];
  for (const chunk of chunks) {
    const drop =
      chunk.type === 'eXIf' ||
      chunk.type === 'tEXt' ||
      chunk.type === 'zTXt' ||
      chunk.type === 'iTXt' ||
      chunk.type === 'tIME' ||
      (chunk.type === 'iCCP' && dropIcc);
    if (drop) {
      if (chunk.type === 'eXIf') removed.push('EXIF');
      else if (chunk.type === 'tIME') removed.push('modification time');
      else if (chunk.type === 'iCCP') removed.push('ICC profile');
      else removed.push('text chunk');
      continue;
    }
    // sRGB/gAMA/cHRM/bKGD/pHYs and all image data are kept: they change how
    // the picture is rendered, not what is known about the photographer.
    kept.push(data.subarray(chunk.start, chunk.end));
  }
  return { bytes: metaConcat(kept), removed: dedupeList(removed), notes: [] };
}

// ── WebP ────────────────────────────────────────────────────────────────────

function riffChunks(data) {
  if (latin1(data, 0, 4) !== 'RIFF' || latin1(data, 8, 4) !== 'WEBP') {
    throw new ScriptError('metadata-bad-webp', 'Not a WebP (bad RIFF header).');
  }
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= data.length && chunks.length < MAX_SEGMENTS) {
    const fourcc = latin1(data, offset, 4);
    const size = readU32(data, offset + 4, true);
    if (size < 0 || offset + 8 + size > data.length) throw new ScriptError('metadata-bad-webp', 'A WebP chunk size points outside the file.');
    chunks.push({ fourcc, start: offset, dataStart: offset + 8, size, end: offset + 8 + size + (size % 2) });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

function inspectWebp(data, out) {
  for (const chunk of riffChunks(data)) {
    const payload = data.subarray(chunk.dataStart, chunk.dataStart + chunk.size);
    if (chunk.fourcc === 'EXIF') readExif(payload, out, 'WebP EXIF chunk');
    else if (chunk.fourcc === 'XMP ') readXmp(payload, out, 'WebP XMP chunk');
    else if (chunk.fourcc === 'ICCP') {
      out.icc = { present: true, bytes: chunk.size, where: 'WebP ICCP' };
      out.findings.push({ kind: 'icc', label: 'Colour profile (ICC)', detail: `${chunk.size} bytes`, where: 'ICCP' });
    }
  }
}

function stripWebp(data, { dropIcc }) {
  const chunks = riffChunks(data);
  const kept = [];
  const removed = [];
  for (const chunk of chunks) {
    const drop = chunk.fourcc === 'EXIF' || chunk.fourcc === 'XMP ' || (chunk.fourcc === 'ICCP' && dropIcc);
    if (drop) {
      removed.push(chunk.fourcc === 'EXIF' ? 'EXIF' : chunk.fourcc === 'XMP ' ? 'XMP' : 'ICC profile');
      continue;
    }
    kept.push(data.subarray(chunk.start, chunk.end));
  }
  const body = metaConcat(kept);
  const header = new Uint8Array(12);
  writeAscii(header, 0, 'RIFF');
  writeU32LE(header, 4, 4 + body.length);
  writeAscii(header, 8, 'WEBP');
  return { bytes: metaConcat([header, body]), removed: dedupeList(removed), notes: [] };
}

// ── GIF ─────────────────────────────────────────────────────────────────────

function gifBlocks(data) {
  if (latin1(data, 0, 3) !== 'GIF') throw new ScriptError('metadata-bad-gif', 'Not a GIF.');
  const blocks = [];
  let offset = 13;
  const flags = data[10] || 0;
  if (flags & 0x80) offset += 3 * (2 << (flags & 0x07)); // global colour table
  while (offset < data.length && blocks.length < MAX_SEGMENTS * 4) {
    const marker = data[offset];
    if (marker === 0x3b) {
      blocks.push({ kind: 'trailer', start: offset, end: offset + 1 });
      break;
    }
    if (marker === 0x21) {
      const label = data[offset + 1];
      let cursor = offset + 2;
      let payloadStart = cursor;
      let applicationId = '';
      while (cursor < data.length && data[cursor] !== 0) {
        if (label === 0xff && cursor === payloadStart) {
          applicationId = latin1(data, cursor + 1, Math.min(11, data[cursor]));
        }
        cursor += 1 + data[cursor];
      }
      cursor += 1;
      blocks.push({ kind: 'extension', label, applicationId, start: offset, end: cursor, payload: data.subarray(payloadStart, cursor - 1) });
      offset = cursor;
      continue;
    }
    if (marker === 0x2c) {
      let cursor = offset + 10;
      const flags = data[offset + 9] || 0;
      if (flags & 0x80) cursor += 3 * (2 << (flags & 0x07)); // local colour table
      while (cursor < data.length && data[cursor] !== 0) cursor += 1 + data[cursor];
      cursor += 1;
      blocks.push({ kind: 'image', start: offset, end: cursor });
      offset = cursor;
      continue;
    }
    throw new ScriptError('metadata-bad-gif', 'Unexpected byte where a GIF block should start.');
  }
  return blocks;
}

function inspectGif(data, out) {
  for (const block of gifBlocks(data)) {
    if (block.kind !== 'extension') continue;
    if (block.label === 0xfe) {
      out.findings.push({ kind: 'comment', label: 'Comment extension', detail: printable(block.payload || new Uint8Array(0)).slice(0, MAX_COMMENT_TEXT), where: 'GIF 0x21FE' });
    } else if (block.label === 0x01) {
      out.findings.push({ kind: 'text', label: 'Plain-text extension', detail: printable(block.payload || new Uint8Array(0)).slice(0, MAX_COMMENT_TEXT), where: 'GIF 0x2101' });
    } else if (block.label === 0xff) {
      const id = block.applicationId || '';
      if (/^XMP DataXMP/i.test(id)) readXmp(block.payload || new Uint8Array(0), out, 'GIF XMP application extension');
      else out.findings.push({ kind: 'app', label: 'Application extension', detail: id || `${(block.payload || []).length} bytes`, where: 'GIF 0x21FF' });
    }
  }
}

function stripGif(data) {
  const blocks = gifBlocks(data);
  const kept = [data.subarray(0, blocks.length ? blocks[0].start : data.length)];
  const removed = [];
  for (const block of blocks) {
    if (block.kind === 'extension') {
      const id = block.applicationId || '';
      if (block.label === 0xfe) {
        removed.push('comment');
        continue;
      }
      if (block.label === 0x01) {
        removed.push('plain text');
        continue;
      }
      if (block.label === 0xff && /^XMP DataXMP/i.test(id)) {
        removed.push('XMP');
        continue;
      }
    }
    kept.push(data.subarray(block.start, block.end));
  }
  return { bytes: metaConcat(kept), removed: dedupeList(removed), notes: [] };
}

// ── EXIF / XMP readers ──────────────────────────────────────────────────────

function readExif(payload, out, where) {
  out.exif.present = true;
  out.findings.push({ kind: 'exif', label: 'EXIF block', detail: `${payload.length} bytes`, where });
  let text = payload;
  if (startsWith(text, 'Exif\0\0')) text = text.subarray(6);
  const parsed = parseTiff(text);
  if (!parsed) {
    out.warnings.push('An EXIF block was present but its structure could not be read; it is still removed when stripping.');
    return;
  }
  const fields = {};
  const orientation = parsed.ifd0[EXIF_TAGS.orientation];
  if (orientation) {
    out.exif.orientation = Number(orientation) || 0;
    fields.orientation = `${out.exif.orientation} (${ORIENTATION_LABELS[out.exif.orientation] || 'unknown'})`;
  }
  for (const [key, tag] of Object.entries(EXIF_TAGS)) {
    if (['gpsIfd', 'exifIfd', 'orientation'].includes(key)) continue;
    const value = parsed.ifd0[tag];
    if (typeof value === 'string' && value.trim()) fields[key] = value.trim().slice(0, 80);
  }
  for (const [key, tag] of Object.entries(EXIF_IFD_TAGS)) {
    const value = parsed.exif[tag];
    if (value === undefined) continue;
    fields[key] = typeof value === 'string' ? value.trim().slice(0, 80) : String(value);
  }
  if (parsed.gps) {
    out.gps.present = true;
    const lat = dmsToDecimal(parsed.gps[GPS_TAGS.latitude], parsed.gps[GPS_TAGS.latitudeRef]);
    const lon = dmsToDecimal(parsed.gps[GPS_TAGS.longitude], parsed.gps[GPS_TAGS.longitudeRef]);
    out.gps.lat = lat;
    out.gps.lon = lon;
    fields.gps = lat === null && lon === null ? 'present (coordinates not readable)' : `${lat === null ? '?' : lat.toFixed(2)}, ${lon === null ? '?' : lon.toFixed(2)}`;
  }
  out.exif.fields = fields;
  for (const [key, value] of Object.entries(fields)) {
    out.findings.push({ kind: 'exif-field', label: exifFieldLabel(key), detail: String(value), where: 'EXIF' });
  }
  if (out.gps.present) {
    out.findings.push({
      kind: 'gps',
      label: 'Location (GPS)',
      detail: fields.gps || 'present',
      where: 'EXIF GPS IFD',
      sensitive: true,
    });
  }
}

function exifFieldLabel(key) {
  const labels = {
    make: 'Camera make',
    model: 'Camera model',
    software: 'Software',
    dateTime: 'Modified date',
    dateTimeOriginal: 'Original date',
    dateTimeDigitized: 'Digitized date',
    artist: 'Artist',
    copyright: 'Copyright',
    iso: 'ISO',
    focalLength35: 'Focal length (35 mm equiv.)',
    lensModel: 'Lens',
    orientation: 'Orientation',
    gps: 'GPS coordinates',
  };
  return labels[key] || key;
}

function parseTiff(data) {
  if (data.length < 8) return null;
  const byteOrder = latin1(data, 0, 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const little = byteOrder === 'II';
  const magic = readU16(data, 2, little);
  if (magic !== 42) return null;
  const ifd0Offset = readU32(data, 4, little);
  const ifd0 = readIfd(data, ifd0Offset, little);
  if (!ifd0) return null;
  const result = { ifd0, exif: {}, gps: null };
  const exifPointer = ifd0[EXIF_TAGS.exifIfd];
  if (typeof exifPointer === 'number') result.exif = readIfd(data, exifPointer, little) || {};
  const gpsPointer = ifd0[EXIF_TAGS.gpsIfd];
  if (typeof gpsPointer === 'number') result.gps = readIfd(data, gpsPointer, little) || null;
  return result;
}

function readIfd(data, offset, little) {
  if (offset < 8 || offset + 2 > data.length) return null;
  const count = readU16(data, offset, little);
  if (!count || count > MAX_IFD_ENTRIES) return null;
  const entries = {};
  for (let index = 0; index < count; index += 1) {
    const start = offset + 2 + index * 12;
    if (start + 12 > data.length) break;
    const tag = readU16(data, start, little);
    const type = readU16(data, start + 2, little);
    const valueCount = readU32(data, start + 4, little);
    const size = typeSize(type) * valueCount;
    if (!Number.isFinite(size) || size < 0 || valueCount > 4096) continue;
    const valueOffset = size <= 4 ? start + 8 : readU32(data, start + 8, little);
    if (valueOffset + size > data.length) continue;
    entries[tag] = decodeTagValue(data, valueOffset, type, valueCount, little);
  }
  return entries;
}

function decodeTagValue(data, offset, type, count, little) {
  if (type === 2) return printable(data.subarray(offset, offset + count)).replace(/\0+$/, '').trim();
  if (type === 3) return count === 1 ? readU16(data, offset, little) : arrayFrom(data, offset, count, 2, little);
  if (type === 4) return count === 1 ? readU32(data, offset, little) : arrayFrom(data, offset, count, 4, little);
  if (type === 5 || type === 10) {
    const rationals = [];
    for (let index = 0; index < Math.min(count, 4); index += 1) {
      const at = offset + index * 8;
      const numerator = readU32(data, at, little);
      const denominator = readU32(data, at + 4, little);
      rationals.push(denominator ? numerator / denominator : null);
    }
    return count === 1 ? rationals[0] : rationals;
  }
  if (type === 1 || type === 7) return count === 1 ? data[offset] : null;
  return null;
}

function arrayFrom(data, offset, count, width, little) {
  const values = [];
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    values.push(width === 2 ? readU16(data, offset + index * 2, little) : readU32(data, offset + index * 4, little));
  }
  return values;
}

function typeSize(type) {
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  return sizes[type] === undefined ? 0 : sizes[type];
}

function dmsToDecimal(value, ref) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [degrees, minutes, seconds] = value;
  if (![degrees, minutes, seconds].every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  const direction = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (direction === 'S' || direction === 'W') decimal = -decimal;
  return decimal;
}

function readXmp(payload, out, where) {
  const text = printable(payload);
  out.xmp.present = true;
  out.xmp.bytes = payload.length;
  out.xmp.where = where;
  out.findings.push({ kind: 'xmp', label: 'XMP block', detail: `${payload.length} bytes`, where });

  // Opaque-text scanning only: no XML parsing, no entity handling.
  const fields = {};
  const grab = (pattern, key, transform) => {
    const match = pattern.exec(text);
    if (match && match[1]) fields[key] = transform ? transform(match[1]) : match[1].slice(0, 80);
  };
  grab(/<(?:xmp|photoshop|xmpMM):CreatorTool>([^<]{1,120})</, 'creatorTool');
  grab(/(?:xmp|photoshop|exif):CreateDate="([^"]{1,40})"/, 'createDate');
  grab(/(?:xmp|photoshop|exif):ModifyDate="([^"]{1,40})"/, 'modifyDate');
  grab(/<dc:creator>\s*<rdf:Seq>\s*<rdf:li>([^<]{1,80})</, 'author');
  grab(/<dc:description>[\s\S]{0,200}?<rdf:li[^>]*>([^<]{1,200})</, 'description');
  if (/exif:GPS|gps:latitude|GPSLatitude/i.test(text)) {
    out.gps.present = true;
    out.findings.push({ kind: 'gps', label: 'Location (GPS in XMP)', detail: 'coordinates present', where: 'XMP', sensitive: true });
    fields.gps = 'present';
  }
  out.xmp.fields = fields;
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'gps') continue;
    out.findings.push({ kind: 'xmp-field', label: xmpFieldLabel(key), detail: String(value), where: 'XMP' });
  }
}

function xmpFieldLabel(key) {
  const labels = {
    creatorTool: 'Editing software',
    createDate: 'Created',
    modifyDate: 'Modified',
    author: 'Author',
    description: 'Description',
  };
  return labels[key] || key;
}

// ── shared helpers ──────────────────────────────────────────────────────────

function summarise(out) {
  const removes = [];
  for (const finding of out.findings) {
    if (finding.kind === 'exif' || finding.kind === 'exif-field') pushOnce(removes, 'EXIF');
    else if (finding.kind === 'xmp' || finding.kind === 'xmp-field') pushOnce(removes, 'XMP');
    else if (finding.kind === 'icc') pushOnce(removes, 'ICC profile (optional)');
    else if (finding.kind === 'iptc') pushOnce(removes, 'IPTC');
    else if (finding.kind === 'comment' || finding.kind === 'text') pushOnce(removes, 'text/comments');
    else if (finding.kind === 'time') pushOnce(removes, 'modification time');
  }
  out.removes = removes;
  if (out.gps.present) {
    out.warnings.push(
      'This file contains GPS coordinates. Anyone who receives it could work out where the photo was taken — strip metadata before sharing.',
    );
  }
  if (out.exif.orientation && out.exif.orientation !== 1) {
    out.warnings.push(
      `EXIF orientation ${out.exif.orientation} (${ORIENTATION_LABELS[out.exif.orientation] || 'rotated'}) is stored as metadata, not in the pixels. Stripping metadata will not rotate the image.`,
    );
  }
  // A JFIF/structural marker is not metadata anybody cares about, so "nothing
  // was found" is decided on the findings that actually carry information.
  if (!out.findings.some((finding) => finding.kind !== 'jfif')) {
    out.warnings.push('No EXIF, XMP, ICC or comment data was found in this file.');
  }
}

export function detectContainerMime(bytes) {
  const data = metaToBytes(bytes);
  if (!data || data.length < 12) return '';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (startsWith(data, Uint8Array.from(PNG_SIGNATURE))) return 'image/png';
  if (latin1(data, 0, 4) === 'RIFF' && latin1(data, 8, 4) === 'WEBP') return 'image/webp';
  if (latin1(data, 0, 3) === 'GIF') return 'image/gif';
  if (latin1(data, 0, 2) === 'BM') return 'image/bmp';
  if (latin1(data, 4, 8) === 'ftypavif' || latin1(data, 4, 8) === 'ftypavis' || latin1(data, 4, 8) === 'ftypmif1') return 'image/avif';
  if (latin1(data, 0, 4) === '%PDF') return 'application/pdf';
  return '';
}

function containerOf(mime) {
  const names = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'image/avif': 'AVIF',
    'image/bmp': 'BMP',
    'application/pdf': 'PDF',
  };
  return names[mime] || 'Unknown';
}

function metaToBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function metaConcat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Does `data` begin with `prefix`?
 *
 * `prefix` may be a byte array or a latin1 string: every marker this module
 * looks for ('Exif\0\0', 'ICC_PROFILE', 'Photoshop 3.0', …) is written as a
 * string at the call site. Comparing a byte against a one-character string is
 * always false, so the string is converted first — a comparison that silently
 * never matches would mean EXIF is neither reported nor removed.
 */
function startsWith(data, prefix) {
  if (!data || !prefix || !prefix.length) return false;
  const expected = typeof prefix === 'string' ? latin1Bytes(prefix) : prefix;
  if (data.length < expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (data[index] !== expected[index]) return false;
  }
  return true;
}

function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function latin1(data, offset, length) {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    const byte = data[offset + index];
    if (byte === undefined) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

function writeAscii(target, offset, text) {
  for (let index = 0; index < text.length; index += 1) target[offset + index] = text.charCodeAt(index) & 0xff;
}

/**
 * Is this segment an XMP packet?
 *
 * Matched on the packet markers rather than on the Adobe namespace URI, which
 * keeps a resolvable-looking http:// constant out of the artifact. Control bytes
 * are dropped by `printable`, so UTF-16-encoded packets match too.
 */
export function looksLikeXmp(bytes) {
  const text = printable(bytes && bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes || new Uint8Array(0));
  return text.includes('<?xpacket') || text.includes('<x:xmpmeta') || text.includes('XML:com.adobe.xmp') || text.includes('adobe:ns:meta/');
}

function printable(data) {
  let out = '';
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];
    if (byte === 9 || byte === 10 || byte === 13) out += ' ';
    else if (byte >= 32 && byte < 127) out += String.fromCharCode(byte);
    else if (byte >= 128) out += '?';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function readU16(data, offset, little) {
  if (offset + 2 > data.length) return 0;
  return little ? data[offset] | (data[offset + 1] << 8) : (data[offset] << 8) | data[offset + 1];
}

function readU32(data, offset, little) {
  if (offset + 4 > data.length) return 0;
  return little
    ? (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
    : ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readU32BE(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readU16BE(data, offset) {
  return (data[offset] << 8) | data[offset + 1];
}

function writeU32LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dedupeList(list) {
  const out = [];
  for (const item of list) pushOnce(out, item);
  return out;
}

function pushOnce(list, item) {
  if (!list.includes(item)) list.push(item);
}
