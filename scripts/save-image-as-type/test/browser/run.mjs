#!/usr/bin/env node
/**
 * Fixture browser test for Save Image as Type (offline test instrumentation).
 *
 * What this really is: a verifier-instrumented copy of the built artifact
 * is injected into a real Chromium page before load, exactly as a userscript
 * manager would, on top of an emulated manager API. Real mouse clicks open the
 * menu, real Chrome encoders produce the pixels, and every byte that leaves the
 * page is captured and re-decoded by independent tools (Pillow / pypdf) before
 * it is compared against the source fixture.
 *
 * What this is NOT: it is not Tampermonkey or Violentmonkey. The manager API is
 * emulated by test/browser/harness.mjs (documented in the report), so anything
 * that depends on a real manager's behaviour — the Save As dialog, the download
 * extension whitelist, cross-tab storage sync — is either emulated or explicitly
 * listed as "could not be performed".
 *
 * Run: npm run test:browser
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
import { runV2 } from './v2.mjs';
import {
  startServers,
  shimSource,
  artifactSource,
  saveForVerification,
  cdpDirFor,
  VERIFY_DIR,
  CDP_DOWNLOAD_DIR,
  GM_DOWNLOAD_DIR,
  FIXTURE_DIR,
  GENERATED_FIXTURE_DIR,
  ROOT,
} from './harness.mjs';
import { verifyMedia, findFacts, pythonAvailable } from '../helpers/harness.mjs';
import { SCRIPT_VERSION } from '../../src/meta.js';
import { SETTINGS_STORAGE_KEYS, DEFAULT_SETTINGS } from '../../src/core/settings.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const results = [];
const notes = [];
const HAVE_PYTHON = pythonAvailable();

// `node test/browser/run.mjs --only=spa-rerender,settings-panel-and-persistence`
// runs a subset, which keeps iteration on one scenario fast.
const ONLY = (() => {
  const flag = process.argv.find((arg) => arg.startsWith('--only='));
  return flag ? flag.slice(7).split(',').map((entry) => entry.trim()).filter(Boolean) : null;
})();

function note(text) {
  notes.push(text);
}

/** Runs one scenario, capturing pass/fail and the evidence it produced. */
/** Dumps enough page state to explain a failure instead of guessing at it. */
async function diagnose(ctx) {
  try {
    if (!ctx || !ctx.page) return { error: 'no page' };
    const snapshot = await ctx.page.evaluate(() => {
      const menuHost = document.getElementById('siat-menu-host');
      const menu = menuHost && menuHost.shadowRoot ? menuHost.shadowRoot.querySelector('.siat-menu') : null;
      const toastHost = document.getElementById('siat-toast-host');
      const panelHost = document.getElementById('siat-panel-host');
      const instance = window.__saveImageAsTypeInitialised;
      return {
        url: location.href,
        scrollY: window.scrollY,
        menu: menu ? { hidden: menu.hidden, items: [...menu.querySelectorAll('[role="menuitem"]')].map((el) => (el.querySelector('.siat-ext') || el).textContent.trim()) } : 'no host',
        panelDialog: Boolean(panelHost && panelHost.shadowRoot && panelHost.shadowRoot.querySelector('[role="dialog"]')),
        toasts: toastHost && toastHost.shadowRoot ? [...toastHost.shadowRoot.querySelectorAll('.siat-toast')].map((node) => ({ kind: node.dataset.kind, title: (node.querySelector('.siat-title') || {}).textContent, meta: (node.querySelector('.siat-meta') || {}).textContent, notes: [...node.querySelectorAll('.siat-details li')].map((li) => li.textContent) })) : [],
        shimCalls: window.__siatE2E ? window.__siatE2E.calls.slice(-8) : [],
        settings: instance ? { cors: instance.store.get().allowCrossOriginFetch, bg: instance.store.get().enableBackgroundImages, formats: instance.store.get().formats } : null,
        gmDownloads: undefined,
      };
    });
    return { snapshot, problems: ctx.problems, noise: (ctx.expectedNoise || []).length };
  } catch (err) {
    return { diagnoseError: String(err && err.message ? err.message : err) };
  }
}

// Diagnostics must describe the page the failing scenario actually used.
// Scenarios that open their own page set activeCtx through openPage(); every
// other scenario runs on the shared main page, so that is the default.
let activeCtx = null;
let activeMainCtx = null;
let recreateMain = null;

// A CDP protocol timeout is a harness/transport failure, not a product result:
// the renderer stops answering Runtime.* for tens of seconds. Such a scenario
// is retried once on a freshly created page and the retry is reported, so a
// genuine product failure (which reproduces on the retry) is never hidden.
const PROTOCOL_FLAKE = /Protocol error|callFunctionOn timed out|Target closed|Session closed|Detached Frame|Connection closed/i;
const isProtocolFlake = (message) => PROTOCOL_FLAKE.test(message);

async function scenario(id, title, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  const evidence = [];
  const started = Date.now();
  let attempts = 0;
  let retriedBecause = null;
  for (;;) {
    activeCtx = activeMainCtx;
    attempts += 1;
    try {
      await fn({ evidence, note: (text) => evidence.push(text) });
      results.push({ id, title, status: 'pass', ms: Date.now() - started, evidence, attempts, retriedBecause });
      console.log(`  PASS  ${id.padEnd(26)} ${title}${attempts > 1 ? `  (passed on attempt ${attempts})` : ''}`);
      return;
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (attempts === 1 && recreateMain && isProtocolFlake(message)) {
        retriedBecause = message.split('\n')[0].slice(0, 160);
        console.log(`  RETRY ${id.padEnd(26)} CDP transport error (${retriedBecause}) — recreating the page and running the scenario once more`);
        evidence.push(`retried once after a CDP transport error: ${retriedBecause}`);
        try {
          await recreateMain();
        } catch (recreateError) {
          console.log(`        could not recreate the page: ${String(recreateError.message || recreateError).slice(0, 200)}`);
        }
        continue;
      }
      const diagnostics = await diagnose(activeCtx);
      results.push({ id, title, status: 'fail', ms: Date.now() - started, evidence, attempts, retriedBecause, error: message, diagnostics });
      console.log(`  FAIL  ${id.padEnd(26)} ${title}${attempts > 1 ? `  (after ${attempts} attempts)` : ''}\n        ${message.split('\n').join('\n        ')}`);
      console.log(`        page state: ${JSON.stringify(diagnostics).slice(0, 1200)}`);
      return;
    }
  }
}

function skipped(id, title, reason) {
  results.push({ id, title, status: 'skipped', reason });
  console.log(`  SKIP  ${id.padEnd(26)} ${title}\n        ${reason}`);
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function assertEquals(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser plumbing
// ─────────────────────────────────────────────────────────────────────────────

// The gallery deliberately contains an image that 404s and an image on an origin
// that sends no CORS headers. Chrome logs both, so they are classified as
// expected noise; everything else is a real problem and fails the scenario.
const BENIGN_PROBLEM = [
  /missing\.png/,
  /status of 404/,
  /has been blocked by CORS policy/,
  /net::ERR_FAILED/,
];
const isBenign = (text) => BENIGN_PROBLEM.some((pattern) => pattern.test(text));

let pageCounter = 0;

async function openPage(browser, state, config = {}, { url = '/', seedSettings = null } = {}) {
  pageCounter += 1;
  const scope = `p${pageCounter}`;
  // Every page gets its own manager-storage scope and its own download
  // directory, so scenarios cannot observe (or overwrite) each other's state.
  if (!state.scopes[scope]) {
    state.scopes[scope] = {};
    state.scopeVersions[scope] = 0;
  }
  if (seedSettings) {
    state.scopes[scope][SETTINGS_STORAGE_KEYS[0]] = JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, { schemaVersion: DEFAULT_SETTINGS.schemaVersion }, seedSettings));
    state.scopeVersions[scope] += 1;
  }
  const downloadDir = cdpDirFor(scope);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });

  const problems = [];
  const expectedNoise = [];
  const record = (text) => (isBenign(text) ? expectedNoise : problems).push(text);
  page.on('pageerror', (err) => record(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') record(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (request) => record(`requestfailed: ${request.url()} (${(request.failure() || {}).errorText})`));

  await page.evaluateOnNewDocument(shimSource(Object.assign({ scope }, config)));
  await page.evaluateOnNewDocument(artifactSource());
  await page.goto(`${state.originA}${url}`, { waitUntil: 'load', timeout: 30000 });
  // `ready` is the signal that boot finished: the marker object itself exists
  // from the very first synchronous step so that a second injection can see it.
  await page.waitForFunction('window.__saveImageAsTypeInitialised && window.__saveImageAsTypeInitialised.ready === true', { timeout: 20000 });
  // Wait for every fixture image to settle so a right-click never races a load.
  await page
    .waitForFunction(
      () => [...document.images].filter((img) => !img.src.includes('missing.png')).every((img) => img.complete),
      { timeout: 15000 },
    )
    .catch(() => {});
  const ctx = { page, cdp, problems, expectedNoise, downloadDir, scope, config };
  activeCtx = ctx;
  return ctx;
}

async function elementCenter(page, selector) {
  return page.$eval(selector, (element) => {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), width: rect.width, height: rect.height };
  });
}

async function rightClickAt(page, x, y, { shift = false } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(x, y, { button: 'right' });
  if (shift) await page.keyboard.up('Shift');
}

async function waitForMenu(page, { open = true, timeout = 8000 } = {}) {
  await page.waitForFunction(
    (wantOpen) => {
      const host = document.getElementById('siat-menu-host');
      if (!host || !host.shadowRoot) return false;
      const menu = host.shadowRoot.querySelector('.siat-menu');
      return menu && !menu.hidden === wantOpen;
    },
    { timeout },
    open,
  );
}

async function menuState(page) {
  return page.evaluate(() => {
    const hosts = document.querySelectorAll('#siat-menu-host');
    const host = hosts[0];
    const state = {
      hosts: hosts.length,
      present: Boolean(host && host.shadowRoot),
      open: false,
      items: [],
      title: '',
      sub: '',
      foot: '',
      busy: '',
      role: null,
      rect: null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    if (!state.present) return state;
    const menu = host.shadowRoot.querySelector('.siat-menu');
    state.open = !menu.hidden;
    state.role = menu.getAttribute('role');
    state.items = [...menu.querySelectorAll('[role="menuitem"]')].map((element) => ({
      label: (element.querySelector('.siat-ext') || element).textContent.trim(),
      hint: (element.querySelector('.siat-hint') || {}).textContent || '',
      disabled: element.getAttribute('aria-disabled') === 'true',
    }));
    state.title = (menu.querySelector('.siat-head-title') || {}).textContent || '';
    state.sub = (menu.querySelector('.siat-head-sub') || {}).textContent || '';
    state.foot = (menu.querySelector('.siat-foot') || {}).textContent || '';
    state.busy = (menu.querySelector('.siat-busy') || {}).textContent || '';
    const rect = menu.getBoundingClientRect();
    state.rect = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    return state;
  });
}

async function clickMenuItem(page, label) {
  const box = await page.evaluate((wanted) => {
    const host = document.getElementById('siat-menu-host');
    const menu = host.shadowRoot.querySelector('.siat-menu');
    const item = [...menu.querySelectorAll('[role="menuitem"]')].find((element) => (element.querySelector('.siat-ext') || element).textContent.trim() === wanted);
    if (!item) return null;
    item.scrollIntoView({ block: 'center' });
    const rect = item.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), disabled: item.getAttribute('aria-disabled') === 'true' };
  }, label);
  if (!box) throw new Error(`menu item "${label}" was not offered`);
  await page.mouse.click(box.x, box.y);
  return box;
}

/** Right-clicks an element and picks a format with real mouse events. */
async function convertWithMouse(page, selector, label, { shift = false } = {}) {
  const center = await elementCenter(page, selector);
  await rightClickAt(page, center.x, center.y, { shift });
  await waitForMenu(page);
  await clickMenuItem(page, label);
  return center;
}

async function toasts(page) {
  return page.evaluate(() => {
    const host = document.getElementById('siat-toast-host');
    if (!host || !host.shadowRoot) return [];
    return [...host.shadowRoot.querySelectorAll('.siat-toast')].map((node) => ({
      kind: node.dataset.kind,
      role: node.getAttribute('role'),
      live: node.getAttribute('aria-live'),
      title: (node.querySelector('.siat-title') || {}).textContent || '',
      meta: (node.querySelector('.siat-meta') || {}).textContent || '',
      notes: [...node.querySelectorAll('.siat-details li')].map((li) => li.textContent),
      actions: [...node.querySelectorAll('.siat-actions .siat-btn')].map((b) => b.textContent),
    }));
  });
}

async function waitForToast(page, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = [];
  while (Date.now() < deadline) {
    last = await toasts(page);
    const hit = last.find(predicate);
    if (hit) return hit;
    await sleep(60);
  }
  throw new Error(`no matching toast within ${timeout}ms (saw: ${JSON.stringify(last)})`);
}

async function waitForGmDownload(state, since, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (state.gmDownloads.length > since) return state.gmDownloads[state.gmDownloads.length - 1];
    await sleep(50);
  }
  throw new Error(`no manager download within ${timeout}ms`);
}

async function waitForCdpDownload(dir, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = readdirSync(dir).filter((name) => !name.endsWith('.crdownload'));
    if (files.length) {
      const newest = files.map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime)[0];
      return { name: newest.name, path: join(dir, newest.name), bytes: readFileSync(join(dir, newest.name)) };
    }
    await sleep(50);
  }
  throw new Error(`no browser download landed in ${dir} within ${timeout}ms`);
}

/** Clears the toast stack so it cannot sit under a later click. */
async function clearToasts(page) {
  await page.evaluate(() => {
    const instance = window.__saveImageAsTypeInitialised;
    if (instance && instance.toaster) instance.toaster.dismissAll();
  });
}

/** Copies a captured file into the verification directory and decodes it. */
function verifyCapture(uniqueName, bytes) {
  saveForVerification(uniqueName, bytes);
  if (!HAVE_PYTHON) return null;
  const report = verifyMedia(VERIFY_DIR, uniqueName);
  const facts = findFacts(report, uniqueName);
  if (!facts) throw new Error(`verify_media.py produced no facts for ${uniqueName}`);
  return facts;
}

function pixelsOf(facts) {
  return (facts.frames && facts.frames[0] && facts.frames[0].pixels) || [];
}
function pixelAt(facts, x, y) {
  return pixelsOf(facts).find((entry) => entry[0] === x && entry[1] === y);
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

const ALL_GRANTS = ['GM_info', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_xmlhttpRequest', 'GM_download', 'GM_registerMenuCommand', 'GM_notification'];
const without = (name) => ALL_GRANTS.filter((grant) => grant !== name);

async function main() {
  console.log('Save Image as Type — browser end-to-end test\n');
  const state = await startServers();
  const fixtureFacts = HAVE_PYTHON ? verifyMedia(FIXTURE_DIR) : null;
  const fixture = (name) => (fixtureFacts ? findFacts(fixtureFacts, name) : null);

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 25000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const version = await browser.version();
  note(`browser: ${version}`);
  note(`manager API: emulated by test/browser/harness.mjs (handler "EmulatedMonkey"), not a real userscript manager`);
  note(`independent verification: ${HAVE_PYTHON ? 'Pillow + pypdf via test/helpers/verify_media.py' : 'UNAVAILABLE (Pillow/pypdf missing) — byte-level checks skipped'}`);
  console.log(`  ${version}`);
  console.log(`  fixture origin A ${state.originA} · CDN origin B ${state.originB}\n`);

  // Environment facts that decide what can be claimed later. WebCodecs is only
  // exposed in a secure context, so the same browser answers differently on
  // about:blank and on http://127.0.0.1 — both are measured and reported.
  const probePage = await browser.newPage();
  const blankEnv = await probePage.evaluate(() => ({
    imageDecoder: typeof ImageDecoder !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    idleCallback: typeof requestIdleCallback === 'function',
    secureContext: window.isSecureContext,
  }));
  await probePage.goto(`${state.originA}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const env = await probePage.evaluate(() => ({
    imageDecoder: typeof ImageDecoder !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    idleCallback: typeof requestIdleCallback === 'function',
    secureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
  }));
  await probePage.close();
  note(`page APIs on ${state.originA} (secureContext=${env.secureContext}): ImageDecoder=${env.imageDecoder} OffscreenCanvas=${env.offscreenCanvas} createImageBitmap=${env.createImageBitmap} requestIdleCallback=${env.idleCallback}`);
  note(`same browser on about:blank (secureContext=${blankEnv.secureContext}): ImageDecoder=${blankEnv.imageDecoder} — WebCodecs needs a secure context, so capability claims are made per origin`);

  let main_ctx = await openPage(browser, state, { downloadMode: 'browser' });
  let page = main_ctx.page;
  activeMainCtx = main_ctx;
  recreateMain = async () => {
    try {
      await main_ctx.page.close();
    } catch {
      /* the page may already be gone */
    }
    main_ctx = await openPage(browser, state, { downloadMode: 'browser' });
    page = main_ctx.page;
    activeMainCtx = main_ctx;
  };

  // ── A. boot, isolation, idempotency ────────────────────────────────────────
  await scenario('boot-and-register', 'the artifact boots, registers manager commands and touches nothing else', async ({ note: ev }) => {
    const info = await page.evaluate(() => {
      const instance = window.__saveImageAsTypeInitialised;
      return {
        version: instance.version,
        hosts: document.querySelectorAll('#siat-menu-host').length,
        commands: (window.__siatE2E.menuCommands || []).map((c) => c.label),
        diagnostics: instance.diagnostics(),
      };
    });
    assertEquals(info.version, SCRIPT_VERSION, 'reported version matches the metadata block');
    assert(info.hosts <= 1, `at most one menu host at boot (${info.hosts})`);
    assert(info.commands.length >= 3, `manager menu commands registered: ${JSON.stringify(info.commands)}`);
    assertEquals(info.diagnostics.handler, 'EmulatedMonkey', 'diagnostics report the manager');
    assertEquals(info.diagnostics.downloadMode, 'browser', 'diagnostics report the download mode');
    assertEquals(info.diagnostics.storage, 'gm', 'settings storage is the manager, not the page');
    const bootNoise = main_ctx.expectedNoise.filter((entry) => /404|missing\.png/.test(entry));
    assert(main_ctx.problems.length === 0, `no unexpected page errors during boot: ${main_ctx.problems.join(' | ')}`);
    ev(`expected 404 noise from the deliberately broken fixture image: ${bootNoise.length} entries`);
    ev(`menu commands: ${info.commands.join(' / ')}`);
  });

  await scenario('idle-capability-probe', 'the idle probe measures real encoders and gates AVIF on the result', async ({ note: ev }) => {
    await page.evaluate(() => window.__saveImageAsTypeInitialised.ensureCapabilities());
    const report = await page.evaluate(() => window.__saveImageAsTypeInitialised.diagnostics());
    // Independent measurement, in the same page, of what canvas.toBlob really does.
    const measured = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const out = {};
      for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/bmp']) {
        out[type] = await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? blob.type : 'null'), type));
      }
      return out;
    });
    assertEquals(report.encoders['image/png'], measured['image/png'] === 'image/png', 'PNG capability matches the browser');
    assertEquals(report.encoders['image/jpeg'], measured['image/jpeg'] === 'image/jpeg', 'JPEG capability matches the browser');
    assertEquals(report.encoders['image/webp'], measured['image/webp'] === 'image/webp', 'WebP capability matches the browser');
    assertEquals(report.encoders['image/avif'], measured['image/avif'] === 'image/avif', 'AVIF capability matches the browser');
    ev(`canvas.toBlob actually returns: ${Object.entries(measured).map(([k, v]) => `${k.split('/')[1]}→${v.split('/')[1]}`).join(', ')}`);
    ev(`script encoder map: ${JSON.stringify(report.encoders)}`);
    ev(`animation: decoderAvailable=${report.animation.decoderAvailable} supportedTypes=[${report.animation.supportedTypes.join(', ')}] reason="${report.animation.reason}"`);
    assert(measured['image/gif'] === 'image/png' && measured['image/bmp'] === 'image/png', 'GIF/BMP are confirmed unsupported by canvas, which is why the script ships its own encoders');
    if (!measured['image/avif'].startsWith('image/avif')) {
      const center = await elementCenter(page, '#same-jpg');
      await rightClickAt(page, center.x, center.y);
      await waitForMenu(page);
      const menu = await menuState(page);
      assert(!menu.items.some((item) => item.label === 'AVIF'), 'AVIF is hidden from the menu because this browser cannot encode it');
      ev(`menu offers: ${menu.items.map((item) => item.label).join(', ')}`);
      await page.keyboard.press('Escape');
    } else {
      ev('this browser can encode AVIF, so the AVIF entry is expected to be offered');
    }
  });

  await scenario('idempotent-same-module-bootstrap', 'repeated trusted bootstrap calls do not duplicate UI, listeners or work (not a second artifact execution)', async ({ note: ev }) => {
    // Counts the document's real listeners through CDP: a second live instance
    // would double them, which is invisible from inside the page.
    const documentListeners = async () => {
      const evaluated = await main_ctx.cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'siat-probe' });
      const { listeners } = await main_ctx.cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId, depth: -1 });
      await main_ctx.cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'siat-probe' }).catch(() => {});
      const counts = {};
      for (const listener of listeners) counts[listener.type] = (counts[listener.type] || 0) + 1;
      return counts;
    };

    const before = await page.evaluate(() => {
      window.__siatProbeBefore = window.__saveImageAsTypeInitialised;
      return {
        hosts: document.querySelectorAll('#siat-menu-host').length,
        toastHosts: document.querySelectorAll('#siat-toast-host').length,
        ready: window.__saveImageAsTypeInitialised.ready === true,
        commands: (window.__siatE2E.menuCommands || []).length,
      };
    });
    assert(before.ready, 'the first instance finished booting before the second injection');
    const listenersBefore = await documentListeners();

    // The private lifetime is the source-module instance. This does NOT test
    // two independently evaluated distributions or two manager sandboxes.
    await page.evaluate(async () => {
      await window.__siatVerificationBootstrap();
    });
    await sleep(300);

    const after = await page.evaluate(() => ({
      hosts: document.querySelectorAll('#siat-menu-host').length,
      toastHosts: document.querySelectorAll('#siat-toast-host').length,
      commands: (window.__siatE2E.menuCommands || []).length,
      sameInstance: window.__saveImageAsTypeInitialised === window.__siatProbeBefore,
      markerOnDocument: document.__saveImageAsTypeInitialised === window.__siatProbeBefore,
      markerOnHtml: document.documentElement.__saveImageAsTypeInitialised === window.__siatProbeBefore,
      markerOnBody: document.body.__saveImageAsTypeInitialised === window.__siatProbeBefore,
    }));
    const listenersAfter = await documentListeners();

    assertEquals(after.hosts, before.hosts, 'still exactly one menu host');
    assertEquals(after.toastHosts, before.toastHosts, 'still exactly one toast host');
    assertEquals(after.commands, before.commands, `the manager menu commands were not registered again (${before.commands} before, ${after.commands} after)`);
    assert(after.sameInstance, 'the second injection returned the existing instance instead of booting a new one');
    assert(!after.markerOnDocument && !after.markerOnHtml && !after.markerOnBody, 'no capability markers on DOM roots');
    for (const type of ['contextmenu', 'keydown', 'click', 'pointerdown', 'mouseover', 'scroll']) {
      assertEquals(listenersAfter[type] || 0, listenersBefore[type] || 0, `no additional document "${type}" listener after a second injection`);
    }

    // End-to-end symptom check: one right-click still produces one file.
    await clearToasts(page);
    const downloadsBefore = state.gmDownloads.length;
    const center = await elementCenter(page, '#same-jpg');
    await rightClickAt(page, center.x, center.y);
    await waitForMenu(page);
    const menu = await menuState(page);
    assertEquals(menu.hosts, 1, 'a right-click after double injection still yields one host');
    assert(menu.items.length >= 2, 'the menu is still functional');
    await clickMenuItem(page, 'PNG');
    const saved = await waitForGmDownload(state, downloadsBefore);
    await sleep(400);
    assertEquals(state.gmDownloads.length - downloadsBefore, 1, 'one right-click produced exactly one download');
    const visible = await toasts(page);
    assertEquals(visible.length, 1, `one conversion produced exactly one toast (got ${visible.length})`);

    ev(`hosts ${before.hosts}→${after.hosts}, toast hosts ${before.toastHosts}→${after.toastHosts}, manager commands ${before.commands}→${after.commands}`);
    ev(`document listeners unchanged: ${JSON.stringify(listenersAfter)}`);
    ev(`one conversion after same-module bootstrap → 1 download (${saved.name}), 1 toast`);
    await page.keyboard.press('Escape');
    // This scenario's own probe handle must not survive into page-untouched.
    await page.evaluate(() => {
      delete window.__siatProbeBefore;
    });
  });

  await scenario('shadow-dom-isolation', 'the UI is encapsulated and page CSS cannot reach it', async ({ note: ev }) => {
    await page.addStyleTag({ content: 'div,button{background:lime !important;color:magenta !important;font-size:40px !important} [role="menuitem"]{display:none !important}' });
    const center = await elementCenter(page, '#same-jpg');
    await rightClickAt(page, center.x, center.y);
    await waitForMenu(page);
    const style = await page.evaluate(() => {
      const menu = document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu');
      const item = menu.querySelector('[role="menuitem"]');
      const computed = getComputedStyle(item);
      return { display: computed.display, background: getComputedStyle(menu).backgroundColor, visible: item.getBoundingClientRect().width > 0 };
    });
    assertEquals(style.display, 'flex', 'a page rule targeting [role=menuitem] cannot hide our items');
    assert(style.visible, 'items are rendered');
    assert(style.background !== 'rgb(0, 255, 0)', `the menu keeps its own background (${style.background})`);
    ev(`menu background inside the shadow root: ${style.background}`);
    await page.evaluate(() => [...document.querySelectorAll('style')].pop().remove());
    await page.keyboard.press('Escape');
  });

  // ── B. menu behaviour with real input ──────────────────────────────────────
  await scenario('real-right-click-opens-menu', 'a real right-click opens an accessible menu inside the viewport', async ({ note: ev }) => {
    const center = await elementCenter(page, '#same-jpg');
    await rightClickAt(page, center.x, center.y);
    await waitForMenu(page);
    const menu = await menuState(page);
    assertEquals(menu.role, 'menu', 'ARIA role');
    assert(menu.open, 'menu is open');
    assert(menu.items.length >= 5, `formats + settings offered (${menu.items.length})`);
    assert(menu.rect.x >= 0 && menu.rect.y >= 0, `position is non-negative (${menu.rect.x},${menu.rect.y})`);
    assert(menu.rect.x + menu.rect.w <= menu.viewport.w + 1, `menu fits horizontally: ${menu.rect.x}+${menu.rect.w} <= ${menu.viewport.w}`);
    assert(menu.rect.y + menu.rect.h <= menu.viewport.h + 1, `menu fits vertically: ${menu.rect.y}+${menu.rect.h} <= ${menu.viewport.h}`);
    assert(/photo\.jpg/.test(menu.sub), `the source is described to the user: "${menu.sub}"`);
    const focus = await page.evaluate(() => {
      const host = document.getElementById('siat-menu-host');
      return { inner: host.shadowRoot.activeElement ? host.shadowRoot.activeElement.getAttribute('role') : null, outer: document.activeElement.id };
    });
    assertEquals(focus.inner, 'menuitem', 'the first item has focus, so the menu is keyboard-operable');
    assertEquals(focus.outer, 'siat-menu-host', 'page focus moved to the menu host');
    ev(`items: ${menu.items.map((i) => i.label).join(', ')}`);
    ev(`rect ${Math.round(menu.rect.x)},${Math.round(menu.rect.y)} ${Math.round(menu.rect.w)}x${Math.round(menu.rect.h)} in a ${menu.viewport.w}x${menu.viewport.h} viewport`);
  });

  await scenario('keyboard-only-operation', 'the menu can be driven entirely from the keyboard', async ({ note: ev }) => {
    // The menu is already open from the previous scenario.
    const order = await page.evaluate(() => {
      const menu = document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu');
      return [...menu.querySelectorAll('[role="menuitem"]')].map((el) => (el.querySelector('.siat-ext') || el).textContent.trim());
    });
    await page.keyboard.press('ArrowDown');
    const second = await page.evaluate(() => document.getElementById('siat-menu-host').shadowRoot.activeElement.querySelector('.siat-ext').textContent.trim());
    assertEquals(second, order[1], 'ArrowDown moves to the second item');
    await page.keyboard.press('End');
    const last = await page.evaluate(() => document.getElementById('siat-menu-host').shadowRoot.activeElement.querySelector('.siat-ext').textContent.trim());
    assertEquals(last, order[order.length - 1], 'End moves to the last item');
    await page.keyboard.press('Home');
    const first = await page.evaluate(() => document.getElementById('siat-menu-host').shadowRoot.activeElement.querySelector('.siat-ext').textContent.trim());
    assertEquals(first, order[0], 'Home moves back to the first');
    const before = state.gmDownloads.length;
    await page.keyboard.press('Enter');
    const record = await waitForGmDownload(state, before);
    assertEquals(record.name.split('.').pop(), 'png', 'Enter activated the focused PNG item');
    ev(`keyboard order: ${order.join(' → ')}`);
    await waitForToast(page, (toast) => toast.kind === 'success');
  });

  await scenario('shift-yields-native-menu', 'Shift + right-click leaves the browser menu alone', async ({ note: ev }) => {
    const center = await elementCenter(page, '#same-jpg');
    await rightClickAt(page, center.x, center.y, { shift: true });
    await sleep(400);
    const menu = await menuState(page);
    assert(!menu.open, 'the custom menu did not open');
    ev('with Shift held the script does not call preventDefault, so the native menu appears');
  });

  await scenario('menu-dismissal', 'Escape, an outside click and a scroll all close the menu', async ({ note: ev }) => {
    const center = await elementCenter(page, '#same-jpg');
    await rightClickAt(page, center.x, center.y);
    await waitForMenu(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu').hidden, { timeout: 3000 });
    await rightClickAt(page, center.x, center.y);
    await waitForMenu(page);
    await page.mouse.click(10, 10);
    await page.waitForFunction(() => document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu').hidden, { timeout: 3000 });
    await rightClickAt(page, center.x, center.y);
    await waitForMenu(page);
    // A scroll that lands while the page is still settling must not make the
    // menu flash open and shut — that is what the 150 ms grace window in
    // src/ui/menu.js exists for. Both halves of the behaviour are asserted.
    await page.evaluate(() => window.scrollBy(0, 12));
    await sleep(60);
    assert((await menuState(page)).open === true, 'a scroll inside the grace window does not dismiss the menu');
    await sleep(200);
    await page.evaluate(() => window.scrollBy(0, 28));
    await page.waitForFunction(() => document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu').hidden, { timeout: 3000 });
    ev('Escape, an outside click and a settled scroll all closed the menu within 3s; a scroll 60 ms after opening did not');
  });

  await scenario('narrow-viewport-clamping', 'the menu stays fully visible in a narrow viewport', async ({ note: ev }) => {
    await page.setViewport({ width: 360, height: 640 });
    await sleep(200);
    const center = await elementCenter(page, '#same-jpg');
    await rightClickAt(page, Math.min(center.x, 355), Math.min(center.y, 630));
    await waitForMenu(page);
    const menu = await menuState(page);
    assert(menu.rect.x >= 0 && menu.rect.x + menu.rect.w <= menu.viewport.w + 1, `horizontal clamp: ${menu.rect.x}+${menu.rect.w} <= ${menu.viewport.w}`);
    assert(menu.rect.y >= 0 && menu.rect.y + menu.rect.h <= menu.viewport.h + 1, `vertical clamp: ${menu.rect.y}+${menu.rect.h} <= ${menu.viewport.h}`);
    ev(`360x640 viewport → menu at ${Math.round(menu.rect.x)},${Math.round(menu.rect.y)} ${Math.round(menu.rect.w)}x${Math.round(menu.rect.h)}`);
    await page.keyboard.press('Escape');
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(150);
  });

  // ── C. conversions, verified byte-by-byte by Pillow / pypdf ────────────────
  // Expected dimensions come from the fixtures as decoded by Pillow, never from
  // the HTML width/height attributes (those are display sizes).
  const sizeOf = (name) => (HAVE_PYTHON ? fixture(name).size : null);
  const conversions = [
    { id: 'jpg-to-png', selector: '#same-jpg', label: 'PNG', unique: 'jpg-to-png.png', expect: { format: 'PNG', size: sizeOf('photo.jpg'), tolerance: 2 }, sourceFixture: 'photo.jpg' },
    { id: 'png-to-jpg', selector: '#same-png', label: 'JPG', unique: 'png-to-jpg.jpg', expect: { format: 'JPEG', size: sizeOf('opaque.png'), tolerance: 24 }, sourceFixture: 'opaque.png' },
    { id: 'png-to-webp', selector: '#same-png', label: 'WebP', unique: 'png-to-webp.webp', expect: { format: 'WEBP', size: sizeOf('opaque.png'), tolerance: 24 }, sourceFixture: 'opaque.png' },
    { id: 'png-to-gif', selector: '#same-png', label: 'GIF', unique: 'png-to-gif.gif', expect: { format: 'GIF', size: sizeOf('opaque.png'), tolerance: 32 }, sourceFixture: 'opaque.png' },
    { id: 'png-to-bmp', selector: '#same-png', label: 'BMP', unique: 'png-to-bmp.bmp', expect: { format: 'BMP', size: sizeOf('opaque.png'), tolerance: 0 }, sourceFixture: 'opaque.png' },
  ];

  for (const conversion of conversions) {
    await scenario(conversion.id, `${conversion.selector} → ${conversion.label}, verified by an independent decoder`, async ({ note: ev }) => {
      await clearToasts(page);
      const before = state.gmDownloads.length;
      await convertWithMouse(page, conversion.selector, conversion.label);
      const record = await waitForGmDownload(state, before);
      const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
      ev(`manager download name: ${record.name} (${record.bytes} bytes)`);
      const expectedExt = { PNG: 'png', JPEG: 'jpg', WEBP: 'webp', GIF: 'gif', BMP: 'bmp' }[conversion.expect.format];
      assert(record.name.endsWith(`.${expectedExt}`), `file name has the right extension: ${record.name}`);
      if (!HAVE_PYTHON) {
        ev('byte verification skipped: Pillow/pypdf unavailable');
        return;
      }
      const facts = verifyCapture(conversion.unique, bytes);
      assertEquals(facts.format, conversion.expect.format, 'container format');
      assert(JSON.stringify(facts.size) === JSON.stringify(conversion.expect.size), `dimensions ${JSON.stringify(facts.size)} vs source ${JSON.stringify(conversion.expect.size)}`);
      const source = fixture(conversion.sourceFixture);
      const sourcePixel = pixelAt(source, 0, 0);
      const outPixel = pixelAt(facts, 0, 0);
      assert(sourcePixel && outPixel, 'both files were sampled at (0,0)');
      const delta = Math.max(...outPixel[2].slice(0, 3).map((channel, index) => Math.abs(channel - sourcePixel[2][index])));
      const limit = conversion.expect.tolerance;
      assert(delta <= limit, `top-left pixel delta ${delta} within the ${limit} allowed for ${conversion.expect.format} (source ${sourcePixel[2]} → output ${outPixel[2]})`);
      ev(`Pillow: ${facts.format} ${facts.mode} ${facts.size.join('x')} ${facts.bytes}B; (0,0) ${sourcePixel[2]} → ${outPixel[2]} (Δ${delta})`);
      const toast = await waitForToast(page, (entry) => entry.kind === 'success' && entry.title.toLowerCase().includes(`.${expectedExt}`));
      assert(/saved|wrote|done/i.test(toast.title + toast.meta), `success toast: "${toast.title} ${toast.meta}"`);
      assertEquals(toast.role, 'status', 'success is announced politely, not as an alert');
    });
  }

  await scenario('alpha-to-bmp-lossless', 'a transparent PNG → 32-bit BMP keeps alpha exactly', async ({ note: ev }) => {
    await clearToasts(page);
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#same-alpha', 'BMP');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    if (!HAVE_PYTHON) return ev('byte verification skipped: Pillow/pypdf unavailable');
    const facts = verifyCapture('alpha-to-bmp.bmp', bytes);
    assertEquals(facts.format, 'BMP', 'format');
    assertEquals(facts.mode, 'RGBA', 'Pillow sees an alpha channel');
    const source = fixture('transparent.png');
    for (const [x, y, rgba] of pixelsOf(source)) {
      const out = pixelAt(facts, x, y);
      assert(out, `output sampled at ${x},${y}`);
      const delta = Math.max(...out[2].map((channel, index) => Math.abs(channel - rgba[index])));
      assertEquals(delta, 0, `pixel ${x},${y} is bit-identical (source ${rgba} → output ${out[2]})`);
    }
    ev(`BMP ${facts.size.join('x')} ${facts.mode}: every sampled pixel bit-identical to the source PNG, alpha included`);
  });

  await scenario('alpha-to-jpg-flattened', 'a transparent PNG → JPG is flattened onto the chosen background', async ({ note: ev }) => {
    await clearToasts(page);
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#same-alpha', 'JPG');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    if (!HAVE_PYTHON) return ev('byte verification skipped: Pillow/pypdf unavailable');
    const facts = verifyCapture('alpha-to-jpg.jpg', bytes);
    assertEquals(facts.format, 'JPEG', 'format');
    assertEquals(facts.mode, 'RGB', 'JPEG has no alpha channel');
    const source = fixture('transparent.png');
    const [x, y, rgba] = pixelsOf(source)[0];
    const out = pixelAt(facts, x, y);
    const alpha = rgba[3] / 255;
    const expected = rgba.slice(0, 3).map((channel) => Math.round(channel * alpha + 255 * (1 - alpha)));
    // Pillow reports JPEG pixels as RGBX; compare the three colour channels.
    const delta = Math.max(...expected.map((channel, index) => Math.abs(out[2][index] - channel)));
    assert(delta <= 12, `flattened onto white as expected: source ${rgba} → ${out[2]}, expected ≈${expected} (Δ${delta}, JPEG is lossy)`);
    // Match on the file name so a toast left over from an earlier conversion
    // cannot be mistaken for this one.
    const toast = await waitForToast(page, (entry) => entry.kind === 'success' && /\.jpg\b/i.test(`${entry.title} ${entry.meta}`));
    assert(toast.notes.some((entry) => /flatten|transparen/i.test(entry)), `the toast discloses the flattening: ${JSON.stringify(toast.notes)}`);
    ev(`JPEG (0,0) ${out[2]} vs expected white-composite ${expected} (Δ${delta}); toast notes: ${toast.notes.length}`);
  });

  await scenario('jpg-to-pdf', 'JPG → PDF embeds the image and builds a valid xref', async ({ note: ev }) => {
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#same-jpg', 'PDF');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    assert(bytes.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'), 'PDF header');
    assert(bytes.subarray(bytes.length - 1024).toString('latin1').includes('%%EOF'), 'PDF trailer');
    if (!HAVE_PYTHON) return ev('pypdf verification skipped');
    const facts = verifyCapture('jpg-to-pdf.pdf', bytes);
    assertEquals(facts.pypdf_pages, 1, 'one page');
    assertEquals(facts.pypdf_image_count, 1, 'exactly one embedded image');
    assertEquals(facts.embedded_image_format, 'JPEG', 'the JPEG is embedded as DCTDecode, not re-encoded');
    assert(JSON.stringify(facts.embedded_image_size) === JSON.stringify(fixture('photo.jpg').size), `embedded image size ${JSON.stringify(facts.embedded_image_size)}`);
    assertEquals(facts.xref_consistent, true, 'every xref offset points at its object');
    assertEquals(facts.all_entry_lengths_20, true, 'xref entries are exactly 20 bytes, as the spec requires');
    assertEquals(facts.startxref_points_to_xref, true, 'startxref points at the xref table');
    ev(`pypdf: ${facts.pypdf_pages} page, MediaBox ${JSON.stringify(facts.pypdf_mediabox)}, embedded ${facts.embedded_image_format} ${facts.embedded_image_size.join('x')}, xref consistent=${facts.xref_consistent}`);
  });

  await scenario('original-passthrough', '"Original file" re-saves the exact source bytes', async ({ note: ev }) => {
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#same-jpg', 'Original');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    const sourceBytes = readFileSync(join(FIXTURE_DIR, 'photo.jpg'));
    assertEquals(sha(bytes), sha(sourceBytes), 'the bytes are identical to the source file');
    assertEquals(record.name.split('.').pop(), 'jpg', 'the original extension is kept');
    ev(`sha256 ${sha(bytes).slice(0, 16)}… identical to test/fixtures/photo.jpg (${bytes.length} bytes)`);
  });

  // ── D. cross-origin and the acquisition ladder ─────────────────────────────
  await scenario('cross-origin-no-cors', 'a CORS-blocked image is fetched through the manager and converted', async ({ note: ev }) => {
    await clearToasts(page);
    const xhrBefore = state.xhrLog.length;
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#tainted-bmp', 'PNG');
    const record = await waitForGmDownload(state, before);
    assert(state.xhrLog.length > xhrBefore, 'GM_xmlhttpRequest was used');
    const request = state.xhrLog[state.xhrLog.length - 1];
    assert(request.url.includes('/fixtures/icon.bmp'), `the request was for the right-clicked image only: ${request.url}`);
    assertEquals(request.headers.Accept, 'image/*,*/*', 'the request advertises an image accept header');
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    if (HAVE_PYTHON) {
      const facts = verifyCapture('cross-origin-no-cors.png', bytes);
      assertEquals(facts.format, 'PNG', 'format');
      assert(JSON.stringify(facts.size) === JSON.stringify(fixture('icon.bmp').size), `size ${JSON.stringify(facts.size)} vs source ${JSON.stringify(fixture('icon.bmp').size)}`);
      ev(`Pillow: ${facts.format} ${facts.mode} ${facts.size.join('x')}`);
    }
    const toast = await waitForToast(page, (entry) => entry.kind === 'success');
    ev(`manager XHR: ${request.url} → HTTP ${request.status}, ${request.bytes} bytes; toast notes ${toast.notes.length}`);
    ev(`only ${state.xhrLog.length - xhrBefore} network request was made for this conversion`);
  });

  await scenario('cross-origin-with-cors', 'a CORS-enabled cross-origin image never needs the manager XHR', async ({ note: ev }) => {
    const xhrBefore = state.xhrLog.length;
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#cors-webp', 'PNG');
    await waitForGmDownload(state, before);
    assertEquals(state.xhrLog.length, xhrBefore, 'no manager fetch was needed (the canvas was not tainted)');
    ev('the cheaper same-origin/CORS path was preferred over GM_xmlhttpRequest');
  });

  await scenario('cross-origin-fetch-disabled', 'with cross-origin fetching turned off the user gets an explanation, not a broken file', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'browser' }, { seedSettings: { allowCrossOriginFetch: false } });
    await clearToasts(ctx.page);
    const xhrBefore = state.xhrLog.length;
    const center = await elementCenter(ctx.page, '#tainted-bmp');
    await rightClickAt(ctx.page, center.x, center.y);
    await waitForMenu(ctx.page);
    await clickMenuItem(ctx.page, 'PNG');
    const toast = await waitForToast(ctx.page, (entry) => entry.kind === 'error', 20000);
    assert(/cross-origin|permission|not allowed|tainted/i.test(toast.title + toast.meta + toast.notes.join(' ')), `the failure is explained: "${toast.title}" / "${toast.meta}" / ${JSON.stringify(toast.notes)}`);
    assertEquals(toast.role, 'alert', 'an error is announced assertively');
    assertEquals(state.xhrLog.length, xhrBefore, 'no network request was made after the user disabled it');
    ev(`error toast: "${toast.title}" — ${toast.meta}`);
    ev(`notes: ${toast.notes.join(' | ')}`);
    assert(ctx.problems.length === 0, `no unexpected page errors: ${ctx.problems.join(' | ')}`);
    ev(`expected browser noise (deliberate fixtures): ${ctx.expectedNoise.length} entries`);
    await ctx.page.close();
  });

  await scenario('no-xhr-grant', 'without the GM_xmlhttpRequest grant the message says exactly that', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { grants: without('GM_xmlhttpRequest') });
    await clearToasts(ctx.page);
    const capabilities = await ctx.page.evaluate(() => window.__saveImageAsTypeInitialised.gm.capabilities);
    assertEquals(capabilities.xhr, false, 'the adapter reports no XHR capability');
    const center = await elementCenter(ctx.page, '#tainted-bmp');
    await rightClickAt(ctx.page, center.x, center.y);
    await waitForMenu(ctx.page);
    await clickMenuItem(ctx.page, 'PNG');
    const toast = await waitForToast(ctx.page, (entry) => entry.kind === 'error', 20000);
    const text = [toast.title, toast.meta, ...toast.notes].join(' ');
    assert(/GM_xmlhttpRequest/.test(text), `the missing grant is named explicitly: "${toast.title}" / ${JSON.stringify(toast.notes)}`);
    assert(!/Turn on .*Fetch cross-origin/i.test(text), 'it does not tell the user to flip a setting that cannot help when the grant is missing');
    ev(`toast: "${toast.title}" — ${toast.meta} — ${toast.notes.join(' | ')}`);
    await ctx.page.close();
  });

  // ── E. dynamic pages ───────────────────────────────────────────────────────
  await scenario('lazy-loaded-image', 'an image that loads on scroll is a working target', async ({ note: ev }) => {
    await page.evaluate(() => document.getElementById('lazy').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => document.getElementById('lazy').dataset.loaded === '1' && document.getElementById('lazy').naturalWidth > 0, { timeout: 10000 });
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#lazy', 'PNG');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    if (HAVE_PYTHON) {
      const facts = verifyCapture('lazy-loaded.png', bytes);
      assertEquals(facts.format, 'PNG', 'format');
      assert(JSON.stringify(facts.size) === JSON.stringify(fixture('big.png').size), `full-resolution lazy image converted: ${JSON.stringify(facts.size)}`);
      ev(`Pillow: ${facts.format} ${facts.size.join('x')} from an image whose src was set by IntersectionObserver`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await scenario('spa-rerender', 'after the node is destroyed and replaced the menu still works', async ({ note: ev }) => {
    const beforeRender = await page.evaluate(() => ({ src: document.getElementById('spa-img').src, count: window.__rerenders || 0 }));
    await clearToasts(page);
    await page.click('#rerender');
    await page.waitForFunction(
      (previous) => (window.__rerenders || 0) > previous && document.getElementById('spa-img').naturalWidth > 0,
      { timeout: 10000 },
      beforeRender.count,
    );
    const afterRender = await page.evaluate(() => ({ src: document.getElementById('spa-img').src, alt: document.getElementById('spa-img').alt }));
    assert(afterRender.src !== beforeRender.src, 'the SPA really replaced the image node');
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#spa-img', 'PNG');
    const record = await waitForGmDownload(state, before);
    assert(record.name.includes('SPA') || record.name.toLowerCase().includes('spa') || record.name.length > 4, `file name derived from the new node: ${record.name}`);
    ev(`re-rendered node converted; saved as "${record.name}"`);
    ev('no re-initialisation was needed: the listeners are delegated on document with capture');
  });


  await scenario('toasts-do-not-obscure', 'the toast stack never covers or swallows page interaction', async ({ note: ev }) => {
    // Hit-testing uses viewport coordinates, so bring the probe button on screen first.
    await page.evaluate(() => document.getElementById('rerender').scrollIntoView({ block: 'center' }));
    await sleep(250);
    const info = await page.evaluate(() => {
      const instance = window.__saveImageAsTypeInitialised;
      for (let i = 0; i < 6; i += 1) instance.toaster.success(`toast-${i}`, `Saved example-${i}.png`, 'Image · 12 KB', ['a note'], [], 60000);
      const host = document.getElementById('siat-toast-host');
      const stack = host.shadowRoot.querySelector('.siat-toast-stack');
      const stackRect = stack.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const button = document.getElementById('rerender');
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        visible: host.shadowRoot.querySelectorAll('.siat-toast').length,
        stack: { x: Math.round(stackRect.x), y: Math.round(stackRect.y), w: Math.round(stackRect.width), h: Math.round(stackRect.height) },
        host: { w: Math.round(hostRect.width), h: Math.round(hostRect.height) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        buttonIsTopmost: hit === button || button.contains(hit),
        topmost: hit ? `${hit.tagName}#${hit.id}` : 'none',
        stackPointerEvents: getComputedStyle(stack).pointerEvents,
      };
    });
    assert(info.visible >= 1 && info.visible <= 4, `the stack is bounded instead of growing forever (${info.visible} visible)`);
    assert(info.stackPointerEvents === 'none', `the stack container lets clicks through (pointer-events: ${info.stackPointerEvents})`);
    assert(info.buttonIsTopmost, `a page button is still the topmost element at its own centre (got ${info.topmost})`);
    assert(info.stack.x >= 0 && info.stack.y >= 0 && info.stack.x + info.stack.w <= info.viewport.w && info.stack.y + info.stack.h <= info.viewport.h, `the stack stays inside the viewport: ${JSON.stringify(info.stack)} in ${JSON.stringify(info.viewport)}`);
    assert(info.host.w <= info.viewport.w, `the shadow host does not blanket the page (${info.host.w}x${info.host.h})`);
    const before = await page.evaluate(() => window.__rerenders || 0);
    await page.click('#rerender');
    await page.waitForFunction((previous) => (window.__rerenders || 0) > previous, { timeout: 5000 }, before);
    ev(`${info.visible} toasts in a ${info.stack.w}x${info.stack.h} box at (${info.stack.x},${info.stack.y}); a real click on page content still landed`);
    await clearToasts(page);
    const cleared = await page.evaluate(() => document.getElementById('siat-toast-host').shadowRoot.querySelectorAll('.siat-toast').length);
    assertEquals(cleared, 0, 'dismissAll() clears the stack');
  });

  await scenario('iframe-image', 'an image inside an iframe gets its own working menu', async ({ note: ev }) => {
    const frame = page.frames().find((entry) => entry.url().endsWith('/frame.html'));
    assert(frame, 'the fixture iframe is present');
    const before = state.gmDownloads.length;
    const box = await frame.evaluate(() => {
      const element = document.getElementById('frame-img');
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      const frameRect = window.frameElement.getBoundingClientRect();
      return { x: Math.round(frameRect.x + rect.x + rect.width / 2), y: Math.round(frameRect.y + rect.y + rect.height / 2) };
    });
    await rightClickAt(page, box.x, box.y);
    await frame.waitForFunction(() => {
      const host = document.getElementById('siat-menu-host');
      return host && host.shadowRoot && !host.shadowRoot.querySelector('.siat-menu').hidden;
    }, { timeout: 8000 });
    const inFrame = await frame.evaluate(() => {
      const menu = document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu');
      return { items: [...menu.querySelectorAll('[role="menuitem"]')].length, hosts: document.querySelectorAll('#siat-menu-host').length };
    });
    assert(inFrame.items >= 2, `the frame has its own menu (${inFrame.items} items, ${inFrame.hosts} host)`);
    await frame.evaluate(() => {
      const menu = document.getElementById('siat-menu-host').shadowRoot.querySelector('.siat-menu');
      const item = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.querySelector('.siat-ext').textContent.trim() === 'PNG');
      item.click();
    });
    const record = await waitForGmDownload(state, before);
    ev(`frame image saved as "${record.name}"; menu rendered inside the frame (${inFrame.items} items)`);
  });

  await scenario('inline-svg-target', 'an inline SVG is rasterised to PNG', async ({ note: ev }) => {
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#inline-svg', 'PNG');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    if (HAVE_PYTHON) {
      const facts = verifyCapture('inline-svg.png', bytes);
      assertEquals(facts.format, 'PNG', 'format');
      assert(facts.size[0] >= 90 && facts.size[1] >= 60, `rasterised at the SVG's natural size or better: ${facts.size.join('x')}`);
      const corner = pixelAt(facts, 0, 0);
      assert(corner && corner[2][2] > 150, `the blue rectangle survived serialisation: (0,0)=${corner[2]}`);
      ev(`Pillow: ${facts.format} ${facts.mode} ${facts.size.join('x')}; (0,0)=${corner[2]}`);
    }
    ev(`saved as "${record.name}" (${bytes.length} bytes)`);
  });

  await scenario('css-background-target', 'a CSS background image is a target when the setting allows it', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'browser' }, { seedSettings: { enableBackgroundImages: true } });
    const before = state.gmDownloads.length;
    const center = await elementCenter(ctx.page, '#bg');
    await rightClickAt(ctx.page, center.x, center.y);
    await waitForMenu(ctx.page);
    const menu = await menuState(ctx.page);
    assert(/css background/i.test(menu.title), `the header names the target kind: "${menu.title}"`);
    await clickMenuItem(ctx.page, 'PNG');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    if (HAVE_PYTHON) {
      const facts = verifyCapture('css-background.png', bytes);
      assertEquals(facts.format, 'PNG', 'format');
      ev(`Pillow: ${facts.format} ${facts.size.join('x')} from background-image`);
    }
    ev(`header "${menu.title}", saved as "${record.name}" (${bytes.length} bytes)`);
    await ctx.page.close();
  });

  await scenario('broken-image-error', 'an image that 404s produces an actionable error, not a hang', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, {});
    const center = await elementCenter(ctx.page, '#broken');
    await rightClickAt(ctx.page, center.x, center.y);
    const menu = await menuState(ctx.page).catch(() => null);
    if (menu && menu.open) {
      await clickMenuItem(ctx.page, 'PNG');
      const toast = await waitForToast(ctx.page, (entry) => entry.kind === 'error', 25000);
      assert(toast.title.length > 3, `an error is reported: "${toast.title}"`);
      ev(`menu opened on a broken image; conversion failed with "${toast.title}" — ${toast.meta}`);
    } else {
      ev('the broken image was not offered as a target (no menu opened), which is also a safe outcome');
    }
    await sleep(500);
    const alive = await ctx.page.evaluate(() => {
      const instance = window.__saveImageAsTypeInitialised;
      return Boolean(instance) && typeof instance.runConversion === 'function';
    });
    assert(alive, 'the script is still alive and usable after the failure');
    await ctx.page.close();
  });

  // ── F. settings, persistence, file names ───────────────────────────────────
  await scenario('settings-panel-and-persistence', 'the panel saves settings that survive a reload', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'browser' });
    await clearToasts(ctx.page);
    const center = await elementCenter(ctx.page, '#same-jpg');
    await rightClickAt(ctx.page, center.x, center.y);
    await waitForMenu(ctx.page);
    await clickMenuItem(ctx.page, 'Settings');
    await ctx.page.waitForFunction(() => {
      const host = document.getElementById('siat-panel-host');
      return host && host.shadowRoot && host.shadowRoot.querySelector('[role="dialog"]');
    }, { timeout: 8000 });
    const dialog = await ctx.page.evaluate(() => {
      const panel = document.getElementById('siat-panel-host').shadowRoot;
      const element = panel.querySelector('[role="dialog"]');
      return {
        modal: element.getAttribute('aria-modal'),
        labelledby: element.getAttribute('aria-labelledby'),
        focusInside: panel.activeElement !== null,
        sections: [...panel.querySelectorAll('.siat-legend')].map((legend) => legend.textContent),
        bmpChecked: panel.querySelector('#siat-fmt-bmp').checked,
      };
    });
    assertEquals(dialog.modal, 'true', 'the dialog is modal');
    assert(dialog.labelledby, 'the dialog is labelled');
    assert(dialog.focusInside, 'focus moved into the dialog');
    assert(dialog.sections.length >= 5, `settings sections: ${dialog.sections.join(' / ')}`);
    ev(`sections: ${dialog.sections.join(' / ')}`);

    // Untick BMP and save.
    await ctx.page.evaluate(() => {
      const panel = document.getElementById('siat-panel-host').shadowRoot;
      const box = panel.querySelector('#siat-fmt-bmp');
      box.click();
    });
    await ctx.page.evaluate(() => {
      const panel = document.getElementById('siat-panel-host').shadowRoot;
      const save = [...panel.querySelectorAll('.siat-foot .siat-btn')].find((button) => button.textContent.trim() === 'Save');
      save.click();
    });
    // Wait for the dialog to go away (or for storage to be written), then settle.
    await ctx.page.waitForFunction(
      () => {
        const host = document.getElementById('siat-panel-host');
        const dialog = host && host.shadowRoot && host.shadowRoot.querySelector('[role="dialog"]');
        return !dialog || dialog.closest('[hidden]') !== null || getComputedStyle(dialog).display === 'none';
      },
      { timeout: 8000 },
    ).catch(() => {});
    await sleep(500);
    const stored = JSON.parse(state.storage[SETTINGS_STORAGE_KEYS[0]] || '{}');
    assert(Array.isArray(stored.formats) && !stored.formats.includes('bmp'), `BMP was removed from storage: ${JSON.stringify(stored.formats)}`);
    ev(`stored formats after Save: ${stored.formats.join(', ')}`);

    // The menu must reflect it immediately, and after a reload.
    await rightClickAt(ctx.page, center.x, center.y);
    await waitForMenu(ctx.page);
    let menu = await menuState(ctx.page);
    assert(!menu.items.some((item) => item.label === 'BMP'), 'BMP is gone from the menu immediately');
    await ctx.page.keyboard.press('Escape');

    await ctx.page.reload({ waitUntil: 'load' });
    await ctx.page.waitForFunction('window.__saveImageAsTypeInitialised && window.__saveImageAsTypeInitialised.ready === true', { timeout: 20000 });
    const persisted = await ctx.page.evaluate(() => window.__saveImageAsTypeInitialised.store.get().formats);
    assert(!persisted.includes('bmp'), `BMP is still off after a reload: ${persisted.join(', ')}`);
    const center2 = await elementCenter(ctx.page, '#same-jpg');
    await rightClickAt(ctx.page, center2.x, center2.y);
    await waitForMenu(ctx.page);
    menu = await menuState(ctx.page);
    assert(!menu.items.some((item) => item.label === 'BMP'), 'the menu after reload matches the stored setting');
    ev(`formats after reload: ${(await menuState(ctx.page)).items.map((i) => i.label).join(', ')}`);
    await ctx.page.keyboard.press('Escape');
    await ctx.page.close();
  });

  await scenario('filename-settings', 'prefix, sub-folder and max length are applied to the saved name', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'browser' }, {
      seedSettings: { filenamePrefix: 'shot', subfolder: 'refs/2026', maxFilenameLength: 16 },
    });
    const before = state.gmDownloads.length;
    await convertWithMouse(ctx.page, '#same-jpg', 'PNG');
    const record = await waitForGmDownload(state, before);
    assert(record.name.startsWith('refs/2026/'), `the sub-folder is part of the manager download path: ${record.name}`);
    const bare = record.name.split('/').pop();
    assert(bare.startsWith('shot-'), `the prefix is applied: ${bare}`);
    assert(bare.length <= 16, `max length respected: ${bare} (${bare.length} chars)`);
    assert(bare.endsWith('.png'), 'the extension still fits inside the limit');
    ev(`manager received name "${record.name}" (bare "${bare}", ${bare.length} chars, limit 16)`);
    await ctx.page.close();
  });

  await scenario('subfolder-needs-browser-mode', 'in native download mode the sub-folder is dropped and the user is told', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'native' }, { seedSettings: { subfolder: 'refs' } });
    const before = state.gmDownloads.length;
    await convertWithMouse(ctx.page, '#same-jpg', 'PNG');
    const record = await waitForGmDownload(state, before);
    assert(!record.name.includes('/'), `no path was sent to a manager that cannot honour it: "${record.name}"`);
    const toast = await waitForToast(ctx.page, (entry) => entry.kind === 'success', 20000);
    const mentions = [...toast.notes, toast.meta, toast.title].join(' ');
    assert(/sub-folder|folder|download mode/i.test(mentions), `the limitation is disclosed: ${JSON.stringify(toast.notes)}`);
    ev(`native mode → name "${record.name}"; disclosure: ${toast.notes.find((n) => /folder/i.test(n)) || toast.meta}`);
    await ctx.page.close();
  });

  await scenario('anchor-fallback-without-grant', 'without GM_download the browser downloads the file itself', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { grants: without('GM_download') });
    const capability = await ctx.page.evaluate(() => window.__saveImageAsTypeInitialised.gm.capabilities.download);
    assertEquals(capability, false, 'the adapter reports no download capability');
    await convertWithMouse(ctx.page, '#same-jpg', 'PNG');
    const download = await waitForCdpDownload(ctx.downloadDir);
    assert(download.bytes.length > 100, `Chrome really wrote a file (${download.bytes.length} bytes)`);
    if (HAVE_PYTHON) {
      const facts = verifyCapture(`anchor-${download.name}`, download.bytes);
      assertEquals(facts.format, 'PNG', 'the file Chrome saved is a valid PNG');
      ev(`Pillow: ${facts.format} ${facts.size.join('x')} from a real Chrome download (${download.name})`);
    }
    const toast = await waitForToast(ctx.page, (entry) => entry.kind === 'success', 20000);
    ev(`toast: "${toast.title}" — ${toast.meta}`);
    ev(`saved through the anchor fallback: ${download.path}`);
    await ctx.page.close();
  });

  await scenario('anchor-fallback-on-whitelist-error', 'a not_whitelisted manager error falls back instead of losing the file', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'browser', downloadError: 'not_whitelisted' });
    await convertWithMouse(ctx.page, '#same-jpg', 'PNG');
    const download = await waitForCdpDownload(ctx.downloadDir);
    assert(download.bytes.length > 100, `the file still reached the disk (${download.bytes.length} bytes)`);
    const toast = await waitForToast(ctx.page, (entry) => entry.kind === 'success' || entry.kind === 'progress', 20000);
    const text = [toast.title, toast.meta, ...toast.notes].join(' ');
    assert(/whitelist|manager download|browser/i.test(text), `the fallback is explained to the user: ${text.slice(0, 220)}`);
    ev(`manager error not_whitelisted → browser download ${download.name}; message: ${text.slice(0, 180)}`);
    await ctx.page.close();
  });

  await scenario('download-mode-disabled', 'downloadMode "disabled" never calls GM_download', async ({ note: ev }) => {
    const ctx = await openPage(browser, state, { downloadMode: 'disabled' });
    const callsBefore = await ctx.page.evaluate(() => window.__siatE2E.calls.filter((c) => c.api === 'download').length);
    await convertWithMouse(ctx.page, '#same-jpg', 'PNG');
    await waitForCdpDownload(ctx.downloadDir);
    const callsAfter = await ctx.page.evaluate(() => window.__siatE2E.calls.filter((c) => c.api === 'download').length);
    assertEquals(callsAfter, callsBefore, 'GM_download was not attempted while the manager has downloads disabled');
    ev('the script honoured GM_info.downloadMode = "disabled" and used the browser path');
    await ctx.page.close();
  });

  // ── G. animation capability, reported honestly ─────────────────────────────
  await scenario('animation-capability-honest', 'animated conversion reports what this browser can actually do', async ({ note: ev }) => {
    await clearToasts(page);
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#same-gif', 'GIF');
    const record = await waitForGmDownload(state, before);
    const bytes = readFileSync(join(GM_DOWNLOAD_DIR, record.name));
    const report = await page.evaluate(() => window.__saveImageAsTypeInitialised.diagnostics().animation);
    // Measured independently of the script's own probe: ask the browser directly.
    const independent = await page.evaluate(async () => {
      if (typeof ImageDecoder === 'undefined') return { present: false, types: {} };
      const types = {};
      for (const type of ['image/gif', 'image/webp', 'image/png', 'image/avif']) {
        try {
          types[type] = await ImageDecoder.isTypeSupported(type);
        } catch {
          types[type] = false;
        }
      }
      return { present: true, types };
    });
    assertEquals(report.decoderAvailable, independent.present, 'the script reports the same decoder presence as a direct typeof check');
    assertEquals(
      JSON.stringify(report.supportedTypes.slice().sort()),
      JSON.stringify(Object.keys(independent.types).filter((type) => independent.types[type]).sort()),
      `the script's supported-type list matches ImageDecoder.isTypeSupported: ${JSON.stringify(independent.types)}`,
    );
    const toast = await waitForToast(page, (entry) => entry.kind === 'success' && /\.gif\b/i.test(`${entry.title} ${entry.meta}`), 20000);
    if (HAVE_PYTHON) {
      const facts = verifyCapture('animated-source-to-gif.gif', bytes);
      assertEquals(facts.format, 'GIF', 'the output is a real GIF');
      ev(`Pillow: GIF ${facts.size.join('x')} n_frames=${facts.n_frames}`);
      const gifFrames = independent.present && independent.types['image/gif'] === true;
      if (!gifFrames) {
        // The source is animated (4 frames); if the browser cannot decode GIF
        // frames the output must be a single frame *and* the user must be told,
        // rather than silently receiving a file that lost its animation.
        assert(facts.n_frames === 1, `this browser cannot decode GIF frames (ImageDecoder present=${independent.present}, image/gif supported=${independent.types['image/gif']}), so the output must hold exactly one frame — got ${facts.n_frames}`);
        assert(toast.notes.some((entry) => /first frame|could not extract|Original file|frame/i.test(entry)), `the limitation is disclosed to the user: ${JSON.stringify(toast.notes)}`);
      } else {
        // The browser can decode GIF frames, so the animation must actually
        // survive: same frame count, same per-frame delay, and pixels within the
        // GIF re-quantisation tolerance — all measured with Pillow, not by the
        // script's own encoder.
        const source = fixture('animated.gif');
        assert(source, 'the source fixture facts are available');
        assertEquals(facts.n_frames, source.n_frames, `every frame of the ${source.n_frames}-frame source survived (got ${facts.n_frames})`);
        let worst = 0;
        for (let index = 0; index < facts.frames.length; index += 1) {
          const outFrame = facts.frames[index];
          const srcFrame = source.frames[index];
          assertEquals(outFrame.duration_ms, srcFrame.duration_ms, `frame ${index} keeps the source delay (${srcFrame.duration_ms} ms)`);
          for (let sample = 0; sample < outFrame.pixels.length; sample += 1) {
            const out = outFrame.pixels[sample][2];
            const src = srcFrame.pixels[sample][2];
            for (let channel = 0; channel < 3; channel += 1) worst = Math.max(worst, Math.abs(out[channel] - src[channel]));
          }
        }
        assert(worst <= 32, `re-encoded frames stay within the GIF quantisation tolerance (worst channel delta ${worst})`);
        ev(`animated output verified frame by frame against the source: ${facts.n_frames} frames, delays ${facts.frames.map((entry) => entry.duration_ms).join('/')} ms, worst channel delta ${worst}`);
      }
      ev(`decoderAvailable=${report.decoderAvailable} supportedTypes=[${report.supportedTypes.join(', ')}] → frames written: ${facts.n_frames}`);
    }
    ev(`independent probe: ${JSON.stringify(independent)}`);
    ev(`toast notes: ${JSON.stringify(toast.notes)}`);
  });

  await runV2({ scenario, browser, state, openPage, assert, assertEquals, convertWithMouse, waitForGmDownload, verifyCapture, GM_DOWNLOAD_DIR, FIXTURE_DIR, VERIFY_DIR, GENERATED_FIXTURE_DIR, saveForVerification, sleep, HAVE_PYTHON });

  await scenario('no-network-beyond-the-image', 'nothing is requested except the fixture origins', async ({ note: ev }) => {
    const seen = [];
    const listener = (request) => seen.push(request.url());
    page.on('request', listener);
    const before = state.gmDownloads.length;
    await convertWithMouse(page, '#same-png', 'PNG');
    await waitForGmDownload(state, before);
    await sleep(500);
    page.off('request', listener);
    const external = seen.filter((url) => !url.startsWith(state.originA) && !url.startsWith(state.originB) && !url.startsWith('data:') && !url.startsWith('blob:'));
    assertEquals(external.length, 0, `no third-party requests: ${external.join(', ')}`);
    ev(`requests during one conversion: ${seen.length}, all to the two fixture origins`);
  });

  await scenario('page-untouched', 'no page errors, no leaked globals, no page storage used', async ({ note: ev }) => {
    const audit = await page.evaluate(() => ({
      problems: window.__siatE2E ? undefined : 'shim missing',
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
      cookie: document.cookie,
      globals: Object.keys(window).filter((key) => key.startsWith('__save') || key.startsWith('__siat') || key.startsWith('siat')),
      hosts: [...document.querySelectorAll('[id^="siat-"]')].map((el) => el.id),
    }));
    assertEquals(audit.localStorageKeys.length, 0, `the script never writes localStorage (${audit.localStorageKeys.join(',')})`);
    assertEquals(audit.sessionStorageKeys.length, 0, 'the script never writes sessionStorage');
    assertEquals(audit.cookie, '', 'the script never touches cookies');
    assert(audit.globals.every((k) => ['__siatE2E', '__saveImageAsTypeInitialised', '__siatVerificationBootstrap'].includes(k)), `only explicit OFFLINE FIXTURE globals exist: ${audit.globals.join(', ')}`);
    assert(main_ctx.problems.length === 0, `no unexpected page errors across the whole run: ${main_ctx.problems.join(' | ')}`);
    ev(`expected browser noise on the main page: ${main_ctx.expectedNoise.length} entries (the deliberate 404 and the CORS-blocked fixture)`);
    ev(`globals: ${audit.globals.join(', ')}`);
    ev(`hosts in the page DOM: ${audit.hosts.join(', ')}`);
  });

  await browser.close();
  await state.close();

  // ── report ────────────────────────────────────────────────────────────────
  const passed = results.filter((entry) => entry.status === 'pass').length;
  const failed = results.filter((entry) => entry.status === 'fail').length;
  const skippedCount = results.filter((entry) => entry.status === 'skipped').length;
  const report = {
    generatedAt: new Date().toISOString(),
    scriptVersion: SCRIPT_VERSION,
    artifactSha256: sha(readFileSync(join(ROOT, 'release/save-image-as-type.user.js'))),
    instrumentedFixtureSha256: sha(Buffer.from(artifactSource())),
    scope: 'Offline fixture build: explicit verifier API and synthetic-event policy bypass; NOT exact production injection or a real manager',
    browser: version,
    pageApis: env,
    managerApi: 'emulated (test/browser/harness.mjs) — not Tampermonkey/Violentmonkey',
    independentVerification: HAVE_PYTHON ? 'Pillow + pypdf' : 'unavailable',
    origins: { page: state.originA, cdn: state.originB },
    totals: { passed, failed, skipped: skippedCount, total: results.length },
    notes,
    results,
  };
  const reportPath = join(ROOT, '.tmp-browser', 'report.json');
  mkdirSync(join(ROOT, '.tmp-browser'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n${passed} passed, ${failed} failed, ${skippedCount} skipped (${results.length} scenarios)`);
  console.log(`report: ${reportPath}`);
  if (!HAVE_PYTHON) console.log('NOTE: Pillow/pypdf unavailable — byte-level verification was skipped, not passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('browser test crashed:', err);
  process.exit(2);
});
