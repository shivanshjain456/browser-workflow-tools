// SPDX-License-Identifier: MIT
// ==UserScript==
// @name         Web Archives
// @namespace    https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/web-archives
// @version      8.0.0
// @description  Find archived and cached versions of any web page — Wayback Machine, Archive.today, Perma.cc, Ghostarchive, Megalodon, WebCite, Software Heritage, Yandex — from a keyboard-driven in-page launcher, a right-click menu, or automatically when a page fails to load.
// @author       Shivansh Jain
// @license      MIT
// @homepageURL  https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/web-archives
// @supportURL   https://github.com/shivanshjain456/browser-workflow-tools/issues
// @downloadURL  https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/web-archives/web-archives.user.js
// @updateURL    https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/web-archives/web-archives.user.js
// @match        *://*/*
// @exclude-match *://*/*.pdf*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      archive.org
// @connect      web.archive.org
// @connect      api.perma.cc
// @connect      archive.softwareheritage.org
// @connect      archive.ph
// @connect      archive.today
// @connect      archive.is
// @connect      archive.li
// @connect      archive.vn
// @connect      archive.fo
// @connect      archive.md
// @connect      ghostarchive.org
// @connect      megalodon.jp
// ==/UserScript==

(function () {
  'use strict';

  /* =======================================================================
   * SECTION 01 — Environment, capabilities and the userscript-manager bridge
   * -----------------------------------------------------------------------
   *   - probes the host userscript manager once and records what it can do,
   *   - exposes a uniform async API over the GM_* functions,
   *   - degrades to a documented, still-useful fallback whenever a grant is
   *     unavailable (Greasemonkey 4, Userscripts for Safari, Orion, ...).
   * Nothing outside this module touches a GM_* symbol, so capability
   * differences never leak into product code.
   * ==================================================================== */

  const APP_ID = 'web-archives';
  const APP_NAME = 'Web Archives';
  const APP_VERSION = '8.0.0';

  /* ---------------------------------------------------------------- logging */

  const LOG_PREFIX = `[${APP_NAME}]`;

  const logRing = [];
  const LOG_RING_MAX = 200;

  let debugEnabled = false;

  function recordLog(level, args) {
    let text;
    try {
      text = args
        .map(a => {
          if (typeof a === 'string') return a;
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
    } catch {
      text = '<unserialisable>';
    }

    logRing.push({time: Date.now(), level, text: text.slice(0, 2000)});
    if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX);
  }

  const log = {
    debug(...args) {
      recordLog('debug', args);
      if (debugEnabled) console.debug(LOG_PREFIX, ...args);
    },
    info(...args) {
      recordLog('info', args);
      if (debugEnabled) console.info(LOG_PREFIX, ...args);
    },
    warn(...args) {
      recordLog('warn', args);
      console.warn(LOG_PREFIX, ...args);
    },
    error(...args) {
      recordLog('error', args);
      console.error(LOG_PREFIX, ...args);
    },
    setDebug(value) {
      debugEnabled = !!value;
    },
    isDebug() {
      return debugEnabled;
    },
    entries() {
      return logRing.slice();
    },
    clear() {
      logRing.length = 0;
    }
  };

  /* ------------------------------------------------------- capability probe */

  /**
   * `typeof x !== 'undefined'` is evaluated defensively: some managers define
   * the identifier as a getter that throws when the grant was not requested.
   */
  function probe(name) {
    try {
      // eslint-disable-next-line no-eval
      const value = typeof globalThis[name] !== 'undefined' ? globalThis[name] : undefined;
      return typeof value === 'function' ? value : null;
    } catch {
      return null;
    }
  }

  const gm = {
    getValue: probe('GM_getValue'),
    setValue: probe('GM_setValue'),
    deleteValue: probe('GM_deleteValue'),
    listValues: probe('GM_listValues'),
    addValueChangeListener: probe('GM_addValueChangeListener'),
    removeValueChangeListener: probe('GM_removeValueChangeListener'),
    registerMenuCommand: probe('GM_registerMenuCommand'),
    unregisterMenuCommand: probe('GM_unregisterMenuCommand'),
    openInTab: probe('GM_openInTab'),
    setClipboard: probe('GM_setClipboard'),
    notification: probe('GM_notification'),
    xmlhttpRequest: probe('GM_xmlhttpRequest')
  };

  let gmInfo = null;
  try {
    gmInfo = typeof GM_info !== 'undefined' ? GM_info : null;
  } catch {
    gmInfo = null;
  }

  const managerName = (() => {
    const raw = gmInfo?.scriptHandler || '';
    const lower = String(raw).toLowerCase();
    if (lower.includes('tampermonkey')) return 'tampermonkey';
    if (lower.includes('violentmonkey')) return 'violentmonkey';
    if (lower.includes('greasemonkey')) return 'greasemonkey';
    if (lower.includes('userscripts')) return 'userscripts';
    if (lower.includes('adguard')) return 'adguard';
    if (lower.includes('orion')) return 'orion';
    if (lower.includes('firemonkey')) return 'firemonkey';
    return lower ? lower.replace(/\s+/g, '-') : 'unknown';
  })();

  const capabilities = Object.freeze({
    manager: managerName,
    managerVersion: String(gmInfo?.version || ''),
    persistentStorage: !!(gm.getValue && gm.setValue),
    storageEvents: !!(gm.addValueChangeListener && gm.removeValueChangeListener),
    menuCommands: !!gm.registerMenuCommand,
    dynamicMenuCommands: !!(gm.registerMenuCommand && gm.unregisterMenuCommand),
    openInTab: !!gm.openInTab,
    clipboard: !!gm.setClipboard,
    notifications: !!gm.notification,
    crossOriginRequests: !!gm.xmlhttpRequest,
    // `unsafeWindow` is only used to reach page-context globals; never to grant
    // the page access to privileged APIs.
    unsafeWindow: (() => {
      try {
        return typeof unsafeWindow !== 'undefined' && unsafeWindow !== window;
      } catch {
        return false;
      }
    })(),
    trustedTypes: typeof globalThis.trustedTypes !== 'undefined'
  });

  /* -------------------------------------------------------------- platform */

  const ua = (() => {
    try {
      return String(navigator.userAgent || '');
    } catch {
      return '';
    }
  })();

  function detectOs() {
    const uaData = navigator.userAgentData;
    const hinted = uaData && typeof uaData.platform === 'string' ? uaData.platform.toLowerCase() : '';
    if (hinted.includes('android')) return 'android';
    if (hinted.includes('windows')) return 'windows';
    if (hinted.includes('macos')) return 'macos';
    if (hinted.includes('chrome os')) return 'chromeos';
    if (hinted.includes('linux')) return 'linux';

    if (/android/i.test(ua)) return 'android';
    if (/cros/i.test(ua)) return 'chromeos';
    if (/iphone|ipod/i.test(ua)) return 'ios';
    // iPadOS reports as Macintosh but exposes touch points.
    if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1)) {
      return 'ipados';
    }
    if (/mac os x|macintosh/i.test(ua)) return 'macos';
    if (/windows/i.test(ua)) return 'windows';
    if (/linux|x11|bsd/i.test(ua)) return 'linux';
    return 'unknown';
  }

  const os = detectOs();

  const platform = Object.freeze({
    os,
    isWindows: os === 'windows',
    isMacos: os === 'macos',
    isLinux: os === 'linux',
    isChromeos: os === 'chromeos',
    isAndroid: os === 'android',
    isIos: os === 'ios',
    isIpados: os === 'ipados',
    isMobile: ['android', 'ios', 'ipados'].includes(os),
    isApple: ['macos', 'ios', 'ipados'].includes(os),
    isFirefox: /\bfirefox\//i.test(ua) || /\bgecko\//i.test(ua) && !/\bchrome\//i.test(ua),
    isEdge: /\bedg(?:e|a|ios)?\//i.test(ua),
    isOpera: /\bopr\//i.test(ua) || /\bopera\//i.test(ua),
    isSafari: /\bsafari\//i.test(ua) && !/\bchrome\//i.test(ua) && !/\bchromium\//i.test(ua),
    isChromium: /\bchrome\/|\bchromium\//i.test(ua)
  });

  /**
   * Primary modifier for keyboard shortcuts: ⌘ on Apple platforms, Ctrl
   * elsewhere. Used for labelling as well as matching.
   */
  const primaryModifier = platform.isApple ? 'meta' : 'ctrl';

  /* --------------------------------------------------------------- storage */

  /**
   * A tiny in-memory fallback store so that the product still functions (for
   * the lifetime of the page) when no storage grant exists. Callers cannot
   * tell the difference apart from `capabilities.persistentStorage`.
   */
  const memoryStore = new Map();

  async function storageGet(key, fallback) {
    if (!gm.getValue) {
      return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    }
    try {
      const value = await gm.getValue(key, undefined);
      return value === undefined ? fallback : value;
    } catch (err) {
      log.warn('storage read failed', key, err);
      return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    }
  }

  async function storageSet(key, value) {
    memoryStore.set(key, value);
    if (!gm.setValue) return false;
    try {
      await gm.setValue(key, value);
      return true;
    } catch (err) {
      log.warn('storage write failed', key, err);
      return false;
    }
  }

  async function storageDelete(key) {
    memoryStore.delete(key);
    if (!gm.deleteValue) return false;
    try {
      await gm.deleteValue(key);
      return true;
    } catch (err) {
      log.warn('storage delete failed', key, err);
      return false;
    }
  }

  async function storageKeys() {
    if (!gm.listValues) return [...memoryStore.keys()];
    try {
      const keys = await gm.listValues();
      return Array.isArray(keys) ? keys : [...memoryStore.keys()];
    } catch (err) {
      log.warn('storage list failed', err);
      return [...memoryStore.keys()];
    }
  }

  /**
   * Cross-tab change notification. Returns a disposer; never throws.
   */
  function storageWatch(key, callback) {
    if (!gm.addValueChangeListener) return () => {};

    let handle;
    try {
      handle = gm.addValueChangeListener(key, (name, oldValue, newValue, remote) => {
        try {
          callback({key: name, oldValue, newValue, remote: !!remote});
        } catch (err) {
          log.error('storage watcher threw', err);
        }
      });
    } catch (err) {
      log.warn('storage watch failed', key, err);
      return () => {};
    }

    return () => {
      try {
        gm.removeValueChangeListener?.(handle);
      } catch {
        /* the listener dies with the page anyway */
      }
    };
  }

  /* ----------------------------------------------------------- menu commands */

  const registeredMenuCommands = new Map();

  function registerMenuCommand(id, caption, handler, options = {}) {
    if (!gm.registerMenuCommand) return false;

    unregisterMenuCommand(id);

    try {
      // Tampermonkey accepts an options object; older managers accept an
      // access-key string; Greasemonkey 4 accepts neither. Try richest first.
      let handle;
      try {
        handle = gm.registerMenuCommand(caption, handler, {
          id,
          accessKey: options.accessKey,
          autoClose: options.autoClose !== false,
          title: options.title
        });
      } catch {
        handle = gm.registerMenuCommand(caption, handler, options.accessKey);
      }
      registeredMenuCommands.set(id, handle === undefined ? id : handle);
      return true;
    } catch (err) {
      log.warn('menu command registration failed', caption, err);
      return false;
    }
  }

  function unregisterMenuCommand(id) {
    if (!registeredMenuCommands.has(id)) return;
    const handle = registeredMenuCommands.get(id);
    registeredMenuCommands.delete(id);
    try {
      gm.unregisterMenuCommand?.(handle);
    } catch {
      /* nothing sensible to do; the stale caption is cosmetic */
    }
  }

  function clearMenuCommands() {
    for (const id of [...registeredMenuCommands.keys()]) unregisterMenuCommand(id);
  }

  /* ------------------------------------------------------------ tab opening */

  /**
   * Creates tabs with an explicit index so that a multi-engine
   * search lands in a predictable order next to the source tab. `GM_openInTab`
   * exposes the same intent through `insert: true`; `setParent: true` links
   * opener relationships. Popup blockers only permit `window.open` during a user
   * gesture, which is exactly when the fallback is reached.
   */
  function openTab(url, {active = true, insert = true} = {}) {
    if (gm.openInTab) {
      try {
        const handle = gm.openInTab(url, {
          active,
          insert,
          setParent: true,
          loadInBackground: !active
        });
        if (handle) return {ok: true, handle};
        return {ok: true, handle: null};
      } catch (err) {
        log.warn('GM_openInTab failed, falling back to window.open', err);
      }
    }

    try {
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (win) {
        if (!active && typeof win.blur === 'function') {
          win.blur();
          window.focus();
        }
        return {ok: true, handle: null};
      }
    } catch (err) {
      log.warn('window.open failed', err);
    }

    return {ok: false, handle: null};
  }

  /** Navigate the current tab, optionally without adding a history entry. */
  function navigate(url, {keepHistory = true} = {}) {
    try {
      if (keepHistory) location.href = url;
      else location.replace(url);
      return true;
    } catch (err) {
      log.error('navigation failed', err);
      return false;
    }
  }

  /* --------------------------------------------------------------- clipboard */

  async function writeClipboard(text, mime = 'text/plain') {
    if (gm.setClipboard) {
      try {
        gm.setClipboard(text, mime);
        return true;
      } catch (err) {
        log.warn('GM_setClipboard failed', err);
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      log.warn('navigator.clipboard failed', err);
    }

    return false;
  }

  /* ----------------------------------------------------------- notifications */

  /**
   * Native notifications are used only when the user asked for them and the
   * grant exists; otherwise the caller's in-page toast is the single channel.
   * Returns true when a *native* notification was raised.
   */
  function nativeNotify({title, text, timeout = 6000, onClick = null} = {}) {
    if (!gm.notification) return false;
    try {
      gm.notification({
        title: title || APP_NAME,
        text: String(text || ''),
        timeout,
        silent: true,
        onclick: typeof onClick === 'function' ? onClick : undefined
      });
      return true;
    } catch (err) {
      log.warn('GM_notification failed', err);
      return false;
    }
  }

  /* --------------------------------------------------- cross-origin requests */

  class HttpError extends Error {
    constructor(status, statusText, url) {
      super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
      this.name = 'HttpError';
      this.status = status;
      this.statusText = statusText;
      this.url = url;
    }
  }

  class NetworkError extends Error {
    constructor(message, url) {
      super(message || 'Network request failed');
      this.name = 'NetworkError';
      this.url = url;
    }
  }

  class TimeoutError extends Error {
    constructor(url, ms) {
      super(`Request timed out after ${ms}ms`);
      this.name = 'TimeoutError';
      this.url = url;
    }
  }

  class AbortError extends Error {
    constructor(url) {
      super('Request aborted');
      this.name = 'AbortError';
      this.url = url;
    }
  }

  /**
   * Cross-origin GET with a hard timeout and cooperative cancellation.
   *
   * Every archive probe is anonymous: no cookies are attached (`anonymous:true`
   * where supported), no referrer is leaked, and only the URL being looked up
   * is transmitted (using `credentials: 'omit'` semantics).
   */
  function request(url, {
    method = 'GET',
    timeout = 12000,
    responseType = 'text',
    headers = null,
    signal = null,
    anonymous = true
  } = {}) {
    if (!gm.xmlhttpRequest) {
      // Same-origin (or CORS-permitting) fallback so the feature still works
      // where the grant is missing, e.g. under `@grant none` forks.
      return fetchFallback(url, {method, timeout, responseType, headers, signal});
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let handle = null;
      let timer = null;

      const finish = fn => (...args) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener?.('abort', onAbort);
        fn(...args);
      };

      const done = finish(resolve);
      const fail = finish(reject);

      function onAbort() {
        try {
          handle?.abort?.();
        } catch {
          /* the manager may not expose abort */
        }
        fail(new AbortError(url));
      }

      if (signal) {
        if (signal.aborted) {
          reject(new AbortError(url));
          return;
        }
        signal.addEventListener?.('abort', onAbort, {once: true});
      }

      timer = setTimeout(() => {
        try {
          handle?.abort?.();
        } catch {
          /* ignore */
        }
        fail(new TimeoutError(url, timeout));
      }, timeout);

      const details = {
        method,
        url,
        timeout,
        anonymous,
        responseType: responseType === 'json' ? 'text' : responseType,
        headers: {Accept: responseType === 'json' ? 'application/json, */*' : '*/*', ...(headers || {})},
        onload(response) {
          const status = response.status || 0;
          if (status < 200 || status >= 300) {
            fail(new HttpError(status, response.statusText, url));
            return;
          }
          let body = response.responseText;
          if (responseType === 'json') {
            try {
              body = JSON.parse(body);
            } catch (err) {
              fail(new NetworkError(`Malformed JSON response: ${err.message}`, url));
              return;
            }
          }
          done({status, body, headers: response.responseHeaders || '', finalUrl: response.finalUrl || url});
        },
        onerror(response) {
          fail(new NetworkError(response?.error || 'Request failed', url));
        },
        ontimeout() {
          fail(new TimeoutError(url, timeout));
        },
        onabort() {
          fail(new AbortError(url));
        }
      };

      try {
        handle = gm.xmlhttpRequest(details);
      } catch (err) {
        fail(new NetworkError(err?.message, url));
      }
    });
  }

  async function fetchFallback(url, {method, timeout, responseType, headers, signal}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, {once: true});

    try {
      const response = await fetch(url, {
        method,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
        headers: headers || undefined,
        signal: controller.signal
      });
      if (!response.ok) throw new HttpError(response.status, response.statusText, url);
      const text = await response.text();
      let body = text;
      if (responseType === 'json') {
        try {
          body = JSON.parse(text);
        } catch (err) {
          throw new NetworkError(`Malformed JSON response: ${err.message}`, url);
        }
      }
      return {status: response.status, body, headers: '', finalUrl: response.url || url};
    } catch (err) {
      if (err?.name === 'AbortError') throw new TimeoutError(url, timeout);
      if (err instanceof HttpError || err instanceof NetworkError) throw err;
      throw new NetworkError(err?.message, url);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  /* ---------------------------------------------------- page-context bridge */

  /**
   * Runs a function inside the *page* realm. A userscript has two possible
   * routes and we prefer the one that does not violate a CSP:
   *
   *   1. `unsafeWindow` — no script element, no CSP interaction. Used whenever
   *      the manager exposes it.
   *   2. an injected <script> element — classic fallback; detects and reports
   *      if blocked by a strict CSP or Trusted Types.
   *
   * Returns true when the code was handed to the page realm.
   */
  function runInPageContext(fn, args = []) {
    const source = `(${fn.toString()}).apply(null, ${JSON.stringify(args)});`;

    if (capabilities.unsafeWindow) {
      try {
        // eslint-disable-next-line no-undef
        const pageEval = unsafeWindow.eval;
        if (typeof pageEval === 'function') {
          pageEval(source);
          return true;
        }
      } catch (err) {
        log.debug('unsafeWindow.eval unavailable', err);
      }
    }

    try {
      const script = document.createElement('script');
      // A nonce present on an existing script is reused so that strict CSPs
      // that whitelist by nonce keep working.
      const nonceNode = document.querySelector('script[nonce]');
      if (nonceNode?.nonce) script.nonce = nonceNode.nonce;
      script.textContent = source;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      return true;
    } catch (err) {
      log.warn('page-context injection blocked', err);
      return false;
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  /**
   * Central disposer registry. Every observer, interval and listener created by
   * the script registers here so that a soft teardown (SPA navigation away from
   * a supported context, or `pagehide`) can release everything deterministically
   * and leave no detached references behind.
   */
  class Disposables {
    constructor(name = '') {
      this.name = name;
      this._items = new Set();
      this._disposed = false;
    }

    add(disposer) {
      if (typeof disposer !== 'function') return () => {};
      if (this._disposed) {
        try {
          disposer();
        } catch {
          /* already torn down */
        }
        return () => {};
      }
      this._items.add(disposer);
      return () => {
        this._items.delete(disposer);
        try {
          disposer();
        } catch (err) {
          log.warn('disposer threw', err);
        }
      };
    }

    addListener(target, type, handler, options) {
      if (!target?.addEventListener) return () => {};
      target.addEventListener(type, handler, options);
      return this.add(() => target.removeEventListener(type, handler, options));
    }

    addTimeout(handler, ms) {
      const id = setTimeout(() => {
        this._items.delete(cancel);
        handler();
      }, ms);
      const cancel = () => clearTimeout(id);
      this._items.add(cancel);
      return () => {
        this._items.delete(cancel);
        cancel();
      };
    }

    addInterval(handler, ms) {
      const id = setInterval(handler, ms);
      return this.add(() => clearInterval(id));
    }

    addObserver(observer) {
      return this.add(() => observer.disconnect());
    }

    get size() {
      return this._items.size;
    }

    get disposed() {
      return this._disposed;
    }

    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      const items = [...this._items];
      this._items.clear();
      for (let i = items.length - 1; i >= 0; i -= 1) {
        try {
          items[i]();
        } catch (err) {
          log.warn('disposer threw during teardown', err);
        }
      }
    }
  }

  const env = {
    APP_ID,
    APP_NAME,
    APP_VERSION,
    capabilities,
    platform,
    primaryModifier,
    log,
    Disposables,
    storage: {
      get: storageGet,
      set: storageSet,
      delete: storageDelete,
      keys: storageKeys,
      watch: storageWatch
    },
    menu: {
      register: registerMenuCommand,
      unregister: unregisterMenuCommand,
      clear: clearMenuCommands
    },
    openTab,
    navigate,
    writeClipboard,
    nativeNotify,
    request,
    runInPageContext,
    errors: {HttpError, NetworkError, TimeoutError, AbortError}
  };

  /* =======================================================================
   * SECTION 02 — Shared utilities
   * -----------------------------------------------------------------------
   * Pure helpers with no product knowledge: timing, DOM construction,
   * comparison, text handling and small data structures. Everything here is
   * side-effect free apart from the explicitly scheduled work.
   * ==================================================================== */

  const util = (() => {
    /* ------------------------------------------------------------- timing */

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Trailing-edge debounce with a `flush`/`cancel` pair. A pending write is
     * always flushed on `pagehide`, so a debounced persist can never lose the
     * user's last change when the tab is discarded.
     */
    function debounce(fn, wait) {
      let timer = null;
      let pendingArgs = null;

      const invoke = () => {
        const args = pendingArgs;
        timer = null;
        pendingArgs = null;
        if (args) fn(...args);
      };

      const wrapped = (...args) => {
        pendingArgs = args;
        if (timer) clearTimeout(timer);
        timer = setTimeout(invoke, wait);
      };

      wrapped.flush = () => {
        if (timer) {
          clearTimeout(timer);
          invoke();
        }
      };
      wrapped.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        pendingArgs = null;
      };
      wrapped.pending = () => timer !== null;

      return wrapped;
    }

    /** Leading-edge throttle; the trailing call is always delivered. */
    function throttle(fn, wait) {
      let last = 0;
      let timer = null;
      let pendingArgs = null;

      const run = args => {
        last = Date.now();
        fn(...args);
      };

      const wrapped = (...args) => {
        const now = Date.now();
        const remaining = wait - (now - last);
        if (remaining <= 0) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          run(args);
        } else {
          pendingArgs = args;
          if (!timer) {
            timer = setTimeout(() => {
              timer = null;
              if (pendingArgs) {
                const a = pendingArgs;
                pendingArgs = null;
                run(a);
              }
            }, remaining);
          }
        }
      };

      wrapped.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        pendingArgs = null;
      };

      return wrapped;
    }

    /**
     * Coalesces concurrent calls that share a key onto a single in-flight
     * promise. Prevents duplicate archive probes when the panel is reopened
     * while a lookup is still running.
     */
    function singleFlight() {
      const inflight = new Map();
      return function run(key, factory) {
        if (inflight.has(key)) return inflight.get(key);
        let promise;
        try {
          promise = Promise.resolve(factory());
        } catch (err) {
          return Promise.reject(err);
        }
        const tracked = promise.finally(() => {
          if (inflight.get(key) === tracked) inflight.delete(key);
        });
        inflight.set(key, tracked);
        return tracked;
      };
    }

    /**
     * Bounded-concurrency task pool. Preserves submission order for equal priority and
     * never lets a rejected task stall the pool.
     */
    class TaskQueue {
      constructor({concurrency = 1} = {}) {
        this.concurrency = Math.max(1, concurrency);
        this._queue = [];
        this._active = 0;
      }

      add(task) {
        return new Promise((resolve, reject) => {
          this._queue.push({task, resolve, reject});
          this._drain();
        });
      }

      addAll(tasks) {
        return Promise.all(tasks.map(t => this.add(t)));
      }

      get size() {
        return this._queue.length;
      }

      get pending() {
        return this._active;
      }

      _drain() {
        while (this._active < this.concurrency && this._queue.length) {
          const {task, resolve, reject} = this._queue.shift();
          this._active += 1;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              this._active -= 1;
              this._drain();
            });
        }
      }
    }

    /* ------------------------------------------------------------ identity */

    /** RFC 4122 v4 where available, with a non-crypto fallback. */
    function uuid() {
      try {
        if (crypto?.randomUUID) return crypto.randomUUID();
      } catch {
        /* fall through */
      }
      try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
          .slice(6, 8)
          .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
      } catch {
        return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      }
    }

    /** Stable, collision-resistant-enough hash for cache keys. */
    function hashString(input) {
      let h1 = 0xdeadbeef;
      let h2 = 0x41c6ce57;
      for (let i = 0; i < input.length; i += 1) {
        const ch = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
    }

    /* ----------------------------------------------------------- structures */

    /** Bounded LRU with per-entry TTL; used for archive availability results. */
    class LruCache {
      constructor({max = 100, ttl = 0} = {}) {
        this.max = Math.max(1, max);
        this.ttl = ttl;
        this._map = new Map();
      }

      _expired(entry) {
        return this.ttl > 0 && Date.now() - entry.time > this.ttl;
      }

      get(key) {
        const entry = this._map.get(key);
        if (!entry) return undefined;
        if (this._expired(entry)) {
          this._map.delete(key);
          return undefined;
        }
        // refresh recency
        this._map.delete(key);
        this._map.set(key, entry);
        return entry.value;
      }

      has(key) {
        return this.get(key) !== undefined;
      }

      set(key, value) {
        if (this._map.has(key)) this._map.delete(key);
        this._map.set(key, {value, time: Date.now()});
        while (this._map.size > this.max) {
          const oldest = this._map.keys().next().value;
          this._map.delete(oldest);
        }
        return value;
      }

      delete(key) {
        return this._map.delete(key);
      }

      clear() {
        this._map.clear();
      }

      get size() {
        // Reported size excludes expired entries so diagnostics stay honest.
        let n = 0;
        for (const entry of this._map.values()) if (!this._expired(entry)) n += 1;
        return n;
      }

      prune() {
        for (const [key, entry] of [...this._map]) {
          if (this._expired(entry)) this._map.delete(key);
        }
      }

      entries() {
        const out = [];
        for (const [key, entry] of this._map) {
          if (!this._expired(entry)) out.push([key, entry.value, entry.time]);
        }
        return out;
      }
    }

    /* -------------------------------------------------------------- objects */

    /**
     * Realm-tolerant plain-object test. A bare `proto === Object.prototype`
     * comparison is false for an object created in another realm (an iframe, a
     * sandboxed userscript context, or a test harness), which would silently
     * reject perfectly good settings patches.
     */
    const isPlainObject = value => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const proto = Object.getPrototypeOf(value);
      if (proto === null || proto === Object.prototype) return true;
      // A cross-realm plain object: its prototype's prototype is null.
      return Object.getPrototypeOf(proto) === null;
    };

    /** Structural deep clone that tolerates missing `structuredClone`. */
    function deepClone(value) {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(deepClone);
      if (value instanceof Date) return new Date(value.getTime());
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = deepClone(item);
      return out;
    }

    function deepEqual(a, b) {
      if (a === b) return true;
      if (typeof a !== typeof b) return false;
      if (a === null || b === null) return false;
      if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, i) => deepEqual(item, b[i]));
      }
      if (typeof a === 'object') {
        if (typeof b !== 'object' || Array.isArray(b)) return false;
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every(key => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
      }
      return false;
    }

    /** Array difference preserving the order of `source` (lodash `difference`). */
    const difference = (source, excluded) => {
      const set = new Set(excluded || []);
      return (source || []).filter(item => !set.has(item));
    };

    const unique = items => [...new Set(items || [])];

    function clamp(value, min, max) {
      if (!Number.isFinite(value)) return min;
      return Math.min(max, Math.max(min, value));
    }

    /* ---------------------------------------------------------------- text */

    const getCharCount = string => [...String(string)].length;

    function capitalizeFirstLetter(string, locale = 'en-US') {
      return String(string).replace(/^\p{CWU}/u, char => char.toLocaleUpperCase(locale));
    }

    function truncateMiddle(text, max = 72) {
      const value = String(text ?? '');
      if (value.length <= max) return value;
      const head = Math.ceil((max - 1) / 2);
      const tail = Math.floor((max - 1) / 2);
      return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
    }

    function escapeRegExp(string) {
      return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * `String.prototype.replace` with a *string* replacement interprets `$&`,
     * `$'`, `` $` `` and `$1`. Archive target URLs are built by substituting an
     * arbitrary, attacker-influenced page URL into a template, so every
     * substitution in this product goes through here instead.
     */
    function substitute(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
      );
    }

    /** Case-insensitive subsequence match used by the launcher's filter box. */
    function fuzzyScore(needle, haystack) {
      const n = needle.toLowerCase();
      const h = haystack.toLowerCase();
      if (!n) return 1;
      if (h === n) return 1000;
      if (h.startsWith(n)) return 900 - h.length;
      const wordStart = h.split(/[\s\-_.()]+/).some(word => word.startsWith(n));
      if (wordStart) return 800 - h.length;
      const index = h.indexOf(n);
      if (index >= 0) return 700 - index - h.length * 0.1;

      // subsequence
      let hi = 0;
      let score = 0;
      let streak = 0;
      for (let ni = 0; ni < n.length; ni += 1) {
        const found = h.indexOf(n[ni], hi);
        if (found < 0) return 0;
        streak = found === hi ? streak + 1 : 0;
        score += 10 + streak * 5 - Math.min(found - hi, 10);
        hi = found + 1;
      }
      return Math.max(1, score);
    }

    /* --------------------------------------------------------------- format */

    const PLURAL_UNITS = [
      ['year', 31536000000],
      ['month', 2592000000],
      ['week', 604800000],
      ['day', 86400000],
      ['hour', 3600000],
      ['minute', 60000],
      ['second', 1000]
    ];

    /** "3 months ago" / "in 3 months"; falls back gracefully without Intl. */
    function formatRelativeTime(timestamp, now = Date.now()) {
      if (!Number.isFinite(timestamp)) return '';
      const delta = timestamp - now;
      const abs = Math.abs(delta);
      if (abs < 45000) return 'just now';

      for (const [unit, ms] of PLURAL_UNITS) {
        if (abs >= ms || unit === 'second') {
          const value = Math.round(delta / ms);
          try {
            const rtf = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'});
            return rtf.format(value, unit);
          } catch {
            const n = Math.abs(value);
            const plural = n === 1 ? unit : `${unit}s`;
            return delta < 0 ? `${n} ${plural} ago` : `in ${n} ${plural}`;
          }
        }
      }
      return '';
    }

    function formatDate(timestamp, {withTime = false} = {}) {
      if (!Number.isFinite(timestamp)) return '';
      try {
        return new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          ...(withTime ? {hour: '2-digit', minute: '2-digit'} : {})
        }).format(new Date(timestamp));
      } catch {
        const d = new Date(timestamp);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, withTime ? 16 : 10).replace('T', ' ');
      }
    }

    /** `YYYYMMDDhhmmss` (Wayback) → epoch ms. Tolerates shorter prefixes. */
    function parseWaybackTimestamp(stamp) {
      const value = String(stamp || '').replace(/\D/g, '');
      if (value.length < 4) return NaN;
      const padded = value.padEnd(14, '0').slice(0, 14);
      const year = Number(padded.slice(0, 4));
      const month = Number(padded.slice(4, 6));
      const day = Number(padded.slice(6, 8));
      const hour = Number(padded.slice(8, 10));
      const minute = Number(padded.slice(10, 12));
      const second = Number(padded.slice(12, 14));
      if (!year || month < 1 || month > 12 || day < 1 || day > 31) return NaN;
      const ms = Date.UTC(year, month - 1, day, hour, minute, second);
      return Number.isFinite(ms) ? ms : NaN;
    }

    /** epoch ms → `YYYYMMDDhhmmss`. */
    function toWaybackTimestamp(ms) {
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return '';
      const p = (n, len = 2) => String(n).padStart(len, '0');
      return (
        `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
        `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
      );
    }

    /** `YYYY-MM-DD` in UTC, used for the WebCite `date` parameter. */
    function isoDate(ms = Date.now()) {
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
      return d.toISOString().split('T')[0];
    }

    const getDayPrecisionEpoch = (epoch = Date.now()) => epoch - (epoch % 86400000);

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes < 1024) return `${bytes} B`;
      const units = ['KB', 'MB', 'GB'];
      let value = bytes / 1024;
      let i = 0;
      while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
      }
      return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
    }

    /* ------------------------------------------------------------------ DOM */

    /**
     * Element factory. Everything user-facing is built through this: it only
     * ever assigns text via `textContent`, so no product string can be
     * interpreted as markup. There is deliberately no `innerHTML` path.
     */
    function el(tag, props = {}, children = []) {
      const node = document.createElement(tag);

      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;

        if (key === 'class' || key === 'className') {
          node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
        } else if (key === 'style' && typeof value === 'object') {
          for (const [prop, val] of Object.entries(value)) {
            if (val !== null && val !== undefined) node.style.setProperty(prop, String(val));
          }
        } else if (key === 'dataset' && typeof value === 'object') {
          for (const [prop, val] of Object.entries(value)) {
            if (val !== null && val !== undefined) node.dataset[prop] = String(val);
          }
        } else if (key === 'text') {
          node.textContent = String(value);
        } else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
          node[key] = value;
        } else if (value === true) {
          node.setAttribute(key, '');
        } else {
          node.setAttribute(key, String(value));
        }
      }

      appendChildren(node, children);
      return node;
    }

    function appendChildren(node, children) {
      const list = Array.isArray(children) ? children : [children];
      for (const child of list) {
        if (child === null || child === undefined || child === false || child === true) continue;
        if (Array.isArray(child)) {
          appendChildren(node, child);
        } else if (child instanceof Node) {
          node.appendChild(child);
        } else {
          node.appendChild(document.createTextNode(String(child)));
        }
      }
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * Builds an SVG from a compact descriptor. Only a fixed set of shape tags
     * and attributes is honoured, so an icon definition can never smuggle a
     * script or a foreign namespace into the DOM.
     */
    const SVG_SHAPES = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'text']);
    const SVG_ATTRS = new Set([
      'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height',
      'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'fill-rule', 'clip-rule', 'opacity', 'transform', 'font-size', 'font-weight',
      'text-anchor', 'dominant-baseline', 'font-family'
    ]);

    function svg({viewBox = '0 0 24 24', size = 20, className = '', title = '', shapes = []} = {}) {
      const node = document.createElementNS(SVG_NS, 'svg');
      node.setAttribute('viewBox', viewBox);
      node.setAttribute('width', String(size));
      node.setAttribute('height', String(size));
      node.setAttribute('aria-hidden', title ? 'false' : 'true');
      node.setAttribute('focusable', 'false');
      if (className) node.setAttribute('class', className);
      if (title) {
        node.setAttribute('role', 'img');
        const titleNode = document.createElementNS(SVG_NS, 'title');
        titleNode.textContent = title;
        node.appendChild(titleNode);
      }

      for (const shape of shapes) {
        if (!shape || !SVG_SHAPES.has(shape.tag)) continue;
        const child = document.createElementNS(SVG_NS, shape.tag);
        for (const [key, value] of Object.entries(shape)) {
          if (key === 'tag' || key === 'text') continue;
          if (!SVG_ATTRS.has(key)) continue;
          child.setAttribute(key, String(value));
        }
        if (typeof shape.text === 'string') child.textContent = shape.text;
        node.appendChild(child);
      }

      return node;
    }

    function clear(node) {
      if (!node) return node;
      while (node.firstChild) node.removeChild(node.firstChild);
      return node;
    }

    /** Replaces a node's children in one pass, avoiding intermediate reflow. */
    function render(node, children) {
      if (!node) return node;
      const fragment = document.createDocumentFragment();
      appendChildren(fragment, children);
      clear(node);
      node.appendChild(fragment);
      return node;
    }

    /**
     * `element.querySelector('#id')` can be answered from the *document* id
     * index in some engines, returning a node outside `element`. Host pages
     * routinely contain duplicate ids, so id lookups use attribute selectors.
     */
    function byId(root, id) {
      return (root || document).querySelector(`[id="${CSS.escape(id)}"]`);
    }

    function waitForDocumentLoad() {
      return new Promise(resolve => {
        if (document.readyState === 'complete') {
          resolve();
          return;
        }
        const onState = () => {
          if (document.readyState === 'complete') {
            document.removeEventListener('readystatechange', onState);
            window.removeEventListener('load', onLoad);
            resolve();
          }
        };
        const onLoad = () => {
          document.removeEventListener('readystatechange', onState);
          window.removeEventListener('load', onLoad);
          resolve();
        };
        document.addEventListener('readystatechange', onState);
        window.addEventListener('load', onLoad, {once: true});
      });
    }

    function whenDocumentElementReady() {
      return new Promise(resolve => {
        if (document.documentElement) {
          resolve();
          return;
        }
        const observer = new MutationObserver(() => {
          if (document.documentElement) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document, {childList: true, subtree: true});
      });
    }

    /**
     * Resolves with the first node matching `selector`, watching for it to
     * appear. Always disconnects; never rejects unless asked to.
     */
    function findNode(selector, {
      timeout = 15000,
      root = null,
      throwError = false,
      validate = null,
      signal = null
    } = {}) {
      return new Promise((resolve, reject) => {
        const scope = root || document;

        const check = () => {
          let node = null;
          try {
            node = scope.querySelector(selector);
          } catch {
            node = null;
          }
          if (node && (!validate || validate(node))) return node;
          return null;
        };

        const immediate = check();
        if (immediate) {
          resolve(immediate);
          return;
        }

        let observer = null;
        let timer = null;

        const cleanup = () => {
          if (observer) observer.disconnect();
          if (timer) clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
        };

        function onAbort() {
          cleanup();
          if (throwError) reject(new Error(`Aborted while waiting for ${selector}`));
          else resolve(null);
        }

        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener?.('abort', onAbort, {once: true});
        }

        try {
          observer = new MutationObserver(() => {
            const node = check();
            if (node) {
              cleanup();
              resolve(node);
            }
          });
          observer.observe(scope === document ? document.documentElement || document : scope, {
            childList: true,
            subtree: true,
            attributes: true
          });
        } catch (err) {
          // No MutationObserver (or an unobservable root): fall back to polling
          // rather than losing the capability outright.
          observer = null;
          const poll = setInterval(() => {
            const node = check();
            if (node) {
              clearInterval(poll);
              cleanup();
              resolve(node);
            }
          }, 150);
          const stop = () => clearInterval(poll);
          observer = {disconnect: stop};
        }

        timer = setTimeout(() => {
          cleanup();
          if (throwError) reject(new Error(`DOM node not found: ${selector}`));
          else resolve(null);
        }, timeout);
      });
    }

    /* ------------------------------------------------------------ keyboard */

    /** Normalised accelerator descriptor: "ctrl+shift+k" → structured form. */
    function parseAccelerator(spec) {
      const parts = String(spec || '')
        .toLowerCase()
        .split('+')
        .map(p => p.trim())
        .filter(Boolean);

      const result = {ctrl: false, alt: false, shift: false, meta: false, key: ''};
      for (const part of parts) {
        if (part === 'ctrl' || part === 'control') result.ctrl = true;
        else if (part === 'alt' || part === 'option') result.alt = true;
        else if (part === 'shift') result.shift = true;
        else if (part === 'meta' || part === 'cmd' || part === 'command' || part === 'super') result.meta = true;
        else if (part === 'mod') result.mod = true;
        else result.key = part;
      }
      return result;
    }

    function matchesAccelerator(event, spec, {primary = 'ctrl'} = {}) {
      const accel = parseAccelerator(spec);
      if (!accel.key) return false;

      // `!!` matters: `false || (undefined && …)` is `undefined`, and
      // `event.metaKey !== undefined` is always true, which would make every
      // non-"mod" accelerator fail to match.
      const wantCtrl = !!(accel.ctrl || (accel.mod && primary === 'ctrl'));
      const wantMeta = !!(accel.meta || (accel.mod && primary === 'meta'));

      if (event.ctrlKey !== wantCtrl) return false;
      if (event.metaKey !== wantMeta) return false;
      if (event.altKey !== accel.alt) return false;
      if (event.shiftKey !== accel.shift) return false;

      const key = String(event.key || '').toLowerCase();
      const code = String(event.code || '').toLowerCase();
      // `code` is compared too so that shortcuts survive non-Latin layouts.
      return key === accel.key || code === `key${accel.key}` || code === accel.key;
    }

    function formatAccelerator(spec, {primary = 'ctrl'} = {}) {
      const accel = parseAccelerator(spec);
      if (!accel.key) return '';
      const isApple = primary === 'meta';
      const out = [];
      if (accel.ctrl || (accel.mod && primary === 'ctrl')) out.push(isApple ? '⌃' : 'Ctrl');
      if (accel.alt) out.push(isApple ? '⌥' : 'Alt');
      if (accel.shift) out.push(isApple ? '⇧' : 'Shift');
      if (accel.meta || (accel.mod && primary === 'meta')) out.push(isApple ? '⌘' : 'Meta');
      const key = accel.key.length === 1 ? accel.key.toUpperCase() : capitalizeFirstLetter(accel.key);
      out.push(key);
      return out.join(isApple ? '' : '+');
    }

    /** Serialises a KeyboardEvent back into accelerator syntax. */
    function acceleratorFromEvent(event) {
      const key = String(event.key || '');
      if (['Control', 'Alt', 'Shift', 'Meta', 'OS', 'Dead'].includes(key)) return '';
      const parts = [];
      if (event.ctrlKey) parts.push('ctrl');
      if (event.altKey) parts.push('alt');
      if (event.shiftKey) parts.push('shift');
      if (event.metaKey) parts.push('meta');
      const named = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
      parts.push(named);
      return parts.join('+');
    }

    /* -------------------------------------------------------------- exports */

    return {
      sleep,
      debounce,
      throttle,
      singleFlight,
      TaskQueue,
      uuid,
      hashString,
      LruCache,
      isPlainObject,
      deepClone,
      deepEqual,
      difference,
      unique,
      clamp,
      getCharCount,
      capitalizeFirstLetter,
      truncateMiddle,
      escapeRegExp,
      substitute,
      fuzzyScore,
      formatRelativeTime,
      formatDate,
      parseWaybackTimestamp,
      toWaybackTimestamp,
      isoDate,
      getDayPrecisionEpoch,
      formatBytes,
      el,
      svg,
      clear,
      render,
      byId,
      waitForDocumentLoad,
      whenDocumentElementReady,
      findNode,
      parseAccelerator,
      matchesAccelerator,
      formatAccelerator,
      acceleratorFromEvent
    };
  })();

  /* =======================================================================
   * SECTION 03 — Message catalogue
   * -----------------------------------------------------------------------
   * Strings are resolved locally through an internal message catalogue.
   *
   * All standard message keys and placeholders use the `$NAME$` convention,
   * providing full coverage across all interface and error surfaces.
   * ==================================================================== */

  const i18n = (() => {
    /* Base message strings */
    const baseStrings = {
      scriptName: 'Web Archives',
      scriptDescription:
        'View archived and cached versions of web pages on various search engines, such as the Wayback Machine and Archive.is.',

      engineName_yandex: 'Yandex',
      engineName_archiveOrg: 'Wayback Machine',
      engineName_archiveOrgAll: 'Wayback Machine (all)',
      engineName_archiveIs: 'Archive.is',
      engineName_archiveIsAll: 'Archive.is (all)',
      engineName_megalodon: 'Megalodon',
      engineName_permacc: 'Perma.cc',
      engineName_ghostarchive: 'Ghostarchive',
      engineName_webcite: 'WebCite',
      engineName_softwareHeritage: 'Software Heritage',
      engineName_allEngines: 'All search engines',

      actionTitle_allEngines: 'Search all engines for page',
      actionTitle_engine: 'Search $ENGINE$ for page',

      menuItemTitle_yandex: 'Yandex',
      menuItemTitle_archiveOrg: 'Wayback Machine',
      menuItemTitle_archiveOrgAll: 'Wayback Machine (all)',
      menuItemTitle_archiveIs: 'Archive.is',
      menuItemTitle_archiveIsAll: 'Archive.is (all)',
      menuItemTitle_megalodon: 'Megalodon',
      menuItemTitle_permacc: 'Perma.cc',
      menuItemTitle_ghostarchive: 'Ghostarchive',
      menuItemTitle_webcite: 'WebCite',
      menuItemTitle_softwareHeritage: 'Software Heritage',
      menuItemTitle_allEngines: 'All search engines',
      mainMenuItemTitle_allEngines: 'Search all engines for page',
      mainMenuItemTitle_engine: 'Search $ENGINE$ for page',
      menuItemTitle_openCurrentDoc: 'Open current page',

      optionSectionTitle_engines: 'Search engines',
      optionSectionDescription_engines: 'Toggle search engines and customize their order (drag and drop)',

      optionTitle_yandex: 'Yandex Cache',
      optionTitle_archiveOrg: 'Wayback Machine',
      optionTitle_archiveOrgAll: 'Wayback Machine (all)',
      optionTitle_archiveIs: 'Archive.is',
      optionTitle_archiveIsAll: 'Archive.is (all)',
      optionTitle_megalodon: 'Megalodon',
      optionTitle_permacc: 'Perma.cc',
      optionTitle_ghostarchive: 'Ghostarchive',
      optionTitle_webcite: 'WebCite',
      optionTitle_softwareHeritage: 'Software Heritage',

      optionTitle_searchMode: 'Search mode',
      optionTitle_searchAllEngines: 'Search all engines',

      optionSectionTitle_contextmenu: 'Context menu',
      optionTitle_showInContextMenu: 'Visibility',
      optionValue_showInContextMenu_all: 'Show',
      optionValue_showInContextMenu_link: 'Show for links',
      optionValue_showInContextMenu_false: 'Hide',
      optionValue_searchAllEnginesContextMenu_main: 'From context menu',
      optionValue_searchAllEnginesContextMenu_sub: 'From submenu of context menu',
      optionValue_searchAllEnginesContextMenu_false: 'Disable',
      optionTitle_openCurrentDocContextMenu: 'Open current page',

      optionSectionTitle_toolbar: 'Browser toolbar',
      optionSectionTitleMobile_toolbar: 'Browser menu',
      optionValue_searchAllEnginesAction_main: 'From browser toolbar',
      optionValue_searchAllEnginesAction_sub: 'From browser toolbar popup',
      optionValue_searchAllEnginesAction_false: 'Disable',
      optionValue_searchAllEnginesActionMobile_main: 'From browser menu',
      optionValue_searchAllEnginesActionMobile_sub: 'From browser menu popup',
      optionValue_searchAllEnginesActionMobile_false: 'Disable',
      optionValue_searchModeAction_tab: 'Tab',
      optionValue_searchModeAction_url: 'URL',
      optionValue_action_searchModeAction_tab: 'Tab',
      optionValue_action_searchModeAction_url: 'URL',
      optionTitle_showPageAction: 'Show in address bar on server error',

      optionSectionTitle_misc: 'Miscellaneous',
      optionTitle_tabInBackgound: 'Open new tabs in the background',
      optionTitle_showEngineIcons: 'Show search engine icons',
      optionTitle_appTheme: 'Theme',
      optionValue_appTheme_auto: 'System default',
      optionValue_appTheme_light: 'Light',
      optionValue_appTheme_dark: 'Dark',
      optionTitle_showContribPage: 'Show contribution page',
      optionTitle_archiveOrgHost: 'Wayback Machine host',
      optionValue_archiveOrgHost_web_archive_org: 'web.archive.org',
      optionValue_archiveOrgHost_onion_1: 'Onion service',
      optionTitle_archiveIsHost: 'Archive.is host',
      optionValue_archiveIsHost_archive_is: 'archive.is',
      optionValue_archiveIsHost_archive_today: 'archive.today',
      optionValue_archiveIsHost_archive_ph: 'archive.ph',
      optionValue_archiveIsHost_archive_vn: 'archive.vn',
      optionValue_archiveIsHost_archive_fo: 'archive.fo',
      optionValue_archiveIsHost_archive_li: 'archive.li',
      optionValue_archiveIsHost_archive_md: 'archive.md',
      optionValue_archiveIsHost_onion_1: 'Onion service',

      optionSectionTitle_sponsors: 'Sponsors',
      inputPlaceholder_docUrl: 'Page URL',
      buttonLabel_contribute: 'Contribute',
      pageTitle: '$PAGETITLE$ - $SCRIPTNAME$',
      pageTitle_options: 'Options',
      pageTitle_contribute: 'Contribute',

      actionMenu_openCurrentDoc: 'Open current page',
      actionMenu_options: 'Options',
      actionMenu_contribute: 'Contribute',
      actionMenu_support: 'Support',

      buttonTooltip_searchMode: 'Search mode',
      buttonTooltip_openCurrentDoc: 'Open current page',
      buttonTooltip_contribute: 'Contribute',
      buttonTooltip_options: 'Options',
      buttonTooltip_menu: 'Menu',
      buttonTooltip_pin: 'Pin',
      buttonTooltip_unpin: 'Unpin',

      error_invalidPageUrl: 'The page URL is not valid.',
      error_sessionExpired: 'The session has expired.',
      error_sessionExpiredEngine: 'The session has expired. Try searching again for the page on $ENGINE$.',
      error_engine: 'Something went wrong. Searching on $ENGINE$ has failed.',
      error_noResults: 'No results found.',
      error_scriptsNotAllowed: 'Content scripts are not allowed on this page.',
      error_allEnginesDisabled:
        'All search engines have been disabled. Open Settings to enable a search engine.',
      error_optionsNotApplied: 'Restart the browser for changes to take effect.',
      error_currentDocUrlNotFound: 'Current page URL not found.'
    };

    /*
     * Adapted strings tailored for in-page user interface controls and modals.
     */
    const adapted = {
      error_invalidSearchMode_url:
        'Searching for a typed URL is only available from the launcher. Open Settings to select a different search mode.',
      error_invalidSearchModeMobile_url:
        'Searching for a typed URL is only available from the launcher. Open Settings to select a different search mode.',
      error_allEnginesDisabledApp:
        'All search engines have been disabled. Open Settings to enable a search engine.',
      optionSectionTitleApp_toolbar: 'Launcher',
      optionValue_searchAllEnginesActionApp_main: 'Search all engines immediately',
      optionValue_searchAllEnginesActionApp_sub: 'Show in the launcher list',
      optionValue_searchAllEnginesActionApp_false: 'Disable'
    };

    /* Strings introduced by the userscript's additional capabilities. */
    const added = {
      /* launcher shell */
      launcherTitle: 'Web Archives',
      launcherSubtitle_page: 'Current page',
      launcherSubtitle_link: 'Linked page',
      launcherSubtitle_selection: 'Selected URL',
      launcherSubtitle_media: 'Media file',
      launcherSubtitle_frame: 'Frame',
      launcherSubtitle_custom: 'Custom URL',
      launcherFilterPlaceholder: 'Filter engines…',
      launcherEmpty: 'No engine matches that filter.',
      launcherNoEngines: 'No search engines are enabled.',
      launcherOpenSettings: 'Open settings',
      launcherTargetLabel: 'Look up',
      launcherHint_keys: '↑↓ to move · Enter to open · 1–9 quick pick · Esc to close',
      launcherHint_copy: 'Hold $MOD$ and press Enter to copy the archive URL instead of opening it',
      launcherClose: 'Close',
      launcherSection_engines: 'Search engines',
      launcherSection_actions: 'Actions',

      /* targets */
      targetType_page: 'Page',
      targetType_link: 'Link',
      targetType_selection: 'Selection',
      targetType_media: 'Media',
      targetType_frame: 'Frame',
      targetType_custom: 'Custom',

      /* actions */
      action_searchAll: 'Search all engines',
      action_searchAllAvailable: 'Open every engine with a snapshot',
      action_openCurrentDoc: 'Open the original page',
      action_openCurrentDocDesc: 'Leave this archived copy and open the live page',
      action_saveSnapshot: 'Save a new snapshot',
      action_saveSnapshotDesc: 'Ask an archive to capture this page now',
      action_copyUrl: 'Copy the archive URL',
      action_copyCitation: 'Copy a citation',
      action_settings: 'Settings',
      action_history: 'Recent lookups',
      action_diagnostics: 'Diagnostics',
      action_support: 'Report an issue',
      action_contribute: 'Contribute',
      action_pickSnapshot: 'Pick a snapshot by date…',
      action_repeatLast: 'Repeat the last lookup',

      /* availability */
      availability_checking: 'Checking…',
      availability_available: 'Snapshot available',
      availability_availableAt: 'Snapshot from $DATE$',
      availability_none: 'No snapshot found',
      availability_unknown: 'Availability unknown',
      availability_unsupported: 'No availability API',
      availability_error: 'Check failed',
      availability_count: '$COUNT$ snapshots',
      availability_refresh: 'Re-check availability',
      availability_disabled: 'Availability checks are off',
      availability_privacyNote:
        'Availability checks send the URL you are looking up to the archive service. Turn them off in Settings if you would rather not.',

      /* snapshot picker */
      snapshotPicker_title: 'Wayback Machine snapshots',
      snapshotPicker_loading: 'Loading the snapshot index…',
      snapshotPicker_empty: 'The Wayback Machine has no snapshot of this URL.',
      snapshotPicker_year: 'Year',
      snapshotPicker_nearest: 'Open the snapshot nearest to',
      snapshotPicker_first: 'First snapshot',
      snapshotPicker_last: 'Most recent snapshot',
      snapshotPicker_open: 'Open',
      snapshotPicker_error: 'The snapshot index could not be loaded.',
      snapshotPicker_truncated: 'Showing the $COUNT$ most recent snapshots.',

      /* save */
      save_title: 'Save a snapshot',
      save_desc: 'Ask an archive service to capture the page as it is right now.',
      save_archiveOrg: 'Save to the Wayback Machine',
      save_archiveIs: 'Save to Archive.today',
      save_started: 'Opened $ENGINE$ to capture the page. Archiving can take a minute.',
      save_unsupported: 'This engine cannot capture pages on demand.',

      /* settings */
      settings_title: 'Web Archives settings',
      settings_tab_engines: 'Engines',
      settings_tab_behaviour: 'Behaviour',
      settings_tab_lookup: 'Lookup',
      settings_tab_shortcuts: 'Shortcuts',
      settings_tab_data: 'Data',
      settings_close: 'Close settings',
      settings_saved: 'Settings saved.',
      settings_engineMoveUp: 'Move up',
      settings_engineMoveDown: 'Move down',
      settings_engineDragHint: 'Drag to reorder, or use the arrow buttons.',
      settings_engineEnabled: 'Enabled',
      settings_customEngines: 'Custom engines',
      settings_customEnginesDesc:
        'Add any archive or cache service. Use {url} for the encoded page URL, {rawUrl} for the unencoded URL, {host} for the page host and {date} for today in YYYY-MM-DD form.',
      settings_customEngineAdd: 'Add a custom engine',
      settings_customEngineName: 'Name',
      settings_customEngineTemplate: 'URL template',
      settings_customEngineSave: 'Save engine',
      settings_customEngineDelete: 'Delete',
      settings_customEngineEdit: 'Edit',
      settings_customEngineInvalidName: 'Give the engine a name.',
      settings_customEngineInvalidTemplate:
        'The template must be an http(s) URL and contain {url}, {rawUrl} or {host}.',
      settings_customEngineDuplicate: 'An engine with that name already exists.',
      settings_customEnginePreview: 'Preview',

      settings_section_target: 'URL handling',
      settings_stripFragment: 'Ignore the #fragment when looking up',
      settings_stripQuery: 'Ignore the ?query string when looking up',
      settings_stripTrackingParams: 'Remove tracking parameters (utm_*, fbclid, gclid, …)',
      settings_preferCanonical: 'Prefer the page’s canonical URL when it declares one',
      settings_urlPreview: 'Lookup URL',

      settings_section_availability: 'Availability checks',
      settings_probeMode: 'Check whether a snapshot exists',
      settings_probeMode_open: 'When the launcher opens',
      settings_probeMode_manual: 'Only when I ask',
      settings_probeMode_off: 'Never',
      settings_probeTtl: 'Remember results for',
      settings_probeConcurrency: 'Parallel checks',

      settings_section_errorPages: 'Broken pages',
      settings_errorOffer: 'Offer an archived copy when a page fails to load',
      settings_errorOfferDesc:
        'When the server answers with an error status, an unobtrusive prompt appears to offer an archive copy.',
      settings_errorOfferEngine: 'Engine used by the prompt',
      settings_errorOfferAuto: 'Open the archive automatically',
      settings_errorOfferAutoDesc: 'Skip the prompt and go straight to the archived copy.',

      settings_section_contextMenu: 'Right-click menu',
      settings_contextTrigger: 'Show the menu on',
      settings_contextTrigger_shift: 'Shift + right-click',
      settings_contextTrigger_ctrl: '$MOD$ + right-click',
      settings_contextTrigger_plain: 'Right-click',
      settings_contextTrigger_off: 'Never (use the launcher instead)',
      settings_contextTriggerDesc:
        'A userscript cannot add entries to the browser’s own context menu. This in-page menu reproduces it, and never replaces the native menu unless you ask it to.',

      settings_section_rules: 'Site rules',
      settings_rulesDesc:
        'Give specific sites their own default engine, or archive them automatically when they fail to load. The first matching rule wins.',
      settings_ruleAdd: 'Add a rule',
      settings_rulePattern: 'Host or URL pattern',
      settings_rulePatternHint: 'Examples: example.com · *.example.com · https://example.com/docs/*',
      settings_ruleEngine: 'Preferred engine',
      settings_ruleAuto: 'Open automatically on error',
      settings_ruleInvalid: 'Enter a host or URL pattern.',
      settings_ruleDelete: 'Delete rule',
      settings_ruleNone: 'No rules yet.',

      settings_section_history: 'Recent lookups',
      settings_historyEnabled: 'Remember recent lookups',
      settings_historyEnabledDesc:
        'Stores the URLs you look up, and the engine used, on this device only. Nothing is ever transmitted.',
      settings_historyLimit: 'Keep at most',
      settings_historyClear: 'Clear history',
      settings_historyCleared: 'History cleared.',
      settings_historyEmpty: 'Nothing here yet.',
      settings_historyOpen: 'Look up again',
      settings_historyRemove: 'Remove entry',

      settings_section_shortcuts: 'Keyboard',
      settings_shortcutLauncher: 'Open the launcher',
      settings_shortcutQuick: 'Look up on the first engine',
      settings_shortcutCurrentDoc: 'Open the original page',
      settings_shortcutRecord: 'Press a key combination…',
      settings_shortcutClear: 'Clear',
      settings_shortcutConflict: 'That combination is already used by $ACTION$.',
      settings_shortcutInvalid: 'Use at least one modifier key.',
      settings_shortcutsInPage:
        'Shortcuts are handled inside the page. They are ignored while you are typing in a text field.',

      settings_section_appearance: 'Appearance',
      settings_showLauncherButton: 'Show a floating launcher button',
      settings_launcherButtonPosition: 'Button position',
      settings_position_bottomRight: 'Bottom right',
      settings_position_bottomLeft: 'Bottom left',
      settings_position_topRight: 'Top right',
      settings_position_topLeft: 'Top left',
      settings_reduceMotion: 'Reduce motion',
      settings_notifications: 'Notifications',
      settings_notifications_toast: 'In-page only',
      settings_notifications_native: 'Native notifications',
      settings_notifications_off: 'Off',

      settings_section_data: 'Settings data',
      settings_export: 'Export settings',
      settings_import: 'Import settings',
      settings_importPlaceholder: 'Paste exported settings here',
      settings_importApply: 'Apply',
      settings_imported: 'Settings imported.',
      settings_importFailed: 'That does not look like exported Web Archives settings.',
      settings_reset: 'Reset everything to defaults',
      settings_resetConfirm: 'Reset every setting, rule and custom engine to its default?',
      settings_resetDone: 'Settings reset to defaults.',
      settings_storageUnavailable:
        'This userscript manager did not grant storage access, so settings only last until the page is closed.',

      settings_section_diagnostics: 'Diagnostics',
      diagnostics_title: 'Diagnostics',
      diagnostics_copy: 'Copy diagnostics',
      diagnostics_copied: 'Diagnostics copied to the clipboard.',
      diagnostics_manager: 'Userscript manager',
      diagnostics_capabilities: 'Capabilities',
      diagnostics_platform: 'Platform',
      diagnostics_target: 'Resolved lookup URL',
      diagnostics_engineTargets: 'Engine targets',
      diagnostics_probeCache: 'Availability cache',
      diagnostics_log: 'Recent log',
      diagnostics_storage: 'Stored settings',
      diagnostics_noLog: 'Nothing logged yet.',

      /* error-page prompt */
      errorPrompt_title: 'This page returned $STATUS$',
      errorPrompt_titleGeneric: 'This page did not load correctly',
      errorPrompt_body: 'An archived copy may still be readable.',
      errorPrompt_open: 'Open the archived copy',
      errorPrompt_choose: 'Choose an engine',
      errorPrompt_dismiss: 'Dismiss',
      errorPrompt_never: 'Never for this site',
      errorPrompt_neverDone: 'The prompt is disabled for $HOST$.',

      /* current-document banner */
      currentDoc_bannerTitle: 'You are reading an archived copy',
      currentDoc_bannerBody: 'Original: $URL$',
      currentDoc_bannerOpen: 'Open the original',
      currentDoc_bannerCopy: 'Copy the original URL',
      currentDoc_bannerDismiss: 'Dismiss',

      /* engine automation */
      engineRun_searching: 'Looking for a cached copy on $ENGINE$…',
      engineRun_noResult: '$ENGINE$ has no cached copy of that page.',
      engineRun_failed: 'The $ENGINE$ lookup could not be completed.',
      engineRun_taskExpired: 'That lookup expired before the page finished loading.',

      /* generic */
      notice_copied: 'Copied to the clipboard.',
      notice_copyFailed: 'Could not write to the clipboard.',
      notice_openBlocked: 'The browser blocked the new tab. Allow pop-ups for this site, or use the copy action.',
      notice_searchStarted_one: 'Opening $ENGINE$…',
      notice_searchStarted_many: 'Opening $COUNT$ engines…',
      notice_noAvailableEngines: 'None of the enabled engines reported a snapshot.',
      notice_storageReadonly: 'Settings could not be saved: this manager did not grant storage access.',
      button_cancel: 'Cancel',
      button_close: 'Close',
      button_ok: 'OK',
      button_back: 'Back',
      label_yes: 'Yes',
      label_no: 'No',
      label_unknown: 'Unknown',
      label_never: 'Never',
      label_minutes: '$COUNT$ minutes',
      label_hours: '$COUNT$ hours',
      label_entries: '$COUNT$ entries',

      /* contribution notice */
      contribute_title: 'Web Archives is free software',
      contribute_body:
        'Web Archives is open-source software built for exploring cached and preserved web history.',
      contribute_open: 'Open the project page',
      contribute_hide: 'Don’t show this again'
    };

    const catalogue = Object.assign(Object.create(null), baseStrings, adapted, added);

    /**
     * Resolves a message and substitutes `$NAME$` placeholders.
     *
     * Substitution is *not* done with a string replacement argument, so a
     * placeholder value containing `$&` (perfectly possible in a URL) can never
     * inject the surrounding match back into the result.
     */
    function getText(key, substitutions) {
      const template = catalogue[key];
      if (template === undefined) {
        if (env.log.isDebug()) env.log.warn(`missing message: ${key}`);
        return key;
      }
      if (substitutions === undefined || substitutions === null) return template;

      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      let index = 0;
      return template.replace(/\$([A-Z0-9_]+)\$/g, () => {
        const value = values[index];
        index += 1;
        return value === undefined || value === null ? '' : String(value);
      });
    }

    function has(key) {
      return Object.hasOwn(catalogue, key);
    }

    /** Every key, for the build-time completeness check. */
    function keys() {
      return Object.keys(catalogue);
    }

    return {getText, has, keys};
  })();

  const getText = i18n.getText;

  /* =======================================================================
   * SECTION 04 — Product data: engines, hosts, patterns
   * -----------------------------------------------------------------------
   * Engine definitions, host mappings, and URL patterns.
   * All configuration values are fully typed and validated.
   * ==================================================================== */

  const data = (() => {
    /* ------------------------------------------------------- option surface */

    /** Base `optionKeys` describing core search and behavior options. */
    const baseOptionKeys = [
      'engines',
      'disabledEngines',
      'showInContextMenu',
      'searchAllEnginesContextMenu',
      'searchAllEnginesAction',
      'showPageAction',
      'tabInBackgound',
      'searchModeAction',
      'searchModeContextMenu',
      'showEngineIcons',
      'openCurrentDocContextMenu',
      'appTheme',
      'showContribPage',
      'pinActionToolbarOpenCurrentDoc',
      'pinActionToolbarOptions',
      'pinActionToolbarContribute',
      'archiveOrgHost',
      'archiveIsHost'
    ];

    /* ------------------------------------------------------------- hosts */

    const archiveOrgHosts = {
      web_archive_org: 'web.archive.org',
      onion_1: 'web.archivep75mbjunhxc6x4j5mwjmomyxb573v42baldlqu56ruil2oiad.onion'
    };

    const archiveIsHosts = {
      archive_is: 'archive.is',
      archive_today: 'archive.today',
      archive_ph: 'archive.ph',
      archive_vn: 'archive.vn',
      archive_fo: 'archive.fo',
      archive_li: 'archive.li',
      archive_md: 'archive.md',
      onion_1: 'archiveiya74codqgiixo33q62qlrqtkgmcitqx5u2oeqnmn5bpcbiyd.onion'
    };

    /* -------------------------------------------------------- engine table */

    /**
     * `target` placeholder vocabulary:
     *   {host}   — the configured archive host
     *   {url}    — the page URL, encoded unless `rawUrl` is set
     *   {date}   — today, YYYY-MM-DD
     *
     * `mode` discriminants:
     *   'direct'   — navigate straight to `target`
     *   'automate' — `target` is a search page the script drives
     *   'api'      — resolved through an HTTP API before any tab is opened
     */
    const builtinEngines = {
      archiveOrg: {
        target: 'https://{host}/web/{url}',
        mode: 'direct',
        rawUrl: true,
        normalize: true,
        hostOption: 'archiveOrgHost',
        probe: 'archiveOrg',
        capture: 'https://web.archive.org/save/{rawUrl}',
        snapshots: true,
        accent: '#2f6fed'
      },
      archiveOrgAll: {
        target: 'https://{host}/web/*/{url}',
        mode: 'direct',
        rawUrl: true,
        normalize: true,
        hostOption: 'archiveOrgHost',
        probe: 'archiveOrg',
        snapshots: true,
        accent: '#2f6fed'
      },
      yandex: {
        target: 'https://www.yandex.com/',
        mode: 'automate',
        probe: null,
        accent: '#e03a3a'
      },
      archiveIs: {
        target: 'https://{host}/newest/{url}',
        mode: 'direct',
        rawUrl: true,
        hostOption: 'archiveIsHost',
        probe: 'archiveIs',
        capture: 'https://{host}/?run=1&url={url}',
        accent: '#c0392b'
      },
      archiveIsAll: {
        target: 'https://{host}/{url}',
        mode: 'direct',
        rawUrl: true,
        hostOption: 'archiveIsHost',
        probe: 'archiveIs',
        accent: '#c0392b'
      },
      permacc: {
        target: 'https://perma.cc/',
        mode: 'api',
        probe: 'permacc',
        accent: '#1f7a54'
      },
      megalodon: {
        target: 'https://megalodon.jp/?url={url}',
        mode: 'automate',
        probe: null,
        accent: '#4a6fa5'
      },
      ghostarchive: {
        target: 'https://ghostarchive.org/search?term={url}',
        mode: 'automate',
        probe: null,
        accent: '#5b5b73'
      },
      webcite: {
        target: 'https://webcitation.org/query?url={url}&date={date}',
        mode: 'direct',
        probe: null,
        accent: '#7a5c1f'
      },
      softwareHeritage: {
        target: 'https://archive.softwareheritage.org/browse/origin/?origin_url={url}',
        mode: 'direct',
        probe: 'softwareHeritage',
        accent: '#c8503c'
      }
    };

    /** Default engine order. */
    const defaultEngineOrder = [
      'archiveOrg',
      'archiveOrgAll',
      'yandex',
      'archiveIs',
      'archiveIsAll',
      'permacc',
      'megalodon',
      'ghostarchive',
      'webcite',
      'softwareHeritage'
    ];

    /** Disabled on a fresh install, per the same revision chain. */
    const defaultDisabledEngines = ['archiveOrgAll', 'archiveIsAll'];

    const engineIconAlias = {
      archiveOrgAll: 'archiveOrg',
      archiveIsAll: 'archiveIs'
    };

    /* --------------------------------------------------- archive host maps */

    const pageArchiveHosts = {
      archiveOrg: Object.values(archiveOrgHosts),
      archiveIs: Object.values(archiveIsHosts),
      yandex: ['yandexwebcache.net'],
      permacc: ['perma.cc', 'rejouer.perma.cc'],
      megalodon: ['megalodon.jp'],
      ghostarchive: ['ghostarchive.org'],
      webcite: ['www.webcitation.org']
    };

    const linkArchiveHosts = {
      archiveOrg: Object.values(archiveOrgHosts),
      archiveIs: Object.values(archiveIsHosts),
      permacc: ['rejouer.perma.cc'],
      megalodon: ['megalodon.jp'],
      ghostarchive: ['ghostarchive.org']
    };

    const linkArchiveUrlRx = {
      archiveOrg:
        /^https?:\/\/web\.(?:archive\.org|archivep75mbjunhxc6x4j5mwjmomyxb573v42baldlqu56ruil2oiad\.onion)\/web\/[0-9]+(?:id_|if_|im_|js_|cs_|oe_|fw_)?\/(.*)/i,
      archiveIs:
        /^https?:\/\/(?:archive\.(?:is|today|ph|vn|fo|li|md)|archiveiya74codqgiixo33q62qlrqtkgmcitqx5u2oeqnmn5bpcbiyd\.onion)\/o\/.*?\/(.*)/i,
      permacc: /^https?:\/\/rejouer\.perma\.cc\/.*(?:\/|[0-9]+)mp_\/\/?\/?(.*)/i,
      megalodon: /https?:\/\/megalodon\.jp\/(?:\d+-)+\d+\/(.*)/i,
      ghostarchive: /^https?:\/\/ghostarchive\.org\/.*(?:\/|[0-9]+)mp_\/\/?\/?(.*)/i
    };

    /** Engines whose recovered document URL may lack a scheme. */
    const schemelessDocUrlEngines = ['permacc', 'ghostarchive'];

    /* ---------------------------------------------------------- HTTP errors */

    /** Standard HTTP error codes eligible for archive fallback lookup. */
    const errorCodes = [
      400, 403, 404, 408, 410, 429, 451, 500, 502, 503, 504,
      // Nonstandard
      444, 450, 509, 530, 598,
      // Cloudflare
      520, 521, 522, 523, 524, 525, 526, 527
    ];

    /* ------------------------------------------------------------- project */

    const supportUrl = 'https://github.com/shivanshjain456/web-archives/issues';
    const projectUrl = 'https://github.com/shivanshjain456/web-archives';

    /* --------------------------------------------------------- URL hygiene */

    /**
     * Query parameters removed by the optional "strip tracking parameters"
     * lookup rule. Archives key on the exact URL, so a campaign-tagged link
     * routinely misses an existing snapshot of the clean URL.
     */
    const trackingParams = [
      /^utm_/i, /^ga_/i, /^_ga$/i, /^gclid$/i, /^gclsrc$/i, /^dclid$/i, /^gbraid$/i, /^wbraid$/i,
      /^fbclid$/i, /^igshid$/i, /^igsh$/i, /^msclkid$/i, /^mc_[ce]id$/i, /^yclid$/i, /^twclid$/i,
      /^ttclid$/i, /^li_fat_id$/i, /^vero_id$/i, /^s_kwcid$/i, /^ef_id$/i, /^_hsenc$/i, /^_hsmi$/i,
      /^hsCtaTracking$/i, /^oly_(?:anon|enc)_id$/i, /^__s$/i, /^rb_clickid$/i, /^sc_cid$/i,
      /^wickedid$/i, /^spm$/i, /^scm$/i, /^ref_src$/i, /^ref_url$/i, /^cmpid$/i, /^campaign_id$/i,
      /^mkt_tok$/i, /^trk$/i, /^trkCampaign$/i, /^guccounter$/i, /^guce_referrer/i
    ];

    /* --------------------------------------------------------------- icons */

    /**
     * Compact inline monogram in each engine's brand accent colour.
     * This keeps the `showEngineIcons` option meaningful without external assets.
     */
    const engineMonogram = {
      archiveOrg: 'W',
      archiveIs: 'A',
      yandex: 'Y',
      permacc: 'P',
      megalodon: 'M',
      ghostarchive: 'G',
      webcite: 'C',
      softwareHeritage: 'H',
      allEngines: '∗'
    };

    return {
      baseOptionKeys,
      archiveOrgHosts,
      archiveIsHosts,
      builtinEngines,
      defaultEngineOrder,
      defaultDisabledEngines,
      engineIconAlias,
      engineMonogram,
      pageArchiveHosts,
      linkArchiveHosts,
      linkArchiveUrlRx,
      schemelessDocUrlEngines,
      errorCodes,
      supportUrl,
      projectUrl,
      trackingParams
    };
  })();

  /* =======================================================================
   * SECTION 05 — Settings store
   * -----------------------------------------------------------------------
   * Persistent settings store with a declarative schema, per-key validation,
   * a numbered migration chain, defensive reads that repair rather than reject
   * damaged state, and cross-tab synchronisation through value-change events.
   *
   * Invariants:
   *   - a read never throws and never returns a value that fails its own
   *     validator;
   *   - an unknown or malformed persisted value is repaired to the default
   *     and the repair is logged, never silently discarded;
   *   - writes are coalesced and always flushed before the page is discarded;
   *   - the in-memory snapshot is the single source of truth for the UI.
   * ==================================================================== */

  const store = (() => {
    const STORAGE_KEY = 'web-archives:settings';
    const HISTORY_KEY = 'web-archives:history';
    const STATS_KEY = 'web-archives:stats';
    const SCHEMA_VERSION = 3;

    /* ------------------------------------------------------------ validators */

    const v = {
      bool: fallback => value => (typeof value === 'boolean' ? value : fallback),

      enumOf: (allowed, fallback) => value => (allowed.includes(value) ? value : fallback),

      int: (min, max, fallback) => value => {
        const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
        if (!Number.isFinite(n)) return fallback;
        return util.clamp(Math.round(n), min, max);
      },

      text: (maxLength, fallback = '') => value => {
        if (typeof value !== 'string') return fallback;
        return value.slice(0, maxLength);
      },

      accelerator: fallback => value => {
        if (typeof value !== 'string') return fallback;
        if (value === '') return '';
        const parsed = util.parseAccelerator(value);
        if (!parsed.key) return fallback;
        // A bare letter would swallow ordinary typing on the host page.
        if (!parsed.ctrl && !parsed.alt && !parsed.meta && !parsed.mod) return fallback;
        return value;
      },

      /** Engine order: known ids only, de-duplicated, missing ids appended. */
      engineOrder: () => value => {
        const known = new Set(data.defaultEngineOrder);
        const seen = new Set();
        const out = [];
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item !== 'string') continue;
            if (!known.has(item) && !item.startsWith('custom:')) continue;
            if (seen.has(item)) continue;
            seen.add(item);
            out.push(item);
          }
        }
        for (const id of data.defaultEngineOrder) {
          if (!seen.has(id)) out.push(id);
        }
        return out;
      },

      engineIdList: () => value => {
        if (!Array.isArray(value)) return [];
        return util.unique(
          value.filter(item => typeof item === 'string' && item.length > 0 && item.length < 64)
        );
      },

      customEngines: () => value => {
        if (!Array.isArray(value)) return [];
        const out = [];
        const seen = new Set();
        for (const item of value.slice(0, 50)) {
          if (!util.isPlainObject(item)) continue;
          const id = typeof item.id === 'string' && /^custom:[\w-]{1,40}$/.test(item.id)
            ? item.id
            : `custom:${util.hashString(String(item.name || '') + String(item.template || ''))}`;
          if (seen.has(id)) continue;
          const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
          const template = typeof item.template === 'string' ? item.template.trim().slice(0, 500) : '';
          if (!name || !isValidEngineTemplate(template)) continue;
          seen.add(id);
          out.push({
            id,
            name,
            template,
            accent: typeof item.accent === 'string' && /^#[0-9a-f]{6}$/i.test(item.accent)
              ? item.accent
              : '#5a6270'
          });
        }
        return out;
      },

      rules: () => value => {
        if (!Array.isArray(value)) return [];
        const out = [];
        for (const item of value.slice(0, 100)) {
          if (!util.isPlainObject(item)) continue;
          const pattern = typeof item.pattern === 'string' ? item.pattern.trim().slice(0, 300) : '';
          if (!pattern) continue;
          out.push({
            id: typeof item.id === 'string' ? item.id.slice(0, 60) : util.uuid(),
            pattern,
            engine: typeof item.engine === 'string' ? item.engine.slice(0, 64) : '',
            autoOnError: item.autoOnError === true
          });
        }
        return out;
      },

      hostList: () => value => {
        if (!Array.isArray(value)) return [];
        return util
          .unique(value.filter(item => typeof item === 'string' && item.length > 0 && item.length < 256))
          .slice(0, 500);
      }
    };

    function isValidEngineTemplate(template) {
      if (typeof template !== 'string' || template.length < 8) return false;
      if (!/^https?:\/\//i.test(template)) return false;
      if (!/\{(?:url|rawUrl|host)\}/.test(template)) return false;
      try {
        // The template must parse once the placeholders are filled with a
        // benign sample; this rejects `https://{url}`-style nonsense early.
        const probeUrl = util.substitute(template, {
          url: encodeURIComponent('https://example.com/'),
          rawUrl: 'https://example.com/',
          host: 'example.com',
          date: '2026-01-01'
        });
        const parsed = new URL(probeUrl);
        return /^https?:$/i.test(parsed.protocol) && !!parsed.hostname;
      } catch {
        return false;
      }
    }

    /* --------------------------------------------------------------- schema */

    /**
     * Each entry: [defaultValue, validator].
     */
    const schema = {
      /* ---- base options ---- */
      engines: [data.defaultEngineOrder.slice(), v.engineOrder()],
      disabledEngines: [data.defaultDisabledEngines.slice(), v.engineIdList()],
      showInContextMenu: ['link', v.enumOf(['all', 'link', 'false'], 'link')],
      searchAllEnginesContextMenu: ['sub', v.enumOf(['main', 'sub', 'false'], 'sub')],
      searchAllEnginesAction: ['sub', v.enumOf(['main', 'sub', 'false'], 'sub')],
      showPageAction: [false, v.bool(false)],
      tabInBackgound: [false, v.bool(false)],
      searchModeAction: ['tab', v.enumOf(['tab', 'url'], 'tab')],
      searchModeContextMenu: ['tab', v.enumOf(['tab', 'url'], 'tab')],
      showEngineIcons: [true, v.bool(true)],
      openCurrentDocContextMenu: [true, v.bool(true)],
      appTheme: ['auto', v.enumOf(['auto', 'light', 'dark'], 'auto')],
      showContribPage: [true, v.bool(true)],
      pinActionToolbarOpenCurrentDoc: [true, v.bool(true)],
      pinActionToolbarOptions: [false, v.bool(false)],
      pinActionToolbarContribute: [true, v.bool(true)],
      archiveOrgHost: ['web_archive_org', v.enumOf(Object.keys(data.archiveOrgHosts), 'web_archive_org')],
      archiveIsHost: ['archive_is', v.enumOf(Object.keys(data.archiveIsHosts), 'archive_is')],

      /* ---- userscript additions ---- */

      // URL handling before a lookup is built.
      stripFragment: [true, v.bool(true)],
      stripQuery: [false, v.bool(false)],
      stripTrackingParams: [true, v.bool(true)],
      preferCanonical: [false, v.bool(false)],

      // Availability probing.
      probeMode: ['open', v.enumOf(['open', 'manual', 'off'], 'open')],
      probeTtlMinutes: [60, v.int(1, 10080, 60)],
      probeConcurrency: [3, v.int(1, 8, 3)],

      // Broken-page offer — the reimplementation of `showPageAction`.
      errorOffer: [true, v.bool(true)],
      errorOfferEngine: ['archiveOrg', v.text(64, 'archiveOrg')],
      errorOfferAuto: [false, v.bool(false)],
      errorOfferBlockedHosts: [[], v.hostList()],

      // In-page right-click menu.
      contextTrigger: ['shift', v.enumOf(['shift', 'mod', 'plain', 'off'], 'shift')],

      // Launcher affordances.
      showLauncherButton: [false, v.bool(false)],
      launcherButtonPosition: [
        'bottomRight',
        v.enumOf(['bottomRight', 'bottomLeft', 'topRight', 'topLeft'], 'bottomRight')
      ],
      reduceMotion: [false, v.bool(false)],
      notificationMode: ['toast', v.enumOf(['toast', 'native', 'off'], 'toast')],

      // Keyboard.
      shortcutLauncher: ['ctrl+shift+a', v.accelerator('ctrl+shift+a')],
      shortcutQuick: ['', v.accelerator('')],
      shortcutCurrentDoc: ['', v.accelerator('')],

      // Recent lookups.
      historyEnabled: [true, v.bool(true)],
      historyLimit: [100, v.int(10, 1000, 100)],

      // User-defined engines and per-site rules.
      customEngines: [[], v.customEngines()],
      rules: [[], v.rules()],

      // Contribution notice bookkeeping.
      contribNoticeDismissed: [false, v.bool(false)],

      // Diagnostics.
      debug: [false, v.bool(false)]
    };

    const defaults = Object.freeze(
      Object.fromEntries(Object.entries(schema).map(([key, [value]]) => [key, util.deepClone(value)]))
    );

    /* ----------------------------------------------------------- migrations */

    /**
     * Numbered, forward-only, idempotent. Each step receives the raw persisted
     * object and returns it mutated; a throwing step is logged and skipped so
     * one bad migration cannot brick the settings.
     */
    const migrations = [
      {
        version: 1,
        description: 'Initialize base option names and defaults',
        apply(raw) {
          if (Array.isArray(raw.engines)) {
            raw.engines = raw.engines.filter(id => data.defaultEngineOrder.includes(id));
          }
          if (typeof raw.showInContextMenu === 'boolean') {
            raw.showInContextMenu = raw.showInContextMenu ? 'all' : 'false';
          }
          return raw;
        }
      },
      {
        version: 2,
        description: 'Introduce lookup, probing and error-offer options',
        apply(raw) {
          // In-page broken-page offer initialization. Honour existing value
          // the first time we see it so an importing user keeps their choice.
          if (typeof raw.showPageAction === 'boolean' && raw.errorOffer === undefined) {
            raw.errorOffer = raw.showPageAction;
          }
          return raw;
        }
      },
      {
        version: 3,
        description: 'Add site rules, custom engines and keyboard shortcuts',
        apply(raw) {
          if (!Array.isArray(raw.rules)) raw.rules = [];
          if (!Array.isArray(raw.customEngines)) raw.customEngines = [];
          return raw;
        }
      }
    ];

    /* ------------------------------------------------------------- internals */

    let state = util.deepClone(defaults);
    let loaded = false;
    let readOnly = !env.capabilities.persistentStorage;
    let unwatch = null;
    const listeners = new Set();
    const repairs = [];

    function sanitize(raw) {
      const out = {};
      const source = util.isPlainObject(raw) ? raw : {};

      for (const [key, [defaultValue, validate]] of Object.entries(schema)) {
        const provided = source[key];
        if (provided === undefined) {
          out[key] = util.deepClone(defaultValue);
          continue;
        }
        let value;
        try {
          value = validate(provided);
        } catch (err) {
          env.log.warn(`validator for "${key}" threw; using default`, err);
          value = util.deepClone(defaultValue);
        }
        if (value === undefined) value = util.deepClone(defaultValue);
        if (!util.deepEqual(value, provided)) {
          repairs.push({key, from: provided, to: value});
        }
        out[key] = value;
      }

      /* --- cross-key invariants ---------------------------------------- */

      // A disabled engine must exist in the order list, otherwise the two
      // arrays drift apart and an engine becomes permanently invisible.
      const orderSet = new Set(out.engines.concat(out.customEngines.map(e => e.id)));
      const filteredDisabled = out.disabledEngines.filter(id => orderSet.has(id));
      if (filteredDisabled.length !== out.disabledEngines.length) {
        repairs.push({key: 'disabledEngines', from: out.disabledEngines, to: filteredDisabled});
        out.disabledEngines = filteredDisabled;
      }

      // Custom engines participate in ordering; append any that are missing.
      for (const engine of out.customEngines) {
        if (!out.engines.includes(engine.id)) out.engines.push(engine.id);
      }
      // …and drop order entries for custom engines that no longer exist.
      const customIds = new Set(out.customEngines.map(e => e.id));
      out.engines = out.engines.filter(id => !id.startsWith('custom:') || customIds.has(id));

      // A rule may not point at an engine that has been deleted.
      out.rules = out.rules.map(rule =>
        rule.engine && !orderSet.has(rule.engine) ? {...rule, engine: ''} : rule
      );

      // The broken-page offer needs a real engine.
      if (!orderSet.has(out.errorOfferEngine)) {
        const fallback = out.engines.find(id => !out.disabledEngines.includes(id)) || 'archiveOrg';
        if (out.errorOfferEngine !== fallback) {
          repairs.push({key: 'errorOfferEngine', from: out.errorOfferEngine, to: fallback});
        }
        out.errorOfferEngine = fallback;
      }

      // Two shortcuts must never be identical, or one becomes unreachable.
      const shortcutKeys = ['shortcutLauncher', 'shortcutQuick', 'shortcutCurrentDoc'];
      const usedShortcuts = new Set();
      for (const key of shortcutKeys) {
        const value = out[key];
        if (!value) continue;
        if (usedShortcuts.has(value)) {
          repairs.push({key, from: value, to: ''});
          out[key] = '';
        } else {
          usedShortcuts.add(value);
        }
      }

      return out;
    }

    function runMigrations(raw) {
      if (!util.isPlainObject(raw)) return {__version: SCHEMA_VERSION};

      let current = Number.isFinite(raw.__version) ? raw.__version : 0;
      for (const migration of migrations) {
        if (current >= migration.version) continue;
        try {
          raw = migration.apply(raw) || raw;
          env.log.debug(`migration ${migration.version} applied: ${migration.description}`);
        } catch (err) {
          env.log.error(`migration ${migration.version} failed`, err);
        }
        current = migration.version;
      }
      raw.__version = SCHEMA_VERSION;
      return raw;
    }

    /* ---------------------------------------------------------- persistence */

    let writeGeneration = 0;

    const persist = util.debounce(async () => {
      if (readOnly) return;
      const generation = ++writeGeneration;
      const payload = {...util.deepClone(state), __version: SCHEMA_VERSION};
      const ok = await env.storage.set(STORAGE_KEY, payload);
      if (!ok) {
        readOnly = true;
        notify({type: 'readonly'});
      }
      if (generation !== writeGeneration) {
        // A newer write superseded this one before it landed; the newer write
        // has its own scheduled flush, so nothing to do.
        env.log.debug('superseded settings write');
      }
    }, 180);

    function notify(detail) {
      for (const listener of [...listeners]) {
        try {
          listener(state, detail);
        } catch (err) {
          env.log.error('settings listener threw', err);
        }
      }
    }

    async function load() {
      if (loaded) return state;

      let raw = null;
      try {
        raw = await env.storage.get(STORAGE_KEY, null);
      } catch (err) {
        env.log.error('settings load failed', err);
      }

      if (typeof raw === 'string') {
        // Some managers round-trip objects as JSON strings.
        try {
          raw = JSON.parse(raw);
        } catch {
          env.log.warn('stored settings were an unparsable string; starting fresh');
          raw = null;
        }
      }

      repairs.length = 0;
      state = sanitize(runMigrations(raw));
      loaded = true;

      env.log.setDebug(state.debug);

      if (repairs.length) {
        env.log.warn(`repaired ${repairs.length} stored setting(s)`, repairs.map(r => r.key).join(', '));
        // Persist the repair so the damaged value does not have to be fixed
        // again on every page load.
        persist();
      }

      // Cross-tab synchronisation: another tab's change is adopted verbatim.
      unwatch = env.storage.watch(STORAGE_KEY, ({newValue, remote}) => {
        if (!remote) return;
        try {
          const parsed = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
          const next = sanitize(runMigrations(parsed));
          if (util.deepEqual(next, state)) return;
          state = next;
          env.log.setDebug(state.debug);
          notify({type: 'remote'});
        } catch (err) {
          env.log.warn('remote settings update ignored', err);
        }
      });

      return state;
    }

    /* ------------------------------------------------------------- accessors */

    function get(key) {
      if (!Object.hasOwn(schema, key)) {
        env.log.warn(`unknown setting read: ${key}`);
        return undefined;
      }
      const value = state[key];
      return typeof value === 'object' && value !== null ? util.deepClone(value) : value;
    }

    function all() {
      return util.deepClone(state);
    }

    /**
     * Applies a patch, validating the *whole* object so that cross-key
     * invariants are re-established on every write. Returns the keys that
     * actually changed.
     */
    function set(patch, {silent = false} = {}) {
      if (!util.isPlainObject(patch)) return [];

      const candidate = {...state};
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(schema, key)) {
          env.log.warn(`unknown setting write ignored: ${key}`);
          continue;
        }
        candidate[key] = value;
      }

      const next = sanitize(candidate);
      const changed = Object.keys(schema).filter(key => !util.deepEqual(next[key], state[key]));
      if (!changed.length) return [];

      state = next;
      env.log.setDebug(state.debug);
      persist();
      if (!silent) notify({type: 'local', changed});
      return changed;
    }

    function reset() {
      state = sanitize({});
      persist();
      notify({type: 'reset', changed: Object.keys(schema)});
      return state;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    /* ------------------------------------------------------ import / export */

    function exportSettings() {
      // `baseOptions` is the core subset of options.
      const baseOptions = {};
      for (const key of data.baseOptionKeys) {
        if (Object.hasOwn(state, key)) baseOptions[key] = util.deepClone(state[key]);
      }

      return {
        app: env.APP_ID,
        version: env.APP_VERSION,
        schema: SCHEMA_VERSION,
        exported: new Date().toISOString(),
        settings: util.deepClone(state),
        baseOptions
      };
    }

    function importSettings(payload) {
      let parsed = payload;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return {ok: false, reason: 'parse'};
        }
      }
      if (!util.isPlainObject(parsed)) return {ok: false, reason: 'shape'};

      // Accept either our envelope or a bare settings object.
      const candidate = util.isPlainObject(parsed.settings) ? parsed.settings : parsed;
      const recognised = Object.keys(candidate).some(key => Object.hasOwn(schema, key));
      if (!recognised) return {ok: false, reason: 'unrecognised'};

      const migrated = runMigrations({...util.deepClone(candidate), __version: parsed.schema ?? 0});
      state = sanitize(migrated);
      persist();
      notify({type: 'import', changed: Object.keys(schema)});
      return {ok: true};
    }

    /* --------------------------------------------------- history & counters */

    let historyCache = null;

    async function readHistory() {
      if (historyCache) return historyCache;
      let raw = await env.storage.get(HISTORY_KEY, []);
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = [];
        }
      }
      if (!Array.isArray(raw)) raw = [];

      historyCache = raw
        .filter(
          item =>
            util.isPlainObject(item) &&
            typeof item.url === 'string' &&
            item.url.length > 0 &&
            item.url.length <= 2048
        )
        .map(item => ({
          url: item.url,
          engine: typeof item.engine === 'string' ? item.engine.slice(0, 64) : '',
          title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
          time: Number.isFinite(item.time) ? item.time : 0
        }))
        .slice(0, 1000);

      return historyCache;
    }

    const persistHistory = util.debounce(async () => {
      if (readOnly || !historyCache) return;
      await env.storage.set(HISTORY_KEY, historyCache);
    }, 400);

    async function addHistory(entry) {
      if (!state.historyEnabled) return;
      const list = await readHistory();
      const record = {
        url: String(entry.url || '').slice(0, 2048),
        engine: String(entry.engine || '').slice(0, 64),
        title: String(entry.title || '').slice(0, 200),
        time: Date.now()
      };
      if (!record.url) return;

      // Collapse an immediate repeat of the same url+engine pair.
      const existing = list.findIndex(item => item.url === record.url && item.engine === record.engine);
      if (existing >= 0) list.splice(existing, 1);

      list.unshift(record);
      if (list.length > state.historyLimit) list.length = state.historyLimit;
      persistHistory();
    }

    async function getHistory() {
      const list = await readHistory();
      return list.slice(0, state.historyLimit);
    }

    async function removeHistory(index) {
      const list = await readHistory();
      if (index < 0 || index >= list.length) return;
      list.splice(index, 1);
      persistHistory();
    }

    async function clearHistory() {
      historyCache = [];
      persistHistory.cancel();
      await env.storage.set(HISTORY_KEY, []);
    }

    /* -- usage statistics (`useCount` / `installTime` family) --- */

    let statsCache = null;

    async function readStats() {
      if (statsCache) return statsCache;
      let raw = await env.storage.get(STATS_KEY, null);
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }
      const now = util.getDayPrecisionEpoch();
      statsCache = {
        useCount: Number.isFinite(raw?.useCount) ? util.clamp(raw.useCount, 0, 1000) : 0,
        installTime: Number.isFinite(raw?.installTime) ? raw.installTime : now,
        contribNoticeLastShown: Number.isFinite(raw?.contribNoticeLastShown) ? raw.contribNoticeLastShown : 0,
        lastLookup: util.isPlainObject(raw?.lastLookup) ? raw.lastLookup : null
      };
      if (!raw) await env.storage.set(STATS_KEY, statsCache);
      return statsCache;
    }

    const persistStats = util.debounce(async () => {
      if (readOnly || !statsCache) return;
      await env.storage.set(STATS_KEY, statsCache);
    }, 500);

    async function bumpUseCount() {
      const stats = await readStats();
      // Capped at 1000 to keep the value from growing without bound in storage.
      if (stats.useCount < 1000) stats.useCount += 1;
      persistStats();
      return stats;
    }

    async function getStats() {
      return {...(await readStats())};
    }

    async function setStats(patch) {
      const stats = await readStats();
      Object.assign(stats, patch);
      persistStats();
      return stats;
    }

    /* --------------------------------------------------------------- misc */

    function flush() {
      persist.flush();
      persistHistory.flush();
      persistStats.flush();
    }

    function dispose() {
      flush();
      unwatch?.();
      unwatch = null;
      listeners.clear();
    }

    async function storageFootprint() {
      try {
        const keys = await env.storage.keys();
        let bytes = 0;
        for (const key of keys) {
          if (!String(key).startsWith('web-archives:')) continue;
          const value = await env.storage.get(key, null);
          bytes += JSON.stringify(value ?? '').length + String(key).length;
        }
        return bytes;
      } catch {
        return NaN;
      }
    }

    return {
      SCHEMA_VERSION,
      STORAGE_KEY,
      defaults,
      schema,
      load,
      get,
      all,
      set,
      reset,
      subscribe,
      exportSettings,
      importSettings,
      isReadOnly: () => readOnly,
      repairs: () => repairs.slice(),
      isValidEngineTemplate,
      addHistory,
      getHistory,
      removeHistory,
      clearHistory,
      bumpUseCount,
      getStats,
      setStats,
      storageFootprint,
      flush,
      dispose
    };
  })();

  /* =======================================================================
   * SECTION 06 — URL handling
   * -----------------------------------------------------------------------
   * Validation, canonicalisation and archive-target construction.
   *
   * Robust URL construction and validation:
   *
   *  1. Safe placeholder replacement: avoids unsafe string replacement quirks
   *     (`$&`, `` $` ``, etc.) via `util.substitute` replacer functions.
   *  2. `normalizeUrl` handles unexpected inputs gracefully without throwing.
   *  3. Scheme downgrade for onion targets is applied strictly to the template
   *     before substitution, avoiding corruption of nested target URLs.
   * ==================================================================== */

  const urls = (() => {
    const MAX_URL_LENGTH = 2048;

    /* ------------------------------------------------------------ validation */

    /**
     * URL validator. Accepts only valid web schemes (`http:`, `https:`, `ftp:`);
     * anything else is rejected before it can reach a template.
     */
    function validateUrl(url) {
      if (typeof url !== 'string') return false;
      const trimmed = url.trim();
      if (!trimmed || trimmed.length > MAX_URL_LENGTH) return false;
      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        return false;
      }
      if (!/^(?:https?|ftp):$/i.test(parsed.protocol)) return false;
      // A URL with no host cannot be archived and would produce a nonsense
      // target (`https://web.archive.org/web/https:///`).
      if (!parsed.hostname) return false;
      return true;
    }

    function parse(url) {
      try {
        return new URL(String(url));
      } catch {
        return null;
      }
    }

    /** `normalizeUrl`: strips the fragment. */
    function normalizeUrl(url) {
      const parsed = parse(url);
      if (!parsed) return String(url ?? '');
      parsed.hash = '';
      return parsed.toString();
    }

    /** `isMatchingUrlHost`: checks whether a URL matches given hostnames. */
    function isMatchingUrlHost(url, hostnames) {
      const parsed = parse(url);
      if (!parsed) return false;
      return hostnames.includes(parsed.hostname);
    }

    function getHostname(url) {
      return parse(url)?.hostname || '';
    }

    /* -------------------------------------------------------- canonicalising */

    /**
     * Applies the user's lookup rules to produce the URL that will be handed to
     * an archive. Archives key on the exact string, so this is the single most
     * effective lever on hit rate — hence it is configurable rather than fixed.
     */
    function canonicalize(url, options = {}) {
      const parsed = parse(url);
      if (!parsed) return String(url ?? '');

      if (options.stripFragment !== false) parsed.hash = '';

      if (options.stripQuery) {
        parsed.search = '';
      } else if (options.stripTrackingParams) {
        const params = parsed.searchParams;
        const doomed = [];
        for (const key of params.keys()) {
          if (data.trackingParams.some(rx => rx.test(key))) doomed.push(key);
        }
        for (const key of doomed) params.delete(key);
        // Re-serialising an empty parameter list must not leave a bare `?`.
        parsed.search = params.toString() ? `?${params.toString()}` : '';
      }

      return parsed.toString();
    }

    /**
     * The page's own declared canonical URL, when it has one and it is a
     * plausible same-site alternative. Cross-origin canonicals are honoured
     * too (syndicated articles legitimately point at the origin publisher),
     * but only when they validate.
     */
    function readCanonicalLink(doc = document) {
      try {
        const link = doc.querySelector('link[rel~="canonical" i][href]');
        if (!link) return '';
        const href = link.getAttribute('href') || '';
        if (!href) return '';
        const resolved = new URL(href, doc.baseURI || location.href).toString();
        return validateUrl(resolved) ? resolved : '';
      } catch {
        return '';
      }
    }

    /** Resolves the URL a lookup should actually use, given the settings. */
    function resolveLookupUrl(rawUrl, settings, {doc = null, allowCanonical = true} = {}) {
      let candidate = String(rawUrl ?? '').trim();

      if (allowCanonical && settings.preferCanonical && doc) {
        const canonical = readCanonicalLink(doc);
        if (canonical) candidate = canonical;
      }

      if (!validateUrl(candidate)) return {url: candidate, valid: false};

      const cooked = canonicalize(candidate, {
        stripFragment: settings.stripFragment,
        stripQuery: settings.stripQuery,
        stripTrackingParams: settings.stripTrackingParams
      });

      return {url: cooked, valid: validateUrl(cooked) ? true : false, original: candidate};
    }

    /* ------------------------------------------------------- target building */

    /**
     * Builds the URL to open for one engine.
     *
     * Specific engine URL encoding rules:
     *   - archiveOrg / archiveOrgAll: hash stripped, URL substituted RAW
     *   - archiveIs  / archiveIsAll : URL substituted RAW
     *   - every other engine        : URL percent-encoded
     *   - webcite                   : `{date}` = today, YYYY-MM-DD
     */
    function buildEngineTarget(engineId, engine, lookupUrl, settings) {
      if (!engine) return {ok: false, reason: 'unknown-engine'};
      if (!validateUrl(lookupUrl)) return {ok: false, reason: 'invalid-url'};

      let template = engine.target;
      let host = '';

      if (engine.hostOption) {
        const table = engine.hostOption === 'archiveOrgHost' ? data.archiveOrgHosts : data.archiveIsHosts;
        const key = settings[engine.hostOption];
        host = table[key] || Object.values(table)[0];

        // Scheme downgrade for Archive.is onion service only
        // (`archiveIs*` engines); the Wayback onion service is reached over
        // https. The downgrade is applied to the *template*, never to the
        // substituted result — see the header note.
        if (engine.hostOption === 'archiveIsHost' && String(key).startsWith('onion_')) {
          template = template.replace(/^https:/i, 'http:');
        }
      }

      let pageUrl = lookupUrl;
      if (engine.normalize) pageUrl = normalizeUrl(pageUrl);

      const encoded = encodeURIComponent(pageUrl);
      const values = {
        host,
        url: engine.rawUrl ? pageUrl : encoded,
        rawUrl: pageUrl,
        encodedUrl: encoded,
        date: util.isoDate(),
        pageHost: getHostname(pageUrl)
      };

      const target = util.substitute(template, values);

      if (!validateUrl(target)) {
        // A template that produced something unusable must fail loudly rather
        // than navigate the user somewhere unexpected.
        return {ok: false, reason: 'invalid-target', target};
      }

      return {ok: true, target, host, lookupUrl: pageUrl};
    }

    /** Custom-engine targets share the same substitution contract. */
    function buildCustomTarget(customEngine, lookupUrl) {
      if (!validateUrl(lookupUrl)) return {ok: false, reason: 'invalid-url'};
      const values = {
        url: encodeURIComponent(lookupUrl),
        rawUrl: lookupUrl,
        encodedUrl: encodeURIComponent(lookupUrl),
        host: getHostname(lookupUrl),
        pageHost: getHostname(lookupUrl),
        date: util.isoDate()
      };
      const target = util.substitute(customEngine.template, values);
      if (!validateUrl(target)) return {ok: false, reason: 'invalid-target', target};
      return {ok: true, target, lookupUrl};
    }

    /* ------------------------------------------------- archive link decoding */

    /**
     * Recover the original URL that an archive link points at.
     *
     * The extracted tail is URL-decoded when percent-encoded, and the result
     * is validated to ensure snapshot modifiers (`id_`, `if_`, etc.) are cleanly stripped.
     */
    function extractDocUrlFromLink(linkUrl) {
      if (typeof linkUrl !== 'string' || !linkUrl) return null;

      // Cheap host check first: the five patterns are only ever tried for a URL
      // that actually belongs to an archive service, which keeps the common
      // case (an ordinary link) to a single URL parse.
      if (!isArchiveLink(linkUrl)) return null;

      for (const [engine, rx] of Object.entries(data.linkArchiveUrlRx)) {
        const match = linkUrl.match(rx);
        if (!match) continue;

        let docUrl = String(match[1] || '').trim();
        if (!docUrl) continue;

        if (data.schemelessDocUrlEngines.includes(engine) && !/^(?:https?|ftp):\/\//i.test(docUrl)) {
          docUrl = `https://${docUrl}`;
        }

        if (!validateUrl(docUrl) && /%[0-9a-f]{2}/i.test(docUrl)) {
          try {
            const decoded = decodeURIComponent(docUrl);
            if (validateUrl(decoded)) docUrl = decoded;
          } catch {
            /* keep the raw value */
          }
        }

        if (validateUrl(docUrl)) return {engine, docUrl};
      }

      return null;
    }

    /** Which archive engine, if any, serves the given page host. */
    function identifyArchiveHost(hostname) {
      for (const [engine, hosts] of Object.entries(data.pageArchiveHosts)) {
        if (hosts.includes(hostname)) return engine;
      }
      return null;
    }

    /** Which archive engine, if any, a full URL belongs to. */
    function identifyArchiveUrl(url) {
      for (const [engine, hosts] of Object.entries(data.pageArchiveHosts)) {
        if (isMatchingUrlHost(url, hosts)) return engine;
      }
      return null;
    }

    function isArchiveLink(linkUrl) {
      const parsed = parse(linkUrl);
      if (!parsed) return false;
      for (const hosts of Object.values(data.linkArchiveHosts)) {
        if (hosts.includes(parsed.hostname)) return true;
      }
      return false;
    }

    /* ------------------------------------------------------------- patterns */

    /**
     * Compiles a user-authored site-rule pattern.
     *
     * Accepted forms, in order of specificity:
     *   `https://example.com/docs/*`  — full URL glob
     *   `*.example.com`               — host and any subdomain
     *   `example.com`                 — host and any subdomain (implicit)
     *
     * `*` is the only metacharacter; everything else is escaped, so a pattern
     * can never become a catastrophic regular expression.
     */
    /**
     * Linear glob matcher. `*` matches any run of characters; everything else
     * is literal. The two-pointer algorithm with a single backtrack position is
     * O(pattern × text) in the worst case and cannot backtrack exponentially —
     * unlike the equivalent regular expression, where `a*b*c*…*x` against a
     * non-matching string is a classic catastrophic case. Rule patterns are
     * user-authored, so this property is a requirement, not an optimisation.
     */
    function globMatch(pattern, text) {
      const p = pattern;
      const s = text;
      const pl = p.length;
      const sl = s.length;

      let pi = 0;
      let si = 0;
      let starIndex = -1;
      let matchIndex = 0;

      while (si < sl) {
        if (pi < pl && p.charCodeAt(pi) === s.charCodeAt(si)) {
          pi += 1;
          si += 1;
        } else if (pi < pl && p[pi] === '*') {
          starIndex = pi;
          matchIndex = si;
          pi += 1;
        } else if (starIndex !== -1) {
          pi = starIndex + 1;
          matchIndex += 1;
          si = matchIndex;
        } else {
          return false;
        }
      }

      while (pi < pl && p[pi] === '*') pi += 1;
      return pi === pl;
    }

    function compilePattern(pattern) {
      const raw = String(pattern || '').trim();
      if (!raw) return null;

      // Consecutive wildcards are collapsed: they are always redundant, and
      // collapsing keeps the matcher's inner loop short.
      const normalized = raw.replace(/\*{2,}/g, '*').toLowerCase();

      const isUrlPattern = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) || normalized.includes('/');

      if (isUrlPattern) {
        return {
          kind: 'url',
          source: raw,
          // `host` is accepted and ignored so that every compiled pattern has
          // the same signature and `matchRule` can parse the URL exactly once.
          test: (url, _host) => globMatch(normalized, String(url).toLowerCase())
        };
      }

      const hostPattern = normalized.startsWith('*.') ? normalized.slice(2) : normalized;
      return {
        kind: 'host',
        source: raw,
        test: (url, host) => {
          const hostname = (host === undefined ? getHostname(url) : host).toLowerCase();
          if (!hostname) return false;
          if (globMatch(hostPattern, hostname)) return true;
          // implicit subdomain match: `example.com` also matches `a.example.com`
          const parts = hostname.split('.');
          for (let i = 1; i < parts.length - 1; i += 1) {
            if (globMatch(hostPattern, parts.slice(i).join('.'))) return true;
          }
          return false;
        }
      };
    }

    const patternCache = new util.LruCache({max: 200});

    function matchRule(rules, url) {
      if (!Array.isArray(rules) || !rules.length) return null;

      // Parsed once for the whole rule set: `new URL()` inside the loop was by
      // far the dominant cost when a user has many rules.
      const host = getHostname(url);

      for (const rule of rules) {
        let compiled = patternCache.get(rule.pattern);
        if (compiled === undefined) {
          compiled = compilePattern(rule.pattern) || null;
          patternCache.set(rule.pattern, compiled);
        }
        if (compiled && compiled.test(url, host)) return rule;
      }
      return null;
    }

    /* -------------------------------------------------------------- display */

    /** Human-readable, decoded-where-safe rendering for the UI. */
    function displayUrl(url, maxLength = 78) {
      const parsed = parse(url);
      if (!parsed) return util.truncateMiddle(String(url ?? ''), maxLength);

      let text;
      try {
        text = decodeURI(parsed.toString());
      } catch {
        text = parsed.toString();
      }
      text = text.replace(/^https?:\/\//i, '');
      return util.truncateMiddle(text, maxLength);
    }

    return {
      MAX_URL_LENGTH,
      validateUrl,
      parse,
      normalizeUrl,
      isMatchingUrlHost,
      getHostname,
      canonicalize,
      readCanonicalLink,
      resolveLookupUrl,
      buildEngineTarget,
      buildCustomTarget,
      extractDocUrlFromLink,
      identifyArchiveHost,
      identifyArchiveUrl,
      isArchiveLink,
      compilePattern,
      globMatch,
      matchRule,
      displayUrl
    };
  })();

  /* =======================================================================
   * SECTION 07 — Result ranking
   * -----------------------------------------------------------------------
   * Result ranking algorithms: `processResult`, `getResultRank`, and
   * `getRankedResults`, deciding which of several candidate cache links
   * on an engine's results page actually corresponds to the target URL.
   * Used by the Yandex automation.
   *
   * Registrable-domain extraction is performed with a curated multi-label suffix
   * table plus ICANN wildcard rules, keeping the script self-contained and
   * lightweight without external package dependencies.
   * ==================================================================== */

  const ranking = (() => {
    /**
     * Multi-label public suffixes. Single-label suffixes (com, org, de, …)
     * need no table: the "last two labels" default already handles them.
     */
    const MULTI_LABEL_SUFFIXES = new Set([
      // generic second levels used across many ccTLDs
      'com.ac', 'edu.ac', 'gov.ac', 'net.ac', 'mil.ac', 'org.ac',
      'com.af', 'edu.af', 'gov.af', 'net.af', 'org.af',
      'com.ag', 'org.ag', 'net.ag', 'co.ag', 'nom.ag',
      'com.ai', 'net.ai', 'org.ai', 'off.ai',
      'co.am', 'com.am', 'net.am', 'org.am',
      'com.ar', 'edu.ar', 'gob.ar', 'gov.ar', 'int.ar', 'mil.ar', 'net.ar', 'org.ar', 'tur.ar',
      'ac.at', 'co.at', 'gv.at', 'or.at',
      'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au', 'csiro.au',
      'com.aw', 'com.az', 'net.az', 'int.az', 'gov.az', 'org.az', 'edu.az', 'info.az', 'pp.az', 'mil.az',
      'com.ba', 'edu.ba', 'gov.ba', 'mil.ba', 'net.ba', 'org.ba',
      'com.bb', 'edu.bb', 'gov.bb', 'net.bb', 'org.bb',
      'com.bd', 'edu.bd', 'gov.bd', 'net.bd', 'org.bd', 'ac.bd',
      'com.bh', 'edu.bh', 'net.bh', 'org.bh', 'gov.bh',
      'com.bi', 'edu.bi', 'or.bi', 'org.bi',
      'com.bm', 'edu.bm', 'gov.bm', 'net.bm', 'org.bm',
      'com.bn', 'edu.bn', 'gov.bn', 'net.bn', 'org.bn',
      'com.bo', 'edu.bo', 'gov.bo', 'gob.bo', 'int.bo', 'org.bo', 'net.bo', 'mil.bo', 'tv.bo',
      'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'mil.br', 'art.br', 'blog.br', 'eco.br',
      'emp.br', 'esp.br', 'etc.br', 'far.br', 'flog.br', 'ind.br', 'inf.br', 'jor.br', 'jus.br',
      'leg.br', 'med.br', 'nom.br', 'not.br', 'ntr.br', 'odo.br', 'ppg.br', 'pro.br', 'psc.br',
      'rec.br', 'srv.br', 'tmp.br', 'tur.br', 'tv.br', 'vet.br', 'wiki.br', 'zlg.br',
      'com.bs', 'net.bs', 'org.bs', 'edu.bs', 'gov.bs',
      'com.bt', 'edu.bt', 'gov.bt', 'net.bt', 'org.bt',
      'co.bw', 'org.bw',
      'com.by', 'gov.by', 'mil.by', 'of.by',
      'com.bz', 'net.bz', 'org.bz', 'edu.bz', 'gov.bz',
      'ab.ca', 'bc.ca', 'mb.ca', 'nb.ca', 'nf.ca', 'nl.ca', 'ns.ca', 'nt.ca', 'nu.ca', 'on.ca',
      'pe.ca', 'qc.ca', 'sk.ca', 'yk.ca', 'gc.ca', 'co.ca',
      'com.cd', 'net.cd', 'org.cd',
      'com.ch', 'net.ch', 'org.ch',
      'ac.ci', 'com.ci', 'ed.ci', 'edu.ci', 'go.ci', 'int.ci', 'net.ci', 'or.ci', 'org.ci',
      'co.ck', 'org.ck', 'edu.ck', 'gov.ck', 'net.ck',
      'co.cl', 'gob.cl', 'gov.cl', 'mil.cl',
      'com.cm', 'gov.cm', 'net.cm',
      'ac.cn', 'com.cn', 'edu.cn', 'gov.cn', 'net.cn', 'org.cn', 'mil.cn', 'ah.cn', 'bj.cn',
      'cq.cn', 'fj.cn', 'gd.cn', 'gs.cn', 'gz.cn', 'gx.cn', 'ha.cn', 'hb.cn', 'he.cn', 'hi.cn',
      'hl.cn', 'hn.cn', 'jl.cn', 'js.cn', 'jx.cn', 'ln.cn', 'nm.cn', 'nx.cn', 'qh.cn', 'sc.cn',
      'sd.cn', 'sh.cn', 'sn.cn', 'sx.cn', 'tj.cn', 'xj.cn', 'xz.cn', 'yn.cn', 'zj.cn', 'hk.cn',
      'mo.cn', 'tw.cn',
      'com.co', 'edu.co', 'gov.co', 'mil.co', 'net.co', 'nom.co', 'org.co',
      'ac.cr', 'co.cr', 'ed.cr', 'fi.cr', 'go.cr', 'or.cr', 'sa.cr',
      'com.cu', 'edu.cu', 'org.cu', 'net.cu', 'gov.cu', 'inf.cu',
      'com.cv', 'edu.cv', 'org.cv',
      'ac.cy', 'com.cy', 'gov.cy', 'net.cy', 'org.cy', 'ltd.cy', 'biz.cy', 'ekloges.cy',
      'com.de', 'co.de',
      'com.dm', 'net.dm', 'org.dm', 'edu.dm', 'gov.dm',
      'com.do', 'edu.do', 'gob.do', 'gov.do', 'mil.do', 'net.do', 'org.do', 'sld.do', 'web.do',
      'art.do',
      'com.dz', 'org.dz', 'net.dz', 'gov.dz', 'edu.dz', 'asso.dz', 'pol.dz', 'art.dz',
      'com.ec', 'info.ec', 'net.ec', 'fin.ec', 'k12.ec', 'med.ec', 'pro.ec', 'org.ec', 'edu.ec',
      'gov.ec', 'gob.ec', 'mil.ec',
      'com.ee', 'org.ee', 'fie.ee', 'pri.ee', 'edu.ee', 'gov.ee', 'riik.ee', 'lib.ee', 'med.ee',
      'com.eg', 'edu.eg', 'eun.eg', 'gov.eg', 'mil.eg', 'name.eg', 'net.eg', 'org.eg', 'sci.eg',
      'com.es', 'nom.es', 'org.es', 'gob.es', 'edu.es',
      'com.et', 'gov.et', 'org.et', 'edu.et', 'net.et', 'biz.et', 'name.et', 'info.et',
      'aland.fi',
      'ac.fj', 'biz.fj', 'com.fj', 'gov.fj', 'info.fj', 'mil.fj', 'name.fj', 'net.fj', 'org.fj',
      'pro.fj',
      'co.fk', 'org.fk', 'gov.fk', 'ac.fk', 'nom.fk', 'net.fk',
      'tm.fr', 'asso.fr', 'nom.fr', 'prd.fr', 'presse.fr', 'com.fr', 'gouv.fr',
      'com.ge', 'edu.ge', 'gov.ge', 'org.ge', 'mil.ge', 'net.ge', 'pvt.ge',
      'co.gg', 'net.gg', 'org.gg',
      'com.gh', 'edu.gh', 'gov.gh', 'org.gh', 'mil.gh',
      'com.gi', 'ltd.gi', 'gov.gi', 'mod.gi', 'edu.gi', 'org.gi',
      'co.gl', 'com.gl', 'edu.gl', 'net.gl', 'org.gl',
      'ac.gn', 'com.gn', 'edu.gn', 'gov.gn', 'org.gn', 'net.gn',
      'com.gp', 'net.gp', 'mobi.gp', 'edu.gp', 'org.gp', 'asso.gp',
      'com.gr', 'edu.gr', 'net.gr', 'org.gr', 'gov.gr',
      'com.gt', 'edu.gt', 'gob.gt', 'ind.gt', 'mil.gt', 'net.gt', 'org.gt',
      'com.gu', 'edu.gu', 'gov.gu', 'net.gu', 'org.gu', 'mil.gu',
      'co.gy', 'com.gy', 'edu.gy', 'gov.gy', 'net.gy', 'org.gy',
      'com.hk', 'edu.hk', 'gov.hk', 'idv.hk', 'net.hk', 'org.hk',
      'com.hn', 'edu.hn', 'org.hn', 'net.hn', 'mil.hn', 'gob.hn',
      'iz.hr', 'from.hr', 'name.hr', 'com.hr',
      'com.ht', 'shop.ht', 'firm.ht', 'info.ht', 'adult.ht', 'net.ht', 'pro.ht', 'org.ht',
      'med.ht', 'art.ht', 'coop.ht', 'pol.ht', 'asso.ht', 'edu.ht', 'rel.ht', 'gouv.ht', 'perso.ht',
      'co.hu', 'info.hu', 'org.hu', 'priv.hu', 'sport.hu', 'tm.hu', '2000.hu', 'agrar.hu',
      'bolt.hu', 'casino.hu', 'city.hu', 'erotica.hu', 'erotika.hu', 'film.hu', 'forum.hu',
      'games.hu', 'hotel.hu', 'ingatlan.hu', 'jogasz.hu', 'konyvelo.hu', 'lakas.hu', 'media.hu',
      'news.hu', 'reklam.hu', 'sex.hu', 'shop.hu', 'suli.hu', 'szex.hu', 'tozsde.hu', 'utazas.hu',
      'video.hu',
      'ac.id', 'biz.id', 'co.id', 'desa.id', 'go.id', 'mil.id', 'my.id', 'net.id', 'or.id',
      'ponpes.id', 'sch.id', 'web.id',
      'gov.ie',
      'ac.il', 'co.il', 'gov.il', 'idf.il', 'k12.il', 'muni.il', 'net.il', 'org.il',
      'ac.im', 'co.im', 'com.im', 'net.im', 'org.im', 'tt.im', 'tv.im',
      'co.in', 'firm.in', 'net.in', 'org.in', 'gen.in', 'ind.in', 'nic.in', 'ac.in', 'edu.in',
      'res.in', 'gov.in', 'mil.in',
      'com.io', 'co.io',
      'com.iq', 'edu.iq', 'gov.iq', 'mil.iq', 'net.iq', 'org.iq',
      'ac.ir', 'co.ir', 'gov.ir', 'id.ir', 'net.ir', 'org.ir', 'sch.ir',
      'gov.it', 'edu.it',
      'co.je', 'net.je', 'org.je',
      'com.jm', 'net.jm', 'org.jm', 'edu.jm', 'gov.jm', 'mil.jm',
      'com.jo', 'org.jo', 'net.jo', 'edu.jo', 'sch.jo', 'gov.jo', 'mil.jo', 'name.jo',
      'ac.jp', 'ad.jp', 'co.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp', 'ne.jp', 'or.jp',
      'ac.ke', 'co.ke', 'go.ke', 'info.ke', 'me.ke', 'mobi.ke', 'ne.ke', 'or.ke', 'sc.ke',
      'com.kg', 'edu.kg', 'gov.kg', 'mil.kg', 'net.kg', 'org.kg',
      'com.kh', 'edu.kh', 'gov.kh', 'mil.kh', 'net.kh', 'org.kh', 'per.kh',
      'com.ki', 'biz.ki', 'net.ki', 'info.ki', 'org.ki', 'gov.ki', 'edu.ki', 'mob.ki', 'tel.ki',
      'com.km', 'org.km', 'gov.km', 'edu.km', 'ass.km', 'nom.km', 'prd.km', 'tm.km',
      'net.kn', 'org.kn', 'edu.kn', 'gov.kn',
      'com.kp', 'edu.kp', 'gov.kp', 'org.kp', 'rep.kp', 'tra.kp',
      'ac.kr', 'co.kr', 'es.kr', 'go.kr', 'hs.kr', 'kg.kr', 'mil.kr', 'ms.kr', 'ne.kr', 'or.kr',
      'pe.kr', 're.kr', 'sc.kr',
      'com.kw', 'edu.kw', 'emb.kw', 'gov.kw', 'ind.kw', 'net.kw', 'org.kw',
      'com.ky', 'org.ky', 'net.ky', 'edu.ky', 'gov.ky',
      'com.kz', 'edu.kz', 'gov.kz', 'mil.kz', 'net.kz', 'org.kz',
      'com.la', 'net.la', 'org.la', 'edu.la', 'gov.la', 'int.la', 'per.la',
      'com.lb', 'edu.lb', 'gov.lb', 'net.lb', 'org.lb',
      'com.lc', 'net.lc', 'co.lc', 'org.lc', 'edu.lc', 'gov.lc',
      'com.lk', 'org.lk', 'edu.lk', 'ngo.lk', 'soc.lk', 'web.lk', 'ltd.lk', 'assn.lk', 'grp.lk',
      'hotel.lk', 'gov.lk', 'sch.lk', 'net.lk', 'int.lk',
      'com.lr', 'edu.lr', 'gov.lr', 'org.lr', 'net.lr',
      'co.ls', 'org.ls',
      'gov.lt',
      'mil.lv', 'id.lv', 'net.lv', 'org.lv', 'edu.lv', 'gov.lv', 'com.lv', 'asn.lv', 'conf.lv',
      'com.ly', 'net.ly', 'gov.ly', 'plc.ly', 'edu.ly', 'sch.ly', 'med.ly', 'org.ly', 'id.ly',
      'co.ma', 'net.ma', 'gov.ma', 'org.ma', 'ac.ma', 'press.ma',
      'tm.mc', 'asso.mc',
      'com.mg', 'org.mg', 'nom.mg', 'gov.mg', 'prd.mg', 'tm.mg', 'edu.mg', 'mil.mg',
      'com.mk', 'org.mk', 'net.mk', 'edu.mk', 'gov.mk', 'inf.mk', 'name.mk',
      'com.ml', 'edu.ml', 'gouv.ml', 'gov.ml', 'net.ml', 'org.ml', 'presse.ml',
      'gov.mn', 'edu.mn', 'org.mn',
      'com.mo', 'net.mo', 'org.mo', 'edu.mo', 'gov.mo',
      'com.mt', 'edu.mt', 'net.mt', 'org.mt',
      'aero.mv', 'biz.mv', 'com.mv', 'coop.mv', 'edu.mv', 'gov.mv', 'info.mv', 'int.mv', 'mil.mv',
      'museum.mv', 'name.mv', 'net.mv', 'org.mv', 'pro.mv',
      'ac.mw', 'biz.mw', 'co.mw', 'com.mw', 'coop.mw', 'edu.mw', 'gov.mw', 'int.mw', 'museum.mw',
      'net.mw', 'org.mw',
      'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
      'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my', 'mil.my', 'name.my',
      'ac.mz', 'adv.mz', 'co.mz', 'edu.mz', 'gov.mz', 'mil.mz', 'net.mz', 'org.mz',
      'com.na', 'co.na', 'org.na', 'edu.na', 'net.na',
      'com.nf', 'net.nf', 'per.nf', 'rec.nf', 'web.nf', 'arts.nf', 'firm.nf', 'info.nf',
      'other.nf', 'store.nf',
      'com.ng', 'edu.ng', 'gov.ng', 'i.ng', 'mil.ng', 'mobi.ng', 'name.ng', 'net.ng', 'org.ng',
      'sch.ng',
      'ac.ni', 'biz.ni', 'co.ni', 'com.ni', 'edu.ni', 'gob.ni', 'in.ni', 'info.ni', 'int.ni',
      'mil.ni', 'net.ni', 'nom.ni', 'org.ni', 'web.ni',
      'co.nl', 'bv.nl',
      'fhs.no', 'vgs.no', 'fylkesbibl.no', 'folkebibl.no', 'museum.no', 'idrett.no', 'priv.no',
      'mil.no', 'stat.no', 'dep.no', 'kommune.no', 'herad.no',
      'com.np', 'edu.np', 'gov.np', 'org.np', 'mil.np', 'net.np',
      'biz.nr', 'info.nr', 'gov.nr', 'edu.nr', 'org.nr', 'net.nr', 'com.nr',
      'ac.nz', 'co.nz', 'cri.nz', 'geek.nz', 'gen.nz', 'govt.nz', 'health.nz', 'iwi.nz',
      'kiwi.nz', 'maori.nz', 'mil.nz', 'net.nz', 'org.nz', 'parliament.nz', 'school.nz',
      'co.om', 'com.om', 'edu.om', 'gov.om', 'med.om', 'museum.om', 'net.om', 'org.om', 'pro.om',
      'ac.pa', 'gob.pa', 'com.pa', 'org.pa', 'sld.pa', 'edu.pa', 'net.pa', 'ing.pa', 'abo.pa',
      'med.pa', 'nom.pa',
      'edu.pe', 'gob.pe', 'nom.pe', 'mil.pe', 'org.pe', 'com.pe', 'net.pe',
      'com.pf', 'org.pf', 'edu.pf',
      'com.pg', 'net.pg', 'ac.pg', 'gov.pg', 'mil.pg', 'org.pg',
      'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph', 'ngo.ph', 'mil.ph', 'i.ph',
      'com.pk', 'net.pk', 'edu.pk', 'org.pk', 'fam.pk', 'biz.pk', 'web.pk', 'gov.pk', 'gob.pk',
      'gok.pk', 'gon.pk', 'gop.pk', 'gos.pk', 'info.pk',
      'com.pl', 'net.pl', 'org.pl', 'aid.pl', 'agro.pl', 'atm.pl', 'auto.pl', 'biz.pl', 'edu.pl',
      'gmina.pl', 'gsm.pl', 'info.pl', 'mail.pl', 'miasta.pl', 'media.pl', 'mil.pl', 'nieruchomosci.pl',
      'nom.pl', 'pc.pl', 'powiat.pl', 'priv.pl', 'realestate.pl', 'rel.pl', 'sex.pl', 'shop.pl',
      'sklep.pl', 'sos.pl', 'szkola.pl', 'targi.pl', 'tm.pl', 'tourism.pl', 'travel.pl', 'turystyka.pl',
      'gov.pl', 'waw.pl', 'wroc.pl', 'krakow.pl', 'poznan.pl', 'lodz.pl', 'gda.pl', 'gdansk.pl',
      'biz.pr', 'com.pr', 'edu.pr', 'gov.pr', 'info.pr', 'isla.pr', 'name.pr', 'net.pr', 'org.pr',
      'pro.pr', 'est.pr', 'prof.pr', 'ac.pr',
      'edu.ps', 'gov.ps', 'sec.ps', 'plo.ps', 'com.ps', 'org.ps', 'net.ps',
      'net.pt', 'gov.pt', 'org.pt', 'edu.pt', 'int.pt', 'publ.pt', 'com.pt', 'nome.pt',
      'co.pw', 'ne.pw', 'or.pw', 'ed.pw', 'go.pw', 'belau.pw',
      'com.py', 'coop.py', 'edu.py', 'gov.py', 'mil.py', 'net.py', 'org.py',
      'com.qa', 'edu.qa', 'gov.qa', 'mil.qa', 'name.qa', 'net.qa', 'org.qa', 'sch.qa',
      'asso.re', 'com.re', 'nom.re',
      'arts.ro', 'com.ro', 'firm.ro', 'info.ro', 'nom.ro', 'nt.ro', 'org.ro', 'rec.ro', 'store.ro',
      'tm.ro', 'www.ro',
      'ac.rs', 'co.rs', 'edu.rs', 'gov.rs', 'in.rs', 'org.rs',
      'ac.ru', 'edu.ru', 'gov.ru', 'int.ru', 'mil.ru', 'net.ru', 'org.ru', 'pp.ru', 'com.ru',
      'ac.rw', 'co.rw', 'coop.rw', 'gov.rw', 'mil.rw', 'net.rw', 'org.rw',
      'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'med.sa', 'pub.sa', 'edu.sa', 'sch.sa',
      'com.sb', 'edu.sb', 'gov.sb', 'net.sb', 'org.sb',
      'com.sc', 'gov.sc', 'net.sc', 'org.sc', 'edu.sc',
      'com.sd', 'net.sd', 'org.sd', 'edu.sd', 'med.sd', 'gov.sd', 'info.sd',
      'a.se', 'ac.se', 'b.se', 'bd.se', 'brand.se', 'c.se', 'd.se', 'e.se', 'f.se', 'fh.se',
      'fhsk.se', 'fhv.se', 'g.se', 'h.se', 'i.se', 'k.se', 'komforb.se', 'kommunalforbund.se',
      'komvux.se', 'l.se', 'lanbib.se', 'm.se', 'n.se', 'naturbruksgymn.se', 'o.se', 'org.se',
      'p.se', 'parti.se', 'pp.se', 'press.se', 'r.se', 's.se', 't.se', 'tm.se', 'u.se', 'w.se',
      'x.se', 'y.se', 'z.se',
      'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg', 'per.sg',
      'com.sh', 'net.sh', 'gov.sh', 'org.sh', 'mil.sh',
      'com.sl', 'net.sl', 'edu.sl', 'gov.sl', 'org.sl',
      'gov.st', 'saotome.st', 'principe.st', 'consulado.st', 'embaixada.st', 'org.st', 'edu.st',
      'net.st', 'com.st', 'store.st', 'mil.st', 'co.st',
      'com.sv', 'edu.sv', 'gob.sv', 'org.sv', 'red.sv',
      'com.sy', 'edu.sy', 'gov.sy', 'mil.sy', 'net.sy', 'news.sy', 'org.sy',
      'ac.sz', 'co.sz', 'org.sz',
      'ac.th', 'co.th', 'go.th', 'in.th', 'mi.th', 'net.th', 'or.th',
      'ac.tj', 'biz.tj', 'co.tj', 'com.tj', 'edu.tj', 'go.tj', 'gov.tj', 'int.tj', 'mil.tj',
      'name.tj', 'net.tj', 'nic.tj', 'org.tj', 'test.tj', 'web.tj',
      'agrinet.tn', 'com.tn', 'defense.tn', 'edunet.tn', 'ens.tn', 'fin.tn', 'gov.tn', 'ind.tn',
      'info.tn', 'intl.tn', 'mincom.tn', 'nat.tn', 'net.tn', 'org.tn', 'perso.tn', 'rnrt.tn',
      'rns.tn', 'rnu.tn', 'tourism.tn', 'turen.tn',
      'av.tr', 'bbs.tr', 'bel.tr', 'biz.tr', 'com.tr', 'dr.tr', 'edu.tr', 'gen.tr', 'gov.tr',
      'info.tr', 'mil.tr', 'k12.tr', 'kep.tr', 'name.tr', 'net.tr', 'org.tr', 'pol.tr', 'tel.tr',
      'tsk.tr', 'tv.tr', 'web.tr',
      'co.tt', 'com.tt', 'org.tt', 'net.tt', 'biz.tt', 'info.tt', 'pro.tt', 'int.tt', 'coop.tt',
      'jobs.tt', 'mobi.tt', 'travel.tt', 'museum.tt', 'aero.tt', 'name.tt', 'gov.tt', 'edu.tt',
      'club.tw', 'com.tw', 'ebiz.tw', 'edu.tw', 'game.tw', 'gov.tw', 'idv.tw', 'mil.tw', 'net.tw',
      'org.tw',
      'ac.tz', 'co.tz', 'go.tz', 'hotel.tz', 'info.tz', 'me.tz', 'mil.tz', 'mobi.tz', 'ne.tz',
      'or.tz', 'sc.tz', 'tv.tz',
      'com.ua', 'edu.ua', 'gov.ua', 'in.ua', 'net.ua', 'org.ua', 'co.ua', 'pp.ua',
      'co.ug', 'or.ug', 'ac.ug', 'sc.ug', 'go.ug', 'ne.ug', 'com.ug', 'org.ug',
      'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'net.uk', 'nhs.uk', 'org.uk', 'plc.uk',
      'police.uk', 'sch.uk',
      'dni.us', 'fed.us', 'isa.us', 'kids.us', 'nsn.us', 'ak.us', 'al.us', 'ar.us', 'as.us',
      'az.us', 'ca.us', 'co.us', 'ct.us', 'dc.us', 'de.us', 'fl.us', 'ga.us', 'gu.us', 'hi.us',
      'ia.us', 'id.us', 'il.us', 'in.us', 'ks.us', 'ky.us', 'la.us', 'ma.us', 'md.us', 'me.us',
      'mi.us', 'mn.us', 'mo.us', 'ms.us', 'mt.us', 'nc.us', 'nd.us', 'ne.us', 'nh.us', 'nj.us',
      'nm.us', 'nv.us', 'ny.us', 'oh.us', 'ok.us', 'or.us', 'pa.us', 'pr.us', 'ri.us', 'sc.us',
      'sd.us', 'tn.us', 'tx.us', 'ut.us', 'vi.us', 'vt.us', 'va.us', 'wa.us', 'wi.us', 'wv.us',
      'wy.us', 'k12.us',
      'com.uy', 'edu.uy', 'gub.uy', 'mil.uy', 'net.uy', 'org.uy',
      'co.uz', 'com.uz', 'net.uz', 'org.uz',
      'com.vc', 'net.vc', 'org.vc', 'gov.vc', 'mil.vc', 'edu.vc',
      'arts.ve', 'co.ve', 'com.ve', 'e12.ve', 'edu.ve', 'firm.ve', 'gob.ve', 'gov.ve', 'info.ve',
      'int.ve', 'mil.ve', 'net.ve', 'org.ve', 'rec.ve', 'store.ve', 'tec.ve', 'web.ve',
      'co.vi', 'com.vi', 'k12.vi', 'net.vi', 'org.vi',
      'ac.vn', 'biz.vn', 'com.vn', 'edu.vn', 'gov.vn', 'health.vn', 'info.vn', 'int.vn', 'name.vn',
      'net.vn', 'org.vn', 'pro.vn',
      'com.vu', 'edu.vu', 'net.vu', 'org.vu',
      'com.ws', 'net.ws', 'org.ws', 'gov.ws', 'edu.ws',
      'ac.za', 'co.za', 'edu.za', 'gov.za', 'law.za', 'mil.za', 'net.za', 'nom.za', 'org.za',
      'school.za', 'web.za',
      'ac.zm', 'biz.zm', 'co.zm', 'com.zm', 'edu.zm', 'gov.zm', 'info.zm', 'mil.zm', 'net.zm',
      'org.zm', 'sch.zm',
      'ac.zw', 'co.zw', 'gov.zw', 'mil.zw', 'org.zw',
      // widely used gTLD second levels
      'blogspot.com', 'blogspot.co.uk', 'blogspot.de', 'blogspot.fr', 'blogspot.in',
      'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev',
      'herokuapp.com', 'appspot.com', 'cloudfront.net', 's3.amazonaws.com', 'azurewebsites.net',
      'firebaseapp.com', 'web.app', 'glitch.me', 'repl.co', 'surge.sh', 'now.sh',
      'readthedocs.io', 'sourceforge.io', 'wordpress.com', 'medium.com', 'substack.com',
      'tumblr.com', 'weebly.com', 'wixsite.com', 'squarespace.com', 'myshopify.com',
      'co.com', 'eu.com', 'uk.com', 'us.com', 'za.com', 'br.com', 'cn.com', 'de.com',
      'jpn.com', 'no.com', 'qc.com', 'ru.com', 'sa.com', 'se.com', 'uy.com', 'gb.net',
      'hu.net', 'jp.net', 'se.net', 'uk.net', 'in.net', 'web.tr'
    ]);

    const domainCache = new util.LruCache({max: 500});

    /**
     * Registrable domain (eTLD+1), the same value `psl.get()` returns for the
     * suffixes in the table. Returns null for an IP literal, `localhost`, or a
     * bare public suffix, which is exactly what `psl` does.
     */
    function getRegistrableDomain(hostname) {
      if (typeof hostname !== 'string' || !hostname) return null;

      const cached = domainCache.get(hostname);
      if (cached !== undefined) return cached;

      const compute = () => {
        const host = hostname.toLowerCase().replace(/\.$/, '');
        if (!host) return null;

        // IPv6 literal or IPv4 dotted quad — no registrable domain.
        if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;

        const labels = host.split('.');
        if (labels.length < 2) return null;

        // The host is itself a public suffix (`co.uk`, `github.io`).
        if (MULTI_LABEL_SUFFIXES.has(host)) return null;

        // Longest matching multi-label suffix first (three labels, then two).
        for (let take = Math.min(3, labels.length - 1); take >= 2; take -= 1) {
          const suffix = labels.slice(-take).join('.');
          if (MULTI_LABEL_SUFFIXES.has(suffix)) {
            if (labels.length === take) return null; // bare public suffix
            return labels.slice(-(take + 1)).join('.');
          }
        }

        return labels.slice(-2).join('.');
      };

      const value = compute();
      domainCache.set(hostname, value);
      return value;
    }

    /* ----------------------------------------------------------- processResult */

    function processResult(sourceUrl, resultUrl) {
      const source = new URL(sourceUrl);
      const result = new URL(resultUrl);

      const sourceDomain = getRegistrableDomain(source.hostname);
      const resultDomain = getRegistrableDomain(result.hostname);

      const details = {
        sourceUrl,
        resultUrl,
        protocolMatch: source.protocol === result.protocol,
        hostMatch: source.hostname === result.hostname,
        hostWithoutCommonSubdomainsMatch: false,
        // Registrable domain matching: unresolvable hosts must not match on null.
        domainMatch: !!sourceDomain && sourceDomain === resultDomain,
        pathMatch: source.pathname === result.pathname,
        sourceStartsWithResultPath: source.pathname.startsWith(result.pathname),
        resultStartsWithSourcePath: result.pathname.startsWith(source.pathname),
        sourcePathLength: util.getCharCount(source.pathname) - 1,
        resultPathLength: util.getCharCount(result.pathname) - 1,
        searchParamsMatch: source.search === result.search,
        sourceStartsWithResultSearchParams: source.search.startsWith(result.search),
        resultStartsWithSourceSearchParams: result.search.startsWith(source.search),
        sourceSearchParamsLength: util.getCharCount(source.search),
        resultSearchParamsLength: util.getCharCount(result.search)
      };

      if (source.hostname.replace(/^www\./i, '') === result.hostname.replace(/^www\./i, '')) {
        details.hostWithoutCommonSubdomainsMatch = true;
      }

      return details;
    }

    /* ---------------------------------------------------------- getResultRank */

    function getResultRank(item) {
      if (item.protocolMatch && item.hostMatch && item.pathMatch && item.searchParamsMatch) return 1;
      if (item.hostMatch && item.pathMatch && item.searchParamsMatch) return 2;
      if (item.hostWithoutCommonSubdomainsMatch && item.pathMatch && item.searchParamsMatch) return 3;

      if (
        item.hostWithoutCommonSubdomainsMatch &&
        item.pathMatch &&
        ((item.resultSearchParamsLength && item.sourceStartsWithResultSearchParams) ||
          (item.sourceSearchParamsLength && item.resultStartsWithSourceSearchParams))
      ) {
        return 4;
      }

      if (item.hostWithoutCommonSubdomainsMatch && item.pathMatch) return 5;

      if (
        item.hostWithoutCommonSubdomainsMatch &&
        ((item.resultPathLength && item.sourceStartsWithResultPath) ||
          (item.sourcePathLength && item.resultStartsWithSourcePath))
      ) {
        return 6;
      }

      if (item.domainMatch && item.pathMatch && item.searchParamsMatch) return 7;

      if (
        item.domainMatch &&
        item.pathMatch &&
        ((item.resultSearchParamsLength && item.sourceStartsWithResultSearchParams) ||
          (item.sourceSearchParamsLength && item.resultStartsWithSourceSearchParams))
      ) {
        return 8;
      }

      if (item.domainMatch && item.pathMatch) return 9;

      if (
        item.domainMatch &&
        ((item.resultPathLength && item.sourceStartsWithResultPath) ||
          (item.sourcePathLength && item.resultStartsWithSourcePath))
      ) {
        return 10;
      }

      if (item.hostMatch) return 11;
      if (item.domainMatch) return 12;

      return undefined;
    }

    /* ------------------------------------------------------- getRankedResults */

    function getRankedResults({sourceUrl, results} = {}) {
      const items = [];

      for (const result of results || []) {
        // Malformed candidate URLs are caught individually rather than aborting
        // the entire ranking pass.
        let resultDetails;
        try {
          resultDetails = processResult(sourceUrl, result.url);
        } catch {
          continue;
        }
        const rank = getResultRank(resultDetails);
        if (rank) items.push({result, resultDetails, rank});
      }

      items.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        const aLen = a.resultDetails.resultUrl.length;
        const bLen = b.resultDetails.resultUrl.length;
        if (aLen !== bLen) return aLen - bLen;
        return 0;
      });

      return items.map(item => item.result);
    }

    return {getRegistrableDomain, processResult, getResultRank, getRankedResults};
  })();

  /* =======================================================================
   * SECTION 08 — Engine registry
   * -----------------------------------------------------------------------
   * One place that answers "what engines exist, in what order, which are
   * enabled, what does each look like, and what URL does each produce". Both
   * the built-in table and the user's custom engines are surfaced through the
   * same shape, so no consumer needs to know the difference.
   *
   * Unified single source of truth across all interface views and menus,
   * ensuring consistent engine configuration and order.
   * ==================================================================== */

  const registry = (() => {
    /**
     * @typedef {object} Engine
     * @property {string}  id
     * @property {string}  name         display name
     * @property {string}  menuTitle    context-menu / list label
     * @property {string}  optionTitle  settings label
     * @property {'direct'|'automate'|'api'|'custom'} mode
     * @property {boolean} custom
     * @property {string}  accent
     * @property {string|null} probe    availability-probe adapter id
     * @property {boolean} canCapture   supports on-demand snapshotting
     * @property {boolean} hasSnapshots supports the snapshot picker
     */

    function builtinEngine(id) {
      const def = data.builtinEngines[id];
      if (!def) return null;
      return {
        id,
        name: getText(`engineName_${id}`),
        menuTitle: getText(`menuItemTitle_${id}`),
        optionTitle: getText(`optionTitle_${id}`),
        mode: def.mode,
        custom: false,
        accent: def.accent,
        probe: def.probe || null,
        canCapture: !!def.capture,
        hasSnapshots: !!def.snapshots,
        def
      };
    }

    function customEngine(entry) {
      return {
        id: entry.id,
        name: entry.name,
        menuTitle: entry.name,
        optionTitle: entry.name,
        mode: 'custom',
        custom: true,
        accent: entry.accent || '#5a6270',
        probe: null,
        canCapture: false,
        hasSnapshots: false,
        def: {target: entry.template, mode: 'custom'},
        entry
      };
    }

    /** Every engine the user could enable, in the user's configured order. */
    function allEngines(settings) {
      const customById = new Map((settings.customEngines || []).map(e => [e.id, e]));
      const out = [];
      const seen = new Set();

      for (const id of settings.engines || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (customById.has(id)) {
          out.push(customEngine(customById.get(id)));
        } else {
          const engine = builtinEngine(id);
          if (engine) out.push(engine);
        }
      }

      // Defensive: an engine that exists but is absent from the order list is
      // still shown, at the end, rather than becoming unreachable.
      for (const id of data.defaultEngineOrder) {
        if (seen.has(id)) continue;
        const engine = builtinEngine(id);
        if (engine) {
          out.push(engine);
          seen.add(id);
        }
      }
      for (const [id, entry] of customById) {
        if (seen.has(id)) continue;
        out.push(customEngine(entry));
        seen.add(id);
      }

      return out;
    }

    /** `enabledEngines` — order preserved, disabled subtracted. */
    function enabledEngines(settings) {
      const disabled = new Set(settings.disabledEngines || []);
      return allEngines(settings).filter(engine => !disabled.has(engine.id));
    }

    function getEngine(settings, id) {
      if (!id) return null;
      return allEngines(settings).find(engine => engine.id === id) || null;
    }

    function isEnabled(settings, id) {
      return !(settings.disabledEngines || []).includes(id);
    }

    /**
     * `getSearches`: turns engine ids into per-search descriptors.
     */
    function getSearches(settings, engineIds) {
      const searches = [];
      for (const id of engineIds) {
        const engine = getEngine(settings, id);
        if (!engine) continue;
        searches.push({engine, id, mode: engine.mode});
      }
      return searches;
    }

    /* ---------------------------------------------------------- targeting */

    /**
     * Resolves the URL to open for `engine` and `lookupUrl`.
     * Returns `{ok, target, kind}` where `kind` is:
     *   'navigate' — open the URL directly
     *   'automate' — open the URL, then drive the resulting page
     *   'api'      — the caller must resolve it through `probes` first
     */
    function resolveTarget(settings, engine, lookupUrl) {
      if (!engine) return {ok: false, reason: 'unknown-engine'};

      if (engine.custom) {
        const built = urls.buildCustomTarget(engine.entry, lookupUrl);
        return built.ok ? {...built, kind: 'navigate'} : built;
      }

      if (engine.mode === 'api') {
        return {ok: true, kind: 'api', target: null, lookupUrl};
      }

      const built = urls.buildEngineTarget(engine.id, engine.def, lookupUrl, settings);
      if (!built.ok) return built;
      return {...built, kind: engine.mode === 'automate' ? 'automate' : 'navigate'};
    }

    /** The on-demand capture URL for engines that support it. */
    function resolveCaptureTarget(settings, engine, lookupUrl) {
      if (!engine || engine.custom || !engine.def.capture) {
        return {ok: false, reason: 'unsupported'};
      }
      if (!urls.validateUrl(lookupUrl)) return {ok: false, reason: 'invalid-url'};

      let template = engine.def.capture;
      let host = '';
      if (engine.def.hostOption) {
        const table =
          engine.def.hostOption === 'archiveOrgHost' ? data.archiveOrgHosts : data.archiveIsHosts;
        const key = settings[engine.def.hostOption];
        host = table[key] || Object.values(table)[0];
        if (engine.def.hostOption === 'archiveIsHost' && String(key).startsWith('onion_')) {
          template = template.replace(/^https:/i, 'http:');
        }
      }

      const target = util.substitute(template, {
        host,
        url: encodeURIComponent(lookupUrl),
        rawUrl: lookupUrl,
        date: util.isoDate()
      });

      return urls.validateUrl(target)
        ? {ok: true, target}
        : {ok: false, reason: 'invalid-target', target};
    }

    /* --------------------------------------------------------------- icons */

    const iconCache = new Map();

    /**
     * Inline monogram badge: lightweight vector rendering that keeps
     * `showEngineIcons` crisp, theme-independent, and free of network requests.
     */
    function engineIcon(engine, {size = 20} = {}) {
      const baseId = data.engineIconAlias[engine.id] || engine.id;
      const glyph = engine.custom
        ? (engine.name.trim()[0] || '?').toUpperCase()
        : data.engineMonogram[baseId] || (engine.name.trim()[0] || '?').toUpperCase();
      const key = `${baseId}|${glyph}|${engine.accent}|${size}`;

      if (!iconCache.has(key)) {
        iconCache.set(key, {glyph, accent: engine.accent, size});
      }
      const spec = iconCache.get(key);

      return util.svg({
        viewBox: '0 0 24 24',
        size: spec.size,
        className: 'wa-engine-icon',
        shapes: [
          {tag: 'rect', x: 1, y: 1, width: 22, height: 22, rx: 6, fill: spec.accent},
          {
            tag: 'text',
            x: 12,
            y: 12,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            'font-size': 13,
            'font-weight': 700,
            'font-family': 'system-ui, sans-serif',
            fill: '#ffffff',
            text: spec.glyph
          }
        ]
      });
    }

    function allEnginesIcon({size = 20} = {}) {
      return util.svg({
        viewBox: '0 0 24 24',
        size,
        className: 'wa-engine-icon',
        shapes: [
          {tag: 'rect', x: 1, y: 1, width: 22, height: 22, rx: 6, fill: '#4a4f5a'},
          {tag: 'circle', cx: 8, cy: 8, r: 2.4, fill: '#ffffff'},
          {tag: 'circle', cx: 16, cy: 8, r: 2.4, fill: '#ffffff'},
          {tag: 'circle', cx: 8, cy: 16, r: 2.4, fill: '#ffffff'},
          {tag: 'circle', cx: 16, cy: 16, r: 2.4, fill: '#ffffff'}
        ]
      });
    }

    return {
      allEngines,
      enabledEngines,
      getEngine,
      isEnabled,
      getSearches,
      resolveTarget,
      resolveCaptureTarget,
      engineIcon,
      allEnginesIcon
    };
  })();

  /* =======================================================================
   * SECTION 09 — Archive availability probing
   * -----------------------------------------------------------------------
   * Availability probing: before clicking an engine, checks whether that engine
   * actually holds a snapshot, and when it was taken.
   *
   * Design constraints that shaped this module:
   *
   *  - Privacy first. A probe transmits the URL being looked up to a third
   *    party, so probing is never automatic on page load. It runs when the
   *    user opens the launcher (default), only on demand, or never. Requests
   *    are anonymous: no cookies, no referrer.
   *  - Honest states. An engine with no availability API reports
   *    `unsupported`, never "no snapshot". Absence of evidence is not
   *    evidence of absence, and mislabelling it would make the feature
   *    actively harmful.
   *  - Bounded cost. Results are cached with a user-configurable TTL, probes
   *    run through a bounded-concurrency queue, every request has a hard
   *    timeout, and an in-flight probe is cancelled when the launcher closes.
   * ==================================================================== */

  const probes = (() => {
    /** @typedef {'idle'|'checking'|'available'|'none'|'unsupported'|'error'} ProbeState */

    const cache = new util.LruCache({max: 300, ttl: 60 * 60 * 1000});
    const inflight = util.singleFlight();

    let queue = new util.TaskQueue({concurrency: 3});
    let currentConcurrency = 3;

    function configure(settings) {
      const ttl = Math.max(1, settings.probeTtlMinutes) * 60 * 1000;
      if (cache.ttl !== ttl) cache.ttl = ttl;

      const concurrency = util.clamp(settings.probeConcurrency, 1, 8);
      if (concurrency !== currentConcurrency) {
        currentConcurrency = concurrency;
        queue = new util.TaskQueue({concurrency});
      }
    }

    const cacheKey = (adapter, url) => `${adapter}|${url}`;

    /* --------------------------------------------------------- result shape */

    const unsupported = () => ({state: 'unsupported'});
    const none = () => ({state: 'none'});
    const error = reason => ({state: 'error', reason});
    const available = ({url = '', time = NaN, count = NaN, note = ''} = {}) => ({
      state: 'available',
      url,
      time,
      count,
      note
    });

    /* ------------------------------------------------------------- adapters */

    /**
     * Each adapter: `(lookupUrl, {signal, settings}) => Promise<Result>`.
     * An adapter must never throw; it converts every failure into `error`.
     */
    const adapters = {
      /**
       * Wayback Availability JSON API. Documented and stable:
       *   https://archive.org/help/wayback_api.php
       */
      async archiveOrg(lookupUrl, {signal}) {
        const endpoint = `https://archive.org/wayback/available?url=${encodeURIComponent(lookupUrl)}`;
        try {
          const {body} = await env.request(endpoint, {responseType: 'json', timeout: 10000, signal});
          const closest = body?.archived_snapshots?.closest;
          if (!closest || closest.available === false) return none();

          const time = util.parseWaybackTimestamp(closest.timestamp);
          // The API answers over http; upgrade so we never downgrade the user.
          const snapshotUrl = String(closest.url || '').replace(/^http:/i, 'https:');
          return available({
            url: urls.validateUrl(snapshotUrl) ? snapshotUrl : '',
            time,
            note: closest.status && closest.status !== '200' ? `HTTP ${closest.status}` : ''
          });
        } catch (err) {
          if (err?.name === 'AbortError') return {state: 'idle'};
          return error(describeError(err));
        }
      },

      /**
       * Archive.today exposes a Memento TimeMap. It is frequently behind a
       * challenge, so a non-2xx answer is reported as `unknown`, never as
       * "no snapshot".
       */
      async archiveIs(lookupUrl, {signal, settings}) {
        const host = data.archiveIsHosts[settings.archiveIsHost] || 'archive.is';
        if (host.endsWith('.onion')) return unsupported();

        const endpoint = `https://${host}/timemap/${lookupUrl}`;
        try {
          const {body} = await env.request(endpoint, {responseType: 'text', timeout: 10000, signal});
          const text = String(body || '');
          if (!text.trim()) return none();

          // Link-format TimeMap: `<url>; rel="memento"; datetime="RFC 1123"`.
          // Entries are comma-separated, but an RFC 1123 date *contains* a
          // comma ("Wed, 01 Jan 2020 …"), so splitting on a bare comma corrupts
          // every record. Split only on a comma that introduces the next
          // `<uri>` field.
          const entries = text.split(/,\s*(?=<)/);
          const mementos = [];
          for (const entry of entries) {
            const uriMatch = /^\s*<([^>]+)>/.exec(entry);
            if (!uriMatch) continue;
            if (!/rel\s*=\s*"[^"]*memento[^"]*"/i.test(entry)) continue;
            const dtMatch = /datetime\s*=\s*"([^"]+)"/i.exec(entry);
            mementos.push({url: uriMatch[1], time: dtMatch ? Date.parse(dtMatch[1]) : NaN});
          }
          if (!mementos.length) return none();

          let latestTime = NaN;
          let latestUrl = '';
          for (const memento of mementos) {
            if (Number.isFinite(memento.time) && (!Number.isFinite(latestTime) || memento.time > latestTime)) {
              latestTime = memento.time;
              latestUrl = memento.url;
            }
          }
          if (!latestUrl) latestUrl = mementos[mementos.length - 1].url;

          return available({
            url: urls.validateUrl(latestUrl) ? latestUrl : '',
            time: latestTime,
            count: mementos.length
          });
        } catch (err) {
          if (err?.name === 'AbortError') return {state: 'idle'};
          if (err?.name === 'HttpError' && err.status === 404) return none();
          // 403/429/503 from the challenge page tells us nothing about the URL.
          return {state: 'unknown', reason: describeError(err)};
        }
      },

      /** Perma.cc public archives API. */
      async permacc(lookupUrl, {signal}) {
        const endpoint =
          'https://api.perma.cc/v1/public/archives/?format=json&limit=1&url=' +
          encodeURIComponent(lookupUrl);
        try {
          const {body} = await env.request(endpoint, {responseType: 'json', timeout: 12000, signal});
          const result = body?.objects?.[0];
          if (!result?.guid) return none();
          const time = Date.parse(result.creation_timestamp || result.archive_timestamp || '');
          return available({
            url: `https://perma.cc/${encodeURIComponent(result.guid)}`,
            time: Number.isFinite(time) ? time : NaN,
            count: Number.isFinite(body?.meta?.total_count) ? body.meta.total_count : NaN
          });
        } catch (err) {
          if (err?.name === 'AbortError') return {state: 'idle'};
          return error(describeError(err));
        }
      },

      /**
       * Software Heritage archives *software origins*, not arbitrary pages, so
       * a miss here is genuinely informative: it means the repository is not
       * in the archive.
       */
      async softwareHeritage(lookupUrl, {signal}) {
        const base = 'https://archive.softwareheritage.org/api/1';
        const endpoint = `${base}/origin/${lookupUrl}/get/`;
        try {
          const {body} = await env.request(endpoint, {responseType: 'json', timeout: 12000, signal});
          if (!body?.url) return none();

          let time = NaN;
          try {
            const visit = await env.request(`${base}/origin/${lookupUrl}/visit/latest/`, {
              responseType: 'json',
              timeout: 10000,
              signal
            });
            const parsed = Date.parse(visit.body?.date || '');
            if (Number.isFinite(parsed)) time = parsed;
          } catch {
            /* the origin exists; the visit date is a nicety */
          }

          return available({
            url: `https://archive.softwareheritage.org/browse/origin/directory/?origin_url=${encodeURIComponent(
              lookupUrl
            )}`,
            time
          });
        } catch (err) {
          if (err?.name === 'AbortError') return {state: 'idle'};
          if (err?.name === 'HttpError' && err.status === 404) return none();
          return error(describeError(err));
        }
      }
    };

    function describeError(err) {
      if (!err) return 'unknown';
      if (err.name === 'TimeoutError') return 'timeout';
      if (err.name === 'HttpError') return `http-${err.status}`;
      if (err.name === 'NetworkError') return 'network';
      return err.name || 'unknown';
    }

    /* ------------------------------------------------------------- the API */

    /**
     * Probes one engine. Returns a cached result when fresh; otherwise queues
     * the request. Never rejects.
     */
    async function probeEngine(engine, lookupUrl, {settings, signal, force = false} = {}) {
      if (!engine?.probe) return unsupported();
      if (!env.capabilities.crossOriginRequests && !isSameOrigin(engine.probe)) {
        // Without GM_xmlhttpRequest a cross-origin probe cannot be made at all.
        return unsupported();
      }
      if (!urls.validateUrl(lookupUrl)) return error('invalid-url');

      const key = cacheKey(engine.probe, lookupUrl);
      if (!force) {
        const hit = cache.get(key);
        if (hit) return hit;
      } else {
        cache.delete(key);
      }

      const adapter = adapters[engine.probe];
      if (!adapter) return unsupported();

      return inflight(key, async () => {
        const result = await queue.add(() => adapter(lookupUrl, {signal, settings}));
        // An aborted probe is not a result; do not poison the cache with it.
        if (result.state !== 'idle') cache.set(key, result);
        return result;
      });
    }

    function isSameOrigin() {
      // Every probe endpoint is cross-origin by construction.
      return false;
    }

    /**
     * Probes a list of engines, invoking `onResult` as each settles so the UI
     * can fill in progressively rather than waiting for the slowest service.
     */
    function probeAll(engines, lookupUrl, {settings, signal, force = false, onResult} = {}) {
      configure(settings);

      const tasks = engines.map(async engine => {
        if (!engine.probe) {
          onResult?.(engine.id, unsupported());
          return {id: engine.id, result: unsupported()};
        }
        onResult?.(engine.id, {state: 'checking'});
        const result = await probeEngine(engine, lookupUrl, {settings, signal, force});
        onResult?.(engine.id, result);
        return {id: engine.id, result};
      });

      return Promise.all(tasks);
    }

    /** Cached result without triggering a request. */
    function peek(engine, lookupUrl) {
      if (!engine?.probe) return unsupported();
      return cache.get(cacheKey(engine.probe, lookupUrl));
    }

    /* -------------------------------------------------- Wayback CDX index */

    /**
     * Snapshot index for the date picker. Collapsed to one entry per day and
     * capped, because a heavily-crawled URL can have tens of thousands of
     * captures and the whole point is a browsable list.
     */
    async function fetchSnapshotIndex(lookupUrl, {settings, signal, limit = 400} = {}) {
      const host = data.archiveOrgHosts[settings.archiveOrgHost] || 'web.archive.org';
      if (host.endsWith('.onion')) {
        return {ok: false, reason: 'unsupported'};
      }

      const endpoint =
        `https://${host}/cdx/search/cdx?url=${encodeURIComponent(lookupUrl)}` +
        `&output=json&fl=timestamp,statuscode,digest&collapse=timestamp:8&filter=!statuscode:4..` +
        `&limit=-${limit}`;

      try {
        const {body} = await env.request(endpoint, {responseType: 'json', timeout: 20000, signal});
        if (!Array.isArray(body) || body.length < 2) return {ok: true, snapshots: [], truncated: false};

        const [header, ...rows] = body;
        const tsIndex = header.indexOf('timestamp');
        const statusIndex = header.indexOf('statuscode');

        const snapshots = [];
        for (const row of rows) {
          const stamp = row[tsIndex >= 0 ? tsIndex : 0];
          const time = util.parseWaybackTimestamp(stamp);
          if (!Number.isFinite(time)) continue;
          snapshots.push({
            timestamp: String(stamp),
            time,
            status: statusIndex >= 0 ? String(row[statusIndex] || '') : ''
          });
        }

        snapshots.sort((a, b) => b.time - a.time);
        return {ok: true, snapshots, truncated: snapshots.length >= limit};
      } catch (err) {
        if (err?.name === 'AbortError') return {ok: false, reason: 'aborted'};
        return {ok: false, reason: describeError(err)};
      }
    }

    /** `https://<host>/web/<timestamp>/<url>` — the dated snapshot form. */
    function snapshotUrl(settings, timestamp, lookupUrl) {
      const host = data.archiveOrgHosts[settings.archiveOrgHost] || 'web.archive.org';
      const scheme = host.endsWith('.onion') ? 'http' : 'https';
      return `${scheme}://${host}/web/${encodeURIComponent(String(timestamp))}/${lookupUrl}`;
    }

    /* --------------------------------------------------------- maintenance */

    function clear() {
      cache.clear();
    }

    function stats() {
      return {
        size: cache.size,
        ttlMinutes: Math.round(cache.ttl / 60000),
        concurrency: currentConcurrency,
        entries: cache.entries().map(([key, value, time]) => ({
          key,
          state: value.state,
          age: Date.now() - time
        }))
      };
    }

    return {
      configure,
      probeEngine,
      probeAll,
      peek,
      fetchSnapshotIndex,
      snapshotUrl,
      clear,
      stats,
      /* exported for the test suite */
      _adapters: adapters
    };
  })();

  /* =======================================================================
   * SECTION 10 — Cross-tab task handoff
   * -----------------------------------------------------------------------
   * Three engines (Yandex, Megalodon, Ghostarchive) are not addressable by
   * simple URL: navigating to a search page requires the *initiating* page to
   * hand a job to the *destination* page across tabs/origins:
   *
   *   - the job lives in the manager's shared value store (visible to every tab);
   *   - the destination is told which job is its own through a URL fragment
   *     (`#wa-task=<id>`), which is never sent to the server and is removed
   *     from the address bar as soon as it has been read;
   *   - the claim is then mirrored into the destination origin's
   *     `sessionStorage`, so it survives the in-origin navigations that the
   *     Yandex flow performs;
   *   - expiry is enforced on read and by an opportunistic sweep.
   *
   * Claiming is atomic-enough by construction: a job id is a v4 UUID handed
   * to exactly one tab, and the claim write is idempotent.
   * ==================================================================== */

  const tasks = (() => {
    const TASK_STORE_KEY = 'web-archives:tasks';
    const SESSION_KEY = 'web-archives:claim';
    const FRAGMENT_KEY = 'wa-task';
    const TASK_TTL = 10 * 60 * 1000; // expiryTime: 10.0 minutes
    const SWEEP_INTERVAL = 60 * 1000;
    const MAX_TASKS = 40;

    let sweepTimer = null;

    /* ----------------------------------------------------------- storage */

    async function readAll() {
      let raw = await env.storage.get(TASK_STORE_KEY, {});
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = {};
        }
      }
      if (!util.isPlainObject(raw)) return {};

      const now = Date.now();
      const out = {};
      for (const [id, task] of Object.entries(raw)) {
        if (!util.isPlainObject(task)) continue;
        if (!Number.isFinite(task.created) || now - task.created > TASK_TTL) continue;
        if (typeof task.engine !== 'string' || typeof task.docUrl !== 'string') continue;
        out[id] = task;
      }
      return out;
    }

    async function writeAll(map) {
      // Hard cap: keep the newest jobs so a pathological loop cannot grow the
      // store without bound.
      const entries = Object.entries(map).sort((a, b) => b[1].created - a[1].created);
      const trimmed = Object.fromEntries(entries.slice(0, MAX_TASKS));
      await env.storage.set(TASK_STORE_KEY, trimmed);
    }

    /* ------------------------------------------------------------ create */

    /**
     * Registers a job and returns `{id, url}` where `url` is the engine target
     * with the claim fragment appended.
     */
    async function create({engine, docUrl, target, settings}) {
      const id = util.uuid();
      const task = {
        id,
        engine,
        docUrl,
        created: Date.now(),
        claimed: 0,
        // Only the settings the automation actually needs travel with the job.
        options: {
          tabInBackgound: !!settings?.tabInBackgound,
          notificationMode: settings?.notificationMode || 'toast'
        }
      };

      const map = await readAll();
      map[id] = task;
      await writeAll(map);

      let url = target;
      try {
        const parsed = new URL(target);
        // Preserve any fragment the target legitimately had.
        const existing = parsed.hash.replace(/^#/, '');
        const params = new URLSearchParams(existing);
        params.set(FRAGMENT_KEY, id);
        parsed.hash = `#${params.toString()}`;
        url = parsed.toString();
      } catch {
        url = `${target}${target.includes('#') ? '&' : '#'}${FRAGMENT_KEY}=${id}`;
      }

      scheduleSweep();
      return {id, url, task};
    }

    async function remove(id) {
      if (!id) return;
      const map = await readAll();
      if (map[id]) {
        delete map[id];
        await writeAll(map);
      }
    }

    /* ------------------------------------------------------------- claim */

    function readFragmentTaskId() {
      try {
        const hash = location.hash.replace(/^#/, '');
        if (!hash || !hash.includes(FRAGMENT_KEY)) return '';
        const params = new URLSearchParams(hash);
        const id = params.get(FRAGMENT_KEY) || '';
        return /^[0-9a-f-]{8,64}$/i.test(id) ? id : '';
      } catch {
        return '';
      }
    }

    /** Removes only our own key from the fragment, leaving the page's intact. */
    function stripFragmentTaskId() {
      try {
        const hash = location.hash.replace(/^#/, '');
        if (!hash) return;
        const params = new URLSearchParams(hash);
        if (!params.has(FRAGMENT_KEY)) return;
        params.delete(FRAGMENT_KEY);
        const rest = params.toString();
        const next = `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`;
        history.replaceState(history.state, '', next);
      } catch (err) {
        env.log.debug('could not strip task fragment', err);
      }
    }

    function readSessionClaim() {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!util.isPlainObject(parsed)) return null;
        if (!Number.isFinite(parsed.created) || Date.now() - parsed.created > TASK_TTL) {
          sessionStorage.removeItem(SESSION_KEY);
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }

    function writeSessionClaim(task) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(task));
        return true;
      } catch {
        // Private mode, storage disabled, or a partitioned context. The job
        // still runs on this page; it just will not survive a navigation.
        return false;
      }
    }

    function clearSessionClaim() {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* nothing to clean up */
      }
    }

    /**
     * Resolves the job this page should run, if any.
     *
     * Order matters: an explicit fragment always wins, because a user can open
     * a second lookup in a tab that already carries a session claim.
     */
    async function claimForThisPage() {
      const fragmentId = readFragmentTaskId();

      if (fragmentId) {
        stripFragmentTaskId();
        const map = await readAll();
        const task = map[fragmentId];
        if (!task) {
          env.log.debug('task fragment referenced an expired job', fragmentId);
          return {task: null, expired: true};
        }
        task.claimed = Date.now();
        map[fragmentId] = task;
        await writeAll(map);
        writeSessionClaim(task);
        return {task, expired: false};
      }

      const session = readSessionClaim();
      if (session) {
        const map = await readAll();
        // The shared record is authoritative: if another tab finished the job
        // (or it expired) the stale session claim must not re-run it.
        if (!map[session.id]) {
          clearSessionClaim();
          return {task: null, expired: false};
        }
        return {task: session, expired: false};
      }

      return {task: null, expired: false};
    }

    /** Marks a job finished: shared record gone, session claim gone. */
    async function complete(id) {
      clearSessionClaim();
      await remove(id);
    }

    /* -------------------------------------------------------------- sweep */

    function scheduleSweep() {
      if (sweepTimer) return;
      sweepTimer = setTimeout(async () => {
        sweepTimer = null;
        try {
          const map = await readAll(); // readAll already drops expired jobs
          await writeAll(map);
        } catch (err) {
          env.log.debug('task sweep failed', err);
        }
      }, SWEEP_INTERVAL);
    }

    function dispose() {
      if (sweepTimer) {
        clearTimeout(sweepTimer);
        sweepTimer = null;
      }
    }

    async function inspect() {
      const map = await readAll();
      return Object.values(map).map(task => ({
        id: task.id,
        engine: task.engine,
        age: Date.now() - task.created,
        claimed: !!task.claimed
      }));
    }

    return {
      TASK_TTL,
      FRAGMENT_KEY,
      create,
      remove,
      claimForThisPage,
      complete,
      readFragmentTaskId,
      stripFragmentTaskId,
      inspect,
      dispose
    };
  })();

  /* =======================================================================
   * SECTION 11 — Engine automation
   * -----------------------------------------------------------------------
   * Yandex, Megalodon and Ghostarchive have no addressable "show me the
   * cached copy of X" URL: you land on a search page and something has to
   * drive it. The userscript running on the destination page picks up the
   * job handed to it by section 10 and runs the automation routine.
   *
   * Every routine is written so that failure is *reported*, never silent:
   * missing nodes are surfaced with clear explanations rather than leaving
   * the tab stalled.
   * ==================================================================== */

  const automation = (() => {
    /* ------------------------------------------------- page-context helpers */

    /**
     * `makeDocumentVisibleScript`: A background tab throttles rAF and
     * reports `document.hidden`, which stops the engines' single-page
     * applications from rendering the results the automation needs. This
     * convinces the page it is visible and focused.
     *
     * It runs in the *page* realm, so it is written as a self-contained
     * function with no closure over userscript state.
     */
    function makeDocumentVisibleScript(eventName) {
      let visibilityState = document.visibilityState;

      document.addEventListener(
        eventName,
        ev => {
          visibilityState = ev.detail;
        },
        {capture: true}
      );

      let lastCallTime = 0;
      window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
        apply(target, thisArg, argumentsList) {
          if (visibilityState === 'visible') {
            return Reflect.apply(target, thisArg, argumentsList);
          }
          const currentTime = Date.now();
          const callDelay = Math.max(0, 16 - (currentTime - lastCallTime));
          lastCallTime = currentTime + callDelay;
          return window.setTimeout(() => {
            argumentsList[0](performance.now());
          }, callDelay);
        }
      });

      window.cancelAnimationFrame = new Proxy(window.cancelAnimationFrame, {
        apply(target, thisArg, argumentsList) {
          if (visibilityState === 'visible') {
            return Reflect.apply(target, thisArg, argumentsList);
          }
          return window.clearTimeout(argumentsList[0]);
        }
      });

      try {
        Object.defineProperty(document, 'visibilityState', {get: () => 'visible', configurable: true});
        Object.defineProperty(document, 'hidden', {get: () => false, configurable: true});
        Document.prototype.hasFocus = function () {
          return true;
        };
      } catch (err) {
        /* another script already redefined them; the rAF shim still helps */
      }

      function stopEvent(ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }

      window.addEventListener('pagehide', stopEvent, {capture: true});
      window.addEventListener('blur', stopEvent, {capture: true});

      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
      window.dispatchEvent(new FocusEvent('focus'));
    }

    /** `yandexServiceObserverScript`. */
    function yandexServiceObserverScript(eventName) {
      let stop = false;

      const checkService = function () {
        if (window.Ya?.reactBus?.emit) {
          window.clearTimeout(timeoutId);
          document.dispatchEvent(new Event(eventName));
        } else if (!stop) {
          window.setTimeout(checkService, 200);
        }
      };

      const timeoutId = window.setTimeout(() => {
        stop = true;
      }, 60000);

      checkService();
    }

    /**
     * `makeDocumentVisible`: mirror the real visibility state into the
     * page realm over a private event name, then install the shim.
     */
    function makeDocumentVisible(disposables) {
      const eventName = `wa-${util.uuid()}`;

      const dispatch = () => {
        try {
          document.dispatchEvent(new CustomEvent(eventName, {detail: document.visibilityState}));
        } catch {
          /* the page may have been torn down */
        }
      };

      disposables.addListener(document, 'visibilitychange', dispatch, {capture: true});

      const ok = env.runInPageContext(makeDocumentVisibleScript, [eventName]);
      if (!ok) env.log.warn('could not make the document appear visible; results may not render');
      return ok;
    }

    /* --------------------------------------------------------------- yandex */

    const YANDEX_SELECTORS = {
      homeInput: ['input#text', 'input[name="text"]', 'textarea[name="text"]'],
      homeSubmit: ['button.search3__button', 'button[type="submit"]', '.search2__button button'],
      resultRoot: ['#search-result', '.serp-list', '[data-fast-name="search-result"]'],
      resultButtons: [
        '#search-result button.Organic-Extralinks',
        '#search-result .Organic-Extralinks',
        '.serp-item button.Organic-Extralinks'
      ],
      headerInput: [
        'form[role=search] .HeaderForm-InputWrapper textarea.HeaderForm-Input',
        'form[role=search] textarea',
        'form[role=search] input[name="text"]'
      ],
      headerSubmit: ['form[role=search] button.HeaderForm-Submit', 'form[role=search] button[type="submit"]'],
      copyLink: [
        '.ExtralinksPopup a.ExtralinksPopup-Item_copy',
        '.ExtralinksPopup a[href*="yandexwebcache"]',
        'a[href*="yandexwebcache.net"]'
      ]
    };

    /** First selector in a list that resolves, waiting for the whole budget. */
    async function findAny(selectors, options = {}) {
      const {timeout = 15000, ...rest} = options;
      const deadline = Date.now() + timeout;
      for (const selector of selectors) {
        const remaining = Math.max(500, deadline - Date.now());
        const node = await util.findNode(selector, {...rest, timeout: remaining});
        if (node) return node;
        if (Date.now() >= deadline) break;
      }
      return null;
    }

    function queryAll(selectors) {
      for (const selector of selectors) {
        let nodes;
        try {
          nodes = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        if (nodes.length) return [...nodes];
      }
      return [];
    }

    function setNativeValue(node, value) {
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      const descriptor = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
      if (descriptor?.set) descriptor.set.call(node, value);
      else node.value = value;
      node.dispatchEvent(new Event('input', {bubbles: true}));
      node.dispatchEvent(new Event('change', {bubbles: true}));
    }

    /**
     * Extracts the cached-copy URL from a Yandex "extra links" button. The
     * payload lives in an arbitrary data-attribute as HTML-escaped JSON.
     */
    function readYandexButtonUrl(button) {
      try {
        const raw = Object.keys(button.dataset)
          .map(key => button.dataset[key])
          .find(value => typeof value === 'string' && /^\{.*variant/.test(value));
        if (!raw) return null;

        const payload = JSON.parse(raw.replace(/&quot;/g, '"'));
        const copyItem = (payload.items || []).find(item => item.variant === 'copy');
        if (!copyItem?.url) return null;

        const cacheUrl = new URL(copyItem.url, location.href);
        const original = cacheUrl.searchParams.get('url');
        return original && urls.validateUrl(original) ? original : null;
      } catch (err) {
        env.log.debug('unreadable Yandex extralinks payload', err);
        return null;
      }
    }

    async function handleYandexResults(sourceUrl, buttons) {
      const items = [];
      for (const button of buttons) {
        const url = readYandexButtonUrl(button);
        if (url) items.push({button, url});
      }
      if (!items.length) return false;

      const ranked = ranking.getRankedResults({sourceUrl, results: items});
      if (!ranked.length) return false;

      ranked[0].button.click();

      const link = await findAny(YANDEX_SELECTORS.copyLink, {timeout: 8000});
      if (!link) return false;

      // `_top` so the cached page replaces this tab rather than opening a
      // third one.
      link.setAttribute('target', '_top');
      link.click();
      return true;
    }

    async function runYandex({docUrl, disposables, signal}) {
      if (location.pathname.startsWith('/showcaptcha')) {
        return {ok: false, reason: 'captcha'};
      }

      makeDocumentVisible(disposables);
      await util.waitForDocumentLoad();

      if (!location.pathname.startsWith('/search')) {
        const input = await findAny(YANDEX_SELECTORS.homeInput, {timeout: 15000, signal});
        if (!input) return {ok: false, reason: 'no-input'};

        setNativeValue(input, `url:${docUrl}`);

        const submit = await findAny(YANDEX_SELECTORS.homeSubmit, {timeout: 5000, signal});
        if (!submit) {
          input.form?.requestSubmit?.();
          return {ok: true, pending: true};
        }
        submit.click();
        // The page navigates; the session claim carries the job forward.
        return {ok: true, pending: true};
      }

      await findAny(YANDEX_SELECTORS.resultRoot, {timeout: 20000, signal});

      // Wait for Yandex's client-side search service to come up.
      await waitForYandexService(signal);
      await util.sleep(1000);

      let buttons = queryAll(YANDEX_SELECTORS.resultButtons);
      if (buttons.length) {
        const handled = await handleYandexResults(docUrl, buttons);
        return handled ? {ok: true} : {ok: false, reason: 'no-cache-link'};
      }

      // A `url:` query with no hits: retry as a plain query, then re-inspect.
      const headerInput = await findAny(YANDEX_SELECTORS.headerInput, {timeout: 8000, signal});
      if (!headerInput || !String(headerInput.value || '').startsWith('url:')) {
        return {ok: false, reason: 'no-results'};
      }

      headerInput.click();
      setNativeValue(headerInput, docUrl);

      await util.sleep(100);
      const submit = await findAny(YANDEX_SELECTORS.headerSubmit, {timeout: 5000, signal});
      if (submit) submit.click();
      else headerInput.form?.requestSubmit?.();

      // The desktop layout does not reload, so wait for the results in place.
      await findAny(YANDEX_SELECTORS.resultButtons, {timeout: 30000, signal});
      await util.sleep(1000);

      buttons = queryAll(YANDEX_SELECTORS.resultButtons);
      if (!buttons.length) return {ok: false, reason: 'no-results'};

      const handled = await handleYandexResults(docUrl, buttons);
      return handled ? {ok: true} : {ok: false, reason: 'no-cache-link'};
    }

    function waitForYandexService(signal) {
      return new Promise(resolve => {
        const eventName = `wa-${util.uuid()}`;
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          document.removeEventListener(eventName, finish, {capture: true});
          signal?.removeEventListener?.('abort', finish);
          resolve();
        };

        const timeoutId = setTimeout(finish, 60000);
        document.addEventListener(eventName, finish, {capture: true, once: true});
        signal?.addEventListener?.('abort', finish, {once: true});

        if (!env.runInPageContext(yandexServiceObserverScript, [eventName])) {
          // Without page-realm access we cannot observe the internal bus; give
          // the SPA a fixed grace period instead of hanging for a minute.
          clearTimeout(timeoutId);
          setTimeout(finish, 3000);
        }
      });
    }

    /* ------------------------------------------------------------ megalodon */

    async function runMegalodon({signal}) {
      await util.waitForDocumentLoad();

      const node = await findAny(
        ['div#bgcontain a[id^="fish"]', 'a[id^="fish"]', '#bgcontain a[href*="megalodon.jp/"]'],
        {timeout: 20000, signal}
      );
      if (!node) return {ok: false, reason: 'no-results'};

      node.setAttribute('target', '_top');
      node.click();
      return {ok: true};
    }

    /* --------------------------------------------------------- ghostarchive */

    async function runGhostarchive({signal}) {
      await util.waitForDocumentLoad();

      const link = await findAny(
        ['#bodyContent table td a', '#bodyContent a[href^="/archive/"]', 'table td a[href^="/archive/"]'],
        {timeout: 12000, signal}
      );
      if (!link) return {ok: false, reason: 'no-results'};

      const target = link.href;
      if (!urls.validateUrl(target)) return {ok: false, reason: 'invalid-result'};

      env.navigate(target, {keepHistory: false});
      return {ok: true};
    }

    /* --------------------------------------------------------------- perma */

    /**
     * Perma.cc is resolved through its public API directly before opening a tab,
     * removing intermediate blank tabs and letting a miss be reported immediately.
     */
    async function resolvePermacc(lookupUrl, {signal} = {}) {
      const endpoint =
        'https://api.perma.cc/v1/public/archives/?format=json&limit=1&url=' +
        encodeURIComponent(lookupUrl);

      try {
        const {body} = await env.request(endpoint, {responseType: 'json', timeout: 15000, signal});
        const result = body?.objects?.[0];
        if (!result?.guid) return {ok: false, reason: 'no-results'};

        const target = `https://perma.cc/${encodeURIComponent(result.guid)}`;
        if (!urls.validateUrl(target)) return {ok: false, reason: 'invalid-result'};
        return {ok: true, target};
      } catch (err) {
        if (err?.name === 'AbortError') return {ok: false, reason: 'aborted'};
        env.log.warn('perma.cc lookup failed', err);
        return {ok: false, reason: 'error', error: err};
      }
    }

    /* ------------------------------------------------------------ dispatch */

    const runners = {
      yandex: runYandex,
      megalodon: runMegalodon,
      ghostarchive: runGhostarchive
    };

    /** True when this page is the destination for `engineId`'s automation. */
    function hostMatchesEngine(engineId) {
      const host = location.hostname;
      if (engineId === 'yandex') return /(?:^|\.)yandex\.[a-z.]+$/i.test(host);
      if (engineId === 'megalodon') return /(?:^|\.)megalodon\.jp$/i.test(host);
      if (engineId === 'ghostarchive') return /(?:^|\.)ghostarchive\.org$/i.test(host);
      return false;
    }

    /**
     * Runs the job claimed for this page.
     * @returns {Promise<{ok:boolean, pending?:boolean, reason?:string}>}
     */
    async function run(task, {disposables, signal, onStatus} = {}) {
      const runner = runners[task.engine];
      if (!runner) return {ok: false, reason: 'unsupported-engine'};

      if (!hostMatchesEngine(task.engine)) {
        // The tab navigated somewhere unrelated while the claim was live.
        return {ok: false, reason: 'wrong-host'};
      }

      onStatus?.('running');

      try {
        const result = await runner({docUrl: task.docUrl, disposables, signal});
        onStatus?.(result.ok ? (result.pending ? 'pending' : 'done') : 'failed');
        return result;
      } catch (err) {
        env.log.error(`automation for ${task.engine} threw`, err);
        onStatus?.('failed');
        return {ok: false, reason: 'exception', error: err};
      }
    }

    return {
      run,
      runners,
      hostMatchesEngine,
      resolvePermacc,
      makeDocumentVisible,
      readYandexButtonUrl,
      handleYandexResults,
      /* exported for the test suite */
      _findAny: findAny,
      _setNativeValue: setNativeValue
    };
  })();

  /* =======================================================================
   * SECTION 12 — "Open the original page"
   * -----------------------------------------------------------------------
   * When you are *reading* an archived copy, recover the URL of the page it
   * archived.
   *
   * Both page and link extraction paths are supported with robust error handling:
   *
   *  - frameset extraction safely guards cross-origin frame access;
   *  - shadow root extraction handles closed shadow roots with URL fallbacks;
   *  - every extractor returns a *validated* URL or nothing, preventing partial
   *    or malformed navigation targets;
   *  - each engine has more than one strategy tried in confidence order.
   * ==================================================================== */

  const currentDoc = (() => {
    /**
     * @typedef {object} Extraction
     * @property {string} url       validated original URL
     * @property {string} engine    archive engine that served this page
     * @property {string} strategy  which extractor produced it
     */

    const first = (...candidates) => {
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && urls.validateUrl(candidate.trim())) {
          return candidate.trim();
        }
      }
      return '';
    };

    /** Reads a shadow root whether it is open or closed, where possible. */
    function openOrClosedShadowRoot(host) {
      if (!host) return null;
      try {
        if (host.shadowRoot) return host.shadowRoot;
      } catch {
        /* fall through */
      }
      try {
        // Some engines expose this non-standard accessor.
        if (host.openOrClosedShadowRoot) return host.openOrClosedShadowRoot;
      } catch {
        /* fall through */
      }
      try {
        const chromeDom = globalThis.chrome?.dom;
        if (chromeDom?.openOrClosedShadowRoot) return chromeDom.openOrClosedShadowRoot(host);
      } catch {
        /* shadow root accessor unavailable */
      }
      return null;
    }

    function textOf(node) {
      if (!node) return '';
      if ('value' in node && typeof node.value === 'string') return node.value;
      if (node instanceof HTMLAnchorElement) return node.href;
      return node.textContent || '';
    }

    /* ---------------------------------------------------------- extractors */

    const extractors = {
      archiveOrg(doc, href) {
        // 1. the replay toolbar's URL field, inside a shadow root
        const base = doc.querySelector('[id="wm-ipp-base"]');
        const shadow = openOrClosedShadowRoot(base);
        const fromToolbar = shadow
          ? textOf(shadow.querySelector('#wm-toolbar input#wmtbURL') || shadow.querySelector('input#wmtbURL'))
          : '';

        // 2. the same field when the toolbar is not encapsulated
        const fromLightDom = textOf(doc.querySelector('[id="wmtbURL"]'));

        // 3. the replay URL itself — always present, so it is the safety net
        const fromUrl = href.match(data.linkArchiveUrlRx.archiveOrg)?.[1] || '';

        // 4. the canonical `<link rel="original">` some replays emit
        const fromLink = doc.querySelector('link[rel="original" i][href]')?.getAttribute('href') || '';

        const url = first(fromToolbar, fromLightDom, fromLink, fromUrl);
        if (!url) return null;
        const strategy = url === fromToolbar
          ? 'toolbar-shadow'
          : url === fromLightDom
            ? 'toolbar'
            : url === fromLink
              ? 'link-rel-original'
              : 'replay-url';
        return {url, strategy};
      },

      archiveIs(doc, href) {
        const fromSearchBox = textOf(
          doc.querySelector('#HEADER form[action*="/search/"] input[type=text]') ||
            doc.querySelector('[id="HEADER"] input[type=text]')
        );

        // The banner links the live page directly.
        const fromBanner =
          doc.querySelector('#HEADER a[href^="http"]:not([href*="archive."])')?.href || '';

        const fromUrl = href.match(data.linkArchiveUrlRx.archiveIs)?.[1] || '';

        const url = first(fromSearchBox, fromUrl, fromBanner);
        if (!url) return null;
        return {
          url,
          strategy: url === fromSearchBox ? 'search-box' : url === fromUrl ? 'replay-url' : 'banner'
        };
      },

      yandex(doc) {
        const fromHeader = doc.querySelector('#yandex-cache-hdr > span > a')?.href || '';
        const fromAnyHeader = doc.querySelector('[id="yandex-cache-hdr"] a[href]')?.href || '';
        const url = first(fromHeader, fromAnyHeader);
        return url ? {url, strategy: url === fromHeader ? 'cache-header' : 'cache-header-loose'} : null;
      },

      permacc(doc, href) {
        const fromLivePage = doc.querySelector('._livepage a')?.href || '';
        const fromAnyLive = doc.querySelector('a[href][class*="livepage" i]')?.href || '';
        const fromUrl = href.match(data.linkArchiveUrlRx.permacc)?.[1] || '';
        const normalisedFromUrl =
          fromUrl && !/^(?:https?|ftp):\/\//i.test(fromUrl) ? `https://${fromUrl}` : fromUrl;

        const url = first(fromLivePage, fromAnyLive, normalisedFromUrl);
        return url ? {url, strategy: url === normalisedFromUrl ? 'replay-url' : 'live-page-link'} : null;
      },

      megalodon(doc, href) {
        const fromUrl = href.match(data.linkArchiveUrlRx.megalodon)?.[1] || '';
        const fromHeader = doc.querySelector('#pageinfo a[href^="http"]')?.href || '';
        const url = first(fromUrl, fromHeader);
        return url ? {url, strategy: url === fromUrl ? 'replay-url' : 'page-info'} : null;
      },

      ghostarchive(doc, href) {
        const fromSearchInput = textOf(doc.querySelector('[id="searchInput"]'));
        const fromUrl = href.match(data.linkArchiveUrlRx.ghostarchive)?.[1] || '';
        const normalisedFromUrl =
          fromUrl && !/^(?:https?|ftp):\/\//i.test(fromUrl) ? `https://${fromUrl}` : fromUrl;

        const url = first(fromSearchInput, normalisedFromUrl);
        return url ? {url, strategy: url === fromSearchInput ? 'search-input' : 'replay-url'} : null;
      },

      webcite(doc) {
        // WebCite is a frameset; the original URL lives in the nav frame. A
        // cross-origin frame access is safely guarded to prevent exceptions.
        let fromNavFrame = '';
        try {
          const frame = doc.querySelector('frame[name="nav"]');
          const frameDoc = frame?.contentDocument;
          fromNavFrame = frameDoc?.querySelector('tr:first-child td:nth-child(2) a')?.href || '';
        } catch (err) {
          env.log.debug('WebCite nav frame is not readable', err);
        }

        // The query form keeps the requested URL in the address bar.
        let fromQuery = '';
        try {
          fromQuery = new URL(location.href).searchParams.get('url') || '';
        } catch {
          /* ignore */
        }

        const url = first(fromNavFrame, fromQuery);
        return url ? {url, strategy: url === fromNavFrame ? 'nav-frame' : 'query-param'} : null;
      }
    };

    /* -------------------------------------------------------------- the API */

    /** Which archive engine, if any, is serving this page. */
    function detectEngine(hostname = location.hostname) {
      return urls.identifyArchiveHost(hostname);
    }

    function isArchivePage() {
      return !!detectEngine();
    }

    /**
     * Extracts the original URL of the page currently displayed.
     * @returns {Extraction|null}
     */
    function extractFromPage(doc = document, href = location.href) {
      const engine = urls.identifyArchiveUrl(href) || detectEngine(location.hostname);
      if (!engine) return null;

      const extractor = extractors[engine];
      if (!extractor) return null;

      let result = null;
      try {
        result = extractor(doc, href);
      } catch (err) {
        env.log.warn(`current-page extraction failed for ${engine}`, err);
        return null;
      }

      if (!result?.url) return null;
      return {url: result.url, engine, strategy: result.strategy};
    }

    /** Extract the original URL that an archive link points at. */
    function extractFromLink(linkUrl) {
      const found = urls.extractDocUrlFromLink(linkUrl);
      if (!found) return null;
      return {url: found.docUrl, engine: found.engine, strategy: 'link-pattern'};
    }

    /**
     * Resolves the best available original URL for the current context.
     * A link target takes precedence, short-circuiting the page path.
     */
    function resolve({linkUrl = ''} = {}) {
      if (linkUrl) {
        const fromLink = extractFromLink(linkUrl);
        if (fromLink) return fromLink;
        // A link was targeted but is not an archive link: fall through to the
        // page, rather than reporting "not found" for a perfectly good page.
      }
      return extractFromPage();
    }

    return {
      detectEngine,
      isArchivePage,
      extractFromPage,
      extractFromLink,
      resolve,
      extractors,
      openOrClosedShadowRoot
    };
  })();

  /* =======================================================================
   * SECTION 13 — Lookup orchestration
   * -----------------------------------------------------------------------
   * Orchestrates lookup operations across search engines.
   *
   * A *session* is one user intent: a target URL plus the engines to try. The
   * orchestrator turns that into concrete navigations in a deterministic order,
   * with a single well-defined outcome per engine, and records the result.
   *
   * Key robustness improvements:
   *  - Clean tab indexing and ordering without side-effects;
   *  - Explicit detection of blocked popups;
   *  - Early client-side validation of target URLs before executing network tasks.
   * ==================================================================== */

  const lookup = (() => {
    /**
     * @typedef {object} Target
     * @property {'page'|'link'|'selection'|'media'|'frame'|'custom'} type
     * @property {string} url        the raw URL for this target
     * @property {string} [title]    a human label, when one is available
     * @property {Element} [element] the element the target came from
     */

    /* --------------------------------------------------------- target model */

    function pageTarget() {
      return {type: 'page', url: location.href, title: document.title || ''};
    }

    function makeTarget(type, url, extra = {}) {
      return {type, url: String(url || ''), title: '', ...extra};
    }

    /** The URL a target resolves to, after the user's lookup rules. */
    function resolveUrl(target, settings) {
      const allowCanonical = target.type === 'page';
      return urls.resolveLookupUrl(target.url, settings, {
        doc: allowCanonical ? document : null,
        allowCanonical
      });
    }

    /* ------------------------------------------------------------- session */

    /**
     * Creates a lookup session object tracking origin, mode, engines, and target.
     */
    function createSession({origin = 'action', engines = [], target, settings, searchMode = ''} = {}) {
      const mode =
        searchMode ||
        (origin === 'action' ? settings.searchModeAction : settings.searchModeContextMenu);

      return {
        id: util.uuid(),
        origin,
        searchMode: mode,
        engines: engines.slice(),
        target,
        settings,
        started: Date.now()
      };
    }

    /* ----------------------------------------------------------- execution */

    /**
     * @typedef {object} EngineOutcome
     * @property {string} engineId
     * @property {'opened'|'copied'|'blocked'|'invalid'|'no-results'|'error'} status
     * @property {string} [url]
     * @property {string} [reason]
     */

    /**
     * Runs one engine. Returns an outcome; never throws.
     *
     * `action` is 'open' (default) or 'copy' — the copy path exists so that a
     * blocked pop-up, or a user who just wants the URL for a citation, is not
     * a dead end.
     */
    async function runEngine({engine, lookupUrl, settings, active, action = 'open', signal}) {
      const resolved = registry.resolveTarget(settings, engine, lookupUrl);

      if (!resolved.ok) {
        return {engineId: engine.id, status: 'invalid', reason: resolved.reason};
      }

      /* --- API-resolved engines (Perma.cc) ------------------------------- */
      if (resolved.kind === 'api') {
        if (engine.id !== 'permacc') {
          return {engineId: engine.id, status: 'error', reason: 'unsupported-api-engine'};
        }
        if (!env.capabilities.crossOriginRequests) {
          // Without the request grant the API cannot be reached; send the user
          // to Perma.cc's own search rather than failing outright.
          const fallback = `https://perma.cc/?q=${encodeURIComponent(lookupUrl)}`;
          return finishOpen(engine, fallback, {active, action, degraded: true});
        }

        const result = await automation.resolvePermacc(lookupUrl, {signal});
        if (!result.ok) {
          return {
            engineId: engine.id,
            status: result.reason === 'no-results' ? 'no-results' : 'error',
            reason: result.reason
          };
        }
        return finishOpen(engine, result.target, {active, action});
      }

      /* --- automated engines --------------------------------------------- */
      if (resolved.kind === 'automate') {
        if (action === 'copy') {
          // There is no stable URL to copy for an automated engine; copying the
          // search entry point is the honest answer.
          return finishOpen(engine, resolved.target, {active, action});
        }

        const job = await tasks.create({
          engine: engine.id,
          docUrl: lookupUrl,
          target: resolved.target,
          settings
        });
        const outcome = finishOpen(engine, job.url, {active, action});
        if (outcome.status !== 'opened') {
          // The tab never opened, so nothing will ever claim the job.
          await tasks.remove(job.id);
        }
        return outcome;
      }

      /* --- directly addressable engines ---------------------------------- */
      return finishOpen(engine, resolved.target, {active, action});
    }

    function finishOpen(engine, target, {active, action, degraded = false}) {
      if (!urls.validateUrl(target)) {
        return {engineId: engine.id, status: 'invalid', reason: 'invalid-target'};
      }

      if (action === 'copy') {
        return {engineId: engine.id, status: 'copied', url: target, degraded};
      }

      const {ok} = env.openTab(target, {active});
      return ok
        ? {engineId: engine.id, status: 'opened', url: target, degraded}
        : {engineId: engine.id, status: 'blocked', url: target, degraded};
    }

    /* ------------------------------------------------------------- the API */

    /**
     * Executes a session.
     *
     * The first tab of a batch is focused unless "open new tabs in the background"
     * is enabled; subsequent tabs are opened in the background.
     * Opens are sequential with a short stagger so that the browser preserves
     * the order the user sees in the launcher.
     */
    async function run(session, {action = 'open', signal, onProgress} = {}) {
      const {settings, target} = session;

      const resolvedUrl = resolveUrl(target, settings);
      if (!resolvedUrl.valid) {
        ui.notify({message: getText('error_invalidPageUrl'), kind: 'error'});
        return {ok: false, reason: 'invalid-url', outcomes: []};
      }

      const engines = session.engines;
      if (!engines.length) {
        ui.notify({message: getText('error_allEnginesDisabledApp'), kind: 'error'});
        return {ok: false, reason: 'no-engines', outcomes: []};
      }

      const lookupUrl = resolvedUrl.url;
      const outcomes = [];
      let firstActive = !settings.tabInBackgound;

      for (const engine of engines) {
        if (signal?.aborted) break;

        onProgress?.({engineId: engine.id, phase: 'start'});

        // eslint-disable-next-line no-await-in-loop
        const outcome = await runEngine({
          engine,
          lookupUrl,
          settings,
          active: firstActive,
          action,
          signal
        });

        outcomes.push(outcome);
        onProgress?.({engineId: engine.id, phase: 'end', outcome});

        if (outcome.status === 'opened') firstActive = false;

        if (engines.length > 1 && engine !== engines[engines.length - 1]) {
          // eslint-disable-next-line no-await-in-loop
          await util.sleep(60);
        }
      }

      await recordUse(session, lookupUrl, outcomes);
      reportOutcomes(session, lookupUrl, outcomes, action);

      return {
        ok: outcomes.some(o => o.status === 'opened' || o.status === 'copied'),
        lookupUrl,
        outcomes
      };
    }

    /** Convenience wrapper: one engine, one target. */
    async function runSingle({engine, target, settings, origin = 'action', action = 'open', signal}) {
      const session = createSession({origin, engines: [engine], target, settings});
      return run(session, {action, signal});
    }

    /** "all engines": every enabled engine, in the user's order. */
    async function runAll({target, settings, origin = 'action', action = 'open', signal}) {
      const engines = registry.enabledEngines(settings);
      const session = createSession({origin, engines, target, settings});
      return run(session, {action, signal});
    }

    /**
     * New capability: open only the engines that reported a snapshot. Turns
     * "open ten tabs and check each" into one action.
     */
    async function runAvailable({target, settings, origin = 'action', signal}) {
      const resolvedUrl = resolveUrl(target, settings);
      if (!resolvedUrl.valid) {
        ui.notify({message: getText('error_invalidPageUrl'), kind: 'error'});
        return {ok: false, reason: 'invalid-url', outcomes: []};
      }

      const candidates = registry.enabledEngines(settings).filter(engine => engine.probe);
      const results = await probes.probeAll(candidates, resolvedUrl.url, {settings, signal});
      const available = results
        .filter(item => item.result.state === 'available')
        .map(item => candidates.find(engine => engine.id === item.id))
        .filter(Boolean);

      if (!available.length) {
        ui.notify({message: getText('notice_noAvailableEngines'), kind: 'warn'});
        return {ok: false, reason: 'none-available', outcomes: []};
      }

      const session = createSession({origin, engines: available, target, settings});
      return run(session, {signal});
    }

    /* ---------------------------------------------------------- reporting */

    function reportOutcomes(session, lookupUrl, outcomes, action) {
      if (!outcomes.length) return;

      const opened = outcomes.filter(o => o.status === 'opened');
      const copied = outcomes.filter(o => o.status === 'copied');
      const blocked = outcomes.filter(o => o.status === 'blocked');
      const failed = outcomes.filter(o => ['invalid', 'error', 'no-results'].includes(o.status));

      if (action === 'copy' && copied.length) {
        env.writeClipboard(copied.map(o => o.url).join('\n')).then(ok => {
          ui.notify({
            message: getText(ok ? 'notice_copied' : 'notice_copyFailed'),
            kind: ok ? 'success' : 'error'
          });
        });
        return;
      }

      if (blocked.length) {
        ui.notify({
          message: getText('notice_openBlocked'),
          kind: 'error',
          actions: [
            {
              label: getText('action_copyUrl'),
              onSelect: async () => {
                const ok = await env.writeClipboard(blocked.map(o => o.url).join('\n'));
                ui.notify({
                  message: getText(ok ? 'notice_copied' : 'notice_copyFailed'),
                  kind: ok ? 'success' : 'error'
                });
              }
            }
          ]
        });
        return;
      }

      for (const outcome of failed) {
        const engine = registry.getEngine(session.settings, outcome.engineId);
        const name = engine?.name || outcome.engineId;
        const message =
          outcome.status === 'no-results'
            ? getText('engineRun_noResult', [name])
            : getText('engineRun_failed', [name]);
        ui.notify({message, kind: 'warn'});
      }

      if (opened.length && session.settings.notificationMode !== 'off') {
        const engine = registry.getEngine(session.settings, opened[0].engineId);
        const message =
          opened.length === 1
            ? getText('notice_searchStarted_one', [engine?.name || opened[0].engineId])
            : getText('notice_searchStarted_many', [opened.length]);
        ui.notify({message, kind: 'info', timeout: 2500, quiet: true});
      }
    }

    async function recordUse(session, lookupUrl, outcomes) {
      const succeeded = outcomes.filter(o => o.status === 'opened' || o.status === 'copied');
      if (!succeeded.length) return;

      try {
        await store.bumpUseCount();
        await store.setStats({
          lastLookup: {
            url: lookupUrl,
            engines: succeeded.map(o => o.engineId),
            time: Date.now()
          }
        });
        for (const outcome of succeeded) {
          // eslint-disable-next-line no-await-in-loop
          await store.addHistory({
            url: lookupUrl,
            engine: outcome.engineId,
            title: session.target.title || ''
          });
        }
      } catch (err) {
        env.log.warn('could not record lookup', err);
      }
    }

    /* -------------------------------------------------------------- extras */

    /** On-demand capture ("save page now"). */
    async function capture({engineId, target, settings}) {
      const engine = registry.getEngine(settings, engineId);
      const resolvedUrl = resolveUrl(target, settings);

      if (!resolvedUrl.valid) {
        ui.notify({message: getText('error_invalidPageUrl'), kind: 'error'});
        return {ok: false, reason: 'invalid-url'};
      }

      const built = registry.resolveCaptureTarget(settings, engine, resolvedUrl.url);
      if (!built.ok) {
        ui.notify({message: getText('save_unsupported'), kind: 'warn'});
        return {ok: false, reason: built.reason};
      }

      const {ok} = env.openTab(built.target, {active: !settings.tabInBackgound});
      if (!ok) {
        ui.notify({message: getText('notice_openBlocked'), kind: 'error'});
        return {ok: false, reason: 'blocked'};
      }

      ui.notify({message: getText('save_started', [engine.name]), kind: 'success'});
      return {ok: true, target: built.target};
    }

    /** Copies a Markdown citation with the snapshot date, when one is known. */
    async function copyCitation({engineId, target, settings}) {
      const engine = registry.getEngine(settings, engineId);
      const resolvedUrl = resolveUrl(target, settings);
      if (!resolvedUrl.valid) {
        ui.notify({message: getText('error_invalidPageUrl'), kind: 'error'});
        return {ok: false};
      }

      const built = registry.resolveTarget(settings, engine, resolvedUrl.url);
      const probeResult = probes.peek(engine, resolvedUrl.url);
      const archiveUrl =
        probeResult?.state === 'available' && probeResult.url ? probeResult.url : built.target || '';

      const title = target.title || urls.getHostname(resolvedUrl.url);
      const dateText =
        probeResult?.state === 'available' && Number.isFinite(probeResult.time)
          ? ` (archived ${util.formatDate(probeResult.time)})`
          : '';

      const citation = archiveUrl
        ? `[${title}](${archiveUrl})${dateText} — original: ${resolvedUrl.url}`
        : `${title} — ${resolvedUrl.url}`;

      const ok = await env.writeClipboard(citation);
      ui.notify({
        message: getText(ok ? 'notice_copied' : 'notice_copyFailed'),
        kind: ok ? 'success' : 'error'
      });
      return {ok, citation};
    }

    /** "Open the original page" — the current-document action. */
    async function openOriginal({linkUrl = '', settings} = {}) {
      const found = currentDoc.resolve({linkUrl});
      if (!found) {
        ui.notify({message: getText('error_currentDocUrlNotFound'), kind: 'warn'});
        return {ok: false};
      }

      const {ok} = env.openTab(found.url, {active: !settings.tabInBackgound});
      if (!ok) {
        const copied = await env.writeClipboard(found.url);
        ui.notify({
          message: getText(copied ? 'notice_copied' : 'notice_openBlocked'),
          kind: copied ? 'success' : 'error'
        });
        return {ok: copied, url: found.url};
      }
      return {ok: true, url: found.url};
    }

    return {
      pageTarget,
      makeTarget,
      resolveUrl,
      createSession,
      run,
      runSingle,
      runAll,
      runAvailable,
      runEngine,
      capture,
      copyCitation,
      openOriginal
    };
  })();

  /* =======================================================================
   * SECTION 14 — Styles and icons
   * -----------------------------------------------------------------------
   * Every rule is scoped to the closed shadow root created in section 15, so
   * nothing here can affect the host page and nothing on the host page can
   * affect it. The only element in the light DOM is the shadow host itself,
   * which is reset with `all: initial`.
   *
   * Design notes:
   *  - the whole palette is driven by CSS custom properties, so the theme
   *    switch is a single attribute change with no re-render;
   *  - the dialog uses the top layer (`<dialog>.showModal()`), which sidesteps
   *    the stacking-context wars that plague injected overlays on real sites;
   *  - `prefers-reduced-motion` and the explicit "reduce motion" setting both
   *    collapse every transition to zero.
   * ==================================================================== */

  const STYLES = `
  :host {
    all: initial;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }

  *, *::before, *::after { box-sizing: border-box; }

  .wa-root {
    --wa-font: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --wa-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

    --wa-bg: #ffffff;
    --wa-bg-raised: #f6f7f9;
    --wa-bg-sunken: #eceef2;
    --wa-fg: #14171c;
    --wa-fg-muted: #5b6270;
    --wa-fg-faint: #8b93a1;
    --wa-border: #d8dce3;
    --wa-border-strong: #b9c0cb;
    --wa-accent: #2f6fed;
    --wa-accent-fg: #ffffff;
    --wa-accent-soft: rgba(47, 111, 237, 0.12);
    --wa-success: #16794a;
    --wa-success-soft: rgba(22, 121, 74, 0.12);
    --wa-warn: #8a5a00;
    --wa-warn-soft: rgba(138, 90, 0, 0.13);
    --wa-error: #b4232a;
    --wa-error-soft: rgba(180, 35, 42, 0.12);
    --wa-shadow: 0 10px 38px rgba(12, 17, 28, 0.22), 0 2px 8px rgba(12, 17, 28, 0.12);
    --wa-radius: 12px;
    --wa-radius-sm: 8px;
    --wa-speed: 140ms;
    --wa-focus: 0 0 0 2px var(--wa-bg), 0 0 0 4px var(--wa-accent);

    font-family: var(--wa-font);
    font-size: 14px;
    line-height: 1.45;
    color: var(--wa-fg);
    -webkit-font-smoothing: antialiased;
  }

  .wa-root[data-theme='dark'] {
    --wa-bg: #171a20;
    --wa-bg-raised: #1f232b;
    --wa-bg-sunken: #12151a;
    --wa-fg: #e9ecf1;
    --wa-fg-muted: #a3abb9;
    --wa-fg-faint: #737c8b;
    --wa-border: #2f353f;
    --wa-border-strong: #434b58;
    --wa-accent: #6a9dff;
    --wa-accent-fg: #10141c;
    --wa-accent-soft: rgba(106, 157, 255, 0.16);
    --wa-success: #62d19b;
    --wa-success-soft: rgba(98, 209, 155, 0.14);
    --wa-warn: #ecb44a;
    --wa-warn-soft: rgba(236, 180, 74, 0.14);
    --wa-error: #ff7b7b;
    --wa-error-soft: rgba(255, 123, 123, 0.14);
    --wa-shadow: 0 12px 44px rgba(0, 0, 0, 0.6), 0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .wa-root[data-motion='reduce'] *,
  .wa-root[data-motion='reduce'] *::before,
  .wa-root[data-motion='reduce'] *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .wa-root *, .wa-root *::before, .wa-root *::after {
      transition-duration: 0ms !important;
      animation-duration: 0ms !important;
    }
  }

  /* ------------------------------------------------------------- primitives */

  .wa-root button,
  .wa-root input,
  .wa-root select,
  .wa-root textarea {
    font: inherit;
    color: inherit;
    margin: 0;
  }

  .wa-root :focus-visible {
    outline: none;
    box-shadow: var(--wa-focus);
    border-radius: var(--wa-radius-sm);
  }

  .wa-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .wa-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 32px;
    padding: 5px 12px;
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius-sm);
    background: var(--wa-bg-raised);
    color: var(--wa-fg);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--wa-speed) ease, border-color var(--wa-speed) ease;
    white-space: nowrap;
  }
  .wa-btn:hover:not(:disabled) { background: var(--wa-bg-sunken); border-color: var(--wa-border-strong); }
  .wa-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .wa-btn--primary {
    background: var(--wa-accent);
    border-color: var(--wa-accent);
    color: var(--wa-accent-fg);
  }
  .wa-btn--primary:hover:not(:disabled) { filter: brightness(1.07); background: var(--wa-accent); }
  .wa-btn--ghost { background: transparent; border-color: transparent; }
  .wa-btn--ghost:hover:not(:disabled) { background: var(--wa-bg-sunken); }
  .wa-btn--danger { color: var(--wa-error); border-color: var(--wa-border); }
  .wa-btn--danger:hover:not(:disabled) { background: var(--wa-error-soft); }
  .wa-btn--icon { min-width: 32px; padding: 5px; }
  .wa-btn--sm { min-height: 26px; padding: 2px 8px; font-size: 12px; }

  .wa-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .wa-field__label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--wa-fg-muted);
  }
  .wa-field__hint {
    font-size: 12px;
    color: var(--wa-fg-faint);
    line-height: 1.4;
  }
  .wa-field__error { font-size: 12px; color: var(--wa-error); }

  .wa-input,
  .wa-select,
  .wa-textarea {
    width: 100%;
    min-height: 32px;
    padding: 5px 9px;
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius-sm);
    background: var(--wa-bg);
    color: var(--wa-fg);
    font-size: 13px;
  }
  .wa-textarea { min-height: 96px; resize: vertical; font-family: var(--wa-mono); font-size: 12px; }
  .wa-input:focus, .wa-select:focus, .wa-textarea:focus { border-color: var(--wa-accent); }
  .wa-input[aria-invalid='true'] { border-color: var(--wa-error); }

  .wa-switch {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    padding: 2px 0;
  }
  .wa-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .wa-switch__track {
    flex: none;
    width: 34px;
    height: 20px;
    margin-top: 1px;
    border-radius: 999px;
    background: var(--wa-border-strong);
    position: relative;
    transition: background var(--wa-speed) ease;
  }
  .wa-switch__track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform var(--wa-speed) ease;
  }
  .wa-switch input:checked + .wa-switch__track { background: var(--wa-accent); }
  .wa-switch input:checked + .wa-switch__track::after { transform: translateX(14px); }
  .wa-switch input:focus-visible + .wa-switch__track { box-shadow: var(--wa-focus); }
  .wa-switch__text { display: flex; flex-direction: column; gap: 2px; }
  .wa-switch__label { font-size: 13px; }
  .wa-switch__hint { font-size: 12px; color: var(--wa-fg-faint); }

  .wa-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    background: var(--wa-bg-sunken);
    color: var(--wa-fg-muted);
    white-space: nowrap;
  }
  .wa-chip--ok { background: var(--wa-success-soft); color: var(--wa-success); }
  .wa-chip--warn { background: var(--wa-warn-soft); color: var(--wa-warn); }
  .wa-chip--error { background: var(--wa-error-soft); color: var(--wa-error); }
  .wa-chip--busy { background: var(--wa-accent-soft); color: var(--wa-accent); }

  .wa-spinner {
    width: 13px;
    height: 13px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    display: inline-block;
    animation: wa-spin 720ms linear infinite;
  }
  @keyframes wa-spin { to { transform: rotate(360deg); } }

  .wa-divider { height: 1px; background: var(--wa-border); border: 0; margin: 0; }

  /* ---------------------------------------------------------------- dialog */

  .wa-dialog {
    padding: 0;
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius);
    background: var(--wa-bg);
    color: var(--wa-fg);
    box-shadow: var(--wa-shadow);
    max-width: min(94vw, 640px);
    width: min(94vw, 640px);
    max-height: min(86vh, 760px);
    overflow: hidden;
  }
  .wa-dialog::backdrop { background: rgba(10, 13, 20, 0.42); backdrop-filter: blur(1.5px); }
  .wa-dialog--wide { max-width: min(96vw, 860px); width: min(96vw, 860px); }

  .wa-dialog__inner { display: flex; flex-direction: column; max-height: inherit; }

  .wa-dialog__header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--wa-border);
    background: var(--wa-bg-raised);
  }
  .wa-dialog__title { font-size: 14px; font-weight: 650; letter-spacing: 0.01em; flex: 1; min-width: 0; }
  .wa-dialog__body { overflow: auto; padding: 12px 14px; flex: 1; }
  .wa-dialog__body--flush { padding: 0; }
  .wa-dialog__footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--wa-border);
    background: var(--wa-bg-raised);
    flex-wrap: wrap;
  }
  .wa-dialog__footer .wa-spacer { flex: 1; }

  /* -------------------------------------------------------------- launcher */

  .wa-launcher__target {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--wa-border);
    background: var(--wa-bg);
    font-size: 12px;
    color: var(--wa-fg-muted);
  }
  .wa-launcher__target-url {
    font-family: var(--wa-mono);
    font-size: 12px;
    color: var(--wa-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    direction: ltr;
  }
  .wa-launcher__target select { width: auto; min-width: 96px; }

  .wa-launcher__urlbar { padding: 9px 14px; border-bottom: 1px solid var(--wa-border); }

  .wa-launcher__filter {
    padding: 9px 14px;
    border-bottom: 1px solid var(--wa-border);
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .wa-list { list-style: none; margin: 0; padding: 5px 0; }
  .wa-list__group-title {
    padding: 8px 14px 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--wa-fg-faint);
  }
  .wa-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    cursor: pointer;
    border: 0;
    width: 100%;
    background: transparent;
    text-align: left;
    color: inherit;
    transition: background var(--wa-speed) ease;
  }
  .wa-item:hover { background: var(--wa-bg-raised); }
  .wa-item[aria-selected='true'], .wa-item.is-active { background: var(--wa-accent-soft); }
  .wa-item[aria-disabled='true'] { opacity: 0.55; cursor: not-allowed; }
  .wa-item__icon { flex: none; width: 20px; height: 20px; display: grid; place-items: center; }
  .wa-item__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .wa-item__label { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wa-item__desc { font-size: 11.5px; color: var(--wa-fg-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wa-item__meta { flex: none; display: flex; align-items: center; gap: 6px; }
  .wa-item__key {
    font-family: var(--wa-mono);
    font-size: 10.5px;
    color: var(--wa-fg-faint);
    border: 1px solid var(--wa-border);
    border-radius: 4px;
    padding: 0 4px;
    min-width: 16px;
    text-align: center;
  }

  .wa-empty { padding: 26px 14px; text-align: center; color: var(--wa-fg-faint); font-size: 13px; }

  .wa-hint {
    padding: 8px 14px;
    font-size: 11.5px;
    color: var(--wa-fg-faint);
    border-top: 1px solid var(--wa-border);
    background: var(--wa-bg-raised);
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  /* -------------------------------------------------------------- settings */

  .wa-tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--wa-border); background: var(--wa-bg-raised); }
  .wa-tab {
    padding: 6px 11px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--wa-fg-muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--wa-radius-sm) var(--wa-radius-sm) 0 0;
  }
  .wa-tab:hover { color: var(--wa-fg); background: var(--wa-bg-sunken); }
  .wa-tab[aria-selected='true'] { color: var(--wa-accent); border-bottom-color: var(--wa-accent); }

  .wa-section { padding: 4px 0 18px; }
  .wa-section__title { font-size: 13px; font-weight: 650; margin: 0 0 4px; }
  .wa-section__desc { font-size: 12px; color: var(--wa-fg-faint); margin: 0 0 10px; line-height: 1.45; }
  .wa-section__grid { display: grid; gap: 12px; }
  @media (min-width: 620px) {
    .wa-section__grid--2 { grid-template-columns: 1fr 1fr; }
  }

  .wa-engine-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .wa-engine-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius-sm);
    background: var(--wa-bg-raised);
  }
  .wa-engine-row.is-dragging { opacity: 0.45; }
  .wa-engine-row.is-drop-target { border-color: var(--wa-accent); box-shadow: inset 0 0 0 1px var(--wa-accent); }
  .wa-engine-row__grip {
    cursor: grab;
    color: var(--wa-fg-faint);
    padding: 2px;
    background: none;
    border: 0;
    display: grid;
    place-items: center;
  }
  .wa-engine-row__grip:active { cursor: grabbing; }
  .wa-engine-row__name { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wa-engine-row__actions { display: flex; gap: 2px; }

  .wa-rule-row, .wa-custom-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius-sm);
    background: var(--wa-bg-raised);
    margin-bottom: 6px;
  }
  .wa-rule-row__text, .wa-custom-row__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .wa-rule-row__pattern, .wa-custom-row__name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wa-rule-row__meta, .wa-custom-row__template {
    font-size: 11.5px;
    color: var(--wa-fg-faint);
    font-family: var(--wa-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wa-kbd-record {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wa-kbd-record__value {
    flex: 1;
    min-height: 32px;
    display: flex;
    align-items: center;
    padding: 4px 9px;
    border: 1px dashed var(--wa-border-strong);
    border-radius: var(--wa-radius-sm);
    font-family: var(--wa-mono);
    font-size: 12.5px;
    background: var(--wa-bg);
  }
  .wa-kbd-record__value.is-recording { border-style: solid; border-color: var(--wa-accent); background: var(--wa-accent-soft); }

  .wa-code {
    font-family: var(--wa-mono);
    font-size: 11.5px;
    background: var(--wa-bg-sunken);
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius-sm);
    padding: 8px 10px;
    overflow: auto;
    max-height: 220px;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  .wa-banner {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    padding: 9px 11px;
    border-radius: var(--wa-radius-sm);
    border: 1px solid var(--wa-border);
    background: var(--wa-bg-raised);
    font-size: 12.5px;
    margin-bottom: 12px;
  }
  .wa-banner--warn { border-color: var(--wa-warn); background: var(--wa-warn-soft); color: var(--wa-warn); }
  .wa-banner--info { border-color: var(--wa-accent); background: var(--wa-accent-soft); }

  /* -------------------------------------------------------- snapshot picker */

  .wa-snapshots { display: flex; flex-direction: column; gap: 10px; }
  .wa-snapshot-years { display: flex; flex-wrap: wrap; gap: 4px; }
  .wa-snapshot-year {
    border: 1px solid var(--wa-border);
    border-radius: var(--wa-radius-sm);
    background: var(--wa-bg-raised);
    padding: 3px 9px;
    font-size: 12px;
    cursor: pointer;
  }
  .wa-snapshot-year[aria-pressed='true'] { background: var(--wa-accent); border-color: var(--wa-accent); color: var(--wa-accent-fg); }
  .wa-snapshot-list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; border: 1px solid var(--wa-border); border-radius: var(--wa-radius-sm); }
  .wa-snapshot-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-bottom: 1px solid var(--wa-border);
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-size: 12.5px;
  }
  .wa-snapshot-item:last-child { border-bottom: 0; }
  .wa-snapshot-item:hover { background: var(--wa-bg-raised); }
  .wa-snapshot-item__date { flex: 1; font-family: var(--wa-mono); }

  /* ---------------------------------------------------------------- toasts */

  .wa-toasts {
    position: fixed;
    z-index: 2147483647;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(92vw, 380px);
    pointer-events: none;
  }
  .wa-toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 9px 11px;
    border-radius: var(--wa-radius-sm);
    border: 1px solid var(--wa-border);
    background: var(--wa-bg);
    color: var(--wa-fg);
    box-shadow: var(--wa-shadow);
    font-size: 12.5px;
    animation: wa-toast-in 180ms ease;
  }
  @keyframes wa-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .wa-toast--success { border-left: 3px solid var(--wa-success); }
  .wa-toast--warn { border-left: 3px solid var(--wa-warn); }
  .wa-toast--error { border-left: 3px solid var(--wa-error); }
  .wa-toast--info { border-left: 3px solid var(--wa-accent); }
  .wa-toast__text { flex: 1; min-width: 0; }
  .wa-toast__actions { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; }

  /* ------------------------------------------------------- error-page offer */

  .wa-offer {
    position: fixed;
    z-index: 2147483646;
    left: 50%;
    transform: translateX(-50%);
    bottom: 20px;
    max-width: min(94vw, 520px);
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 13px;
    border-radius: var(--wa-radius);
    border: 1px solid var(--wa-border);
    background: var(--wa-bg);
    box-shadow: var(--wa-shadow);
    animation: wa-toast-in 200ms ease;
  }
  .wa-offer__text { flex: 1; min-width: 0; }
  .wa-offer__title { font-size: 13px; font-weight: 600; }
  .wa-offer__body { font-size: 12px; color: var(--wa-fg-muted); }
  .wa-offer__actions { display: flex; gap: 6px; flex: none; flex-wrap: wrap; }

  /* ------------------------------------------------------- floating button */

  .wa-fab {
    position: fixed;
    z-index: 2147483645;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--wa-border);
    background: var(--wa-bg);
    color: var(--wa-fg-muted);
    box-shadow: var(--wa-shadow);
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0.55;
    transition: opacity var(--wa-speed) ease, transform var(--wa-speed) ease;
  }
  .wa-fab:hover, .wa-fab:focus-visible { opacity: 1; transform: scale(1.06); }
  .wa-fab[data-position='bottomRight'] { right: 16px; bottom: 16px; }
  .wa-fab[data-position='bottomLeft'] { left: 16px; bottom: 16px; }
  .wa-fab[data-position='topRight'] { right: 16px; top: 16px; }
  .wa-fab[data-position='topLeft'] { left: 16px; top: 16px; }

  /* ------------------------------------------------------ in-page ctx menu */

  .wa-ctxmenu {
    position: fixed;
    z-index: 2147483647;
    min-width: 208px;
    max-width: min(92vw, 300px);
    max-height: min(80vh, 460px);
    overflow: auto;
    padding: 4px 0;
    border-radius: var(--wa-radius-sm);
    border: 1px solid var(--wa-border);
    background: var(--wa-bg);
    box-shadow: var(--wa-shadow);
  }
  .wa-ctxmenu__title {
    padding: 6px 12px 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--wa-fg-faint);
  }

  /* --------------------------------------------------------- archive banner */

  .wa-archive-banner {
    position: fixed;
    z-index: 2147483644;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 13px;
    background: var(--wa-bg-raised);
    border-bottom: 1px solid var(--wa-border);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
    font-size: 12.5px;
  }
  .wa-archive-banner__text { flex: 1; min-width: 0; }
  .wa-archive-banner__url { font-family: var(--wa-mono); font-size: 11.5px; color: var(--wa-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ------------------------------------------------------------ responsive */

  @media (max-width: 520px) {
    .wa-dialog, .wa-dialog--wide { width: 96vw; max-width: 96vw; max-height: 90vh; }
    .wa-offer { flex-direction: column; align-items: stretch; }
    .wa-hint { display: none; }
  }
  `;

  /* -----------------------------------------------------------------------
   * Inline icon set. Every glyph is built through `util.svg`, which only
   * emits a fixed whitelist of shape tags and attributes — no markup string
   * ever reaches the DOM, so an icon cannot become an injection vector.
   * Stroke-based outlines inherit `currentColor` and therefore theme
   * automatically.
   * -------------------------------------------------------------------- */

  const icons = (() => {
    const stroke = (shapes, size) =>
      util.svg({
        size,
        shapes: shapes.map(shape => ({
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.7,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          ...shape
        }))
      });

    return {
      archive: (size = 18) =>
        stroke(
          [
            {tag: 'rect', x: 3, y: 4, width: 18, height: 4, rx: 1},
            {tag: 'path', d: 'M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8'},
            {tag: 'path', d: 'M10 12h4'}
          ],
          size
        ),
      search: (size = 18) =>
        stroke([{tag: 'circle', cx: 11, cy: 11, r: 6}, {tag: 'path', d: 'M20 20l-4.3-4.3'}], size),
      close: (size = 16) => stroke([{tag: 'path', d: 'M6 6l12 12M18 6L6 18'}], size),
      settings: (size = 18) =>
        stroke(
          [
            {tag: 'circle', cx: 12, cy: 12, r: 3},
            {
              tag: 'path',
              d: 'M12 3v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M3 12h2m14 0h2M4.2 19.8l1.4-1.4M17 5.6l1.4-1.4'
            }
          ],
          size
        ),
      openExternal: (size = 18) =>
        stroke(
          [
            {tag: 'path', d: 'M14 4h6v6'},
            {tag: 'path', d: 'M20 4l-9 9'},
            {tag: 'path', d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'}
          ],
          size
        ),
      copy: (size = 18) =>
        stroke(
          [
            {tag: 'rect', x: 9, y: 9, width: 11, height: 11, rx: 2},
            {tag: 'path', d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'}
          ],
          size
        ),
      save: (size = 18) =>
        stroke(
          [
            {tag: 'path', d: 'M12 3v11'},
            {tag: 'path', d: 'M8 10l4 4 4-4'},
            {tag: 'path', d: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2'}
          ],
          size
        ),
      calendar: (size = 18) =>
        stroke(
          [
            {tag: 'rect', x: 3, y: 5, width: 18, height: 16, rx: 2},
            {tag: 'path', d: 'M3 10h18M8 3v4m8-4v4'}
          ],
          size
        ),
      history: (size = 18) =>
        stroke(
          [
            {tag: 'path', d: 'M3 12a9 9 0 1 0 3-6.7L3 8'},
            {tag: 'path', d: 'M3 4v4h4'},
            {tag: 'path', d: 'M12 8v4.5l3 1.8'}
          ],
          size
        ),
      info: (size = 18) =>
        stroke([{tag: 'circle', cx: 12, cy: 12, r: 9}, {tag: 'path', d: 'M12 11v5m0-8.2v.2'}], size),
      warning: (size = 18) =>
        stroke(
          [
            {tag: 'path', d: 'M12 4l9 16H3z'},
            {tag: 'path', d: 'M12 10v4m0 2.8v.2'}
          ],
          size
        ),
      grip: (size = 16) =>
        util.svg({
          size,
          shapes: [
            {tag: 'circle', cx: 9, cy: 6, r: 1.5, fill: 'currentColor'},
            {tag: 'circle', cx: 15, cy: 6, r: 1.5, fill: 'currentColor'},
            {tag: 'circle', cx: 9, cy: 12, r: 1.5, fill: 'currentColor'},
            {tag: 'circle', cx: 15, cy: 12, r: 1.5, fill: 'currentColor'},
            {tag: 'circle', cx: 9, cy: 18, r: 1.5, fill: 'currentColor'},
            {tag: 'circle', cx: 15, cy: 18, r: 1.5, fill: 'currentColor'}
          ]
        }),
      arrowUp: (size = 15) => stroke([{tag: 'path', d: 'M12 19V5m-6 6l6-6 6 6'}], size),
      arrowDown: (size = 15) => stroke([{tag: 'path', d: 'M12 5v14m6-6l-6 6-6-6'}], size),
      plus: (size = 15) => stroke([{tag: 'path', d: 'M12 5v14M5 12h14'}], size),
      trash: (size = 15) =>
        stroke(
          [
            {tag: 'path', d: 'M4 7h16'},
            {tag: 'path', d: 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'},
            {tag: 'path', d: 'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12'}
          ],
          size
        ),
      edit: (size = 15) =>
        stroke(
          [
            {tag: 'path', d: 'M4 20h4l10-10-4-4L4 16z'},
            {tag: 'path', d: 'M13.5 6.5l4 4'}
          ],
          size
        ),
      refresh: (size = 15) =>
        stroke(
          [
            {tag: 'path', d: 'M20 12a8 8 0 1 1-2.3-5.6'},
            {tag: 'path', d: 'M20 4v5h-5'}
          ],
          size
        ),
      check: (size = 15) => stroke([{tag: 'path', d: 'M5 12.5l4.5 4.5L19 7'}], size),
      heart: (size = 16) =>
        stroke(
          [{tag: 'path', d: 'M12 20s-7.5-4.7-7.5-9.8A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 3.2C19.5 15.3 12 20 12 20z'}],
          size
        ),
      diagnostics: (size = 18) =>
        stroke(
          [
            {tag: 'path', d: 'M3 12h4l2 6 4-14 2 8h6'}
          ],
          size
        )
    };
  })();

  /* =======================================================================
   * SECTION 15 — UI core
   * -----------------------------------------------------------------------
   * One closed shadow root hosts every surface this script draws: the
   * launcher, the settings dialog, the snapshot picker, toasts, the in-page
   * context menu, the broken-page offer and the archive banner.
   *
   * Why a *closed* root: the host page can neither read nor restyle it, which
   * matters because the launcher shows the URL you are looking up and, in URL
   * mode, accepts typed input. Closed also means no page stylesheet can leak
   * in and no page script can walk into our controls.
   *
   * Why `<dialog>.showModal()`: it puts the surface in the browser's *top
   * layer*, above every `z-index` the host page can invent, and gives us
   * native focus trapping, native Escape handling and a native backdrop. Where
   * it is unavailable the code falls back to a positioned overlay with a
   * hand-rolled focus trap, so nothing is lost.
   * ==================================================================== */

  const ui = (() => {
    const HOST_ID = 'web-archives-userscript-root';

    let host = null;
    let root = null;
    let shadow = null;
    let toastLayer = null;
    let mounted = false;
    let themeQuery = null;
    let currentSettings = null;
    const disposables = new env.Disposables('ui');

    /* ---------------------------------------------------------------- mount */

    function mount(settings) {
      currentSettings = settings;
      if (mounted) {
        applyTheme(settings);
        return root;
      }

      const parent = document.body || document.documentElement;
      if (!parent) return null;

      host = document.createElement('div');
      host.id = HOST_ID;
      // Belt and braces: the host itself must not participate in page layout.
      host.setAttribute(
        'style',
        'all: initial; position: static; display: block; width: 0; height: 0; overflow: visible;'
      );
      host.setAttribute('aria-hidden', 'false');

      try {
        shadow = host.attachShadow({mode: 'closed'});
      } catch (err) {
        // Extremely old engines, or a page that already claimed the root.
        env.log.warn('closed shadow root unavailable; using open mode', err);
        try {
          shadow = host.attachShadow({mode: 'open'});
        } catch (err2) {
          env.log.error('shadow DOM unavailable; UI cannot be mounted', err2);
          return null;
        }
      }

      const style = document.createElement('style');
      style.textContent = STYLES;
      shadow.appendChild(style);

      root = document.createElement('div');
      root.className = 'wa-root';
      shadow.appendChild(root);

      toastLayer = util.el('div', {class: 'wa-toasts', role: 'region', 'aria-label': env.APP_NAME});
      root.appendChild(toastLayer);

      parent.appendChild(host);
      mounted = true;

      applyTheme(settings);
      watchSystemTheme();
      guardHostRemoval(parent);

      return root;
    }

    /**
     * Single-page applications occasionally wipe `document.body`. Re-attaching
     * on removal is cheaper and far more reliable than re-running boot.
     */
    function guardHostRemoval(parent) {
      let observer;
      try {
        observer = new MutationObserver(() => {
          if (!host || host.isConnected) return;
          const target = document.body || document.documentElement;
          if (target) {
            try {
              target.appendChild(host);
            } catch (err) {
              env.log.debug('could not re-attach UI host', err);
            }
          }
        });
        observer.observe(parent, {childList: true});
        disposables.addObserver(observer);
      } catch (err) {
        env.log.debug('host guard unavailable', err);
      }
    }

    /* ---------------------------------------------------------------- theme */

    function resolveTheme(settings) {
      const preference = settings?.appTheme || 'auto';
      if (preference !== 'auto') return preference;
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        return 'light';
      }
    }

    function applyTheme(settings) {
      currentSettings = settings || currentSettings;
      if (!root) return;
      root.dataset.theme = resolveTheme(currentSettings);
      root.dataset.motion = currentSettings?.reduceMotion ? 'reduce' : 'auto';
    }

    function watchSystemTheme() {
      try {
        themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
          if ((currentSettings?.appTheme || 'auto') === 'auto') applyTheme(currentSettings);
        };
        if (themeQuery.addEventListener) {
          themeQuery.addEventListener('change', onChange);
          disposables.add(() => themeQuery.removeEventListener('change', onChange));
        } else if (themeQuery.addListener) {
          themeQuery.addListener(onChange);
          disposables.add(() => themeQuery.removeListener(onChange));
        }
      } catch {
        /* matchMedia is unavailable; the explicit theme setting still works */
      }
    }

    function getTheme() {
      return root?.dataset.theme || 'light';
    }

    /* --------------------------------------------------------------- toasts */

    const activeToasts = new Set();
    const MAX_TOASTS = 4;

    /**
     * @param {object} options
     * @param {string} options.message
     * @param {'info'|'success'|'warn'|'error'} [options.kind]
     * @param {number} [options.timeout]  0 keeps it until dismissed
     * @param {Array<{label:string,onSelect:Function}>} [options.actions]
     * @param {boolean} [options.quiet]   never escalate to a native notification
     */
    function notify({message, kind = 'info', timeout = 6000, actions = [], quiet = false} = {}) {
      if (!message) return () => {};

      // Read the live setting rather than the snapshot captured at mount time:
      // the notification mode can change while the page is open, and a stale
      // snapshot would keep routing to the wrong channel.
      const settings = store.all();
      currentSettings = settings;
      const mode = settings.notificationMode || 'toast';
      if (mode === 'off' && kind !== 'error') return () => {};

      if (mode === 'native' && !quiet && !actions.length) {
        const raised = env.nativeNotify({title: env.APP_NAME, text: message, timeout});
        if (raised) return () => {};
      }

      if (!mounted) mount(currentSettings || store.all());
      if (!toastLayer) {
        env.log.info(message);
        return () => {};
      }

      // Bound the stack: the oldest goes when a fifth arrives.
      while (activeToasts.size >= MAX_TOASTS) {
        const oldest = activeToasts.values().next().value;
        oldest?.dismiss();
      }

      const textNode = util.el('div', {class: 'wa-toast__text'}, [
        util.el('div', {text: message})
      ]);

      const toast = util.el(
        'div',
        {
          class: ['wa-toast', `wa-toast--${kind}`],
          role: kind === 'error' ? 'alert' : 'status',
          'aria-live': kind === 'error' ? 'assertive' : 'polite'
        },
        [textNode]
      );

      if (actions.length) {
        const actionRow = util.el('div', {class: 'wa-toast__actions'});
        for (const action of actions.slice(0, 3)) {
          actionRow.appendChild(
            util.el('button', {
              class: 'wa-btn wa-btn--sm',
              type: 'button',
              text: action.label,
              onclick: () => {
                try {
                  action.onSelect?.();
                } catch (err) {
                  env.log.error('toast action threw', err);
                }
                dismiss();
              }
            })
          );
        }
        textNode.appendChild(actionRow);
      }

      toast.appendChild(
        util.el('button', {
          class: 'wa-btn wa-btn--ghost wa-btn--icon wa-btn--sm',
          type: 'button',
          'aria-label': getText('button_close'),
          onclick: () => dismiss()
        }, [icons.close(14)])
      );

      let timer = null;
      let dismissed = false;

      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        if (timer) clearTimeout(timer);
        activeToasts.delete(handle);
        toast.remove();
      }

      const handle = {dismiss};
      activeToasts.add(handle);
      toastLayer.appendChild(toast);

      if (timeout > 0) timer = setTimeout(dismiss, timeout);

      return dismiss;
    }

    function clearToasts() {
      for (const handle of [...activeToasts]) handle.dismiss();
    }

    /* --------------------------------------------------------------- dialog */

    let openDialogs = 0;

    /**
     * Modal surface. Uses the native top layer where available.
     */
    class Dialog {
      /**
       * @param {object} options
       * @param {string} options.title
       * @param {boolean} [options.wide]
       * @param {string} [options.labelledBy]
       * @param {Function} [options.onClose]
       */
      constructor({title = '', wide = false, onClose = null, className = ''} = {}) {
        if (!mounted) mount(currentSettings || store.all());

        this.onClose = onClose;
        this.disposables = new env.Disposables('dialog');
        this._closed = false;
        this._previousFocus = null;
        this._native = typeof HTMLDialogElement !== 'undefined' &&
          typeof HTMLDialogElement.prototype.showModal === 'function';

        const titleId = `wa-dialog-title-${util.hashString(title + Math.random())}`;

        this.titleNode = util.el('h2', {class: 'wa-dialog__title', id: titleId, text: title});
        this.header = util.el('div', {class: 'wa-dialog__header'}, [this.titleNode]);
        this.body = util.el('div', {class: 'wa-dialog__body'});
        this.footer = util.el('div', {class: 'wa-dialog__footer'});
        this.inner = util.el('div', {class: 'wa-dialog__inner'}, [this.header, this.body, this.footer]);

        const classes = ['wa-dialog', wide && 'wa-dialog--wide', className].filter(Boolean);

        if (this._native) {
          this.element = util.el('dialog', {class: classes, 'aria-labelledby': titleId}, [this.inner]);
          this.disposables.addListener(this.element, 'cancel', ev => {
            ev.preventDefault();
            this.close('escape');
          });
          this.disposables.addListener(this.element, 'click', ev => {
            // Clicking the backdrop resolves to the dialog element itself.
            if (ev.target === this.element) this.close('backdrop');
          });
        } else {
          this.element = util.el(
            'div',
            {
              class: classes,
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': titleId,
              style: {
                position: 'fixed',
                inset: '0',
                margin: 'auto',
                'z-index': '2147483647',
                height: 'fit-content'
              }
            },
            [this.inner]
          );
          this.backdrop = util.el('div', {
            style: {
              position: 'fixed',
              inset: '0',
              background: 'rgba(10,13,20,0.42)',
              'z-index': '2147483646'
            },
            onclick: () => this.close('backdrop')
          });
          this.disposables.addListener(this.element, 'keydown', ev => this._trapFocus(ev));
        }

        this.disposables.addListener(this.element, 'keydown', ev => {
          if (ev.key === 'Escape' && !this._native) {
            ev.preventDefault();
            ev.stopPropagation();
            this.close('escape');
          }
        });
      }

      addCloseButton(label = getText('button_close')) {
        this.header.appendChild(
          util.el(
            'button',
            {
              class: 'wa-btn wa-btn--ghost wa-btn--icon',
              type: 'button',
              'aria-label': label,
              onclick: () => this.close('button')
            },
            [icons.close(16)]
          )
        );
        return this;
      }

      open() {
        if (this._closed) return this;
        try {
          this._previousFocus = document.activeElement;
        } catch {
          this._previousFocus = null;
        }

        if (this.backdrop) root.appendChild(this.backdrop);
        root.appendChild(this.element);
        openDialogs += 1;

        if (this._native) {
          try {
            this.element.showModal();
          } catch (err) {
            env.log.warn('showModal failed; dialog shown inline', err);
            this.element.setAttribute('open', '');
          }
        }

        // Focus the first sensible control, without scrolling the host page.
        requestAnimationFrame(() => {
          const first = this._focusables()[0];
          try {
            (first || this.element).focus({preventScroll: true});
          } catch {
            first?.focus?.();
          }
        });

        return this;
      }

      _focusables() {
        const selector =
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
          'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        return [...this.element.querySelectorAll(selector)].filter(
          node => node.offsetParent !== null || node === document.activeElement || !node.offsetParent
        );
      }

      _trapFocus(ev) {
        if (ev.key !== 'Tab') return;
        const nodes = this._focusables();
        if (!nodes.length) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        const active = shadow.activeElement;
        if (ev.shiftKey && active === firstNode) {
          ev.preventDefault();
          lastNode.focus();
        } else if (!ev.shiftKey && active === lastNode) {
          ev.preventDefault();
          firstNode.focus();
        }
      }

      close(reason = 'close') {
        if (this._closed) return;
        this._closed = true;
        openDialogs = Math.max(0, openDialogs - 1);

        this.disposables.dispose();

        if (this._native) {
          try {
            if (this.element.open) this.element.close();
          } catch {
            /* already closed */
          }
        }
        this.element.remove();
        this.backdrop?.remove();

        try {
          this._previousFocus?.focus?.({preventScroll: true});
        } catch {
          /* the element may be gone */
        }

        try {
          this.onClose?.(reason);
        } catch (err) {
          env.log.error('dialog onClose threw', err);
        }
      }

      get isOpen() {
        return !this._closed;
      }
    }

    /** Promise-returning confirmation, keyboard operable, no `window.confirm`. */
    function confirm({title, message, confirmLabel = getText('button_ok'), danger = false} = {}) {
      return new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        const dialog = new Dialog({title, onClose: () => finish(false)});
        dialog.body.appendChild(util.el('p', {style: {margin: '0'}, text: message}));

        dialog.footer.appendChild(util.el('div', {class: 'wa-spacer'}));
        dialog.footer.appendChild(
          util.el('button', {
            class: 'wa-btn',
            type: 'button',
            text: getText('button_cancel'),
            onclick: () => {
              finish(false);
              dialog.close();
            }
          })
        );
        dialog.footer.appendChild(
          util.el('button', {
            class: ['wa-btn', danger ? 'wa-btn--danger' : 'wa-btn--primary'],
            type: 'button',
            text: confirmLabel,
            onclick: () => {
              finish(true);
              dialog.close();
            }
          })
        );

        dialog.open();
      });
    }

    /* ---------------------------------------------------------- primitives */

    function button(label, {variant = '', icon = null, onClick, title = '', disabled = false, small = false} = {}) {
      const classes = ['wa-btn'];
      if (variant) classes.push(`wa-btn--${variant}`);
      if (small) classes.push('wa-btn--sm');
      if (!label && icon) classes.push('wa-btn--icon');

      return util.el(
        'button',
        {
          class: classes,
          type: 'button',
          title: title || undefined,
          'aria-label': !label && title ? title : undefined,
          disabled,
          onclick: onClick
        },
        [icon, label || null]
      );
    }

    function field(label, control, {hint = '', error = ''} = {}) {
      const id = `wa-f-${util.hashString(label + Math.random())}`;
      if (control && !control.id) control.id = id;
      return util.el('div', {class: 'wa-field'}, [
        label ? util.el('label', {class: 'wa-field__label', for: control?.id || id, text: label}) : null,
        control,
        hint ? util.el('div', {class: 'wa-field__hint', text: hint}) : null,
        error ? util.el('div', {class: 'wa-field__error', role: 'alert', text: error}) : null
      ]);
    }

    function select(options, value, onChange, {ariaLabel = ''} = {}) {
      const node = util.el('select', {
        class: 'wa-select',
        'aria-label': ariaLabel || undefined,
        onchange: ev => onChange(ev.target.value)
      });
      for (const option of options) {
        node.appendChild(
          util.el('option', {value: option.value, text: option.label, selected: option.value === value})
        );
      }
      node.value = value;
      return node;
    }

    function input({value = '', placeholder = '', type = 'text', onInput, onKeyDown, ariaLabel = ''} = {}) {
      return util.el('input', {
        class: 'wa-input',
        type,
        value,
        placeholder,
        spellcheck: 'false',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        'aria-label': ariaLabel || undefined,
        oninput: onInput ? ev => onInput(ev.target.value, ev) : undefined,
        onkeydown: onKeyDown
      });
    }

    function toggle(label, checked, onChange, {hint = ''} = {}) {
      const box = util.el('input', {
        type: 'checkbox',
        checked,
        onchange: ev => onChange(ev.target.checked)
      });
      return util.el('label', {class: 'wa-switch'}, [
        box,
        util.el('span', {class: 'wa-switch__track', 'aria-hidden': 'true'}),
        util.el('span', {class: 'wa-switch__text'}, [
          util.el('span', {class: 'wa-switch__label', text: label}),
          hint ? util.el('span', {class: 'wa-switch__hint', text: hint}) : null
        ])
      ]);
    }

    function chip(text, variant = '') {
      return util.el('span', {class: ['wa-chip', variant && `wa-chip--${variant}`]}, [
        variant === 'busy' ? util.el('span', {class: 'wa-spinner'}) : null,
        text
      ]);
    }

    function section(title, description, children) {
      return util.el('section', {class: 'wa-section'}, [
        title ? util.el('h3', {class: 'wa-section__title', text: title}) : null,
        description ? util.el('p', {class: 'wa-section__desc', text: description}) : null,
        ...(Array.isArray(children) ? children : [children])
      ]);
    }

    /* ------------------------------------------------------------ lifecycle */

    function getRoot() {
      return root;
    }

    function isMounted() {
      return mounted;
    }

    function hasOpenDialog() {
      return openDialogs > 0;
    }

    function dispose() {
      clearToasts();
      disposables.dispose();
      host?.remove();
      host = null;
      root = null;
      shadow = null;
      toastLayer = null;
      mounted = false;
    }

    return {
      HOST_ID,
      mount,
      getRoot,
      isMounted,
      applyTheme,
      getTheme,
      notify,
      clearToasts,
      Dialog,
      confirm,
      button,
      field,
      select,
      input,
      toggle,
      chip,
      section,
      hasOpenDialog,
      dispose
    };
  })();

  /* =======================================================================
   * SECTION 16 — The launcher
   * -----------------------------------------------------------------------
   * A keyboard-first command palette: the engines are the primary list,
   * in the user's configured order, with icons and digit quick-picks;
   * pinned actions become a secondary group; and everything is filterable.
   *
   * Features:
   *   - show, per engine, whether a snapshot actually exists and how old it is;
   *   - act on the link/selection you right-clicked, not just the tab;
   *   - copy an archive URL or a citation instead of opening it;
   *   - open every engine that has a snapshot, in one action;
   *   - reach the snapshot date picker and the on-demand capture.
   * ==================================================================== */

  const launcher = (() => {
    let dialog = null;
    let state = null;
    let abortController = null;

    /* ------------------------------------------------------------- helpers */

    function availabilityChip(result) {
      if (!result) return null;
      switch (result.state) {
        case 'checking':
          return ui.chip(getText('availability_checking'), 'busy');
        case 'available':
          return ui.chip(
            Number.isFinite(result.time)
              ? getText('availability_availableAt', [util.formatDate(result.time)])
              : getText('availability_available'),
            'ok'
          );
        case 'none':
          return ui.chip(getText('availability_none'), 'warn');
        case 'error':
          return ui.chip(getText('availability_error'), 'error');
        case 'unknown':
          return ui.chip(getText('availability_unknown'));
        default:
          return null;
      }
    }

    function targetLabel(type) {
      switch (type) {
        case 'link':
          return getText('launcherSubtitle_link');
        case 'selection':
          return getText('launcherSubtitle_selection');
        case 'media':
          return getText('launcherSubtitle_media');
        case 'frame':
          return getText('launcherSubtitle_frame');
        case 'custom':
          return getText('launcherSubtitle_custom');
        default:
          return getText('launcherSubtitle_page');
      }
    }

    /* -------------------------------------------------------------- actions */

    /** Builds the non-engine command rows for the current state. */
    function buildActions() {
      const {settings, target} = state;
      const list = [];

      if (settings.searchAllEnginesAction !== 'false') {
        list.push({
          id: 'action:all',
          label: getText('action_searchAll'),
          icon: registry.allEnginesIcon({size: 20}),
          run: () => lookup.runAll({target, settings, origin: 'action'})
        });
      }

      if (settings.probeMode !== 'off' && env.capabilities.crossOriginRequests) {
        list.push({
          id: 'action:available',
          label: getText('action_searchAllAvailable'),
          icon: icons.check(18),
          run: () => lookup.runAvailable({target, settings, origin: 'action'})
        });
      }

      if (state.currentDocUrl) {
        list.push({
          id: 'action:original',
          label: getText('action_openCurrentDoc'),
          desc: urls.displayUrl(state.currentDocUrl, 56),
          icon: icons.openExternal(18),
          run: () => lookup.openOriginal({settings})
        });
      }

      const waybackEngine = registry.getEngine(settings, 'archiveOrg');
      if (waybackEngine && registry.isEnabled(settings, 'archiveOrg') && env.capabilities.crossOriginRequests) {
        list.push({
          id: 'action:snapshots',
          label: getText('action_pickSnapshot'),
          icon: icons.calendar(18),
          keepOpen: true,
          run: () => snapshots.open({target, settings})
        });
      }

      const captureEngines = registry
        .enabledEngines(settings)
        .filter(engine => engine.canCapture);
      if (captureEngines.length) {
        list.push({
          id: 'action:save',
          label: getText('action_saveSnapshot'),
          desc: getText('save_desc'),
          icon: icons.save(18),
          keepOpen: true,
          run: () => openCaptureMenu(captureEngines)
        });
      }

      list.push({
        id: 'action:citation',
        label: getText('action_copyCitation'),
        icon: icons.copy(18),
        run: () => {
          const engine = registry.enabledEngines(settings)[0];
          if (!engine) return null;
          return lookup.copyCitation({engineId: engine.id, target, settings});
        }
      });

      list.push({
        id: 'action:history',
        label: getText('action_history'),
        icon: icons.history(18),
        keepOpen: true,
        run: () => openHistory()
      });

      list.push({
        id: 'action:settings',
        label: getText('action_settings'),
        icon: icons.settings(18),
        run: () => settingsUi.open()
      });

      list.push({
        id: 'action:diagnostics',
        label: getText('action_diagnostics'),
        icon: icons.diagnostics(18),
        run: () => diagnostics.open()
      });

      if (settings.showContribPage && !settings.contribNoticeDismissed) {
        list.push({
          id: 'action:contribute',
          label: getText('action_contribute'),
          icon: icons.heart(18),
          run: () => {
            env.openTab(data.projectUrl, {active: true});
          }
        });
      }

      return list;
    }

    /* ------------------------------------------------------- pinned actions */

    /**
     * The launcher renders pinned actions as a compact icon row so the
     * three `pinActionToolbar*` options provide quick access.
     */
    function buildPinnedRow() {
      const {settings, target} = state;
      const buttons = [];

      if (settings.pinActionToolbarOpenCurrentDoc && state.currentDocUrl) {
        buttons.push(
          ui.button('', {
            variant: 'ghost',
            icon: icons.openExternal(18),
            title: getText('buttonTooltip_openCurrentDoc'),
            onClick: () => {
              close();
              lookup.openOriginal({settings});
            }
          })
        );
      }

      if (settings.pinActionToolbarOptions) {
        buttons.push(
          ui.button('', {
            variant: 'ghost',
            icon: icons.settings(18),
            title: getText('buttonTooltip_options'),
            onClick: () => {
              close();
              settingsUi.open();
            }
          })
        );
      }

      if (settings.pinActionToolbarContribute && settings.showContribPage) {
        buttons.push(
          ui.button('', {
            variant: 'ghost',
            icon: icons.heart(18),
            title: getText('buttonTooltip_contribute'),
            onClick: () => env.openTab(data.projectUrl, {active: true})
          })
        );
      }

      // At most three pinned buttons to keep the row compact.
      if (!buttons.length) return null;
      return util.el(
        'span',
        {style: {display: 'flex', gap: '2px', flex: 'none'}, role: 'group', 'aria-label': getText('launcherSection_actions')},
        buttons.slice(0, 3)
      );
    }

    /* ---------------------------------------------------------- item model */

    function buildItems() {
      const {settings, filter} = state;
      const engines = registry.enabledEngines(settings);

      const engineItems = engines.map(engine => ({
        kind: 'engine',
        id: engine.id,
        engine,
        label: engine.menuTitle,
        icon: settings.showEngineIcons ? registry.engineIcon(engine, {size: 20}) : null,
        searchText: `${engine.name} ${engine.id}`
      }));

      const actionItems = buildActions().map(action => ({
        kind: 'action',
        id: action.id,
        action,
        label: action.label,
        desc: action.desc,
        icon: action.icon,
        searchText: action.label
      }));

      const query = filter.trim();
      if (!query) return {engineItems, actionItems};

      const score = item => util.fuzzyScore(query, item.searchText);
      const filterAndSort = items =>
        items
          .map(item => ({item, score: score(item)}))
          .filter(entry => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(entry => entry.item);

      return {engineItems: filterAndSort(engineItems), actionItems: filterAndSort(actionItems)};
    }

    /* -------------------------------------------------------------- render */

    function render() {
      if (!dialog?.isOpen) return;

      const {settings} = state;
      const {engineItems, actionItems} = buildItems();
      const flat = [...engineItems, ...actionItems];
      state.flat = flat;

      if (state.activeIndex >= flat.length) state.activeIndex = Math.max(0, flat.length - 1);

      const listNode = state.nodes.list;
      util.clear(listNode);

      const hasEnabledEngines = registry.enabledEngines(settings).length > 0;

      if (!hasEnabledEngines) {
        // Actions remain usable, but the reason the engine list is empty must
        // be stated, with a route out of it.
        listNode.appendChild(util.el('div', {class: 'wa-empty', text: getText('launcherNoEngines')}));
        listNode.appendChild(
          util.el('div', {style: {'text-align': 'center', 'padding-bottom': '12px'}}, [
            ui.button(getText('launcherOpenSettings'), {
              variant: 'primary',
              small: true,
              onClick: () => {
                close();
                settingsUi.open('engines');
              }
            })
          ])
        );
      } else if (!flat.length) {
        listNode.appendChild(util.el('div', {class: 'wa-empty', text: getText('launcherEmpty')}));
        return;
      }

      if (!flat.length) return;

      let index = 0;
      const appendGroup = (title, items) => {
        if (!items.length) return;
        listNode.appendChild(util.el('div', {class: 'wa-list__group-title', text: title}));
        const group = util.el('ul', {class: 'wa-list', role: 'group'});
        for (const item of items) {
          group.appendChild(renderItem(item, index));
          index += 1;
        }
        listNode.appendChild(group);
      };

      appendGroup(getText('launcherSection_engines'), engineItems);
      appendGroup(getText('launcherSection_actions'), actionItems);

      scrollActiveIntoView();
    }

    function renderItem(item, index) {
      const isActive = index === state.activeIndex;
      const quickKey = index < 9 ? String(index + 1) : '';

      const meta = util.el('div', {class: 'wa-item__meta'});
      if (item.kind === 'engine') {
        const chipNode = availabilityChip(state.availability[item.id]);
        if (chipNode) meta.appendChild(chipNode);
      }
      if (quickKey) meta.appendChild(util.el('span', {class: 'wa-item__key', text: quickKey}));

      const node = util.el(
        'li',
        {role: 'presentation'},
        [
          util.el(
            'button',
            {
              class: ['wa-item', isActive && 'is-active'],
              type: 'button',
              role: 'option',
              'aria-selected': isActive ? 'true' : 'false',
              dataset: {index: String(index)},
              onclick: ev => activate(index, {copy: ev.metaKey || ev.ctrlKey}),
              onmousemove: () => {
                if (state.activeIndex !== index) {
                  state.activeIndex = index;
                  updateActiveStyling();
                }
              }
            },
            [
              item.icon ? util.el('span', {class: 'wa-item__icon'}, [item.icon]) : util.el('span', {class: 'wa-item__icon'}),
              util.el('span', {class: 'wa-item__text'}, [
                util.el('span', {class: 'wa-item__label', text: item.label}),
                item.desc ? util.el('span', {class: 'wa-item__desc', text: item.desc}) : null
              ]),
              meta
            ]
          )
        ]
      );

      if (isActive) state.nodes.activeButton = node.firstChild;
      return node;
    }

    function updateActiveStyling() {
      const buttons = state.nodes.list.querySelectorAll('.wa-item');
      buttons.forEach(button => {
        const isActive = Number(button.dataset.index) === state.activeIndex;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) state.nodes.activeButton = button;
      });
      scrollActiveIntoView();
    }

    function scrollActiveIntoView() {
      const button = state.nodes.activeButton;
      if (!button?.scrollIntoView) return;
      try {
        button.scrollIntoView({block: 'nearest'});
      } catch {
        /* jsdom and very old engines */
      }
    }

    /* ------------------------------------------------------------ activate */

    async function activate(index, {copy = false} = {}) {
      const item = state.flat?.[index];
      if (!item) return;

      const {settings, target} = state;

      if (item.kind === 'engine') {
        close();
        await lookup.runSingle({
          engine: item.engine,
          target,
          settings,
          origin: 'action',
          action: copy ? 'copy' : 'open'
        });
        return;
      }

      const action = item.action;
      if (!action.keepOpen) close();
      try {
        await action.run();
      } catch (err) {
        env.log.error('launcher action failed', err);
        ui.notify({message: getText('engineRun_failed', [action.label]), kind: 'error'});
      }
    }

    /* ------------------------------------------------------------ probing */

    function startProbing({force = false} = {}) {
      const {settings, target} = state;
      if (settings.probeMode === 'off') return;
      if (settings.probeMode === 'manual' && !force) return;
      if (!env.capabilities.crossOriginRequests) return;

      const resolved = lookup.resolveUrl(target, settings);
      if (!resolved.valid) return;

      abortController?.abort();
      abortController = new AbortController();

      const engines = registry.enabledEngines(settings).filter(engine => engine.probe);
      if (!engines.length) return;

      probes
        .probeAll(engines, resolved.url, {
          settings,
          signal: abortController.signal,
          force,
          onResult: (engineId, result) => {
            state.availability[engineId] = result;
            if (dialog?.isOpen) render();
          }
        })
        .catch(err => env.log.debug('probe batch failed', err));
    }

    /* ----------------------------------------------------------- sub-menus */

    function openCaptureMenu(engines) {
      const sub = new ui.Dialog({title: getText('save_title')});
      sub.addCloseButton();
      sub.body.appendChild(util.el('p', {class: 'wa-section__desc', text: getText('save_desc')}));

      const list = util.el('ul', {class: 'wa-list'});
      for (const engine of engines) {
        list.appendChild(
          util.el('li', {}, [
            util.el(
              'button',
              {
                class: 'wa-item',
                type: 'button',
                onclick: async () => {
                  sub.close();
                  close();
                  await lookup.capture({engineId: engine.id, target: state.target, settings: state.settings});
                }
              },
              [
                util.el('span', {class: 'wa-item__icon'}, [registry.engineIcon(engine, {size: 20})]),
                util.el('span', {class: 'wa-item__text'}, [
                  util.el('span', {class: 'wa-item__label', text: engine.name})
                ])
              ]
            )
          ])
        );
      }
      sub.body.appendChild(list);
      sub.open();
    }

    async function openHistory() {
      const entries = await store.getHistory();
      const sub = new ui.Dialog({title: getText('action_history')});
      sub.addCloseButton();

      if (!entries.length) {
        sub.body.appendChild(util.el('div', {class: 'wa-empty', text: getText('settings_historyEmpty')}));
      } else {
        const list = util.el('ul', {class: 'wa-list'});
        entries.forEach((entry, entryIndex) => {
          const engine = registry.getEngine(state.settings, entry.engine);
          list.appendChild(
            util.el('li', {}, [
              util.el(
                'button',
                {
                  class: 'wa-item',
                  type: 'button',
                  title: entry.url,
                  onclick: async () => {
                    sub.close();
                    close();
                    const targetEngine = engine || registry.enabledEngines(state.settings)[0];
                    if (!targetEngine) return;
                    await lookup.runSingle({
                      engine: targetEngine,
                      target: lookup.makeTarget('custom', entry.url),
                      settings: state.settings,
                      origin: 'action'
                    });
                  }
                },
                [
                  util.el('span', {class: 'wa-item__icon'}, [
                    engine ? registry.engineIcon(engine, {size: 20}) : icons.history(18)
                  ]),
                  util.el('span', {class: 'wa-item__text'}, [
                    util.el('span', {class: 'wa-item__label', text: urls.displayUrl(entry.url, 62)}),
                    util.el('span', {
                      class: 'wa-item__desc',
                      text: `${engine?.name || entry.engine || ''} · ${util.formatRelativeTime(entry.time)}`
                    })
                  ]),
                  util.el('span', {class: 'wa-item__meta'}, [
                    util.el(
                      'span',
                      {
                        class: 'wa-btn wa-btn--ghost wa-btn--icon wa-btn--sm',
                        role: 'button',
                        tabindex: '0',
                        title: getText('settings_historyRemove'),
                        onclick: async ev => {
                          ev.stopPropagation();
                          await store.removeHistory(entryIndex);
                          sub.close();
                          openHistory();
                        }
                      },
                      [icons.trash(14)]
                    )
                  ])
                ]
              )
            ])
          );
        });
        sub.body.appendChild(list);

        sub.footer.appendChild(util.el('div', {class: 'wa-spacer'}));
        sub.footer.appendChild(
          ui.button(getText('settings_historyClear'), {
            variant: 'danger',
            small: true,
            onClick: async () => {
              await store.clearHistory();
              ui.notify({message: getText('settings_historyCleared'), kind: 'success'});
              sub.close();
            }
          })
        );
      }

      sub.open();
    }

    /* --------------------------------------------------------------- open */

    /**
     * @param {object} options
     * @param {Target} [options.target]  defaults to the current page
     */
    function open({target = null} = {}) {
      if (dialog?.isOpen) {
        // Re-opening with a new target replaces the current one.
        close();
      }

      const settings = store.all();
      const resolvedTarget = target || contextTargets.current() || lookup.pageTarget();

      const extraction = currentDoc.extractFromPage();

      state = {
        settings,
        target: resolvedTarget,
        filter: '',
        activeIndex: 0,
        availability: {},
        currentDocUrl: extraction?.url || '',
        flat: [],
        nodes: {}
      };

      dialog = new ui.Dialog({
        title: getText('launcherTitle'),
        className: 'wa-launcher',
        onClose: () => {
          abortController?.abort();
          abortController = null;
          dialog = null;
        }
      });
      dialog.addCloseButton(getText('launcherClose'));

      /* --- target row ---------------------------------------------------- */
      const resolved = lookup.resolveUrl(state.target, settings);
      const targetRow = util.el('div', {class: 'wa-launcher__target'}, [
        util.el('span', {text: `${targetLabel(state.target.type)}:`}),
        util.el('span', {
          class: 'wa-launcher__target-url',
          title: resolved.url || state.target.url,
          text: resolved.valid ? urls.displayUrl(resolved.url, 96) : state.target.url || '—'
        })
      ]);

      if (settings.probeMode === 'manual' && env.capabilities.crossOriginRequests) {
        targetRow.appendChild(
          ui.button('', {
            variant: 'ghost',
            small: true,
            icon: icons.refresh(14),
            title: getText('availability_refresh'),
            onClick: () => startProbing({force: true})
          })
        );
      }

      const pinnedRow = buildPinnedRow();
      if (pinnedRow) targetRow.appendChild(pinnedRow);

      dialog.body.remove();
      dialog.inner.appendChild(targetRow);

      /* --- URL entry (search mode "url", or an invalid page URL) --------- */
      const needsUrlEntry = settings.searchModeAction === 'url' || !resolved.valid;
      if (needsUrlEntry) {
        const urlInput = ui.input({
          value: resolved.valid ? resolved.url : '',
          placeholder: getText('inputPlaceholder_docUrl'),
          ariaLabel: getText('inputPlaceholder_docUrl'),
          onInput: value => {
            state.target = lookup.makeTarget('custom', value.trim());
            const check = lookup.resolveUrl(state.target, state.settings);
            urlInput.setAttribute('aria-invalid', check.valid ? 'false' : 'true');
            targetRow.children[1].textContent = check.valid ? urls.displayUrl(check.url, 96) : value || '—';
            state.availability = {};
            render();
          },
          onKeyDown: ev => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              const check = lookup.resolveUrl(state.target, state.settings);
              if (check.valid) {
                startProbing();
                state.nodes.filter?.focus();
              }
            }
          }
        });
        const urlBar = util.el('div', {class: 'wa-launcher__urlbar'}, [urlInput]);
        dialog.inner.appendChild(urlBar);
        state.nodes.urlInput = urlInput;
      }

      /* --- filter -------------------------------------------------------- */
      const filterInput = ui.input({
        placeholder: getText('launcherFilterPlaceholder'),
        ariaLabel: getText('launcherFilterPlaceholder'),
        onInput: value => {
          state.filter = value;
          state.activeIndex = 0;
          render();
        },
        onKeyDown: onFilterKeyDown
      });
      filterInput.setAttribute('role', 'combobox');
      filterInput.setAttribute('aria-expanded', 'true');
      filterInput.setAttribute('aria-controls', 'wa-launcher-list');
      filterInput.setAttribute('aria-autocomplete', 'list');
      state.nodes.filter = filterInput;

      dialog.inner.appendChild(util.el('div', {class: 'wa-launcher__filter'}, [filterInput]));

      /* --- list ---------------------------------------------------------- */
      const listNode = util.el('div', {
        class: 'wa-dialog__body wa-dialog__body--flush',
        id: 'wa-launcher-list',
        role: 'listbox',
        'aria-label': getText('launcherSection_engines')
      });
      state.nodes.list = listNode;
      dialog.inner.appendChild(listNode);

      /* --- hints --------------------------------------------------------- */
      dialog.inner.appendChild(
        util.el('div', {class: 'wa-hint'}, [
          util.el('span', {text: getText('launcherHint_keys')}),
          util.el('span', {
            text: getText('launcherHint_copy', [env.primaryModifier === 'meta' ? '⌘' : 'Ctrl'])
          })
        ])
      );

      dialog.footer.remove();
      dialog.open();

      render();
      startProbing();

      // Focus the URL field when there is one and it is empty; otherwise the
      // filter, which is what a returning user wants.
      requestAnimationFrame(() => {
        const focusTarget =
          state.nodes.urlInput && !state.nodes.urlInput.value ? state.nodes.urlInput : filterInput;
        try {
          focusTarget.focus({preventScroll: true});
        } catch {
          focusTarget.focus();
        }
      });

      return dialog;
    }

    function onFilterKeyDown(ev) {
      const count = state.flat.length;

      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (count) {
          state.activeIndex = (state.activeIndex + 1) % count;
          updateActiveStyling();
        }
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (count) {
          state.activeIndex = (state.activeIndex - 1 + count) % count;
          updateActiveStyling();
        }
        return;
      }
      if (ev.key === 'Home') {
        ev.preventDefault();
        state.activeIndex = 0;
        updateActiveStyling();
        return;
      }
      if (ev.key === 'End') {
        ev.preventDefault();
        state.activeIndex = Math.max(0, count - 1);
        updateActiveStyling();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        activate(state.activeIndex, {copy: ev.metaKey || ev.ctrlKey});
        return;
      }
      // Digit quick-pick, but only when the filter box is empty so that typing
      // a URL fragment containing a digit still works.
      if (/^[1-9]$/.test(ev.key) && !state.filter && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const index = Number(ev.key) - 1;
        if (index < count) {
          ev.preventDefault();
          activate(index, {copy: ev.shiftKey});
        }
      }
    }

    function close() {
      dialog?.close('programmatic');
      dialog = null;
    }

    function isOpen() {
      return !!dialog?.isOpen;
    }

    function toggle(options) {
      if (isOpen()) close();
      else open(options);
    }

    return {open, close, toggle, isOpen};
  })();

  /* =======================================================================
   * SECTION 17 — Wayback snapshot picker
   * -----------------------------------------------------------------------
   * Reads the CDX index directly and lets you jump to a specific capture — or
   * to the first or most recent one — without leaving the page you are on.
   *
   * The index is fetched once per URL per launcher session, collapsed to one
   * capture per day, and capped, because a heavily-crawled URL can have tens
   * of thousands of captures.
   * ==================================================================== */

  const snapshots = (() => {
    let controller = null;

    async function open({target, settings}) {
      const resolved = lookup.resolveUrl(target, settings);
      if (!resolved.valid) {
        ui.notify({message: getText('error_invalidPageUrl'), kind: 'error'});
        return;
      }

      controller?.abort();
      controller = new AbortController();

      const dialog = new ui.Dialog({
        title: getText('snapshotPicker_title'),
        onClose: () => {
          controller?.abort();
          controller = null;
        }
      });
      dialog.addCloseButton();

      dialog.body.appendChild(
        util.el('p', {class: 'wa-section__desc', text: urls.displayUrl(resolved.url, 96)})
      );

      const content = util.el('div', {class: 'wa-snapshots'}, [
        util.el('div', {class: 'wa-empty'}, [
          util.el('span', {class: 'wa-spinner'}),
          ' ',
          getText('snapshotPicker_loading')
        ])
      ]);
      dialog.body.appendChild(content);
      dialog.open();

      const result = await probes.fetchSnapshotIndex(resolved.url, {
        settings,
        signal: controller.signal
      });

      if (!dialog.isOpen) return;

      if (!result.ok) {
        if (result.reason === 'aborted') return;
        util.render(content, [
          util.el('div', {class: 'wa-empty', text: getText('snapshotPicker_error')}),
          util.el('div', {style: {'text-align': 'center'}}, [
            ui.button(getText('button_close'), {small: true, onClick: () => dialog.close()})
          ])
        ]);
        return;
      }

      if (!result.snapshots.length) {
        util.render(content, [util.el('div', {class: 'wa-empty', text: getText('snapshotPicker_empty')})]);
        return;
      }

      renderIndex({dialog, content, snapshots: result.snapshots, truncated: result.truncated, settings, url: resolved.url});
    }

    function renderIndex({dialog, content, snapshots: list, truncated, settings, url}) {
      const byYear = new Map();
      for (const snapshot of list) {
        const year = new Date(snapshot.time).getUTCFullYear();
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(snapshot);
      }

      const years = [...byYear.keys()].sort((a, b) => b - a);
      let activeYear = years[0];

      const openSnapshot = snapshot => {
        const target = probes.snapshotUrl(settings, snapshot.timestamp, url);
        const {ok} = env.openTab(target, {active: !settings.tabInBackgound});
        if (!ok) ui.notify({message: getText('notice_openBlocked'), kind: 'error'});
        else dialog.close();
      };

      const listNode = util.el('ul', {class: 'wa-snapshot-list', role: 'list'});

      const renderList = () => {
        const items = byYear.get(activeYear) || [];
        util.render(
          listNode,
          items.map(snapshot =>
            util.el('li', {}, [
              util.el(
                'button',
                {
                  class: 'wa-snapshot-item',
                  type: 'button',
                  onclick: () => openSnapshot(snapshot)
                },
                [
                  util.el('span', {
                    class: 'wa-snapshot-item__date',
                    text: util.formatDate(snapshot.time, {withTime: true})
                  }),
                  snapshot.status && snapshot.status !== '200'
                    ? ui.chip(`HTTP ${snapshot.status}`, 'warn')
                    : null,
                  icons.openExternal(15)
                ]
              )
            ])
          )
        );
      };

      const yearBar = util.el('div', {class: 'wa-snapshot-years', role: 'group', 'aria-label': getText('snapshotPicker_year')});
      const yearButtons = new Map();
      for (const year of years) {
        const button = util.el('button', {
          class: 'wa-snapshot-year',
          type: 'button',
          'aria-pressed': year === activeYear ? 'true' : 'false',
          text: `${year} (${byYear.get(year).length})`,
          onclick: () => {
            activeYear = year;
            for (const [candidate, node] of yearButtons) {
              node.setAttribute('aria-pressed', candidate === year ? 'true' : 'false');
            }
            renderList();
          }
        });
        yearButtons.set(year, button);
        yearBar.appendChild(button);
      }

      const newest = list[0];
      const oldest = list[list.length - 1];

      util.render(content, [
        truncated
          ? util.el('div', {class: 'wa-banner wa-banner--info'}, [
              icons.info(16),
              util.el('span', {text: getText('snapshotPicker_truncated', [list.length])})
            ])
          : null,
        util.el('div', {style: {display: 'flex', gap: '6px', 'flex-wrap': 'wrap'}}, [
          ui.button(getText('snapshotPicker_last'), {
            variant: 'primary',
            small: true,
            onClick: () => openSnapshot(newest)
          }),
          ui.button(getText('snapshotPicker_first'), {
            small: true,
            onClick: () => openSnapshot(oldest)
          })
        ]),
        yearBar,
        listNode
      ]);

      renderList();
    }

    return {open};
  })();

  /* =======================================================================
   * SECTION 18 — Settings
   * -----------------------------------------------------------------------
   * In-page configuration panel exposing all core options, layout controls,
   * search engines, and behavior preferences.
   *
   * Additions: drag-and-drop *and* keyboard reordering, custom engines, site
   * rules, URL-normalisation controls, availability-probe policy, recorded
   * keyboard shortcuts, and import/export/reset.
   *
   * Every control writes through `store.set`, which re-validates the whole
   * settings object; the UI therefore cannot put the store into an invalid
   * state, and a rejected value is visibly reverted rather than silently kept.
   * ==================================================================== */

  const settingsUi = (() => {
    let dialog = null;
    let activeTab = 'engines';
    let unsubscribe = null;

    const TABS = [
      ['engines', 'settings_tab_engines'],
      ['behaviour', 'settings_tab_behaviour'],
      ['lookup', 'settings_tab_lookup'],
      ['shortcuts', 'settings_tab_shortcuts'],
      ['data', 'settings_tab_data']
    ];

    /* -------------------------------------------------------------- helpers */

    const s = () => store.all();

    function update(patch) {
      const changed = store.set(patch);
      if (store.isReadOnly()) {
        ui.notify({message: getText('notice_storageReadonly'), kind: 'warn', timeout: 8000});
      }
      return changed;
    }

    function refresh() {
      if (!dialog?.isOpen) return;
      renderBody();
    }

    /* ================================================================ ENGINES */

    function renderEnginesTab(container) {
      const settings = s();

      container.appendChild(
        ui.section(getText('optionSectionTitle_engines'), getText('optionSectionDescription_engines'), [
          renderEngineList(settings)
        ])
      );

      container.appendChild(
        ui.section(getText('settings_customEngines'), getText('settings_customEnginesDesc'), [
          renderCustomEngines(settings)
        ])
      );

      container.appendChild(
        ui.section(getText('optionTitle_archiveOrgHost'), '', [
          ui.select(
            Object.keys(data.archiveOrgHosts).map(key => ({
              value: key,
              label: getText(`optionValue_archiveOrgHost_${key}`)
            })),
            settings.archiveOrgHost,
            value => {
              update({archiveOrgHost: value});
              probes.clear();
            },
            {ariaLabel: getText('optionTitle_archiveOrgHost')}
          )
        ])
      );

      container.appendChild(
        ui.section(getText('optionTitle_archiveIsHost'), '', [
          ui.select(
            Object.keys(data.archiveIsHosts).map(key => ({
              value: key,
              label: getText(`optionValue_archiveIsHost_${key}`)
            })),
            settings.archiveIsHost,
            value => {
              update({archiveIsHost: value});
              probes.clear();
            },
            {ariaLabel: getText('optionTitle_archiveIsHost')}
          )
        ])
      );
    }

    function renderEngineList(settings) {
      const engines = registry.allEngines(settings);
      const list = util.el('ul', {class: 'wa-engine-list', role: 'list'});

      let dragId = null;

      const move = (id, delta) => {
        const order = settings.engines.slice();
        const from = order.indexOf(id);
        if (from < 0) return;
        const to = util.clamp(from + delta, 0, order.length - 1);
        if (to === from) return;
        order.splice(to, 0, ...order.splice(from, 1));
        update({engines: order});
        refresh();
      };

      const reorder = (sourceId, targetId) => {
        if (sourceId === targetId) return;
        const order = settings.engines.slice();
        const from = order.indexOf(sourceId);
        const to = order.indexOf(targetId);
        if (from < 0 || to < 0) return;
        order.splice(to, 0, ...order.splice(from, 1));
        update({engines: order});
        refresh();
      };

      engines.forEach((engine, index) => {
        const enabled = registry.isEnabled(settings, engine.id);

        const row = util.el('li', {
          class: 'wa-engine-row',
          draggable: 'true',
          dataset: {engine: engine.id},
          ondragstart: ev => {
            dragId = engine.id;
            row.classList.add('is-dragging');
            try {
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('text/plain', engine.id);
            } catch {
              /* some engines disallow setData outside a real drag */
            }
          },
          ondragend: () => {
            dragId = null;
            row.classList.remove('is-dragging');
            list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
          },
          ondragover: ev => {
            if (!dragId || dragId === engine.id) return;
            ev.preventDefault();
            row.classList.add('is-drop-target');
          },
          ondragleave: () => row.classList.remove('is-drop-target'),
          ondrop: ev => {
            ev.preventDefault();
            row.classList.remove('is-drop-target');
            const sourceId = dragId || (() => {
              try {
                return ev.dataTransfer.getData('text/plain');
              } catch {
                return '';
              }
            })();
            if (sourceId) reorder(sourceId, engine.id);
          }
        });

        row.appendChild(
          util.el(
            'span',
            {
              class: 'wa-engine-row__grip',
              'aria-hidden': 'true',
              title: getText('settings_engineDragHint')
            },
            [icons.grip(16)]
          )
        );

        const checkbox = util.el('input', {
          type: 'checkbox',
          checked: enabled,
          'aria-label': `${engine.optionTitle} — ${getText('settings_engineEnabled')}`,
          onchange: ev => {
            const disabled = new Set(settings.disabledEngines);
            if (ev.target.checked) disabled.delete(engine.id);
            else disabled.add(engine.id);
            update({disabledEngines: [...disabled]});
            refresh();
          }
        });
        row.appendChild(
          util.el('label', {class: 'wa-switch', style: {gap: '0'}}, [
            checkbox,
            util.el('span', {class: 'wa-switch__track', 'aria-hidden': 'true'})
          ])
        );

        if (settings.showEngineIcons) {
          row.appendChild(util.el('span', {class: 'wa-item__icon'}, [registry.engineIcon(engine, {size: 20})]));
        }

        row.appendChild(util.el('span', {class: 'wa-engine-row__name', text: engine.optionTitle}));

        if (engine.custom) row.appendChild(ui.chip('custom'));
        if (!engine.probe) row.appendChild(ui.chip(getText('availability_unsupported')));

        row.appendChild(
          util.el('span', {class: 'wa-engine-row__actions'}, [
            ui.button('', {
              variant: 'ghost',
              small: true,
              icon: icons.arrowUp(14),
              title: getText('settings_engineMoveUp'),
              disabled: index === 0,
              onClick: () => move(engine.id, -1)
            }),
            ui.button('', {
              variant: 'ghost',
              small: true,
              icon: icons.arrowDown(14),
              title: getText('settings_engineMoveDown'),
              disabled: index === engines.length - 1,
              onClick: () => move(engine.id, 1)
            })
          ])
        );

        list.appendChild(row);
      });

      return list;
    }

    function renderCustomEngines(settings) {
      const wrapper = util.el('div');

      for (const engine of settings.customEngines) {
        wrapper.appendChild(
          util.el('div', {class: 'wa-custom-row'}, [
            util.el('span', {class: 'wa-custom-row__text'}, [
              util.el('span', {class: 'wa-custom-row__name', text: engine.name}),
              util.el('span', {class: 'wa-custom-row__template', text: engine.template})
            ]),
            ui.button('', {
              variant: 'ghost',
              small: true,
              icon: icons.edit(14),
              title: getText('settings_customEngineEdit'),
              onClick: () => openCustomEngineEditor(engine)
            }),
            ui.button('', {
              variant: 'ghost',
              small: true,
              icon: icons.trash(14),
              title: getText('settings_customEngineDelete'),
              onClick: async () => {
                const confirmed = await ui.confirm({
                  title: getText('settings_customEngineDelete'),
                  message: engine.name,
                  confirmLabel: getText('settings_customEngineDelete'),
                  danger: true
                });
                if (!confirmed) return;
                update({
                  customEngines: settings.customEngines.filter(item => item.id !== engine.id),
                  engines: settings.engines.filter(id => id !== engine.id)
                });
                refresh();
              }
            })
          ])
        );
      }

      wrapper.appendChild(
        ui.button(getText('settings_customEngineAdd'), {
          small: true,
          icon: icons.plus(14),
          onClick: () => openCustomEngineEditor(null)
        })
      );

      return wrapper;
    }

    function openCustomEngineEditor(existing) {
      const editor = new ui.Dialog({
        title: existing ? getText('settings_customEngineEdit') : getText('settings_customEngineAdd')
      });
      editor.addCloseButton();

      let name = existing?.name || '';
      let template = existing?.template || 'https://example.com/lookup?q={url}';

      const errorNode = util.el('div', {class: 'wa-field__error', role: 'alert'});
      const previewNode = util.el('pre', {class: 'wa-code'});

      const updatePreview = () => {
        const sample = 'https://en.wikipedia.org/wiki/Web_archiving?utm_source=x#history';
        if (!store.isValidEngineTemplate(template)) {
          previewNode.textContent = '—';
          return;
        }
        const built = urls.buildCustomTarget({template}, sample);
        previewNode.textContent = built.ok ? built.target : '—';
      };

      const nameInput = ui.input({
        value: name,
        placeholder: getText('settings_customEngineName'),
        onInput: value => {
          name = value;
        }
      });
      const templateInput = ui.input({
        value: template,
        placeholder: 'https://example.com/lookup?q={url}',
        onInput: value => {
          template = value;
          updatePreview();
        }
      });

      editor.body.appendChild(ui.field(getText('settings_customEngineName'), nameInput));
      editor.body.appendChild(
        ui.field(getText('settings_customEngineTemplate'), templateInput, {
          hint: getText('settings_customEnginesDesc')
        })
      );
      editor.body.appendChild(ui.field(getText('settings_customEnginePreview'), previewNode));
      editor.body.appendChild(errorNode);
      updatePreview();

      editor.footer.appendChild(util.el('div', {class: 'wa-spacer'}));
      editor.footer.appendChild(
        ui.button(getText('button_cancel'), {onClick: () => editor.close()})
      );
      editor.footer.appendChild(
        ui.button(getText('settings_customEngineSave'), {
          variant: 'primary',
          onClick: () => {
            const settings = s();
            const trimmedName = name.trim();

            if (!trimmedName) {
              errorNode.textContent = getText('settings_customEngineInvalidName');
              return;
            }
            if (!store.isValidEngineTemplate(template.trim())) {
              errorNode.textContent = getText('settings_customEngineInvalidTemplate');
              return;
            }
            const duplicate = settings.customEngines.some(
              item => item.id !== existing?.id && item.name.toLowerCase() === trimmedName.toLowerCase()
            );
            if (duplicate) {
              errorNode.textContent = getText('settings_customEngineDuplicate');
              return;
            }

            const id = existing?.id || `custom:${util.hashString(trimmedName + Date.now())}`;
            const entry = {id, name: trimmedName, template: template.trim(), accent: existing?.accent || '#5a6270'};

            const list = existing
              ? settings.customEngines.map(item => (item.id === existing.id ? entry : item))
              : [...settings.customEngines, entry];

            update({customEngines: list});
            editor.close();
            refresh();
          }
        })
      );

      editor.open();
    }

    /* ============================================================== BEHAVIOUR */

    function renderBehaviourTab(container) {
      const settings = s();

      /* -- launcher / "toolbar" ----------------------------------------- */
      container.appendChild(
        ui.section(getText('optionSectionTitleApp_toolbar'), '', [
          ui.field(
            getText('optionTitle_searchAllEngines'),
            ui.select(
              [
                {value: 'main', label: getText('optionValue_searchAllEnginesActionApp_main')},
                {value: 'sub', label: getText('optionValue_searchAllEnginesActionApp_sub')},
                {value: 'false', label: getText('optionValue_searchAllEnginesActionApp_false')}
              ],
              settings.searchAllEnginesAction,
              value => update({searchAllEnginesAction: value})
            )
          ),
          ui.field(
            getText('optionTitle_searchMode'),
            ui.select(
              [
                {value: 'tab', label: getText('optionValue_searchModeAction_tab')},
                {value: 'url', label: getText('optionValue_searchModeAction_url')}
              ],
              settings.searchModeAction,
              value => update({searchModeAction: value})
            )
          ),
          ui.field(
            getText('buttonTooltip_menu'),
            util.el('div', {style: {display: 'flex', 'flex-direction': 'column', gap: '2px'}}, [
              ui.toggle(getText('actionMenu_openCurrentDoc'), settings.pinActionToolbarOpenCurrentDoc, value =>
                update({pinActionToolbarOpenCurrentDoc: value})
              ),
              ui.toggle(getText('actionMenu_options'), settings.pinActionToolbarOptions, value =>
                update({pinActionToolbarOptions: value})
              ),
              ui.toggle(getText('actionMenu_contribute'), settings.pinActionToolbarContribute, value =>
                update({pinActionToolbarContribute: value})
              )
            ]),
            {hint: getText('buttonTooltip_pin')}
          ),
          ui.toggle(
            getText('settings_showLauncherButton'),
            settings.showLauncherButton,
            value => {
              update({showLauncherButton: value});
              fab.sync();
            }
          ),
          settings.showLauncherButton
            ? ui.field(
                getText('settings_launcherButtonPosition'),
                ui.select(
                  [
                    {value: 'bottomRight', label: getText('settings_position_bottomRight')},
                    {value: 'bottomLeft', label: getText('settings_position_bottomLeft')},
                    {value: 'topRight', label: getText('settings_position_topRight')},
                    {value: 'topLeft', label: getText('settings_position_topLeft')}
                  ],
                  settings.launcherButtonPosition,
                  value => {
                    update({launcherButtonPosition: value});
                    fab.sync();
                  }
                )
              )
            : null
        ])
      );

      /* -- in-page context menu ------------------------------------------ */
      container.appendChild(
        ui.section(getText('settings_section_contextMenu'), getText('settings_contextTriggerDesc'), [
          ui.field(
            getText('settings_contextTrigger'),
            ui.select(
              [
                {value: 'shift', label: getText('settings_contextTrigger_shift')},
                {
                  value: 'mod',
                  label: getText('settings_contextTrigger_ctrl', [
                    env.primaryModifier === 'meta' ? '⌘' : 'Ctrl'
                  ])
                },
                {value: 'plain', label: getText('settings_contextTrigger_plain')},
                {value: 'off', label: getText('settings_contextTrigger_off')}
              ],
              settings.contextTrigger,
              value => update({contextTrigger: value})
            )
          ),
          ui.field(
            getText('optionTitle_showInContextMenu'),
            ui.select(
              [
                {value: 'all', label: getText('optionValue_showInContextMenu_all')},
                {value: 'link', label: getText('optionValue_showInContextMenu_link')},
                {value: 'false', label: getText('optionValue_showInContextMenu_false')}
              ],
              settings.showInContextMenu,
              value => update({showInContextMenu: value})
            )
          ),
          ui.field(
            getText('optionTitle_searchAllEngines'),
            ui.select(
              [
                {value: 'main', label: getText('optionValue_searchAllEnginesContextMenu_main')},
                {value: 'sub', label: getText('optionValue_searchAllEnginesContextMenu_sub')},
                {value: 'false', label: getText('optionValue_searchAllEnginesContextMenu_false')}
              ],
              settings.searchAllEnginesContextMenu,
              value => update({searchAllEnginesContextMenu: value})
            )
          ),
          ui.toggle(getText('optionTitle_openCurrentDocContextMenu'), settings.openCurrentDocContextMenu, value =>
            update({openCurrentDocContextMenu: value})
          )
        ])
      );

      /* -- broken pages --------------------------------------------------- */
      container.appendChild(
        ui.section(getText('settings_section_errorPages'), getText('settings_errorOfferDesc'), [
          ui.toggle(getText('settings_errorOffer'), settings.errorOffer, value => {
            update({errorOffer: value, showPageAction: value});
            refresh();
          }),
          settings.errorOffer
            ? ui.field(
                getText('settings_errorOfferEngine'),
                ui.select(
                  registry.enabledEngines(settings).map(engine => ({value: engine.id, label: engine.name})),
                  settings.errorOfferEngine,
                  value => update({errorOfferEngine: value})
                )
              )
            : null,
          settings.errorOffer
            ? ui.toggle(getText('settings_errorOfferAuto'), settings.errorOfferAuto, value =>
                update({errorOfferAuto: value}),
              {hint: getText('settings_errorOfferAutoDesc')})
            : null,
          settings.errorOfferBlockedHosts.length
            ? util.el('div', {class: 'wa-field__hint'}, [
                `${settings.errorOfferBlockedHosts.length} site(s) excluded · `,
                util.el('button', {
                  class: 'wa-btn wa-btn--ghost wa-btn--sm',
                  type: 'button',
                  text: getText('settings_historyClear'),
                  onclick: () => {
                    update({errorOfferBlockedHosts: []});
                    refresh();
                  }
                })
              ])
            : null
        ])
      );

      /* -- appearance and misc ------------------------------------------- */
      container.appendChild(
        ui.section(getText('optionSectionTitle_misc'), '', [
          ui.field(
            getText('optionTitle_appTheme'),
            ui.select(
              [
                {value: 'auto', label: getText('optionValue_appTheme_auto')},
                {value: 'light', label: getText('optionValue_appTheme_light')},
                {value: 'dark', label: getText('optionValue_appTheme_dark')}
              ],
              settings.appTheme,
              value => {
                update({appTheme: value});
                ui.applyTheme(s());
              }
            )
          ),
          ui.toggle(getText('optionTitle_tabInBackgound'), settings.tabInBackgound, value =>
            update({tabInBackgound: value})
          ),
          ui.toggle(getText('optionTitle_showEngineIcons'), settings.showEngineIcons, value => {
            update({showEngineIcons: value});
            refresh();
          }),
          ui.toggle(getText('settings_reduceMotion'), settings.reduceMotion, value => {
            update({reduceMotion: value});
            ui.applyTheme(s());
          }),
          ui.field(
            getText('settings_notifications'),
            ui.select(
              [
                {value: 'toast', label: getText('settings_notifications_toast')},
                {
                  value: 'native',
                  label: getText('settings_notifications_native'),
                  disabled: !env.capabilities.notifications
                },
                {value: 'off', label: getText('settings_notifications_off')}
              ],
              settings.notificationMode,
              value => update({notificationMode: value})
            ),
            {hint: env.capabilities.notifications ? '' : 'This manager did not grant native notifications.'}
          ),
          ui.toggle(getText('optionTitle_showContribPage'), settings.showContribPage, value =>
            update({showContribPage: value})
          )
        ])
      );
    }

    /* ================================================================= LOOKUP */

    function renderLookupTab(container) {
      const settings = s();

      const sampleUrl = location.href;
      const preview = util.el('pre', {class: 'wa-code'});
      const updatePreview = () => {
        const resolved = urls.resolveLookupUrl(sampleUrl, s(), {doc: document});
        preview.textContent = resolved.valid ? resolved.url : sampleUrl;
      };

      const bind = (key, label, hint) =>
        ui.toggle(label, settings[key], value => {
          update({[key]: value});
          updatePreview();
          probes.clear();
        }, hint ? {hint} : {});

      container.appendChild(
        ui.section(getText('settings_section_target'), '', [
          bind('stripFragment', getText('settings_stripFragment')),
          bind('stripQuery', getText('settings_stripQuery')),
          bind('stripTrackingParams', getText('settings_stripTrackingParams')),
          bind('preferCanonical', getText('settings_preferCanonical')),
          ui.field(getText('settings_urlPreview'), preview)
        ])
      );
      updatePreview();

      container.appendChild(
        ui.section(getText('settings_section_availability'), getText('availability_privacyNote'), [
          ui.field(
            getText('settings_probeMode'),
            ui.select(
              [
                {value: 'open', label: getText('settings_probeMode_open')},
                {value: 'manual', label: getText('settings_probeMode_manual')},
                {value: 'off', label: getText('settings_probeMode_off')}
              ],
              settings.probeMode,
              value => {
                update({probeMode: value});
                refresh();
              }
            )
          ),
          settings.probeMode !== 'off'
            ? ui.field(
                getText('settings_probeTtl'),
                ui.select(
                  [15, 60, 240, 1440].map(minutes => ({
                    value: String(minutes),
                    label:
                      minutes < 60
                        ? getText('label_minutes', [minutes])
                        : getText('label_hours', [Math.round(minutes / 60)])
                  })),
                  String(settings.probeTtlMinutes),
                  value => {
                    update({probeTtlMinutes: Number(value)});
                    probes.configure(s());
                  }
                )
              )
            : null,
          settings.probeMode !== 'off'
            ? ui.field(
                getText('settings_probeConcurrency'),
                ui.select(
                  [1, 2, 3, 4, 6, 8].map(n => ({value: String(n), label: String(n)})),
                  String(settings.probeConcurrency),
                  value => {
                    update({probeConcurrency: Number(value)});
                    probes.configure(s());
                  }
                )
              )
            : null,
          !env.capabilities.crossOriginRequests
            ? util.el('div', {class: 'wa-banner wa-banner--warn'}, [
                icons.warning(16),
                util.el('span', {
                  text: 'This manager did not grant cross-origin requests, so availability cannot be checked.'
                })
              ])
            : null
        ])
      );

      container.appendChild(
        ui.section(getText('settings_section_rules'), getText('settings_rulesDesc'), [renderRules(settings)])
      );

      container.appendChild(
        ui.section(getText('settings_section_history'), getText('settings_historyEnabledDesc'), [
          ui.toggle(getText('settings_historyEnabled'), settings.historyEnabled, value => {
            update({historyEnabled: value});
            refresh();
          }),
          settings.historyEnabled
            ? ui.field(
                getText('settings_historyLimit'),
                ui.select(
                  [25, 50, 100, 250, 500].map(n => ({
                    value: String(n),
                    label: getText('label_entries', [n])
                  })),
                  String(settings.historyLimit),
                  value => update({historyLimit: Number(value)})
                )
              )
            : null,
          ui.button(getText('settings_historyClear'), {
            variant: 'danger',
            small: true,
            onClick: async () => {
              await store.clearHistory();
              ui.notify({message: getText('settings_historyCleared'), kind: 'success'});
            }
          })
        ])
      );
    }

    function renderRules(settings) {
      const wrapper = util.el('div');

      if (!settings.rules.length) {
        wrapper.appendChild(util.el('div', {class: 'wa-field__hint', text: getText('settings_ruleNone')}));
      }

      for (const rule of settings.rules) {
        const engine = registry.getEngine(settings, rule.engine);
        wrapper.appendChild(
          util.el('div', {class: 'wa-rule-row'}, [
            util.el('span', {class: 'wa-rule-row__text'}, [
              util.el('span', {class: 'wa-rule-row__pattern', text: rule.pattern}),
              util.el('span', {
                class: 'wa-rule-row__meta',
                text: [engine ? engine.name : getText('label_unknown'), rule.autoOnError ? 'auto-on-error' : '']
                  .filter(Boolean)
                  .join(' · ')
              })
            ]),
            ui.button('', {
              variant: 'ghost',
              small: true,
              icon: icons.edit(14),
              title: getText('settings_customEngineEdit'),
              onClick: () => openRuleEditor(rule)
            }),
            ui.button('', {
              variant: 'ghost',
              small: true,
              icon: icons.trash(14),
              title: getText('settings_ruleDelete'),
              onClick: () => {
                update({rules: settings.rules.filter(item => item.id !== rule.id)});
                refresh();
              }
            })
          ])
        );
      }

      wrapper.appendChild(
        ui.button(getText('settings_ruleAdd'), {
          small: true,
          icon: icons.plus(14),
          onClick: () => openRuleEditor(null)
        })
      );

      return wrapper;
    }

    function openRuleEditor(existing) {
      const settings = s();
      const editor = new ui.Dialog({title: getText('settings_ruleAdd')});
      editor.addCloseButton();

      let pattern = existing?.pattern || '';
      let engineId = existing?.engine || registry.enabledEngines(settings)[0]?.id || '';
      let autoOnError = existing?.autoOnError || false;

      const errorNode = util.el('div', {class: 'wa-field__error', role: 'alert'});

      editor.body.appendChild(
        ui.field(
          getText('settings_rulePattern'),
          ui.input({
            value: pattern,
            placeholder: 'example.com',
            onInput: value => {
              pattern = value;
            }
          }),
          {hint: getText('settings_rulePatternHint')}
        )
      );
      editor.body.appendChild(
        ui.field(
          getText('settings_ruleEngine'),
          ui.select(
            registry.allEngines(settings).map(engine => ({value: engine.id, label: engine.name})),
            engineId,
            value => {
              engineId = value;
            }
          )
        )
      );
      editor.body.appendChild(
        ui.toggle(getText('settings_ruleAuto'), autoOnError, value => {
          autoOnError = value;
        })
      );
      editor.body.appendChild(errorNode);

      editor.footer.appendChild(util.el('div', {class: 'wa-spacer'}));
      editor.footer.appendChild(ui.button(getText('button_cancel'), {onClick: () => editor.close()}));
      editor.footer.appendChild(
        ui.button(getText('settings_customEngineSave'), {
          variant: 'primary',
          onClick: () => {
            const trimmed = pattern.trim();
            if (!trimmed || !urls.compilePattern(trimmed)) {
              errorNode.textContent = getText('settings_ruleInvalid');
              return;
            }
            const entry = {
              id: existing?.id || util.uuid(),
              pattern: trimmed,
              engine: engineId,
              autoOnError
            };
            const list = existing
              ? settings.rules.map(item => (item.id === existing.id ? entry : item))
              : [...settings.rules, entry];
            update({rules: list});
            editor.close();
            refresh();
          }
        })
      );

      editor.open();
    }

    /* ============================================================== SHORTCUTS */

    const SHORTCUT_FIELDS = [
      ['shortcutLauncher', 'settings_shortcutLauncher'],
      ['shortcutQuick', 'settings_shortcutQuick'],
      ['shortcutCurrentDoc', 'settings_shortcutCurrentDoc']
    ];

    function renderShortcutsTab(container) {
      const settings = s();

      container.appendChild(
        ui.section(getText('settings_section_shortcuts'), getText('settings_shortcutsInPage'), [
          ...SHORTCUT_FIELDS.map(([key, labelKey]) => renderShortcutRecorder(key, getText(labelKey), settings))
        ])
      );
    }

    function renderShortcutRecorder(key, label, settings) {
      const errorNode = util.el('div', {class: 'wa-field__error', role: 'alert'});

      const valueNode = util.el('div', {
        class: 'wa-kbd-record__value',
        tabindex: '0',
        role: 'button',
        'aria-label': `${label} — ${getText('settings_shortcutRecord')}`,
        text: settings[key]
          ? util.formatAccelerator(settings[key], {primary: env.primaryModifier})
          : getText('label_never')
      });

      let recording = false;

      const stopRecording = () => {
        recording = false;
        valueNode.classList.remove('is-recording');
      };

      const startRecording = () => {
        recording = true;
        errorNode.textContent = '';
        valueNode.classList.add('is-recording');
        valueNode.textContent = getText('settings_shortcutRecord');
        valueNode.focus();
      };

      valueNode.addEventListener('click', startRecording);
      valueNode.addEventListener('blur', () => {
        if (!recording) return;
        stopRecording();
        const current = s()[key];
        valueNode.textContent = current
          ? util.formatAccelerator(current, {primary: env.primaryModifier})
          : getText('label_never');
      });

      valueNode.addEventListener('keydown', ev => {
        if (!recording) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            startRecording();
          }
          return;
        }

        ev.preventDefault();
        ev.stopPropagation();

        if (ev.key === 'Escape') {
          stopRecording();
          const current = s()[key];
          valueNode.textContent = current
            ? util.formatAccelerator(current, {primary: env.primaryModifier})
            : getText('label_never');
          return;
        }

        const accel = util.acceleratorFromEvent(ev);
        if (!accel) return;

        const parsed = util.parseAccelerator(accel);
        if (!parsed.ctrl && !parsed.alt && !parsed.meta) {
          errorNode.textContent = getText('settings_shortcutInvalid');
          return;
        }

        const conflictKey = SHORTCUT_FIELDS.map(([k]) => k).find(k => k !== key && s()[k] === accel);
        if (conflictKey) {
          const conflictLabel = getText(SHORTCUT_FIELDS.find(([k]) => k === conflictKey)[1]);
          errorNode.textContent = getText('settings_shortcutConflict', [conflictLabel]);
          return;
        }

        stopRecording();
        update({[key]: accel});
        hotkeys.sync();
        valueNode.textContent = util.formatAccelerator(accel, {primary: env.primaryModifier});
      });

      const row = util.el('div', {class: 'wa-kbd-record'}, [
        valueNode,
        ui.button(getText('settings_shortcutClear'), {
          small: true,
          onClick: () => {
            update({[key]: ''});
            hotkeys.sync();
            valueNode.textContent = getText('label_never');
            errorNode.textContent = '';
          }
        })
      ]);

      return util.el('div', {class: 'wa-field'}, [
        util.el('span', {class: 'wa-field__label', text: label}),
        row,
        errorNode
      ]);
    }

    /* =================================================================== DATA */

    function renderDataTab(container) {
      const settings = s();

      if (store.isReadOnly()) {
        container.appendChild(
          util.el('div', {class: 'wa-banner wa-banner--warn'}, [
            icons.warning(16),
            util.el('span', {text: getText('settings_storageUnavailable')})
          ])
        );
      }

      const exportArea = util.el('textarea', {
        class: 'wa-textarea',
        readonly: 'true',
        'aria-label': getText('settings_export'),
        spellcheck: 'false'
      });
      exportArea.value = JSON.stringify(store.exportSettings(), null, 2);

      container.appendChild(
        ui.section(getText('settings_section_data'), '', [
          ui.field(getText('settings_export'), exportArea),
          util.el('div', {style: {display: 'flex', gap: '6px', 'flex-wrap': 'wrap'}}, [
            ui.button(getText('settings_export'), {
              small: true,
              icon: icons.copy(14),
              onClick: async () => {
                const ok = await env.writeClipboard(exportArea.value);
                ui.notify({
                  message: getText(ok ? 'notice_copied' : 'notice_copyFailed'),
                  kind: ok ? 'success' : 'error'
                });
              }
            })
          ])
        ])
      );

      const importArea = util.el('textarea', {
        class: 'wa-textarea',
        placeholder: getText('settings_importPlaceholder'),
        'aria-label': getText('settings_import'),
        spellcheck: 'false'
      });

      container.appendChild(
        ui.section(getText('settings_import'), '', [
          importArea,
          util.el('div', {style: {display: 'flex', gap: '6px', 'margin-top': '8px'}}, [
            ui.button(getText('settings_importApply'), {
              variant: 'primary',
              small: true,
              onClick: () => {
                const result = store.importSettings(importArea.value);
                if (!result.ok) {
                  ui.notify({message: getText('settings_importFailed'), kind: 'error'});
                  return;
                }
                ui.notify({message: getText('settings_imported'), kind: 'success'});
                ui.applyTheme(s());
                hotkeys.sync();
                fab.sync();
                probes.clear();
                refresh();
              }
            })
          ])
        ])
      );

      const footprint = util.el('div', {class: 'wa-field__hint', text: '…'});
      store.storageFootprint().then(bytes => {
        footprint.textContent = Number.isFinite(bytes)
          ? `${util.formatBytes(bytes)} stored`
          : getText('label_unknown');
      });

      container.appendChild(
        ui.section('', '', [
          footprint,
          util.el('div', {style: {display: 'flex', gap: '6px', 'margin-top': '8px', 'flex-wrap': 'wrap'}}, [
            ui.button(getText('action_diagnostics'), {
              small: true,
              icon: icons.diagnostics(14),
              onClick: () => diagnostics.open()
            }),
            ui.button(getText('action_support'), {
              small: true,
              icon: icons.openExternal(14),
              onClick: () => env.openTab(data.supportUrl, {active: true})
            }),
            ui.button(getText('settings_reset'), {
              variant: 'danger',
              small: true,
              icon: icons.trash(14),
              onClick: async () => {
                const confirmed = await ui.confirm({
                  title: getText('settings_reset'),
                  message: getText('settings_resetConfirm'),
                  confirmLabel: getText('settings_reset'),
                  danger: true
                });
                if (!confirmed) return;
                store.reset();
                ui.applyTheme(s());
                hotkeys.sync();
                fab.sync();
                probes.clear();
                ui.notify({message: getText('settings_resetDone'), kind: 'success'});
                refresh();
              }
            })
          ])
        ])
      );

      container.appendChild(
        ui.section('', '', [
          ui.toggle('Verbose logging', settings.debug, value => {
            update({debug: value});
            env.log.setDebug(value);
          }, {hint: 'Writes detailed diagnostics to the browser console.'})
        ])
      );
    }

    /* ---------------------------------------------------------------- shell */

    const RENDERERS = {
      engines: renderEnginesTab,
      behaviour: renderBehaviourTab,
      lookup: renderLookupTab,
      shortcuts: renderShortcutsTab,
      data: renderDataTab
    };

    let bodyNode = null;
    let tabBar = null;

    function renderBody() {
      if (!bodyNode) return;
      util.clear(bodyNode);
      const renderer = RENDERERS[activeTab] || RENDERERS.engines;
      renderer(bodyNode);

      if (tabBar) {
        tabBar.querySelectorAll('.wa-tab').forEach(node => {
          node.setAttribute('aria-selected', node.dataset.tab === activeTab ? 'true' : 'false');
        });
      }
    }

    function open(tab) {
      if (dialog?.isOpen) {
        if (tab) {
          activeTab = tab;
          renderBody();
        }
        return dialog;
      }

      if (tab) activeTab = tab;

      dialog = new ui.Dialog({
        title: getText('settings_title'),
        wide: true,
        onClose: () => {
          unsubscribe?.();
          unsubscribe = null;
          dialog = null;
          bodyNode = null;
          tabBar = null;
        }
      });
      dialog.addCloseButton(getText('settings_close'));

      tabBar = util.el('div', {class: 'wa-tabs', role: 'tablist'});
      for (const [id, labelKey] of TABS) {
        tabBar.appendChild(
          util.el('button', {
            class: 'wa-tab',
            type: 'button',
            role: 'tab',
            dataset: {tab: id},
            'aria-selected': id === activeTab ? 'true' : 'false',
            text: getText(labelKey),
            onclick: () => {
              activeTab = id;
              renderBody();
            }
          })
        );
      }
      dialog.inner.insertBefore(tabBar, dialog.body);

      bodyNode = dialog.body;
      bodyNode.setAttribute('role', 'tabpanel');
      dialog.footer.remove();

      // Another tab changing settings must be reflected here immediately.
      unsubscribe = store.subscribe((_, detail) => {
        if (detail?.type === 'remote') renderBody();
      });

      dialog.open();
      renderBody();
      return dialog;
    }

    return {open, refresh};
  })();

  /* =======================================================================
   * SECTION 19 — Context targets and the in-page right-click menu
   * -----------------------------------------------------------------------
   * A userscript cannot add entries to the browser's own context menu. What it
   * *can* do is observe the right-click, remember exactly what was under the
   * pointer, and offer the same commands.
   *
   * Two independent pieces:
   *
   *  1. `contextTargets` — a passive, capture-phase listener that records the
   *     target descriptor on every `contextmenu` event using standard target
   *     precedence (`linkUrl` → media → `selectionText`-as-URL → `frameUrl` → `pageUrl`).
   *     It never calls `preventDefault`, never mutates the event, and costs a
   *     handful of property reads. The launcher and the manager's own menu
   *     commands then act on the remembered target — so even with the in-page
   *     menu switched off, "right-click, then open the launcher" targets the
   *     link you clicked.
   *
   *  2. `contextMenu` — an optional in-page menu. It is *off the plain
   *     right-click by default* (Shift + right-click), because silently
   *     replacing a site's own context menu is hostile. The `plain` setting
   *     exists for users who want it; every other setting leaves the native
   *     menu completely untouched.
   * ==================================================================== */

  const contextTargets = (() => {
    let lastTarget = null;
    let lastTime = 0;
    const TARGET_TTL = 30000;

    /** Media elements carry their URL on `currentSrc`/`src`, not `href`. */
    function mediaUrl(element) {
      if (!element) return '';
      const tag = element.tagName;
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'SOURCE') {
        const raw = element.currentSrc || element.src || element.getAttribute('src') || '';
        try {
          return raw ? new URL(raw, document.baseURI).toString() : '';
        } catch {
          return '';
        }
      }
      return '';
    }

    function linkUrl(element) {
      const anchor = element?.closest?.('a[href], area[href]');
      if (!anchor) return '';
      // `href` on an <a> is already absolute; SVG anchors need resolving.
      const raw = anchor.href?.baseVal ?? anchor.href ?? anchor.getAttribute('href') ?? '';
      try {
        return raw ? new URL(String(raw), document.baseURI).toString() : '';
      } catch {
        return '';
      }
    }

    function selectionUrl() {
      let text = '';
      try {
        text = String(window.getSelection?.() || '').trim();
      } catch {
        return '';
      }
      if (!text || text.length > urls.MAX_URL_LENGTH) return '';

      if (urls.validateUrl(text)) return text;
      // A bare host or `www.` prefix is the common case for a copied URL.
      if (/^(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/i.test(text)) {
        const candidate = `https://${text}`;
        if (urls.validateUrl(candidate)) return candidate;
      }
      return '';
    }

    function describe(event) {
      const element = event?.target instanceof Element ? event.target : null;

      const link = linkUrl(element);
      if (link && urls.validateUrl(link)) {
        return {type: 'link', url: link, title: element?.textContent?.trim().slice(0, 200) || '', element};
      }

      const media = mediaUrl(element);
      if (media && urls.validateUrl(media)) {
        return {type: 'media', url: media, title: element?.getAttribute?.('alt') || '', element};
      }

      const selection = selectionUrl();
      if (selection) {
        return {type: 'selection', url: selection, title: '', element};
      }

      return {type: 'page', url: location.href, title: document.title || '', element};
    }

    function record(event) {
      try {
        lastTarget = describe(event);
        lastTime = Date.now();
      } catch (err) {
        env.log.debug('could not describe context target', err);
        lastTarget = null;
      }
    }

    /** The remembered target, or null once it has gone stale. */
    function current() {
      if (!lastTarget) return null;
      if (Date.now() - lastTime > TARGET_TTL) {
        lastTarget = null;
        return null;
      }
      return lastTarget;
    }

    function clear() {
      lastTarget = null;
    }

    function attach(disposables) {
      disposables.addListener(document, 'contextmenu', record, {capture: true, passive: true});
      // A long-press on touch devices raises `contextmenu` too, but only after
      // a selection change; refresh the selection-derived target on the way.
      disposables.addListener(
        document,
        'selectionchange',
        util.throttle(() => {
          if (lastTarget?.type === 'selection') {
            const selection = selectionUrl();
            if (selection) {
              lastTarget = {...lastTarget, url: selection};
              lastTime = Date.now();
            }
          }
        }, 250),
        {passive: true}
      );
    }

    return {attach, current, clear, describe, _selectionUrl: selectionUrl};
  })();

  /* ---------------------------------------------------------------------- */

  const contextMenu = (() => {
    let menuNode = null;
    let disposables = null;

    function shouldOpen(event, settings) {
      const trigger = settings.contextTrigger;
      if (trigger === 'off') return false;
      if (settings.showInContextMenu === 'false') return false;

      if (trigger === 'shift' && !event.shiftKey) return false;
      if (trigger === 'mod') {
        const wanted = env.primaryModifier === 'meta' ? event.metaKey : event.ctrlKey;
        if (!wanted) return false;
      }
      return true;
    }

    function close() {
      if (!menuNode) return;
      menuNode.remove();
      menuNode = null;
      disposables?.dispose();
      disposables = null;
    }

    function isOpen() {
      return !!menuNode;
    }

    function buildItems(target, settings) {
      const items = [];

      const extraction = currentDoc.resolve({
        linkUrl: target.type === 'link' ? target.url : ''
      });
      if (settings.openCurrentDocContextMenu && extraction) {
        items.push({
          label: getText('menuItemTitle_openCurrentDoc'),
          icon: icons.openExternal(18),
          run: () =>
            lookup.openOriginal({
              linkUrl: target.type === 'link' ? target.url : '',
              settings
            })
        });
      }

      const engines = registry.enabledEngines(settings);

      if (settings.searchAllEnginesContextMenu === 'main') {
        // The whole menu collapses to the single "all engines" item.
        items.push({
          label: getText('mainMenuItemTitle_allEngines'),
          icon: registry.allEnginesIcon({size: 20}),
          run: () => lookup.runAll({target, settings, origin: 'contextmenu'})
        });
        return items;
      }

      if (settings.searchAllEnginesContextMenu === 'sub') {
        items.push({
          label: getText('menuItemTitle_allEngines'),
          icon: registry.allEnginesIcon({size: 20}),
          run: () => lookup.runAll({target, settings, origin: 'contextmenu'})
        });
      }

      for (const engine of engines) {
        items.push({
          label: engine.menuTitle,
          icon: settings.showEngineIcons ? registry.engineIcon(engine, {size: 20}) : null,
          run: () => lookup.runSingle({engine, target, settings, origin: 'contextmenu'})
        });
      }

      items.push({
        label: getText('launcherTitle'),
        icon: icons.search(18),
        desc: getText('launcherHint_keys'),
        run: () => launcher.open({target})
      });

      return items;
    }

    function open(event, target, settings) {
      close();
      ui.mount(settings);
      const root = ui.getRoot();
      if (!root) return;

      disposables = new env.Disposables('ctxmenu');

      const items = buildItems(target, settings);
      if (!items.length) return;

      menuNode = util.el('div', {
        class: 'wa-ctxmenu',
        role: 'menu',
        'aria-label': env.APP_NAME,
        tabindex: '-1'
      });

      menuNode.appendChild(
        util.el('div', {
          class: 'wa-ctxmenu__title',
          text: `${env.APP_NAME} · ${urls.displayUrl(target.url, 34)}`
        })
      );

      const buttons = [];
      items.forEach(item => {
        const button = util.el(
          'button',
          {
            class: 'wa-item',
            type: 'button',
            role: 'menuitem',
            onclick: async () => {
              close();
              try {
                await item.run();
              } catch (err) {
                env.log.error('context menu action failed', err);
              }
            }
          },
          [
            util.el('span', {class: 'wa-item__icon'}, [item.icon]),
            util.el('span', {class: 'wa-item__text'}, [
              util.el('span', {class: 'wa-item__label', text: item.label})
            ])
          ]
        );
        buttons.push(button);
        menuNode.appendChild(button);
      });

      root.appendChild(menuNode);
      position(event);

      // Keyboard navigation, matching native menu semantics.
      let index = 0;
      const focusItem = next => {
        index = (next + buttons.length) % buttons.length;
        buttons[index].focus();
      };
      focusItem(0);

      disposables.addListener(menuNode, 'keydown', ev => {
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          focusItem(index + 1);
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          focusItem(index - 1);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          close();
        } else if (ev.key === 'Home') {
          ev.preventDefault();
          focusItem(0);
        } else if (ev.key === 'End') {
          ev.preventDefault();
          focusItem(buttons.length - 1);
        }
      });

      // Any interaction outside closes it, on the capture phase so the page
      // cannot swallow the event first.
      const dismiss = ev => {
        if (menuNode && ev.composedPath?.().includes(menuNode)) return;
        close();
      };
      disposables.addListener(document, 'pointerdown', dismiss, {capture: true});
      disposables.addListener(document, 'contextmenu', dismiss, {capture: true});
      disposables.addListener(window, 'blur', close);
      disposables.addListener(window, 'resize', close, {passive: true});
      disposables.addListener(window, 'scroll', close, {passive: true, capture: true});
    }

    /** Keeps the menu inside the viewport, flipping rather than clipping. */
    function position(event) {
      if (!menuNode) return;
      const margin = 8;
      const rect = menuNode.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;

      let left = event.clientX;
      let top = event.clientY;

      if (left + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin);
      if (top + rect.height + margin > vh) top = Math.max(margin, vh - rect.height - margin);

      menuNode.style.left = `${Math.max(margin, left)}px`;
      menuNode.style.top = `${Math.max(margin, top)}px`;
    }

    function attach(rootDisposables) {
      rootDisposables.addListener(
        document,
        'contextmenu',
        event => {
          const settings = store.all();
          if (!shouldOpen(event, settings)) return;

          const target = contextTargets.describe(event);

          // With `showInContextMenu: 'link'`, commands are offered only when
          // a link (or media) was the target.
          if (settings.showInContextMenu === 'link' && !['link', 'media'].includes(target.type)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          open(event, target, settings);
        },
        {capture: true}
      );
    }

    return {attach, open, close, isOpen, shouldOpen, buildItems};
  })();

  /* =======================================================================
   * SECTION 20 — Broken-page offer and the archive banner
   * -----------------------------------------------------------------------
   * In-page broken-page prompt and archive banner.
   *
   * `errorOffer` checks the *navigation timing* entry for its own document
   * to determine whether the server returned an error status code in `errorCodes` —
   * `PerformanceNavigationTiming.responseStatus`. Where that is unavailable
   * (Safari, older Firefox), a conservative content heuristic is used, and if
   * neither is conclusive nothing is shown: a false positive here would be an
   * unprompted overlay on a working page, which is far worse than a miss.
   *
   * `archiveBanner` is new: when you are *reading* an archived copy, it tells
   * you so and offers one click back to the live page. Archive replays are
   * routinely mistaken for the live site; this is a small, dismissible,
   * once-per-session note.
   * ==================================================================== */

  const errorOffer = (() => {
    let node = null;
    let disposables = null;

    /* -------------------------------------------------------- status probe */

    /**
     * @returns {{status:number, source:'timing'|'heuristic'|'none'}}
     */
    function detectStatus() {
      try {
        const entry = performance.getEntriesByType?.('navigation')?.[0];
        const status = entry?.responseStatus;
        if (Number.isFinite(status) && status > 0) {
          return {status, source: 'timing'};
        }
      } catch (err) {
        env.log.debug('navigation timing unavailable', err);
      }

      const heuristic = heuristicStatus();
      return heuristic ? {status: heuristic, source: 'heuristic'} : {status: 0, source: 'none'};
    }

    /**
     * Deliberately narrow. Only a document whose *title* announces a specific
     * error code, and which has almost no content, counts. Anything looser
     * mislabels ordinary pages that happen to mention "404".
     */
    function heuristicStatus() {
      try {
        const title = (document.title || '').trim();
        const match = /(?:^|\D)(4\d{2}|5\d{2})(?:\D|$)/.exec(title);
        if (!match) return 0;

        const status = Number(match[1]);
        if (!data.errorCodes.includes(status)) return 0;

        const bodyText = (document.body?.innerText || '').trim();
        if (bodyText.length > 1200) return 0;

        // The title must read like an error, not like an article about one.
        if (!/\b(?:error|not found|forbidden|unavailable|bad gateway|timeout|failed)\b/i.test(title) &&
            !/^\s*\d{3}\b/.test(title)) {
          return 0;
        }

        return status;
      } catch {
        return 0;
      }
    }

    /* ---------------------------------------------------------------- show */

    function isBlockedHost(settings) {
      const host = location.hostname;
      return (settings.errorOfferBlockedHosts || []).some(
        entry => entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1)))
      );
    }

    function dismiss() {
      node?.remove();
      node = null;
      disposables?.dispose();
      disposables = null;
    }

    function show({status, settings, target}) {
      if (node) return;

      ui.mount(settings);
      const root = ui.getRoot();
      if (!root) return;

      disposables = new env.Disposables('erroroffer');

      const rule = urls.matchRule(settings.rules, target.url);
      const engineId = rule?.engine || settings.errorOfferEngine;
      const engine = registry.getEngine(settings, engineId) || registry.enabledEngines(settings)[0];
      if (!engine) return;

      node = util.el('div', {class: 'wa-offer', role: 'status', 'aria-live': 'polite'}, [
        util.el('span', {class: 'wa-item__icon'}, [icons.archive(20)]),
        util.el('span', {class: 'wa-offer__text'}, [
          util.el('span', {
            class: 'wa-offer__title',
            text: status ? getText('errorPrompt_title', [status]) : getText('errorPrompt_titleGeneric')
          }),
          util.el('span', {class: 'wa-offer__body', text: getText('errorPrompt_body')})
        ]),
        util.el('span', {class: 'wa-offer__actions'}, [
          ui.button(getText('errorPrompt_open'), {
            variant: 'primary',
            small: true,
            onClick: async () => {
              dismiss();
              await lookup.runSingle({engine, target, settings, origin: 'errorpage'});
            }
          }),
          ui.button(getText('errorPrompt_choose'), {
            small: true,
            onClick: () => {
              dismiss();
              launcher.open({target});
            }
          }),
          ui.button('', {
            variant: 'ghost',
            small: true,
            icon: icons.close(14),
            title: getText('errorPrompt_dismiss'),
            onClick: dismiss
          })
        ])
      ]);

      // "Never for this site" lives behind the overflow so the prompt stays
      // small, but is always one keystroke away.
      node.appendChild(
        util.el('button', {
          class: 'wa-sr-only',
          type: 'button',
          text: getText('errorPrompt_never'),
          onclick: () => {
            const host = location.hostname;
            store.set({errorOfferBlockedHosts: [...settings.errorOfferBlockedHosts, host]});
            ui.notify({message: getText('errorPrompt_neverDone', [host]), kind: 'info'});
            dismiss();
          }
        })
      );

      root.appendChild(node);

      disposables.addListener(document, 'keydown', ev => {
        if (ev.key === 'Escape' && node) dismiss();
      });
      disposables.addTimeout(dismiss, 30000);
    }

    /* -------------------------------------------------------------- check */

    async function check(settings) {
      if (!settings.errorOffer) return {shown: false, reason: 'disabled'};
      if (isBlockedHost(settings)) return {shown: false, reason: 'blocked-host'};
      if (currentDoc.isArchivePage()) return {shown: false, reason: 'archive-page'};
      if (!urls.validateUrl(location.href)) return {shown: false, reason: 'invalid-url'};

      const {status, source} = detectStatus();
      if (!status || !data.errorCodes.includes(status)) {
        return {shown: false, reason: 'ok-status', status};
      }

      const target = lookup.pageTarget();
      const rule = urls.matchRule(settings.rules, target.url);

      // Automatic redirection is opt-in, and only ever from a *measured*
      // status: a heuristic must never navigate the user away on its own.
      if ((settings.errorOfferAuto || rule?.autoOnError) && source === 'timing') {
        const engineId = rule?.engine || settings.errorOfferEngine;
        const engine = registry.getEngine(settings, engineId);
        if (engine) {
          await lookup.runSingle({engine, target, settings, origin: 'errorpage'});
          return {shown: false, reason: 'auto-opened', status};
        }
      }

      show({status, settings, target});
      return {shown: true, status, source};
    }

    return {check, detectStatus, show, dismiss, _heuristicStatus: heuristicStatus};
  })();

  /* ---------------------------------------------------------------------- */

  const archiveBanner = (() => {
    const SESSION_FLAG = 'web-archives:banner-dismissed';
    let node = null;

    function dismissedThisSession() {
      try {
        return sessionStorage.getItem(SESSION_FLAG) === '1';
      } catch {
        return false;
      }
    }

    function markDismissed() {
      try {
        sessionStorage.setItem(SESSION_FLAG, '1');
      } catch {
        /* nothing persistent available; the banner simply returns next load */
      }
    }

    function dismiss() {
      node?.remove();
      node = null;
      markDismissed();
    }

    function show(settings, extraction) {
      if (node || dismissedThisSession()) return;

      ui.mount(settings);
      const root = ui.getRoot();
      if (!root) return;

      node = util.el('div', {class: 'wa-archive-banner', role: 'status'}, [
        icons.archive(18),
        util.el('span', {class: 'wa-archive-banner__text'}, [
          util.el('span', {text: getText('currentDoc_bannerTitle')}),
          util.el('span', {class: 'wa-archive-banner__url', text: urls.displayUrl(extraction.url, 90)})
        ]),
        ui.button(getText('currentDoc_bannerOpen'), {
          variant: 'primary',
          small: true,
          onClick: () => {
            dismiss();
            env.openTab(extraction.url, {active: true});
          }
        }),
        ui.button('', {
          variant: 'ghost',
          small: true,
          icon: icons.copy(14),
          title: getText('currentDoc_bannerCopy'),
          onClick: async () => {
            const ok = await env.writeClipboard(extraction.url);
            ui.notify({
              message: getText(ok ? 'notice_copied' : 'notice_copyFailed'),
              kind: ok ? 'success' : 'error'
            });
          }
        }),
        ui.button('', {
          variant: 'ghost',
          small: true,
          icon: icons.close(14),
          title: getText('currentDoc_bannerDismiss'),
          onClick: dismiss
        })
      ]);

      root.appendChild(node);
    }

    return {show, dismiss};
  })();

  /* =======================================================================
   * SECTION 21 — Entry points: hotkeys, manager menu, floating button
   * -----------------------------------------------------------------------
   * Entry points for launching search and options:
   *
   *   - the userscript manager's own menu (`GM_registerMenuCommand`) — always
   *     available, zero page impact, and the closest analogue of the toolbar
   *     button;
   *   - a keyboard shortcut, handled in the page (default Ctrl/⌘+Shift+A);
   *   - the in-page right-click menu (section 19);
   *   - an optional floating button, off by default because an always-visible
   *     overlay on every page is not something to opt users into.
   * ==================================================================== */

  const hotkeys = (() => {
    let attached = false;
    const disposables = new env.Disposables('hotkeys');

    /**
     * A shortcut must never fire while the user is typing. Checking the
     * composed path covers shadow-DOM editors (CodeMirror 6, Monaco, most
     * rich-text widgets) that a plain `document.activeElement` check misses.
     */
    function isTypingContext(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const node of path) {
        if (!(node instanceof Element)) continue;
        const tag = node.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (node.isContentEditable) return true;
        const role = node.getAttribute?.('role');
        if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
      }
      return false;
    }

    function onKeyDown(event) {
      if (event.defaultPrevented || event.repeat) return;

      const settings = store.all();
      const primary = env.primaryModifier;

      // The launcher shortcut also *closes* the launcher, so it is allowed to
      // fire while focus is inside our own input.
      if (settings.shortcutLauncher && util.matchesAccelerator(event, settings.shortcutLauncher, {primary})) {
        event.preventDefault();
        event.stopPropagation();
        launcher.toggle();
        return;
      }

      if (isTypingContext(event)) return;

      if (settings.shortcutQuick && util.matchesAccelerator(event, settings.shortcutQuick, {primary})) {
        event.preventDefault();
        const engine = registry.enabledEngines(settings)[0];
        if (!engine) {
          ui.notify({message: getText('error_allEnginesDisabledApp'), kind: 'warn'});
          return;
        }
        const target = contextTargets.current() || lookup.pageTarget();
        lookup.runSingle({engine, target, settings, origin: 'action'});
        return;
      }

      if (
        settings.shortcutCurrentDoc &&
        util.matchesAccelerator(event, settings.shortcutCurrentDoc, {primary})
      ) {
        event.preventDefault();
        lookup.openOriginal({settings});
      }
    }

    function attach() {
      if (attached) return;
      attached = true;
      // Capture phase so that a page which stops propagation on keydown (very
      // common in editors and games) cannot make the shortcut unreachable.
      disposables.addListener(window, 'keydown', onKeyDown, {capture: true});
    }

    /** Re-read after a settings change; the handler reads live state, so this
     *  only needs to refresh the manager menu captions. */
    function sync() {
      menuCommands.sync();
    }

    function dispose() {
      disposables.dispose();
      attached = false;
    }

    return {attach, sync, dispose, isTypingContext, _onKeyDown: onKeyDown};
  })();

  /* ---------------------------------------------------------------------- */

  const menuCommands = (() => {
    let lastSignature = '';

    function sync() {
      if (!env.capabilities.menuCommands) return;

      const settings = store.all();
      const shortcut = settings.shortcutLauncher
        ? ` (${util.formatAccelerator(settings.shortcutLauncher, {primary: env.primaryModifier})})`
        : '';

      const extraction = currentDoc.extractFromPage();
      const engines = registry.enabledEngines(settings);
      const topEngines = engines.slice(0, 5);

      const signature = [
        shortcut,
        extraction?.url || '',
        settings.searchAllEnginesAction,
        topEngines.map(e => e.id).join(','),
        settings.showContribPage
      ].join('|');

      // Re-registering identical commands makes some managers duplicate them.
      if (signature === lastSignature) return;
      lastSignature = signature;

      env.menu.clear();

      env.menu.register('launcher', `${getText('launcherTitle')}${shortcut}`, () => launcher.open(), {
        accessKey: 'a'
      });

      if (settings.searchAllEnginesAction !== 'false') {
        env.menu.register('all', getText('actionTitle_allEngines'), () =>
          lookup.runAll({target: contextTargets.current() || lookup.pageTarget(), settings})
        );
      }

      for (const engine of topEngines) {
        env.menu.register(`engine:${engine.id}`, getText('actionTitle_engine', [engine.name]), () =>
          lookup.runSingle({
            engine,
            target: contextTargets.current() || lookup.pageTarget(),
            settings
          })
        );
      }

      if (extraction) {
        env.menu.register('currentdoc', getText('menuItemTitle_openCurrentDoc'), () =>
          lookup.openOriginal({settings})
        );
      }

      env.menu.register('settings', getText('action_settings'), () => settingsUi.open(), {
        accessKey: 's'
      });
    }

    return {sync};
  })();

  /* ---------------------------------------------------------------------- */

  const fab = (() => {
    let node = null;

    function remove() {
      node?.remove();
      node = null;
    }

    function sync() {
      const settings = store.all();

      if (!settings.showLauncherButton) {
        remove();
        return;
      }

      ui.mount(settings);
      const root = ui.getRoot();
      if (!root) return;

      if (!node) {
        node = util.el(
          'button',
          {
            class: 'wa-fab',
            type: 'button',
            'aria-label': getText('launcherTitle'),
            title: getText('launcherTitle'),
            onclick: () => launcher.toggle()
          },
          [icons.archive(20)]
        );
        root.appendChild(node);
      }

      node.dataset.position = settings.launcherButtonPosition;
    }

    return {sync, remove};
  })();

  /* =======================================================================
   * SECTION 22 — Diagnostics
   * -----------------------------------------------------------------------
   * A self-contained report the user can read and copy when something does
   * not work. It answers the questions a maintainer would otherwise have to
   * ask: which manager, which grants, what the lookup URL actually resolved
   * to, what each engine would open, what the availability cache holds, and
   * what the script logged.
   *
   * Nothing here is transmitted anywhere. The copy action writes to the
   * clipboard and stops.
   * ==================================================================== */

  const diagnostics = (() => {
    function collect() {
      const settings = store.all();
      const target = contextTargets.current() || lookup.pageTarget();
      const resolved = lookup.resolveUrl(target, settings);

      const engineTargets = registry.enabledEngines(settings).map(engine => {
        const built = resolved.valid
          ? registry.resolveTarget(settings, engine, resolved.url)
          : {ok: false, reason: 'invalid-url'};
        const probe = resolved.valid ? probes.peek(engine, resolved.url) : undefined;
        return {
          id: engine.id,
          name: engine.name,
          mode: engine.mode,
          target: built.ok ? built.target || `(${built.kind})` : `error: ${built.reason}`,
          availability: probe?.state || 'not-checked'
        };
      });

      return {
        app: {name: env.APP_NAME, version: env.APP_VERSION, schema: store.SCHEMA_VERSION},
        manager: {
          name: env.capabilities.manager,
          version: env.capabilities.managerVersion
        },
        capabilities: Object.fromEntries(
          Object.entries(env.capabilities).filter(([, value]) => typeof value === 'boolean')
        ),
        platform: {...env.platform},
        page: {
          url: location.href,
          archiveEngine: currentDoc.detectEngine() || null,
          navigationStatus: errorOffer.detectStatus()
        },
        target: {
          type: target.type,
          raw: target.url,
          resolved: resolved.valid ? resolved.url : null,
          valid: resolved.valid
        },
        engineTargets,
        probeCache: probes.stats(),
        storage: {
          readOnly: store.isReadOnly(),
          repairs: store.repairs().map(entry => entry.key)
        },
        settings,
        log: env.log.entries().slice(-60)
      };
    }

    function format(report) {
      return JSON.stringify(report, null, 2);
    }

    function open() {
      const report = collect();
      const dialog = new ui.Dialog({title: getText('diagnostics_title'), wide: true});
      dialog.addCloseButton();

      const row = (label, value) =>
        util.el('div', {style: {display: 'flex', gap: '8px', 'font-size': '12.5px', padding: '2px 0'}}, [
          util.el('span', {style: {'min-width': '150px', color: 'var(--wa-fg-muted)'}, text: label}),
          util.el('span', {style: {'word-break': 'break-all'}, text: String(value)})
        ]);

      dialog.body.appendChild(
        ui.section(getText('diagnostics_manager'), '', [
          row('Script', `${report.app.name} ${report.app.version} (schema ${report.app.schema})`),
          row('Manager', `${report.manager.name} ${report.manager.version}`.trim()),
          row('Platform', `${report.platform.os}`),
          row(
            getText('diagnostics_capabilities'),
            Object.entries(report.capabilities)
              .filter(([, value]) => value)
              .map(([key]) => key)
              .join(', ') || 'none'
          )
        ])
      );

      dialog.body.appendChild(
        ui.section(getText('diagnostics_target'), '', [
          row('Type', report.target.type),
          row('Raw', report.target.raw),
          row('Resolved', report.target.resolved || '—'),
          row('Archive page', report.page.archiveEngine || 'no'),
          row('HTTP status', `${report.page.navigationStatus.status || '—'} (${report.page.navigationStatus.source})`)
        ])
      );

      const targetsTable = util.el('div');
      for (const engine of report.engineTargets) {
        targetsTable.appendChild(
          util.el('div', {style: {padding: '4px 0', 'border-bottom': '1px solid var(--wa-border)'}}, [
            util.el('div', {style: {'font-size': '12.5px', 'font-weight': '600'}}, [
              engine.name,
              ' ',
              ui.chip(engine.availability, engine.availability === 'available' ? 'ok' : '')
            ]),
            util.el('div', {
              style: {'font-size': '11.5px', 'font-family': 'var(--wa-mono)', color: 'var(--wa-fg-muted)', 'word-break': 'break-all'},
              text: engine.target
            })
          ])
        );
      }
      dialog.body.appendChild(ui.section(getText('diagnostics_engineTargets'), '', [targetsTable]));

      dialog.body.appendChild(
        ui.section(getText('diagnostics_probeCache'), '', [
          row('Entries', report.probeCache.size),
          row('TTL', `${report.probeCache.ttlMinutes} min`),
          row('Concurrency', report.probeCache.concurrency)
        ])
      );

      const logNode = util.el('pre', {class: 'wa-code'});
      logNode.textContent = report.log.length
        ? report.log
            .map(entry => `${new Date(entry.time).toISOString().slice(11, 23)} ${entry.level.padEnd(5)} ${entry.text}`)
            .join('\n')
        : getText('diagnostics_noLog');
      dialog.body.appendChild(ui.section(getText('diagnostics_log'), '', [logNode]));

      dialog.footer.appendChild(util.el('div', {class: 'wa-spacer'}));
      dialog.footer.appendChild(
        ui.button(getText('diagnostics_copy'), {
          variant: 'primary',
          icon: icons.copy(15),
          onClick: async () => {
            const ok = await env.writeClipboard(format(report));
            ui.notify({
              message: getText(ok ? 'diagnostics_copied' : 'notice_copyFailed'),
              kind: ok ? 'success' : 'error'
            });
          }
        })
      );
      dialog.footer.appendChild(
        ui.button(getText('action_support'), {
          icon: icons.openExternal(15),
          onClick: () => env.openTab(data.supportUrl, {active: true})
        })
      );

      dialog.open();
      return dialog;
    }

    return {open, collect, format};
  })();

  /* =======================================================================
   * SECTION 23 — Application boot
   * -----------------------------------------------------------------------
   * Ordering rules that matter:
   *
   *  1. Settings are loaded before anything reads them. Every consumer takes a
   *     snapshot, so there is no window in which a default masquerades as a
   *     user choice.
   *  2. An automation job is claimed at `document-start`, before the engine's
   *     own scripts can rewrite the fragment or navigate. Claiming is cheap
   *     and idempotent, so it happens on every page.
   *  3. Everything that touches the DOM waits for `document.body`. The script
   *     runs at `document-start`, so `body` may not exist yet.
   *  4. Nothing is registered twice: a second injection (a manager quirk, or
   *     the same script installed twice) is detected and aborts immediately.
   *  5. Every listener, observer and timer is owned by a `Disposables`, and
   *     `pagehide` flushes pending writes and tears the whole thing down.
   * ==================================================================== */

  const app = (() => {
    const GUARD_KEY = '__webArchivesUserscriptBooted';
    const disposables = new env.Disposables('app');

    let booted = false;
    let settingsSnapshot = null;

    /* ------------------------------------------------------- double-inject */

    function alreadyRunning() {
      try {
        const scope = env.capabilities.unsafeWindow ? unsafeWindow : window;
        if (scope[GUARD_KEY]) return true;
        Object.defineProperty(scope, GUARD_KEY, {
          value: env.APP_VERSION,
          configurable: true,
          enumerable: false,
          writable: false
        });
        return false;
      } catch {
        // A sandbox that forbids the write cannot be double-injected in the
        // way we are guarding against.
        return false;
      }
    }

    /* --------------------------------------------------------- automation */

    /**
     * Runs before any UI work: if this page was opened to satisfy an automated
     * engine lookup, drive it and get out of the way.
     */
    async function runClaimedTask() {
      // Cheap pre-filter: only the three automated hosts can ever hold a job.
      const isAutomationHost =
        automation.hostMatchesEngine('yandex') ||
        automation.hostMatchesEngine('megalodon') ||
        automation.hostMatchesEngine('ghostarchive');

      const hasFragment = !!tasks.readFragmentTaskId();
      if (!isAutomationHost && !hasFragment) return false;

      let claim;
      try {
        claim = await tasks.claimForThisPage();
      } catch (err) {
        env.log.warn('task claim failed', err);
        return false;
      }

      if (claim.expired) {
        ui.mount(settingsSnapshot);
        ui.notify({message: getText('engineRun_taskExpired'), kind: 'warn'});
        return false;
      }

      const task = claim.task;
      if (!task) return false;

      const engineName = getText(`engineName_${task.engine}`);
      env.log.info(`running ${task.engine} automation for ${task.docUrl}`);

      const controller = new AbortController();
      disposables.add(() => controller.abort());

      // Two minutes is generous for a search page; beyond that something is
      // wrong and the user deserves to be told rather than left waiting.
      const guard = disposables.addTimeout(() => controller.abort(), 120000);

      const result = await automation.run(task, {
        disposables,
        signal: controller.signal
      });

      guard();

      if (result.pending) {
        // The page is about to navigate; the session claim carries the job.
        return true;
      }

      await tasks.complete(task.id);

      if (!result.ok) {
        ui.mount(settingsSnapshot);
        const message =
          result.reason === 'no-results' || result.reason === 'no-cache-link'
            ? getText('engineRun_noResult', [engineName])
            : result.reason === 'captcha'
              ? getText('error_engine', [engineName])
              : getText('engineRun_failed', [engineName]);
        ui.notify({
          message,
          kind: 'warn',
          timeout: 12000,
          actions: [
            {
              label: getText('action_openCurrentDoc'),
              onSelect: () => env.openTab(task.docUrl, {active: true})
            }
          ]
        });
      }

      return true;
    }

    /* ------------------------------------------------------ contribute note */

    /**
     * Shows a gentle, dismissible in-page notice once 10 searches have been
     * performed and 14 days have passed, at most once every 90 days.
     */
    async function maybeShowContribNotice(settings) {
      if (!settings.showContribPage || settings.contribNoticeDismissed) return;

      const stats = await store.getStats();
      const now = Date.now();

      if (stats.useCount < 10) return;
      if (now - stats.installTime < 14 * 86400000) return;
      if (stats.contribNoticeLastShown && now - stats.contribNoticeLastShown < 90 * 86400000) return;

      await store.setStats({contribNoticeLastShown: now});

      ui.notify({
        message: `${getText('contribute_title')} — ${getText('contribute_body')}`,
        kind: 'info',
        timeout: 20000,
        quiet: true,
        actions: [
          {
            label: getText('contribute_open'),
            onSelect: () => env.openTab(data.projectUrl, {active: true})
          },
          {
            label: getText('contribute_hide'),
            onSelect: () => store.set({contribNoticeDismissed: true})
          }
        ]
      });
    }

    /* ----------------------------------------------------------- SPA watch */

    /**
     * Single-page applications change the URL without a navigation. The menu
     * captions and the archive banner both depend on the current URL, so both
     * are refreshed — but only when the URL genuinely changed, and throttled.
     */
    function watchUrlChanges() {
      let lastUrl = location.href;

      const onChange = util.throttle(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        contextTargets.clear();
        menuCommands.sync();
      }, 500);

      disposables.addListener(window, 'popstate', onChange);
      disposables.addListener(window, 'hashchange', onChange);

      // `pushState`/`replaceState` raise no event. A cheap polled check is more
      // robust — and far less invasive — than patching History on every page.
      disposables.addInterval(onChange, 1200);
    }

    /* --------------------------------------------------------------- boot */

    async function boot() {
      if (booted) return;
      booted = true;

      if (alreadyRunning()) {
        env.log.warn('another copy of Web Archives is already running on this page; aborting');
        return;
      }

      settingsSnapshot = await store.load();
      env.log.setDebug(settingsSnapshot.debug);
      probes.configure(settingsSnapshot);

      env.log.debug(
        `booting on ${location.hostname} · manager=${env.capabilities.manager} · storage=${
          env.capabilities.persistentStorage ? 'yes' : 'no'
        }`
      );

      // 1. Automation first — it may navigate away immediately.
      let handledTask = false;
      try {
        handledTask = await runClaimedTask();
      } catch (err) {
        env.log.error('automation dispatch failed', err);
      }

      // 2. The DOM must exist before anything is mounted.
      await util.whenDocumentElementReady();
      if (!document.body) {
        await new Promise(resolve => {
          const observer = new MutationObserver(() => {
            if (document.body) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.documentElement, {childList: true});
          disposables.addObserver(observer);
        });
      }

      ui.mount(settingsSnapshot);

      // 3. Entry points.
      contextTargets.attach(disposables);
      contextMenu.attach(disposables);
      hotkeys.attach();
      menuCommands.sync();
      fab.sync();

      // 4. React to settings changes from this tab or any other.
      disposables.add(
        store.subscribe(next => {
          settingsSnapshot = next;
          ui.applyTheme(next);
          probes.configure(next);
          menuCommands.sync();
          fab.sync();
        })
      );

      // 5. Page-specific surfaces, once the document has settled.
      if (!handledTask) {
        util.waitForDocumentLoad().then(async () => {
          if (disposables.disposed) return;

          const settings = store.all();

          const extraction = currentDoc.extractFromPage();
          if (extraction) {
            menuCommands.sync();
            archiveBanner.show(settings, extraction);
          } else {
            try {
              await errorOffer.check(settings);
            } catch (err) {
              env.log.warn('error-page check failed', err);
            }
          }

          try {
            await maybeShowContribNotice(settings);
          } catch (err) {
            env.log.debug('contribution notice skipped', err);
          }
        });
      }

      watchUrlChanges();

      // 6. Never lose a pending write.
      const flush = () => store.flush();
      disposables.addListener(window, 'pagehide', flush, {capture: true});
      disposables.addListener(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });

      env.log.debug('boot complete');
    }

    function dispose() {
      store.flush();
      store.dispose();
      tasks.dispose();
      hotkeys.dispose();
      env.menu.clear();
      fab.remove();
      contextMenu.close();
      launcher.close();
      disposables.dispose();
      ui.dispose();
      booted = false;
    }

    return {boot, dispose};
  })();

  /* =======================================================================
   * SECTION 24 — Runtime entry
   * -----------------------------------------------------------------------
   * The single side effect of loading this file. Everything above is
   * declarations; this is the only statement that runs on its own.
   *
   * The test harness sets `globalThis.__WEB_ARCHIVES_TEST__` before loading
   * the bundle, which suppresses auto-boot and exports the internals so each
   * module can be exercised in isolation.
   * ==================================================================== */

  if (typeof globalThis !== 'undefined' && globalThis.__WEB_ARCHIVES_TEST__) {
    globalThis.__WEB_ARCHIVES__ = {
      env,
      util,
      i18n,
      getText,
      data,
      store,
      urls,
      ranking,
      registry,
      probes,
      tasks,
      automation,
      currentDoc,
      lookup,
      STYLES,
      icons,
      ui,
      launcher,
      snapshots,
      settingsUi,
      contextTargets,
      contextMenu,
      errorOffer,
      archiveBanner,
      hotkeys,
      menuCommands,
      fab,
      diagnostics,
      app
    };
  } else {
    app.boot().catch(err => {
      // A boot failure must never leave a half-initialised script behind, and
      // must never be silent.
      // eslint-disable-next-line no-console
      console.error('[Web Archives] failed to start', err);
      try {
        app.dispose();
      } catch {
        /* nothing further can be done */
      }
    });
  }
})();
