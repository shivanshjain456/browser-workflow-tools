import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeFrames, animationCapability, resetAnimationCapabilityForTest } from '../../src/core/frames.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = (name) => readFileSync(join(HERE, '..', 'fixtures', name));

// jsdom is a dev dependency; if it is missing the DOM tests report a skip with
// the reason instead of failing, so the suite never claims a result it did not get.
let JSDOM = null;
let SKIP_DOM = false;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (err) {
  SKIP_DOM = `jsdom unavailable (${err.code || err.message}) — run \`npm install\` to enable the DOM tests`;
}

/**
 * Frame extraction is the one part of the GIF path a byte-level test cannot
 * cover: it needs a WebCodecs ImageDecoder and a 2D canvas. Both are stubbed
 * here so the *logic* around them is pinned down — including the quirk that
 * made a real browser silently produce a one-frame GIF:
 *
 *   Chromium reports codedWidth/codedHeight = 0 on a GIF track until a frame has
 *   been decoded. Bailing out on 0x0 lost the whole animation, so the decoder is
 *   now asked for frame 0 and its display size is used instead.
 *
 * The real browser behaviour (4 frames out, 100 ms each, pixels within tolerance)
 * is verified separately by test/browser/run.mjs against Pillow.
 */

let dom = null;
let drawCalls = null;

function installDom() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://page.example/gallery' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  drawCalls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = function stub() {
    const canvas = this;
    return {
      canvas,
      clearRect() {},
      drawImage(image) {
        drawCalls.push({ w: image.displayWidth, h: image.displayHeight });
      },
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    };
  };
}

function teardownDom() {
  if (dom) dom.window.close();
  dom = null;
  drawCalls = null;
  for (const key of ['window', 'document', 'HTMLCanvasElement']) delete globalThis[key];
}

/**
 * @param {object} options
 * @param {number} options.frameCount     frames the track advertises
 * @param {number} options.codedWidth     0 reproduces the Chromium GIF quirk
 * @param {number} options.displayWidth   size reported by a decoded frame
 * @param {number|null} options.throwOn   frame index whose decode() rejects
 */
function installDecoderStub({
  frameCount = 4,
  codedWidth = 0,
  codedHeight = 0,
  displayWidth = 50,
  displayHeight = 40,
  durationUs = 100000,
  throwOn = null,
  supported = ['image/gif', 'image/webp', 'image/png', 'image/avif'],
} = {}) {
  const calls = { configs: [], decoded: [], closed: 0, imagesClosed: 0 };
  class StubImage {
    constructor(index) {
      this.displayWidth = displayWidth;
      this.displayHeight = displayHeight;
      this.codedWidth = displayWidth;
      this.codedHeight = displayHeight;
      this.timestamp = index * durationUs;
      this.duration = durationUs;
    }

    close() {
      calls.imagesClosed += 1;
    }
  }
  class StubImageDecoder {
    constructor(config) {
      calls.configs.push(config);
      this.tracks = {
        ready: Promise.resolve(),
        length: 1,
        selectedTrack: { frameCount, codedWidth, codedHeight, displayWidth: codedWidth, displayHeight: codedHeight },
      };
    }

    async decode({ frameIndex }) {
      calls.decoded.push(frameIndex);
      if (throwOn !== null && throwOn !== undefined && frameIndex === throwOn) throw new Error('stub decode failure');
      return { image: new StubImage(frameIndex), complete: true };
    }

    close() {
      calls.closed += 1;
    }

    static async isTypeSupported(type) {
      return supported.includes(type);
    }
  }
  globalThis.ImageDecoder = StubImageDecoder;
  return calls;
}

describe('decodeFrames — WebCodecs path (stubbed decoder and canvas)', { skip: SKIP_DOM }, () => {
  beforeEach(() => {
    installDom();
    resetAnimationCapabilityForTest();
  });
  afterEach(() => {
    delete globalThis.ImageDecoder;
    resetAnimationCapabilityForTest();
    teardownDom();
  });

  test('the capability probe reports the stubbed decoder and its supported types', async () => {
    installDecoderStub({ supported: ['image/gif', 'image/webp'] });
    const capability = await animationCapability();
    assert.equal(capability.decoderAvailable, true);
    assert.deepEqual(Object.keys(capability.types).filter((type) => capability.types[type]), ['image/gif', 'image/webp']);
    assert.equal(capability.reason, '', 'no excuse is invented when decoding is available');
  });

  test('REGRESSION: a track that reports 0x0 (Chromium GIF) is decoded using frame 0', async () => {
    const calls = installDecoderStub({ frameCount: 4, codedWidth: 0, codedHeight: 0, displayWidth: 50, displayHeight: 40 });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif' });
    assert.equal(result.animated, true);
    assert.equal(result.frameCount, 4);
    assert.equal(result.frames.length, 4, 'all four frames were extracted');
    assert.equal(result.width, 50, 'the width came from the decoded frame, not the empty track');
    assert.equal(result.height, 40);
    assert.equal(calls.decoded.filter((index) => index === 0).length, 1, 'frame 0 was decoded once and reused, not twice');
    assert.equal(drawCalls.length, 4, 'every frame was drawn into the canvas');
    assert.equal(calls.closed, 1, 'the decoder was closed');
    assert.equal(calls.imagesClosed, 4, 'every VideoFrame was released');
  });

  test('frame delays come from the decoder (microseconds → ms)', async () => {
    installDecoderStub({ frameCount: 3, durationUs: 120000 });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif' });
    assert.deepEqual(result.frames.map((frame) => frame.delayMs), [120, 120, 120]);
  });

  test('a decoder that reports a single frame does not claim animation', async () => {
    installDecoderStub({ frameCount: 1 });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif' });
    assert.deepEqual(result.frames, []);
    assert.equal(result.animated, false);
    assert.match(result.notes.join(' '), /single frame/i);
  });

  test('the frame limit subsamples and tells the user', async () => {
    const calls = installDecoderStub({ frameCount: 12 });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif', maxFrames: 4 });
    assert.equal(result.frames.length, 4, `4 frames kept, got ${result.frames.length}`);
    assert.ok(calls.decoded.length <= 4, 'only the kept frames were decoded');
    assert.match(result.notes.join(' '), /skipped to respect the 4-frame limit/i, result.notes.join(' | '));
  });

  test('the memory limit scales frames down instead of crashing the tab', async () => {
    installDecoderStub({ frameCount: 4, displayWidth: 4000, displayHeight: 3000 });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif', memoryLimitMB: 1 });
    assert.equal(result.animated, true);
    assert.ok(result.width < 4000, `frames were scaled down (width ${result.width})`);
    assert.match(result.notes.join(' '), /scaled to \d+% .*1 MB GIF memory limit/i, result.notes.join(' | '));
  });

  test('a decoder failure degrades to an honest note, and still closes the decoder', async () => {
    const calls = installDecoderStub({ frameCount: 4, throwOn: 2 });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif' });
    assert.deepEqual(result.frames, []);
    assert.equal(result.animated, false);
    assert.match(result.notes.join(' '), /Frame decoding failed \(stub decode failure\)/, result.notes.join(' | '));
    assert.equal(calls.closed, 1, 'the decoder is closed even when decoding throws');
  });

  test('the caller keeps its bytes: the decoder gets a copy', async () => {
    const calls = installDecoderStub({ frameCount: 4 });
    const bytes = FIXTURE('animated.gif');
    const before = bytes.slice(0, 6);
    await decodeFrames({ bytes, mime: 'image/gif' });
    const config = calls.configs[0];
    assert.equal(config.type, 'image/gif');
    assert.equal(config.data instanceof ArrayBuffer, true, 'ImageDecoder receives a transferable buffer');
    assert.equal(config.data.byteLength, bytes.byteLength);
    assert.deepEqual(bytes.slice(0, 6), before, 'the source bytes are untouched (the "Original file" path still needs them)');
  });

  test('an unsupported container never reaches the decoder', async () => {
    const calls = installDecoderStub({ supported: ['image/webp'] });
    const result = await decodeFrames({ bytes: FIXTURE('animated.gif'), mime: 'image/gif' });
    assert.deepEqual(result.frames, []);
    assert.deepEqual(calls.configs, [], 'no decoder was constructed');
    assert.match(result.notes.join(' '), /cannot decode image\/gif/i, result.notes.join(' | '));
  });
});
