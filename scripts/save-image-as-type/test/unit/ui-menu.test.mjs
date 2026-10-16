import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createContextMenu } from '../../src/ui/menu.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

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
 * The context menu is the whole user interface of this script, so it is tested
 * against a real DOM (jsdom) rather than by reading the code: opening rules, the
 * Shift escape hatch, keyboard operation, dismissal, long-press timing and —
 * importantly — listener hygiene across many interactions.
 *
 * Every test gets a fresh document (`beforeEach`) because a leaked menu instance
 * would intercept the next test's events and produce misleading results.
 */

let dom = null;
let doc = null;
let tracked = null;
let baseline = null;
let addCounts = null;

const FORMATS = [{ id: 'png' }, { id: 'jpg' }, { id: 'webp' }, { id: 'original' }];
const LABELS = ['PNG', 'JPG', 'WebP', 'Original', 'Settings'];

function installDom({ width = 1024, height = 768 } = {}) {
  dom = new JSDOM(
    `<!doctype html><html><body>
      <button id="focusable">page button</button>
      <img id="photo" src="https://cdn.example/a/b/photo.jpg" alt="A photo" width="200" height="100">
      <div id="plain">just text</div>
      <div id="bg" role="img" aria-label="CSS background target" style="background-image:url('https://cdn.example/bg.png')"></div>
      <svg id="inline" xmlns="http://www.w3.org/2000/svg" width="90" height="60" viewBox="0 0 90 60" role="img" aria-label="Inline SVG target"><rect width="90" height="60" fill="#2563eb"/></svg>
     </body></html>`,
    { url: 'https://page.example/gallery', pretendToBeVisual: true },
  );
  doc = dom.window.document;
  Object.defineProperty(dom.window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: height, configurable: true });
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;

  // Track live document listeners so accumulation can be detected. jsdom does
  // not expose listener counts, so the two methods are wrapped. nwsapi (jsdom's
  // selector engine) lazily installs its own mouseover/mouseout pair on the
  // first querySelector, which is forced here so it is part of the baseline
  // rather than being mistaken for a leak from the script.
  tracked = new Map();
  addCounts = new Map();
  const originalAdd = doc.addEventListener.bind(doc);
  const originalRemove = doc.removeEventListener.bind(doc);
  doc.addEventListener = (type, handler, options) => {
    tracked.set(handler, type);
    addCounts.set(type, (addCounts.get(type) || 0) + 1);
    return originalAdd(type, handler, options);
  };
  doc.removeEventListener = (type, handler, options) => {
    tracked.delete(handler);
    return originalRemove(type, handler, options);
  };
  doc.querySelector('html');
  baseline = new Set(tracked.keys());
}

function teardownDom() {
  if (dom) dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'getComputedStyle', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    delete globalThis[key];
  }
}

function makeMenu({ settings = {}, formats = FORMATS, busy = false } = {}) {
  const calls = { picks: [], settingsOpened: 0, cancels: 0, settingsReads: 0 };
  const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
  const api = createContextMenu({
    document: doc,
    getSettings: () => {
      calls.settingsReads += 1;
      return merged;
    },
    getMenuFormats: () => formats,
    onPick: (id, target) => calls.picks.push({ id, target }),
    onOpenSettings: () => {
      calls.settingsOpened += 1;
    },
    onCancel: () => {
      calls.cancels += 1;
    },
    isBusy: () => busy,
  });
  api.attach();
  return { api, calls, settings: merged };
}

function rightClick(element, { x = 100, y = 100, shiftKey = false } = {}) {
  const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, shiftKey });
  element.dispatchEvent(event);
  return event;
}

function pointerEvent(type, { x = 50, y = 50, pointerType = 'touch', target = doc } = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
  return event;
}

function key(name, { shiftKey = false } = {}) {
  const event = new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, shiftKey });
  doc.dispatchEvent(event);
  return event;
}

function click(element) {
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
}

const menuElement = (api) => api.shadowRoot.querySelector('.siat-menu');
const menuItems = (api) => [...api.shadowRoot.querySelectorAll('[role="menuitem"]')];
const itemLabels = (api) => menuItems(api).map((el) => el.querySelector('.siat-ext').textContent);
/** Focus inside a shadow root is reported on the root, not on the document. */
const focused = (api) => api.shadowRoot.activeElement;
const scriptListeners = () => [...tracked.keys()].filter((handler) => !baseline.has(handler));
const addTotal = () => [...addCounts.values()].reduce((sum, n) => sum + n, 0);

describe('context menu — opening rules', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('a right-click on an image opens a shadow-DOM menu and suppresses the native one', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    const img = doc.getElementById('photo');
    const event = rightClick(img);
    assert.equal(event.defaultPrevented, true, 'the native menu is replaced only when an image was hit');
    assert.equal(api.isOpen, true);
    const menu = menuElement(api);
    assert.equal(menu.hidden, false);
    assert.equal(menu.getAttribute('role'), 'menu');
    assert.equal(menu.getAttribute('aria-label'), 'Save image as');
    assert.equal(menu.getAttribute('aria-orientation'), 'vertical');
    assert.deepEqual(itemLabels(api), LABELS);
    assert.match(menu.querySelector('.siat-head-title').textContent, /Save image as/i);
    assert.match(menu.querySelector('.siat-head-sub').textContent, /cdn\.example\/photo\.jpg/, 'the source is identified for the user');
    assert.match(menu.querySelector('.siat-head-sub').textContent, /A photo/, 'the alt text is shown');
    // The menu lives in a shadow root, so page CSS cannot reach it.
    assert.equal(api.shadowRoot.host.id, 'siat-menu-host');
    assert.equal(api.shadowRoot.host.getAttribute('data-siat'), 'menu');
    assert.equal(doc.querySelectorAll('#siat-menu-host').length, 1);
    assert.equal(api.shadowRoot.querySelector('style').textContent.length > 500, true, 'styles are encapsulated in the shadow root');
  });

  test('a right-click that is not on an image leaves the native menu alone', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    const event = rightClick(doc.getElementById('plain'));
    assert.equal(event.defaultPrevented, false, 'no preventDefault → the browser menu still appears');
    assert.equal(api.isOpen, false);
  });

  test('Shift + right-click always yields the native menu (documented escape hatch)', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    const event = rightClick(doc.getElementById('photo'), { shiftKey: true });
    assert.equal(event.defaultPrevented, false);
    assert.equal(api.isOpen, false);
    // A bypass must not create any DOM: the host is built lazily on first open.
    assert.equal(doc.querySelectorAll('#siat-menu-host').length, 0);
  });

  test('requireShift inverts the rule: plain right-click is native, Shift opens ours', (t) => {
    const { api } = makeMenu({ settings: { requireShift: true } });
    t.after(() => api.destroy());
    const plain = rightClick(doc.getElementById('photo'));
    assert.equal(plain.defaultPrevented, false);
    assert.equal(api.isOpen, false);
    const shifted = rightClick(doc.getElementById('photo'), { shiftKey: true });
    assert.equal(shifted.defaultPrevented, true);
    assert.equal(api.isOpen, true);
    assert.match(menuElement(api).querySelector('.siat-foot').textContent, /Release Shift/, 'the footer explains the inverted mode');
  });

  test('interceptContextMenu:false disables the menu entirely', (t) => {
    const { api } = makeMenu({ settings: { interceptContextMenu: false } });
    t.after(() => api.destroy());
    const event = rightClick(doc.getElementById('photo'));
    assert.equal(event.defaultPrevented, false);
    assert.equal(api.isOpen, false);
    assert.equal(doc.querySelectorAll('#siat-menu-host').length, 0);
  });

  test('target kinds: CSS background (only when enabled) and inline SVG', (t) => {
    const off = makeMenu({ settings: { enableBackgroundImages: false } });
    const eventOff = rightClick(doc.getElementById('bg'));
    assert.equal(eventOff.defaultPrevented, false, 'background targets are ignored when the setting is off');
    assert.equal(off.api.isOpen, false);
    off.api.destroy();

    const on = makeMenu({ settings: { enableBackgroundImages: true } });
    t.after(() => on.api.destroy());
    const eventOn = rightClick(doc.getElementById('bg'));
    assert.equal(eventOn.defaultPrevented, true);
    assert.equal(on.api.isOpen, true);
    assert.match(menuElement(on.api).querySelector('.siat-head-title').textContent, /css background/i, 'the header names the target kind');
    on.api.close();

    const svg = rightClick(doc.getElementById('inline'));
    assert.equal(svg.defaultPrevented, true, 'an inline SVG is a saveable target');
    assert.match(menuElement(on.api).querySelector('.siat-head-title').textContent, /inline svg/i);
  });

  test('two instances never produce two host elements', (t) => {
    const first = makeMenu();
    rightClick(doc.getElementById('photo'));
    assert.equal(doc.querySelectorAll('#siat-menu-host').length, 1);
    first.api.detach(); // leaves the host in the DOM, as a paused script would
    const second = makeMenu();
    t.after(() => second.api.destroy());
    rightClick(doc.getElementById('photo'));
    assert.equal(doc.querySelectorAll('#siat-menu-host').length, 1, 'the existing host is adopted, not duplicated');
    assert.equal(second.api.isOpen, true);
    assert.deepEqual(itemLabels(second.api), LABELS, 'the adopted host is rebuilt with fresh contents');
    assert.equal(second.api.shadowRoot.querySelectorAll('style').length, 1, 'exactly one stylesheet after adoption');
    second.api.destroy();
    assert.equal(doc.querySelectorAll('#siat-menu-host').length, 0, 'destroy() removes the host');
  });
});

describe('context menu — keyboard operation', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('focus starts on the first item and arrow keys wrap around', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    const items = menuItems(api);
    assert.equal(focused(api), items[0], 'the first item receives focus, so the menu is operable without a mouse');
    assert.equal(doc.activeElement, api.shadowRoot.host, 'from the page the focus sits on the shadow host');
    key('ArrowDown');
    assert.equal(focused(api), items[1]);
    key('ArrowUp');
    key('ArrowUp');
    assert.equal(focused(api), items[items.length - 1], 'ArrowUp wraps to the last item');
    key('ArrowDown');
    assert.equal(focused(api), items[0], 'ArrowDown wraps to the first');
    key('End');
    assert.equal(focused(api), items[items.length - 1]);
    key('Home');
    assert.equal(focused(api), items[0]);
    assert.equal(items[1].classList.contains('siat-active'), false, 'only one item is marked active');
  });

  test('Tab is trapped inside the open menu', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    const items = menuItems(api);
    const event = key('Tab');
    assert.equal(event.defaultPrevented, true, 'Tab does not move focus to the page behind the menu');
    assert.equal(focused(api), items[1]);
    const back = key('Tab', { shiftKey: true });
    assert.equal(back.defaultPrevented, true);
    assert.equal(focused(api), items[0]);
  });

  test('Enter activates the focused item, closes the menu and restores page focus', (t) => {
    const { api, calls } = makeMenu();
    t.after(() => api.destroy());
    const pageButton = doc.getElementById('focusable');
    pageButton.focus();
    const img = doc.getElementById('photo');
    rightClick(img);
    key('ArrowDown'); // PNG -> JPG
    const enter = key('Enter');
    assert.equal(enter.defaultPrevented, true);
    assert.equal(api.isOpen, false);
    assert.deepEqual(
      calls.picks.map((pick) => pick.id),
      ['jpg'],
    );
    assert.equal(calls.picks[0].target.element, img, 'the picked target is the image that was right-clicked');
    assert.equal(doc.activeElement, pageButton, 'focus returns to where the user was');
    assert.equal(menuElement(api).hidden, true);
  });

  test('Space activates too, and Escape closes without activating anything', (t) => {
    const { api, calls } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    const space = key(' ');
    assert.equal(space.defaultPrevented, true, 'Space does not scroll the page behind the menu');
    assert.deepEqual(calls.picks.map((pick) => pick.id), ['png']);
    assert.equal(api.isOpen, false);

    rightClick(doc.getElementById('photo'));
    const escape = key('Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(api.isOpen, false);
    assert.equal(calls.picks.length, 1, 'Escape added no conversion');
  });

  test('the Settings item opens the panel instead of converting', (t) => {
    const { api, calls } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    const settings = menuItems(api).find((el) => el.textContent.includes('Settings'));
    click(settings);
    assert.equal(calls.settingsOpened, 1);
    assert.equal(calls.picks.length, 0);
    assert.equal(api.isOpen, false);
  });

  test('keys are ignored while the menu is closed', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    for (const name of ['ArrowDown', 'Enter', 'Home', 'End', 'Tab']) {
      const event = key(name);
      assert.equal(event.defaultPrevented, false, `${name} keeps its normal page behaviour while closed`);
    }
    assert.equal(api.isOpen, false);
  });
});

describe('context menu — dismissal', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('a click outside, a scroll, a resize, a blur and a pagehide all close it', async (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());

    rightClick(doc.getElementById('photo'));
    click(doc.getElementById('plain'));
    assert.equal(api.isOpen, false, 'outside click closes');

    rightClick(doc.getElementById('photo'));
    // Scrolling dismisses the menu (a position:fixed menu would drift from its
    // target) — but only once the page has settled; see the grace-window tests.
    await new Promise((resolve) => setTimeout(resolve, 160));
    doc.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
    assert.equal(api.isOpen, false, 'scroll closes (a position:fixed menu would drift from its target)');

    rightClick(doc.getElementById('photo'));
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(api.isOpen, false, 'resize closes');

    rightClick(doc.getElementById('photo'));
    dom.window.dispatchEvent(new dom.window.Event('blur'));
    assert.equal(api.isOpen, false, 'losing the window closes');

    rightClick(doc.getElementById('photo'));
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(api.isOpen, false, 'page teardown closes');
  });

  test('clicking the menu’s own chrome does not dismiss it', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    click(menuElement(api).querySelector('.siat-head'));
    assert.equal(api.isOpen, true);
  });

  test('detach() removes every listener the script added', (t) => {
    const { api } = makeMenu();
    rightClick(doc.getElementById('photo'));
    assert.ok(scriptListeners().length >= 6, `attach() registered the expected listeners (${scriptListeners().length})`);
    api.detach();
    assert.equal(api.isOpen, false);
    assert.deepEqual(scriptListeners(), [], `all script listeners removed (left: ${scriptListeners().join(', ')})`);
    const event = rightClick(doc.getElementById('photo'));
    assert.equal(event.defaultPrevented, false, 'the native menu works again after detach');
    api.destroy();
  });
});

describe('context menu — busy state', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('formats are disabled, explained and unclickable while a conversion runs', (t) => {
    const { api, calls } = makeMenu({ busy: true });
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    const busyLine = menuElement(api).querySelector('.siat-busy');
    assert.match(busyLine.textContent, /Still converting/);
    assert.equal(busyLine.getAttribute('role'), 'status', 'announced politely, not as an alert');
    const items = menuItems(api);
    for (const item of items.slice(0, FORMATS.length)) assert.equal(item.getAttribute('aria-disabled'), 'true');
    click(items[0]);
    assert.equal(calls.picks.length, 0, 'a disabled item cannot start a second job');
    const cancel = menuElement(api).querySelector('.siat-cancel');
    assert.ok(cancel, 'a cancel control is offered');
    click(cancel);
    assert.equal(calls.cancels, 1);
    assert.equal(api.isOpen, false);
  });

  test('an empty format list says so instead of showing a blank menu', (t) => {
    const { api } = makeMenu({ formats: [] });
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    assert.match(menuElement(api).textContent, /No formats are enabled/);
    assert.deepEqual(itemLabels(api), ['Settings'], 'the way out is still reachable');
  });

  test('an unavailable format is listed but disabled with its reason', (t) => {
    const { api, calls } = makeMenu({ formats: [{ id: 'png' }, { id: 'avif', disabled: 'not supported by this browser' }] });
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    const items = menuItems(api);
    assert.equal(items[1].getAttribute('aria-disabled'), 'true');
    assert.match(items[1].querySelector('.siat-hint').textContent, /not supported by this browser/);
    click(items[1]);
    assert.equal(calls.picks.length, 0);
    click(items[0]);
    assert.deepEqual(calls.picks.map((pick) => pick.id), ['png'], 'the available format still works');
  });
});

describe('context menu — positioning', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom({ width: 800, height: 600 }));
  afterEach(() => teardownDom());

  test('the menu is clamped inside the viewport instead of opening off-screen', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'), { x: 5000, y: 5000 });
    const menu = menuElement(api);
    // jsdom has no layout engine, so the measured size is stubbed to a realistic
    // one; the clamping arithmetic under test is the script's own.
    menu.getBoundingClientRect = () => ({ width: 260, height: 320, top: 0, left: 0, right: 260, bottom: 320, x: 0, y: 0 });
    rightClick(doc.getElementById('photo'), { x: 790, y: 590 });
    const left = Number.parseInt(menu.style.left, 10);
    const top = Number.parseInt(menu.style.top, 10);
    assert.ok(left >= 8 && left + 260 <= 800, `left ${left}px keeps a 260px menu inside an 800px viewport`);
    assert.ok(top >= 8 && top + 320 <= 600, `top ${top}px keeps a 320px menu inside a 600px viewport`);
    rightClick(doc.getElementById('photo'), { x: 20, y: 20 });
    assert.equal(menu.style.left, '20px', 'a comfortable position is used as-is');
    assert.equal(menu.style.top, '20px');
  });

  test('openForLastHovered() places the menu over the element for manager menu commands', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    const img = doc.getElementById('photo');
    img.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    img.getBoundingClientRect = () => ({ width: 200, height: 100, top: 40, left: 30, right: 230, bottom: 140, x: 30, y: 40 });
    assert.equal(api.openForLastHovered(), true);
    assert.equal(api.isOpen, true);
    const menu = menuElement(api);
    assert.ok(Number.parseInt(menu.style.left, 10) >= 8, 'clamped into view');
    api.close();
    img.remove();
    assert.equal(api.openForLastHovered(), false, 'a detached element cannot open a menu for a stale node');
  });
});

describe('context menu — long press (touch)', { skip: SKIP_DOM }, () => {
  beforeEach(() => {
    installDom();
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
    teardownDom();
  });

  test('holding still for the long-press duration opens the menu', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo') });
    assert.equal(api.isOpen, false, 'not before the delay');
    mock.timers.tick(549);
    assert.equal(api.isOpen, false, 'still not at 549ms');
    mock.timers.tick(2);
    assert.equal(api.isOpen, true, 'opens at 551ms');
  });

  test('a small finger jitter does not cancel the long press', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo'), x: 50, y: 50 });
    pointerEvent('pointermove', { x: 56, y: 58 }); // 6px / 8px — inside the 12px tolerance
    mock.timers.tick(600);
    assert.equal(api.isOpen, true, 'a real finger is never perfectly still; jitter must not defeat the gesture');
  });

  test('dragging beyond the tolerance cancels it (that is a scroll, not a press)', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo'), x: 50, y: 50 });
    pointerEvent('pointermove', { x: 50, y: 90 }); // 40px vertically
    mock.timers.tick(600);
    assert.equal(api.isOpen, false);
  });

  test('lifting the finger before the delay cancels it', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo') });
    mock.timers.tick(200);
    pointerEvent('pointerup');
    mock.timers.tick(600);
    assert.equal(api.isOpen, false, 'a tap is not a long press');
  });

  test('a mouse pointerdown never starts a long press', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo'), pointerType: 'mouse' });
    mock.timers.tick(1200);
    assert.equal(api.isOpen, false);
  });

  test('enableLongPress:false disables the gesture', (t) => {
    const { api } = makeMenu({ settings: { enableLongPress: false } });
    t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo') });
    mock.timers.tick(1200);
    assert.equal(api.isOpen, false);
  });

  test('detaching during a pending long press cancels timer and local subscriptions', (t) => {
    const { api } = makeMenu(); t.after(() => api.destroy());
    pointerEvent('pointerdown', { target: doc.getElementById('photo') });
    api.detach(); mock.timers.tick(2000);
    assert.equal(api.isOpen, false);
    assert.deepEqual(scriptListeners(), []);
  });

  test('completed long press releases local handlers even without pointerup', (t) => {
    const { api } = makeMenu(); t.after(() => api.destroy());
    const count = scriptListeners().length;
    pointerEvent('pointerdown', { target: doc.getElementById('photo') });
    mock.timers.tick(600);
    assert.equal(api.isOpen, true);
    assert.equal(scriptListeners().length, count);
  });

  test('replacement touch sessions retain only one set of transient listeners', (t) => {
    const { api } = makeMenu(); t.after(() => api.destroy());
    const count = scriptListeners().length;
    for (let n = 0; n < 20; n += 1) pointerEvent('pointerdown', { target: doc.getElementById('photo') });
    assert.equal(scriptListeners().length, count + 2, 'two callback identities cover three event types');
    dom.window.dispatchEvent(new dom.window.Event('blur'));
    mock.timers.tick(2000);
    assert.equal(api.isOpen, false);
    assert.equal(scriptListeners().length, count);
  });

  test('repeated touches do not accumulate document listeners (leak regression)', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    api.close();
    const afterAttach = scriptListeners().length;
    assert.ok(afterAttach >= 6, `attach() registered the expected listeners (${afterAttach})`);
    for (let i = 0; i < 25; i += 1) {
      pointerEvent('pointerdown', { target: doc.getElementById('photo'), x: 50, y: 50 });
      pointerEvent('pointermove', { x: 52, y: 53 });
      pointerEvent('pointerup');
      pointerEvent('pointerdown', { target: doc.getElementById('photo'), x: 50, y: 50 });
      pointerEvent('pointermove', { x: 200, y: 200 }); // cancelled by movement
      pointerEvent('pointerdown', { target: doc.getElementById('photo'), x: 50, y: 50 });
      mock.timers.tick(600); // fires and opens
      api.close();
      pointerEvent('pointerup');
    }
    mock.timers.tick(5000);
    assert.equal(scriptListeners().length, afterAttach, `listener count returned to the post-attach baseline after 75 touch-downs (now ${scriptListeners().length}, expected ${afterAttach})`);
    api.detach();
    assert.deepEqual(scriptListeners(), [], 'detach() still removes everything');
  });
});

describe('context menu — dismissal timing and listener hygiene', { skip: SKIP_DOM }, () => {
  beforeEach(() => {
    installDom();
    // `now` must be a realistic timestamp: menu.js compares Date.now() against
    // the long-press double-open guard, and a mocked epoch of 0 would trip it.
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
    teardownDom();
  });

  const scrollEvent = () => doc.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
  const windowEvent = (type) => dom.window.dispatchEvent(new dom.window.Event(type));

  test('a scroll landing right after the menu opens does not dismiss it (grace window)', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    rightClick(doc.getElementById('photo'));
    assert.equal(api.isOpen, true);
    // Pages fire scroll asynchronously after scrollIntoView / smooth scrolling;
    // without a grace period the menu flashed open and shut (found in E2E).
    scrollEvent();
    mock.timers.tick(50);
    scrollEvent();
    assert.equal(api.isOpen, true, 'scrolls inside the 150ms grace window are ignored');
    mock.timers.tick(150);
    scrollEvent();
    assert.equal(api.isOpen, false, 'a later scroll still dismisses the menu');
  });

  test('resize, blur and pagehide dismiss immediately — the grace applies to scroll only', (t) => {
    const { api } = makeMenu();
    t.after(() => api.destroy());
    for (const type of ['resize', 'blur', 'pagehide']) {
      rightClick(doc.getElementById('photo'));
      assert.equal(api.isOpen, true, `menu open before ${type}`);
      windowEvent(type);
      assert.equal(api.isOpen, false, `${type} dismisses the menu even inside the grace window`);
    }
  });

  test('attach() is idempotent: re-applying settings does not stack listeners', (t) => {
    const { api, calls } = makeMenu();
    t.after(() => api.destroy());
    const handle = () => {
      const before = calls.settingsReads;
      const event = rightClick(doc.getElementById('photo'));
      const reads = calls.settingsReads - before;
      api.close();
      return { reads, prevented: event.defaultPrevented, open: api.isOpen };
    };
    const once = handle();
    assert.equal(once.prevented, true);
    assert.ok(once.reads >= 1, 'the contextmenu handler ran');
    const listenersAfterFirst = scriptListeners().length;
    const addsAfterFirst = addTotal();
    // main.js calls attach() after every settings save / remote change.
    for (let i = 0; i < 5; i += 1) api.attach();
    assert.equal(addTotal(), addsAfterFirst, 'no additional addEventListener calls');
    assert.equal(scriptListeners().length, listenersAfterFirst);
    assert.deepEqual(handle(), once, 'one right-click is still handled exactly once');
    api.detach();
    const after = rightClick(doc.getElementById('photo'));
    assert.equal(after.defaultPrevented, false, 'detach() removed every listener');
    assert.deepEqual(scriptListeners(), [], 'nothing left behind');
  });
});
