import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectAnimation, sniffMime, animationCapability, decodeFrames } from '../../src/core/frames.js';

const FIXTURE = (name) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

describe('detectAnimation — real container files produced by Pillow', () => {
  test('animated GIF: frame count and total duration from the block walk', () => {
    const result = detectAnimation(FIXTURE('animated.gif'));
    assert.equal(result.format, 'image/gif');
    assert.equal(result.animated, true);
    assert.equal(result.frameCount, 4, 'Pillow wrote 4 frames');
    assert.equal(result.totalDelayMs, 400, '4 frames x 100ms, read from the GCE delays');
  });

  test('animated WebP: ANIM/ANMF chunks detected', () => {
    const result = detectAnimation(FIXTURE('animated.webp'));
    assert.equal(result.format, 'image/webp');
    assert.equal(result.animated, true);
    assert.equal(result.frameCount, 3, 'three ANMF chunks');
  });

  test('APNG: acTL chunk detected', () => {
    const result = detectAnimation(FIXTURE('animated.apng'));
    assert.equal(result.format, 'image/png');
    assert.equal(result.animated, true);
    assert.equal(result.frameCount, 3, 'acTL declares 3 frames');
  });

  test('still images are reported as not animated', () => {
    for (const [name, format] of [
      ['still.webp', 'image/webp'],
      ['opaque.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['icon.bmp', 'image/bmp'],
      ['tiny.png', 'image/png'],
    ]) {
      const result = detectAnimation(FIXTURE(name));
      assert.equal(result.animated, false, `${name} must not be reported as animated`);
      assert.equal(result.format, format, `${name} format`);
    }
  });

  test('non-image input is handled without throwing', () => {
    const svg = FIXTURE('logo.svg');
    const result = detectAnimation(svg);
    assert.equal(result.animated, false);
    assert.ok(typeof result.format === 'string');

    for (const bytes of [new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(500).fill(0xff)]) {
      assert.doesNotThrow(() => detectAnimation(bytes), `${bytes.length} bytes of junk`);
    }
  });

  test('truncated containers degrade instead of crashing', () => {
    const full = FIXTURE('animated.gif');
    for (const cut of [6, 13, 20, 40, full.length - 1]) {
      const truncated = full.subarray(0, cut);
      const result = detectAnimation(truncated);
      assert.equal(typeof result.animated, 'boolean', `cut at ${cut}`);
      assert.ok(result.frameCount === null || result.frameCount >= 0);
    }
    const webp = FIXTURE('animated.webp');
    for (const cut of [12, 20, 30, webp.length - 5]) {
      assert.doesNotThrow(() => detectAnimation(webp.subarray(0, cut)), `webp cut at ${cut}`);
    }
    const apng = FIXTURE('animated.apng');
    for (const cut of [8, 20, 33, apng.length - 4]) {
      assert.doesNotThrow(() => detectAnimation(apng.subarray(0, cut)), `apng cut at ${cut}`);
    }
  });

  test('a single-frame GIF is not reported as animated', () => {
    // GIF89a, 1x1, one image descriptor
    const single = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
      0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ]);
    const result = detectAnimation(single);
    assert.equal(result.animated, false);
    assert.equal(result.frameCount, 1);
  });

  test('a WebP without the animation flag is still, even with a VP8X chunk', () => {
    const bytes = new Uint8Array(64);
    const write = (at, text) => {
      for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
    };
    write(0, 'RIFF');
    bytes[4] = 56;
    write(8, 'WEBP');
    write(12, 'VP8X');
    bytes[16] = 10; // chunk size
    bytes[20] = 0x10; // flags: alpha only, NOT animation (bit 1)
    const result = detectAnimation(bytes);
    assert.equal(result.format, 'image/webp');
    assert.equal(result.animated, false, 'alpha-only VP8X is not animation');
    bytes[20] = 0x12; // set the animation bit
    assert.equal(detectAnimation(bytes).animated, true, 'animation bit flips the verdict');
  });
});

describe('sniffMime — content sniffing for the "Original file" path', () => {
  test('identifies the fixtures by magic bytes, not by extension', () => {
    assert.equal(sniffMime(FIXTURE('photo.jpg')), 'image/jpeg');
    assert.equal(sniffMime(FIXTURE('opaque.png')), 'image/png');
    assert.equal(sniffMime(FIXTURE('animated.gif')), 'image/gif');
    assert.equal(sniffMime(FIXTURE('still.webp')), 'image/webp');
    assert.equal(sniffMime(FIXTURE('icon.bmp')), 'image/bmp');
    assert.equal(sniffMime(FIXTURE('logo.svg')), '', 'SVG has no magic bytes; the caller keeps the URL hint');
    assert.equal(sniffMime(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])), 'image/avif');
    assert.equal(sniffMime(new Uint8Array(2)), '');
    assert.equal(sniffMime(null), '');
  });
});

describe('frame decoding without WebCodecs — honest degradation', () => {
  test('capability probe reports the absence of ImageDecoder in this runtime', async () => {
    const capability = await animationCapability();
    assert.equal(capability.decoderAvailable, typeof ImageDecoder === 'function');
    if (!capability.decoderAvailable) {
      assert.match(capability.reason, /ImageDecoder/, 'the reason names the missing API');
      assert.deepEqual(capability.types, {});
    }
    // Cached: a second call must not re-probe.
    assert.equal(await animationCapability(), capability);
  });

  test('decodeFrames resolves with an explanatory note instead of throwing', async () => {
    const result = await decodeFrames({ bytes: FIXTURE('animated.webp'), mime: 'image/webp' });
    assert.deepEqual(result.frames, [], 'no frames invented');
    assert.equal(result.animated, false);
    assert.ok(result.notes.length >= 1);
    assert.match(result.notes[0], /ImageDecoder|frames/i);
  });

  test('decodeFrames reports an unsupported container type without touching the decoder', async () => {
    const result = await decodeFrames({ bytes: FIXTURE('photo.jpg'), mime: 'image/tiff-not-real' });
    assert.deepEqual(result.frames, []);
    assert.ok(result.notes.length >= 1);
  });

  test('an aborted signal is honoured where a decoder exists', async () => {
    const capability = await animationCapability();
    if (!capability.decoderAvailable) return; // nothing to abort in this runtime
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif', signal: controller.signal }),
      /cancel/i,
    );
  });
});
