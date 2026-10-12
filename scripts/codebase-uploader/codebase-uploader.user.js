// SPDX-License-Identifier: MIT
// ==UserScript==
// @name         Codebase Uploader
// @namespace    https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/codebase-uploader
// @version      2.0.2
// @description  Package any directory or codebase into structured markdown chunks and raw attachments for AI chats. Gitignore-aware filtering, virtualized file tree, keyboard-driven operation, token budgeting, abortable packing, and settings that follow you across every supported site.
// @author       Shivansh Jain
// @license      MIT
// @homepageURL  https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/codebase-uploader
// @supportURL   https://github.com/shivanshjain456/browser-workflow-tools/issues
// @downloadURL  https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/codebase-uploader/codebase-uploader.user.js
// @updateURL    https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/codebase-uploader/codebase-uploader.user.js
// @icon         https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-32.png
// @icon64       https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-64.png
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @match        *://claude.ai/*
// @match        *://*.claude.ai/*
// @match        *://gemini.google.com/*
// @match        *://aistudio.google.com/*
// @match        *://*.deepseek.com/*
// @match        *://*.perplexity.ai/*
// @match        *://*.meta.ai/*
// @match        *://arena.lmsys.org/*
// @match        *://*.lmarena.ai/*
// @match        *://lmarena.ai/*
// @match        *://*.arena.ai/*
// @match        *://*.grok.com/*
// @match        *://chat.mistral.ai/*
// @match        *://copilot.microsoft.com/*
// @match        *://huggingface.co/chat/*
// @match        *://*.qwen.ai/*
// @match        *://*.kimi.com/*
// @match        *://*.z.ai/*
// @match        *://openrouter.ai/*
// @match        *://*.groq.com/*
// @match        *://aistudio.xiaomimimo.com/*
// @match        *://agent.minimax.io/*
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
// @grant        GM_setClipboard
// @grant        GM_info
// ==/UserScript==

/*
 * Codebase Uploader — packages directories into AI-chat-ready markdown chunks.
 *
 * Operates locally without third-party network requests: zero external telemetry,
 * analytics, or remote configuration. Selected file contents are processed in memory
 * and handed exclusively to the active AI chat composer, to your clipboard, or
 * downloaded as a local file upon explicit user action.
 */

(function () {
  'use strict';

  /* =======================================================================
   * SECTION 01 — Environment: userscript-manager bridge and capabilities
   * -----------------------------------------------------------------------
   * Settings live in the manager's per-script store rather than per-origin
   * localStorage, so they follow the user seamlessly across all supported sites.
   *
   * This module funnels every privileged operation through one place so that:
   *   - settings live in the manager's per-script store and are therefore
   *     shared across all supported sites, with `localStorage` retained as a
   *     migration source and as the fallback when no storage grant exists;
   *   - a missing grant degrades to a documented fallback instead of an
   *     exception;
   *   - no other module ever touches a `GM_*` symbol, so manager differences
   *     cannot leak into product code.
   * ==================================================================== */

  const APP_ID = 'codebase-uploader';
  const APP_NAME = 'Codebase Uploader';
  const APP_VERSION = '2.0.2';
  const LOG_PREFIX = `[${APP_NAME}]`;

  /* ------------------------------------------------------------- logging */

  const logRing = [];
  const LOG_RING_MAX = 250;
  let debugEnabled = false;

  function record(level, args) {
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
    logRing.push({ t: Date.now(), level, text: text.slice(0, 1500) });
    if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX);
  }

  const log = {
    debug(...a) {
      record('debug', a);
      if (debugEnabled) console.debug(LOG_PREFIX, ...a);
    },
    info(...a) {
      record('info', a);
      if (debugEnabled) console.info(LOG_PREFIX, ...a);
    },
    warn(...a) {
      record('warn', a);
      console.warn(LOG_PREFIX, ...a);
    },
    error(...a) {
      record('error', a);
      console.error(LOG_PREFIX, ...a);
    },
    setDebug(v) {
      debugEnabled = !!v;
    },
    isDebug: () => debugEnabled,
    entries: () => logRing.slice(),
    clear() {
      logRing.length = 0;
    }
  };

  /* -------------------------------------------------------- capabilities */

  /**
   * Resolves a granted API.
   *
   * This must reference the identifier **directly**, not look it up on
   * `globalThis`. Violentmonkey injects granted `GM_*` functions as bindings
   * in the script's own scope and never puts them on `window`; Tampermonkey
   * does the same under its default sandbox. A `globalThis['GM_setValue']`
   * lookup therefore returns `undefined` in both, which silently costs the
   * script every privileged capability it has — shared settings storage,
   * menu commands and the clipboard — with no error anywhere.
   *
   * A direct reference to an undeclared identifier throws `ReferenceError`,
   * which is what the try/catch is for. `probeName` is recorded so the build
   * can still verify that every declared `@grant` is actually probed.
   */
  function probeRef(probeName, resolve) {
    void probeName;
    try {
      const v = resolve();
      return typeof v === 'function' ? v : null;
    } catch {
      return null;
    }
  }

  const gm = {
    getValue: probeRef('GM_getValue', () => GM_getValue),
    setValue: probeRef('GM_setValue', () => GM_setValue),
    deleteValue: probeRef('GM_deleteValue', () => GM_deleteValue),
    listValues: probeRef('GM_listValues', () => GM_listValues),
    addValueChangeListener: probeRef('GM_addValueChangeListener', () => GM_addValueChangeListener),
    removeValueChangeListener: probeRef('GM_removeValueChangeListener', () => GM_removeValueChangeListener),
    registerMenuCommand: probeRef('GM_registerMenuCommand', () => GM_registerMenuCommand),
    unregisterMenuCommand: probeRef('GM_unregisterMenuCommand', () => GM_unregisterMenuCommand),
    setClipboard: probeRef('GM_setClipboard', () => GM_setClipboard)
  };

  let gmInfo = null;
  try {
    // Direct reference for the same reason as the functions above.
    gmInfo = GM_info;
  } catch {
    gmInfo = null;
  }

  const managerName = (() => {
    const raw = String(gmInfo?.scriptHandler || '').toLowerCase();
    if (raw.includes('tampermonkey')) return 'tampermonkey';
    if (raw.includes('violentmonkey')) return 'violentmonkey';
    if (raw.includes('greasemonkey')) return 'greasemonkey';
    if (raw.includes('userscripts')) return 'userscripts';
    if (raw.includes('adguard')) return 'adguard';
    if (raw.includes('firemonkey')) return 'firemonkey';
    if (raw.includes('orion')) return 'orion';
    return raw ? raw.replace(/\s+/g, '-') : 'unknown';
  })();

  const ua = (() => {
    try {
      return String(navigator.userAgent || '');
    } catch {
      return '';
    }
  })();

  /**
   * `navigator.platform` is deprecated and, on Apple Silicon and iPadOS, it
   * lies. The modern hint is preferred and the UA string is the fallback.
   */
  const isMac = (() => {
    try {
      const hinted = navigator.userAgentData?.platform;
      if (typeof hinted === 'string' && hinted) return /mac/i.test(hinted);
    } catch {
      /* fall through */
    }
    if (/iPhone|iPod|iPad/i.test(ua)) return true;
    if (/Macintosh|Mac OS X/i.test(ua)) return true;
    return false;
  })();

  const capabilities = Object.freeze({
    manager: managerName,
    managerVersion: String(gmInfo?.version || ''),
    gmStorage: !!(gm.getValue && gm.setValue),
    gmStorageEvents: !!(gm.addValueChangeListener && gm.removeValueChangeListener),
    menuCommands: !!gm.registerMenuCommand,
    menuCommandsDynamic: !!(gm.registerMenuCommand && gm.unregisterMenuCommand),
    gmClipboard: !!gm.setClipboard,
    localStorage: (() => {
      try {
        const k = '__cu_probe__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch {
        return false;
      }
    })(),
    /*
     * Reported for diagnostics only. The File System Access pickers are
     * deliberately NOT used: inside a userscript sandbox their failure modes
     * are opaque (a rejected handle, a cross-realm async iterator, or a
     * consumed user activation all surface as "nothing happened"), and they
     * buy nothing here because the script only ever reads files. The
     * `<input type="file" webkitdirectory>` route is used instead — it is
     * universally supported and its failure modes are observable.
     */
    fileSystemAccess: typeof globalThis.showDirectoryPicker === 'function',
    saveFilePicker: typeof globalThis.showSaveFilePicker === 'function',
    dropHandles: typeof DataTransferItem !== 'undefined' &&
      'getAsFileSystemHandle' in DataTransferItem.prototype,
    dropEntries: typeof DataTransferItem !== 'undefined' &&
      'webkitGetAsEntry' in DataTransferItem.prototype,
    asyncClipboard: !!(globalThis.navigator?.clipboard?.write) && typeof globalThis.ClipboardItem === 'function',
    clipboardText: !!globalThis.navigator?.clipboard?.writeText,
    constructableStylesheets: (() => {
      try {
        new CSSStyleSheet();
        return 'adoptedStyleSheets' in ShadowRoot.prototype;
      } catch {
        return false;
      }
    })(),
    trustedTypes: typeof globalThis.trustedTypes !== 'undefined',
    isMac,
    secureContext: !!globalThis.isSecureContext
  });

  /* -------------------------------------------------------------- storage */

  /**
   * Two backends behind one async interface.
   *
   *   `gm`     — the manager's per-script store. Shared across every matched
   *              site, which is what settings actually want.
   *   `local`  — `localStorage`, per-origin. Used when no storage grant
   *              exists, and always read once at startup so an existing
   *              1.x installation is migrated rather than reset.
   *
   * Neither path ever throws to the caller.
   */
  const LS_PREFIX = 'cu-';

  async function storageGet(key, fallback) {
    if (gm.getValue) {
      try {
        const v = await gm.getValue(key, undefined);
        if (v !== undefined) return v;
      } catch (e) {
        log.warn('GM storage read failed', key, e);
      }
    }
    if (capabilities.localStorage) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) {
        log.debug('localStorage read failed', key, e);
      }
    }
    return fallback;
  }

  async function storageSet(key, value) {
    let ok = false;
    if (gm.setValue) {
      try {
        await gm.setValue(key, value);
        ok = true;
      } catch (e) {
        log.warn('GM storage write failed', key, e);
      }
    }
    if (!ok && capabilities.localStorage) {
      try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
        ok = true;
      } catch (e) {
        // Quota exhausted, or storage disabled mid-session.
        log.warn('localStorage write failed', key, e);
      }
    }
    return ok;
  }

  async function storageDelete(key) {
    if (gm.deleteValue) {
      try {
        await gm.deleteValue(key);
      } catch (e) {
        log.debug('GM storage delete failed', key, e);
      }
    }
    if (capabilities.localStorage) {
      try {
        localStorage.removeItem(LS_PREFIX + key);
      } catch {
        /* nothing to do */
      }
    }
  }

  async function storageKeys() {
    if (gm.listValues) {
      try {
        const keys = await gm.listValues();
        if (Array.isArray(keys)) return keys;
      } catch (e) {
        log.debug('GM storage list failed', e);
      }
    }
    if (capabilities.localStorage) {
      try {
        return Object.keys(localStorage)
          .filter(k => k.startsWith(LS_PREFIX))
          .map(k => k.slice(LS_PREFIX.length));
      } catch {
        /* fall through */
      }
    }
    return [];
  }

  /** Raw `localStorage` read, used only by the 1.x settings migration. */
  function legacyLocalRead(key) {
    if (!capabilities.localStorage) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Cross-tab / cross-site change notification. Returns a disposer that never
   * throws. Without the grant this is a no-op and each tab simply keeps its
   * own view until reload — stated in the settings UI rather than hidden.
   */
  function storageWatch(key, cb) {
    if (!gm.addValueChangeListener) return () => {};
    let handle;
    try {
      handle = gm.addValueChangeListener(key, (name, oldValue, newValue, remote) => {
        try {
          cb({ key: name, oldValue, newValue, remote: !!remote });
        } catch (e) {
          log.error('storage watcher threw', e);
        }
      });
    } catch (e) {
      log.warn('storage watch failed', key, e);
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

  /* ---------------------------------------------------------- menu commands */

  const menuHandles = new Map();

  function registerMenuCommand(id, caption, handler, opts = {}) {
    if (!gm.registerMenuCommand) return false;
    try {
      let handle;
      try {
        // Tampermonkey and Violentmonkey both accept an options object with
        // `id`, which updates the command in place instead of duplicating it.
        handle = gm.registerMenuCommand(caption, handler, {
          id,
          accessKey: opts.accessKey,
          autoClose: opts.autoClose !== false,
          title: opts.title
        });
      } catch {
        handle = gm.registerMenuCommand(caption, handler, opts.accessKey);
      }
      menuHandles.set(id, handle === undefined ? caption : handle);
      return true;
    } catch (e) {
      log.warn('menu command registration failed', caption, e);
      return false;
    }
  }

  function unregisterMenuCommand(id) {
    if (!menuHandles.has(id)) return;
    const handle = menuHandles.get(id);
    menuHandles.delete(id);
    try {
      gm.unregisterMenuCommand?.(handle);
    } catch {
      /* a stale caption is cosmetic */
    }
  }

  function clearMenuCommands() {
    for (const id of [...menuHandles.keys()]) unregisterMenuCommand(id);
  }

  /* -------------------------------------------------------------- clipboard */

  /**
   * Text to clipboard, ordered by reliability rather than by modernity.
   *
   * `GM_setClipboard` is tried first when granted because it is synchronous
   * and immune to the transient-activation rules that make the async
   * Clipboard API fail after an `await` — exactly the situation this script is
   * in after reading files from disk.
   */
  async function writeClipboardText(text) {
    if (gm.setClipboard) {
      try {
        gm.setClipboard(text, 'text');
        return true;
      } catch (e) {
        log.debug('GM_setClipboard failed', e);
      }
    }
    if (capabilities.clipboardText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        log.debug('navigator.clipboard.writeText failed', e);
      }
    }
    return false;
  }

  /* -------------------------------------------------------------- lifecycle */

  /**
   * Every observer, timer, listener and abortable task registers here. A
   * teardown is deterministic, idempotent, and survives a throwing disposer.
   */
  class Disposables {
    constructor(name = '') {
      this.name = name;
      this._items = new Set();
      this._disposed = false;
    }

    add(fn) {
      if (typeof fn !== 'function') return () => {};
      if (this._disposed) {
        try {
          fn();
        } catch {
          /* already torn down */
        }
        return () => {};
      }
      this._items.add(fn);
      return () => {
        if (!this._items.delete(fn)) return;
        try {
          fn();
        } catch (e) {
          log.warn('disposer threw', e);
        }
      };
    }

    listen(target, type, handler, options) {
      if (!target?.addEventListener) return () => {};
      target.addEventListener(type, handler, options);
      return this.add(() => target.removeEventListener(type, handler, options));
    }

    timeout(fn, ms) {
      const id = setTimeout(() => {
        this._items.delete(cancel);
        fn();
      }, ms);
      const cancel = () => clearTimeout(id);
      this._items.add(cancel);
      return () => {
        this._items.delete(cancel);
        cancel();
      };
    }

    interval(fn, ms) {
      const id = setInterval(fn, ms);
      return this.add(() => clearInterval(id));
    }

    observer(obs) {
      return this.add(() => obs.disconnect());
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
        } catch (e) {
          log.warn('disposer threw during teardown', e);
        }
      }
    }
  }

  const env = {
    APP_ID,
    APP_NAME,
    APP_VERSION,
    capabilities,
    log,
    Disposables,
    storage: {
      get: storageGet,
      set: storageSet,
      delete: storageDelete,
      keys: storageKeys,
      watch: storageWatch,
      legacyLocalRead
    },
    menu: {
      register: registerMenuCommand,
      unregister: unregisterMenuCommand,
      clear: clearMenuCommands
    },
    writeClipboardText
  };

  /* =======================================================================
   * SECTION 02 — Utilities
   * -----------------------------------------------------------------------
   * Pure, side-effect-free helpers. Key design decisions:
   *
   *  - `globMatch` is a linear two-pointer matcher rather than a translated
   *    regular expression, so a user-authored ignore pattern can never
   *    backtrack exponentially.
   *  - `safeSlice` advances by code points and guarantees
   *    forward progress, ensuring slices never split surrogate pairs.
   * ==================================================================== */

  const util = (() => {
    /* ------------------------------------------------------------ timing */

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /** Yields to the event loop so a long loop cannot freeze the UI. */
    const yieldToUI = () =>
      new Promise(r => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
        else setTimeout(r, 0);
      });

    /** Trailing-edge debounce with `flush`/`cancel`, so no write is lost. */
    function debounce(fn, wait) {
      let timer = null;
      let pending = null;
      const invoke = () => {
        const args = pending;
        timer = null;
        pending = null;
        if (args) fn(...args);
      };
      const wrapped = (...args) => {
        pending = args;
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
        pending = null;
      };
      wrapped.pending = () => timer !== null;
      return wrapped;
    }

    /** Leading-edge throttle that always delivers the trailing call. */
    function throttle(fn, wait) {
      let last = 0;
      let timer = null;
      let pending = null;
      const run = args => {
        last = Date.now();
        fn(...args);
      };
      const wrapped = (...args) => {
        const remaining = wait - (Date.now() - last);
        if (remaining <= 0) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          run(args);
        } else {
          pending = args;
          if (!timer) {
            timer = setTimeout(() => {
              timer = null;
              if (pending) {
                const a = pending;
                pending = null;
                run(a);
              }
            }, remaining);
          }
        }
      };
      wrapped.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        pending = null;
      };
      return wrapped;
    }

    /** Schedules on the next frame, collapsing repeated requests into one. */
    function rafBatch(fn) {
      let scheduled = false;
      let lastArgs = null;
      const wrapped = (...args) => {
        lastArgs = args;
        if (scheduled) return;
        scheduled = true;
        const run = () => {
          scheduled = false;
          const a = lastArgs;
          lastArgs = null;
          fn(...(a || []));
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(run, 16);
      };
      wrapped.cancel = () => {
        scheduled = false;
        lastArgs = null;
      };
      return wrapped;
    }

    /** Bounded-concurrency pool; a rejected task never stalls the queue. */
    class TaskQueue {
      constructor({ concurrency = 4 } = {}) {
        this.concurrency = Math.max(1, concurrency);
        this._q = [];
        this._active = 0;
      }

      add(task) {
        return new Promise((resolve, reject) => {
          this._q.push({ task, resolve, reject });
          this._drain();
        });
      }

      get size() {
        return this._q.length;
      }

      get pending() {
        return this._active;
      }

      _drain() {
        while (this._active < this.concurrency && this._q.length) {
          const { task, resolve, reject } = this._q.shift();
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

    /** Thrown by any operation the user cancelled. Never surfaced as an error. */
    class CancelledError extends Error {
      constructor(message = 'Cancelled') {
        super(message);
        this.name = 'CancelledError';
      }
    }

    const isCancellation = err =>
      !!err && (err.name === 'CancelledError' || err.name === 'AbortError');

    function throwIfAborted(signal) {
      if (signal?.aborted) throw new CancelledError();
    }

    /* --------------------------------------------------------- identity */

    function uid(prefix = 'id') {
      try {
        if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
      } catch {
        /* fall through */
      }
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /** Stable, non-cryptographic 53-bit-ish hash for cache and identity keys. */
    function hashString(input) {
      let h1 = 0xdeadbeef;
      let h2 = 0x41c6ce57;
      const s = String(input);
      for (let i = 0; i < s.length; i += 1) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
    }

    /* -------------------------------------------------------- structures */

    /** Bounded LRU. Used for compiled patterns and per-path filter verdicts. */
    class LruCache {
      constructor(max = 500) {
        this.max = Math.max(1, max);
        this._m = new Map();
      }

      get(k) {
        if (!this._m.has(k)) return undefined;
        const v = this._m.get(k);
        this._m.delete(k);
        this._m.set(k, v);
        return v;
      }

      has(k) {
        return this._m.has(k);
      }

      set(k, v) {
        if (this._m.has(k)) this._m.delete(k);
        this._m.set(k, v);
        while (this._m.size > this.max) this._m.delete(this._m.keys().next().value);
        return v;
      }

      delete(k) {
        return this._m.delete(k);
      }

      clear() {
        this._m.clear();
      }

      get size() {
        return this._m.size;
      }
    }

    /* ----------------------------------------------------------- objects */

    /**
     * Realm-tolerant plain-object test: a bare `proto === Object.prototype`
     * comparison is false for objects created in another realm, which would
     * silently reject otherwise valid persisted settings.
     */
    function isPlainObject(v) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      const proto = Object.getPrototypeOf(v);
      if (proto === null || proto === Object.prototype) return true;
      return Object.getPrototypeOf(proto) === null;
    }

    function deepClone(v) {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(deepClone);
      if (v instanceof Date) return new Date(v.getTime());
      const out = {};
      for (const [k, item] of Object.entries(v)) out[k] = deepClone(item);
      return out;
    }

    function deepEqual(a, b) {
      if (a === b) return true;
      if (typeof a !== typeof b || a === null || b === null) return false;
      if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        return a.every((x, i) => deepEqual(x, b[i]));
      }
      if (typeof a === 'object') {
        if (typeof b !== 'object' || Array.isArray(b)) return false;
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        return ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
      }
      return false;
    }

    const clamp = (v, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);

    const unique = arr => [...new Set(arr || [])];

    /* -------------------------------------------------------------- text */

    const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    /**
     * `String.prototype.replace` with a *string* replacement interprets `$&`,
     * `` $` ``, `$'` and `$1`. File paths and user-authored prompt text can
     * contain those sequences, so every templated substitution goes through a
     * replacer function instead.
     */
    function substitute(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (m, k) =>
        Object.hasOwn(values, k) ? String(values[k]) : m
      );
    }

    const codePointCount = s => [...String(s)].length;

    function truncateMiddle(text, max = 64) {
      const v = String(text ?? '');
      if (v.length <= max) return v;
      const head = Math.ceil((max - 1) / 2);
      const tail = Math.floor((max - 1) / 2);
      return `${v.slice(0, head)}…${v.slice(v.length - tail)}`;
    }

    /**
     * Slices `str` starting at UTF-16 index `start`, taking at most `length`
     * units, without ever splitting a surrogate pair.
     *
     * Guarantees progress: the returned slice is empty only when `start`
     * is genuinely at or past the end of the string, and the caller is given
     * the exact next offset without splitting surrogate pairs.
     *
     * @returns {{text: string, next: number}}
     */
    function safeSlice(str, start, length) {
      const s = String(str);
      const len = s.length;
      if (start >= len || length <= 0) return { text: '', next: len };

      let from = Math.max(0, start);
      // Never begin on the low half of a pair that was already emitted.
      if (from > 0 && isLowSurrogate(s.charCodeAt(from)) && isHighSurrogate(s.charCodeAt(from - 1))) {
        from += 1;
      }
      if (from >= len) return { text: '', next: len };

      let to = Math.min(len, from + length);
      // Never end between the halves of a pair.
      if (to < len && isHighSurrogate(s.charCodeAt(to - 1)) && isLowSurrogate(s.charCodeAt(to))) {
        to -= 1;
      }
      // A one-unit budget landing on a high surrogate would otherwise produce
      // an empty slice and stall the caller; take the whole pair instead.
      if (to <= from) {
        to = Math.min(len, from + 2);
      }

      return { text: s.slice(from, to), next: to };
    }

    const isHighSurrogate = c => c >= 0xd800 && c <= 0xdbff;
    const isLowSurrogate = c => c >= 0xdc00 && c <= 0xdfff;

    /**
     * Linear glob matcher: `*` matches any run, `?` matches one character.
     * O(pattern x text) worst case with a single backtrack position, so it
     * cannot degrade exponentially the way an equivalent regular expression
     * does on `a*b*c*...*x` against a non-matching string.
     */
    function globMatch(pattern, text) {
      const p = pattern;
      const s = text;
      const pl = p.length;
      const sl = s.length;
      let pi = 0;
      let si = 0;
      let star = -1;
      let mark = 0;

      while (si < sl) {
        if (pi < pl && (p[pi] === '?' || p.charCodeAt(pi) === s.charCodeAt(si))) {
          pi += 1;
          si += 1;
        } else if (pi < pl && p[pi] === '*') {
          star = pi;
          mark = si;
          pi += 1;
        } else if (star !== -1) {
          pi = star + 1;
          mark += 1;
          si = mark;
        } else {
          return false;
        }
      }
      while (pi < pl && p[pi] === '*') pi += 1;
      return pi === pl;
    }

    /** Case-insensitive subsequence scoring for the filter box. */
    function fuzzyScore(needle, haystack) {
      const n = needle;
      const h = haystack.toLowerCase();
      if (!n) return 1;
      if (h === n) return 1000;
      if (h.startsWith(n)) return 900 - h.length * 0.1;
      const idx = h.indexOf(n);
      if (idx >= 0) return 800 - idx - h.length * 0.05;
      let hi = 0;
      let score = 0;
      let streak = 0;
      for (let ni = 0; ni < n.length; ni += 1) {
        const found = h.indexOf(n[ni], hi);
        if (found < 0) return 0;
        streak = found === hi ? streak + 1 : 0;
        score += 10 + streak * 4 - Math.min(found - hi, 8);
        hi = found + 1;
      }
      return Math.max(1, score);
    }

    /* ------------------------------------------------------------ format */

    function formatSize(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
      return `${(bytes / 1073741824).toFixed(2)} GB`;
    }

    function formatCount(n) {
      if (!Number.isFinite(n)) return '—';
      if (n < 1000) return String(n);
      if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
      return `${(n / 1000000).toFixed(1)}M`;
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '—';
      if (ms < 1000) return `${Math.round(ms)} ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
      return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    }

    function formatDateTime(ts) {
      if (!Number.isFinite(ts)) return '—';
      try {
        return new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(ts));
      } catch {
        return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
      }
    }

    /**
     * Token estimate for the packed payload. Deliberately labelled as an
     * estimate everywhere it is shown: tokenisers differ per model, and the
     * only honest claim is an order-of-magnitude figure. ~3.6 characters per
     * token is a reasonable central value for source code across the common
     * BPE tokenisers, which run denser than prose because of punctuation.
     */
    const CHARS_PER_TOKEN = 3.6;
    const estimateTokens = chars => Math.round(Math.max(0, chars) / CHARS_PER_TOKEN);

    /* --------------------------------------------------------------- paths */

    /**
     * Normalises a path from any ingestion source into the single internal
     * form the rest of the script relies on: forward slashes, no leading
     * slash, no `.` segments, resolved `..`, and no empty segments.
     */
    function normalizePath(raw) {
      let p = String(raw ?? '').replace(/\\/g, '/');
      p = p.replace(/^[a-zA-Z]:\//, '');
      const out = [];
      for (const seg of p.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') {
          if (out.length) out.pop();
          continue;
        }
        out.push(seg);
      }
      return out.join('/');
    }

    const basename = p => {
      const s = String(p ?? '');
      const i = s.lastIndexOf('/');
      return i < 0 ? s : s.slice(i + 1);
    };

    const dirname = p => {
      const s = String(p ?? '');
      const i = s.lastIndexOf('/');
      return i < 0 ? '' : s.slice(0, i);
    };

    /**
     * Extension including the dot, lowercased. A leading dot does not start an
     * extension (`.gitignore` has none), which is what every consumer here
     * wants; `.min.js` style compound suffixes are handled by the filter with
     * an explicit `endsWith` test rather than by this function.
     */
    function extname(p) {
      const name = basename(p).toLowerCase();
      const i = name.lastIndexOf('.');
      return i > 0 ? name.slice(i) : '';
    }

    /** All ancestor directory paths of a file path, outermost first. */
    function ancestors(path) {
      const parts = String(path).split('/');
      parts.pop();
      const out = [];
      let cur = '';
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        out.push(cur);
      }
      return out;
    }

    /* --------------------------------------------------------------- DOM */

    /**
     * Element factory. Text is only ever assigned through `textContent`, and
     * there is deliberately no `innerHTML` path anywhere in this script, so it
     * runs unmodified under the Trusted Types policies enforced on
     * gemini.google.com and aistudio.google.com.
     */
    const DOM_PROPS = new Set([
      'id', 'title', 'type', 'placeholder', 'autocomplete', 'rows', 'cols',
      'spellcheck', 'value', 'checked', 'disabled', 'min', 'max', 'step',
      'maxLength', 'readOnly', 'draggable', 'multiple', 'accept'
    ]);

    function el(tag, props = {}, children = []) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'cls') {
          node.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
        } else if (k === 'txt') {
          node.textContent = String(v);
        } else if (k === 'style' && typeof v === 'object') {
          for (const [prop, val] of Object.entries(v)) {
            if (val !== null && val !== undefined) node.style.setProperty(prop, String(val));
          }
        } else if (k === 'dataset' && typeof v === 'object') {
          for (const [prop, val] of Object.entries(v)) {
            if (val !== null && val !== undefined) node.dataset[prop] = String(val);
          }
        } else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (DOM_PROPS.has(k)) {
          node[k] = v;
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      }
      append(node, children);
      return node;
    }

    function append(parent, children) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c === null || c === undefined || c === false || c === true) continue;
        if (Array.isArray(c)) append(parent, c);
        else if (c instanceof Node) parent.appendChild(c);
        else parent.appendChild(document.createTextNode(String(c)));
      }
    }

    function clear(node) {
      if (!node) return node;
      while (node.firstChild) node.removeChild(node.firstChild);
      return node;
    }

    /** Replaces children in one pass to avoid intermediate layout work. */
    function render(node, children) {
      if (!node) return node;
      const frag = document.createDocumentFragment();
      append(frag, children);
      clear(node);
      node.appendChild(frag);
      return node;
    }

    return {
      sleep,
      yieldToUI,
      debounce,
      throttle,
      rafBatch,
      TaskQueue,
      CancelledError,
      isCancellation,
      throwIfAborted,
      uid,
      hashString,
      LruCache,
      isPlainObject,
      deepClone,
      deepEqual,
      clamp,
      unique,
      escapeRegExp,
      substitute,
      codePointCount,
      truncateMiddle,
      safeSlice,
      globMatch,
      fuzzyScore,
      formatSize,
      formatCount,
      formatDuration,
      formatDateTime,
      CHARS_PER_TOKEN,
      estimateTokens,
      normalizePath,
      basename,
      dirname,
      extname,
      ancestors,
      el,
      append,
      clear,
      render
    };
  })();

  /* =======================================================================
   * SECTION 03 — Product data: file classification, defaults, site profiles
   * -----------------------------------------------------------------------
   * File extension and name classification tables for text and binary detection.
   * ==================================================================== */

  const data = (() => {
    /* ------------------------------------------------ text classification */

    /** Known text file extensions. */
    const TEXT_EXTS = new Set([
      '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
      '.java', '.kt', '.kts', '.swift', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.cs', '.php',
      '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl', '.json', '.jsonc', '.json5',
      '.yaml', '.yml', '.toml', '.xml', '.md', '.mdx', '.markdown', '.txt', '.csv', '.tsv',
      '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql',
      '.vue', '.svelte', '.astro', '.env', '.ini', '.cfg', '.conf', '.config', '.properties',
      '.r', '.lua', '.pl', '.pm', '.scala', '.clj', '.cljs', '.edn', '.ex', '.exs',
      '.elm', '.hs', '.lhs', '.ml', '.mli', '.fs', '.fsx', '.fsi', '.dart', '.gradle',
      '.proto', '.thrift', '.prisma', '.tf', '.tfvars', '.hcl', '.nim', '.cr', '.d', '.zig', '.v', '.sv', '.svh',
      '.gitignore', '.dockerignore', '.npmignore', '.editorconfig',
      '.gitattributes', '.gitmodules', '.babelrc', '.stylelintrc', '.rspec', '.nvmrc',
      // additions: common in modern repositories and unambiguously text
      '.mts', '.cts', '.pyi', '.ipynb', '.rake', '.gemspec', '.podspec', '.cmake',
      '.bazel', '.bzl', '.nix', '.sol', '.move', '.zsh-theme', '.applescript',
      '.tex', '.bib', '.rst', '.adoc', '.asciidoc', '.org', '.tf.json', '.tfstate',
      '.jsonl', '.ndjson', '.http', '.rest', '.feature', '.cue', '.jsonnet', '.libsonnet',
      '.snap', '.patch', '.diff', '.plist', '.strings', '.resx', '.csproj', '.fsproj',
      '.vbproj', '.sln', '.pu', '.puml', '.mermaid', '.mmd', '.gd', '.tres', '.tscn',
      '.erb', '.haml', '.slim', '.twig', '.njk', '.hbs', '.mustache', '.ejs', '.pug', '.jade',
      '.avsc', '.smithy', '.raml', '.openapi', '.swagger'
    ]);

    /** Known binary file extensions. */
    const BINARY_EXTS = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif',
      '.mp4', '.mp3', '.wav', '.avi', '.mov', '.mkv', '.flv', '.webm', '.ogg', '.oga', '.m4a', '.aac', '.flac',
      '.zip', '.gz', '.tar', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.lz', '.zst',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
      '.exe', '.dll', '.so', '.dylib', '.a', '.lib', '.wasm', '.node', '.jar', '.war',
      '.woff', '.woff2', '.ttf', '.eot', '.otf', '.fon',
      '.sqlite', '.db', '.sqlite3', '.mdb', '.dbf', '.pickle', '.pkl',
      // additions
      '.class', '.o', '.obj', '.pyc', '.pyo', '.pyd', '.bin', '.dat', '.dmg', '.iso',
      '.apk', '.aab', '.ipa', '.msi', '.deb', '.rpm', '.pak', '.bundle', '.nupkg',
      '.psd', '.ai', '.sketch', '.fig', '.blend', '.fbx', '.glb', '.gltf', '.obj3d',
      '.parquet', '.orc', '.avro', '.feather', '.arrow', '.npy', '.npz', '.pt', '.pth',
      '.onnx', '.safetensors', '.gguf', '.ggml', '.h5', '.hdf5', '.tflite', '.mlmodel'
    ]);

    /** Known text filenames without extensions. */
    const TEXT_FILENAMES = new Set([
      'dockerfile', 'makefile', 'justfile', 'rakefile', 'gemfile', 'brewfile',
      'procfile', 'vagrantfile', 'license', 'licence', 'readme', 'changelog',
      'contributing', 'authors', 'thanks', 'todo', 'notice',
      '.env', '.eslintrc', '.prettierrc', '.node-version', '.python-version', '.ruby-version',
      // additions
      'cmakelists.txt', 'cargo.lock', 'gemfile.lock', 'pipfile', 'pipfile.lock',
      'go.sum', 'go.mod', 'requirements.txt', 'setup.py', 'setup.cfg', 'pyproject.toml',
      'codeowners', 'security', 'copying', 'install', 'news', 'history', 'maintainers',
      '.gitignore', '.gitattributes', '.dockerignore', '.npmrc', '.yarnrc', '.nvmrc',
      '.editorconfig', '.babelrc', '.browserslistrc', '.eslintignore', '.prettierignore',
      '.gitkeep', '.gitmodules', '.mailmap', '.tool-versions'
    ]);

    /**
     * Extensions that must never be treated as documentation by the DOCS
     * preset even though they are text-ish, because they are the payload the
     * user usually wants under CODE.
     */
    const DOC_EXTS = new Set([
      '.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.asciidoc', '.org',
      '.doc', '.docx', '.pdf', '.tex'
    ]);

    const DOC_NAMES = new Set([
      'readme', 'changelog', 'license', 'licence', 'contributing', 'notice',
      'authors', 'security', 'copying', 'code_of_conduct', 'codeowners', 'history', 'news'
    ]);

    /** Configuration and metadata files, for the CONFIG preset. */
    const CONFIG_EXTS = new Set([
      '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg',
      '.conf', '.config', '.properties', '.env', '.editorconfig', '.lock',
      '.gradle', '.tf', '.tfvars', '.hcl', '.nix', '.bazel', '.bzl', '.cmake'
    ]);

    const CONFIG_NAMES = new Set([
      'dockerfile', 'makefile', 'justfile', 'procfile', 'vagrantfile',
      'package.json', 'tsconfig.json', 'cmakelists.txt', '.npmrc', '.yarnrc',
      '.gitignore', '.dockerignore', '.gitattributes', '.babelrc', '.prettierrc',
      '.eslintrc', '.browserslistrc', '.nvmrc', '.tool-versions'
    ]);

    /** Test files, for the TESTS preset and for the "exclude tests" filter. */
    const TEST_PATH_HINTS = [
      '/test/', '/tests/', '/__tests__/', '/spec/', '/specs/', '/e2e/',
      '/cypress/', '/playwright/', '/testdata/', '/fixtures/', '/__mocks__/',
      '/__snapshots__/'
    ];
    const TEST_NAME_RX = /(?:^|[.\-_])(?:test|tests|spec|specs|e2e|bench|benchmark)(?:[.\-_]|$)/i;

    /* ---------------------------------------------------------- defaults */

    /**
     * Default list constants stored pre-lowercased to ensure idempotent
     * validation and optimal lookup set performance.
     */
    const DEFAULT_IGNORE_FOLDERS =
      'node_modules,__pycache__,dist,build,venv,.next,.nuxt,.idea,.vscode,coverage,.git,out,tmp,temp,.cache,.parcel-cache,vendor,pods,target,bin,obj,.angular,.svelte-kit';

    const DEFAULT_IGNORE_EXTS =
      '.pyc,.pyo,.log,.lock,.map,.ds_store,.min.js,.min.css,.exe,.dll,.so,.dylib,.bin,.o,.obj,.class';

    /** Built-in, non-deletable filter profiles the user can switch between. */
    const BUILTIN_PROFILES = [
      {
        id: 'builtin:default',
        name: 'Default',
        builtin: true,
        ignoreFolders: DEFAULT_IGNORE_FOLDERS,
        ignoreExts: DEFAULT_IGNORE_EXTS
      },
      {
        id: 'builtin:lean',
        name: 'Lean (source only)',
        builtin: true,
        ignoreFolders:
          `${DEFAULT_IGNORE_FOLDERS},docs,doc,examples,example,samples,fixtures,__snapshots__,storybook-static,.storybook,public,static,assets,locales,i18n,migrations`,
        ignoreExts:
          `${DEFAULT_IGNORE_EXTS},.snap,.md,.mdx,.markdown,.csv,.tsv,.svg,.png,.jpg,.jpeg,.gif,.webp,.ico`
      },
      {
        id: 'builtin:everything',
        name: 'Everything (VCS only)',
        builtin: true,
        ignoreFolders: '.git',
        ignoreExts: ''
      }
    ];

    const DEFAULT_SETTINGS = {
      /* --- default limits --- */
      maxChunks: 10,
      maxFileBytes: 2_000_000,
      maxChunkChars: 480_000,
      ignoreFolders: DEFAULT_IGNORE_FOLDERS,
      ignoreExts: DEFAULT_IGNORE_EXTS,
      skipHidden: true,
      includeBinary: false,
      customPrompt: '',
      shortcutKey: 'u',

      /* --- new: filtering --- */
      activeProfile: 'builtin:default',
      userProfiles: [],
      useGitignore: true,
      extraIgnoreGlobs: '',
      excludeTests: false,
      excludeLockfiles: true,
      maxTotalFiles: 5000,

      /* --- new: packing --- */
      includeTree: true,
      includeLineNumbers: false,
      stripTrailingWhitespace: false,
      collapseBlankLines: false,
      sortOrder: 'path',
      manifestStats: true,
      chunkNaming: 'part',

      /* --- new: delivery --- */
      deliveryMode: 'upload',
      closeOnDeliver: true,
      combineOnDownload: true,
      autoRetryAsCopy: true,

      /* --- new: interface --- */
      theme: 'crt',
      density: 'comfortable',
      reduceMotion: false,
      confirmDestructive: true,
      rememberSelection: true,
      virtualiseThreshold: 400,

      /* --- new: diagnostics --- */
      debug: false
    };

    /* ------------------------------------------------------ site profiles */

    /**
     * Per-site behaviour is declared in one table, so site quirks are handled cleanly
     * and the diagnostics panel can show which profile matched.
     *
     * `selectors` holds ONLY genuinely site-specific selectors. Generic ones
     * (`input[type=file]`, `input[type=file][multiple]`) are appended as a universal
     * fallback ladder in section 10, ensuring specific inputs take priority over generic inputs.
     */
    const SITE_PROFILES = [
      {
        id: 'chatgpt',
        label: 'ChatGPT',
        test: h => /(^|\.)chatgpt\.com$/i.test(h) || /(^|\.)openai\.com$/i.test(h),
        selectors: ['input[data-testid="file-upload-input"]'],
        composer: ['#prompt-textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'claude',
        label: 'Claude',
        test: h => /(^|\.)claude\.ai$/i.test(h),
        selectors: ['input[data-testid="file-upload"]'],
        composer: ['div[contenteditable="true"]', 'div.ProseMirror']
      },
      {
        id: 'gemini',
        label: 'Gemini / AI Studio',
        test: h => /(^|\.)gemini\.google\.com$/i.test(h) || /(^|\.)aistudio\.google\.com$/i.test(h),
        selectors: [],
        composer: ['div[contenteditable="true"]', 'textarea'],
        // Both enforce Trusted Types; recorded so diagnostics can say so.
        trustedTypes: true
      },
      {
        id: 'deepseek',
        label: 'DeepSeek',
        test: h => /(^|\.)deepseek\.com$/i.test(h),
        selectors: ['input.chat-upload__input'],
        composer: ['#chat-input', 'textarea']
      },
      {
        id: 'perplexity',
        label: 'Perplexity',
        test: h => /(^|\.)perplexity\.ai$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'grok',
        label: 'Grok',
        test: h => /(^|\.)grok\.com$/i.test(h) || /(^|\.)x\.ai$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'mistral',
        label: 'Mistral',
        test: h => /(^|\.)mistral\.ai$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'copilot',
        label: 'Microsoft Copilot',
        test: h => /(^|\.)copilot\.microsoft\.com$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'huggingface',
        label: 'HuggingChat',
        test: h => /(^|\.)huggingface\.co$/i.test(h),
        selectors: [],
        composer: ['textarea']
      },
      {
        id: 'qwen',
        label: 'Qwen',
        test: h => /(^|\.)qwen\.ai$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]'],
        // Qwen's composer rejects synthetically populated file inputs,
        // so chatInjection is disabled with the reason surfaced in the UI.
        chatInjection: false,
        injectionNote: 'Qwen rejects programmatically attached files; copy or download instead.'
      },
      {
        id: 'kimi',
        label: 'Kimi',
        test: h => /(^|\.)kimi\.com$/i.test(h) || /(^|\.)moonshot\.cn$/i.test(h),
        selectors: [],
        composer: ['div[contenteditable="true"]', 'textarea']
      },
      {
        id: 'zai',
        label: 'Z.ai',
        test: h => /(^|\.)z\.ai$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'openrouter',
        label: 'OpenRouter',
        test: h => /(^|\.)openrouter\.ai$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'groq',
        label: 'Groq',
        test: h => /(^|\.)groq\.com$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'meta',
        label: 'Meta AI',
        test: h => /(^|\.)meta\.ai$/i.test(h),
        selectors: [],
        composer: ['div[contenteditable="true"]', 'textarea']
      },
      {
        id: 'arena',
        label: 'Chatbot Arena',
        test: h => /(^|\.)lmarena\.ai$/i.test(h) || /(^|\.)arena\.ai$/i.test(h) || /(^|\.)lmsys\.org$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'mimo',
        label: 'Xiaomi MiMo',
        test: h => /(^|\.)aistudio\.xiaomimimo\.com$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      },
      {
        id: 'minimax',
        label: 'MiniMax Agent',
        test: h => /(^|\.)minimax\.io$/i.test(h),
        selectors: [],
        composer: ['textarea', 'div[contenteditable="true"]']
      }
    ];

    /**
     * Fallback for an unrecognised host. Relies on the universal
     * ladder appended in section 10.
     */
    const GENERIC_PROFILE = {
      id: 'generic',
      label: 'Generic',
      selectors: [],
      composer: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea', 'input[type="text"]']
    };

    function siteProfile(hostname = location.hostname) {
      for (const p of SITE_PROFILES) {
        try {
          if (p.test(hostname)) return p;
        } catch {
          /* a malformed profile must not break detection */
        }
      }
      return GENERIC_PROFILE;
    }

    /* ------------------------------------------------------------ limits */

    const LIMITS = {
      // Guardrails on user-editable numbers. Chosen so that any value inside
      // the range produces a usable payload rather than an unusable one.
      maxChunks: { min: 1, max: 200 },
      maxFileBytes: { min: 1_000, max: 64_000_000 },
      maxChunkChars: { min: 5_000, max: 4_000_000 },
      maxTotalFiles: { min: 100, max: 200_000 },
      virtualiseThreshold: { min: 50, max: 20_000 }
    };

    const TOAST_DURATION = 2600;
    const TOAST_FADE_MS = 260;
    const CHUNK_OVERHEAD_CHARS = 100;
    const LIMIT_WARNING_THRESHOLD = 0.7;
    const REVOCATION_DELAY_MS = 60_000;
    const BINARY_SNIFF_BYTES = 4096;
    /**
     * How long to watch the page for evidence that it accepted an upload.
     * Long enough for a composer to render an attachment chip or issue its
     * request, short enough that a genuinely unresponsive page is reported
     * promptly rather than leaving the user waiting.
     */
    const UPLOAD_VERIFY_MS = 6000;

    return {
      TEXT_EXTS,
      BINARY_EXTS,
      TEXT_FILENAMES,
      DOC_EXTS,
      DOC_NAMES,
      CONFIG_EXTS,
      CONFIG_NAMES,
      TEST_PATH_HINTS,
      TEST_NAME_RX,
      DEFAULT_IGNORE_FOLDERS,
      DEFAULT_IGNORE_EXTS,
      BUILTIN_PROFILES,
      DEFAULT_SETTINGS,
      SITE_PROFILES,
      GENERIC_PROFILE,
      siteProfile,
      LIMITS,
      TOAST_DURATION,
      TOAST_FADE_MS,
      CHUNK_OVERHEAD_CHARS,
      LIMIT_WARNING_THRESHOLD,
      REVOCATION_DELAY_MS,
      BINARY_SNIFF_BYTES,
      UPLOAD_VERIFY_MS
    };
  })();

  /* =======================================================================
   * SECTION 04 — Settings store
   * -----------------------------------------------------------------------
   * Settings persistence architecture:
   *
   *  1. Strict validation. Prevents invalid numeric configurations from poisoning
   *     arithmetic expressions and packing logic.
   *  2. Forward versioning. Allows schema evolution with seamless migrations.
   *  3. Centralized manager storage. Shared backing store with cross-tab synchronisation.
   *
   * The replacement is a declarative schema of `[default, validator]` pairs, a
   * numbered forward-only migration chain, repair-rather-than-reset semantics
   * (a damaged value is coerced and the repair is recorded for diagnostics),
   * and a single shared backing store with cross-tab synchronisation.
   * ==================================================================== */

  const store = (() => {
    const KEY = 'settings';
    const SESSION_KEY = 'session';
    const LEGACY_LS_KEY = 'cu-settings';
    const SCHEMA_VERSION = 2;

    /* -------------------------------------------------------- validators */

    const V = {
      bool: d => v => (typeof v === 'boolean' ? v : d),

      int: (min, max, d) => v => {
        const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
        if (!Number.isFinite(n)) return d;
        return util.clamp(Math.round(n), min, max);
      },

      enumOf: (allowed, d) => v => (allowed.includes(v) ? v : d),

      text: (maxLen, d = '') => v => (typeof v === 'string' ? v.slice(0, maxLen) : d),

      /** Comma-separated token list, normalised, de-duplicated, bounded. */
      csv: (maxItems, maxLen) => v => {
        if (typeof v !== 'string') return '';
        const seen = new Set();
        const out = [];
        for (const raw of v.split(',')) {
          const t = raw.trim().toLowerCase();
          if (!t || t.length > maxLen) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push(t);
          if (out.length >= maxItems) break;
        }
        return out.join(',');
      },

      /** Newline- or comma-separated glob list. */
      globs: (maxItems, maxLen) => v => {
        if (typeof v !== 'string') return '';
        const seen = new Set();
        const out = [];
        for (const raw of v.split(/[\n,]/)) {
          const t = raw.trim();
          if (!t || t.length > maxLen) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push(t);
          if (out.length >= maxItems) break;
        }
        return out.join('\n');
      },

      /**
       * A single printable character used as the hotkey letter. Digits and
       * punctuation are accepted; whitespace and multi-character input are
       * not, because `Alt+Shift+<key>` needs exactly one key to compare.
       */
      hotkey: d => v => {
        if (typeof v !== 'string') return d;
        const s = v.trim().toLowerCase();
        if (s.length !== 1 || /\s/.test(s)) return d;
        return s;
      },

      profiles: () => v => {
        if (!Array.isArray(v)) return [];
        const out = [];
        const seen = new Set();
        for (const p of v.slice(0, 40)) {
          if (!util.isPlainObject(p)) continue;
          const name = typeof p.name === 'string' ? p.name.trim().slice(0, 48) : '';
          if (!name) continue;
          const id = typeof p.id === 'string' && p.id.startsWith('user:')
            ? p.id.slice(0, 64)
            : `user:${util.hashString(name)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
            id,
            name,
            builtin: false,
            ignoreFolders: V.csv(300, 80)(p.ignoreFolders),
            ignoreExts: V.csv(300, 80)(p.ignoreExts),
            extraIgnoreGlobs: V.globs(200, 200)(p.extraIgnoreGlobs)
          });
        }
        return out;
      }
    };

    /* ------------------------------------------------------------ schema */

    const D = data.DEFAULT_SETTINGS;
    const L = data.LIMITS;

    const schema = {
      /* --- core options --- */
      maxChunks: [D.maxChunks, V.int(L.maxChunks.min, L.maxChunks.max, D.maxChunks)],
      maxFileBytes: [D.maxFileBytes, V.int(L.maxFileBytes.min, L.maxFileBytes.max, D.maxFileBytes)],
      maxChunkChars: [D.maxChunkChars, V.int(L.maxChunkChars.min, L.maxChunkChars.max, D.maxChunkChars)],
      ignoreFolders: [D.ignoreFolders, V.csv(500, 80)],
      ignoreExts: [D.ignoreExts, V.csv(500, 80)],
      skipHidden: [D.skipHidden, V.bool(D.skipHidden)],
      includeBinary: [D.includeBinary, V.bool(D.includeBinary)],
      customPrompt: [D.customPrompt, V.text(8000, '')],
      shortcutKey: [D.shortcutKey, V.hotkey(D.shortcutKey)],

      /* --- filtering --- */
      activeProfile: [D.activeProfile, V.text(64, D.activeProfile)],
      userProfiles: [[], V.profiles()],
      useGitignore: [D.useGitignore, V.bool(D.useGitignore)],
      extraIgnoreGlobs: [D.extraIgnoreGlobs, V.globs(400, 200)],
      excludeTests: [D.excludeTests, V.bool(D.excludeTests)],
      excludeLockfiles: [D.excludeLockfiles, V.bool(D.excludeLockfiles)],
      maxTotalFiles: [D.maxTotalFiles, V.int(L.maxTotalFiles.min, L.maxTotalFiles.max, D.maxTotalFiles)],

      /* --- packing --- */
      includeTree: [D.includeTree, V.bool(D.includeTree)],
      includeLineNumbers: [D.includeLineNumbers, V.bool(D.includeLineNumbers)],
      stripTrailingWhitespace: [D.stripTrailingWhitespace, V.bool(D.stripTrailingWhitespace)],
      collapseBlankLines: [D.collapseBlankLines, V.bool(D.collapseBlankLines)],
      sortOrder: [D.sortOrder, V.enumOf(['path', 'size-desc', 'size-asc', 'ext'], D.sortOrder)],
      manifestStats: [D.manifestStats, V.bool(D.manifestStats)],
      chunkNaming: [D.chunkNaming, V.enumOf(['part', 'indexed'], D.chunkNaming)],

      /* --- delivery --- */
      deliveryMode: [D.deliveryMode, V.enumOf(['upload', 'download', 'copy'], D.deliveryMode)],
      closeOnDeliver: [D.closeOnDeliver, V.bool(D.closeOnDeliver)],
      combineOnDownload: [D.combineOnDownload, V.bool(D.combineOnDownload)],
      autoRetryAsCopy: [D.autoRetryAsCopy, V.bool(D.autoRetryAsCopy)],

      /* --- interface --- */
      theme: [D.theme, V.enumOf(['crt', 'slate', 'light'], D.theme)],
      density: [D.density, V.enumOf(['comfortable', 'compact'], D.density)],
      reduceMotion: [D.reduceMotion, V.bool(D.reduceMotion)],
      confirmDestructive: [D.confirmDestructive, V.bool(D.confirmDestructive)],
      rememberSelection: [D.rememberSelection, V.bool(D.rememberSelection)],
      virtualiseThreshold: [
        D.virtualiseThreshold,
        V.int(L.virtualiseThreshold.min, L.virtualiseThreshold.max, D.virtualiseThreshold)
      ],

      /* --- diagnostics --- */
      debug: [D.debug, V.bool(D.debug)]
    };

    const defaults = Object.freeze(
      Object.fromEntries(Object.entries(schema).map(([k, [d]]) => [k, util.deepClone(d)]))
    );

    /* -------------------------------------------------------- migrations */

    /**
     * Forward-only and idempotent. A throwing step is logged and skipped so a
     * single bad migration can never brick an installation.
     */
    const migrations = [
      {
        version: 1,
        description: 'Adopt the 1.x localStorage shape',
        apply(raw) {
          // 1.x stored nine core keys; they keep their names and meanings.
          // Coerce values to ensure proper types.
          if (typeof raw.shortcutKey === 'string' && raw.shortcutKey.length > 1) {
            raw.shortcutKey = raw.shortcutKey.trim().charAt(0).toLowerCase();
          }
          return raw;
        }
      },
      {
        version: 2,
        description: 'Introduce filter profiles, packing and delivery options',
        apply(raw) {
          // A 1.x user's customised lists become the seed of their active
          // profile so the upgrade is invisible to them.
          if (!Array.isArray(raw.userProfiles)) raw.userProfiles = [];
          const folders = typeof raw.ignoreFolders === 'string' ? raw.ignoreFolders : '';
          const exts = typeof raw.ignoreExts === 'string' ? raw.ignoreExts : '';
          const customised =
            (folders && folders !== data.DEFAULT_IGNORE_FOLDERS) ||
            (exts && exts !== data.DEFAULT_IGNORE_EXTS);
          if (customised && !raw.activeProfile) {
            raw.userProfiles.push({
              id: 'user:imported',
              name: 'Imported (1.x)',
              ignoreFolders: folders,
              ignoreExts: exts,
              extraIgnoreGlobs: ''
            });
            raw.activeProfile = 'user:imported';
          }
          return raw;
        }
      }
    ];

    /* --------------------------------------------------------- internals */

    let state = util.deepClone(defaults);
    /**
     * Bumped on every accepted change. Hot paths compare this integer instead
     * of building a signature string or deep-cloning the settings object.
     */
    let revision = 0;
    let loaded = false;
    let readOnly = false;
    let unwatch = null;
    const listeners = new Set();
    const repairs = [];

    function sanitize(raw) {
      const src = util.isPlainObject(raw) ? raw : {};
      const out = {};

      for (const [key, [dflt, validate]] of Object.entries(schema)) {
        const missing = src[key] === undefined;
        const provided = missing ? util.deepClone(dflt) : src[key];

        let value;
        try {
          // Defaults go through their own validator too. Without that, a
          // stored default and a validated default can differ, and the first
          // unrelated write then reports spurious "changes".
          value = validate(provided);
        } catch (e) {
          env.log.warn(`validator for "${key}" threw; using default`, e);
          value = util.deepClone(dflt);
        }
        if (value === undefined) value = util.deepClone(dflt);
        if (!missing && !util.deepEqual(value, provided)) repairs.push({ key, from: provided, to: value });
        out[key] = value;
      }

      /* --- cross-key invariants, re-established on every write ---------- */

      // The active profile must exist, or the filter layer would silently fall
      // back to an unrelated list without telling anyone.
      const known = new Set([
        ...data.BUILTIN_PROFILES.map(p => p.id),
        ...out.userProfiles.map(p => p.id)
      ]);
      if (!known.has(out.activeProfile)) {
        repairs.push({ key: 'activeProfile', from: out.activeProfile, to: 'builtin:default' });
        out.activeProfile = 'builtin:default';
      }

      // A per-chunk budget below the per-file budget makes every file split,
      // which is legal but almost never intended; the reverse (a file budget
      // larger than a chunk) is genuinely broken because a single file could
      // never fit. Nudge the chunk budget up rather than silently truncating.
      const minChunk = data.LIMITS.maxChunkChars.min;
      if (out.maxChunkChars < minChunk) {
        repairs.push({ key: 'maxChunkChars', from: out.maxChunkChars, to: minChunk });
        out.maxChunkChars = minChunk;
      }

      return out;
    }

    function runMigrations(raw) {
      if (!util.isPlainObject(raw)) return { __v: SCHEMA_VERSION };
      let current = Number.isFinite(raw.__v) ? raw.__v : 0;
      for (const m of migrations) {
        if (current >= m.version) continue;
        try {
          raw = m.apply(raw) || raw;
          env.log.debug(`migration ${m.version} applied: ${m.description}`);
        } catch (e) {
          env.log.error(`migration ${m.version} failed`, e);
        }
        current = m.version;
      }
      raw.__v = SCHEMA_VERSION;
      return raw;
    }

    /* -------------------------------------------------------- persistence */

    const persist = util.debounce(async () => {
      const payload = { ...util.deepClone(state), __v: SCHEMA_VERSION };
      const ok = await env.storage.set(KEY, payload);
      if (!ok && !readOnly) {
        readOnly = true;
        emit({ type: 'readonly' });
      } else if (ok && readOnly) {
        readOnly = false;
      }
    }, 200);

    function emit(detail) {
      for (const fn of [...listeners]) {
        try {
          fn(state, detail);
        } catch (e) {
          env.log.error('settings listener threw', e);
        }
      }
    }

    async function load() {
      if (loaded) return state;

      let raw = await env.storage.get(KEY, null);

      // A manager that round-trips objects as JSON strings.
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          env.log.warn('stored settings were an unparsable string; starting fresh');
          raw = null;
        }
      }

      // First run under 2.x on a site where 1.x already ran: adopt the old
      // per-origin settings rather than resetting the user to defaults.
      let migratedFromLegacy = false;
      if (!util.isPlainObject(raw)) {
        const legacy = env.storage.legacyLocalRead(LEGACY_LS_KEY);
        if (util.isPlainObject(legacy)) {
          raw = { ...legacy, __v: 0 };
          migratedFromLegacy = true;
          env.log.info('migrated settings from the 1.x localStorage key');
        }
      }

      repairs.length = 0;
      state = sanitize(runMigrations(raw));
      revision += 1;
      loaded = true;
      env.log.setDebug(state.debug);

      if (!env.capabilities.gmStorage && !env.capabilities.localStorage) {
        readOnly = true;
      }

      if (repairs.length || migratedFromLegacy) {
        if (repairs.length) {
          env.log.warn(
            `repaired ${repairs.length} stored setting(s): ${util.unique(repairs.map(r => r.key)).join(', ')}`
          );
        }
        // Write the repaired/migrated state back so the same work is not
        // redone on every page load.
        persist();
      }

      unwatch = env.storage.watch(KEY, ({ newValue, remote }) => {
        if (!remote) return;
        try {
          const parsed = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
          const next = sanitize(runMigrations(parsed));
          if (util.deepEqual(next, state)) return;
          state = next;
          revision += 1;
          env.log.setDebug(state.debug);
          emit({ type: 'remote' });
        } catch (e) {
          env.log.warn('remote settings update ignored', e);
        }
      });

      return state;
    }

    /* --------------------------------------------------------- accessors */

    function get(key) {
      if (!Object.hasOwn(schema, key)) {
        env.log.warn(`unknown setting read: ${key}`);
        return undefined;
      }
      const v = state[key];
      return typeof v === 'object' && v !== null ? util.deepClone(v) : v;
    }

    const all = () => util.deepClone(state);

    /**
     * The live settings object, without cloning. Read-only by contract: it is
     * used only where a clone-per-call would show up in a hot path (the policy
     * compiler and the stats pass, both of which run on every model access).
     * Mutating it would bypass validation, so nothing does.
     */
    const raw = () => state;

    /** Monotonic revision, for cheap change detection. */
    const getRevision = () => revision;

    /**
     * Applies a patch and re-validates the *whole* object, so cross-key
     * invariants hold after every write rather than only after a load.
     * @returns {string[]} the keys that actually changed
     */
    function set(patch, { silent = false } = {}) {
      if (!util.isPlainObject(patch)) return [];

      const candidate = { ...state };
      for (const [k, v] of Object.entries(patch)) {
        if (!Object.hasOwn(schema, k)) {
          env.log.warn(`unknown setting write ignored: ${k}`);
          continue;
        }
        candidate[k] = v;
      }

      const next = sanitize(candidate);
      const changed = Object.keys(schema).filter(k => !util.deepEqual(next[k], state[k]));
      if (!changed.length) return [];

      state = next;
      revision += 1;
      env.log.setDebug(state.debug);
      persist();
      if (!silent) emit({ type: 'local', changed });
      return changed;
    }

    function reset() {
      state = sanitize({});
      revision += 1;
      persist();
      emit({ type: 'reset', changed: Object.keys(schema) });
      return state;
    }

    function subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    /* ---------------------------------------------------------- profiles */

    function profiles() {
      return [...data.BUILTIN_PROFILES.map(p => ({ ...p, extraIgnoreGlobs: '' })), ...state.userProfiles];
    }

    function activeProfile() {
      return profiles().find(p => p.id === state.activeProfile) || data.BUILTIN_PROFILES[0];
    }

    /**
     * Switching profile rewrites the live ignore lists, because those lists
     * are what the filter reads. Keeping two sources of truth (a profile and a
     * separate live list) is exactly the kind of divergence this rebuild is
     * meant to eliminate.
     */
    function applyProfile(id) {
      const p = profiles().find(x => x.id === id);
      if (!p) return false;
      set({
        activeProfile: p.id,
        ignoreFolders: p.ignoreFolders,
        ignoreExts: p.ignoreExts,
        extraIgnoreGlobs: p.extraIgnoreGlobs || ''
      });
      return true;
    }

    /** Saves the live lists as a new named profile, or updates an existing one. */
    function saveProfile(name) {
      const trimmed = String(name || '').trim().slice(0, 48);
      if (!trimmed) return { ok: false, reason: 'name' };

      const existing = state.userProfiles.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
      const entry = {
        id: existing?.id || `user:${util.hashString(trimmed + Date.now())}`,
        name: trimmed,
        builtin: false,
        ignoreFolders: state.ignoreFolders,
        ignoreExts: state.ignoreExts,
        extraIgnoreGlobs: state.extraIgnoreGlobs
      };
      const list = existing
        ? state.userProfiles.map(p => (p.id === existing.id ? entry : p))
        : [...state.userProfiles, entry];

      set({ userProfiles: list, activeProfile: entry.id });
      return { ok: true, id: entry.id, updated: !!existing };
    }

    function deleteProfile(id) {
      if (!String(id).startsWith('user:')) return false;
      const list = state.userProfiles.filter(p => p.id !== id);
      if (list.length === state.userProfiles.length) return false;
      set({
        userProfiles: list,
        activeProfile: state.activeProfile === id ? 'builtin:default' : state.activeProfile
      });
      return true;
    }

    /* ------------------------------------------------- session (selection) */

    /**
     * Remembers which paths were deselected under a given root, so re-dropping
     * the same project does not mean re-curating it. Only paths are stored —
     * never file contents — and only when the user has opted in.
     *
     * Bounded to 20 roots and 5000 paths each so it cannot grow without limit.
     */
    let sessionCache = null;

    async function readSession() {
      if (sessionCache) return sessionCache;
      let raw = await env.storage.get(SESSION_KEY, null);
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }
      sessionCache = util.isPlainObject(raw) && util.isPlainObject(raw.roots) ? raw : { roots: {} };
      return sessionCache;
    }

    const persistSession = util.debounce(async () => {
      if (!sessionCache) return;
      await env.storage.set(SESSION_KEY, sessionCache);
    }, 400);

    async function rememberDeselected(root, paths) {
      if (!state.rememberSelection || !root) return;
      const s = await readSession();
      s.roots[root] = {
        at: Date.now(),
        paths: Array.from(paths).slice(0, 5000)
      };
      const entries = Object.entries(s.roots).sort((a, b) => b[1].at - a[1].at);
      s.roots = Object.fromEntries(entries.slice(0, 20));
      persistSession();
    }

    async function recallDeselected(root) {
      if (!state.rememberSelection || !root) return null;
      const s = await readSession();
      const entry = s.roots[root];
      if (!entry || !Array.isArray(entry.paths)) return null;
      return new Set(entry.paths);
    }

    async function clearSession() {
      sessionCache = { roots: {} };
      persistSession.cancel();
      await env.storage.set(SESSION_KEY, sessionCache);
    }

    /* --------------------------------------------------- import / export */

    function exportSettings() {
      return {
        app: env.APP_ID,
        version: env.APP_VERSION,
        schema: SCHEMA_VERSION,
        exported: new Date().toISOString(),
        settings: util.deepClone(state)
      };
    }

    function importSettings(payload) {
      let parsed = payload;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return { ok: false, reason: 'parse' };
        }
      }
      if (!util.isPlainObject(parsed)) return { ok: false, reason: 'shape' };

      // Accept our own envelope, or a bare settings object — which also lets a
      // 1.x user paste the contents of their old `cu-settings` key directly.
      const candidate = util.isPlainObject(parsed.settings) ? parsed.settings : parsed;
      const recognised = Object.keys(candidate).some(k => Object.hasOwn(schema, k));
      if (!recognised) return { ok: false, reason: 'unrecognised' };

      state = sanitize(runMigrations({ ...util.deepClone(candidate), __v: parsed.schema ?? 0 }));
      revision += 1;
      persist();
      emit({ type: 'import', changed: Object.keys(schema) });
      return { ok: true };
    }

    /* ------------------------------------------------------------- misc */

    function flush() {
      persist.flush();
      persistSession.flush();
    }

    function dispose() {
      flush();
      unwatch?.();
      unwatch = null;
      listeners.clear();
    }

    return {
      SCHEMA_VERSION,
      defaults,
      schema,
      load,
      get,
      all,
      raw,
      revision: getRevision,
      set,
      reset,
      subscribe,
      isReadOnly: () => readOnly,
      repairs: () => repairs.slice(),
      profiles,
      activeProfile,
      applyProfile,
      saveProfile,
      deleteProfile,
      rememberDeselected,
      recallDeselected,
      clearSession,
      exportSettings,
      importSettings,
      flush,
      dispose
    };
  })();

  /* =======================================================================
   * SECTION 05 — Path matching: gitignore-compatible pattern engine
   * -----------------------------------------------------------------------
   * A full gitignore-compatible pattern engine provides precise, authoritative
   * filtering for repository files:
   *
   * This module implements that syntax properly:
   *
   *   #comment              ignored
   *   !pattern              negation (re-includes)
   *   pattern/              directory-only
   *   /pattern              anchored to the file containing the rule
   *   a/b                   anchored (contains a non-trailing slash)
   *   pattern               matches at any depth
   *   *                     any run within one segment
   *   **                    any number of segments
   *   ?                     one character within a segment
   *   [abc] [a-z] [!abc]    character classes
   *   \x                    escape
   *
   * Matching is done with two nested two-pointer scanners — one over path
   * segments for `**`, one over characters for `*` — each with a single
   * backtrack position. Neither can backtrack exponentially, so a
   * user-authored or repository-authored pattern can never hang the browser.
   * A regex translation of the same syntax can, which is why one is not used.
   * ==================================================================== */

  const match = (() => {
    /* ------------------------------------------------- character classes */

    /**
     * Reads a `[...]` class starting at `pi` and reports whether `ch` is in
     * it. Returns `null` when the bracket is unterminated, in which case the
     * caller treats `[` as a literal — which is what git does.
     */
    function readClass(pattern, pi, ch) {
      let i = pi + 1;
      let negate = false;
      if (pattern[i] === '!' || pattern[i] === '^') {
        negate = true;
        i += 1;
      }

      let matched = false;
      let first = true;

      while (i < pattern.length) {
        const c = pattern[i];

        if (c === ']' && !first) {
          return { end: i + 1, matched: negate ? !matched : matched };
        }
        first = false;

        let lo = c;
        if (c === '\\' && i + 1 < pattern.length) {
          i += 1;
          lo = pattern[i];
        }

        if (pattern[i + 1] === '-' && pattern[i + 2] !== undefined && pattern[i + 2] !== ']') {
          let hi = pattern[i + 2];
          let advance = 3;
          if (hi === '\\' && pattern[i + 3] !== undefined) {
            hi = pattern[i + 3];
            advance = 4;
          }
          if (ch >= lo && ch <= hi) matched = true;
          i += advance;
        } else {
          if (ch === lo) matched = true;
          i += 1;
        }
      }

      return null; // unterminated
    }

    /**
     * Matches one path segment against one pattern segment.
     * `*` and `?` never cross a `/` because a segment contains none.
     */
    function matchSegment(pattern, text) {
      const pl = pattern.length;
      const tl = text.length;
      let pi = 0;
      let ti = 0;
      let star = -1;
      let mark = 0;

      while (ti < tl) {
        const pc = pi < pl ? pattern[pi] : undefined;

        if (pc === '*') {
          star = pi;
          mark = ti;
          pi += 1;
          continue;
        }

        let consumed = false;

        if (pc === '?') {
          pi += 1;
          ti += 1;
          consumed = true;
        } else if (pc === '[') {
          const res = readClass(pattern, pi, text[ti]);
          if (res === null) {
            // Unterminated class: `[` is a literal.
            if (text[ti] === '[') {
              pi += 1;
              ti += 1;
              consumed = true;
            }
          } else if (res.matched) {
            pi = res.end;
            ti += 1;
            consumed = true;
          }
        } else if (pc === '\\' && pi + 1 < pl) {
          if (pattern[pi + 1] === text[ti]) {
            pi += 2;
            ti += 1;
            consumed = true;
          }
        } else if (pc !== undefined && pc === text[ti]) {
          pi += 1;
          ti += 1;
          consumed = true;
        }

        if (consumed) continue;

        if (star !== -1) {
          pi = star + 1;
          mark += 1;
          ti = mark;
          if (mark > tl) return false;
          continue;
        }
        return false;
      }

      while (pi < pl && pattern[pi] === '*') pi += 1;
      return pi === pl;
    }

    /**
     * Matches a list of pattern segments against a list of path segments,
     * where a `**` pattern segment consumes zero or more path segments.
     */
    function matchSegments(pat, path) {
      const pl = pat.length;
      const sl = path.length;
      let pi = 0;
      let si = 0;
      let star = -1;
      let mark = 0;

      while (si < sl) {
        if (pi < pl && pat[pi] === '**') {
          star = pi;
          mark = si;
          pi += 1;
          continue;
        }
        if (pi < pl && matchSegment(pat[pi], path[si])) {
          pi += 1;
          si += 1;
          continue;
        }
        if (star !== -1) {
          pi = star + 1;
          mark += 1;
          si = mark;
          continue;
        }
        return false;
      }

      while (pi < pl && pat[pi] === '**') pi += 1;
      return pi === pl;
    }

    /* --------------------------------------------------- rule compilation */

    /**
     * @typedef {object} IgnoreRule
     * @property {string}  source     raw pattern line, for diagnostics
     * @property {string}  base       directory the rule is relative to ('' = root)
     * @property {boolean} negate
     * @property {boolean} dirOnly
     * @property {boolean} anchored
     * @property {string[]} segments
     */

    /**
     * Compiles one gitignore line. Returns null for blanks and comments.
     * @param {string} line
     * @param {string} base normalised directory the rule lives in
     */
    function compileRule(line, base = '') {
      let s = String(line);

      // Strip the trailing newline artefacts and unescaped trailing spaces.
      s = s.replace(/[\r\n]+$/, '');
      s = s.replace(/(?<!\\)\s+$/, '');
      if (!s) return null;
      if (s.startsWith('#')) return null;
      if (s.startsWith('\\#')) s = s.slice(1);

      let negate = false;
      if (s.startsWith('!')) {
        negate = true;
        s = s.slice(1);
      } else if (s.startsWith('\\!')) {
        s = s.slice(1);
      }
      if (!s) return null;

      let dirOnly = false;
      if (s.endsWith('/') && !s.endsWith('\\/')) {
        dirOnly = true;
        s = s.slice(0, -1);
      }
      if (!s) return null;

      // A leading slash anchors; so does any slash that is not the last
      // character (git's rule).
      let anchored = false;
      if (s.startsWith('/')) {
        anchored = true;
        s = s.slice(1);
      } else if (s.includes('/')) {
        anchored = true;
      }
      if (!s) return null;

      const segments = s.split('/').filter(seg => seg.length > 0 || false);
      if (!segments.length) return null;

      return { source: line, base, negate, dirOnly, anchored, segments };
    }

    /** Parses a whole `.gitignore` body into rules relative to `base`. */
    function compileIgnoreFile(text, base = '') {
      const rules = [];
      for (const line of String(text).split('\n')) {
        const rule = compileRule(line, base);
        if (rule) rules.push(rule);
      }
      return rules;
    }

    /**
     * Tests one rule against a path.
     * @param {IgnoreRule} rule
     * @param {string[]} segments full path segments
     * @param {boolean} isDir
     */
    function ruleMatches(rule, segments, isDir) {
      if (rule.dirOnly && !isDir) {
        // A directory-only rule still excludes files *inside* that directory;
        // the caller handles that by testing ancestor directories separately.
        return false;
      }

      // Restrict to the subtree the rule lives in.
      let rel = segments;
      if (rule.base) {
        const baseSegs = rule.base.split('/');
        if (segments.length <= baseSegs.length) return false;
        for (let i = 0; i < baseSegs.length; i += 1) {
          if (segments[i] !== baseSegs[i]) return false;
        }
        rel = segments.slice(baseSegs.length);
      }
      if (!rel.length) return false;

      if (rule.anchored) return matchSegments(rule.segments, rel);

      // Unanchored: the pattern may start at any depth.
      for (let start = 0; start < rel.length; start += 1) {
        if (matchSegments(rule.segments, rel.slice(start))) return true;
      }
      return false;
    }

    /**
     * Evaluates an ordered rule list against a path, honouring negation.
     * Later rules win, exactly as git specifies.
     *
     * A path is also ignored when any of its ancestor directories is ignored
     * and not subsequently re-included — git's "you cannot re-include a file
     * inside an excluded directory" behaviour is deliberately *relaxed* here:
     * we evaluate ancestors first and allow a later negation on the file
     * itself to win, because in this tool the user's intent ("give me that
     * one file back") is unambiguous and the stricter behaviour would only be
     * surprising.
     *
     * @returns {{ignored: boolean, rule: IgnoreRule|null}}
     */
    function evaluate(rules, path) {
      const segments = String(path).split('/').filter(Boolean);
      if (!segments.length) return { ignored: false, rule: null };

      let decision = false;
      let decidedBy = null;

      // Ancestors, outermost first, then the file itself.
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const isDir = depth < segments.length;
        const slice = segments.slice(0, depth);
        for (const rule of rules) {
          if (ruleMatches(rule, slice, isDir)) {
            decision = !rule.negate;
            decidedBy = rule;
          }
        }
      }

      return { ignored: decision, rule: decidedBy };
    }

    /**
     * A prepared matcher with a bounded result cache. Building one is cheap;
     * evaluating it is the hot path during rendering and stat updates.
     */
    function createMatcher(rules) {
      const cache = new util.LruCache(20000);
      const list = rules.slice();
      return {
        rules: list,
        get size() {
          return list.length;
        },
        test(path) {
          const hit = cache.get(path);
          if (hit !== undefined) return hit;
          const res = list.length ? evaluate(list, path) : { ignored: false, rule: null };
          cache.set(path, res);
          return res;
        },
        clearCache() {
          cache.clear();
        }
      };
    }

    return {
      compileRule,
      compileIgnoreFile,
      matchSegment,
      matchSegments,
      ruleMatches,
      evaluate,
      createMatcher
    };
  })();

  /* =======================================================================
   * SECTION 06 — Inclusion policy
   * -----------------------------------------------------------------------
   * One place decides whether a file is part of the payload, and why.
   *
   * The policy is compiled once per settings change into a matcher with a
   * bounded cache, and every verdict carries a machine-readable reason that
   * the tree renders as a badge and the diagnostics panel aggregates.
   *
   * Key design details:
   *
   *  1. Directory ignore tests check actual directory segments, so a file named `dist` or `bin`
   *     is not accidentally dropped as if it were a directory.
   *  2. Classification falls back to content sniffing for anything the file-extension tables do not recognise,
   *     ensuring extensionless binaries and text files are correctly identified.
   * ==================================================================== */

  const policy = (() => {
    /** Reason codes. Order here is the order they are evaluated in. */
    const REASON = {
      HIDDEN: 'hidden',
      FOLDER: 'ignored-folder',
      EXTENSION: 'ignored-extension',
      GLOB: 'ignore-glob',
      GITIGNORE: 'gitignore',
      TEST: 'test-file',
      LOCKFILE: 'lockfile',
      BINARY: 'binary-excluded',
      TOO_LARGE: 'too-large',
      EMPTY: 'empty'
    };

    const REASON_LABEL = {
      [REASON.HIDDEN]: 'Hidden',
      [REASON.FOLDER]: 'Ignored folder',
      [REASON.EXTENSION]: 'Ignored extension',
      [REASON.GLOB]: 'Ignore pattern',
      [REASON.GITIGNORE]: '.gitignore',
      [REASON.TEST]: 'Test file',
      [REASON.LOCKFILE]: 'Lockfile',
      [REASON.BINARY]: 'Binary excluded',
      [REASON.TOO_LARGE]: 'Over size limit',
      [REASON.EMPTY]: 'Empty file'
    };

    const LOCKFILE_NAMES = new Set([
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
      'composer.lock', 'gemfile.lock', 'poetry.lock', 'pipfile.lock', 'cargo.lock',
      'go.sum', 'packages.lock.json', 'podfile.lock', 'mix.lock', 'flake.lock',
      'pubspec.lock', 'gradle.lockfile', 'conan.lock', 'uv.lock'
    ]);

    /* ------------------------------------------------ binary classification */

    /**
     * Extension-based classification: a leading dot does not begin an
     * extension, matching is case-insensitive, and `BINARY_EXTS` determines binary files.
     */
    function isBinaryByExtension(nameOrPath) {
      return data.BINARY_EXTS.has(util.extname(nameOrPath));
    }

    function isTextByExtension(nameOrPath) {
      const name = util.basename(nameOrPath).toLowerCase();
      if (data.TEXT_FILENAMES.has(name)) return true;
      const ext = util.extname(nameOrPath);
      if (ext && data.TEXT_EXTS.has(ext)) return true;
      // A dotfile whose whole name is a known text name, e.g. `.gitignore`.
      if (name.startsWith('.') && data.TEXT_EXTS.has(name)) return true;
      return false;
    }

    /**
     * Content sniff for files the file-extension tables cannot classify.
     *
     * A UTF-8/UTF-16 BOM means text. A NUL byte in the first few kilobytes
     * means binary — the same heuristic git uses. An unusually high proportion
     * of C0 control bytes also means binary. Everything else is text.
     *
     * Reads at most `BINARY_SNIFF_BYTES`, so the cost is independent of file
     * size and a 4 GB video is classified as cheaply as a 4 KB script.
     */
    async function sniffIsBinary(file) {
      try {
        const slice = file.slice(0, data.BINARY_SNIFF_BYTES);
        const buf = new Uint8Array(await slice.arrayBuffer());
        if (!buf.length) return false;

        if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return false; // UTF-8 BOM
        if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return false;

        let control = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const b = buf[i];
          if (b === 0) return true;
          // Printable ASCII, tab, LF, CR, FF, ESC and anything >= 0x80 (which
          // is legal UTF-8 continuation) are all acceptable in a text file.
          if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) control += 1;
        }
        return control / buf.length > 0.15;
      } catch (e) {
        env.log.debug('binary sniff failed; assuming text', e);
        return false;
      }
    }

    /**
     * Full classification for one ingested file.
     * @returns {Promise<{isBinary: boolean, method: 'extension'|'sniff'|'assumed'}>}
     */
    async function classify(file, path) {
      if (isBinaryByExtension(path)) return { isBinary: true, method: 'extension' };
      if (isTextByExtension(path)) return { isBinary: false, method: 'extension' };
      if (file.size === 0) return { isBinary: false, method: 'assumed' };
      return { isBinary: await sniffIsBinary(file), method: 'sniff' };
    }

    /* --------------------------------------------------------- test files */

    function looksLikeTest(path) {
      const lower = `/${path.toLowerCase()}`;
      if (data.TEST_PATH_HINTS.some(h => lower.includes(h))) return true;
      return data.TEST_NAME_RX.test(util.basename(path));
    }

    /* ---------------------------------------------------------- compiling */

    /**
     * @typedef {object} Verdict
     * @property {boolean} skip
     * @property {string|null} reason
     * @property {string|null} detail human-readable specifics (which rule)
     */

    const INCLUDED = Object.freeze({ skip: false, reason: null, detail: null });

    /**
     * Builds the policy for a given settings snapshot and gitignore rule set.
     * The result is immutable and cheap to hold; rebuild it whenever either
     * input changes rather than mutating it.
     *
     * @param {object} settings
     * @param {Array} gitignoreRules compiled rules from section 05
     */
    function compile(settings, gitignoreRules = []) {
      const ignoreFolders = new Set(
        String(settings.ignoreFolders || '')
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean)
      );

      const ignoreExtsRaw = String(settings.ignoreExts || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      // Split once into the two ways an entry is used, instead of re-deciding
      // per file inside the per-file loop.
      const ignoreExactNames = new Set(ignoreExtsRaw.filter(e => !e.startsWith('.')));
      const ignoreSuffixes = ignoreExtsRaw.filter(e => e.startsWith('.'));
      // Longest first so the reported reason names the most specific match.
      ignoreSuffixes.sort((a, b) => b.length - a.length);

      const extraGlobRules = String(settings.extraIgnoreGlobs || '')
        .split(/[\n,]/)
        .map(s => match.compileRule(s, ''))
        .filter(Boolean);

      const extraMatcher = match.createMatcher(extraGlobRules);
      const gitMatcher = match.createMatcher(settings.useGitignore ? gitignoreRules : []);

      const maxFileBytes = settings.maxFileBytes;
      const skipHidden = settings.skipHidden;
      const includeBinary = settings.includeBinary;
      const excludeTests = settings.excludeTests;
      const excludeLockfiles = settings.excludeLockfiles;

      const cache = new util.LruCache(20000);

      /**
       * @param {string} path normalised, root-relative
       * @param {number} size
       * @param {boolean} isBinary resolved classification
       * @returns {Verdict}
       */
      function verdict(path, size, isBinary) {
        const key = `${path}\u0000${size}\u0000${isBinary ? 1 : 0}`;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const v = compute(path, size, isBinary);
        cache.set(key, v);
        return v;
      }

      function compute(path, size, isBinary) {
        const segs = path.split('/');
        const filename = segs[segs.length - 1];
        const lowerName = filename.toLowerCase();
        const dirSegs = segs.slice(0, -1);

        /* 1. hidden files and folders ------------------------------------ */
        if (skipHidden) {
          for (const s of dirSegs) {
            if (s.startsWith('.')) {
              return { skip: true, reason: REASON.HIDDEN, detail: `hidden folder "${s}"` };
            }
          }
          if (lowerName.startsWith('.')) {
            // A recognised dotfile (.gitignore, .env, .eslintrc, …) is kept:
            // it is configuration, and configuration is usually the point.
            const ext = util.extname(lowerName);
            const known =
              data.TEXT_FILENAMES.has(lowerName) ||
              data.TEXT_EXTS.has(lowerName) ||
              (ext && (data.TEXT_EXTS.has(ext) || data.BINARY_EXTS.has(ext)));
            if (!known) {
              return { skip: true, reason: REASON.HIDDEN, detail: `hidden file "${filename}"` };
            }
          }
        }

        /* 2. ignored folders — directory segments only -------------------- */
        // Only directory segments are tested against ignoreFolders.
        for (const s of dirSegs) {
          if (ignoreFolders.has(s.toLowerCase())) {
            return { skip: true, reason: REASON.FOLDER, detail: s };
          }
        }

        /* 3. ignored extensions / exact filenames ------------------------- */
        if (ignoreExactNames.has(lowerName)) {
          return { skip: true, reason: REASON.EXTENSION, detail: lowerName };
        }
        for (const suffix of ignoreSuffixes) {
          if (lowerName.endsWith(suffix)) {
            return { skip: true, reason: REASON.EXTENSION, detail: suffix };
          }
        }

        /* 4. user ignore globs -------------------------------------------- */
        if (extraMatcher.size) {
          const res = extraMatcher.test(path);
          if (res.ignored) {
            return { skip: true, reason: REASON.GLOB, detail: res.rule?.source?.trim() || '' };
          }
        }

        /* 5. repository .gitignore ---------------------------------------- */
        if (gitMatcher.size) {
          const res = gitMatcher.test(path);
          if (res.ignored) {
            const rule = res.rule;
            const where = rule?.base ? `${rule.base}/.gitignore` : '.gitignore';
            return { skip: true, reason: REASON.GITIGNORE, detail: `${rule?.source?.trim() || ''} (${where})` };
          }
        }

        /* 6. tests --------------------------------------------------------- */
        if (excludeTests && looksLikeTest(path)) {
          return { skip: true, reason: REASON.TEST, detail: null };
        }

        /* 7. lockfiles ----------------------------------------------------- */
        if (excludeLockfiles && LOCKFILE_NAMES.has(lowerName)) {
          return { skip: true, reason: REASON.LOCKFILE, detail: lowerName };
        }

        /* 8. binary -------------------------------------------------------- */
        if (!includeBinary && isBinary) {
          return { skip: true, reason: REASON.BINARY, detail: null };
        }

        /* 9. size ---------------------------------------------------------- */
        if (size > maxFileBytes) {
          return { skip: true, reason: REASON.TOO_LARGE, detail: util.formatSize(size) };
        }

        return INCLUDED;
      }

      return {
        verdict,
        /** Convenience boolean skip helper. */
        shouldSkip: (path, size, isBinary) => verdict(path, size, isBinary).skip,
        gitignoreRuleCount: gitMatcher.size,
        globRuleCount: extraMatcher.size,
        clearCache() {
          cache.clear();
          extraMatcher.clearCache();
          gitMatcher.clearCache();
        },
        /** Identity of the inputs, so callers can tell when to rebuild. */
        signature: [
          settings.ignoreFolders,
          settings.ignoreExts,
          settings.extraIgnoreGlobs,
          settings.skipHidden,
          settings.includeBinary,
          settings.excludeTests,
          settings.excludeLockfiles,
          settings.maxFileBytes,
          settings.useGitignore,
          gitignoreRules.length
        ].join('\u0001')
      };
    }

    /* ------------------------------------------------------------ presets */

    const PRESET = {
      ALL: 'all',
      CODE: 'code',
      DOCS: 'docs',
      CONFIG: 'config',
      TESTS: 'tests',
      NONE: 'none'
    };

    function isDoc(path) {
      const name = util.basename(path).toLowerCase();
      const ext = util.extname(path);
      const stem = ext ? name.slice(0, -ext.length) : name;
      return data.DOC_EXTS.has(ext) || data.DOC_NAMES.has(name) || data.DOC_NAMES.has(stem);
    }

    function isConfig(path) {
      const name = util.basename(path).toLowerCase();
      return data.CONFIG_NAMES.has(name) || data.CONFIG_EXTS.has(util.extname(path));
    }

    /**
     * Whether a preset selects a given file. Presets operate on the *visible*
     * set — files already admitted by the policy — so they compose predictably
     * with filtering rather than fighting it.
     */
    function presetSelects(preset, item) {
      switch (preset) {
        case PRESET.ALL:
          return true;
        case PRESET.NONE:
          return false;
        case PRESET.DOCS:
          return isDoc(item.path);
        case PRESET.CONFIG:
          return isConfig(item.path);
        case PRESET.TESTS:
          return looksLikeTest(item.path);
        case PRESET.CODE:
          return !item.isBinary && !isDoc(item.path) && !isConfig(item.path) && !looksLikeTest(item.path);
        default:
          return true;
      }
    }

    return {
      REASON,
      REASON_LABEL,
      LOCKFILE_NAMES,
      isBinaryByExtension,
      isTextByExtension,
      sniffIsBinary,
      classify,
      looksLikeTest,
      isDoc,
      isConfig,
      compile,
      PRESET,
      presetSelects
    };
  })();

  /* =======================================================================
   * SECTION 07 — Ingestion
   * -----------------------------------------------------------------------
   * Getting files into the workspace, from three sources, with one contract.
   *
   * Robust ingestion design:
   *
   *  1. `readEntries` and `entry.file()` are wrapped with explicit error handling
   *     and timeouts so permission failures or vanished files cannot hang the traversal.
   *  2. Over-limit guards avoid blocking mid-traversal dialogs.
   *  3. Directory and file paths are unified through a single normaliser
   *     regardless of whether files enter via drag-and-drop or file picker.
   * ==================================================================== */

  const ingest = (() => {
    /**
     * @typedef {object} IngestItem
     * @property {File}    file
     * @property {string}  path      normalised, root-relative
     * @property {boolean} isBinary
     * @property {string}  classifiedBy 'extension' | 'sniff' | 'assumed'
     */

    /**
     * @typedef {object} IngestResult
     * @property {IngestItem[]} items
     * @property {Map<string,string>} gitignores  dir -> file body
     * @property {number} scanned
     * @property {number} skippedUnreadable
     * @property {boolean} truncated  hit the hard file cap
     * @property {string}  root       common top-level directory, '' if mixed
     */

    /* --------------------------------------------------- entry primitives */

    /** Promisified `entry.file()` with the error callback the spec requires. */
    function entryFile(entry) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = fn => v => {
          if (settled) return;
          settled = true;
          fn(v);
        };
        try {
          entry.file(done(resolve), done(reject));
        } catch (e) {
          done(reject)(e);
        }
        // A directory entry that lies about `isFile`, or a driver that never
        // calls back, must not wedge the walk.
        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`Timed out reading ${entry?.name || 'file'}`));
          }
        }, 15000);
      });
    }

    /** Promisified `readEntries()`; also with the required error callback. */
    function readEntriesOnce(reader) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = fn => v => {
          if (settled) return;
          settled = true;
          fn(v);
        };
        try {
          reader.readEntries(done(resolve), done(reject));
        } catch (e) {
          done(reject)(e);
        }
        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Timed out listing a directory'));
          }
        }, 15000);
      });
    }

    /**
     * `readEntries` returns a bounded batch (100 in Chromium) and must be
     * called until it yields an empty array. A guard bounds the loop so a
     * misbehaving implementation that never empties cannot spin forever.
     */
    async function readAllEntries(reader, signal) {
      const out = [];
      for (let round = 0; round < 10000; round += 1) {
        util.throwIfAborted(signal);
        // eslint-disable-next-line no-await-in-loop
        const batch = await readEntriesOnce(reader);
        if (!batch || !batch.length) break;
        out.push(...batch);
      }
      return out;
    }

    /* ---------------------------------------------------------- traversal */

    /**
     * Breadth-first walk over dropped entries, in two phases.
     *
     * Phase 1 enumerates directories and collects file *entries* — cheap, and
     * breadth-first so the file cap keeps the shallowest files, which are the
     * ones a user wants when they overshoot. Phase 2 resolves the `File`
     * objects with bounded concurrency.
     *
     * The two-phase design avoids serial round-trips: resolving File objects
     * in bounded parallel batches prevents freezing on large repositories.
     */
    async function walkEntries(roots, { signal, onProgress, limit }) {
      const fileEntries = [];
      const queue = roots.map(entry => ({ entry, prefix: '' }));
      let unreadable = 0;
      let truncated = false;
      let directories = 0;

      /* phase 1 — enumerate */
      while (queue.length) {
        util.throwIfAborted(signal);
        const { entry, prefix } = queue.shift();
        if (!entry) continue;

        if (entry.isFile) {
          if (fileEntries.length >= limit) {
            truncated = true;
            continue;
          }
          fileEntries.push({ entry, path: `${prefix}${entry.name}` });
          if (fileEntries.length % 250 === 0) {
            onProgress?.({ phase: 'scan', found: fileEntries.length, directories });
            // eslint-disable-next-line no-await-in-loop
            await util.yieldToUI();
          }
        } else if (entry.isDirectory) {
          directories += 1;
          try {
            // eslint-disable-next-line no-await-in-loop
            const children = await readAllEntries(entry.createReader(), signal);
            const nextPrefix = `${prefix}${entry.name}/`;
            for (const child of children) queue.push({ entry: child, prefix: nextPrefix });
          } catch (e) {
            if (util.isCancellation(e)) throw e;
            unreadable += 1;
            env.log.warn('unreadable directory skipped', prefix + entry.name, e);
          }
          if (directories % 40 === 0) {
            onProgress?.({ phase: 'scan', found: fileEntries.length, directories });
            // eslint-disable-next-line no-await-in-loop
            await util.yieldToUI();
          }
        }
      }

      onProgress?.({ phase: 'scan', found: fileEntries.length, directories, complete: true });

      /* phase 2 — resolve */
      const pool = new util.TaskQueue({ concurrency: 12 });
      const files = [];
      let done = 0;

      await Promise.all(
        fileEntries.map(fe =>
          pool.add(async () => {
            util.throwIfAborted(signal);
            try {
              const file = await entryFile(fe.entry);
              files.push({ file, path: util.normalizePath(fe.path) });
            } catch (e) {
              unreadable += 1;
              env.log.warn('unreadable file skipped', fe.path, e);
            }
            done += 1;
            if (done % 100 === 0 || done === fileEntries.length) {
              onProgress?.({ phase: 'read', done, total: fileEntries.length });
            }
          })
        )
      );

      // Concurrency makes completion order arbitrary; sort so that two ingests
      // of the same folder always produce the same result.
      files.sort((a, b) => a.path.localeCompare(b.path));

      return { files, scanned: fileEntries.length, unreadable, truncated, directories };
    }

    /* -------------------------------------------------------------- roots */

    /**
     * The common top-level directory of a set of paths, used to key remembered
     * selections. Returns '' when the drop mixed unrelated roots, in which
     * case no selection is recalled — recalling one would be a guess.
     */
    function commonRoot(paths) {
      let root = null;
      for (const p of paths) {
        const first = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
        if (!first) return '';
        if (root === null) root = first;
        else if (root !== first) return '';
      }
      return root || '';
    }

    /* --------------------------------------------------------- gitignores */

    /**
     * Reads every `.gitignore` in the ingested set. They are tiny and there
     * are few of them, so this is done eagerly at ingest time and the compiled
     * rules are cached for the lifetime of the workspace.
     */
    async function collectGitignores(raw, signal) {
      const map = new Map();
      const candidates = raw.filter(r => util.basename(r.path).toLowerCase() === '.gitignore');
      for (const entry of candidates) {
        util.throwIfAborted(signal);
        try {
          // eslint-disable-next-line no-await-in-loop
          const text = await entry.file.text();
          map.set(util.dirname(entry.path), text);
        } catch (e) {
          env.log.debug('could not read .gitignore', entry.path, e);
        }
      }
      return map;
    }

    /* ------------------------------------------------------ classification */

    /**
     * Classifies files with bounded concurrency. Sniffing reads at most 4 KB
     * per file and only for names the file-extension tables cannot decide, so a
     * typical repository sniffs a handful of files, not all of them.
     */
    async function classifyAll(raw, { signal, onProgress }) {
      const queue = new util.TaskQueue({ concurrency: 8 });
      const items = new Array(raw.length);
      let done = 0;

      await Promise.all(
        raw.map((entry, i) =>
          queue.add(async () => {
            util.throwIfAborted(signal);
            const { isBinary, method } = await policy.classify(entry.file, entry.path);
            items[i] = {
              file: entry.file,
              path: entry.path,
              isBinary,
              classifiedBy: method
            };
            done += 1;
            if (done % 128 === 0) onProgress?.({ classified: done, total: raw.length });
          })
        )
      );

      onProgress?.({ classified: raw.length, total: raw.length });
      return items;
    }

    /* --------------------------------------------------------------- API */

    /**
     * Normalises, de-duplicates, classifies and reads gitignores.
     * Shared by all three ingestion routes so their results are identical.
     */
    async function finalise(rawFiles, { signal, onProgress, existingPaths }) {
      util.throwIfAborted(signal);

      const seen = new Set(existingPaths || []);
      const deduped = [];
      let duplicates = 0;

      for (const entry of rawFiles) {
        const path = util.normalizePath(entry.path);
        if (!path) continue;
        if (seen.has(path)) {
          duplicates += 1;
          continue;
        }
        seen.add(path);
        deduped.push({ file: entry.file, path });
      }

      // One sorting point for both ingestion routes, so a drop and a folder
      // pick of the same project produce byte-identical state.
      deduped.sort((a, b) => a.path.localeCompare(b.path));

      onProgress?.({ phase: 'gitignore' });
      const gitignores = await collectGitignores(deduped, signal);

      onProgress?.({ phase: 'classify' });
      const items = await classifyAll(deduped, { signal, onProgress });

      return { items, gitignores, duplicates, root: commonRoot(items.map(i => i.path)) };
    }

    /**
     * Reads a `drop` event.
     *
     * `webkitGetAsEntry()` (and `getAsFileSystemHandle()`) may only be called
     * in the same task as the event: `dataTransfer.items` is neutered once the
     * handler yields. Every entry is therefore extracted synchronously *first*
     * and only then awaited — the single most important ordering constraint in
     * this module.
     *
     * @param {DragEvent} event
     */
    function extractDropEntries(event) {
      const dt = event.dataTransfer;
      if (!dt) return { entries: [], plainFiles: [] };

      const entries = [];
      let hasEntrySupport = false;

      try {
        for (const item of Array.from(dt.items || [])) {
          if (item.kind !== 'file') continue;
          if (typeof item.webkitGetAsEntry === 'function') {
            hasEntrySupport = true;
            const entry = item.webkitGetAsEntry();
            if (entry) entries.push(entry);
          }
        }
      } catch (e) {
        env.log.debug('could not read dropped entries', e);
      }

      // Browsers without the entry API (or a drop of loose files from an app
      // that provides no entries) still give a flat FileList.
      const plainFiles = [];
      if (!hasEntrySupport || !entries.length) {
        try {
          for (const file of Array.from(dt.files || [])) {
            plainFiles.push({ file, path: file.webkitRelativePath || file.name });
          }
        } catch (e) {
          env.log.debug('could not read dropped files', e);
        }
      }

      return { entries, plainFiles };
    }

    /**
     * Completes a drop whose entries were already extracted synchronously.
     *
     * @param {{entries: any[], plainFiles: Array}} extracted
     * @param {object} options
     * @param {AbortSignal} options.signal
     * @param {(p: object) => void} options.onProgress
     * @param {number} options.limit hard cap on files
     * @param {Set<string>} options.existingPaths
     * @returns {Promise<IngestResult>}
     */
    async function fromDrop(extracted, options) {
      const { signal, onProgress, limit, existingPaths } = options;

      let walked = { files: [], scanned: 0, unreadable: 0, truncated: false };
      if (extracted.entries.length) {
        walked = await walkEntries(extracted.entries, { signal, onProgress, limit });
      }

      const raw = [...walked.files, ...extracted.plainFiles.slice(0, Math.max(0, limit - walked.files.length))];
      if (extracted.plainFiles.length > limit - walked.files.length) walked.truncated = true;

      const finished = await finalise(raw, { signal, onProgress, existingPaths });
      return {
        ...finished,
        scanned: walked.scanned || raw.length,
        skippedUnreadable: walked.unreadable,
        truncated: walked.truncated
      };
    }

    /* ------------------------------------------------------------ pickers */

    /**
     * Opens a native file/directory picker and returns **immediately**.
     *
     * The previous design awaited the picker inside the same promise that held
     * the application's "busy" lock. That was wrong in two ways at once:
     *
     *  - a picker is an OS-modal dialog that can stay open indefinitely, so
     *    the lock was held for an unbounded time and every other control was
     *    refused while it was up;
     *  - no engine reliably reports dismissal. The `cancel` event is not
     *    universal, so a focus-based heuristic was used — and because it
     *    *resolved* the promise, a slow confirmation (Chrome asks "Upload N
     *    files?" for a directory) made the script decide the user had
     *    cancelled. The real `change` then arrived, found the promise already
     *    settled, and did nothing at all. That is the silent folder-selection
     *    failure.
     *
     * This version is event-driven. Selection and dismissal are separate
     * callbacks, the busy lock is taken only once files actually exist, and a
     * late `change` is still honoured after a tentative dismissal.
     *
     * @param {object} options
     * @param {boolean} options.directory  pick a whole directory
     * @param {(files: Array<{file: File, path: string}>) => void} options.onFiles
     * @param {(info: {tentative: boolean}) => void} options.onDismiss
     * @param {(err: Error) => void} [options.onError]
     * @returns {{cancel: () => void}} handle for teardown
     */
    function openPicker({ directory, onFiles, onDismiss, onError }) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (directory) {
        input.webkitdirectory = true;
        // Non-standard aliases, harmless where unsupported.
        try {
          input.setAttribute('webkitdirectory', '');
          input.setAttribute('directory', '');
        } catch {
          /* ignore */
        }
      }
      /*
       * Off-screen rather than `display:none`: some engines refuse to open a
       * picker for a fully hidden input. `pointer-events` is forced back on
       * because the shadow host disables it and the property is inherited —
       * a programmatic click is not hit-tested, but there is no reason to
       * leave the element in a state a user gesture could not reach.
       */
      input.style.cssText =
        'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:auto;';

      /*
       * The input is attached to the DOM. A detached input opens the picker in
       * current Chrome, but not dependably everywhere, and an attached input
       * is the only shape every engine documents. It is parented to the
       * script's own shadow root rather than the page, so the host document is
       * not polluted, and it is removed again as soon as it has been used.
       */
      const host = ui.getRoot() || document.documentElement;
      host.appendChild(input);

      let delivered = false;
      let disposed = false;
      let focusTimer = null;
      let hardTimer = null;

      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (focusTimer) clearTimeout(focusTimer);
        if (hardTimer) clearTimeout(hardTimer);
        window.removeEventListener('focus', onWindowFocus);
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancelEvent);
        input.remove();
      };

      function deliver() {
        if (delivered) return;
        delivered = true;
        let list = [];
        try {
          list = Array.from(input.files || []);
        } catch (e) {
          env.log.error('could not read the selected files', e);
          onError?.(e instanceof Error ? e : new Error(String(e)));
          dispose();
          return;
        }
        const raw = list.map(f => ({
          file: f,
          // `webkitRelativePath` carries the directory structure; a loose file
          // has none and keeps its bare name.
          path: f.webkitRelativePath || f.name
        }));
        dispose();
        try {
          onFiles(raw);
        } catch (e) {
          env.log.error('file handler threw', e);
          onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      }

      function onChange() {
        if (input.files && input.files.length) deliver();
        else {
          dispose();
          onDismiss?.({ tentative: false });
        }
      }

      function onCancelEvent() {
        // The browser told us definitively that the picker was dismissed.
        dispose();
        onDismiss?.({ tentative: false });
      }

      function onWindowFocus() {
        /*
         * Focus returning means the picker closed, but `change` may still be
         * on its way — Chrome fires it only after its own confirmation dialog
         * for large directories. The waiting indicator is therefore cleared
         * *tentatively* while the listeners stay alive, so a late selection is
         * still honoured. Only after a long stop is the input torn down.
         */
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
          if (delivered || disposed) return;
          if (input.files && input.files.length) {
            deliver();
            return;
          }
          onDismiss?.({ tentative: true });
        }, 1500);
      }

      input.addEventListener('change', onChange);
      input.addEventListener('cancel', onCancelEvent);
      window.addEventListener('focus', onWindowFocus);

      // Absolute backstop so an abandoned picker cannot leak an input and two
      // listeners for the lifetime of the tab.
      hardTimer = setTimeout(() => {
        if (delivered || disposed) return;
        if (input.files && input.files.length) deliver();
        else dispose();
      }, 10 * 60 * 1000);

      try {
        // Must happen in the same task as the user gesture.
        input.click();
      } catch (e) {
        env.log.error('could not open the file picker', e);
        dispose();
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }

      return { cancel: dispose };
    }

    /**
     * Turns a raw picker result into an ingest result, using the same
     * normalisation, de-duplication, classification and `.gitignore`
     * collection as the drop path, so both routes converge on identical state.
     */
    async function fromFileList(rawFiles, { signal, onProgress, limit, existingPaths }) {
      const truncated = rawFiles.length > limit;
      const raw = rawFiles.slice(0, limit);
      const finished = await finalise(raw, { signal, onProgress, existingPaths });
      return {
        ...finished,
        scanned: raw.length,
        skippedUnreadable: 0,
        truncated,
        directories: 0
      };
    }

    return {
      extractDropEntries,
      fromDrop,
      openPicker,
      fromFileList,
      commonRoot,
      /* exported for the test suite */
      _walkEntries: walkEntries,
      _finalise: finalise
    };
  })();

  /* =======================================================================
   * SECTION 08 — Workspace model
   * -----------------------------------------------------------------------
   * The single source of truth for what has been ingested, what is visible
   * under the current policy, and what is selected.
   *
   * The model is authoritative and the DOM is a pure projection of it.
   * Selection state is maintained centrally so filtering and search cannot cause
   * divergence between rendered checkboxes and actual payload selection.
   *
   * Here the model is authoritative and the DOM is a pure projection of it.
   * Every mutation bumps a version counter; the view re-derives from that.
   * ==================================================================== */

  const workspace = (() => {
    /**
     * @typedef {object} Item
     * @property {File}    file
     * @property {string}  path
     * @property {boolean} isBinary
     * @property {string}  classifiedBy
     * @property {boolean} selected
     */

    const listeners = new Set();

    const state = {
      items: [],
      byPath: new Map(),
      gitignores: new Map(),
      root: '',
      openFolders: new Set(),
      query: '',
      queryMode: 'text',
      /** Bumped by every mutation; drives the view. */
      version: 0,
      /** Bumped whenever the set of .gitignore files changes. */
      gitignoreVersion: 0,
      /**
       * Bumped only when the *set* of files or the policy changes. Selection
       * changes do not affect which files exist or how they nest, so the
       * visible list and the tree are keyed on this instead — otherwise every
       * checkbox click rebuilt a 5,000-node tree for no reason.
       */
      structureVersion: 0,
      ingestedAt: 0
    };

    /** Derived caches. */
    let cache = {
      structureVersion: -1,
      statsVersion: -1,
      policySignature: '',
      compiled: null,
      visible: null,
      visibleByPath: null,
      excluded: null,
      tree: null,
      stats: null
    };

    /** Bounded undo stack for destructive operations. */
    const undoStack = [];
    const UNDO_LIMIT = 25;

    function emit(detail = {}) {
      for (const fn of [...listeners]) {
        try {
          fn(detail);
        } catch (e) {
          env.log.error('workspace listener threw', e);
        }
      }
    }

    function subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function invalidate(detail = {}) {
      state.version += 1;
      if (detail.structural) state.structureVersion += 1;
      emit(detail);
    }

    /* ------------------------------------------------------------ ingest */

    /**
     * Merges an ingest result. Existing entries keep their selection state, so
     * adding a second folder never silently re-selects work the user curated.
     */
    function merge(result) {
      let added = 0;
      for (const item of result.items) {
        if (state.byPath.has(item.path)) continue;
        const entry = { ...item, selected: true };
        state.items.push(entry);
        state.byPath.set(entry.path, entry);
        added += 1;
      }

      let gitignoreChanged = false;
      for (const [dir, body] of result.gitignores || []) {
        if (state.gitignores.get(dir) !== body) gitignoreChanged = true;
        state.gitignores.set(dir, body);
      }
      if (gitignoreChanged) state.gitignoreVersion += 1;

      if (!state.root) state.root = result.root || '';
      else if (result.root && result.root !== state.root) state.root = '';

      if (added) state.ingestedAt = Date.now();
      invalidate({ type: 'ingest', added, structural: true });
      return added;
    }

    /** Applies a remembered set of deselected paths, if the root matches. */
    function applyRememberedSelection(deselected) {
      if (!deselected || !deselected.size) return 0;
      let applied = 0;
      for (const path of deselected) {
        const item = state.byPath.get(path);
        if (item && item.selected) {
          item.selected = false;
          applied += 1;
        }
      }
      if (applied) invalidate({ type: 'selection' });
      return applied;
    }

    /* ------------------------------------------------------------ policy */

    /**
     * Compiling the policy means parsing every `.gitignore` and building three
     * caches, so it must not happen on every model access. A monotonic
     * settings revision plus a gitignore revision is compared first; the
     * expensive work runs only when one of them actually moved.
     */
    function compiledPolicy() {
      const key = `${store.revision()}:${state.gitignoreVersion}`;
      if (cache.compiled && cache.policySignature === key) return cache.compiled;

      const settings = store.raw();
      const rules = [];
      // Deterministic order: shallower `.gitignore` files first, so a nested
      // one can override its parent, exactly as git resolves them.
      const dirs = [...state.gitignores.keys()].sort(
        (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
      );
      for (const dir of dirs) {
        rules.push(...match.compileIgnoreFile(state.gitignores.get(dir), dir));
      }

      const probe = policy.compile(settings, rules);

      // A settings change that does not touch the policy (a theme switch, say)
      // must not throw away the derived model, so the compiled signature is
      // compared before invalidating anything.
      const unchanged = cache.compiled && cache.compiled.signature === probe.signature;
      cache.compiled = unchanged ? cache.compiled : probe;
      cache.policySignature = key;
      if (unchanged) return cache.compiled;

      // A real policy change is structural: it changes which files exist as
      // far as the rest of the product is concerned.
      cache.structureVersion = -1;
      cache.statsVersion = -1;
      cache.visible = null;
      cache.excluded = null;
      cache.tree = null;
      cache.stats = null;
      return probe;
    }

    function ensureDerived() {
      const compiled = compiledPolicy();
      if (cache.structureVersion === state.structureVersion && cache.visible) return;

      const visible = [];
      const excluded = [];
      for (const item of state.items) {
        const v = compiled.verdict(item.path, item.file.size, item.isBinary);
        if (v.skip) excluded.push({ item, verdict: v });
        else visible.push(item);
      }

      cache.structureVersion = state.structureVersion;
      cache.visible = visible;
      cache.visibleByPath = new Map(visible.map(i => [i.path, i]));
      cache.excluded = excluded;
      cache.tree = null;
      cache.stats = null;
    }

    const visibleItems = () => {
      ensureDerived();
      return cache.visible;
    };

    const excludedItems = () => {
      ensureDerived();
      return cache.excluded;
    };

    const verdictFor = path => {
      const item = state.byPath.get(path);
      if (!item) return null;
      return compiledPolicy().verdict(path, item.file.size, item.isBinary);
    };

    /* -------------------------------------------------------------- tree */

    /**
     * @typedef {object} FolderNode
     * @property {true}   isFolder
     * @property {string} name
     * @property {string} path
     * @property {Map<string, TreeNode>} children
     *
     * @typedef {object} FileNode
     * @property {false}  isFolder
     * @property {string} name
     * @property {string} path
     * @property {Item}   item
     */

    function buildTree(items) {
      const root = { isFolder: true, name: '', path: '', children: new Map() };
      for (const item of items) {
        const parts = item.path.split('/').filter(Boolean);
        let node = root;
        let cur = '';
        for (let i = 0; i < parts.length; i += 1) {
          const seg = parts[i];
          cur = cur ? `${cur}/${seg}` : seg;
          if (i === parts.length - 1) {
            node.children.set(seg, { isFolder: false, name: seg, path: cur, item });
          } else {
            let child = node.children.get(seg);
            // A path can collide with an already-recorded file only if two
            // ingests disagreed about whether a name is a directory; prefer
            // the directory so the deeper files remain reachable.
            if (!child || !child.isFolder) {
              child = { isFolder: true, name: seg, path: cur, children: new Map() };
              node.children.set(seg, child);
            }
            node = child;
          }
        }
      }
      return root;
    }

    function tree() {
      ensureDerived();
      if (!cache.tree) cache.tree = buildTree(cache.visible);
      return cache.tree;
    }

    /**
     * Selection state of a node: 1 all, 0 none, 0.5 mixed.
     * Selection state of a node: 1 all, 0 none, 0.5 mixed, including
     * a `0` result for an empty folder.
     */
    function nodeCheckState(node) {
      if (!node.isFolder) return node.item.selected ? 1 : 0;
      let total = 0;
      let sum = 0;
      const stack = [node];
      while (stack.length) {
        const n = stack.pop();
        if (n.isFolder) {
          for (const c of n.children.values()) stack.push(c);
        } else {
          total += 1;
          if (n.item.selected) sum += 1;
        }
      }
      if (!total) return 0;
      if (sum === total) return 1;
      if (sum === 0) return 0;
      return 0.5;
    }

    function collectFiles(node, out = []) {
      if (!node.isFolder) {
        out.push(node.item);
        return out;
      }
      for (const c of node.children.values()) collectFiles(c, out);
      return out;
    }

    function findNode(path) {
      if (!path) return tree();
      const parts = path.split('/').filter(Boolean);
      let node = tree();
      for (const seg of parts) {
        if (!node?.isFolder) return null;
        node = node.children.get(seg);
        if (!node) return null;
      }
      return node;
    }

    /* ------------------------------------------------------------ search */

    /**
     * Compiles the filter box into a predicate. Three modes, chosen from the
     * text itself so there is no extra control to learn:
     *   - contains a `*` or `?`  → glob over the whole path
     *   - starts and ends with / → regular expression
     *   - otherwise              → case-insensitive substring
     */
    function compileQuery(raw) {
      const q = String(raw || '').trim();
      if (!q) return null;

      if (q.length > 2 && q.startsWith('/') && q.endsWith('/')) {
        try {
          const rx = new RegExp(q.slice(1, -1), 'i');
          return { mode: 'regex', test: p => rx.test(p), source: q };
        } catch {
          // An incomplete regex while typing is not an error; fall back to
          // substring so the list keeps responding.
        }
      }

      const lower = q.toLowerCase();
      if (q.includes('*') || q.includes('?')) {
        return { mode: 'glob', test: p => util.globMatch(lower, p.toLowerCase()), source: q };
      }
      return { mode: 'text', test: p => p.toLowerCase().includes(lower), source: q };
    }

    let queryPredicate = null;

    function setQuery(raw) {
      const next = String(raw || '');
      if (next === state.query) return;
      state.query = next;
      queryPredicate = compileQuery(next);
      state.queryMode = queryPredicate?.mode || 'text';
      invalidate({ type: 'query' });
    }

    const matchesQuery = path => (queryPredicate ? queryPredicate.test(path) : true);

    /**
     * Which nodes survive the current query. A folder survives when it or any
     * descendant matches; when the folder *itself* matched, all of its
     * descendants survive too.
     *
     * When a folder matches the query, all of its descendants survive too,
     * ensuring matching directories include their relevant contents.
     */
    function computeSearchSet() {
      if (!queryPredicate) return null;
      const keep = new Set();

      const walk = (node, ancestorMatched) => {
        const selfMatch = node.path ? queryPredicate.test(node.path) : false;
        const inherited = ancestorMatched || selfMatch;

        if (!node.isFolder) {
          if (inherited || selfMatch) keep.add(node.path);
          return inherited || selfMatch;
        }

        let any = false;
        for (const child of node.children.values()) {
          if (walk(child, inherited)) any = true;
        }
        if (any || selfMatch) {
          keep.add(node.path);
          return true;
        }
        return false;
      };

      walk(tree(), false);
      return keep;
    }

    let searchSetCache = { structureVersion: -1, query: null, set: null };

    function searchSet() {
      if (
        searchSetCache.structureVersion === state.structureVersion &&
        searchSetCache.query === state.query
      ) {
        return searchSetCache.set;
      }
      const set = computeSearchSet();
      searchSetCache = { structureVersion: state.structureVersion, query: state.query, set };
      return set;
    }

    /* ------------------------------------------------------- flattening */

    /**
     * Produces the ordered, flat row list the virtualised view renders.
     * Only expanded folders contribute children, so the cost is proportional
     * to what is on screen plus what is expanded — not to the whole tree.
     */
    function flatten() {
      const rows = [];
      const keep = searchSet();
      const openFolders = state.openFolders;
      const searching = !!queryPredicate;

      const sortNodes = nodes =>
        nodes.sort((a, b) => {
          if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

      const walk = (node, depth) => {
        const children = sortNodes([...node.children.values()]);
        for (const child of children) {
          if (keep && !keep.has(child.path)) continue;
          if (child.isFolder) {
            // While searching, matching folders auto-expand so results are
            // visible without the user having to click through.
            const open = openFolders.has(child.path) || searching;
            rows.push({ kind: 'folder', node: child, depth, open, path: child.path });
            if (open) walk(child, depth + 1);
          } else {
            rows.push({ kind: 'file', node: child, depth, path: child.path });
          }
        }
      };

      walk(tree(), 0);
      return rows;
    }

    /* ------------------------------------------------------------- stats */

    function stats() {
      ensureDerived();
      if (cache.stats && cache.statsVersion === state.version) return cache.stats;

      const visible = cache.visible;
      const selected = visible.filter(f => f.selected);
      const textSel = selected.filter(f => !f.isBinary);
      const binSel = selected.filter(f => f.isBinary);

      let selectedBytes = 0;
      let textBytes = 0;
      for (const f of selected) {
        selectedBytes += f.file.size;
        if (!f.isBinary) textBytes += f.file.size;
      }

      const maxChunkChars = store.get('maxChunkChars');
      const maxChunks = store.get('maxChunks');
      const overhead = textSel.length * data.CHUNK_OVERHEAD_CHARS;
      const estChunks = selected.length
        ? Math.max(1, Math.ceil((textBytes + overhead) / Math.max(1, maxChunkChars)))
        : 0;
      const estUploads = selected.length ? estChunks + binSel.length : 0;

      // Reason histogram, so the interface can explain the excluded count
      // instead of merely stating it.
      const reasons = new Map();
      for (const { verdict } of cache.excluded) {
        const key = verdict.reason || 'other';
        reasons.set(key, (reasons.get(key) || 0) + 1);
      }

      cache.statsVersion = state.version;
      cache.stats = {
        total: state.items.length,
        visible: visible.length,
        excluded: cache.excluded.length,
        selected: selected.length,
        selectedText: textSel.length,
        selectedBinary: binSel.length,
        selectedBytes,
        textBytes,
        estChunks,
        estUploads,
        estTokens: util.estimateTokens(textBytes + overhead),
        overBudget: estUploads > maxChunks,
        nearBudget: estUploads > maxChunks * data.LIMIT_WARNING_THRESHOLD,
        reasons,
        matches: queryPredicate ? visible.filter(f => queryPredicate.test(f.path)).length : visible.length
      };
      return cache.stats;
    }

    /* ---------------------------------------------------------- mutation */

    function snapshot(label) {
      undoStack.push({
        label,
        at: Date.now(),
        items: state.items.map(i => ({ path: i.path, selected: i.selected })),
        removed: null
      });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }

    /** Full snapshot including the item list, for removals and clears. */
    function snapshotFull(label) {
      undoStack.push({
        label,
        at: Date.now(),
        items: state.items.map(i => ({ path: i.path, selected: i.selected })),
        removed: state.items.slice(),
        gitignores: new Map(state.gitignores),
        root: state.root
      });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }

    function canUndo() {
      return undoStack.length > 0;
    }

    function lastUndoLabel() {
      return undoStack.length ? undoStack[undoStack.length - 1].label : '';
    }

    function undo() {
      const snap = undoStack.pop();
      if (!snap) return false;

      if (snap.removed) {
        state.items = snap.removed.slice();
        state.byPath = new Map(state.items.map(i => [i.path, i]));
        if (snap.gitignores) state.gitignores = new Map(snap.gitignores);
        state.root = snap.root ?? state.root;
      }
      const wanted = new Map(snap.items.map(i => [i.path, i.selected]));
      for (const item of state.items) {
        if (wanted.has(item.path)) item.selected = wanted.get(item.path);
      }

      invalidate({ type: 'undo', label: snap.label, structural: !!snap.removed });
      return true;
    }

    function setSelected(path, value) {
      const item = state.byPath.get(path);
      if (!item || item.selected === value) return false;
      item.selected = value;
      invalidate({ type: 'selection' });
      return true;
    }

    /**
     * Sets an entire subtree. Only *visible* files are touched: a file
     * excluded by policy is not part of the payload, and silently flipping its
     * hidden selection state would resurface later as a surprise.
     */
    function setSubtreeSelected(path, value) {
      const node = findNode(path);
      if (!node) return 0;
      const files = collectFiles(node);
      let changed = 0;
      for (const item of files) {
        if (item.selected !== value) {
          item.selected = value;
          changed += 1;
        }
      }
      if (changed) invalidate({ type: 'selection' });
      return changed;
    }

    /** Applies a preset over the visible set, snapshotting for undo. */
    function applyPreset(preset) {
      snapshot(`Preset: ${preset}`);
      ensureDerived();
      let changed = 0;
      for (const item of cache.visible) {
        const want = policy.presetSelects(preset, item);
        if (item.selected !== want) {
          item.selected = want;
          changed += 1;
        }
      }
      invalidate({ type: 'selection', preset });
      return changed;
    }

    /** Selects exactly the files currently matching the query. */
    function selectMatches(value) {
      if (!queryPredicate) return 0;
      snapshot(value ? 'Select matches' : 'Deselect matches');
      ensureDerived();
      let changed = 0;
      for (const item of cache.visible) {
        if (!queryPredicate.test(item.path)) continue;
        if (item.selected !== value) {
          item.selected = value;
          changed += 1;
        }
      }
      invalidate({ type: 'selection' });
      return changed;
    }

    function invertSelection() {
      snapshot('Invert selection');
      ensureDerived();
      for (const item of cache.visible) item.selected = !item.selected;
      invalidate({ type: 'selection' });
    }

    function removePath(path) {
      const node = findNode(path);
      if (!node) return 0;
      snapshotFull(`Remove ${util.basename(path) || path}`);

      const doomed = new Set(collectFiles(node).map(i => i.path));
      if (!doomed.size) return 0;

      state.items = state.items.filter(i => !doomed.has(i.path));
      state.byPath = new Map(state.items.map(i => [i.path, i]));
      for (const p of doomed) {
        if (util.basename(p).toLowerCase() === '.gitignore') {
          state.gitignores.delete(util.dirname(p));
          state.gitignoreVersion += 1;
        }
      }
      invalidate({ type: 'remove', count: doomed.size, structural: true });
      return doomed.size;
    }

    function clearAll() {
      if (!state.items.length) return false;
      snapshotFull('Clear workspace');
      state.items = [];
      state.byPath = new Map();
      state.gitignores = new Map();
      state.gitignoreVersion += 1;
      state.root = '';
      state.openFolders.clear();
      invalidate({ type: 'clear', structural: true });
      return true;
    }

    function toggleFolder(path) {
      if (state.openFolders.has(path)) state.openFolders.delete(path);
      else state.openFolders.add(path);
      invalidate({ type: 'expand' });
    }

    function setFolderOpen(path, open) {
      const had = state.openFolders.has(path);
      if (open === had) return false;
      if (open) state.openFolders.add(path);
      else state.openFolders.delete(path);
      invalidate({ type: 'expand' });
      return true;
    }

    function expandAll() {
      ensureDerived();
      for (const item of cache.visible) {
        for (const dir of util.ancestors(item.path)) state.openFolders.add(dir);
      }
      invalidate({ type: 'expand' });
    }

    function collapseAll() {
      if (!state.openFolders.size) return;
      state.openFolders.clear();
      invalidate({ type: 'expand' });
    }

    /** Expands just enough to reveal a path, used by keyboard navigation. */
    function revealPath(path) {
      let changed = false;
      for (const dir of util.ancestors(path)) {
        if (!state.openFolders.has(dir)) {
          state.openFolders.add(dir);
          changed = true;
        }
      }
      if (changed) invalidate({ type: 'expand' });
      return changed;
    }

    /* ------------------------------------------------------------ output */

    /**
     * The files that will actually be packed, in the configured order.
     * This is the only function the packer consumes, so "what you see is what
     * is uploaded" holds by construction.
     */
    function payload() {
      ensureDerived();
      const selected = cache.visible.filter(f => f.selected);
      const order = store.get('sortOrder');

      const sorted = selected.slice();
      if (order === 'size-desc') sorted.sort((a, b) => b.file.size - a.file.size || a.path.localeCompare(b.path));
      else if (order === 'size-asc') sorted.sort((a, b) => a.file.size - b.file.size || a.path.localeCompare(b.path));
      else if (order === 'ext') {
        sorted.sort(
          (a, b) => util.extname(a.path).localeCompare(util.extname(b.path)) || a.path.localeCompare(b.path)
        );
      } else sorted.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

      return {
        text: sorted.filter(f => !f.isBinary),
        binary: sorted.filter(f => f.isBinary),
        all: sorted
      };
    }

    /** Paths the user has deliberately deselected, for session memory. */
    function deselectedPaths() {
      ensureDerived();
      return cache.visible.filter(f => !f.selected).map(f => f.path);
    }

    function reset() {
      state.items = [];
      state.byPath = new Map();
      state.gitignores = new Map();
      state.root = '';
      state.openFolders.clear();
      state.query = '';
      queryPredicate = null;
      undoStack.length = 0;
      cache = {
        structureVersion: -1,
        statsVersion: -1,
        policySignature: '',
        compiled: null,
        visible: null,
        visibleByPath: null,
        excluded: null,
        tree: null,
        stats: null
      };
      invalidate({ type: 'reset', structural: true });
    }

    return {
      state,
      subscribe,
      merge,
      applyRememberedSelection,
      visibleItems,
      excludedItems,
      verdictFor,
      tree,
      buildTree,
      nodeCheckState,
      collectFiles,
      findNode,
      setQuery,
      matchesQuery,
      searchSet,
      flatten,
      stats,
      snapshot,
      canUndo,
      lastUndoLabel,
      undo,
      setSelected,
      setSubtreeSelected,
      applyPreset,
      selectMatches,
      invertSelection,
      removePath,
      clearAll,
      toggleFolder,
      setFolderOpen,
      expandAll,
      collapseAll,
      revealPath,
      payload,
      deselectedPaths,
      reset,
      compiledPolicy
    };
  })();

  /* =======================================================================
   * SECTION 09 — Packing
   * -----------------------------------------------------------------------
   * Turning the selected files into markdown chunks.
   *
   * Robust packing architecture:
   *
   *  1. **Fence collision.** Every file was wrapped in a three-backtick fence
   *     with no check for backticks in the content. Any markdown file
   *     containing a code block — which is most of them, and is exactly what
   *     this tool ingests — terminated its own fence early and corrupted the
   *     rest of the chunk. The fence is now sized to exceed the longest
   *     backtick run in the file.
   *  2. **Budget arithmetic.** `maxContentSize = Math.max(1000, maxChunkChars
   *     - 300)` exceeds `maxChunkChars` whenever the chunk budget is below
   *     1300, so every emitted block overflowed the limit it was meant to
   *     respect. The per-file budget is now derived from the real header
   *     length and clamped to the chunk budget.
   *  3. **Silent truncation.** The split loop advanced by `chunkContent.length`
   *     and broke out on an empty slice. A surrogate pair at a boundary
   *     produced an empty slice, so the remainder of the file was dropped with
   *     no error. `util.safeSlice` now returns the exact next offset and
   *     guarantees forward progress.
   *  4. **Header not counted.** `currentChars` only tracked block lengths, so
   *     the `# Codebase Context — Part N` header pushed every chunk over
   *     budget by its own length.
   *  5. **No cancellation, no progress.** Packing a large repository read
   *     every file in a tight `await` loop with no way to stop and no
   *     feedback. It is now abortable at every await point and reports
   *     progress per file.
   * ==================================================================== */

  const packer = (() => {
    /** Language hints for the fence, keyed by extension. */
    const LANG_BY_EXT = {
      '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
      '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
      '.tsx': 'tsx', '.jsx': 'jsx', '.py': 'python', '.pyi': 'python',
      '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
      '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift',
      '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
      '.hpp': 'cpp', '.hxx': 'cpp', '.cs': 'csharp', '.php': 'php',
      '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss',
      '.sass': 'sass', '.less': 'less', '.json': 'json', '.jsonc': 'jsonc',
      '.json5': 'json5', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
      '.xml': 'xml', '.md': 'markdown', '.mdx': 'mdx', '.markdown': 'markdown',
      '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'fish',
      '.ps1': 'powershell', '.bat': 'batch', '.cmd': 'batch',
      '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
      '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
      '.lua': 'lua', '.pl': 'perl', '.pm': 'perl', '.r': 'r',
      '.scala': 'scala', '.clj': 'clojure', '.cljs': 'clojure',
      '.ex': 'elixir', '.exs': 'elixir', '.elm': 'elm', '.hs': 'haskell',
      '.ml': 'ocaml', '.fs': 'fsharp', '.dart': 'dart', '.gradle': 'gradle',
      '.proto': 'protobuf', '.prisma': 'prisma', '.tf': 'hcl', '.hcl': 'hcl',
      '.nim': 'nim', '.cr': 'crystal', '.zig': 'zig', '.sol': 'solidity',
      '.nix': 'nix', '.tex': 'latex', '.rst': 'rst', '.diff': 'diff',
      '.patch': 'diff', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
      '.env': 'dotenv', '.dockerfile': 'dockerfile', '.csv': 'csv', '.tsv': 'tsv',
      '.txt': 'text', '.log': 'text', '.text': 'text'
    };

    const LANG_BY_NAME = {
      dockerfile: 'dockerfile',
      makefile: 'makefile',
      justfile: 'makefile',
      rakefile: 'ruby',
      gemfile: 'ruby',
      procfile: 'yaml',
      vagrantfile: 'ruby',
      '.gitignore': 'gitignore',
      '.dockerignore': 'gitignore',
      '.npmignore': 'gitignore',
      '.editorconfig': 'ini',
      '.env': 'dotenv'
    };

    function languageFor(path) {
      const name = util.basename(path).toLowerCase();
      if (LANG_BY_NAME[name]) return LANG_BY_NAME[name];
      const ext = util.extname(path);
      if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
      return ext ? ext.slice(1) : '';
    }

    /**
     * The longest run of backticks anywhere in `text`. A fence must be longer
     * than this or the block terminates early if code fences are nested.
     */
    function longestBacktickRun(text) {
      let longest = 0;
      let run = 0;
      for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) === 96) {
          run += 1;
          if (run > longest) longest = run;
        } else {
          run = 0;
        }
      }
      return longest;
    }

    const fenceFor = text => '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));

    /* -------------------------------------------------------- transforms */

    function applyTextTransforms(text, settings) {
      let out = text;
      // Normalise line endings so chunk boundaries and line numbering are
      // consistent regardless of the source platform.
      out = out.replace(/\r\n?/g, '\n');
      if (settings.stripTrailingWhitespace) out = out.replace(/[ \t]+$/gm, '');
      if (settings.collapseBlankLines) out = out.replace(/\n{3,}/g, '\n\n');
      return out;
    }

    function withLineNumbers(text, startLine = 1) {
      const lines = text.split('\n');
      const width = String(startLine + lines.length - 1).length;
      return lines
        .map((line, i) => `${String(startLine + i).padStart(width, ' ')} | ${line}`)
        .join('\n');
    }

    /* ---------------------------------------------------------- manifest */

    /** ASCII directory tree for the manifest, bounded so it cannot dominate. */
    function renderTree(paths, { maxLines = 800 } = {}) {
      const root = { children: new Map(), isFile: false };
      for (const p of paths) {
        const parts = p.split('/').filter(Boolean);
        let node = root;
        parts.forEach((seg, i) => {
          if (!node.children.has(seg)) {
            node.children.set(seg, { children: new Map(), isFile: i === parts.length - 1 });
          }
          node = node.children.get(seg);
        });
      }

      const lines = [];
      let truncated = false;

      const walk = (node, prefix) => {
        const entries = [...node.children.entries()].sort((a, b) => {
          const aDir = a[1].children.size > 0;
          const bDir = b[1].children.size > 0;
          if (aDir !== bDir) return aDir ? -1 : 1;
          return a[0].localeCompare(b[0], undefined, { numeric: true });
        });
        entries.forEach(([name, child], i) => {
          if (lines.length >= maxLines) {
            truncated = true;
            return;
          }
          const last = i === entries.length - 1;
          lines.push(`${prefix}${last ? '└── ' : '├── '}${name}${child.children.size ? '/' : ''}`);
          if (child.children.size) walk(child, `${prefix}${last ? '    ' : '│   '}`);
        });
      };

      walk(root, '');
      if (truncated) lines.push('… (tree truncated)');
      return lines.join('\n');
    }

    function buildManifest({ textFiles, binaryFiles, chunkCount, settings, totals }) {
      const parts = ['# Codebase Manifest'];

      if (settings.customPrompt && settings.customPrompt.trim()) {
        parts.push('', settings.customPrompt.trim());
      }

      parts.push('');
      parts.push(`- **Total files:** ${textFiles.length + binaryFiles.length}`);
      parts.push(`- **Chunks:** ${chunkCount}`);

      if (settings.manifestStats) {
        parts.push(`- **Text files:** ${textFiles.length}`);
        if (binaryFiles.length) parts.push(`- **Binary attachments:** ${binaryFiles.length}`);
        parts.push(`- **Total size:** ${util.formatSize(totals.bytes)}`);
        parts.push(`- **Characters packed:** ${totals.chars.toLocaleString('en-US')}`);
        parts.push(`- **Estimated tokens:** ~${util.estimateTokens(totals.chars).toLocaleString('en-US')}`);
        if (totals.splitFiles) parts.push(`- **Files split across chunks:** ${totals.splitFiles}`);
        if (totals.unreadable) parts.push(`- **Unreadable files:** ${totals.unreadable}`);
      }

      if (settings.includeTree) {
        const tree = renderTree([...textFiles.map(f => f.path), ...binaryFiles.map(f => f.path)]);
        if (tree) {
          parts.push('', '## Directory tree', '', '```text', tree, '```');
        }
      }

      parts.push('', '## File list');
      for (const f of textFiles) parts.push(`- \`${f.path}\``);
      for (const f of binaryFiles) parts.push(`- \`${f.path}\` (binary)`);

      return parts.join('\n');
    }

    /* ------------------------------------------------------------ naming */

    function chunkName(index, naming) {
      return naming === 'indexed'
        ? `codebase_${String(index).padStart(3, '0')}.md`
        : `codebase_part_${index}.md`;
    }

    /* ------------------------------------------------------------- build */

    /**
     * @typedef {object} PackResult
     * @property {File[]}  chunks    manifest first, then the content chunks
     * @property {object}  totals
     * @property {string[]} warnings
     */

    /**
     * Packs the selected text files into markdown chunks.
     *
     * @param {Array} textFiles
     * @param {Array} binaryFiles listed in the manifest, delivered as-is
     * @param {object} options
     * @param {AbortSignal} [options.signal]
     * @param {(p: {done:number,total:number,path:string,bytes:number}) => void} [options.onProgress]
     * @returns {Promise<PackResult>}
     */
    async function pack(textFiles, binaryFiles = [], options = {}) {
      const { signal, onProgress } = options;
      const settings = store.all();
      const naming = settings.chunkNaming;

      const chunkBudget = Math.max(data.LIMITS.maxChunkChars.min, settings.maxChunkChars);
      const chunks = [];
      const warnings = [];

      let chunkIndex = 1;
      let parts = [];
      let used = 0;
      let splitFiles = 0;
      let unreadable = 0;
      let totalChars = 0;
      let totalBytes = 0;

      const headerFor = n => `# Codebase Context — Part ${n}\n\n`;

      const flush = () => {
        if (!parts.length) return;
        const header = headerFor(chunkIndex);
        chunks.push(
          new File([header + parts.join('')], chunkName(chunkIndex, naming), { type: 'text/markdown' })
        );
        chunkIndex += 1;
        parts = [];
        used = 0;
      };

      for (let i = 0; i < textFiles.length; i += 1) {
        util.throwIfAborted(signal);
        const entry = textFiles[i];
        const { path, file } = entry;

        onProgress?.({ done: i, total: textFiles.length, path, bytes: totalBytes });

        let content;
        try {
          content = await file.text();
        } catch (e) {
          env.log.warn(`could not read ${path}`, e);
          unreadable += 1;
          warnings.push(`Unreadable: ${path}`);
          content = '[unreadable — the file could not be read from disk]';
        }

        content = applyTextTransforms(content, settings);
        totalBytes += file.size;

        const lang = languageFor(path);
        const fence = fenceFor(content);

        // The exact per-file budget, derived from the real header rather than
        // a magic constant, and never larger than a whole chunk.
        const headerLen = headerFor(chunkIndex).length;
        const wrapperLen = `## File: \`${path}\` (Part 99)\n\n${fence}${lang}\n\n${fence}\n\n`.length;
        const perFileBudget = Math.max(200, Math.min(chunkBudget - headerLen, chunkBudget) - wrapperLen);

        const isLarge = content.length > perFileBudget;
        if (isLarge) splitFiles += 1;

        let offset = 0;
        let partNum = 1;
        let line = 1;

        do {
          util.throwIfAborted(signal);

          const slice = util.safeSlice(content, offset, perFileBudget);
          let body = slice.text;
          if (settings.includeLineNumbers && body) {
            body = withLineNumbers(body, line);
            line += slice.text.split('\n').length - 1;
          }

          const displayPath = isLarge ? `${path} (Part ${partNum})` : path;
          const block = `## File: \`${displayPath}\`\n\n${fence}${lang}\n${body}\n${fence}\n\n`;

          // Start a new chunk when this block would overflow, but never flush
          // an empty chunk just because one block is larger than the budget.
          if (parts.length && used + block.length > chunkBudget - headerLen) flush();

          parts.push(block);
          used += block.length;
          totalChars += block.length;

          offset = slice.next;
          partNum += 1;
        } while (offset < content.length);

        if (i % 8 === 0) await util.yieldToUI();
      }

      flush();
      onProgress?.({ done: textFiles.length, total: textFiles.length, path: '', bytes: totalBytes });

      for (const f of binaryFiles) totalBytes += f.file.size;

      const totals = {
        chars: totalChars,
        bytes: totalBytes,
        splitFiles,
        unreadable,
        chunkCount: chunks.length,
        textFiles: textFiles.length,
        binaryFiles: binaryFiles.length
      };

      const manifest = buildManifest({
        textFiles,
        binaryFiles,
        chunkCount: chunks.length,
        settings,
        totals
      });

      chunks.unshift(new File([manifest], 'codebase_manifest.md', { type: 'text/markdown' }));

      return { chunks, totals, warnings };
    }

    /**
     * Concatenates markdown chunks into one document for the download path.
     * Built from Blob parts rather than by reading each chunk back into a
     * string, so the browser never holds two full copies in memory.
     */
    function combine(mdFiles, name = 'codebase_combined.md') {
      if (!mdFiles.length) return null;
      const parts = [];
      mdFiles.forEach((f, i) => {
        if (i) parts.push('\n\n---\n\n');
        parts.push(f);
      });
      return new File(parts, name, { type: 'text/markdown' });
    }

    /** A dry-run manifest preview, so the user can inspect before packing. */
    function previewManifest(textFiles, binaryFiles) {
      const settings = store.all();
      const bytes = [...textFiles, ...binaryFiles].reduce((a, f) => a + f.file.size, 0);
      const chars = textFiles.reduce((a, f) => a + f.file.size, 0);
      const chunkCount = Math.max(
        1,
        Math.ceil((chars + textFiles.length * data.CHUNK_OVERHEAD_CHARS) / Math.max(1, settings.maxChunkChars))
      );
      return buildManifest({
        textFiles,
        binaryFiles,
        chunkCount,
        settings,
        totals: { bytes, chars, splitFiles: 0, unreadable: 0 }
      });
    }

    return {
      pack,
      combine,
      previewManifest,
      buildManifest,
      renderTree,
      languageFor,
      longestBacktickRun,
      fenceFor,
      applyTextTransforms,
      withLineNumbers,
      chunkName
    };
  })();

  /* =======================================================================
   * SECTION 10 — Delivery
   * -----------------------------------------------------------------------
   * Getting the packed files to their destination: the chat composer, the
   * clipboard, or disk.
   *
   * The composer path is built on a proven selector ladder and recursive shadow search
   * to ensure compatibility across all supported AI chat interfaces:
   *
   *  1. Element discovery uses a deterministic ladder, specific selectors first,
   *     with recursive shadow DOM traversal.
   *  2. Success is never assumed. After dispatching, the page is observed for
   *     evidence that it actually took the files, and the absence of evidence
   *     is reported as such rather than as success.
   * ==================================================================== */

  const deliver = (() => {
    /* ------------------------------------------------- input discovery */

    /**
     * Universal selector ladder for chat file inputs.
     * Specific attributes are prioritized, and shadow DOM roots are inspected recursively.
     */
    const UNIVERSAL_LADDER = [
      'input[data-testid="file-upload-input"]',
      'input[data-testid="upload-file-input"]',
      'input.chat-upload__input',
      'input[type="file"][accept*="text"]',
      'input[type="file"][multiple]',
      'input[type="file"]'
    ];

    const UNIVERSAL_COMPOSER = [
      '#prompt-textarea',
      'textarea',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];

    /**
     * Every searchable root: the document, then open shadow roots in document
     * order. Shadow root traversal is budgeted so a pathological page cannot
     * make discovery expensive.
     */
    function collectRoots() {
      const roots = [document];
      const MAX_NODES = 30000;
      const MAX_ROOTS = 250;
      const MAX_DEPTH = 6;
      let budget = MAX_NODES;

      const descend = (root, depth) => {
        if (depth > MAX_DEPTH || budget <= 0 || roots.length >= MAX_ROOTS) return;
        let nodes;
        try {
          nodes = root.querySelectorAll('*');
        } catch {
          return;
        }
        for (const node of nodes) {
          if (budget-- <= 0 || roots.length >= MAX_ROOTS) return;
          const sr = node.shadowRoot;
          if (sr) {
            roots.push(sr);
            descend(sr, depth + 1);
          }
        }
      };

      try {
        descend(document, 0);
      } catch (e) {
        env.log.debug('shadow traversal failed', e);
      }
      return roots;
    }

    const isFileInput = node =>
      !!node && node.nodeType === 1 && node.tagName === 'INPUT' && node.type === 'file' && node.isConnected;

    /**
     * Whether an `accept` attribute could take the files we are handing over.
     *
     * This is not a heuristic: `accept` is the element's own declaration of
     * what it will take, and the browser applies it to a real user selection.
     * An input that cannot take markdown is not the composer's attachment
     * input, and assigning to it is how the previous revision produced a
     * false success. An input with no `accept` takes anything.
     */
    function acceptsFiles(input, files) {
      const accept = (input.getAttribute('accept') || '').trim().toLowerCase();
      if (!accept) return true;
      const tokens = accept.split(',').map(t => t.trim()).filter(Boolean);
      if (!tokens.length) return true;

      return files.every(file => {
        const name = String(file.name || '').toLowerCase();
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
        const type = String(file.type || '').toLowerCase();
        return tokens.some(token => {
          if (token === '*' || token === '*/*') return true;
          if (token.startsWith('.')) return ext === token;
          if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
          return type && token === type;
        });
      });
    }

    /**
     * Root-major, selector-minor order.
     */
    function findDeep(selectors, roots, predicate) {
      for (const root of roots) {
        for (const sel of selectors) {
          let nodes;
          try {
            nodes = root.querySelectorAll(sel);
          } catch {
            continue;
          }
          for (const node of nodes) {
            if (predicate(node)) return node;
          }
        }
      }
      return null;
    }

    /** The ladder for this site: profile-specific selectors, then the universal ladder. */
    function ladderFor(profile) {
      return util.unique([...(profile.selectors || []), ...UNIVERSAL_LADDER]);
    }

    /**
     * Finds the composer's file input.
     *
     * No caching. The previous revision cached the result for 15 seconds,
     * which on a single-page chat application is long enough for the composer
     * to be re-rendered and the cached node to be a detached orphan that
     * accepts an assignment and tells nobody.
     */
    function findFileInput(files = []) {
      const profile = data.siteProfile();
      const roots = collectRoots();
      const ladder = ladderFor(profile);

      // Preferred: an input that can actually take these files.
      const usable = findDeep(ladder, roots, n => isFileInput(n) && !n.disabled && acceptsFiles(n, files));
      if (usable) return usable;

      // Nothing declared compatible. Fall back to structural match,
      // but only when we have no files to check against.
      if (!files.length) {
        return findDeep(ladder, roots, n => isFileInput(n) && !n.disabled);
      }
      return null;
    }

    function findComposer() {
      const profile = data.siteProfile();
      const roots = collectRoots();
      const selectors = util.unique([...(profile.composer || []), ...UNIVERSAL_COMPOSER]);
      return findDeep(selectors, roots, n => n instanceof HTMLElement && n.isConnected);
    }

    /* ---------------------------------------------------- injection */

    function makeDataTransfer(files) {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      return dt;
    }

    /**
     * Assigns files to an input and notifies the page.
     *
     * Event order is `change` then `input` because that is
     * the sequence the target sites are known to work with. The assignment is
     * verified, because a framework-installed setter can ignore the write.
     */
    function assignToInput(input, files) {
      let dt;
      try {
        dt = makeDataTransfer(files);
      } catch (e) {
        env.log.warn('DataTransfer construction failed', e);
        return { ok: false, reason: 'datatransfer' };
      }

      try {
        input.files = dt.files;
      } catch (e) {
        env.log.warn('file input assignment threw', e);
        return { ok: false, reason: 'assign-threw' };
      }

      if (!input.files || input.files.length !== files.length) {
        return { ok: false, reason: 'assign-rejected' };
      }

      try {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) {
        env.log.warn('event dispatch failed', e);
        return { ok: false, reason: 'dispatch' };
      }

      return { ok: true };
    }

    /** Synthesises a drag-and-drop onto a target that accepts drops. */
    function dispatchDrop(target, files) {
      let dt;
      try {
        dt = makeDataTransfer(files);
      } catch {
        return false;
      }
      try {
        const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
        target.dispatchEvent(new DragEvent('dragenter', opts));
        target.dispatchEvent(new DragEvent('dragover', opts));
        target.dispatchEvent(new DragEvent('drop', opts));
        return true;
      } catch (e) {
        env.log.debug('synthetic drop failed', e);
        return false;
      }
    }

    /* -------------------------------------------------- verification */

    /**
     * A short, distinctive token from a filename that survives the truncation
     * chat composers apply when they render an attachment chip.
     */
    function evidenceToken(name) {
      const base = String(name || '').replace(/\.[^.]*$/, '');
      return base.slice(0, 12);
    }

    /**
     * Waits for observable evidence that the page actually took the files.
     *
     * Three independent signals, because no single one is universal:
     *
     *   dom       one of our filenames appeared in the document — the page
     *             rendered an attachment chip. Strongest signal.
     *   consumed  the input was emptied, which is what a composer does after
     *             reading `files`.
     *   network   a new fetch/XHR started right after the dispatch, which is
     *             what an upload looks like from the outside.
     *
     * Absence of all three is reported as `unconfirmed` and never as success.
     *
     * @returns {Promise<{verdict:'confirmed'|'accepted'|'unconfirmed', signals:object}>}
     */
    async function verifyAcceptance(files, input, { timeout = data.UPLOAD_VERIFY_MS, onTick } = {}) {
      const tokens = util.unique(files.map(f => evidenceToken(f.name)).filter(t => t.length >= 6));
      const signals = { dom: false, consumed: false, network: false };

      const hasToken = text => {
        if (!text) return false;
        for (const t of tokens) if (text.includes(t)) return true;
        return false;
      };

      /* network */
      let perfObserver = null;
      const startedAt = (() => {
        try {
          return performance.now();
        } catch {
          return 0;
        }
      })();
      try {
        perfObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.startTime < startedAt) continue;
            if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') {
              signals.network = true;
            }
          }
        });
        perfObserver.observe({ type: 'resource', buffered: false });
      } catch {
        perfObserver = null;
      }

      /* dom */
      let domObserver = null;
      try {
        domObserver = new MutationObserver(records => {
          if (signals.dom) return;
          for (const rec of records) {
            if (rec.type === 'characterData') {
              if (hasToken(rec.target.data)) {
                signals.dom = true;
                return;
              }
              continue;
            }
            for (const node of rec.addedNodes) {
              const text = node.nodeType === 3 ? node.data : node.textContent;
              if (hasToken(text)) {
                signals.dom = true;
                return;
              }
            }
          }
        });
        domObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch (e) {
        env.log.debug('acceptance observer unavailable', e);
      }

      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (signals.dom) break;
        if (input && input.files && input.files.length === 0) signals.consumed = true;
        if (signals.consumed && signals.network) break;
        onTick?.((timeout - (deadline - Date.now())) / timeout);
        // eslint-disable-next-line no-await-in-loop
        await util.sleep(150);
      }

      domObserver?.disconnect();
      perfObserver?.disconnect();

      // One final sweep, in case the chip was rendered before the observer
      // attached or through a mechanism that produced no mutation record.
      if (!signals.dom && tokens.length) {
        try {
          signals.dom = hasToken(document.body?.textContent || '');
        } catch {
          /* an enormous document; the live observer was the real check */
        }
      }

      const verdict = signals.dom ? 'confirmed' : signals.consumed || signals.network ? 'accepted' : 'unconfirmed';
      return { verdict, signals };
    }

    /**
     * Attaches files to the page's composer and reports what actually
     * happened.
     *
     * @returns {Promise<{ok:boolean, verdict:string, via:string, reason?:string,
     *                    note?:string, signals?:object}>}
     */
    async function toChat(files, { onProgress } = {}) {
      const profile = data.siteProfile();

      if (profile.chatInjection === false) {
        return {
          ok: false,
          verdict: 'unsupported',
          via: 'none',
          reason: 'site-unsupported',
          note: profile.injectionNote
        };
      }

      const input = findFileInput(files);
      let via = null;

      if (input) {
        const res = assignToInput(input, files);
        if (res.ok) {
          via = 'file-input';
        } else {
          env.log.warn('file input rejected the assignment', res.reason);
          // A re-render between discovery and assignment is the likely cause;
          // discovery is uncached, so a second look gets the current node.
          const fresh = findFileInput(files);
          if (fresh && fresh !== input) {
            const retry = assignToInput(fresh, files);
            if (retry.ok) via = 'file-input';
          }
        }
      }

      if (!via) {
        const composer = findComposer();
        if (composer && dispatchDrop(composer, files)) via = 'composer-drop';
        else if (document.body && dispatchDrop(document.body, files)) via = 'body-drop';
      }

      if (!via) {
        return {
          ok: false,
          verdict: 'failed',
          via: 'none',
          reason: input ? 'rejected' : 'no-input'
        };
      }

      onProgress?.(0);
      const { verdict, signals } = await verifyAcceptance(files, input, { onTick: onProgress });

      return {
        ok: verdict !== 'unconfirmed',
        verdict,
        via,
        signals
      };
    }

    /* ------------------------------------------------------------ disk */

    const liveUrls = new Set();

    function revokeAll() {
      for (const url of liveUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already revoked */
        }
      }
      liveUrls.clear();
    }

    function downloadOne(file) {
      const url = URL.createObjectURL(file);
      liveUrls.add(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.rel = 'noopener';
      a.style.display = 'none';
      // Anchors must be connected in Firefox for a programmatic click to
      // start a download; it is removed again immediately.
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
        liveUrls.delete(url);
      }, data.REVOCATION_DELAY_MS);
    }

    /**
     * Saves files to disk. Browsers rate-limit and sometimes silently drop
     * rapid consecutive downloads, so they are spaced out.
     *
     * The File System Access save dialog is deliberately not used. It requires
     * transient user activation, and by the time a bundle has been packed the
     * activation from the button click is long gone — so it threw on every
     * real run and fell through to this path anyway, having first cost the
     * user an unexplained permission failure.
     */
    async function toDisk(files, { signal } = {}) {
      if (!files.length) return { ok: false, count: 0, reason: 'empty' };

      let count = 0;
      for (const file of files) {
        util.throwIfAborted(signal);
        downloadOne(file);
        count += 1;
        if (count < files.length) {
          // eslint-disable-next-line no-await-in-loop
          await util.sleep(220);
        }
      }
      return { ok: true, count, via: 'download' };
    }

    /* ------------------------------------------------------- clipboard */

    /**
     * Copies one file to the clipboard.
     *
     * Ordering is chosen for reliability, not novelty:
     *   1. `GM_setClipboard` — synchronous, no transient-activation rule.
     *   2. `ClipboardItem` with a *promise* value — the only pattern WebKit
     *      accepts after an await, and it works in Chromium too.
     *   3. `writeText` — fine in Chromium and Firefox.
     *
     * Images are copied as `image/png` when the source is already PNG, since
     * that is the only image type the clipboard accepts across engines; any
     * other image becomes a base64 data URL, which is what an AI chat can
     * actually consume from a paste.
     *
     * @returns {Promise<'text'|'image'|'base64'>}
     */
    async function copyFile(file) {
      const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';

      if (isImage) {
        if (file.type === 'image/png' && env.capabilities.asyncClipboard) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
            return 'image';
          } catch (e) {
            env.log.debug('image clipboard write failed; using data URL', e);
          }
        }
        const dataUrl = await readAsDataURL(file);
        if (await env.writeClipboardText(dataUrl)) return 'base64';
        throw new Error('Clipboard rejected the image');
      }

      // Text path. Read first so a failure surfaces as a read error rather
      // than a clipboard error, then write through the most reliable channel.
      const text = await file.text();
      if (await env.writeClipboardText(text)) return 'text';

      if (env.capabilities.asyncClipboard) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': Promise.resolve(new Blob([text], { type: 'text/plain' }))
            })
          ]);
          return 'text';
        } catch (e) {
          env.log.debug('ClipboardItem text write failed', e);
        }
      }

      throw new Error('Clipboard is unavailable');
    }

    function readAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Unexpected read result'));
        };
        reader.onerror = () => reject(reader.error || new Error('Read failed'));
        try {
          reader.readAsDataURL(file);
        } catch (e) {
          reject(e);
        }
      });
    }

    /** Copies several markdown files as one concatenated document. */
    async function copyCombined(files) {
      const md = files.filter(f => f.type === 'text/markdown' || f.name.endsWith('.md'));
      const source = md.length ? md : files;
      const combined = packer.combine(source, 'combined.md');
      if (!combined) throw new Error('Nothing to copy');
      return copyFile(combined);
    }

    function dispose() {
      revokeAll();
    }

    return {
      findFileInput,
      findComposer,
      acceptsFiles,
      assignToInput,
      dispatchDrop,
      verifyAcceptance,
      evidenceToken,
      collectRoots,
      UNIVERSAL_LADDER,
      toChat,
      toDisk,
      downloadOne,
      copyFile,
      copyCombined,
      revokeAll,
      dispose
    };
  })();

  /* =======================================================================
   * SECTION 11 — Styles and icons
   * -----------------------------------------------------------------------
   * The "Swiss Industrial Telemetry & CRT Command Matrix" aesthetic features
   * a distinct palette (`#08090d` substrate, `#00E5FF` phosphor cyan,
   * `#FF3333` execute red, 2px industrial radii, monospaced stack) and
   * strict single-focus-ring rule:
   *
   *   - the palette is driven entirely by custom properties, so theme switching
   *     is an attribute change rather than a second stylesheet;
   *   - radii come cleanly from tokens rather than ad-hoc overrides;
   *   - a `density` attribute drives compact layouts dynamically without
   *     scattered hardcoded pixel values;
   *   - motion respects both `prefers-reduced-motion` and the explicit
   *     setting;
   *   - virtualised lists, progress bars, exclusion badges and modal
   *     dialogs provide structured feedback surfaces.
   *
   * Everything is scoped to the shadow root, so nothing here can affect the
   * host page and nothing on the host page can affect it.
   * ==================================================================== */

  const STYLESHEET = `
  :host {
    all: initial;
    position: fixed !important;
    inset: 0 auto auto 0;
    width: 0; height: 0;
    z-index: 2147483647 !important;
    pointer-events: none;
    contain: style;

    --bg-base: #08090d;
    --surface-0: #06070a;
    --surface-1: #0b0c12;
    --surface-2: #12141d;
    --surface-3: #181b28;

    --border: #1e2230;
    --border-strong: #2e3448;

    --text-primary: #f0f2f8;
    --text-secondary: #82889a;
    --text-tertiary: #525866;

    --accent: #00E5FF;
    --accent-soft: rgba(0, 229, 255, 0.14);
    --accent-glow: rgba(0, 229, 255, 0.35);
    --danger: #FF3333;
    --danger-soft: rgba(255, 51, 51, 0.16);
    --warn: #FFB800;
    --warn-soft: rgba(255, 184, 0, 0.16);
    --success: #3CD070;
    --success-soft: rgba(60, 208, 112, 0.16);

    --dir-color: #FFB800;
    --code-color: #00E5FF;
    --bin-color: #3CD070;

    --radius: 2px;
    --radius-lg: 3px;
    --ease: cubic-bezier(0.16, 1, 0.3, 1);
    --speed: 150ms;

    --row-h: 26px;
    --pad: 14px;
    --gap: 8px;
    --fs: 13px;
    --fs-sm: 11.5px;
    --fs-xs: 10.5px;

    --font-mono: 'JetBrains Mono', 'Space Mono', 'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    font-family: var(--font-mono);
    font-size: var(--fs);
    line-height: 1.45;
    color: var(--text-primary);
  }

  .cu-root[data-theme='slate'] {
    --bg-base: #14161b;
    --surface-0: #101216;
    --surface-1: #171a20;
    --surface-2: #1f232b;
    --surface-3: #272c36;
    --border: #2b313c;
    --border-strong: #3d4553;
    --text-primary: #e8ebf0;
    --text-secondary: #98a0ae;
    --text-tertiary: #6b7280;
    --accent: #6aa8ff;
    --accent-soft: rgba(106, 168, 255, 0.16);
    --accent-glow: rgba(106, 168, 255, 0.32);
    --danger: #ff6b6b;
    --code-color: #6aa8ff;
    --radius: 6px;
    --radius-lg: 10px;
  }

  .cu-root[data-theme='light'] {
    --bg-base: #ffffff;
    --surface-0: #f4f6f9;
    --surface-1: #ffffff;
    --surface-2: #f0f2f6;
    --surface-3: #e6e9ef;
    --border: #d5d9e2;
    --border-strong: #b3bac7;
    --text-primary: #14171c;
    --text-secondary: #545c6b;
    --text-tertiary: #7c8494;
    --accent: #0b62d6;
    --accent-soft: rgba(11, 98, 214, 0.12);
    --accent-glow: rgba(11, 98, 214, 0.28);
    --danger: #c62828;
    --danger-soft: rgba(198, 40, 40, 0.12);
    --warn: #9a6700;
    --warn-soft: rgba(154, 103, 0, 0.14);
    --success: #16794a;
    --success-soft: rgba(22, 121, 74, 0.14);
    --dir-color: #9a6700;
    --code-color: #0b62d6;
    --bin-color: #16794a;
    --radius: 6px;
    --radius-lg: 10px;
  }

  .cu-root[data-density='compact'] {
    --row-h: 21px;
    --pad: 9px;
    --gap: 6px;
    --fs: 12px;
    --fs-sm: 11px;
    --fs-xs: 10px;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  svg { pointer-events: none; display: block; flex-shrink: 0; }

  /* ─── Single phosphor focus ring (no double outline, ever) ─── */
  .cu-root *:focus { outline: none; }
  .cu-root *:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 0 12px var(--accent-glow);
    z-index: 1;
  }

  .cu-root[data-motion='reduce'] *,
  .cu-root[data-motion='reduce'] *::before,
  .cu-root[data-motion='reduce'] *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .cu-root *, .cu-root *::before, .cu-root *::after {
      transition-duration: 0ms !important;
      animation-duration: 0ms !important;
    }
  }

  .cu-sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
  }

  /* ─── Overlay & panel ───
   * The overlay is a <dialog> opened with showModal(), which places it in the
   * browser's top layer. That matters on these hosts specifically: several of
   * them (Claude, ChatGPT) open their own <dialog> elements, and a top-layer
   * dialog covers any z-index a plain div can claim — including 2147483647.
   * showModal() also gives native Escape handling, a native backdrop and a
   * native focus trap, avoiding custom trap quirks. The
   * cu-fallback-open rules cover engines without showModal.
   */
  #cu-overlay {
    position: fixed; inset: 0;
    width: 100%; height: 100%; max-width: 100%; max-height: 100%;
    margin: 0; padding: 0; border: 0;
    background: transparent; color: inherit;
    display: none; overflow: hidden;

    /*
     * pointer-events is an INHERITED property and the host sets it to none
     * so the page stays clickable through the zero-sized host box.
     * Every interactive surface must therefore switch it back on explicitly.
     * Omitting this makes the entire panel transparent to hit-testing: every
     * button silently does nothing, and drops land on whatever is underneath.
     */
    pointer-events: auto;
  }
  #cu-overlay[open], #cu-overlay.cu-fallback-open {
    display: flex; align-items: center; justify-content: center;
  }
  #cu-overlay::backdrop { background: rgba(4, 5, 8, 0.82); }
  #cu-overlay.cu-fallback-open { background: rgba(4, 5, 8, 0.82); z-index: 2147483647; }
  .cu-root[data-theme='light'] #cu-overlay::backdrop { background: rgba(20, 23, 28, 0.42); }
  .cu-root[data-theme='light'] #cu-overlay.cu-fallback-open { background: rgba(20, 23, 28, 0.42); }

  #cu-panel {
    pointer-events: auto;
    display: flex; flex-direction: column;
    width: min(1180px, 94vw);
    height: min(820px, 90vh);
    background: var(--bg-base);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    animation: cu-panel-in var(--speed) var(--ease);
  }
  @keyframes cu-panel-in {
    from { opacity: 0; transform: translateY(8px) scale(0.995); }
    to { opacity: 1; transform: none; }
  }

  /* ─── Header ─── */
  #cu-header {
    display: flex; align-items: center; gap: var(--gap);
    padding: 9px var(--pad);
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  #cu-header h3 {
    font-size: var(--fs-sm); font-weight: 600; letter-spacing: 0.06em;
    color: var(--text-secondary); text-transform: uppercase;
    display: flex; align-items: center; gap: 6px; min-width: 0;
  }
  #cu-header .cu-spacer { flex: 1; }
  .cu-status {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: var(--fs-xs); letter-spacing: 0.08em; color: var(--success);
  }
  .cu-status[data-state='busy'] { color: var(--warn); }
  .cu-status[data-state='error'] { color: var(--danger); }
  .cu-kbd {
    font-size: var(--fs-xs); letter-spacing: 0.04em;
    color: var(--text-tertiary);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 2px 6px; white-space: nowrap;
  }

  /* ─── Layout ─── */
  #cu-body { display: flex; flex: 1; min-height: 0; }
  #cu-hud {
    width: 264px; flex: none;
    display: flex; flex-direction: column; gap: var(--gap);
    padding: var(--pad);
    background: var(--surface-0);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  #cu-work { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  #cu-settings-pane { display: none; flex: 1; overflow-y: auto; padding: var(--pad); }
  #cu-settings-pane.open { display: block; }

  @media (max-width: 900px) {
    #cu-body { flex-direction: column; }
    #cu-hud { width: auto; border-right: 0; border-bottom: 1px solid var(--border); max-height: 34%; }
  }

  /* ─── HUD ─── */
  .cu-section-title {
    font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.1em;
    color: var(--text-tertiary); text-transform: uppercase;
    padding-bottom: 2px; border-bottom: 1px solid var(--border);
  }
  #cu-meter {
    font-size: var(--fs-sm); letter-spacing: 0.08em; color: var(--accent);
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 6px 8px; white-space: nowrap; overflow: hidden;
  }
  #cu-meter[data-level='warn'] { color: var(--warn); border-color: var(--warn); }
  #cu-meter[data-level='over'] { color: var(--danger); border-color: var(--danger); }

  .cu-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .cu-metric {
    display: flex; flex-direction: column; gap: 1px;
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 6px 8px; min-width: 0;
  }
  .cu-metric--wide { grid-column: span 2; }
  .cu-metric-label {
    font-size: var(--fs-xs); letter-spacing: 0.06em; color: var(--text-tertiary); text-transform: uppercase;
  }
  .cu-metric-value {
    font-size: var(--fs); font-weight: 600; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cu-metric-value.warn { color: var(--warn); }
  .cu-metric-value.danger { color: var(--danger); }

  .cu-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .cu-preset {
    font: inherit; font-size: var(--fs-xs); letter-spacing: 0.05em;
    padding: 3px 8px; cursor: pointer;
    background: var(--surface-1); color: var(--text-secondary);
    border: 1px solid var(--border); border-radius: var(--radius);
    transition: background var(--speed) var(--ease), color var(--speed) var(--ease), border-color var(--speed) var(--ease);
  }
  .cu-preset:hover { background: var(--surface-2); color: var(--text-primary); border-color: var(--border-strong); }
  .cu-preset[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }

  #cu-exclusions { display: flex; flex-direction: column; gap: 3px; }
  .cu-exclusion {
    display: flex; align-items: center; gap: 6px;
    font-size: var(--fs-xs); color: var(--text-tertiary);
  }
  .cu-exclusion b { color: var(--text-secondary); font-weight: 600; min-width: 34px; text-align: right; }

  #cu-dropzone-mini {
    margin-top: auto; padding: 12px 10px; text-align: center;
    border: 1px dashed var(--border-strong); border-radius: var(--radius);
    background: var(--surface-0);
    transition: border-color var(--speed) var(--ease), background var(--speed) var(--ease);
  }
  #cu-dropzone-mini.drag-over { border-color: var(--accent); background: var(--accent-soft); }
  #cu-dropzone-mini .hint {
    font-size: var(--fs-xs); color: var(--text-tertiary); margin-bottom: 7px; display: block;
  }

  /* ─── Toolbar & actions ─── */
  #cu-toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 8px var(--pad); border-bottom: 1px solid var(--border); background: var(--surface-1);
  }
  #cu-search {
    flex: 1; min-width: 0;
    font: inherit; font-size: var(--fs);
    padding: 5px 9px;
    background: var(--surface-0); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  #cu-search::placeholder { color: var(--text-tertiary); }
  #cu-search-mode {
    font-size: var(--fs-xs); letter-spacing: 0.05em; color: var(--text-tertiary);
    border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 6px; white-space: nowrap;
  }

  #cu-actions {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 7px var(--pad); border-bottom: 1px solid var(--border); background: var(--surface-0);
  }
  .cu-group { display: flex; gap: 2px; }

  .cu-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    font: inherit; font-size: var(--fs-sm); letter-spacing: 0.03em;
    min-height: 26px; padding: 3px 9px; cursor: pointer; white-space: nowrap;
    background: var(--surface-2); color: var(--text-secondary);
    border: 1px solid var(--border); border-radius: var(--radius);
    transition: transform var(--speed) var(--ease), background var(--speed) var(--ease),
                color var(--speed) var(--ease), border-color var(--speed) var(--ease),
                box-shadow var(--speed) var(--ease);
  }
  .cu-btn:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); border-color: var(--border-strong); }
  .cu-btn:active:not(:disabled) { transform: scale(0.97); }
  .cu-btn:disabled { opacity: 0.42; cursor: not-allowed; }
  .cu-btn--primary { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .cu-btn--primary:hover:not(:disabled) { background: var(--accent); color: var(--bg-base); }
  .cu-btn--execute {
    background: var(--danger); color: #fff; border-color: var(--danger);
    box-shadow: 0 0 12px var(--danger-soft); font-weight: 600;
  }
  .cu-btn--execute:hover:not(:disabled) { filter: brightness(1.12); }
  .cu-btn--danger { color: var(--danger); border-color: var(--border); }
  .cu-btn--danger:hover:not(:disabled) { background: var(--danger-soft); border-color: var(--danger); }
  .cu-btn--ghost { background: transparent; border-color: transparent; }
  .cu-btn--ghost:hover:not(:disabled) { background: var(--surface-2); }
  .cu-btn--icon { min-width: 26px; padding: 3px; }
  .cu-btn--wide { width: 100%; }

  /* ─── Tree ─── */
  #cu-tree {
    flex: 1; min-height: 0; position: relative; overflow: auto;
    background: var(--bg-base);
    transition: background var(--speed) var(--ease), box-shadow var(--speed) var(--ease);
  }
  #cu-tree.drag-over { box-shadow: inset 0 0 0 2px var(--accent); background: var(--accent-soft); }
  #cu-viewport { position: relative; width: 100%; }
  #cu-rows { position: absolute; top: 0; left: 0; right: 0; }

  .cu-row {
    display: flex; align-items: center; gap: 6px;
    height: var(--row-h); padding: 0 var(--pad) 0 0;
    cursor: default; user-select: none;
    border-left: 2px solid transparent;
  }
  .cu-row:hover { background: var(--surface-1); }
  .cu-row[aria-selected='true'] { background: var(--accent-soft); border-left-color: var(--accent); }
  .cu-row.is-cursor { box-shadow: inset 0 0 0 1px var(--accent); }
  .cu-row-indent { flex: none; }
  .cu-caret {
    flex: none; width: 16px; height: 16px; display: grid; place-items: center;
    color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius);
  }
  .cu-caret:hover { color: var(--accent); background: var(--surface-2); }
  .cu-caret.spacer { cursor: default; }
  .cu-check {
    flex: none; width: 13px; height: 13px; margin: 0; cursor: pointer;
    accent-color: var(--accent);
  }
  .cu-badge {
    flex: none; font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.06em;
    padding: 0 4px; border-radius: var(--radius); border: 1px solid currentColor; opacity: 0.85;
  }
  .cu-badge.dir { color: var(--dir-color); }
  .cu-badge.code { color: var(--code-color); }
  .cu-badge.bin { color: var(--bin-color); }
  .cu-label {
    flex: 1; min-width: 0; font-size: var(--fs);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cu-label mark { background: var(--warn-soft); color: var(--warn); padding: 0 1px; border-radius: 1px; }
  .cu-meta { flex: none; font-size: var(--fs-xs); color: var(--text-tertiary); }
  .cu-remove {
    flex: none; width: 18px; height: 18px; display: grid; place-items: center;
    color: var(--text-tertiary); cursor: pointer; border: 0; background: none; border-radius: var(--radius);
    opacity: 0; transition: opacity var(--speed) var(--ease), color var(--speed) var(--ease);
  }
  .cu-row:hover .cu-remove, .cu-remove:focus-visible { opacity: 1; }
  .cu-remove:hover { color: var(--danger); background: var(--danger-soft); }

  /* ─── Empty state ─── */
  #cu-empty {
    position: absolute; inset: 0; display: none;
    flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; padding: 26px; text-align: center;
    /* The overlay box itself must not intercept pointer events aimed at the
       tree beneath it; its children remain interactive. */
    pointer-events: none;
  }
  #cu-tree.is-empty #cu-empty { display: flex; }
  #cu-empty > * { pointer-events: auto; }
  #cu-empty .cu-drop-icon { color: var(--text-tertiary); opacity: 0.5; }
  #cu-empty strong { font-size: var(--fs); letter-spacing: 0.06em; color: var(--text-secondary); }
  #cu-empty .hint { font-size: var(--fs-sm); color: var(--text-tertiary); max-width: 380px; }

  /* ─── Footer ─── */
  #cu-footer {
    display: flex; align-items: center; gap: var(--gap);
    padding: 9px var(--pad); border-top: 1px solid var(--border); background: var(--surface-1); flex: none;
  }
  #cu-footer .cu-spacer { flex: 1; }
  #cu-status-line {
    font-size: var(--fs-sm); color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  }

  /* ─── Progress ─── */
  #cu-progress {
    display: none; align-items: center; gap: var(--gap);
    padding: 7px var(--pad); border-top: 1px solid var(--border); background: var(--surface-0);
  }
  #cu-progress.active { display: flex; }
  .cu-bar { flex: 1; height: 4px; background: var(--surface-3); border-radius: var(--radius); overflow: hidden; }
  .cu-bar > span {
    display: block; height: 100%; width: 0%;
    background: var(--accent); box-shadow: 0 0 8px var(--accent-glow);
    transition: width 120ms linear;
  }
  .cu-bar.indeterminate > span { width: 35%; animation: cu-slide 1.1s ease-in-out infinite; }
  @keyframes cu-slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(340%); }
  }
  #cu-progress-text {
    font-size: var(--fs-xs); color: var(--text-secondary); min-width: 190px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* ─── Settings ─── */
  .cu-setting-block { margin-bottom: 18px; }
  .cu-setting-block > .cu-section-title { margin-bottom: 9px; }
  .cu-grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
  @media (max-width: 760px) { .cu-grid { grid-template-columns: 1fr; } }
  .cu-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .cu-field > label, .cu-field-label {
    font-size: var(--fs-sm); color: var(--text-secondary);
    display: flex; align-items: baseline; gap: 6px;
  }
  .cu-field .hint { font-size: var(--fs-xs); color: var(--text-tertiary); line-height: 1.45; }
  .cu-field .helper { color: var(--accent); font-size: var(--fs-xs); }
  .cu-field .error { color: var(--danger); font-size: var(--fs-xs); }

  .cu-input, .cu-select, .cu-textarea {
    font: inherit; font-size: var(--fs); width: 100%;
    padding: 5px 8px;
    background: var(--surface-0); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  .cu-textarea { resize: vertical; min-height: 68px; font-size: var(--fs-sm); }
  .cu-input[aria-invalid='true'] { border-color: var(--danger); }

  .cu-check-row { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; cursor: pointer; }
  .cu-check-row input { margin-top: 2px; accent-color: var(--accent); }
  .cu-check-row .cu-check-text { display: flex; flex-direction: column; gap: 1px; }
  .cu-check-row .cu-check-label { font-size: var(--fs); color: var(--text-primary); }
  .cu-check-row .cu-check-hint { font-size: var(--fs-xs); color: var(--text-tertiary); }

  .cu-tag-editor {
    display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
    padding: 5px; min-height: 34px;
    background: var(--surface-0); border: 1px solid var(--border); border-radius: var(--radius);
  }
  .cu-tag {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: var(--fs-xs); padding: 1px 4px 1px 6px;
    background: var(--surface-2); color: var(--text-secondary);
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  .cu-tag-x {
    display: grid; place-items: center; width: 13px; height: 13px;
    cursor: pointer; border: 0; background: none; color: var(--text-tertiary); border-radius: 1px;
  }
  .cu-tag-x:hover { color: var(--danger); background: var(--danger-soft); }
  .cu-tag-input {
    flex: 1; min-width: 110px; font: inherit; font-size: var(--fs-xs);
    background: transparent; border: 0; color: var(--text-primary); padding: 2px;
  }
  .cu-tag-input:focus { outline: none; }

  .cu-code {
    font-size: var(--fs-xs); background: var(--surface-0); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 8px; overflow: auto; max-height: 240px;
    white-space: pre-wrap; word-break: break-word; color: var(--text-secondary);
  }

  .cu-banner {
    display: flex; gap: 8px; align-items: flex-start;
    padding: 8px 10px; margin-bottom: 12px;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface-1); font-size: var(--fs-sm); color: var(--text-secondary);
  }
  .cu-banner--warn { border-color: var(--warn); background: var(--warn-soft); color: var(--warn); }
  .cu-banner--info { border-color: var(--accent); background: var(--accent-soft); }

  /* ─── Modal ─── */
  .cu-modal {
    pointer-events: auto;
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(4, 5, 8, 0.7); z-index: 20; padding: 20px;
  }
  .cu-modal-card {
    width: min(560px, 100%); max-height: 100%;
    display: flex; flex-direction: column;
    background: var(--surface-1); border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg); box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55); overflow: hidden;
  }
  .cu-modal-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px var(--pad); border-bottom: 1px solid var(--border); background: var(--surface-2);
  }
  .cu-modal-head h4 { font-size: var(--fs); font-weight: 600; letter-spacing: 0.04em; flex: 1; }
  .cu-modal-body { padding: var(--pad); overflow: auto; font-size: var(--fs-sm); color: var(--text-secondary); }
  .cu-modal-foot {
    display: flex; gap: 6px; justify-content: flex-end;
    padding: 10px var(--pad); border-top: 1px solid var(--border); background: var(--surface-2);
  }

  /* ─── Copy list ─── */
  .cu-chunk-row {
    display: flex; align-items: center; gap: var(--gap);
    padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface-0); margin-bottom: 5px;
  }
  .cu-chunk-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .cu-chunk-title {
    font-size: var(--fs-sm); color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cu-chunk-stats { font-size: var(--fs-xs); color: var(--text-tertiary); }
  .cu-chunk-row .cu-btn.copied { color: var(--success); border-color: var(--success); background: var(--success-soft); }

  /* ─── Toasts ─── */
  #cu-toasts {
    position: fixed; right: 16px; bottom: 16px; z-index: 30;
    display: flex; flex-direction: column; gap: 7px; max-width: min(400px, 90vw); pointer-events: none;
  }
  .cu-toast {
    pointer-events: auto; display: flex; align-items: flex-start; gap: 8px;
    padding: 8px 10px; font-size: var(--fs-sm);
    background: var(--surface-2); color: var(--text-primary);
    border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
    opacity: 0; transform: translateY(6px);
    transition: opacity var(--speed) var(--ease), transform var(--speed) var(--ease);
  }
  .cu-toast.show { opacity: 1; transform: none; }
  .cu-toast.success { border-left-color: var(--success); }
  .cu-toast.error { border-left-color: var(--danger); }
  .cu-toast.info { border-left-color: var(--accent); }
  .cu-toast.warn { border-left-color: var(--warn); }
  .cu-toast-text { flex: 1; min-width: 0; word-break: break-word; }
  .cu-toast-actions { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; }
  `;

  /* -----------------------------------------------------------------------
   * Icons. Built with `createElementNS` and never from markup strings, so the
   * icon set is inert under Trusted Types and cannot become an injection
   * vector. Every glyph in the icon set is keyed consistently by name.
   * -------------------------------------------------------------------- */

  const icons = (() => {
    const NS = 'http://www.w3.org/2000/svg';

    const PATHS = {
      folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'],
      folderOpen: ['M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1'],
      file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v6h6'],
      paperclip: ['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
      x: ['M18 6 6 18', 'M6 6l12 12'],
      chevronRight: ['m9 18 6-6-6-6'],
      chevronDown: ['m6 9 6 6 6-6'],
      arrowLeft: ['M19 12H5', 'm12 19-7-7 7-7'],
      plus: ['M12 5v14', 'M5 12h14'],
      download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
      zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
      search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.35-4.35'],
      settings: [
        'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
        'M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0z'
      ],
      upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
      copy: ['M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
      save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
      terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
      code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
      binary: ['M6 18h12', 'M6 6h12', 'M12 2v20'],
      dot: ['M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
      /* added */
      undo: ['M3 7v6h6', 'M3.5 13a9 9 0 1 0 2.3-6.4L3 9'],
      check: ['M5 12.5l4.5 4.5L19 7'],
      filter: ['M3 4h18l-7 8v7l-4 2v-9z'],
      info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v5', 'M12 7.8v.2'],
      warning: ['M12 4l9 16H3z', 'M12 10v4', 'M12 16.8v.2'],
      stop: ['M7 7h10v10H7z'],
      eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
      trash: ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12'],
      layers: ['m12 2 9 5-9 5-9-5z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5']
    };

    const cache = new Map();

    function icon(name, size = 16) {
      const key = `${name}|${size}`;
      const cached = cache.get(key);
      if (cached) return cached.cloneNode(true);

      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.75');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');

      for (const d of PATHS[name] || []) {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
      }

      cache.set(key, svg);
      return svg.cloneNode(true);
    }

    icon.names = () => Object.keys(PATHS);
    return icon;
  })();

  /* =======================================================================
   * SECTION 12 — UI core
   * -----------------------------------------------------------------------
   * The shadow host, the modal shell, toasts, confirmation, progress and the
   * shared form primitives.
   *
   * Architectural design highlights:
   *
   *  - The shadow root is **closed**, ensuring external scripts on the host page
   *    cannot walk into the panel, read internal file paths or tamper with
   *    controls.
   *  - The overlay is a `<dialog>` opened with `showModal()`, giving a real
   *    top-layer surface, native Escape, a native backdrop and a robust focus
   *    trap that correctly retains focus within the panel.
   *  - `confirm()` is avoided. It is blocked in some embedded contexts, cannot be
   *    styled, and blocks the event loop; destructive actions now use an
   *    in-panel dialog that is keyboard-operable and cancellable.
   *  - Toasts stack (bounded) instead of replacing each other, carry actions,
   *    and announce themselves to assistive technology.
   * ==================================================================== */

  const ui = (() => {
    const HOST_ID = 'codebase-uploader-root';

    let host = null;
    let shadow = null;
    let root = null;
    let toastLayer = null;
    let mounted = false;
    const disposables = new env.Disposables('ui');

    /* --------------------------------------------------------------- mount */

    function mount() {
      if (mounted) return root;

      const parent = document.documentElement;
      if (!parent) return null;

      host = document.createElement('div');
      host.id = HOST_ID;
      // `all: initial` isolates from inherited page styles; the fixed
      // zero-size box keeps the host out of the page's layout entirely.
      host.setAttribute(
        'style',
        'all:initial;position:fixed!important;top:0;left:0;width:0;height:0;' +
          'z-index:2147483647!important;pointer-events:none;'
      );

      try {
        shadow = host.attachShadow({ mode: 'closed' });
      } catch (e) {
        env.log.warn('closed shadow root unavailable; falling back to open', e);
        try {
          shadow = host.attachShadow({ mode: 'open' });
        } catch (e2) {
          env.log.error('shadow DOM unavailable; the panel cannot be mounted', e2);
          return null;
        }
      }

      // Constructable stylesheets avoid a second parse per re-mount and keep
      // the CSS text out of the DOM entirely.
      let styleApplied = false;
      if (env.capabilities.constructableStylesheets) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(STYLESHEET);
          shadow.adoptedStyleSheets = [sheet];
          styleApplied = true;
        } catch (e) {
          env.log.debug('adoptedStyleSheets failed; using a <style> element', e);
        }
      }
      if (!styleApplied) {
        const style = document.createElement('style');
        // `textContent` on a <style> is not a Trusted Types sink.
        style.textContent = STYLESHEET;
        shadow.appendChild(style);
      }

      root = util.el('div', { cls: 'cu-root' });
      shadow.appendChild(root);

      toastLayer = util.el('div', {
        id: 'cu-toasts',
        role: 'region',
        'aria-label': `${env.APP_NAME} notifications`
      });
      root.appendChild(toastLayer);

      parent.appendChild(host);
      mounted = true;
      applyAppearance();
      return root;
    }

    /**
     * Re-attaches the host if a single-page application replaces the element
     * it lives in. One observer for the lifetime of the script — the Source
     * Script created a *new* `MutationObserver` inside `buildUI()`, and
     * `buildUI()` was called from that observer, so every re-attach doubled
     * the number of live observers watching the same node.
     */
    function guardAttachment() {
      if (!host) return;
      try {
        const observer = new MutationObserver(() => {
          if (host && !host.isConnected && document.documentElement) {
            try {
              document.documentElement.appendChild(host);
              env.log.debug('re-attached the UI host after a DOM replacement');
            } catch (e) {
              env.log.warn('could not re-attach the UI host', e);
            }
          }
        });
        observer.observe(document.documentElement, { childList: true });
        disposables.observer(observer);
      } catch (e) {
        env.log.debug('attachment guard unavailable', e);
      }
    }

    function applyAppearance() {
      if (!root) return;
      const s = store.all();
      root.dataset.theme = s.theme;
      root.dataset.density = s.density;
      root.dataset.motion = s.reduceMotion ? 'reduce' : 'auto';
    }

    /**
     * Moves the toast layer into a given container.
     *
     * This matters because the panel is a `<dialog>` opened with
     * `showModal()`: everything outside the top-layer dialog becomes inert,
     * so a toast rendered at the shadow-root level would be visible but
     * unclickable — its "Undo" button would do nothing. Toasts are therefore
     * parented inside the dialog while it is open and returned to the root
     * when it closes. They are `position: fixed`, so their on-screen position
     * is unaffected by the move.
     */
    function attachToastLayer(container) {
      if (!toastLayer) return;
      const target = container || root;
      if (target && toastLayer.parentNode !== target) target.appendChild(toastLayer);
    }

    const getRoot = () => root;
    const isMounted = () => mounted;
    const $ = id => (root ? root.querySelector(`[id="${CSS.escape(id)}"]`) : null);

    /* -------------------------------------------------------------- toasts */

    const activeToasts = new Set();
    const MAX_TOASTS = 4;

    /**
     * @param {string} message
     * @param {'success'|'error'|'info'|'warn'} [type]
     * @param {{timeout?: number, actions?: Array<{label: string, onSelect: Function}>}} [opts]
     * @returns {() => void} dismisser
     */
    function toast(message, type = 'success', opts = {}) {
      if (!message) return () => {};
      if (!mounted) mount();
      if (!toastLayer) {
        env.log.info(message);
        return () => {};
      }

      while (activeToasts.size >= MAX_TOASTS) {
        const oldest = activeToasts.values().next().value;
        oldest?.dismiss();
      }

      const text = util.el('div', { cls: 'cu-toast-text' }, [util.el('div', { txt: message })]);
      const node = util.el(
        'div',
        {
          cls: ['cu-toast', type],
          role: type === 'error' ? 'alert' : 'status',
          'aria-live': type === 'error' ? 'assertive' : 'polite'
        },
        [text]
      );

      const actions = (opts.actions || []).slice(0, 3);
      if (actions.length) {
        const row = util.el('div', { cls: 'cu-toast-actions' });
        for (const a of actions) {
          row.appendChild(
            util.el('button', {
              cls: 'cu-btn',
              type: 'button',
              txt: a.label,
              onclick: () => {
                try {
                  a.onSelect?.();
                } catch (e) {
                  env.log.error('toast action threw', e);
                }
                dismiss();
              }
            })
          );
        }
        text.appendChild(row);
      }

      node.appendChild(
        util.el(
          'button',
          {
            cls: 'cu-btn cu-btn--ghost cu-btn--icon',
            type: 'button',
            'aria-label': 'Dismiss',
            onclick: () => dismiss()
          },
          [icons('x', 13)]
        )
      );

      let hideTimer = null;
      let removeTimer = null;
      let dismissed = false;

      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        if (hideTimer) clearTimeout(hideTimer);
        // Unregister synchronously. Deferring this until the fade completed
        // meant the eviction loop below could keep selecting the same
        // already-dismissed toast and never terminate.
        activeToasts.delete(handle);
        node.classList.remove('show');
        removeTimer = setTimeout(() => node.remove(), data.TOAST_FADE_MS);
      }

      const handle = {
        dismiss,
        destroy() {
          if (hideTimer) clearTimeout(hideTimer);
          if (removeTimer) clearTimeout(removeTimer);
          node.remove();
          activeToasts.delete(handle);
        }
      };

      activeToasts.add(handle);
      toastLayer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('show'));

      const timeout = opts.timeout ?? (type === 'error' ? data.TOAST_DURATION * 2 : data.TOAST_DURATION);
      if (timeout > 0) hideTimer = setTimeout(dismiss, timeout);

      return dismiss;
    }

    function clearToasts() {
      for (const h of [...activeToasts]) h.destroy();
      // Also sweep any node still mid-fade, so "clear" means the layer is
      // actually empty rather than empty-in-260-milliseconds.
      if (toastLayer) util.clear(toastLayer);
    }

    /* --------------------------------------------------------------- modal */

    let openModals = 0;

    /**
     * An in-panel modal. Rendered inside the panel rather than the shadow root
     * so it inherits the panel's bounds and cannot escape it.
     */
    function modal({ title, body, actions = [], onClose = null, dismissible = true } = {}) {
      const container = $('cu-panel') || root;
      if (!container) return null;

      const d = new env.Disposables('modal');
      let closed = false;
      const previous = shadow?.activeElement || null;

      const titleId = util.uid('cu-modal-title');
      const card = util.el('div', { cls: 'cu-modal-card', role: 'document' });
      const head = util.el('div', { cls: 'cu-modal-head' }, [
        util.el('h4', { id: titleId, txt: title || '' })
      ]);
      const bodyNode = util.el('div', { cls: 'cu-modal-body' });
      const foot = util.el('div', { cls: 'cu-modal-foot' });

      util.append(bodyNode, body || []);

      const overlay = util.el(
        'div',
        { cls: 'cu-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        [card]
      );

      function close(reason = 'close') {
        if (closed) return;
        closed = true;
        openModals = Math.max(0, openModals - 1);
        d.dispose();
        overlay.remove();
        try {
          previous?.focus?.({ preventScroll: true });
        } catch {
          /* the element may be gone */
        }
        try {
          onClose?.(reason);
        } catch (e) {
          env.log.error('modal onClose threw', e);
        }
      }

      if (dismissible) {
        head.appendChild(
          util.el(
            'button',
            {
              cls: 'cu-btn cu-btn--ghost cu-btn--icon',
              type: 'button',
              'aria-label': 'Close',
              onclick: () => close('button')
            },
            [icons('x', 14)]
          )
        );
        d.listen(overlay, 'click', e => {
          if (e.target === overlay) close('backdrop');
        });
      }

      for (const a of actions) {
        foot.appendChild(
          util.el('button', {
            cls: ['cu-btn', a.variant ? `cu-btn--${a.variant}` : ''],
            type: 'button',
            txt: a.label,
            onclick: () => {
              let keepOpen = false;
              try {
                keepOpen = a.onSelect?.() === false;
              } catch (e) {
                env.log.error('modal action threw', e);
              }
              if (!keepOpen) close('action');
            }
          })
        );
      }

      card.append(head, bodyNode, foot);

      // Contain Tab within the modal while it is open.
      d.listen(overlay, 'keydown', e => {
        if (e.key === 'Escape' && dismissible) {
          e.preventDefault();
          e.stopPropagation();
          close('escape');
          return;
        }
        if (e.key !== 'Tab') return;
        const focusables = focusableWithin(card);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = shadow?.activeElement;
        if (e.shiftKey && (active === first || !card.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !card.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      });

      container.appendChild(overlay);
      openModals += 1;

      requestAnimationFrame(() => {
        const target = focusableWithin(card)[0] || card;
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus?.();
        }
      });

      return { close, card, body: bodyNode, foot };
    }

    /**
     * Promise-returning replacement for the blocking global confirmation
     * dialog. Named distinctly so nothing in this file can accidentally
     * resolve to the global one.
     */
    function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false } = {}) {
      return new Promise(resolve => {
        let settled = false;
        const finish = v => {
          if (settled) return;
          settled = true;
          resolve(v);
        };

        modal({
          title,
          body: [util.el('p', { txt: message })],
          onClose: () => finish(false),
          actions: [
            { label: 'Cancel', onSelect: () => finish(false) },
            {
              label: confirmLabel,
              variant: danger ? 'danger' : 'primary',
              onSelect: () => finish(true)
            }
          ]
        });
      });
    }

    /** Confirmation that honours the "confirm destructive actions" setting. */
    async function confirmDestructive(opts) {
      if (!store.get('confirmDestructive')) return true;
      return confirmDialog({ ...opts, danger: true });
    }

    const hasOpenModal = () => openModals > 0;

    /* ------------------------------------------------------------- focus */

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function focusableWithin(container) {
      if (!container) return [];
      return Array.from(container.querySelectorAll(FOCUSABLE)).filter(node => {
        if (node.hidden) return false;
        // `offsetParent` is null for `position: fixed`, so fall back to rects.
        return node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0;
      });
    }

    /* ---------------------------------------------------------- primitives */

    function button(label, { variant = '', icon = null, onClick, title = '', disabled = false, id = '', wide = false } = {}) {
      const classes = ['cu-btn'];
      if (variant) classes.push(`cu-btn--${variant}`);
      if (wide) classes.push('cu-btn--wide');
      if (!label && icon) classes.push('cu-btn--icon');
      return util.el(
        'button',
        {
          cls: classes,
          type: 'button',
          id: id || undefined,
          title: title || undefined,
          'aria-label': !label && title ? title : undefined,
          disabled,
          onclick: onClick
        },
        [icon, label ? util.el('span', { txt: label }) : null]
      );
    }

    function field(labelText, control, { hint = '', helper = null, id = '' } = {}) {
      const controlId = id || control?.id || util.uid('cu-f');
      if (control && !control.id) control.id = controlId;
      return util.el('div', { cls: 'cu-field' }, [
        labelText
          ? util.el('label', { for: controlId }, [
              util.el('span', { txt: labelText }),
              helper || null
            ])
          : null,
        control,
        hint ? util.el('div', { cls: 'hint', txt: hint }) : null
      ]);
    }

    function input({ value = '', type = 'text', placeholder = '', onInput, onChange, onKeyDown, min, max, step, id = '', ariaLabel = '' } = {}) {
      return util.el('input', {
        cls: 'cu-input',
        type,
        value: String(value),
        placeholder,
        id: id || undefined,
        min,
        max,
        step,
        spellcheck: false,
        autocomplete: 'off',
        'aria-label': ariaLabel || undefined,
        oninput: onInput ? e => onInput(e.target.value, e) : undefined,
        onchange: onChange ? e => onChange(e.target.value, e) : undefined,
        onkeydown: onKeyDown
      });
    }

    function select(options, value, onChange, { ariaLabel = '', id = '' } = {}) {
      const node = util.el('select', {
        cls: 'cu-select',
        id: id || undefined,
        'aria-label': ariaLabel || undefined,
        onchange: e => onChange(e.target.value)
      });
      for (const o of options) {
        node.appendChild(
          util.el('option', { value: o.value, txt: o.label, selected: o.value === value })
        );
      }
      node.value = value;
      return node;
    }

    function checkbox(labelText, checked, onChange, { hint = '' } = {}) {
      const box = util.el('input', {
        type: 'checkbox',
        checked: !!checked,
        onchange: e => onChange(e.target.checked)
      });
      return util.el('label', { cls: 'cu-check-row' }, [
        box,
        util.el('span', { cls: 'cu-check-text' }, [
          util.el('span', { cls: 'cu-check-label', txt: labelText }),
          hint ? util.el('span', { cls: 'cu-check-hint', txt: hint }) : null
        ])
      ]);
    }

    /**
     * Chip editor for comma-separated lists. Improvements over the Source
     * Script's version: values are validated and de-duplicated, an empty
     * value cannot be added, Backspace on an empty input removes the last
     * chip, and paste of a comma-separated string adds all of its entries.
     */
    function tagEditor(initialValue, onUpdate, { placeholder = 'Add + Enter…', ariaLabel = '' } = {}) {
      const container = util.el('div', { cls: 'cu-tag-editor' });
      const chips = util.el('div', { cls: 'cu-chips', style: { display: 'contents' } });
      const box = util.el('input', {
        cls: 'cu-tag-input',
        type: 'text',
        placeholder,
        'aria-label': ariaLabel || placeholder,
        spellcheck: false,
        autocomplete: 'off'
      });

      let tags = String(initialValue || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      tags = util.unique(tags);

      const commit = () => onUpdate(tags.join(','));

      function renderChips() {
        util.clear(chips);
        for (const tag of tags) {
          const remove = util.el(
            'button',
            {
              cls: 'cu-tag-x',
              type: 'button',
              'aria-label': `Remove ${tag}`,
              onclick: () => {
                tags = tags.filter(t => t !== tag);
                commit();
                renderChips();
                box.focus();
              }
            },
            [icons('x', 9)]
          );
          chips.appendChild(util.el('span', { cls: 'cu-tag' }, [util.el('span', { txt: tag }), remove]));
        }
      }

      function addRaw(raw) {
        let added = 0;
        for (const piece of String(raw).split(',')) {
          const v = piece.trim().toLowerCase();
          if (!v || v.length > 80 || tags.includes(v)) continue;
          tags.push(v);
          added += 1;
        }
        if (added) {
          commit();
          renderChips();
        }
        return added;
      }

      box.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          addRaw(box.value);
          box.value = '';
        } else if (e.key === 'Backspace' && !box.value && tags.length) {
          e.preventDefault();
          tags.pop();
          commit();
          renderChips();
        }
      });
      box.addEventListener('blur', () => {
        if (box.value.trim()) {
          addRaw(box.value);
          box.value = '';
        }
      });
      box.addEventListener('paste', e => {
        const text = e.clipboardData?.getData('text');
        if (text && text.includes(',')) {
          e.preventDefault();
          addRaw(text);
          box.value = '';
        }
      });

      renderChips();
      container.append(chips, box);
      return container;
    }

    function sectionTitle(text) {
      return util.el('div', { cls: 'cu-section-title', txt: text });
    }

    function banner(text, variant = 'info', iconName = 'info') {
      return util.el('div', { cls: ['cu-banner', `cu-banner--${variant}`] }, [
        icons(iconName, 15),
        util.el('span', { txt: text })
      ]);
    }

    /* ------------------------------------------------------------ lifecycle */

    function dispose() {
      clearToasts();
      disposables.dispose();
      host?.remove();
      host = null;
      shadow = null;
      root = null;
      toastLayer = null;
      mounted = false;
      openModals = 0;
    }

    return {
      HOST_ID,
      mount,
      guardAttachment,
      attachToastLayer,
      applyAppearance,
      getRoot,
      isMounted,
      $,
      shadowActiveElement: () => shadow?.activeElement || null,
      toast,
      clearToasts,
      modal,
      confirm: confirmDialog,
      confirmDestructive,
      hasOpenModal,
      focusableWithin,
      button,
      field,
      input,
      select,
      checkbox,
      tagEditor,
      sectionTitle,
      banner,
      dispose
    };
  })();

  /* =======================================================================
   * SECTION 13 — The panel
   * -----------------------------------------------------------------------
   * Telemetry HUD, toolbar, virtualised file tree, footer and progress.
   *
   * Rather than rebuilding the entire DOM subtree on every keystroke or expand
   * (which would thrash thousands of DOM elements during large project loads),
   * this tree maintains clean unidirectional data flow and high rendering
   * efficiency.
   *
   * Here the tree is a windowed projection of the model: only the rows inside
   * the viewport exist, scrolling reuses the same nodes, and every checkbox is
   * derived from the model rather than pushed into the DOM. Below a
   * configurable threshold the whole list is rendered so that browser
   * find-in-page still works on small projects.
   *
   * The tree is also fully keyboard operable — arrows, expand/collapse,
   * space to toggle, shift-click and shift-arrow range selection, type-ahead
   * and Delete to remove — with correct `role="tree"` semantics including
   * tri-state `aria-checked`.
   * ==================================================================== */

  const panel = (() => {
    let built = false;
    let openState = false;
    let rowHeight = 26;
    let rows = [];
    let cursor = 0;
    let anchor = null;
    let typeahead = { text: '', at: 0 };
    let activePreset = null;
    const disposables = new env.Disposables('panel');

    /* refs, populated by build() */
    const ref = {};

    /* ------------------------------------------------------------- build */

    function build() {
      if (built) return;
      const root = ui.mount();
      if (!root) return;

      /* ── header ────────────────────────────────────────────────────── */
      ref.status = util.el('span', { cls: 'cu-status', id: 'cu-status', dataset: { state: 'idle' } }, [
        icons('dot', 11),
        util.el('span', { txt: 'READY' })
      ]);

      ref.kbd = util.el('span', { cls: 'cu-kbd', id: 'cu-kbd' });

      ref.settingsBtn = ui.button('', {
        variant: 'ghost',
        icon: icons('settings', 15),
        title: 'Settings',
        id: 'cu-settings-toggle',
        onClick: () => toggleSettings()
      });

      ref.closeBtn = ui.button('', {
        variant: 'ghost',
        icon: icons('x', 15),
        title: 'Close (Esc)',
        id: 'cu-close',
        onClick: () => close()
      });

      const header = util.el('div', { id: 'cu-header' }, [
        util.el('h3', { id: 'cu-title' }, [
          icons('layers', 13),
          util.el('span', { txt: `CODEBASE_UPLOADER // ${env.APP_VERSION}` })
        ]),
        ref.status,
        util.el('span', { cls: 'cu-spacer' }),
        ref.kbd,
        ref.settingsBtn,
        ref.closeBtn
      ]);

      /* ── HUD ───────────────────────────────────────────────────────── */
      ref.meter = util.el('div', { id: 'cu-meter', txt: '[············] 0%' });

      const metric = (id, label, wide = false) => {
        const value = util.el('span', { cls: 'cu-metric-value', id, txt: '—' });
        return {
          node: util.el('div', { cls: ['cu-metric', wide && 'cu-metric--wide'] }, [
            util.el('span', { cls: 'cu-metric-label', txt: label }),
            value
          ]),
          value
        };
      };

      const mFiles = metric('cu-m-files', 'Selected');
      const mUploads = metric('cu-m-uploads', 'Uploads');
      const mSize = metric('cu-m-size', 'Payload');
      const mTokens = metric('cu-m-tokens', 'Est. tokens');
      ref.mFiles = mFiles.value;
      ref.mUploads = mUploads.value;
      ref.mSize = mSize.value;
      ref.mTokens = mTokens.value;

      ref.presets = util.el('div', { cls: 'cu-chips', role: 'group', 'aria-label': 'Selection presets' });
      for (const [id, label] of [
        [policy.PRESET.ALL, 'ALL'],
        [policy.PRESET.CODE, 'CODE'],
        [policy.PRESET.DOCS, 'DOCS'],
        [policy.PRESET.CONFIG, 'CONFIG'],
        [policy.PRESET.TESTS, 'TESTS'],
        [policy.PRESET.NONE, 'NONE']
      ]) {
        ref.presets.appendChild(
          util.el('button', {
            cls: 'cu-preset',
            type: 'button',
            txt: `[${label}]`,
            dataset: { preset: id },
            'aria-pressed': 'false',
            onclick: () => {
              const changed = workspace.applyPreset(id);
              activePreset = id;
              ui.toast(`${label}: ${changed} file(s) changed.`, 'info', { timeout: 1600 });
            }
          })
        );
      }

      ref.exclusions = util.el('div', { id: 'cu-exclusions' });

      ref.miniDrop = util.el('div', { id: 'cu-dropzone-mini' }, [
        util.el('span', { cls: 'hint', txt: 'Drop a folder anywhere in this panel' }),
        ui.button('SELECT DIRECTORY', {
          variant: 'primary',
          wide: true,
          icon: icons('folderOpen', 13),
          onClick: () => controller.pickDirectory()
        }),
        ui.button('Add files…', {
          wide: true,
          icon: icons('plus', 12),
          onClick: () => controller.pickFiles()
        })
      ]);

      const hud = util.el('div', { id: 'cu-hud' }, [
        ui.sectionTitle('[ TELEMETRY ]'),
        ref.meter,
        util.el('div', { cls: 'cu-metrics' }, [mFiles.node, mUploads.node, mSize.node, mTokens.node]),
        ui.sectionTitle('[ PRESETS ]'),
        ref.presets,
        ui.sectionTitle('[ EXCLUDED ]'),
        ref.exclusions,
        ref.miniDrop
      ]);

      /* ── toolbar ───────────────────────────────────────────────────── */
      ref.search = ui.input({
        id: 'cu-search',
        placeholder: 'FILTER: text, glob* or /regex/',
        ariaLabel: 'Filter files',
        onInput: v => onSearchInput(v),
        onKeyDown: e => onSearchKeyDown(e)
      });
      ref.search.setAttribute('role', 'searchbox');
      ref.search.setAttribute('aria-controls', 'cu-tree');

      ref.searchMode = util.el('span', { id: 'cu-search-mode', cls: 'cu-kbd', txt: 'MATCHES: 0' });

      const toolbar = util.el('div', { id: 'cu-toolbar' }, [
        icons('search', 14),
        ref.search,
        ref.searchMode
      ]);

      /* ── actions ───────────────────────────────────────────────────── */
      ref.undoBtn = ui.button('[UNDO]', {
        title: 'Undo the last selection change',
        disabled: true,
        onClick: () => {
          if (workspace.undo()) ui.toast('Reverted.', 'info', { timeout: 1400 });
        }
      });

      const actions = util.el('div', { id: 'cu-actions' }, [
        util.el('div', { cls: 'cu-group' }, [
          ui.button('[ALL]', { title: 'Select every visible file', onClick: () => workspace.applyPreset(policy.PRESET.ALL) }),
          ui.button('[NONE]', { title: 'Deselect everything', onClick: () => workspace.applyPreset(policy.PRESET.NONE) }),
          ui.button('[INVERT]', { title: 'Invert the selection', onClick: () => workspace.invertSelection() })
        ]),
        util.el('div', { cls: 'cu-group' }, [
          ui.button('[EXPAND]', { title: 'Expand every folder', onClick: () => workspace.expandAll() }),
          ui.button('[COLLAPSE]', { title: 'Collapse every folder', onClick: () => workspace.collapseAll() })
        ]),
        ref.undoBtn,
        util.el('span', { cls: 'cu-spacer', style: { flex: '1' } }),
        ui.button('[PREVIEW]', {
          title: 'Preview the manifest that will be generated',
          icon: icons('eye', 12),
          onClick: () => controller.previewManifest()
        }),
        ui.button('[RESET]', {
          variant: 'danger',
          title: 'Remove every ingested file',
          onClick: () => controller.clearWorkspace()
        })
      ]);

      /* ── tree ──────────────────────────────────────────────────────── */
      ref.rowsNode = util.el('div', { id: 'cu-rows' });
      ref.viewport = util.el('div', { id: 'cu-viewport' }, [ref.rowsNode]);

      ref.emptyTitle = util.el('strong', { txt: 'MATRIX EMPTY — NO DATA LOADED' });
      ref.emptyHint = util.el('div', {
        cls: 'hint',
        txt: 'Drop a folder here, or choose one. Text files become markdown chunks; binaries are attached as-is.'
      });
      ref.emptyAction = ui.button('Select directory', {
        variant: 'primary',
        icon: icons('folderOpen', 13),
        onClick: () => controller.pickDirectory()
      });
      ref.emptyFilters = ui.button('Open filter settings', {
        variant: 'primary',
        icon: icons('filter', 13),
        onClick: () => toggleSettings(true)
      });
      ref.emptyFilters.style.setProperty('display', 'none');

      ref.empty = util.el('div', { id: 'cu-empty' }, [
        util.el('div', { cls: 'cu-drop-icon' }, [icons('folderOpen', 44)]),
        ref.emptyTitle,
        ref.emptyHint,
        ref.emptyAction,
        ref.emptyFilters
      ]);

      ref.tree = util.el(
        'div',
        {
          id: 'cu-tree',
          cls: 'is-empty',
          role: 'tree',
          'aria-label': 'Ingested files',
          'aria-multiselectable': 'true',
          tabindex: '0'
        },
        [ref.viewport, ref.empty]
      );

      /* ── progress ──────────────────────────────────────────────────── */
      ref.progressText = util.el('span', { id: 'cu-progress-text', txt: '' });
      ref.progressFill = util.el('span');
      ref.progressBar = util.el('div', { cls: 'cu-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [
        ref.progressFill
      ]);
      ref.cancelBtn = ui.button('[STOP]', {
        variant: 'danger',
        icon: icons('stop', 11),
        title: 'Cancel the running operation',
        onClick: () => controller.cancel()
      });
      ref.progress = util.el('div', { id: 'cu-progress' }, [
        ref.progressText,
        ref.progressBar,
        ref.cancelBtn
      ]);

      /* ── footer ────────────────────────────────────────────────────── */
      ref.statusLine = util.el('div', { id: 'cu-status-line', txt: 'No files loaded.', role: 'status', 'aria-live': 'polite' });

      ref.downloadBtn = ui.button('[SAVE BUNDLE]', {
        icon: icons('save', 12),
        title: 'Write the bundle to disk',
        onClick: () => controller.run('download')
      });
      ref.copyBtn = ui.button('[COPY]', {
        variant: 'primary',
        icon: icons('copy', 12),
        title: 'Copy the chunks to the clipboard',
        onClick: () => controller.run('copy')
      });
      ref.uploadBtn = ui.button('[EXECUTE UPLOAD]', {
        variant: 'execute',
        icon: icons('upload', 12),
        title: 'Attach the bundle to this chat',
        onClick: () => controller.run('upload')
      });

      const footer = util.el('div', { id: 'cu-footer' }, [
        ref.statusLine,
        util.el('span', { cls: 'cu-spacer' }),
        ref.downloadBtn,
        ref.copyBtn,
        ref.uploadBtn
      ]);

      /* ── assembly ──────────────────────────────────────────────────── */
      ref.settingsPane = util.el('div', { id: 'cu-settings-pane' });
      ref.work = util.el('div', { id: 'cu-work' }, [toolbar, actions, ref.tree, ref.progress, footer]);
      ref.body = util.el('div', { id: 'cu-body' }, [hud, ref.work, ref.settingsPane]);
      ref.panel = util.el('div', { id: 'cu-panel', role: 'document' }, [header, ref.body]);

      ref.overlay = util.el('dialog', {
        id: 'cu-overlay',
        'aria-label': `${env.APP_NAME} workspace`
      }, [ref.panel]);

      root.appendChild(ref.overlay);
      built = true;

      wireEvents();
      measureRowHeight();
      updateShortcutHint();
    }

    /* ------------------------------------------------------------ events */

    function wireEvents() {
      // Native <dialog> emits `cancel` for Escape; prevent the default close so
      // the same teardown path runs for every route out of the panel.
      disposables.listen(ref.overlay, 'cancel', e => {
        e.preventDefault();
        close();
      });
      disposables.listen(ref.overlay, 'click', e => {
        if (e.target === ref.overlay) close();
      });
      // Escape inside a text field should return focus to the tree rather than
      // closing outright or blurring into an undefined focus state.
      disposables.listen(ref.overlay, 'keydown', e => {
        if (e.key !== 'Escape') return;
        if (ui.hasOpenModal()) return;
        const active = ui.shadowActiveElement();
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.value) {
          e.preventDefault();
          e.stopPropagation();
          if (active === ref.search) {
            ref.search.value = '';
            onSearchInput('');
          }
          ref.tree.focus();
          return;
        }
        if (!ref.overlay.open) {
          e.preventDefault();
          close();
        }
      });

      /* drag and drop, on the whole panel */
      let dragDepth = 0;
      const dragTargets = [ref.tree, ref.miniDrop];

      disposables.listen(ref.panel, 'dragenter', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth += 1;
        for (const t of dragTargets) t.classList.add('drag-over');
      });
      disposables.listen(ref.panel, 'dragover', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      disposables.listen(ref.panel, 'dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) for (const t of dragTargets) t.classList.remove('drag-over');
      });
      disposables.listen(ref.panel, 'drop', e => {
        e.preventDefault();
        dragDepth = 0;
        for (const t of dragTargets) t.classList.remove('drag-over');
        // Entries must be pulled out synchronously, before any await.
        const extracted = ingest.extractDropEntries(e);
        controller.ingestDrop(extracted);
      });

      /* virtualised scrolling */
      const onScroll = util.rafBatch(() => renderRows());
      disposables.listen(ref.tree, 'scroll', onScroll, { passive: true });
      disposables.add(() => onScroll.cancel());

      /* keyboard navigation */
      disposables.listen(ref.tree, 'keydown', onTreeKeyDown);
      disposables.listen(ref.tree, 'focus', () => {
        if (rows.length && !getRowNode(cursor)) scrollCursorIntoView();
        paintCursor();
      });

      /* the model drives every visual update */
      disposables.add(
        workspace.subscribe(detail => {
          if (detail.type === 'selection' && detail.preset === undefined) activePreset = null;
          refresh();
        })
      );

      disposables.add(
        store.subscribe((_, detail) => {
          ui.applyAppearance();
          measureRowHeight();
          updateShortcutHint();
          if (detail?.type === 'remote' || detail?.changed?.length) refresh();
        })
      );

      /* resizing changes how many rows fit */
      const onResize = util.throttle(() => renderRows(), 120);
      disposables.listen(window, 'resize', onResize, { passive: true });
      disposables.add(() => onResize.cancel());
    }

    function hasFiles(e) {
      const dt = e.dataTransfer;
      if (!dt) return false;
      try {
        if (dt.types && Array.from(dt.types).includes('Files')) return true;
        return Array.from(dt.items || []).some(i => i.kind === 'file');
      } catch {
        return false;
      }
    }

    /* --------------------------------------------------------- open/close */

    function open() {
      build();
      if (!ref.overlay) return;
      openState = true;

      if (typeof ref.overlay.showModal === 'function' && !ref.overlay.open) {
        try {
          ref.overlay.showModal();
        } catch (e) {
          env.log.debug('showModal failed; using the fallback overlay', e);
          ref.overlay.classList.add('cu-fallback-open');
        }
      } else {
        ref.overlay.classList.add('cu-fallback-open');
      }

      // Toasts must live inside the top-layer dialog to remain interactive.
      ui.attachToastLayer(ref.overlay);
      refreshNow();

      /*
       * The first render happens in the same task as `showModal()`, before the
       * dialog has been laid out, so `clientHeight` is still zero and the
       * virtualised window is guessed. Re-measure and repaint once layout has
       * settled, otherwise a large tree renders a stale window until the first
       * scroll.
       */
      requestAnimationFrame(() => {
        measureRowHeight();
        renderRows();
      });

      requestAnimationFrame(() => {
        // Focus the tree when there is content to navigate, the search box
        // otherwise; both are more useful than the close button.
        const target = rows.length ? ref.tree : ref.search;
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus?.();
        }
      });
    }

    function close() {
      if (!ref.overlay) return;
      openState = false;
      try {
        if (ref.overlay.open) ref.overlay.close();
      } catch {
        /* already closed */
      }
      ref.overlay.classList.remove('cu-fallback-open');
      // Back to the shadow root, where a toast raised with the panel closed
      // (for example from a manager menu command) can still be seen.
      ui.attachToastLayer(null);
    }

    const isOpen = () => openState;
    const toggle = () => (openState ? close() : open());

    /**
     * Temporarily leaves the browser's top layer without changing the panel's
     * logical open state.
     *
     * `showModal()` makes the whole document `inert`. A plain positioned div
     * would not cause this, leaving the page in its normal state when files are handed over.
     * Injecting while the document is inert changes the environment the
     * composer runs in — it cannot be focused or hit-tested — so the dialog
     * steps out of the top layer for the duration of the handover and steps
     * back in if the panel is still supposed to be visible afterwards.
     */
    function exitTopLayer() {
      if (!ref.overlay) return false;
      const wasShowing = ref.overlay.open || ref.overlay.classList.contains('cu-fallback-open');
      if (!wasShowing) return false;
      try {
        if (ref.overlay.open) ref.overlay.close();
      } catch {
        /* already closed */
      }
      ref.overlay.classList.remove('cu-fallback-open');
      ui.attachToastLayer(null);
      return true;
    }

    function enterTopLayer() {
      if (!ref.overlay || !openState) return;
      if (ref.overlay.open || ref.overlay.classList.contains('cu-fallback-open')) return;
      if (typeof ref.overlay.showModal === 'function') {
        try {
          ref.overlay.showModal();
        } catch {
          ref.overlay.classList.add('cu-fallback-open');
        }
      } else {
        ref.overlay.classList.add('cu-fallback-open');
      }
      ui.attachToastLayer(ref.overlay);
      refreshNow();
    }

    function toggleSettings(force) {
      build();
      const showing = force !== undefined ? force : !ref.settingsPane.classList.contains('open');
      if (showing) {
        settingsUi.render(ref.settingsPane);
        ref.settingsPane.classList.add('open');
        ref.work.style.display = 'none';
        util.render(ref.settingsBtn, [icons('arrowLeft', 15)]);
        ref.settingsBtn.title = 'Back to the workspace';
        ref.settingsBtn.setAttribute('aria-label', 'Back to the workspace');
        const first = ui.focusableWithin(ref.settingsPane)[0];
        first?.focus?.();
      } else {
        ref.settingsPane.classList.remove('open');
        // Emptied rather than merely hidden: the pane is rebuilt from live
        // settings every time it opens, so keeping a stale copy in the DOM
        // only risks it being read or focused by something later.
        util.clear(ref.settingsPane);
        ref.work.style.display = 'flex';
        util.render(ref.settingsBtn, [icons('settings', 15)]);
        ref.settingsBtn.title = 'Settings';
        ref.settingsBtn.setAttribute('aria-label', 'Settings');
        refreshNow();
        ref.tree.focus();
      }
    }

    /* -------------------------------------------------------------- search */

    const applySearch = util.debounce(value => {
      workspace.setQuery(value);
      cursor = 0;
      anchor = null;
    }, 120);

    function onSearchInput(value) {
      applySearch(value);
    }

    function onSearchKeyDown(e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        applySearch.flush();
        ref.tree.focus();
        cursor = 0;
        scrollCursorIntoView();
        paintCursor();
      } else if (e.key === 'Escape' && ref.search.value) {
        e.preventDefault();
        e.stopPropagation();
        ref.search.value = '';
        applySearch.flush();
        workspace.setQuery('');
      }
    }

    /* -------------------------------------------------------- measurement */

    function measureRowHeight() {
      const root = ui.getRoot();
      if (!root) return;
      try {
        const raw = getComputedStyle(root).getPropertyValue('--row-h').trim();
        const px = Number.parseFloat(raw);
        if (Number.isFinite(px) && px > 6) rowHeight = px;
      } catch {
        /* keep the previous value */
      }
    }

    /* ------------------------------------------------------------ refresh */

    let dirty = false;

    /**
     * Rendering is skipped entirely while the panel is closed. The model still
     * changes — presets, ingests and settings all mutate it in the background
     * — but touching the DOM for a surface nobody can see is pure waste, so
     * the work is deferred until `open()`.
     */
    const refresh = util.rafBatch(() => {
      if (!built) return;
      if (!openState) {
        dirty = true;
        return;
      }
      dirty = false;
      rows = workspace.flatten();
      if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
      renderRows();
      renderStats();
    });

    /** Synchronous variant used when the panel becomes visible. */
    function refreshNow() {
      if (!built || !openState) return;
      dirty = false;
      rows = workspace.flatten();
      if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
      renderRows();
      renderStats();
    }

    /* --------------------------------------------------------- row render */

    function renderRows() {
      if (!ref.tree) return;

      const total = rows.length;
      ref.tree.classList.toggle('is-empty', total === 0);
      if (total === 0) paintEmptyState();
      ref.viewport.style.height = `${total * rowHeight}px`;

      if (!total) {
        util.clear(ref.rowsNode);
        ref.rowsNode.style.transform = 'translateY(0px)';
        return;
      }

      const threshold = store.get('virtualiseThreshold');
      let start = 0;
      let end = total;

      if (total > threshold) {
        const scrollTop = ref.tree.scrollTop;
        const height = ref.tree.clientHeight || 400;
        const overscan = 8;
        start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        end = Math.min(total, Math.ceil((scrollTop + height) / rowHeight) + overscan);
      }

      ref.rowsNode.style.transform = `translateY(${start * rowHeight}px)`;

      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i += 1) frag.appendChild(buildRow(rows[i], i, total));
      util.clear(ref.rowsNode);
      ref.rowsNode.appendChild(frag);

      paintCursor();
    }

    /**
     * An empty tree has three very different causes and the user needs to be
     * able to tell them apart: nothing loaded, everything filtered out, or a
     * filter query that matches nothing.
     */
    function paintEmptyState() {
      if (!ref.emptyTitle || !ref.emptyHint) return;
      const s = workspace.stats();

      if (s.total === 0) {
        ref.emptyTitle.textContent = 'MATRIX EMPTY — NO DATA LOADED';
        ref.emptyHint.textContent =
          'Drop a folder here, or choose one. Text files become markdown chunks; binaries are attached as-is.';
        ref.emptyAction.style.removeProperty('display');
        ref.emptyFilters.style.setProperty('display', 'none');
        return;
      }

      if (s.visible === 0) {
        const top = [...s.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
        const reason = top ? `${policy.REASON_LABEL[top[0]] || top[0]} (${top[1]})` : 'the current filters';
        ref.emptyTitle.textContent = `ALL ${util.formatCount(s.total)} FILE(S) EXCLUDED`;
        ref.emptyHint.textContent = `Every ingested file is filtered out — mostly ${reason}. Adjust the filters to include them.`;
        ref.emptyAction.style.setProperty('display', 'none');
        ref.emptyFilters.style.removeProperty('display');
        return;
      }

      ref.emptyTitle.textContent = 'NO MATCHES';
      ref.emptyHint.textContent = `No file matches "${workspace.state.query}". Clear the filter to see all ${util.formatCount(s.visible)} included file(s).`;
      ref.emptyAction.style.setProperty('display', 'none');
      ref.emptyFilters.style.setProperty('display', 'none');
    }

    function highlight(text) {
      const q = workspace.state.query.trim().toLowerCase();
      if (!q || q.includes('*') || q.includes('?') || (q.startsWith('/') && q.endsWith('/'))) {
        return document.createTextNode(text);
      }
      const idx = text.toLowerCase().indexOf(q);
      if (idx < 0) return document.createTextNode(text);
      const span = document.createElement('span');
      span.append(text.slice(0, idx));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(idx, idx + q.length);
      span.append(mark, text.slice(idx + q.length));
      return span;
    }

    function buildRow(row, index, total) {
      const isFolder = row.kind === 'folder';
      const node = row.node;
      const checkState = workspace.nodeCheckState(node);

      const el = util.el('div', {
        cls: 'cu-row',
        role: 'treeitem',
        // A stable id per row position lets `aria-activedescendant` actually
        // reference something; without it the attribute is decorative.
        id: `cu-row-${index}`,
        dataset: { index: String(index), path: row.path },
        'aria-level': String(row.depth + 1),
        'aria-setsize': String(total),
        'aria-posinset': String(index + 1),
        'aria-checked': checkState === 1 ? 'true' : checkState === 0 ? 'false' : 'mixed',
        'aria-selected': checkState === 1 ? 'true' : 'false',
        'aria-label': isFolder ? `${node.name} folder` : node.name
      });
      if (isFolder) el.setAttribute('aria-expanded', row.open ? 'true' : 'false');

      el.appendChild(util.el('span', { cls: 'cu-row-indent', style: { width: `${row.depth * 14 + 4}px` } }));

      if (isFolder) {
        const caret = util.el(
          'span',
          {
            cls: 'cu-caret',
            'aria-hidden': 'true',
            onclick: e => {
              e.stopPropagation();
              workspace.toggleFolder(row.path);
            }
          },
          [icons(row.open ? 'chevronDown' : 'chevronRight', 12)]
        );
        el.appendChild(caret);
      } else {
        el.appendChild(util.el('span', { cls: 'cu-caret spacer', 'aria-hidden': 'true' }));
      }

      const box = util.el('input', {
        cls: 'cu-check',
        type: 'checkbox',
        tabindex: '-1',
        'aria-hidden': 'true',
        onclick: e => {
          e.stopPropagation();
          toggleRow(index, e.shiftKey);
        }
      });
      box.checked = checkState === 1;
      box.indeterminate = checkState === 0.5;
      el.appendChild(box);

      const badgeText = isFolder ? 'DIR' : node.item.isBinary ? 'BIN' : 'CODE';
      const badgeCls = isFolder ? 'dir' : node.item.isBinary ? 'bin' : 'code';
      el.appendChild(util.el('span', { cls: `cu-badge ${badgeCls}`, txt: badgeText }));

      const label = util.el('span', { cls: 'cu-label', title: row.path });
      label.appendChild(highlight(node.name));
      el.appendChild(label);

      if (!isFolder) {
        el.appendChild(util.el('span', { cls: 'cu-meta', txt: util.formatSize(node.item.file.size) }));
      } else {
        const count = workspace.collectFiles(node).length;
        el.appendChild(util.el('span', { cls: 'cu-meta', txt: `${count}` }));
      }

      el.appendChild(
        util.el(
          'button',
          {
            cls: 'cu-remove',
            type: 'button',
            tabindex: '-1',
            'aria-label': `Remove ${node.name}`,
            onclick: e => {
              e.stopPropagation();
              controller.removePath(row.path);
            }
          },
          [icons('x', 12)]
        )
      );

      el.addEventListener('click', e => {
        cursor = index;
        if (e.shiftKey) {
          toggleRow(index, true);
        } else if (isFolder) {
          workspace.toggleFolder(row.path);
        } else {
          toggleRow(index, false);
        }
        paintCursor();
      });

      el.addEventListener('dblclick', () => {
        if (isFolder) workspace.setFolderOpen(row.path, !row.open);
      });

      return el;
    }

    const getRowNode = index => ref.rowsNode?.querySelector(`[data-index="${index}"]`);

    function paintCursor() {
      if (!ref.rowsNode) return;
      for (const node of ref.rowsNode.children) {
        node.classList.toggle('is-cursor', Number(node.dataset.index) === cursor);
      }
      const active = getRowNode(cursor);
      if (active && active.id) ref.tree.setAttribute('aria-activedescendant', active.id);
      else ref.tree.removeAttribute('aria-activedescendant');
    }

    /* --------------------------------------------------------- selection */

    function toggleRow(index, extend) {
      const row = rows[index];
      if (!row) return;

      if (extend && anchor !== null && anchor !== index) {
        // Shift-range: apply the anchor row's *new* state across the range,
        // which is what every file manager does and what users expect.
        const from = Math.min(anchor, index);
        const to = Math.max(anchor, index);
        const anchorRow = rows[anchor];
        const target = workspace.nodeCheckState(anchorRow.node) !== 1;
        workspace.snapshot('Range selection');
        for (let i = from; i <= to; i += 1) {
          const r = rows[i];
          if (!r) continue;
          if (r.kind === 'folder') workspace.setSubtreeSelected(r.path, target);
          else workspace.setSelected(r.path, target);
        }
        return;
      }

      anchor = index;
      if (row.kind === 'folder') {
        const next = workspace.nodeCheckState(row.node) !== 1;
        workspace.snapshot(`Toggle ${row.node.name}`);
        workspace.setSubtreeSelected(row.path, next);
      } else {
        workspace.setSelected(row.path, !row.node.item.selected);
      }
    }

    /* ------------------------------------------------------------ keyboard */

    function moveCursor(delta) {
      if (!rows.length) return;
      cursor = util.clamp(cursor + delta, 0, rows.length - 1);
      scrollCursorIntoView();
      paintCursor();
    }

    function setCursor(index) {
      if (!rows.length) return;
      cursor = util.clamp(index, 0, rows.length - 1);
      scrollCursorIntoView();
      paintCursor();
    }

    function scrollCursorIntoView() {
      if (!ref.tree) return;
      const top = cursor * rowHeight;
      const bottom = top + rowHeight;
      const viewTop = ref.tree.scrollTop;
      const viewBottom = viewTop + ref.tree.clientHeight;
      if (top < viewTop) ref.tree.scrollTop = top;
      else if (bottom > viewBottom) ref.tree.scrollTop = bottom - ref.tree.clientHeight;
      renderRows();
    }

    function onTreeKeyDown(e) {
      if (!rows.length) return;
      const row = rows[cursor];

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey) {
            if (anchor === null) anchor = cursor;
            moveCursor(1);
            toggleRow(cursor, true);
          } else {
            anchor = null;
            moveCursor(1);
          }
          return;

        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey) {
            if (anchor === null) anchor = cursor;
            moveCursor(-1);
            toggleRow(cursor, true);
          } else {
            anchor = null;
            moveCursor(-1);
          }
          return;

        case 'ArrowRight':
          e.preventDefault();
          if (row?.kind === 'folder' && !row.open) workspace.setFolderOpen(row.path, true);
          else moveCursor(1);
          return;

        case 'ArrowLeft': {
          e.preventDefault();
          if (row?.kind === 'folder' && row.open) {
            workspace.setFolderOpen(row.path, false);
            return;
          }
          const parent = util.dirname(row?.path || '');
          if (parent) {
            const idx = rows.findIndex(r => r.path === parent);
            if (idx >= 0) setCursor(idx);
          }
          return;
        }

        case 'Home':
          e.preventDefault();
          setCursor(0);
          return;

        case 'End':
          e.preventDefault();
          setCursor(rows.length - 1);
          return;

        case 'PageDown':
          e.preventDefault();
          moveCursor(Math.max(1, Math.floor(ref.tree.clientHeight / rowHeight) - 1));
          return;

        case 'PageUp':
          e.preventDefault();
          moveCursor(-Math.max(1, Math.floor(ref.tree.clientHeight / rowHeight) - 1));
          return;

        case ' ':
        case 'Spacebar':
          e.preventDefault();
          toggleRow(cursor, e.shiftKey);
          return;

        case 'Enter':
          e.preventDefault();
          if (row?.kind === 'folder') workspace.toggleFolder(row.path);
          else toggleRow(cursor, false);
          return;

        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          if (row) controller.removePath(row.path);
          return;

        case 'Escape':
          // Handled by the overlay; do not swallow it here.
          return;

        default:
          break;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Type-ahead: printable characters jump to the next matching row.
      if (e.key.length === 1 && /\S/.test(e.key)) {
        e.preventDefault();
        const now = Date.now();
        typeahead.text = now - typeahead.at > 900 ? e.key.toLowerCase() : typeahead.text + e.key.toLowerCase();
        typeahead.at = now;

        const start = typeahead.text.length === 1 ? cursor + 1 : cursor;
        for (let i = 0; i < rows.length; i += 1) {
          const idx = (start + i) % rows.length;
          if (rows[idx].node.name.toLowerCase().startsWith(typeahead.text)) {
            setCursor(idx);
            return;
          }
        }
      }
    }

    /* --------------------------------------------------------------- stats */

    function renderStats() {
      const s = workspace.stats();
      const settings = store.all();

      /* meter */
      const capacity = Math.max(1, settings.maxChunkChars * settings.maxChunks);
      const pct = util.clamp(Math.round((s.textBytes / capacity) * 100), 0, 999);
      const filled = util.clamp(Math.round((Math.min(pct, 100) / 100) * 12), 0, 12);
      ref.meter.textContent = `[${'|'.repeat(filled)}${'·'.repeat(12 - filled)}] ${pct}%`;
      ref.meter.dataset.level = s.overBudget ? 'over' : s.nearBudget ? 'warn' : 'ok';
      ref.meter.setAttribute('aria-label', `Context budget used: ${pct} percent`);

      /* metrics */
      ref.mFiles.textContent = `${util.formatCount(s.selected)} / ${util.formatCount(s.visible)}`;
      ref.mUploads.textContent = s.selected ? `~${s.estUploads}` : '—';
      ref.mUploads.className = `cu-metric-value${s.overBudget ? ' danger' : s.nearBudget ? ' warn' : ''}`;
      ref.mSize.textContent = util.formatSize(s.selectedBytes);
      ref.mTokens.textContent = s.selected ? `~${util.formatCount(s.estTokens)}` : '—';

      /* presets */
      for (const btn of ref.presets.children) {
        btn.setAttribute('aria-pressed', btn.dataset.preset === activePreset ? 'true' : 'false');
      }

      /* exclusion breakdown */
      const entries = [...s.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      util.render(
        ref.exclusions,
        entries.length
          ? entries.map(([reason, count]) =>
              util.el('div', { cls: 'cu-exclusion' }, [
                util.el('b', { txt: String(count) }),
                util.el('span', { txt: policy.REASON_LABEL[reason] || reason })
              ])
            )
          : [util.el('div', { cls: 'cu-exclusion', txt: 'Nothing excluded.' })]
      );

      /* search counter */
      const mode = workspace.state.query ? workspace.state.queryMode.toUpperCase() : 'ALL';
      ref.searchMode.textContent = `${mode}: ${util.formatCount(s.matches)}`;

      /* footer */
      if (!s.total) {
        ref.statusLine.textContent = 'No files loaded.';
      } else {
        const bits = [
          `${s.selected}/${s.visible} selected`,
          `${s.selectedText} text · ${s.selectedBinary} binary`,
          util.formatSize(s.selectedBytes)
        ];
        if (s.excluded) bits.push(`${s.excluded} excluded`);
        ref.statusLine.textContent = bits.join(' · ');
      }

      /* action availability — no silently dead buttons */
      const busy = controller.isBusy();
      const nothing = s.selected === 0;
      ref.downloadBtn.disabled = busy || nothing;
      ref.copyBtn.disabled = busy || nothing;
      ref.uploadBtn.disabled = busy || nothing;
      ref.undoBtn.disabled = busy || !workspace.canUndo();
      ref.undoBtn.title = workspace.canUndo()
        ? `Undo: ${workspace.lastUndoLabel()}`
        : 'Nothing to undo';

      const profile = data.siteProfile();
      if (profile.chatInjection === false) {
        ref.uploadBtn.title = profile.injectionNote || 'This site does not accept attached files.';
      }
    }

    /* ------------------------------------------------------------ progress */

    /**
     * The progress row serves two distinct states, and the difference matters
     * to the user: `busy` means the script is working and the action buttons
     * are unavailable; `pending` means a native picker is open and the panel
     * is still fully usable. Conflating them is what made folder selection
     * look like a frozen panel.
     */
    let progressState = { busy: false, pending: false };

    function paintProgress() {
      if (!built) return;
      const { busy, pending } = progressState;
      const active = busy || pending;

      ref.status.dataset.state = busy ? 'busy' : pending ? 'busy' : 'idle';
      util.render(ref.status, [
        icons('dot', 11),
        util.el('span', { txt: busy ? 'WORKING' : pending ? 'WAITING' : 'READY' })
      ]);

      ref.progress.classList.toggle('active', active);
      if (!active) {
        ref.progressText.textContent = '';
        ref.progressBar.classList.remove('indeterminate');
        ref.progressFill.style.width = '0%';
        ref.progressBar.removeAttribute('aria-valuenow');
      }
      renderStats();
    }

    function setBusy(busy, label = '') {
      if (!built) return;
      progressState.busy = !!busy;
      if (busy) {
        ref.progressText.textContent = label;
        ref.progressBar.classList.add('indeterminate');
        ref.progressFill.style.width = '35%';
        ref.progressBar.removeAttribute('aria-valuenow');
      }
      paintProgress();
    }

    /** A native picker is open: show it, but keep the panel interactive. */
    function setPending(pending, label = '') {
      if (!built) return;
      progressState.pending = !!pending;
      if (pending) {
        ref.progressText.textContent = label;
        ref.progressBar.classList.add('indeterminate');
        ref.progressFill.style.width = '35%';
        ref.progressBar.removeAttribute('aria-valuenow');
      }
      paintProgress();
    }

    function setProgress(fraction, label) {
      if (!built) return;
      if (!progressState.busy && !progressState.pending) return;
      if (Number.isFinite(fraction)) {
        const pct = util.clamp(Math.round(fraction * 100), 0, 100);
        ref.progressBar.classList.remove('indeterminate');
        ref.progressFill.style.width = `${pct}%`;
        ref.progressBar.setAttribute('aria-valuenow', String(pct));
      }
      if (label !== undefined) ref.progressText.textContent = label;
    }

    function setStatusLine(text) {
      if (built) ref.statusLine.textContent = text;
    }

    function updateShortcutHint() {
      if (!ref.kbd) return;
      const key = (store.get('shortcutKey') || 'u').toUpperCase();
      ref.kbd.textContent = `${env.capabilities.isMac ? '⌥⇧' : 'Alt+Shift+'}${key}`;
      ref.kbd.title = 'Toggle this panel';
    }

    /* ------------------------------------------------------------- dispose */

    function dispose() {
      applySearch.cancel();
      refresh.cancel();
      disposables.dispose();
      built = false;
      openState = false;
      rows = [];
      for (const k of Object.keys(ref)) delete ref[k];
    }

    return {
      build,
      open,
      close,
      toggle,
      isOpen,
      exitTopLayer,
      enterTopLayer,
      toggleSettings,
      refresh: () => refresh(),
      renderStats,
      setBusy,
      setPending,
      setProgress,
      setStatusLine,
      updateShortcutHint,
      measureRowHeight,
      dispose,
      isDirty: () => dirty,
      /* exported for tests */
      _rows: () => rows,
      _cursor: () => cursor,
      _ref: ref
    };
  })();

  /* =======================================================================
   * SECTION 14 — Settings
   * -----------------------------------------------------------------------
   * Every setting the store declares is exposed here, and every control here
   * writes through `store.set`, which re-validates the whole object. The UI
   * therefore cannot put the store into an invalid state, and a rejected value
   * is visibly corrected rather than silently kept or allowing invalid
   * zero/NaN numeric states.
   *
   * The pane is rebuilt from the live settings each time it is shown, so it
   * can never display state that has drifted from what is stored.
   * ==================================================================== */

  const settingsUi = (() => {
    let container = null;

    const s = () => store.all();

    function update(patch) {
      const changed = store.set(patch);
      if (store.isReadOnly()) {
        ui.toast('Settings could not be saved: this browser blocked storage.', 'warn', { timeout: 7000 });
      }
      return changed;
    }

    /** Re-renders in place, preserving scroll position. */
    function rerender() {
      if (!container) return;
      const scroll = container.scrollTop;
      render(container);
      container.scrollTop = scroll;
    }

    /* ------------------------------------------------------------ numbers */

    /**
     * A numeric field that shows what the stored value actually became.
     * Out-of-range input is clamped by the store and the field is corrected on
     * blur, so the displayed number is always the effective one.
     */
    function numberField(key, label, { hint = '', format = null, limits = null } = {}) {
      const bounds = limits || data.LIMITS[key] || {};
      const helper = format ? util.el('span', { cls: 'helper', txt: format(s()[key]) }) : null;

      const control = ui.input({
        type: 'number',
        value: s()[key],
        min: bounds.min,
        max: bounds.max,
        onInput: v => {
          if (helper) {
            const n = Number(v);
            helper.textContent = Number.isFinite(n) ? format(n) : '';
          }
        },
        onChange: v => {
          update({ [key]: v });
          const effective = s()[key];
          control.value = String(effective);
          if (helper) helper.textContent = format(effective);
        }
      });
      control.addEventListener('blur', () => {
        control.value = String(s()[key]);
      });

      const bits = [];
      if (bounds.min !== undefined) bits.push(`min ${bounds.min.toLocaleString('en-US')}`);
      if (bounds.max !== undefined) bits.push(`max ${bounds.max.toLocaleString('en-US')}`);
      const fullHint = [hint, bits.join(' · ')].filter(Boolean).join(' — ');

      return ui.field(label, control, { hint: fullHint, helper });
    }

    function toggleField(key, label, hint = '', after = null) {
      return ui.checkbox(
        label,
        s()[key],
        v => {
          update({ [key]: v });
          after?.();
        },
        { hint }
      );
    }

    /* ----------------------------------------------------------- sections */

    function profilesSection() {
      const current = s();
      const list = store.profiles();

      const selector = ui.select(
        list.map(p => ({ value: p.id, label: p.builtin ? `${p.name} (built-in)` : p.name })),
        current.activeProfile,
        id => {
          store.applyProfile(id);
          rerender();
          ui.toast(`Profile applied: ${list.find(p => p.id === id)?.name || id}`, 'info', { timeout: 1800 });
        },
        { ariaLabel: 'Active filter profile' }
      );

      const nameInput = ui.input({ placeholder: 'New profile name…', ariaLabel: 'Profile name' });

      const saveBtn = ui.button('Save as profile', {
        icon: icons('save', 12),
        onClick: () => {
          const res = store.saveProfile(nameInput.value);
          if (!res.ok) {
            ui.toast('Give the profile a name first.', 'error');
            nameInput.focus();
            return;
          }
          nameInput.value = '';
          rerender();
          ui.toast(res.updated ? 'Profile updated.' : 'Profile saved.', 'success');
        }
      });

      const activeIsUser = current.activeProfile.startsWith('user:');
      const deleteBtn = ui.button('Delete', {
        variant: 'danger',
        icon: icons('trash', 12),
        disabled: !activeIsUser,
        title: activeIsUser ? 'Delete the active profile' : 'Built-in profiles cannot be deleted',
        onClick: async () => {
          const ok = await ui.confirmDestructive({
            title: 'Delete profile',
            message: `Delete "${store.activeProfile().name}"? The filter lists themselves are not changed.`,
            confirmLabel: 'Delete'
          });
          if (!ok) return;
          store.deleteProfile(current.activeProfile);
          rerender();
          ui.toast('Profile deleted.', 'success');
        }
      });

      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ FILTER PROFILES ]'),
        ui.field('Active profile', selector, {
          hint: 'Switching a profile replaces the ignore lists below. Saving captures the current lists under a name.'
        }),
        util.el('div', { cls: 'cu-grid' }, [
          ui.field('Save current lists as', nameInput),
          util.el('div', { cls: 'cu-field' }, [
            util.el('span', { cls: 'cu-field-label', txt: '\u00a0' }),
            util.el('div', { style: { display: 'flex', gap: '6px' } }, [saveBtn, deleteBtn])
          ])
        ])
      ]);
    }

    function filteringSection() {
      const current = s();

      const folderEditor = ui.tagEditor(
        current.ignoreFolders,
        v => update({ ignoreFolders: v }),
        { placeholder: 'Add folder + Enter…', ariaLabel: 'Ignored folders' }
      );
      const extEditor = ui.tagEditor(
        current.ignoreExts,
        v => update({ ignoreExts: v }),
        { placeholder: 'Add .ext or filename + Enter…', ariaLabel: 'Ignored extensions' }
      );

      const globs = util.el('textarea', {
        cls: 'cu-textarea',
        rows: 4,
        spellcheck: false,
        placeholder: 'One pattern per line — gitignore syntax\n**/generated/**\n!keep-this.ts',
        'aria-label': 'Additional ignore patterns'
      });
      globs.value = current.extraIgnoreGlobs;
      globs.addEventListener('change', () => update({ extraIgnoreGlobs: globs.value }));

      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ FILTERING ]'),
        ui.field('Ignored folders', folderEditor, {
          hint: 'Matched against directory names only. A file named "dist" is no longer dropped as if it were a folder.'
        }),
        ui.field('Ignored extensions and filenames', extEditor, {
          hint: 'Entries beginning with a dot match a suffix (.min.js); anything else must match the whole filename.'
        }),
        ui.field('Additional ignore patterns', globs, {
          hint: 'Full gitignore syntax: *, **, ?, [a-z], leading / to anchor, trailing / for folders, ! to re-include.'
        }),
        toggleField(
          'useGitignore',
          'Honour .gitignore files found in the dropped folder',
          'Rules are applied relative to the directory containing each .gitignore, exactly as git resolves them.'
        ),
        util.el('div', { cls: 'cu-grid' }, [
          toggleField('skipHidden', 'Skip hidden files and folders', 'Recognised dotfiles such as .gitignore and .env are still kept.'),
          toggleField('includeBinary', 'Include binary files', 'Attached as raw uploads rather than packed into markdown.')
        ]),
        util.el('div', { cls: 'cu-grid' }, [
          toggleField('excludeTests', 'Exclude tests, specs and fixtures'),
          toggleField('excludeLockfiles', 'Exclude dependency lockfiles', 'package-lock.json, yarn.lock, Cargo.lock, and similar.')
        ])
      ]);
    }

    function limitsSection() {
      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ LIMITS ]'),
        util.el('div', { cls: 'cu-grid' }, [
          numberField('maxChunks', 'Max uploads per run', {
            hint: 'Above this the run offers to save a combined file instead'
          }),
          numberField('maxFileBytes', 'Max file size', { format: util.formatSize }),
          numberField('maxChunkChars', 'Max characters per chunk', {
            format: n => `~${util.formatCount(util.estimateTokens(n))} tokens`
          }),
          numberField('maxTotalFiles', 'Max files per ingest', {
            hint: 'A hard cap; the rest of a very large drop is discarded rather than freezing the tab'
          })
        ])
      ]);
    }

    function packingSection() {
      const current = s();

      const prompt = util.el('textarea', {
        cls: 'cu-textarea',
        rows: 3,
        placeholder: 'e.g. Review this codebase for memory leaks and unhandled promise rejections.',
        'aria-label': 'Custom manifest prompt'
      });
      prompt.value = current.customPrompt;
      prompt.addEventListener('change', () => update({ customPrompt: prompt.value }));

      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ PACKING ]'),
        ui.field('Instructions prepended to the manifest', prompt, {
          hint: 'Written verbatim at the top of codebase_manifest.md.'
        }),
        util.el('div', { cls: 'cu-grid' }, [
          ui.field(
            'File order',
            ui.select(
              [
                { value: 'path', label: 'Path (A → Z)' },
                { value: 'size-desc', label: 'Size (largest first)' },
                { value: 'size-asc', label: 'Size (smallest first)' },
                { value: 'ext', label: 'Extension, then path' }
              ],
              current.sortOrder,
              v => update({ sortOrder: v }),
              { ariaLabel: 'File order' }
            ),
            { hint: 'Determines the order files appear in the chunks.' }
          ),
          ui.field(
            'Chunk filenames',
            ui.select(
              [
                { value: 'part', label: 'codebase_part_1.md' },
                { value: 'indexed', label: 'codebase_001.md' }
              ],
              current.chunkNaming,
              v => update({ chunkNaming: v }),
              { ariaLabel: 'Chunk filenames' }
            ),
            { hint: 'Zero-padded names sort correctly in file managers.' }
          )
        ]),
        util.el('div', { cls: 'cu-grid' }, [
          toggleField('includeTree', 'Include a directory tree in the manifest'),
          toggleField('manifestStats', 'Include size and token statistics')
        ]),
        util.el('div', { cls: 'cu-grid' }, [
          toggleField('includeLineNumbers', 'Prefix each line with its number', 'Useful when you intend to discuss specific lines; costs roughly 8% more tokens.'),
          toggleField('stripTrailingWhitespace', 'Strip trailing whitespace')
        ]),
        toggleField('collapseBlankLines', 'Collapse runs of blank lines', 'Three or more consecutive blank lines become one.')
      ]);
    }

    function deliverySection() {
      const current = s();
      const profile = data.siteProfile();

      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ DELIVERY ]'),
        profile.chatInjection === false
          ? ui.banner(
              `${profile.label}: ${profile.injectionNote}`,
              'warn',
              'warning'
            )
          : null,
        ui.field(
          'Default action',
          ui.select(
            [
              { value: 'upload', label: 'Attach to this chat' },
              { value: 'copy', label: 'Copy to clipboard' },
              { value: 'download', label: 'Save to disk' }
            ],
            current.deliveryMode,
            v => update({ deliveryMode: v }),
            { ariaLabel: 'Default delivery action' }
          ),
          { hint: 'Used by the keyboard shortcut for "run with the default action".' }
        ),
        util.el('div', { cls: 'cu-grid' }, [
          toggleField('closeOnDeliver', 'Close the panel after a successful run'),
          toggleField('combineOnDownload', 'Combine chunks into one file when saving')
        ]),
        toggleField(
          'autoRetryAsCopy',
          'Fall back to the clipboard if attaching fails',
          'When the page rejects the attachment, the bundle is copied instead of the run failing.'
        )
      ]);
    }

    function interfaceSection() {
      const current = s();

      const hotkey = ui.input({
        value: current.shortcutKey,
        ariaLabel: 'Hotkey letter',
        onChange: v => {
          update({ shortcutKey: v });
          hotkey.value = s().shortcutKey;
          panel.updateShortcutHint();
        }
      });
      hotkey.maxLength = 1;
      hotkey.style.setProperty('max-width', '80px');

      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ INTERFACE ]'),
        util.el('div', { cls: 'cu-grid' }, [
          ui.field(
            'Theme',
            ui.select(
              [
                { value: 'crt', label: 'CRT (industrial)' },
                { value: 'slate', label: 'Slate' },
                { value: 'light', label: 'Light' }
              ],
              current.theme,
              v => {
                update({ theme: v });
                ui.applyAppearance();
              },
              { ariaLabel: 'Theme' }
            )
          ),
          ui.field(
            'Density',
            ui.select(
              [
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' }
              ],
              current.density,
              v => {
                update({ density: v });
                ui.applyAppearance();
                panel.measureRowHeight();
                panel.refresh();
              },
              { ariaLabel: 'Density' }
            )
          )
        ]),
        util.el('div', { cls: 'cu-grid' }, [
          ui.field(`Hotkey letter (${env.capabilities.isMac ? '⌥⇧' : 'Alt+Shift+'}…)`, hotkey, {
            hint: 'One character. Applies on every supported site.'
          }),
          numberField('virtualiseThreshold', 'Virtualise the tree above', {
            hint: 'Rows. Below this the whole list is rendered so browser find-in-page works'
          })
        ]),
        util.el('div', { cls: 'cu-grid' }, [
          toggleField('reduceMotion', 'Reduce motion', 'Also honoured automatically from your system setting.', () =>
            ui.applyAppearance()
          ),
          toggleField('confirmDestructive', 'Confirm destructive actions', 'Clearing the workspace and deleting profiles.')
        ]),
        toggleField(
          'rememberSelection',
          'Remember which files I deselected',
          'Stored on this device only, keyed by the top-level folder name. Paths only — never file contents.'
        )
      ]);
    }

    function dataSection() {
      const exportArea = util.el('textarea', {
        cls: 'cu-textarea',
        rows: 4,
        readonly: true,
        spellcheck: false,
        'aria-label': 'Exported settings'
      });
      exportArea.value = JSON.stringify(store.exportSettings(), null, 2);

      const importArea = util.el('textarea', {
        cls: 'cu-textarea',
        rows: 3,
        spellcheck: false,
        placeholder: 'Paste exported settings here…',
        'aria-label': 'Import settings'
      });

      const footprint = util.el('div', { cls: 'hint', txt: 'Calculating…' });
      env.storage.keys().then(async keys => {
        let bytes = 0;
        for (const k of keys) {
          // eslint-disable-next-line no-await-in-loop
          const v = await env.storage.get(k, null);
          bytes += JSON.stringify(v ?? '').length + String(k).length;
        }
        footprint.textContent = `${util.formatSize(bytes)} stored across ${keys.length} key(s).`;
      });

      return util.el('div', { cls: 'cu-setting-block' }, [
        ui.sectionTitle('[ DATA ]'),
        store.isReadOnly()
          ? ui.banner('Storage is unavailable here, so settings will reset when the page closes.', 'warn', 'warning')
          : null,
        env.capabilities.gmStorage
          ? ui.banner('Settings are shared across every supported site.', 'info', 'info')
          : ui.banner(
              'Your userscript manager did not grant shared storage, so settings apply to this site only.',
              'warn',
              'warning'
            ),
        ui.field('Export', exportArea),
        util.el('div', { style: { display: 'flex', gap: '6px', 'margin-bottom': '12px' } }, [
          ui.button('Copy export', {
            icon: icons('copy', 12),
            onClick: async () => {
              const ok = await env.writeClipboardText(exportArea.value);
              ui.toast(ok ? 'Settings copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error');
            }
          }),
          ui.button('Download export', {
            icon: icons('download', 12),
            onClick: () => {
              deliver.downloadOne(
                new File([exportArea.value], 'codebase-uploader-settings.json', { type: 'application/json' })
              );
              ui.toast('Settings file saved.', 'success');
            }
          })
        ]),
        ui.field('Import', importArea),
        util.el('div', { style: { display: 'flex', gap: '6px', 'flex-wrap': 'wrap', 'margin-top': '8px' } }, [
          ui.button('Apply import', {
            variant: 'primary',
            onClick: () => {
              const res = store.importSettings(importArea.value);
              if (!res.ok) {
                ui.toast('That does not look like exported settings.', 'error');
                return;
              }
              ui.applyAppearance();
              panel.updateShortcutHint();
              panel.measureRowHeight();
              rerender();
              panel.refresh();
              ui.toast('Settings imported.', 'success');
            }
          }),
          ui.button('Diagnostics', {
            icon: icons('info', 12),
            onClick: () => controller.showDiagnostics()
          }),
          ui.button('Forget remembered selections', {
            onClick: async () => {
              await store.clearSession();
              ui.toast('Remembered selections cleared.', 'success');
            }
          }),
          ui.button('Reset all settings', {
            variant: 'danger',
            icon: icons('trash', 12),
            onClick: async () => {
              const ok = await ui.confirmDestructive({
                title: 'Reset settings',
                message: 'Restore every setting to its default? Saved profiles are removed too.',
                confirmLabel: 'Reset'
              });
              if (!ok) return;
              store.reset();
              ui.applyAppearance();
              panel.updateShortcutHint();
              panel.measureRowHeight();
              rerender();
              panel.refresh();
              ui.toast('Settings reset to defaults.', 'success');
            }
          })
        ]),
        util.el('div', { style: { 'margin-top': '12px' } }, [footprint]),
        toggleField('debug', 'Verbose console logging', 'Writes detailed diagnostics to the browser console.', () =>
          env.log.setDebug(store.get('debug'))
        )
      ]);
    }

    /* ------------------------------------------------------------- render */

    function render(target) {
      container = target;
      util.render(container, [
        profilesSection(),
        filteringSection(),
        limitsSection(),
        packingSection(),
        deliverySection(),
        interfaceSection(),
        dataSection()
      ]);
    }

    return { render, rerender };
  })();

  /* =======================================================================
   * SECTION 15 — Controller
   * -----------------------------------------------------------------------
   * Orchestration: one operation at a time, always cancellable, always
   * reporting progress, and always leaving the workspace in a coherent state
   * whether it succeeded, failed or was interrupted.
   *
   * Operations are strictly guarded against re-entrant runs: duplicate execution
   * clicks are ignored while an operation is in flight, cancellation is fully
   * supported, and delivery outcomes are verified prior to reporting success.
   * ==================================================================== */

  const controller = (() => {
    /**
     * One explicit lifecycle for the whole application, so the interface can
     * always say what is happening and no two operations can collide.
     *
     *   idle       nothing in flight
     *   waiting    a native picker is open (NOT busy: the panel stays usable)
     *   ingesting  scanning, reading and classifying files
     *   packing    building markdown chunks
     *   delivering attaching, copying or saving
     */
    const PHASE = {
      IDLE: 'idle',
      WAITING: 'waiting',
      INGESTING: 'ingesting',
      PACKING: 'packing',
      DELIVERING: 'delivering'
    };

    let phase = PHASE.IDLE;
    let aborter = null;
    let pendingPicker = null;
    let lastRun = null;

    const isBusy = () =>
      phase === PHASE.INGESTING || phase === PHASE.PACKING || phase === PHASE.DELIVERING;
    const isWaiting = () => phase === PHASE.WAITING;
    const getPhase = () => phase;

    function setPhase(next, label = '') {
      phase = next;
      if (next === PHASE.IDLE) {
        panel.setBusy(false);
        panel.setPending(false);
      } else if (next === PHASE.WAITING) {
        panel.setBusy(false);
        panel.setPending(true, label);
      } else {
        panel.setPending(false);
        panel.setBusy(true, label);
      }
    }

    function begin(next, label) {
      if (isBusy()) return null;
      aborter = new AbortController();
      setPhase(next, label);
      return aborter.signal;
    }

    function end() {
      aborter = null;
      setPhase(PHASE.IDLE);
    }

    /** Cancels whatever is in flight — a picker, or a running operation. */
    function cancel() {
      if (phase === PHASE.WAITING) {
        pendingPicker?.cancel();
        pendingPicker = null;
        setPhase(PHASE.IDLE);
        panel.setStatusLine('Selection cancelled.');
        ui.toast('Selection cancelled.', 'info', { timeout: 1800 });
        return true;
      }
      if (!aborter) return false;
      aborter.abort();
      panel.setProgress(undefined, 'Cancelling…');
      return true;
    }

    /**
     * Wraps a user-initiated action so that a thrown exception becomes a
     * visible error rather than a console entry nobody reads. Every entry
     * point below goes through this.
     */
    function guard(name, fn) {
      return (...args) => {
        try {
          const result = fn(...args);
          if (result && typeof result.catch === 'function') {
            return result.catch(e => {
              if (util.isCancellation(e)) return undefined;
              env.log.error(`${name} failed`, e);
              ui.toast(`${name} failed: ${e?.message || e}`, 'error');
              panel.setStatusLine(`${name} failed: ${e?.message || e}`);
              if (isBusy()) end();
              return undefined;
            });
          }
          return result;
        } catch (e) {
          env.log.error(`${name} failed`, e);
          ui.toast(`${name} failed: ${e?.message || e}`, 'error');
          panel.setStatusLine(`${name} failed: ${e?.message || e}`);
          if (isBusy()) end();
          return undefined;
        }
      };
    }

    /* ------------------------------------------------------------ ingest */

    /** Human-readable progress for every phase the ingest passes through. */
    function ingestProgress(p) {
      if (!p) return;
      if (p.phase === 'scan') {
        panel.setProgress(
          undefined,
          p.complete
            ? `Found ${util.formatCount(p.found)} file(s); reading…`
            : `Scanning… ${util.formatCount(p.found)} file(s) in ${util.formatCount(p.directories || 0)} folder(s)`
        );
      } else if (p.phase === 'read') {
        panel.setProgress(p.total ? p.done / p.total : undefined,
          `Reading ${util.formatCount(p.done)}/${util.formatCount(p.total)}…`);
      } else if (p.phase === 'gitignore') {
        panel.setProgress(undefined, 'Reading .gitignore rules…');
      } else if (p.phase === 'classify') {
        panel.setProgress(undefined, 'Classifying files…');
      } else if (Number.isFinite(p.classified) && p.total) {
        panel.setProgress(p.classified / p.total,
          `Classifying ${util.formatCount(p.classified)}/${util.formatCount(p.total)}…`);
      }
    }

    async function runIngest(label, producer) {
      const signal = begin(PHASE.INGESTING, label);
      if (!signal) {
        ui.toast('Another operation is already running.', 'warn');
        return;
      }

      const started = Date.now();
      panel.setStatusLine(label);

      try {
        const result = await producer(signal, { onProgress: ingestProgress });

        if (!result) {
          panel.setStatusLine('Nothing was read.');
          return;
        }

        if (!result.items.length) {
          // Never return to idle without saying why.
          const why = result.scanned === 0
            ? 'That folder contained no readable files.'
            : result.duplicates
              ? `All ${result.duplicates} file(s) were already loaded.`
              : 'No new files were found.';
          panel.setStatusLine(why);
          ui.toast(why, 'warn', { timeout: 5000 });
          return;
        }

        const added = workspace.merge(result);

        if (result.root) {
          const remembered = await store.recallDeselected(result.root);
          const applied = workspace.applyRememberedSelection(remembered);
          if (applied) {
            ui.toast(`Restored ${applied} previously deselected file(s).`, 'info', { timeout: 3500 });
          }
        }

        const stats = workspace.stats();
        const bits = [`Added ${util.formatCount(added)} file(s)`];
        if (result.duplicates) bits.push(`${result.duplicates} duplicate(s) skipped`);
        if (result.skippedUnreadable) bits.push(`${result.skippedUnreadable} unreadable`);
        if (result.gitignores?.size) bits.push(`${result.gitignores.size} .gitignore file(s)`);
        bits.push(util.formatDuration(Date.now() - started));
        panel.setStatusLine(bits.join(' · '));

        if (result.truncated) {
          ui.toast(
            `Stopped at the ${store.get('maxTotalFiles').toLocaleString('en-US')}-file limit. ` +
              'Narrow the folder or raise the limit in Settings.',
            'warn',
            { timeout: 10000, actions: [{ label: 'Settings', onSelect: () => panel.toggleSettings(true) }] }
          );
        } else if (stats.visible === 0 && stats.total > 0) {
          /*
           * Everything was filtered out. Without this the tree simply looks
           * empty and the ingest appears to have done nothing — the single
           * most confusing outcome the previous version could produce.
           */
          const top = [...stats.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
          const reason = top ? `${policy.REASON_LABEL[top[0]] || top[0]} (${top[1]})` : 'the current filters';
          panel.setStatusLine(`All ${util.formatCount(stats.total)} file(s) are excluded by ${reason}.`);
          ui.toast(
            `Read ${util.formatCount(added)} file(s), but every one is excluded — mostly ${reason}. ` +
              'Adjust the filters to include them.',
            'warn',
            { timeout: 12000, actions: [{ label: 'Open filters', onSelect: () => panel.toggleSettings(true) }] }
          );
        } else {
          ui.toast(
            `Added ${util.formatCount(added)} file(s) · ${util.formatCount(stats.visible)} included`,
            'success',
            { timeout: 2600 }
          );
        }

        if (result.skippedUnreadable) {
          ui.toast(
            `${result.skippedUnreadable} file(s) or folder(s) could not be read and were skipped.`,
            'warn',
            { timeout: 7000 }
          );
        }
      } catch (e) {
        if (util.isCancellation(e)) {
          panel.setStatusLine('Cancelled.');
          ui.toast('Ingest cancelled.', 'info', { timeout: 1800 });
        } else {
          env.log.error('ingest failed', e);
          panel.setStatusLine(`Could not read that selection: ${e?.message || e}`);
          ui.toast(`Could not read that selection: ${e?.message || e}`, 'error');
        }
      } finally {
        end();
      }
    }

    function ingestDrop(extracted) {
      if (!extracted.entries.length && !extracted.plainFiles.length) {
        ui.toast('That drop contained no files.', 'warn', { timeout: 2600 });
        panel.setStatusLine('That drop contained no files.');
        return;
      }
      return runIngest('Reading dropped items…', (signal, opts) =>
        ingest.fromDrop(extracted, {
          signal,
          onProgress: opts.onProgress,
          limit: store.get('maxTotalFiles'),
          existingPaths: new Set(workspace.state.byPath.keys())
        })
      );
    }

    /**
     * Opens a picker. Deliberately does *not* take the busy lock — see the
     * note on `ingest.openPicker`. The panel stays usable, the waiting state
     * is visible, and the ingest starts only once files actually arrive.
     */
    function openPickerFor(directory) {
      if (isBusy()) {
        ui.toast('Another operation is already running.', 'warn');
        return;
      }
      if (phase === PHASE.WAITING) {
        // A second click while the picker is already up: bring attention to it
        // rather than opening a second dialog.
        ui.toast('A file picker is already open.', 'info', { timeout: 2000 });
        return;
      }
      // A picker dismissed only *tentatively* still has live listeners; retire
      // it so a late selection from an abandoned dialog cannot ingest twice.
      if (pendingPicker) {
        pendingPicker.cancel();
        pendingPicker = null;
      }

      const label = directory ? 'Waiting for a folder…' : 'Waiting for files…';
      setPhase(PHASE.WAITING, label);
      panel.setStatusLine(`${label} Choose one in the browser dialog, or press Stop to cancel.`);

      pendingPicker = ingest.openPicker({
        directory,
        onFiles: raw => {
          pendingPicker = null;
          setPhase(PHASE.IDLE);
          if (!raw.length) {
            panel.setStatusLine('Nothing was selected.');
            ui.toast('Nothing was selected.', 'warn', { timeout: 3000 });
            return;
          }
          panel.setStatusLine(`Selected ${util.formatCount(raw.length)} file(s); reading…`);
          runIngest(
            directory ? 'Reading the selected folder…' : 'Reading the selected files…',
            (signal, opts) =>
              ingest.fromFileList(raw, {
                signal,
                onProgress: opts.onProgress,
                limit: store.get('maxTotalFiles'),
                existingPaths: new Set(workspace.state.byPath.keys())
              })
          );
        },
        onDismiss: ({ tentative }) => {
          if (phase !== PHASE.WAITING) return;
          if (tentative) {
            // The picker closed but a selection may still be on its way; stop
            // implying that we are waiting, without discarding the listener.
            setPhase(PHASE.IDLE);
            panel.setStatusLine('No folder was selected.');
            return;
          }
          pendingPicker = null;
          setPhase(PHASE.IDLE);
          panel.setStatusLine('Selection cancelled.');
        },
        onError: e => {
          pendingPicker = null;
          setPhase(PHASE.IDLE);
          env.log.error('picker failed', e);
          panel.setStatusLine(`The file picker could not be opened: ${e?.message || e}`);
          ui.toast(`The file picker could not be opened: ${e?.message || e}`, 'error');
        }
      });
    }

    const pickDirectory = () => openPickerFor(true);
    const pickFiles = () => openPickerFor(false);

    /* ------------------------------------------------------------ mutate */

    function removePath(path) {
      const removed = workspace.removePath(path);
      if (!removed) return;
      ui.toast(`Removed ${removed} file(s).`, 'info', {
        timeout: 5000,
        actions: [{ label: 'Undo', onSelect: () => workspace.undo() }]
      });
    }

    async function clearWorkspace() {
      if (!workspace.state.items.length) {
        ui.toast('Nothing to clear.', 'info', { timeout: 1500 });
        return;
      }
      const ok = await ui.confirmDestructive({
        title: 'Clear workspace',
        message: `Remove all ${workspace.state.items.length} ingested file(s)? This can be undone.`,
        confirmLabel: 'Clear'
      });
      if (!ok) return;
      workspace.clearAll();
      ui.toast('Workspace cleared.', 'info', {
        timeout: 6000,
        actions: [{ label: 'Undo', onSelect: () => workspace.undo() }]
      });
    }

    /* ----------------------------------------------------------- preview */

    function previewManifest() {
      const { text, binary } = workspace.payload();
      if (!text.length && !binary.length) {
        ui.toast('Select at least one file first.', 'error');
        return;
      }
      const body = util.el('pre', { cls: 'cu-code', txt: packer.previewManifest(text, binary) });
      ui.modal({
        title: 'Manifest preview',
        body: [
          util.el('p', {
            cls: 'hint',
            txt: 'This is the manifest that will lead the bundle. Chunk count is an estimate until the run happens.'
          }),
          body
        ],
        actions: [
          {
            label: 'Copy',
            onSelect: () => {
              env.writeClipboardText(body.textContent).then(ok =>
                ui.toast(ok ? 'Manifest copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error')
              );
              return false;
            }
          },
          { label: 'Close', variant: 'primary' }
        ]
      });
    }

    /* --------------------------------------------------------------- run */

    /**
     * @param {'upload'|'download'|'copy'} [mode]
     */
    async function run(mode) {
      const settings = store.all();
      const chosen = mode || settings.deliveryMode;

      const { text, binary } = workspace.payload();
      if (!text.length && !binary.length) {
        ui.toast('Select at least one file first.', 'error');
        return;
      }

      const signal = begin(PHASE.PACKING, 'Packing…');
      if (!signal) {
        ui.toast('Another operation is already running.', 'warn');
        return;
      }

      const started = Date.now();
      try {
        const { chunks, totals, warnings } = await packer.pack(text, binary, {
          signal,
          onProgress: p => {
            const frac = p.total ? p.done / p.total : 0;
            panel.setProgress(
              frac,
              p.path ? `Packing ${p.done}/${p.total} — ${util.truncateMiddle(p.path, 48)}` : 'Finalising…'
            );
          }
        });

        util.throwIfAborted(signal);

        const rawBinaries = binary.map(f => f.file);
        const bundle = [...chunks, ...rawBinaries];
        lastRun = { bundle, totals, at: Date.now() };

        for (const w of warnings.slice(0, 3)) ui.toast(w, 'warn', { timeout: 6000 });

        panel.setProgress(1, `Packed ${bundle.length} item(s) in ${util.formatDuration(Date.now() - started)}`);

        if (bundle.length > settings.maxChunks) {
          end();
          await handleOverLimit(bundle, settings);
          return;
        }

        end();
        await dispatch(chosen, bundle, totals);
      } catch (e) {
        end();
        if (util.isCancellation(e)) {
          ui.toast('Run cancelled.', 'info', { timeout: 1800 });
          panel.setStatusLine('Cancelled.');
        } else {
          env.log.error('run failed', e);
          ui.toast(`Run failed: ${e.message || e}`, 'error');
          panel.setStatusLine(`Failed: ${e.message || e}`);
        }
      }
    }

    /**
     * Non-blocking modal that offers three clear resolution options with exact
     * chunk counts.
     */
    function handleOverLimit(bundle, settings) {
      return new Promise(resolve => {
        ui.modal({
          title: 'More uploads than the configured limit',
          body: [
            util.el('p', {
              txt: `Packing produced ${bundle.length} items, above your limit of ${settings.maxChunks}.`
            }),
            util.el('p', {
              cls: 'hint',
              txt: 'Saving a combined file keeps everything in one document. Raising the limit lets the run proceed as-is. Deselecting files is usually the better answer for a very large project.'
            })
          ],
          onClose: () => resolve(),
          actions: [
            {
              label: 'Save combined file',
              variant: 'primary',
              onSelect: () => {
                dispatch('download', bundle, null, { forceCombine: true }).then(resolve);
              }
            },
            {
              label: `Raise limit to ${bundle.length}`,
              onSelect: () => {
                store.set({ maxChunks: bundle.length });
                ui.toast(`Upload limit raised to ${store.get('maxChunks')}.`, 'info');
                dispatch(settings.deliveryMode, bundle, null).then(resolve);
              }
            },
            { label: 'Cancel', onSelect: () => resolve() }
          ]
        });
      });
    }

    /* ---------------------------------------------------------- dispatch */

    async function dispatch(mode, bundle, totals, opts = {}) {
      const settings = store.all();
      const ownsPhase = phase === PHASE.IDLE;
      if (ownsPhase) {
        setPhase(
          PHASE.DELIVERING,
          mode === 'download' ? 'Saving…' : mode === 'copy' ? 'Preparing the clipboard…' : 'Attaching…'
        );
      }
      try {
        return await dispatchInner(mode, bundle, totals, opts, settings);
      } finally {
        if (ownsPhase) setPhase(PHASE.IDLE);
      }
    }

    async function dispatchInner(mode, bundle, totals, opts, settings) {

      if (mode === 'download') {
        const combine = opts.forceCombine ?? settings.combineOnDownload;
        const md = bundle.filter(f => f.name.endsWith('.md'));
        const others = bundle.filter(f => !f.name.endsWith('.md'));
        const files = combine && md.length > 1 ? [packer.combine(md), ...others] : bundle;

        const res = await deliver.toDisk(files.filter(Boolean));
        if (res.reason === 'cancelled') {
          ui.toast('Save cancelled.', 'info', { timeout: 1600 });
          return;
        }
        ui.toast(`Saved ${res.count} file(s).`, 'success');
        panel.setStatusLine(`Saved ${res.count} file(s).`);
        if (settings.closeOnDeliver) panel.close();
        return;
      }

      if (mode === 'copy') {
        if (bundle.length > 1) {
          openCopyList(bundle);
          return;
        }
        await copySingle(bundle[0]);
        return;
      }

      /* upload */

      /*
       * Step out of the top layer first. `showModal()` marks the whole
       * document inert; dropping top-layer status ensures the host composer
       * receives drag/file events in the expected active document environment.
       */
      const wasInTopLayer = panel.exitTopLayer();

      panel.setProgress(0, 'Attaching to the page…');
      const result = await deliver.toChat(bundle, {
        onProgress: f => panel.setProgress(f, 'Waiting for the page to accept the files…')
      });

      /* -------- the page took them, and we can see that it did -------- */
      if (result.verdict === 'confirmed' || result.verdict === 'accepted') {
        const how = result.verdict === 'confirmed'
          ? 'the attachment is visible on the page'
          : 'the page accepted them';
        const summary = `Attached ${bundle.length} item(s) — ${how}.`;

        ui.toast(summary, 'success');
        panel.setStatusLine(summary);
        env.log.info(summary, { via: result.via, signals: result.signals, totals });

        if (settings.closeOnDeliver) panel.close();
        else if (wasInTopLayer) panel.enterTopLayer();
        return;
      }

      /* -------- dispatched, but nothing observable happened ---------- */
      if (result.verdict === 'unconfirmed') {
        /*
         * The events were delivered and the assignment verified, but the page
         * showed no sign of taking the files: no attachment appeared, the
         * input was not consumed, and no request was made. Reporting this as
         * a successful upload is exactly the false positive this rewrite
         * exists to eliminate, so it is reported as unresolved and the user
         * is given the two routes that always work.
         */
        if (wasInTopLayer) panel.enterTopLayer();

        const message =
          `The files were handed to the page, but it showed no sign of accepting them. ` +
          `They may not have been attached.`;
        panel.setStatusLine(message);
        ui.toast(message, 'warn', {
          timeout: 0,
          actions: [
            { label: 'Copy instead', onSelect: () => dispatch('copy', bundle, totals) },
            { label: 'Save to disk', onSelect: () => dispatch('download', bundle, totals) },
            { label: 'Try again', onSelect: () => dispatch('upload', bundle, totals) }
          ]
        });
        return;
      }

      /* ---------------- it did not even get that far ----------------- */
      if (wasInTopLayer) panel.enterTopLayer();

      const why =
        result.reason === 'site-unsupported'
          ? result.note || 'This site does not accept programmatically attached files.'
          : result.reason === 'no-input'
            ? 'No usable file input was found on this page.'
            : 'The page rejected the attachment.';

      if (settings.autoRetryAsCopy) {
        ui.toast(`${why} Copying instead…`, 'warn', { timeout: 5000 });
        panel.setStatusLine(`${why} Copying instead.`);
        if (bundle.length > 1) openCopyList(bundle);
        else await copySingle(bundle[0]);
        return;
      }

      ui.toast(why, 'error', {
        timeout: 0,
        actions: [
          { label: 'Copy instead', onSelect: () => dispatch('copy', bundle, totals) },
          { label: 'Save to disk', onSelect: () => dispatch('download', bundle, totals) }
        ]
      });
      panel.setStatusLine(why);
    }

    async function copySingle(file) {
      if (!file) return;
      try {
        const kind = await deliver.copyFile(file);
        const what = kind === 'base64' ? 'image (as a data URL)' : file.name;
        ui.toast(`Copied ${what}.`, 'success');
        panel.setStatusLine(`Copied ${what}.`);
        if (store.get('closeOnDeliver')) panel.close();
      } catch (e) {
        env.log.warn('copy failed', e);
        ui.toast('The clipboard is unavailable — saving to disk instead.', 'warn');
        await deliver.toDisk([file]);
      }
    }

    /**
     * Multi-part copy dialog. Renders as a dedicated modal with keyboard navigation,
     * combined-copy option and per-part progress feedback.
     */
    function openCopyList(bundle) {
      const rows = bundle.map((file, index) => {
        const isChunk = /^codebase_(part_)?\d+\.md$/.test(file.name);
        const label = isChunk ? `Part ${file.name.match(/(\d+)/)?.[1] || index}` : file.name;

        const btn = ui.button('Copy', {
          icon: icons('copy', 12),
          onClick: async () => {
            btn.disabled = true;
            try {
              const kind = await deliver.copyFile(file);
              util.render(btn, [icons('check', 12), util.el('span', { txt: 'Copied' })]);
              btn.classList.add('copied');
              ui.toast(`Copied ${kind === 'base64' ? 'image data URL' : label}.`, 'success', { timeout: 1600 });
              setTimeout(() => {
                util.render(btn, [icons('copy', 12), util.el('span', { txt: 'Copy' })]);
                btn.classList.remove('copied');
                btn.disabled = false;
              }, 1800);
            } catch (e) {
              env.log.warn('chunk copy failed', e);
              ui.toast('Copy failed. Saving that part instead.', 'error');
              deliver.downloadOne(file);
              btn.disabled = false;
            }
          }
        });

        return util.el('div', { cls: 'cu-chunk-row' }, [
          util.el('div', { cls: 'cu-chunk-info' }, [
            util.el('span', { cls: 'cu-chunk-title', txt: label }),
            util.el('span', {
              cls: 'cu-chunk-stats',
              txt: `${util.formatSize(file.size)} · ~${util.formatCount(util.estimateTokens(file.size))} tokens`
            })
          ]),
          btn
        ]);
      });

      ui.modal({
        title: `Copy ${bundle.length} part(s)`,
        body: [
          util.el('p', {
            cls: 'hint',
            txt: 'Paste each part into the chat in order. The manifest comes first.'
          }),
          ...rows
        ],
        actions: [
          {
            label: 'Copy all as one',
            onSelect: () => {
              deliver
                .copyCombined(bundle)
                .then(() => ui.toast('All parts copied as one document.', 'success'))
                .catch(e => {
                  env.log.warn('combined copy failed', e);
                  ui.toast('Could not copy — saving instead.', 'error');
                  deliver.toDisk([packer.combine(bundle.filter(f => f.name.endsWith('.md')))].filter(Boolean));
                });
              return false;
            }
          },
          {
            label: 'Save all',
            onSelect: () => {
              deliver.toDisk(bundle).then(r =>
                ui.toast(`Saved ${r.count} file(s).`, 'success')
              );
              return false;
            }
          },
          { label: 'Done', variant: 'primary' }
        ]
      });
    }

    /* ------------------------------------------------------- diagnostics */

    /** A short, readable identity for an element, for the diagnostics report. */
    function describeElement(el) {
      if (!el) return 'none';
      const bits = [el.tagName.toLowerCase()];
      if (el.id) bits.push(`#${el.id}`);
      const testid = el.getAttribute('data-testid');
      if (testid) bits.push(`[data-testid="${testid}"]`);
      const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      for (const c of cls) bits.push(`.${c}`);
      if (el.multiple) bits.push('[multiple]');
      if (el.getRootNode() !== document) bits.push('(in shadow root)');
      return bits.join('');
    }

    function collectDiagnostics() {
      const s = store.all();
      const stats = workspace.stats();
      const profile = data.siteProfile();
      // Probe with a representative payload so the report reflects what an
      // actual upload would resolve to, `accept` filtering included.
      const probeFiles = [new File([''], 'codebase_manifest.md', { type: 'text/markdown' })];
      const input = deliver.findFileInput(probeFiles);

      return {
        app: { name: env.APP_NAME, version: env.APP_VERSION, schema: store.SCHEMA_VERSION },
        manager: { name: env.capabilities.manager, version: env.capabilities.managerVersion },
        capabilities: Object.fromEntries(
          Object.entries(env.capabilities).filter(([, v]) => typeof v === 'boolean')
        ),
        site: {
          host: location.hostname,
          profile: profile.id,
          label: profile.label,
          chatInjection: profile.chatInjection !== false,
          fileInputFound: !!input,
          fileInputSelector: input ? describeElement(input) : null,
          fileInputAccept: input ? input.getAttribute('accept') : null,
          fileInputMultiple: input ? !!input.multiple : null,
          shadowRoots: deliver.collectRoots().length - 1,
          ladder: deliver.UNIVERSAL_LADDER.length
        },
        workspace: {
          total: stats.total,
          visible: stats.visible,
          excluded: stats.excluded,
          selected: stats.selected,
          selectedBytes: stats.selectedBytes,
          estUploads: stats.estUploads,
          estTokens: stats.estTokens,
          root: workspace.state.root,
          gitignoreFiles: workspace.state.gitignores.size,
          gitignoreRules: workspace.compiledPolicy().gitignoreRuleCount,
          exclusionReasons: Object.fromEntries(stats.reasons)
        },
        storage: { readOnly: store.isReadOnly(), repairs: store.repairs().map(r => r.key) },
        settings: s,
        lastRun: lastRun
          ? { at: util.formatDateTime(lastRun.at), items: lastRun.bundle.length, totals: lastRun.totals }
          : null,
        log: env.log.entries().slice(-60)
      };
    }

    function showDiagnostics() {
      const report = collectDiagnostics();
      const text = JSON.stringify(report, null, 2);

      const row = (k, v) =>
        util.el('div', { style: { display: 'flex', gap: '8px', padding: '2px 0' } }, [
          util.el('span', { style: { 'min-width': '148px', color: 'var(--text-tertiary)' }, txt: k }),
          util.el('span', { style: { 'word-break': 'break-all' }, txt: String(v) })
        ]);

      ui.modal({
        title: 'Diagnostics',
        body: [
          row('Script', `${report.app.name} ${report.app.version} (schema ${report.app.schema})`),
          row('Manager', `${report.manager.name} ${report.manager.version}`.trim()),
          row('Site profile', `${report.site.label} (${report.site.profile})`),
          row('File input', report.site.fileInputFound ? report.site.fileInputSelector : 'not found'),
          row('Input accept', report.site.fileInputAccept || '(any)'),
          row('Open shadow roots', report.site.shadowRoots),
          row('Chat attachment', report.site.chatInjection ? 'supported' : 'not supported on this site'),
          row(
            'Capabilities',
            Object.entries(report.capabilities)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(', ') || 'none'
          ),
          row('Files', `${report.workspace.selected} selected of ${report.workspace.visible} visible`),
          row('.gitignore', `${report.workspace.gitignoreFiles} file(s), ${report.workspace.gitignoreRules} rule(s)`),
          row('Storage', report.storage.readOnly ? 'read-only' : 'writable'),
          util.el('div', { cls: 'cu-section-title', style: { 'margin-top': '10px' }, txt: 'RECENT LOG' }),
          util.el('pre', {
            cls: 'cu-code',
            txt:
              report.log
                .map(e => `${new Date(e.t).toISOString().slice(11, 23)} ${e.level.padEnd(5)} ${e.text}`)
                .join('\n') || 'Nothing logged yet.'
          })
        ],
        actions: [
          {
            label: 'Copy report',
            variant: 'primary',
            onSelect: () => {
              env.writeClipboardText(text).then(ok =>
                ui.toast(ok ? 'Diagnostics copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error')
              );
              return false;
            }
          },
          { label: 'Close' }
        ]
      });
    }

    /* ------------------------------------------------------------ session */

    /** Persists the current curation so the next ingest of this root recalls it. */
    const rememberSelection = util.debounce(() => {
      const root = workspace.state.root;
      if (!root || !store.get('rememberSelection')) return;
      store.rememberDeselected(root, workspace.deselectedPaths());
    }, 1200);

    return {
      PHASE,
      isBusy,
      isWaiting,
      phase: getPhase,
      cancel,
      ingestDrop: guard('Ingest', ingestDrop),
      pickDirectory: guard('Folder selection', pickDirectory),
      pickFiles: guard('File selection', pickFiles),
      removePath: guard('Remove', removePath),
      clearWorkspace: guard('Clear', clearWorkspace),
      previewManifest: guard('Preview', previewManifest),
      run: guard('Run', run),
      showDiagnostics: guard('Diagnostics', showDiagnostics),
      collectDiagnostics,
      rememberSelection
    };
  })();

  /* =======================================================================
   * SECTION 16 — Application lifecycle
   * -----------------------------------------------------------------------
   * Boot, hotkeys, manager menu, and teardown.
   *
   * Key lifecycle considerations addressed here:
   *
   *  1. UI creation avoids uncoordinated `document-start` mutation races,
   *     preventing redundant observer accumulation across SPA view switches.
   *  2. The keydown listener was attached at module scope on `window` with no
   *     capture and no way to remove it, and it read `settings.shortcutKey`
   *     directly, so it kept firing after any teardown.
   *  3. `Alt+Shift+<key>` was matched with `e.key.toLowerCase()`. On many
   *     layouts Alt produces a different character (Alt+Shift+U is `Ÿ` on
   *     macOS US), so the configured hotkey silently stopped working. The
   *     match now uses `event.code`, which is layout-independent, with
   *     `event.key` as a secondary route.
   *  4. Nothing was idempotent: a second injection of the script (a manager
   *     quirk, or the script installed twice) produced two panels.
   * ==================================================================== */

  const app = (() => {
    const GUARD = '__codebaseUploaderBooted';
    const disposables = new env.Disposables('app');
    let booted = false;

    /* -------------------------------------------------------- guard */

    function alreadyRunning() {
      try {
        if (window[GUARD]) return true;
        Object.defineProperty(window, GUARD, {
          value: env.APP_VERSION,
          configurable: true,
          enumerable: false,
          writable: false
        });
        return false;
      } catch {
        // A sandbox that forbids the write cannot be double-injected in the
        // way this guard protects against.
        return false;
      }
    }

    /* ------------------------------------------------------- hotkeys */

    /**
     * True when the event should not be treated as a shortcut because the
     * user is typing. The composed path is checked so editors that live in a
     * shadow root — which several of these chat sites use — are recognised.
     */
    function isTypingTarget(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const node of path) {
        if (!node || node.nodeType !== 1) continue;
        const tag = node.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (node.isContentEditable) return true;
        const role = node.getAttribute?.('role');
        if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
      }
      return false;
    }

    /**
     * Layout-independent match for `Alt+Shift+<letter>`. `event.code` is the
     * physical key, so the shortcut works on Dvorak, AZERTY and non-Latin
     * layouts where `event.key` under Alt is some other glyph entirely.
     */
    function matchesHotkey(event, letter) {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return false;
      const want = String(letter || 'u').toLowerCase();
      const code = String(event.code || '').toLowerCase();
      if (code === `key${want}` || code === `digit${want}`) return true;
      const key = String(event.key || '').toLowerCase();
      return key === want;
    }

    function onKeyDown(event) {
      if (event.defaultPrevented || event.repeat) return;

      const insidePanel = panel.isOpen();

      /* toggle — allowed even while typing, because it also closes */
      if (matchesHotkey(event, store.get('shortcutKey'))) {
        event.preventDefault();
        event.stopPropagation();
        panel.toggle();
        return;
      }

      if (!insidePanel) return;

      /* panel-scoped shortcuts, suppressed while typing */
      if (isTypingTarget(event)) return;

      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        ui.$('cu-search')?.focus();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (workspace.undo()) ui.toast('Reverted.', 'info', { timeout: 1400 });
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        controller.run();
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        workspace.applyPreset(policy.PRESET.ALL);
        return;
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        controller.pickDirectory();
        return;
      }
      if (mod && event.key.toLowerCase() === ',') {
        event.preventDefault();
        panel.toggleSettings();
      }
    }

    /* ---------------------------------------------------- manager menu */

    let menuSignature = '';

    function syncMenu() {
      if (!env.capabilities.menuCommands) return;
      const key = (store.get('shortcutKey') || 'u').toUpperCase();
      const accel = `${env.capabilities.isMac ? '⌥⇧' : 'Alt+Shift+'}${key}`;

      // Only the shortcut letter appears in a caption, so nothing else needs a
      // re-registration. Some managers duplicate commands when re-registered,
      // and doing it on every settings change (theme, density, a checkbox)
      // churned four entries each time.
      if (menuSignature === accel) return;
      menuSignature = accel;

      env.menu.register('toggle', `Toggle Codebase Uploader (${accel})`, () => panel.toggle(), {
        accessKey: 'u'
      });
      env.menu.register('pick', 'Select a directory…', () => {
        panel.open();
        controller.pickDirectory();
      });
      env.menu.register('settings', 'Settings', () => {
        panel.open();
        panel.toggleSettings(true);
      });
      env.menu.register('diagnostics', 'Diagnostics', () => {
        panel.open();
        controller.showDiagnostics();
      });
    }

    /* ------------------------------------------------------------- boot */

    async function boot() {
      if (booted) return;
      booted = true;

      if (alreadyRunning()) {
        env.log.warn('another copy of Codebase Uploader is already running on this page; aborting');
        return;
      }

      await store.load();
      env.log.setDebug(store.get('debug'));
      env.log.debug(
        `booting on ${location.hostname} · manager=${env.capabilities.manager} · ` +
          `shared storage=${env.capabilities.gmStorage ? 'yes' : 'no'}`
      );

      // The script runs at document-start, so `documentElement` may be the
      // only node that exists yet. That is enough to mount the host; nothing
      // is rendered into the page itself.
      if (!document.documentElement) {
        await new Promise(resolve => {
          const observer = new MutationObserver(() => {
            if (document.documentElement) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document, { childList: true, subtree: true });
          disposables.observer(observer);
        });
      }

      ui.mount();
      ui.guardAttachment();
      panel.build();
      syncMenu();

      // The hotkey listener is registered once, on the capture phase so a page
      // that stops propagation on keydown (common in chat composers) cannot
      // make the panel unreachable.
      disposables.listen(window, 'keydown', onKeyDown, { capture: true });

      // Settings changes that affect chrome outside the panel.
      let warnedReadOnly = false;
      disposables.add(
        store.subscribe((_, detail) => {
          if (detail?.type === 'readonly' && !warnedReadOnly) {
            // A background write failed. Say so once, rather than letting the
            // user discover on the next page load that nothing was saved.
            warnedReadOnly = true;
            ui.toast(
              'Settings could not be saved — this browser is blocking storage for this site. ' +
                'They will apply until the page is closed.',
              'warn',
              { timeout: 10000 }
            );
          }
          ui.applyAppearance();
          panel.updateShortcutHint();
          syncMenu();
        })
      );

      // Persist the user's curation shortly after they stop changing it.
      disposables.add(
        workspace.subscribe(detail => {
          if (detail.type === 'selection' || detail.type === 'ingest') controller.rememberSelection();
        })
      );

      // Never lose a pending write, and never leak an object URL.
      const flush = () => {
        store.flush();
        controller.rememberSelection.flush?.();
      };
      disposables.listen(window, 'pagehide', () => {
        flush();
        deliver.revokeAll();
      }, { capture: true });
      disposables.listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });

      env.log.debug('boot complete');
    }

    function dispose() {
      store.flush();
      store.dispose();
      disposables.dispose();
      env.menu.clear();
      panel.dispose();
      deliver.dispose();
      ui.dispose();
      workspace.reset();
      try {
        delete window[GUARD];
      } catch {
        /* the guard is not configurable here */
      }
      booted = false;
    }

    return { boot, dispose, matchesHotkey, isTypingTarget, _onKeyDown: onKeyDown };
  })();

  /* =======================================================================
   * SECTION 17 — Runtime entry
   * -----------------------------------------------------------------------
   * The only statement in this file that runs on its own. Everything above is
   * declarations.
   *
   * The test harness sets `__CODEBASE_UPLOADER_TEST__` before evaluating the
   * bundle, which suppresses auto-boot and exports the internals so each
   * module can be exercised in isolation.
   * ==================================================================== */

  if (typeof globalThis !== 'undefined' && globalThis.__CODEBASE_UPLOADER_TEST__) {
    globalThis.__CODEBASE_UPLOADER__ = {
      env,
      util,
      data,
      store,
      match,
      policy,
      ingest,
      workspace,
      packer,
      deliver,
      STYLESHEET,
      icons,
      ui,
      panel,
      settingsUi,
      controller,
      app
    };
  } else {
    app.boot().catch(err => {
      // A boot failure must never leave a half-initialised script behind, and
      // must never be silent.
      // eslint-disable-next-line no-console
      console.error('[Codebase Uploader] failed to start', err);
      try {
        app.dispose();
      } catch {
        /* nothing further can be done */
      }
    });
  }
})();
