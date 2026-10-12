// SPDX-License-Identifier: AGPL-3.0-or-later
// ==UserScript==
// @name         YTShareAntiTrack
// @namespace    https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/yt-share-antitrack
// @version      2.0.0
// @description  Removes tracking parameters (si, feature, utm_*, …) from YouTube share links — desktop, mobile web and YouTube Music. Event-driven, configuration, clipboard interception; everything stays local, no telemetry.
// @author       Shivansh Jain
// @license      AGPL-3.0-or-later
// @homepageURL  https://github.com/shivanshjain456/browser-workflow-tools/tree/main/scripts/yt-share-antitrack
// @supportURL   https://github.com/shivanshjain456/browser-workflow-tools/issues
// @downloadURL  https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/yt-share-antitrack/yt-share-antitrack.user.js
// @updateURL    https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/scripts/yt-share-antitrack/yt-share-antitrack.user.js
// @icon         https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-32.png
// @icon64       https://raw.githubusercontent.com/shivanshjain456/browser-workflow-tools/main/assets/brand/png/browser-workflow-tools-mark-64.png
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.youtube.com/*
// @noframes
// @run-at       document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.setClipboard
// @grant        GM.registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @compatible   tampermonkey
// @compatible   violentmonkey
// @compatible   greasemonkey
// ==/UserScript==

(function () {
	'use strict';

	/* ======================================================================
	 * 1. Constants
	 * ==================================================================== */

	const SCRIPT_NAME = 'YTShareAntiTrack';
	const VERSION = '2.0.0';
	const LOG_PREFIX = '[YTShareAntiTrack]';

	// Storage keys. New, versioned keys; the legacy "transitionPageVisited"
	// flag written by 1.x is intentionally left untouched (inert, one byte,
	// deleting it would require an extra grant).
	const CONFIG_KEY = 'config.v2';
	const STATS_KEY = 'stats.v1';

	// Double-execution guard, shared-realm symbol survives SPA lifetime.
	const BOOT_SYMBOL = Symbol.for('ytshareantitrack.booted');

	// Fields that display a share URL. #share-url is the desktop share
	// dialog input (inside yt-copy-link-renderer); the class covers the
	// mobile web bottom sheet. Copy-link renderer fallbacks keep this
	// working if the id/class ever changes while the renderer tag remains.
	const BASE_FIELD_SELECTORS = Object.freeze([
		'input#share-url',
		'#share-url',
		'.unified-share-url-input',
		'yt-copy-link-renderer input',
		'ytd-copy-link-renderer input',
		'ytm-copy-link-renderer input',
		'ytmusic-copy-link-renderer input',
	]);

	// Elements considered a share surface for clipboard interception.
	const PANEL_ROOT_SELECTOR = [
		'yt-copy-link-renderer',
		'ytd-copy-link-renderer',
		'ytm-copy-link-renderer',
		'ytmusic-copy-link-renderer',
		'ytd-unified-share-panel-renderer',
		'ytm-unified-share-panel-renderer',
		'ytmusic-unified-share-panel-renderer',
		'ytd-sharing-renderer',
		'ytd-share-panel-renderer',
		'yt-share-panel-renderer',
		'ytmusic-share-panel-renderer',
		'yt-dialog-renderer',
		'tp-yt-paper-dialog',
		'paper-dialog',
		'[class*="unified-share"]',
	].join(',');

	// Interactive controls inside a share surface that may copy the URL.
	// Anchors are deliberately excluded: social-share links inside the
	// panel must keep navigating normally.
	const COPY_CONTROL_SELECTOR = [
		'button',
		'yt-button-renderer',
		'ytd-button-renderer',
		'ytmusic-button-renderer',
		'ytm-button-renderer',
		'yt-icon-button',
		'paper-icon-button',
		'tp-yt-paper-icon-button',
		'paper-button',
		'[role="button"]',
	].join(',');

	// Known tracker names removed in blocklist mode and used for
	// statistics in allowlist mode. Names are matched case-insensitively.
	const TRACKER_EXACT = Object.freeze([
		'si',            // YouTube / Spotify style per-share source identifier
		'feature',       // legacy YouTube feature=share attribution
		'pp',            // playback context blob attached to shared links
		'ab_channel',    // channel attribution
		'time_continue', // legacy comment deep-link marker
		'ref', 'ref_src', 'ved', 'spm', 'scm', 'kw',
		'gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'igshid',
		'msclkid', 'twclid', 'li_fat_id', 'mc_cid', 'mc_eid', 'mibextid',
	]);
	const TRACKER_PREFIXES = Object.freeze(['utm_']);

	/* ======================================================================
	 * 2. Tiny utilities
	 * ==================================================================== */

	function isFn(v) { return typeof v === 'function'; }
	function isObj(v) { return v !== null && typeof v === 'object'; }
	function clampStr(v, max) {
		const s = String(v);
		return s.length > max ? s.slice(0, max - 1) + '…' : s;
	}

	// Exception isolation for callbacks crossing into live DOM / events.
	function guard(fn, label) {
		return function () {
			try { return fn.apply(null, arguments); }
			catch (err) { Log.error(label || 'handler', err); return undefined; }
		};
	}

	/* ======================================================================
	 * 3. Logging — quiet by default, never builds strings when disabled
	 * ==================================================================== */

	const Log = {
		info(...args) { try { console.info(LOG_PREFIX, ...args); } catch (_) {} },
		warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch (_) {} },
		error(...args) { try { console.error(LOG_PREFIX, ...args); } catch (_) {} },
		debug(...args) {
			if (!Config.ready || !Config.get('verbose')) return;
			try { console.debug(LOG_PREFIX, ...args); } catch (_) {}
		},
	};

	/* ======================================================================
	 * 4. Environment bridge — userscript-manager and browser capabilities
	 *    detected once, every access wrapped so a missing grant can never
	 *    take the script down.
	 * ==================================================================== */

	const Bridge = (() => {
		const gmDot = (typeof GM !== 'undefined' && isObj(GM)) ? GM : null;
		const memStore = new Map();

		let lsStore = null;
		try {
			const probe = '__ytsa_probe__';
			window.localStorage.setItem(probe, '1');
			window.localStorage.removeItem(probe);
			lsStore = window.localStorage;
		} catch (_) { lsStore = null; }

		const has = {
			gmGet: !!(gmDot && isFn(gmDot.getValue)),
			gmSet: !!(gmDot && isFn(gmDot.setValue)),
			gmClip: !!(gmDot && isFn(gmDot.setClipboard)),
			gmMenu: !!(gmDot && isFn(gmDot.registerMenuCommand)),
			legacyGet: (typeof GM_getValue !== 'undefined') && isFn(GM_getValue),
			legacySet: (typeof GM_setValue !== 'undefined') && isFn(GM_setValue),
			legacyClip: (typeof GM_setClipboard !== 'undefined') && isFn(GM_setClipboard),
			legacyMenu: (typeof GM_registerMenuCommand !== 'undefined') && isFn(GM_registerMenuCommand),
			webClip: !!(navigator.clipboard && isFn(navigator.clipboard.writeText)),
		};

		async function storageGet(key, fallback) {
			// GM.* promise-style
			if (has.gmGet) {
				try {
					const v = await gmDot.getValue(key);
					if (v !== undefined && v !== null) return v;
				} catch (_) { /* fall through */ }
			}
			// Legacy GM_* (sync or promise-like depending on manager)
			if (has.legacyGet) {
				try {
					let v = GM_getValue(key);
					if (v && isFn(v.then)) v = await v;
					if (v !== undefined && v !== null) return v;
				} catch (_) { /* fall through */ }
			}
			// Namespaced localStorage
			if (lsStore) {
				try {
					const raw = lsStore.getItem('ytsat.' + key);
					if (raw !== null) return JSON.parse(raw);
				} catch (_) { /* fall through */ }
			}
			// Volatile memory
			if (memStore.has(key)) return memStore.get(key);
			return fallback;
		}

		async function storageSet(key, value) {
			memStore.set(key, value);
			let ok = false;
			if (has.gmSet) {
				try { await gmDot.setValue(key, value); ok = true; }
				catch (err) { Log.warn('GM.setValue rejected; falling back', err); }
			}
			if (!ok && has.legacySet) {
				try { const r = GM_setValue(key, value); if (r && isFn(r.then)) await r; ok = true; }
				catch (_) { /* fall through */ }
			}
			if (!ok && lsStore) {
				try { lsStore.setItem('ytsat.' + key, JSON.stringify(value)); ok = true; }
				catch (_) { /* fall through */ }
			}
			return ok; // memory fallback always holds, so callers never break
		}

		async function clipboardWrite(text) {
			if (has.webClip) {
				try { await navigator.clipboard.writeText(text); return true; }
				catch (_) { /* permission denied / not focused → fall through */ }
			}
			if (has.gmClip) {
				try { await gmDot.setClipboard(text); return true; }
				catch (_) { /* fall through */ }
			}
			if (has.legacyClip) {
				try { GM_setClipboard(text); return true; }
				catch (_) { /* fall through */ }
			}
			// Last-resort execCommand path (deprecated but still functional
			// under a transient user activation in all relevant browsers).
			try {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.setAttribute('readonly', '');
				ta.style.cssText = 'position:fixed;top:-200px;left:-200px;opacity:0;';
				(document.body || document.documentElement).appendChild(ta);
				ta.select();
				const ok = document.execCommand('copy');
				ta.remove();
				return ok;
			} catch (_) { return false; }
		}

		function menuCommand(label, fn) {
			if (has.gmMenu) {
				try { gmDot.registerMenuCommand(label, fn); return true; } catch (_) {}
			}
			if (has.legacyMenu) {
				try { GM_registerMenuCommand(label, fn); return true; } catch (_) {}
			}
			return false;
		}

		return { has, storageGet, storageSet, clipboardWrite, menuCommand };
	})();

	/* ======================================================================
	 * 5. Configuration — defaults, validation, versioned persistence
	 * ==================================================================== */

	const CONFIG_SCHEMA = 2;
	const CONFIG_DEFAULTS = Object.freeze({
		schema: CONFIG_SCHEMA,
		// 'allowlist' = strict semantics: drop everything except known-good.
		// 'blocklist' = keep unknown params, strip known trackers only.
		mode: 'allowlist',
		allowParams: ['t', 'list', 'index', 'v'],
		extraAllowParams: [],
		extraDenyParams: [],
		interceptCopyButton: true,
		sanitizeManualCopy: true,
		cleanAddressBar: false,
		showToasts: true,
		verbose: false,
		statsEnabled: true,
		extraFieldSelectors: [],
	});

	const PARAM_NAME_RE = /^[A-Za-z0-9_\-]{1,32}$/;
	const BOOL_KEYS = Object.keys(CONFIG_DEFAULTS).filter(
		(k) => typeof CONFIG_DEFAULTS[k] === 'boolean'
	);

	function sanitizeParamList(value, fallback) {
		if (!Array.isArray(value)) return fallback.slice();
		const out = [];
		for (const item of value) {
			if (typeof item !== 'string') continue;
			const name = item.trim();
			if (!PARAM_NAME_RE.test(name)) continue;
			if (!out.includes(name)) out.push(name);
			if (out.length >= 64) break;
		}
		return out;
	}

	function sanitizeSelectorList(value, fallback) {
		if (!Array.isArray(value)) return fallback.slice();
		const out = [];
		for (const item of value) {
			if (typeof item !== 'string') continue;
			const sel = item.trim().slice(0, 160);
			if (!sel) continue;
			if (!out.includes(sel)) out.push(sel);
			if (out.length >= 8) break;
		}
		return out;
	}

	function sanitizeConfig(raw) {
		const cfg = Object.assign({}, CONFIG_DEFAULTS);
		if (!isObj(raw)) return cfg;
		if (raw.mode === 'allowlist' || raw.mode === 'blocklist') cfg.mode = raw.mode;
		cfg.allowParams = sanitizeParamList(raw.allowParams, CONFIG_DEFAULTS.allowParams);
		cfg.extraAllowParams = sanitizeParamList(raw.extraAllowParams, []);
		cfg.extraDenyParams = sanitizeParamList(raw.extraDenyParams, []);
		cfg.extraFieldSelectors = sanitizeSelectorList(raw.extraFieldSelectors, []);
		for (const key of BOOL_KEYS) {
			if (typeof raw[key] === 'boolean') cfg[key] = raw[key];
		}
		return cfg;
	}

	const Config = {
		ready: false,
		revision: 0, // bumped on every change; used to invalidate derived caches
		_data: Object.assign({}, CONFIG_DEFAULTS),
		_saveTimer: 0,

		async load() {
			try {
				const raw = await Bridge.storageGet(CONFIG_KEY, null);
				if (typeof raw === 'string') {
					this._data = sanitizeConfig(JSON.parse(raw));
				} else if (isObj(raw)) {
					this._data = sanitizeConfig(raw);
				} else {
					this._data = Object.assign({}, CONFIG_DEFAULTS);
				}
			} catch (err) {
				Log.warn('Config load failed; using defaults', err);
				this._data = Object.assign({}, CONFIG_DEFAULTS);
			}
			this.ready = true;
			this.revision++;
			return this._data;
		},

		get(key) { return this._data[key]; },
		all() { return Object.assign({}, this._data); },

		setAll(patch) {
			// Validate the merged result: keys absent from the patch keep
			// their current values instead of snapping back to defaults.
			this._data = sanitizeConfig(Object.assign({}, this._data, patch));
			this.revision++;
			this._persistSoon();
		},

		_persistSoon() {
			clearTimeout(this._saveTimer);
			this._saveTimer = setTimeout(guard(() => {
				Bridge.storageSet(CONFIG_KEY, JSON.stringify(this._data))
					.then((ok) => { if (!ok) Log.warn('Config persisted to memory only'); });
			}, 'config-persist'), 400);
		},
	};

	/* ======================================================================
	 * 6. Statistics — local-only counters, disable-able, never transmitted
	 * ==================================================================== */

	const Stats = {
		ready: false,
		_data: { cleaned: 0, paramsRemoved: 0, copies: 0, since: Date.now() },
		_saveTimer: 0,

		async load() {
			try {
				const raw = await Bridge.storageGet(STATS_KEY, null);
				const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
				if (isObj(obj)) {
					for (const k of ['cleaned', 'paramsRemoved', 'copies']) {
						const n = Number(obj[k]);
						if (Number.isFinite(n) && n >= 0) this._data[k] = Math.min(n, 1e12);
					}
					const since = Number(obj.since);
					if (Number.isFinite(since) && since > 0) this._data.since = since;
				}
			} catch (_) { /* keep zeros */ }
			this.ready = true;
		},

		bump(key, amount) {
			if (!Config.ready || !Config.get('statsEnabled')) return;
			this._data[key] = (this._data[key] || 0) + (amount || 1);
			clearTimeout(this._saveTimer);
			this._saveTimer = setTimeout(guard(() => this.flush(), 'stats-save'), 1000);
		},

		flush() {
			if (!Config.ready || !Config.get('statsEnabled')) return;
			Bridge.storageSet(STATS_KEY, JSON.stringify(this._data));
		},

		reset() {
			this._data = { cleaned: 0, paramsRemoved: 0, copies: 0, since: Date.now() };
			Bridge.storageSet(STATS_KEY, JSON.stringify(this._data));
		},

		get data() { return Object.assign({}, this._data); },
	};

	/* ======================================================================
	 * 7. URL sanitizer — the heart of the script.
	 *    Standards-based, duplicate-safe, fragment-preserving.
	 * ==================================================================== */

	const UrlEngine = (() => {
		const trackerExact = new Set(TRACKER_EXACT.map((s) => s.toLowerCase()));
		let cache = { revision: -1, mode: null, allow: null, deny: null, denyPrefixes: [] };

		// Precompute policy sets per config revision to avoid re-allocating
		// them on every share-field write.
		function policy() {
			if (cache.revision === Config.revision) return cache;
			const allow = new Set(Config.get('allowParams') || []);
			for (const p of Config.get('extraAllowParams') || []) allow.add(p);
			const deny = new Set(trackerExact);
			for (const p of Config.get('extraDenyParams') || []) deny.add(p.toLowerCase());
			cache = {
				revision: Config.revision,
				mode: Config.get('mode'),
				allow,
				deny,
				denyPrefixes: TRACKER_PREFIXES,
			};
			return cache;
		}

		function isDenied(nameLower, pol) {
			if (pol.deny.has(nameLower)) return true;
			for (const prefix of pol.denyPrefixes) {
				if (nameLower.startsWith(prefix)) return true;
			}
			return false;
		}

		/**
		 * Sanitize a raw string as a URL.
		 * @returns {object} { ok, changed, url, removed[], removedCount, reason? }
		 */
		function sanitize(input, opts) {
			const result = { ok: false, changed: false, url: '', removed: [], removedCount: 0, reason: '' };
			if (typeof input !== 'string') { result.reason = 'non-string'; return result; }
			const raw = input.trim();
			if (!raw) { result.reason = 'empty'; return result; }
			if (raw.length > 32768) { result.reason = 'oversized'; return result; }

			let url;
			try { url = new URL(raw); }
			catch (_) {
				// Relative fallback only for inputs shaped like real relative
				// references; random garbage must be rejected, not resolved
				// into a fabricated absolute URL on the current host.
				if (!/^[/?.#]/.test(raw)) { result.reason = 'malformed'; return result; }
				try { url = new URL(raw, location.href); }
				catch (__) { result.reason = 'malformed'; return result; }
			}
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				result.reason = 'unsupported-scheme';
				return result;
			}

			const pol = policy();
			const forceBlocklist = !!(opts && opts.mode === 'blocklist');
			const mode = forceBlocklist ? 'blocklist' : pol.mode;

			const kept = [];
			const removed = [];
			if (url.search) {
				// URLSearchParams iteration is live; we do not mutate until the
				// loop is done, and we re-append kept pairs so duplicates of
				// allowed params (e.g. repeated "v") survive exactly.
				for (const pair of url.searchParams) {
					const name = pair[0];
					const lower = name.toLowerCase();
					let keep;
					if (mode === 'allowlist') {
						// Allowlist match preserves exact case semantics; the
						// always-deny list (trackers/user extras) still wins.
						keep = pol.allow.has(name) && !isDenied(lower, pol);
					} else {
						keep = !isDenied(lower, pol);
					}
					if (keep) kept.push(pair); else removed.push(name);
				}
			}

			if (removed.length) {
				const rebuilt = new URLSearchParams();
				for (const pair of kept) rebuilt.append(pair[0], pair[1]);
				const qs = rebuilt.toString();
				url.search = qs ? '?' + qs : '';
			}
			// Hash and path are never touched.

			result.ok = true;
			result.url = url.href;
			result.removed = removed;
			result.removedCount = removed.length;
			result.changed = result.url !== raw;
			return result;
		}

		return { sanitize, isTrackerName: (n) => trackerExact.has(String(n).toLowerCase()) };
	})();

	/* ======================================================================
	 * 8. Toast — single reused node, shadow-DOM isolated, auto-dismiss
	 * ==================================================================== */

	const Toast = (() => {
		let host = null, shadow = null, node = null, hideTimer = 0;

		const CSS = [
			':host{all:initial}',
			'.toast{position:fixed;bottom:72px;left:50%;transform:translateX(-50%);',
			'z-index:2147483000;max-width:min(480px,90vw);padding:10px 18px;',
			'border-radius:20px;font:500 13px/1.4 Roboto,Arial,sans-serif;',
			'color:#f1f1f1;background:rgba(28,28,28,.92);box-shadow:0 2px 10px rgba(0,0,0,.35);',
			'opacity:0;transition:opacity .18s ease;pointer-events:none;text-align:center}',
			'@media (prefers-color-scheme:light){.toast{background:rgba(32,33,36,.92)}}',
			'.toast.show{opacity:1}',
			'.toast.err{background:rgba(150,40,27,.94)}',
		].join('');

		function ensure() {
			if (node && host && host.isConnected) return true;
			const mount = document.body || document.documentElement;
			if (!mount) return false;
			host = document.createElement('div');
			host.id = 'ytsat-toast-host';
			shadow = host.attachShadow({ mode: 'open' });
			const style = document.createElement('style');
			style.textContent = CSS;
			node = document.createElement('div');
			node.className = 'toast';
			node.setAttribute('role', 'status');
			node.setAttribute('aria-live', 'polite');
			shadow.append(style, node);
			mount.appendChild(host);
			return true;
		}

		function show(message, isError) {
			if (!Config.ready || !Config.get('showToasts')) return;
			if (!ensure()) { Log.info(message); return; }
			node.textContent = message; // textContent only — never markup
			node.classList.toggle('err', !!isError);
			node.classList.add('show');
			clearTimeout(hideTimer);
			hideTimer = setTimeout(guard(() => {
				if (node) node.classList.remove('show');
			}, 'toast-hide'), 2200);
		}

		return { show };
	})();

	/* ======================================================================
	 * 9. Share-field targeting: discovery, value-accessor wrapping,
	 *    sanitizing writes, manual-copy sanitization
	 * ==================================================================== */

	const Fields = (() => {
		const wrapped = new WeakSet();      // accessor installed
		const known = new WeakSet();        // ever processed (cheap re-entry)
		let selectorCache = { revision: -1, css: '' };

		function selector() {
			if (selectorCache.revision === Config.revision) return selectorCache.css;
			const parts = BASE_FIELD_SELECTORS.slice();
			for (const sel of Config.get('extraFieldSelectors') || []) {
				try { document.createDocumentFragment().querySelector(sel); parts.push(sel); }
				catch (_) { Log.warn('Ignoring invalid extra selector:', sel); }
			}
			selectorCache = { revision: Config.revision, css: parts.join(',') };
			return selectorCache.css;
		}

		function query(root) {
			const scope = root || document;
			let list;
			try { list = scope.querySelectorAll(selector()); }
			catch (_) { return []; }
			const out = [];
			for (const el of list) {
				if (out.indexOf(el) === -1) out.push(el);
			}
			return out;
		}

		function matches(el) {
			try { return el.matches(selector()); }
			catch (_) { return false; }
		}

		function isShareField(el) {
			return !!(el && el.nodeType === 1 && (known.has(el) || matches(el)));
		}

		// Intercept programmatic value assignment so even YouTube's own
		// writes are normalized at the source. Falls back silently when the
		// descriptor is not wrappable; processing passes still apply.
		function wrapAccessor(el) {
			if (wrapped.has(el)) return;
			const isInput = el instanceof HTMLInputElement;
			const isArea = typeof HTMLTextAreaElement !== 'undefined' &&
				el instanceof HTMLTextAreaElement;
			if (!isInput && !isArea) { wrapped.add(el); return; }

			let desc = null;
			try {
				desc = Object.getOwnPropertyDescriptor(el, 'value') ||
					Object.getOwnPropertyDescriptor(
						isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
						'value');
			} catch (_) { /* no-op */ }
			if (!desc || desc.configurable === false || !desc.get || !desc.set) {
				wrapped.add(el);
				return;
			}

			try {
				Object.defineProperty(el, 'value', {
					configurable: true,
					enumerable: desc.enumerable,
					get() { return desc.get.call(this); },
					set(v) {
						let next = v;
						try {
							const r = UrlEngine.sanitize(String(v));
							next = r.ok ? r.url : String(v);
						} catch (_) {
							next = String(v);
						}
						return desc.set.call(this, next);
					},
				});
			} catch (_) {
				// Frozen/sealed element instance — mark wrapped so we stop
				// retrying per pass; event-driven passes still clean it.
			}
			wrapped.add(el);
		}

		function dispatch(el, type) {
			try {
				el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
			} catch (_) { /* non-fatal */ }
		}

		/**
		 * Sanitize a single field. Returns the final (clean) value shown,
		 * or null when the element holds nothing processable.
		 */
		function process(el, source) {
			if (!el || el.nodeType !== 1) return null;
			if (!('value' in el)) return null;
			wrapAccessor(el);
			known.add(el);

			let current;
			try { current = el.value; } catch (_) { return null; }
			if (typeof current !== 'string' || !current.trim()) return null;

			const r = UrlEngine.sanitize(current);
			if (!r.ok) {
				if (r.reason !== 'malformed') Log.debug('skip', r.reason, 'via', source);
				return null;
			}
			if (r.url === current) return current; // already clean — no work

			try {
				el.value = r.url;
				if (el.isConnected) { dispatch(el, 'input'); dispatch(el, 'change'); }
			} catch (_) { return null; }

			Stats.bump('cleaned', 1);
			Stats.bump('paramsRemoved', r.removedCount);
			Log.info(
				'Share link cleaned (',
				(r.removed.join(', ') || 'normalized'), '):',
				clampStr(current, 160), '→', clampStr(r.url, 160)
			);
			return r.url;
		}

		function processAll(source) {
			const fields = query();
			for (const el of fields) process(el, source);
			return fields;
		}

		return { query, matches, isShareField, process, processAll, selector };
	})();

	/* ======================================================================
	 * 10. Timer registry — every deferred task tracked, zero leaks
	 * ==================================================================== */

	const Timers = (() => {
		const pending = new Set();
		let watchdogId = 0;

		function after(ms, fn) {
			const id = setTimeout(guard(() => {
				pending.delete(id);
				fn();
			}, 'timer'), ms);
			pending.add(id);
			return id;
		}

		function clearAllPending() {
			for (const id of pending) clearTimeout(id);
			pending.clear();
		}

		function setWatchdog(fn, ms) {
			if (watchdogId) return;
			watchdogId = setInterval(guard(fn, 'watchdog'), ms);
		}

		function clearWatchdog() {
			if (watchdogId) { clearInterval(watchdogId); watchdogId = 0; }
		}

		return { after, clearAllPending, setWatchdog, clearWatchdog };
	})();

	/* ======================================================================
	 * 11. Watch — observation, settle passes, watchdog
	 * ==================================================================== */

	const Watch = (() => {
		let started = false;
		let microQueued = false;
		let emptyTicks = 0;

		function queueProcess() {
			if (microQueued) return;
			microQueued = true;
			Promise.resolve().then(guard(() => {
				microQueued = false;
				Fields.processAll('mutation');
			}, 'mq'));
		}

		// After a user gesture that might open/update a share surface, run a
		// short cascade of passes. This is not polling: timers only exist in
		// the ~1s window after relevant activity.
		function settle() {
			Fields.processAll('settle:now');
			Timers.after(120, () => Fields.processAll('settle:120'));
			Timers.after(400, () => Fields.processAll('settle:400'));
			Timers.after(900, () => Fields.processAll('settle:900'));
			armWatchdog();
		}

		// Low-frequency reconciliation that exists only while fields are
		// actually in the DOM and shuts itself off after two empty ticks.
		function armWatchdog() {
			Timers.setWatchdog(() => {
				const fields = Fields.query();
				if (fields.length === 0) {
					emptyTicks++;
					if (emptyTicks >= 2) Timers.clearWatchdog();
					return;
				}
				emptyTicks = 0;
				for (const el of fields) Fields.process(el, 'watchdog');
			}, 1500);
		}

		// Cheap identity hints before any selector query: renderer tags that
		// host the panel, or nodes that are themselves a share field.
		const PANEL_TAG_RE = /SHARE|-DIALOG|COPY-LINK/;

		let dirtyTimer = 0;

		// Catch-all rescan for insertions no quick check recognized, trailing
		// throttled to ≤4 full scans/sec and only existing right after real
		// DOM activity — never a free-running interval.
		function markDirty() {
			if (dirtyTimer) return;
			dirtyTimer = Timers.after(250, () => {
				dirtyTimer = 0;
				Fields.processAll('observer-scan');
			});
		}

		function quickHit(node) {
			try {
				if (node.id === 'share-url') return true;
				const cn = node.className;
				if (typeof cn === 'string' && cn.indexOf('unified-share') !== -1) return true;
				if (PANEL_TAG_RE.test(node.nodeName)) return true;
			} catch (_) { /* ignore */ }
			return false;
		}

		function onMutations(records) {
			for (const rec of records) {
				if (rec.type === 'attributes') {
					const t = rec.target;
					if (t && t.nodeType === 1 && Fields.isShareField(t)) queueProcess();
					continue;
				}
				const nodes = rec.addedNodes;
				let sawInsertion = false;
				for (let i = 0, n = nodes.length; i < n; i++) {
					const node = nodes[i];
					if (node.nodeType !== 1) continue;
					sawInsertion = true;
					if (quickHit(node)) {
						// Panel-bearing node: targeted deep query, then process.
						try {
							if (node.matches(Fields.selector()) ||
								node.querySelector(Fields.selector())) {
								queueProcess();
								return;
							}
						} catch (_) { /* fall through */ }
					}
				}
				if (sawInsertion) markDirty();
			}
		}

		function start() {
			if (started) return;
			started = true;

			// Each wiring step is isolated: any single environmental failure
			// must degrade that one capability, never abort the rest.
			try {
				const root = document.documentElement;
				if (root && typeof MutationObserver === 'function') {
					new MutationObserver(guard(onMutations, 'mutation-observer'))
						.observe(root, {
							childList: true,
							subtree: true,
							attributes: true,
							attributeFilter: ['value'],
						});
				}
			} catch (err) { Log.warn('MutationObserver unavailable', err); }

			// Click-driven settle: catches share openings and the timestamp
			// checkbox rewriting the URL without any DOM childList change.
			try {
				document.addEventListener('click', guard(settle, 'settle-click'),
					{ capture: true, passive: true });
			} catch (err) { Log.warn('click settle unavailable', err); }

			// SPA navigation awareness.
			try {
				const onNav = guard(() => {
					settle();
					LocationCleaner.run('navigate');
				}, 'nav');
				for (const ev of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate']) {
					window.addEventListener(ev, onNav, { passive: true });
				}
			} catch (err) { Log.warn('navigation hooks unavailable', err); }

			try { Fields.processAll('startup'); }
			catch (err) { Log.warn('initial pass failed', err); }
			try { LocationCleaner.run('startup'); }
			catch (err) { Log.warn('location cleaner failed', err); }
			try { settle(); }
			catch (err) { Log.warn('settle failed', err); }
		}

		return { start, settle };
	})();

	/* ======================================================================
	 * 12. Clipboard defense
	 * ==================================================================== */

	// 12a. Manual copy from a share field (Ctrl+C / context menu): rewrite
	// the clipboard payload to the sanitized selection when it differs.
	document.addEventListener('copy', guard((event) => {
		if (!Config.ready || !Config.get('sanitizeManualCopy')) return;
		const target = event.target;
		if (!target || target.nodeType !== 1) return;
		if (!Fields.isShareField(target)) return;
		if (!event.clipboardData) return;

		let value;
		try { value = target.value; } catch (_) { return; }
		if (typeof value !== 'string' || !value.trim()) return;

		let selected = value;
		try {
			if (typeof target.selectionStart === 'number' &&
				target.selectionStart !== target.selectionEnd) {
				selected = value.slice(target.selectionStart, target.selectionEnd);
			}
		} catch (_) { /* use full value */ }

		const r = UrlEngine.sanitize(selected);
		if (!r.ok || r.url === selected) return;

		event.preventDefault();
		try { event.clipboardData.setData('text/plain', r.url); } catch (_) {}
		Stats.bump('cleaned', 1);
		Stats.bump('paramsRemoved', r.removedCount);
		Log.debug('manual copy sanitized:', r.removed.join(', '));
	}, 'copy-event'), true);

	// 12b. Copy-button interception: YouTube's own handler may copy the
	// tracked URL from internal panel data regardless of the visible field.
	// We intercept in the capture phase, sanitize via the field (which is
	// already normalized), and write to the clipboard ourselves.
	const COPY_BY_RENDERER_BAR = 'yt-copy-link-renderer,ytd-copy-link-renderer,ytm-copy-link-renderer,ytmusic-copy-link-renderer';

	document.addEventListener('click', guard((event) => {
		if (!Config.ready || !Config.get('interceptCopyButton')) return;
		if (event.defaultPrevented) return;

		const path = isFn(event.composedPath) ? event.composedPath() : [];
		if (!path.length) return;

		// Clicks on the field itself are never intercepted.
		for (const node of path) {
			if (node && node.nodeType === 1 && Fields.isShareField(node)) return;
			if (node === document || node === window) break;
		}

		// Find the enclosing share surface.
		let rootEl = null;
		let insideCopyBar = false;
		for (const node of path) {
			if (!node || node.nodeType !== 1) continue;
			if (!insideCopyBar && node.matches && node.matches(COPY_BY_RENDERER_BAR)) {
				insideCopyBar = true;
			}
			if (node.matches && node.matches(PANEL_ROOT_SELECTOR)) { rootEl = node; break; }
			if (node === document.documentElement) break;
		}
		if (!rootEl) return;

		// The gesture must land on a button-like control (never on a link —
		// social share anchors inside the panel keep navigating normally).
		const origin = path[0] && path[0].nodeType === 1 ? path[0] :
			(event.target && event.target.nodeType === 1 ? event.target : null);
		if (!origin || !isFn(origin.closest)) return;
		const control = origin.closest(COPY_CONTROL_SELECTOR);
		if (!control || !rootEl.contains(control)) return;
		if (/\bclose\b/i.test(control.id || '')) return;

		// Social targets carry a real destination URL somewhere inside.
		if (control.querySelector && control.querySelector('a[href*="//"]') &&
			!control.querySelector(Fields.selector())) return;

		// Confidence gate: only hijack clicks we are sure mean "copy the
		// link" — anything inside the dedicated copy-link bar qualifies
		// (that surface contains exactly one action), otherwise require a
		// copy-ish identifier on the control itself. Unrecognized buttons
		// (embed tabs, experiment hooks) pass through untouched.
		if (!insideCopyBar) {
			let signature = String(control.id || '');
			try { signature += ' ' + String(control.className || ''); } catch (_) {}
			if (isFn(control.getAttribute)) {
				signature += ' ' + String(control.getAttribute('aria-label') || '');
				signature += ' ' + String(control.getAttribute('title') || '');
			}
			if (!/copy/i.test(signature)) return;
		}

		// Locate the share field inside this surface; without it we cannot
		// guarantee a clean copy, so we gracefully let YouTube proceed.
		let field = null;
		let candidates = [];
		try { candidates = Array.prototype.slice.call(rootEl.querySelectorAll(Fields.selector())); }
		catch (_) { /* fall through */ }
		for (const el of candidates) {
			field = field || el;
			if (el && typeof el.value === 'string' && el.value.trim()) { field = el; break; }
		}
		if (!field) return;

		const finalUrl = Fields.process(field, 'copy-button');
		if (!finalUrl) return;

		event.preventDefault();
		event.stopPropagation();
		if (isFn(event.stopImmediatePropagation)) event.stopImmediatePropagation();

		// UX parity: YouTube selects the link text when copying.
		try {
			if (isFn(field.select)) field.select();
			else if (isFn(field.setSelectionRange)) {
				field.setSelectionRange(0, String(field.value).length);
			}
		} catch (_) { /* cosmetic only */ }

		Bridge.clipboardWrite(finalUrl).then(guard((ok) => {
			if (ok) {
				Stats.bump('copies', 1);
				Toast.show('Clean link copied to clipboard');
				Log.debug('copy intercepted:', clampStr(finalUrl, 160));
			} else {
				Toast.show('Could not write to clipboard — the field holds the clean link, copy it manually', true);
				Log.warn('Clipboard unavailable on all backends');
			}
		}, 'copy-write'));
	}, 'copy-button'), true);

	/* ======================================================================
	 * 13. Address-bar cleaner (opt-in) — conservative blocklist rewrite of
	 *     the current page URL via history.replaceState; hash preserved,
	 *     state object preserved, unknown params untouched.
	 * ==================================================================== */

	const LocationCleaner = (() => {
		let lastHref = '';

		function run(source) {
			if (!Config.ready || !Config.get('cleanAddressBar')) return;
			const href = location.href;
			if (href === lastHref) return;
			lastHref = href;
			const r = UrlEngine.sanitize(href, { mode: 'blocklist' });
			if (!r.ok || r.url === href) return;
			try {
				history.replaceState(history.state, document.title, r.url);
				lastHref = r.url;
				Stats.bump('cleaned', 1);
				Stats.bump('paramsRemoved', r.removedCount);
				Log.info('Address bar cleaned:', r.removed.join(', '), '(' + source + ')');
			} catch (err) {
				Log.warn('replaceState blocked; leaving URL untouched', err);
			}
		}

		return { run };
	})();

	/* ======================================================================
	 * 14. Settings dialog — shadow-DOM isolated, keyboard usable, built
	 *     lazily on first open. No innerHTML with dynamic data anywhere.
	 * ==================================================================== */

	const SettingsUI = (() => {
		let host = null, shadow = null, built = false;
		const widgets = {};

		const CSS = [
			':host{all:initial}',
			'.overlay{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;',
			'justify-content:center;background:rgba(0,0,0,0.5)}',
			'.panel{width:min(560px,92vw);max-height:86vh;overflow:auto;background:#212121;color:#f1f1f1;',
			'border-radius:12px;padding:20px 24px;font:400 14px/1.5 Roboto,Arial,sans-serif;',
			'box-shadow:0 8px 40px rgba(0,0,0,.5)}',
			'@media (prefers-color-scheme:light){.panel{background:#fff;color:#0f0f0f}}',
			'h2{margin:0 0 4px;font-size:18px;font-weight:600}',
			'.sub{margin:0 0 14px;font-size:12px;opacity:.7}',
			'fieldset{border:0;margin:0 0 12px;padding:0}',
			'label{display:flex;align-items:center;gap:8px;margin:7px 0;cursor:pointer}',
			'label.block{display:block}',
			'label.block span{display:block;margin-bottom:4px}',
			'input[type=text]{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;',
			'border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;font:inherit}',
			'select{padding:6px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.5);',
			'background:#2b2b2b;color:#f1f1f1;font:inherit;max-width:100%}',
			'@media (prefers-color-scheme:light){select{background:#f2f2f2;color:#0f0f0f}}',
			'.hint{font-size:12px;opacity:.65;margin:2px 0 0}',
			'.stats{font-size:12px;opacity:.8;margin:10px 0;padding:8px 10px;',
			'border:1px solid rgba(128,128,128,.35);border-radius:8px}',
			'.row{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
			'button{padding:8px 16px;border-radius:18px;border:0;font:600 14px Roboto,Arial,sans-serif;',
			'cursor:pointer;background:rgba(255,255,255,.12);color:inherit}',
			'button.primary{background:#3ea6ff;color:#0f0f0f}',
			'button.danger{background:rgba(220,60,60,.85);color:#fff}',
			'button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #3ea6ff;outline-offset:2px}',
		].join('');

		function el(tag, attrs, text) {
			const node = document.createElement(tag);
			if (attrs) for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
			if (text !== undefined) node.textContent = text;
			return node;
		}

		function checkbox(key, label, hint) {
			const wrap = el('label');
			const input = el('input', { type: 'checkbox', 'data-key': key });
			wrap.appendChild(input);
			wrap.appendChild(el('span', null, label));
			widgets[key] = input;
			if (!hint) return wrap;
			const fs = el('div');
			fs.appendChild(wrap);
			fs.appendChild(el('p', { class: 'hint' }, hint));
			return fs;
		}

		function build() {
			if (built) return;
			built = true;

			const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': SCRIPT_NAME + ' settings' });
			const panel = el('div', { class: 'panel' });

			panel.appendChild(el('h2', null, SCRIPT_NAME + ' ' + VERSION));
			panel.appendChild(el('p', { class: 'sub' },
				'Privacy engine for YouTube share links. All settings are stored locally; nothing is ever sent anywhere.'));

			// --- cleanup policy
			const fsPolicy = el('fieldset');
			const modeLabel = el('label', { class: 'block' });
			modeLabel.appendChild(el('span', null, 'Cleanup policy'));
			const sel = el('select', { 'data-key': 'mode' });
			sel.append(
				el('option', { value: 'allowlist' },
					'Allowlist (default) — keep only known-good parameters (t, list, index, v)'),
				el('option', { value: 'blocklist' },
					'Blocklist — keep everything except known trackers'));
			widgets.mode = sel;
			modeLabel.appendChild(sel);
			fsPolicy.appendChild(modeLabel);
			fsPolicy.appendChild(el('p', { class: 'hint' },
				'Allowlist is the strictest behavior, dropping unknown parameters. Blocklist avoids mangling unfamiliar parameters on edge-case URLs.'));

			const allowLabel = el('label', { class: 'block' });
			allowLabel.appendChild(el('span', null, 'Extra parameters to always keep (comma-separated)'));
			widgets.extraAllowParams = el('input', { type: 'text', 'data-key': 'extraAllowParams', placeholder: 'e.g. feature2, ab_compare' });
			allowLabel.appendChild(widgets.extraAllowParams);
			fsPolicy.appendChild(allowLabel);

			const denyLabel = el('label', { class: 'block' });
			denyLabel.appendChild(el('span', null, 'Extra parameters to always strip (comma-separated)'));
			widgets.extraDenyParams = el('input', { type: 'text', 'data-key': 'extraDenyParams', placeholder: 'e.g. my_tracker' });
			denyLabel.appendChild(widgets.extraDenyParams);
			fsPolicy.appendChild(denyLabel);
			panel.appendChild(fsPolicy);

			// --- behavior
			const fsBehavior = el('fieldset');
			fsBehavior.appendChild(checkbox('interceptCopyButton',
				'Intercept the panel’s Copy button (recommended)',
				'Guarantees the clipboard receives the cleaned URL even where YouTube copies from internal panel data.'));
			fsBehavior.appendChild(checkbox('sanitizeManualCopy',
				'Sanitize manual copies from the link field',
				'Re-cleans the text when you copy out of the field yourself.'));
			fsBehavior.appendChild(checkbox('cleanAddressBar',
				'Also strip known trackers from the current page URL (opt-in)',
				'Conservative: removes known tracker parameters only, keeps everything else, hash intact.'));
			panel.appendChild(fsBehavior);

			// --- advanced
			const fsAdvanced = el('fieldset');
			const selLabel = el('label', { class: 'block' });
			selLabel.appendChild(el('span', null, 'Extra share-field selectors (comma-separated CSS, advanced)'));
			widgets.extraFieldSelectors = el('input', { type: 'text', 'data-key': 'extraFieldSelectors', placeholder: 'e.g. #future-share-input' });
			selLabel.appendChild(widgets.extraFieldSelectors);
			fsAdvanced.appendChild(selLabel);
			fsAdvanced.appendChild(checkbox('showToasts', 'Show toast notifications'));
			fsAdvanced.appendChild(checkbox('verbose', 'Verbose console logging (diagnostics)'));
			fsAdvanced.appendChild(checkbox('statsEnabled', 'Keep local counters (cleaned links, stripped params)'));
			panel.appendChild(fsAdvanced);

			// --- stats
			const statsBox = el('div', { class: 'stats' });
			widgets.statsBox = statsBox;
			panel.appendChild(statsBox);

			// --- actions
			const row = el('div', { class: 'row' });
			const btnDefaults = el('button', { type: 'button' }, 'Reset to defaults');
			const btnResetStats = el('button', { type: 'button', class: 'danger' }, 'Reset statistics');
			const btnClose = el('button', { type: 'button' }, 'Cancel');
			const btnSave = el('button', { type: 'button', class: 'primary' }, 'Save');
			row.append(btnDefaults, btnResetStats, btnClose, btnSave);
			panel.appendChild(row);

			overlay.appendChild(panel);

			// wiring
			btnClose.addEventListener('click', guard(close, 'ui-close'));
			btnSave.addEventListener('click', guard(save, 'ui-save'));
			btnDefaults.addEventListener('click', guard(() => {
				Config.setAll(Object.assign({}, CONFIG_DEFAULTS));
				syncFromConfig();
				Toast.show('Defaults restored — Save to keep them');
			}, 'ui-defaults'));
			btnResetStats.addEventListener('click', guard(() => {
				Stats.reset();
				syncStats();
				Toast.show('Statistics reset');
			}, 'ui-stats-reset'));
			overlay.addEventListener('mousedown', guard((e) => {
				if (e.target === overlay) close();
			}, 'ui-overlay'));
			overlay.addEventListener('keydown', guard((e) => {
				if (e.key === 'Escape') { e.stopPropagation(); close(); }
			}, 'ui-keys'));

			shadow.appendChild(overlay);
			syncFromConfig();
		}

		function syncFromConfig() {
			const cfg = Config.all();
			for (const key of Object.keys(widgets)) {
				if (key === 'statsBox') continue;
				const w = widgets[key];
				if (!w) continue;
				if (w.type === 'checkbox') w.checked = !!cfg[key];
				else if (Array.isArray(cfg[key])) w.value = cfg[key].join(', ');
				else w.value = cfg[key];
			}
			syncStats();
		}

		function syncStats() {
			const d = Stats.data;
			const since = new Date(d.since);
			widgets.statsBox.textContent =
				'Local statistics (since ' + (isNaN(since) ? '—' : since.toLocaleDateString()) + '): ' +
				d.cleaned + ' links cleaned · ' + d.paramsRemoved + ' parameters stripped · ' +
				d.copies + ' copy-button intercepts';
		}

		function save() {
			const patch = {};
			for (const key of Object.keys(widgets)) {
				if (key === 'statsBox') continue;
				const w = widgets[key];
				if (w.type === 'checkbox') patch[key] = w.checked;
				else if (key === 'extraAllowParams' || key === 'extraDenyParams' || key === 'extraFieldSelectors') {
					patch[key] = w.value.split(',').map((s) => s.trim()).filter(Boolean);
				} else patch[key] = w.value;
			}
			Config.setAll(patch);
			Fields.processAll('settings-change');
			LocationCleaner.run('settings-change');
			Toast.show('Settings saved');
			close();
		}

		function open() {
			if (!Config.ready) { Log.debug('settings requested before config init'); return; }
			try {
				if (!host) {
					host = document.createElement('div');
					host.id = 'ytsat-settings-host';
					shadow = host.attachShadow({ mode: 'open' });
					const style = document.createElement('style');
					style.textContent = CSS;
					shadow.appendChild(style);
				}
				build();
				if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
				const first = shadow.querySelector('select');
				if (first && isFn(first.focus)) first.focus();
			} catch (err) { Log.error('open settings', err); }
		}

		function close() {
			if (host && host.isConnected) host.remove();
		}

		return { open, close };
	})();

	/* ======================================================================
	 * 15. Power-user actions
	 * ==================================================================== */

	function copyCleanPageUrl() {
		const r = UrlEngine.sanitize(location.href, { mode: 'blocklist' });
		const url = r.ok ? r.url : location.href;
		Bridge.clipboardWrite(url).then(guard((ok) => {
			if (ok) {
				Toast.show(r.changed ? 'Cleaned page URL copied' : 'Page URL copied (already clean)');
				if (r.changed) { Stats.bump('cleaned', 1); Stats.bump('paramsRemoved', r.removedCount); }
			} else {
				Toast.show('Clipboard unavailable: ' + clampStr(url, 90), true);
			}
		}, 'copy-page-url'));
	}

	// Keyboard access to settings for managers without menu commands.
	// Ctrl+Alt+Shift+Y — deliberately awkward to avoid collisions.
	document.addEventListener('keydown', guard((e) => {
		if (e.ctrlKey && e.altKey && e.shiftKey && !e.repeat &&
			(e.code === 'KeyY' || e.key === 'Y' || e.key === 'y')) {
			e.preventDefault();
			SettingsUI.open();
		}
	}, 'settings-shortcut'), true);

	/* ======================================================================
	 * 16. Boot — idempotent, timing-safe, partial-failure tolerant
	 * ==================================================================== */

	function registerMenus() {
		if (Bridge.menuCommand(SCRIPT_NAME + ': Settings', guard(SettingsUI.open, 'menu-settings'))) {
			Bridge.menuCommand(SCRIPT_NAME + ': Copy clean URL of this page', guard(copyCleanPageUrl, 'menu-copy'));
			Bridge.menuCommand(SCRIPT_NAME + ': Rescan share fields now', guard(() => {
				const found = Fields.processAll('menu-rescan').length;
				Toast.show(found ? ('Processed ' + found + ' share field(s)') : 'No share link field found on this page');
			}, 'menu-rescan'));
		} else {
			Log.debug('Menu commands unsupported by this manager — use Ctrl+Alt+Shift+Y for settings.');
		}
	}

	function boot() {
		const g = globalThis;
		if (g[BOOT_SYMBOL]) return;
		try { g[BOOT_SYMBOL] = true; } catch (_) { /* continue anyway */ }

		// Never trust any single subsystem to be healthy; degrade per-part.
		Promise.resolve()
			.then(() => Config.load())
			.catch((err) => { Log.warn('Config init failed; defaults active', err); Config.ready = true; })
			.then(() => Stats.load())
			.catch((err) => Log.warn('Stats init failed', err))
			.then(guard(() => {
				Watch.start();
				registerMenus();

				document.addEventListener('pagehide', guard(() => {
					Stats.flush();
					Timers.clearAllPending();
				}, 'flush'), { passive: true });
				document.addEventListener('visibilitychange', guard(() => {
					if (document.visibilityState === 'hidden') Stats.flush();
				}, 'flush-v'), { passive: true });

				const caps = [];
				if (Bridge.has.webClip) caps.push('web-clipboard');
				if (Bridge.has.gmClip || Bridge.has.legacyClip) caps.push('gm-clipboard');
				if (Bridge.has.gmMenu || Bridge.has.legacyMenu) caps.push('menu');
				Log.info(
					'v' + VERSION + ' active (' + (Bridge.has.gmGet || Bridge.has.legacyGet
						? 'persistent storage' : 'volatile storage') +
					(caps.length ? ' · ' + caps.join(', ') : '') +
					'). Settings via userscript-menu or Ctrl+Alt+Shift+Y.'
				);
			}, 'boot-main'))
			.catch((err) => Log.error('boot failed core', err));
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', guard(boot, 'boot'), { once: true });
	} else {
		boot();
	}

})();
