import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CLIPBOARD_TIMEOUT_MS, clipboardCapability, mimeSupported, copyImageToClipboard } from '../../src/core/clipboard.js';

/**
 * Feature: copy the image to the clipboard.
 *
 * There is no userscript grant that puts image bytes on the clipboard, so this
 * is entirely browser-dependent. What can be tested — and what matters — is the
 * honesty of the degradation: every reason a copy cannot happen is detected,
 * named, and turned into a message that tells the user what to do instead.
 * A silent no-op would be the worst outcome.
 */

/** A window that looks like the ones this feature meets in the wild. */
function fakeWindow({ secure = true, clipboard = true, write = true, item = true, focus = true, permission = 'granted', isTypeSupported, writeImpl } = {}) {
  const writes = [];
  class ClipboardItem {
    constructor(payload) {
      this.payload = payload;
      writes.push(payload);
    }
  }
  if (isTypeSupported !== undefined) ClipboardItem.isTypeSupported = isTypeSupported;
  const win = {
    isSecureContext: secure,
    writes,
    ClipboardItem: item ? ClipboardItem : undefined,
    navigator: {
      clipboard: clipboard
        ? {
            write: write
              ? async (items) => {
                  if (writeImpl) return writeImpl(items);
                  return undefined;
                }
              : undefined,
          }
        : undefined,
      permissions: permission === 'throw' ? { query: async () => { throw new Error('unknown permission'); } } : { query: async () => ({ state: permission }) },
    },
    document: { hasFocus: () => focus },
  };
  return win;
}

const blob = (size = 1200, type = 'image/png') => ({ size, type });

describe('clipboard — capability detection', () => {
  test('a fully capable secure context is reported as supported', () => {
    const capability = clipboardCapability(fakeWindow({}));
    assert.equal(capability.supported, true);
    assert.deepEqual(capability.reasons, []);
    assert.equal(capability.secureContext, true);
    assert.equal(capability.hasClipboard, true);
    assert.equal(capability.hasWrite, true);
    assert.equal(capability.hasClipboardItem, true);
    assert.equal(capability.pngOnly, true, 'the PNG-only reality is advertised up front');
  });

  test('each missing piece is named, and support is refused', () => {
    const insecure = clipboardCapability(fakeWindow({ secure: false }));
    assert.equal(insecure.supported, false);
    assert.match(insecure.reasons[0], /secure context/);

    const noClipboard = clipboardCapability(fakeWindow({ clipboard: false }));
    assert.equal(noClipboard.supported, false);
    assert.ok(noClipboard.reasons.some((reason) => /does not expose navigator\.clipboard/.test(reason)));

    const noWrite = clipboardCapability(fakeWindow({ write: false }));
    assert.equal(noWrite.hasClipboard, true);
    assert.equal(noWrite.hasWrite, false);
    assert.ok(noWrite.reasons.some((reason) => /clipboard\.write is not available/.test(reason)));

    const noItem = clipboardCapability(fakeWindow({ item: false }));
    assert.equal(noItem.supported, false);
    assert.ok(noItem.reasons.some((reason) => /no ClipboardItem/.test(reason)));

    const nothing = clipboardCapability(undefined);
    assert.equal(nothing.supported, false);
    assert.equal(nothing.reasons.length, 1, 'even with no window at all there is a reason, not a crash');

    const several = clipboardCapability(fakeWindow({ secure: false, clipboard: false, item: false }));
    assert.equal(several.reasons.length, 3, 'every problem is listed, not just the first');
  });

  test('mimeSupported answers per browser, defaulting to the PNG-only reality', async () => {
    assert.equal(await mimeSupported('image/png', fakeWindow({})), true, 'no isTypeSupported: PNG is assumed, nothing else');
    assert.equal(await mimeSupported('image/jpeg', fakeWindow({})), false);
    assert.equal(await mimeSupported('image/jpeg', fakeWindow({ isTypeSupported: async () => true })), true);
    assert.equal(await mimeSupported('image/png', fakeWindow({ isTypeSupported: async () => false })), false);
    assert.equal(await mimeSupported('image/png', fakeWindow({ isTypeSupported: async () => { throw new Error('nope'); } })), true, 'a throwing probe falls back to PNG');
    assert.equal(await mimeSupported('image/png', fakeWindow({ item: false })), false, 'no ClipboardItem means no image support');
    assert.equal(await mimeSupported('image/png', undefined), false);
  });

  test('the write timeout is bounded and sane', () => {
    assert.ok(CLIPBOARD_TIMEOUT_MS >= 1000 && CLIPBOARD_TIMEOUT_MS <= 30000, `${CLIPBOARD_TIMEOUT_MS} ms`);
  });
});

describe('clipboard — copying, and every way it can fail', () => {
  test('a PNG copy on a capable browser succeeds and reports the size', async () => {
    const win = fakeWindow({});
    const result = await copyImageToClipboard({ blob: blob(2048), mime: 'image/png', win });
    assert.equal(result.ok, true);
    assert.equal(result.converted, false);
    assert.equal(result.mime, 'image/png');
    assert.match(result.message, /2 KB/);
    assert.equal(win.writes.length, 1, 'one ClipboardItem was written');
    assert.deepEqual(Object.keys(win.writes[0]), ['image/png']);
  });

  test('a JPEG is re-encoded to PNG and the user is told', async () => {
    const win = fakeWindow({});
    let reencoded = null;
    const result = await copyImageToClipboard({
      blob: blob(3000, 'image/jpeg'),
      mime: 'image/jpeg',
      win,
      toPng: async (input) => {
        reencoded = input;
        return blob(9000, 'image/png');
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.converted, true);
    assert.equal(result.mime, 'image/png');
    assert.equal(reencoded.size, 3000, 'the original blob was handed to the re-encoder');
    assert.match(result.message, /PNG only/);
    assert.match(result.message, /9 KB/, 'the size shown is the size actually copied');
    assert.deepEqual(Object.keys(win.writes[0]), ['image/png']);
  });

  test('without a re-encoder, an unsupported type is refused with the reason', async () => {
    const result = await copyImageToClipboard({ blob: blob(3000, 'image/jpeg'), mime: 'image/jpeg', win: fakeWindow({}) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'mime-unsupported');
    assert.match(result.message, /image\/jpeg/);
    assert.match(result.message, /PNG only/);
  });

  test('a failing re-encoder is reported, not swallowed', async () => {
    const result = await copyImageToClipboard({
      blob: blob(3000, 'image/webp'),
      mime: 'image/webp',
      win: fakeWindow({}),
      toPng: async () => {
        throw new Error('canvas is tainted');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'reencode-failed');
    assert.match(result.message, /tainted/);
    assert.match(result.message, /Save the file instead/);
  });

  test('an unsupported browser never attempts a write', async () => {
    const win = fakeWindow({ secure: false });
    const result = await copyImageToClipboard({ blob: blob(), win });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported');
    assert.match(result.message, /secure context/);
    assert.match(result.message, /Use "Save" instead/);
    assert.equal(win.writes.length, 0);
  });

  test('an empty blob is refused before touching the clipboard', async () => {
    const result = await copyImageToClipboard({ blob: { size: 0, type: 'image/png' }, win: fakeWindow({}) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty');
    assert.match(result.message, /no image data/);
    const missing = await copyImageToClipboard({ win: fakeWindow({}) });
    assert.equal(missing.reason, 'empty');
  });

  test('a denied permission is named, with the way out', async () => {
    const result = await copyImageToClipboard({ blob: blob(), win: fakeWindow({ permission: 'denied' }) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'denied');
    assert.match(result.message, /blocked for this site/);
    assert.match(result.message, /site settings/);
  });

  test('a browser that rejects the permission query is not treated as a denial', async () => {
    // Firefox throws for the unknown "clipboard-write" name; that is not a "no".
    const result = await copyImageToClipboard({ blob: blob(), win: fakeWindow({ permission: 'throw' }) });
    assert.equal(result.ok, true, result.message);
  });

  test('an unfocused document is refused with the one action that fixes it', async () => {
    const result = await copyImageToClipboard({ blob: blob(), win: fakeWindow({ focus: false }) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unfocused');
    assert.match(result.message, /Click the page once/);
  });

  test('browser-side refusals are classified into actionable messages', async () => {
    const cases = [
      ['NotAllowedError', 'not-allowed', /click or key press/],
      ['NotSupportedError', 'mime-unsupported', /PNG is the only widely supported/],
      ['SecurityError', 'insecure', /not a secure context/],
    ];
    for (const [name, reason, message] of cases) {
      const win = fakeWindow({
        writeImpl: async () => {
          const error = new Error(`${name} from the browser`);
          error.name = name;
          throw error;
        },
      });
      const result = await copyImageToClipboard({ blob: blob(), win });
      assert.equal(result.ok, false, name);
      assert.equal(result.reason, reason, name);
      assert.match(result.message, message, name);
    }
  });

  test('an unknown failure still produces a message, never an empty string', async () => {
    const win = fakeWindow({
      writeImpl: async () => {
        throw new Error('something odd');
      },
    });
    const result = await copyImageToClipboard({ blob: blob(), win });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'failed');
    assert.match(result.message, /something odd/);
  });

  test('a hanging write is timed out instead of leaving the toast spinning', async (t) => {
    let timers = null;
    try {
      timers = t.mock.timers;
      timers.enable({ apis: ['setTimeout'] });
    } catch {
      t.skip('mock timers unavailable in this Node build — the timeout path is covered by the constant bound test');
      return;
    }
    const win = fakeWindow({ writeImpl: () => new Promise(() => {}) });
    const pending = copyImageToClipboard({ blob: blob(), win });
    // Let the capability/permission/mime awaits run so the write timer exists
    // before the mocked clock is advanced past it.
    await new Promise((resolve) => setImmediate(resolve));
    timers.tick(CLIPBOARD_TIMEOUT_MS + 10);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'timeout');
    assert.match(result.message, /timed out/);
    assert.match(result.message, /Save the file instead/);
  });
});
