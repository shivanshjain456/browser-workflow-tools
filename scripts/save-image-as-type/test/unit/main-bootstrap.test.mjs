import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGmAdapter } from '../../src/core/gm.js';

/** Private module boot tests. Separately evaluated artifacts are a different,
 * unresolved lifetime: these tests do not certify cross-manager arbitration. */
const { bootstrap, SCRIPT_VERSION_REPORTED } = await import('../../src/main.js');

const FLAG = '__saveImageAsTypeInitialised';

let JSDOM = null;
let SKIP_DOM = false;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (err) {
  SKIP_DOM = `jsdom unavailable (${err.code || err.message}) — run \`npm install\` to enable the DOM tests`;
}

let dom = null;
let doc = null;
let listenerAdds = null;

function installDom() {
  dom = new JSDOM(
    '<!doctype html><html data-siat-no-autoboot><body><img id="photo" src="https://cdn.example/photo.jpg" alt="A photo"></body></html>',
    { url: 'https://page.example/gallery', pretendToBeVisual: true },
  );
  doc = dom.window.document;
  globalThis.window = dom.window;
  globalThis.document = doc;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  // The idle capability probe needs a real canvas/encoder stack; the browser
  // suite covers it. Stubbing the scheduler keeps these tests about booting.
  dom.window.requestIdleCallback = () => 0;

  listenerAdds = new Map();
  const original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, handler, options) => {
    listenerAdds.set(type, (listenerAdds.get(type) || 0) + 1);
    return original(type, handler, options);
  };
}

function teardownDom() {
  if (dom) dom.window.close();
  dom = null;
  doc = null;
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    delete globalThis[key];
  }
}

const adds = (type) => listenerAdds.get(type) || 0;

describe('bootstrap — one instance per document', { skip: SKIP_DOM }, () => {
  beforeEach(() => installDom());
  afterEach(() => teardownDom());

  test('boots, reports ready, and publishes the documented API', async (t) => {
    const instance = await bootstrap({ document: doc });
    t.after(() => instance.destroy());
    assert.equal(instance.ready, true, 'ready is only true once boot finished');
    // In the *source* module this is still the build placeholder; build.mjs
    // stamps the real version and lint checks that none survives. What matters
    // here is that diagnostics reports the module's own constant, not a copy
    // that can drift.
    assert.equal(instance.version, SCRIPT_VERSION_REPORTED, 'the reported version is the module constant');
    for (const key of ['menu', 'panel', 'store', 'toaster', 'gm', 'runConversion', 'cancelJob', 'diagnostics', 'capabilityReport', 'resolveTarget', 'destroy']) {
      assert.ok(instance[key] !== undefined, `instance.${key} is exposed`);
    }
    assert.equal(typeof instance.diagnostics, 'function');
    assert.equal(instance.paused, false, 'paused is a live getter, not a copied snapshot');
    assert.equal(adds('contextmenu'), 1, 'exactly one contextmenu listener');
  });

  test('no privileged handle is published and page-preseeded roots are ignored', async (t) => {
    const fake = { pageControlled: true };
    for (const root of [doc, doc.documentElement, doc.body, dom.window]) root[FLAG] = fake;
    const instance = await bootstrap({ document: doc });
    t.after(() => instance.destroy());
    assert.notEqual(instance, fake);
    assert.equal(instance.ready, true);
    for (const root of [doc, doc.documentElement, doc.body, dom.window]) {
      assert.equal(root[FLAG], fake, 'page state is neither adopted nor written');
    }
    assert.deepEqual(Object.keys(fake), ['pageControlled'], 'no capability copied onto a page object');
  });

  test('a second bootstrap returns the same instance and adds no listeners', async (t) => {
    const first = await bootstrap({ document: doc });
    t.after(() => first.destroy());
    const before = adds('contextmenu');
    const second = await bootstrap({ document: doc });
    const third = await bootstrap({ document: doc });
    assert.equal(second, first, 'same instance');
    assert.equal(third, first, 'same instance again');
    assert.equal(adds('contextmenu'), before, 'no duplicate contextmenu listener — one right-click, one conversion');
  });

  test('REGRESSION: booting at document-start (no <html> yet) is still seen by a later injection', async (t) => {
    const realRoot = doc.documentElement;
    // At document-start Chrome has not created <html> yet; the script must cope
    // and still be recognisable once the document has been parsed.
    Object.defineProperty(doc, 'documentElement', { value: null, configurable: true });
    const early = await bootstrap({ document: doc });
    Object.defineProperty(doc, 'documentElement', { value: realRoot, configurable: true });

    const listenersAfterEarlyBoot = adds('contextmenu');
    const later = await bootstrap({ document: doc });
    assert.equal(later, early, 'the injection after parsing reuses the document-start instance');
    assert.equal(adds('contextmenu'), listenersAfterEarlyBoot, 'no second set of listeners (this used to double every download)');
    assert.equal(doc.documentElement[FLAG], undefined, 'no marker is published after parsing');
    t.after(() => early.destroy());
  });

  test('destroy() clears private ownership so the module can boot again cleanly', async (t) => {
    const first = await bootstrap({ document: doc });
    first.destroy();
    assert.equal(doc[FLAG], undefined, 'marker removed from the Document');
    assert.equal(doc.documentElement[FLAG], undefined, 'marker removed from <html>');
    assert.equal(dom.window[FLAG], undefined, 'marker removed from the window');
    const second = await bootstrap({ document: doc });
    t.after(() => second.destroy());
    assert.notEqual(second, first, 'a fresh instance after an explicit destroy');
    assert.equal(second.ready, true);
    assert.equal(second.paused, false);
  });

  test('failed construction clears private ownership for a fresh retry', async (t) => {
    await assert.rejects(bootstrap({ document: doc, get gm() { throw Error('forced constructor failure'); } }), /forced constructor failure/);
    const instance = await bootstrap({ document: doc });
    t.after(() => instance.destroy());
    assert.equal(instance.ready, true);
  });

  test('twenty construct/destroy cycles do not accumulate owned page listeners', async () => {
    const live = new Map();
    const types = new Set(['contextmenu','keydown','click','pointerdown','mouseover','scroll','resize','blur','pagehide','pointermove','pointerup','pointercancel']);
    for (const [index,target] of [doc,dom.window].entries()) {
      const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, fn, options) => {
        if(types.has(type)) { const key = `${index}/${type}/${Boolean(typeof options === 'boolean' ? options : options?.capture)}`; if(!live.has(key)) live.set(key,new Set()); live.get(key).add(fn); }
        return add(type,fn,options);
      };
      target.removeEventListener = (type, fn, options) => {
        live.get(`${index}/${type}/${Boolean(typeof options === 'boolean' ? options : options?.capture)}`)?.delete(fn);
        return remove(type,fn,options);
      };
    }
    for(let n=0;n<20;n++) {
      const instance=await bootstrap({document:doc}); instance.destroy();
      assert.equal([...live.values()].reduce((sum,set)=>sum+set.size,0),0,`owned listeners after cycle ${n}`);
    }
  });

  test('embedded document keeps interaction without registering another eight manager commands', async (t) => {
    const commands = [];
    const gm = createGmAdapter({ GM_registerMenuCommand: (label) => commands.push(label) });
    const parent = await bootstrap({ document: doc, gm });
    t.after(() => parent.destroy());
    assert.equal(commands.length, 8);
    const frame = doc.createElement('iframe');doc.body.appendChild(frame);
    frame.contentWindow.requestIdleCallback = () => 0;
    const child = await bootstrap({ document: frame.contentDocument, gm });
    t.after(() => child.destroy());
    assert.equal(child.ready, true);
    assert.equal(commands.length, 8);
    const image = frame.contentDocument.createElement('img');image.src = 'https://cdn.example/child.png';
    frame.contentDocument.body.appendChild(image);
    assert.equal(child.resolveTarget(image).kind, 'img');
    assert.equal(child.menu.open(child.resolveTarget(image), 20, 20), true);
    assert.equal(child.menu.isOpen, true);
  });

  test('resolveTarget() reports an image and nothing else', async (t) => {
    const instance = await bootstrap({ document: doc });
    t.after(() => instance.destroy());
    const img = doc.getElementById('photo');
    const hit = instance.resolveTarget(img);
    assert.ok(hit, 'an <img> is a target');
    assert.equal(instance.resolveTarget(doc.body), null, 'the page background is not a target by default');
  });
});
