import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyZip, verifyMetadata, makeMetadataFixtures } from '../helpers/harness.mjs';

/** Real Chromium integration scenarios against the built userscript, not module mocks. */
export async function runV2(h) {
  const { scenario, browser, state, openPage, assert, assertEquals, convertWithMouse, waitForGmDownload, verifyCapture, GM_DOWNLOAD_DIR, FIXTURE_DIR, GENERATED_FIXTURE_DIR, VERIFY_DIR, saveForVerification, sleep, HAVE_PYTHON } = h;
  const marker = 'window.__saveImageAsTypeInitialised';
  async function fresh(seedSettings = {}, config = {}) {
    const c = await openPage(browser, state, { downloadMode: 'browser', ...config }, { seedSettings });
    await c.page.evaluate(async () => { await window.__saveImageAsTypeInitialised.ensureCapabilities(); });
    return c;
  }
  async function command(page, text) {
    await page.evaluate((text) => {
      const command = window.__siatE2E.menuCommands.find((x) => x.label.includes(text));
      if (!command) throw new Error(`missing manager command: ${text}`);
      command.run();
    }, text);
  }
  async function dialog(page, host) {
    await page.waitForFunction((host) => {
      const el = document.getElementById(host);
      return el && el.shadowRoot && el.shadowRoot.querySelector('[role=dialog]') && !el.shadowRoot.querySelector('[role=dialog]').closest('[hidden]');
    }, { timeout: 8000 }, host);
  }
  async function click(page, host, id) {
    // Real DOM activation inside the shadow root; `.click()` honours disabled.
    await page.evaluate((host, id) => {
      const el = document.getElementById(host)?.shadowRoot?.getElementById(id);
      if (!el) throw new Error(`missing ${host}/${id}`);
      el.click();
    }, host, id);
  }
  async function set(page, host, id, value, event = 'input') {
    await page.evaluate((host, id, value, event) => {
      const el = document.getElementById(host).shadowRoot.getElementById(id);
      if (!el) throw new Error(`missing control ${id}`);
      if (typeof value === 'boolean') el.checked = value; else el.value = String(value);
      el.dispatchEvent(new Event(event, { bubbles: true }));
    }, host, id, value, event);
  }
  async function selectRows(page, elementIds) {
    await page.evaluate((ids) => {
      const api = window.__saveImageAsTypeInitialised;
      const inv = api.scanPage().entries;
      const root = api.picker.shadowRoot;
      root.getElementById('siat-pick-clear').click();
      const hide = root.getElementById('siat-pick-notiny');
      if (hide.checked) hide.click();
      for (const wanted of ids) {
        const entry = inv.find((x) => x.element && x.element.id === wanted);
        if (!entry) throw new Error(`not scanned: ${wanted}`);
        const box = root.getElementById(`siat-pick-check-${entry.id}`);
        if (!box) throw new Error(`not listed: ${wanted}`);
        box.click();
      }
    }, elementIds);
  }
  async function settled(page) {
    await page.waitForFunction(() => {
      const api = window.__saveImageAsTypeInitialised;
      return !api.batch && api.jobState === 'idle';
    }, { timeout: 30000 });
  }
  const capture = (record) => readFileSync(join(GM_DOWNLOAD_DIR, record.name));

  await scenario('v2-inventory-local', 'picker inventory, filters, thumbnails and rescan produce no image requests', async ({ note }) => {
    const c = await fresh();
    try {
      const seen = [];
      const listener = (r) => seen.push(r.url());
      c.page.on('request', listener);
      await command(c.page, 'Browse page images');
      await dialog(c.page, 'siat-picker-host');
      await sleep(150);
      const initial = await c.page.evaluate(() => {
        const api = window.__saveImageAsTypeInitialised;
        return { state: api.picker.state(), thumbs: [...api.picker.shadowRoot.querySelectorAll('img.siat-row-thumb')].map((x) => x.src), kinds: api.scanPage().entries.map((e) => e.kind) };
      });
      assert(initial.state.found >= 10, `mixed gallery found ${initial.state.found}`);
      assert(initial.kinds.includes('svg') && initial.kinds.includes('background'), 'SVG and background inventoried');
      assert(initial.thumbs.length > 0 && initial.thumbs.every((x) => x.startsWith('data:')), 'thumbnails are local pixels');
      await set(c.page, 'siat-picker-host', 'siat-pick-search', 'photo.jpg');
      const count = await c.page.evaluate(() => window.__saveImageAsTypeInitialised.picker.state().listed);
      assertEquals(count, 1, 'search narrows to photo');
      await click(c.page, 'siat-picker-host', 'siat-pick-refresh');
      c.page.off('request', listener);
      const imageRequests = seen.filter((url) => /\/fixtures\/|\/cors\//.test(url));
      assertEquals(imageRequests.length, 0, `scan/preview made no image requests: ${imageRequests}`);
      note(`${initial.state.found} sources; ${initial.thumbs.length} data-URL thumbnails; filters + rescan: zero image requests`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-picker-single-routing', 'picker This one saves the selected row in the chosen format', async ({ note }) => {
    const c = await fresh();
    try {
      await command(c.page, 'Browse page images');
      await dialog(c.page, 'siat-picker-host');
      await set(c.page, 'siat-picker-host', 'siat-pick-format', 'bmp', 'change');
      const id = await c.page.evaluate(() => window.__saveImageAsTypeInitialised.scanPage().entries.find((x) => x.element?.id === 'same-jpg').id);
      const before = state.gmDownloads.length;
      await click(c.page, 'siat-picker-host', `siat-pick-one-${id}`);
      const record = await waitForGmDownload(state, before);
      await settled(c.page);
      assertEquals(state.gmDownloads.length - before, 1, 'exactly one file');
      assert(record.name.endsWith('.bmp'), `chosen format: ${record.name}`);
      const facts = verifyCapture('v2-picker-single.bmp', capture(record));
      if (facts) assertEquals(facts.size[0], 200, 'BMP decoded');
      note(`one image → ${record.name}, independent decoder accepted BMP`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-batch-preview-files', 'batch dialog previews counts, confirms, then saves each eligible image once', async ({ note }) => {
    const c = await fresh({ batchMaxImages: 3, batchConcurrency: 2, filenameTemplate: '{index3}-{base}' });
    try {
      const before = state.gmDownloads.length;
      await command(c.page, 'Convert every image');
      await dialog(c.page, 'siat-batch-host');
      const plan = await c.page.evaluate(() => window.__saveImageAsTypeInitialised.batchDialog.state().plan);
      assertEquals(state.gmDownloads.length, before, 'preview does not save');
      assertEquals(plan.eligible, 3, 'configured batch cap respected');
      assertEquals(plan.concurrency, 2, 'preview concurrency');
      await click(c.page, 'siat-batch-host', 'siat-batch-start');
      await settled(c.page);
      const files = state.gmDownloads.slice(before);
      assertEquals(files.length, plan.files, 'exactly planned file count');
      assertEquals(new Set(files.map((f) => f.name)).size, files.length, 'no duplicate output paths');
      for (let i = 0; i < files.length; i++) verifyCapture(`v2-batch-${i}.png`, capture(files[i]));
      const status = await c.page.evaluate(() => document.getElementById('siat-jobbar-host').shadowRoot.getElementById('siat-jobbar-status').textContent);
      assert(/saved|finished|converted/i.test(status), `summary: ${status}`);
      note(`preview ${plan.eligible} images/${plan.files} files; saved ${files.length} independently decoded files; ${status}`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-zip-multiple-formats', 'picker exports two selected images in one independently verified ZIP', async ({ note }) => {
    const c = await fresh({ filenameTemplate: '{index3}-{base}-{format}' });
    try {
      await command(c.page, 'Browse page images');
      await dialog(c.page, 'siat-picker-host');
      await selectRows(c.page, ['same-jpg', 'same-png']);
      const before = state.gmDownloads.length;
      await click(c.page, 'siat-picker-host', 'siat-pick-zip');
      await settled(c.page);
      const files = state.gmDownloads.slice(before);
      assertEquals(files.length, 1, 'one download avoids multi-download throttling');
      assert(files[0].name.endsWith('.zip'), `archive name ${files[0].name}`);
      saveForVerification('v2-batch.zip', capture(files[0]));
      if (HAVE_PYTHON) {
        const r = verifyZip(VERIFY_DIR, 'v2-batch.zip');
        assertEquals(r.errors.length, 0, 'zipfile parsed archive');
        const a = r.archives[0];
        assertEquals(a.member_count, 2, 'two selected images');
        assertEquals(a.testzip, null, 'all CRCs pass');
        assert(a.members.every((m) => m.crc_matches && m.decoded), 'every member CRC and Pillow decode pass');
        note(`Python zipfile+zlib+Pillow: ${a.members.map((m) => `${m.name} ${m.size} bytes`).join('; ')}`);
      }
    } finally { await c.page.close(); }
  });

  await scenario('v2-transform-save', 'transform dialog resizes 200×140 to 100×70 and saves real PNG pixels', async ({ note }) => {
    const c = await fresh();
    try {
      await convertWithMouse(c.page, '#same-jpg', 'Transform and save…');
      await dialog(c.page, 'siat-transform-host');
      await c.page.waitForFunction(() => /200×140/.test(document.getElementById('siat-transform-host').shadowRoot.getElementById('siat-tf-output').textContent));
      await set(c.page, 'siat-transform-host', 'siat-tf-width', 100);
      const out = await c.page.evaluate(() => document.getElementById('siat-transform-host').shadowRoot.getElementById('siat-tf-output').textContent);
      assert(out.includes('100×70'), `aspect-locked readout ${out}`);
      const before = state.gmDownloads.length;
      await click(c.page, 'siat-transform-host', 'siat-tf-save');
      const r = await waitForGmDownload(state, before);
      const facts = verifyCapture('v2-resized.png', capture(r));
      if (facts) { assertEquals(facts.size[0], 100, 'decoded width'); assertEquals(facts.size[1], 70, 'decoded height'); }
      note(`UI readout ${out}; independently decoded 100×70 PNG`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-transform-pixel-geometry', 'rotate, flip and crop preserve exact coloured quadrant geometry', async ({ note }) => {
    const c = await fresh();
    try {
      // Local canvas fixture, no mocked canvas/encoder: verifies the entire pixel path.
      const result = await c.page.evaluate(async () => {
        const cv = document.createElement('canvas'); cv.width = 4; cv.height = 2;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2, 2);
        ctx.fillStyle = '#0000ff'; ctx.fillRect(2, 0, 2, 2);
        cv.id = 'pixel-truth'; document.body.appendChild(cv);
        const api = window.__saveImageAsTypeInitialised;
        const target = api.resolveTarget(cv);
        const p = await api.produceOutput(target, 'png', { transform: { rotate: 90, flipH: false, flipV: false, crop: null, resize: { mode: 'none' } } });
        const image = await createImageBitmap(p.blob);
        const out = document.createElement('canvas'); out.width = image.width; out.height = image.height;
        const oc = out.getContext('2d'); oc.drawImage(image, 0, 0);
        const sample = async (transform) => {
          const output = await api.produceOutput(target, 'png', { transform });
          const decoded = await createImageBitmap(output.blob);
          const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height;
          const context = canvas.getContext('2d'); context.drawImage(decoded, 0, 0);
          return { w: decoded.width, h: decoded.height, first: [...context.getImageData(0, 0, 1, 1).data], last: [...context.getImageData(decoded.width-1, 0, 1, 1).data] };
        };
        const flipped = await sample({ flipH: true, resize: { mode: 'none' } });
        const cropped = await sample({ crop: {x: 1, y: 0, width: 2, height: 2}, resize: {mode:'none'} });
        return { w: image.width, h: image.height, first: [...oc.getImageData(0, 0, 1, 1).data], last: [...oc.getImageData(0, image.height - 1, 1, 1).data], flipped, cropped };
      });
      assertEquals(result.w, 2, 'rotated width'); assertEquals(result.h, 4, 'rotated height');
      assertEquals(JSON.stringify(result.first), '[255,0,0,255]', 'red half rotates to top');
      assertEquals(JSON.stringify(result.last), '[0,0,255,255]', 'blue half rotates to bottom');
      assertEquals(JSON.stringify(result.flipped.first), '[0,0,255,255]', 'flip puts blue on left');
      assertEquals(JSON.stringify(result.flipped.last), '[255,0,0,255]', 'flip puts red on right');
      assertEquals(result.cropped.w, 2, 'crop width');
      assertEquals(JSON.stringify(result.cropped.first), '[255,0,0,255]', 'crop selects red edge');
      assertEquals(JSON.stringify(result.cropped.last), '[0,0,255,255]', 'crop selects blue edge');
      note(`real canvas → convertImage → PNG → ImageBitmap → readback: ${JSON.stringify(result)}`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-template-download', 'filename tokens reach the actual saved path without unsafe page text', async ({ note }) => {
    const c = await fresh({ filenameTemplate: '{host}-{w}x{h}', filenamePrefix: 'ignored' });
    try {
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#same-jpg', 'PNG');
      const r = await waitForGmDownload(state, before);
      assertEquals(r.name, '127.0.0.1-200x140.png', 'host and real output size in saved name; template replaces prefix');
      note(`manager received ${r.name}`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-preset-host-roundtrip', 'per-host preset changes format, template and transform and survives reload', async ({ note }) => {
    // The loopback fixture is a real page host; auto-apply is exercised without a manual preset.
    const c = await fresh({ presets: [{ id: 'archive', name: 'Archive', formatId: 'webp', hosts: ['127.0.0.1'], filenameTemplate: '{preset}-{w}x{h}', transform: { resize: { mode: 'percent', width: 50 }, rotate: 0 } }], activePresetId: '' });
    try {
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#same-jpg', 'WebP');
      const r = await waitForGmDownload(state, before);
      assertEquals(r.name, 'Archive-100x70.webp', 'active preset naming and transform applied');
      const facts = verifyCapture('v2-preset.webp', capture(r));
      if (facts) assertEquals(facts.size[0], 100, 'preset transformed pixels');
      await c.page.reload({ waitUntil: 'load' });
      await c.page.waitForFunction(`${marker} && ${marker}.ready`);
      const stored = await c.page.evaluate(() => window.__saveImageAsTypeInitialised.store.get().presets[0]);
      assertEquals(stored.jpegQuality, 0, 'unset preset quality did not drift after reload');
      assertEquals(stored.name, 'Archive', 'preset persisted');
      note(`${r.name}, 100×70 decoded; preset and quality sentinel preserved after reload`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-comparison-save', 'comparison UI shows real encoded sizes then saves the recommended format', async ({ note }) => {
    const c = await fresh();
    try {
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#same-jpg', 'Compare formats…');
      await dialog(c.page, 'siat-compare-host');
      await c.page.waitForFunction(() => !document.getElementById('siat-compare-host').shadowRoot.getElementById('siat-cmp-save-smallest').disabled, { timeout: 20000 });
      const outcome = await c.page.evaluate(() => window.__saveImageAsTypeInitialised.compareDialog.state());
      assert(outcome.rows.length >= 2, 'at least two real encoders compared');
      assert(outcome.rows.every((r) => r.ok && r.bytes > 0), 'real encoded byte counts');
      assertEquals(state.gmDownloads.length, before, 'nothing saved during comparison');
      await click(c.page, 'siat-compare-host', 'siat-cmp-save-smallest');
      const r = await waitForGmDownload(state, before);
      assert(r.name.endsWith(`.${outcome.recommended.formatId}`), `saved recommended ${outcome.recommended.formatId}: ${r.name}`);
      verifyCapture(`v2-compared.${outcome.recommended.formatId}`, capture(r));
      note(`${outcome.rows.map((r) => `${r.formatId}=${r.bytes}`).join(', ')}; recommended ${outcome.recommended.formatId} saved and independently decoded`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-metadata-inspect-strip', 'inspector detects real GPS and saves an EXIF-free pixel-identical original', async ({ note }) => {
    assert(HAVE_PYTHON, 'Pillow required for metadata E2E');
    // Generated into the ignored scratch directory (see harness.mjs): the bytes
    // depend on the local Pillow/lcms build, so they are never committed.
    mkdirSync(join(GENERATED_FIXTURE_DIR, 'metadata'), { recursive: true });
    makeMetadataFixtures(join(GENERATED_FIXTURE_DIR, 'metadata'));
    // The fixture route only permits a basename, so copy the generated input there.
    writeFileSync(join(GENERATED_FIXTURE_DIR, 'exif-test.jpg'), readFileSync(join(GENERATED_FIXTURE_DIR, 'metadata', 'exif.jpg')));
    const c = await fresh();
    try {
      await c.page.evaluate(async () => {
        const img = new Image(); img.id = 'exif-target'; img.src = '/fixtures/exif-test.jpg';
        document.body.prepend(img); await img.decode();
      });
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#exif-target', 'Inspect metadata');
      await dialog(c.page, 'siat-inspector-host');
      await c.page.waitForFunction(() => document.getElementById('siat-inspector-host').shadowRoot.textContent.includes('Location data found'));
      const text = await c.page.evaluate(() => document.getElementById('siat-inspector-host').shadowRoot.textContent);
      assert(text.includes('FixtureCam') && text.includes('GPS'), 'real EXIF fields displayed');
      await click(c.page, 'siat-inspector-host', 'siat-insp-save-stripped');
      const r = await waitForGmDownload(state, before);
      saveForVerification('v2-stripped.jpg', capture(r));
      saveForVerification('v2-metadata-original.jpg', readFileSync(join(GENERATED_FIXTURE_DIR, 'exif-test.jpg')));
      const original = verifyMetadata(VERIFY_DIR, 'v2-metadata-original.jpg').images[0];
      const stripped = verifyMetadata(VERIFY_DIR, 'v2-stripped.jpg').images[0];
      assertEquals(original.exif.gps.present, true, 'independent reader confirms GPS in source');
      assertEquals(stripped.exif.present, false, 'independent reader confirms EXIF removed');
      assertEquals(stripped.pixel_sha256, original.pixel_sha256, 'stored pixel hashes identical');
      note(`inspector GPS warning → Save stripped → Pillow: EXIF absent; pixels SHA256 ${stripped.pixel_sha256}`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-keyboard-workflow', 'hover + shortcut saves without a menu; typing field is left alone; picker shortcut opens UI', async ({ note }) => {
    const c = await fresh();
    try {
      const box = await c.page.$eval('#same-jpg', (el) => { el.scrollIntoView(); const r = el.getBoundingClientRect(); return {x:r.x+20,y:r.y+20}; });
      await c.page.mouse.move(box.x, box.y);
      const before = state.gmDownloads.length;
      await c.page.keyboard.down('Alt'); await c.page.keyboard.down('Shift'); await c.page.keyboard.press('KeyS'); await c.page.keyboard.up('Shift'); await c.page.keyboard.up('Alt');
      await waitForGmDownload(state, before);
      await settled(c.page);
      await c.page.evaluate(() => { const input = document.createElement('input'); input.id = 'typing'; document.body.prepend(input); input.focus(); });
      const saved = state.gmDownloads.length;
      await c.page.keyboard.type('ordinary typing');
      await sleep(50);
      assertEquals(state.gmDownloads.length, saved, 'plain typing does not save');
      await c.page.$eval('#typing', (el) => el.blur());
      await c.page.keyboard.down('Alt'); await c.page.keyboard.down('Shift'); await c.page.keyboard.press('KeyP'); await c.page.keyboard.up('Shift'); await c.page.keyboard.up('Alt');
      await dialog(c.page, 'siat-picker-host');
      note('real keyboard chord saved exactly one file; ordinary typing no save; picker chord opened dialog');
    } finally { await c.page.close(); }
  });

  await scenario('v2-clipboard-real', 'image clipboard uses real browser permission and PNG bytes, or explains a real refusal', async ({ note }) => {
    const c = await fresh();
    try {
      await c.cdp.send('Browser.grantPermissions', { origin: state.originA, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
      await c.page.bringToFront();
      await convertWithMouse(c.page, '#same-png', 'Copy image to clipboard');
      await c.page.waitForFunction(() => {
        const root = document.getElementById('siat-toast-host')?.shadowRoot;
        return root && /Copied to|clipboard write failed|refused the clipboard|Clipboard access is blocked/.test(root.textContent);
      }, { timeout: 15000 });
      const actual = await c.page.evaluate(async () => {
        const root = document.getElementById('siat-toast-host').shadowRoot;
        const message = [...root.querySelectorAll('.siat-toast')].map((x) => x.textContent).join(' ');
        if (!message.includes('Copied to')) return { message, success: false };
        const items = await navigator.clipboard.read();
        const png = await items[0].getType('image/png');
        const image = await createImageBitmap(png);
        return { message, success: true, mime: png.type, width: image.width, height: image.height, size: png.size };
      });
      assert(actual.success, `real clipboard copy failed: ${actual.message}`);
      assertEquals(actual.mime, 'image/png', 'clipboard PNG MIME');
      assertEquals(actual.width, 64, 'clipboard decoded image width');
      note(`real Chromium clipboard write + readback: ${actual.mime}, ${actual.width}×${actual.height}, ${actual.size} bytes; permission granted explicitly in test`);
    } finally { await c.page.close(); }
  });
  await scenario('v2-multiformat-zip-collisions', 'batch encodes multiple formats and resolves colliding templates inside ZIP', async ({ note }) => {
    const c = await fresh({ filenameTemplate: 'same-name' });
    try {
      const before = state.gmDownloads.length;
      await c.page.evaluate(() => {
        const api = window.__saveImageAsTypeInitialised;
        const entries = api.scanPage().entries.filter((e) => ['same-jpg', 'same-png'].includes(e.element?.id));
        api.startBatch({ entries, formatId: 'png', extraFormats: ['bmp'], destination: 'zip', skipTiny: false });
      });
      await waitForGmDownload(state, before); await settled(c.page);
      const r = state.gmDownloads[before];
      assertEquals(state.gmDownloads.length - before, 1, 'single archive download');
      saveForVerification('v2-multiformat.zip', capture(r));
      const archive = verifyZip(VERIFY_DIR, 'v2-multiformat.zip').archives[0];
      assertEquals(archive.member_count, 4, 'two images times two formats');
      assertEquals(new Set(archive.members.map((m) => m.name)).size, 4, 'colliding names suffixed');
      assertEquals(archive.testzip, null, 'CRC checks');
      assert(archive.members.every((m) => m.decoded && m.crc_matches), 'all images independently decode');
      note(archive.members.map((m) => `${m.name}: ${m.decoded.format}`).join('; '));
    } finally { await c.page.close(); }
  });

  await scenario('v2-default-transform', 'Make default transform applies to subsequent ordinary saves and batches', async ({ note }) => {
    const c = await fresh({ defaultTransform: { resize: { mode: 'percent', width: 50, keepAspect: true }, rotate: 0 } });
    try {
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#same-jpg', 'PNG');
      const r = await waitForGmDownload(state, before); await settled(c.page);
      const f = verifyCapture('v2-default-transform.png', capture(r));
      assertEquals(f.size[0], 100, 'stored default applied to ordinary save');
      await c.page.evaluate(() => {
        const api = window.__saveImageAsTypeInitialised;
        api.startBatch({ entries: api.scanPage().entries.filter((e) => e.element?.id === 'same-jpg'), formatId: 'bmp', skipTiny: false });
      });
      const rb = await waitForGmDownload(state, before + 1); await settled(c.page);
      const fb = verifyCapture('v2-default-transform.bmp', capture(rb));
      // findFacts selects raw BMP facts before image facts; both expose dimensions differently.
      const raw = verifyMetadata(VERIFY_DIR, 'v2-default-transform.bmp').images[0];
      assertEquals(raw.width, 100, 'stored default applied to batch');
      note(`single + batch both independently decoded at 100px wide`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-batch-cancel', 'cancel stops a running batch without scheduling queued saves or replaying writes', async ({ note }) => {
    const c = await fresh({ batchConcurrency: 1 });
    try {
      await c.page.setRequestInterception(true);
      let firstWrite;
      const began = new Promise((resolve) => { firstWrite = resolve; });
      c.page.on('request', (req) => {
        if (req.url().includes('/__gm_download')) {
          firstWrite();
          setTimeout(() => req.continue().catch(() => {}), 450);
        } else req.continue().catch(() => {});
      });
      const before = state.gmDownloads.length;
      await c.page.evaluate(() => {
        const api = window.__saveImageAsTypeInitialised;
        const source = api.scanPage().entries.find((e) => e.element?.id === 'same-jpg');
        const entries = Array.from({length: 12}, (_, i) => ({ ...source, id: `cancel-${i}`, url: `${source.url}?cancel=${i}` }));
        api.startBatch({ entries, dedupe: false, formatId: 'png', skipTiny: false });
      });
      await Promise.race([began, sleep(5000).then(() => { throw new Error('first write never began'); })]);
      await click(c.page, 'siat-jobbar-host', 'siat-jobbar-cancel');
      await settled(c.page); await sleep(650);
      const saved = state.gmDownloads.length - before;
      assertEquals(saved, 1, 'only the already-started save may land');
      const status = await c.page.evaluate(() => document.getElementById('siat-jobbar-host').shadowRoot.getElementById('siat-jobbar-status').textContent);
      assert(/cancel/i.test(status), `cancelled state visible: ${status}`);
      await sleep(200);
      assertEquals(state.gmDownloads.length - before, 1, 'no delayed replay');
      note(`12-item queue at concurrency 1 cancelled during first write: one in-flight file landed, 11 not started; ${status}`);
    } finally { await c.page.close(); }
  });

  await scenario('v2-partial-failure-no-replay', 'a failed format cannot cause an already-saved sibling output to be retried', async ({ note }) => {
    const c = await fresh();
    try {
      const before = state.gmDownloads.length;
      await c.page.evaluate(() => {
        const api = window.__saveImageAsTypeInitialised;
        api.startBatch({ entries: api.scanPage().entries.filter((e) => e.element?.id === 'same-jpg'), formatId: 'png', extraFormats: ['avif'], skipTiny: false });
      });
      await settled(c.page);
      assertEquals(state.gmDownloads.length - before, 1, 'PNG landed, unsupported AVIF did not');
      const text = await c.page.evaluate(() => document.getElementById('siat-toast-host').shadowRoot.textContent);
      assert(/1 failed|1 of 2 outputs written/.test(text), 'partial failure reported');
      await click(c.page, 'siat-jobbar-host', 'siat-jobbar-retry');
      await sleep(250);
      assertEquals(state.gmDownloads.length - before, 1, 'explicit retry did not repeat saved PNG');
      const reason = await c.page.evaluate(() => document.getElementById('siat-toast-host').shadowRoot.textContent);
      assert(/No safely retryable items|Partial or unconfirmed/.test(reason), 'manual recovery instructions shown');
      note('one PNG saved, AVIF failed; retry refused partial-item replay with manual recovery explanation');
    } finally { await c.page.close(); }
  });

  await scenario('v2-clipboard-denied', 'explicitly denied clipboard permission gives actionable feedback without a save', async ({ note }) => {
    const c = await fresh();
    try {
      await c.cdp.send('Browser.setPermission', { origin: state.originA, permission: { name: 'clipboard-write' }, setting: 'denied' });
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#same-png', 'Copy image to clipboard');
      await c.page.waitForFunction(() => /blocked for this site|refused the clipboard/.test(document.getElementById('siat-toast-host')?.shadowRoot?.textContent || ''));
      assertEquals(state.gmDownloads.length, before, 'no unsolicited fallback download');
      note('real Chrome permission denial → actionable refusal, no file download');
    } finally { await c.page.close(); }
  });

  await scenario('v2-uncertain-save-no-fallback', 'a manager timeout is reported as uncertain without a second browser download', async ({ note }) => {
    const c = await fresh({}, { downloadError: 'timeout' });
    try {
      const before = state.gmDownloads.length;
      await convertWithMouse(c.page, '#same-jpg', 'PNG');
      await c.page.waitForFunction(() => /outcome was not confirmed/.test(document.getElementById('siat-toast-host')?.shadowRoot?.textContent || ''));
      await settled(c.page); await sleep(150);
      const calls = await c.page.evaluate(() => window.__siatE2E.calls.filter((x) => x.api === 'download').length);
      assertEquals(calls, 1, 'only one manager save attempted');
      assertEquals(state.gmDownloads.length, before, 'no manager capture');
      const { readdirSync } = await import('node:fs');
      assertEquals(readdirSync(c.downloadDir).length, 0, 'no anchor fallback after an uncertain outcome');
      note('fixture manager timeout → check-downloads warning; one attempt, no fallback/retry (uncertainty simulated, not a real manager timeout)');
    } finally { await c.page.close(); }
  });

  await scenario('v2-cancel-without-jobbar', 'hiding the job bar still leaves an accessible toast Cancel control', async ({ note }) => {
    const c = await fresh({ showJobBar: false, batchConcurrency: 1 });
    try {
      await c.page.setRequestInterception(true);
      c.page.on('request', (r) => {
        if (r.url().includes('/__gm_download')) setTimeout(() => r.continue().catch(() => {}), 300);
        else r.continue().catch(() => {});
      });
      const before = state.gmDownloads.length;
      await c.page.evaluate(() => {
        const api = window.__saveImageAsTypeInitialised;
        const src = api.scanPage().entries.find((e) => e.element?.id === 'same-jpg');
        api.startBatch({ entries: Array.from({length:10}, (_,i) => ({...src, id:`hidden-${i}`, url:src.url+'?n='+i})), dedupe:false, formatId:'png' });
      });
      await c.page.waitForFunction(() => document.getElementById('siat-toast-host')?.shadowRoot?.textContent.includes('Converting images'));
      const hasBar = await c.page.evaluate(() => !!document.getElementById('siat-jobbar-host'));
      assertEquals(hasBar, false, 'job bar hidden as configured');
      await c.page.evaluate(() => {
        const root = document.getElementById('siat-toast-host').shadowRoot;
        const cancel = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
        if (!cancel) throw new Error('no toast Cancel'); cancel.click();
      });
      await settled(c.page); await sleep(450);
      assert(state.gmDownloads.length - before <= 1, 'queued images were not saved after cancellation');
      note('showJobBar=false: toast Cancel remained available and stopped the queue');
    } finally { await c.page.close(); }
  });

}
