/**
 * BMP encoder (written from the Microsoft bitmap specification).
 *
 * Why hand-written: `canvas.toBlob(blob, 'image/bmp')` does not exist — Chrome
 * returns a PNG instead (verified: blob.type === "image/png", bytes identical to
 * the PNG encode). The browser extension this is ported from writes its own BMP
 * too, for the same reason.
 *
 * Two variants are produced:
 *   - 32-bit BITMAPV5HEADER with an explicit alpha mask and LCS_sRGB colour
 *     space, when the image actually contains transparency. V5 is the header
 *     that lets a BMP carry meaningful alpha (V3 32-bit alpha is ignored by
 *     several viewers).
 *   - 24-bit BITMAPINFOHEADER (V3, BI_RGB) otherwise, because it is the most
 *     universally readable BMP there is and it is 25% smaller than 32-bit.
 *
 * Rows are bottom-up and padded to a 4-byte boundary, as the format requires.
 */

const V5_HEADER_SIZE = 124;
const V3_HEADER_SIZE = 40;
const FILE_HEADER_SIZE = 14;
const BI_RGB = 0;
const BI_BITFIELDS = 3;
const LCS_SRGB = 0x73524742; // 'sRGB'
const LCS_GM_IMAGES = 4;
const PIXELS_PER_METER_72DPI = 2835;

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData RGBA pixels
 * @param {{alpha?: 'auto'|'always'|'never', hasAlpha?: boolean}} [options]
 * @returns {Uint8Array} the complete .bmp file
 */
export function encodeBmp(imageData, options = {}) {
  const width = imageData.width | 0;
  const height = imageData.height | 0;
  if (width <= 0 || height <= 0) throw new Error('encodeBmp: invalid dimensions');
  const pixels = imageData.data;
  if (!pixels || pixels.length < width * height * 4) throw new Error('encodeBmp: pixel buffer too small');

  const alphaMode = options.alpha || 'auto';
  const hasAlpha = alphaMode === 'always' ? true : alphaMode === 'never' ? false : options.hasAlpha !== undefined ? options.hasAlpha : scanForAlpha(pixels);

  return hasAlpha ? encodeBmp32(imageData, width, height) : encodeBmp24(imageData, width, height);
}

function scanForAlpha(pixels) {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) return true;
  }
  return false;
}

function encodeBmp32(imageData, width, height) {
  const rowBytes = width * 4; // 32bpp rows are already 4-byte aligned
  const imageSize = rowBytes * height;
  const pixelOffset = FILE_HEADER_SIZE + V5_HEADER_SIZE;
  const fileSize = pixelOffset + imageSize;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  // BITMAPFILEHEADER
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true); // reserved
  view.setUint16(8, 0, true); // reserved
  view.setUint32(10, pixelOffset, true);

  // BITMAPV5HEADER
  let o = FILE_HEADER_SIZE;
  view.setUint32(o, V5_HEADER_SIZE, true); o += 4;
  view.setInt32(o, width, true); o += 4;
  view.setInt32(o, height, true); o += 4; // positive => bottom-up
  view.setUint16(o, 1, true); o += 2; // planes
  view.setUint16(o, 32, true); o += 2; // bit count
  view.setUint32(o, BI_BITFIELDS, true); o += 4;
  view.setUint32(o, imageSize, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setUint32(o, 0, true); o += 4; // clrUsed
  view.setUint32(o, 0, true); o += 4; // clrImportant
  view.setUint32(o, 0x00ff0000, true); o += 4; // red mask
  view.setUint32(o, 0x0000ff00, true); o += 4; // green mask
  view.setUint32(o, 0x000000ff, true); o += 4; // blue mask
  view.setUint32(o, 0xff000000, true); o += 4; // alpha mask
  view.setUint32(o, LCS_SRGB, true); o += 4;
  o += 36; // CIEXYZTRIPLE endpoints: unused for LCS_sRGB, must be zero
  view.setUint32(o, 0, true); o += 4; // gammaRed
  view.setUint32(o, 0, true); o += 4; // gammaGreen
  view.setUint32(o, 0, true); o += 4; // gammaBlue
  view.setUint32(o, LCS_GM_IMAGES, true); o += 4; // intent
  view.setUint32(o, 0, true); o += 4; // profileData
  view.setUint32(o, 0, true); o += 4; // profileSize
  view.setUint32(o, 0, true); o += 4; // reserved

  // Pixel data, bottom-up, BGRA order
  const src = imageData.data;
  let p = pixelOffset;
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * 4;
      out[p] = src[i + 2]; // B
      out[p + 1] = src[i + 1]; // G
      out[p + 2] = src[i]; // R
      out[p + 3] = src[i + 3]; // A
      p += 4;
    }
  }
  return out;
}

function encodeBmp24(imageData, width, height) {
  const rowStride = (width * 3 + 3) & ~3; // pad each row to 4 bytes
  const imageSize = rowStride * height;
  const pixelOffset = FILE_HEADER_SIZE + V3_HEADER_SIZE;
  const fileSize = pixelOffset + imageSize;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, pixelOffset, true);

  let o = FILE_HEADER_SIZE;
  view.setUint32(o, V3_HEADER_SIZE, true); o += 4;
  view.setInt32(o, width, true); o += 4;
  view.setInt32(o, height, true); o += 4;
  view.setUint16(o, 1, true); o += 2;
  view.setUint16(o, 24, true); o += 2;
  view.setUint32(o, BI_RGB, true); o += 4;
  view.setUint32(o, imageSize, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setInt32(o, PIXELS_PER_METER_72DPI, true); o += 4;
  view.setUint32(o, 0, true); o += 4;
  view.setUint32(o, 0, true); o += 4;

  const src = imageData.data;
  let p = pixelOffset;
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowStart = y * width * 4;
    const rowEnd = p + rowStride;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * 4;
      // 24-bit BMP has no alpha: composite over white so partially transparent
      // pixels do not come out black. Callers that care flatten first.
      const a = src[i + 3] / 255;
      out[p] = Math.round(src[i + 2] * a + 255 * (1 - a)); // B
      out[p + 1] = Math.round(src[i + 1] * a + 255 * (1 - a)); // G
      out[p + 2] = Math.round(src[i] * a + 255 * (1 - a)); // R
      p += 3;
    }
    while (p < rowEnd) out[p++] = 0; // row padding
  }
  return out;
}

/** Exposed for tests: the exact header field offsets a reader must agree on. */
export const BMP_LAYOUT = Object.freeze({
  FILE_HEADER_SIZE,
  V3_HEADER_SIZE,
  V5_HEADER_SIZE,
  offset24: FILE_HEADER_SIZE + V3_HEADER_SIZE,
  offset32: FILE_HEADER_SIZE + V5_HEADER_SIZE,
});
