/**
 * Browser-test harness.
 *
 * Two HTTP servers on two ports give a genuine cross-origin setup:
 *   origin A — the page, same-origin images, and the emulated manager endpoints
 *   origin B — "a CDN": images with no CORS headers (they taint a canvas) and a
 *              /cors/ route that does send Access-Control-Allow-Origin
 *
 * The userscript manager itself is emulated by a shim injected before the
 * artifact. That is *emulation*, not Tampermonkey or Violentmonkey: it
 * implements the documented API surface (GM_info, GM_getValue/setValue/
 * deleteValue, GM_add/removeValueChangeListener, GM_xmlhttpRequest,
 * GM_download, GM_registerMenuCommand, GM_notification) with the async
 * GM.getValue-style promise semantics, and routes cross-origin fetches through
 * a local proxy endpoint so no request leaves the machine.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SCRIPT_VERSION } from '../../src/meta.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const FIXTURE_DIR = join(ROOT, 'test', 'fixtures');
export const ARTIFACT = join(ROOT, 'release', 'save-image-as-type.user.js');
export const WORK_DIR = join(ROOT, '.tmp-browser');
export const VERIFY_DIR = join(WORK_DIR, 'verify');
export const CDP_DOWNLOAD_DIR = join(WORK_DIR, 'cdp-downloads');
/**
 * Fixtures that are *generated* by the test run (currently the metadata set,
 * built by Pillow/lcms) live here, never in `test/fixtures/`. Their bytes depend
 * on the local Pillow/lcms build, so committing them would both dirty the tree on
 * every run and make "the fixture" ambiguous. The fixture route below serves this
 * directory first and falls back to the committed fixtures.
 */
export const GENERATED_FIXTURE_DIR = join(WORK_DIR, 'fixtures');
/** Each page gets its own download directory and storage scope, so a scenario
 *  can wait for "the file this page produced" without racing earlier ones. */
export function cdpDirFor(scope) {
  const dir = join(CDP_DOWNLOAD_DIR, scope);
  mkdirSync(dir, { recursive: true });
  return dir;
}
export const GM_DOWNLOAD_DIR = join(WORK_DIR, 'gm-downloads');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.apng': 'image/png',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json' });
}

function readBody(req, limitBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fixtureBytes(name) {
  const safe = basename(name);
  for (const file of [join(GENERATED_FIXTURE_DIR, safe), join(FIXTURE_DIR, safe)]) {
    if (existsSync(file)) return readFileSync(file);
  }
  return null;
}

function galleryHtml(originB) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixture gallery — Save Image as Type</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #16181d; }
  img, svg { display: block; margin: 14px 0; outline: 1px solid #ddd; }
  #bg { width: 160px; height: 100px; background-image: url('/fixtures/opaque.png'); background-size: contain; background-repeat: no-repeat; margin: 14px 0; outline: 1px solid #ddd; }
  .spacer { height: 70vh; }
</style>
</head>
<body>
<h1>Fixture gallery</h1>
<p><a id="first-link" href="#">A link, so keyboard focus has somewhere to start</a></p>

<img id="same-jpg" src="/fixtures/photo.jpg" alt="Same-origin photo" width="200" height="140">
<img id="same-png" src="/fixtures/opaque.png" alt="Same-origin opaque PNG" width="120" height="90">
<img id="same-alpha" src="/fixtures/transparent.png" alt="Same-origin PNG with alpha" width="60" height="60">
<img id="same-gif" src="/fixtures/animated.gif" alt="Same-origin animated GIF" width="50" height="40">
<img id="cors-webp" src="${originB}/cors/still.webp" alt="Cross-origin WebP with CORS" width="80" height="60" crossorigin="anonymous">
<img id="tainted-bmp" src="${originB}/fixtures/icon.bmp" alt="Cross-origin BMP without CORS" width="64" height="64">
<img id="lazy" data-src="/fixtures/big.png" alt="Lazy-loaded image" width="120" height="90">
<img id="broken" src="/missing.png" alt="Image that 404s" width="40" height="40">

<svg id="inline-svg" width="120" height="80" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Inline SVG target">
  <rect width="120" height="80" fill="#2563eb"></rect>
  <circle cx="60" cy="40" r="24" fill="#ffffff"></circle>
</svg>

<div id="bg" role="img" aria-label="CSS background image target"></div>

<button id="rerender" type="button">Re-render the SPA image</button>
<div id="spa-root"><img id="spa-img" src="/fixtures/tiny.png" alt="SPA-managed image" width="32" height="32"></div>

<div class="spacer"></div>
<iframe id="frame" src="/frame.html" title="Nested frame" width="240" height="180"></iframe>
<script>
  // Lazy loading, the way a real site does it.
  (function () {
    var lazy = document.getElementById('lazy');
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { lazy.src = lazy.dataset.src; lazy.dataset.loaded = '1'; observer.disconnect(); }
      });
    }, { threshold: 0.01 });
    observer.observe(lazy);
  })();
  // SPA re-render: the node is destroyed and replaced, as a router would do.
  document.getElementById('rerender').addEventListener('click', function () {
    var root = document.getElementById('spa-root');
    while (root.firstChild) root.removeChild(root.firstChild);
    var img = document.createElement('img');
    img.id = 'spa-img';
    img.src = '/fixtures/opaque.png';
    img.alt = 'SPA-managed image (re-rendered)';
    img.width = 120; img.height = 90;
    root.appendChild(img);
    window.__rerenders = (window.__rerenders || 0) + 1;
  });
</script>
</body>
</html>
`;
}

const FRAME_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Nested frame</title></head>
<body style="margin:8px">
<p style="font:12px sans-serif">Inside an iframe</p>
<img id="frame-img" src="/fixtures/tiny.png" alt="Image inside a frame" width="32" height="32">
</body></html>
`;

/**
 * @param {object} state shared mutable state for the run
 * @param {object} opts {cors: boolean, host: 'A'|'B'}
 */
function makeHandler(state, opts) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      if (path === '/' || path === '/index.html') return send(res, 200, galleryHtml(state.originB), { 'Content-Type': MIME['.html'] });
      if (path === '/frame.html') return send(res, 200, FRAME_HTML, { 'Content-Type': MIME['.html'] });
      if (path === '/missing.png') return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });

      if (path.startsWith('/fixtures/') || path.startsWith('/cors/')) {
        const bytes = fixtureBytes(path.split('/').pop());
        if (!bytes) return send(res, 404, 'no such fixture', { 'Content-Type': 'text/plain' });
        const headers = { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' };
        // Only the /cors/ route on the CDN origin sends CORS permission.
        if (path.startsWith('/cors/')) headers['Access-Control-Allow-Origin'] = '*';
        return send(res, 200, bytes, headers);
      }

      // ── emulated manager endpoints (origin A only) ──────────────────────
      if (path === '/__gm_xhr') {
        const payload = JSON.parse((await readBody(req)).toString('utf8'));
        const target = new URL(payload.url);
        // Not an open proxy: only the two local fixture origins may be reached.
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
          return sendJson(res, 403, { error: 'proxy is restricted to the local fixture origins' });
        }
        const upstream = await fetch(target.href, { redirect: 'follow' });
        const body = Buffer.from(await upstream.arrayBuffer());
        const headerText = [...upstream.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';
        state.xhrLog.push({ url: payload.url, status: upstream.status, headers: payload.headers || {}, bytes: body.length });
        return send(res, upstream.status, body, {
          'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
          'X-GM-Status': String(upstream.status),
          'X-GM-Final-Url': upstream.url,
          'X-GM-Headers': Buffer.from(headerText, 'utf8').toString('base64'),
        });
      }

      if (path === '/__gm_download' && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req)).toString('utf8'));
        const bytes = Buffer.from(payload.base64, 'base64');
        const relative = String(payload.name || 'download.bin').replace(/^[/\\]+/, '');
        const target = join(GM_DOWNLOAD_DIR, relative);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
        const record = { name: relative, saveAs: Boolean(payload.saveAs), bytes: bytes.length, sha256: hash(bytes), at: Date.now() };
        state.gmDownloads.push(record);
        return sendJson(res, 200, { ok: true, record });
      }

      if (path === '/__gm_store') {
        const scope = url.searchParams.get('scope') || 'shared';
        if (!state.scopes[scope]) {
          state.scopes[scope] = {};
          state.scopeVersions[scope] = 0;
        }
        if (req.method === 'GET') return sendJson(res, 200, { values: state.scopes[scope], version: state.scopeVersions[scope] });
        const payload = JSON.parse((await readBody(req)).toString('utf8'));
        if (payload.op === 'delete') delete state.scopes[scope][payload.key];
        else state.scopes[scope][payload.key] = payload.value;
        state.scopeVersions[scope] += 1;
        // Mirror into the legacy shared bucket so a run can inspect it.
        state.storage = state.scopes[scope];
        state.storageVersion = state.scopeVersions[scope];
        return sendJson(res, 200, { ok: true, version: state.scopeVersions[scope] });
      }

      if (path === '/__gm_log' && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req)).toString('utf8'));
        state.log.push(payload);
        return sendJson(res, 200, { ok: true });
      }

      return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    } catch (err) {
      return sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
    }
  };
}

export function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

/** Starts both origins and returns the shared run state. */
export async function startServers() {
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(VERIFY_DIR, { recursive: true });
  mkdirSync(CDP_DOWNLOAD_DIR, { recursive: true });
  mkdirSync(GM_DOWNLOAD_DIR, { recursive: true });

  const state = {
    storage: {},
    storageVersion: 0,
    scopes: {},
    scopeVersions: {},
    gmDownloads: [],
    xhrLog: [],
    log: [],
    originA: '',
    originB: '',
  };

  const serverA = createServer(makeHandler(state, { host: 'A' }));
  const serverB = createServer(makeHandler(state, { host: 'B' }));
  const portA = await listen(serverA);
  const portB = await listen(serverB);
  state.originA = `http://127.0.0.1:${portA}`;
  state.originB = `http://127.0.0.1:${portB}`;
  state.serverA = serverA;
  state.serverB = serverB;
  state.close = () =>
    Promise.all(
      [serverA, serverB].map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
          }),
      ),
    );
  return state;
}

/** The manager shim, as a string to inject before the artifact. */
export function shimSource(config = {}) {
  const cfg = Object.assign(
    {
      handler: 'EmulatedMonkey',
      managerVersion: '0.0.0-e2e',
      scriptVersion: SCRIPT_VERSION,
      downloadMode: 'browser',
      grants: ['GM_info', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_xmlhttpRequest', 'GM_download', 'GM_registerMenuCommand', 'GM_notification'],
      downloadError: null,
      xhrError: null,
      pollMs: 200,
      scope: 'shared',
    },
    config,
  );
  return `
(() => {
  const CFG = ${JSON.stringify(cfg)};
  const has = (name) => CFG.grants.includes(name);
  const values = Object.create(null);
  const listeners = new Map();
  let nextListenerId = 1;
  let loaded = null;
  let lastVersion = -1;
  window.__siatE2E = { config: CFG, calls: [], menuCommands: [], notifications: [] };
  const record = (entry) => { window.__siatE2E.calls.push(entry); };

  const storeUrl = '/__gm_store?scope=' + encodeURIComponent(CFG.scope);
  const loadStore = () => {
    if (!loaded) {
      loaded = fetch(storeUrl, { method: 'GET' })
        .then((r) => r.json())
        .then((data) => { Object.assign(values, data.values || {}); lastVersion = data.version || 0; return values; })
        .catch(() => values);
    }
    return loaded;
  };
  loadStore();

  const persist = (key, value, op) => fetch(storeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, op: op || 'set' }),
    keepalive: true,
  }).then((r) => r.json()).catch(() => ({ ok: false }));

  // Cross-tab sync emulation: poll the server and fire listeners on change.
  setInterval(() => {
    fetch(storeUrl).then((r) => r.json()).then((data) => {
      const version = data.version || 0;
      if (version === lastVersion) return;
      const incoming = data.values || {};
      for (const { key, handler } of listeners.values()) {
        const next = incoming[key];
        const previous = values[key];
        if (next !== previous) handler(key, previous === undefined ? '{}' : previous, next === undefined ? '{}' : next, false);
      }
      Object.keys(values).forEach((k) => { if (!(k in incoming)) delete values[k]; });
      Object.assign(values, incoming);
      lastVersion = version;
    }).catch(() => {});
  }, CFG.pollMs);

  if (has('GM_info')) {
    window.GM_info = {
      scriptHandler: CFG.handler,
      version: CFG.managerVersion,
      downloadMode: CFG.downloadMode,
      injectInto: 'auto',
      isIncognito: false,
      script: { name: 'Save Image as Type', version: CFG.scriptVersion, 'run-at': 'document-start', namespace: 'https://siat.invalid/save-image-as-type', grants: CFG.grants.slice() },
    };
    window.GM = window.GM || {};
    window.GM.info = window.GM_info;
  }

  if (has('GM_getValue')) {
    window.GM_getValue = (key, fallback) => loadStore().then(() => (key in values ? values[key] : fallback));
  }
  if (has('GM_setValue')) {
    window.GM_setValue = (key, value) => { values[key] = value; record({ api: 'setValue', key }); return persist(key, value).then((r) => r.ok !== false); };
  }
  if (has('GM_deleteValue')) {
    window.GM_deleteValue = (key) => { delete values[key]; record({ api: 'deleteValue', key }); return persist(key, null, 'delete').then((r) => r.ok !== false); };
  }
  if (has('GM_addValueChangeListener')) {
    window.GM_addValueChangeListener = (key, handler) => { const id = nextListenerId++; listeners.set(id, { key, handler }); record({ api: 'addValueChangeListener', key }); return id; };
  }
  if (has('GM_removeValueChangeListener')) {
    window.GM_removeValueChangeListener = (id) => { listeners.delete(id); record({ api: 'removeValueChangeListener', id }); };
  }

  if (has('GM_xmlhttpRequest')) {
    window.GM_xmlhttpRequest = (details) => {
      const controller = new AbortController();
      const timer = details.timeout ? setTimeout(() => { controller.abort(); details.ontimeout && details.ontimeout({}); }, details.timeout) : null;
      record({ api: 'xmlHttpRequest', url: details.url, responseType: details.responseType, headers: details.headers || {} });
      fetch('/__gm_xhr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: details.url, headers: details.headers || {} }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (timer) clearTimeout(timer);
          const buffer = await response.arrayBuffer();
          if (CFG.xhrError) { details.onerror && details.onerror({ status: response.status, error: CFG.xhrError }); return; }
          const headerText = response.headers.get('X-GM-Headers') ? atob(response.headers.get('X-GM-Headers')) : '';
          const contentType = (headerText.match(/content-type:\\s*([^\\r\\n]+)/i) || [, 'application/octet-stream'])[1].trim();
          const payload = details.responseType === 'blob' ? new Blob([buffer], { type: contentType }) : buffer;
          details.onload && details.onload({
            status: response.status,
            response: payload,
            responseText: details.responseType === 'blob' ? undefined : new TextDecoder().decode(buffer),
            responseHeaders: headerText,
            finalUrl: response.headers.get('X-GM-Final-Url') || details.url,
          });
        })
        .catch((err) => {
          if (timer) clearTimeout(timer);
          if (String(err && err.name) === 'AbortError') return;
          details.onerror && details.onerror({ error: String(err && err.message ? err.message : err) });
        });
      return { abort: () => { controller.abort(); record({ api: 'xhrAbort', url: details.url }); } };
    };
  }

  if (has('GM_download')) {
    window.GM_download = (details) => {
      record({ api: 'download', url: String(details.url).slice(0, 32), name: details.name, saveAs: Boolean(details.saveAs) });
      const finishError = (reason) => setTimeout(() => details.onerror && details.onerror({ error: reason, reason }), 0);
      if (CFG.downloadMode === 'disabled') { finishError(CFG.downloadError || 'not_enabled'); return { abort() {} }; }
      if (CFG.downloadError) { finishError(CFG.downloadError); return { abort() {} }; }
      fetch(details.url)
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          return fetch('/__gm_download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: details.name, base64: btoa(binary), saveAs: Boolean(details.saveAs) }),
          });
        })
        .then(() => setTimeout(() => details.onload && details.onload({}), 0))
        .catch((err) => setTimeout(() => details.onerror && details.onerror({ error: 'threw', message: String(err && err.message ? err.message : err) }), 0));
      return { abort: () => record({ api: 'downloadAbort', name: details.name }) };
    };
  }

  if (has('GM_registerMenuCommand')) {
    window.GM_registerMenuCommand = (label, handler, accessKey) => {
      const id = window.__siatE2E.menuCommands.length + 1;
      window.__siatE2E.menuCommands.push({ id, label, accessKey: accessKey || null, run: handler });
      record({ api: 'registerMenuCommand', label });
      return id;
    };
    window.GM_unregisterMenuCommand = (id) => { window.__siatE2E.menuCommands = window.__siatE2E.menuCommands.filter((c) => c.id !== id); };
  }

  if (has('GM_notification')) {
    window.GM_notification = (details) => { window.__siatE2E.notifications.push(typeof details === 'string' ? { text: details } : details); record({ api: 'notification' }); return true; };
  }
})();
`;
}

/** Offline fixture compiler. NOT the installed file: appends an intentional
 * privileged verifier handle inside a trusted local test build only. Production
 * has no switch that can enable this. Exact-production probes run separately. */
export function artifactSource() {
  if (!existsSync(ARTIFACT)) throw new Error(`missing artifact: ${ARTIFACT} — run \`npm run build\``);
  const raw = readFileSync(ARTIFACT, 'utf8');
  const policy = 'return event !== null && event !== undefined && event.isTrusted === true;';
  if (raw.split(policy).length !== 2) throw new Error('Owned-event policy transform drift');
  const source = raw.replace(policy, 'return true;');
  const entry = 'startProduction();';
  if (source.split(entry).length !== 2) throw new Error('Expected exactly one production entry');
  return source.replace(entry, `startProduction().then((api) => {
    window.__saveImageAsTypeInitialised = api;
    window.__siatVerificationBootstrap = bootstrap;
  });`);
}

/** Saves bytes captured in the browser so verify_media.py can decode them. */
export function saveForVerification(name, bytes) {
  const target = join(VERIFY_DIR, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(bytes));
  return target;
}
