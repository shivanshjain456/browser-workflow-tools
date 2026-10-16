import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGmAdapter, GmError } from '../../src/core/gm.js';

describe('createGmAdapter — nothing granted', () => {
  const gm = createGmAdapter({});

  test('every capability is reported false and calls degrade safely', async () => {
    assert.deepEqual(gm.capabilities, {
      storage: false,
      xhr: false,
      download: false,
      menuCommand: false,
      notification: false,
      valueChangeSync: false,
    });
    assert.equal(await gm.getValue('key', 'fallback'), 'fallback');
    assert.equal(await gm.setValue('key', 1), false);
    assert.equal(await gm.deleteValue('key'), false);
    assert.equal(gm.registerMenuCommand('x', () => {}), null);
    assert.equal(gm.notify('x'), false);
    assert.equal(gm.onValueChanged('k', () => {}), null);
    await assert.rejects(() => gm.xhrBlob('https://x.example/a.png'), (err) => err instanceof GmError && err.reason === 'xhr-unavailable');
    await assert.rejects(() => gm.downloadBlobUrl('blob:x', 'a.png'), (err) => err instanceof GmError && err.reason === 'unsupported');
  });

  test('manager facts are "unknown" rather than invented', () => {
    assert.equal(gm.handler, 'unknown');
    assert.equal(gm.downloadMode, 'unknown');
    assert.equal(gm.managerVersion, '');
  });
});

describe('createGmAdapter — classic GM_* manager (Tampermonkey style)', () => {
  function classicManager(overrides = {}) {
    const store = new Map();
    return Object.assign(
      {
        GM_info: { scriptHandler: 'Tampermonkey', version: '5.3.3', downloadMode: 'browser', script: { version: '1.0.0' }, injectInto: 'auto' },
        GM_getValue: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
        GM_setValue: (key, value) => {
          store.set(key, value);
        },
        GM_deleteValue: (key) => store.delete(key),
        _store: store,
      },
      overrides,
    );
  }

  test('reads manager facts from GM_info', () => {
    const gm = createGmAdapter(classicManager());
    assert.equal(gm.handler, 'Tampermonkey');
    assert.equal(gm.managerVersion, '5.3.3');
    assert.equal(gm.downloadMode, 'browser');
    assert.equal(gm.scriptVersion, '1.0.0');
    assert.equal(gm.capabilities.storage, true);
  });

  test('sync storage APIs are normalised to promises', async () => {
    const manager = classicManager();
    const gm = createGmAdapter(manager);
    assert.equal(await gm.getValue('missing', 'dflt'), 'dflt');
    assert.equal(await gm.setValue('k', 'v'), true);
    assert.equal(manager._store.get('k'), 'v');
    assert.equal(await gm.getValue('k'), 'v');
    assert.equal(await gm.deleteValue('k'), true);
    assert.equal(await gm.getValue('k', 'gone'), 'gone');
  });

  test('a throwing storage API degrades to the fallback instead of crashing', async () => {
    const gm = createGmAdapter(
      classicManager({
        GM_getValue: () => {
          throw new Error('storage exploded');
        },
        GM_setValue: () => {
          throw new Error('storage exploded');
        },
      }),
    );
    assert.equal(await gm.getValue('k', 'safe'), 'safe');
    assert.equal(await gm.setValue('k', 1), false);
  });

  test('GM_download success resolves with via:"gm"', async () => {
    const calls = [];
    const gm = createGmAdapter(
      classicManager({
        GM_download: (details) => {
          calls.push(details);
          setTimeout(() => details.onload(), 0);
          return { abort() {} };
        },
      }),
    );
    const result = await gm.downloadBlobUrl('blob:https://x/1', 'sub/photo.png', { saveAs: true });
    assert.deepEqual(result, { via: 'gm', name: 'sub/photo.png' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'blob:https://x/1');
    assert.equal(calls[0].name, 'sub/photo.png', 'the manager receives the sub-folder path');
    assert.equal(calls[0].saveAs, true);
    assert.equal(typeof calls[0].timeout, 'number');
  });

  test('every documented GM_download failure reason surfaces with an actionable message', async () => {
    const reasons = ['not_enabled', 'not_whitelisted', 'not_permitted', 'not_supported', 'not_succeeded', 'mystery'];
    for (const reason of reasons) {
      const gm = createGmAdapter(
        classicManager({
          GM_download: (details) => {
            details.onerror({ error: reason });
            return { abort() {} };
          },
        }),
      );
      await assert.rejects(
        () => gm.downloadBlobUrl('blob:x', 'a.bmp'),
        (err) => {
          assert.ok(err instanceof GmError, `${reason}: GmError`);
          assert.equal(err.reason, reason);
          assert.ok(err.message.length > 10, `${reason}: message is explanatory, got "${err.message}"`);
          return true;
        },
        reason,
      );
    }
    const gm = createGmAdapter(classicManager({ GM_download: () => { throw new Error('boom'); } }));
    await assert.rejects(() => gm.downloadBlobUrl('blob:x', 'a.png'), (err) => err.reason === 'threw' && /boom/.test(err.message));
  });

  test('a download timeout is reported distinctly', async () => {
    const gm = createGmAdapter(
      classicManager({
        GM_download: (details) => {
          details.ontimeout();
          return { abort() {} };
        },
      }),
    );
    await assert.rejects(() => gm.downloadBlobUrl('blob:x', 'a.png'), (err) => err.reason === 'timeout');
  });

  test('GM_xmlhttpRequest resolves with status, body, headers and final URL', async () => {
    let received = null;
    const gm = createGmAdapter(
      classicManager({
        GM_xmlhttpRequest: (details) => {
          received = details;
          setTimeout(
            () =>
              details.onload({
                status: 200,
                response: new Uint8Array([1, 2, 3]),
                responseHeaders: 'Content-Type: image/png\r\nCache-Control: max-age=60\r\n',
                finalUrl: 'https://cdn.example/real.png',
              }),
            0,
          );
          return { abort() {} };
        },
      }),
    );
    const res = await gm.xhrBlob('https://cdn.example/a.png', { timeout: 5000, headers: { Referer: 'https://page.example/' } });
    assert.equal(res.status, 200);
    assert.deepEqual([...res.response], [1, 2, 3]);
    assert.match(res.responseHeaders, /image\/png/i);
    assert.equal(res.finalUrl, 'https://cdn.example/real.png');
    assert.equal(received.method, 'GET');
    assert.equal(received.responseType, 'blob', 'requests bytes, not base64 text');
    assert.equal(received.timeout, 5000);
    assert.equal(received.headers.Referer, 'https://page.example/');
    assert.equal(received.headers.Accept, 'image/*,*/*');
  });

  test('network error and timeout map to distinct GmError reasons', async () => {
    const networkGm = createGmAdapter(
      classicManager({
        GM_xmlhttpRequest: (details) => {
          details.onerror({ status: 403 });
          return { abort() {} };
        },
      }),
    );
    await assert.rejects(() => networkGm.xhrBlob('https://x/a.png'), (err) => err.reason === 'network' && /403/.test(err.message));

    const timeoutGm = createGmAdapter(
      classicManager({
        GM_xmlhttpRequest: (details) => {
          details.ontimeout();
          return { abort() {} };
        },
      }),
    );
    await assert.rejects(() => timeoutGm.xhrBlob('https://x/a.png'), (err) => err.reason === 'timeout');

    const emptyGm = createGmAdapter(
      classicManager({
        GM_xmlhttpRequest: (details) => {
          details.onload({ status: 200, response: null });
          return { abort() {} };
        },
      }),
    );
    await assert.rejects(() => emptyGm.xhrBlob('https://x/a.png'), (err) => err.reason === 'empty-response');
  });

  test('an abort signal cancels the request and rejects as aborted', async () => {
    let abortCalls = 0;
    const gm = createGmAdapter(
      classicManager({
        GM_xmlhttpRequest: () => ({
          abort() {
            abortCalls += 1;
          },
        }),
      }),
    );
    const controller = new AbortController();
    const pending = gm.xhrBlob('https://x/a.png', { signal: controller.signal });
    controller.abort();
    await assert.rejects(() => pending, (err) => err.reason === 'aborted');
    assert.equal(abortCalls, 1, 'the manager request was actually aborted');

    // Already-aborted signal: never issues the request at all.
    const pre = new AbortController();
    pre.abort();
    await assert.rejects(() => gm.xhrBlob('https://x/b.png', { signal: pre.signal }), (err) => err.reason === 'aborted');
    assert.equal(abortCalls, 1, 'no second request was started');
  });

  test('notifications use the details form and fall back to the positional form', () => {
    const seen = [];
    const gm = createGmAdapter(
      classicManager({
        GM_notification: (details) => {
          seen.push(details);
        },
      }),
    );
    assert.equal(gm.notify('body', 'title', { timeout: 1234 }), true);
    assert.deepEqual(seen[0], { text: 'body', title: 'title', timeout: 1234 });
    assert.equal(gm.notify('x'.repeat(900), 't').text, undefined);
    assert.ok(seen[1].text.length <= 400, 'long text is truncated, never unbounded');
    assert.equal(gm.notify('silent', 't', { silent: true }), false);
    assert.equal(seen.length, 2, 'silent notifications are not sent');
  });

  test('menu commands are registered and tolerate a throwing manager', () => {
    const registered = [];
    const gm = createGmAdapter(
      classicManager({
        GM_registerMenuCommand: (label, handler, key) => {
          registered.push([label, typeof handler, key]);
          return registered.length;
        },
      }),
    );
    assert.equal(gm.registerMenuCommand('Settings…', () => {}, 's'), 1);
    assert.deepEqual(registered[0], ['Settings…', 'function', 's']);

    const throwing = createGmAdapter(
      classicManager({
        GM_registerMenuCommand: () => {
          throw new Error('nope');
        },
      }),
    );
    assert.equal(throwing.registerMenuCommand('x', () => {}), null);
  });

  test('value-change listeners can be disposed', () => {
    let removed = null;
    const gm = createGmAdapter(
      classicManager({
        GM_addValueChangeListener: (key, handler) => {
          assert.equal(typeof handler, 'function');
          return 7;
        },
        GM_removeValueChangeListener: (id) => {
          removed = id;
        },
      }),
    );
    const subscription = gm.onValueChanged('k', () => {});
    assert.ok(subscription);
    subscription.dispose();
    assert.equal(removed, 7);
  });
});

describe('createGmAdapter — GM.* namespace manager (Violentmonkey/GM4 style)', () => {
  test('async GM.* functions are awaited like the sync GM_* ones', async () => {
    const store = new Map();
    const gm = createGmAdapter({
      GM: {
        info: { scriptHandler: 'Violentmonkey', version: '2.70.0', downloadMode: 'native', injectInto: 'content' },
        getValue: async (key, fallback) => (store.has(key) ? store.get(key) : fallback),
        setValue: async (key, value) => {
          store.set(key, value);
        },
        download: async (details) => {
          details.onload();
        },
        xmlHttpRequest: async (details) => {
          details.onload({ status: 200, response: new Uint8Array([9]) });
          return { abort() {} };
        },
      },
    });
    assert.equal(gm.handler, 'Violentmonkey');
    assert.equal(gm.downloadMode, 'native');
    assert.equal(gm.injectInto, 'content');
    assert.equal(gm.capabilities.storage, true);
    assert.equal(gm.capabilities.download, true);
    assert.equal(await gm.getValue('a', 'd'), 'd');
    assert.equal(await gm.setValue('a', 2), true);
    assert.equal(await gm.getValue('a'), 2);
    const res = await gm.downloadBlobUrl('blob:x', 'a.png');
    assert.equal(res.via, 'gm');
    const xhr = await gm.xhrBlob('https://x/a.png');
    assert.deepEqual([...xhr.response], [9]);
  });

  test('GM_* wins when a manager exposes both spellings', async () => {
    const calls = [];
    const gm = createGmAdapter({
      GM_getValue: (k, d) => {
        calls.push('classic');
        return 'classic-value';
      },
      GM: {
        getValue: (k, d) => {
          calls.push('namespace');
          return Promise.resolve('namespace-value');
        },
      },
    });
    assert.equal(await gm.getValue('k'), 'classic-value');
    assert.deepEqual(calls, ['classic'], 'the granted GM_* binding is preferred');
  });
});
