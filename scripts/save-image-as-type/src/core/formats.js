/**
 * Format registry.
 *
 * `engine` decides how the output bytes are produced:
 *   - "native"      : canvas.toBlob(), verified by checking the returned
 *                     blob.type. Verified on Chrome 131 that PNG/JPEG/WebP
 *                     encode natively while AVIF/GIF/BMP silently fall back to
 *                     PNG — which is exactly why this check exists and why the
 *                     remaining engines are hand-written encoders.
 *   - "bmp"         : src/encoders/bmp.js  (BITMAPV5 / 24-bit V3 writer)
 *   - "gif"         : src/encoders/gif.js  (GIF89a + median-cut + LZW)
 *   - "pdf"         : src/encoders/pdf.js  (single-page PDF, DCTDecode JPEG)
 *   - "passthrough" : the original file bytes, unchanged (keeps animation and
 *                     the source's own quality; only possible when we actually
 *                     hold the bytes).
 */

export const FORMATS = [
  {
    id: 'png',
    label: 'PNG',
    ext: 'png',
    mime: 'image/png',
    engine: 'native',
    quality: false,
    transparency: true,
    hint: 'Lossless · keeps transparency',
    enabledByDefault: true,
  },
  {
    id: 'jpg',
    label: 'JPG',
    ext: 'jpg',
    mime: 'image/jpeg',
    engine: 'native',
    quality: true,
    transparency: false,
    hint: 'Small photos · transparency is flattened',
    enabledByDefault: true,
  },
  {
    id: 'webp',
    label: 'WebP',
    ext: 'webp',
    mime: 'image/webp',
    engine: 'native',
    quality: true,
    transparency: true,
    hint: 'Modern · small files, keeps transparency',
    enabledByDefault: true,
  },
  {
    id: 'gif',
    label: 'GIF',
    ext: 'gif',
    mime: 'image/gif',
    engine: 'gif',
    quality: false,
    transparency: 'indexed',
    hint: '256 colours · animation when the browser can read the frames',
    enabledByDefault: true,
  },
  {
    id: 'bmp',
    label: 'BMP',
    ext: 'bmp',
    mime: 'image/bmp',
    engine: 'bmp',
    quality: false,
    transparency: true,
    hint: 'Uncompressed · 32-bit with alpha when needed',
    enabledByDefault: true,
  },
  {
    id: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    mime: 'application/pdf',
    engine: 'pdf',
    quality: true,
    transparency: false,
    hint: 'One page, JPEG-compressed, ready to print or attach',
    enabledByDefault: true,
  },
  {
    id: 'avif',
    label: 'AVIF',
    ext: 'avif',
    mime: 'image/avif',
    engine: 'native',
    quality: true,
    transparency: true,
    hint: 'Only offered where your browser can really encode AVIF',
    enabledByDefault: false,
    /** Hidden entirely unless the runtime probe proves the encoder exists. */
    requiresEncodeProbe: 'image/avif',
  },
  {
    id: 'original',
    label: 'Original file',
    ext: '',
    mime: '',
    engine: 'passthrough',
    quality: false,
    transparency: true,
    hint: 'Re-save the source file untouched (animation and quality preserved)',
    enabledByDefault: true,
    alwaysLast: true,
  },
];

export const FORMAT_IDS = FORMATS.map((f) => f.id);

export function getFormat(id) {
  return FORMATS.find((f) => f.id === id) || null;
}

export function defaultEnabledFormats() {
  return FORMATS.filter((f) => f.enabledByDefault).map((f) => f.id);
}

/** Extension to use for a given format + source (only `original` depends on the source). */
export function extensionForFormat(format, sourceMime, sourceUrl) {
  if (format.id !== 'original') return format.ext;
  const fromMime = MIME_TO_EXT[sourceMime] || '';
  if (fromMime) return fromMime;
  const fromUrl = extFromUrl(sourceUrl);
  return fromUrl || 'img';
}

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/apng': 'apng',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

export function extFromUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  let clean = url;
  try {
    // `https://siat.invalid/` is an RFC 2606 reserved host used only as a base
    // so `new URL()` can resolve a relative path; it is never requested.
    clean = new URL(url, 'https://siat.invalid/').pathname;
  } catch {
    /* keep the raw string */
  }
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(clean);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  return MIME_TO_EXT[`image/${ext}`] || ext;
}

export function mimeFromExt(ext) {
  const lower = String(ext || '').toLowerCase();
  for (const [mime, value] of Object.entries(MIME_TO_EXT)) {
    if (value === lower) return mime;
  }
  return '';
}
