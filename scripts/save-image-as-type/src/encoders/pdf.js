/**
 * Minimal single-page PDF writer.
 *
 * "Save as PDF" is the one requested output that no browser API can produce, so
 * the file is assembled here directly. The image is embedded as a JPEG with the
 * DCTDecode filter, which means:
 *
 *   - no deflate/zlib implementation is needed (JPEG streams are stored as-is),
 *   - the PDF stays small (it is the same bytes the browser's own JPEG encoder
 *     produced),
 *   - every PDF reader in existence can open it (DCTDecode is PDF 1.2+).
 *
 * Transparency is flattened before encoding, because JPEG has no alpha channel.
 * The cross-reference table is written with exact byte offsets, which is the
 * part hand-rolled PDF writers usually get wrong; test/unit/pdf.test.mjs parses
 * the produced bytes back and asserts every offset, and pypdf (independent
 * implementation) opens the result.
 */

const PAGE_SIZES = {
  a4: [595.276, 841.89],
  letter: [612, 792],
};
const DEFAULT_MARGIN = 24; // points

/**
 * @param {object} input
 * @param {Uint8Array} input.jpegBytes   complete JPEG file (must start FFD8, end FFD9)
 * @param {number} input.width           image width in pixels
 * @param {number} input.height          image height in pixels
 * @param {'a4'|'letter'|'pixel'} [input.pageFit='a4']
 * @param {number} [input.margin]
 * @param {string} [input.title]
 * @param {() => Date} [input.now] Verification clock; default retains current-time behaviour.
 * @returns {Uint8Array} a complete PDF file
 */
export function encodePdf({ jpegBytes, width, height, pageFit = 'a4', margin = DEFAULT_MARGIN, title = '', now = () => new Date() }) {
  if (!jpegBytes || jpegBytes.length < 4) throw new Error('encodePdf: no JPEG data supplied');
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) throw new Error('encodePdf: data is not a JPEG (missing SOI marker)');
  const tail = jpegBytes.subarray(Math.max(0, jpegBytes.length - 2));
  if (tail[0] !== 0xff || tail[1] !== 0xd9) throw new Error('encodePdf: data is not a complete JPEG (missing EOI marker)');
  if (!(width > 0) || !(height > 0)) throw new Error('encodePdf: invalid image dimensions');

  const layout = pdfLayout({ width, height, pageFit, margin });
  const content = `q\n${num(layout.drawWidth)} 0 0 ${num(layout.drawHeight)} ${num(layout.x)} ${num(layout.y)} cm\n/Im0 Do\nQ\n`;
  const contentBytes = asciiBytes(content);
  const infoDate = pdfDate(now());

  const objects = [];
  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = asciiBytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects[3] = asciiBytes(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(layout.pageWidth)} ${num(layout.pageHeight)}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>',
  );
  objects[4] = [
    asciiBytes(
      `<< /Type /XObject /Subtype /Image /Width ${width | 0} /Height ${height | 0} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    ),
    jpegBytes,
    asciiBytes('\nendstream'),
  ];
  objects[5] = [asciiBytes(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, asciiBytes('\nendstream')];
  objects[6] = asciiBytes(
    `<< /Producer (Save Image as Type userscript) /Creator (Save Image as Type userscript)` +
      `${title ? ` /Title (${escapePdfString(title)})` : ''} /CreationDate (${infoDate}) >>`,
  );

  const chunks = [];
  const offsets = new Array(objects.length).fill(0);
  let position = 0;
  const push = (bytes) => {
    chunks.push(bytes);
    position += bytes.length;
  };

  push(asciiBytes('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = position;
    push(asciiBytes(`${i} 0 obj\n`));
    const body = objects[i];
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push(asciiBytes('\nendobj\n'));
  }

  const xrefPosition = position;
  const entries = [`0000000000 65535 f \n`];
  for (let i = 1; i < objects.length; i += 1) {
    entries.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  push(asciiBytes(`xref\n0 ${objects.length}\n${entries.join('')}`));
  push(asciiBytes(`trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`));

  return joinChunks(chunks);
}

/** Page + placement geometry, exported so tests can assert it independently. */
export function pdfLayout({ width, height, pageFit = 'a4', margin = DEFAULT_MARGIN }) {
  if (pageFit === 'pixel') {
    const pageWidth = width * 0.75;
    const pageHeight = height * 0.75;
    return { pageWidth, pageHeight, drawWidth: pageWidth, drawHeight: pageHeight, x: 0, y: 0, scale: 0.75 };
  }
  const [pageWidth, pageHeight] = PAGE_SIZES[pageFit] || PAGE_SIZES.a4;
  const usableWidth = Math.max(1, pageWidth - margin * 2);
  const usableHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(usableWidth / width, usableHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    drawWidth,
    drawHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    scale,
  };
}

function num(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return String(rounded);
}

function asciiBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** PDF literal strings are limited to Latin-1; anything else is escaped or dropped. */
export function escapePdfString(text) {
  return String(text)
    .replace(/[\\()]/g, (m) => `\\${m}`)
    .replace(/[^\x20-\x7e]/g, (ch) => {
      const code = ch.codePointAt(0);
      return code < 256 ? `\\${code.toString(8).padStart(3, '0')}` : '';
    })
    .slice(0, 200);
}

function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function joinChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
