// SPDX-License-Identifier: MIT
// ==UserScript==
// @name         Clip LeetCode
// @namespace    https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/clip-leetcode
// @version      3.0.0
// @description  Copy any LeetCode problem to your clipboard as Markdown, plain text, HTML, JSON or your own template. SPA-aware buttons, hotkeys, auto-copy, clip history and a full settings panel.
// @author       Shivansh Jain
// @license      MIT
// @homepageURL  https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/clip-leetcode
// @supportURL   https://github.com/shivanshjain456/browser-workflow-tools/issues
// @downloadURL  https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/clip-leetcode/clip-leetcode.user.js
// @updateURL    https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/clip-leetcode/clip-leetcode.user.js
// @icon         https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-32.png
// @icon64       https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-64.png
// @match        *://*.leetcode.com/problems/*
// @match        *://*.leetcode.com/contest/*
// @match        *://*.leetcode.com/problemset*
// @match        *://*.leetcode.com/study-plan/*
// @match        *://*.leetcode.com/explore/*
// @match        *://*.leetcode.cn/problems/*
// @match        *://*.leetcode.cn/contest/*
// @match        *://*.leetcode.cn/problemset*
// @match        *://*.leetcode.cn/study-plan/*
// @run-at       document-start
// @noframes
// @compatible   chrome  Tampermonkey, Violentmonkey
// @compatible   firefox Tampermonkey, Violentmonkey, Greasemonkey 4+
// @compatible   edge    Tampermonkey, Violentmonkey
// @compatible   opera   Tampermonkey, Violentmonkey
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// ==/UserScript==

/*
 * Clip LeetCode
 *
 * Places "Copy" / "Copy Markdown" buttons next to a LeetCode problem title and puts the problem on the
 * clipboard, complete with an HTML->Markdown engine, extra formats, persistence,
 * hotkeys, automation, history and a settings UI.
 *
 * Notes on scope of @match: only problem pages and contest problem pages carry UI. The extra
 * routes are matched because LeetCode is a client-routed SPA and userscript managers do not
 * re-inject on history navigation; the script stays completely dormant (no observers, no DOM,
 * no storage writes) until the URL resolves to a problem route.
 *
 * No unsafeWindow, no eval, no innerHTML with page/network-derived data, no remote code.
 */

(function () {
  'use strict';

  /* ======================================================================== *
   * 0. Guards, constants
   * ======================================================================== */

  // Some managers can inject twice (e.g. duplicate @match, bfcache + soft nav quirks).
  const INSTANCE_KEY = '__clipLeetCodeUserscript__';
  const SCRIPT_VERSION = '3.0.0';
  try {
    if (window[INSTANCE_KEY]) return;
    Object.defineProperty(window, INSTANCE_KEY, {
      value: SCRIPT_VERSION,
      configurable: true,
      enumerable: false,
      writable: false
    });
  } catch (_) {
    if (window[INSTANCE_KEY]) return;
    window[INSTANCE_KEY] = SCRIPT_VERSION;
  }

  const STORE_KEYS = {
    settings: 'clip-leetcode.settings.v3',
    history: 'clip-leetcode.history.v1',
    meta: 'clip-leetcode.meta-cache.v1'
  };

  // Default visual and behavioural styling constants.
  const LEGACY = {
    MAIN_COLOR: '#0CB345',
    TEXT_COLOR: '#ffffff',
    BUTTON_ACTION_TEXT: 'Copied!',
    BUTTON_ACTION_WAIT_TIME: 1000
  };

  const LIMITS = {
    mountTimeoutMs: 20000,      // give up waiting for a title node after this long
    mountRetryBaseMs: 250,
    mountRetryMaxMs: 4000,
    observerDebounceMs: 120,
    historyMaxEntries: 60,
    historyMaxBytes: 512 * 1024,
    historyPreviewChars: 220,
    historyBodyChars: 20000,
    metaCacheTtlMs: 6 * 60 * 60 * 1000,
    metaCacheMaxEntries: 120,
    networkTimeoutMs: 12000,
    maxClipChars: 4 * 1024 * 1024
  };

  /* ======================================================================== *
   * 1. Userscript-manager compatibility layer
   *
   * Every privileged call is funnelled through here so that a missing / broken GM API
   * degrades to a documented fallback instead of taking the whole script down.
   * ======================================================================== */

  const GMBridge = (() => {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    const legacy = {
      get: typeof g.GM_getValue === 'function' ? g.GM_getValue : null,
      set: typeof g.GM_setValue === 'function' ? g.GM_setValue : null,
      del: typeof g.GM_deleteValue === 'function' ? g.GM_deleteValue : null,
      clip: typeof g.GM_setClipboard === 'function' ? g.GM_setClipboard : null,
      menu: typeof g.GM_registerMenuCommand === 'function' ? g.GM_registerMenuCommand : null,
      unmenu: typeof g.GM_unregisterMenuCommand === 'function' ? g.GM_unregisterMenuCommand : null,
      onChange: typeof g.GM_addValueChangeListener === 'function' ? g.GM_addValueChangeListener : null,
      offChange: typeof g.GM_removeValueChangeListener === 'function' ? g.GM_removeValueChangeListener : null
    };
    const modern = (typeof g.GM === 'object' && g.GM) || null;

    // Last-resort persistence: localStorage, then a process-lifetime map.
    const memory = new Map();
    const localAvailable = (() => {
      try {
        const probe = '__clip_leetcode_probe__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return true;
      } catch (_) {
        return false;
      }
    })();

    const storageKind = legacy.get || (modern && modern.getValue)
      ? 'gm'
      : (localAvailable ? 'localStorage' : 'memory');

    async function getValue(key, fallback) {
      try {
        if (legacy.get) return await legacy.get(key, fallback);
        if (modern && modern.getValue) return await modern.getValue(key, fallback);
        if (localAvailable) {
          const raw = window.localStorage.getItem(key);
          return raw === null ? fallback : raw;
        }
        return memory.has(key) ? memory.get(key) : fallback;
      } catch (err) {
        Log.warn('storage read failed', key, err);
        return fallback;
      }
    }

    async function setValue(key, value) {
      try {
        if (legacy.set) return await legacy.set(key, value);
        if (modern && modern.setValue) return await modern.setValue(key, value);
        if (localAvailable) return window.localStorage.setItem(key, String(value));
        memory.set(key, value);
      } catch (err) {
        Log.warn('storage write failed', key, err);
        // Keep the session usable even if the quota is exhausted.
        memory.set(key, value);
      }
    }

    async function deleteValue(key) {
      try {
        if (legacy.del) return await legacy.del(key);
        if (modern && modern.deleteValue) return await modern.deleteValue(key);
        if (localAvailable) return window.localStorage.removeItem(key);
        memory.delete(key);
      } catch (err) {
        Log.warn('storage delete failed', key, err);
      }
    }

    function setClipboard(text) {
      try {
        if (legacy.clip) { legacy.clip(text, 'text'); return true; }
        if (modern && modern.setClipboard) { modern.setClipboard(text, 'text'); return true; }
      } catch (err) {
        Log.warn('GM_setClipboard failed', err);
      }
      return false;
    }

    function registerMenu(label, fn, accessKey) {
      try {
        if (legacy.menu) return legacy.menu(label, fn, accessKey);
        if (modern && modern.registerMenuCommand) return modern.registerMenuCommand(label, fn, accessKey);
      } catch (err) {
        Log.warn('menu registration failed', err);
      }
      return null;
    }

    function unregisterMenu(id) {
      if (id === null || id === undefined) return;
      try {
        if (legacy.unmenu) return legacy.unmenu(id);
        if (modern && modern.unregisterMenuCommand) return modern.unregisterMenuCommand(id);
      } catch (_) { /* manager without unregister support: menu entries simply persist */ }
    }

    function addChangeListener(key, fn) {
      try {
        if (legacy.onChange) return legacy.onChange(key, fn);
      } catch (err) {
        Log.warn('value-change listener unsupported', err);
      }
      return null;
    }

    function removeChangeListener(id) {
      if (id === null || id === undefined) return;
      try {
        if (legacy.offChange) legacy.offChange(id);
      } catch (_) { /* noop */ }
    }

    const info = (() => {
      try {
        if (typeof g.GM_info === 'object' && g.GM_info) return g.GM_info;
        if (modern && modern.info) return modern.info;
      } catch (_) { /* noop */ }
      return null;
    })();

    return {
      getValue,
      setValue,
      deleteValue,
      setClipboard,
      registerMenu,
      unregisterMenu,
      addChangeListener,
      removeChangeListener,
      storageKind,
      canWatchValues: Boolean(legacy.onChange),
      canUnregisterMenu: Boolean(legacy.unmenu || (modern && modern.unregisterMenuCommand)),
      managerName: (info && info.scriptHandler) || 'unknown',
      managerVersion: (info && info.version) || ''
    };
  })();

  /* ======================================================================== *
   * 2. Logging (level-gated; silent by default)
   * ======================================================================== */

  const Log = (() => {
    const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
    let level = LEVELS.warn;
    const prefix = '[Clip LeetCode]';

    function emit(kind, min, args) {
      if (level < min) return;
      const fn = console[kind] || console.log;
      try { fn.call(console, prefix, ...args); } catch (_) { /* noop */ }
    }
    return {
      setLevel(name) { level = Object.prototype.hasOwnProperty.call(LEVELS, name) ? LEVELS[name] : LEVELS.warn; },
      getLevel() { return Object.keys(LEVELS).find((k) => LEVELS[k] === level) || 'warn'; },
      error: (...a) => emit('error', LEVELS.error, a),
      warn: (...a) => emit('warn', LEVELS.warn, a),
      info: (...a) => emit('info', LEVELS.info, a),
      debug: (...a) => emit('debug', LEVELS.debug, a)
    };
  })();

  /* ======================================================================== *
   * 3. Generic utilities
   * ======================================================================== */

  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function safe(fn, fallback, label) {
    try {
      return fn();
    } catch (err) {
      Log.warn(label || 'operation failed', err);
      return fallback;
    }
  }

  function debounce(fn, wait) {
    let timer = null;
    const wrapped = (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn(...args); }, wait);
    };
    wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    wrapped.flush = (...args) => { if (timer) { clearTimeout(timer); timer = null; fn(...args); } };
    return wrapped;
  }

  function deepClone(value) {
    if (!isObject(value) && !Array.isArray(value)) return value;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (!isObject(a) && !Array.isArray(a)) return false;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDate(d, withTime) {
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
  }

  function relativeTime(ts) {
    const delta = Date.now() - ts;
    if (!Number.isFinite(delta) || delta < 0) return 'just now';
    const units = [
      [86400000, 'd'], [3600000, 'h'], [60000, 'm'], [1000, 's']
    ];
    for (const [ms, label] of units) {
      if (delta >= ms) return `${Math.floor(delta / ms)}${label} ago`;
    }
    return 'just now';
  }

  /**
   * Disposable registry: every listener, observer and timer created by a subsystem is
   * registered here so teardown (route change, disable, re-init) is total and leak-free.
   */
  class Disposer {
    constructor(name) {
      this.name = name || 'disposer';
      this._items = new Set();
      this._disposed = false;
    }
    add(fn) {
      if (typeof fn !== 'function') return () => {};
      if (this._disposed) { safe(fn, undefined, 'late dispose'); return () => {}; }
      this._items.add(fn);
      return () => { this._items.delete(fn); safe(fn, undefined, 'dispose'); };
    }
    listen(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      target.addEventListener(type, handler, options);
      return this.add(() => target.removeEventListener(type, handler, options));
    }
    observe(observer) {
      return this.add(() => observer.disconnect());
    }
    timeout(fn, ms) {
      const id = setTimeout(() => { this._items.delete(cancel); fn(); }, ms);
      const cancel = () => clearTimeout(id);
      this._items.add(cancel);
      return cancel;
    }
    get size() { return this._items.size; }
    dispose() {
      const items = Array.from(this._items);
      this._items.clear();
      for (const fn of items) safe(fn, undefined, `${this.name} dispose`);
    }
  }

  /** Minimal typed event bus (no wildcard, no bubbling — just enough for module decoupling). */
  class Emitter {
    constructor() { this._map = new Map(); }
    on(type, fn) {
      if (!this._map.has(type)) this._map.set(type, new Set());
      this._map.get(type).add(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) {
      const set = this._map.get(type);
      if (set) { set.delete(fn); if (!set.size) this._map.delete(type); }
    }
    emit(type, payload) {
      const set = this._map.get(type);
      if (!set) return;
      for (const fn of Array.from(set)) safe(() => fn(payload), undefined, `emitter:${type}`);
    }
    clear() { this._map.clear(); }
  }

  /** DOM builder — textContent only, never innerHTML, so page/network data can never inject markup. */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = String(value);
        else if (key === 'style' && isObject(value)) Object.assign(node.style, value);
        else if (key === 'dataset' && isObject(value)) Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
      }
    }
    if (children) {
      for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' || typeof child === 'number'
          ? document.createTextNode(String(child))
          : child);
      }
    }
    return node;
  }

  /** First matching element across an ordered candidate list, scoped and null-safe. */
  function queryFirst(selectors, root) {
    const scope = root || document;
    for (const selector of selectors) {
      const found = safe(() => scope.querySelector(selector), null, `bad selector: ${selector}`);
      if (found) return found;
    }
    return null;
  }

  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    if (typeof node.getClientRects !== 'function') return true;
    if (node.getClientRects().length > 0) return true;
    // Elements inside a collapsed accordion still count as present for extraction purposes.
    return Boolean(node.offsetParent) || node.getBoundingClientRect().height > 0;
  }

  function documentReady() {
    if (document.readyState === 'interactive' || document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }

  /* ======================================================================== *
   * 4. Settings: defaults, schema, validation, persistence
   *
   * Defaults configure two buttons labelled "Copy" and
   * "Copy Markdown", #0CB345 outline styling, "Copied!" for 1000 ms, and clean
   * plain-text / Markdown output templates.
   * ======================================================================== */

  const FORMAT_IDS = ['text', 'markdown', 'html', 'json', 'custom'];

  const FORMAT_META = {
    text:     { name: 'Plain text',  ext: 'txt',  mime: 'text/plain' },
    markdown: { name: 'Markdown',    ext: 'md',   mime: 'text/markdown' },
    html:     { name: 'HTML',        ext: 'html', mime: 'text/html' },
    json:     { name: 'JSON',        ext: 'json', mime: 'application/json' },
    custom:   { name: 'Custom',      ext: 'md',   mime: 'text/markdown' }
  };

  const DEFAULT_TEMPLATES = {
    // Byte-identical to the v2.0.5 output shape.
    text: 'URL: {{url}}\n\n{{title}}\n\n{{body}}',
    markdown: '# [{{title}}]({{url}})\n\n{{body}}',
    custom: [
      '# {{title}}',
      '',
      '- **Link:** {{url}}',
      '- **Difficulty:** {{difficulty}}',
      '- **Tags:** {{tags}}',
      '- **Clipped:** {{datetime}}',
      '',
      '## Problem',
      '',
      '{{body}}',
      '',
      '## Approach',
      '',
      '',
      '## Solution',
      '',
      '```{{snippetLang}}',
      '{{snippet}}',
      '```',
      ''
    ].join('\n')
  };

  const DEFAULTS = Object.freeze({
    schemaVersion: 3,
    enabled: true,
    logLevel: 'warn',

    ui: {
      showButtons: true,
      buttonTheme: 'classic',        // classic | native | minimal
      accentColor: LEGACY.MAIN_COLOR,
      textColor: LEGACY.TEXT_COLOR,
      copiedLabel: LEGACY.BUTTON_ACTION_TEXT,
      copiedLabelMs: LEGACY.BUTTON_ACTION_WAIT_TIME,
      gapPx: 8,
      fontSizePx: 10,
      showSettingsButton: true,
      showFormatMenu: true,
      notifications: 'errors',       // all | errors | none
      toastPosition: 'bottom-right', // bottom-right | bottom-left | top-right | top-left
      toastMs: 2600,
      respectReducedMotion: true
    },

    formats: {
      text:     { enabled: true,  button: true,  label: 'Copy',          hotkey: 'Alt+Shift+C' },
      markdown: { enabled: true,  button: true,  label: 'Copy Markdown', hotkey: 'Alt+Shift+M' },
      html:     { enabled: true,  button: false, label: 'Copy HTML',     hotkey: '' },
      json:     { enabled: true,  button: false, label: 'Copy JSON',     hotkey: 'Alt+Shift+J' },
      custom:   { enabled: true,  button: false, label: 'Copy Note',     hotkey: 'Alt+Shift+N' }
    },

    content: {
      titleMode: 'as-shown',         // as-shown | with-id | strip-id
      textEngine: 'textContent',     // textContent | innerText | markdown
      excludeCollapsedSections: false,
      includeHints: false,
      includeSimilar: false,
      includeSnippet: false,
      snippetLanguage: 'python3',
      maxBlankLines: 1,
      nbspToSpace: true,
      trimTrailingSpaces: true,
      fetchMetadata: true            // same-origin GraphQL enrichment (difficulty, tags, snippets)
    },

    markdown: {
      engine: 'dom',                 // dom | legacy  (legacy = regex pipeline)
      inlineCode: 'backtick',        // backtick | html | plain
      codeFenceLang: '',
      listBullet: '-',
      underline: 'plain',            // plain | html | italic
      superscript: 'caret',          // caret | html | plain
      convertTables: true,
      images: 'markdown',            // markdown | alt | skip
      absolutizeLinks: true,
      escapeSpecials: false,
      preAsFence: true
    },

    templates: deepClone(DEFAULT_TEMPLATES),

    automation: {
      autoCopyOnOpen: false,
      autoCopyFormat: 'markdown',
      autoCopyDelayMs: 800,
      autoCopyOncePerProblem: true,
      copyOnSelectionOnly: false     // when text is selected, clip the selection instead
    },

    shortcuts: {
      enabled: true,
      allowInEditor: false,
      openSettings: 'Alt+Shift+P',
      openHistory: 'Alt+Shift+H',
      cycleFormat: '',
      lastFormat: 'Alt+Shift+V'
    },

    history: {
      enabled: true,
      maxEntries: 25,
      storeBody: true
    },

    advanced: {
      mountTimeoutMs: LIMITS.mountTimeoutMs,
      observerScope: 'auto',         // auto | body
      downloadEnabled: true,
      richHtmlClipboard: false,      // also place text/html on the clipboard when available
      syncAcrossTabs: true
    }
  });

  /** Declarative schema used to coerce untrusted (possibly hand-edited / corrupted) stored data. */
  const SCHEMA = {
    schemaVersion: { type: 'int', min: 1, max: 999 },
    enabled: { type: 'bool' },
    logLevel: { type: 'enum', values: ['silent', 'error', 'warn', 'info', 'debug'] },
    ui: {
      type: 'shape',
      shape: {
        showButtons: { type: 'bool' },
        buttonTheme: { type: 'enum', values: ['classic', 'native', 'minimal'] },
        accentColor: { type: 'color' },
        textColor: { type: 'color' },
        copiedLabel: { type: 'str', max: 40 },
        copiedLabelMs: { type: 'int', min: 200, max: 10000 },
        gapPx: { type: 'int', min: 0, max: 64 },
        fontSizePx: { type: 'int', min: 8, max: 20 },
        showSettingsButton: { type: 'bool' },
        showFormatMenu: { type: 'bool' },
        notifications: { type: 'enum', values: ['all', 'errors', 'none'] },
        toastPosition: { type: 'enum', values: ['bottom-right', 'bottom-left', 'top-right', 'top-left'] },
        toastMs: { type: 'int', min: 800, max: 15000 },
        respectReducedMotion: { type: 'bool' }
      }
    },
    formats: {
      type: 'record',
      keys: FORMAT_IDS,
      value: {
        type: 'shape',
        shape: {
          enabled: { type: 'bool' },
          button: { type: 'bool' },
          label: { type: 'str', max: 32 },
          hotkey: { type: 'hotkey' }
        }
      }
    },
    content: {
      type: 'shape',
      shape: {
        titleMode: { type: 'enum', values: ['as-shown', 'with-id', 'strip-id'] },
        textEngine: { type: 'enum', values: ['textContent', 'innerText', 'markdown'] },
        excludeCollapsedSections: { type: 'bool' },
        includeHints: { type: 'bool' },
        includeSimilar: { type: 'bool' },
        includeSnippet: { type: 'bool' },
        snippetLanguage: { type: 'str', max: 24 },
        maxBlankLines: { type: 'int', min: 0, max: 5 },
        nbspToSpace: { type: 'bool' },
        trimTrailingSpaces: { type: 'bool' },
        fetchMetadata: { type: 'bool' }
      }
    },
    markdown: {
      type: 'shape',
      shape: {
        engine: { type: 'enum', values: ['dom', 'legacy'] },
        inlineCode: { type: 'enum', values: ['backtick', 'html', 'plain'] },
        codeFenceLang: { type: 'str', max: 24 },
        listBullet: { type: 'enum', values: ['-', '*', '+'] },
        underline: { type: 'enum', values: ['plain', 'html', 'italic'] },
        superscript: { type: 'enum', values: ['caret', 'html', 'plain'] },
        convertTables: { type: 'bool' },
        images: { type: 'enum', values: ['markdown', 'alt', 'skip'] },
        absolutizeLinks: { type: 'bool' },
        escapeSpecials: { type: 'bool' },
        preAsFence: { type: 'bool' }
      }
    },
    templates: {
      type: 'record',
      keys: ['text', 'markdown', 'custom'],
      value: { type: 'str', max: 8000 }
    },
    automation: {
      type: 'shape',
      shape: {
        autoCopyOnOpen: { type: 'bool' },
        autoCopyFormat: { type: 'enum', values: FORMAT_IDS },
        autoCopyDelayMs: { type: 'int', min: 0, max: 15000 },
        autoCopyOncePerProblem: { type: 'bool' },
        copyOnSelectionOnly: { type: 'bool' }
      }
    },
    shortcuts: {
      type: 'shape',
      shape: {
        enabled: { type: 'bool' },
        allowInEditor: { type: 'bool' },
        openSettings: { type: 'hotkey' },
        openHistory: { type: 'hotkey' },
        cycleFormat: { type: 'hotkey' },
        lastFormat: { type: 'hotkey' }
      }
    },
    history: {
      type: 'shape',
      shape: {
        enabled: { type: 'bool' },
        maxEntries: { type: 'int', min: 0, max: LIMITS.historyMaxEntries },
        storeBody: { type: 'bool' }
      }
    },
    advanced: {
      type: 'shape',
      shape: {
        mountTimeoutMs: { type: 'int', min: 2000, max: 120000 },
        observerScope: { type: 'enum', values: ['auto', 'body'] },
        downloadEnabled: { type: 'bool' },
        richHtmlClipboard: { type: 'bool' },
        syncAcrossTabs: { type: 'bool' }
      }
    }
  };

  const COLOR_RE = /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\))$/i;
  const HOTKEY_RE = /^$|^((Ctrl|Alt|Shift|Meta)\+){0,4}([A-Za-z0-9]|F[1-9]|F1[0-2]|Space|Escape|Enter|Comma|Period|Slash|Backslash|Semicolon|Quote|Minus|Equal|BracketLeft|BracketRight|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;

  function coerce(raw, spec, fallback) {
    if (raw === undefined) return deepClone(fallback);
    switch (spec.type) {
      case 'bool':
        return typeof raw === 'boolean' ? raw : (raw === 'true' ? true : (raw === 'false' ? false : fallback));
      case 'int': {
        const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
        if (!Number.isFinite(n)) return fallback;
        return clamp(Math.round(n), spec.min, spec.max);
      }
      case 'str': {
        if (typeof raw !== 'string') return fallback;
        return raw.length > spec.max ? raw.slice(0, spec.max) : raw;
      }
      case 'enum':
        return spec.values.includes(raw) ? raw : fallback;
      case 'color':
        return typeof raw === 'string' && COLOR_RE.test(raw.trim()) ? raw.trim() : fallback;
      case 'hotkey':
        return typeof raw === 'string' && HOTKEY_RE.test(raw.trim()) ? raw.trim() : fallback;
      case 'shape': {
        const out = {};
        const source = isObject(raw) ? raw : {};
        for (const [key, sub] of Object.entries(spec.shape)) {
          out[key] = coerce(source[key], sub, fallback ? fallback[key] : undefined);
        }
        return out;
      }
      case 'record': {
        const out = {};
        const source = isObject(raw) ? raw : {};
        for (const key of spec.keys) {
          out[key] = coerce(source[key], spec.value, fallback ? fallback[key] : undefined);
        }
        return out;
      }
      default:
        return deepClone(fallback);
    }
  }

  function sanitizeSettings(raw) {
    const out = {};
    for (const [key, spec] of Object.entries(SCHEMA)) {
      out[key] = coerce(isObject(raw) ? raw[key] : undefined, spec, DEFAULTS[key]);
    }
    out.schemaVersion = DEFAULTS.schemaVersion;
    return out;
  }

  /**
   * Forward-migrates persisted payloads. Migration copes with partial or foreign-shaped objects, which
   * sanitizeSettings already handles field-by-field.
   */
  function migrateSettings(raw) {
    if (!isObject(raw)) return sanitizeSettings(null);
    const version = Number(raw.schemaVersion) || 0;
    let working = raw;
    if (version < 3) {
      working = Object.assign({}, raw);
      // Older ad-hoc keys some users may have hand-written.
      if (typeof raw.markdownMode === 'string') {
        working.markdown = Object.assign({}, working.markdown, {
          engine: raw.markdownMode === 'legacy' ? 'legacy' : 'dom'
        });
      }
    }
    return sanitizeSettings(working);
  }

  const Settings = (() => {
    const events = new Emitter();
    let current = deepClone(DEFAULTS);
    let loaded = false;
    let writeToken = 0;
    let watcherId = null;

    function parse(rawValue) {
      if (rawValue === undefined || rawValue === null) return null;
      if (isObject(rawValue)) return rawValue;
      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        if (!trimmed) return null;
        try { return JSON.parse(trimmed); } catch (err) {
          Log.warn('stored settings are not valid JSON — falling back to defaults', err);
          return null;
        }
      }
      return null;
    }

    async function load() {
      const stored = parse(await GMBridge.getValue(STORE_KEYS.settings, null));
      current = migrateSettings(stored);
      loaded = true;
      Log.setLevel(current.logLevel);
      if (stored && !deepEqual(stored, current)) {
        // Repaired a corrupt / outdated payload — persist the clean version once.
        await persist();
      }
      if (current.advanced.syncAcrossTabs && GMBridge.canWatchValues) {
        watcherId = GMBridge.addChangeListener(STORE_KEYS.settings, (_key, _old, newValue, remote) => {
          if (!remote) return;
          const next = migrateSettings(parse(newValue));
          if (deepEqual(next, current)) return;
          current = next;
          Log.setLevel(current.logLevel);
          events.emit('change', { settings: current, remote: true });
        });
      }
      events.emit('load', { settings: current });
      return current;
    }

    async function persist() {
      const token = ++writeToken;
      const payload = JSON.stringify(current);
      await GMBridge.setValue(STORE_KEYS.settings, payload);
      return token === writeToken;
    }

    function get() { return current; }

    /** Apply a partial patch (deep-merged at one level per section), validate, persist, notify. */
    async function update(patch, options) {
      const merged = deepClone(current);
      for (const [key, value] of Object.entries(patch || {})) {
        if (!(key in SCHEMA)) continue;
        merged[key] = isObject(value) && isObject(merged[key])
          ? Object.assign({}, merged[key], value)
          : value;
      }
      const next = sanitizeSettings(merged);
      if (deepEqual(next, current)) return current;
      current = next;
      Log.setLevel(current.logLevel);
      if (!options || options.persist !== false) await persist();
      events.emit('change', { settings: current, remote: false });
      return current;
    }

    async function setPath(path, value) {
      const parts = path.split('.');
      if (parts.length === 1) return update({ [parts[0]]: value });
      if (parts.length === 2) return update({ [parts[0]]: { [parts[1]]: value } });
      if (parts.length === 3) {
        const section = deepClone(current[parts[0]]) || {};
        section[parts[1]] = Object.assign({}, section[parts[1]], { [parts[2]]: value });
        return update({ [parts[0]]: section });
      }
      Log.warn('unsupported settings path', path);
      return current;
    }

    function getPath(path) {
      return path.split('.').reduce((acc, key) => (isObject(acc) ? acc[key] : undefined), current);
    }

    async function reset() {
      current = deepClone(DEFAULTS);
      Log.setLevel(current.logLevel);
      await persist();
      events.emit('change', { settings: current, remote: false, reset: true });
      return current;
    }

    async function importJson(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (err) {
        throw new Error('Not valid JSON');
      }
      if (!isObject(parsed)) throw new Error('Expected a JSON object');
      const payload = isObject(parsed.settings) ? parsed.settings : parsed;
      current = migrateSettings(payload);
      Log.setLevel(current.logLevel);
      await persist();
      events.emit('change', { settings: current, remote: false, imported: true });
      return current;
    }

    function exportJson() {
      return JSON.stringify({
        script: 'Clip LeetCode',
        version: SCRIPT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: current
      }, null, 2);
    }

    function dispose() {
      GMBridge.removeChangeListener(watcherId);
      watcherId = null;
      events.clear();
    }

    return {
      load, get, update, setPath, getPath, reset, importJson, exportJson, dispose,
      on: events.on.bind(events),
      get isLoaded() { return loaded; }
    };
  })();

  /* ======================================================================== *
   * 5. Clip history (bounded, corruption-tolerant)
   * ======================================================================== */

  const History = (() => {
    let entries = [];
    let loadedOnce = false;
    let saveChain = Promise.resolve();
    const events = new Emitter();

    function sanitizeEntry(raw) {
      if (!isObject(raw)) return null;
      const ts = Number(raw.ts);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      const formatId = FORMAT_IDS.includes(raw.formatId) ? raw.formatId : 'text';
      const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
      return {
        id: str(raw.id, 40) || `${ts}-${Math.random().toString(36).slice(2, 8)}`,
        ts,
        formatId,
        title: str(raw.title, 200),
        slug: str(raw.slug, 200),
        url: str(raw.url, 500),
        chars: Number.isFinite(Number(raw.chars)) ? Number(raw.chars) : 0,
        preview: str(raw.preview, LIMITS.historyPreviewChars),
        body: str(raw.body, LIMITS.historyBodyChars)
      };
    }

    async function load() {
      if (loadedOnce) return entries;
      const raw = await GMBridge.getValue(STORE_KEYS.history, null);
      let parsed = null;
      if (typeof raw === 'string' && raw.trim()) {
        try { parsed = JSON.parse(raw); } catch (err) { Log.warn('history payload corrupt — resetting', err); }
      } else if (Array.isArray(raw)) {
        parsed = raw;
      }
      entries = Array.isArray(parsed)
        ? parsed.map(sanitizeEntry).filter(Boolean).sort((a, b) => b.ts - a.ts)
        : [];
      loadedOnce = true;
      return entries;
    }

    /**
     * O(1)-per-entry size estimate. Serialising the whole history on every clip was measurably
     * expensive with large bodies, and an approximation is entirely sufficient for a soft budget
     * (the 1.5 factor covers multi-byte characters and JSON escaping).
     */
    function estimateBytes(entry) {
      return Math.ceil((entry.body.length + entry.preview.length + entry.title.length
        + entry.url.length + entry.slug.length + 160) * 1.5);
    }

    function trim() {
      const max = clamp(Settings.get().history.maxEntries, 0, LIMITS.historyMaxEntries);
      if (entries.length > max) entries.length = max;

      let total = entries.reduce((sum, entry) => sum + estimateBytes(entry), 0);
      // Budget: shed the oldest bodies first, then the oldest entries themselves.
      for (let i = entries.length - 1; i >= 0 && total > LIMITS.historyMaxBytes; i--) {
        const victim = entries[i];
        if (victim.body) {
          total -= Math.ceil(victim.body.length * 1.5);
          victim.body = '';
        }
        if (total > LIMITS.historyMaxBytes) {
          total -= estimateBytes(victim);
          entries.splice(i, 1);
        }
      }
    }

    // Coalesce bursts of clips into a single write.
    const flush = debounce(() => {
      const payload = JSON.stringify(entries);
      saveChain = saveChain
        .then(() => GMBridge.setValue(STORE_KEYS.history, payload))
        .catch((err) => Log.warn('history save failed', err));
    }, 400);

    function save() { flush(); }

    // Never lose a pending write when the tab goes away.
    safe(() => {
      window.addEventListener('pagehide', () => flush.flush(), { capture: false });
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush.flush(); });
    }, undefined, 'history flush hooks');

    async function add(record) {
      const cfg = Settings.get().history;
      if (!cfg.enabled || cfg.maxEntries === 0) return null;
      await load();
      const body = cfg.storeBody ? String(record.content || '').slice(0, LIMITS.historyBodyChars) : '';
      const entry = sanitizeEntry({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        formatId: record.formatId,
        title: record.title,
        slug: record.slug,
        url: record.url,
        chars: String(record.content || '').length,
        preview: String(record.content || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.historyPreviewChars),
        body
      });
      if (!entry) return null;
      entries.unshift(entry);
      trim();
      save();
      events.emit('change', entries);
      return entry;
    }

    async function all() { return (await load()).slice(); }

    async function remove(id) {
      await load();
      const before = entries.length;
      entries = entries.filter((e) => e.id !== id);
      if (entries.length !== before) { save(); events.emit('change', entries); }
    }

    async function clear() {
      entries = [];
      loadedOnce = true;
      await GMBridge.deleteValue(STORE_KEYS.history);
      events.emit('change', entries);
    }

    return { load, add, all, remove, clear, on: events.on.bind(events) };
  })();

  /* ======================================================================== *
   * 6. Route model + SPA navigation watcher
   *
   * Because LeetCode is a client-routed SPA, route changes are detected
   * through four layered signals, cheapest first, staying dormant on non-problem routes.
   * ======================================================================== */

  const Route = (() => {
    const PROBLEM_RE = /^\/problems\/([^/?#]+)/;
    const CONTEST_RE = /^\/contest\/([^/?#]+)\/problems\/([^/?#]+)/;

    function parse(href) {
      let url;
      try { url = new URL(href); } catch (_) { return null; }
      const path = url.pathname;
      const contest = CONTEST_RE.exec(path);
      if (contest) {
        return {
          kind: 'contest',
          slug: decodeURIComponent(contest[2]),
          contestSlug: decodeURIComponent(contest[1]),
          canonicalUrl: `${url.origin}/contest/${contest[1]}/problems/${contest[2]}/`,
          host: url.host
        };
      }
      const problem = PROBLEM_RE.exec(path);
      if (problem) {
        return {
          kind: 'problem',
          slug: decodeURIComponent(problem[1]),
          contestSlug: null,
          canonicalUrl: `${url.origin}/problems/${problem[1]}/`,
          host: url.host
        };
      }
      return null;
    }

    return { parse };
  })();

  class RouteWatcher extends Emitter {
    constructor() {
      super();
      this._disposer = new Disposer('route-watcher');
      this._href = location.href;
      this._started = false;
      this._check = this._check.bind(this);
    }

    start() {
      if (this._started) return;
      this._started = true;
      const d = this._disposer;

      d.listen(window, 'popstate', this._check);
      d.listen(window, 'hashchange', this._check);
      d.listen(window, 'pageshow', this._check);

      // Modern Chrome/Edge: authoritative and cheap.
      const nav = window.navigation;
      if (nav && typeof nav.addEventListener === 'function') {
        d.listen(nav, 'navigatesuccess', this._check);
        d.listen(nav, 'currententrychange', this._check);
      }

      // Fallback for managers/browsers without the Navigation API: wrap the history methods.
      // Wrapped defensively; if the page later replaces them we still have the observer backstop.
      if (!nav) this._patchHistory();
    }

    _patchHistory() {
      const self = this;
      const patchMethod = (name) => {
        const nativeMethod = history[name];
        if (typeof nativeMethod !== 'function' || nativeMethod.__clipPatched) return;
        const wrapper = function (...args) {
          const result = nativeMethod.apply(this, args);
          // Defer: frameworks often mutate the DOM synchronously right after.
          Promise.resolve().then(self._check);
          return result;
        };
        wrapper.__clipPatched = true;
        try {
          history[name] = wrapper;
          this._disposer.add(() => { try { history[name] = nativeMethod; } catch (_) { /* noop */ } });
        } catch (err) {
          Log.warn(`could not patch history.${name}`, err);
        }
      };
      patchMethod('pushState');
      patchMethod('replaceState');
    }

    /** Cheap poll hook: called by the DOM observer, so no dedicated timer is needed. */
    poke() { this._check(); }

    _check() {
      const href = location.href;
      if (href === this._href) return;
      const previous = this._href;
      this._href = href;
      this.emit('change', { href, previous, context: Route.parse(href) });
    }

    get href() { return this._href; }

    dispose() {
      this._disposer.dispose();
      this.clear();
      this._started = false;
    }
  }

  /* ======================================================================== *
   * 7. Site integration: layout descriptors and problem extraction
   *
   * Selector sets are ordered fallback chains for LeetCode's layout
   * variations, plus resilient structural fallbacks so a class-name change on LeetCode's side
   * degrades to "slightly different anchor point" instead of "no buttons".
   * ======================================================================== */

  const LAYOUTS = [
    {
      id: 'classicLayout',
      titleSelectors: ['[data-cy=question-title]'],
      mount: 'absolute-right'
    },
    {
      id: 'newLayout',
      titleSelectors: [
        '.mr-2.text-lg.font-medium.text-label-1.dark\\:text-dark-label-1',
        'a.mr-2.text-label-1'
      ],
      mount: 'inline-tailwind'
    },
    {
      id: 'contestLayout',
      titleSelectors: [
        '#base_content > div.container > div > div > div.question-title.clearfix > h3',
        '.question-title h3',
        '.question-title'
      ],
      mount: 'inline-flex'
    },
    {
      id: 'dynamicLayout',
      // The container is preferred over the inner <a> so the bar lands beside the title,
      // in the same flex row.
      titleSelectors: [
        'div.text-title-large',
        '.text-title-large',
        'div[class*="text-title-large"]',
        'a[href^="/problems/"].text-label-1'
      ],
      mount: 'inline-flex'
    }
  ];

  const DESCRIPTION_SELECTORS = [
    '[data-track-load=description_content]',
    'div.question-content.default-content',
    'div.elfjS',
    '[data-key="description-content"]',
    '.question-content__JfgR',
    'div[class*="_1l1MA"]',
    '.content__u3I1'
  ];

  const Extractor = (() => {
    /** CSS.escape is not universally available; this covers the identifier subset we need. */
    function escapeSelector(value) {
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
        return safe(() => CSS.escape(value), '', 'CSS.escape');
      }
      return String(value).replace(/[^\w-]/g, (ch) => `\\${ch}`);
    }

    /**
     * Locate the title node using the ordered layout list.
     * A visible match always wins; a connected-but-unmeasurable match is accepted as a fallback
     * so the bar still mounts during hydration or inside zero-height wrappers.
     */
    function findLayout() {
      let fallback = null;
      for (const layout of LAYOUTS) {
        const node = queryFirst(layout.titleSelectors);
        if (!node || !node.isConnected) continue;
        if (isVisible(node)) return { layout, titleNode: node };
        if (!fallback) fallback = { layout, titleNode: node };
      }
      if (fallback) return fallback;

      // Structural fallback: an anchor pointing at the current problem, inside a heading-ish node.
      const ctx = Route.parse(location.href);
      if (ctx) {
        const selector = `a[href*="/problems/${escapeSelector(ctx.slug)}/"]`;
        const anchor = safe(() => document.querySelector(selector), null, 'fallback title lookup');
        if (anchor && anchor.isConnected && anchor.textContent.trim().length > 1) {
          return { layout: { id: 'fallbackLayout', titleSelectors: [], mount: 'inline-flex' }, titleNode: anchor };
        }
      }
      return null;
    }

    function findDescription() {
      const node = queryFirst(DESCRIPTION_SELECTORS);
      if (node) return node;
      // Structural fallback: the densest text block that contains an example <pre>.
      const candidates = safe(() => Array.from(document.querySelectorAll('div')).filter((d) => {
        if (!d.querySelector('pre')) return false;
        const len = d.textContent ? d.textContent.length : 0;
        return len > 200 && len < 60000;
      }), [], 'description fallback scan');
      if (!candidates.length) return null;
      // Prefer the deepest (most specific) container.
      candidates.sort((a, b) => b.textContent.length - a.textContent.length);
      let best = candidates[0];
      for (const c of candidates) if (c.contains(best) === false && best.contains(c)) best = c;
      return best;
    }

    function rawTitle(node) {
      if (!node) return '';
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      return text;
    }

    function applyTitleMode(title, meta, mode) {
      const idMatch = /^(\d+)\.\s*(.+)$/.exec(title);
      const bare = idMatch ? idMatch[2] : title;
      const id = idMatch ? idMatch[1] : (meta && meta.frontendId) || '';
      if (mode === 'strip-id') return bare;
      if (mode === 'with-id') return id ? `${id}. ${bare}` : bare;
      return title;
    }

    function difficultyFromDom() {
      const node = queryFirst([
        'div[class*="text-difficulty-"]',
        '[diff]',
        '.text-olive', '.text-yellow', '.text-pink'
      ]);
      if (!node) return '';
      const text = (node.textContent || '').trim();
      return /^(easy|medium|hard)$/i.test(text) ? text : '';
    }

    function tagsFromDom() {
      const nodes = safe(() => Array.from(document.querySelectorAll('a[href^="/tag/"]')), [], 'tag scan');
      const out = [];
      for (const n of nodes) {
        const t = (n.textContent || '').trim();
        if (t && t.length < 40 && !out.includes(t)) out.push(t);
        if (out.length >= 25) break;
      }
      return out;
    }

    /** Build the immutable snapshot every formatter consumes. */
    function snapshot(context) {
      const found = findLayout();
      const description = findDescription();
      return {
        context,
        layoutId: found ? found.layout.id : null,
        titleNode: found ? found.titleNode : null,
        descriptionNode: description,
        titleRaw: rawTitle(found ? found.titleNode : null),
        difficultyDom: difficultyFromDom(),
        tagsDom: tagsFromDom(),
        url: location.href
      };
    }

    return { findLayout, findDescription, snapshot, applyTitleMode };
  })();

  /* ======================================================================== *
   * 8. Metadata enrichment (same-origin GraphQL)
   *
   * Optional, cached, single-flight, aborts on navigation. Purely additive: every consumer works
   * with `null` metadata, so a blocked/failed request can never break copying.
   * ======================================================================== */

  const MetaService = (() => {
    const inflight = new Map();
    const failures = new Map(); // key -> timestamp; short backoff so a dead network is not hammered
    const FAILURE_BACKOFF_MS = 60000;
    let cache = null; // { [host:slug]: { ts, data } }
    let cacheDirty = false;
    let flushTimer = null;

    const QUERY = `query clipLeetCodeQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    difficulty
    isPaidOnly
    likes
    dislikes
    stats
    content
    hints
    topicTags { name slug }
    codeSnippets { lang langSlug code }
    similarQuestionList { titleSlug title difficulty }
  }
}`;

    async function loadCache() {
      if (cache) return cache;
      const raw = await GMBridge.getValue(STORE_KEYS.meta, null);
      let parsed = null;
      if (typeof raw === 'string' && raw.trim()) {
        try { parsed = JSON.parse(raw); } catch (err) { Log.warn('meta cache corrupt — resetting', err); }
      }
      cache = isObject(parsed) ? parsed : {};
      // Evict expired / overflowing entries at load time.
      const now = Date.now();
      const keys = Object.keys(cache);
      for (const key of keys) {
        const entry = cache[key];
        if (!isObject(entry) || !Number.isFinite(entry.ts) || now - entry.ts > LIMITS.metaCacheTtlMs) delete cache[key];
      }
      const remaining = Object.keys(cache);
      if (remaining.length > LIMITS.metaCacheMaxEntries) {
        remaining
          .sort((a, b) => cache[a].ts - cache[b].ts)
          .slice(0, remaining.length - LIMITS.metaCacheMaxEntries)
          .forEach((k) => delete cache[k]);
      }
      return cache;
    }

    function scheduleFlush() {
      cacheDirty = true;
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!cacheDirty || !cache) return;
        cacheDirty = false;
        GMBridge.setValue(STORE_KEYS.meta, JSON.stringify(cache));
      }, 1500);
    }

    /** Strict shape validation — never trust a network response. */
    function normalize(payload) {
      if (!isObject(payload) || !isObject(payload.data) || !isObject(payload.data.question)) return null;
      const q = payload.data.question;
      const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

      let acRate = null;
      if (typeof q.stats === 'string') {
        try {
          const stats = JSON.parse(q.stats);
          if (isObject(stats) && typeof stats.acRate === 'string') acRate = stats.acRate;
        } catch (_) { /* stats is best-effort */ }
      }

      return {
        questionId: str(q.questionId, 16),
        frontendId: str(q.questionFrontendId, 16),
        title: str(q.title, 300),
        slug: str(q.titleSlug, 200),
        difficulty: /^(Easy|Medium|Hard)$/.test(q.difficulty) ? q.difficulty : '',
        isPaidOnly: q.isPaidOnly === true,
        likes: num(q.likes),
        dislikes: num(q.dislikes),
        acRate,
        contentHtml: str(q.content, 400000),
        hints: Array.isArray(q.hints) ? q.hints.filter((h) => typeof h === 'string').map((h) => h.slice(0, 4000)).slice(0, 20) : [],
        tags: Array.isArray(q.topicTags)
          ? q.topicTags.filter(isObject).map((t) => str(t.name, 60)).filter(Boolean).slice(0, 30)
          : [],
        snippets: Array.isArray(q.codeSnippets)
          ? q.codeSnippets.filter(isObject).map((s) => ({
            lang: str(s.lang, 40),
            langSlug: str(s.langSlug, 40),
            code: str(s.code, 20000)
          })).filter((s) => s.langSlug && s.code).slice(0, 40)
          : [],
        similar: Array.isArray(q.similarQuestionList)
          ? q.similarQuestionList.filter(isObject).map((s) => ({
            title: str(s.title, 200),
            slug: str(s.titleSlug, 200),
            difficulty: str(s.difficulty, 12)
          })).filter((s) => s.title).slice(0, 20)
          : []
      };
    }

    function csrfToken() {
      const match = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie || '');
      return match ? decodeURIComponent(match[1]) : '';
    }

    async function request(slug, signal) {
      const endpoint = `${location.origin}/graphql/`;
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const token = csrfToken();
      if (token) headers['x-csrftoken'] = token;

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        mode: 'same-origin',
        redirect: 'error',
        referrerPolicy: 'same-origin',
        headers,
        body: JSON.stringify({ operationName: 'clipLeetCodeQuestion', variables: { titleSlug: slug }, query: QUERY }),
        signal
      });
      if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
      const ct = response.headers.get('content-type') || '';
      if (!/json/i.test(ct)) throw new Error('GraphQL returned non-JSON');
      return normalize(await response.json());
    }

    /**
     * @param {string} slug
     * @param {{force?: boolean, signal?: AbortSignal}} [options]
     * @returns {Promise<object|null>} normalized metadata, or null when unavailable
     */
    async function fetchMeta(slug, options) {
      const opts = options || {};
      if (!slug || typeof slug !== 'string') return null;
      if (typeof fetch !== 'function') return null;

      const key = `${location.host}:${slug}`;
      const store = await loadCache();
      if (!opts.force && isObject(store[key]) && Date.now() - store[key].ts < LIMITS.metaCacheTtlMs) {
        return store[key].data;
      }
      if (inflight.has(key)) return inflight.get(key);

      const failedAt = failures.get(key);
      if (!opts.force && failedAt && Date.now() - failedAt < FAILURE_BACKOFF_MS) {
        Log.debug('metadata skipped (recent failure)', slug);
        return null;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIMITS.networkTimeoutMs);
      if (opts.signal) {
        if (opts.signal.aborted) { clearTimeout(timer); return null; }
        opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const promise = request(slug, controller.signal)
        .then((data) => {
          if (data) {
            failures.delete(key);
            store[key] = { ts: Date.now(), data };
            scheduleFlush();
          } else {
            failures.set(key, Date.now());
          }
          return data;
        })
        .catch((err) => {
          // Aborts are expected on navigation and must not poison the backoff.
          if (err && err.name === 'AbortError') Log.debug('metadata request aborted', slug);
          else { failures.set(key, Date.now()); Log.warn('metadata request failed', err); }
          return null;
        })
        .finally(() => { clearTimeout(timer); inflight.delete(key); });

      inflight.set(key, promise);
      return promise;
    }

    async function clearCache() {
      cache = {};
      failures.clear();
      cacheDirty = false;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      await GMBridge.deleteValue(STORE_KEYS.meta);
    }

    return { fetchMeta, clearCache };
  })();

  /* ======================================================================== *
   * 9. Conversion engines
   * ======================================================================== */

  const HtmlEntities = (() => {
    const NAMED = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
      hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', times: '\u00d7',
      le: '\u2264', ge: '\u2265', ne: '\u2260', minus: '\u2212', deg: '\u00b0',
      infin: '\u221e', sum: '\u2211', radic: '\u221a', larr: '\u2190', rarr: '\u2192'
    };
    const RE = /&(#x?[0-9a-f]+|[a-z][a-z0-9]{1,10});/gi;

    /** Entity decoding without touching innerHTML (no parser round-trip, no injection surface). */
    function decode(text) {
      if (typeof text !== 'string' || text.indexOf('&') === -1) return text;
      return text.replace(RE, (match, body) => {
        if (body[0] === '#') {
          const isHex = body[1] === 'x' || body[1] === 'X';
          const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
          if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
          try { return String.fromCodePoint(code); } catch (_) { return match; }
        }
        const key = body.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : match;
      });
    }

    function escape(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    return { decode, escape };
  })();

  const TextTools = (() => {
    function normalizeNbsp(text, enabled) {
      return enabled ? text.replace(/\u00a0/g, ' ') : text;
    }
    function trimTrailing(text, enabled) {
      return enabled ? text.replace(/[ \t]+$/gm, '') : text;
    }
    function collapseBlankLines(text, maxBlank) {
      const limit = clamp(Number(maxBlank), 0, 5);
      const re = new RegExp(`\\n{${limit + 2},}`, 'g');
      return text.replace(re, '\n'.repeat(limit + 1));
    }
    function normalize(text, contentCfg) {
      let out = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
      out = normalizeNbsp(out, contentCfg.nbspToSpace);
      out = trimTrailing(out, contentCfg.trimTrailingSpaces);
      out = collapseBlankLines(out, contentCfg.maxBlankLines);
      return out.trim();
    }
    return { normalizeNbsp, trimTrailing, collapseBlankLines, normalize };
  })();

  /* ---------------------------------------------------------------------- *
   * 9a. DOM-walking HTML -> Markdown (default engine)
   *
   * Handles nested structures, ordered lists, links, images,
   * tables and code fences, resilient against attribute variance.
   * ---------------------------------------------------------------------- */

  const MarkdownEngine = (() => {
    const SKIP_TAGS = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
      'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO'
    ]);
    const BLOCK_TAGS = new Set([
      'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
      'FIGURE', 'FIGCAPTION', 'ADDRESS', 'FORM', 'DL', 'DT', 'DD', 'DETAILS'
    ]);
    const ESCAPE_RE = /([\\`*_[\]()#+\-!>|])/g;

    function escapeText(text, enabled) {
      return enabled ? text.replace(ESCAPE_RE, '\\$1') : text;
    }

    function fenceLanguage(node, opts) {
      if (opts.codeFenceLang) return opts.codeFenceLang;
      const code = node.querySelector && node.querySelector('code');
      const source = code || node;
      const cls = (source.getAttribute && source.getAttribute('class')) || '';
      const match = /(?:language|lang)-([a-z0-9+#-]+)/i.exec(cls);
      return match ? match[1] : '';
    }

    function absolutize(href, enabled) {
      if (!href) return '';
      if (!enabled) return href;
      try { return new URL(href, location.href).href; } catch (_) { return href; }
    }

    function shouldSkip(node, ctx) {
      if (SKIP_TAGS.has(node.tagName)) return true;
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true' && !node.textContent.trim()) return true;
      if (ctx.opts.excludeCollapsedSections) {
        if (node.hasAttribute && node.hasAttribute('data-headlessui-state')) return true;
        if (node.tagName === 'DETAILS') return true;
      }
      return false;
    }

    function renderChildren(node, ctx) {
      let out = '';
      for (const child of node.childNodes) out += renderNode(child, ctx);
      return out;
    }

    function wrapInline(node, ctx, marker) {
      const inner = renderChildren(node, ctx);
      const trimmed = inner.trim();
      if (!trimmed) return inner;
      // Keep surrounding whitespace outside the emphasis markers so Markdown stays valid.
      const lead = /^\s*/.exec(inner)[0];
      const tail = /\s*$/.exec(inner)[0];
      return `${lead}${marker}${trimmed}${marker}${tail}`;
    }

    function renderList(node, ctx) {
      const ordered = node.tagName === 'OL';
      let start = parseInt(node.getAttribute('start'), 10);
      if (!Number.isFinite(start)) start = 1;
      const items = Array.from(node.children).filter((c) => c.tagName === 'LI');
      if (!items.length) return '';
      const childCtx = Object.assign({}, ctx, { listDepth: ctx.listDepth + 1 });
      const indent = '  '.repeat(ctx.listDepth);
      const lines = items.map((li, index) => {
        const marker = ordered ? `${start + index}. ` : `${ctx.opts.listBullet} `;
        // LeetCode list items are single-paragraph; collapsing keeps nested lists tight and valid.
        const body = renderChildren(li, childCtx).replace(/\n{2,}/g, '\n').trim();
        const pad = ' '.repeat(marker.length);
        const wrapped = body.split('\n')
          .map((line, i) => (i === 0 ? line : (line ? pad + line : '')))
          .join('\n');
        return `${indent}${marker}${wrapped}`;
      });
      return `\n\n${lines.join('\n')}\n\n`;
    }

    function renderTable(node, ctx) {
      if (!ctx.opts.convertTables) return `\n\n${renderChildren(node, ctx).trim()}\n\n`;
      const rows = Array.from(node.querySelectorAll('tr'));
      if (!rows.length) return '';
      const cellCtx = Object.assign({}, ctx, { inTable: true });
      const grid = rows.map((row) => Array.from(row.children)
        .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
        .map((cell) => renderChildren(cell, cellCtx).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
      const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
      if (!width) return '';
      const pad = (row) => {
        const copy = row.slice(0, width);
        while (copy.length < width) copy.push('');
        return `| ${copy.join(' | ')} |`;
      };
      const hasHeader = rows[0].querySelector('th') !== null;
      const header = hasHeader ? grid[0] : new Array(width).fill('');
      const bodyRows = hasHeader ? grid.slice(1) : grid;
      const divider = `|${new Array(width).fill(' --- ').join('|')}|`;
      return `\n\n${[pad(header), divider, ...bodyRows.map(pad)].join('\n')}\n\n`;
    }

    function renderNode(node, ctx) {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.nodeValue || '';
        if (ctx.pre) return raw;
        const collapsed = raw.replace(/[\t\n\r ]+/g, ' ');
        if (!collapsed) return '';
        return escapeText(collapsed, ctx.opts.escapeSpecials && !ctx.inCode);
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (shouldSkip(node, ctx)) return '';

      const tag = node.tagName;

      switch (tag) {
        case 'BR':
          return ctx.inTable ? ' ' : '\n';
        case 'HR':
          return '\n\n---\n\n';
        case 'PRE': {
          const text = TextTools.normalizeNbsp(node.textContent || '', ctx.opts.nbspToSpace)
            .replace(/\r\n?/g, '\n')
            .replace(/\n+$/, '');
          if (!text.trim()) return '';
          if (!ctx.opts.preAsFence) {
            return `\n\n${text.split('\n').map((l) => `    ${l}`).join('\n')}\n\n`;
          }
          // Guard against content that itself contains a fence.
          const ticks = /^`{3,}/m.test(text) ? '````' : '```';
          const token = ctx.blocks.length;
          ctx.blocks.push(`${ticks}${fenceLanguage(node, ctx.opts)}\n${text}\n${ticks}`);
          return `\n\n\u0000${token}\u0000\n\n`;
        }
        case 'CODE': {
          if (ctx.pre) return renderChildren(node, ctx);
          const inner = renderChildren(node, Object.assign({}, ctx, { inCode: true })).trim();
          if (!inner) return '';
          if (ctx.opts.inlineCode === 'plain') return inner;
          if (ctx.opts.inlineCode === 'html') return `<code>${inner}</code>`;
          const fence = inner.includes('`') ? '``' : '`';
          const spacer = inner.startsWith('`') || inner.endsWith('`') ? ' ' : '';
          return `${fence}${spacer}${inner}${spacer}${fence}`;
        }
        case 'STRONG':
        case 'B':
          return wrapInline(node, ctx, '**');
        case 'EM':
        case 'I':
          return wrapInline(node, ctx, '*');
        case 'DEL':
        case 'S':
        case 'STRIKE':
          return wrapInline(node, ctx, '~~');
        case 'U': {
          if (ctx.opts.underline === 'html') return `<u>${renderChildren(node, ctx)}</u>`;
          if (ctx.opts.underline === 'italic') return wrapInline(node, ctx, '*');
          return renderChildren(node, ctx);
        }
        case 'SUP': {
          const inner = renderChildren(node, ctx).trim();
          if (!inner) return '';
          if (ctx.opts.superscript === 'html') return `<sup>${inner}</sup>`;
          if (ctx.opts.superscript === 'plain') return inner;
          return `^${inner}`;
        }
        case 'SUB': {
          const inner = renderChildren(node, ctx).trim();
          if (!inner) return '';
          return ctx.opts.superscript === 'html' ? `<sub>${inner}</sub>` : `_${inner}`;
        }
        case 'A': {
          const inner = renderChildren(node, ctx).trim();
          const href = absolutize(node.getAttribute('href'), ctx.opts.absolutizeLinks);
          if (!href || href.startsWith('javascript:')) return inner;
          if (!inner) return `<${href}>`;
          return `[${inner}](${href})`;
        }
        case 'IMG': {
          if (ctx.opts.images === 'skip') return '';
          const alt = (node.getAttribute('alt') || '').trim();
          if (ctx.opts.images === 'alt') return alt;
          const src = absolutize(node.getAttribute('src'), ctx.opts.absolutizeLinks);
          if (!src || src.startsWith('javascript:')) return alt;
          return `![${alt}](${src})`;
        }
        case 'UL':
        case 'OL':
          return renderList(node, ctx);
        case 'LI':
          // Orphan <li> (no list parent) — render as a bullet so nothing is lost.
          return `\n${ctx.opts.listBullet} ${renderChildren(node, ctx).trim()}\n`;
        case 'TABLE':
          return renderTable(node, ctx);
        case 'BLOCKQUOTE': {
          const inner = renderChildren(node, ctx).trim();
          if (!inner) return '';
          return `\n\n${inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n`;
        }
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
          const inner = renderChildren(node, ctx).trim();
          if (!inner) return '';
          return `\n\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`;
        }
        case 'SUMMARY': {
          const inner = renderChildren(node, ctx).trim();
          return inner ? `\n\n**${inner}**\n\n` : '';
        }
        default: {
          const inner = renderChildren(node, ctx);
          if (BLOCK_TAGS.has(tag)) return inner.trim() ? `\n\n${inner}\n\n` : '';
          return inner;
        }
      }
    }

    /**
     * @param {Element|DocumentFragment} root
     * @param {object} opts merged markdown + content options
     * @returns {string}
     */
    function convert(root, opts) {
      if (!root) return '';
      const ctx = { opts, pre: false, inCode: false, inTable: false, listDepth: 0, blocks: [] };
      let out = renderChildren(root, ctx);

      out = out.replace(/\r\n?/g, '\n');
      out = TextTools.normalizeNbsp(out, opts.nbspToSpace);
      out = out.replace(/[ \t]{2,}/g, ' ');
      out = TextTools.trimTrailing(out, opts.trimTrailingSpaces);
      out = TextTools.collapseBlankLines(out, opts.maxBlankLines);
      out = out.trim();

      // Re-inject verbatim code fences after whitespace normalisation.
      out = out.replace(/\u0000(\d+)\u0000/g, (match, index) => {
        const block = ctx.blocks[Number(index)];
        return block === undefined ? '' : block;
      });
      return out;
    }

    return { convert };
  })();

  /* ---------------------------------------------------------------------- *
   * 9b. Legacy engine — regex replacement pipeline
   *      (optional alternative engine for simple regex-based conversion).
   * ---------------------------------------------------------------------- */

  const LegacyMarkdown = (() => {
    const MAP = [
      ['<div>', ''], ['</div>', ''], ['<p>', ''], ['</p>', ''], ['<u>', ''], ['</u>', ''],
      ['<ol>', ''], ['</ol>', ''], ['<ul>', ''], ['</ul>', ''], ['<li>', '- '], ['</li>', ''],
      ['&nbsp;', ''], ['<em>', ''], ['</em>', ''],
      ['<strong>Input</strong>', 'Input\n'], ['<strong>Output</strong>', 'Output\n'],
      ['<strong>Explanation</strong>', 'Explanation\n'],
      ['<strong>Input:</strong>', 'Input:'], ['<strong>Output:</strong>', 'Output:'],
      ['<strong>Explanation:</strong>', 'Explanation:'],
      ['<strong>Input: </strong>', 'Input: '], ['<strong>Output: </strong>', 'Output: '],
      ['<strong>Explanation: </strong>', 'Explanation: '],
      ['<strong class="example">Example', '**Example'],
      ['<strong>', '**'], ['</strong>', '** '],
      ['<pre>', '\n```\n'], ['</pre>', '```\n\n'],
      ['<code>', '<code>'], ['</code>', '</code>'],
      ['&lt;', '<'], ['&gt;', '>'],
      ['<sup>', '^'], ['</sup>', ''],
      ['\t', ''],
      ['<span.*?>', ''], ['</span>', ''],
      ['<font face="monospace">', ''], ['</font>', '']
    ];

    function convert(html) {
      let out = String(html || '')
        .replace(/<div class=".*?" data-headlessui-state=".*?">/g, '')
        .replace(/<div id=".*?" aria-expanded=".*?" data-headlessui-state=".*?">/g, '');
      for (const [key, value] of MAP) {
        // Compiled per call; wrapped so one bad pattern cannot abort the run.
        const re = safe(() => new RegExp(key, 'g'), null, `legacy pattern: ${key}`);
        if (!re) continue;
        out = out.replace(re, () => value);
      }
      return out.replace(/(\n){2,}/g, '\n\n').trim();
    }

    return { convert };
  })();

  /* ---------------------------------------------------------------------- *
   * 9c. Template renderer
   * ---------------------------------------------------------------------- */

  const Template = (() => {
    const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

    /**
     * Substitutes {{token}} placeholders. A line whose tokens ALL resolve to empty is dropped,
     * which lets one template serve problems with and without metadata.
     */
    function render(template, tokens) {
      const lines = String(template || '').replace(/\r\n?/g, '\n').split('\n');
      const output = [];
      for (const line of lines) {
        let sawToken = false;
        let sawValue = false;
        const rendered = line.replace(TOKEN_RE, (match, name) => {
          if (!Object.prototype.hasOwnProperty.call(tokens, name)) return match;
          sawToken = true;
          const value = tokens[name];
          const text = value === null || value === undefined ? '' : String(value);
          if (text.trim()) sawValue = true;
          return text;
        });
        if (sawToken && !sawValue) continue;
        output.push(rendered);
      }
      // Remove fences that became empty because their content token was dropped.
      return output.join('\n').replace(/^```[a-z0-9+#-]*\n```$/gim, '').replace(/\n{3,}/g, '\n\n');
    }

    function tokenNames() {
      return [
        'title', 'url', 'canonicalUrl', 'slug', 'id', 'difficulty', 'tags', 'tagList',
        'likes', 'dislikes', 'acceptance', 'paid', 'date', 'time', 'datetime', 'iso',
        'body', 'bodyText', 'bodyHtml', 'snippet', 'snippetLang', 'hints', 'similar',
        'host', 'format', 'contest'
      ];
    }

    return { render, tokenNames };
  })();

  /* ---------------------------------------------------------------------- *
   * 9d. Clip builder — turns a page snapshot (+ optional metadata) into clip text
   * ---------------------------------------------------------------------- */

  const ClipBuilder = (() => {
    /** Selection support: clip only what the user highlighted inside the description. */
    function selectionRoot(descriptionNode) {
      const selection = window.getSelection && window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!descriptionNode || !descriptionNode.contains(range.commonAncestorContainer)) return null;
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      return holder;
    }

    function pickSnippet(meta, preferred) {
      if (!meta || !Array.isArray(meta.snippets) || !meta.snippets.length) return null;
      const wanted = String(preferred || '').toLowerCase();
      return meta.snippets.find((s) => s.langSlug.toLowerCase() === wanted)
        || meta.snippets.find((s) => s.lang.toLowerCase() === wanted)
        || meta.snippets[0];
    }

    function buildTokens(input) {
      const { snapshot, meta, settings, bodies, formatId } = input;
      const now = new Date();
      const snippet = settings.content.includeSnippet
        ? pickSnippet(meta, settings.content.snippetLanguage)
        : null;
      const tags = (meta && meta.tags && meta.tags.length ? meta.tags : snapshot.tagsDom) || [];
      const difficulty = (meta && meta.difficulty) || snapshot.difficultyDom || '';
      const hints = settings.content.includeHints && meta && meta.hints.length
        ? meta.hints.map((h, i) => `${i + 1}. ${h.replace(/<[^>]+>/g, '').trim()}`).join('\n')
        : '';
      const similar = settings.content.includeSimilar && meta && meta.similar.length
        ? meta.similar.map((s) => `- [${s.title}](${location.origin}/problems/${s.slug}/)${s.difficulty ? ` — ${s.difficulty}` : ''}`).join('\n')
        : '';

      return {
        title: bodies.title,
        url: snapshot.url,
        canonicalUrl: snapshot.context ? snapshot.context.canonicalUrl : snapshot.url,
        slug: snapshot.context ? snapshot.context.slug : '',
        id: (meta && meta.frontendId) || '',
        difficulty,
        tags: tags.join(', '),
        tagList: tags.map((t) => `- ${t}`).join('\n'),
        likes: meta && meta.likes !== null ? String(meta.likes) : '',
        dislikes: meta && meta.dislikes !== null ? String(meta.dislikes) : '',
        acceptance: (meta && meta.acRate) || '',
        paid: meta && meta.isPaidOnly ? 'Premium' : '',
        date: formatDate(now, false),
        time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
        datetime: formatDate(now, true),
        iso: now.toISOString(),
        body: bodies.body,
        bodyText: bodies.text,
        bodyHtml: bodies.html,
        snippet: snippet ? snippet.code.replace(/\s+$/, '') : '',
        snippetLang: snippet ? snippet.langSlug : '',
        hints,
        similar,
        host: location.host,
        format: FORMAT_META[formatId] ? FORMAT_META[formatId].name : formatId,
        contest: snapshot.context && snapshot.context.contestSlug ? snapshot.context.contestSlug : ''
      };
    }

    function appendSections(body, tokens, settings) {
      const parts = [body];
      if (settings.content.includeHints && tokens.hints) parts.push(`## Hints\n\n${tokens.hints}`);
      if (settings.content.includeSimilar && tokens.similar) parts.push(`## Similar Questions\n\n${tokens.similar}`);
      return parts.filter((p) => p && p.trim()).join('\n\n');
    }

    /**
     * @returns {{ok: boolean, content?: string, html?: string, reason?: string, title?: string}}
     */
    function build(input) {
      const { snapshot, meta, settings, formatId } = input;
      const md = settings.markdown;
      const content = settings.content;

      const selection = settings.automation.copyOnSelectionOnly
        ? selectionRoot(snapshot.descriptionNode)
        : null;
      const root = selection || snapshot.descriptionNode;

      // Metadata content is the last-resort source: it lets the user clip from the Solutions or
      // Submissions tab where the description DOM is not mounted at all.
      let fallbackRoot = null;
      if (!root && meta && meta.contentHtml) {
        fallbackRoot = document.createElement('div');
        // Parsed inertly: DOMParser documents do not execute scripts or load subresources.
        const doc = safe(() => new DOMParser().parseFromString(meta.contentHtml, 'text/html'), null, 'parse meta html');
        if (doc && doc.body) {
          for (const child of Array.from(doc.body.childNodes)) fallbackRoot.appendChild(child);
        }
      }
      const source = root || fallbackRoot;
      if (!source) {
        return { ok: false, reason: 'Problem description not found on this page.' };
      }

      const titleBase = snapshot.titleRaw || (meta && meta.title) || (snapshot.context ? snapshot.context.slug : 'LeetCode problem');
      const title = Extractor.applyTitleMode(titleBase, meta, content.titleMode);

      const mdOpts = Object.assign({}, md, {
        nbspToSpace: content.nbspToSpace,
        trimTrailingSpaces: content.trimTrailingSpaces,
        maxBlankLines: content.maxBlankLines,
        excludeCollapsedSections: content.excludeCollapsedSections
      });

      const html = source.innerHTML || '';
      const markdownBody = md.engine === 'legacy'
        ? LegacyMarkdown.convert(html)
        : MarkdownEngine.convert(source, mdOpts);

      let plainBody;
      if (content.textEngine === 'markdown') {
        plainBody = markdownBody;
      } else if (content.textEngine === 'innerText' && typeof source.innerText === 'string' && source.isConnected) {
        plainBody = source.innerText;
      } else {
        plainBody = source.textContent || '';
      }
      plainBody = TextTools.normalize(plainBody, content);

      const bodies = {
        title,
        body: formatId === 'text' ? plainBody : markdownBody,
        text: plainBody,
        html,
        markdown: markdownBody
      };

      const tokens = buildTokens({ snapshot, meta, settings, bodies, formatId });

      let output;
      switch (formatId) {
        case 'text':
          output = Template.render(settings.templates.text, tokens);
          break;
        case 'markdown':
          output = Template.render(settings.templates.markdown,
            Object.assign({}, tokens, { body: appendSections(markdownBody, tokens, settings) }));
          break;
        case 'custom':
          output = Template.render(settings.templates.custom,
            Object.assign({}, tokens, { body: appendSections(markdownBody, tokens, settings) }));
          break;
        case 'html': {
          const heading = `<h1><a href="${HtmlEntities.escape(tokens.url)}">${HtmlEntities.escape(title)}</a></h1>`;
          output = `${heading}\n${html}`.trim();
          break;
        }
        case 'json': {
          output = JSON.stringify({
            title,
            slug: tokens.slug,
            id: tokens.id || null,
            url: tokens.url,
            canonicalUrl: tokens.canonicalUrl,
            difficulty: tokens.difficulty || null,
            tags: (meta && meta.tags.length ? meta.tags : snapshot.tagsDom) || [],
            premium: Boolean(meta && meta.isPaidOnly),
            stats: {
              likes: meta ? meta.likes : null,
              dislikes: meta ? meta.dislikes : null,
              acceptance: (meta && meta.acRate) || null
            },
            description: { markdown: markdownBody, text: plainBody, html },
            hints: (meta && meta.hints) || [],
            similarQuestions: (meta && meta.similar) || [],
            codeSnippet: tokens.snippet ? { language: tokens.snippetLang, code: tokens.snippet } : null,
            capturedAt: tokens.iso,
            source: `Clip LeetCode ${SCRIPT_VERSION}`
          }, null, 2);
          break;
        }
        default:
          return { ok: false, reason: `Unknown format "${formatId}".` };
      }

      output = String(output || '').replace(/\n{3,}/g, '\n\n').trim();
      if (!output) return { ok: false, reason: 'Nothing to copy — the description looks empty.' };
      if (output.length > LIMITS.maxClipChars) {
        output = `${output.slice(0, LIMITS.maxClipChars)}\n\n[clip truncated]`;
      }

      const richHtml = formatId === 'html'
        ? output
        : `<h1><a href="${HtmlEntities.escape(tokens.url)}">${HtmlEntities.escape(title)}</a></h1>\n${html}`;

      return { ok: true, content: output, html: richHtml, title, tokens, partial: Boolean(selection) };
    }

    return { build };
  })();

  /* ======================================================================== *
   * 10. Clipboard (layered strategies, explicit failure reporting)
   *
   * Uses async Clipboard API first, then GM_setClipboard, with a textarea
   * fallback path for non-secure contexts.
   * ======================================================================== */

  const Clipboard = (() => {
    async function viaAsyncApi(text, html, wantRich) {
      if (!navigator.clipboard || !window.isSecureContext) return false;
      if (wantRich && html && typeof ClipboardItem === 'function' && navigator.clipboard.write) {
        try {
          const item = new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
          });
          await navigator.clipboard.write([item]);
          return true;
        } catch (err) {
          Log.debug('rich clipboard write failed, falling back to text', err);
        }
      }
      if (!navigator.clipboard.writeText) return false;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        Log.debug('navigator.clipboard.writeText failed', err);
        return false;
      }
    }

    function viaTextarea(text) {
      // Fallback for non-secure contexts.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.setAttribute('aria-hidden', 'true');
      area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';
      const active = document.activeElement;
      const selection = window.getSelection();
      const savedRanges = selection && selection.rangeCount
        ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
        : [];
      document.body.appendChild(area);
      let ok = false;
      try {
        area.select();
        area.setSelectionRange(0, area.value.length);
        ok = document.execCommand('copy');
      } catch (err) {
        Log.debug('execCommand copy failed', err);
      } finally {
        area.remove();
        // Restore whatever the user had selected/focused before we hijacked it.
        if (selection && savedRanges.length) {
          safe(() => {
            selection.removeAllRanges();
            savedRanges.forEach((r) => selection.addRange(r));
          }, undefined, 'restore selection');
        }
        if (active && typeof active.focus === 'function') safe(() => active.focus({ preventScroll: true }), undefined, 'restore focus');
      }
      return ok;
    }

    /**
     * @returns {Promise<{ok: boolean, via: string}>}
     */
    async function write(text, options) {
      const opts = options || {};
      const value = String(text == null ? '' : text);
      if (!value) return { ok: false, via: 'none' };

      if (await viaAsyncApi(value, opts.html, opts.rich)) return { ok: true, via: 'async-api' };
      if (GMBridge.setClipboard(value)) return { ok: true, via: 'gm' };
      if (viaTextarea(value)) return { ok: true, via: 'execCommand' };
      return { ok: false, via: 'failed' };
    }

    return { write };
  })();

  /* ======================================================================== *
   * 11. File download (Blob + object URL; no extra userscript privileges)
   * ======================================================================== */

  const Downloader = (() => {
    function sanitizeFilename(name) {
      return String(name || 'leetcode-problem')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80) || 'leetcode-problem';
    }

    function save(content, filename, mime) {
      try {
        const blob = new Blob([content], { type: `${mime || 'text/plain'};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: sanitizeFilename(filename), rel: 'noopener' });
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        // Give the browser a tick to start the download before revoking.
        setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 2000);
        return true;
      } catch (err) {
        Log.warn('download failed', err);
        return false;
      }
    }

    return { save, sanitizeFilename };
  })();

  /* ======================================================================== *
   * 12. Hotkeys
   *
   * Layout-independent (matches KeyboardEvent.code first), never fires while the user is typing
   * — including inside Monaco, LeetCode's code editor.
   * ======================================================================== */

  const Hotkeys = (() => {
    const NAMED_CODES = new Set([
      'Space', 'Escape', 'Enter', 'Comma', 'Period', 'Slash', 'Backslash', 'Semicolon',
      'Quote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
    ]);

    function parse(spec) {
      if (typeof spec !== 'string' || !spec.trim()) return null;
      const parts = spec.split('+').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return null;
      const combo = { ctrl: false, alt: false, shift: false, meta: false, code: '', key: '' };
      for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === 'ctrl' || lower === 'control') combo.ctrl = true;
        else if (lower === 'alt' || lower === 'option') combo.alt = true;
        else if (lower === 'shift') combo.shift = true;
        else if (lower === 'meta' || lower === 'cmd' || lower === 'command') combo.meta = true;
        else {
          if (/^[a-z]$/i.test(part)) { combo.code = `Key${part.toUpperCase()}`; combo.key = part.toUpperCase(); }
          else if (/^[0-9]$/.test(part)) { combo.code = `Digit${part}`; combo.key = part; }
          else if (/^F([1-9]|1[0-2])$/i.test(part)) { combo.code = part.toUpperCase(); combo.key = part.toUpperCase(); }
          else if (NAMED_CODES.has(part)) { combo.code = part; combo.key = part; }
          else return null;
        }
      }
      return combo.code ? combo : null;
    }

    function format(event) {
      const parts = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Meta');
      const code = event.code || '';
      if (/^Key[A-Z]$/.test(code)) parts.push(code.slice(3));
      else if (/^Digit[0-9]$/.test(code)) parts.push(code.slice(5));
      else if (/^F([1-9]|1[0-2])$/.test(code)) parts.push(code);
      else if (NAMED_CODES.has(code)) parts.push(code);
      else return '';
      return parts.join('+');
    }

    function matches(event, combo) {
      if (!combo) return false;
      if (event.ctrlKey !== combo.ctrl || event.altKey !== combo.alt) return false;
      if (event.shiftKey !== combo.shift || event.metaKey !== combo.meta) return false;
      if (event.code && event.code === combo.code) return true;
      // Layout fallback when `code` is unavailable (older engines, virtual keyboards).
      return !event.code && typeof event.key === 'string' && event.key.toUpperCase() === combo.key;
    }

    function isTypingTarget(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      for (const node of path) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (node.isContentEditable) return true;
        const cls = typeof node.className === 'string' ? node.className : '';
        if (cls.includes('monaco-editor') || cls.includes('CodeMirror') || cls.includes('cm-editor')) return true;
        if (node.getAttribute && node.getAttribute('role') === 'textbox') return true;
      }
      return false;
    }

    class Manager {
      constructor() {
        this._bindings = [];
        this._disposer = new Disposer('hotkeys');
        this._attached = false;
        this._onKeyDown = this._onKeyDown.bind(this);
      }

      /** @param {Array<{spec: string, run: Function, allowInEditor?: boolean}>} bindings */
      setBindings(bindings) {
        this._bindings = bindings
          .map((b) => ({ combo: parse(b.spec), run: b.run, allowInEditor: b.allowInEditor === true, spec: b.spec }))
          .filter((b) => b.combo && typeof b.run === 'function');
        if (this._bindings.length && !this._attached) this._attach();
        else if (!this._bindings.length && this._attached) this.detach();
      }

      _attach() {
        this._disposer.listen(window, 'keydown', this._onKeyDown, true);
        this._attached = true;
      }

      _onKeyDown(event) {
        if (!this._bindings.length || event.defaultPrevented || event.isComposing || event.repeat) return;
        const typing = isTypingTarget(event);
        for (const binding of this._bindings) {
          if (!matches(event, binding.combo)) continue;
          if (typing && !binding.allowInEditor) return;
          event.preventDefault();
          event.stopPropagation();
          safe(() => binding.run(event), undefined, `hotkey ${binding.spec}`);
          return;
        }
      }

      detach() {
        this._disposer.dispose();
        this._attached = false;
      }
    }

    return { Manager, format };
  })();

  /* ======================================================================== *
   * 13. UI layer
   *
   * Everything the script renders lives in a shadow root: LeetCode's CSS cannot leak in, our CSS
   * cannot leak out, and the host page cannot accidentally restyle or query our controls.
   * ======================================================================== */

  const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
.layer > * { pointer-events: auto; }

/* ---- toasts ---- */
.toasts { position: fixed; display: flex; flex-direction: column; gap: 8px; max-width: min(360px, 90vw); }
.toasts[data-pos="bottom-right"] { right: 16px; bottom: 16px; align-items: flex-end; }
.toasts[data-pos="bottom-left"] { left: 16px; bottom: 16px; align-items: flex-start; }
.toasts[data-pos="top-right"] { right: 16px; top: 16px; align-items: flex-end; }
.toasts[data-pos="top-left"] { left: 16px; top: 16px; align-items: flex-start; }
.toast {
  display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 10px;
  background: #1f2937; color: #f9fafb; font-size: 13px; line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0,0,0,.28); border-left: 3px solid var(--accent, #0CB345);
  animation: slide-in .16s ease-out;
}
.toast[data-kind="error"] { border-left-color: #ef4444; }
.toast[data-kind="warn"] { border-left-color: #f59e0b; }
.toast .t-msg { flex: 1; word-break: break-word; }
.toast .t-sub { display: block; opacity: .7; font-size: 11px; margin-top: 2px; }
.toast button {
  background: none; border: 0; color: inherit; opacity: .6; cursor: pointer; font-size: 14px;
  line-height: 1; padding: 2px 4px; border-radius: 4px;
}
.toast button:hover { opacity: 1; background: rgba(255,255,255,.12); }
@keyframes slide-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.reduced .toast { animation: none; }

/* ---- popup menu ---- */
.menu {
  position: fixed; min-width: 208px; max-width: 300px; padding: 6px; border-radius: 10px;
  background: #ffffff; color: #16181d; border: 1px solid rgba(0,0,0,.12);
  box-shadow: 0 12px 32px rgba(0,0,0,.18); font-size: 13px;
}
.dark .menu { background: #282828; color: #eff1f6; border-color: rgba(255,255,255,.14); }
.menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 9px; border: 0;
  border-radius: 7px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.menu-item:hover, .menu-item:focus-visible { background: rgba(12,179,69,.12); outline: none; }
.menu-item[disabled] { opacity: .45; cursor: not-allowed; }
.menu-item .m-key { margin-left: auto; opacity: .55; font-size: 11px; font-variant-numeric: tabular-nums; }
.menu-sep { height: 1px; margin: 5px 4px; background: rgba(128,128,128,.24); }
.menu-label { padding: 6px 9px 3px; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .55; }

/* ---- modal ---- */
.backdrop { position: fixed; inset: 0; background: rgba(15,17,21,.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal {
  width: min(860px, 100%); max-height: min(86vh, 780px); display: flex; flex-direction: column;
  background: #ffffff; color: #16181d; border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,.36); font-size: 13.5px;
}
.dark .modal { background: #1f1f1f; color: #eff1f6; }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid rgba(128,128,128,.22); }
.modal-title { font-size: 15px; font-weight: 600; margin: 0; }
.modal-badge { font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--accent, #0CB345); color: var(--accent, #0CB345); }
.modal-close { margin-left: auto; background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: inherit; opacity: .6; padding: 4px 8px; border-radius: 6px; }
.modal-close:hover { opacity: 1; background: rgba(128,128,128,.16); }
.modal-body { display: flex; min-height: 0; flex: 1; }
.tabs { display: flex; flex-direction: column; gap: 2px; padding: 12px 8px; border-right: 1px solid rgba(128,128,128,.22); min-width: 148px; overflow-y: auto; }
.tab { text-align: left; padding: 7px 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
.tab:hover { background: rgba(128,128,128,.14); }
.tab[aria-selected="true"] { background: var(--accent, #0CB345); color: #fff; font-weight: 600; }
.panes { flex: 1; overflow-y: auto; padding: 16px 20px 24px; min-width: 0; }
.pane[hidden] { display: none; }
.section-title { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; opacity: .6; margin: 4px 0 10px; }
.row { display: flex; align-items: flex-start; gap: 14px; padding: 9px 0; border-bottom: 1px solid rgba(128,128,128,.14); }
.row:last-child { border-bottom: 0; }
.row-main { flex: 1; min-width: 0; }
.row-label { display: block; font-weight: 500; }
.row-help { display: block; margin-top: 2px; font-size: 11.5px; opacity: .62; line-height: 1.45; }
.row-control { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
input[type="text"], input[type="number"], select, textarea {
  font: inherit; padding: 5px 8px; border-radius: 7px; border: 1px solid rgba(128,128,128,.42);
  background: rgba(128,128,128,.06); color: inherit; max-width: 100%;
}
.dark input[type="text"], .dark input[type="number"], .dark select, .dark textarea { background: rgba(255,255,255,.06); }
input[type="number"] { width: 92px; }
input[type="text"] { width: 190px; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--accent, #0CB345); outline-offset: 1px; }
textarea { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; resize: vertical; }
input[type="color"] { width: 40px; height: 28px; padding: 0; border: 1px solid rgba(128,128,128,.42); border-radius: 6px; background: none; cursor: pointer; }
.switch { position: relative; width: 40px; height: 22px; flex: none; }
.switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch span { position: absolute; inset: 0; background: rgba(128,128,128,.42); border-radius: 999px; transition: background .15s; pointer-events: none; }
.switch span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
.switch input:checked + span { background: var(--accent, #0CB345); }
.switch input:checked + span::after { transform: translateX(18px); }
.switch input:focus-visible + span { outline: 2px solid var(--accent, #0CB345); outline-offset: 2px; }
.reduced .switch span, .reduced .switch span::after { transition: none; }
.btn {
  font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(128,128,128,.42); background: rgba(128,128,128,.08); color: inherit;
}
.btn:hover { background: rgba(128,128,128,.18); }
.btn.primary { background: var(--accent, #0CB345); border-color: var(--accent, #0CB345); color: #fff; }
.btn.danger { border-color: #ef4444; color: #ef4444; }
.btn.danger:hover { background: rgba(239,68,68,.12); }
.btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.grid-formats { display: grid; grid-template-columns: 1.1fr auto auto 1fr 1fr; gap: 8px 10px; align-items: center; }
.grid-formats .head { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; opacity: .55; }
.hint { font-size: 11.5px; opacity: .62; line-height: 1.5; margin: 8px 0 0; }
.token-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.token {
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; padding: 2px 6px;
  border-radius: 5px; background: rgba(12,179,69,.14); color: var(--accent, #0CB345); cursor: pointer; border: 0;
}
.token:hover { background: rgba(12,179,69,.28); }
.hist { display: flex; flex-direction: column; gap: 8px; }
.hist-item { border: 1px solid rgba(128,128,128,.22); border-radius: 9px; padding: 9px 11px; }
.hist-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.hist-title { font-weight: 600; }
.hist-meta { font-size: 11px; opacity: .6; margin-left: auto; }
.hist-prev { font-size: 11.5px; opacity: .72; margin-top: 5px; word-break: break-word; max-height: 3.2em; overflow: hidden; }
.hist-actions { display: flex; gap: 6px; margin-top: 8px; }
.empty { opacity: .6; padding: 22px 0; text-align: center; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 12.5px; }
.kv dt { opacity: .6; }
.kv dd { margin: 0; font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
.warn-box { border: 1px solid #f59e0b; background: rgba(245,158,11,.1); border-radius: 8px; padding: 9px 11px; font-size: 12px; margin-bottom: 12px; }
`;

  const BAR_CSS = `
:host { all: initial; display: inline-flex; vertical-align: middle; }
.bar { display: inline-flex; align-items: center; gap: var(--gap, 8px); font-family: inherit; }
button {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: var(--fs, 10px); line-height: 1.3; padding: 4px 8px; cursor: pointer; text-align: center;
  border-radius: 12px; border: 1px solid var(--accent, #0CB345); background: transparent;
  color: var(--accent, #0CB345); transition: background-color .12s ease, color .12s ease;
  white-space: nowrap; user-select: none;
}
button:hover, button:focus-visible { background: var(--accent, #0CB345); color: var(--fg, #fff); outline: none; }
button:focus-visible { box-shadow: 0 0 0 2px rgba(12,179,69,.35); }
button[data-busy="true"] { background: var(--accent, #0CB345); color: var(--fg, #fff); }
button[disabled] { opacity: .5; cursor: progress; }
.icon { padding: 4px 6px; font-size: calc(var(--fs, 10px) + 2px); }
:host([data-theme="native"]) button { border-radius: 6px; font-size: 12px; padding: 4px 10px; }
:host([data-theme="minimal"]) button { border-color: transparent; padding: 2px 5px; text-decoration: underline; }
:host([data-theme="minimal"]) button:hover { background: transparent; color: var(--accent, #0CB345); text-decoration: none; }
.reduced button { transition: none; }
`;

  const Overlay = (() => {
    let host = null;
    let root = null;
    let layer = null;
    let toastBox = null;

    function isDarkSite() {
      const html = document.documentElement;
      if (!html) return false;
      if (html.classList.contains('dark')) return true;
      const theme = html.getAttribute('data-theme') || (document.body && document.body.getAttribute('data-theme'));
      if (theme && /dark/i.test(theme)) return true;
      return safe(() => window.matchMedia('(prefers-color-scheme: dark)').matches, false, 'matchMedia');
    }

    function prefersReducedMotion() {
      return safe(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, false, 'matchMedia');
    }

    function ensure() {
      if (host && host.isConnected) { syncTheme(); return { root, layer, toastBox }; }
      host = el('div', { id: 'clip-leetcode-overlay' });
      host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;';
      root = host.attachShadow({ mode: 'open' });
      root.appendChild(el('style', { text: OVERLAY_CSS }));
      layer = el('div', { class: 'layer' });
      toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      layer.appendChild(toastBox);
      root.appendChild(layer);
      // documentElement, not body: survives frameworks that replace <body> children wholesale.
      (document.documentElement || document.body).appendChild(host);
      syncTheme();
      return { root, layer, toastBox };
    }

    function syncTheme() {
      if (!layer) return;
      const settings = Settings.get();
      layer.classList.toggle('dark', isDarkSite());
      layer.classList.toggle('reduced', settings.ui.respectReducedMotion && prefersReducedMotion());
      layer.style.setProperty('--accent', settings.ui.accentColor);
      if (toastBox) toastBox.dataset.pos = settings.ui.toastPosition;
    }

    function destroy() {
      if (host) host.remove();
      host = null; root = null; layer = null; toastBox = null;
    }

    return { ensure, syncTheme, destroy, isDarkSite, prefersReducedMotion, get layer() { return layer; } };
  })();

  const Toast = (() => {
    const active = new Set();

    function dismiss(node) {
      if (!active.has(node)) return;
      active.delete(node);
      node.remove();
    }

    /** @param {{kind?: 'info'|'error'|'warn', detail?: string, ms?: number}} [options] */
    function show(message, options) {
      const opts = options || {};
      const settings = Settings.get();
      const mode = settings.ui.notifications;
      const kind = opts.kind || 'info';
      if (mode === 'none') return null;
      if (mode === 'errors' && kind === 'info') return null;

      const { toastBox } = Overlay.ensure();
      Overlay.syncTheme();

      const body = el('div', { class: 't-msg', text: String(message) });
      if (opts.detail) body.appendChild(el('span', { class: 't-sub', text: String(opts.detail) }));
      const node = el('div', { class: 'toast', dataset: { kind } }, [
        body,
        el('button', { type: 'button', 'aria-label': 'Dismiss', text: '\u00d7', onclick: () => dismiss(node) })
      ]);

      toastBox.appendChild(node);
      active.add(node);
      // Cap on-screen toasts so a stuck loop cannot fill the viewport.
      while (toastBox.children.length > 4) dismiss(toastBox.firstElementChild);

      const ms = clamp(Number(opts.ms) || settings.ui.toastMs, 800, 15000);
      setTimeout(() => dismiss(node), ms);
      return node;
    }

    function clear() { active.forEach(dismiss); }

    return { show, clear };
  })();

  const PopupMenu = (() => {
    let current = null;
    let disposer = null;

    function close() {
      if (!current) return;
      current.remove();
      current = null;
      if (disposer) { disposer.dispose(); disposer = null; }
    }

    /**
     * @param {DOMRect} anchorRect
     * @param {Array<{type?: 'item'|'sep'|'label', label?: string, hint?: string, disabled?: boolean, run?: Function}>} items
     */
    function open(anchorRect, items) {
      close();
      const { layer } = Overlay.ensure();
      Overlay.syncTheme();
      const menu = el('div', { class: 'menu', role: 'menu', tabindex: '-1' });

      for (const item of items) {
        if (item.type === 'sep') { menu.appendChild(el('div', { class: 'menu-sep' })); continue; }
        if (item.type === 'label') { menu.appendChild(el('div', { class: 'menu-label', text: item.label })); continue; }
        const button = el('button', {
          class: 'menu-item', type: 'button', role: 'menuitem', disabled: item.disabled === true,
          onclick: () => { close(); safe(() => item.run && item.run(), undefined, 'menu action'); }
        }, [el('span', { text: item.label })]);
        if (item.hint) button.appendChild(el('span', { class: 'm-key', text: item.hint }));
        menu.appendChild(button);
      }

      layer.appendChild(menu);
      current = menu;

      // Position within the viewport, flipping when there is not enough room.
      const rect = menu.getBoundingClientRect();
      const margin = 8;
      let left = clamp(anchorRect.left, margin, Math.max(margin, window.innerWidth - rect.width - margin));
      let top = anchorRect.bottom + 6;
      if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - rect.height - 6);
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

      disposer = new Disposer('menu');
      // `setTimeout` so the click that opened the menu does not immediately close it.
      disposer.timeout(() => {
        disposer.listen(window, 'pointerdown', (e) => {
          if (!menu.contains(e.composedPath ? e.composedPath()[0] : e.target)) close();
        }, true);
      }, 0);
      disposer.listen(window, 'keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
      }, true);
      disposer.listen(window, 'scroll', close, { passive: true, capture: true });
      disposer.listen(window, 'resize', close, { passive: true });

      const first = menu.querySelector('.menu-item:not([disabled])');
      if (first) first.focus({ preventScroll: true });
      return menu;
    }

    return { open, close, get isOpen() { return Boolean(current); } };
  })();

  /* ---------------------------------------------------------------------- *
   * 13a. Button bar mounted next to the problem title
   * ---------------------------------------------------------------------- */

  class ButtonBar {
    /** @param {{onCopy: Function, onMenu: Function, onSettings: Function}} handlers */
    constructor(handlers) {
      this.handlers = handlers;
      this.host = null;
      this.shadow = null;
      this.bar = null;
      this.buttons = new Map();
      this._restore = null;
      this._labelTimers = new Map();
      this._disposer = new Disposer('button-bar');
    }

    get isMounted() { return Boolean(this.host && this.host.isConnected); }

    /** Anchors relative to the title node based on layout strategy. */
    mount(titleNode, strategy) {
      this.unmount();
      const parent = titleNode && titleNode.parentElement;
      if (!parent) return false;

      this.host = el('div', { id: 'clip-leetcode-bar', 'data-clip-leetcode': 'bar' });
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.appendChild(el('style', { text: BAR_CSS }));
      this.bar = el('div', { class: 'bar', role: 'group', 'aria-label': 'Clip LeetCode actions' });
      this.shadow.appendChild(this.bar);

      if (strategy === 'absolute-right') {
        // Absolutely positioned at the top-right of the title's parent.
        const computed = safe(() => getComputedStyle(parent).position, 'static', 'computed style');
        if (computed === 'static') {
          const previous = parent.style.position;
          parent.style.position = 'relative';
          this._restore = () => { parent.style.position = previous; };
        }
        this.host.style.cssText = 'position:absolute;top:1rem;right:0;display:flex;align-items:center;';
      } else if (strategy === 'inline-tailwind') {
        ['mt-1', 'inline-flex', 'min-h-20px', 'items-center', 'space-x-2', 'align-top']
          .forEach((c) => this.host.classList.add(c));
      } else {
        this.host.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;';
      }

      parent.appendChild(this.host);
      this.applySettings();
      return true;
    }

    applySettings() {
      if (!this.isMounted) return;
      const s = Settings.get();
      this.host.dataset.theme = s.ui.buttonTheme;
      this.bar.style.setProperty('--accent', s.ui.accentColor);
      this.bar.style.setProperty('--fg', s.ui.textColor);
      this.bar.style.setProperty('--gap', `${s.ui.gapPx}px`);
      this.bar.style.setProperty('--fs', `${s.ui.fontSizePx}px`);
      this.bar.classList.toggle('reduced', s.ui.respectReducedMotion && Overlay.prefersReducedMotion());
      this.render();
    }

    render() {
      if (!this.isMounted) return;
      const s = Settings.get();
      this._labelTimers.forEach((t) => clearTimeout(t));
      this._labelTimers.clear();
      this.buttons.clear();
      this.bar.textContent = '';

      if (!s.ui.showButtons) { this.host.style.display = 'none'; return; }
      this.host.style.display = '';

      for (const id of FORMAT_IDS) {
        const cfg = s.formats[id];
        if (!cfg || !cfg.enabled || !cfg.button) continue;
        const label = cfg.label || FORMAT_META[id].name;
        const hint = cfg.hotkey ? ` (${cfg.hotkey})` : '';
        const button = el('button', {
          type: 'button',
          title: `Copy this problem as ${FORMAT_META[id].name}${hint}`,
          'aria-label': `${label}${hint}`,
          dataset: { format: id },
          text: label,
          onclick: (e) => { e.preventDefault(); this.handlers.onCopy(id, { source: 'button' }); }
        });
        this.bar.appendChild(button);
        this.buttons.set(id, { node: button, label });
      }

      if (s.ui.showFormatMenu) {
        const more = el('button', {
          type: 'button', class: 'icon', title: 'More clip formats and actions',
          'aria-label': 'More clip formats and actions', 'aria-haspopup': 'menu', text: '\u22ef',
          onclick: (e) => { e.preventDefault(); this.handlers.onMenu(e.currentTarget.getBoundingClientRect()); }
        });
        this.bar.appendChild(more);
      }

      if (s.ui.showSettingsButton) {
        const gear = el('button', {
          type: 'button', class: 'icon', title: 'Clip LeetCode settings',
          'aria-label': 'Clip LeetCode settings', text: '\u2699',
          onclick: (e) => { e.preventDefault(); this.handlers.onSettings(); }
        });
        this.bar.appendChild(gear);
      }
    }

    /** Transient per-button feedback — "Copied!" label swap. */
    flash(formatId, text, kind) {
      const entry = this.buttons.get(formatId);
      if (!entry) return;
      const s = Settings.get();
      const previous = this._labelTimers.get(formatId);
      if (previous) clearTimeout(previous);
      entry.node.textContent = text || s.ui.copiedLabel;
      entry.node.dataset.busy = kind === 'error' ? 'false' : 'true';
      const timer = setTimeout(() => {
        if (!entry.node.isConnected) return;
        entry.node.textContent = entry.label;
        delete entry.node.dataset.busy;
        this._labelTimers.delete(formatId);
      }, s.ui.copiedLabelMs);
      this._labelTimers.set(formatId, timer);
    }

    setBusy(formatId, busy) {
      const entry = this.buttons.get(formatId);
      if (entry) entry.node.disabled = Boolean(busy);
    }

    unmount() {
      this._labelTimers.forEach((t) => clearTimeout(t));
      this._labelTimers.clear();
      this.buttons.clear();
      if (this._restore) { safe(this._restore, undefined, 'restore parent style'); this._restore = null; }
      if (this.host) this.host.remove();
      this.host = null; this.shadow = null; this.bar = null;
      this._disposer.dispose();
    }
  }

  /* ---------------------------------------------------------------------- *
   * 13b. Settings / history panel
   * ---------------------------------------------------------------------- */

  const Panel = (() => {
    let api = { remount: () => {}, diagnostics: () => ({}) };
    let backdrop = null;
    let modal = null;
    let disposer = null;
    let activeTab = 'general';
    let unsubscribe = null;
    let lastFocused = null;

    function init(injected) { api = Object.assign(api, injected); }

    /* --- control factory --- */

    function row(label, help, controlNode) {
      return el('div', { class: 'row' }, [
        el('div', { class: 'row-main' }, [
          el('label', { class: 'row-label', text: label }),
          help ? el('span', { class: 'row-help', text: help }) : null
        ]),
        el('div', { class: 'row-control' }, [controlNode])
      ]);
    }

    function commit(path, value) {
      Settings.setPath(path, value).catch((err) => {
        Log.error('failed to save setting', path, err);
        Toast.show('Could not save that setting.', { kind: 'error' });
      });
    }

    function ctlToggle(desc) {
      const checked = Settings.getPath(desc.path) === true;
      const input = el('input', {
        type: 'checkbox', checked, 'aria-label': desc.label,
        onchange: (e) => { commit(desc.path, e.currentTarget.checked); if (desc.rerender) renderTab(); }
      });
      return row(desc.label, desc.help, el('span', { class: 'switch' }, [input, el('span')]));
    }

    function ctlSelect(desc) {
      const value = Settings.getPath(desc.path);
      const node = el('select', {
        'aria-label': desc.label,
        onchange: (e) => { commit(desc.path, e.currentTarget.value); if (desc.rerender) renderTab(); }
      }, desc.options.map(([val, text]) => el('option', { value: val, text, selected: val === value })));
      return row(desc.label, desc.help, node);
    }

    function ctlNumber(desc) {
      const node = el('input', {
        type: 'number', value: String(Settings.getPath(desc.path)),
        min: String(desc.min), max: String(desc.max), step: String(desc.step || 1), 'aria-label': desc.label,
        onchange: (e) => {
          const parsed = clamp(parseInt(e.currentTarget.value, 10) || 0, desc.min, desc.max);
          e.currentTarget.value = String(parsed);
          commit(desc.path, parsed);
        }
      });
      return row(desc.label, desc.help, node);
    }

    function ctlText(desc) {
      const node = el('input', {
        type: 'text', value: String(Settings.getPath(desc.path) || ''),
        maxlength: String(desc.max || 60), placeholder: desc.placeholder || '', 'aria-label': desc.label,
        onchange: (e) => commit(desc.path, e.currentTarget.value)
      });
      return row(desc.label, desc.help, node);
    }

    function ctlColor(desc) {
      const value = String(Settings.getPath(desc.path) || '#000000');
      const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#0cb345';
      const picker = el('input', {
        type: 'color', value: hex, 'aria-label': desc.label,
        oninput: (e) => { field.value = e.currentTarget.value; commit(desc.path, e.currentTarget.value); }
      });
      const field = el('input', {
        type: 'text', value, style: { width: '110px' }, 'aria-label': `${desc.label} value`,
        onchange: (e) => {
          const next = e.currentTarget.value.trim();
          if (!COLOR_RE.test(next)) { e.currentTarget.value = Settings.getPath(desc.path); return; }
          if (/^#[0-9a-f]{6}$/i.test(next)) picker.value = next;
          commit(desc.path, next);
        }
      });
      return row(desc.label, desc.help, el('span', { class: 'row-control' }, [picker, field]));
    }

    function ctlHotkey(desc) {
      const node = el('input', {
        type: 'text', readonly: true, value: String(Settings.getPath(desc.path) || ''),
        placeholder: 'Click, then press keys', style: { width: '160px', cursor: 'pointer' },
        'aria-label': `${desc.label} shortcut`,
        onkeydown: (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') { e.currentTarget.blur(); return; }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.currentTarget.value = '';
            commit(desc.path, '');
            return;
          }
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
          const combo = Hotkeys.format(e);
          if (!combo) return;
          if (!/\+/.test(combo)) {
            Toast.show('Use at least one modifier (Ctrl, Alt, Shift or Meta).', { kind: 'warn' });
            return;
          }
          e.currentTarget.value = combo;
          commit(desc.path, combo);
        }
      });
      return desc.bare ? node : row(desc.label, desc.help, node);
    }

    function ctlTextarea(desc) {
      const save = debounce((value) => commit(desc.path, value), 400);
      const node = el('textarea', {
        rows: String(desc.rows || 8), spellcheck: 'false', 'aria-label': desc.label,
        oninput: (e) => save(e.currentTarget.value)
      });
      node.value = String(Settings.getPath(desc.path) || '');
      const wrapper = el('div', { class: 'row-main' }, [
        el('label', { class: 'row-label', text: desc.label }),
        desc.help ? el('span', { class: 'row-help', text: desc.help }) : null,
        el('div', { style: { marginTop: '7px' } }, [node]),
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn', type: 'button', text: 'Reset to default',
            onclick: () => {
              save.cancel();
              node.value = DEFAULT_TEMPLATES[desc.key];
              commit(desc.path, DEFAULT_TEMPLATES[desc.key]);
            }
          }),
          el('button', {
            class: 'btn', type: 'button', text: 'Insert token\u2026',
            onclick: (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              PopupMenu.open(rect, Template.tokenNames().map((name) => ({
                label: `{{${name}}}`,
                run: () => {
                  const start = node.selectionStart || 0;
                  const end = node.selectionEnd || 0;
                  node.value = `${node.value.slice(0, start)}{{${name}}}${node.value.slice(end)}`;
                  node.focus();
                  node.setSelectionRange(start + name.length + 4, start + name.length + 4);
                  save(node.value);
                }
              })));
            }
          })
        ])
      ]);
      return el('div', { class: 'row' }, [wrapper]);
    }

    function build(desc) {
      switch (desc.type) {
        case 'toggle': return ctlToggle(desc);
        case 'select': return ctlSelect(desc);
        case 'number': return ctlNumber(desc);
        case 'text': return ctlText(desc);
        case 'color': return ctlColor(desc);
        case 'hotkey': return ctlHotkey(desc);
        case 'textarea': return ctlTextarea(desc);
        case 'title': return el('div', { class: 'section-title', text: desc.label });
        default: return el('div');
      }
    }

    /* --- tab definitions --- */

    const TABS = [
      { id: 'general', label: 'General' },
      { id: 'formats', label: 'Formats' },
      { id: 'content', label: 'Content' },
      { id: 'markdown', label: 'Markdown' },
      { id: 'templates', label: 'Templates' },
      { id: 'shortcuts', label: 'Shortcuts' },
      { id: 'automation', label: 'Automation' },
      { id: 'history', label: 'History' },
      { id: 'data', label: 'Data' },
      { id: 'about', label: 'About' }
    ];

    function generalPane() {
      return [
        { type: 'title', label: 'Behaviour' },
        { type: 'toggle', path: 'enabled', label: 'Enable Clip LeetCode', help: 'Turn the whole script off without uninstalling it. Takes effect immediately.' },
        { type: 'select', path: 'ui.notifications', label: 'Notifications', options: [['all', 'All (success + errors)'], ['errors', 'Errors only'], ['none', 'None']], help: 'Buttons always show the inline "Copied!" confirmation regardless of this setting.' },
        { type: 'select', path: 'ui.toastPosition', label: 'Notification position', options: [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left']] },
        { type: 'number', path: 'ui.toastMs', label: 'Notification duration (ms)', min: 800, max: 15000, step: 100 },
        { type: 'select', path: 'logLevel', label: 'Console log level', options: [['silent', 'Silent'], ['error', 'Errors'], ['warn', 'Warnings (default)'], ['info', 'Info'], ['debug', 'Debug']] },
        { type: 'title', label: 'Appearance' },
        { type: 'toggle', path: 'ui.showButtons', label: 'Show buttons on the problem page', help: 'When off, use hotkeys or the userscript menu instead.' },
        { type: 'select', path: 'ui.buttonTheme', label: 'Button style', options: [['classic', 'Classic'], ['native', 'Native (LeetCode-like)'], ['minimal', 'Minimal (text links)']] },
        { type: 'color', path: 'ui.accentColor', label: 'Accent colour', help: 'Default #0CB345, emerald green.' },
        { type: 'color', path: 'ui.textColor', label: 'Hover text colour' },
        { type: 'text', path: 'ui.copiedLabel', label: 'Confirmation label', max: 40, placeholder: 'Copied!' },
        { type: 'number', path: 'ui.copiedLabelMs', label: 'Confirmation duration (ms)', min: 200, max: 10000, step: 100 },
        { type: 'number', path: 'ui.fontSizePx', label: 'Button font size (px)', min: 8, max: 20 },
        { type: 'number', path: 'ui.gapPx', label: 'Button spacing (px)', min: 0, max: 64 },
        { type: 'toggle', path: 'ui.showFormatMenu', label: 'Show the "\u22ef" format menu' },
        { type: 'toggle', path: 'ui.showSettingsButton', label: 'Show the settings gear' },
        { type: 'toggle', path: 'ui.respectReducedMotion', label: 'Respect prefers-reduced-motion' }
      ].map(build);
    }

    function formatsPane() {
      const s = Settings.get();
      const grid = el('div', { class: 'grid-formats' }, [
        el('div', { class: 'head', text: 'Format' }),
        el('div', { class: 'head', text: 'On' }),
        el('div', { class: 'head', text: 'Button' }),
        el('div', { class: 'head', text: 'Label' }),
        el('div', { class: 'head', text: 'Shortcut' })
      ]);

      for (const id of FORMAT_IDS) {
        const cfg = s.formats[id];
        grid.appendChild(el('div', {}, [
          el('strong', { text: FORMAT_META[id].name }),
          el('div', { class: 'row-help', text: `.${FORMAT_META[id].ext}` })
        ]));
        grid.appendChild(el('span', { class: 'switch' }, [
          el('input', {
            type: 'checkbox', checked: cfg.enabled, 'aria-label': `${FORMAT_META[id].name} enabled`,
            onchange: (e) => commit(`formats.${id}.enabled`, e.currentTarget.checked)
          }),
          el('span')
        ]));
        grid.appendChild(el('span', { class: 'switch' }, [
          el('input', {
            type: 'checkbox', checked: cfg.button, 'aria-label': `${FORMAT_META[id].name} shown as a button`,
            onchange: (e) => commit(`formats.${id}.button`, e.currentTarget.checked)
          }),
          el('span')
        ]));
        grid.appendChild(el('input', {
          type: 'text', value: cfg.label, maxlength: '32', style: { width: '100%' },
          'aria-label': `${FORMAT_META[id].name} button label`,
          onchange: (e) => commit(`formats.${id}.label`, e.currentTarget.value)
        }));
        grid.appendChild(ctlHotkey({ path: `formats.${id}.hotkey`, label: FORMAT_META[id].name, bare: true }));
      }

      return [
        el('div', { class: 'section-title', text: 'Clip formats' }),
        grid,
        el('p', { class: 'hint', text: 'Disabled formats are hidden everywhere (buttons, menu, hotkeys, automation).' })
      ];
    }

    function contentPane() {
      return [
        { type: 'title', label: 'What gets clipped' },
        { type: 'select', path: 'content.titleMode', label: 'Title', options: [['as-shown', 'Exactly as shown on the page'], ['with-id', 'Force "123. Title"'], ['strip-id', 'Strip the leading number']] },
        { type: 'select', path: 'content.textEngine', label: 'Plain-text source', options: [['textContent', 'textContent (default)'], ['innerText', 'innerText (respects layout, skips collapsed blocks)'], ['markdown', 'Rendered Markdown']] },
        { type: 'toggle', path: 'content.excludeCollapsedSections', label: 'Skip Topics / Companies / Hints accordions', help: 'Excludes collapsible blocks at the end of the description.' },
        { type: 'number', path: 'content.maxBlankLines', label: 'Max consecutive blank lines', min: 0, max: 5 },
        { type: 'toggle', path: 'content.nbspToSpace', label: 'Convert non-breaking spaces to spaces', help: 'Replaces non-breaking space entities with standard spaces.' },
        { type: 'toggle', path: 'content.trimTrailingSpaces', label: 'Trim trailing whitespace' },
        { type: 'title', label: 'Enrichment (same-origin LeetCode API)' },
        { type: 'toggle', path: 'content.fetchMetadata', label: 'Fetch problem metadata', help: 'Adds difficulty, tags, acceptance rate, hints and starter code. Cached locally for 6 hours. Also lets you clip from the Solutions/Submissions tab.' },
        { type: 'toggle', path: 'content.includeHints', label: 'Append hints' },
        { type: 'toggle', path: 'content.includeSimilar', label: 'Append similar questions' },
        { type: 'toggle', path: 'content.includeSnippet', label: 'Include starter code snippet', help: 'Used by the {{snippet}} template token.' },
        { type: 'text', path: 'content.snippetLanguage', label: 'Snippet language slug', max: 24, placeholder: 'python3', help: 'e.g. python3, cpp, java, javascript, golang, rust.' }
      ].map(build);
    }

    function markdownPane() {
      return [
        { type: 'title', label: 'Markdown conversion' },
        { type: 'select', path: 'markdown.engine', label: 'Engine', options: [['dom', 'DOM converter (recommended)'], ['legacy', 'Legacy regex pipeline']], help: 'Legacy uses regular expressions for conversion.', rerender: true },
        { type: 'select', path: 'markdown.inlineCode', label: 'Inline code', options: [['backtick', 'Backticks `code`'], ['html', 'Keep <code> tags'], ['plain', 'Plain text']] },
        { type: 'text', path: 'markdown.codeFenceLang', label: 'Code fence language', max: 24, placeholder: '(auto)', help: 'Left empty, the converter uses any language-* class it finds.' },
        { type: 'select', path: 'markdown.listBullet', label: 'Bullet character', options: [['-', '-'], ['*', '*'], ['+', '+']] },
        { type: 'select', path: 'markdown.underline', label: 'Underlined text', options: [['plain', 'Drop the underline'], ['html', 'Keep <u> tags'], ['italic', 'Convert to italics']] },
        { type: 'select', path: 'markdown.superscript', label: 'Superscript', options: [['caret', 'Caret: 10^9'], ['html', 'Keep <sup> tags'], ['plain', 'Plain text']] },
        { type: 'toggle', path: 'markdown.convertTables', label: 'Convert tables to GitHub-flavoured Markdown' },
        { type: 'select', path: 'markdown.images', label: 'Images', options: [['markdown', 'Markdown image links'], ['alt', 'Alt text only'], ['skip', 'Remove']] },
        { type: 'toggle', path: 'markdown.absolutizeLinks', label: 'Make links absolute', help: 'Turns /problems/two-sum/ into a full URL so the clip works anywhere.' },
        { type: 'toggle', path: 'markdown.preAsFence', label: 'Examples as fenced code blocks', help: 'Off: indent example blocks with four spaces instead.' },
        { type: 'toggle', path: 'markdown.escapeSpecials', label: 'Escape Markdown special characters', help: 'Safer round-tripping, noisier output. Off by default.' }
      ].map(build);
    }

    function templatesPane() {
      const tokens = el('div', { class: 'token-list' }, Template.tokenNames().map((name) => el('button', {
        class: 'token', type: 'button', text: `{{${name}}}`, title: `Copy {{${name}}} to the clipboard`,
        onclick: () => Clipboard.write(`{{${name}}}`).then((r) => {
          if (r.ok) Toast.show(`Copied {{${name}}}`, { kind: 'info' });
        })
      })));

      return [
        el('div', { class: 'section-title', text: 'Output templates' }),
        el('p', { class: 'hint', text: 'A line whose placeholders all resolve to nothing is removed automatically, so one template works with or without metadata.' }),
        tokens,
        ctlTextarea({ path: 'templates.text', key: 'text', label: 'Plain text', rows: 4, help: 'Default template for plain text.' }),
        ctlTextarea({ path: 'templates.markdown', key: 'markdown', label: 'Markdown', rows: 4, help: 'Default template for Markdown.' }),
        ctlTextarea({ path: 'templates.custom', key: 'custom', label: 'Custom note', rows: 14, help: 'Your own study-note layout, available as the "Copy Note" format.' })
      ];
    }

    function shortcutsPane() {
      return [
        { type: 'title', label: 'Keyboard' },
        { type: 'toggle', path: 'shortcuts.enabled', label: 'Enable keyboard shortcuts' },
        { type: 'toggle', path: 'shortcuts.allowInEditor', label: 'Allow while typing in the code editor', help: 'Off by default so shortcuts never interfere with Monaco.' },
        { type: 'hotkey', path: 'shortcuts.openSettings', label: 'Open settings' },
        { type: 'hotkey', path: 'shortcuts.openHistory', label: 'Open clip history' },
        { type: 'hotkey', path: 'shortcuts.lastFormat', label: 'Repeat last clip format' },
        { type: 'hotkey', path: 'shortcuts.cycleFormat', label: 'Cycle through enabled formats' }
      ].map(build).concat([
        el('p', { class: 'hint', text: 'Per-format shortcuts live on the Formats tab. Shortcuts are matched by physical key, so they work on any keyboard layout.' })
      ]);
    }

    function automationPane() {
      return [
        { type: 'title', label: 'Automation' },
        { type: 'toggle', path: 'automation.autoCopyOnOpen', label: 'Auto-copy when a problem opens', help: 'Runs once the description is ready, including after in-app navigation.' },
        { type: 'select', path: 'automation.autoCopyFormat', label: 'Auto-copy format', options: FORMAT_IDS.map((id) => [id, FORMAT_META[id].name]) },
        { type: 'number', path: 'automation.autoCopyDelayMs', label: 'Auto-copy delay (ms)', min: 0, max: 15000, step: 100 },
        { type: 'toggle', path: 'automation.autoCopyOncePerProblem', label: 'Only once per problem per session' },
        { type: 'toggle', path: 'automation.copyOnSelectionOnly', label: 'Clip the selection when text is selected', help: 'If you highlight part of the description, only that part is clipped.' },
        { type: 'title', label: 'Clipboard' },
        { type: 'toggle', path: 'advanced.richHtmlClipboard', label: 'Also place rich HTML on the clipboard', help: 'Lets Notion / Google Docs / Word paste formatted content. Plain text is always included.' },
        { type: 'toggle', path: 'advanced.downloadEnabled', label: 'Enable "Save as file" actions' },
        { type: 'title', label: 'Runtime' },
        { type: 'toggle', path: 'advanced.syncAcrossTabs', label: 'Sync settings across tabs', help: 'Requires a userscript manager with value-change listeners. Applies on reload.' },
        { type: 'number', path: 'advanced.mountTimeoutMs', label: 'Give up waiting for the page after (ms)', min: 2000, max: 120000, step: 1000 }
      ].map(build);
    }

    async function historyPane() {
      const entries = await History.all();
      if (!entries.length) {
        return [el('div', { class: 'empty', text: 'No clips yet. Copy a problem and it will appear here.' })];
      }
      const list = el('div', { class: 'hist' });
      for (const entry of entries) {
        list.appendChild(el('div', { class: 'hist-item' }, [
          el('div', { class: 'hist-top' }, [
            el('span', { class: 'hist-title', text: entry.title || entry.slug || 'Untitled' }),
            el('span', { class: 'modal-badge', text: FORMAT_META[entry.formatId] ? FORMAT_META[entry.formatId].name : entry.formatId }),
            el('span', { class: 'hist-meta', text: `${relativeTime(entry.ts)} \u00b7 ${entry.chars.toLocaleString()} chars` })
          ]),
          el('div', { class: 'hist-prev', text: entry.preview || '(no preview stored)' }),
          el('div', { class: 'hist-actions' }, [
            el('button', {
              class: 'btn', type: 'button', text: 'Copy again', disabled: !entry.body,
              onclick: async () => {
                const result = await Clipboard.write(entry.body);
                Toast.show(result.ok ? 'Clip restored to the clipboard.' : 'Clipboard write failed.', { kind: result.ok ? 'info' : 'error' });
              }
            }),
            entry.url ? el('button', {
              class: 'btn', type: 'button', text: 'Open problem',
              onclick: () => window.open(entry.url, '_blank', 'noopener')
            }) : null,
            el('button', {
              class: 'btn', type: 'button', text: 'Save file', disabled: !entry.body || !Settings.get().advanced.downloadEnabled,
              onclick: () => {
                const meta = FORMAT_META[entry.formatId] || FORMAT_META.text;
                Downloader.save(entry.body, `${entry.slug || 'leetcode'}.${meta.ext}`, meta.mime);
              }
            }),
            el('button', {
              class: 'btn danger', type: 'button', text: 'Delete',
              onclick: async () => { await History.remove(entry.id); renderTab(); }
            })
          ])
        ]));
      }
      return [
        el('div', { class: 'section-title', text: `Clip history (${entries.length})` }),
        list,
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn danger', type: 'button', text: 'Clear history',
            onclick: async () => { await History.clear(); renderTab(); }
          })
        ])
      ];
    }

    function dataPane() {
      const importField = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
      importField.addEventListener('change', async () => {
        const file = importField.files && importField.files[0];
        if (!file) return;
        if (file.size > 512 * 1024) { Toast.show('That file is too large to be a settings export.', { kind: 'error' }); return; }
        try {
          await Settings.importJson(await file.text());
          Toast.show('Settings imported.', { kind: 'info' });
          renderTab();
          api.remount();
        } catch (err) {
          Toast.show('Import failed.', { kind: 'error', detail: String(err && err.message ? err.message : err) });
        } finally {
          importField.value = '';
        }
      });

      const controls = [
        { type: 'toggle', path: 'history.enabled', label: 'Keep a clip history' },
        { type: 'number', path: 'history.maxEntries', label: 'History entries to keep', min: 0, max: LIMITS.historyMaxEntries },
        { type: 'toggle', path: 'history.storeBody', label: 'Store full clip text', help: 'Off: only a short preview is kept, which uses far less storage.' }
      ].map(build);

      return [el('div', { class: 'section-title', text: 'Settings data' })].concat(controls).concat([
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn primary', type: 'button', text: 'Export settings',
            onclick: () => Downloader.save(Settings.exportJson(), `clip-leetcode-settings-${formatDate(new Date(), false)}.json`, 'application/json')
          }),
          el('button', {
            class: 'btn', type: 'button', text: 'Copy settings JSON',
            onclick: async () => {
              const result = await Clipboard.write(Settings.exportJson());
              Toast.show(result.ok ? 'Settings JSON copied.' : 'Clipboard write failed.', { kind: result.ok ? 'info' : 'error' });
            }
          }),
          el('button', { class: 'btn', type: 'button', text: 'Import settings\u2026', onclick: () => importField.click() }),
          importField,
          el('button', {
            class: 'btn', type: 'button', text: 'Clear metadata cache',
            onclick: async () => { await MetaService.clearCache(); Toast.show('Metadata cache cleared.', { kind: 'info' }); }
          }),
          el('button', {
            class: 'btn danger', type: 'button', text: 'Reset all settings',
            onclick: async () => {
              await Settings.reset();
              Toast.show('Settings reset to defaults.', { kind: 'info' });
              renderTab();
              api.remount();
            }
          })
        ]),
        el('p', { class: 'hint', text: `Storage backend: ${GMBridge.storageKind}. Exports contain preferences only \u2014 never page content or credentials.` })
      ]);
    }

    function aboutPane() {
      const diag = safe(() => api.diagnostics(), {}, 'diagnostics');
      const pairs = [
        ['Version', SCRIPT_VERSION],
        ['Userscript manager', `${GMBridge.managerName} ${GMBridge.managerVersion}`.trim()],
        ['Storage', GMBridge.storageKind],
        ['Cross-tab sync', GMBridge.canWatchValues ? 'supported' : 'unavailable'],
        ['Secure context', String(Boolean(window.isSecureContext))],
        ['Async clipboard', navigator.clipboard ? 'available' : 'unavailable'],
        ['Route', diag.route || 'not a problem page'],
        ['Layout detected', diag.layoutId || 'none'],
        ['Description found', diag.hasDescription ? 'yes' : 'no'],
        ['Buttons mounted', diag.mounted ? 'yes' : 'no'],
        ['Metadata', diag.metaState || 'idle']
      ];
      const dl = el('dl', { class: 'kv' });
      for (const [key, value] of pairs) {
        dl.appendChild(el('dt', { text: key }));
        dl.appendChild(el('dd', { text: String(value) }));
      }
      const nodes = [el('div', { class: 'section-title', text: 'Clip LeetCode' })];
      if (!window.isSecureContext) {
        nodes.push(el('div', { class: 'warn-box', text: 'This page is not a secure context, so the async clipboard API is unavailable. Copying falls back to the legacy method, which requires the page to be focused.' }));
      }
      nodes.push(dl);
      nodes.push(el('p', { class: 'hint', text: 'Clip LeetCode: clean copying and markdown formatting for LeetCode problems.' }));
      nodes.push(el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn', type: 'button', text: 'Copy diagnostics',
          onclick: async () => {
            const report = pairs.map(([k, v]) => `${k}: ${v}`).join('\n');
            const result = await Clipboard.write(`Clip LeetCode diagnostics\n${report}`);
            Toast.show(result.ok ? 'Diagnostics copied.' : 'Clipboard write failed.', { kind: result.ok ? 'info' : 'error' });
          }
        }),
        el('button', { class: 'btn', type: 'button', text: 'Re-scan page', onclick: () => { api.remount(); Toast.show('Re-scanning the page\u2026', { kind: 'info' }); } })
      ]));
      return nodes;
    }

    const PANES = {
      general: generalPane,
      formats: formatsPane,
      content: contentPane,
      markdown: markdownPane,
      templates: templatesPane,
      shortcuts: shortcutsPane,
      automation: automationPane,
      history: historyPane,
      data: dataPane,
      about: aboutPane
    };

    async function renderTab() {
      if (!modal) return;
      const container = modal.querySelector('.panes');
      if (!container) return;
      const token = ++renderTab._token;
      const producer = PANES[activeTab] || generalPane;
      const nodes = await Promise.resolve(safe(producer, [], `pane:${activeTab}`));
      if (token !== renderTab._token || !modal) return;
      container.textContent = '';
      const pane = el('div', { class: 'pane', role: 'tabpanel', 'aria-label': activeTab });
      for (const node of [].concat(nodes)) if (node) pane.appendChild(node);
      container.appendChild(pane);
      container.scrollTop = 0;
      modal.querySelectorAll('.tab').forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab.dataset.tab === activeTab));
      });
    }
    renderTab._token = 0;

    function trapFocus(event) {
      if (event.key !== 'Tab' || !modal) return;
      const focusable = Array.from(modal.querySelectorAll(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = modal.getRootNode().activeElement;
      if (event.shiftKey && activeEl === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && activeEl === last) { event.preventDefault(); first.focus(); }
    }

    function open(tabId) {
      if (backdrop) {
        if (tabId && PANES[tabId]) { activeTab = tabId; renderTab(); }
        return;
      }
      if (tabId && PANES[tabId]) activeTab = tabId;
      lastFocused = document.activeElement;

      const { layer } = Overlay.ensure();
      Overlay.syncTheme();

      const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-orientation': 'vertical' },
        TABS.map((tab) => el('button', {
          class: 'tab', type: 'button', role: 'tab', dataset: { tab: tab.id },
          'aria-selected': String(tab.id === activeTab), text: tab.label,
          onclick: () => { activeTab = tab.id; renderTab(); }
        })));

      modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Clip LeetCode settings' }, [
        el('div', { class: 'modal-head' }, [
          el('h2', { class: 'modal-title', text: 'Clip LeetCode' }),
          el('span', { class: 'modal-badge', text: `v${SCRIPT_VERSION}` }),
          el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close settings', text: '\u00d7', onclick: close })
        ]),
        el('div', { class: 'modal-body' }, [tabs, el('div', { class: 'panes' })])
      ]);

      backdrop = el('div', {
        class: 'backdrop',
        onpointerdown: (e) => { if (e.target === backdrop) close(); }
      }, [modal]);
      layer.appendChild(backdrop);

      disposer = new Disposer('panel');
      disposer.listen(window, 'keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        trapFocus(e);
      }, true);
      unsubscribe = Settings.on('change', (payload) => {
        // Only re-render for changes we did not originate, to avoid stealing focus mid-edit.
        if (payload && (payload.remote || payload.reset || payload.imported)) renderTab();
        Overlay.syncTheme();
      });

      renderTab();
      const firstTab = modal.querySelector('.tab[aria-selected="true"]') || modal.querySelector('.tab');
      if (firstTab) firstTab.focus({ preventScroll: true });
    }

    function close() {
      if (!backdrop) return;
      PopupMenu.close();
      backdrop.remove();
      backdrop = null;
      modal = null;
      if (disposer) { disposer.dispose(); disposer = null; }
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (lastFocused && typeof lastFocused.focus === 'function') {
        safe(() => lastFocused.focus({ preventScroll: true }), undefined, 'restore focus');
      }
      lastFocused = null;
    }

    function toggle(tabId) { if (backdrop) close(); else open(tabId); }

    return { init, open, close, toggle, get isOpen() { return Boolean(backdrop); } };
  })();

  /* ======================================================================== *
   * 14. Application controller
   *
   * Owns lifecycle: route activation/deactivation, mounting with bounded retries, a single
   * debounced MutationObserver, the copy pipeline, menu commands and hotkeys. All per-route
   * resources hang off `pageDisposer`, so a route change frees everything deterministically.
   * ======================================================================== */

  const App = (() => {
    const globalDisposer = new Disposer('app');
    const routeWatcher = new RouteWatcher();
    const autoCopied = new Set();

    let bar = null;
    let pageDisposer = null;
    let context = null;
    let meta = null;
    let metaState = 'idle';
    let metaAbort = null;
    let mountDeadline = 0;
    let mountBackoff = LIMITS.mountRetryBaseMs;
    let mountedForRoute = false;
    let gaveUpForRoute = false;
    let observer = null;
    let observerTarget = null;
    let themeObserver = null;
    let lastFormat = null;
    let busy = false;
    let menuIds = [];
    let menuRegistered = false;
    let started = false;

    /* ---------------- mounting ---------------- */

    const scheduleEnsure = debounce(() => {
      routeWatcher.poke();
      ensureMounted();
    }, LIMITS.observerDebounceMs);

    function observerScope() {
      if (Settings.get().advanced.observerScope === 'body') return document.body;
      return queryFirst(['#qd-content', '#app main', 'main', '#base_content']) || document.body;
    }

    function startObserver() {
      if (observer || !document.body) return;
      const target = observerScope();
      if (!target) return;
      observer = new MutationObserver((records) => {
        // Cheapest possible hot path: only structural changes are interesting.
        for (const record of records) {
          if (record.addedNodes.length || record.removedNodes.length) { scheduleEnsure(); return; }
        }
      });
      observer.observe(target, { childList: true, subtree: true });
      observerTarget = target;
      pageDisposer.add(() => {
        scheduleEnsure.cancel();
        if (observer) { observer.disconnect(); observer = null; }
        observerTarget = null;
      });
    }

    /** If the SPA swapped out the container we were watching, re-attach to the new one. */
    function verifyObserver() {
      if (!observer || (observerTarget && observerTarget.isConnected)) return;
      observer.disconnect();
      observer = null;
      observerTarget = null;
      startObserver();
    }

    function ensureMounted() {
      const settings = Settings.get();
      if (!settings.enabled || !context || !pageDisposer || !document.body) return;

      verifyObserver();
      // `isMounted` already covers "our host was detached by a re-render".
      if (bar && bar.isMounted) return;

      const found = Extractor.findLayout();
      if (!found) {
        if (Date.now() > mountDeadline) {
          if (!gaveUpForRoute) {
            gaveUpForRoute = true;
            Log.info('no supported layout found yet; waiting for DOM changes only');
          }
          return; // observer-driven retries continue; the timer chain stops here
        }
        mountBackoff = Math.min(mountBackoff * 1.6, LIMITS.mountRetryMaxMs);
        pageDisposer.timeout(ensureMounted, mountBackoff);
        return;
      }

      gaveUpForRoute = false;
      mountBackoff = LIMITS.mountRetryBaseMs;
      if (!bar) bar = new ButtonBar(handlers);
      if (!bar.mount(found.titleNode, found.layout.mount)) {
        pageDisposer.timeout(ensureMounted, mountBackoff);
        return;
      }
      Log.debug('mounted', found.layout.id);

      if (!mountedForRoute) {
        mountedForRoute = true;
        onFirstMount();
      }
    }

    function onFirstMount() {
      const settings = Settings.get();
      if (settings.content.fetchMetadata && context && context.kind === 'problem') {
        prefetchMeta();
      }
      if (settings.automation.autoCopyOnOpen) scheduleAutoCopy();
    }

    function scheduleAutoCopy() {
      const settings = Settings.get();
      const key = context ? `${context.host}:${context.slug}` : '';
      if (settings.automation.autoCopyOncePerProblem && autoCopied.has(key)) return;
      // Bound the session-scoped guard so a very long browsing session cannot grow it forever.
      if (autoCopied.size > 500) autoCopied.clear();
      pageDisposer.timeout(() => {
        if (!context) return;
        if (settings.automation.autoCopyOncePerProblem) autoCopied.add(key);
        const formatId = settings.automation.autoCopyFormat;
        if (!settings.formats[formatId] || !settings.formats[formatId].enabled) return;
        copy(formatId, { source: 'automation' });
      }, clamp(settings.automation.autoCopyDelayMs, 0, 15000));
    }

    /* ---------------- metadata ---------------- */

    function prefetchMeta() {
      if (!context || context.kind !== 'problem') { metaState = 'n/a (contest)'; return Promise.resolve(null); }
      if (!Settings.get().content.fetchMetadata) { metaState = 'disabled'; return Promise.resolve(null); }
      if (meta) return Promise.resolve(meta);
      metaState = 'loading';
      if (metaAbort) metaAbort.abort();
      metaAbort = new AbortController();
      return MetaService.fetchMeta(context.slug, { signal: metaAbort.signal }).then((data) => {
        meta = data;
        metaState = data ? 'loaded' : 'unavailable';
        return data;
      });
    }

    /**
     * Metadata is only awaited when the requested output actually depends on it, so the common
     * "Copy" / "Copy Markdown" path stays synchronous and instant.
     */
    function needsMeta(formatId, settings) {
      if (!settings.content.fetchMetadata) return false;
      if (formatId === 'json') return true;
      if (settings.content.includeHints || settings.content.includeSimilar || settings.content.includeSnippet) return true;
      if (settings.content.titleMode === 'with-id') return true;
      const template = settings.templates[formatId];
      if (typeof template === 'string' && /\{\{\s*(id|difficulty|tags|tagList|likes|dislikes|acceptance|paid|snippet|snippetLang|hints|similar)\s*\}\}/.test(template)) {
        return true;
      }
      return false;
    }

    /* ---------------- copy pipeline ---------------- */

    async function buildClip(formatId, options) {
      const settings = Settings.get();
      const snapshot = Extractor.snapshot(context);

      let metadata = meta;
      const wantMeta = needsMeta(formatId, settings) || !snapshot.descriptionNode;
      if (wantMeta && !metadata && context && context.kind === 'problem' && settings.content.fetchMetadata) {
        metadata = await prefetchMeta();
      }

      return ClipBuilder.build({ snapshot, meta: metadata, settings, formatId, options: options || {} });
    }

    async function copy(formatId, options) {
      const opts = options || {};
      const settings = Settings.get();
      if (!settings.enabled) return false;
      const formatCfg = settings.formats[formatId];
      if (!formatCfg || !formatCfg.enabled) {
        Toast.show(`The ${FORMAT_META[formatId] ? FORMAT_META[formatId].name : formatId} format is disabled.`, { kind: 'warn' });
        return false;
      }
      if (!context) {
        Toast.show('Open a LeetCode problem first.', { kind: 'warn' });
        return false;
      }
      if (busy) return false;
      busy = true;
      if (bar) bar.setBusy(formatId, true);

      try {
        const clip = await buildClip(formatId, opts);
        if (!clip.ok) {
          Log.warn('clip build failed', clip.reason);
          if (bar) bar.flash(formatId, 'Failed', 'error');
          Toast.show('Could not build the clip.', { kind: 'error', detail: clip.reason });
          return false;
        }

        const result = await Clipboard.write(clip.content, {
          html: clip.html,
          rich: settings.advanced.richHtmlClipboard
        });

        if (!result.ok) {
          if (bar) bar.flash(formatId, 'Failed', 'error');
          Toast.show('Clipboard write was blocked.', {
            kind: 'error',
            detail: window.isSecureContext
              ? 'Click the page once and try again — the browser needs the document focused.'
              : 'This page is not a secure context.'
          });
          return false;
        }

        lastFormat = formatId;
        if (bar) bar.flash(formatId, settings.ui.copiedLabel);
        Toast.show(`${clip.partial ? 'Selection' : FORMAT_META[formatId].name} copied`, {
          kind: 'info',
          detail: `${clip.content.length.toLocaleString()} characters${result.via === 'async-api' ? '' : ` \u00b7 via ${result.via}`}`
        });

        History.add({
          formatId,
          title: clip.title,
          slug: context.slug,
          url: location.href,
          content: clip.content
        }).catch((err) => Log.warn('history write failed', err));

        return true;
      } catch (err) {
        Log.error('copy failed', err);
        if (bar) bar.flash(formatId, 'Failed', 'error');
        Toast.show('Copy failed unexpectedly.', { kind: 'error', detail: String(err && err.message ? err.message : err) });
        return false;
      } finally {
        busy = false;
        if (bar) bar.setBusy(formatId, false);
      }
    }

    async function download(formatId) {
      const settings = Settings.get();
      if (!settings.advanced.downloadEnabled) {
        Toast.show('File downloads are disabled in settings.', { kind: 'warn' });
        return false;
      }
      if (!context) { Toast.show('Open a LeetCode problem first.', { kind: 'warn' }); return false; }
      const clip = await buildClip(formatId, {});
      if (!clip.ok) {
        Toast.show('Could not build the clip.', { kind: 'error', detail: clip.reason });
        return false;
      }
      const info = FORMAT_META[formatId];
      const ok = Downloader.save(clip.content, `${context.slug || 'leetcode-problem'}.${info.ext}`, info.mime);
      Toast.show(ok ? 'File saved.' : 'Download failed.', { kind: ok ? 'info' : 'error' });
      return ok;
    }

    function enabledFormats() {
      const settings = Settings.get();
      return FORMAT_IDS.filter((id) => settings.formats[id] && settings.formats[id].enabled);
    }

    function cycleFormat() {
      const list = enabledFormats();
      if (!list.length) return;
      const index = lastFormat ? list.indexOf(lastFormat) : -1;
      copy(list[(index + 1) % list.length], { source: 'cycle' });
    }

    /* ---------------- UI handlers ---------------- */

    const handlers = {
      onCopy: (formatId, options) => { copy(formatId, options); },
      onSettings: () => Panel.toggle('general'),
      onMenu: (rect) => {
        const settings = Settings.get();
        const items = [{ type: 'label', label: 'Copy as' }];
        for (const id of enabledFormats()) {
          items.push({
            label: settings.formats[id].label || FORMAT_META[id].name,
            hint: settings.formats[id].hotkey,
            run: () => copy(id, { source: 'menu' })
          });
        }
        if (settings.advanced.downloadEnabled) {
          items.push({ type: 'sep' });
          items.push({ type: 'label', label: 'Save as file' });
          for (const id of enabledFormats()) {
            items.push({ label: `.${FORMAT_META[id].ext} file`, run: () => download(id) });
          }
        }
        items.push({ type: 'sep' });
        items.push({
          label: `Selection-only mode: ${settings.automation.copyOnSelectionOnly ? 'on' : 'off'}`,
          run: () => Settings.setPath('automation.copyOnSelectionOnly', !settings.automation.copyOnSelectionOnly)
        });
        items.push({ label: 'Clip history\u2026', run: () => Panel.open('history') });
        items.push({ label: 'Settings\u2026', run: () => Panel.open('general') });
        PopupMenu.open(rect, items);
      }
    };

    /* ---------------- menu commands (userscript manager menu) ---------------- */

    function refreshMenus() {
      if (menuRegistered && !GMBridge.canUnregisterMenu) return; // avoid duplicate entries
      menuIds.forEach((id) => GMBridge.unregisterMenu(id));
      menuIds = [];
      const settings = Settings.get();
      const register = (label, fn) => {
        const id = GMBridge.registerMenu(label, fn);
        if (id !== null && id !== undefined) menuIds.push(id);
      };
      for (const id of enabledFormats()) {
        const cfg = settings.formats[id];
        register(`Copy as ${FORMAT_META[id].name}${cfg.hotkey ? ` (${cfg.hotkey})` : ''}`, () => copy(id, { source: 'gm-menu' }));
      }
      register('Clip history\u2026', () => Panel.open('history'));
      register('Settings\u2026', () => Panel.open('general'));
      register(settings.ui.showButtons ? 'Hide page buttons' : 'Show page buttons',
        () => Settings.setPath('ui.showButtons', !Settings.get().ui.showButtons));
      menuRegistered = true;
    }

    /* ---------------- hotkeys ---------------- */

    const hotkeyManager = new Hotkeys.Manager();

    function refreshHotkeys() {
      const settings = Settings.get();
      if (!settings.enabled || !settings.shortcuts.enabled) { hotkeyManager.setBindings([]); return; }
      const allowInEditor = settings.shortcuts.allowInEditor;
      const bindings = [];
      for (const id of enabledFormats()) {
        const spec = settings.formats[id].hotkey;
        if (spec) bindings.push({ spec, allowInEditor, run: () => copy(id, { source: 'hotkey' }) });
      }
      if (settings.shortcuts.openSettings) bindings.push({ spec: settings.shortcuts.openSettings, allowInEditor, run: () => Panel.toggle('general') });
      if (settings.shortcuts.openHistory) bindings.push({ spec: settings.shortcuts.openHistory, allowInEditor, run: () => Panel.toggle('history') });
      if (settings.shortcuts.lastFormat) {
        bindings.push({ spec: settings.shortcuts.lastFormat, allowInEditor, run: () => copy(lastFormat || enabledFormats()[0], { source: 'hotkey' }) });
      }
      if (settings.shortcuts.cycleFormat) bindings.push({ spec: settings.shortcuts.cycleFormat, allowInEditor, run: cycleFormat });
      hotkeyManager.setBindings(bindings);
    }

    /* ---------------- route lifecycle ---------------- */

    function deactivate() {
      if (metaAbort) { metaAbort.abort(); metaAbort = null; }
      if (bar) { bar.unmount(); bar = null; }
      if (pageDisposer) { pageDisposer.dispose(); pageDisposer = null; }
      PopupMenu.close();
      context = null;
      meta = null;
      metaState = 'idle';
      mountedForRoute = false;
      gaveUpForRoute = false;
      mountBackoff = LIMITS.mountRetryBaseMs;
    }

    function activate(next) {
      deactivate();
      context = next;
      pageDisposer = new Disposer('route');
      mountDeadline = Date.now() + Settings.get().advanced.mountTimeoutMs;

      // Pause the observer while the tab is hidden; re-verify on return.
      pageDisposer.listen(document, 'visibilitychange', () => {
        if (document.hidden) {
          if (observer) { observer.disconnect(); observer = null; }
        } else {
          startObserver();
          scheduleEnsure();
        }
      });

      startObserver();
      ensureMounted();
    }

    function applyRoute(href) {
      const settings = Settings.get();
      const next = Route.parse(href || location.href);
      if (!settings.enabled || !next) {
        if (context) Log.debug('leaving problem route — going dormant');
        deactivate();
        return;
      }
      if (context && context.slug === next.slug && context.kind === next.kind && bar && bar.isMounted) {
        return; // same problem, e.g. tab switch inside the page
      }
      activate(next);
    }

    /* ---------------- theme sync ---------------- */

    function watchTheme() {
      if (themeObserver || !document.documentElement) return;
      const sync = debounce(() => Overlay.syncTheme(), 200);
      themeObserver = new MutationObserver(sync);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      globalDisposer.observe(themeObserver);
    }

    /* ---------------- diagnostics ---------------- */

    function diagnostics() {
      const snapshot = context ? Extractor.snapshot(context) : null;
      return {
        route: context ? `${context.kind}:${context.slug}` : '',
        layoutId: snapshot ? snapshot.layoutId : '',
        hasDescription: Boolean(snapshot && snapshot.descriptionNode),
        mounted: Boolean(bar && bar.isMounted),
        metaState
      };
    }

    /* ---------------- bootstrap ---------------- */

    async function start() {
      if (started) return;
      started = true;

      Panel.init({ remount: () => { deactivate(); applyRoute(); }, diagnostics });

      routeWatcher.on('change', (payload) => {
        Log.debug('route change', payload.href);
        applyRoute(payload.href);
      });
      routeWatcher.start();
      globalDisposer.add(() => routeWatcher.dispose());

      globalDisposer.add(Settings.on('change', () => {
        Overlay.syncTheme();
        refreshHotkeys();
        refreshMenus();
        if (!Settings.get().enabled) { deactivate(); return; }
        if (!context) { applyRoute(); return; }
        if (bar && bar.isMounted) bar.applySettings();
        else ensureMounted();
      }));

      globalDisposer.add(() => hotkeyManager.detach());

      watchTheme();
      refreshHotkeys();
      refreshMenus();
      applyRoute();

      // A single safety-net re-check shortly after load covers the rare case where LeetCode
      // finishes hydrating without emitting mutations inside the observed scope.
      globalDisposer.timeout(() => { routeWatcher.poke(); ensureMounted(); }, 1500);
    }

    function stop() {
      deactivate();
      globalDisposer.dispose();
      Settings.dispose();
      Overlay.destroy();
      started = false;
    }

    return { start, stop, copy, download, diagnostics, get context() { return context; } };
  })();

  /* ======================================================================== *
   * 15. Entry point
   * ======================================================================== */

  (async function bootstrap() {
    try {
      await Settings.load();
    } catch (err) {
      Log.error('settings failed to load; continuing with defaults', err);
    }
    try {
      await documentReady();
      App.start();
    } catch (err) {
      Log.error('startup failed', err);
    }
  })();
})();
