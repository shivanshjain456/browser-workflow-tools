/**
 * Animation: detection and frame extraction.
 *
 * Two independent halves, because the honest answer differs per browser:
 *
 * 1. `detectAnimation()` parses the file's own container (GIF block walk, WebP
 *    RIFF chunks, PNG acTL/fcTL). It is pure, dependency-free and needs no
 *    browser support at all, so the script can *tell the user* "this is an
 *    animated WebP" even where frames cannot be decoded.
 *
 * 2. `decodeFrames()` uses WebCodecs `ImageDecoder`, the only browser API that
 *    exposes individual frames of an animated image. It is entirely optional and
 *    probed at runtime: `ImageDecoder` is undefined in the sandbox Chrome 131
 *    used for this project's browser tests, and older Safari/Firefox lack it
 *    too. When it is missing the caller falls back to the first frame and says
 *    so, instead of pretending an animated GIF was produced.
 *
 * Nothing here re-encodes animation the browser already decoded correctly:
 * "Original file" in the menu exists precisely so animation is never lost.
 */

import { ConversionError, createCanvas, canvasToImageData } from './raster.js';
import { subsampleFrames } from '../encoders/gif.js';

/**
 * @param {Uint8Array} bytes
 * @param {string} [mimeHint]
 * @returns {{format:string, animated:boolean, frameCount:number|null, totalDelayMs:number|null}}
 */
export function detectAnimation(bytes, mimeHint = '') {
  if (!bytes || bytes.length < 12) return { format: mimeHint || 'unknown', animated: false, frameCount: null, totalDelayMs: null };

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return parseGif(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return parsePng(bytes);
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return parseWebp(bytes);

  return { format: mimeHint || sniffMime(bytes) || 'unknown', animated: false, frameCount: null, totalDelayMs: null };
}

function parseGif(bytes) {
  let i = 6;
  // Logical Screen Descriptor
  if (i + 7 > bytes.length) return { format: 'image/gif', animated: false, frameCount: 0, totalDelayMs: 0 };
  const packed = bytes[i + 4];
  i += 7;
  if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1)); // global colour table

  let frames = 0;
  let totalDelay = 0;
  let pendingDelay = 0;
  while (i < bytes.length) {
    const marker = bytes[i];
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      // extension
      const label = bytes[i + 1];
      let j = i + 2;
      // GCE = 0x21 0xF9 <blockSize=4> <packed flags> <delayLo> <delayHi> <transparentIndex> <0x00>
      // `j` points at the block-size byte, so the delay is at j+2 / j+3.
      if (label === 0xf9 && bytes[j] >= 4 && j + 4 <= bytes.length) {
        const delay = bytes[j + 2] | (bytes[j + 3] << 8);
        pendingDelay = delay * 10; // centiseconds -> ms
      }
      while (j < bytes.length && bytes[j] !== 0) j += bytes[j] + 1; // skip sub-blocks
      i = j + 1;
      continue;
    }
    if (marker === 0x2c) {
      // image descriptor
      if (i + 10 > bytes.length) break;
      const descriptorPacked = bytes[i + 9];
      let j = i + 10;
      if (descriptorPacked & 0x80) j += 3 * (1 << ((descriptorPacked & 0x07) + 1)); // local colour table
      j += 1; // LZW minimum code size
      while (j < bytes.length && bytes[j] !== 0) j += bytes[j] + 1;
      i = j + 1;
      frames += 1;
      totalDelay += pendingDelay;
      pendingDelay = 0;
      continue;
    }
    break; // corrupt
  }
  return { format: 'image/gif', animated: frames > 1, frameCount: frames, totalDelayMs: totalDelay };
}

function parsePng(bytes) {
  let i = 8;
  let acTLFrames = null;
  let fcTLCount = 0;
  while (i + 8 <= bytes.length) {
    const length = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = asciiAt(bytes, i + 4, 4);
    if (type === 'acTL' && i + 12 <= bytes.length) {
      acTLFrames = (bytes[i + 8] << 24) | (bytes[i + 9] << 16) | (bytes[i + 10] << 8) | bytes[i + 11];
    } else if (type === 'fcTL') {
      fcTLCount += 1;
    } else if (type === 'IEND') {
      break;
    }
    if (!Number.isFinite(length) || length < 0 || length > bytes.length) break;
    i += 12 + length; // length + type + data + CRC
  }
  const frames = acTLFrames !== null ? acTLFrames : fcTLCount;
  return { format: 'image/png', animated: Boolean(frames && frames > 1), frameCount: frames || null, totalDelayMs: null };
}

function parseWebp(bytes) {
  let i = 12;
  let animated = false;
  let frameChunks = 0;
  while (i + 8 <= bytes.length) {
    const fourCC = asciiAt(bytes, i, 4);
    const size = (bytes[i + 4]) | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    if (fourCC === 'VP8X' && i + 12 <= bytes.length) {
      const flags = bytes[i + 8];
      animated = Boolean(flags & 0x02); // bit 1 = animation
    } else if (fourCC === 'ANMF') {
      frameChunks += 1;
      animated = true;
    } else if (fourCC === 'ANIM') {
      animated = true;
    }
    i += 8 + size + (size % 2); // chunks are padded to an even size
  }
  return {
    format: 'image/webp',
    animated: animated && frameChunks !== 1,
    frameCount: frameChunks || null,
    totalDelayMs: null,
  };
}

export function sniffMime(bytes) {
  if (!bytes || bytes.length < 4) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (asciiAt(bytes, 0, 3) === 'GIF') return 'image/gif';
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return 'image/avif';
  }
  return '';
}

function asciiAt(bytes, start, length) {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** What this browser can do with animated images, probed once and cached. */
let capabilityCache = null;
/**
 * Test hook: the capability probe is memoised for the lifetime of the page (a
 * browser does not gain or lose WebCodecs mid-session), so tests that stub
 * `ImageDecoder` need a way to clear the memo. Not used by the script itself.
 */
export function resetAnimationCapabilityForTest() {
  capabilityCache = null;
}

export async function animationCapability() {
  if (capabilityCache) return capabilityCache;
  const result = {
    decoderAvailable: typeof ImageDecoder === 'function',
    types: {},
    reason: '',
  };
  if (!result.decoderAvailable) {
    result.reason = 'This browser has no WebCodecs ImageDecoder, so individual frames of an animated image cannot be read.';
    capabilityCache = result;
    return result;
  }
  for (const type of ['image/gif', 'image/webp', 'image/png', 'image/avif']) {
    try {
      result.types[type] = await ImageDecoder.isTypeSupported(type);
    } catch {
      result.types[type] = false;
    }
  }
  capabilityCache = result;
  return result;
}

/** ImageDecoder's `type` for a given source MIME (APNG is decoded as PNG). */
function decoderTypeFor(mime) {
  const lower = String(mime || '').toLowerCase();
  if (lower === 'image/apng') return 'image/png';
  if (['image/gif', 'image/webp', 'image/png', 'image/avif', 'image/jpeg'].includes(lower)) return lower;
  return '';
}

/**
 * Decode every frame of an animated image.
 *
 * @returns {Promise<{frames: Array<{imageData:object, delayMs:number}>, notes: string[], animated: boolean, frameCount: number}>}
 *   Resolves with `frames: []` (plus a note) when the browser cannot do it, so
 *   the caller can degrade to a single frame without inventing a failure.
 */
export async function decodeFrames({ bytes, mime, maxFrames = 100, memoryLimitMB = 512, signal } = {}) {
  const notes = [];
  const capability = await animationCapability();
  const type = decoderTypeFor(mime);
  if (!capability.decoderAvailable || !type || !capability.types[type]) {
    return { frames: [], notes: [capability.reason || `This browser cannot decode ${mime || 'this format'} frame by frame.`], animated: false, frameCount: 0 };
  }

  let decoder = null;
  try {
    // ImageDecoder wants a buffer it can own (it may be detached while
    // decoding), so hand it an exact-size copy and keep the caller's bytes
    // intact — the "Original file" path still needs them. Building the copy
    // explicitly also avoids handing over a whole allocation pool when `bytes`
    // is a view with an offset (a Node Buffer, or a subarray of a larger fetch).
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    decoder = new ImageDecoder({ data: copy.buffer, type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track ? track.frameCount : 0;
    if (!frameCount || frameCount < 2) {
      return { frames: [], notes: ['The image has a single frame.'], animated: false, frameCount };
    }

    let naturalWidth = track.codedWidth || track.displayWidth || 0;
    let naturalHeight = track.codedHeight || track.displayHeight || 0;
    // Chromium reports 0x0 on a GIF track until a frame has actually been
    // decoded, so give up only after asking the decoder for the first frame.
    let probed = null;
    if (!naturalWidth || !naturalHeight) {
      const first = await decoder.decode({ frameIndex: 0 });
      probed = first.image;
      naturalWidth = probed.displayWidth || probed.codedWidth || 0;
      naturalHeight = probed.displayHeight || probed.codedHeight || 0;
    }
    if (!naturalWidth || !naturalHeight) {
      if (probed) probed.close();
      return { frames: [], notes: ['The browser could not report the frame dimensions.'], animated: false, frameCount };
    }

    // Crash guard: bound raw RGBA memory before decoding anything.
    const limitBytes = Math.max(1, memoryLimitMB) * 1024 * 1024;
    const plan = subsampleFrames(
      Array.from({ length: frameCount }, (_, i) => ({ index: i, delayMs: 0 })),
      Math.max(2, maxFrames),
    );
    let scale = 1;
    const wanted = plan.frames.length;
    const rawMemory = wanted * naturalWidth * naturalHeight * 4;
    if (rawMemory > limitBytes) {
      scale = Math.sqrt(limitBytes / rawMemory);
      notes.push(
        `Frames were scaled to ${Math.round(scale * 100)}% to stay inside your ${memoryLimitMB} MB GIF memory limit ` +
          `(${Math.round(rawMemory / 1048576)} MB needed at full size).`,
      );
    }
    if (plan.dropped > 0) {
      notes.push(`${plan.dropped} of ${frameCount} frames were skipped to respect the ${maxFrames}-frame limit; delays were stretched to keep the original duration.`);
    }

    const targetW = Math.max(1, Math.round(naturalWidth * scale));
    const targetH = Math.max(1, Math.round(naturalHeight * scale));
    const { canvas, ctx } = createCanvas(targetW, targetH, { willReadFrequently: true });
    const frames = [];
    let previousTimestamp = 0;

    for (const placeholder of plan.frames) {
      if (signal && signal.aborted) throw new ConversionError('aborted', 'Conversion cancelled.');
      let image = null;
      if (probed && placeholder.index === 0) {
        image = probed; // already decoded while measuring the frame size
        probed = null;
      } else {
        const decodedFrame = await decoder.decode({ frameIndex: placeholder.index });
        image = decodedFrame.image;
      }
      let delayMs = 0;
      if (typeof image.duration === 'number' && image.duration > 0) delayMs = image.duration / 1000; // microseconds
      else if (image.timestamp > previousTimestamp) delayMs = (image.timestamp - previousTimestamp) / 1000;
      previousTimestamp = image.timestamp || previousTimestamp;
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(image, 0, 0, targetW, targetH);
      frames.push({ imageData: canvasToImageData(canvas, ctx), delayMs: delayMs || 100 });
      image.close();
    }
    if (probed) probed.close(); // frame 0 was not part of the plan
    return { frames, notes, animated: true, frameCount, width: targetW, height: targetH };
  } catch (err) {
    if (err && err.code === 'aborted') throw err;
    notes.push(`Frame decoding failed (${err && err.message ? err.message : 'unknown error'}) — the first frame was used instead.`);
    return { frames: [], notes, animated: false, frameCount: 0 };
  } finally {
    try {
      if (decoder) decoder.close();
    } catch {
      /* noop */
    }
  }
}
