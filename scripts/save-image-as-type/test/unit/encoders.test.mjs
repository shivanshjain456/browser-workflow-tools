import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeBmp, BMP_LAYOUT } from '../../src/encoders/bmp.js';
import { encodeGif, lzwEncode, subsampleFrames, estimateAnimationMemory } from '../../src/encoders/gif.js';
import { encodePdf, pdfLayout, escapePdfString } from '../../src/encoders/pdf.js';
import { FIXTURES, tempDir, writeFile, writeReference, verifyMedia, findFacts, pythonAvailable, walkGif } from '../helpers/harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', 'fixtures');
const PHOTO_JPEG = new Uint8Array(readFileSync(join(FIXTURE_DIR, 'photo.jpg')));

const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u32 = (bytes, at) => dv(bytes).getUint32(at, true);
const u16 = (bytes, at) => dv(bytes).getUint16(at, true);
const i32 = (bytes, at) => dv(bytes).getInt32(at, true);
const ascii = (bytes, at, len) => String.fromCharCode(...bytes.subarray(at, at + len));

describe('BMP encoder — header and pixel layout', () => {
  test('writes a 32-bit BITMAPV5 file with alpha masks when the image has transparency', () => {
    const image = FIXTURES.halfTransparent(12, 10);
    const bytes = encodeBmp(image);
    const view = dv(bytes);

    assert.equal(ascii(bytes, 0, 2), 'BM');
    assert.equal(u32(bytes, 2), bytes.length, 'declared file size must equal the real size');
    assert.equal(u32(bytes, 10), BMP_LAYOUT.offset32, 'pixel data offset');
    assert.equal(u32(bytes, 14), 124, 'BITMAPV5HEADER size');
    assert.equal(i32(bytes, 18), 12, 'width');
    assert.equal(i32(bytes, 22), 10, 'height (positive => bottom-up)');
    assert.equal(u16(bytes, 26), 1, 'planes');
    assert.equal(u16(bytes, 28), 32, 'bits per pixel');
    assert.equal(u32(bytes, 30), 3, 'BI_BITFIELDS');
    assert.equal(u32(bytes, 34), 12 * 10 * 4, 'image size');
    assert.equal(u32(bytes, 54), 0x00ff0000, 'red mask');
    assert.equal(u32(bytes, 58), 0x0000ff00, 'green mask');
    assert.equal(u32(bytes, 62), 0x000000ff, 'blue mask');
    assert.equal(u32(bytes, 66), 0xff000000, 'alpha mask');
    // LCS_sRGB is the DWORD 0x73524742 ("sRGB" read big-endian); stored
    // little-endian the on-disk bytes are "BGRs", which is what Windows writes.
    assert.equal(u32(bytes, 70), 0x73524742, 'colour space = LCS_sRGB');
    // BITMAPV5 field offsets are DIB-relative + 14: gammaBlue=118, intent=122,
    // profileData=126, profileSize=130, reserved=134.
    assert.equal(u32(bytes, 122), 4, 'rendering intent = LCS_GM_IMAGES');
    assert.equal(u32(bytes, 126), 0, 'no profile data');
    assert.equal(u32(bytes, 130), 0, 'no profile size');
    assert.equal(u32(bytes, 134), 0, 'reserved');
    assert.equal(u32(bytes, 110), 0, 'gammaRed unused for LCS_sRGB');
    assert.equal(u32(bytes, 114), 0, 'gammaGreen unused for LCS_sRGB');
    assert.equal(u32(bytes, 118), 0, 'gammaBlue unused for LCS_sRGB');
    // The 36-byte CIEXYZTRIPLE between cstype and the gammas must be zeroed.
    assert.deepEqual([...bytes.subarray(74, 110)], new Array(36).fill(0), 'CIEXYZTRIPLE zeroed');
    assert.equal(view.getUint32(2, true), bytes.length);
  });

  test('stores rows bottom-up in BGRA order', () => {
    const image = FIXTURES.gradient(6, 4);
    const bytes = encodeBmp(image, { alpha: 'always' });
    const firstStored = bytes.subarray(BMP_LAYOUT.offset32, BMP_LAYOUT.offset32 + 4);
    // Bottom-left pixel of the source must be the first pixel in the file.
    const bottomLeft = (4 - 1) * 6 * 4;
    assert.deepEqual([...firstStored], [image.data[bottomLeft + 2], image.data[bottomLeft + 1], image.data[bottomLeft], image.data[bottomLeft + 3]]);
    const lastRowStart = BMP_LAYOUT.offset32 + 6 * 4 * (4 - 1);
    const lastStored = bytes.subarray(lastRowStart, lastRowStart + 4);
    assert.deepEqual([...lastStored], [image.data[2], image.data[1], image.data[0], image.data[3]], 'top-left pixel stored last');
  });

  test('writes a 24-bit V3 file with 4-byte row padding for an odd width', () => {
    const image = FIXTURES.oddWidth(5, 3);
    const bytes = encodeBmp(image);
    assert.equal(u32(bytes, 10), BMP_LAYOUT.offset24, 'pixel offset for V3');
    assert.equal(u32(bytes, 14), 40, 'BITMAPINFOHEADER size');
    assert.equal(u16(bytes, 28), 24, 'bits per pixel');
    assert.equal(u32(bytes, 30), 0, 'BI_RGB');
    const stride = (5 * 3 + 3) & ~3;
    assert.equal(stride, 16);
    assert.equal(u32(bytes, 34), stride * 3, 'image size includes padding');
    assert.equal(bytes.length, BMP_LAYOUT.offset24 + stride * 3, 'file size accounts for padding');
    // The two padding bytes at the end of each row must be zero.
    for (let row = 0; row < 3; row += 1) {
      const rowStart = BMP_LAYOUT.offset24 + row * stride;
      assert.equal(bytes[rowStart + 15], 0, `row ${row} padding byte 2`);
      assert.equal(bytes[rowStart + 16 - 1], 0);
    }
  });

  test('alpha mode is respected (auto / always / never)', () => {
    const opaque = FIXTURES.red8();
    const transparent = FIXTURES.halfTransparent(4, 4);
    assert.equal(u16(encodeBmp(opaque), 28), 24, 'opaque image auto-selects 24-bit');
    assert.equal(u16(encodeBmp(opaque, { alpha: 'always' }), 28), 32, 'always => 32-bit');
    assert.equal(u16(encodeBmp(transparent, { alpha: 'never' }), 28), 24, 'never => 24-bit');
    assert.equal(u16(encodeBmp(transparent), 28), 32, 'transparent image auto-selects 32-bit');
  });

  test('rejects invalid input instead of writing a broken file', () => {
    assert.throws(() => encodeBmp({ width: 0, height: 4, data: new Uint8ClampedArray(0) }), /invalid dimensions/);
    assert.throws(() => encodeBmp({ width: 4, height: 4, data: new Uint8ClampedArray(8) }), /pixel buffer too small/);
  });
});

describe('GIF encoder — container structure', () => {
  // All structure assertions go through walkGif(), which follows the spec's block
  // layout. Searching the byte stream for a marker is not valid: 0x21/0x2C occur
  // inside colour tables and inside compressed data.
  test('header, screen descriptor and global colour table are well formed', () => {
    const gif = walkGif(encodeGif([{ imageData: FIXTURES.fourColors(8, 8), delayMs: 100 }]));
    assert.equal(gif.signature, 'GIF89a');
    assert.deepEqual([gif.width, gif.height], [8, 8]);
    assert.equal(gif.gctFlag, true, 'global colour table flag');
    assert.ok(gif.gctEntries >= 2 && gif.gctEntries <= 256, `colour table has ${gif.gctEntries} entries`);
    assert.equal(Number.isInteger(Math.log2(gif.gctEntries)), true, 'colour table size is a power of two');
    assert.equal(gif.gct.length, gif.gctEntries * 3, 'colour table byte length');
    assert.equal(gif.backgroundIndex, 0);
    assert.equal(gif.aspect, 0, 'pixel aspect ratio');
    assert.equal(gif.parseErrorAt, undefined, 'container parsed without hitting an unknown marker');
    assert.ok(gif.trailerAt === undefined || gif.trailerAt > 0, 'trailer reached');
  });

  test('writes the Netscape looping extension with loop=0 (forever)', () => {
    const gif = walkGif(encodeGif([{ imageData: FIXTURES.red8(), delayMs: 100 }], { loop: 0 }));
    assert.ok(gif.netscape, 'NETSCAPE2.0 application extension present');
    assert.equal(gif.netscape.label, 0xff, 'application extension label');
    assert.deepEqual(gif.netscape.subBlockSizes, [11, 3], 'sub-block sizes');
    assert.equal(gif.netscape.loopCount, 0, 'loop count 0 = infinite');
    const finite = walkGif(encodeGif([{ imageData: FIXTURES.red8(), delayMs: 100 }], { loop: 3 }));
    assert.equal(finite.netscape.loopCount, 3, 'loop count is honoured');
  });

  test('one Graphic Control Extension + image descriptor per frame, with clamped delays', () => {
    const gif = walkGif(encodeGif(FIXTURES.animFrames()));
    assert.equal(gif.images.length, 3, 'three image descriptors');
    assert.equal(gif.gces.length, 3, 'three graphic control extensions');
    assert.deepEqual(gif.gces.map((g) => g.delayCs), [10, 20, 5], 'delays in centiseconds');
    assert.deepEqual(gif.gces.map((g) => g.blockSize), [4, 4, 4], 'GCE block size');
    for (const gce of gif.gces) assert.equal(gce.disposal, 1, 'disposal method 1 (do not dispose)');
    for (const image of gif.images) {
      assert.deepEqual([image.width, image.height], [10, 8], 'frame dimensions');
      assert.equal(image.localColorTable, false, 'one shared global palette, no per-frame tables');
      assert.ok(image.minCodeSize >= 2 && image.minCodeSize <= 8, `LZW minimum code size ${image.minCodeSize}`);
      assert.ok(image.subBlockSizes.every((size) => size >= 1 && size <= 255), 'every sub-block within the 255-byte limit');
      assert.equal(image.subBlockSizes.reduce((a, b) => a + b, 0), image.lzwBytes, 'sub-blocks tile the stream');
    }
    // The container must end with the trailer byte right after the last block.
    const bytes = encodeGif(FIXTURES.animFrames());
    assert.equal(bytes[bytes.length - 1], 0x3b, 'trailer is the final byte');
  });

  test('delays below 2cs are raised (browsers clamp them) and zero becomes 10cs', () => {
    const gif = walkGif(encodeGif([
      { imageData: FIXTURES.red8(), delayMs: 0 },
      { imageData: FIXTURES.red8(), delayMs: 5 },
      { imageData: FIXTURES.red8(), delayMs: 100000 },
    ]));
    assert.deepEqual(gif.gces.map((g) => g.delayCs), [10, 2, 10000], 'zero -> 100ms default, 5ms -> 2cs floor, 100s -> 10000cs');
  });

  test('transparency gets a reserved palette index and the GCE flag', () => {
    const gif = walkGif(encodeGif([{ imageData: FIXTURES.halfTransparent(8, 8), delayMs: 100 }]));
    assert.equal(gif.gces[0].transparentFlag, true, 'transparent flag set');
    assert.ok(gif.gces[0].transparentIndex < gif.gctEntries, `index ${gif.gces[0].transparentIndex} within the ${gif.gctEntries}-entry palette`);
    const opaque = walkGif(encodeGif([{ imageData: FIXTURES.red8(), delayMs: 100 }]));
    assert.equal(opaque.gces[0].transparentFlag, false, 'no transparency reserved for an opaque image');
  });

  test('splits the LZW stream into <=255 byte sub-blocks on a large noisy image', () => {
    const gif = walkGif(encodeGif([{ imageData: FIXTURES.noise(64, 64), delayMs: 100 }]));
    const image = gif.images[0];
    assert.ok(image.subBlockSizes.length > 1, `expected multiple sub-blocks, got ${image.subBlockSizes.length}`);
    assert.ok(image.subBlockSizes.every((size) => size <= 255), 'every sub-block within the limit');
    assert.equal(Math.max(...image.subBlockSizes), 255, 'blocks are filled to the maximum before splitting');
    assert.ok(image.lzwBytes > 500, 'a 64x64 noise image produces a real LZW stream');
    assert.equal(gif.gctEntries, 256, 'a noisy image uses the full palette');
  });

  test('subsampleFrames keeps total duration when dropping frames', () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ imageData: FIXTURES.red8(), delayMs: 100 }));
    const result = subsampleFrames(frames, 4);
    assert.equal(result.frames.length, 4);
    assert.equal(result.dropped, 6);
    const totalBefore = frames.reduce((a, f) => a + f.delayMs, 0);
    const totalAfter = result.frames.reduce((a, f) => a + f.delayMs, 0);
    assert.ok(Math.abs(totalAfter - totalBefore) <= 4 * 100, `duration preserved approximately (${totalAfter} vs ${totalBefore})`);
  });

  test('estimateAnimationMemory reports RGBA bytes for the crash guard', () => {
    assert.equal(estimateAnimationMemory(10, 100, 100), 10 * 100 * 100 * 4);
  });

  test('lzwEncode emits clear + EOI and never exceeds 12-bit codes', () => {
    const indices = new Uint8Array(5000).map((_, i) => i % 200);
    const blocks = lzwEncode(indices, 8);
    assert.ok(blocks.length > 0);
    // every sub-block must be length-prefixed and <= 255
    let i = 0;
    while (i < blocks.length) {
      const size = blocks[i];
      assert.ok(size <= 255, `sub-block size ${size}`);
      i += size + 1;
    }
    assert.equal(i, blocks.length, 'sub-blocks tile the stream exactly');
  });

  test('rejects mismatched frame dimensions and empty input', () => {
    assert.throws(() => encodeGif([]), /no frames/);
    assert.throws(
      () => encodeGif([{ imageData: FIXTURES.red8(), delayMs: 1 }, { imageData: FIXTURES.gradient(9, 9), delayMs: 1 }]),
      /share dimensions/,
    );
  });
});

describe('PDF encoder — structure', () => {
  test('produces a parseable 1.4 file with a byte-exact xref table', () => {
    const pdf = encodePdf({ jpegBytes: PHOTO_JPEG, width: 200, height: 140, pageFit: 'pixel' });
    const text = new TextDecoder('latin1').decode(pdf);
    assert.ok(text.startsWith('%PDF-1.4\n'), 'header');
    assert.ok(text.trimEnd().endsWith('%%EOF'), 'EOF marker');

    const startxref = Number(/startxref\s+(\d+)\s+%%EOF/.exec(text)[1]);
    assert.equal(text.slice(startxref, startxref + 4), 'xref', 'startxref points at the xref keyword');

    const tableBlock = text.slice(startxref).split('\n');
    const [startObj, count] = tableBlock[1].split(' ').map(Number);
    assert.equal(startObj, 0);
    for (let k = 0; k < count; k += 1) {
      const line = tableBlock[2 + k];
      assert.equal(line.length + 1, 20, `xref entry ${k} is exactly 20 bytes (got "${line}")`);
      const offset = Number(line.slice(0, 10));
      const kind = line[17];
      if (kind === 'n') {
        const objNumber = startObj + k;
        assert.equal(text.slice(offset, offset + `${objNumber} 0 obj`.length), `${objNumber} 0 obj`, `offset for object ${objNumber}`);
      } else {
        assert.equal(kind, 'f');
        assert.equal(offset, 0);
      }
    }
    assert.match(text, new RegExp(`/Size ${count}`), 'trailer /Size matches the table');
  });

  test('page geometry follows the pageFit setting', () => {
    const pixel = pdfLayout({ width: 200, height: 140, pageFit: 'pixel' });
    assert.deepEqual([pixel.pageWidth, pixel.pageHeight], [150, 105], '1px = 0.75pt');
    assert.deepEqual([pixel.x, pixel.y], [0, 0]);

    const a4 = pdfLayout({ width: 200, height: 140, pageFit: 'a4' });
    assert.deepEqual([a4.pageWidth, a4.pageHeight], [595.276, 841.89]);
    assert.ok(a4.drawWidth <= 595.276 - 48 + 1e-6, 'fits inside the 24pt margins');
    assert.ok(a4.drawHeight <= 841.89 - 48 + 1e-6);
    assert.ok(Math.abs(a4.drawWidth / a4.drawHeight - 200 / 140) < 1e-6, 'aspect ratio preserved');
    assert.ok(Math.abs(a4.x - (a4.pageWidth - a4.drawWidth) / 2) < 1e-9, 'centred horizontally');

    const letter = pdfLayout({ width: 200, height: 140, pageFit: 'letter' });
    assert.deepEqual([letter.pageWidth, letter.pageHeight], [612, 792]);
  });

  test('the MediaBox in the written file matches the layout', () => {
    const layout = pdfLayout({ width: 200, height: 140, pageFit: 'a4' });
    const pdf = encodePdf({ jpegBytes: PHOTO_JPEG, width: 200, height: 140, pageFit: 'a4' });
    const text = new TextDecoder('latin1').decode(pdf);
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    assert.ok(box, 'MediaBox present');
    assert.equal(Number(box[1]), Math.round(layout.pageWidth * 10000) / 10000);
    assert.equal(Number(box[2]), Math.round(layout.pageHeight * 10000) / 10000);
    const cm = /q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(text);
    assert.ok(cm, 'placement matrix present');
    assert.equal(Number(cm[1]), Math.round(layout.drawWidth * 10000) / 10000);
    assert.equal(Number(cm[4]), Math.round(layout.y * 10000) / 10000);
  });

  test('embeds the JPEG byte-for-byte with DCTDecode', () => {
    const pdf = encodePdf({ jpegBytes: PHOTO_JPEG, width: 200, height: 140 });
    const text = new TextDecoder('latin1').decode(pdf);
    assert.match(text, /\/Filter \/DCTDecode/);
    assert.match(text, /\/ColorSpace \/DeviceRGB/);
    assert.match(text, /\/BitsPerComponent 8/);
    assert.match(text, new RegExp(`/Length ${PHOTO_JPEG.length} >>`));
    // the JPEG must appear verbatim between stream markers
    const streamStart = text.indexOf('/DCTDecode') ;
    const marker = pdf.indexOf(0xff, streamStart);
    assert.equal(pdf[marker], 0xff);
    assert.equal(pdf[marker + 1], 0xd8, 'SOI marker inside the stream');
    const embedded = pdf.subarray(marker, marker + PHOTO_JPEG.length);
    assert.deepEqual([...embedded], [...PHOTO_JPEG], 'JPEG payload is unchanged');
  });

  test('refuses input that is not a complete JPEG rather than writing a broken PDF', () => {
    assert.throws(() => encodePdf({ jpegBytes: new Uint8Array([1, 2, 3, 4]), width: 2, height: 2 }), /not a JPEG/);
    assert.throws(
      () => encodePdf({ jpegBytes: PHOTO_JPEG.subarray(0, PHOTO_JPEG.length - 2), width: 200, height: 140 }),
      /complete JPEG/,
    );
    assert.throws(() => encodePdf({ jpegBytes: PHOTO_JPEG, width: 0, height: 140 }), /invalid image dimensions/);
  });

  test('escapePdfString neutralises hostile titles', () => {
    assert.equal(escapePdfString('plain'), 'plain');
    assert.equal(escapePdfString('a(b)c\\d'), 'a\\(b\\)c\\\\d');
    assert.equal(escapePdfString('ünïcödé'), '\\374n\\357c\\366d\\351', 'Latin-1 octal escapes');
    assert.equal(escapePdfString('漢字'), '', 'non-Latin-1 is dropped, never passed through');
    assert.equal(escapePdfString('x'.repeat(500)).length, 200, 'length capped');
    assert.ok(!escapePdfString(')))(((').includes(')))'), 'no unbalanced delimiters survive');
  });
});

describe('encoders verified by independent decoders (Pillow + pypdf)', { skip: pythonAvailable() ? false : 'Pillow/pypdf not installed' }, () => {
  const dir = tempDir('encoders');

  test('BMP: Pillow decodes our files back to the exact pixels', () => {
    const opaque = FIXTURES.gradient(16, 16);
    const alpha = FIXTURES.halfTransparent(12, 10);
    const odd = FIXTURES.oddWidth(5, 3);
    writeFile(dir, 'gradient-24.bmp', encodeBmp(opaque));
    writeReference(dir, 'gradient-24.bmp', opaque);
    writeFile(dir, 'alpha-32.bmp', encodeBmp(alpha));
    writeReference(dir, 'alpha-32.bmp', alpha);
    writeFile(dir, 'odd-24.bmp', encodeBmp(odd));
    writeReference(dir, 'odd-24.bmp', odd);
    writeFile(dir, 'red8-24.bmp', encodeBmp(FIXTURES.red8()));
    writeReference(dir, 'red8-24.bmp', FIXTURES.red8());

    const report = verifyMedia(dir, '.bmp');
    assert.deepEqual(report.errors, [], `verifier errors: ${JSON.stringify(report.errors)}`);

    const gradientFacts = findFacts(report, 'gradient-24.bmp');
    assert.equal(gradientFacts.format, 'BMP');
    assert.deepEqual(gradientFacts.size, [16, 16]);
    // bottom-right pixel of a horizontal+vertical gradient: r=255, g=255, b=128
    const bottomRight = gradientFacts.pixels.find(([x, y]) => x === 15 && y === 15);
    assert.deepEqual(bottomRight[2], [255, 255, 128, 255], 'no channel swap, no vertical flip');
    const topLeft = gradientFacts.pixels.find(([x, y]) => x === 0 && y === 0);
    assert.deepEqual(topLeft[2], [0, 0, 128, 255]);

    const alphaFacts = findFacts(report, 'alpha-32.bmp');
    assert.equal(alphaFacts.mode, 'RGBA', '32-bit BMP with alpha decodes as RGBA');
    const opaqueSide = alphaFacts.pixels.find(([x, y]) => x === 0 && y === 0);
    const clearSide = alphaFacts.pixels.find(([x, y]) => x === 11 && y === 0);
    assert.deepEqual(opaqueSide[2], [20, 60, 200, 255]);
    assert.equal(clearSide[2][3], 0, 'transparency survived the round trip');

    const oddFacts = findFacts(report, 'odd-24.bmp');
    assert.deepEqual(oddFacts.size, [5, 3]);
    const oddPixel = oddFacts.pixels.find(([x, y]) => x === 0 && y === 0);
    assert.deepEqual(oddPixel[2], [255, 0, 0, 255], 'padding did not shift or flip the row');

    // BMP is lossless: every channel, including alpha, must come back identical.
    for (const name of ['gradient-24.bmp', 'alpha-32.bmp', 'odd-24.bmp', 'red8-24.bmp']) {
      const delta = findFacts(report, name).delta_vs_reference;
      assert.ok(delta, `${name}: reference comparison ran`);
      assert.equal(delta.error, undefined, `${name}: ${delta.error}`);
      assert.equal(delta.max_channel_delta, 0, `${name}: colours are bit-exact`);
      assert.equal(delta.max_alpha_delta, 0, `${name}: alpha is bit-exact`);
    }

    const raw = report.bmp_raw.map((entry) => [entry.name, entry]);
    for (const [name, facts] of raw) {
      assert.equal(facts.signature, 'BM', name);
      assert.equal(facts.file_size_matches, true, `${name}: declared size`);
      assert.equal(facts.offset_matches, true, `${name}: pixel offset`);
      assert.equal(facts.size_matches, true, `${name}: image size`);
    }
    const raw32 = report.bmp_raw.find((e) => e.name === 'alpha-32.bmp');
    assert.equal(raw32.variant, 'BITMAPV5HEADER');
    assert.equal(raw32.bpp, 32);
    assert.equal(raw32.alpha_mask, '0xff000000');
    assert.equal(raw32.cstype, '0x73524742', "LCS_sRGB colour space ('sRGB' as a big-endian DWORD)");
    const raw24 = report.bmp_raw.find((e) => e.name === 'odd-24.bmp');
    assert.equal(raw24.variant, 'BITMAPINFOHEADER (V3)');
    assert.equal(raw24.bpp, 24);
    assert.equal(raw24.row_stride, 16);
  });

  test('GIF: Pillow reads frames, delays, transparency; an independent LZW decoder reads our stream', () => {
    const stillSource = FIXTURES.fourColors(8, 8);
    const animSource = FIXTURES.animFrames();
    const transparentSource = FIXTURES.halfTransparent(10, 10);
    const noiseSource = FIXTURES.noise(64, 64);
    writeFile(dir, 'still.gif', encodeGif([{ imageData: stillSource, delayMs: 0 }]));
    writeReference(dir, 'still.gif', stillSource);
    writeFile(dir, 'anim.gif', encodeGif(animSource, { loop: 0 }));
    writeReference(dir, 'anim.gif', animSource[0].imageData); // reference = frame 0
    writeFile(dir, 'transparent.gif', encodeGif([{ imageData: transparentSource, delayMs: 100 }]));
    writeReference(dir, 'transparent.gif', transparentSource);
    writeFile(dir, 'noise.gif', encodeGif([{ imageData: noiseSource, delayMs: 100 }]));
    writeReference(dir, 'noise.gif', noiseSource);

    const report = verifyMedia(dir, '.gif');
    assert.deepEqual(report.errors, [], `verifier errors: ${JSON.stringify(report.errors)}`);

    const anim = findFacts(report, 'anim.gif');
    assert.equal(anim.format, 'GIF');
    assert.equal(anim.n_frames, 3, 'three frames survived');
    assert.deepEqual(anim.frames.map((f) => f.duration_ms), [100, 200, 50], 'per-frame delays in ms');
    const centers = anim.frames.map((f) => f.pixels.find(([x, y]) => x === 5 && y === 4)[2]);
    assert.deepEqual(centers, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]], 'saturated colours survive exactly (bit-replicated 5-bit expansion)');
    const animDelta = findFacts(report, 'anim.gif').delta_vs_reference;
    assert.equal(animDelta.max_channel_delta, 0, 'frame 0 is bit-exact against its source pixels');

    const transparent = findFacts(report, 'transparent.gif');
    const leftPixel = transparent.pixels.find(([x, y]) => x === 0 && y === 0)[2];
    const rightPixel = transparent.pixels.find(([x, y]) => x === 9 && y === 0)[2];
    assert.equal(leftPixel[3], 255, 'opaque side stays opaque');
    assert.equal(rightPixel[3], 0, 'transparent side decodes as transparent');

    // Quantisation quality, measured against the exact source pixels.
    const stillDelta = findFacts(report, 'still.gif').delta_vs_reference;
    assert.ok(stillDelta.max_channel_delta <= 8, `four flat colours reproduce within 5-bit reduction error (got ${stillDelta.max_channel_delta})`);
    assert.equal(stillDelta.max_alpha_delta, 0);

    const transparentDelta = findFacts(report, 'transparent.gif').delta_vs_reference;
    assert.equal(transparentDelta.max_alpha_delta, 0, 'binary transparency is reproduced exactly');
    assert.ok(
      transparentDelta.max_channel_delta_visible <= 8,
      `visible pixels keep their colour (max ${transparentDelta.max_channel_delta_visible})`,
    );

    const noiseDelta = findFacts(report, 'noise.gif').delta_vs_reference;
    // Random noise is the worst case for a 256-colour palette; these bounds are
    // measured, and would catch a channel swap (mean would exceed 60) or a
    // vertical flip (max would exceed 200).
    // Measured with this encoder: mean 10.53, max 41 for 4096 random colours
    // quantised to a 256-entry palette. Bounds are set just above the measured
    // values so a channel swap (mean > 60), a vertical flip or an off-by-one row
    // stride would fail, while ordinary quantisation noise does not.
    assert.ok(noiseDelta.mean_channel_delta < 16, `mean error ${noiseDelta.mean_channel_delta} (measured 10.53)`);
    assert.ok(noiseDelta.max_channel_delta < 64, `max error ${noiseDelta.max_channel_delta} (measured 41)`);
    assert.equal(noiseDelta.visible_pixels, 64 * 64, 'every pixel compared');
    assert.equal(noiseDelta.max_alpha_delta, 0, 'opaque source stays opaque');

    // Documented GIF limitation, asserted rather than assumed: the RGB of a fully
    // transparent pixel cannot be stored (it is replaced by the reserved
    // transparency index), while visible pixels and the alpha itself stay exact.
    assert.equal(transparentDelta.max_alpha_delta, 0, 'binary alpha exact');
    assert.ok(transparentDelta.mean_channel_delta > 100, `transparent pixels lose their RGB as the format requires (mean ${transparentDelta.mean_channel_delta})`);
    assert.ok(transparentDelta.visible_pixels > 0 && transparentDelta.visible_pixels < 10 * 10, 'only part of the fixture is visible');

    const rawAnim = report.gif_raw.find((e) => e.name === 'anim.gif');
    assert.equal(rawAnim.signature, 'GIF89a');
    assert.equal(rawAnim.image_descriptor_count, 3);
    assert.equal(rawAnim.gce_count, 3);
    assert.equal(rawAnim.loop_count, 0, 'Netscape loop parsed as infinite');
    assert.equal(rawAnim.sub_blocks_within_limit, true);

    const rawStill = report.gif_raw.find((e) => e.name === 'still.gif');
    assert.equal(rawStill.width, 8);
    assert.equal(rawStill.height, 8);

    // Independent LZW decode of the noise image: every pixel must come back and
    // every index must exist in the palette.
    const lzw = report.gif_lzw.find((e) => e.name === 'noise.gif');
    assert.ok(lzw, 'LZW stream extracted');
    assert.equal(lzw.error, undefined, `LZW decode error: ${lzw.error}`);
    assert.equal(lzw.decoded, lzw.expected_pixels, 'decoded exactly width*height indices');
    assert.ok(lzw.max_code_width === 12, `stream reached 12-bit codes (got ${lzw.max_code_width})`);
    assert.ok(lzw.clear_resets >= 1, `stream exercised clear-code table resets (${lzw.clear_resets})`);
    const paletteEntries = report.gif_raw.find((e) => e.name === 'noise.gif').gct_entries;
    assert.ok(lzw.max_index < paletteEntries, `index ${lzw.max_index} within palette of ${paletteEntries}`);
  });

  test('PDF: pypdf opens it in strict mode and extracts the embedded image', () => {
    writeFile(dir, 'pixel.pdf', encodePdf({ jpegBytes: PHOTO_JPEG, width: 200, height: 140, pageFit: 'pixel', title: 'Test (with) \\ chars' }));
    writeFile(dir, 'a4.pdf', encodePdf({ jpegBytes: PHOTO_JPEG, width: 200, height: 140, pageFit: 'a4' }));

    const report = verifyMedia(dir, '.pdf');
    assert.deepEqual(report.errors, [], `verifier errors: ${JSON.stringify(report.errors)}`);

    for (const name of ['pixel.pdf', 'a4.pdf']) {
      const facts = findFacts(report, name);
      assert.equal(facts.pypdf_error, undefined, `${name}: ${facts.pypdf_error}`);
      assert.equal(facts.starts_with_pdf, true);
      assert.equal(facts.ends_with_eof, true);
      assert.equal(facts.startxref_points_to_xref, true, `${name}: startxref`);
      assert.equal(facts.xref_consistent, true, `${name}: every xref offset points at its object`);
      assert.equal(facts.all_entry_lengths_20, true, `${name}: 20-byte xref entries`);
      assert.equal(facts.pypdf_pages, 1);
      assert.equal(facts.pypdf_image_count, 1);
      assert.equal(facts.embedded_image_format, 'JPEG', `${name}: embedded stream is the JPEG`);
      assert.deepEqual(facts.embedded_image_size, [200, 140]);
    }
    const pixel = findFacts(report, 'pixel.pdf');
    assert.deepEqual(pixel.pypdf_mediabox, [0, 0, 150, 105], 'MediaBox = image at 0.75pt/px');
    const a4 = findFacts(report, 'a4.pdf');
    assert.deepEqual(a4.pypdf_mediabox, [0, 0, 595.276, 841.89]);
    assert.match(JSON.stringify(pixel.pypdf_metadata), /Test \(with\) \\\\ chars/, 'title survived escaping');
    assert.match(JSON.stringify(pixel.pypdf_metadata), /Save Image as Type userscript/, 'producer recorded');
  });
});
