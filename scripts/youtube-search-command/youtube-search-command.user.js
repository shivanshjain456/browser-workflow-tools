// SPDX-License-Identifier: MIT
// ==UserScript==
// @name         YouTube Search Command
// @namespace    https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/youtube-search-command
// @version      2.1.0
// @description  Power-user control plane for YouTube search and channel pages: per-channel policies keyed by canonical channel id, context profiles, weighted multi-signal ranking with grouping and pinning, tag/like/category/region filters via precision metadata, near-duplicate and series clustering, title-structure and writing-system analysis, personal result memory, and a fully keyboard-accessible panel.
// @author       Shivansh Jain
// @license      MIT
// @homepageURL  https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/youtube-search-command
// @supportURL   https://github.com/shivanshjain456/browser-workflow-tools/issues
// @downloadURL  https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/youtube-search-command/youtube-search-command.user.js
// @updateURL    https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/youtube-search-command/youtube-search-command.user.js
// @match        https://www.youtube.com/*
// @exclude      https://www.youtube.com/embed/*
// @exclude      https://www.youtube.com/live_chat*
// @exclude      https://www.youtube.com/tv*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.registerMenuCommand
// @grant        window.onurlchange
// ==/UserScript==

/*
 * YouTube Search Command
 * ----------------------
 * Scope: the desktop YouTube search results page
 * (https://www.youtube.com/results?...). The mobile site (m.youtube.com) uses a
 * different component tree and is deliberately out of scope.
 * The script is inert on every other YouTube surface; it only allocates
 * observers, UI and state while a search results page is active.
 *
 * Scopes: global settings, context profiles (search-context) and per-channel
 * policies compose in a fixed precedence — per-video verdict > channel policy >
 * context profile > global rule — and every decision records which scope made
 * it, so behaviour is explainable rather than emergent.
 *
 * Design notes that are not obvious from the code are documented inline.
 * Privacy: no telemetry, no third-party requests, no remote code. The only
 * network access is an OPT-IN, cookie-less, same-origin request to YouTube's
 * own /youtubei/v1/player endpoint used to obtain exact upload dates and view
 * counts ("Precision mode"). It is disabled by default.
 */

(function () {
  'use strict';

  /* ==========================================================================
   * 1. Constants & environment
   * ======================================================================= */

  const APP = Object.freeze({
    id: 'ytsc',
    name: 'YouTube Search Command',
    short: 'YSC',
    version: '2.1.0',
    schemaVersion: 2,
    storage: Object.freeze({
      config: 'ytsc.config.v1',
      presets: 'ytsc.presets.v1',
      cache: 'ytsc.metacache.v1',
      channels: 'ytsc.channels.v1',
      memory: 'ytsc.memory.v1'
    })
  });

  // Hard limits. They exist so that pathological pages, hostile input or long
  // sessions cannot turn into unbounded memory/CPU growth.
  const LIMITS = Object.freeze({
    maxCardsPerPass: 1200,        // safety valve for absurd DOM sizes
    maxListEntries: 500,          // per keyword/channel list
    maxPatternLength: 200,
    maxPresets: 40,
    maxContexts: 30,
    maxChannelPolicies: 5000,     // indexed by id/handle: O(1) lookup
    maxMemoryEntries: 5000,
    memoryTtlDays: 120,
    maxCacheEntries: 4000,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxEnrichConcurrency: 6,
    enrichTimeoutMs: 12000,
    enrichBudgetPerNav: 300,      // cap requests per navigation
    deepLoadMaxBatches: 20,
    deepLoadStepTimeoutMs: 9000,
    diagRingSize: 25,
    passIntervalMs: 120,          // minimum spacing between full passes
    writeDebounceMs: 300,
    maxClusterCards: 600          // similarity clustering is O(n·k); bound it
  });

  /** Page types the script knows how to operate on. */
  const PAGE = Object.freeze({
    search: 'search',
    channelGrid: 'channel-grid',     // /@handle/videos, /streams, /shorts
    channelSearch: 'channel-search', // /@handle/search?query=
    none: 'none'
  });

  const SORT_MODES = Object.freeze([
    { id: 'relevance', label: 'Relevance (YouTube order)' },
    { id: 'score', label: 'Weighted score (ranking model)' },
    { id: 'newest', label: 'Newest first' },
    { id: 'oldest', label: 'Oldest first' },
    { id: 'views-desc', label: 'Most viewed' },
    { id: 'views-asc', label: 'Least viewed' },
    { id: 'vpd-desc', label: 'Views per day (momentum)' },
    { id: 'likes-desc', label: 'Most liked (precision)' },
    { id: 'ratio-desc', label: 'Best like ratio (precision)' },
    { id: 'outperform-desc', label: 'Outperforms its channel' },
    { id: 'duration-desc', label: 'Longest first' },
    { id: 'duration-asc', label: 'Shortest first' },
    { id: 'title-asc', label: 'Title A→Z' },
    { id: 'channel-asc', label: 'Channel A→Z' }
  ]);

  const DISPLAY_MODES = Object.freeze([
    { id: 'hide', label: 'Hide (remove from view)' },
    { id: 'collapse', label: 'Collapse to one line' },
    { id: 'dim', label: 'Dim' },
    { id: 'blur', label: 'Blur with reason' }
  ]);

  const GROUP_MODES = Object.freeze([
    { id: 'none', label: 'No grouping' },
    { id: 'tier', label: 'Priority tiers' },
    { id: 'channel', label: 'By channel' },
    { id: 'series', label: 'By series / near-duplicate cluster' },
    { id: 'recency', label: 'By recency bucket' }
  ]);

  /** Channel policy modes, in descending precedence when both could apply. */
  const CHANNEL_MODES = Object.freeze([
    { id: 'blocked', label: 'Blocked — never show' },
    { id: 'muted', label: 'Muted — hide but keep reachable via “show hidden”' },
    { id: 'limited', label: 'Limited — show at most N per result set (falls back to the global cap)' },
    { id: 'normal', label: 'Normal — global rules apply' },
    { id: 'trusted', label: 'Trusted — bypasses exactly the rules ticked below' },
    { id: 'priority', label: 'Priority — as Trusted, plus ranked ahead of other results' }
  ]);

  /** Global rules a channel policy may explicitly bypass. */
  const BYPASSABLE = Object.freeze([
    { id: 'views', label: 'View thresholds' },
    { id: 'duration', label: 'Duration thresholds' },
    { id: 'age', label: 'Age thresholds' },
    { id: 'keywords', label: 'Global keyword rules' },
    { id: 'shorts', label: 'Shorts rule' },
    { id: 'watched', label: 'Watched rule' },
    { id: 'style', label: 'Title-style rule' },
    { id: 'script', label: 'Writing-system rule' },
    { id: 'query', label: 'Query-term requirement' },
    { id: 'cap', label: 'Per-channel result cap' },
    { id: 'seen', label: 'Already-seen suppression' },
    { id: 'duplicates', label: 'Duplicate / cluster limits' }
  ]);

  /** Signals available to the weighted ranking model. */
  const SIGNALS = Object.freeze([
    { id: 'recency', label: 'Recency', hint: 'Newer uploads score higher (configurable half-life).' },
    { id: 'views', label: 'View count', hint: 'Log-scaled between 100 and 10M views.' },
    { id: 'velocity', label: 'Views per day', hint: 'Log-scaled momentum since upload.' },
    { id: 'engagement', label: 'Like ratio', hint: 'Likes ÷ views (precision mode only).' },
    { id: 'queryMatch', label: 'Query match', hint: 'Share of search words found in title/channel/snippet.' },
    { id: 'durationFit', label: 'Duration fit', hint: 'Closeness to your preferred length window.' },
    { id: 'titleCalm', label: 'Title restraint', hint: 'Inverse of the structural clickbait score.' },
    { id: 'channelPriority', label: 'Channel priority', hint: 'Boost configured in the channel policy.' },
    { id: 'outperformance', label: 'Channel outperformance', hint: 'Views vs. the same channel’s median in this result set.' }
  ]);

  // Filter reason identifiers. Kept stable: they are surfaced in the UI and in
  // the per-card annotation, and are used as object keys in statistics.
  const REASON = Object.freeze({
    kindShort: 'Shorts',
    kindShortsShelf: 'Shorts shelf',
    kindPlaylist: 'Playlist',
    kindMix: 'Mix',
    kindChannel: 'Channel result',
    kindMovie: 'Movie',
    kindShelf: 'Shelf / suggestion block',
    kindPromoted: 'Promoted',
    live: 'Live',
    upcoming: 'Upcoming',
    members: 'Members only',
    unverified: 'Unverified channel',
    watched: 'Already watched',
    duplicate: 'Duplicate result',
    similar: 'Near-duplicate title',
    seriesCap: 'Series limit reached',
    channelBlocked: 'Blocked channel',
    channelMuted: 'Muted channel',
    channelCap: 'Channel result cap',
    channelPolicyRule: 'Channel rule',
    titleExcluded: 'Blocked keyword',
    titleRequired: 'Missing required keyword',
    tagExcluded: 'Blocked tag',
    tagRequired: 'Missing required tag',
    descriptionExcluded: 'Blocked description text',
    categoryExcluded: 'Category filter',
    notFamilySafe: 'Not marked family safe',
    regionBlocked: 'Not available in your region',
    queryTerms: 'Missing query terms',
    viewsMin: 'Too few views',
    viewsMax: 'Too many views',
    likesMin: 'Too few likes',
    ratioMin: 'Like ratio too low',
    durationMin: 'Too short',
    durationMax: 'Too long',
    ageMax: 'Too old',
    ageMin: 'Too new',
    styleScore: 'Clickbait-style title',
    scriptBlocked: 'Writing system filtered',
    outperformMin: 'Below channel median',
    seen: 'Seen in an earlier search',
    videoMuted: 'Muted video',
    videoSnoozed: 'Snoozed',
    scoreFloor: 'Below score threshold',
    inResults: 'Not matching in-page search'
  });

  /** Which scope decided a card's fate — surfaced in the UI for transparency. */
  const SCOPE = Object.freeze({
    video: 'video rule',
    channel: 'channel policy',
    context: 'context profile',
    global: 'global rule'
  });

  const RUNTIME = (() => {
    const info = (() => {
      try {
        return typeof GM_info !== 'undefined' ? GM_info : (typeof GM !== 'undefined' && GM && GM.info) || null;
      } catch (_e) { return null; }
    })();
    const handler = (info && info.scriptHandler) || 'unknown';
    return Object.freeze({
      info,
      handler,
      handlerVersion: (info && info.version) || 'unknown'
    });
  })();

  const CAPS = Object.freeze({
    gmGetSync: typeof GM_getValue === 'function',
    gmSetSync: typeof GM_setValue === 'function',
    gmDelSync: typeof GM_deleteValue === 'function',
    gmAsync: typeof GM !== 'undefined' && !!GM && typeof GM.getValue === 'function',
    gmValueChange: typeof GM_addValueChangeListener === 'function',
    gmMenu: typeof GM_registerMenuCommand === 'function' ||
      (typeof GM !== 'undefined' && !!GM && typeof GM.registerMenuCommand === 'function'),
    localStorage: (() => {
      try {
        const k = '__ytsc_probe__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        return true;
      } catch (_e) { return false; }
    })(),
    constructableStylesheets: (() => {
      try { return typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype && 'adoptedStyleSheets' in Document.prototype; } catch (_e) { return false; }
    })(),
    navigationApi: typeof window.navigation === 'object' && window.navigation !== null &&
      typeof window.navigation.addEventListener === 'function',
    abortController: typeof AbortController === 'function',
    fetch: typeof fetch === 'function',
    onUrlChange: 'onurlchange' in window,
    relativeTimeFormat: typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function',
    compactNumbers: (() => {
      try { return new Intl.NumberFormat('en', { notation: 'compact' }).format(1000) === '1K'; } catch (_e) { return false; }
    })(),
    unicodeScriptRegex: (() => {
      try { return new RegExp('\\p{Script=Latin}', 'u').test('a'); } catch (_e) { return false; }
    })()
  });

  /* ==========================================================================
   * 2. Foundations: diagnostics, scheduling, DOM & text helpers
   * ======================================================================= */

  /** Bounded diagnostics sink. Errors never escape into YouTube's own code. */
  const Diag = (() => {
    const events = [];
    let debug = false;
    let errorCount = 0;

    const push = (level, message, detail) => {
      events.push({
        t: Date.now(),
        level,
        message: String(message).slice(0, 300),
        detail: detail === undefined ? undefined : String(detail).slice(0, 300)
      });
      if (events.length > LIMITS.diagRingSize) events.splice(0, events.length - LIMITS.diagRingSize);
    };

    return {
      setDebug(v) { debug = !!v; },
      get debug() { return debug; },
      get errorCount() { return errorCount; },
      log(...args) { if (debug) console.log(`[${APP.short}]`, ...args); },
      info(message, detail) { push('info', message, detail); if (debug) console.log(`[${APP.short}] ${message}`, detail ?? ''); },
      warn(message, detail) { push('warn', message, detail); if (debug) console.warn(`[${APP.short}] ${message}`, detail ?? ''); },
      error(message, err) {
        errorCount++;
        const detail = err && err.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : String(err ?? '');
        push('error', message, detail);
        // Always surface real errors: silent failure is worse than a console line.
        console.error(`[${APP.short}] ${message}`, err ?? '');
      },
      snapshot() { return events.slice(); }
    };
  })();

  /**
   * Wrap a function so a subsystem failure can never break the page or leave
   * the controller half-initialised. Returns `fallback` on failure.
   */
  const guard = (label, fn, fallback) => function guarded(...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      Diag.error(`${label} failed`, err);
      return fallback;
    }
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Coalesced, frame-aligned scheduler with a hard minimum spacing. */
  function createScheduler(run, minIntervalMs) {
    let queued = false;
    let lastRun = 0;
    let timer = 0;
    let rafId = 0;
    let destroyed = false;

    const invoke = () => {
      queued = false;
      timer = 0;
      rafId = 0;
      if (destroyed) return;
      lastRun = Date.now();
      try {
        run();
      } catch (err) {
        Diag.error('scheduled task failed', err);
      }
    };

    const schedule = () => {
      if (destroyed || queued) return;
      queued = true;
      const wait = Math.max(0, minIntervalMs - (Date.now() - lastRun));
      timer = window.setTimeout(() => {
        timer = 0;
        // Align with the next frame so we never fight YouTube's own rendering.
        if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(invoke);
        else invoke();
      }, wait);
    };

    return {
      schedule,
      flush() {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (rafId && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(rafId); rafId = 0; }
        if (queued) invoke();
      },
      destroy() {
        destroyed = true;
        if (timer) clearTimeout(timer);
        if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        timer = 0; rafId = 0; queued = false;
      }
    };
  }

  /**
   * Owns every long-lived resource of one lifecycle scope so that teardown is
   * a single, total operation instead of a list of ad-hoc cleanups.
   */
  function createDisposer(name) {
    const disposers = [];
    let disposed = false;
    return {
      get name() { return name; },
      get disposed() { return disposed; },
      add(fn) {
        if (disposed) { try { fn(); } catch (_e) { /* already torn down */ } return; }
        disposers.push(fn);
      },
      listen(target, type, handler, options) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, handler, options);
        this.add(() => {
          try { target.removeEventListener(type, handler, options); } catch (_e) { /* detached */ }
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        while (disposers.length) {
          const fn = disposers.pop();
          try { fn(); } catch (err) { Diag.error(`dispose(${name}) step failed`, err); }
        }
      }
    };
  }

  /* --- DOM construction ---------------------------------------------------
   * YouTube serves `require-trusted-types-for 'script'`; more importantly the
   * host page is untrusted input. Everything is built with createElement +
   * textContent, so no HTML string ever reaches a parser.
   */
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, props, children) {
    const node = document.createElement(tag);
    applyProps(node, props);
    appendChildren(node, children);
    return node;
  }

  function svg(tag, props, children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value === null || value === undefined || value === false) continue;
        node.setAttribute(key, String(value));
      }
    }
    appendChildren(node, children);
    return node;
  }

  function applyProps(node, props) {
    if (!props) return;
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'dataset') {
        for (const dk of Object.keys(value)) node.dataset[dk] = String(value[dk]);
      } else if (key === 'style' && typeof value === 'object') {
        for (const sk of Object.keys(value)) node.style.setProperty(sk, String(value[sk]));
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node && key !== 'list' && typeof value !== 'object') {
        try { node[key] = value; } catch (_e) { node.setAttribute(key, String(value)); }
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined) return;
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'object' && child.nodeType ? child : document.createTextNode(String(child)));
    }
  }

  /** querySelector that never throws on a malformed/unsupported selector. */
  function q(root, selector) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector(selector); } catch (_e) { return null; }
  }

  function qa(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try { return Array.prototype.slice.call(root.querySelectorAll(selector)); } catch (_e) { return []; }
  }

  function firstMatch(root, selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const found = q(root, selectors[i]);
      if (found) return found;
    }
    return null;
  }

  /* --- text helpers ------------------------------------------------------ */

  const WS_RE = /\s+/g;
  const normalizeSpace = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(WS_RE, ' ').trim();

  /** Case/diacritic-insensitive fold used for all user-facing matching. */
  function fold(s) {
    const str = normalizeSpace(s).toLowerCase();
    try { return str.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (_e) { return str; }
  }

  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const DURATION_UNITS = Object.freeze({ s: 1, m: 60, h: 3600, d: 86400 });

  /** Parse "90", "90s", "5m", "1h30m", "1:30", "01:02:03" into seconds. */
  function parseDurationInput(raw) {
    const value = normalizeSpace(raw);
    if (!value) return null;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
      const parts = value.split(':').map(Number);
      return parts.reduce((acc, part) => acc * 60 + part, 0);
    }
    const unitMatches = value.toLowerCase().match(/(\d+(?:\.\d+)?)\s*([smhd])/g);
    if (unitMatches && unitMatches.length) {
      let total = 0;
      for (const chunk of unitMatches) {
        const m = chunk.match(/(\d+(?:\.\d+)?)\s*([smhd])/);
        if (m) total += parseFloat(m[1]) * DURATION_UNITS[m[2]];
      }
      return Math.round(total);
    }
    const plain = Number(value);
    return Number.isFinite(plain) && plain >= 0 ? Math.round(plain) : null;
  }

  /** Parse "1000", "1k", "2.5M", "1,000" into a number of views. */
  function parseCountInput(raw) {
    const value = normalizeSpace(raw).toLowerCase().replace(/[, _]/g, '');
    if (!value) return null;
    const m = value.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
    if (!m) return null;
    const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
    const n = parseFloat(m[1]) * mult;
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function formatCount(n) {
    if (!isFiniteNumber(n)) return '—';
    try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n); } catch (_e) { return String(n); }
  }

  function formatDuration(seconds) {
    if (!isFiniteNumber(seconds) || seconds < 0) return '—';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function formatDate(ms) {
    if (!isFiniteNumber(ms)) return '—';
    try { return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms)); } catch (_e) { return new Date(ms).toISOString().slice(0, 10); }
  }

  function formatAgo(ms) {
    if (!isFiniteNumber(ms)) return '—';
    const days = (Date.now() - ms) / 86400000;
    if (days < 1) return 'today';
    if (days < 30) return `${Math.round(days)}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${(days / 365).toFixed(1)}y`;
  }

  /**
   * Compile one user pattern line into a predicate description.
   * Supported syntax (documented in the UI):
   *   plain text        → substring match (case/diacritic-insensitive)
   *   "quoted phrase"   → whole-phrase match with word boundaries
   *   /regex/flags      → regular expression (validated, length-capped)
   * Invalid patterns are reported, never silently dropped.
   */
  function compilePattern(line) {
    const raw = String(line == null ? '' : line).trim();
    if (!raw) return null;
    if (raw.length > LIMITS.maxPatternLength) {
      return { raw, error: 'Pattern too long', test: () => false };
    }
    const regexMatch = raw.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        // Deduplicate: a user-supplied /…/i plus our implicit 'i' would
        // otherwise produce the invalid flag string 'ii'.
        const flags = Array.from(new Set(`${(regexMatch[2] || '').replace(/[gy]/g, '')}i`)).join('');
        const re = new RegExp(regexMatch[1], flags);
        return { raw, kind: 'regex', test: (haystackRaw) => re.test(haystackRaw) };
      } catch (err) {
        return { raw, error: `Invalid regular expression: ${err.message}`, test: () => false };
      }
    }
    const quoted = raw.match(/^"(.*)"$/);
    if (quoted) {
      const needle = fold(quoted[1]);
      if (!needle) return null;
      const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?:$|[^\\p{L}\\p{N}])`, 'u');
      return { raw, kind: 'phrase', test: (_hayRaw, hayFolded) => re.test(hayFolded) };
    }
    const needle = fold(raw);
    if (!needle) return null;
    return { raw, kind: 'substring', test: (_hayRaw, hayFolded) => hayFolded.indexOf(needle) !== -1 };
  }

  function compilePatternList(lines) {
    const compiled = [];
    const errors = [];
    for (const line of lines || []) {
      const c = compilePattern(line);
      if (!c) continue;
      if (c.error) errors.push({ pattern: c.raw, error: c.error });
      compiled.push(c);
    }
    return { compiled, errors };
  }

  function matchesAny(list, rawText, foldedText) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.error) continue;
      try {
        if (p.test(rawText, foldedText)) return p;
      } catch (_e) { /* a pathological regex on one card must not stop the pass */ }
    }
    return null;
  }

  function matchesAll(list, rawText, foldedText) {
    let usable = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.error) continue;
      usable++;
      try {
        if (!p.test(rawText, foldedText)) return false;
      } catch (_e) { return false; }
    }
    return usable > 0;
  }

  /* --- numeric helpers ----------------------------------------------------- */

  const clamp01 = (n) => (isFiniteNumber(n) ? Math.min(1, Math.max(0, n)) : 0);

  /** Median of a numeric array (ignores non-finite values). Returns null if empty. */
  function median(values) {
    const list = (values || []).filter(isFiniteNumber).sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = list.length >> 1;
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  /**
   * Map a value onto 0..1 using a logarithmic scale between `lo` and `hi`.
   * Values at or below `lo` map to 0, at or above `hi` map to 1. Used by the
   * ranking model so that "1M vs 2M views" does not dwarf every other signal.
   */
  function logScale(value, lo, hi) {
    if (!isFiniteNumber(value) || value <= 0) return 0;
    const a = Math.log10(Math.max(lo, 1));
    const b = Math.log10(Math.max(hi, lo * 10));
    return clamp01((Math.log10(value) - a) / (b - a));
  }

  /* --- URL helpers -------------------------------------------------------- */

  function safeUrl(href, base) {
    if (!href) return null;
    try { return new URL(String(href), base || location.href); } catch (_e) { return null; }
  }

  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function extractVideoId(href) {
    const url = safeUrl(href);
    if (!url) return null;
    if (url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      return v && VIDEO_ID_RE.test(v) ? v : null;
    }
    const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function isSearchLocation(loc) {
    const l = loc || location;
    return /(^|\.)youtube\.com$/.test(l.hostname) && l.pathname === '/results';
  }

  /**
   * Split a raw YouTube query into positive terms, ignoring operator syntax so
   * that "require query terms" does not demand literal operator text.
   */
  function queryTerms(rawQuery) {
    const cleaned = String(rawQuery || '')
      .replace(/\b(?:before|after|intitle|channel|site|filter):\S+/gi, ' ')
      .replace(/[-+]\S+/g, (m) => (m[0] === '+' ? m.slice(1) : ' '));
    const terms = [];
    const phraseRe = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = phraseRe.exec(cleaned)) !== null) {
      const term = fold(m[1] || m[2] || '');
      if (term.length >= 2 && terms.indexOf(term) === -1) terms.push(term);
      if (terms.length >= 12) break;
    }
    return terms;
  }

  /* ==========================================================================
   * 3. Locale-aware metadata parsing
   *
   * YouTube renders counts and ages in the interface language, so hard-coded
   * English tables silently mis-parse for most of the world. Instead the unit
   * vocabulary is DERIVED at runtime from Intl (CLDR) for the document
   * language, with an English table as a permanent fallback. This keeps the
   * parser correct for locales never explicitly tested, and it degrades to
   * "unknown" (never to a wrong number) when nothing matches.
   * ======================================================================= */

  const LocaleParser = (() => {
    let cache = null;

    const docLocale = () => {
      const langAttr = document.documentElement && document.documentElement.getAttribute('lang');
      const lang = normalizeSpace(langAttr) || (navigator.language || 'en');
      try { return Intl.getCanonicalLocales(lang)[0] || 'en'; } catch (_e) { return 'en'; }
    };

    const buildDigitMap = (locale) => {
      const map = new Map();
      try {
        const nf = new Intl.NumberFormat(locale, { useGrouping: false });
        for (let d = 0; d <= 9; d++) {
          const rendered = nf.format(d);
          if (rendered && rendered !== String(d)) map.set(rendered, String(d));
        }
      } catch (_e) { /* ASCII digits only */ }
      return map;
    };

    const buildSeparators = (locale) => {
      let group = ',';
      let decimal = '.';
      try {
        const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
        for (const p of parts) {
          if (p.type === 'group') group = p.value;
          if (p.type === 'decimal') decimal = p.value;
        }
      } catch (_e) { /* defaults */ }
      return { group, decimal };
    };

    // Compact suffixes ("K", "Mio.", "万", "лакх"…) mapped to their multiplier.
    const buildCompactSuffixes = (locale) => {
      const table = [];
      const probes = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e12];
      let nf;
      try {
        nf = new Intl.NumberFormat(locale, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 0 });
      } catch (_e) { return table; }
      for (const probe of probes) {
        let rendered;
        try { rendered = nf.format(probe); } catch (_e) { continue; }
        // Strip the numeric part; whatever remains is the suffix token.
        const suffix = normalizeSpace(rendered.replace(/[\d\u0660-\u0669\u06f0-\u06f9\u0966-\u096f.,\u00a0\s]/g, ''));
        if (!suffix) continue;
        const leading = rendered.match(/[\d\u0660-\u0669\u06f0-\u06f9\u0966-\u096f]+/);
        const shown = leading ? Number(toAsciiDigits(leading[0], buildDigitMap(locale))) : NaN;
        if (!Number.isFinite(shown) || shown <= 0) continue;
        const multiplier = probe / shown;
        if (!Number.isFinite(multiplier) || multiplier < 1) continue;
        if (!table.some((entry) => entry.suffix === suffix)) table.push({ suffix, folded: fold(suffix), multiplier });
      }
      // Always keep the English/ASCII ladder available: YouTube sometimes emits
      // English abbreviations even on localised pages (e.g. API-sourced text).
      for (const [suffix, multiplier] of [['k', 1e3], ['m', 1e6], ['b', 1e9], ['t', 1e12]]) {
        if (!table.some((entry) => entry.folded === suffix)) table.push({ suffix, folded: suffix, multiplier });
      }
      table.sort((a, b) => b.folded.length - a.folded.length);
      return table;
    };

    // Relative-time unit vocabulary, e.g. { unit: 'year', tokens: ['years','year','años'] }.
    const buildRelativeUnits = (locale) => {
      const unitSeconds = {
        second: 1, minute: 60, hour: 3600, day: 86400,
        week: 604800, month: 2629800, year: 31557600
      };
      const out = [];
      for (const unit of Object.keys(unitSeconds)) {
        const tokens = new Set();
        if (CAPS.relativeTimeFormat) {
          for (const numeric of ['always']) {
            let rtf;
            try { rtf = new Intl.RelativeTimeFormat(locale, { numeric }); } catch (_e) { break; }
            for (const count of [1, 2, 3, 5, 11, 21]) {
              let rendered;
              try { rendered = rtf.format(-count, unit); } catch (_e) { continue; }
              const stripped = normalizeSpace(rendered.replace(/[\d\u0660-\u0669\u06f0-\u06f9\u0966-\u096f]+/g, ' '));
              for (const token of stripped.split(/[\s,.;:()]+/)) {
                const t = fold(token);
                if (t.length >= 1) tokens.add(t);
              }
            }
          }
        }
        // English fallback tokens: YouTube's own strings and API text.
        tokens.add(unit);
        tokens.add(`${unit}s`);
        out.push({ unit, seconds: unitSeconds[unit], tokens: Array.from(tokens).filter(Boolean) });
      }
      // Words shared by several units ("ago", "hace", "vor", "前") carry no unit
      // information: keep only tokens that identify exactly one unit.
      const frequency = new Map();
      for (const entry of out) {
        for (const token of new Set(entry.tokens)) frequency.set(token, (frequency.get(token) || 0) + 1);
      }
      for (const entry of out) {
        entry.tokens = entry.tokens.filter((token) => frequency.get(token) === 1);
      }
      // Longer units first so "month" is not shadowed by a shared prefix.
      out.sort((a, b) => b.seconds - a.seconds);
      return out;
    };

    function toAsciiDigits(text, digitMap) {
      if (!digitMap || digitMap.size === 0) return text;
      let out = '';
      for (const ch of String(text)) out += digitMap.get(ch) || ch;
      return out;
    }

    function build() {
      const locale = docLocale();
      const digitMap = buildDigitMap(locale);
      return {
        locale,
        digitMap,
        separators: buildSeparators(locale),
        compact: buildCompactSuffixes(locale),
        relative: buildRelativeUnits(locale),
        // Words that mark an ambiguous "ago" phrase as a stream/premiere.
        stopTokens: ['ago', 'streamed', 'premiered']
      };
    }

    function ctx() {
      if (!cache) cache = build();
      return cache;
    }

    return {
      reset() { cache = null; },
      get locale() { return ctx().locale; },

      /** Normalise localised digits and separators, then read the leading number. */
      parseNumber(text) {
        const c = ctx();
        const ascii = toAsciiDigits(normalizeSpace(text), c.digitMap);
        if (!ascii) return null;
        const groupRe = new RegExp(`\\${c.separators.group === ' ' ? '\\s' : escapeRegExp(c.separators.group)}`, 'g');
        let cleaned = ascii.replace(/[\u00a0\u202f\u2009]/g, ' ');
        cleaned = cleaned.replace(groupRe, '');
        if (c.separators.decimal !== '.') cleaned = cleaned.replace(new RegExp(escapeRegExp(c.separators.decimal), 'g'), '.');
        // Also treat ASCII grouping commas as separators when they group digits.
        cleaned = cleaned.replace(/(\d),(?=\d{3}\b)/g, '$1');
        const m = cleaned.match(/-?\d+(?:\.\d+)?/);
        if (!m) return null;
        const n = parseFloat(m[0]);
        return Number.isFinite(n) ? n : null;
      },

      /** "1.2M views" / "9,478,579 views" / "1万 回視聴" → 1200000 / 9478579 / 10000 */
      parseCount(text) {
        const c = ctx();
        const raw = normalizeSpace(text);
        if (!raw) return null;
        const base = this.parseNumber(raw);
        if (base === null) return null;
        const folded = fold(toAsciiDigits(raw, c.digitMap));
        for (const entry of c.compact) {
          if (!entry.folded) continue;
          // Suffix must appear attached to the number, not anywhere in the string,
          // otherwise "1 million views" style words inflate unrelated numbers.
          const re = new RegExp(`\\d\\s?${escapeRegExp(entry.folded)}(?![\\p{L}\\p{N}])`, 'u');
          if (re.test(folded)) return Math.round(base * entry.multiplier);
        }
        return Math.round(base);
      },

      /**
       * "3 years ago" / "hace 2 meses" / "2 か月前" → age in ms.
       * Returns null when the text is not a relative time expression.
       */
      parseRelativeAge(text) {
        const c = ctx();
        const raw = normalizeSpace(text);
        if (!raw) return null;
        const ascii = toAsciiDigits(raw, c.digitMap);
        const folded = fold(ascii);
        const numberMatch = ascii.match(/\d+(?:\.\d+)?/);
        for (const unit of c.relative) {
          for (const token of unit.tokens) {
            if (!token) continue;
            if (folded.indexOf(token) === -1) continue;
            const count = numberMatch ? parseFloat(numberMatch[0]) : 1;
            if (!Number.isFinite(count) || count < 0) return null;
            return Math.round(count * unit.seconds * 1000);
          }
        }
        return null;
      },

      /** "12:34" / "1:02:03" → seconds. Locale-safe (digits normalised). */
      parseClockDuration(text) {
        const c = ctx();
        const ascii = toAsciiDigits(normalizeSpace(text), c.digitMap);
        const m = ascii.match(/(?:^|\s)(\d{1,3}(?::\d{2}){1,2})(?:\s|$)/);
        if (!m) return null;
        const parts = m[1].split(':').map((p) => parseInt(p, 10));
        if (parts.some((p) => !Number.isFinite(p))) return null;
        return parts.reduce((acc, part) => acc * 60 + part, 0);
      },

      /** True when the first token of a metadata part is numeric. */
      startsWithNumber(text) {
        const c = ctx();
        const ascii = toAsciiDigits(normalizeSpace(text), c.digitMap);
        return /^[<>~]?\s*\d/.test(ascii);
      }
    };
  })();

  /* ==========================================================================
   * 3b. Text signals: writing system, title structure, series & similarity
   *
   * These are *derived* signals computed from the title text that YouTube
   * already renders. They are deliberately structural and language-neutral:
   * no word lists, no sentiment, no claims about content quality. Every metric
   * below has an exact definition, is stable for identical input, and is
   * presented as a heuristic in the interface.
   * ======================================================================= */

  const TextSignals = (() => {
    /**
     * Writing systems we can identify. Detection is by Unicode script ranges
     * (via \p{Script=…} when supported, otherwise code-point ranges), and it
     * reports the *script*, not the language: "Latin" covers English, Spanish,
     * Vietnamese and so on. Titles are classified by the script holding the
     * majority of their letters; titles with no letters are "unknown".
     */
    const SCRIPTS = Object.freeze([
      { id: 'latin', label: 'Latin', re: /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g },
      { id: 'cyrillic', label: 'Cyrillic', re: /[\u0400-\u04FF\u0500-\u052F]/g },
      { id: 'greek', label: 'Greek', re: /[\u0370-\u03FF\u1F00-\u1FFF]/g },
      { id: 'arabic', label: 'Arabic', re: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF]/g },
      { id: 'hebrew', label: 'Hebrew', re: /[\u0590-\u05FF]/g },
      { id: 'devanagari', label: 'Devanagari', re: /[\u0900-\u097F]/g },
      { id: 'bengali', label: 'Bengali', re: /[\u0980-\u09FF]/g },
      { id: 'tamil', label: 'Tamil', re: /[\u0B80-\u0BFF]/g },
      { id: 'thai', label: 'Thai', re: /[\u0E00-\u0E7F]/g },
      { id: 'han', label: 'Han (Chinese)', re: /[\u4E00-\u9FFF\u3400-\u4DBF]/g },
      { id: 'kana', label: 'Kana (Japanese)', re: /[\u3040-\u30FF]/g },
      { id: 'hangul', label: 'Hangul (Korean)', re: /[\uAC00-\uD7AF\u1100-\u11FF]/g }
    ]);

    const EMOJI_RE = /[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u{1F000}-\u{1FAFF}]/gu;
    const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
    const BRACKET_RE = /[[\](){}｜|]/g;
    const RUN_PUNCT_RE = /([!?])\1+|[!?]{2,}/g;

    const count = (text, re) => {
      re.lastIndex = 0;
      const matches = text.match(re);
      return matches ? matches.length : 0;
    };

    /** Dominant writing system of a string plus the per-script letter counts. */
    function scriptOf(text) {
      const value = String(text || '');
      if (!value) return { id: 'unknown', label: 'Unknown', counts: {} };
      const counts = {};
      let best = null;
      let bestCount = 0;
      let total = 0;
      for (const script of SCRIPTS) {
        const n = count(value, script.re);
        if (!n) continue;
        counts[script.id] = n;
        total += n;
        if (n > bestCount) { bestCount = n; best = script; }
      }
      if (!best || total === 0) return { id: 'unknown', label: 'Unknown', counts };
      // Japanese titles mix Kana and Han; Kana is the decisive marker.
      if (counts.kana && counts.han && best.id === 'han' && counts.kana >= counts.han * 0.15) {
        return { id: 'kana', label: 'Kana (Japanese)', counts };
      }
      return { id: best.id, label: best.label, counts };
    }

    /**
     * Structural "shouting" score for a title, 0 (calm) … 100 (maximally
     * shouty). Components are additive and capped; each is a plain structural
     * count, never a judgement about the video itself:
     *   • capsRatio   – share of A–Z letters that are upper-case, once the
     *                   title has at least 8 cased letters (up to 35 pts)
     *   • exclaim     – '!' and '?' characters beyond the first (up to 20 pts)
     *   • runs        – runs of repeated '!'/'?' (up to 10 pts)
     *   • emoji       – emoji/pictographs beyond the first (up to 15 pts)
     *   • brackets    – bracket/pipe characters beyond two (up to 10 pts)
     *   • hashtags    – hashtags beyond one (up to 10 pts)
     * Titles in scripts without letter case simply score 0 on capsRatio.
     */
    function styleOf(text) {
      const value = normalizeSpace(text);
      if (!value) return { score: 0, capsRatio: 0, exclaim: 0, emoji: 0, hashtags: 0, brackets: 0, runs: 0, length: 0 };
      const cased = value.match(/[A-Za-z\u00C0-\u024F]/g) || [];
      const upper = value.match(/[A-Z\u00C0-\u00DE]/g) || [];
      const capsRatio = cased.length >= 8 ? upper.length / cased.length : 0;
      const exclaim = count(value, /[!?！？]/g);
      const emoji = count(value, EMOJI_RE);
      const hashtags = count(value, HASHTAG_RE);
      const brackets = count(value, BRACKET_RE);
      const runs = count(value, RUN_PUNCT_RE);

      let score = 0;
      score += clamp01((capsRatio - 0.3) / 0.6) * 35;
      score += clamp01((exclaim - 1) / 3) * 20;
      score += clamp01(runs / 2) * 10;
      score += clamp01((emoji - 1) / 4) * 15;
      score += clamp01((brackets - 2) / 4) * 10;
      score += clamp01((hashtags - 1) / 3) * 10;
      return {
        score: Math.round(clamp01(score / 100) * 100),
        capsRatio: Math.round(capsRatio * 100) / 100,
        exclaim, emoji, hashtags, brackets, runs,
        length: value.length
      };
    }

    /* --- series / episode parsing ----------------------------------------- */

    const SERIES_PATTERNS = [
      /\bs(?:eason)?\s*(\d{1,2})\s*[·\-–—]?\s*e(?:p(?:isode)?)?\s*(\d{1,3})\b/i, // S02E03
      /\bepisode\s+(\d{1,3})\b/i,
      /\bep\.?\s*(\d{1,3})\b/i,
      /\bpart\s+(\d{1,3})\b/i,
      /\bpt\.?\s*(\d{1,3})\b/i,
      /\bday\s+(\d{1,3})\b/i,
      /\b#(\d{1,3})\b/,
      /\((\d{1,3})\s*\/\s*\d{1,3}\)/,
      /\[(\d{1,3})\s*\/\s*\d{1,3}\]/
    ];

    /**
     * Detect an episode marker. Returns { number, label, key } where `key` is
     * the title with the episode marker removed, used to group a series.
     * Returns null when the title carries no recognisable sequence marker.
     */
    function seriesOf(text) {
      const value = normalizeSpace(text);
      if (!value) return null;
      for (const pattern of SERIES_PATTERNS) {
        const match = value.match(pattern);
        if (!match) continue;
        const numbers = match.slice(1).filter((v) => v !== undefined).map(Number);
        if (!numbers.length || numbers.some((n) => !Number.isFinite(n))) continue;
        const episode = numbers[numbers.length - 1];
        const season = numbers.length > 1 ? numbers[0] : null;
        const stripped = value.replace(pattern, ' ');
        return {
          number: episode,
          season,
          label: season === null ? `#${episode}` : `S${season}E${episode}`,
          key: normalizeKey(stripped)
        };
      }
      return null;
    }

    /* --- normalisation, tokens and similarity ------------------------------ */

    const NOISE_TOKENS = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'vs',
      'official', 'video', 'hd', 'full', 'new', '4k', '1080p', '2160p', 'shorts'
    ]);

    /** Case/diacritic/punctuation-insensitive key used for grouping. */
    function normalizeKey(text) {
      return fold(text)
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /** Content tokens of a title, minus very common filler words. */
    function tokensOf(text) {
      const key = normalizeKey(text);
      if (!key) return [];
      const out = [];
      for (const token of key.split(' ')) {
        if (token.length < 2) continue;
        if (NOISE_TOKENS.has(token)) continue;
        if (out.indexOf(token) === -1) out.push(token);
        if (out.length >= 24) break;
      }
      return out;
    }

    /** Jaccard similarity of two token lists: |A∩B| / |A∪B|, 0…1. */
    function similarity(tokensA, tokensB) {
      if (!tokensA.length || !tokensB.length) return 0;
      const set = new Set(tokensA);
      let intersection = 0;
      for (const token of tokensB) if (set.has(token)) intersection++;
      const union = tokensA.length + tokensB.length - intersection;
      return union > 0 ? intersection / union : 0;
    }

    /** Stable 32-bit hash, used for bucketing similar titles cheaply. */
    function hash(text) {
      let h = 2166136261;
      const value = String(text || '');
      for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36);
    }

    return { SCRIPTS, scriptOf, styleOf, seriesOf, tokensOf, similarity, normalizeKey, hash };
  })();

  /* ==========================================================================
   * 4. Storage adapter
   *
   * One async API over four possible backends (GM sync, GM async, GM4 promise
   * API, localStorage). Writes are debounced and coalesced per key; a failed
   * write is reported and retried on the next change instead of corrupting or
   * dropping state. Cross-tab updates are honoured when the manager supports
   * value-change listeners.
   * ======================================================================= */

  const Store = (() => {
    const pendingWrites = new Map();   // key -> value
    const writeTimers = new Map();     // key -> timeout id
    const changeHandlers = new Map();  // key -> Set<fn>
    let backend = 'none';

    if (CAPS.gmGetSync && CAPS.gmSetSync) backend = 'gm-sync';
    else if (CAPS.gmAsync) backend = 'gm-async';
    else if (CAPS.localStorage) backend = 'local';

    const readRaw = async (key) => {
      switch (backend) {
        case 'gm-sync': return GM_getValue(key, null);
        case 'gm-async': return await GM.getValue(key, null);
        case 'local': return window.localStorage.getItem(key);
        default: return null;
      }
    };

    const writeRaw = async (key, raw) => {
      switch (backend) {
        case 'gm-sync': GM_setValue(key, raw); return;
        case 'gm-async': await GM.setValue(key, raw); return;
        case 'local': window.localStorage.setItem(key, raw); return;
        default: throw new Error('no storage backend available');
      }
    };

    const deleteRaw = async (key) => {
      switch (backend) {
        case 'gm-sync': if (CAPS.gmDelSync) GM_deleteValue(key); else GM_setValue(key, null); return;
        case 'gm-async': if (typeof GM.deleteValue === 'function') await GM.deleteValue(key); else await GM.setValue(key, null); return;
        case 'local': window.localStorage.removeItem(key); return;
        default: return;
      }
    };

    const parse = (raw) => {
      if (raw === null || raw === undefined || raw === '') return null;
      if (typeof raw === 'object') return raw; // GM backends can store structured values
      try { return JSON.parse(String(raw)); } catch (err) {
        Diag.warn('stored value is not valid JSON; ignoring it', err && err.message);
        return null;
      }
    };

    const flushKey = async (key) => {
      if (!pendingWrites.has(key)) return;
      const value = pendingWrites.get(key);
      pendingWrites.delete(key);
      try {
        if (value === undefined) await deleteRaw(key);
        else await writeRaw(key, JSON.stringify(value));
      } catch (err) {
        Diag.error(`failed to persist "${key}"`, err);
      }
    };

    // Cross-tab change notification (optional capability).
    const wireValueChange = (key) => {
      if (!CAPS.gmValueChange) return;
      try {
        GM_addValueChangeListener(key, (_name, _old, newValue, remote) => {
          if (!remote) return;
          const handlers = changeHandlers.get(key);
          if (!handlers || handlers.size === 0) return;
          const parsed = parse(newValue);
          for (const fn of handlers) {
            try { fn(parsed); } catch (err) { Diag.error('value-change handler failed', err); }
          }
        });
      } catch (err) {
        Diag.warn('GM_addValueChangeListener unavailable', err && err.message);
      }
    };

    if (backend === 'local' && CAPS.localStorage) {
      window.addEventListener('storage', (event) => {
        if (!event.key || !changeHandlers.has(event.key)) return;
        const handlers = changeHandlers.get(event.key);
        const parsed = parse(event.newValue);
        for (const fn of handlers) {
          try { fn(parsed); } catch (err) { Diag.error('storage handler failed', err); }
        }
      });
    }

    return {
      get backend() { return backend; },
      get available() { return backend !== 'none'; },

      async get(key, fallback) {
        try {
          const parsed = parse(await readRaw(key));
          return parsed === null ? fallback : parsed;
        } catch (err) {
          Diag.error(`failed to read "${key}"`, err);
          return fallback;
        }
      },

      /** Debounced write. Multiple rapid changes collapse into one store call. */
      set(key, value) {
        pendingWrites.set(key, value);
        if (writeTimers.has(key)) clearTimeout(writeTimers.get(key));
        writeTimers.set(key, window.setTimeout(() => {
          writeTimers.delete(key);
          flushKey(key);
        }, LIMITS.writeDebounceMs));
      },

      async remove(key) {
        if (writeTimers.has(key)) { clearTimeout(writeTimers.get(key)); writeTimers.delete(key); }
        pendingWrites.delete(key);
        try { await deleteRaw(key); } catch (err) { Diag.error(`failed to delete "${key}"`, err); }
      },

      onExternalChange(key, handler) {
        if (!changeHandlers.has(key)) {
          changeHandlers.set(key, new Set());
          wireValueChange(key);
        }
        changeHandlers.get(key).add(handler);
        return () => {
          const set = changeHandlers.get(key);
          if (set) set.delete(handler);
        };
      },

      /** Best-effort flush used on pagehide so nothing pending is lost. */
      flushAll() {
        for (const key of Array.from(writeTimers.keys())) {
          clearTimeout(writeTimers.get(key));
          writeTimers.delete(key);
          flushKey(key);
        }
      }
    };
  })();

  /* ==========================================================================
   * 5. Configuration: schema, defaults, validation, migration, presets
   *
   * The schema is the single authority for defaults, type coercion, range
   * clamping, import sanitisation and reset. Unknown keys from imported or
   * corrupted data are dropped rather than merged, so hostile input can never
   * inject properties into operational state.
   *
   * Three scopes share one vocabulary:
   *   • global   – the plain values in `filters`, `content`, `ranking`, …
   *   • context  – a named profile whose `rules` override the global scope
   *                while its activation conditions match the current page
   *   • channel  – a per-channel policy (stored separately) whose `rules`
   *                override both, plus explicit bypasses of global rules
   * Context and channel scopes use tri-state switches ('inherit' | 'on' |
   * 'off') and nullable numbers so "not configured" is always distinguishable
   * from "configured to false/zero".
   * ======================================================================= */

  const S = {
    bool: (def) => ({ type: 'bool', def }),
    tri: () => ({ type: 'enum', def: 'inherit', values: ['inherit', 'on', 'off'] }),
    int: (def, min, max, nullable) => ({ type: 'int', def, min, max, nullable: !!nullable }),
    num: (def, min, max, nullable) => ({ type: 'num', def, min, max, nullable: !!nullable }),
    str: (def, maxLen) => ({ type: 'str', def, maxLen: maxLen || 200 }),
    enm: (def, values) => ({ type: 'enum', def, values }),
    list: (maxItems) => ({ type: 'list', def: [], maxItems: maxItems || LIMITS.maxListEntries }),
    obj: (fields) => ({ type: 'object', fields }),
    items: (item, maxItems) => ({ type: 'items', item, def: [], maxItems })
  };

  const SORT_IDS = SORT_MODES.map((m) => m.id);
  const GROUP_IDS = GROUP_MODES.map((m) => m.id);

  /**
   * Rule overrides usable by context profiles and channel policies.
   * Every field defaults to "inherit"/null, i.e. "defer to the wider scope".
   */
  const SCOPED_RULES = () => S.obj({
    sortMode: S.enm('inherit', ['inherit'].concat(SORT_IDS)),
    groupBy: S.enm('inherit', ['inherit'].concat(GROUP_IDS)),
    viewsMin: S.int(null, 0, 1e12, true),
    viewsMax: S.int(null, 0, 1e12, true),
    likesMin: S.int(null, 0, 1e12, true),
    likeRatioMin: S.num(null, 0, 1, true),
    outperformMin: S.num(null, 0, 100, true),
    durationMinSec: S.int(null, 0, 360000, true),
    durationMaxSec: S.int(null, 0, 360000, true),
    ageMaxDays: S.num(null, 0, 20000, true),
    ageMinDays: S.num(null, 0, 20000, true),
    styleMaxScore: S.int(null, 0, 100, true),
    scoreFloor: S.num(null, 0, 100, true),
    hideShorts: S.tri(),
    hideLive: S.tri(),
    hideUpcoming: S.tri(),
    hideWatched: S.tri(),
    hideMembersOnly: S.tri(),
    hideSeen: S.tri(),
    requireQueryTerms: S.enm('inherit', ['inherit', 'off', 'any', 'all']),
    titleInclude: S.list(120),
    titleIncludeMode: S.enm('inherit', ['inherit', 'any', 'all']),
    titleExclude: S.list(120),
    tagInclude: S.list(120),
    tagExclude: S.list(120)
  });

  const CONTEXT_SCHEMA = S.obj({
    id: S.str('', 60),
    name: S.str('Context', 60),
    enabled: S.bool(true),
    when: S.obj({
      queryPattern: S.str('', 200),
      pageTypes: S.list(4),                       // '' / 'search' / 'channel-grid' / 'channel-search'
      channelScope: S.enm('any', ['any', 'configured', 'unconfigured']),
      withYouTubeFilter: S.enm('any', ['any', 'with', 'without'])
    }),
    rules: SCOPED_RULES()
  });

  const CONFIG_SCHEMA = S.obj({
    schemaVersion: S.int(APP.schemaVersion, 1, 1000),
    enabled: S.bool(true),

    display: S.obj({
      mode: S.enm('hide', DISPLAY_MODES.map((m) => m.id)),
      showHidden: S.bool(false),
      showBar: S.bool(true),
      showBadges: S.bool(true),
      showReasons: S.bool(true),
      showScope: S.bool(true),
      showScore: S.bool(true),
      channelAccents: S.bool(true),
      highlightQuery: S.bool(false),
      compactRows: S.bool(false),
      theme: S.enm('auto', ['auto', 'dark', 'light'])
    }),

    filters: S.obj({
      hideShorts: S.bool(false),
      hideShortsShelves: S.bool(true),
      hideShelves: S.bool(true),
      hidePlaylists: S.bool(false),
      hideMixes: S.bool(false),
      hideChannels: S.bool(false),
      hideMovies: S.bool(false),
      hidePromoted: S.bool(true),
      hideLive: S.bool(false),
      hideUpcoming: S.bool(false),
      hideMembersOnly: S.bool(false),
      verifiedOnly: S.bool(false),
      hideWatched: S.bool(false),
      watchedThreshold: S.int(80, 1, 100),
      hideDuplicates: S.bool(true),
      viewsMin: S.int(null, 0, 1e12, true),
      viewsMax: S.int(null, 0, 1e12, true),
      likesMin: S.int(null, 0, 1e12, true),
      likeRatioMin: S.num(null, 0, 1, true),
      outperformMin: S.num(null, 0, 100, true),
      durationMinSec: S.int(null, 0, 360000, true),
      durationMaxSec: S.int(null, 0, 360000, true),
      ageMaxDays: S.num(null, 0, 20000, true),
      ageMinDays: S.num(null, 0, 20000, true),
      titleExclude: S.list(),
      titleInclude: S.list(),
      titleIncludeMode: S.enm('any', ['any', 'all']),
      matchDescription: S.bool(false),
      channelBlock: S.list(),
      channelAllow: S.list(),
      maxPerChannel: S.int(null, 1, 50, true),
      requireQueryTerms: S.enm('off', ['off', 'any', 'all'])
    }),

    // Content intelligence that needs precision metadata (tags, description,
    // category, region availability). Each rule is inert without it.
    content: S.obj({
      tagInclude: S.list(),
      tagExclude: S.list(),
      tagIncludeMode: S.enm('any', ['any', 'all']),
      descriptionInclude: S.list(),
      descriptionExclude: S.list(),
      categoryDeny: S.list(40),
      categoryAllow: S.list(40),
      familySafeOnly: S.bool(false),
      regionFilter: S.bool(false),
      regionCode: S.str('', 4)
    }),

    // Structural title analysis (see TextSignals).
    style: S.obj({
      enabled: S.bool(false),
      maxScore: S.int(60, 0, 100),
      action: S.enm('demote', ['hide', 'demote']),
      demotePoints: S.int(15, 0, 100),
      minTitleLength: S.int(null, 0, 300, true),
      maxTitleLength: S.int(null, 0, 300, true)
    }),

    // Writing system of the title.
    scripts: S.obj({
      mode: S.enm('off', ['off', 'allow', 'deny']),
      list: S.list(20)
    }),

    // Near-duplicate and series handling.
    dedupe: S.obj({
      similarEnabled: S.bool(false),
      similarThreshold: S.num(0.75, 0.4, 1),
      similarKeep: S.int(1, 1, 10),
      similarAction: S.enm('hide', ['hide', 'group']),
      seriesEnabled: S.bool(false),
      seriesKeep: S.int(2, 1, 20),
      seriesPrefer: S.enm('first', ['first', 'newest', 'lowest-episode', 'highest-episode'])
    }),

    // Personal memory of results already surfaced to the user.
    memory: S.obj({
      trackSeen: S.bool(true),
      hideSeen: S.bool(false),
      seenTtlDays: S.int(30, 1, LIMITS.memoryTtlDays),
      seenScopeQuery: S.bool(true)
    }),

    // Weighted ranking model (used when sort.mode === 'score').
    ranking: S.obj({
      weights: S.obj({
        recency: S.num(1, 0, 5),
        views: S.num(0.6, 0, 5),
        velocity: S.num(1, 0, 5),
        engagement: S.num(0.5, 0, 5),
        queryMatch: S.num(1.2, 0, 5),
        durationFit: S.num(0.4, 0, 5),
        titleCalm: S.num(0.3, 0, 5),
        channelPriority: S.num(1.5, 0, 5),
        outperformance: S.num(0.6, 0, 5)
      }),
      halfLifeDays: S.num(180, 1, 3650),
      targetMinSec: S.int(300, 0, 360000),
      targetMaxSec: S.int(2400, 0, 360000),
      scoreFloor: S.num(null, 0, 100, true),
      groupBy: S.enm('none', GROUP_IDS),
      pinnedFirst: S.bool(true),
      priorityFirst: S.bool(true),
      tierHigh: S.num(65, 0, 100),
      tierLow: S.num(35, 0, 100)
    }),

    sort: S.obj({
      mode: S.enm('relevance', SORT_IDS),
      unknownLast: S.bool(true)
    }),

    contexts: S.items(CONTEXT_SCHEMA, LIMITS.maxContexts),

    precision: S.obj({
      enabled: S.bool(false),
      concurrency: S.int(4, 1, LIMITS.maxEnrichConcurrency),
      ttlHours: S.int(168, 1, 24 * 90),
      cacheEnabled: S.bool(true),
      channelPages: S.bool(true)
    }),

    channelPages: S.obj({
      enabled: S.bool(true),
      applyGlobalFilters: S.bool(false),
      applySort: S.bool(true)
    }),

    deepLoad: S.obj({
      batches: S.int(3, 1, LIMITS.deepLoadMaxBatches),
      autoWhenSparse: S.bool(false),
      minVisible: S.int(8, 1, 200)
    }),

    shortcuts: S.obj({
      enabled: S.bool(true),
      togglePanel: S.str('Alt+Shift+F', 40),
      toggleHidden: S.str('Alt+Shift+H', 40),
      cycleSort: S.str('Alt+Shift+S', 40),
      focusSearch: S.str('Alt+Shift+Q', 40),
      blockChannel: S.str('Alt+Shift+B', 40)
    }),

    advanced: S.obj({
      debug: S.bool(false),
      activePreset: S.str('', 60)
    })
  });

  /** Deterministic, schema-driven validation + coercion. */
  function coerce(schema, value, issues, path) {
    const here = path || '';
    if (value === null && schema.type !== 'int' && schema.type !== 'num') value = undefined;
    switch (schema.type) {
      case 'bool':
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value !== undefined) issues.push(`${here}: expected boolean`);
        return schema.def;
      case 'int':
      case 'num': {
        if (value === null || value === '') return schema.nullable ? null : schema.def;
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          if (value !== undefined) issues.push(`${here}: expected number`);
          return schema.def;
        }
        const rounded = schema.type === 'int' ? Math.round(n) : n;
        return clamp(rounded, schema.min, schema.max);
      }
      case 'str': {
        if (typeof value !== 'string') {
          if (value !== undefined) issues.push(`${here}: expected string`);
          return schema.def;
        }
        return value.slice(0, schema.maxLen);
      }
      case 'enum':
        if (schema.values.indexOf(value) !== -1) return value;
        if (value !== undefined) issues.push(`${here}: unsupported value`);
        return schema.def;
      case 'list': {
        if (!Array.isArray(value)) {
          if (value !== undefined) issues.push(`${here}: expected array`);
          return [];
        }
        const out = [];
        for (const item of value) {
          if (typeof item !== 'string') continue;
          const trimmed = item.trim().slice(0, LIMITS.maxPatternLength);
          if (trimmed && out.indexOf(trimmed) === -1) out.push(trimmed);
          if (out.length >= schema.maxItems) break;
        }
        return out;
      }
      case 'items': {
        if (!Array.isArray(value)) {
          if (value !== undefined) issues.push(`${here}: expected array`);
          return [];
        }
        const out = [];
        for (let i = 0; i < value.length && out.length < schema.maxItems; i++) {
          out.push(coerce(schema.item, value[i], issues, `${here}[${i}]`));
        }
        return out;
      }
      case 'object': {
        const out = {};
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
          issues.push(`${here || 'root'}: expected object`);
        }
        for (const key of Object.keys(schema.fields)) {
          out[key] = coerce(schema.fields[key], source[key], issues, here ? `${here}.${key}` : key);
        }
        return out;
      }
      default:
        return schema.def;
    }
  }

  function defaultsOf(schema) { return coerce(schema, undefined, [], ''); }

  const BUILTIN_PRESETS = Object.freeze([
    {
      id: 'builtin:clean',
      name: 'Clean search',
      builtin: true,
      patch: {
        filters: { hideShelves: true, hideShortsShelves: true, hidePromoted: true, hideDuplicates: true, hideMixes: true },
        sort: { mode: 'relevance' }
      }
    },
    {
      id: 'builtin:longform',
      name: 'Long-form only',
      builtin: true,
      patch: {
        filters: { hideShorts: true, hideShortsShelves: true, hideShelves: true, durationMinSec: 600, hideMixes: true, hidePlaylists: true },
        sort: { mode: 'relevance' }
      }
    },
    {
      id: 'builtin:fresh',
      name: 'Fresh uploads',
      builtin: true,
      patch: {
        filters: { hideShelves: true, hideShortsShelves: true, ageMaxDays: 30, hideShorts: true },
        sort: { mode: 'newest' }
      }
    },
    {
      id: 'builtin:signal',
      name: 'Signal over noise',
      builtin: true,
      patch: {
        filters: { hideShelves: true, hideShortsShelves: true, hideShorts: true, hideMixes: true, maxPerChannel: 3 },
        style: { enabled: true, maxScore: 55, action: 'demote', demotePoints: 20 },
        dedupe: { similarEnabled: true, similarThreshold: 0.75, similarKeep: 1, similarAction: 'hide' },
        sort: { mode: 'score' },
        ranking: { groupBy: 'tier' }
      }
    },
    {
      id: 'builtin:research',
      name: 'Research mode',
      builtin: true,
      patch: {
        filters: { hideShelves: true, hideShortsShelves: true, hideShorts: true, requireQueryTerms: 'all' },
        dedupe: { similarEnabled: true, similarThreshold: 0.8, similarKeep: 1, similarAction: 'group', seriesEnabled: true, seriesKeep: 2 },
        memory: { trackSeen: true, hideSeen: false },
        sort: { mode: 'score' },
        ranking: { groupBy: 'channel', weights: { queryMatch: 2, recency: 0.6, views: 0.4, velocity: 0.6, engagement: 0.8 } }
      }
    },
    {
      id: 'builtin:trusted',
      name: 'Trusted channels first',
      builtin: true,
      patch: {
        filters: { hideShelves: true, hideShortsShelves: true },
        sort: { mode: 'score' },
        ranking: { priorityFirst: true, groupBy: 'tier', weights: { channelPriority: 3, queryMatch: 1.2, recency: 0.8 } }
      }
    }
  ]);

  const Config = (() => {
    let current = defaultsOf(CONFIG_SCHEMA);
    let presets = [];
    const subscribers = new Set();
    let loaded = false;
    let lastIssues = [];

    const clone = (value) => (typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value)));

    const notify = (origin) => {
      for (const fn of subscribers) {
        try { fn(current, origin); } catch (err) { Diag.error('config subscriber failed', err); }
      }
    };

    /**
     * Migration. v1 → v2 only adds sections, so validated v1 data upgrades by
     * filling defaults; the hook exists so future versions transform rather
     * than discard. Unknown *newer* versions are kept and validated, never wiped.
     */
    const migrate = (raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const version = Number(raw.schemaVersion) || 0;
      if (version > APP.schemaVersion) {
        Diag.warn(`stored config is from a newer version (v${version}); unknown fields are ignored`);
      } else if (version === 1) {
        Diag.info('upgrading configuration from schema v1 to v2');
      }
      return raw;
    };

    const validate = (raw) => {
      const issues = [];
      const value = coerce(CONFIG_SCHEMA, migrate(raw), issues, '');
      value.schemaVersion = APP.schemaVersion;
      // Context profiles need stable ids; generate one when missing.
      value.contexts.forEach((ctx, index) => {
        if (!ctx.id) ctx.id = `ctx${Date.now().toString(36)}${index}`;
      });
      return { value, issues };
    };

    const sanitizePresets = (raw) => {
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
        if (!name) continue;
        const issues = [];
        const snapshot = coerce(CONFIG_SCHEMA, item.config, issues, `preset(${name})`);
        out.push({ id: typeof item.id === 'string' ? item.id.slice(0, 80) : `user:${name}`, name, config: snapshot });
        if (out.length >= LIMITS.maxPresets) break;
      }
      return out;
    };

    return {
      get value() { return current; },
      get presets() { return presets.slice(); },
      get builtinPresets() { return BUILTIN_PRESETS.slice(); },
      get loaded() { return loaded; },
      get issues() { return lastIssues.slice(); },

      async load() {
        const rawConfig = await Store.get(APP.storage.config, null);
        const { value, issues } = validate(rawConfig);
        current = value;
        lastIssues = issues;
        if (issues.length) Diag.warn(`configuration repaired (${issues.length} issue(s))`, issues.slice(0, 5).join('; '));
        presets = sanitizePresets(await Store.get(APP.storage.presets, []));
        loaded = true;
        Diag.setDebug(current.advanced.debug);

        Store.onExternalChange(APP.storage.config, (incoming) => {
          const result = validate(incoming);
          current = result.value;
          Diag.setDebug(current.advanced.debug);
          notify('remote');
        });
        Store.onExternalChange(APP.storage.presets, (incoming) => {
          presets = sanitizePresets(incoming);
          notify('remote');
        });
        return current;
      },

      patch(partial, origin) {
        const merged = mergeDeep(clone(current), partial);
        const { value, issues } = validate(merged);
        lastIssues = issues;
        current = value;
        Diag.setDebug(current.advanced.debug);
        Store.set(APP.storage.config, current);
        notify(origin || 'local');
        return current;
      },

      setPath(path, value, origin) {
        const patch = {};
        const parts = String(path).split('.');
        let cursor = patch;
        for (let i = 0; i < parts.length - 1; i++) {
          cursor[parts[i]] = {};
          cursor = cursor[parts[i]];
        }
        cursor[parts[parts.length - 1]] = value;
        return this.patch(patch, origin);
      },

      getPath(path) {
        return String(path).split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), current);
      },

      /** Replace the context profile list wholesale (already user-validated). */
      setContexts(contexts, origin) {
        const merged = clone(current);
        merged.contexts = contexts;
        const { value, issues } = validate(merged);
        lastIssues = issues;
        current = value;
        Store.set(APP.storage.config, current);
        notify(origin || 'contexts');
        return current.contexts;
      },

      reset(origin) {
        current = defaultsOf(CONFIG_SCHEMA);
        lastIssues = [];
        Diag.setDebug(false);
        Store.set(APP.storage.config, current);
        notify(origin || 'reset');
        return current;
      },

      subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },

      savePreset(name) {
        const trimmed = String(name || '').trim().slice(0, 60);
        if (!trimmed) return { ok: false, error: 'A preset needs a name.' };
        const snapshot = clone(current);
        snapshot.advanced.activePreset = '';
        const existingIndex = presets.findIndex((p) => p.name.toLowerCase() === trimmed.toLowerCase());
        const entry = { id: existingIndex >= 0 ? presets[existingIndex].id : `user:${Date.now().toString(36)}`, name: trimmed, config: snapshot };
        if (existingIndex >= 0) presets[existingIndex] = entry;
        else if (presets.length >= LIMITS.maxPresets) return { ok: false, error: `Preset limit reached (${LIMITS.maxPresets}).` };
        else presets.push(entry);
        Store.set(APP.storage.presets, presets);
        this.patch({ advanced: { activePreset: entry.id } }, 'preset-save');
        return { ok: true, id: entry.id };
      },

      deletePreset(id) {
        const before = presets.length;
        presets = presets.filter((p) => p.id !== id);
        if (presets.length === before) return false;
        Store.set(APP.storage.presets, presets);
        if (current.advanced.activePreset === id) this.patch({ advanced: { activePreset: '' } }, 'preset-delete');
        else notify('preset-delete');
        return true;
      },

      applyPreset(id) {
        const builtin = BUILTIN_PRESETS.find((p) => p.id === id);
        if (builtin) {
          this.patch(mergeDeep(clone(builtin.patch), { advanced: { activePreset: id } }), 'preset');
          return true;
        }
        const custom = presets.find((p) => p.id === id);
        if (!custom) return false;
        const { value } = validate(custom.config);
        value.advanced.activePreset = id;
        current = value;
        Diag.setDebug(current.advanced.debug);
        Store.set(APP.storage.config, current);
        notify('preset');
        return true;
      },

      exportPayload(extras) {
        return Object.assign({
          app: APP.id,
          name: APP.name,
          version: APP.version,
          schemaVersion: APP.schemaVersion,
          exportedAt: new Date().toISOString(),
          config: clone(current),
          presets: clone(presets)
        }, extras || {});
      },

      /** Imported data is untrusted: parsed, shape-checked, then schema-coerced. */
      importPayload(text) {
        let parsed;
        try {
          parsed = JSON.parse(String(text));
        } catch (err) {
          return { ok: false, error: `Not valid JSON: ${err.message}` };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, error: 'Expected a JSON object.' };
        }
        if (parsed.app && parsed.app !== APP.id) {
          return { ok: false, error: `This backup belongs to "${String(parsed.app).slice(0, 30)}".` };
        }
        const source = parsed.config && typeof parsed.config === 'object' ? parsed.config : parsed;
        const { value, issues } = validate(source);
        current = value;
        lastIssues = issues;
        Diag.setDebug(current.advanced.debug);
        Store.set(APP.storage.config, current);
        if (Array.isArray(parsed.presets)) {
          presets = sanitizePresets(parsed.presets);
          Store.set(APP.storage.presets, presets);
        }
        notify('import');
        return { ok: true, issues, channels: parsed.channels };
      }
    };
  })();

  /** Merge plain objects only; arrays and scalars replace wholesale. */
  function mergeDeep(target, source) {
    if (!source || typeof source !== 'object') return target;
    for (const key of Object.keys(source)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
        mergeDeep(target[key], value);
      } else {
        target[key] = value;
      }
    }
    return target;
  }

  /* ==========================================================================
   * 5b. Channel policies — channel-level intelligence as a first-class scope
   *
   * A policy is keyed by the most stable identity available, in this order:
   *   id:UC…      canonical channel id (authoritative)
   *   handle:@x   channel handle (stable in practice, user-visible)
   *   name:…      folded display name (last resort; documented as weakest)
   * When a stronger identity is later discovered for the same channel (for
   * example precision metadata reveals the channel id behind a handle), the
   * policy is *promoted*: it is re-keyed to the stronger identity and the
   * weaker identity is kept as an alias, so a rule created before the id was
   * known keeps working and does not duplicate.
   *
   * Lookups are O(1) through three indices, so thousands of policies cost the
   * same per card as a handful.
   * ======================================================================= */

  const CHANNEL_SCHEMA = S.obj({
    key: S.str('', 80),
    channelId: S.str('', 40),
    handle: S.str('', 60),
    name: S.str('', 120),
    aliases: S.list(10),
    mode: S.enm('normal', CHANNEL_MODES.map((m) => m.id)),
    enabled: S.bool(true),
    snoozeUntil: S.num(null, 0, 1e15, true),
    boost: S.num(0, -50, 50),
    limit: S.int(null, 1, 100, true),
    bypass: S.list(BYPASSABLE.length),
    color: S.str('', 9),
    label: S.str('', 24),
    note: S.str('', 300),
    rules: SCOPED_RULES(),
    createdAt: S.num(0, 0, 1e15),
    updatedAt: S.num(0, 0, 1e15)
  });

  const Channels = (() => {
    const byKey = new Map();
    const byId = new Map();
    const byHandle = new Map();
    const byName = new Map();
    const compiledCache = new Map(); // key+updatedAt -> compiled rule set
    const subscribers = new Set();
    let loaded = false;
    let dirty = false;

    const now = () => Date.now();
    const CHANNEL_ID_RE = /^UC[\w-]{20,}$/;

    const normalizeHandle = (handle) => {
      const value = normalizeSpace(handle).toLowerCase();
      if (!value) return '';
      return value.startsWith('@') ? value : `@${value}`;
    };

    const keyFor = (identity) => {
      if (identity.channelId && CHANNEL_ID_RE.test(identity.channelId)) return `id:${identity.channelId}`;
      const handle = normalizeHandle(identity.handle);
      if (handle) return `handle:${handle}`;
      const name = fold(identity.name);
      return name ? `name:${name}` : '';
    };

    function reindex() {
      byId.clear();
      byHandle.clear();
      byName.clear();
      for (const policy of byKey.values()) {
        if (policy.channelId) byId.set(policy.channelId, policy);
        if (policy.handle) byHandle.set(policy.handle, policy);
        if (policy.name) byName.set(fold(policy.name), policy);
        for (const alias of policy.aliases) {
          if (alias.startsWith('id:')) byId.set(alias.slice(3), policy);
          else if (alias.startsWith('handle:')) byHandle.set(alias.slice(7), policy);
          else if (alias.startsWith('name:')) byName.set(alias.slice(5), policy);
        }
      }
    }

    function persist() {
      if (!dirty) return;
      dirty = false;
      const list = Array.from(byKey.values())
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, LIMITS.maxChannelPolicies);
      Store.set(APP.storage.channels, { v: 1, policies: list });
    }

    const notify = (origin) => {
      compiledCache.clear();
      for (const fn of subscribers) {
        try { fn(origin); } catch (err) { Diag.error('channel subscriber failed', err); }
      }
    };

    function sanitize(raw) {
      const issues = [];
      const policy = coerce(CHANNEL_SCHEMA, raw, issues, 'channel');
      policy.handle = normalizeHandle(policy.handle);
      policy.channelId = CHANNEL_ID_RE.test(policy.channelId) ? policy.channelId : '';
      policy.color = /^#[0-9a-fA-F]{3,8}$/.test(policy.color) ? policy.color : '';
      policy.bypass = policy.bypass.filter((id) => BYPASSABLE.some((b) => b.id === id));
      // The key always follows the strongest identity currently known, so a
      // policy created from a handle is re-keyed once the channel id appears.
      policy.key = keyFor(policy) || policy.key;
      if (!policy.createdAt) policy.createdAt = now();
      if (!policy.updatedAt) policy.updatedAt = policy.createdAt;
      return policy.key ? policy : null;
    }

    /** Is this policy currently in force? (Disabled and snoozed rules are not.) */
    function isActive(policy) {
      if (!policy || !policy.enabled) return false;
      if (isFiniteNumber(policy.snoozeUntil) && policy.snoozeUntil > now()) return false;
      return true;
    }

    return {
      get loaded() { return loaded; },
      get size() { return byKey.size; },
      get schema() { return CHANNEL_SCHEMA; },

      async load() {
        const raw = await Store.get(APP.storage.channels, null);
        byKey.clear();
        const list = raw && Array.isArray(raw.policies) ? raw.policies : [];
        for (const item of list) {
          const policy = sanitize(item);
          if (!policy) continue;
          byKey.set(policy.key, policy);
          if (byKey.size >= LIMITS.maxChannelPolicies) break;
        }
        reindex();
        loaded = true;
        Diag.info(`channel policies loaded (${byKey.size})`);

        Store.onExternalChange(APP.storage.channels, (incoming) => {
          byKey.clear();
          const remote = incoming && Array.isArray(incoming.policies) ? incoming.policies : [];
          for (const item of remote) {
            const policy = sanitize(item);
            if (policy) byKey.set(policy.key, policy);
          }
          reindex();
          notify('remote');
        });
        return byKey.size;
      },

      subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },

      all() {
        return Array.from(byKey.values());
      },

      /** Resolve the policy governing a channel identity, or null. */
      lookup(identity) {
        if (!identity) return null;
        if (identity.channelId) {
          const hit = byId.get(identity.channelId);
          if (hit) return hit;
        }
        if (identity.handle) {
          const hit = byHandle.get(normalizeHandle(identity.handle));
          if (hit) return hit;
        }
        if (identity.name) {
          const hit = byName.get(fold(identity.name));
          if (hit) return hit;
        }
        return null;
      },

      /** Resolve only policies that are enabled and not snoozed. */
      active(identity) {
        const policy = this.lookup(identity);
        return isActive(policy) ? policy : null;
      },

      isActive,

      byKey(key) { return byKey.get(key) || null; },

      /** Create or update a policy; returns the stored object. */
      upsert(input, origin) {
        const identity = {
          channelId: input.channelId || '',
          handle: input.handle || '',
          name: input.name || ''
        };
        const existing = this.lookup(identity);
        const base = existing ? Object.assign({}, existing) : { createdAt: now(), aliases: [] };
        const merged = Object.assign(base, input);
        merged.aliases = Array.isArray(base.aliases) ? base.aliases.slice() : [];
        merged.updatedAt = now();
        const policy = sanitize(merged);
        if (!policy) return null;

        if (existing && existing.key !== policy.key) {
          // Identity promotion: keep the old key as an alias and drop the old row.
          if (policy.aliases.indexOf(existing.key) === -1) policy.aliases.push(existing.key);
          byKey.delete(existing.key);
        }
        if (!existing && byKey.size >= LIMITS.maxChannelPolicies) {
          Diag.warn(`channel policy limit reached (${LIMITS.maxChannelPolicies})`);
          return null;
        }
        byKey.set(policy.key, policy);
        reindex();
        dirty = true;
        persist();
        notify(origin || 'upsert');
        return policy;
      },

      remove(key, origin) {
        if (!byKey.has(key)) return false;
        byKey.delete(key);
        reindex();
        dirty = true;
        persist();
        notify(origin || 'remove');
        return true;
      },

      update(key, changes, origin) {
        const policy = byKey.get(key);
        if (!policy) return null;
        return this.upsert(Object.assign({}, policy, changes, { key }), origin || 'update');
      },

      setEnabled(key, enabled, origin) {
        return this.update(key, { enabled: !!enabled, snoozeUntil: null }, origin || 'toggle');
      },

      snooze(key, days, origin) {
        const until = isFiniteNumber(days) && days > 0 ? now() + days * 86400000 : null;
        return this.update(key, { snoozeUntil: until }, origin || 'snooze');
      },

      /**
       * Record a stronger identity for a channel we have already seen.
       * Promotes handle/name-keyed policies to id-keyed ones exactly once.
       */
      learnIdentity(identity) {
        if (!identity || !identity.channelId || !CHANNEL_ID_RE.test(identity.channelId)) return false;
        const policy = this.lookup(identity);
        if (!policy) return false;
        if (policy.channelId === identity.channelId && (!identity.handle || policy.handle === normalizeHandle(identity.handle))) {
          return false;
        }
        const next = Object.assign({}, policy, {
          channelId: identity.channelId,
          handle: normalizeHandle(identity.handle) || policy.handle,
          name: identity.name || policy.name
        });
        this.upsert(next, 'identity');
        Diag.info(`channel policy promoted to id ${identity.channelId}`);
        return true;
      },

      /** Compiled keyword rules for a policy, cached until the policy changes. */
      compiled(policy) {
        if (!policy) return null;
        const cacheKey = `${policy.key}:${policy.updatedAt}`;
        const cached = compiledCache.get(cacheKey);
        if (cached) return cached;
        const compiled = {
          titleExclude: compilePatternList(policy.rules.titleExclude).compiled,
          titleInclude: compilePatternList(policy.rules.titleInclude).compiled,
          tagExclude: compilePatternList(policy.rules.tagExclude).compiled,
          tagInclude: compilePatternList(policy.rules.tagInclude).compiled,
          bypass: new Set(policy.bypass)
        };
        if (compiledCache.size > 512) compiledCache.clear();
        compiledCache.set(cacheKey, compiled);
        return compiled;
      },

      exportList() { return this.all(); },

      /** Merge an imported list; existing policies with the same identity win. */
      importList(list, replace) {
        if (!Array.isArray(list)) return { ok: false, error: 'Expected an array of channel policies.' };
        if (replace) byKey.clear();
        let imported = 0;
        let skipped = 0;
        for (const item of list) {
          const policy = sanitize(item);
          if (!policy) { skipped++; continue; }
          if (byKey.size >= LIMITS.maxChannelPolicies) { skipped++; continue; }
          byKey.set(policy.key, policy);
          imported++;
        }
        reindex();
        dirty = true;
        persist();
        notify('import');
        return { ok: true, imported, skipped };
      },

      clear(origin) {
        byKey.clear();
        reindex();
        dirty = true;
        persist();
        notify(origin || 'clear');
      }
    };
  })();

  /* ==========================================================================
   * 5c. Personal result memory
   *
   * Two independent things live here, both local to this browser profile:
   *   • verdicts — explicit per-video decisions (pin / mute / snooze until)
   *   • seen     — video ids that were *shown to the user* in an earlier
   *                search session, enabling "hide what I already scrolled past"
   * A video seen during the current session is never suppressed, so results do
   * not vanish while the user is looking at them.
   * ======================================================================= */

  const Memory = (() => {
    const verdicts = new Map(); // videoId -> { v, until, t }
    const seen = new Map();     // videoId -> { t, q, s }
    const subscribers = new Set();
    const sessionId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let loaded = false;
    let dirty = false;
    let writeTimer = 0;

    const now = () => Date.now();

    function schedulePersist() {
      dirty = true;
      if (writeTimer) return;
      writeTimer = window.setTimeout(() => {
        writeTimer = 0;
        persist();
      }, 1200);
    }

    function prune() {
      const ttl = LIMITS.memoryTtlDays * 86400000;
      const cutoff = now() - ttl;
      for (const [id, entry] of seen) if (entry.t < cutoff) seen.delete(id);
      for (const [id, entry] of verdicts) {
        if (entry.v === 'snooze' && isFiniteNumber(entry.until) && entry.until < now()) verdicts.delete(id);
      }
      if (seen.size > LIMITS.maxMemoryEntries) {
        const ordered = Array.from(seen.entries()).sort((a, b) => b[1].t - a[1].t);
        seen.clear();
        for (let i = 0; i < LIMITS.maxMemoryEntries; i++) seen.set(ordered[i][0], ordered[i][1]);
      }
      if (verdicts.size > LIMITS.maxMemoryEntries) {
        const ordered = Array.from(verdicts.entries()).sort((a, b) => b[1].t - a[1].t);
        verdicts.clear();
        for (let i = 0; i < LIMITS.maxMemoryEntries; i++) verdicts.set(ordered[i][0], ordered[i][1]);
      }
    }

    function persist() {
      if (!dirty) return;
      dirty = false;
      prune();
      const payload = { v: 1, verdicts: {}, seen: {} };
      for (const [id, entry] of verdicts) payload.verdicts[id] = entry;
      for (const [id, entry] of seen) payload.seen[id] = { t: entry.t, q: entry.q };
      Store.set(APP.storage.memory, payload);
    }

    const notify = () => {
      for (const fn of subscribers) {
        try { fn(); } catch (err) { Diag.error('memory subscriber failed', err); }
      }
    };

    return {
      get loaded() { return loaded; },
      get sessionId() { return sessionId; },
      get stats() { return { verdicts: verdicts.size, seen: seen.size }; },

      subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },

      async load() {
        const raw = await Store.get(APP.storage.memory, null);
        if (raw && typeof raw === 'object') {
          const rawVerdicts = raw.verdicts && typeof raw.verdicts === 'object' ? raw.verdicts : {};
          for (const id of Object.keys(rawVerdicts)) {
            if (!VIDEO_ID_RE.test(id)) continue;
            const entry = rawVerdicts[id];
            if (!entry || ['pin', 'mute', 'snooze'].indexOf(entry.v) === -1) continue;
            verdicts.set(id, {
              v: entry.v,
              until: isFiniteNumber(Number(entry.until)) ? Number(entry.until) : null,
              t: Number(entry.t) || now()
            });
            if (verdicts.size >= LIMITS.maxMemoryEntries) break;
          }
          const rawSeen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {};
          for (const id of Object.keys(rawSeen)) {
            if (!VIDEO_ID_RE.test(id)) continue;
            const entry = rawSeen[id];
            const t = Number(entry && entry.t);
            if (!Number.isFinite(t)) continue;
            seen.set(id, { t, q: typeof entry.q === 'string' ? entry.q.slice(0, 16) : '', s: '' });
            if (seen.size >= LIMITS.maxMemoryEntries) break;
          }
        }
        prune();
        loaded = true;
        Diag.info(`memory loaded (${verdicts.size} verdicts, ${seen.size} seen)`);
        return true;
      },

      verdict(videoId) {
        if (!videoId) return null;
        const entry = verdicts.get(videoId);
        if (!entry) return null;
        if (entry.v === 'snooze' && isFiniteNumber(entry.until) && entry.until <= now()) {
          verdicts.delete(videoId);
          schedulePersist();
          return null;
        }
        return entry;
      },

      setVerdict(videoId, kind, days) {
        if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;
        if (!kind) { verdicts.delete(videoId); schedulePersist(); notify(); return null; }
        const entry = {
          v: kind,
          until: kind === 'snooze' ? now() + clamp(Number(days) || 7, 1, 365) * 86400000 : null,
          t: now()
        };
        verdicts.set(videoId, entry);
        schedulePersist();
        notify();
        return entry;
      },

      /** Record that a video was actually shown to the user. */
      markSeen(videoId, queryKey) {
        if (!videoId || !VIDEO_ID_RE.test(videoId)) return;
        const existing = seen.get(videoId);
        if (existing) {
          existing.s = existing.s || '';
          return; // keep the first-seen timestamp: that is what "already seen" means
        }
        seen.set(videoId, { t: now(), q: TextSignals.hash(queryKey || '').slice(0, 12), s: sessionId });
        schedulePersist();
      },

      /**
       * True when the video was shown in an *earlier* session (and, when
       * query-scoped, under a different query) inside the TTL window.
       */
      wasSeenBefore(videoId, queryKey, ttlDays, queryScoped) {
        const entry = videoId ? seen.get(videoId) : null;
        if (!entry) return false;
        if (entry.s === sessionId) return false;
        if (queryScoped && entry.q && entry.q === TextSignals.hash(queryKey || '').slice(0, 12)) return false;
        const ttl = clamp(Number(ttlDays) || 30, 1, LIMITS.memoryTtlDays) * 86400000;
        return now() - entry.t <= ttl;
      },

      seenAt(videoId) {
        const entry = videoId ? seen.get(videoId) : null;
        return entry ? entry.t : null;
      },

      listVerdicts() {
        return Array.from(verdicts.entries()).map(([id, entry]) => Object.assign({ videoId: id }, entry));
      },

      clearVerdicts() {
        verdicts.clear();
        schedulePersist();
        notify();
      },

      clearSeen() {
        seen.clear();
        schedulePersist();
        notify();
      },

      flush() {
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = 0; }
        persist();
      }
    };
  })();

  /* ==========================================================================
   * 6. YouTube compatibility layer
   *
   * Every assumption about YouTube's markup lives here. When YouTube changes
   * its DOM, this is the only section that needs to change; the engine, UI and
   * lifecycle code never reference site-specific selectors directly.
   *
   * Verified against the live desktop site (September 2026):
   *   • /results            — `ytd-video-renderer` and `yt-lockup-view-model`
   *                           inside `ytd-item-section-renderer` sections
   *   • /@handle/videos     — `richItemRenderer` → `yt-lockup-view-model`
   *                           inside `ytd-rich-grid-renderer`
   *   • /@handle/search     — `videoRenderer` inside item sections, under
   *                           `ytd-browse` instead of `ytd-search`
   *   • channel identity    — `link[rel=canonical]` → /channel/UC…, and
   *                           `meta[itemprop=identifier]`
   * ======================================================================= */

  const YT = (() => {
    const SEL = Object.freeze({
      app: 'ytd-app',
      searchRoot: 'ytd-search',
      browseRoot: 'ytd-browse',
      sectionListContents: 'ytd-section-list-renderer > [id="contents"]',
      itemSection: 'ytd-item-section-renderer',
      itemSectionContents: '[id="contents"]',
      richGridContents: 'ytd-rich-grid-renderer > [id="contents"]',
      richGridRow: 'ytd-rich-grid-row',
      legacyGridItems: 'ytd-grid-renderer > [id="items"]',
      continuation: 'ytd-continuation-item-renderer',
      masthead: 'ytd-masthead',
      mastheadEnd: '[id="end"]',
      canonical: 'link[rel="canonical"]',
      channelIdMeta: 'meta[itemprop="identifier"], meta[itemprop="channelId"]',
      card: [
        'ytd-video-renderer',
        'ytd-playlist-renderer',
        'ytd-radio-renderer',
        'ytd-channel-renderer',
        'ytd-movie-renderer',
        'ytd-shelf-renderer',
        'ytd-reel-shelf-renderer',
        'ytd-horizontal-card-list-renderer',
        'ytd-secondary-search-container-renderer',
        'ytd-universal-watch-card-renderer',
        'ytd-search-pyv-renderer',
        'ytd-promoted-video-renderer',
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-rich-item-renderer',
        'ytd-grid-video-renderer',
        'ytd-rich-section-renderer',
        'yt-lockup-view-model',
        'grid-shelf-view-model',
        'ytm-shorts-lockup-view-model',
        'ytm-shorts-lockup-view-model-v2'
      ].join(','),
      title: [
        'a[id="video-title"]',
        'a[id="video-title-link"]',
        'h3 a[href]',
        'a.yt-lockup-metadata-view-model__title',
        'a.yt-lockup-metadata-view-model-wiz__title',
        '.yt-lockup-metadata-view-model__title',
        'a[href*="/watch?"]',
        'a[href^="/shorts/"]',
        'a[href*="/playlist?"]',
        '[id="video-title"]'
      ],
      channelLink: [
        'ytd-channel-name a[href]',
        '[id="channel-name"] a[href]',
        'yt-content-metadata-view-model a[href^="/@"]',
        'a[href^="/@"]',
        'a[href^="/channel/"]',
        'a[href^="/c/"]',
        'a[href^="/user/"]'
      ],
      channelText: [
        'ytd-channel-name [id="text"]',
        'ytd-channel-name yt-formatted-string',
        '[id="channel-name"] [id="text"]',
        '.yt-content-metadata-view-model__metadata-text'
      ],
      metaParts: [
        '[id="metadata-line"] span.inline-metadata-item',
        '[id="metadata-line"] span',
        '.inline-metadata-item',
        'yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row span',
        'yt-content-metadata-view-model span.yt-core-attributed-string',
        '.yt-content-metadata-view-model-wiz__metadata-row span'
      ],
      duration: [
        'ytd-thumbnail-overlay-time-status-renderer [id="text"]',
        'yt-thumbnail-overlay-badge-view-model .yt-badge-shape__text',
        'yt-thumbnail-overlay-badge-view-model badge-shape .badge-shape-wiz__text',
        'badge-shape .badge-shape-wiz__text',
        '.yt-badge-shape__text'
      ],
      progress: [
        'ytd-thumbnail-overlay-resume-playback-renderer [id="progress"]',
        '[id="progress"].ytd-thumbnail-overlay-resume-playback-renderer',
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        '.yt-thumbnail-overlay-progress-bar-view-model__progress',
        'yt-thumbnail-overlay-progress-bar-view-model [style*="width"]'
      ],
      description: [
        '.metadata-snippet-text',
        'yt-formatted-string.metadata-snippet-text',
        '[id="description-text"]',
        '.yt-lockup-metadata-view-model__description',
        '.yt-lockup-metadata-view-model-wiz__description'
      ],
      liveBadge: [
        'ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"]',
        '.badge-style-type-live-now',
        '.badge-style-type-live-now-alternate',
        '.badge-shape-wiz--thumbnail-live',
        '.yt-badge-shape--thumbnail-live',
        '[overlay-style="LIVE"]'
      ],
      upcomingBadge: [
        'ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"]',
        '[overlay-style="UPCOMING"]',
        '.badge-style-type-upcoming',
        '.badge-shape-wiz--thumbnail-upcoming'
      ],
      membersBadge: [
        '.badge-style-type-members-only',
        '.badge-shape-wiz--commerce',
        '.yt-badge-shape--commerce'
      ],
      verifiedBadge: [
        '.badge-style-type-verified',
        '.badge-style-type-verified-artist',
        'ytd-badge-supported-renderer [aria-label]',
        '[class*="CHECK_CIRCLE"]'
      ],
      shortsMarker: [
        'a[href^="/shorts/"]',
        '[overlay-style="SHORTS"]',
        '[is-shorts]',
        'ytm-shorts-lockup-view-model',
        'ytm-shorts-lockup-view-model-v2',
        '.shortsLockupViewModelHost'
      ],
      promotedMarker: [
        'ytd-search-pyv-renderer',
        'ytd-promoted-video-renderer',
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        '[is-promoted]',
        'ytd-display-ad-renderer'
      ]
    });

    const SHELF_TAGS = new Set([
      'YTD-SHELF-RENDERER',
      'YTD-REEL-SHELF-RENDERER',
      'YTD-HORIZONTAL-CARD-LIST-RENDERER',
      'YTD-SECONDARY-SEARCH-CONTAINER-RENDERER',
      'YTD-UNIVERSAL-WATCH-CARD-RENDERER',
      'YTD-RICH-SECTION-RENDERER',
      'GRID-SHELF-VIEW-MODEL'
    ]);

    const PROMO_TAGS = new Set([
      'YTD-SEARCH-PYV-RENDERER',
      'YTD-PROMOTED-VIDEO-RENDERER',
      'YTD-AD-SLOT-RENDERER',
      'YTD-IN-FEED-AD-LAYOUT-RENDERER',
      'YTD-DISPLAY-AD-RENDERER'
    ]);

    const CHANNEL_PATH_RE = /^\/(?:(@[^/]+)|channel\/(UC[\w-]{20,})|c\/([^/]+)|user\/([^/]+))(?:\/([^/?#]*))?/;
    // Only tabs that actually render a list of videos. The channel home,
    // community, about and store tabs are shelf/feed layouts we cannot serve,
    // so the script stays completely inert there instead of arming observers
    // and injecting a toolbar that would never have anything to do.
    const CHANNEL_TABS = new Set(['videos', 'streams', 'shorts', 'search', 'podcasts', 'releases', 'playlists']);

    /** Which page are we on, and (for channel pages) whose page is it? */
    function pageContext(loc) {
      const l = loc || location;
      if (!/(^|\.)youtube\.com$/.test(l.hostname)) return { type: PAGE.none };
      if (l.pathname === '/results') return { type: PAGE.search };
      const match = decodeURIComponent(l.pathname).match(CHANNEL_PATH_RE);
      if (!match) return { type: PAGE.none };
      const tab = (match[5] || '').toLowerCase();
      if (!CHANNEL_TABS.has(tab)) return { type: PAGE.none };
      const identity = {
        handle: match[1] ? match[1].toLowerCase() : (match[3] ? `@${match[3].toLowerCase()}` : (match[4] ? `@${match[4].toLowerCase()}` : '')),
        channelId: match[2] || '',
        name: ''
      };
      return {
        type: tab === 'search' ? PAGE.channelSearch : PAGE.channelGrid,
        tab: tab || 'featured',
        identity
      };
    }

    /**
     * Read the channel identity of the current channel page from the DOM.
     * YouTube keeps `link[rel=canonical]` and the itemprop meta tags in sync
     * with SPA navigation, and both carry the canonical UC… id.
     */
    function pageChannelIdentity(fallback) {
      const identity = Object.assign({ handle: '', channelId: '', name: '' }, fallback || {});
      const canonical = q(document, SEL.canonical);
      if (canonical) {
        const url = safeUrl(canonical.getAttribute('href'));
        if (url) {
          const idMatch = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/);
          if (idMatch) identity.channelId = identity.channelId || idMatch[1];
          const handleMatch = decodeURIComponent(url.pathname).match(/^\/(@[^/]+)/);
          if (handleMatch) identity.handle = identity.handle || handleMatch[1].toLowerCase();
        }
      }
      const meta = q(document, SEL.channelIdMeta);
      if (meta) {
        const value = normalizeSpace(meta.getAttribute('content'));
        if (/^UC[\w-]{20,}$/.test(value)) identity.channelId = identity.channelId || value;
      }
      const nameMeta = q(document, 'meta[itemprop="name"]');
      if (nameMeta) identity.name = identity.name || normalizeSpace(nameMeta.getAttribute('content'));
      if (!identity.name) {
        const heading = q(document, 'ytd-channel-name #text, yt-dynamic-text-view-model h1, #channel-header h1');
        if (heading) identity.name = normalizeSpace(heading.textContent);
      }
      return identity;
    }

    function collectContainers(root, sectionListContents) {
      const containers = [];
      let orderTarget = null;
      let rowLayout = false;
      if (sectionListContents) {
        for (const section of qa(sectionListContents, `:scope > ${SEL.itemSection}`)) {
          const contents = q(section, `:scope > ${SEL.itemSectionContents}`) || q(section, SEL.itemSectionContents);
          if (contents) containers.push(contents);
        }
        if (containers.length) orderTarget = containers[0];
      }
      const grid = q(root, SEL.richGridContents);
      if (grid) {
        const rows = qa(grid, `:scope > ${SEL.richGridRow}`);
        if (rows.length) {
          // Legacy row layout: each row lays out its own cards, so cards may be
          // filtered but must never be moved between rows.
          rowLayout = true;
          for (const row of rows) containers.push(row);
        }
        containers.push(grid);
        if (!orderTarget && !rowLayout) orderTarget = grid;
      }
      const legacy = q(root, SEL.legacyGridItems);
      if (legacy) {
        containers.push(legacy);
        if (!orderTarget && !rowLayout) orderTarget = legacy;
      }
      return { containers, orderTarget: rowLayout ? null : orderTarget, rowLayout };
    }

    /** Locate the live results structure for the current page, or null. */
    function findStructure(context) {
      const ctx = context || pageContext();
      if (ctx.type === PAGE.none) return null;
      const root = ctx.type === PAGE.search
        ? q(document, SEL.searchRoot)
        : q(document, SEL.browseRoot) || q(document, SEL.searchRoot);
      if (!root) return null;

      const sectionListContents = q(root, SEL.sectionListContents) ||
        q(root, 'ytd-section-list-renderer [id="contents"]');
      const collected = collectContainers(root, sectionListContents);
      const containers = collected.containers;
      if (!containers.length) return null;

      const continuationHost = sectionListContents || q(root, SEL.richGridContents) || root;
      return {
        pageType: ctx.type,
        channelIdentity: ctx.identity || null,
        root,
        sectionListContents: sectionListContents || q(root, SEL.richGridContents) || containers[0],
        containers,
        // Where re-ordered cards are moved to. Null when the layout owns the
        // positions itself (row grids), in which case ordering is skipped.
        orderTarget: collected.orderTarget,
        orderable: !!collected.orderTarget,
        rowLayout: collected.rowLayout,
        continuation: q(continuationHost, `:scope > ${SEL.continuation}`) ||
          q(continuationHost, SEL.continuation) ||
          q(root, SEL.continuation)
      };
    }

    // Tag names never change for a given element, so the (relatively costly)
    // multi-selector match is memoised per element.
    const cardYes = new WeakSet();
    const cardNo = new WeakSet();

    function isCardElement(node) {
      if (!node || node.nodeType !== 1) return false;
      if (cardYes.has(node)) return true;
      if (cardNo.has(node)) return false;
      let result = false;
      try { result = node.matches(SEL.card); } catch (_e) { result = false; }
      (result ? cardYes : cardNo).add(node);
      return result;
    }

    function classifyKind(node, info) {
      const tag = node.tagName;
      if (PROMO_TAGS.has(tag) || firstMatch(node, SEL.promotedMarker)) return 'promoted';
      if (SHELF_TAGS.has(tag)) return tag === 'YTD-REEL-SHELF-RENDERER' || tag === 'GRID-SHELF-VIEW-MODEL' ? 'shorts-shelf' : 'shelf';
      if (tag === 'YTD-CHANNEL-RENDERER') return 'channel';
      if (tag === 'YTD-MOVIE-RENDERER') return 'movie';
      if (tag === 'YTD-RADIO-RENDERER') return 'mix';
      if (tag === 'YTD-PLAYLIST-RENDERER') return 'playlist';
      if (tag === 'YTM-SHORTS-LOCKUP-VIEW-MODEL' || tag === 'YTM-SHORTS-LOCKUP-VIEW-MODEL-V2') return 'short';
      if (info.isShort) return 'short';
      if (info.isMix) return 'mix';
      if (info.isPlaylist) return 'playlist';
      if (info.videoId) return 'video';
      if (q(node, 'a[href^="/@"], a[href^="/channel/"]') && !q(node, 'a[href*="/watch"], a[href^="/shorts/"]')) return 'channel';
      return 'other';
    }

    return { SEL, PAGE, pageContext, pageChannelIdentity, findStructure, isCardElement, classifyKind };
  })();

  /* ==========================================================================
   * 7. Card model & extraction
   * ======================================================================= */

  const CardStore = (() => {
    const store = new WeakMap(); // element -> record
    let parseFailures = 0;

    // How long a card is re-probed after extraction. YouTube fills metadata in
    // asynchronously, so a freshly rendered card is watched closely; once it is
    // complete and has stopped changing, repeated passes reuse the record and
    // touch no DOM at all. A card that is still incomplete is probed forever,
    // so late-arriving metadata is never missed.
    const SETTLE_MS = 10000;

    const META_ROOTS = ['[id="metadata-line"]', 'yt-content-metadata-view-model'];

    const usable = (node, host) => {
      if (!node || !node.isConnected) return false;
      // A cached node is only reusable while it still belongs to this card.
      return host.contains(node);
    };

    /**
     * Resolve a selector list. The element that matched last time is reused
     * while it is still attached to the card, so a steady-state pass costs a
     * handful of property reads instead of four selector-engine queries per
     * card — the dominant cost when hundreds of results are loaded and YouTube
     * keeps mutating the list.
     */
    function resolve(host, selectors, hint, cachedNode) {
      if (usable(cachedNode, host)) return { node: cachedNode, selector: hint || '' };
      if (hint) {
        const cached = q(host, hint);
        if (cached) return { node: cached, selector: hint };
      }
      for (let i = 0; i < selectors.length; i++) {
        const found = q(host, selectors[i]);
        if (found) return { node: found, selector: selectors[i] };
      }
      return { node: null, selector: '' };
    }

    /**
     * Cheap change-detection probe. Re-extraction only happens when one of the
     * observable values actually changed, which keeps repeated passes over a
     * large result list close to free.
     */
    const cheapSignature = (node, hints, cache) => {
      const h = hints || {};
      const c = cache || {};
      const title = resolve(node, YT.SEL.title, h.title, c.title);
      const meta = resolve(node, META_ROOTS, h.meta, c.meta);
      const dur = resolve(node, YT.SEL.duration, h.duration, c.duration);
      const prog = resolve(node, YT.SEL.progress, h.progress, c.progress);
      const sig = [
        title.node ? (title.node.getAttribute('title') || title.node.textContent || '') : '',
        meta.node ? meta.node.textContent || '' : '',
        dur.node ? dur.node.textContent || '' : '',
        prog.node ? prog.node.getAttribute('style') || '' : ''
      ].join('\u0001').slice(0, 400);
      return {
        sig,
        hints: { title: title.selector, meta: meta.selector, duration: dur.selector, progress: prog.selector },
        nodes: { title: title.node, meta: meta.node, duration: dur.node, progress: prog.node }
      };
    };

    function readTitle(node) {
      const anchor = firstMatch(node, YT.SEL.title);
      if (!anchor) return { title: '', href: '' };
      const explicit = anchor.getAttribute('title');
      const aria = anchor.getAttribute('aria-label');
      const text = normalizeSpace(explicit || anchor.textContent || aria || '');
      return { title: text, href: anchor.getAttribute('href') || '' };
    }

    function readChannel(node) {
      let link = null;
      const idLink = q(node, 'a[href^="/channel/UC"]');
      for (const selector of YT.SEL.channelLink) {
        const candidate = q(node, selector);
        if (!candidate) continue;
        const href = candidate.getAttribute('href') || '';
        if (!href || /\/watch|\/shorts\/|\/playlist/.test(href)) continue;
        link = candidate;
        break;
      }
      let name = link ? normalizeSpace(link.textContent) : '';
      if (!name) {
        const textNode = firstMatch(node, YT.SEL.channelText);
        name = textNode ? normalizeSpace(textNode.textContent) : '';
      }
      const href = link ? link.getAttribute('href') || '' : '';
      const url = safeUrl(href);
      let handle = '';
      let channelId = '';
      if (url) {
        const path = decodeURIComponent(url.pathname || '');
        const handleMatch = path.match(/^\/(@[^/]+)/);
        if (handleMatch) handle = handleMatch[1].toLowerCase();
        const idMatch = path.match(/^\/channel\/(UC[\w-]{20,})/);
        if (idMatch) channelId = idMatch[1];
        if (!handle) {
          const legacy = path.match(/^\/(?:c|user)\/([^/]+)/);
          if (legacy) handle = `@${legacy[1].toLowerCase()}`;
        }
      }
      if (!channelId && idLink) {
        const idUrl = safeUrl(idLink.getAttribute('href'));
        const idMatch = idUrl ? idUrl.pathname.match(/^\/channel\/(UC[\w-]{20,})/) : null;
        if (idMatch) channelId = idMatch[1];
      }
      return { name, handle, channelId, channelUrl: url ? url.pathname : '' };
    }

    function readMetaParts(node) {
      const seen = new Set();
      const parts = [];
      for (const selector of YT.SEL.metaParts) {
        for (const element of qa(node, selector)) {
          if (element.querySelector && element.querySelector('span')) continue;
          const text = normalizeSpace(element.textContent);
          if (!text || text === '•' || seen.has(text)) continue;
          seen.add(text);
          parts.push(text);
          if (parts.length >= 8) break;
        }
        if (parts.length) break;
      }
      return parts;
    }

    function readDuration(node) {
      for (const selector of YT.SEL.duration) {
        for (const element of qa(node, selector)) {
          const seconds = LocaleParser.parseClockDuration(element.textContent || '');
          if (seconds !== null && seconds > 0) return seconds;
        }
      }
      const aria = q(node, 'badge-shape[aria-label], [aria-label*=":"]');
      if (aria) {
        const seconds = LocaleParser.parseClockDuration(aria.getAttribute('aria-label') || '');
        if (seconds !== null && seconds > 0) return seconds;
      }
      return null;
    }

    function readWatchedPercent(node) {
      for (const selector of YT.SEL.progress) {
        const element = q(node, selector);
        if (!element) continue;
        const style = element.getAttribute('style') || '';
        const inline = element.style && element.style.width ? element.style.width : '';
        const match = `${inline} ${style}`.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
        if (match) return clamp(parseFloat(match[1]), 0, 100);
        const valueNow = element.getAttribute('aria-valuenow');
        if (valueNow && Number.isFinite(Number(valueNow))) return clamp(Number(valueNow), 0, 100);
      }
      return null;
    }

    /**
     * Extract a normalised record from a result card. Everything is optional:
     * missing metadata yields `null` fields, never guesses. Rules that need a
     * field simply do not apply when it is unknown.
     */
    function extract(node, order, pageIdentity) {
      const { title, href } = readTitle(node);
      const titleUrl = safeUrl(href);
      const watchLink = q(node, 'a[href*="/watch?v="]');
      const videoId = extractVideoId(href) || extractVideoId(watchLink && watchLink.getAttribute('href'));
      const isShort = !!firstMatch(node, YT.SEL.shortsMarker) ||
        (titleUrl ? /^\/shorts\//.test(titleUrl.pathname) : false);
      const listId = titleUrl ? titleUrl.searchParams.get('list') : null;
      const isMix = !!listId && (/^RD/.test(listId) || (titleUrl && titleUrl.searchParams.get('start_radio') === '1'));
      const isPlaylist = !!listId && !isMix && (!videoId || (titleUrl && titleUrl.pathname === '/playlist'));

      const channel = readChannel(node);
      // On a channel page the cards usually omit the channel: inherit the page's.
      if (!channel.handle && !channel.channelId && pageIdentity) {
        channel.handle = pageIdentity.handle || '';
        channel.channelId = pageIdentity.channelId || '';
        channel.name = channel.name || pageIdentity.name || '';
      }
      const metaParts = readMetaParts(node);

      let views = null;
      let ageMs = null;
      let viewsText = '';
      let ageText = '';
      for (const part of metaParts) {
        if (ageMs === null) {
          const parsedAge = LocaleParser.parseRelativeAge(part);
          if (parsedAge !== null) { ageMs = parsedAge; ageText = part; continue; }
        }
        if (views === null && LocaleParser.startsWithNumber(part)) {
          const parsedViews = LocaleParser.parseCount(part);
          if (parsedViews !== null) { views = parsedViews; viewsText = part; }
        }
      }

      const durationSec = readDuration(node);
      const watchedPercent = readWatchedPercent(node);
      const descriptionNode = firstMatch(node, YT.SEL.description);
      const description = descriptionNode ? normalizeSpace(descriptionNode.textContent).slice(0, 400) : '';

      const isLive = !!firstMatch(node, YT.SEL.liveBadge);
      const isUpcoming = !isLive && !!firstMatch(node, YT.SEL.upcomingBadge);
      const isMembersOnly = !!firstMatch(node, YT.SEL.membersBadge);
      const isVerified = !!firstMatch(node, YT.SEL.verifiedBadge);

      const style = TextSignals.styleOf(title);
      const script = TextSignals.scriptOf(title);
      const series = TextSignals.seriesOf(title);

      const record = {
        el: node,
        order,
        extractedAt: Date.now(),
        videoId: videoId || null,
        href: titleUrl ? titleUrl.pathname + titleUrl.search : href,
        title,
        titleFolded: fold(title),
        titleTokens: TextSignals.tokensOf(title),
        description,
        descriptionFolded: fold(description),
        channelName: channel.name,
        channelFolded: fold(channel.name),
        channelHandle: channel.handle,
        channelId: channel.channelId,
        channelUrl: channel.channelUrl,
        views: isLive ? null : views,
        liveViewers: isLive ? views : null,
        viewsText,
        ageMs,
        ageText,
        publishedMs: ageMs === null ? null : Date.now() - ageMs,
        exact: false,
        durationSec,
        watchedPercent,
        isLive,
        isUpcoming,
        isMembersOnly,
        isVerified,
        isShort,
        style,
        script,
        series,
        category: null,
        tags: null,
        fullDescription: null,
        likes: null,
        familySafe: null,
        regions: null,
        kind: 'other',
        hidden: false,
        reasons: []
      };
      record.kind = YT.classifyKind(node, { isShort, isMix, isPlaylist, videoId });
      if (record.kind === 'video' && !title) parseFailures++;
      const isVideo = record.kind === 'video' || record.kind === 'short';
      record.complete = !!title && (!isVideo || views !== null || ageMs !== null || isLive || isUpcoming);
      return record;
    }

    return {
      get parseFailures() { return parseFailures; },

      /** Returns a cached record, re-extracting only when the card changed. */
      read(node, order, pageIdentity) {
        const record = store.get(node);
        if (record && record.complete && Date.now() - record.extractedAt > SETTLE_MS) {
          // Settled card: nothing to read, nothing to compare.
          record.order = order;
          return record;
        }
        const probe = cheapSignature(node, record && record.hints, record && record.nodes);
        if (record && record.sig === probe.sig) {
          record.order = order;
          record.nodes = probe.nodes;
          return record;
        }
        const fresh = extract(node, order, pageIdentity);
        fresh.sig = probe.sig;
        fresh.hints = probe.hints;
        fresh.nodes = probe.nodes;
        if (record) {
          if (record.enrichment) fresh.enrichment = record.enrichment;
          if (record.forceVisible) fresh.forceVisible = true;
          // Keep the initial sighting time so a card that keeps changing is
          // not watched forever, but reset it while it is still incomplete.
          if (record.complete) fresh.extractedAt = record.extractedAt;
        }
        store.set(node, fresh);
        return fresh;
      },

      peek(node) { return store.get(node) || null; },

      /**
       * Force the next pass to re-read the given cards. Used after navigation
       * and back/forward restores, where YouTube can update a card in place
       * (for example by adding a watched-progress bar) without replacing it.
       */
      invalidate(records) {
        for (const record of records || []) {
          // Re-open the observation window instead of ageing the record: an
          // "old" timestamp would make it look settled and skip the re-read.
          record.extractedAt = Date.now();
          record.complete = false;
        }
      }
    };
  })();

  /* ==========================================================================
   * 8. Precision metadata service (opt-in)
   *
   * Relative labels ("3 years ago") are coarse and the search markup carries no
   * likes, tags, category or availability at all. When the user opts in, exact
   * values are read from YouTube's own /youtubei/v1/player endpoint on the
   * *same origin*, with credentials omitted, so no account information is
   * attached and no third party is contacted. Responses are cached locally
   * with a TTL.
   *
   * Verified response shape (September 2026), unauthenticated:
   *   videoDetails { videoId, lengthSeconds, keywords[], channelId,
   *                  shortDescription, viewCount, author, isLiveContent }
   *   microformat.playerMicroformatRenderer { publishDate, uploadDate,
   *                  category, isFamilySafe, availableCountries[], likeCount,
   *                  ownerChannelName, ownerProfileUrl, externalChannelId }
   * No API key is required. Failures are non-fatal: the card keeps its
   * DOM-derived values and every precision-only rule is skipped for it.
   *
   * Deliberately not used: `captions` and `streamingData`. They are absent from
   * unauthenticated responses, so features built on them would be unreliable —
   * see AUDIT.md.
   * ======================================================================= */

  const Precision = (() => {
    const ENDPOINT = '/youtubei/v1/player';
    const CLIENT_VERSION = '2.20240726.00.00';
    const WORLDWIDE = 200; // country-list length at/above which we treat availability as unrestricted

    const memory = new Map();      // videoId -> entry
    const inflight = new Map();    // videoId -> Promise
    const queue = [];              // pending video ids
    let active = 0;
    let generation = 0;
    let budget = LIMITS.enrichBudgetPerNav;
    let loaded = false;
    let dirty = false;
    let failures = 0;
    let successes = 0;
    let disabledReason = '';
    let onResult = null;
    let onIdentity = null;

    const now = () => Date.now();
    const ttlMs = () => clamp(Config.value.precision.ttlHours, 1, 24 * 90) * 3600000;

    const numberOr = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    async function loadCache() {
      if (loaded) return;
      loaded = true;
      if (!Config.value.precision.cacheEnabled) return;
      const raw = await Store.get(APP.storage.cache, null);
      if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') return;
      const cutoff = now() - ttlMs();
      let count = 0;
      for (const id of Object.keys(raw.entries)) {
        if (!VIDEO_ID_RE.test(id)) continue;
        const e = raw.entries[id];
        if (!e || typeof e !== 'object') continue;
        const t = Number(e.t);
        if (!Number.isFinite(t) || t < cutoff) continue;
        memory.set(id, {
          t,
          views: numberOr(e.views, null),
          likes: numberOr(e.likes, null),
          publishedMs: numberOr(e.publishedMs, null),
          durationSec: numberOr(e.durationSec, null),
          category: typeof e.category === 'string' ? e.category.slice(0, 40) : null,
          tags: Array.isArray(e.tags) ? e.tags.slice(0, 40).map((t2) => String(t2).slice(0, 60)) : null,
          description: typeof e.description === 'string' ? e.description.slice(0, 1200) : null,
          familySafe: typeof e.familySafe === 'boolean' ? e.familySafe : null,
          regions: typeof e.regions === 'string' ? e.regions : null,
          channelId: typeof e.channelId === 'string' ? e.channelId.slice(0, 40) : null,
          handle: typeof e.handle === 'string' ? e.handle.slice(0, 60) : null,
          live: e.live === true
        });
        if (++count >= LIMITS.maxCacheEntries) break;
      }
      Diag.info(`precision cache loaded (${memory.size} entries)`);
    }

    function persist() {
      if (!dirty || !Config.value.precision.cacheEnabled) return;
      dirty = false;
      const cutoff = now() - ttlMs();
      const entries = [];
      for (const [id, e] of memory) {
        if (e.t < cutoff) { memory.delete(id); continue; }
        entries.push([id, e]);
      }
      if (entries.length > LIMITS.maxCacheEntries) {
        entries.sort((a, b) => b[1].t - a[1].t);
        for (let i = LIMITS.maxCacheEntries; i < entries.length; i++) memory.delete(entries[i][0]);
        entries.length = LIMITS.maxCacheEntries;
      }
      const payload = { v: 2, entries: {} };
      for (const [id, e] of entries) payload.entries[id] = e;
      Store.set(APP.storage.cache, payload);
    }

    function parseResponse(json, videoId) {
      if (!json || typeof json !== 'object') return null;
      const details = json.videoDetails;
      if (!details || details.videoId !== videoId) return null;
      const micro = (json.microformat && json.microformat.playerMicroformatRenderer) || {};
      const publishRaw = micro.publishDate || micro.uploadDate || null;
      const publishedMs = publishRaw ? Date.parse(publishRaw) : NaN;
      const countries = Array.isArray(micro.availableCountries) ? micro.availableCountries : null;
      const ownerUrl = typeof micro.ownerProfileUrl === 'string' ? micro.ownerProfileUrl : '';
      const handleMatch = ownerUrl.match(/\/(@[^/?#]+)/);
      const tags = Array.isArray(details.keywords)
        ? details.keywords.slice(0, 40).map((tag) => String(tag).slice(0, 60))
        : null;

      return {
        t: now(),
        views: numberOr(details.viewCount, null),
        likes: numberOr(micro.likeCount, null),
        publishedMs: Number.isFinite(publishedMs) ? publishedMs : null,
        durationSec: numberOr(details.lengthSeconds, null),
        category: typeof micro.category === 'string' ? micro.category.slice(0, 40) : null,
        tags,
        description: typeof details.shortDescription === 'string' ? details.shortDescription.slice(0, 1200) : null,
        familySafe: typeof micro.isFamilySafe === 'boolean' ? micro.isFamilySafe : null,
        // Availability is only stored when it is actually restricted; an
        // "available everywhere" list of 249 codes carries no information.
        regions: countries ? (countries.length >= WORLDWIDE ? 'ALL' : countries.join(',')) : null,
        channelId: typeof details.channelId === 'string' ? details.channelId : (micro.externalChannelId || null),
        handle: handleMatch ? handleMatch[1].toLowerCase() : null,
        ownerName: typeof micro.ownerChannelName === 'string' ? micro.ownerChannelName.slice(0, 120) : null,
        live: details.isLiveContent === true && details.isLive === true
      };
    }

    async function fetchOne(videoId, gen) {
      if (!CAPS.fetch) throw new Error('fetch unavailable');
      const controller = CAPS.abortController ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), LIMITS.enrichTimeoutMs) : 0;
      try {
        const language = LocaleParser.locale || 'en';
        const response = await fetch(`https://www.youtube.com${ENDPOINT}`, {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'strict-origin-when-cross-origin',
          headers: { 'Content-Type': 'application/json' },
          signal: controller ? controller.signal : undefined,
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB',
                clientVersion: CLIENT_VERSION,
                hl: language.split('-')[0] || 'en',
                gl: 'US'
              }
            },
            videoId
          })
        });
        if (gen !== generation) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseResponse(await response.json(), videoId);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    function pump() {
      const cfg = Config.value.precision;
      const limit = clamp(cfg.concurrency, 1, LIMITS.maxEnrichConcurrency);
      while (active < limit && queue.length > 0) {
        const videoId = queue.shift();
        const gen = generation;
        active++;
        const promise = fetchOne(videoId, gen)
          .then((entry) => {
            if (gen !== generation) return null;
            if (entry) {
              memory.set(videoId, entry);
              dirty = true;
              successes++;
              // Identity learning: the player response ties a handle to the
              // canonical channel id, which lets handle-keyed policies be
              // promoted to id-keyed ones automatically.
              if (onIdentity && entry.channelId) {
                try {
                  onIdentity({ channelId: entry.channelId, handle: entry.handle || '', name: entry.ownerName || '' });
                } catch (e) { Diag.error('identity callback failed', e); }
              }
            } else {
              failures++;
            }
            return entry;
          })
          .catch((err) => {
            failures++;
            if (failures === 5) {
              disabledReason = 'Precision lookups keep failing; falling back to on-page metadata.';
              Diag.warn('precision lookups failing', err && err.message);
            }
            return null;
          })
          .then((entry) => {
            if (gen !== generation) return entry;
            active--;
            inflight.delete(videoId);
            if (entry && onResult) {
              try { onResult(videoId, entry); } catch (e) { Diag.error('precision callback failed', e); }
            }
            if (queue.length === 0 && active === 0) persist();
            pump();
            return entry;
          });
        inflight.set(videoId, promise);
      }
    }

    return {
      get stats() {
        return {
          cached: memory.size,
          queued: queue.length,
          active,
          successes,
          failures,
          budget,
          disabledReason
        };
      },

      setResultHandler(fn) { onResult = fn; },
      setIdentityHandler(fn) { onIdentity = fn; },

      async init() { await loadCache(); },

      cancelAll() {
        generation++;
        queue.length = 0;
        inflight.clear();
        active = 0;
        budget = LIMITS.enrichBudgetPerNav;
        persist();
      },

      get(videoId) {
        if (!videoId) return null;
        const entry = memory.get(videoId);
        if (!entry) return null;
        if (now() - entry.t > ttlMs()) { memory.delete(videoId); return null; }
        return entry;
      },

      /** Queue a lookup; returns true when work was scheduled. */
      request(videoId) {
        if (!Config.value.precision.enabled || !videoId || !VIDEO_ID_RE.test(videoId)) return false;
        if (this.get(videoId) || inflight.has(videoId) || queue.indexOf(videoId) !== -1) return false;
        if (budget <= 0) return false;
        if (failures >= 12) return false;
        budget--;
        queue.push(videoId);
        pump();
        return true;
      },

      clearCache() {
        memory.clear();
        dirty = false;
        Store.remove(APP.storage.cache);
      },

      flush() { persist(); }
    };
  })();

  /* ==========================================================================
   * 9. Decision engine: scopes, rules, signals, ranking, grouping
   *
   * Pure logic: it consumes card records plus configuration and returns
   * decisions. It performs no DOM access, which keeps it deterministic and
   * directly testable.
   *
   * Scope precedence (highest wins, always deterministic):
   *   1. per-video verdict      pin / mute / snooze
   *   2. channel policy mode    blocked → muted → limited → trusted/priority
   *   3. channel policy rules   thresholds and keyword rules of that channel
   *   4. context profile rules  active named profile(s), in list order
   *   5. global rules
   * A channel policy may additionally *bypass* named rule groups coming from
   * scopes 4 and 5; its own rules are never bypassed.
   * ======================================================================= */

  const Engine = (() => {
    // Keyed by configuration object: the controller legitimately alternates
    // between the page configuration and an ordering-derived clone, and a
    // single-slot memo made that recompile every keyword and channel rule
    // twice per pass.
    const compiledByConfig = new WeakMap();
    let compiled = null;

    const CHANNEL_ID_RE = /^UC[\w-]{20,}$/;

    /* --- compilation -------------------------------------------------------- */

    function compileChannelList(list) {
      const handles = new Set();
      const ids = new Set();
      const patterns = [];
      const errors = [];
      for (const raw of list || []) {
        const entry = String(raw).trim();
        if (!entry) continue;
        if (entry.startsWith('@')) { handles.add(entry.toLowerCase()); continue; }
        if (CHANNEL_ID_RE.test(entry)) { ids.add(entry); continue; }
        const url = entry.startsWith('http') ? safeUrl(entry) : null;
        if (url) {
          const path = decodeURIComponent(url.pathname);
          const handleMatch = path.match(/^\/(@[^/]+)/);
          if (handleMatch) { handles.add(handleMatch[1].toLowerCase()); continue; }
          const idMatch = path.match(/^\/channel\/(UC[\w-]{20,})/);
          if (idMatch) { ids.add(idMatch[1]); continue; }
        }
        const pattern = compilePattern(entry);
        if (pattern) {
          if (pattern.error) errors.push({ pattern: pattern.raw, error: pattern.error });
          patterns.push(pattern);
        }
      }
      return { handles, ids, patterns, errors };
    }

    function channelMatches(set, record) {
      if (record.channelHandle && set.handles.has(record.channelHandle)) return true;
      if (record.channelId && set.ids.has(record.channelId)) return true;
      if (set.patterns.length && record.channelName) {
        if (matchesAny(set.patterns, record.channelName, record.channelFolded)) return true;
      }
      return false;
    }

    function compileAll(config) {
      const f = config.filters;
      const c = config.content;
      const titleExclude = compilePatternList(f.titleExclude);
      const titleInclude = compilePatternList(f.titleInclude);
      const tagInclude = compilePatternList(c.tagInclude);
      const tagExclude = compilePatternList(c.tagExclude);
      const descInclude = compilePatternList(c.descriptionInclude);
      const descExclude = compilePatternList(c.descriptionExclude);
      const block = compileChannelList(f.channelBlock);
      const allow = compileChannelList(f.channelAllow);
      const contexts = new Map();
      for (const ctx of config.contexts) {
        contexts.set(ctx.id, {
          titleExclude: compilePatternList(ctx.rules.titleExclude).compiled,
          titleInclude: compilePatternList(ctx.rules.titleInclude).compiled,
          tagExclude: compilePatternList(ctx.rules.tagExclude).compiled,
          tagInclude: compilePatternList(ctx.rules.tagInclude).compiled,
          queryPattern: ctx.when.queryPattern ? compilePattern(ctx.when.queryPattern) : null
        });
      }
      return {
        titleExclude: titleExclude.compiled,
        titleInclude: titleInclude.compiled,
        tagInclude: tagInclude.compiled,
        tagExclude: tagExclude.compiled,
        descInclude: descInclude.compiled,
        descExclude: descExclude.compiled,
        block,
        allow,
        contexts,
        errors: [].concat(
          titleExclude.errors, titleInclude.errors, tagInclude.errors, tagExclude.errors,
          descInclude.errors, descExclude.errors, block.errors, allow.errors
        )
      };
    }

    function rules(config) {
      let entry = compiledByConfig.get(config);
      if (!entry) {
        entry = compileAll(config);
        compiledByConfig.set(config, entry);
      }
      compiled = entry;
      return entry;
    }

    /* --- scope resolution ---------------------------------------------------- */

    /** Which context profiles apply to the current page? */
    function activeContexts(config, ctx) {
      const compiledRules = rules(config);
      const out = [];
      for (const profile of config.contexts) {
        if (!profile.enabled) continue;
        const when = profile.when;
        if (when.pageTypes.length && when.pageTypes.indexOf(ctx.pageType) === -1) continue;
        if (when.withYouTubeFilter === 'with' && !ctx.hasYouTubeFilter) continue;
        if (when.withYouTubeFilter === 'without' && ctx.hasYouTubeFilter) continue;
        if (when.channelScope === 'configured' && !ctx.channelConfigured) continue;
        if (when.channelScope === 'unconfigured' && ctx.channelConfigured) continue;
        if (when.queryPattern) {
          const pattern = compiledRules.contexts.get(profile.id);
          const compiledPattern = pattern && pattern.queryPattern;
          if (!compiledPattern || compiledPattern.error) continue;
          let matched = false;
          try { matched = compiledPattern.test(ctx.query, fold(ctx.query)); } catch (_e) { matched = false; }
          if (!matched) continue;
        }
        out.push(profile);
      }
      return out;
    }

    const TRI = (value, base) => (value === 'on' ? true : value === 'off' ? false : base);
    const NUM = (value, base) => (isFiniteNumber(value) ? value : base);
    const ENUM = (value, base) => (value && value !== 'inherit' ? value : base);

    /**
     * Build the effective rule set for one card:
     * global → context profiles (in order) → channel policy, with bypasses.
     */
    function effectiveRules(config, contexts, policy, compiledRules) {
      const f = config.filters;
      const eff = {
        hideShorts: f.hideShorts,
        hideLive: f.hideLive,
        hideUpcoming: f.hideUpcoming,
        hideWatched: f.hideWatched,
        hideMembersOnly: f.hideMembersOnly,
        hideSeen: config.memory.hideSeen,
        viewsMin: f.viewsMin,
        viewsMax: f.viewsMax,
        likesMin: f.likesMin,
        likeRatioMin: f.likeRatioMin,
        outperformMin: f.outperformMin,
        durationMinSec: f.durationMinSec,
        durationMaxSec: f.durationMaxSec,
        ageMaxDays: f.ageMaxDays,
        ageMinDays: f.ageMinDays,
        styleMaxScore: config.style.enabled ? config.style.maxScore : null,
        scoreFloor: config.ranking.scoreFloor,
        requireQueryTerms: f.requireQueryTerms,
        titleIncludeMode: f.titleIncludeMode,
        sortMode: config.sort.mode,
        groupBy: config.ranking.groupBy,
        titleExclude: compiledRules.titleExclude,
        titleInclude: compiledRules.titleInclude,
        tagExclude: compiledRules.tagExclude,
        tagInclude: compiledRules.tagInclude,
        scopes: { views: SCOPE.global, duration: SCOPE.global, age: SCOPE.global, keywords: SCOPE.global }
      };

      for (const profile of contexts) {
        const r = profile.rules;
        const c = compiledRules.contexts.get(profile.id) || {};
        eff.hideShorts = TRI(r.hideShorts, eff.hideShorts);
        eff.hideLive = TRI(r.hideLive, eff.hideLive);
        eff.hideUpcoming = TRI(r.hideUpcoming, eff.hideUpcoming);
        eff.hideWatched = TRI(r.hideWatched, eff.hideWatched);
        eff.hideMembersOnly = TRI(r.hideMembersOnly, eff.hideMembersOnly);
        eff.hideSeen = TRI(r.hideSeen, eff.hideSeen);
        if (isFiniteNumber(r.viewsMin)) { eff.viewsMin = r.viewsMin; eff.scopes.views = SCOPE.context; }
        eff.viewsMax = NUM(r.viewsMax, eff.viewsMax);
        eff.likesMin = NUM(r.likesMin, eff.likesMin);
        eff.likeRatioMin = NUM(r.likeRatioMin, eff.likeRatioMin);
        eff.outperformMin = NUM(r.outperformMin, eff.outperformMin);
        if (isFiniteNumber(r.durationMinSec)) { eff.durationMinSec = r.durationMinSec; eff.scopes.duration = SCOPE.context; }
        eff.durationMaxSec = NUM(r.durationMaxSec, eff.durationMaxSec);
        if (isFiniteNumber(r.ageMaxDays)) { eff.ageMaxDays = r.ageMaxDays; eff.scopes.age = SCOPE.context; }
        eff.ageMinDays = NUM(r.ageMinDays, eff.ageMinDays);
        eff.styleMaxScore = NUM(r.styleMaxScore, eff.styleMaxScore);
        eff.scoreFloor = NUM(r.scoreFloor, eff.scoreFloor);
        eff.requireQueryTerms = ENUM(r.requireQueryTerms, eff.requireQueryTerms);
        eff.titleIncludeMode = ENUM(r.titleIncludeMode, eff.titleIncludeMode);
        eff.sortMode = ENUM(r.sortMode, eff.sortMode);
        eff.groupBy = ENUM(r.groupBy, eff.groupBy);
        if (c.titleExclude && c.titleExclude.length) {
          eff.titleExclude = eff.titleExclude.concat(c.titleExclude);
          eff.scopes.keywords = SCOPE.context;
        }
        if (c.titleInclude && c.titleInclude.length) eff.titleInclude = eff.titleInclude.concat(c.titleInclude);
        if (c.tagExclude && c.tagExclude.length) eff.tagExclude = eff.tagExclude.concat(c.tagExclude);
        if (c.tagInclude && c.tagInclude.length) eff.tagInclude = eff.tagInclude.concat(c.tagInclude);
      }

      if (policy) {
        const compiledPolicy = Channels.compiled(policy) || {};
        const bypass = compiledPolicy.bypass || new Set();
        eff.bypass = bypass;

        // Bypasses clear inherited (global + context) rules for this channel.
        if (bypass.has('views')) { eff.viewsMin = null; eff.viewsMax = null; eff.likesMin = null; eff.likeRatioMin = null; eff.outperformMin = null; }
        if (bypass.has('duration')) { eff.durationMinSec = null; eff.durationMaxSec = null; }
        if (bypass.has('age')) { eff.ageMaxDays = null; eff.ageMinDays = null; }
        if (bypass.has('keywords')) { eff.titleExclude = []; eff.titleInclude = []; eff.tagExclude = []; eff.tagInclude = []; }
        if (bypass.has('shorts')) eff.hideShorts = false;
        if (bypass.has('watched')) eff.hideWatched = false;
        if (bypass.has('style')) eff.styleMaxScore = null;
        if (bypass.has('query')) eff.requireQueryTerms = 'off';
        if (bypass.has('seen')) eff.hideSeen = false;

        const r = policy.rules;
        eff.hideShorts = TRI(r.hideShorts, eff.hideShorts);
        eff.hideLive = TRI(r.hideLive, eff.hideLive);
        eff.hideUpcoming = TRI(r.hideUpcoming, eff.hideUpcoming);
        eff.hideWatched = TRI(r.hideWatched, eff.hideWatched);
        eff.hideMembersOnly = TRI(r.hideMembersOnly, eff.hideMembersOnly);
        eff.hideSeen = TRI(r.hideSeen, eff.hideSeen);
        if (isFiniteNumber(r.viewsMin)) { eff.viewsMin = r.viewsMin; eff.scopes.views = SCOPE.channel; }
        eff.viewsMax = NUM(r.viewsMax, eff.viewsMax);
        eff.likesMin = NUM(r.likesMin, eff.likesMin);
        eff.likeRatioMin = NUM(r.likeRatioMin, eff.likeRatioMin);
        eff.outperformMin = NUM(r.outperformMin, eff.outperformMin);
        if (isFiniteNumber(r.durationMinSec)) { eff.durationMinSec = r.durationMinSec; eff.scopes.duration = SCOPE.channel; }
        eff.durationMaxSec = NUM(r.durationMaxSec, eff.durationMaxSec);
        if (isFiniteNumber(r.ageMaxDays)) { eff.ageMaxDays = r.ageMaxDays; eff.scopes.age = SCOPE.channel; }
        eff.ageMinDays = NUM(r.ageMinDays, eff.ageMinDays);
        eff.styleMaxScore = NUM(r.styleMaxScore, eff.styleMaxScore);
        eff.scoreFloor = NUM(r.scoreFloor, eff.scoreFloor);
        eff.requireQueryTerms = ENUM(r.requireQueryTerms, eff.requireQueryTerms);
        eff.titleIncludeMode = ENUM(r.titleIncludeMode, eff.titleIncludeMode);
        if (compiledPolicy.titleExclude && compiledPolicy.titleExclude.length) {
          eff.titleExclude = eff.titleExclude.concat(compiledPolicy.titleExclude);
          eff.scopes.keywords = SCOPE.channel;
        }
        if (compiledPolicy.titleInclude && compiledPolicy.titleInclude.length) eff.titleInclude = eff.titleInclude.concat(compiledPolicy.titleInclude);
        if (compiledPolicy.tagExclude && compiledPolicy.tagExclude.length) eff.tagExclude = eff.tagExclude.concat(compiledPolicy.tagExclude);
        if (compiledPolicy.tagInclude && compiledPolicy.tagInclude.length) eff.tagInclude = eff.tagInclude.concat(compiledPolicy.tagInclude);
      } else {
        eff.bypass = new Set();
      }
      return eff;
    }

    /* --- derived values ------------------------------------------------------ */

    /** Effective (exact-when-available) values used by rules and ranking. */
    function effective(record) {
      const e = record.enrichment;
      const views = e && isFiniteNumber(e.views) ? e.views : record.views;
      const publishedMs = e && isFiniteNumber(e.publishedMs) ? e.publishedMs : record.publishedMs;
      const durationSec = e && isFiniteNumber(e.durationSec) ? e.durationSec : record.durationSec;
      const likes = e && isFiniteNumber(e.likes) ? e.likes : null;
      const ageDays = isFiniteNumber(publishedMs) ? Math.max(0, (Date.now() - publishedMs) / 86400000) : null;
      return {
        views,
        likes,
        likeRatio: isFiniteNumber(likes) && isFiniteNumber(views) && views > 0 ? likes / views : null,
        publishedMs,
        durationSec,
        ageDays,
        exact: !!(e && (isFiniteNumber(e.publishedMs) || isFiniteNumber(e.views))),
        viewsPerDay: isFiniteNumber(views) && isFiniteNumber(ageDays) ? views / Math.max(0.5, ageDays) : null
      };
    }

    const channelKeyOf = (record) => record.channelId || record.channelHandle || record.channelFolded || '';

    /** Per-channel aggregates computed from the currently loaded result set. */
    function channelAggregates(records) {
      const groups = new Map();
      for (const record of records) {
        if (record.kind !== 'video' && record.kind !== 'short') continue;
        const key = channelKeyOf(record);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { key, name: record.channelName, count: 0, views: [], durations: [] });
        const group = groups.get(key);
        group.count++;
        const eff = record.effective || effective(record);
        if (isFiniteNumber(eff.views)) group.views.push(eff.views);
        if (isFiniteNumber(eff.durationSec)) group.durations.push(eff.durationSec);
      }
      for (const group of groups.values()) {
        group.medianViews = median(group.views);
        group.medianDuration = median(group.durations);
      }
      return groups;
    }

    /* --- signals & score ------------------------------------------------------ */

    function computeSignals(record, config, ctx, aggregate, policy) {
      const eff = record.effective;
      const ranking = config.ranking;
      const signals = {};

      if (isFiniteNumber(eff.ageDays)) {
        // Exponential decay: a video exactly one half-life old scores 0.5.
        signals.recency = Math.pow(0.5, eff.ageDays / Math.max(1, ranking.halfLifeDays));
      }
      if (isFiniteNumber(eff.views)) signals.views = logScale(eff.views, 100, 1e7);
      if (isFiniteNumber(eff.viewsPerDay)) signals.velocity = logScale(eff.viewsPerDay, 1, 1e5);
      if (isFiniteNumber(eff.likeRatio)) signals.engagement = clamp01(eff.likeRatio / 0.08);

      if (ctx.queryTerms.length) {
        const hay = `${record.titleFolded} ${record.channelFolded} ${record.descriptionFolded}`;
        let hits = 0;
        for (const term of ctx.queryTerms) if (hay.indexOf(term) !== -1) hits++;
        signals.queryMatch = hits / ctx.queryTerms.length;
      }

      if (isFiniteNumber(eff.durationSec)) {
        const lo = ranking.targetMinSec;
        const hi = Math.max(ranking.targetMaxSec, ranking.targetMinSec + 1);
        if (eff.durationSec >= lo && eff.durationSec <= hi) signals.durationFit = 1;
        else if (eff.durationSec < lo) signals.durationFit = clamp01(eff.durationSec / Math.max(1, lo));
        else signals.durationFit = clamp01(hi / eff.durationSec);
      }

      signals.titleCalm = 1 - clamp01(record.style.score / 100);

      if (policy && isFiniteNumber(policy.boost) && policy.boost !== 0) {
        signals.channelPriority = clamp01((policy.boost + 50) / 100);
      }

      if (aggregate && isFiniteNumber(aggregate.medianViews) && aggregate.medianViews > 0 && isFiniteNumber(eff.views) && aggregate.count > 1) {
        // Ratio of this video's views to the median of the same channel's other
        // results *in this loaded set*; 1× → 0.5, 10× → 1.0, 0.1× → 0.
        const ratio = eff.views / aggregate.medianViews;
        record.outperformRatio = ratio;
        signals.outperformance = clamp01(0.5 + Math.log10(ratio) / 2);
      }

      return signals;
    }

    function scoreOf(signals, config, policy, record) {
      const weights = config.ranking.weights;
      let sum = 0;
      let total = 0;
      for (const key of Object.keys(weights)) {
        const weight = weights[key];
        const value = signals[key];
        if (!isFiniteNumber(weight) || weight <= 0 || !isFiniteNumber(value)) continue;
        sum += weight * value;
        total += weight;
      }
      let score = total > 0 ? (sum / total) * 100 : 50; // no usable signal → neutral
      if (policy && isFiniteNumber(policy.boost)) score += policy.boost;
      if (config.style.enabled && config.style.action === 'demote' && record.style.score > config.style.maxScore) {
        score -= config.style.demotePoints;
      }
      return clamp(score, 0, 100);
    }

    /* --- per-record evaluation -------------------------------------------------- */

    const KIND_RULES = [
      ['short', 'hideShorts', REASON.kindShort],
      ['shorts-shelf', 'hideShortsShelves', REASON.kindShortsShelf],
      ['shelf', 'hideShelves', REASON.kindShelf],
      ['playlist', 'hidePlaylists', REASON.kindPlaylist],
      ['mix', 'hideMixes', REASON.kindMix],
      ['channel', 'hideChannels', REASON.kindChannel],
      ['movie', 'hideMovies', REASON.kindMovie],
      ['promoted', 'hidePromoted', REASON.kindPromoted]
    ];

    function evaluateRecord(record, config, ctx, compiledRules, eff, policy) {
      const reasons = [];
      const f = config.filters;
      const c = config.content;
      const e = record.effective;
      const bypass = eff.bypass;
      const add = (reason, scope) => {
        reasons.push(reason);
        if (!record.decidedBy) record.decidedBy = scope || SCOPE.global;
      };

      // 1. Structural kinds (never bypassable: a shelf is not a video).
      for (const [kind, flag, reason] of KIND_RULES) {
        if (record.kind === kind && f[flag]) add(reason);
      }
      if (eff.hideShorts && record.isShort && record.kind !== 'short') add(REASON.kindShort);

      if (eff.hideLive && record.isLive) add(REASON.live);
      if (eff.hideUpcoming && record.isUpcoming) add(REASON.upcoming);
      if (eff.hideMembersOnly && record.isMembersOnly) add(REASON.members);

      if (f.verifiedOnly && ctx.verifiedDetected && !record.isVerified &&
          (record.kind === 'video' || record.kind === 'short')) {
        add(REASON.unverified);
      }

      if (eff.hideWatched && isFiniteNumber(record.watchedPercent) && record.watchedPercent >= f.watchedThreshold) {
        add(REASON.watched, policy && policy.rules.hideWatched !== 'inherit' ? SCOPE.channel : SCOPE.global);
      }

      // 2. Global channel lists. They are the lightweight alternative to a full
      //    channel policy: the allow list behaves exactly like a "trusted"
      //    policy with every bypass enabled, the block list like a "blocked"
      //    one. A real channel policy always takes precedence over both.
      if (!policy) {
        if (compiledRules.allow.handles.size || compiledRules.allow.ids.size || compiledRules.allow.patterns.length) {
          if (channelMatches(compiledRules.allow, record)) {
            record.allowlisted = true;
            record.decidedBy = SCOPE.global;
            return [];
          }
        }
        if (compiledRules.block.handles.size || compiledRules.block.ids.size || compiledRules.block.patterns.length) {
          if (channelMatches(compiledRules.block, record)) add(REASON.channelBlocked, SCOPE.global);
        }
      }

      // 3. Keyword rules (title, and optionally the rendered snippet).
      if (eff.titleExclude.length) {
        const hit = matchesAny(eff.titleExclude, record.title, record.titleFolded) ||
          (f.matchDescription && record.description
            ? matchesAny(eff.titleExclude, record.description, record.descriptionFolded)
            : null);
        if (hit) add(REASON.titleExcluded, eff.scopes.keywords);
      }
      if (eff.titleInclude.length) {
        const hayRaw = f.matchDescription ? `${record.title} ${record.description}` : record.title;
        const hayFolded = f.matchDescription ? `${record.titleFolded} ${record.descriptionFolded}` : record.titleFolded;
        const ok = eff.titleIncludeMode === 'all'
          ? matchesAll(eff.titleInclude, hayRaw, hayFolded)
          : !!matchesAny(eff.titleInclude, hayRaw, hayFolded);
        if (!ok) add(REASON.titleRequired, eff.scopes.keywords);
      }

      // 4. Precision-only content rules. Inert when the data is unknown.
      const tags = record.tags;
      if (tags && tags.length) {
        const tagRaw = tags.join(' • ');
        const tagFolded = fold(tagRaw);
        if (eff.tagExclude.length && matchesAny(eff.tagExclude, tagRaw, tagFolded)) add(REASON.tagExcluded);
        if (eff.tagInclude.length) {
          const ok = c.tagIncludeMode === 'all'
            ? matchesAll(eff.tagInclude, tagRaw, tagFolded)
            : !!matchesAny(eff.tagInclude, tagRaw, tagFolded);
          if (!ok) add(REASON.tagRequired);
        }
      } else if (eff.tagInclude.length && record.tagsKnown === true) {
        add(REASON.tagRequired);
      }

      if (record.fullDescription) {
        const descRaw = record.fullDescription;
        const descFolded = fold(descRaw);
        if (compiledRules.descExclude.length && matchesAny(compiledRules.descExclude, descRaw, descFolded)) {
          add(REASON.descriptionExcluded);
        }
        if (compiledRules.descInclude.length && !matchesAny(compiledRules.descInclude, descRaw, descFolded)) {
          add(REASON.descriptionExcluded);
        }
      }

      if (record.category) {
        const folded = fold(record.category);
        if (c.categoryDeny.length && c.categoryDeny.some((entry) => fold(entry) === folded)) add(REASON.categoryExcluded);
        if (c.categoryAllow.length && !c.categoryAllow.some((entry) => fold(entry) === folded)) add(REASON.categoryExcluded);
      }
      if (c.familySafeOnly && record.familySafe === false) add(REASON.notFamilySafe);
      if (c.regionFilter && record.regions && record.regions !== 'ALL') {
        const region = (c.regionCode || ctx.regionCode || '').toUpperCase();
        if (region && record.regions.split(',').indexOf(region) === -1) add(REASON.regionBlocked);
      }

      // 5. Query-term requirement.
      if (eff.requireQueryTerms !== 'off' && ctx.queryTerms.length && record.kind !== 'shelf') {
        const hay = `${record.titleFolded} ${record.channelFolded} ${record.descriptionFolded}`;
        const hits = ctx.queryTerms.filter((term) => hay.indexOf(term) !== -1).length;
        const ok = eff.requireQueryTerms === 'all' ? hits === ctx.queryTerms.length : hits > 0;
        if (!ok) add(REASON.queryTerms);
      }

      // 6. Numeric thresholds.
      if (isFiniteNumber(e.views)) {
        if (isFiniteNumber(eff.viewsMin) && e.views < eff.viewsMin) add(REASON.viewsMin, eff.scopes.views);
        if (isFiniteNumber(eff.viewsMax) && e.views > eff.viewsMax) add(REASON.viewsMax, eff.scopes.views);
      }
      if (isFiniteNumber(e.likes) && isFiniteNumber(eff.likesMin) && e.likes < eff.likesMin) add(REASON.likesMin);
      if (isFiniteNumber(e.likeRatio) && isFiniteNumber(eff.likeRatioMin) && e.likeRatio < eff.likeRatioMin) add(REASON.ratioMin);
      if (isFiniteNumber(eff.durationMinSec) && isFiniteNumber(e.durationSec) && e.durationSec < eff.durationMinSec) add(REASON.durationMin, eff.scopes.duration);
      if (isFiniteNumber(eff.durationMaxSec) && isFiniteNumber(e.durationSec) && e.durationSec > eff.durationMaxSec) add(REASON.durationMax, eff.scopes.duration);
      if (isFiniteNumber(e.ageDays)) {
        if (isFiniteNumber(eff.ageMaxDays) && e.ageDays > eff.ageMaxDays) add(REASON.ageMax, eff.scopes.age);
        if (isFiniteNumber(eff.ageMinDays) && e.ageDays < eff.ageMinDays) add(REASON.ageMin, eff.scopes.age);
      }
      if (isFiniteNumber(eff.outperformMin) && isFiniteNumber(record.outperformRatio) &&
          record.outperformRatio < eff.outperformMin) {
        add(REASON.outperformMin);
      }

      // 7. Structural title analysis.
      if (isFiniteNumber(eff.styleMaxScore) && config.style.action === 'hide' &&
          record.style.score > eff.styleMaxScore) {
        add(REASON.styleScore);
      }
      if (config.style.enabled) {
        const len = record.style.length;
        if (isFiniteNumber(config.style.minTitleLength) && len < config.style.minTitleLength) add(REASON.styleScore);
        if (isFiniteNumber(config.style.maxTitleLength) && len > config.style.maxTitleLength) add(REASON.styleScore);
      }

      // 8. Writing system.
      if (config.scripts.mode !== 'off' && !bypass.has('script') &&
          (record.kind === 'video' || record.kind === 'short') && record.script.id !== 'unknown') {
        const listed = config.scripts.list.indexOf(record.script.id) !== -1;
        if (config.scripts.mode === 'allow' && config.scripts.list.length && !listed) add(REASON.scriptBlocked);
        if (config.scripts.mode === 'deny' && listed) add(REASON.scriptBlocked);
      }

      // 9. Personal memory.
      if (eff.hideSeen && record.videoId && record.seenBefore) add(REASON.seen, SCOPE.video);

      // 10. Ad-hoc in-page search (always last: it is a live, transient filter).
      if (ctx.inResultsQuery) {
        const needle = ctx.inResultsQuery;
        const negated = needle.startsWith('!') || needle.startsWith('-');
        const term = negated ? needle.slice(1).trim() : needle;
        if (term) {
          const hay = `${record.titleFolded} ${record.channelFolded} ${record.descriptionFolded}`;
          const found = hay.indexOf(term) !== -1;
          if (negated ? found : !found) add(REASON.inResults);
        }
      }

      return reasons;
    }

    /* --- comparators ----------------------------------------------------------- */

    const collator = (() => {
      try { return new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }); } catch (_e) { return null; }
    })();

    const compareText = (a, b) => (collator ? collator.compare(a || '', b || '') : String(a || '').localeCompare(String(b || '')));

    function comparatorFor(mode, unknownLast) {
      const pickValue = (record, pick) => {
        const eff = record.effective || effective(record);
        const value = pick(eff, record);
        return isFiniteNumber(value) ? value : null;
      };
      const byNumber = (pick, direction) => (a, b) => {
        const av = pickValue(a, pick);
        const bv = pickValue(b, pick);
        if (av === null && bv === null) return a.order - b.order;
        if (av === null) return unknownLast ? 1 : -1;
        if (bv === null) return unknownLast ? -1 : 1;
        if (av === bv) return a.order - b.order;
        return direction * (av - bv);
      };

      switch (mode) {
        case 'score': return byNumber((_eff, record) => record.score, -1);
        case 'newest': return byNumber((eff) => eff.publishedMs, -1);
        case 'oldest': return byNumber((eff) => eff.publishedMs, 1);
        case 'views-desc': return byNumber((eff) => eff.views, -1);
        case 'views-asc': return byNumber((eff) => eff.views, 1);
        case 'vpd-desc': return byNumber((eff) => eff.viewsPerDay, -1);
        case 'likes-desc': return byNumber((eff) => eff.likes, -1);
        case 'ratio-desc': return byNumber((eff) => eff.likeRatio, -1);
        case 'outperform-desc': return byNumber((_eff, record) => record.outperformRatio, -1);
        case 'duration-desc': return byNumber((eff) => eff.durationSec, -1);
        case 'duration-asc': return byNumber((eff) => eff.durationSec, 1);
        case 'title-asc': return (a, b) => compareText(a.title, b.title) || (a.order - b.order);
        case 'channel-asc': return (a, b) => compareText(a.channelName, b.channelName) || (a.order - b.order);
        default: return (a, b) => a.order - b.order;
      }
    }

    /* --- grouping --------------------------------------------------------------- */

    function recencyBucket(publishedMs) {
      if (!isFiniteNumber(publishedMs)) return { key: 'zz-unknown', label: 'Unknown date' };
      const days = (Date.now() - publishedMs) / 86400000;
      if (days <= 1) return { key: 'a-today', label: 'Today' };
      if (days <= 7) return { key: 'b-week', label: 'This week' };
      if (days <= 31) return { key: 'c-month', label: 'This month' };
      if (days <= 365) return { key: 'd-year', label: 'This year' };
      return { key: 'e-older', label: 'Older' };
    }

    function groupOf(record, mode, config) {
      switch (mode) {
        case 'channel':
          return { key: channelKeyOf(record) || 'zz', label: record.channelName || 'Unknown channel' };
        case 'tier': {
          const score = isFiniteNumber(record.score) ? record.score : 0;
          if (record.pinned) return { key: 'a-pinned', label: 'Pinned' };
          if (score >= config.ranking.tierHigh) return { key: 'b-top', label: `Top matches (score ≥ ${Math.round(config.ranking.tierHigh)})` };
          if (score >= config.ranking.tierLow) return { key: 'c-standard', label: 'Standard' };
          return { key: 'd-low', label: 'Low priority' };
        }
        case 'series': {
          if (record.clusterLabel) return { key: `s-${record.clusterKey}`, label: record.clusterLabel };
          return { key: 'zz-single', label: 'Individual results' };
        }
        case 'recency':
          return recencyBucket(record.effective ? record.effective.publishedMs : null);
        default:
          return null;
      }
    }

    /* --- clustering -------------------------------------------------------------- */

    /**
     * Group near-duplicate titles and detected series.
     * Similarity is Jaccard overlap of content tokens; a card joins the first
     * cluster whose representative it matches at or above the threshold, which
     * makes the result independent of iteration order for equal inputs.
     */
    let clusterMemo = { key: '', assignments: null };

    const clusterSignature = (records, config) => {
      const dedupe = config.dedupe;
      const first = records.length ? records[0] : null;
      const last = records.length ? records[records.length - 1] : null;
      return [
        records.length,
        first ? first.videoId || first.title.slice(0, 24) : '',
        last ? last.videoId || last.title.slice(0, 24) : '',
        dedupe.similarEnabled, dedupe.similarThreshold, dedupe.seriesEnabled
      ].join('|');
    };

    function clusterRecords(records, config) {
      const dedupe = config.dedupe;
      if (!dedupe.similarEnabled && !dedupe.seriesEnabled) {
        clusterMemo = { key: '', assignments: null };
        return;
      }

      // Clustering only changes when the loaded result set or the clustering
      // configuration changes, so the (quadratic in the worst case) work is
      // done once per result set rather than on every pass.
      const signature = clusterSignature(records, config);
      if (clusterMemo.key === signature && clusterMemo.assignments) {
        for (const record of records) {
          const assignment = clusterMemo.assignments.get(record.el);
          if (!assignment) continue;
          record.clusterKey = assignment.key;
          record.clusterLabel = assignment.label;
          record.clusterKind = assignment.kind;
          record.clusterSize = assignment.size;
        }
        return;
      }

      const candidates = records.filter((r) => (r.kind === 'video' || r.kind === 'short') && r.title)
        .slice(0, LIMITS.maxClusterCards);

      const seriesClusters = new Map();
      if (dedupe.seriesEnabled) {
        for (const record of candidates) {
          if (!record.series) continue;
          const key = `${channelKeyOf(record)}|${record.series.key}`;
          if (!seriesClusters.has(key)) seriesClusters.set(key, []);
          seriesClusters.get(key).push(record);
        }
        for (const [key, members] of seriesClusters) {
          if (members.length < 2) continue;
          const label = `Series: ${members[0].series.key.slice(0, 48) || members[0].channelName}`;
          for (const member of members) {
            member.clusterKey = TextSignals.hash(key);
            member.clusterLabel = label;
            member.clusterKind = 'series';
            member.clusterSize = members.length;
          }
        }
      }

      if (dedupe.similarEnabled) {
        const clusters = [];
        // Inverted index token → candidate clusters. Two titles can only reach
        // the similarity threshold if they share at least one content token,
        // so only those clusters are compared instead of all of them.
        const index = new Map();
        for (const record of candidates) {
          if (record.clusterKind === 'series') continue;
          const seenClusters = new Set();
          let joined = null;
          for (const token of record.titleTokens) {
            const bucket = index.get(token);
            if (!bucket) continue;
            for (const clusterIndex of bucket) {
              if (seenClusters.has(clusterIndex)) continue;
              seenClusters.add(clusterIndex);
              const cluster = clusters[clusterIndex];
              if (TextSignals.similarity(record.titleTokens, cluster.tokens) >= dedupe.similarThreshold) {
                joined = cluster;
                break;
              }
            }
            if (joined) break;
          }
          if (joined) {
            joined.members.push(record);
          } else {
            const cluster = { tokens: record.titleTokens, members: [record], key: TextSignals.hash(record.titleTokens.join(' ')) };
            const clusterIndex = clusters.push(cluster) - 1;
            for (const token of record.titleTokens) {
              if (!index.has(token)) index.set(token, []);
              index.get(token).push(clusterIndex);
            }
          }
        }
        for (const cluster of clusters) {
          if (cluster.members.length < 2) continue;
          for (const member of cluster.members) {
            member.clusterKey = cluster.key;
            member.clusterLabel = `Similar: ${cluster.members[0].title.slice(0, 48)}`;
            member.clusterKind = 'similar';
            member.clusterSize = cluster.members.length;
          }
        }
      }

      const assignments = new Map();
      for (const record of records) {
        if (!record.clusterKey) continue;
        assignments.set(record.el, {
          key: record.clusterKey, label: record.clusterLabel,
          kind: record.clusterKind, size: record.clusterSize
        });
      }
      clusterMemo = { key: signature, assignments };
    }

    /* --- public API ---------------------------------------------------------------- */

    return {
      effective,
      channelKeyOf,
      activeContexts,
      /** Drop per-page caches (called on navigation and teardown). */
      resetCaches() { clusterMemo = { key: '', assignments: null }; },
      effectiveRules,
      comparatorFor,
      groupOf,
      get compileErrors() { return compiled ? compiled.errors : []; },

      /**
       * Full evaluation over an ordered list of records.
       * Mutates each record (hidden/reasons/score/group) and returns statistics.
       */
      run(records, config, ctx) {
        const compiledRules = rules(config);
        const contexts = ctx.activeContexts || activeContexts(config, ctx);
        const stats = {
          total: records.length,
          visible: 0,
          hidden: 0,
          pinned: 0,
          byReason: Object.create(null),
          byScope: Object.create(null),
          needsPrecision: [],
          contexts: contexts.map((c) => c.name),
          channelsConfigured: 0
        };

        // Pass 1 — per-record derived values, so aggregates see exact data.
        for (const record of records) {
          record.effective = effective(record);
          record.reasons = [];
          record.decidedBy = '';
          record.score = null;
          record.group = null;
          record.clusterKey = null;
          record.clusterLabel = '';
          record.clusterKind = '';
          record.clusterSize = 0;
          record.outperformRatio = null;
          record.pinned = false;
          record.allowlisted = false;
          record.policy = null;
          record.policyKey = '';
          if (record.enrichment) {
            const e = record.enrichment;
            record.tags = e.tags || null;
            record.tagsKnown = true;
            record.fullDescription = e.description || null;
            record.category = e.category || null;
            record.familySafe = typeof e.familySafe === 'boolean' ? e.familySafe : null;
            record.regions = e.regions || null;
            if (!record.channelId && e.channelId) record.channelId = e.channelId;
          }
        }

        const aggregates = channelAggregates(records);
        clusterRecords(records, config);

        // Pass 2 — scope resolution, rules, signals, score.
        for (const record of records) {
          const identity = { channelId: record.channelId, handle: record.channelHandle, name: record.channelName };
          const policy = (record.kind === 'video' || record.kind === 'short' || record.kind === 'playlist')
            ? Channels.active(identity)
            : null;
          record.policy = policy;
          record.policyKey = policy ? policy.key : '';
          if (policy) stats.channelsConfigured++;

          const verdict = record.videoId ? Memory.verdict(record.videoId) : null;
          record.verdict = verdict ? verdict.v : '';
          record.seenBefore = !!(record.videoId && config.memory.hideSeen &&
            Memory.wasSeenBefore(record.videoId, ctx.queryKey, config.memory.seenTtlDays, config.memory.seenScopeQuery));

          const eff = effectiveRules(config, contexts, policy, compiledRules);
          record.eff = eff;

          const aggregate = aggregates.get(channelKeyOf(record));
          record.channelAggregate = aggregate || null;
          record.signals = computeSignals(record, config, ctx, aggregate, policy);
          record.score = scoreOf(record.signals, config, policy, record);

          let reasons = [];
          if (verdict && verdict.v === 'pin') {
            record.pinned = true;
            record.decidedBy = SCOPE.video;
          } else if (verdict && verdict.v === 'mute') {
            reasons = [REASON.videoMuted];
            record.decidedBy = SCOPE.video;
          } else if (verdict && verdict.v === 'snooze') {
            reasons = [REASON.videoSnoozed];
            record.decidedBy = SCOPE.video;
          } else if (policy && policy.mode === 'blocked') {
            reasons = [REASON.channelBlocked];
            record.decidedBy = SCOPE.channel;
          } else if (policy && policy.mode === 'muted') {
            reasons = [REASON.channelMuted];
            record.decidedBy = SCOPE.channel;
          } else {
            reasons = evaluateRecord(record, config, ctx, compiledRules, eff, policy);
          }

          record.reasons = reasons;
          record.hidden = reasons.length > 0;
        }

        // Pass 3 — set-level rules that need the whole (surviving) list.
        const survivors = records.filter((r) => !r.hidden);
        const hide = (record, reason, scope) => {
          if (record.hidden) return;
          record.hidden = true;
          record.reasons = record.reasons.concat([reason]);
          if (!record.decidedBy) record.decidedBy = scope || SCOPE.global;
        };

        if (config.filters.hideDuplicates) {
          const seenIds = new Set();
          for (const record of survivors) {
            if (!record.videoId || record.pinned || record.allowlisted) continue;
            if (seenIds.has(record.videoId)) hide(record, REASON.duplicate);
            else seenIds.add(record.videoId);
          }
        }

        const orderIn = (list) => list.slice().sort(comparatorFor(
          config.sort.mode === 'relevance' ? 'relevance' : config.sort.mode,
          config.sort.unknownLast
        ));

        if (config.dedupe.similarEnabled && config.dedupe.similarAction === 'hide') {
          const kept = new Map();
          for (const record of orderIn(records.filter((r) => !r.hidden && r.clusterKind === 'similar'))) {
            if (record.pinned || (record.eff && record.eff.bypass.has('duplicates'))) continue;
            const count = (kept.get(record.clusterKey) || 0) + 1;
            kept.set(record.clusterKey, count);
            if (count > config.dedupe.similarKeep) hide(record, REASON.similar);
          }
        }

        if (config.dedupe.seriesEnabled) {
          const prefer = config.dedupe.seriesPrefer;
          const groups = new Map();
          for (const record of records) {
            if (record.hidden || record.clusterKind !== 'series') continue;
            if (!groups.has(record.clusterKey)) groups.set(record.clusterKey, []);
            groups.get(record.clusterKey).push(record);
          }
          for (const members of groups.values()) {
            const sorted = members.slice().sort((a, b) => {
              if (prefer === 'newest') {
                const av = a.effective.publishedMs || 0;
                const bv = b.effective.publishedMs || 0;
                if (av !== bv) return bv - av;
              } else if (prefer === 'lowest-episode') {
                if (a.series.number !== b.series.number) return a.series.number - b.series.number;
              } else if (prefer === 'highest-episode') {
                if (a.series.number !== b.series.number) return b.series.number - a.series.number;
              }
              return a.order - b.order;
            });
            sorted.forEach((record, index) => {
              if (record.pinned || (record.eff && record.eff.bypass.has('duplicates'))) return;
              if (index >= config.dedupe.seriesKeep) hide(record, REASON.seriesCap);
            });
          }
        }

        // Per-channel caps: the global cap plus any policy-specific limit.
        const globalCap = config.filters.maxPerChannel;
        const counts = new Map();
        for (const record of orderIn(records.filter((r) => !r.hidden))) {
          if (record.pinned || record.allowlisted) continue;
          const key = channelKeyOf(record);
          if (!key) continue;
          const policy = record.policy;
          const policyLimit = policy && policy.mode === 'limited' && isFiniteNumber(policy.limit) ? policy.limit : null;
          const bypassCap = record.eff && record.eff.bypass.has('cap');
          const cap = isFiniteNumber(policyLimit) ? policyLimit : (bypassCap ? null : globalCap);
          if (!isFiniteNumber(cap) || cap <= 0) continue;
          const count = (counts.get(key) || 0) + 1;
          counts.set(key, count);
          if (count > cap) hide(record, isFiniteNumber(policyLimit) ? REASON.channelPolicyRule : REASON.channelCap,
            isFiniteNumber(policyLimit) ? SCOPE.channel : SCOPE.global);
        }

        // Score floor is applied last so that it ranks against the final score.
        for (const record of records) {
          if (record.hidden || record.pinned || record.allowlisted) continue;
          const floor = record.eff ? record.eff.scoreFloor : config.ranking.scoreFloor;
          if (isFiniteNumber(floor) && isFiniteNumber(record.score) && record.score < floor) {
            hide(record, REASON.scoreFloor);
          }
        }

        // Tally.
        for (const record of records) {
          if (record.hidden) {
            stats.hidden++;
            const key = record.reasons[0];
            stats.byReason[key] = (stats.byReason[key] || 0) + 1;
            const scope = record.decidedBy || SCOPE.global;
            stats.byScope[scope] = (stats.byScope[scope] || 0) + 1;
          } else {
            stats.visible++;
            if (record.pinned) stats.pinned++;
          }
          record.group = groupOf(record, record.eff ? record.eff.groupBy : config.ranking.groupBy, config);
        }

        // Which cards would benefit from an exact lookup?
        if (config.precision.enabled) {
          const wantsExact = /^(newest|oldest|likes-desc|ratio-desc|score)$/.test(config.sort.mode) ||
            isFiniteNumber(config.filters.ageMaxDays) || isFiniteNumber(config.filters.ageMinDays) ||
            isFiniteNumber(config.filters.likesMin) || isFiniteNumber(config.filters.likeRatioMin) ||
            config.content.tagInclude.length > 0 || config.content.tagExclude.length > 0 ||
            config.content.descriptionInclude.length > 0 || config.content.descriptionExclude.length > 0 ||
            config.content.categoryAllow.length > 0 || config.content.categoryDeny.length > 0 ||
            config.content.familySafeOnly || config.content.regionFilter ||
            isFiniteNumber(config.filters.viewsMin) || isFiniteNumber(config.filters.viewsMax);
          if (wantsExact) {
            for (const record of records) {
              if (!record.videoId || record.enrichment) continue;
              if (record.kind !== 'video' && record.kind !== 'short') continue;
              stats.needsPrecision.push(record.videoId);
            }
          }
        }

        return stats;
      },

      /**
       * Produce the final display order.
       * Pinned cards (and, optionally, priority channels) float to the top;
       * grouping keeps groups contiguous, ordered by their best member.
       */
      order(records, config) {
        const mode = config.sort.mode;
        const comparator = comparatorFor(mode, config.sort.unknownLast);
        const ranking = config.ranking;

        const rank = (record) => {
          if (ranking.pinnedFirst && record.pinned) return 0;
          if (ranking.priorityFirst && record.policy && record.policy.mode === 'priority') return 1;
          return 2;
        };

        const base = records.slice().sort((a, b) => {
          const ra = rank(a);
          const rb = rank(b);
          if (ra !== rb) return ra - rb;
          return comparator(a, b);
        });

        const groupBy = ranking.groupBy;
        if (groupBy === 'none') return { records: base, groups: [] };

        const groups = new Map();
        base.forEach((record, index) => {
          const group = record.group || groupOf(record, groupBy, config) || { key: 'zz', label: 'Other' };
          if (!groups.has(group.key)) groups.set(group.key, { key: group.key, label: group.label, order: index, records: [] });
          groups.get(group.key).records.push(record);
        });
        const ordered = Array.from(groups.values()).sort((a, b) => {
          // Tier and recency groups have intrinsic order encoded in their keys.
          if (groupBy === 'tier' || groupBy === 'recency') return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
          return a.order - b.order;
        });
        const flat = [];
        for (const group of ordered) for (const record of group.records) flat.push(record);
        return { records: flat, groups: ordered };
      },

      sort(records, config) {
        return this.order(records, config).records;
      }
    };
  })();

  /* ==========================================================================
   * 10. YouTube server-side search filters (sp= builder)
   *
   * YouTube encodes its own search filters as a protobuf message in the `sp`
   * query parameter. Values below were read from the live filter menu of
   * www.youtube.com/results (September 2026) and decoded field-by-field, e.g.
   *   EgIYBA%3D%3D -> 12 02 18 04 -> {2:{3:4}} -> duration = "under 3 minutes"
   *   CAM%3D       -> 08 03       -> {1:3}     -> prioritise "Popularity"
   * Building the message ourselves allows combinations YouTube's own menu does
   * not offer in a single click (e.g. "Videos + This week + Over 20 minutes").
   *
   * Deliberately NOT offered: sort-by-upload-date (field 1 = 1). YouTube
   * removed that option in January 2026 and the server now ignores the
   * parameter, so exposing it would be a fake feature. Chronological ordering
   * is provided client-side by the sort engine instead.
   * ======================================================================= */

  const SearchParams = (() => {
    const UPLOAD_DATE = Object.freeze({ any: null, today: 2, week: 3, month: 4, year: 5 });
    const TYPE = Object.freeze({ any: null, video: 1, channel: 2, playlist: 3, movie: 4, shorts: 9 });
    const DURATION = Object.freeze({ any: null, under3: 4, from3to20: 5, over20: 2 });
    const FEATURES = Object.freeze({
      hd: 4, subtitles: 5, creativeCommons: 6, threeD: 7, live: 8,
      purchased: 9, fourK: 14, spatial360: 15, location: 23, hdr: 25, vr180: 26
    });
    const PRIORITIZE = Object.freeze({ relevance: null, popularity: 3 });

    const FEATURE_LABELS = Object.freeze([
      ['live', 'Live'], ['fourK', '4K'], ['hd', 'HD'], ['subtitles', 'Subtitles/CC'],
      ['creativeCommons', 'Creative Commons'], ['spatial360', '360°'], ['vr180', 'VR180'],
      ['threeD', '3D'], ['hdr', 'HDR'], ['location', 'Location'], ['purchased', 'Purchased']
    ]);

    const varint = (value) => {
      const bytes = [];
      let v = value >>> 0;
      do {
        let byte = v & 0x7f;
        v >>>= 7;
        if (v) byte |= 0x80;
        bytes.push(byte);
      } while (v);
      return bytes;
    };

    const tag = (field, wireType) => varint((field << 3) | wireType);

    const toBase64 = (bytes) => {
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };

    /**
     * @returns {string} the encoded `sp` value, or '' when nothing is selected.
     * The value is percent-encoded once, exactly like YouTube's own links
     * (which contain `%253D` because the value itself contains `%3D`).
     */
    function build(selection) {
      const filterBytes = [];
      const addVarintField = (field, value) => {
        if (!isFiniteNumber(value) || value === null) return;
        filterBytes.push(...tag(field, 0), ...varint(value));
      };

      addVarintField(1, UPLOAD_DATE[selection.uploadDate] ?? null);
      addVarintField(2, TYPE[selection.type] ?? null);
      addVarintField(3, DURATION[selection.duration] ?? null);
      for (const key of Object.keys(FEATURES)) {
        if (selection.features && selection.features[key]) addVarintField(FEATURES[key], 1);
      }

      const message = [];
      const prioritize = PRIORITIZE[selection.prioritize] ?? null;
      if (isFiniteNumber(prioritize)) message.push(...tag(1, 0), ...varint(prioritize));
      if (filterBytes.length) message.push(...tag(2, 2), ...varint(filterBytes.length), ...filterBytes);
      if (!message.length) return '';
      return encodeURIComponent(toBase64(message));
    }

    /** Produce the target URL for the current query with the given selection. */
    function urlFor(selection, baseHref) {
      const url = safeUrl(baseHref || location.href);
      if (!url) return null;
      const sp = build(selection);
      if (sp) url.searchParams.set('sp', sp);
      else url.searchParams.delete('sp');
      return url;
    }

    return { build, urlFor, UPLOAD_DATE, TYPE, DURATION, FEATURES, PRIORITIZE, FEATURE_LABELS };
  })();

  /* ==========================================================================
   * 11. View: page styling, card decoration, grouping and result ordering
   *
   * All host-page mutations are made here, are idempotent, and are fully
   * reversible: every card carries `data-ysc*` attributes plus at most one
   * annotation element that we own, and group headers are elements we create
   * and track so they can be removed completely.
   * ======================================================================= */

  const View = (() => {
    const STYLE_ID = 'ytsc-page-style';
    const ANNO_CLASS = 'ytsc-anno';
    const GROUP_CLASS = 'ytsc-group';
    const MARK_CLASS = 'ytsc-mark';
    const homes = new WeakMap();       // card element -> { container, index }
    const annotations = new WeakMap(); // card element -> annotation nodes
    const highlighted = new Set();     // anchors currently carrying <mark>
    const groupNodes = new Map();      // group key -> header element
    const accented = new Set();        // cards carrying an accent colour
    let consolidated = false;

    const PAGE_CSS = `
      [data-ysc="hidden"] { display: none !important; }
      [data-ysc="collapse"] {
        max-height: 34px !important; overflow: hidden !important;
        opacity: .45 !important; margin-bottom: 4px !important;
      }
      [data-ysc="dim"] { opacity: .32 !important; filter: grayscale(70%); }
      [data-ysc="blur"] > *:not(.${ANNO_CLASS}) { filter: blur(7px); pointer-events: none; }
      [data-ysc="blur"] { position: relative; }
      [data-ysc-accent] {
        border-left: 3px solid var(--ysc-accent, transparent) !important;
        padding-left: 7px !important;
      }
      [data-ysc-compact="1"] ytd-thumbnail,
      [data-ysc-compact="1"] yt-thumbnail-view-model { max-width: 200px; }
      .${GROUP_CLASS} {
        grid-column: 1 / -1; width: 100%;
        display: flex; align-items: center; gap: 8px;
        margin: 14px 0 6px; padding-bottom: 4px;
        border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(128,128,128,.3));
        font-family: "Roboto", Arial, sans-serif; font-size: 12px; font-weight: 600;
        letter-spacing: .04em; text-transform: uppercase;
        color: var(--yt-spec-text-secondary, #909090);
      }
      .${GROUP_CLASS} .ytsc-group-count { font-weight: 400; text-transform: none; letter-spacing: 0; }
      .${ANNO_CLASS} {
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
        margin: 4px 0 10px 0; font-family: "Roboto", Arial, sans-serif; font-size: 11px;
        line-height: 16px; color: var(--yt-spec-text-secondary, #909090); position: relative; z-index: 2;
      }
      .${ANNO_CLASS} .ytsc-chip {
        border: 1px solid var(--yt-spec-10-percent-layer, rgba(128,128,128,.35));
        border-radius: 10px; padding: 1px 7px; white-space: nowrap;
      }
      .${ANNO_CLASS} .ytsc-chip--reason { border-color: rgba(255,120,90,.6); color: var(--yt-spec-text-primary, #f1f1f1); }
      .${ANNO_CLASS} .ytsc-chip--exact { border-style: dashed; }
      .${ANNO_CLASS} .ytsc-chip--score { border-color: rgba(62,166,255,.7); font-variant-numeric: tabular-nums; }
      .${ANNO_CLASS} .ytsc-chip--policy { border-color: var(--ysc-accent, rgba(120,200,120,.7)); }
      .${ANNO_CLASS} button {
        font: inherit; cursor: pointer; border-radius: 10px; padding: 1px 8px;
        background: transparent; color: inherit;
        border: 1px solid var(--yt-spec-10-percent-layer, rgba(128,128,128,.35));
      }
      .${ANNO_CLASS} button:hover { background: var(--yt-spec-badge-chip-background, rgba(128,128,128,.18)); }
      .${ANNO_CLASS} button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 1px; }
      .${ANNO_CLASS} button[aria-pressed="true"] { border-color: #3ea6ff; color: #3ea6ff; }
      .${MARK_CLASS} { background: rgba(255, 212, 0, .35); color: inherit; border-radius: 2px; padding: 0 1px; }
      @media (prefers-reduced-motion: reduce) { [data-ysc] { transition: none !important; } }
    `;

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const parent = document.head || document.documentElement;
      if (!parent) return;
      const style = el('style', { id: STYLE_ID, type: 'text/css' });
      style.textContent = PAGE_CSS;
      parent.appendChild(style);
    }

    function removeStyles() {
      const style = document.getElementById(STYLE_ID);
      if (style && style.parentNode) style.parentNode.removeChild(style);
    }

    function rememberHome(node, container, index) {
      if (!homes.has(node)) homes.set(node, { container, index });
    }

    /* --- annotations ------------------------------------------------------ */

    function annotationFor(node, handlers) {
      let anno = annotations.get(node);
      if (anno && anno.root.isConnected && anno.root.parentNode === node) return anno;
      const chips = el('span', { class: 'ytsc-chips', style: { display: 'flex', gap: '6px', 'flex-wrap': 'wrap' } });
      const mk = (cls, text, title) => el('button', { type: 'button', class: cls, text, title: title || text });
      const pinBtn = mk('ytsc-pin', 'Pin', 'Always keep this video at the top');
      const muteBtn = mk('ytsc-mute', 'Mute', 'Never show this video again');
      const snoozeBtn = mk('ytsc-snooze', 'Snooze', 'Hide this video for 7 days');
      const channelBtn = mk('ytsc-channel', 'Channel…', 'Open the channel policy for this channel');
      const blockBtn = mk('ytsc-block', 'Block', 'Block this channel');
      const revealBtn = mk('ytsc-reveal', 'Show', 'Reveal this filtered result');
      const root = el('div', { class: ANNO_CLASS }, [chips, pinBtn, muteBtn, snoozeBtn, channelBtn, blockBtn, revealBtn]);

      const wire = (button, fn) => button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        fn(node);
      });
      wire(pinBtn, handlers.onPin);
      wire(muteBtn, handlers.onMute);
      wire(snoozeBtn, handlers.onSnooze);
      wire(channelBtn, handlers.onChannelPolicy);
      wire(blockBtn, handlers.onBlockChannel);
      wire(revealBtn, handlers.onReveal);

      anno = { root, chips, pinBtn, muteBtn, snoozeBtn, channelBtn, blockBtn, revealBtn, lastKey: '' };
      annotations.set(node, anno);
      node.appendChild(root);
      return anno;
    }

    function removeAnnotation(node) {
      const anno = annotations.get(node);
      if (anno && anno.root.parentNode) anno.root.parentNode.removeChild(anno.root);
      annotations.delete(node);
    }

    function chipsFor(record, config) {
      const chips = [];
      const eff = record.effective || Engine.effective(record);
      if (config.display.showReasons && record.hidden && record.reasons.length) {
        const scope = config.display.showScope && record.decidedBy ? ` (${record.decidedBy})` : '';
        chips.push({ text: `${record.reasons.join(' · ')}${scope}`, cls: 'ytsc-chip--reason' });
      }
      if (record.policy) {
        const mode = record.policy.mode;
        const label = record.policy.label || CHANNEL_MODES.find((m) => m.id === mode).label.split(' —')[0];
        chips.push({ text: `▎${label}`, cls: 'ytsc-chip--policy' });
      }
      if (record.pinned) chips.push({ text: '📌 pinned', cls: 'ytsc-chip--score' });
      if (config.display.showScore && isFiniteNumber(record.score) && (record.kind === 'video' || record.kind === 'short')) {
        chips.push({
          text: `score ${Math.round(record.score)}`,
          cls: 'ytsc-chip--score',
          title: explainScore(record)
        });
      }
      if (config.display.showBadges) {
        if (record.isLive) chips.push({ text: isFiniteNumber(record.liveViewers) ? `LIVE · ${formatCount(record.liveViewers)} watching` : 'LIVE' });
        if (record.isUpcoming) chips.push({ text: 'Upcoming' });
        if (isFiniteNumber(eff.publishedMs)) {
          chips.push({
            text: eff.exact ? `📅 ${formatDate(eff.publishedMs)}` : `~${formatAgo(eff.publishedMs)}`,
            cls: eff.exact ? 'ytsc-chip--exact' : ''
          });
        }
        if (isFiniteNumber(eff.viewsPerDay)) chips.push({ text: `${formatCount(Math.round(eff.viewsPerDay))}/day` });
        if (isFiniteNumber(eff.likes)) chips.push({ text: `👍 ${formatCount(eff.likes)}`, cls: 'ytsc-chip--exact' });
        if (isFiniteNumber(eff.likeRatio)) chips.push({ text: `${(eff.likeRatio * 100).toFixed(1)}% likes`, cls: 'ytsc-chip--exact' });
        if (isFiniteNumber(record.outperformRatio) && record.channelAggregate && record.channelAggregate.count > 1) {
          chips.push({ text: `${record.outperformRatio >= 1 ? '▲' : '▼'} ${record.outperformRatio.toFixed(1)}× channel median` });
        }
        if (isFiniteNumber(eff.durationSec)) chips.push({ text: formatDuration(eff.durationSec) });
        if (isFiniteNumber(record.watchedPercent) && record.watchedPercent > 0) chips.push({ text: `watched ${Math.round(record.watchedPercent)}%` });
        if (record.category) chips.push({ text: record.category, cls: 'ytsc-chip--exact' });
        if (record.style && record.style.score >= 40) chips.push({ text: `style ${record.style.score}`, title: explainStyle(record.style) });
        if (record.clusterSize > 1) chips.push({ text: `${record.clusterKind === 'series' ? 'series' : 'similar'} ×${record.clusterSize}` });
        if (record.seenBefore) chips.push({ text: 'seen before' });
      }
      return chips;
    }

    function explainScore(record) {
      const parts = [];
      for (const signal of SIGNALS) {
        const value = record.signals ? record.signals[signal.id] : null;
        if (!isFiniteNumber(value)) continue;
        parts.push(`${signal.label}: ${Math.round(value * 100)}`);
      }
      return parts.length ? `Ranking signals — ${parts.join(', ')}` : 'No ranking signals available for this card.';
    }

    function explainStyle(style) {
      return `Title structure — caps ${Math.round(style.capsRatio * 100)}%, ` +
        `${style.exclaim} !/?, ${style.emoji} emoji, ${style.hashtags} hashtags, ${style.brackets} brackets`;
    }

    function renderAnnotation(record, config, handlers) {
      const wantsAnnotation = (config.display.showBadges || config.display.showScore ||
        (config.display.showReasons && record.hidden)) &&
        record.kind !== 'shelf' && record.kind !== 'shorts-shelf';
      if (!wantsAnnotation) { removeAnnotation(record.el); return; }

      const chips = chipsFor(record, config);
      const showReveal = record.hidden && config.display.mode !== 'hide';
      const actionable = !!record.videoId;
      const key = [
        chips.map((c) => c.text).join('|'),
        showReveal, actionable, record.verdict, record.policyKey,
        record.channelHandle || record.channelName
      ].join('~');
      const anno = annotationFor(record.el, handlers);
      if (anno.lastKey === key) return;
      anno.lastKey = key;

      while (anno.chips.firstChild) anno.chips.removeChild(anno.chips.firstChild);
      for (const chip of chips) {
        const node = el('span', { class: `ytsc-chip ${chip.cls || ''}`.trim(), text: chip.text });
        if (chip.title) node.setAttribute('title', chip.title);
        anno.chips.appendChild(node);
      }
      anno.pinBtn.hidden = !actionable;
      anno.pinBtn.setAttribute('aria-pressed', String(record.verdict === 'pin'));
      anno.muteBtn.hidden = !actionable;
      anno.muteBtn.setAttribute('aria-pressed', String(record.verdict === 'mute'));
      anno.snoozeBtn.hidden = !actionable;
      anno.snoozeBtn.setAttribute('aria-pressed', String(record.verdict === 'snooze'));
      const hasChannel = !!(record.channelName || record.channelHandle || record.channelId);
      anno.channelBtn.hidden = !hasChannel;
      anno.channelBtn.textContent = record.policy ? 'Channel ✓' : 'Channel…';
      anno.channelBtn.setAttribute('aria-label', `Channel policy for ${record.channelName || record.channelHandle || 'this channel'}`);
      anno.blockBtn.hidden = !hasChannel || !!record.policy;
      anno.revealBtn.hidden = !showReveal;
    }

    /* --- query highlighting ------------------------------------------------ */

    function clearHighlight(anchor) {
      const marks = qa(anchor, `mark.${MARK_CLASS}`);
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
      anchor.removeAttribute('data-ysc-hl');
      highlighted.delete(anchor);
    }

    function highlight(record, terms) {
      const anchor = firstMatch(record.el, YT.SEL.title);
      if (!anchor) return;
      const key = terms.join(',');
      if (anchor.getAttribute('data-ysc-hl') === key) return;
      clearHighlight(anchor);
      if (!terms.length) return;

      const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
      const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT, null);
      const targets = [];
      let current = walker.nextNode();
      while (current) {
        if (current.nodeValue && current.nodeValue.trim()) targets.push(current);
        current = walker.nextNode();
      }
      for (const textNode of targets) {
        const value = textNode.nodeValue;
        pattern.lastIndex = 0;
        if (!pattern.test(value)) continue;
        pattern.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(value)) !== null) {
          if (match.index > lastIndex) fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
          fragment.appendChild(el('mark', { class: MARK_CLASS, text: match[0] }));
          lastIndex = match.index + match[0].length;
          if (match[0].length === 0) pattern.lastIndex++;
        }
        if (lastIndex < value.length) fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
        if (textNode.parentNode) textNode.parentNode.replaceChild(fragment, textNode);
      }
      anchor.setAttribute('data-ysc-hl', key);
      highlighted.add(anchor);
    }

    function clearAllHighlights() {
      for (const anchor of Array.from(highlighted)) {
        try { clearHighlight(anchor); } catch (_e) { highlighted.delete(anchor); }
      }
    }

    /* --- visual state ------------------------------------------------------ */

    function applyState(record, config, handlers) {
      const node = record.el;
      const showHidden = config.display.showHidden || record.forceVisible === true;
      const mode = config.display.mode === 'hide' ? 'hidden' : config.display.mode;
      const state = record.hidden ? (showHidden ? 'reveal' : mode) : 'visible';

      if (node.getAttribute('data-ysc') !== state) node.setAttribute('data-ysc', state);
      if (config.display.compactRows) node.setAttribute('data-ysc-compact', '1');
      else node.removeAttribute('data-ysc-compact');

      const accent = config.display.channelAccents && record.policy && record.policy.color ? record.policy.color : '';
      if (accent) {
        node.style.setProperty('--ysc-accent', accent);
        node.setAttribute('data-ysc-accent', '1');
        accented.add(node);
      } else if (accented.has(node) || node.hasAttribute('data-ysc-accent')) {
        node.style.removeProperty('--ysc-accent');
        node.removeAttribute('data-ysc-accent');
        accented.delete(node);
      }

      if (state === 'hidden') node.setAttribute('aria-hidden', 'true');
      else if (node.getAttribute('aria-hidden') === 'true') node.removeAttribute('aria-hidden');

      if (state === 'hidden') removeAnnotation(node);
      else renderAnnotation(record, config, handlers);
    }

    function resetCard(node) {
      node.removeAttribute('data-ysc');
      node.removeAttribute('data-ysc-compact');
      node.removeAttribute('data-ysc-accent');
      node.style.removeProperty('--ysc-accent');
      accented.delete(node);
      if (node.getAttribute('aria-hidden') === 'true') node.removeAttribute('aria-hidden');
      removeAnnotation(node);
      const anchor = firstMatch(node, YT.SEL.title);
      if (anchor) clearHighlight(anchor);
    }

    /* --- grouping headers ---------------------------------------------------- */

    function headerFor(group) {
      let node = groupNodes.get(group.key);
      if (!node) {
        node = el('div', { class: GROUP_CLASS, role: 'heading', 'aria-level': '3' }, [
          el('span', { class: 'ytsc-group-label' }),
          el('span', { class: 'ytsc-group-count' })
        ]);
        groupNodes.set(group.key, node);
      }
      const visible = group.records.filter((r) => !r.hidden).length;
      node.firstChild.textContent = group.label;
      node.lastChild.textContent = `${visible} shown${visible !== group.records.length ? ` · ${group.records.length - visible} filtered` : ''}`;
      node.hidden = visible === 0;
      return node;
    }

    function removeGroupHeaders(keep) {
      for (const [key, node] of Array.from(groupNodes)) {
        if (keep && keep.has(key)) continue;
        if (node.parentNode) node.parentNode.removeChild(node);
        groupNodes.delete(key);
      }
    }

    /* --- ordering ------------------------------------------------------------ */

    /**
     * Move cards (and group headers) into a single container in the given
     * order. Scroll position is anchored on the first card currently visible in
     * the viewport so re-ordering never yanks the page under the user.
     */
    function applyOrder(ordering, structure) {
      const target = structure.orderTarget;
      if (!target) return false;

      const sequence = [];
      const keepGroups = new Set();
      if (ordering.groups && ordering.groups.length) {
        for (const group of ordering.groups) {
          keepGroups.add(group.key);
          sequence.push(headerFor(group));
          for (const record of group.records) sequence.push(record.el);
        }
      } else {
        for (const record of ordering.records) sequence.push(record.el);
      }
      removeGroupHeaders(keepGroups);

      /*
       * Non-card children must keep their side of the list. The continuation
       * sentinel that drives YouTube's infinite scroll lives *after* the cards
       * in grid layouts: moving it to the top makes it permanently visible,
       * which makes YouTube load continuation after continuation. Anything
       * before the first card (notices such as "showing results for…") stays
       * leading, anything after the last card stays trailing.
       */
      const children = Array.from(target.children);
      const firstCard = children.findIndex((child) => YT.isCardElement(child));
      const lastCard = (() => {
        for (let i = children.length - 1; i >= 0; i--) if (YT.isCardElement(children[i])) return i;
        return -1;
      })();
      const leading = [];
      const trailing = [];
      children.forEach((child, index) => {
        if (YT.isCardElement(child) || child.classList.contains(ANNO_CLASS) || child.classList.contains(GROUP_CLASS)) return;
        if (firstCard === -1 || index < firstCard) leading.push(child);
        else if (index > lastCard) trailing.push(child);
        else leading.push(child); // interleaved oddity: keep it above the cards
      });
      const full = leading.concat(sequence, trailing);

      let needsWork = false;
      let cursor = target.firstElementChild;
      for (const node of full) {
        if (node.parentNode !== target || node !== cursor) { needsWork = true; break; }
        cursor = cursor.nextElementSibling;
      }
      if (!needsWork) return false;

      const anchor = findScrollAnchor(full);
      const beforeTop = anchor ? anchor.getBoundingClientRect().top : 0;

      let ref = null;
      for (let i = full.length - 1; i >= 0; i--) {
        const node = full[i];
        if (node.parentNode !== target || node.nextElementSibling !== ref) target.insertBefore(node, ref);
        ref = node;
      }
      consolidated = true;

      if (anchor && anchor.isConnected) {
        const afterTop = anchor.getBoundingClientRect().top;
        const delta = afterTop - beforeTop;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
      return true;
    }

    function findScrollAnchor(nodes) {
      for (const node of nodes) {
        if (!node.getBoundingClientRect) continue;
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > 0) return node;
      }
      return null;
    }

    /** Restore cards to the container/section they were first observed in. */
    function restoreOrder(records) {
      removeGroupHeaders(null);
      if (!consolidated) return false;
      const groups = new Map();
      for (const record of records) {
        const home = homes.get(record.el);
        if (!home || !home.container || !home.container.isConnected) continue;
        if (!groups.has(home.container)) groups.set(home.container, []);
        groups.get(home.container).push({ node: record.el, index: home.index });
      }
      for (const [container, items] of groups) {
        items.sort((a, b) => a.index - b.index);
        for (const item of items) {
          if (item.node.parentNode !== container) container.appendChild(item.node);
        }
        let ref = null;
        for (let i = items.length - 1; i >= 0; i--) {
          const node = items[i].node;
          if (node.nextElementSibling !== ref) container.insertBefore(node, ref);
          ref = node;
        }
      }
      consolidated = false;
      return true;
    }

    return {
      ensureStyles,
      removeStyles,
      rememberHome,
      applyState,
      resetCard,
      renderAnnotation,
      highlight,
      clearAllHighlights,
      applyOrder,
      restoreOrder,
      removeGroupHeaders,
      explainScore,
      get consolidated() { return consolidated; },
      resetConsolidated() { consolidated = false; }
    };
  })();

  /* ==========================================================================
   * 12. User interface
   *
   * Everything the script renders lives inside closed-off shadow roots so that
   * YouTube's global CSS cannot restyle it and our CSS cannot leak into the
   * page. Three hosts are used: a masthead launcher, an inline results bar and
   * a modal settings dialog.
   * ======================================================================= */

  const UI = (() => {
    const HOST_IDS = Object.freeze({
      launcher: 'ytsc-launcher-host',
      bar: 'ytsc-bar-host',
      panel: 'ytsc-panel-host'
    });

    const SHADOW_CSS = `
      :host { all: initial; font-family: "Roboto", Arial, sans-serif; color-scheme: light dark; }
      * { box-sizing: border-box; font-family: inherit; }
      .root {
        --bg: #ffffff; --fg: #0f0f0f; --muted: #606060; --line: rgba(0,0,0,.14);
        --accent: #065fd4; --chip: rgba(0,0,0,.05); --danger: #c5221f;
        color: var(--fg); font-size: 13px; line-height: 1.45;
      }
      .root[data-theme="dark"] {
        --bg: #212121; --fg: #f1f1f1; --muted: #aaaaaa; --line: rgba(255,255,255,.18);
        --accent: #3ea6ff; --chip: rgba(255,255,255,.09); --danger: #ff7b72;
      }
      button, select, input, textarea { font: inherit; color: inherit; }
      button {
        cursor: pointer; background: var(--chip); border: 1px solid var(--line);
        border-radius: 16px; padding: 5px 12px; color: var(--fg);
      }
      button:hover { border-color: var(--accent); }
      button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible,
      [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      button[aria-pressed="true"], button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
      button[disabled] { opacity: .5; cursor: not-allowed; }
      select, input[type="text"], input[type="number"], input[type="search"], textarea {
        background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; width: 100%;
      }
      textarea { min-height: 92px; resize: vertical; font-size: 12px; line-height: 1.5; }
      .muted { color: var(--muted); }
      .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .grow { flex: 1 1 auto; min-width: 0; }

      /* Launcher ---------------------------------------------------------- */
      .launcher {
        display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px;
        border-radius: 18px; background: var(--chip); border: 1px solid var(--line);
        font-size: 13px; font-weight: 500; white-space: nowrap;
      }
      .launcher .count { font-variant-numeric: tabular-nums; }
      .launcher[data-active="true"] { border-color: var(--accent); color: var(--accent); }
      .floating {
        position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
      }

      /* Bar --------------------------------------------------------------- */
      .bar {
        background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
        padding: 8px 10px; margin: 0 0 12px 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      }
      .bar .stat { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .bar .sep { width: 1px; height: 20px; background: var(--line); }
      .bar select { width: auto; min-width: 150px; }
      .bar input[type="search"] { min-width: 150px; }
      .bar .notice { flex-basis: 100%; color: var(--muted); }
      .bar .notice[data-tone="warn"] { color: var(--danger); }
      .progress { flex-basis: 100%; height: 3px; background: var(--chip); border-radius: 2px; overflow: hidden; }
      .progress > i { display: block; height: 100%; background: var(--accent); transition: width .2s linear; }

      /* Panel ------------------------------------------------------------- */
      .backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483001;
        display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px;
        overflow: auto;
      }
      .dialog {
        background: var(--bg); border: 1px solid var(--line); border-radius: 14px;
        width: min(860px, 100%); max-height: calc(100vh - 80px); display: flex; flex-direction: column;
        box-shadow: 0 12px 40px rgba(0,0,0,.45); overflow: hidden;
      }
      .dialog header {
        display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line);
      }
      .dialog h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1 1 auto; }
      .tabs { display: flex; gap: 4px; padding: 8px 12px 0; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
      .tabs button { border-radius: 8px 8px 0 0; border-bottom-color: transparent; padding: 6px 12px; }
      .tabs button[aria-selected="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
      .panes { overflow: auto; padding: 14px 16px; }
      .pane[hidden] { display: none; }
      fieldset { border: 1px solid var(--line); border-radius: 10px; margin: 0 0 14px; padding: 10px 12px; }
      legend { padding: 0 6px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
      .field { display: flex; gap: 10px; align-items: flex-start; margin: 8px 0; }
      .field label { flex: 1 1 auto; }
      .field .control { flex: 0 0 210px; max-width: 210px; }
      .field.stack { flex-direction: column; align-items: stretch; }
      .field.stack .control { flex: 1 1 auto; max-width: none; }
      .hint { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
      .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 4px 14px; }
      .check { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
      .check input { width: auto; }
      .footer { display: flex; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--line); flex-wrap: wrap; }
      .error { color: var(--danger); font-size: 12px; }
      .policy-list { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; max-height: 320px; overflow: auto; }
      .policy-row {
        display: flex; align-items: center; gap: 8px; padding: 5px 6px;
        border: 1px solid var(--line); border-radius: 8px;
      }
      .policy-row strong { display: block; font-weight: 600; }
      .policy-row .hint { display: block; }
      .policy-row button { padding: 3px 9px; }
      .dot {
        width: 12px; height: 12px; border-radius: 50%; flex: 0 0 12px;
        border: 1px solid var(--line);
      }
      input[type="range"] { width: 100%; accent-color: var(--accent); }
      table.diag { width: 100%; border-collapse: collapse; font-size: 12px; }
      table.diag td { padding: 3px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
      table.diag td:first-child { color: var(--muted); white-space: nowrap; width: 40%; }
      .log { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; white-space: pre-wrap; max-height: 180px; overflow: auto; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
    `;

    let handlers = null;
    let disposer = null;
    const bindings = [];
    let launcher = null;      // { host, shadow, button, count }
    let bar = null;           // { host, shadow, root, ... }
    let panel = null;         // { host, shadow, ... }
    let panelOpen = false;
    let lastFocused = null;

    const themeOf = () => {
      const setting = Config.value.display.theme;
      if (setting !== 'auto') return setting;
      const dark = document.documentElement && (
        document.documentElement.hasAttribute('dark') ||
        document.documentElement.getAttribute('dark') === 'true'
      );
      if (dark) return 'dark';
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (_e) { return 'light'; }
    };

    function makeHost(id) {
      const host = el('div', { id, class: 'ytsc-host' });
      host.style.setProperty('all', 'initial');
      host.style.setProperty('display', 'block');
      const shadow = host.attachShadow({ mode: 'open' });
      if (CAPS.constructableStylesheets) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(SHADOW_CSS);
          shadow.adoptedStyleSheets = [sheet];
        } catch (_e) {
          const style = el('style');
          style.textContent = SHADOW_CSS;
          shadow.appendChild(style);
        }
      } else {
        const style = el('style');
        style.textContent = SHADOW_CSS;
        shadow.appendChild(style);
      }
      const root = el('div', { class: 'root', 'data-theme': themeOf() });
      shadow.appendChild(root);
      return { host, shadow, root };
    }

    function applyTheme() {
      const theme = themeOf();
      for (const part of [launcher, bar, panel]) {
        if (part && part.root) part.root.setAttribute('data-theme', theme);
      }
    }

    /* --- form field helpers ------------------------------------------------ */

    function registerBinding(path, apply) {
      bindings.push({ path, apply });
    }

    function fieldRow(labelText, control, hint, stack) {
      const label = el('label', { text: labelText });
      if (hint) label.appendChild(el('span', { class: 'hint', text: hint }));
      const wrap = el('div', { class: 'control' }, control);
      return el('div', { class: `field${stack ? ' stack' : ''}` }, [label, wrap]);
    }

    let idCounter = 0;
    const nextId = () => `ysc-f${++idCounter}`;

    /**
     * True when the node currently has focus. `document.activeElement` only
     * ever reports the shadow *host*, so a naive check always looked "not
     * focused" and let background updates overwrite what the user was typing.
     */
    function isFocused(node) {
      if (!node) return false;
      try {
        const root = node.getRootNode ? node.getRootNode() : document;
        if (root && root.activeElement === node) return true;
      } catch (_e) { /* detached node */ }
      return document.activeElement === node;
    }

    function checkbox(path, labelText, hint) {
      const id = nextId();
      const input = el('input', { type: 'checkbox', id });
      input.checked = !!Config.getPath(path);
      input.addEventListener('change', () => Config.setPath(path, input.checked, 'ui'));
      registerBinding(path, () => { if (!isFocused(input)) input.checked = !!Config.getPath(path); });
      const label = el('label', { for: id, text: labelText });
      if (hint) label.appendChild(el('span', { class: 'hint', text: hint }));
      return el('div', { class: 'check' }, [input, label]);
    }

    function selectField(path, labelText, options, hint) {
      const select = el('select');
      for (const option of options) {
        select.appendChild(el('option', { value: option.id, text: option.label }));
      }
      select.value = String(Config.getPath(path));
      select.addEventListener('change', () => Config.setPath(path, select.value, 'ui'));
      registerBinding(path, () => { if (!isFocused(select)) select.value = String(Config.getPath(path)); });
      return fieldRow(labelText, select, hint);
    }

    /**
     * Text input backed by a parser/serialiser pair. Invalid input is reported
     * inline and never written to configuration.
     */
    function parsedField(path, labelText, parse, serialise, hint, placeholder) {
      const input = el('input', { type: 'text', placeholder: placeholder || '' });
      const error = el('span', { class: 'error', hidden: true });
      const sync = () => { if (!isFocused(input)) input.value = serialise(Config.getPath(path)); };
      sync();
      const commit = () => {
        const raw = input.value.trim();
        if (!raw) { error.hidden = true; Config.setPath(path, null, 'ui'); return; }
        const parsed = parse(raw);
        if (parsed === null || parsed === undefined || Number.isNaN(parsed)) {
          error.hidden = false;
          error.textContent = 'Not a valid value — previous setting kept.';
          return;
        }
        error.hidden = true;
        Config.setPath(path, parsed, 'ui');
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      registerBinding(path, sync);
      return fieldRow(labelText, [input, error], hint);
    }

    function listField(path, labelText, hint) {
      const textarea = el('textarea', { spellcheck: false });
      const status = el('span', { class: 'hint' });
      const sync = () => {
        if (isFocused(textarea)) return;
        const list = Config.getPath(path) || [];
        textarea.value = list.join('\n');
        status.textContent = `${list.length} entr${list.length === 1 ? 'y' : 'ies'}`;
      };
      sync();
      const commit = () => {
        const lines = textarea.value.split('\n').map((line) => line.trim()).filter(Boolean);
        const invalid = [];
        for (const line of lines) {
          const compiled = compilePattern(line);
          if (compiled && compiled.error) invalid.push(`${line}: ${compiled.error}`);
        }
        Config.setPath(path, lines, 'ui');
        status.textContent = invalid.length
          ? `${lines.length} entries — ${invalid.length} invalid: ${invalid[0]}`
          : `${lines.length} entr${lines.length === 1 ? 'y' : 'ies'}`;
      };
      textarea.addEventListener('change', commit);
      textarea.addEventListener('blur', commit);
      registerBinding(path, sync);
      return fieldRow(labelText, [textarea, status], hint, true);
    }

    function syncFields() {
      for (const binding of bindings) {
        try { binding.apply(); } catch (err) { Diag.error(`failed to sync field ${binding.path}`, err); }
      }
    }

    /* --- launcher ---------------------------------------------------------- */

    function buildLauncher() {
      const parts = makeHost(HOST_IDS.launcher);
      const count = el('span', { class: 'count', text: '' });
      const button = el('button', {
        type: 'button',
        class: 'launcher',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        title: `${APP.name} — open control panel`
      }, [
        svg('svg', { width: '16', height: '16', viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'currentColor' }, [
          svg('path', { d: 'M3 5h18v2l-7 7v5l-4 2v-7L3 7V5z' })
        ]),
        el('span', { text: 'Filters' }),
        count
      ]);
      button.addEventListener('click', () => togglePanel());
      parts.root.appendChild(button);
      return Object.assign(parts, { button, count });
    }

    function placeLauncher() {
      if (!launcher) launcher = buildLauncher();
      const masthead = q(document, YT.SEL.masthead);
      const end = masthead ? q(masthead, YT.SEL.mastheadEnd) : null;
      const target = end || masthead;
      if (target) {
        launcher.button.classList.remove('floating');
        if (launcher.host.parentNode !== target || target.firstChild !== launcher.host) {
          target.insertBefore(launcher.host, target.firstChild);
        }
      } else if (document.body) {
        launcher.button.classList.add('floating');
        if (launcher.host.parentNode !== document.body) document.body.appendChild(launcher.host);
      }
    }

    /* --- results bar -------------------------------------------------------- */

    function buildBar() {
      const parts = makeHost(HOST_IDS.bar);
      const root = parts.root;

      const stat = el('span', { class: 'stat', text: '' });
      const sortSelect = el('select', { 'aria-label': 'Sort results' });
      for (const mode of SORT_MODES) sortSelect.appendChild(el('option', { value: mode.id, text: mode.label }));
      sortSelect.value = Config.value.sort.mode;
      sortSelect.addEventListener('change', () => Config.setPath('sort.mode', sortSelect.value, 'ui'));
      registerBinding('sort.mode', () => {
        if (!isFocused(sortSelect)) sortSelect.value = Config.value.sort.mode;
      });

      const groupSelect = el('select', { 'aria-label': 'Group results' });
      for (const mode of GROUP_MODES) groupSelect.appendChild(el('option', { value: mode.id, text: mode.label }));
      groupSelect.value = Config.value.ranking.groupBy;
      groupSelect.addEventListener('change', () => Config.setPath('ranking.groupBy', groupSelect.value, 'ui'));
      registerBinding('ranking.groupBy', () => {
        if (!isFocused(groupSelect)) groupSelect.value = Config.value.ranking.groupBy;
      });

      const search = el('input', {
        type: 'search',
        placeholder: 'Search within results…',
        'aria-label': 'Filter the loaded results by text. Prefix with ! to exclude.'
      });
      let searchTimer = 0;
      search.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          searchTimer = 0;
          handlers.onInResultsQuery(search.value);
        }, 180);
      });
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && search.value) {
          event.stopPropagation();
          search.value = '';
          handlers.onInResultsQuery('');
        }
      });

      const hiddenToggle = el('button', {
        type: 'button',
        'aria-pressed': String(Config.value.display.showHidden),
        text: 'Show hidden'
      });
      hiddenToggle.addEventListener('click', () => Config.setPath('display.showHidden', !Config.value.display.showHidden, 'ui'));
      registerBinding('display.showHidden', () => {
        hiddenToggle.setAttribute('aria-pressed', String(Config.value.display.showHidden));
      });

      const channelBtn = el('button', { type: 'button', text: 'This channel…', hidden: true });
      channelBtn.addEventListener('click', () => handlers.onEditPageChannel());

      const loadMore = el('button', { type: 'button', text: 'Load more' });
      loadMore.addEventListener('click', () => handlers.onDeepLoad());

      const settingsBtn = el('button', { type: 'button', text: 'Control panel…', 'aria-haspopup': 'dialog' });
      settingsBtn.addEventListener('click', () => togglePanel());

      const notice = el('div', { class: 'notice', hidden: true, role: 'status', 'aria-live': 'polite' });
      const progressFill = el('i', { style: { width: '0%' } });
      const progress = el('div', { class: 'progress', hidden: true }, progressFill);

      const container = el('div', { class: 'bar', role: 'region', 'aria-label': `${APP.name} controls` }, [
        stat,
        el('span', { class: 'sep' }),
        sortSelect,
        groupSelect,
        search,
        hiddenToggle,
        channelBtn,
        loadMore,
        settingsBtn,
        notice,
        progress
      ]);
      root.appendChild(container);
      return Object.assign(parts, {
        stat, sortSelect, groupSelect, search, hiddenToggle, channelBtn, loadMore, notice, progress, progressFill, container
      });
    }

    function placeBar(structure) {
      if (!Config.value.display.showBar) {
        if (bar && bar.host.parentNode) bar.host.parentNode.removeChild(bar.host);
        return;
      }
      if (!bar) bar = buildBar();
      const anchor = q(document, 'ytd-search [id="primary"]') ||
        q(document, 'ytd-browse ytd-two-column-browse-results-renderer') ||
        (structure && structure.sectionListContents ? structure.sectionListContents.parentNode : null) ||
        q(document, YT.SEL.searchRoot);
      if (!anchor) return;
      if (bar.host.parentNode !== anchor || anchor.firstChild !== bar.host) {
        anchor.insertBefore(bar.host, anchor.firstChild);
      }
    }

    function updateBar(stats, state) {
      if (launcher) {
        const active = stats && stats.hidden > 0;
        launcher.button.setAttribute('data-active', String(!!active));
        launcher.count.textContent = stats && stats.hidden ? `· ${stats.hidden}` : '';
      }
      if (!bar) return;
      if (stats) {
        const pinned = stats.pinned ? ` · ${stats.pinned} pinned` : '';
        bar.stat.textContent = `${stats.visible} shown · ${stats.hidden} filtered${pinned} · ${stats.total} loaded`;
      }
      const messages = [];
      let tone = 'info';
      if (state && state.pageType && state.pageType !== PAGE.search) {
        messages.push(state.pageType === PAGE.channelGrid ? 'Channel page' : 'Search within channel');
      }
      if (state && state.contexts && state.contexts.length) {
        messages.push(`Context: ${state.contexts.join(', ')}`);
      }
      if (state && state.channelPolicy) {
        messages.push(`Channel policy: ${state.channelPolicy}`);
      }
      if (stats && stats.total > 0 && stats.visible === 0) {
        messages.push('Every loaded result is filtered out. Use “Show hidden” or relax the rules.');
        tone = 'warn';
      }
      if (state && state.deepLoad && state.deepLoad.running) {
        messages.push(`Loading more results… (${state.deepLoad.done}/${state.deepLoad.total})`);
      }
      if (state && state.precisionPending) {
        messages.push(`Fetching exact metadata for ${state.precisionPending} video(s)…`);
      }
      if (state && state.orderingBlocked) {
        messages.push('This page uses a fixed row layout, so results are filtered but not re-ordered.');
        tone = 'warn';
      }
      if (state && state.precisionNotice) {
        messages.push(state.precisionNotice);
        tone = 'warn';
      }
      if (state && state.ruleErrors && state.ruleErrors.length) {
        messages.push(`Rule problem: ${state.ruleErrors[0].pattern} — ${state.ruleErrors[0].error}`);
        tone = 'warn';
      }
      bar.notice.hidden = messages.length === 0;
      bar.notice.setAttribute('data-tone', tone);
      bar.notice.textContent = messages.join('  •  ');
      bar.channelBtn.hidden = !(state && state.pageChannel);
      if (state && state.pageChannel) {
        bar.channelBtn.textContent = state.channelPolicy ? 'Channel policy ✓' : 'Configure this channel…';
      }

      const running = !!(state && state.deepLoad && state.deepLoad.running);
      bar.progress.hidden = !running;
      if (running) {
        const pct = state.deepLoad.total ? Math.round((state.deepLoad.done / state.deepLoad.total) * 100) : 0;
        bar.progressFill.style.width = `${clamp(pct, 0, 100)}%`;
      }
      bar.loadMore.textContent = running ? 'Stop loading' : 'Load more';
      bar.loadMore.setAttribute('aria-pressed', String(running));
    }

    /* --- settings dialog ---------------------------------------------------- */

    const TABS = [
      { id: 'results', label: 'Results' },
      { id: 'ranking', label: 'Ranking' },
      { id: 'text', label: 'Text' },
      { id: 'content', label: 'Content' },
      { id: 'channels', label: 'Channels' },
      { id: 'contexts', label: 'Contexts' },
      { id: 'youtube', label: 'YouTube filters' },
      { id: 'presets', label: 'Presets' },
      { id: 'settings', label: 'Settings' },
      { id: 'about', label: 'Diagnostics' }
    ];

    function buildResultsPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-results', 'aria-labelledby': 'ysc-tab-results' });
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Result types' }),
        el('div', { class: 'checks' }, [
          checkbox('filters.hideShorts', 'Hide Shorts'),
          checkbox('filters.hideShortsShelves', 'Hide Shorts shelves'),
          checkbox('filters.hideShelves', 'Hide suggestion shelves', '“People also watched”, “For you”…'),
          checkbox('filters.hidePlaylists', 'Hide playlists'),
          checkbox('filters.hideMixes', 'Hide mixes / radios'),
          checkbox('filters.hideChannels', 'Hide channel results'),
          checkbox('filters.hideMovies', 'Hide movies'),
          checkbox('filters.hidePromoted', 'Hide promoted results')
        ])
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Video state' }),
        el('div', { class: 'checks' }, [
          checkbox('filters.hideLive', 'Hide live streams'),
          checkbox('filters.hideUpcoming', 'Hide upcoming / premieres'),
          checkbox('filters.hideMembersOnly', 'Hide members-only'),
          checkbox('filters.verifiedOnly', 'Only verified channels', 'Ignored when no badge is detectable'),
          checkbox('filters.hideWatched', 'Hide watched videos'),
          checkbox('filters.hideDuplicates', 'Hide duplicate results')
        ]),
        parsedField('filters.watchedThreshold', 'Watched threshold (%)',
          (raw) => clamp(parseInt(raw, 10), 1, 100),
          (value) => (isFiniteNumber(value) ? String(value) : '80'),
          'A video counts as watched at or above this progress.')
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Presentation' }),
        selectField('display.mode', 'Filtered results are…', DISPLAY_MODES),
        el('div', { class: 'checks' }, [
          checkbox('display.showBar', 'Show the toolbar above results'),
          checkbox('display.showBadges', 'Show metadata badges'),
          checkbox('display.showReasons', 'Show why a result was filtered'),
          checkbox('display.showScope', 'Show which scope decided'),
          checkbox('display.showScore', 'Show ranking score'),
          checkbox('display.channelAccents', 'Colour-code configured channels'),
          checkbox('display.highlightQuery', 'Highlight query words in titles'),
          checkbox('display.compactRows', 'Compact thumbnails')
        ]),
        selectField('display.theme', 'Panel theme', [
          { id: 'auto', label: 'Match YouTube' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }
        ])
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Channel pages' }),
        el('p', { class: 'hint', text: 'Channel policies always apply on /@channel pages. These switches decide how much of the global search configuration comes along.' }),
        el('div', { class: 'checks' }, [
          checkbox('channelPages.enabled', 'Operate on channel pages'),
          checkbox('channelPages.applyGlobalFilters', 'Apply global filters there too'),
          checkbox('channelPages.applySort', 'Apply sorting/grouping there too')
        ])
      ]));
      return pane;
    }

    function weightField(key, label, hint) {
      const path = `ranking.weights.${key}`;
      const input = el('input', {
        type: 'range', min: '0', max: '5', step: '0.1',
        'aria-label': `${label} weight`
      });
      const value = el('span', { class: 'hint' });
      const sync = () => {
        const current = Config.getPath(path);
        if (!isFocused(input)) input.value = String(current);
        value.textContent = `×${Number(current).toFixed(1)}`;
      };
      input.addEventListener('input', () => {
        value.textContent = `×${Number(input.value).toFixed(1)}`;
      });
      input.addEventListener('change', () => Config.setPath(path, Number(input.value), 'ui'));
      registerBinding(path, sync);
      sync();
      return fieldRow(label, el('div', { class: 'row' }, [el('div', { class: 'grow' }, input), value]), hint);
    }

    function buildRankingPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-ranking', 'aria-labelledby': 'ysc-tab-ranking', hidden: true });
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Ordering' }),
        selectField('sort.mode', 'Sort loaded results by', SORT_MODES,
          'Sorting is applied client-side to the results already loaded on the page.'),
        selectField('ranking.groupBy', 'Group results', GROUP_MODES,
          'Groups stay contiguous and are labelled with a header row.'),
        el('div', { class: 'checks' }, [
          checkbox('sort.unknownLast', 'Put results with unknown values last'),
          checkbox('ranking.pinnedFirst', 'Pinned videos always first'),
          checkbox('ranking.priorityFirst', 'Priority channels before everything else')
        ]),
        el('p', {
          class: 'hint',
          text: 'YouTube removed server-side “sort by upload date” from search in January 2026 and now ignores the corresponding URL parameter, so chronological order is produced here from the results the page has loaded. Load more results first for a wider window.'
        })
      ]));

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Weighted score' }),
        el('p', {
          class: 'hint',
          text: 'Used by the “Weighted score” sort mode, by priority tiers and by the score floor. Each signal is normalised to 0–100; the score is the weighted average of the signals that are known for that video, plus the channel boost. Signals that cannot be computed are skipped rather than guessed.'
        }),
        weightField('recency', 'Recency', 'Newer uploads score higher.'),
        weightField('views', 'View count', 'Log-scaled 100 → 10M.'),
        weightField('velocity', 'Views per day', 'Momentum since upload.'),
        weightField('engagement', 'Like ratio', 'Needs precision mode.'),
        weightField('queryMatch', 'Query match', 'Share of your search words found.'),
        weightField('durationFit', 'Duration fit', 'Closeness to your preferred length.'),
        weightField('titleCalm', 'Title restraint', 'Inverse of the clickbait-style score.'),
        weightField('channelPriority', 'Channel priority', 'Boost from the channel policy.'),
        weightField('outperformance', 'Channel outperformance', 'Views vs. that channel’s median here.'),
        parsedField('ranking.halfLifeDays', 'Recency half-life (days)',
          (raw) => { const n = Number(raw); return Number.isFinite(n) && n > 0 ? n : null; },
          (v) => String(v || 180),
          'A video this old scores half of a brand-new one on recency.'),
        parsedField('ranking.targetMinSec', 'Preferred length — from', parseDurationInput,
          (v) => (isFiniteNumber(v) ? formatDuration(v) : '5:00')),
        parsedField('ranking.targetMaxSec', 'Preferred length — to', parseDurationInput,
          (v) => (isFiniteNumber(v) ? formatDuration(v) : '40:00')),
        parsedField('ranking.scoreFloor', 'Hide below score',
          (raw) => { const n = Number(raw); return Number.isFinite(n) ? clamp(n, 0, 100) : null; },
          (v) => (isFiniteNumber(v) ? String(v) : ''),
          'Leave empty to keep every result regardless of score.'),
        parsedField('ranking.tierHigh', 'Tier threshold — top',
          (raw) => { const n = Number(raw); return Number.isFinite(n) ? clamp(n, 0, 100) : null; },
          (v) => String(v)),
        parsedField('ranking.tierLow', 'Tier threshold — standard',
          (raw) => { const n = Number(raw); return Number.isFinite(n) ? clamp(n, 0, 100) : null; },
          (v) => String(v))
      ]));

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Numeric thresholds' }),
        parsedField('filters.viewsMin', 'Minimum views', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : ''), 'Accepts 1000, 1k, 2.5M', 'e.g. 5k'),
        parsedField('filters.viewsMax', 'Maximum views', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : ''), '', 'e.g. 500k'),
        parsedField('filters.likesMin', 'Minimum likes', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : ''), 'Precision mode only.', 'e.g. 1k'),
        parsedField('filters.likeRatioMin', 'Minimum like ratio (%)',
          (raw) => { const n = Number(String(raw).replace('%', '')); return Number.isFinite(n) ? clamp(n / 100, 0, 1) : null; },
          (v) => (isFiniteNumber(v) ? (v * 100).toFixed(1) : ''),
          'Likes ÷ views, precision mode only.', 'e.g. 3'),
        parsedField('filters.outperformMin', 'Minimum × channel median',
          (raw) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : null; },
          (v) => (isFiniteNumber(v) ? String(v) : ''),
          'Compares a video with the same channel’s median views in the loaded set.', 'e.g. 1.5'),
        parsedField('filters.durationMinSec', 'Minimum duration', parseDurationInput, (v) => (isFiniteNumber(v) ? formatDuration(v) : ''), 'Accepts 90, 90s, 5m, 1h30m, 1:30', 'e.g. 4m'),
        parsedField('filters.durationMaxSec', 'Maximum duration', parseDurationInput, (v) => (isFiniteNumber(v) ? formatDuration(v) : ''), '', 'e.g. 2h'),
        parsedField('filters.ageMaxDays', 'Maximum age (days)', (raw) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : null; }, (v) => (isFiniteNumber(v) ? String(v) : ''), 'Relative labels are approximate; enable precision mode for exact dates.', 'e.g. 30'),
        parsedField('filters.ageMinDays', 'Minimum age (days)', (raw) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : null; }, (v) => (isFiniteNumber(v) ? String(v) : ''), '', 'e.g. 7'),
        parsedField('filters.maxPerChannel', 'Max results per channel', (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) && n > 0 ? n : null; }, (v) => (isFiniteNumber(v) ? String(v) : ''), 'Keeps the best-ranked results and hides the rest.', 'e.g. 2')
      ]));
      return pane;
    }

    function buildTextPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-text', 'aria-labelledby': 'ysc-tab-text', hidden: true });
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Keyword rules' }),
        el('p', {
          class: 'hint',
          text: 'One rule per line. Plain text matches anywhere (accent/case-insensitive), "quoted text" matches whole words, /regex/i matches a regular expression.'
        }),
        listField('filters.titleExclude', 'Hide when the title matches'),
        listField('filters.titleInclude', 'Keep only when the title matches'),
        selectField('filters.titleIncludeMode', 'Keep-only rules require', [
          { id: 'any', label: 'Any rule to match' }, { id: 'all', label: 'All rules to match' }
        ]),
        el('div', { class: 'checks' }, [
          checkbox('filters.matchDescription', 'Also match the description snippet')
        ])
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Query awareness' }),
        selectField('filters.requireQueryTerms', 'Require search words in the result', [
          { id: 'off', label: 'Off' },
          { id: 'any', label: 'At least one word must appear' },
          { id: 'all', label: 'All words must appear' }
        ], 'Compares against title, channel and description snippet.')
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Title structure (heuristic)' }),
        el('p', {
          class: 'hint',
          text: 'A structural “shouting” score from 0 to 100 built only from countable properties of the title: share of upper-case letters, exclamation/question marks, repeated punctuation, emoji, brackets and hashtags. It says nothing about the video itself and is shown as a heuristic.'
        }),
        el('div', { class: 'checks' }, [checkbox('style.enabled', 'Enable title-structure rules')]),
        parsedField('style.maxScore', 'Act above score',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 0, 100) : null; },
          (v) => String(v)),
        selectField('style.action', 'When a title exceeds it', [
          { id: 'demote', label: 'Demote in the ranking' }, { id: 'hide', label: 'Hide the result' }
        ]),
        parsedField('style.demotePoints', 'Demotion (score points)',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 0, 100) : null; },
          (v) => String(v)),
        parsedField('style.minTitleLength', 'Minimum title length',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 0, 300) : null; },
          (v) => (isFiniteNumber(v) ? String(v) : '')),
        parsedField('style.maxTitleLength', 'Maximum title length',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 0, 300) : null; },
          (v) => (isFiniteNumber(v) ? String(v) : ''))
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Writing system' }),
        el('p', {
          class: 'hint',
          text: 'Classifies a title by the Unicode script most of its letters belong to. This is a script, not a language: “Latin” covers English, Spanish, Vietnamese and more. Titles without letters are never filtered.'
        }),
        selectField('scripts.mode', 'Script rule', [
          { id: 'off', label: 'Off' },
          { id: 'allow', label: 'Show only the selected scripts' },
          { id: 'deny', label: 'Hide the selected scripts' }
        ]),
        el('div', { class: 'field stack' }, [
          el('label', { text: 'Scripts' }),
          el('div', { class: 'control' }, scriptChecklist())
        ])
      ]));
      return pane;
    }

    function scriptChecklist() {
      const wrap = el('div', { class: 'checks' });
      const sync = () => {
        const selected = Config.value.scripts.list;
        for (const input of qa(wrap, 'input[type="checkbox"]')) {
          if (!isFocused(input)) input.checked = selected.indexOf(input.value) !== -1;
        }
      };
      for (const script of TextSignals.SCRIPTS) {
        const id = nextId();
        const input = el('input', { type: 'checkbox', id, value: script.id });
        input.addEventListener('change', () => {
          const list = Config.value.scripts.list.slice();
          const index = list.indexOf(script.id);
          if (input.checked && index === -1) list.push(script.id);
          if (!input.checked && index !== -1) list.splice(index, 1);
          Config.setPath('scripts.list', list, 'ui');
        });
        wrap.appendChild(el('div', { class: 'check' }, [input, el('label', { for: id, text: script.label })]));
      }
      registerBinding('scripts.list', sync);
      sync();
      return wrap;
    }

    function buildContentPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-content', 'aria-labelledby': 'ysc-tab-content', hidden: true });
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Tags & description (precision mode)' }),
        el('p', {
          class: 'hint',
          text: 'Uses the channel-supplied tags and the full description that YouTube’s player endpoint returns. These rules only apply to videos whose metadata has been fetched; everything else is left untouched. Enable precision mode in Settings.'
        }),
        listField('content.tagInclude', 'Keep only videos tagged'),
        selectField('content.tagIncludeMode', 'Tag keep-only rules require', [
          { id: 'any', label: 'Any tag to match' }, { id: 'all', label: 'All tags to match' }
        ]),
        listField('content.tagExclude', 'Hide videos tagged'),
        listField('content.descriptionInclude', 'Keep only when the description matches'),
        listField('content.descriptionExclude', 'Hide when the description matches')
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Category & availability (precision mode)' }),
        listField('content.categoryAllow', 'Keep only these categories', 'Exact category names, e.g. Education, Music, Gaming.'),
        listField('content.categoryDeny', 'Hide these categories'),
        el('div', { class: 'checks' }, [
          checkbox('content.familySafeOnly', 'Only family-safe videos'),
          checkbox('content.regionFilter', 'Hide videos unavailable in my region')
        ]),
        parsedField('content.regionCode', 'Region code',
          (raw) => (/^[A-Za-z]{2}$/.test(String(raw).trim()) ? String(raw).trim().toUpperCase() : null),
          (v) => String(v || ''),
          'Two-letter country code. Leave empty to use the browser locale.', 'e.g. IN')
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Near-duplicates & series' }),
        el('p', {
          class: 'hint',
          text: 'Similarity is the Jaccard overlap of the meaningful words in two titles; a series is detected from markers such as “Part 3”, “Ep. 12” or “S02E03”. Clusters are formed from the results currently loaded.'
        }),
        el('div', { class: 'checks' }, [
          checkbox('dedupe.similarEnabled', 'Cluster near-duplicate titles'),
          checkbox('dedupe.seriesEnabled', 'Cluster series episodes')
        ]),
        parsedField('dedupe.similarThreshold', 'Similarity threshold (%)',
          (raw) => { const n = Number(String(raw).replace('%', '')); return Number.isFinite(n) ? clamp(n / 100, 0.4, 1) : null; },
          (v) => String(Math.round(v * 100))),
        parsedField('dedupe.similarKeep', 'Keep per near-duplicate cluster',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 1, 10) : null; },
          (v) => String(v)),
        selectField('dedupe.similarAction', 'Extra near-duplicates are', [
          { id: 'hide', label: 'Hidden' }, { id: 'group', label: 'Kept (grouped only)' }
        ]),
        parsedField('dedupe.seriesKeep', 'Keep per series',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 1, 20) : null; },
          (v) => String(v)),
        selectField('dedupe.seriesPrefer', 'Which episodes to keep', [
          { id: 'first', label: 'The ones YouTube ranked first' },
          { id: 'newest', label: 'Newest' },
          { id: 'lowest-episode', label: 'Lowest episode number' },
          { id: 'highest-episode', label: 'Highest episode number' }
        ])
      ]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Personal memory' }),
        el('p', {
          class: 'hint',
          text: 'Remembers which videos were actually shown to you, so repeated searches can skip them. Videos seen in the current browsing session are never suppressed.'
        }),
        el('div', { class: 'checks' }, [
          checkbox('memory.trackSeen', 'Remember results I have already been shown'),
          checkbox('memory.hideSeen', 'Hide results seen in earlier searches'),
          checkbox('memory.seenScopeQuery', 'Only when the earlier search used a different query')
        ]),
        parsedField('memory.seenTtlDays', 'Remember for (days)',
          (raw) => { const n = parseInt(raw, 10); return Number.isFinite(n) ? clamp(n, 1, LIMITS.memoryTtlDays) : null; },
          (v) => String(v))
      ]));
      return pane;
    }

    /* --- channel policy manager --------------------------------------------- */

    function buildChannelsPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-channels', 'aria-labelledby': 'ysc-tab-channels', hidden: true });

      const search = el('input', { type: 'search', placeholder: 'Filter configured channels…', 'aria-label': 'Filter configured channels' });
      const countLabel = el('span', { class: 'hint' });
      const list = el('div', { class: 'policy-list', role: 'list' });
      const editorHost = el('div', {});
      const message = el('span', { class: 'hint' });
      let draft = null;

      const addBtn = el('button', { type: 'button', class: 'primary', text: 'Add channel policy' });
      addBtn.addEventListener('click', () => {
        const page = handlers.getPageChannel();
        openEditor(page ? Object.assign({}, page) : {});
      });

      const exportBtn = el('button', { type: 'button', text: 'Export channels' });
      const importArea = el('textarea', { spellcheck: false, 'aria-label': 'Channel policy JSON for import or export' });
      importArea.hidden = true;
      const importBtn = el('button', { type: 'button', text: 'Import channels' });
      const replaceCheckId = nextId();
      const replaceCheck = el('input', { type: 'checkbox', id: replaceCheckId });
      const clearBtn = el('button', { type: 'button', text: 'Remove all' });
      let clearArmed = false;

      exportBtn.addEventListener('click', () => {
        importArea.hidden = false;
        importArea.value = JSON.stringify({ app: APP.id, kind: 'channels', channels: Channels.exportList() }, null, 2);
        importArea.focus();
        importArea.select();
        message.textContent = `${Channels.size} channel policies exported below.`;
      });
      importBtn.addEventListener('click', () => {
        importArea.hidden = false;
        if (!importArea.value.trim()) { message.textContent = 'Paste exported channel JSON into the box first.'; return; }
        let parsed;
        try { parsed = JSON.parse(importArea.value); } catch (err) { message.textContent = `Not valid JSON: ${err.message}`; return; }
        const listing = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.channels) ? parsed.channels : null);
        if (!listing) { message.textContent = 'Expected an array of channel policies, or an export file.'; return; }
        const result = Channels.importList(listing, replaceCheck.checked);
        message.textContent = result.ok
          ? `Imported ${result.imported} policies${result.skipped ? `, skipped ${result.skipped}` : ''}.`
          : result.error;
        refresh();
      });
      clearBtn.addEventListener('click', () => {
        if (!clearArmed) {
          clearArmed = true;
          clearBtn.textContent = 'Click again to remove every policy';
          setTimeout(() => { clearArmed = false; clearBtn.textContent = 'Remove all'; }, 4000);
          return;
        }
        Channels.clear('ui');
        clearArmed = false;
        clearBtn.textContent = 'Remove all';
        message.textContent = 'All channel policies removed.';
        refresh();
      });

      search.addEventListener('input', () => refresh());

      function modeBadge(policy) {
        const mode = CHANNEL_MODES.find((m) => m.id === policy.mode) || CHANNEL_MODES[3];
        return mode.label.split(' —')[0];
      }

      function stateOf(policy) {
        if (!policy.enabled) return 'disabled';
        if (isFiniteNumber(policy.snoozeUntil) && policy.snoozeUntil > Date.now()) {
          return `snoozed until ${formatDate(policy.snoozeUntil)}`;
        }
        return 'active';
      }

      function refresh() {
        while (list.firstChild) list.removeChild(list.firstChild);
        const needle = fold(search.value);
        const all = Channels.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const filtered = needle
          ? all.filter((p) => fold(`${p.name} ${p.handle} ${p.channelId} ${p.label} ${p.note}`).indexOf(needle) !== -1)
          : all;
        countLabel.textContent = `${filtered.length} of ${all.length} configured channel${all.length === 1 ? '' : 's'}`;

        const shown = filtered.slice(0, 200);
        for (const policy of shown) {
          const dot = el('span', {
            class: 'dot',
            style: { background: policy.color || 'transparent', 'border-color': policy.color || 'currentColor' },
            'aria-hidden': 'true'
          });
          const title = el('span', { class: 'grow' }, [
            el('strong', { text: policy.name || policy.handle || policy.channelId || policy.key }),
            el('span', { class: 'hint', text: `${policy.handle || policy.channelId || 'name match'} · ${modeBadge(policy)} · ${stateOf(policy)}${isFiniteNumber(policy.boost) && policy.boost ? ` · boost ${policy.boost > 0 ? '+' : ''}${policy.boost}` : ''}` })
          ]);
          const edit = el('button', { type: 'button', text: 'Edit', 'aria-label': `Edit policy for ${policy.name || policy.key}` });
          edit.addEventListener('click', () => openEditor(policy));
          const toggle = el('button', {
            type: 'button',
            text: policy.enabled ? 'Disable' : 'Enable',
            'aria-pressed': String(!policy.enabled)
          });
          toggle.addEventListener('click', () => {
            Channels.setEnabled(policy.key, !policy.enabled, 'ui');
            refresh();
          });
          const remove = el('button', { type: 'button', text: 'Delete', 'aria-label': `Delete policy for ${policy.name || policy.key}` });
          remove.addEventListener('click', () => {
            Channels.remove(policy.key, 'ui');
            message.textContent = `Removed policy for ${policy.name || policy.key}.`;
            if (draft && draft.key === policy.key) closeEditor();
            refresh();
          });
          list.appendChild(el('div', { class: 'policy-row', role: 'listitem' }, [dot, title, edit, toggle, remove]));
        }
        if (filtered.length > shown.length) {
          list.appendChild(el('div', { class: 'hint', text: `…and ${filtered.length - shown.length} more. Use the filter box to narrow the list.` }));
        }
        if (!all.length) {
          list.appendChild(el('div', { class: 'hint', text: 'No channel policies yet. Use “Channel…” on any result, or add one here.' }));
        }
      }

      /* --- editor ---------------------------------------------------------- */

      function closeEditor() {
        draft = null;
        while (editorHost.firstChild) editorHost.removeChild(editorHost.firstChild);
      }

      function openEditor(source) {
        const existing = source && source.key ? Channels.byKey(source.key) : Channels.lookup({
          channelId: source.channelId, handle: source.handle, name: source.name
        });
        const base = existing || coerce(Channels.schema, {
          channelId: source.channelId || '',
          handle: source.handle || '',
          name: source.name || ''
        }, [], 'channel');
        draft = JSON.parse(JSON.stringify(base));
        renderEditor(!!existing);
      }

      function draftField(labelText, path, parse, serialise, hint, placeholder) {
        const input = el('input', { type: 'text', placeholder: placeholder || '' });
        const get = () => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), draft);
        const set = (value) => {
          const parts = path.split('.');
          let cursor = draft;
          for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
          cursor[parts[parts.length - 1]] = value;
        };
        input.value = serialise(get());
        input.addEventListener('change', () => {
          const raw = input.value.trim();
          set(raw ? parse(raw) : null);
          input.value = serialise(get());
        });
        return fieldRow(labelText, input, hint);
      }

      function draftSelect(labelText, path, options, hint) {
        const select = el('select', { 'aria-label': labelText });
        for (const option of options) select.appendChild(el('option', { value: option.id, text: option.label }));
        const get = () => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), draft);
        select.value = String(get());
        select.addEventListener('change', () => {
          const parts = path.split('.');
          let cursor = draft;
          for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
          cursor[parts[parts.length - 1]] = select.value;
        });
        return fieldRow(labelText, select, hint);
      }

      function draftList(labelText, path, hint) {
        const textarea = el('textarea', { spellcheck: false });
        const get = () => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), draft) || [];
        textarea.value = get().join('\n');
        textarea.addEventListener('change', () => {
          const parts = path.split('.');
          let cursor = draft;
          for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
          cursor[parts[parts.length - 1]] = textarea.value.split('\n').map((line) => line.trim()).filter(Boolean);
        });
        return fieldRow(labelText, textarea, hint, true);
      }

      const TRI_OPTIONS = [
        { id: 'inherit', label: 'Inherit' }, { id: 'on', label: 'Force on' }, { id: 'off', label: 'Force off' }
      ];

      function renderEditor(isExisting) {
        while (editorHost.firstChild) editorHost.removeChild(editorHost.firstChild);
        if (!draft) return;

        const identity = el('p', {
          class: 'hint',
          text: draft.channelId
            ? `Identity: ${draft.channelId} (canonical id — survives renames)`
            : draft.handle
              ? `Identity: ${draft.handle} (handle — will upgrade to the canonical id automatically)`
              : 'Identity: display name only — the weakest match. Open a result from this channel to capture its handle or id.'
        });

        const bypassBox = el('div', { class: 'checks' });
        for (const rule of BYPASSABLE) {
          const id = nextId();
          const input = el('input', { type: 'checkbox', id });
          input.checked = draft.bypass.indexOf(rule.id) !== -1;
          input.addEventListener('change', () => {
            const index = draft.bypass.indexOf(rule.id);
            if (input.checked && index === -1) draft.bypass.push(rule.id);
            if (!input.checked && index !== -1) draft.bypass.splice(index, 1);
          });
          bypassBox.appendChild(el('div', { class: 'check' }, [input, el('label', { for: id, text: rule.label })]));
        }

        const enabledId = nextId();
        const enabled = el('input', { type: 'checkbox', id: enabledId });
        enabled.checked = draft.enabled;
        enabled.addEventListener('change', () => { draft.enabled = enabled.checked; });

        const snoozeSelect = el('select', { 'aria-label': 'Temporarily disable this policy' });
        for (const option of [
          { id: '0', label: 'Not snoozed' }, { id: '1', label: 'Snooze 1 day' },
          { id: '7', label: 'Snooze 7 days' }, { id: '30', label: 'Snooze 30 days' }
        ]) snoozeSelect.appendChild(el('option', { value: option.id, text: option.label }));
        snoozeSelect.value = isFiniteNumber(draft.snoozeUntil) && draft.snoozeUntil > Date.now()
          ? String(Math.max(1, Math.round((draft.snoozeUntil - Date.now()) / 86400000)))
          : '0';
        snoozeSelect.addEventListener('change', () => {
          const days = Number(snoozeSelect.value);
          draft.snoozeUntil = days > 0 ? Date.now() + days * 86400000 : null;
        });

        const save = el('button', { type: 'button', class: 'primary', text: isExisting ? 'Save policy' : 'Create policy' });
        save.addEventListener('click', () => {
          const stored = Channels.upsert(draft, 'ui');
          if (!stored) { message.textContent = 'Could not save this policy (identity missing or limit reached).'; return; }
          message.textContent = `Saved policy for ${stored.name || stored.handle || stored.channelId || stored.key}.`;
          closeEditor();
          refresh();
        });
        const cancel = el('button', { type: 'button', text: 'Cancel' });
        cancel.addEventListener('click', () => { closeEditor(); });

        editorHost.appendChild(el('fieldset', {}, [
          el('legend', { text: isExisting ? 'Edit channel policy' : 'New channel policy' }),
          identity,
          draftField('Channel name', 'name', (v) => v.slice(0, 120), (v) => String(v || ''), 'Used for display and as a last-resort match.'),
          draftField('Handle', 'handle', (v) => (v.startsWith('@') ? v : `@${v}`).toLowerCase(), (v) => String(v || ''), '', '@example'),
          draftField('Channel ID', 'channelId', (v) => v.trim(), (v) => String(v || ''), 'UC… — authoritative when known.', 'UC…'),
          draftSelect('Policy', 'mode', CHANNEL_MODES),
          draftField('Ranking boost', 'boost',
            (v) => clamp(Number(v) || 0, -50, 50), (v) => String(v || 0),
            'Score points added (or removed) for this channel: −50 … +50.'),
          draftField('Result limit', 'limit',
            (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? clamp(n, 1, 100) : null; },
            (v) => (isFiniteNumber(v) ? String(v) : ''),
            'Used by the “Limited” policy: max results from this channel per result set.'),
          draftField('Accent colour', 'color',
            (v) => (/^#[0-9a-fA-F]{3,8}$/.test(v) ? v : ''), (v) => String(v || ''),
            'Hex colour used to mark this channel’s results.', '#4caf50'),
          draftField('Badge label', 'label', (v) => v.slice(0, 24), (v) => String(v || ''), '', 'e.g. Primary source'),
          draftField('Note', 'note', (v) => v.slice(0, 300), (v) => String(v || '')),
          el('div', { class: 'field' }, [
            el('label', { for: enabledId, text: 'Policy enabled' }),
            el('div', { class: 'control row' }, [enabled, snoozeSelect])
          ])
        ]));

        editorHost.appendChild(el('fieldset', {}, [
          el('legend', { text: 'Bypass global rules for this channel' }),
          el('p', { class: 'hint', text: 'Explicitly ignore the selected rules coming from the global and context scopes. The channel’s own rules below always apply.' }),
          bypassBox
        ]));

        editorHost.appendChild(el('fieldset', {}, [
          el('legend', { text: 'Channel-specific rules' }),
          el('p', { class: 'hint', text: 'Leave a field empty or on “Inherit” to defer to the wider scope. Anything set here wins over context profiles and global settings.' }),
          draftSelect('Sort override', 'rules.sortMode', [{ id: 'inherit', label: 'Inherit' }].concat(SORT_MODES)),
          draftSelect('Grouping override', 'rules.groupBy', [{ id: 'inherit', label: 'Inherit' }].concat(GROUP_MODES)),
          draftField('Minimum views', 'rules.viewsMin', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : ''), '', 'e.g. 10k'),
          draftField('Maximum views', 'rules.viewsMax', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftField('Minimum likes', 'rules.likesMin', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : ''), 'Precision mode only.'),
          draftField('Minimum duration', 'rules.durationMinSec', parseDurationInput, (v) => (isFiniteNumber(v) ? formatDuration(v) : ''), '', 'e.g. 10m'),
          draftField('Maximum duration', 'rules.durationMaxSec', parseDurationInput, (v) => (isFiniteNumber(v) ? formatDuration(v) : '')),
          draftField('Maximum age (days)', 'rules.ageMaxDays', (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; }, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftField('Minimum age (days)', 'rules.ageMinDays', (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; }, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftField('Hide above title-style score', 'rules.styleMaxScore', (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? clamp(n, 0, 100) : null; }, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftSelect('Shorts', 'rules.hideShorts', TRI_OPTIONS),
          draftSelect('Live streams', 'rules.hideLive', TRI_OPTIONS),
          draftSelect('Premieres', 'rules.hideUpcoming', TRI_OPTIONS),
          draftSelect('Watched videos', 'rules.hideWatched', TRI_OPTIONS),
          draftSelect('Members-only', 'rules.hideMembersOnly', TRI_OPTIONS),
          draftSelect('Already-seen suppression', 'rules.hideSeen', TRI_OPTIONS),
          draftSelect('Require query words', 'rules.requireQueryTerms', [
            { id: 'inherit', label: 'Inherit' }, { id: 'off', label: 'Off' },
            { id: 'any', label: 'Any word' }, { id: 'all', label: 'All words' }
          ]),
          draftList('Hide when the title matches', 'rules.titleExclude'),
          draftList('Keep only when the title matches', 'rules.titleInclude'),
          draftList('Hide when tagged', 'rules.tagExclude', 'Precision mode only.'),
          draftList('Keep only when tagged', 'rules.tagInclude', 'Precision mode only.'),
          el('div', { class: 'row' }, [save, cancel])
        ]));
      }

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Channel policies' }),
        el('p', {
          class: 'hint',
          text: 'Per-channel rules apply everywhere the script runs: in search results, in search-within-channel and on the channel’s own pages. Policies are keyed by the canonical channel id when it is known, so they survive renames and rebrands.'
        }),
        el('div', { class: 'row' }, [el('div', { class: 'grow' }, search), addBtn]),
        countLabel,
        list,
        el('div', { class: 'row' }, [
          exportBtn, importBtn,
          el('div', { class: 'check' }, [replaceCheck, el('label', { for: replaceCheckId, text: 'Replace existing on import' })]),
          clearBtn
        ]),
        importArea,
        message
      ]));
      pane.appendChild(editorHost);

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Quick lists' }),
        el('p', {
          class: 'hint',
          text: 'Lightweight alternatives to a full policy. The allow list behaves like a “trusted” policy with every bypass enabled, the block list like a “blocked” one. A channel policy above always wins over these lists.'
        }),
        listField('filters.channelBlock', 'Blocked channels', 'Accepts @handles, UC… ids, channel URLs or name patterns.'),
        listField('filters.channelAllow', 'Always allowed channels')
      ]));

      pane.refreshChannels = refresh;
      pane.openChannelEditor = (identity) => { openEditor(identity || {}); };
      refresh();
      return pane;
    }

    /* --- context profiles ----------------------------------------------------- */

    function buildContextsPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-contexts', 'aria-labelledby': 'ysc-tab-contexts', hidden: true });
      const list = el('div', { class: 'policy-list', role: 'list' });
      const editorHost = el('div', {});
      const message = el('span', { class: 'hint' });
      let draft = null;
      let draftIndex = -1;

      const TRI_OPTIONS = [
        { id: 'inherit', label: 'Inherit' }, { id: 'on', label: 'Force on' }, { id: 'off', label: 'Force off' }
      ];

      const emptyContext = () => coerce(CONTEXT_SCHEMA, {
        id: `ctx${Date.now().toString(36)}`,
        name: 'New context',
        enabled: true
      }, [], 'context');

      const addBtn = el('button', { type: 'button', class: 'primary', text: 'Add context profile' });
      addBtn.addEventListener('click', () => {
        draft = emptyContext();
        draftIndex = -1;
        renderEditor();
      });

      function commit(contexts) {
        Config.setContexts(contexts, 'ui');
        refresh();
      }

      function refresh() {
        while (list.firstChild) list.removeChild(list.firstChild);
        const contexts = Config.value.contexts;
        if (!contexts.length) {
          list.appendChild(el('div', {
            class: 'hint',
            text: 'No context profiles. A profile overrides global settings only while its conditions match — for example “strict rules when the query mentions news”, or “no keyword rules on channel pages”.'
          }));
        }
        contexts.forEach((profile, index) => {
          const conditions = [];
          if (profile.when.queryPattern) conditions.push(`query ~ ${profile.when.queryPattern}`);
          if (profile.when.pageTypes.length) conditions.push(profile.when.pageTypes.join('/'));
          if (profile.when.channelScope !== 'any') conditions.push(`${profile.when.channelScope} channels`);
          if (profile.when.withYouTubeFilter !== 'any') conditions.push(`${profile.when.withYouTubeFilter} YouTube filter`);
          const row = el('div', { class: 'policy-row', role: 'listitem' }, [
            el('span', { class: 'grow' }, [
              el('strong', { text: `${index + 1}. ${profile.name}` }),
              el('span', { class: 'hint', text: conditions.length ? conditions.join(' · ') : 'always active' })
            ])
          ]);
          const up = el('button', { type: 'button', text: '↑', 'aria-label': `Move ${profile.name} earlier` });
          up.disabled = index === 0;
          up.addEventListener('click', () => {
            const next = Config.value.contexts.slice();
            [next[index - 1], next[index]] = [next[index], next[index - 1]];
            commit(next);
          });
          const down = el('button', { type: 'button', text: '↓', 'aria-label': `Move ${profile.name} later` });
          down.disabled = index === contexts.length - 1;
          down.addEventListener('click', () => {
            const next = Config.value.contexts.slice();
            [next[index + 1], next[index]] = [next[index], next[index + 1]];
            commit(next);
          });
          const toggle = el('button', {
            type: 'button',
            text: profile.enabled ? 'Disable' : 'Enable',
            'aria-pressed': String(!profile.enabled)
          });
          toggle.addEventListener('click', () => {
            const next = Config.value.contexts.map((p, i) => (i === index ? Object.assign({}, p, { enabled: !p.enabled }) : p));
            commit(next);
          });
          const edit = el('button', { type: 'button', text: 'Edit', 'aria-label': `Edit ${profile.name}` });
          edit.addEventListener('click', () => {
            draft = JSON.parse(JSON.stringify(profile));
            draftIndex = index;
            renderEditor();
          });
          const remove = el('button', { type: 'button', text: 'Delete', 'aria-label': `Delete ${profile.name}` });
          remove.addEventListener('click', () => {
            commit(Config.value.contexts.filter((_p, i) => i !== index));
            message.textContent = `Deleted “${profile.name}”.`;
            closeEditor();
          });
          row.appendChild(up);
          row.appendChild(down);
          row.appendChild(toggle);
          row.appendChild(edit);
          row.appendChild(remove);
          list.appendChild(row);
        });
      }

      function closeEditor() {
        draft = null;
        draftIndex = -1;
        while (editorHost.firstChild) editorHost.removeChild(editorHost.firstChild);
      }

      function draftField(labelText, path, parse, serialise, hint, placeholder) {
        const input = el('input', { type: 'text', placeholder: placeholder || '' });
        const read = () => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), draft);
        const write = (value) => {
          const parts = path.split('.');
          let cursor = draft;
          for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
          cursor[parts[parts.length - 1]] = value;
        };
        input.value = serialise(read());
        input.addEventListener('change', () => {
          const raw = input.value.trim();
          write(raw ? parse(raw) : null);
          input.value = serialise(read());
        });
        return fieldRow(labelText, input, hint);
      }

      function draftSelect(labelText, path, options, hint) {
        const select = el('select', { 'aria-label': labelText });
        for (const option of options) select.appendChild(el('option', { value: option.id, text: option.label }));
        const read = () => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), draft);
        select.value = String(read());
        select.addEventListener('change', () => {
          const parts = path.split('.');
          let cursor = draft;
          for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
          cursor[parts[parts.length - 1]] = select.value;
        });
        return fieldRow(labelText, select, hint);
      }

      function draftList(labelText, path, hint) {
        const textarea = el('textarea', { spellcheck: false });
        const read = () => path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), draft) || [];
        textarea.value = read().join('\n');
        textarea.addEventListener('change', () => {
          const parts = path.split('.');
          let cursor = draft;
          for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
          cursor[parts[parts.length - 1]] = textarea.value.split('\n').map((line) => line.trim()).filter(Boolean);
        });
        return fieldRow(labelText, textarea, hint, true);
      }

      function renderEditor() {
        while (editorHost.firstChild) editorHost.removeChild(editorHost.firstChild);
        if (!draft) return;

        const pageBox = el('div', { class: 'checks' });
        for (const [id, label] of [[PAGE.search, 'Search results'], [PAGE.channelGrid, 'Channel video lists'], [PAGE.channelSearch, 'Search within a channel']]) {
          const inputId = nextId();
          const input = el('input', { type: 'checkbox', id: inputId });
          input.checked = draft.when.pageTypes.indexOf(id) !== -1;
          input.addEventListener('change', () => {
            const index = draft.when.pageTypes.indexOf(id);
            if (input.checked && index === -1) draft.when.pageTypes.push(id);
            if (!input.checked && index !== -1) draft.when.pageTypes.splice(index, 1);
          });
          pageBox.appendChild(el('div', { class: 'check' }, [input, el('label', { for: inputId, text: label })]));
        }

        const enabledId = nextId();
        const enabled = el('input', { type: 'checkbox', id: enabledId });
        enabled.checked = draft.enabled;
        enabled.addEventListener('change', () => { draft.enabled = enabled.checked; });

        const save = el('button', { type: 'button', class: 'primary', text: draftIndex >= 0 ? 'Save context' : 'Create context' });
        save.addEventListener('click', () => {
          const next = Config.value.contexts.slice();
          if (draftIndex >= 0) next[draftIndex] = draft;
          else if (next.length >= LIMITS.maxContexts) { message.textContent = `Context limit reached (${LIMITS.maxContexts}).`; return; }
          else next.push(draft);
          commit(next);
          message.textContent = `Saved “${draft.name}”.`;
          closeEditor();
        });
        const cancel = el('button', { type: 'button', text: 'Cancel' });
        cancel.addEventListener('click', closeEditor);

        editorHost.appendChild(el('fieldset', {}, [
          el('legend', { text: draftIndex >= 0 ? 'Edit context profile' : 'New context profile' }),
          draftField('Name', 'name', (v) => v.slice(0, 60), (v) => String(v || '')),
          el('div', { class: 'field' }, [
            el('label', { for: enabledId, text: 'Profile enabled' }),
            el('div', { class: 'control' }, enabled)
          ]),
          el('p', { class: 'hint', text: 'The profile applies while every condition below matches. Later profiles in the list win over earlier ones; channel policies win over all of them.' }),
          draftField('Query matches', 'when.queryPattern', (v) => v.slice(0, 200), (v) => String(v || ''),
            'Keyword syntax: plain text, "phrase" or /regex/i. Empty means any query.', 'e.g. /news|politics/i'),
          el('div', { class: 'field stack' }, [el('label', { text: 'Only on these pages' }), el('div', { class: 'control' }, pageBox)]),
          draftSelect('Channel scope', 'when.channelScope', [
            { id: 'any', label: 'Any channel' },
            { id: 'configured', label: 'Only pages of configured channels' },
            { id: 'unconfigured', label: 'Only pages of channels without a policy' }
          ]),
          draftSelect('YouTube filter parameter', 'when.withYouTubeFilter', [
            { id: 'any', label: 'Any' }, { id: 'with', label: 'Only when a YouTube filter is applied' }, { id: 'without', label: 'Only without a YouTube filter' }
          ])
        ]));

        editorHost.appendChild(el('fieldset', {}, [
          el('legend', { text: 'Overrides while active' }),
          draftSelect('Sort', 'rules.sortMode', [{ id: 'inherit', label: 'Inherit' }].concat(SORT_MODES)),
          draftSelect('Grouping', 'rules.groupBy', [{ id: 'inherit', label: 'Inherit' }].concat(GROUP_MODES)),
          draftField('Minimum views', 'rules.viewsMin', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftField('Maximum views', 'rules.viewsMax', parseCountInput, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftField('Minimum duration', 'rules.durationMinSec', parseDurationInput, (v) => (isFiniteNumber(v) ? formatDuration(v) : '')),
          draftField('Maximum duration', 'rules.durationMaxSec', parseDurationInput, (v) => (isFiniteNumber(v) ? formatDuration(v) : '')),
          draftField('Maximum age (days)', 'rules.ageMaxDays', (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; }, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftField('Hide below score', 'rules.scoreFloor', (v) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, 0, 100) : null; }, (v) => (isFiniteNumber(v) ? String(v) : '')),
          draftSelect('Shorts', 'rules.hideShorts', TRI_OPTIONS),
          draftSelect('Live streams', 'rules.hideLive', TRI_OPTIONS),
          draftSelect('Watched videos', 'rules.hideWatched', TRI_OPTIONS),
          draftSelect('Already-seen suppression', 'rules.hideSeen', TRI_OPTIONS),
          draftSelect('Require query words', 'rules.requireQueryTerms', [
            { id: 'inherit', label: 'Inherit' }, { id: 'off', label: 'Off' },
            { id: 'any', label: 'Any word' }, { id: 'all', label: 'All words' }
          ]),
          draftList('Additional “hide when title matches” rules', 'rules.titleExclude'),
          draftList('Additional “keep only when title matches” rules', 'rules.titleInclude'),
          el('div', { class: 'row' }, [save, cancel])
        ]));
      }

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Context profiles (search-context scope)' }),
        el('p', {
          class: 'hint',
          text: 'Context profiles sit between global settings and channel policies: they change the rules only while their conditions match the page you are on.'
        }),
        el('div', { class: 'row' }, [addBtn, message]),
        list
      ]));
      pane.appendChild(editorHost);
      pane.refreshContexts = refresh;
      registerBinding('contexts', refresh);
      refresh();
      return pane;
    }

    /* --- YouTube server-side filters ----------------------------------------- */

    function buildYouTubePane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-youtube', 'aria-labelledby': 'ysc-tab-youtube', hidden: true });
      const selection = { type: 'any', uploadDate: 'any', duration: 'any', prioritize: 'relevance', features: {} };
      const preview = el('code', { class: 'hint', text: '' });

      const makeSelect = (label, key, options) => {
        const select = el('select', { 'aria-label': label });
        for (const option of options) select.appendChild(el('option', { value: option.id, text: option.label }));
        select.addEventListener('change', () => { selection[key] = select.value; updatePreview(); });
        return fieldRow(label, select);
      };

      const featureBoxes = el('div', { class: 'checks' });
      for (const [key, label] of SearchParams.FEATURE_LABELS) {
        const id = nextId();
        const input = el('input', { type: 'checkbox', id });
        input.addEventListener('change', () => { selection.features[key] = input.checked; updatePreview(); });
        featureBoxes.appendChild(el('div', { class: 'check' }, [input, el('label', { for: id, text: label })]));
      }

      const applyBtn = el('button', { type: 'button', class: 'primary', text: 'Apply to this search' });
      const clearBtn = el('button', { type: 'button', text: 'Clear YouTube filters' });

      function updatePreview() {
        const sp = SearchParams.build(selection);
        preview.textContent = sp ? `sp=${sp}` : 'No YouTube-side filter selected.';
      }

      applyBtn.addEventListener('click', () => {
        const url = SearchParams.urlFor(selection);
        if (url) handlers.onNavigate(url.toString());
      });
      clearBtn.addEventListener('click', () => {
        const url = safeUrl(location.href);
        if (!url) return;
        url.searchParams.delete('sp');
        handlers.onNavigate(url.toString());
      });

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'YouTube server-side filters' }),
        el('p', {
          class: 'hint',
          text: 'These reload the search using YouTube’s own filter parameter, so they apply to the whole result set rather than only the loaded page. Combinations that YouTube’s own menu cannot express in one step are supported.'
        }),
        makeSelect('Result type', 'type', [
          { id: 'any', label: 'Any' }, { id: 'video', label: 'Videos' }, { id: 'shorts', label: 'Shorts' },
          { id: 'channel', label: 'Channels' }, { id: 'playlist', label: 'Playlists' }, { id: 'movie', label: 'Movies' }
        ]),
        makeSelect('Upload date', 'uploadDate', [
          { id: 'any', label: 'Any time' }, { id: 'today', label: 'Today' }, { id: 'week', label: 'This week' },
          { id: 'month', label: 'This month' }, { id: 'year', label: 'This year' }
        ]),
        makeSelect('Duration', 'duration', [
          { id: 'any', label: 'Any' }, { id: 'under3', label: 'Under 3 minutes' },
          { id: 'from3to20', label: '3–20 minutes' }, { id: 'over20', label: 'Over 20 minutes' }
        ]),
        makeSelect('Prioritise', 'prioritize', [
          { id: 'relevance', label: 'Relevance' }, { id: 'popularity', label: 'Popularity' }
        ]),
        el('div', { class: 'field stack' }, [el('label', { text: 'Features' }), el('div', { class: 'control' }, featureBoxes)]),
        el('div', { class: 'row' }, [applyBtn, clearBtn, preview])
      ]));
      updatePreview();
      return pane;
    }

    /* --- presets --------------------------------------------------------------- */

    function buildPresetsPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-presets', 'aria-labelledby': 'ysc-tab-presets', hidden: true });
      const list = el('div', { class: 'checks' });
      const nameInput = el('input', { type: 'text', placeholder: 'Preset name', 'aria-label': 'New preset name' });
      const saveBtn = el('button', { type: 'button', class: 'primary', text: 'Save current settings' });
      const message = el('span', { class: 'hint' });

      function refresh() {
        while (list.firstChild) list.removeChild(list.firstChild);
        for (const preset of Config.builtinPresets) {
          const apply = el('button', { type: 'button', text: preset.name });
          apply.addEventListener('click', () => { Config.applyPreset(preset.id); message.textContent = `Applied “${preset.name}”.`; });
          list.appendChild(el('div', { class: 'row' }, [apply, el('span', { class: 'hint', text: 'built-in' })]));
        }
        for (const preset of Config.presets) {
          const apply = el('button', { type: 'button', text: preset.name });
          apply.addEventListener('click', () => { Config.applyPreset(preset.id); message.textContent = `Applied “${preset.name}”.`; });
          const remove = el('button', { type: 'button', text: 'Delete', 'aria-label': `Delete preset ${preset.name}` });
          remove.addEventListener('click', () => {
            Config.deletePreset(preset.id);
            refresh();
            message.textContent = `Deleted “${preset.name}”.`;
          });
          list.appendChild(el('div', { class: 'row' }, [apply, remove]));
        }
      }

      saveBtn.addEventListener('click', () => {
        const result = Config.savePreset(nameInput.value);
        message.textContent = result.ok ? `Saved “${nameInput.value.trim()}”.` : result.error;
        if (result.ok) { nameInput.value = ''; refresh(); }
      });

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Presets' }),
        el('p', { class: 'hint', text: 'Built-in presets adjust the relevant options and leave your channel policies and lists untouched. Saved presets capture the complete configuration (channel policies are stored separately and are never overwritten by a preset).' }),
        list,
        el('div', { class: 'row' }, [el('div', { class: 'grow' }, nameInput), saveBtn]),
        message
      ]));
      refresh();
      registerBinding('advanced.activePreset', refresh);
      return pane;
    }

    function shortcutField(path, labelText) {
      const input = el('input', {
        type: 'text',
        readonly: true,
        'aria-label': `${labelText} — press a key combination to change it`
      });
      const clear = el('button', { type: 'button', text: 'Clear' });
      const sync = () => { input.value = Config.getPath(path) || '(disabled)'; };
      sync();
      input.addEventListener('keydown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = event.key;
        if (key === 'Tab' || key === 'Escape') return;
        if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(key) !== -1) return;
        const combo = [];
        if (event.ctrlKey) combo.push('Ctrl');
        if (event.altKey) combo.push('Alt');
        if (event.shiftKey) combo.push('Shift');
        if (event.metaKey) combo.push('Meta');
        combo.push(key.length === 1 ? key.toUpperCase() : key);
        if (combo.length < 2) {
          input.value = 'Use at least one modifier';
          return;
        }
        Config.setPath(path, combo.join('+'), 'ui');
        sync();
      });
      clear.addEventListener('click', () => { Config.setPath(path, '', 'ui'); sync(); });
      registerBinding(path, sync);
      return fieldRow(labelText, el('div', { class: 'row' }, [el('div', { class: 'grow' }, input), clear]));
    }

    function buildSettingsPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-settings', 'aria-labelledby': 'ysc-tab-settings', hidden: true });

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Precision mode' }),
        el('p', {
          class: 'hint',
          text: 'Reads exact upload dates, view and like counts, channel-supplied tags, the full description, the category and regional availability from YouTube’s own player endpoint on this origin, without cookies, and caches them locally. Off by default: on-page metadata is used instead, which is approximate (“3 years ago”) and carries no tags or likes.'
        }),
        el('div', { class: 'checks' }, [
          checkbox('precision.enabled', 'Enable precision mode'),
          checkbox('precision.cacheEnabled', 'Cache results locally'),
          checkbox('precision.channelPages', 'Also on channel pages')
        ]),
        parsedField('precision.concurrency', 'Parallel lookups',
          (raw) => clamp(parseInt(raw, 10) || 0, 1, LIMITS.maxEnrichConcurrency),
          (v) => String(v || 4)),
        parsedField('precision.ttlHours', 'Cache lifetime (hours)',
          (raw) => clamp(parseInt(raw, 10) || 0, 1, 24 * 90),
          (v) => String(v || 168))
      ]));

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Loading more results' }),
        parsedField('deepLoad.batches', 'Batches per “Load more”',
          (raw) => clamp(parseInt(raw, 10) || 0, 1, LIMITS.deepLoadMaxBatches),
          (v) => String(v || 3),
          'Each batch is one of YouTube’s own continuation loads.'),
        el('div', { class: 'checks' }, [
          checkbox('deepLoad.autoWhenSparse', 'Load automatically when few results survive filtering')
        ]),
        parsedField('deepLoad.minVisible', 'Target visible results',
          (raw) => clamp(parseInt(raw, 10) || 0, 1, 200),
          (v) => String(v || 8))
      ]));

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Keyboard' }),
        el('div', { class: 'checks' }, [checkbox('shortcuts.enabled', 'Enable keyboard shortcuts')]),
        shortcutField('shortcuts.togglePanel', 'Open / close the panel'),
        shortcutField('shortcuts.toggleHidden', 'Show / hide filtered results'),
        shortcutField('shortcuts.cycleSort', 'Cycle sort mode'),
        shortcutField('shortcuts.focusSearch', 'Focus “search within results”'),
        shortcutField('shortcuts.blockChannel', 'Channel policy for this page'),
        el('p', { class: 'hint', text: 'Shortcuts never fire while you are typing in a text field, and never override YouTube shortcuts that use no modifier.' })
      ]));

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Master switch' }),
        el('div', { class: 'checks' }, [
          checkbox('enabled', 'Filtering and sorting enabled', 'When off, the page is left completely untouched.'),
          checkbox('advanced.debug', 'Verbose console logging')
        ])
      ]));
      return pane;
    }

    function buildAboutPane() {
      const pane = el('div', { class: 'pane', role: 'tabpanel', id: 'ysc-pane-about', 'aria-labelledby': 'ysc-tab-about', hidden: true });
      const table = el('table', { class: 'diag' });
      const log = el('pre', { class: 'log' });
      const io = el('textarea', {
        spellcheck: false,
        'aria-label': 'Configuration backup: copy this out, or paste a backup in and press Import'
      });
      const message = el('span', { class: 'hint' });

      const refresh = () => {
        const diagnostics = handlers.getDiagnostics();
        while (table.firstChild) table.removeChild(table.firstChild);
        for (const [key, value] of diagnostics.rows) {
          table.appendChild(el('tr', {}, [el('td', { text: key }), el('td', { text: String(value) })]));
        }
        log.textContent = diagnostics.log.length
          ? diagnostics.log.map((entry) => `${new Date(entry.t).toLocaleTimeString()} [${entry.level}] ${entry.message}${entry.detail ? ` — ${entry.detail}` : ''}`).join('\n')
          : 'No warnings or errors recorded.';
      };

      const payload = () => Config.exportPayload({ channels: Channels.exportList() });

      const exportBtn = el('button', { type: 'button', text: 'Export everything' });
      exportBtn.addEventListener('click', () => {
        io.value = JSON.stringify(payload(), null, 2);
        io.focus();
        io.select();
        message.textContent = 'Settings, presets and channel policies exported below.';
      });

      const downloadBtn = el('button', { type: 'button', text: 'Download backup' });
      downloadBtn.addEventListener('click', () => {
        try {
          const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = el('a', { href: url, download: `youtube-search-command-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          message.textContent = 'Backup downloaded.';
        } catch (err) {
          message.textContent = `Download failed: ${err.message}`;
        }
      });

      const importBtn = el('button', { type: 'button', text: 'Import settings' });
      const applyImport = (text) => {
        const result = Config.importPayload(text);
        if (!result.ok) { message.textContent = result.error; return; }
        let extra = '';
        if (Array.isArray(result.channels)) {
          const channelResult = Channels.importList(result.channels, true);
          if (channelResult.ok) extra = `, ${channelResult.imported} channel policies`;
        }
        message.textContent = result.issues.length
          ? `Imported with ${result.issues.length} corrected value(s)${extra}.`
          : `Imported successfully${extra}.`;
        syncFields();
      };
      importBtn.addEventListener('click', () => applyImport(io.value));

      const fileInput = el('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Import a backup file' });
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { message.textContent = 'That file is too large to be a settings backup.'; return; }
        const reader = new FileReader();
        reader.onload = () => {
          io.value = String(reader.result || '');
          applyImport(io.value);
        };
        reader.onerror = () => { message.textContent = 'Could not read that file.'; };
        reader.readAsText(file);
      });

      const resetBtn = el('button', { type: 'button', text: 'Reset settings' });
      let resetArmed = false;
      resetBtn.addEventListener('click', () => {
        if (!resetArmed) {
          resetArmed = true;
          resetBtn.textContent = 'Click again to confirm reset';
          setTimeout(() => { resetArmed = false; resetBtn.textContent = 'Reset settings'; }, 4000);
          return;
        }
        Config.reset('ui');
        syncFields();
        message.textContent = 'Settings restored to defaults. Channel policies were kept.';
        resetArmed = false;
        resetBtn.textContent = 'Reset settings';
      });

      const clearCacheBtn = el('button', { type: 'button', text: 'Clear metadata cache' });
      clearCacheBtn.addEventListener('click', () => {
        Precision.clearCache();
        message.textContent = 'Cached exact metadata cleared.';
        refresh();
      });

      const clearSeenBtn = el('button', { type: 'button', text: 'Forget “seen” history' });
      clearSeenBtn.addEventListener('click', () => {
        Memory.clearSeen();
        message.textContent = 'Seen-history cleared.';
        refresh();
      });

      const clearVerdictsBtn = el('button', { type: 'button', text: 'Clear pins / mutes' });
      clearVerdictsBtn.addEventListener('click', () => {
        Memory.clearVerdicts();
        message.textContent = 'Per-video pins, mutes and snoozes cleared.';
        refresh();
      });

      const refreshBtn = el('button', { type: 'button', text: 'Refresh diagnostics' });
      refreshBtn.addEventListener('click', refresh);

      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Status' }),
        table,
        el('div', { class: 'row' }, [refreshBtn, clearCacheBtn, clearSeenBtn, clearVerdictsBtn])
      ]));
      pane.appendChild(el('fieldset', {}, [el('legend', { text: 'Recent warnings & errors' }), log]));
      pane.appendChild(el('fieldset', {}, [
        el('legend', { text: 'Backup & restore' }),
        io,
        el('div', { class: 'row' }, [exportBtn, downloadBtn, importBtn, fileInput]),
        el('div', { class: 'row' }, [resetBtn, message])
      ]));
      pane.refreshDiagnostics = refresh;
      return pane;
    }

    function buildPanel() {
      const parts = makeHost(HOST_IDS.panel);
      const titleId = 'ysc-dialog-title';

      const closeBtn = el('button', { type: 'button', text: 'Close', 'aria-label': 'Close the control panel' });
      closeBtn.addEventListener('click', () => closePanel());

      const enabledToggle = el('button', {
        type: 'button',
        'aria-pressed': String(Config.value.enabled),
        text: Config.value.enabled ? 'Enabled' : 'Disabled'
      });
      enabledToggle.addEventListener('click', () => Config.setPath('enabled', !Config.value.enabled, 'ui'));
      registerBinding('enabled', () => {
        enabledToggle.setAttribute('aria-pressed', String(Config.value.enabled));
        enabledToggle.textContent = Config.value.enabled ? 'Enabled' : 'Disabled';
      });

      const header = el('header', {}, [
        el('h1', { id: titleId, text: `${APP.name} ${APP.version}` }),
        enabledToggle,
        closeBtn
      ]);

      const tablist = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' });
      const panes = el('div', { class: 'panes' });
      const paneBuilders = {
        results: buildResultsPane,
        ranking: buildRankingPane,
        text: buildTextPane,
        content: buildContentPane,
        channels: buildChannelsPane,
        contexts: buildContextsPane,
        youtube: buildYouTubePane,
        presets: buildPresetsPane,
        settings: buildSettingsPane,
        about: buildAboutPane
      };
      const paneMap = {};
      const tabButtons = [];

      for (const tab of TABS) {
        const button = el('button', {
          type: 'button',
          role: 'tab',
          id: `ysc-tab-${tab.id}`,
          'aria-controls': `ysc-pane-${tab.id}`,
          'aria-selected': String(tab.id === 'results'),
          tabindex: tab.id === 'results' ? '0' : '-1',
          text: tab.label
        });
        button.addEventListener('click', () => selectTab(tab.id));
        tablist.appendChild(button);
        tabButtons.push(button);
        const pane = paneBuilders[tab.id]();
        paneMap[tab.id] = pane;
        panes.appendChild(pane);
      }

      tablist.addEventListener('keydown', (event) => {
        const index = tabButtons.indexOf(event.target);
        if (index === -1) return;
        let next = -1;
        if (event.key === 'ArrowRight') next = (index + 1) % tabButtons.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabButtons.length) % tabButtons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabButtons.length - 1;
        if (next === -1) return;
        event.preventDefault();
        selectTab(TABS[next].id);
        tabButtons[next].focus();
      });

      function selectTab(id) {
        for (let i = 0; i < TABS.length; i++) {
          const selected = TABS[i].id === id;
          tabButtons[i].setAttribute('aria-selected', String(selected));
          tabButtons[i].tabIndex = selected ? 0 : -1;
          paneMap[TABS[i].id].hidden = !selected;
        }
        if (id === 'about' && paneMap.about.refreshDiagnostics) paneMap.about.refreshDiagnostics();
        if (id === 'channels' && paneMap.channels.refreshChannels) paneMap.channels.refreshChannels();
        if (id === 'contexts' && paneMap.contexts.refreshContexts) paneMap.contexts.refreshContexts();
      }

      const dialog = el('div', {
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId
      }, [header, tablist, panes]);

      const backdrop = el('div', { class: 'backdrop', hidden: true }, dialog);
      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) closePanel();
      });
      parts.root.appendChild(backdrop);

      return Object.assign(parts, { backdrop, dialog, closeBtn, selectTab, paneMap, tabButtons });
    }

    /* --- panel behaviour ----------------------------------------------------- */

    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function focusables() {
      if (!panel) return [];
      return qa(panel.dialog, FOCUSABLE).filter((node) => {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
        const rects = node.getClientRects();
        return rects.length > 0 || node.tagName === 'INPUT';
      });
    }

    function onPanelKeydown(event) {
      if (!panelOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const active = panel.shadow.activeElement;
      const index = items.indexOf(active);
      let nextIndex;
      if (event.shiftKey) nextIndex = index <= 0 ? items.length - 1 : index - 1;
      else nextIndex = index === -1 || index === items.length - 1 ? 0 : index + 1;
      event.preventDefault();
      items[nextIndex].focus();
    }

    function openPanel(tabId) {
      if (!panel) panel = buildPanel();
      if (!panel.host.parentNode && document.body) document.body.appendChild(panel.host);
      applyTheme();
      syncFields();
      lastFocused = document.activeElement;
      panel.backdrop.hidden = false;
      panelOpen = true;
      if (launcher) launcher.button.setAttribute('aria-expanded', 'true');
      if (tabId) panel.selectTab(tabId);
      // Move focus to a predictable landmark — the active tab — rather than to
      // whatever happens to be the first focusable control, so opening the
      // panel never parks the caret inside a settings field.
      const landmark = panel.tabButtons.find((button) => button.getAttribute('aria-selected') === 'true') ||
        focusables()[0];
      if (landmark) landmark.focus();
      if (panel.paneMap.about && panel.paneMap.about.refreshDiagnostics) panel.paneMap.about.refreshDiagnostics();
    }

    function closePanel() {
      if (!panel || !panelOpen) return;
      panel.backdrop.hidden = true;
      panelOpen = false;
      if (launcher) launcher.button.setAttribute('aria-expanded', 'false');
      if (lastFocused && typeof lastFocused.focus === 'function' && lastFocused.isConnected) {
        try { lastFocused.focus(); } catch (_e) { /* element vanished during a rerender */ }
      }
      lastFocused = null;
    }

    function togglePanel() {
      if (panelOpen) closePanel();
      else openPanel();
    }

    /* --- public API ---------------------------------------------------------- */

    return {
      mount(hostHandlers, scopeDisposer) {
        handlers = hostHandlers;
        disposer = scopeDisposer;
        disposer.listen(window, 'keydown', onPanelKeydown, true);
        const onChannelsChanged = () => {
          if (panel && panel.paneMap.channels && panel.paneMap.channels.refreshChannels) {
            panel.paneMap.channels.refreshChannels();
          }
        };
        const unsubscribe = Channels.subscribe(onChannelsChanged);
        disposer.add(unsubscribe);
        try {
          const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
          if (media && typeof media.addEventListener === 'function') {
            media.addEventListener('change', applyTheme);
            disposer.add(() => media.removeEventListener('change', applyTheme));
          }
        } catch (_e) { /* matchMedia unavailable */ }
      },

      ensureMounted(structure) {
        placeLauncher();
        placeBar(structure);
        applyTheme();
      },

      updateBar,
      syncFields,
      openPanel,
      closePanel,
      togglePanel,
      get panelOpen() { return panelOpen; },

      /** Open the channel policy editor for a specific channel identity. */
      openChannelEditor(identity) {
        openPanel('channels');
        if (panel && panel.paneMap.channels && panel.paneMap.channels.openChannelEditor) {
          panel.paneMap.channels.openChannelEditor(identity || {});
        }
      },

      focusInResultsSearch() {
        if (!bar || !bar.host.isConnected) return false;
        bar.search.focus();
        bar.search.select();
        return true;
      },

      clearInResultsSearch() {
        if (bar) bar.search.value = '';
      },

      unmount() {
        closePanel();
        for (const part of [launcher, bar, panel]) {
          if (part && part.host && part.host.parentNode) part.host.parentNode.removeChild(part.host);
        }
      },

      destroy() {
        this.unmount();
        launcher = null;
        bar = null;
        panel = null;
        bindings.length = 0;
      }
    };
  })();

  /* ==========================================================================
   * 13. Deep loading
   *
   * YouTube loads more results when its own continuation sentinel scrolls into
   * view. Rather than reimplementing the continuation API (which would need
   * page-context tokens and would break whenever YouTube rotates them), the
   * sentinel is brought into view and the page's own loader is allowed to do
   * the work. The operation is bounded, cancellable, restores the scroll
   * position, and stops as soon as a batch produces no new results.
   * ======================================================================= */

  const DeepLoad = (() => {
    let running = false;
    let aborted = false;
    let done = 0;
    let total = 0;

    const countCards = (structure) => {
      let count = 0;
      for (const container of structure.containers) count += qa(container, ':scope > *').filter(YT.isCardElement).length;
      return count;
    };

    function waitForGrowth(structure, before, timeoutMs) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          try { observer.disconnect(); } catch (_e) { /* already gone */ }
          clearTimeout(timer);
          clearInterval(poll);
          resolve(value);
        };
        const observer = new MutationObserver(() => {
          if (countCards(structure) > before) finish(true);
        });
        try {
          observer.observe(structure.sectionListContents, { childList: true, subtree: true });
        } catch (_e) {
          finish(false);
          return;
        }
        const timer = setTimeout(() => finish(false), timeoutMs);
        const poll = setInterval(() => {
          if (aborted) finish(false);
          else if (countCards(structure) > before) finish(true);
        }, 250);
      });
    }

    return {
      get running() { return running; },
      get progress() { return { running, done, total }; },

      cancel() { aborted = true; },

      async run(batches, getStructure, onProgress) {
        if (running) { this.cancel(); return; }
        const structure0 = getStructure();
        if (!structure0) return;
        running = true;
        aborted = false;
        done = 0;
        total = clamp(batches, 1, LIMITS.deepLoadMaxBatches);
        const originY = window.scrollY;
        onProgress();
        try {
          for (let i = 0; i < total && !aborted; i++) {
            const structure = getStructure();
            if (!structure || !structure.sectionListContents) break;
            const sentinel = structure.continuation ||
              q(structure.sectionListContents, YT.SEL.continuation);
            if (!sentinel) break; // no further results exist
            const before = countCards(structure);
            try {
              sentinel.scrollIntoView({ block: 'end', behavior: 'auto' });
            } catch (_e) {
              window.scrollTo(0, document.documentElement.scrollHeight);
            }
            const grew = await waitForGrowth(structure, before, LIMITS.deepLoadStepTimeoutMs);
            done = i + 1;
            onProgress();
            if (!grew) break;
          }
        } catch (err) {
          Diag.error('deep load failed', err);
        } finally {
          running = false;
          aborted = false;
          try { window.scrollTo({ top: originY, behavior: 'auto' }); } catch (_e) { window.scrollTo(0, originY); }
          onProgress();
        }
      }
    };
  })();

  /* ==========================================================================
   * 14. Controller: lifecycle, observation and the processing pass
   * ======================================================================= */

  const Controller = (() => {
    let globalScope = null;     // lives for the whole document
    let pageScope = null;       // lives for one results page (search or channel)
    let scheduler = null;
    let structure = null;
    let pageCtx = { type: PAGE.none };
    let pageIdentity = null;    // channel identity of a channel page
    let pagePolicy = null;
    let records = [];
    let stats = null;
    let inResultsQuery = '';
    let currentKey = '';
    let cachedTerms = [];
    let cachedTermsFor = '';
    let observedContainers = new Map();
    let sectionObserver = null;
    let structureWatcher = null;
    let structureWatchArms = 0;
    let lastPassAt = 0;
    let passCount = 0;
    let autoLoadUsed = 0;
    let precisionNotice = '';
    let orderingBlocked = false;
    let activeContexts = [];
    let derivedConfig = { source: null, pageType: '', value: null };
    let orderingConfig = { source: null, key: '', value: null };

    const searchKey = () => {
      const url = safeUrl(location.href);
      if (!url) return '';
      return `${url.pathname}?${url.searchParams.get('search_query') || url.searchParams.get('query') || ''}&${url.searchParams.get('sp') || ''}`;
    };

    const currentQueryText = () => {
      const url = safeUrl(location.href);
      if (!url) return '';
      return url.searchParams.get('search_query') || url.searchParams.get('query') || '';
    };

    const terms = () => {
      const query = currentQueryText();
      if (cachedTermsFor !== query) {
        cachedTerms = queryTerms(query);
        cachedTermsFor = query;
      }
      return cachedTerms;
    };

    const regionCode = () => {
      const configured = Config.value.content.regionCode;
      if (configured) return configured.toUpperCase();
      const locale = (navigator.language || '').split('-')[1];
      return locale ? locale.toUpperCase() : '';
    };

    /**
     * On channel pages the global search configuration is opt-in: by default
     * only channel policies, personal verdicts and clustering apply, so opening
     * a channel does not silently hide most of its catalogue.
     */
    function configForPage(config, pageType) {
      if (pageType === PAGE.search) return config;
      if (derivedConfig.source === config && derivedConfig.pageType === pageType) return derivedConfig.value;
      const defaults = defaultsOf(CONFIG_SCHEMA);
      const derived = Object.assign({}, config);
      if (!config.channelPages.applyGlobalFilters) {
        derived.filters = Object.assign({}, defaults.filters, {
          hidePromoted: config.filters.hidePromoted,
          hideDuplicates: config.filters.hideDuplicates,
          hideShelves: config.filters.hideShelves,
          hideShortsShelves: config.filters.hideShortsShelves
        });
        derived.content = defaults.content;
        derived.style = defaults.style;
        derived.scripts = defaults.scripts;
      }
      if (!config.channelPages.applySort) {
        derived.sort = Object.assign({}, config.sort, { mode: 'relevance' });
        derived.ranking = Object.assign({}, config.ranking, { groupBy: 'none' });
      }
      derivedConfig = { source: config, pageType, value: derived };
      return derived;
    }

    /**
     * Sort and grouping are page-level decisions, so they are resolved once per
     * pass: context profiles override the global setting, and the policy of the
     * channel whose page is open overrides both (its results are the whole
     * list, so a per-channel ordering is meaningful there).
     */
    function withPageOrdering(config, contexts, policy) {
      let sortMode = config.sort.mode;
      let groupBy = config.ranking.groupBy;
      for (const profile of contexts) {
        if (profile.rules.sortMode !== 'inherit') sortMode = profile.rules.sortMode;
        if (profile.rules.groupBy !== 'inherit') groupBy = profile.rules.groupBy;
      }
      if (policy && Channels.isActive(policy)) {
        if (policy.rules.sortMode !== 'inherit') sortMode = policy.rules.sortMode;
        if (policy.rules.groupBy !== 'inherit') groupBy = policy.rules.groupBy;
      }
      if (sortMode === config.sort.mode && groupBy === config.ranking.groupBy) return config;
      const key = `${sortMode}|${groupBy}`;
      if (orderingConfig.source === config && orderingConfig.key === key) return orderingConfig.value;
      const derived = Object.assign({}, config, {
        sort: Object.assign({}, config.sort, { mode: sortMode }),
        ranking: Object.assign({}, config.ranking, { groupBy })
      });
      orderingConfig = { source: config, key, value: derived };
      return derived;
    }

    /* --- card collection ---------------------------------------------------- */

    function collect() {
      const found = [];
      let order = 0;
      for (const container of structure.containers) {
        const children = qa(container, ':scope > *');
        for (let i = 0; i < children.length; i++) {
          const node = children[i];
          if (!YT.isCardElement(node)) continue;
          View.rememberHome(node, container, i);
          found.push(CardStore.read(node, order++, pageIdentity));
          if (found.length >= LIMITS.maxCardsPerPass) {
            Diag.warn(`card limit reached (${LIMITS.maxCardsPerPass}); remaining results are left untouched`);
            return found;
          }
        }
      }
      return found;
    }

    /* --- the pass ----------------------------------------------------------- */

    function pass() {
      if (!pageScope || pageScope.disposed) return;
      if (document.hidden) return;
      lastPassAt = Date.now();
      passCount++;

      structure = YT.findStructure(pageCtx);
      if (!structure || !structure.containers.length) {
        watchForStructure();
        return;
      }
      stopStructureWatch();
      attachObservers();
      View.ensureStyles();

      const rootConfig = Config.value;
      let config = configForPage(rootConfig, pageCtx.type);

      if (pageCtx.type !== PAGE.search) {
        pageIdentity = YT.pageChannelIdentity(pageCtx.identity);
        pagePolicy = Channels.lookup(pageIdentity);
      } else {
        pageIdentity = null;
        pagePolicy = null;
      }

      records = collect();

      if (!rootConfig.enabled) {
        for (const record of records) View.resetCard(record.el);
        View.restoreOrder(records);
        View.clearAllHighlights();
        detachResultObservers();
        UI.ensureMounted(structure);
        UI.updateBar({ total: records.length, visible: records.length, hidden: 0, byReason: {} }, { disabled: true });
        return;
      }

      // Attach cached precision data before evaluation.
      if (rootConfig.precision.enabled) {
        for (const record of records) {
          if (!record.videoId || record.enrichment) continue;
          const entry = Precision.get(record.videoId);
          if (entry) record.enrichment = entry;
        }
      }

      const url = safeUrl(location.href);
      const ctx = {
        pageType: pageCtx.type,
        query: currentQueryText(),
        queryKey: currentKey,
        queryTerms: terms(),
        hasYouTubeFilter: !!(url && url.searchParams.get('sp')),
        channelConfigured: !!pagePolicy,
        regionCode: regionCode(),
        inResultsQuery: fold(inResultsQuery),
        verifiedDetected: records.some((r) => r.isVerified)
      };
      activeContexts = Engine.activeContexts(config, ctx);
      ctx.activeContexts = activeContexts;
      config = withPageOrdering(config, activeContexts, pagePolicy);

      stats = Engine.run(records, config, ctx);

      // Ordering (and grouping).
      const wantsOrdering = config.sort.mode !== 'relevance' || config.ranking.groupBy !== 'none' ||
        (config.ranking.pinnedFirst && stats.pinned > 0);
      orderingBlocked = wantsOrdering && !structure.orderable;
      if (wantsOrdering && structure.orderable) {
        View.applyOrder(Engine.order(records, config), structure);
      } else {
        View.restoreOrder(records);
      }

      // Visual state.
      const highlightTerms = config.display.highlightQuery ? ctx.queryTerms : [];
      for (const record of records) {
        View.applyState(record, config, viewHandlers);
        if (config.display.highlightQuery) View.highlight(record, highlightTerms);
      }
      if (!config.display.highlightQuery) View.clearAllHighlights();

      // Personal memory: remember what the user was actually shown.
      if (config.memory.trackSeen) {
        for (const record of records) {
          if (!record.hidden && record.videoId && (record.kind === 'video' || record.kind === 'short')) {
            Memory.markSeen(record.videoId, currentKey);
          }
        }
      }

      // Precision lookups for the cards that actually need them.
      const precisionAllowed = rootConfig.precision.enabled &&
        (pageCtx.type === PAGE.search || rootConfig.precision.channelPages);
      if (precisionAllowed && stats.needsPrecision.length) {
        let scheduled = 0;
        for (const videoId of stats.needsPrecision) {
          if (scheduled >= 40) break;
          if (Precision.request(videoId)) scheduled++;
        }
      }
      const precisionStats = Precision.stats;
      precisionNotice = precisionStats.disabledReason || '';

      UI.ensureMounted(structure);
      UI.updateBar(stats, {
        pageType: pageCtx.type,
        contexts: stats.contexts,
        pageChannel: !!pageIdentity && !!(pageIdentity.channelId || pageIdentity.handle),
        channelPolicy: pagePolicy ? `${pagePolicy.name || pagePolicy.handle || pagePolicy.channelId} (${pagePolicy.mode})` : '',
        deepLoad: DeepLoad.progress,
        precisionPending: precisionAllowed ? precisionStats.queued + precisionStats.active : 0,
        precisionNotice,
        orderingBlocked,
        ruleErrors: Engine.compileErrors
      });

      maybeAutoLoad(config);
    }

    function maybeAutoLoad(config) {
      if (!config.deepLoad.autoWhenSparse || DeepLoad.running) return;
      if (!stats || stats.visible >= config.deepLoad.minVisible) return;
      if (!structure || !structure.continuation) return;
      if (autoLoadUsed >= config.deepLoad.batches) return;
      autoLoadUsed++;
      DeepLoad.run(1, () => structure, onDeepLoadProgress);
    }

    function onDeepLoadProgress() {
      UI.updateBar(stats, {
        pageType: pageCtx.type,
        contexts: activeContexts.map((c) => c.name),
        deepLoad: DeepLoad.progress,
        precisionNotice,
        ruleErrors: Engine.compileErrors
      });
      schedule();
    }

    const schedule = () => { if (scheduler) scheduler.schedule(); };

    /* --- observers ---------------------------------------------------------- */

    /**
     * Wait for YouTube to build the results tree. This is a broad observer, so
     * it is strictly bounded: it disconnects as soon as the structure exists,
     * after 15 seconds, and it may only be re-armed a few times per page.
     */
    function watchForStructure() {
      if (structureWatcher || structureWatchArms >= 5) return;
      const root = q(document, YT.SEL.app) || document.body;
      if (!root) return;
      const observer = new MutationObserver(() => schedule());
      try {
        observer.observe(root, { childList: true, subtree: true });
      } catch (err) {
        Diag.error('failed to watch for the results structure', err);
        return;
      }
      structureWatchArms++;
      structureWatcher = observer;
      const timeout = window.setTimeout(() => {
        if (structureWatcher === observer) {
          stopStructureWatch();
          Diag.warn('results container never appeared; waiting for the next navigation event');
        }
      }, 15000);
      pageScope.add(() => {
        clearTimeout(timeout);
        try { observer.disconnect(); } catch (_e) { /* detached */ }
      });
    }

    function detachResultObservers() {
      if (sectionObserver) {
        try { sectionObserver.observer.disconnect(); } catch (_e) { /* detached */ }
        sectionObserver = null;
      }
      for (const [container, observer] of Array.from(observedContainers)) {
        try { observer.disconnect(); } catch (_e) { /* detached */ }
        observedContainers.delete(container);
      }
      stopStructureWatch();
    }

    function stopStructureWatch() {
      if (!structureWatcher) return;
      try { structureWatcher.disconnect(); } catch (_e) { /* detached */ }
      structureWatcher = null;
    }

    function attachObservers() {
      if (!structure) return;

      if (!sectionObserver || sectionObserver.target !== structure.sectionListContents) {
        if (sectionObserver) {
          try { sectionObserver.observer.disconnect(); } catch (_e) { /* detached */ }
        }
        const observer = new MutationObserver(() => schedule());
        try {
          observer.observe(structure.sectionListContents, { childList: true });
          sectionObserver = { observer, target: structure.sectionListContents };
          pageScope.add(() => { try { observer.disconnect(); } catch (_e) { /* detached */ } });
        } catch (err) {
          Diag.error('failed to observe the results section list', err);
        }
      }

      for (const container of structure.containers) {
        if (observedContainers.has(container)) continue;
        const observer = new MutationObserver(() => schedule());
        try {
          observer.observe(container, { childList: true });
          observedContainers.set(container, observer);
          pageScope.add(() => { try { observer.disconnect(); } catch (_e) { /* detached */ } });
        } catch (err) {
          Diag.error('failed to observe a results container', err);
        }
      }

      for (const [container, observer] of Array.from(observedContainers)) {
        if (!container.isConnected) {
          try { observer.disconnect(); } catch (_e) { /* detached */ }
          observedContainers.delete(container);
        }
      }
    }

    /* --- card & UI handlers --------------------------------------------------- */

    const identityOf = (record) => ({
      channelId: record.channelId || '',
      handle: record.channelHandle || '',
      name: record.channelName || ''
    });

    const viewHandlers = {
      onBlockChannel(node) {
        const record = CardStore.peek(node);
        if (!record) return;
        const identity = identityOf(record);
        if (!identity.channelId && !identity.handle && !identity.name) return;
        const policy = Channels.upsert(Object.assign({}, identity, { mode: 'blocked', enabled: true }), 'card');
        if (policy) Diag.info(`channel policy created: ${policy.key} → blocked`);
        schedule();
      },
      onChannelPolicy(node) {
        const record = CardStore.peek(node);
        if (!record) return;
        UI.openChannelEditor(identityOf(record));
      },
      onPin(node) {
        const record = CardStore.peek(node);
        if (!record || !record.videoId) return;
        Memory.setVerdict(record.videoId, record.verdict === 'pin' ? '' : 'pin');
        schedule();
      },
      onMute(node) {
        const record = CardStore.peek(node);
        if (!record || !record.videoId) return;
        Memory.setVerdict(record.videoId, record.verdict === 'mute' ? '' : 'mute');
        schedule();
      },
      onSnooze(node) {
        const record = CardStore.peek(node);
        if (!record || !record.videoId) return;
        Memory.setVerdict(record.videoId, record.verdict === 'snooze' ? '' : 'snooze', 7);
        schedule();
      },
      onReveal(node) {
        const record = CardStore.peek(node);
        if (!record) return;
        record.forceVisible = true;
        View.applyState(record, configForPage(Config.value, pageCtx.type), viewHandlers);
      }
    };

    const uiHandlers = {
      onInResultsQuery(value) {
        inResultsQuery = String(value || '').trim();
        schedule();
      },
      onDeepLoad() {
        if (DeepLoad.running) { DeepLoad.cancel(); return; }
        DeepLoad.run(Config.value.deepLoad.batches, () => structure, onDeepLoadProgress);
      },
      onNavigate(href) {
        const url = safeUrl(href);
        if (!url) return;
        if (!/(^|\.)youtube\.com$/.test(url.hostname)) return;
        location.assign(url.toString());
      },
      onEditPageChannel() {
        UI.openChannelEditor(pageIdentity || {});
      },
      getPageChannel() {
        if (pageIdentity && (pageIdentity.channelId || pageIdentity.handle || pageIdentity.name)) return pageIdentity;
        for (const record of records) {
          if (record.channelId || record.channelHandle) return identityOf(record);
        }
        return null;
      },
      getDiagnostics() {
        const precision = Precision.stats;
        const memoryStats = Memory.stats;
        return {
          rows: [
            ['Script', `${APP.name} ${APP.version}`],
            ['Userscript manager', `${RUNTIME.handler} ${RUNTIME.handlerVersion}`],
            ['Storage backend', Store.backend],
            ['Interface locale', LocaleParser.locale],
            ['Page type', pageCtx.type],
            ['Active page', currentKey || '(none)'],
            ['Page channel', pageIdentity ? `${pageIdentity.name || ''} ${pageIdentity.handle || ''} ${pageIdentity.channelId || ''}`.trim() : '—'],
            ['Channel policy in force', pagePolicy ? `${pagePolicy.key} (${pagePolicy.mode})` : 'none'],
            ['Channel policies stored', Channels.size],
            ['Context profiles active', activeContexts.length ? activeContexts.map((c) => c.name).join(', ') : 'none'],
            ['Results loaded', records.length],
            ['Visible / filtered', stats ? `${stats.visible} / ${stats.hidden}` : '—'],
            ['Decisions by scope', stats ? Object.keys(stats.byScope).map((k) => `${k}: ${stats.byScope[k]}`).join(', ') || 'none' : '—'],
            ['Pinned videos', stats ? stats.pinned : 0],
            ['Processing passes', passCount],
            ['Last pass', lastPassAt ? new Date(lastPassAt).toLocaleTimeString() : '—'],
            ['Sort / group', `${Config.value.sort.mode} / ${Config.value.ranking.groupBy}`],
            ['Cards re-ordered', String(View.consolidated)],
            ['Precision cache', `${precision.cached} entries`],
            ['Precision requests', `${precision.successes} ok / ${precision.failures} failed`],
            ['Memory', `${memoryStats.verdicts} verdicts / ${memoryStats.seen} seen`],
            ['Title parse failures', CardStore.parseFailures],
            ['Errors recorded', Diag.errorCount],
            ['Capabilities', Object.keys(CAPS).filter((k) => CAPS[k]).join(', ') || 'none'],
            ['Config issues', Config.issues.length ? Config.issues.slice(0, 3).join('; ') : 'none']
          ],
          log: Diag.snapshot()
        };
      }
    };

    /* --- keyboard ------------------------------------------------------------ */

    function comboOf(event) {
      const parts = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Meta');
      const key = event.key;
      if (!key || ['Shift', 'Control', 'Alt', 'Meta'].indexOf(key) !== -1) return '';
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      return parts.join('+');
    }

    function isEditableTarget(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      const node = path[0];
      if (!node || node.nodeType !== 1) return false;
      const tag = node.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (node.isContentEditable) return true;
      return false;
    }

    function onKeydown(event) {
      const config = Config.value;
      if (!config.shortcuts.enabled) return;
      if (event.defaultPrevented) return;
      if (isEditableTarget(event)) return;
      const combo = comboOf(event);
      if (!combo) return;
      const map = config.shortcuts;
      if (combo === map.togglePanel) {
        event.preventDefault();
        UI.togglePanel();
      } else if (combo === map.toggleHidden) {
        event.preventDefault();
        Config.setPath('display.showHidden', !config.display.showHidden, 'shortcut');
      } else if (combo === map.cycleSort) {
        event.preventDefault();
        const index = SORT_MODES.findIndex((m) => m.id === config.sort.mode);
        const next = SORT_MODES[(index + 1) % SORT_MODES.length];
        Config.setPath('sort.mode', next.id, 'shortcut');
      } else if (combo === map.focusSearch) {
        if (UI.focusInResultsSearch()) event.preventDefault();
      } else if (combo === map.blockChannel) {
        const identity = uiHandlers.getPageChannel();
        if (identity) {
          event.preventDefault();
          UI.openChannelEditor(identity);
        }
      }
    }

    /* --- activation / deactivation -------------------------------------------- */

    function pageSupported(context) {
      if (context.type === PAGE.search) return true;
      if (context.type === PAGE.channelGrid || context.type === PAGE.channelSearch) {
        return Config.value.channelPages.enabled;
      }
      return false;
    }

    function activate() {
      if (pageScope && !pageScope.disposed) return;
      pageScope = createDisposer('results-page');
      scheduler = createScheduler(guard('pass', pass), LIMITS.passIntervalMs);
      pageScope.add(() => scheduler.destroy());
      observedContainers = new Map();
      sectionObserver = null;
      structureWatcher = null;
      structureWatchArms = 0;
      records = [];
      stats = null;
      autoLoadUsed = 0;
      currentKey = searchKey();
      View.resetConsolidated();
      Engine.resetCaches();
      Precision.cancelAll();

      pageScope.add(() => {
        UI.unmount();
        View.clearAllHighlights();
        View.removeGroupHeaders(null);
        for (const record of records) {
          try { View.resetCard(record.el); } catch (_e) { /* card already gone */ }
        }
        records = [];
        DeepLoad.cancel();
        Precision.cancelAll();
        Memory.flush();
      });

      Diag.info(`activated (${pageCtx.type}) for ${currentKey}`);
      schedule();
    }

    function deactivate() {
      if (!pageScope || pageScope.disposed) return;
      Diag.info('deactivated');
      pageScope.dispose();
      pageScope = null;
      scheduler = null;
      structure = null;
      stats = null;
      pageIdentity = null;
      pagePolicy = null;
      activeContexts = [];
    }

    function onLocationChange() {
      const context = YT.pageContext();
      const changedType = context.type !== pageCtx.type;
      pageCtx = context;
      if (!pageSupported(context)) {
        deactivate();
        return;
      }
      // A navigation can update cards in place (watched progress, badges), so
      // whatever survives on the page is re-read on the next pass.
      CardStore.invalidate(records);
      const key = searchKey();
      if (pageScope && !pageScope.disposed && (key !== currentKey || changedType)) {
        currentKey = key;
        inResultsQuery = '';
        UI.clearInResultsSearch();
        autoLoadUsed = 0;
        records = [];
        stats = null;
        cachedTermsFor = '';
        pageIdentity = null;
        pagePolicy = null;
        View.resetConsolidated();
        View.removeGroupHeaders(null);
        Engine.resetCaches();
        Precision.cancelAll();
        DeepLoad.cancel();
      }
      activate();
      schedule();
    }

    return {
      start(scope) {
        globalScope = scope;

        Config.subscribe(() => {
          Diag.setDebug(Config.value.advanced.debug);
          UI.syncFields();
          // A configuration change can enable/disable channel-page support.
          const context = YT.pageContext();
          if (!pageSupported(context)) deactivate();
          else { pageCtx = context; activate(); }
          schedule();
        });

        Channels.subscribe(() => schedule());
        Memory.subscribe(() => schedule());

        Precision.setResultHandler((videoId, entry) => {
          for (const record of records) {
            if (record.videoId === videoId) record.enrichment = entry;
          }
          schedule();
        });
        Precision.setIdentityHandler((identity) => {
          if (Channels.learnIdentity(identity)) schedule();
        });

        UI.mount(uiHandlers, globalScope);

        const navigationHandler = guard('navigation', () => onLocationChange());
        for (const type of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate', 'hashchange']) {
          globalScope.listen(window, type, navigationHandler, true);
        }
        if (CAPS.navigationApi) {
          globalScope.listen(window.navigation, 'navigatesuccess', navigationHandler);
        }
        if (CAPS.onUrlChange) {
          try {
            window.addEventListener('urlchange', navigationHandler);
            globalScope.add(() => window.removeEventListener('urlchange', navigationHandler));
          } catch (_e) { /* manager-specific, optional */ }
        }

        globalScope.listen(window, 'pageshow', (event) => {
          if (event.persisted) {
            View.resetConsolidated();
            records = [];
          }
          navigationHandler();
        });
        globalScope.listen(document, 'visibilitychange', () => { if (!document.hidden) schedule(); });
        globalScope.listen(window, 'pagehide', (event) => {
          Precision.flush();
          Memory.flush();
          Store.flushAll();
          if (!event.persisted) this.stop();
        });
        globalScope.listen(document, 'keydown', guard('shortcut', onKeydown), true);

        onLocationChange();
      },

      stop() {
        deactivate();
        UI.destroy();
        View.removeStyles();
        if (globalScope) globalScope.dispose();
        globalScope = null;
      },

      get isActive() { return !!(pageScope && !pageScope.disposed); },
      get pageType() { return pageCtx.type; }
    };
  })();

  /* ==========================================================================
   * 15. Bootstrap
   * ======================================================================= */

  function whenBodyReady() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (!document.body) return false;
        observer.disconnect();
        document.removeEventListener('DOMContentLoaded', onReady);
        resolve();
        return true;
      };
      const onReady = () => { done(); };
      const observer = new MutationObserver(() => { done(); });
      try { observer.observe(document.documentElement, { childList: true }); } catch (_e) { /* pre-parse */ }
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
      // In case body appeared between the check and the observer being wired.
      done();
    });
  }

  function registerMenuCommands(scope) {
    if (!CAPS.gmMenu) return; // e.g. Greasemonkey 4: the in-page button is the entry point
    const register = (label, fn) => {
      try {
        if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
        else if (typeof GM !== 'undefined' && GM && typeof GM.registerMenuCommand === 'function') GM.registerMenuCommand(label, fn);
      } catch (err) {
        Diag.warn('menu command registration failed', err && err.message);
      }
    };
    register(`${APP.short}: open filter panel`, () => {
      if (!isSearchLocation()) {
        Diag.info('panel requested outside a search page');
      }
      UI.openPanel();
    });
    register(`${APP.short}: toggle filtering`, () => Config.setPath('enabled', !Config.value.enabled, 'menu'));
    register(`${APP.short}: show / hide filtered results`, () => Config.setPath('display.showHidden', !Config.value.display.showHidden, 'menu'));
    register(`${APP.short}: channel policies`, () => UI.openPanel('channels'));
    scope.add(() => { /* menu commands are owned by the manager for the tab's lifetime */ });
  }

  async function bootstrap() {
    // @noframes covers every mainstream manager; this is a cheap belt-and-braces
    // guard for environments that ignore it.
    if (window.top !== window.self) return;

    const scope = createDisposer('document');
    try {
      await Config.load();
    } catch (err) {
      Diag.error('configuration could not be loaded; using defaults', err);
    }

    if (!Store.available) {
      Diag.warn('no storage backend available: settings will not persist in this session');
    }

    try {
      await Channels.load();
    } catch (err) {
      Diag.error('channel policies could not be loaded', err);
    }

    try {
      await Memory.load();
    } catch (err) {
      Diag.error('personal memory could not be loaded', err);
    }

    try {
      await Precision.init();
    } catch (err) {
      Diag.error('precision cache could not be loaded', err);
    }

    await whenBodyReady();

    // The document language can arrive after our first read; recompute the
    // locale vocabulary once the document is parsed.
    LocaleParser.reset();

    registerMenuCommands(scope);
    Controller.start(scope);

    Diag.info(`${APP.name} ${APP.version} ready (${RUNTIME.handler}, storage: ${Store.backend}, ` +
      `${Channels.size} channel policies)`);
  }

  bootstrap().catch((err) => {
    // A failure here must not leave YouTube in a broken state.
    console.error(`[${APP.short}] fatal initialisation error`, err);
  });
})();
