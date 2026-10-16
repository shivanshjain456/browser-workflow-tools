/**
 * GIF89a encoder (written from the GIF89a specification).
 *
 * Why hand-written: `canvas.toBlob(blob, 'image/gif')` returns a PNG in Chrome
 * (verified on Chrome 131 — same bytes as the PNG encode), so there is no
 * native path. Bundling a third-party encoder via @require was rejected on
 * supply-chain grounds: an unpinned remote script would run with this script's
 * permissions on every page. This file is ~350 lines, has no dependencies, and
 * is verified byte-for-byte by decoding its output with Pillow in the test
 * suite.
 *
 * What it does:
 *   - median-cut colour quantisation to ≤256 colours, shared as one global
 *     palette across all frames (a single palette keeps animated output small
 *     and avoids per-frame palette flicker),
 *   - one reserved palette entry for binary transparency (GIF has no partial
 *     alpha; pixels below the alpha threshold become fully transparent),
 *   - spec-correct LZW with variable code size, clear-code resets at 12 bits
 *     and ≤255-byte sub-blocks,
 *   - Netscape 2.0 loop extension and per-frame Graphic Control Extensions with
 *     delays clamped to the 2..65535 centisecond range browsers honour.
 *
 * Known limitations (documented in the README, not hidden):
 *   - no dithering (photos show contouring),
 *   - one global palette rather than per-frame local palettes,
 *   - full frames rather than inter-frame diffing (larger files).
 */

const ALPHA_THRESHOLD = 128;
const MAX_COLORS = 256;
const REDUCED_BITS = 5; // 5 bits/channel => at most 32768 distinct histogram entries
const REDUCED_SIZE = 1 << (REDUCED_BITS * 3);

/**
 * @param {Array<{imageData:{width:number,height:number,data:Uint8ClampedArray}, delayMs:number}>} frames
 * @param {{loop?:number, maxColors?:number, alphaThreshold?:number}} [options]
 * @returns {Uint8Array}
 */
export function encodeGif(frames, options = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('encodeGif: no frames');
  const width = frames[0].imageData.width | 0;
  const height = frames[0].imageData.height | 0;
  if (width <= 0 || height <= 0) throw new Error('encodeGif: invalid dimensions');
  for (const frame of frames) {
    if (frame.imageData.width !== width || frame.imageData.height !== height) {
      throw new Error('encodeGif: all frames must share dimensions');
    }
  }

  const maxColors = Math.min(MAX_COLORS, Math.max(2, options.maxColors || MAX_COLORS));
  const alphaThreshold = options.alphaThreshold === undefined ? ALPHA_THRESHOLD : options.alphaThreshold;

  // 1. Histogram over reduced-precision colours, across every frame.
  const counts = new Int32Array(REDUCED_SIZE);
  let transparentSeen = false;
  for (const frame of frames) {
    const data = frame.imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < alphaThreshold) {
        transparentSeen = true;
        continue;
      }
      const key = reduceKey(data[i], data[i + 1], data[i + 2]);
      counts[key] += 1;
    }
  }

  const present = [];
  for (let key = 0; key < REDUCED_SIZE; key += 1) if (counts[key] > 0) present.push(key);
  if (!present.length && !transparentSeen) throw new Error('encodeGif: frame has no pixels');
  if (!present.length) present.push(reduceKey(255, 255, 255)); // fully transparent image

  // 2. Median cut.
  const budget = transparentSeen ? maxColors - 1 : maxColors;
  const boxes = medianCut(present, counts, Math.max(1, budget));
  const palette = boxes.map((box) => boxAverage(box, counts));

  // 3. Reserve the transparency index, then pad to a power of two.
  let transparentIndex = -1;
  if (transparentSeen) {
    transparentIndex = palette.length;
    palette.push([0, 0, 0]);
  }
  const tableBits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const tableSize = 1 << tableBits;
  while (palette.length < tableSize) palette.push([0, 0, 0]);

  // 4. Reduced-colour -> palette-index lookup table.
  const lut = new Uint16Array(REDUCED_SIZE);
  for (let key = 0; key < REDUCED_SIZE; key += 1) lut[key] = nearestPaletteIndex(key, palette);

  // 5. Assemble the file.
  const parts = [];
  parts.push(str('GIF89a'));
  parts.push(u16(width), u16(height));
  // packed: global colour table flag | colour resolution | sort | table size bits
  parts.push(u8(0x80 | ((tableBits - 1) << 4) | (tableBits - 1)));
  parts.push(u8(0)); // background colour index
  parts.push(u8(0)); // pixel aspect ratio
  const tableBytes = new Uint8Array(tableSize * 3);
  for (let i = 0; i < tableSize; i += 1) {
    tableBytes[i * 3] = palette[i][0];
    tableBytes[i * 3 + 1] = palette[i][1];
    tableBytes[i * 3 + 2] = palette[i][2];
  }
  parts.push(tableBytes);

  // Netscape 2.0 looping extension (0 = loop forever)
  const loop = options.loop === undefined ? 0 : options.loop;
  parts.push(u8(0x21), u8(0xff), u8(0x0b), str('NETSCAPE2.0'), u8(0x03), u8(0x01), u16(loop & 0xffff), u8(0x00));

  const minCodeSize = Math.max(2, tableBits);
  for (const frame of frames) {
    const indices = mapFrameToIndices(frame.imageData, lut, alphaThreshold, transparentIndex);
    // Graphic Control Extension: disposal method 1 (do not dispose) because we
    // always write complete frames.
    const gcePacked = (1 << 2) | (transparentIndex >= 0 ? 1 : 0);
    const delayCs = clampDelay(frame.delayMs);
    parts.push(u8(0x21), u8(0xf9), u8(0x04), u8(gcePacked), u16(delayCs), u8(transparentIndex >= 0 ? transparentIndex : 0), u8(0x00));
    // Image Descriptor
    parts.push(u8(0x2c), u16(0), u16(0), u16(width), u16(height), u8(0x00));
    parts.push(u8(minCodeSize));
    parts.push(lzwEncode(indices, minCodeSize));
    parts.push(u8(0x00)); // block terminator
  }
  parts.push(u8(0x3b)); // trailer

  return concat(parts);
}

function clampDelay(delayMs) {
  const value = Number(delayMs);
  if (!Number.isFinite(value) || value <= 0) return 10; // 100ms, a sane default
  // Browsers historically clamp delays below 2cs to 10cs, so never go lower.
  return Math.min(65535, Math.max(2, Math.round(value / 10)));
}

function reduceKey(r, g, b) {
  return ((r >> (8 - REDUCED_BITS)) << (REDUCED_BITS * 2)) | ((g >> (8 - REDUCED_BITS)) << REDUCED_BITS) | (b >> (8 - REDUCED_BITS));
}

/**
 * Expand a REDUCED_BITS channel back to 8 bits by replicating the high bits into
 * the low ones — (v << 3) | (v >> 2) for 5 bits — so that 0 maps to 0 and the
 * maximum maps to 255 instead of 248. A plain left shift would darken every
 * saturated colour, which is exactly what the reference-delta test caught.
 */
function expandChannel(value) {
  const shift = 8 - REDUCED_BITS;
  return (value << shift) | (value >> Math.max(0, REDUCED_BITS - shift));
}

function keyChannels(key) {
  const mask = (1 << REDUCED_BITS) - 1;
  return [(key >> (REDUCED_BITS * 2)) & mask, (key >> REDUCED_BITS) & mask, key & mask];
}

/** Classic median cut: repeatedly split the box with the widest channel range at its population median. */
export function medianCut(keys, counts, targetBoxes) {
  let boxes = [keys.slice()];
  while (boxes.length < targetBoxes) {
    let bestIndex = -1;
    let bestRange = 0;
    let bestAxis = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.length < 2) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        const range = axisRange(box, axis);
        if (range > bestRange) {
          bestRange = range;
          bestIndex = i;
          bestAxis = axis;
        }
      }
    }
    if (bestIndex < 0 || bestRange === 0) break;
    const box = boxes[bestIndex];
    const sorted = box.slice().sort((a, b) => keyChannels(a)[bestAxis] - keyChannels(b)[bestAxis]);
    let total = 0;
    for (const key of sorted) total += counts[key];
    let running = 0;
    let splitAt = 1;
    for (let i = 0; i < sorted.length; i += 1) {
      running += counts[sorted[i]];
      if (running >= total / 2) {
        splitAt = i + 1;
        break;
      }
    }
    splitAt = Math.min(Math.max(1, splitAt), sorted.length - 1);
    boxes.splice(bestIndex, 1, sorted.slice(0, splitAt), sorted.slice(splitAt));
  }
  return boxes;
}

function axisRange(box, axis) {
  let min = 255;
  let max = 0;
  for (const key of box) {
    const value = keyChannels(key)[axis];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function boxAverage(box, counts) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const key of box) {
    const count = counts[key] || 0;
    if (!count) continue;
    const [cr, cg, cb] = keyChannels(key);
    r += expandChannel(cr) * count;
    g += expandChannel(cg) * count;
    b += expandChannel(cb) * count;
    total += count;
  }
  if (!total) {
    const [cr, cg, cb] = keyChannels(box[0]);
    return [expandChannel(cr), expandChannel(cg), expandChannel(cb)];
  }
  return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
}

/** Fill the lookup table: every reduced colour maps to its nearest palette entry. */
function nearestPaletteIndex(key, palette) {
  const [r, g, b] = keyChannels(key).map(expandChannel);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const dr = palette[i][0] - r;
    const dg = palette[i][1] - g;
    const db = palette[i][2] - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
      if (distance === 0) break;
    }
  }
  return best;
}

function mapFrameToIndices(imageData, lut, alphaThreshold, transparentIndex) {
  const data = imageData.data;
  const count = imageData.width * imageData.height;
  const out = new Uint8Array(count);
  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    if (transparentIndex >= 0 && data[i + 3] < alphaThreshold) out[p] = transparentIndex;
    else out[p] = lut[reduceKey(data[i], data[i + 1], data[i + 2])] & 0xff;
  }
  return out;
}

/**
 * GIF LZW compression. Emits variable-width codes LSB-first, packed into
 * ≤255-byte sub-blocks.
 */
export function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bits = [];
  let codeSize = minCodeSize + 1;
  let dictionary = new Map();
  let nextCode = eoiCode + 1;

  const writeCode = (code, size) => {
    for (let i = 0; i < size; i += 1) bits.push((code >> i) & 1);
  };

  writeCode(clearCode, codeSize);

  if (indices.length === 0) {
    writeCode(eoiCode, codeSize);
    return packBitsIntoBlocks(bits);
  }

  let current = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const next = indices[i];
    const key = (current << 8) | next;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      current = existing;
      continue;
    }
    writeCode(current, codeSize);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      // Table full at 12 bits: the format's only reset mechanism.
      writeCode(clearCode, codeSize);
      dictionary = new Map();
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    current = next;
  }
  writeCode(current, codeSize);
  writeCode(eoiCode, codeSize);
  return packBitsIntoBlocks(bits);
}

function packBitsIntoBlocks(bits) {
  const byteCount = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  const blocks = [];
  let offset = 0;
  while (offset < bytes.length) {
    const size = Math.min(255, bytes.length - offset);
    const block = new Uint8Array(size + 1);
    block[0] = size;
    block.set(bytes.subarray(offset, offset + size), 1);
    blocks.push(block);
    offset += size;
  }
  if (!blocks.length) blocks.push(new Uint8Array([0]));
  return concat(blocks);
}

/* ---- byte helpers ---- */

function u8(value) {
  return new Uint8Array([value & 0xff]);
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function str(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts) {
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
 * Estimate the raw pixel memory an animated GIF conversion would need, so the
 * caller can enforce the user's memory limit *before* decoding every frame
 * (the crash guard the original extension exposes as an option).
 */
export function estimateAnimationMemory(frameCount, width, height) {
  return frameCount * width * height * 4; // RGBA
}

/**
 * Enforce an RGBA memory budget on a frame set.
 *
 * A frame *count* limit and a memory limit are different constraints: 20 small
 * frames can be cheaper than 3 huge ones. Dropping frames is preferred over
 * failing — a slightly choppy animation still saves — and the caller reports
 * exactly how many were dropped. Only a single frame that is already over the
 * budget is reported back as unrecoverable.
 *
 * @param {Array<{imageData: {width: number, height: number}}>} frames
 * @param {number} limitMB 0 (or a non-number) disables the check
 * @returns {{frames: Array, dropped: number, bytes: number, overLimitWithOneFrame: boolean}}
 */
export function fitFramesToMemory(frames, limitMB) {
  const list = Array.isArray(frames) ? frames.slice() : [];
  const footprint = (items) => items.reduce((total, frame) => total + estimateAnimationMemory(1, frame.imageData.width, frame.imageData.height), 0);
  const limit = Number(limitMB);
  const limitBytes = Number.isFinite(limit) && limit > 0 ? limit * 1048576 : 0;
  if (!limitBytes || list.length === 0) {
    return { frames: list, dropped: 0, bytes: footprint(list), overLimitWithOneFrame: false };
  }
  let kept = list;
  while (kept.length > 1 && footprint(kept) > limitBytes) {
    kept = subsampleFrames(kept, kept.length - 1).frames;
  }
  return {
    frames: kept,
    dropped: list.length - kept.length,
    bytes: footprint(kept),
    overLimitWithOneFrame: kept.length === 1 && footprint(kept) > limitBytes,
  };
}

/**
 * Uniformly subsample frames when there are too many, scaling the delays so the
 * animation keeps its original total duration instead of silently speeding up.
 */
export function subsampleFrames(frames, maxFrames) {
  if (frames.length <= maxFrames) return { frames, dropped: 0 };
  const keep = [];
  const stride = frames.length / maxFrames;
  for (let i = 0; i < maxFrames; i += 1) {
    const index = Math.min(frames.length - 1, Math.floor(i * stride));
    const frame = frames[index];
    const delayMs = Math.min(655350, Math.round((frame.delayMs || 100) * stride));
    keep.push(Object.assign({}, frame, { delayMs }));
  }
  return { frames: keep, dropped: frames.length - keep.length };
}
