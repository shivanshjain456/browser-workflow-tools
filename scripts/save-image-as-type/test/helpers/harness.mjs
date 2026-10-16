/**
 * Synthetic pixel fixtures and Python-verification bridge.
 *
 * The encoders are verified against decoders we did not write (Pillow, pypdf and
 * a hand-rolled struct parser), so a bug in our writer cannot be "confirmed" by
 * a matching bug in our reader.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export function makeImageData(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = fill(x, y) || [0, 0, 0, 255];
      const i = (y * width + x) * 4;
      data[i] = value[0];
      data[i + 1] = value[1];
      data[i + 2] = value[2];
      data[i + 3] = value.length > 3 ? value[3] : 255;
    }
  }
  return { width, height, data };
}

const ODD_PALETTE = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
  [128, 128, 128, 255],
];

export const FIXTURES = {
  /** 8x8 opaque red — the canonical "did the bytes survive" probe. */
  red8: () => makeImageData(8, 8, () => [227, 51, 51, 255]),
  /** Left half opaque blue, right half fully transparent: exercises alpha paths. */
  halfTransparent: (w = 12, h = 10) =>
    makeImageData(w, h, (x, y) => (x < w / 2 ? [20, 60, 200, 255] : [255, 255, 255, 0])),
  /** Vertical gradient: proves row order (BMP is bottom-up) and no channel swap. */
  gradient: (w = 16, h = 16) =>
    makeImageData(w, h, (x, y) => [Math.round((x / (w - 1)) * 255), Math.round((y / (h - 1)) * 255), 128, 255]),
  /** Odd width (5px): forces the 4-byte row padding path in 24-bit BMP. */
  oddWidth: (w = 5, h = 3) => makeImageData(w, h, (x, y) => ODD_PALETTE[(x + y) % ODD_PALETTE.length]),
  /** 4 distinct colours — exact palette reproduction is checkable. */
  fourColors: (w = 8, h = 8) =>
    makeImageData(w, h, (x, y) => {
      const quadrant = (x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2);
      return [[10, 20, 30], [200, 40, 60], [40, 200, 80], [60, 80, 220]][quadrant].concat([255]);
    }),
  /** Pseudo-random noise: forces the LZW stream past 255 bytes (sub-block split). */
  noise: (w = 64, h = 64, seed = 7) => {
    let state = seed;
    const rnd = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    return makeImageData(w, h, () => [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), 255]);
  },
  /** Three solid frames for animated-GIF checks. */
  animFrames: (w = 10, h = 8) => [
    { imageData: makeImageData(w, h, () => [255, 0, 0, 255]), delayMs: 100 },
    { imageData: makeImageData(w, h, () => [0, 255, 0, 255]), delayMs: 200 },
    { imageData: makeImageData(w, h, () => [0, 0, 255, 255]), delayMs: 50 },
  ],
};

export function tempDir(name) {
  const dir = join(HERE, '..', '..', '.tmp-test', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeFile(dir, name, bytes) {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(bytes.buffer ? bytes : new Uint8Array(bytes)));
  return path;
}

/**
 * Write the exact source pixels next to the produced file as `<base>.ref.rgba`
 * (+ `<base>.ref.json`), so the Python verifier can measure the encoder's error
 * against ground truth without any intermediate encoder of its own.
 */
export function writeReference(dir, producedFilename, imageData) {
  const base = producedFilename.replace(/\.[^.]+$/, '');
  writeFileSync(join(dir, `${base}.ref.rgba`), Buffer.from(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength));
  writeFileSync(join(dir, `${base}.ref.json`), JSON.stringify({ width: imageData.width, height: imageData.height }));
  return `${base}.ref.rgba`;
}

export function pythonAvailable() {
  const probe = spawnSync('python3', ['-c', 'import PIL, pypdf; print("ok")'], { encoding: 'utf8' });
  return probe.status === 0 && probe.stdout.includes('ok');
}

/** Runs verify_media.py over a directory and returns its parsed facts. */
export function verifyMedia(dir, only = '') {
  const script = join(HERE, 'verify_media.py');
  const args = [script, dir];
  if (only) args.push('--only', only);
  const result = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`verify_media.py exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

export function findFacts(report, name) {
  for (const key of ['images', 'bmp_raw', 'gif_raw', 'gif_lzw', 'pdf_raw']) {
    const hit = (report[key] || []).find((entry) => entry.name === name);
    if (hit) return hit;
  }
  return null;
}

/**
 * Walk a GIF89a container the way the specification describes: header, logical
 * screen descriptor, global colour table, then extension/image-descriptor
 * blocks. Byte-searching for a marker is NOT acceptable — 0x21/0x2C occur inside
 * colour tables and compressed data, which silently produces garbage offsets.
 */
export function walkGif(bytes) {
  const u16 = (at) => bytes[at] | (bytes[at + 1] << 8);
  const text = (at, len) => String.fromCharCode(...bytes.subarray(at, at + len));
  const out = {
    signature: text(0, 6),
    width: u16(6),
    height: u16(8),
    packed: bytes[10],
    backgroundIndex: bytes[11],
    aspect: bytes[12],
    blocks: [],
  };
  out.gctFlag = Boolean(bytes[10] & 0x80);
  out.gctEntries = out.gctFlag ? 1 << ((bytes[10] & 0x07) + 1) : 0;
  out.colorResolution = ((bytes[10] >> 4) & 0x07) + 1;
  let i = 13;
  if (out.gctEntries) {
    out.gct = [...bytes.subarray(i, i + 3 * out.gctEntries)];
    i += 3 * out.gctEntries;
  }
  while (i < bytes.length) {
    const marker = bytes[i];
    if (marker === 0x3b) {
      out.trailerAt = i;
      break;
    }
    if (marker === 0x21) {
      const label = bytes[i + 1];
      const block = { type: 'extension', label, at: i, subBlockSizes: [] };
      let j = i + 2;
      if (label === 0xf9) {
        block.gce = { packed: bytes[i + 3], disposal: (bytes[i + 3] >> 2) & 0x07, transparentFlag: Boolean(bytes[i + 3] & 0x01), delayCs: u16(i + 4), transparentIndex: bytes[i + 6], blockSize: bytes[i + 2] };
      }
      if (label === 0xff) {
        block.appId = text(i + 3, 11);
        block.appData = [...bytes.subarray(i + 14, i + 14 + (bytes[i + 14] || 0))];
        block.loopCount = bytes[i + 14] === 3 ? u16(i + 16) : null;
      }
      while (j < bytes.length && bytes[j] !== 0) {
        block.subBlockSizes.push(bytes[j]);
        j += bytes[j] + 1;
      }
      out.blocks.push(block);
      i = j + 1;
      continue;
    }
    if (marker === 0x2c) {
      const block = {
        type: 'image', at: i, left: u16(i + 1), top: u16(i + 3), width: u16(i + 5),
        height: u16(i + 7), packed: bytes[i + 9], localColorTable: Boolean(bytes[i + 9] & 0x80),
      };
      let j = i + 10;
      if (block.localColorTable) j += 3 * (1 << ((bytes[i + 9] & 0x07) + 1));
      block.minCodeSize = bytes[j];
      j += 1;
      block.subBlockSizes = [];
      block.lzwBytes = 0;
      while (j < bytes.length && bytes[j] !== 0) {
        block.subBlockSizes.push(bytes[j]);
        block.lzwBytes += bytes[j];
        j += bytes[j] + 1;
      }
      block.terminatorAt = j;
      out.blocks.push(block);
      i = j + 1;
      continue;
    }
    out.parseErrorAt = i;
    break;
  }
  out.images = out.blocks.filter((b) => b.type === 'image');
  out.gces = out.blocks.filter((b) => b.gce).map((b) => b.gce);
  out.netscape = out.blocks.find((b) => b.appId === 'NETSCAPE2.0') || null;
  return out;
}

/**
 * Metadata fixtures are generated with Pillow (EXIF + GPS + ICC + XMP), so the
 * inspector and the sanitizer are checked against metadata a real camera-shaped
 * writer produced rather than bytes we assembled ourselves.
 */
export function makeMetadataFixtures(dir) {
  const script = join(HERE, 'make_metadata_fixtures.py');
  const result = spawnSync('python3', [script, dir], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`make_metadata_fixtures.py exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().split('\n').filter(Boolean);
}

/** Facts about the metadata inside every image in `dir` (see verify_metadata.py). */
export function verifyMetadata(dir, only = '') {
  return runPython('verify_metadata.py', dir, only);
}

/** Facts about every .zip in `dir`, verified by Python's zipfile (see verify_zip.py). */
export function verifyZip(dir, only = '') {
  return runPython('verify_zip.py', dir, only);
}

function runPython(scriptName, dir, only) {
  const script = join(HERE, scriptName);
  const args = [script, dir];
  if (only) args.push('--only', only);
  const result = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${scriptName} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}
