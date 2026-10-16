import { guardUserEvent } from './ui/events.js';
/**
 * Bootstrap and orchestration.
 *
 * Runs at document-start, which means almost nothing may happen eagerly: the
 * only work done before the first interaction is attaching listeners. Settings,
 * encoder probes and DOM creation are deferred, so it does not intentionally add
 * heavy pixel work to page load, and the listeners live on `document` rather than on
 * elements, so SPA re-renders and route changes cannot orphan them.
 *
 * Repeated bootstrap calls within one module are idempotent. Independently
 * evaluated copies / multiple managers are not authenticated peers: a shared
 * DOM marker is deliberately not trusted for ownership or privileged APIs.
 *
 * This module is the only place that knows about both the manager adapter and
 * the UI: every feature (single conversion, batch run, picker, transform,
 * comparison, clipboard, metadata) is wired here, and each one reuses the same
 * acquisition/convert/save primitives rather than growing its own.
 */

import { getGm } from './core/gm.js';
import { createSettingsStore, DEFAULT_SETTINGS, MENU_ACTION_LABELS } from './core/settings.js';
import { getFormat, defaultEnabledFormats } from './core/formats.js';
import { resolveImageTarget, acquireImage, mimeFromUrl, safeHost } from './core/source.js';
import { convertImage, getOriginalBytes, CancelledError } from './core/convert.js';
import { saveBlob, describeDownloadCapability } from './core/download.js';
import {
  canEncode,
  ConversionError,
  revokeAllPending,
  revokeLater,
  createCanvas,
  blobFromBytes,
  encodeNative,
  drawToCanvas,
  objectUrlFor,
  loadImage,
  svgElementToObjectUrl,
} from './core/raster.js';
import { animationCapability } from './core/frames.js';
import { baseNameFromSource, buildFilename } from './core/filename.js';
import { uniqueFilename } from './core/template.js';
import { scanImages, createThumbnail, dedupeEntries, summarizeInventory } from './core/scan.js';
import { createJobQueue, JOB_STATES, ITEM_STATES } from './core/queue.js';
import { encodeZip, estimateZipSize } from './encoders/zip.js';
import { compareFormats, comparableFormats } from './core/compare.js';
import { copyImageToClipboard, clipboardCapability } from './core/clipboard.js';
import { presetForHost, effectiveSettings } from './core/presets.js';
import { validateShortcuts, matchesBinding, isTypingTarget, SHORTCUT_ACTIONS } from './core/shortcuts.js';
import { messageOf } from './core/errors.js';
import { createContextMenu } from './ui/menu.js';
import { createSettingsPanel } from './ui/panel.js';
import { createToaster } from './ui/toast.js';
import { createImagePicker } from './ui/picker.js';
import { createJobBar } from './ui/jobbar.js';
import { createTransformDialog } from './ui/transform-dialog.js';
import { createCompareDialog } from './ui/compare-dialog.js';
import { createMetadataInspector } from './ui/inspector.js';
import { createShortcutHelp } from './ui/help.js';
import { createBatchDialog } from './ui/batch-dialog.js';

// Private ownership: never put manager capabilities on page-controlled roots.
// This registry deduplicates callers of THIS module, not independently evaluated
// copies or different managers. Those are explicitly unverified configurations.
const bootstrapInstances = new WeakMap();
const JOB_TOAST_ID = 'siat-job';
const BATCH_TOAST_ID = 'siat-batch';
/** Bytes buffered for an archive before the run falls back to separate files. */
const ZIP_FALLBACK_GRACE_BYTES = 8 * 1024 * 1024;

export async function bootstrap(options = {}) {
  const doc = options.document || document;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!doc || !win) return null;

  const existing = bootstrapInstances.get(doc);
  if (existing) return existing;
  const api = { ready: false };
  bootstrapInstances.set(doc, api);

  try {
    const gm = options.gm || getGm();
    const store = options.settingsStore || createSettingsStore({ gm });
    const toaster = createToaster(doc);

    const state = {
      settingsLoaded: false,
      capabilities: null,
      lastFormat: null,
      paused: false,
      job: null,
      batch: null,
      disposed: false,
      runCounter: 0,
      lastBatchOptions: null,
      shortcutCache: null,
    };
    const disposers = [];

    const getSettings = () => (state.settingsLoaded ? store.get() : DEFAULT_SETTINGS);

    async function ensureSettings() {
      if (state.settingsLoaded) return store.get();
      try {
        await store.load();
      } catch {
        /* keep defaults; the diagnostics panel reports the failure */
      }
      state.settingsLoaded = true;
      return store.get();
    }

    /** Probe once, lazily: which encoders this browser really has. */
    async function ensureCapabilities() {
      if (state.capabilities) return state.capabilities;
      const encoders = {};
      const encoderNotes = {};
      for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/avif']) {
        const ok = await canEncode(mime);
        encoders[mime] = ok;
        if (!ok) encoderNotes[mime] = 'canvas silently returns a PNG for this type in your browser';
      }
      const animation = await animationCapability();
      const clipboard = clipboardCapability(win);
      state.capabilities = {
        encoders,
        encoderNotes,
        animation: {
          decoderAvailable: animation.decoderAvailable,
          supportedTypes: Object.keys(animation.types || {}).filter((type) => animation.types[type]),
          reason: animation.reason || '',
        },
        clipboard: {
          supported: clipboard.supported,
          reasons: clipboard.reasons,
        },
      };
      return state.capabilities;
    }

    function diagnostics() {
      const capabilities = state.capabilities || {
        encoders: {},
        encoderNotes: {},
        animation: { decoderAvailable: false, supportedTypes: [] },
        clipboard: { supported: false, reasons: ['not probed yet'] },
      };
      return {
        handler: gm.handler,
        managerVersion: gm.managerVersion,
        scriptVersion: gm.scriptVersion || SCRIPT_VERSION_REPORTED,
        injectInto: gm.injectInto,
        downloadMode: gm.downloadMode,
        storage: store.info().storage,
        encoders: capabilities.encoders,
        encoderNotes: capabilities.encoderNotes,
        animation: capabilities.animation,
        clipboard: capabilities.clipboard,
        capabilities: gm.capabilities,
        batch: state.batch ? state.batch.stats() : null,
      };
    }

    function capabilityReport() {
      const d = diagnostics();
      return [
        `manager=${d.handler}/${d.managerVersion || '?'}`,
        `script=${d.scriptVersion || '?'}`,
        `downloadMode=${d.downloadMode}`,
        `storage=${d.storage}`,
        `encoders=${Object.keys(d.encoders).filter((k) => d.encoders[k]).map((k) => k.split('/')[1]).join(',') || 'none-probed'}`,
        `frames=${d.animation.decoderAvailable ? d.animation.supportedTypes.join(',') || 'decoder-present' : 'unavailable'}`,
        `clipboard=${d.clipboard.supported ? 'yes' : 'no'}`,
      ].join(' ');
    }

    /** Formats to show, with a `disabled` reason where the browser cannot deliver. */
    function getMenuFormats() {
      const settings = getSettings();
      const capabilities = state.capabilities;
      const wanted = (settings.formats && settings.formats.length ? settings.formats : defaultEnabledFormats()).filter((id) => getFormat(id));
      const ordered = [];
      if (settings.rememberLastFormat && state.lastFormat && wanted.includes(state.lastFormat)) {
        ordered.push(state.lastFormat);
      }
      for (const id of wanted) {
        if (!ordered.includes(id)) ordered.push(id);
      }
      // "Original file" reads best at the bottom, whatever the stored order says.
      ordered.sort((a, b) => Number(a === 'original') - Number(b === 'original'));
      return ordered.map((id) => {
        const format = getFormat(id);
        let disabled = '';
        if (format.requiresEncodeProbe && capabilities && !capabilities.encoders[format.mime]) {
          disabled = `Not supported by this browser`;
        }
        if (state.paused) disabled = 'Paused on this page (see the manager menu)';
        return { id, label: format.label, ext: format.ext, hint: format.hint, disabled };
      });
    }

    /* ---------------- presets ---------------- */

    function pageHost() {
      try {
        return (win.location && win.location.hostname) || '';
      } catch {
        return '';
      }
    }

    /**
     * Settings with any active preset applied.
     *
     * A preset chosen by hand wins; otherwise a preset listing this host applies
     * automatically (most specific rule first). The stored settings are never
     * mutated, so turning a preset off restores exactly what the user had.
     */
    function resolveSettings() {
      const base = getSettings();
      const manual = (base.presets || []).find((preset) => preset.id === base.activePresetId) || null;
      const auto = !manual && base.autoApplyPresetByHost ? presetForHost(base.presets || [], pageHost()) : null;
      const preset = manual || auto;
      // Never hand out the stored object: callers read it as "the settings in
      // force right now", and a preset has to be visible without mutating storage.
      const effective = preset ? effectiveSettings(base, preset) : Object.assign({}, base);
      if (auto) effective.presetAutoApplied = true;
      effective.activeFormatId =
        effective.presetFormatId ||
        (base.rememberLastFormat && state.lastFormat ? state.lastFormat : '') ||
        (base.formats && base.formats.length ? base.formats[0] : '') ||
        'png';
      return effective;
    }

    function activePresetLabel() {
      const settings = resolveSettings();
      if (!settings.activePresetId) return '';
      const preset = (settings.presets || []).find((item) => item.id === settings.activePresetId);
      if (!preset) return '';
      return `${preset.name}${settings.presetAutoApplied ? ' (auto for this site)' : ''}`;
    }

    /* ---------------- extra menu actions ---------------- */

    function getMenuActions() {
      const settings = getSettings();
      const wanted = Array.isArray(settings.menuActions) ? settings.menuActions : [];
      const capabilities = state.capabilities;
      return wanted
        .filter((id) => MENU_ACTION_LABELS[id])
        .map((id) => {
          const meta = MENU_ACTION_LABELS[id];
          let disabled = '';
          if (state.paused) disabled = 'Paused on this page (see the manager menu)';
          else if (id === 'copy' && capabilities && !capabilities.clipboard.supported) {
            disabled = `Clipboard unavailable: ${capabilities.clipboard.reasons[0] || 'this browser cannot write images there'}`;
          }
          return { id, label: meta.label, hint: disabled ? '' : meta.hint, disabled };
        });
    }

    function onMenuAction(actionId, target) {
      switch (actionId) {
        case 'copy':
          copyImage(target);
          break;
        case 'transform':
          transformTarget(target);
          break;
        case 'compare':
          compareTarget(target);
          break;
        case 'inspect':
          inspectTarget(target);
          break;
        case 'browse':
          openPicker();
          break;
        case 'batch':
          openBatchDialog();
          break;
        default:
          break;
      }
    }

    /* ---------------- conversion job ---------------- */

    /**
     * Produce one output file (blob + name + report) without saving it.
     *
     * Both the single-image path and the batch path go through here, so naming,
     * transforms, presets and metadata handling behave identically everywhere.
     */
    async function produceOutput(target, formatId, runOptions = {}) {
      const settings = runOptions.settings || resolveSettings();
      const naming = Object.assign(
        {
          index: runOptions.index,
          preset: runOptions.preset || settings.activePresetName || '',
          template: runOptions.template !== undefined ? runOptions.template : settings.filenameTemplate,
          formatId,
        },
        runOptions.naming || {},
      );
      const produced = await convertImage({
        target,
        formatId,
        settings,
        gm,
        downloadMode: gm.downloadMode,
        signal: runOptions.signal,
        onProgress: runOptions.onProgress || (() => {}),
        timeout: runOptions.timeout,
        preacquired: runOptions.preacquired || null,
        transform: runOptions.transform !== undefined ? runOptions.transform : settings.presetTransform || settings.defaultTransform || null,
        stripEmbeddedMetadata: runOptions.stripMetadata === undefined ? null : runOptions.stripMetadata,
        naming,
      });
      // A batch writes many files at once: two identical names would silently
      // overwrite each other, so collisions get a counter.
      if (runOptions.taken && settings.filenameCollisionSuffix !== false) {
        const unique = uniqueFilename(produced.filename, runOptions.taken);
        if (unique !== produced.filename) {
          const renamed = rebuildPath(produced.path, produced.filename, unique);
          produced.report.notes.push(`Renamed to "${unique}" because another file in this run already had that name.`);
          return { blob: produced.blob, filename: unique, path: renamed, report: produced.report };
        }
      }
      return produced;
    }

    function rebuildPath(path, filename, newFilename) {
      const text = String(path || filename || '');
      if (text.endsWith(filename)) return `${text.slice(0, text.length - filename.length)}${newFilename}`;
      return newFilename;
    }

    async function runConversion(target, formatId, runOptions = {}) {
      await ensureSettings();
      const settings = runOptions.settings || resolveSettings();
      if (state.batch) {
        toaster.error('siat-busy', 'A batch run is in progress', 'Cancel it from the progress bar first, or wait for it to finish.');
        return null;
      }
      if (state.job) {
        toaster.error('siat-busy', 'A conversion is already running', 'Cancel it from the notification, or wait for it to finish.');
        return null;
      }
      const effectiveFormat = formatId || settings.presetFormatId || (settings.formats || [])[0] || 'png';
      const format = getFormat(effectiveFormat);
      if (!format) return null;
      const controller = makeController();
      state.job = { controller, formatId: effectiveFormat };
      state.lastFormat = effectiveFormat;

      const presetLabel = settings.activePresetName ? ` · preset ${settings.activePresetName}` : '';
      toaster.progress(JOB_TOAST_ID, `Saving as ${format.label}…${presetLabel}`, 'locating image', null, [
        { label: 'Cancel', variant: 'ghost', onClick: () => cancelJob() },
      ]);

      try {
        const produced = await produceOutput(target, effectiveFormat, Object.assign({}, runOptions, {
          settings,
          signal: controller.signal,
          onProgress: (stage) => {
            toaster.progress(JOB_TOAST_ID, `Saving as ${format.label}…${presetLabel}`, stage, null, [
              { label: 'Cancel', variant: 'ghost', onClick: () => cancelJob() },
            ]);
          },
        }));
        const { blob, filename, path, report } = produced;

        if (controller.signal.aborted) throw new CancelledError();

        toaster.progress(JOB_TOAST_ID, `Saving ${filename}`, 'writing file');
        const saved = await saveBlob({ blob, filename, path, settings, gm, downloadMode: gm.downloadMode });

        if (!saved.ok) {
          throw new ConversionError('save-failed', saved.message || 'The file could not be saved.', { fallbackReason: saved.fallbackReason });
        }

        const notes = (report.notes || []).slice();
        notes.push(`Output: ${report.mime}, ${report.sizeLabel}, ${report.durationMs} ms.`);
        if (report.width && report.height) notes.push(`Dimensions: ${report.width}×${report.height}px.`);
        if (report.transformed) notes.push(`Transform: ${report.transformed}.`);
        if (report.metadataRemoved && report.metadataRemoved.length) notes.push(`Metadata removed: ${report.metadataRemoved.join(', ')}.`);
        notes.push(`Saved ${saved.via === 'gm' ? 'through your userscript manager' : 'through the browser'}${saved.fallbackReason ? ` (manager download unavailable: ${saved.fallbackReason})` : ''}.`);
        if (saved.subfolderApplied) notes.push(`Sub-folder applied: ${path}`);
        if (settings.activePresetName) notes.unshift(`Preset "${settings.activePresetName}" was in effect.`);

        toaster.success(JOB_TOAST_ID, `Saved ${report.filename}`, `${report.kindLabel} · ${report.sizeLabel} · ${saved.message}`, notes, null, 10000);
        return { blob, filename, path, report, saved };
      } catch (err) {
        handleConversionError(err, format, settings);
        return null;
      } finally {
        state.job = null;
      }
    }

    function handleConversionError(err, format, settings) {
      if (err instanceof CancelledError || (err && err.code === 'aborted')) {
        toaster.progress(JOB_TOAST_ID, 'Conversion cancelled', `Nothing was written for the ${format.label} output.`);
        setTimeout(() => toaster.dismiss(JOB_TOAST_ID), 4000);
        return;
      }
      const message = messageOf(err, 'The conversion failed.');
      const help = helpForError(err, settings);
      const actions = [];
      if (help.opensSettings) actions.push({ label: 'Open settings', onClick: () => panel.open() });
      if (help.suggestFormat) {
        actions.push({
          label: `Save as ${getFormat(help.suggestFormat).label} instead`,
          onClick: () => {
            const target = lastTarget();
            if (target) runConversion(target, help.suggestFormat);
          },
        });
      }
      toaster.error(JOB_TOAST_ID, `Could not save as ${format.label}`, message, help.notes, actions, 16000);
      if (settings.notifyOnError) {
        gm.notify(message, `Save as ${format.label} failed`, { timeout: 8000 });
      }
    }

    function helpForError(err, settings) {
      const code = (err && err.code) || (err && err.reason) || '';
      const notes = [];
      switch (code) {
        case 'cors-blocked':
          return { opensSettings: true, notes: ['Turn on "Fetch cross-origin images through the manager" to convert images from other origins.'] };
        case 'xhr-unavailable':
          return { opensSettings: false, notes: ['Your manager did not grant GM_xmlhttpRequest, so cross-origin pixels are unreadable. Reinstall the script and accept the permissions.'] };
        case 'tainted-canvas':
          return { opensSettings: true, notes: ['The page drew cross-origin data into that canvas. Browsers forbid reading it back; this is a page-level restriction.'] };
        case 'memory-limit':
        case 'encoder-unavailable':
          return { opensSettings: true, suggestFormat: code === 'encoder-unavailable' ? 'png' : null, notes: [] };
        case 'no-original-bytes':
          return { opensSettings: false, suggestFormat: 'png', notes: [] };
        case 'transform-needs-format':
          return { opensSettings: false, suggestFormat: 'png', notes: [] };
        case 'transform-invalid':
        case 'transform-too-large':
          return { opensSettings: true, notes: ['Check the transform values: crop and resize must stay inside the image and inside the pixel ceiling.'] };
        case 'clipboard-unsupported':
          return { opensSettings: false, notes: ['This browser cannot put images on the clipboard. Saving a file works everywhere.'] };
        case 'save-failed':
          notes.push('The conversion succeeded but the file could not be handed to the browser. Check your manager’s download setting and your browser’s download permission.');
          if (err.detail && err.detail.fallbackReason === 'not_whitelisted') {
            notes.push('Tampermonkey: add this extension to Settings → Download → "File extension whitelist", or enable "Use browser API" for downloads.');
          }
          return { opensSettings: false, notes };
        case 'zip-empty':
        case 'zip-duplicate':
          return { opensSettings: false, notes: ['Nothing could be archived. The individual files were offered instead where possible.'] };
        case 'http-status':
        case 'fetch-failed':
        case 'timeout':
          return { opensSettings: false, notes: ['The image host refused or stalled the request. Try again; some CDNs rate-limit or require a referrer the manager does not send.'] };
        default:
          return { opensSettings: false, notes: settings.allowCrossOriginFetch ? [] : ['Cross-origin fetching is disabled in your settings.'] };
      }
    }

    function makeController() {
      return typeof AbortController === 'function'
        ? new AbortController()
        : { signal: { aborted: false, addEventListener() {}, removeEventListener() {} }, abort() {} };
    }

    function cancelJob() {
      if (!state.job) return false;
      try {
        state.job.controller.abort();
      } catch {
        /* noop */
      }
      return true;
    }

    /* ---------------- shared acquisition ---------------- */

    /**
     * Acquire one image and hand it to `work`, releasing it afterwards.
     *
     * Comparisons and multi-format batch items reuse a single acquisition, so N
     * outputs cost one request rather than N — which is also the privacy point:
     * the script fetches an image once, because the user asked for it once.
     */
    async function withAcquired(target, work, { signal, timeout = 45000, settings } = {}) {
      const effective = settings || resolveSettings();
      const acquired = await acquireImage(target, { settings: effective, gm, signal, timeout });
      try {
        return await work(acquired, effective);
      } finally {
        try {
          if (acquired.objectUrl) revokeLater(acquired.objectUrl, 1000);
          acquired.release();
        } catch {
          /* releasing is best-effort; a failure must not mask the real result */
        }
      }
    }

    /** Original bytes + MIME for the inspector and clipboard paths. */
    async function readBytesFor(target, { signal, timeout = 45000 } = {}) {
      const settings = await ensureSettings();
      return withAcquired(
        target,
        async (acquired) => {
          const have = acquired.bytes && acquired.bytes.length ? { bytes: acquired.bytes, mime: acquired.mimeHint } : null;
          const bytes = have || (await getOriginalBytes(acquired, { gm, settings, timeout }));
          if (!bytes || !bytes.bytes || !bytes.bytes.length) return null;
          const mime = bytes.mime || acquired.mimeHint || mimeFromUrl(acquired.url || target.url || '') || '';
          const name = baseNameFromSource({
            sourceUrl: acquired.finalUrl || acquired.url || target.url || '',
            altText: target.altText,
            documentTitle: safeTitle(),
            hostName: safeHost(acquired.url || target.url || ''),
          });
          return { bytes: bytes.bytes, mime, filename: name, url: acquired.url || target.url || '' };
        },
        { signal, timeout, settings },
      );
    }

    function safeTitle() {
      try {
        return doc.title || '';
      } catch {
        return '';
      }
    }

    /* ---------------- clipboard ---------------- */

    async function copyImage(target, runOptions = {}) {
      const settings = await ensureSettings();
      const capability = clipboardCapability(win);
      if (!capability.supported) {
        toaster.error(
          'siat-clipboard',
          'Clipboard is not available here',
          capability.reasons[0] || 'This browser cannot write images to the clipboard.',
          ['Saving a file works everywhere — right-click the image and pick a format.'],
          null,
          12000,
        );
        return { ok: false, reason: 'unsupported' };
      }
      const controller = makeController();
      const wantOriginal = (runOptions.format || settings.copyFormat) === 'original';
      toaster.progress('siat-clipboard', 'Copying image…', wantOriginal ? 'reading the original file' : 'encoding PNG', null, [
        { label: 'Cancel', variant: 'ghost', onClick: () => controller.abort() },
      ]);
      try {
        const result = await withAcquired(
          target,
          async (acquired) => {
            if (wantOriginal) {
              const bytes = acquired.bytes && acquired.bytes.length ? acquired.bytes : (await getOriginalBytes(acquired, { gm, settings, timeout: 30000 })) || null;
              if (bytes && bytes.bytes && bytes.bytes.length) {
                const mime = bytes.mime || acquired.mimeHint || 'image/png';
                return { blob: blobFromBytes(bytes.bytes, mime), mime, source: 'original' };
              }
            }
            // PNG is the only image type browsers reliably accept on a clipboard,
            // and canvas.toBlob is the only encoder available to a userscript.
            const blob = await encodeNative(canvasFor(acquired), 'image/png');
            return { blob, mime: 'image/png', source: 'png' };
          },
          { signal: controller.signal, settings },
        );

        const copied = await copyImageToClipboard({
          blob: result.blob,
          mime: result.mime,
          win,
          doc,
          toPng: async (blob) => encodeNative(drawToCanvas(await loadImageFromBlob(blob)).canvas, 'image/png'),
        });
        if (copied.ok) {
          toaster.success('siat-clipboard', 'Copied to the clipboard', copied.message, [copied.converted ? 'The browser accepts PNG only, so the image was re-encoded.' : `Source: ${result.source === 'original' ? 'the original file bytes' : 'a PNG render'}.`], null, 7000);
        } else {
          toaster.error('siat-clipboard', 'Could not copy the image', copied.message, [], null, 12000);
        }
        return copied;
      } catch (err) {
        const message = messageOf(err);
        toaster.error('siat-clipboard', 'Could not copy the image', message, [], null, 12000);
        return { ok: false, reason: (err && err.code) || 'failed', message };
      }
    }

    /** A canvas holding the acquired pixels; throws when there are none to read. */
    function canvasFor(acquired) {
      if (acquired.canvas) return acquired.canvas;
      if (acquired.image && (acquired.image.naturalWidth || acquired.image.width)) {
        return drawToCanvas(acquired.image).canvas;
      }
      throw new ConversionError('no-pixels', 'This image has no readable pixels to work with.');
    }

    /** Decode bytes already in memory, through the tracked object-URL helpers. */
    async function loadImageFromBlob(blob) {
      const url = objectUrlFor(blob);
      try {
        return await loadImage(url, { timeout: 20000 });
      } finally {
        revokeLater(url, 1000);
      }
    }

    /* ---------------- metadata inspector ---------------- */

    function inspectTarget(target) {
      ensureSettings().then(() => inspector.open(target));
    }

    /* ---------------- format comparison ---------------- */

    function compareTarget(target) {
      ensureSettings().then(() => compareDialog.open(target));
    }

    async function runComparison(target, { signal, onProgress }) {
      const settings = resolveSettings();
      const wanted = (settings.compareFormats && settings.compareFormats.length ? settings.compareFormats : comparableFormats(settings)).filter((id) => getFormat(id) && id !== 'original');
      const ids = wanted.length ? wanted.slice(0, 6) : ['png', 'jpg', 'webp'];
      return withAcquired(
        target,
        (acquired) =>
          compareFormats({
            formatIds: ids,
            signal,
            onProgress,
            convert: (formatId) =>
              produceOutput(target, formatId, {
                settings,
                signal,
                preacquired: acquired,
                onProgress,
                naming: { index: undefined },
              }),
          }),
        { signal, settings },
      );
    }

    /* ---------------- transform ---------------- */

    function transformTarget(target) {
      ensureSettings().then(() => transformDialog.open(target));
    }

    async function loadTransformPreview(target) {
      const settings = resolveSettings();
      const acquired = await acquireImage(target, { settings, gm, timeout: 45000 });
      const drawable = acquired.image || acquired.canvas;
      if (!drawable) {
        acquired.release();
        throw new ConversionError('no-pixels', 'This image has no readable pixels to transform.');
      }
      return {
        drawable,
        width: acquired.width || drawable.naturalWidth || drawable.width || 0,
        height: acquired.height || drawable.naturalHeight || drawable.height || 0,
        release() {
          try {
            if (acquired.objectUrl) revokeLater(acquired.objectUrl, 1000);
            acquired.release();
          } catch {
            /* noop */
          }
        },
      };
    }

    /* ---------------- page inventory and picker ---------------- */

    function scanPage(overrides = {}) {
      const settings = getSettings();
      return scanImages(doc, {
        includeBackgrounds: settings.scanBackgrounds !== false,
        maxStyleScan: Number(settings.scanElementCap) || 2500,
        maxEntries: 1000,
        ...overrides,
      });
    }

    function openPicker() {
      ensureSettings().then(() => picker.open());
    }

    /** Turn one inventory entry back into a conversion target. */
    function targetForEntry(entry) {
      if (!entry) return null;
      if (entry.element && entry.element.isConnected !== false) {
        const settings = getSettings();
        const resolved = resolveImageTarget(entry.element, { enableBackgroundImages: settings.enableBackgroundImages });
        if (resolved) return resolved;
      }
      if (entry.url) {
        return {
          kind: entry.kind === 'background' ? 'background' : 'img',
          element: entry.element || null,
          url: entry.url,
          altText: entry.alt || '',
          naturalWidth: entry.natural ? entry.natural.width : 0,
          naturalHeight: entry.natural ? entry.natural.height : 0,
        };
      }
      return null;
    }

    /**
     * Build the batch plan shown in the confirmation dialog.
     *
     * Pure computation over a scan: no downloads, no DOM changes, and every
     * skipped image is counted with a reason rather than disappearing.
     */
    function planBatch(runOptions = {}) {
      const settings = resolveSettings();
      // A picker-driven run already chose its entries: re-scanning would throw the
      // selection away and walk the DOM a second time for nothing.
      const scan =
        Array.isArray(runOptions.entries) && runOptions.entries.length ? { entries: runOptions.entries, notes: [] } : scanPage();
      const list = scan.entries.slice();
      const found = list.length;

      let skippedTiny = 0;
      let skippedNotLoaded = 0;
      let skippedBroken = 0;
      let skippedTooSmall = 0;
      const eligible = [];
      for (const entry of list) {
        if (entry.state === 'broken' || entry.state === 'empty') {
          skippedBroken += 1;
          continue;
        }
        if (runOptions.skipTiny !== false && entry.tiny) {
          skippedTiny += 1;
          continue;
        }
        if ((Number(runOptions.minWidth) || 0) > 0 || (Number(runOptions.minHeight) || 0) > 0) {
          const width = entry.natural.width || entry.displayed.width || 0;
          const height = entry.natural.height || entry.displayed.height || 0;
          if (width && height && (width < (Number(runOptions.minWidth) || 0) || height < (Number(runOptions.minHeight) || 0))) {
            skippedTooSmall += 1;
            continue;
          }
        }
        if (entry.state !== 'loaded') {
          if (runOptions.includeNotLoaded && entry.lazyUrl) {
            eligible.push(entry);
            continue;
          }
          skippedNotLoaded += 1;
          continue;
        }
        eligible.push(entry);
      }

      let skippedDuplicate = 0;
      let chosen = eligible;
      if (runOptions.dedupe !== false) {
        const before = eligible.length;
        chosen = dedupeEntries(eligible);
        skippedDuplicate = before - chosen.length;
      }

      const limit = Math.max(1, Math.min(2000, Number(settings.batchMaxImages) || 200));
      const skippedLimit = Math.max(0, chosen.length - limit);
      const items = chosen.slice(0, limit);

      const formatIds = formatListFor(runOptions, settings);
      const summary = summarizeInventory(items);
      const notes = scan.notes.slice();
      if (skippedNotLoaded) {
        notes.push(
          `${skippedNotLoaded} image${skippedNotLoaded === 1 ? '' : 's'} were skipped because the page has not loaded ${skippedNotLoaded === 1 ? 'it' : 'them'} yet. ` +
            'Tick "Also download images the page has not loaded yet" to include them (that costs bandwidth).',
        );
      }
      if (skippedBroken) notes.push(`${skippedBroken} image${skippedBroken === 1 ? '' : 's'} could not be loaded by the page at all and were skipped.`);
      if (skippedTiny) notes.push(`${skippedTiny} icon-sized image${skippedTiny === 1 ? '' : 's'} were skipped.`);
      if (skippedDuplicate) notes.push(`${skippedDuplicate} duplicate URL${skippedDuplicate === 1 ? '' : 's'} were merged into one output.`);
      if (skippedTooSmall) notes.push(`${skippedTooSmall} image${skippedTooSmall === 1 ? '' : 's'} were below the minimum size.`);
      if (skippedLimit) notes.push(`Only the first ${limit} images are converted per run (Settings → Batch); ${skippedLimit} were left out.`);
      if (summary.crossOrigin) {
        notes.push(
          settings.allowCrossOriginFetch
            ? `${summary.crossOrigin} image${summary.crossOrigin === 1 ? '' : 's'} come from another origin and will be fetched through your userscript manager.`
            : `${summary.crossOrigin} cross-origin image${summary.crossOrigin === 1 ? '' : 's'} may fail: cross-origin fetching is off in your settings.`,
        );
      }
      if (runOptions.destination === 'zip') {
        notes.push('Everything is buffered in memory to build one archive; if it grows past your limit the rest are saved as separate files.');
      }

      return {
        found,
        eligible: items.length,
        files: items.length * formatIds.length,
        skippedTiny,
        skippedNotLoaded,
        skippedBroken,
        skippedDuplicate,
        skippedTooSmall,
        skippedLimit,
        crossOrigin: summary.crossOrigin,
        destination: runOptions.destination === 'zip' ? 'zip' : 'files',
        concurrency: Math.max(1, Math.min(4, Number(settings.batchConcurrency) || 2)),
        formatIds,
        entries: items,
        estimateLabel: `${items.length * formatIds.length} file${items.length * formatIds.length === 1 ? '' : 's'} at ${Math.max(1, Math.min(4, Number(settings.batchConcurrency) || 2))} at a time`,
        notes,
        megapixels: summary.megapixels,
      };
    }

    function formatListFor(runOptions, settings) {
      const primary = runOptions.formatId && getFormat(runOptions.formatId) ? runOptions.formatId : settings.presetFormatId || (settings.formats || [])[0] || 'png';
      const extras = Array.isArray(runOptions.extraFormats) ? runOptions.extraFormats.filter((id) => getFormat(id) && id !== primary) : [];
      return [primary].concat(extras).slice(0, 6);
    }

    function openBatchDialog() {
      if (state.batch) {
        toaster.error('siat-busy', 'A batch run is already in progress', 'Cancel it from the progress bar first.');
        return;
      }
      ensureSettings().then(() => batchDialog.open());
    }

    /**
     * Run a batch.
     *
     * @param {object} runOptions same shape as the dialog's options, plus `entries`
     *        when the run comes from a picker selection instead of the whole page.
     */
    async function startBatch(runOptions = {}) {
      await ensureSettings();
      const settings = resolveSettings();
      if (state.batch) {
        toaster.error('siat-busy', 'A batch run is already in progress', 'Cancel it from the progress bar first.');
        return null;
      }
      if (state.job) {
        toaster.error('siat-busy', 'A conversion is already running', 'Wait for it to finish, then start the batch.');
        return null;
      }

      const plan = runOptions.plan || planBatch(runOptions);
      const entries = Array.isArray(runOptions.entries) && runOptions.entries.length ? runOptions.entries : plan.entries;
      if (!entries.length) {
        toaster.error(BATCH_TOAST_ID, 'Nothing to convert', (plan.notes && plan.notes[0]) || 'No image on this page matched the filters.', [], null, 10000);
        return null;
      }

      const formatIds = runOptions.formatIds || plan.formatIds || ['png'];
      const destination =
        runOptions.destination === 'zip' || (runOptions.destination === undefined && settings.presetDestination === 'zip') ? 'zip' : 'files';
      const controller = makeController();
      const taken = new Set();
      // One mutable record for the run: the queue workers, the archive check and
      // the summary all read the same object, so nothing can disagree about state.
      const runState = { archive: [], zipOverflow: false, index: 0 };
      const zipLimitBytes = Math.max(1, Number(settings.zipMaxMB) || 512) * 1024 * 1024;
      const showBar = settings.showJobBar !== false;
      state.runCounter += 1;
      const runId = state.runCounter;
      // Kept so "Retry the failed ones" replays the same run: by then the queue is
      // destroyed, and a fresh plan would silently lose the chosen formats.
      state.lastBatchOptions = {
        formatIds,
        destination,
        includeNotLoaded: Boolean(runOptions.includeNotLoaded),
        skipTiny: runOptions.skipTiny,
        dedupe: runOptions.dedupe,
        minWidth: Number(runOptions.minWidth) || 0,
        minHeight: Number(runOptions.minHeight) || 0,
      };

      const entriesById = new Map();
      const queue = createJobQueue({
        concurrency: plan.concurrency,
        itemTimeoutMs: 120000,
        // A save can reach the disk even when the manager reports failure, so
        // nothing is repeated automatically; the user retries explicitly.
        autoRetries: 0,
        label: destination === 'zip' ? 'Building archive' : 'Batch conversion',
        onEvent: (event) => {
          if (runId !== state.runCounter) return;
          if (event.type === 'item-start' || event.type === 'item-end') {
            const stats = queue.stats();
            toaster.progress(BATCH_TOAST_ID, destination === 'zip' ? 'Building ZIP archive…' : 'Converting images…', `${stats.done + stats.failed + stats.skipped}/${stats.total} finished · ${stats.running} running`, [], [{ label: 'Cancel', variant: 'ghost', onClick: () => cancelBatch() }]);
          }
          if (!showBar) return;
          if (event.type === 'item-end' || event.type === 'finished' || event.type === 'cancelled') {
            jobbar.update(queue.stats(), queue.items());
          }
        },
        run: (item, helpers) =>
          runBatchItem(item, {
            helpers,
            settings,
            formatIds,
            destination,
            taken,
            runState,
            zipLimitBytes,
            controller,
            runId,
            nextIndex: () => (runState.index += 1),
          }),
      });

      const items = entries.map((entry) => {
        const id = `entry:${entry.id}`;
        const label = entryLabel(entry);
        entriesById.set(id, entry);
        const target = targetForEntry(entry);
        if (!target) return { id, label, skipReason: 'The image is no longer on the page.' };
        if (entry.state !== 'loaded' && !runOptions.includeNotLoaded) {
          return { id, label, skipReason: 'Not loaded by the page yet — tick "Also download images the page has not loaded yet".' };
        }
        return { id, label, payload: { entry, target } };
      });

      state.batch = { queue, controller, destination, runId, startedAt: Date.now() };
      if (showBar) jobbar.show(destination === 'zip' ? 'Building ZIP archive' : 'Batch conversion');
      queue.add(items);
      queue.start();

      // The queue pumps asynchronously; wait for it to settle so the caller (and
      // the summary toast) sees the final state.
      await waitForQueue(queue, controller, entriesById);

      const stats = queue.stats();
      let archiveResult = null;
      if (destination === 'zip' && runState.archive.length) {
        archiveResult = await finishArchive({ archive: runState.archive, settings, taken });
      } else if (destination === 'zip' && runState.zipOverflow) {
        toaster.progress(BATCH_TOAST_ID, 'Archive limit reached', 'Files were saved individually instead.', [], null, 9000);
      }

      const summary = summariseBatch(stats, archiveResult, { zipOverflow: runState.zipOverflow, destination, queue });
      toaster.success(BATCH_TOAST_ID, summary.title, summary.detail, summary.notes, summary.actions, null, 16000);
      if (showBar) jobbar.finish(`${summary.title} — ${summary.detail}`, { failed: stats.failed });

      state.batch = null;
      queue.destroy();
      return { stats, archiveResult, summary };
    }

    function entryLabel(entry) {
      const fromUrl = String(entry.url || '').split('/').pop().split('?')[0];
      const text = fromUrl || entry.alt || `${entry.kind} image`;
      return text.length > 48 ? `…${text.slice(-47)}` : text;
    }

    async function runBatchItem(item, context) {
      const { helpers, settings, formatIds, destination, taken, runState, zipLimitBytes, controller, runId } = context;
      if (runId !== state.runCounter) throw new CancelledError('This run was replaced.');
      const payload = item.payload || {};
      const target = payload.target;
      if (!target) {
        const error = new ConversionError('no-target', 'The image is no longer on the page.');
        error.retryable = false;
        throw error;
      }

      const signal = helpers.signal;
      if (controller && controller.signal.aborted) throw new CancelledError();

      const written = [];
      const failures = [];
      let bytesTotal = 0;
      // Set only by a save whose outcome the manager could not confirm.
      let uncertain = false;

      await withAcquired(
        target,
        async (acquired) => {
          for (const formatId of formatIds) {
            if (signal && signal.aborted) throw new CancelledError();
            const index = context.nextIndex();
            try {
              const produced = await produceOutput(target, formatId, {
                settings,
                signal,
                preacquired: acquired,
                index,
                taken,
                timeout: 90000,
              });
              taken.add(produced.filename);
              bytesTotal += produced.blob.size;
              if (destination === 'zip') {
                const bytes = new Uint8Array(await produced.blob.arrayBuffer());
                if (runState.zipOverflow) {
                  // Past the in-memory limit: keep working, but write to disk
                  // instead of growing the buffer without bound.
                  await saveSingle(produced, settings);
                  written.push(`${produced.filename} (saved separately)`);
                } else {
                  runState.archive.push({ name: produced.path || produced.filename, bytes });
                  written.push(produced.filename);
                }
              } else {
                await saveSingle(produced, settings);
                written.push(produced.filename);
              }
            } catch (err) {
              if (err instanceof CancelledError || (err && err.code === 'aborted')) throw err;
              if (err && err.uncertain) uncertain = true;
              failures.push(`${getFormat(formatId) ? getFormat(formatId).label : formatId}: ${messageOf(err)}`);
            }
          }
        },
        { signal, settings },
      ).catch((err) => {
        failures.push(messageOf(err));
        if (err instanceof CancelledError || (err && err.code === 'aborted')) throw err;
      });

      // Archive growth is measured once per item, in one place, so the switch to
      // "save the rest individually" cannot flip back and forth mid-run.
      if (destination === 'zip' && !runState.zipOverflow) {
        const projected = estimateZipSize(runState.archive);
        if (projected > zipLimitBytes + ZIP_FALLBACK_GRACE_BYTES) runState.zipOverflow = true;
      }

      if (!written.length) {
        const error = new ConversionError('batch-item-failed', failures.join(' ') || 'Nothing could be produced from this image.');
        error.uncertain = uncertain;
        error.retryable = !uncertain;
        throw error;
      }
      if (failures.length) {
        // Partial success is reported as a failure with the detail attached, so
        // the user sees both what landed and what did not.
        const error = new ConversionError('batch-partial', `${written.length} of ${formatIds.length} outputs written. Failures: ${failures.join(' ')}`);
        error.uncertain = uncertain;
        error.retryable = false;
        throw error;
      }
      return { files: written, bytes: bytesTotal };
    }

    async function saveSingle(produced, settings) {
      const saved = await saveBlob({
        blob: produced.blob,
        filename: produced.filename,
        path: produced.path,
        settings,
        gm,
        downloadMode: gm.downloadMode,
      });
      if (!saved.ok) {
        const error = new ConversionError('save-failed', saved.message || 'The file could not be saved.', { fallbackReason: saved.fallbackReason });
        // `uncertain` comes from the download layer: it knows whether the manager
        // gave a definite refusal (nothing written, safe to retry) or an outcome
        // it could not confirm (the file may be on disk, so never repeat silently).
        error.uncertain = Boolean(saved.uncertain);
        error.retryable = !error.uncertain;
        throw error;
      }
      return saved;
    }

    async function finishArchive({ archive, settings, taken }) {
      const name = uniqueFilename(archiveName(), taken);
      let archiveBuilt = false;
      try {
        const built = encodeZip(archive, { comment: `Created by Save Image as Type ${SCRIPT_VERSION_REPORTED}` });
        const blob = blobFromBytes(built.bytes, 'application/zip');
        const named = buildFilename({
          base: name.replace(/\.zip$/i, ''),
          ext: 'zip',
          prefix: settings.filenamePrefix,
          subfolder: settings.subfolder,
          maxLength: settings.maxFilenameLength,
          includeSubfolder: settings.subfolder ? gm.downloadMode === 'browser' : false,
        });
        archiveBuilt = true;
        const saved = await saveBlob({ blob, filename: named.filename, path: named.path, settings, gm, downloadMode: gm.downloadMode });
        return {
          ok: saved.ok,
          filename: named.filename,
          entries: built.entries.length,
          bytes: built.bytes.length,
          notes: built.notes.concat(saved.ok ? [saved.message] : [saved.message || 'The archive could not be saved.']),
          via: saved.via,
        };
      } catch (err) {
        if (archiveBuilt) {
          return { ok: false, filename: name, entries: archive.length, bytes: 0, notes: [`Archive save was not confirmed (${messageOf(err)}). Check downloads before saving again; no outputs were replayed.`], uncertain: true };
        }
        // Fall back to writing the buffered files individually: the work is done,
        // only the container failed, and throwing it away would be worse.
        const notes = [`Building the archive failed (${messageOf(err)}); the files were saved individually instead.`];
        let savedCount = 0;
        for (const entry of archive) {
          try {
            const blob = blobFromBytes(entry.bytes, mimeFromUrl(entry.name) || 'application/octet-stream');
            const filename = uniqueFilename(String(entry.name).split('/').pop(), taken);
            taken.add(filename);
            const saved = await saveBlob({ blob, filename, path: filename, settings, gm, downloadMode: gm.downloadMode });
            if (saved.ok) savedCount += 1;
          } catch {
            /* reported in the summary count */
          }
        }
        notes.push(`${savedCount} of ${archive.length} files were saved individually.`);
        return { ok: savedCount > 0, filename: '', entries: archive.length, bytes: 0, notes, via: 'fallback-files', failed: true };
      }
    }

    function archiveName() {
      const host = pageHost() || 'page';
      const stamp = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return `${host}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.zip`;
    }

    function summariseBatch(stats, archiveResult, { zipOverflow, destination, queue }) {
      const notes = [];
      if (archiveResult) {
        for (const note of archiveResult.notes || []) notes.push(note);
        if (archiveResult.ok && archiveResult.filename) {
          notes.push(`${archiveResult.entries} file${archiveResult.entries === 1 ? '' : 's'} in ${archiveResult.filename} (${(archiveResult.bytes / 1048576).toFixed(1)} MB).`);
        }
      }
      if (zipOverflow) notes.push('The archive size limit was reached, so later images were saved as separate files.');
      if (stats.uncertain) {
        notes.push(
          `${stats.uncertain} save${stats.uncertain === 1 ? '' : 's'} ended with an unknown result. Check your downloads folder before retrying — retrying blindly could create duplicates.`,
        );
      }
      if (stats.failed) {
        const firstFailures = [];
        for (const item of queue ? queue.items() : []) {
          if (item.state === ITEM_STATES.FAILED && firstFailures.length < 3) firstFailures.push(`${item.label}: ${item.error || item.errorCode}`);
        }
        notes.push(...firstFailures);
      }
      if (stats.skipped) notes.push(`${stats.skipped} image${stats.skipped === 1 ? '' : 's'} were skipped without being attempted.`);
      if (stats.cancelled) notes.push(`${stats.cancelled} queued image${stats.cancelled === 1 ? '' : 's'} were cancelled before they started.`);

      const savedCount = archiveResult && archiveResult.ok ? archiveResult.entries : stats.done;
      const title =
        stats.cancelled > 0 && stats.done === 0
          ? 'Batch cancelled'
          : destination === 'zip' && archiveResult && archiveResult.ok
            ? `Saved ${archiveResult.filename}`
            : destination === 'zip' && archiveResult && !archiveResult.ok
              ? 'Archive save was not confirmed'
              : `${savedCount} file${savedCount === 1 ? '' : 's'} saved`;
      const detail = [
        `${stats.done}/${stats.total} images converted`,
        stats.failed ? `${stats.failed} failed` : '',
        stats.skipped ? `${stats.skipped} skipped` : '',
        stats.bytes ? `${(stats.bytes / 1048576).toFixed(1)} MB` : '',
        `${Math.round(stats.durationMs / 1000)}s`,
      ]
        .filter(Boolean)
        .join(' · ');

      const actions = [];
      if (stats.failed) {
        actions.push({
          label: 'Retry the failed ones',
          variant: 'ghost',
          onClick: () => retryFailedBatch(),
        });
      }
      return { title, detail, notes: notes.slice(0, 8), actions };
    }

    /**
     * Re-run only the images that failed.
     *
     * The previous run's queue is gone by the time the toast action is pressed, so
     * the failed entries are collected before the queue is destroyed and replayed
     * as a new run — which is still safe, because a file that saved successfully is
     * never in that list.
     */
    let lastFailedEntries = [];
    function retryFailedBatch() {
      if (!lastFailedEntries.length) {
        toaster.error(BATCH_TOAST_ID, 'Nothing to retry', 'No safely retryable items remain. Partial or unconfirmed saves are not replayed: check your downloads and select only the missing outputs manually.', [], null, 8000);
        return;
      }
      const entries = lastFailedEntries.slice();
      lastFailedEntries = [];
      // Replay with the original run's options: same formats, same destination.
      // Only entries that failed are included, so a file that already saved is
      // never written a second time.
      startBatch(Object.assign({}, state.lastBatchOptions || {}, { entries, retry: true }));
    }

    function waitForQueue(queue, controller, entriesById) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          unsubscribe();
          clearTimeout(timer);
          // Collect the failures before the caller destroys the queue: item
          // snapshots carry no payload, so the entry lookup happens here.
          const byId = entriesById instanceof Map ? entriesById : new Map();
          lastFailedEntries = queue
            .items()
            .filter((item) => item.state === ITEM_STATES.FAILED && item.retryable && !item.uncertain)
            .map((item) => byId.get(item.id))
            .filter(Boolean);
          resolve();
        };
        const unsubscribe = queue.subscribe((event) => {
          if (event.type === 'finished' || event.type === 'cancelled') {
            // Give in-flight items a moment to record their final state.
            setTimeout(finish, 60);
          }
        });
        // Absolute ceiling: a wedged encoder must not keep the summary pending
        // forever. Cleared as soon as the run settles.
        const timer = setTimeout(finish, 30 * 60 * 1000);
        if (controller && controller.signal && typeof controller.signal.addEventListener === 'function') {
          controller.signal.addEventListener('abort', guardUserEvent(() => setTimeout(finish, 200)), { once: true });
        }
        if (queue.stats().complete) finish();
      });
    }

    function cancelBatch() {
      if (!state.batch) return false;
      try {
        state.batch.controller.abort();
      } catch {
        /* noop */
      }
      state.batch.queue.cancel();
      jobbar.update(state.batch.queue.stats(), state.batch.queue.items());
      return true;
    }

    /* ---------------- target bookkeeping ---------------- */

    let rememberedTarget = null;
    function lastTarget() {
      return rememberedTarget && rememberedTarget.element && rememberedTarget.element.isConnected !== false ? rememberedTarget : null;
    }

    /* ---------------- UI wiring ---------------- */

    const panel = createSettingsPanel({
      document: doc,
      getSettings: () => store.get(),
      gm: () => gm,
      diagnostics,
      capabilityReport,
      settingsWarnings: () => store.info().warnings || [],
      saveSettings: async (patch) => {
        const result = await store.save(patch);
        applySettingsSideEffects(store.get());
        return result;
      },
      resetSettings: async () => {
        const result = await store.reset();
        applySettingsSideEffects(result.settings);
        return result.settings;
      },
    });

    const menu = createContextMenu({
      document: doc,
      getSettings,
      getMenuFormats,
      getMenuActions,
      isBusy: () => Boolean(state.job) || Boolean(state.batch),
      onCancel: () => (state.batch ? cancelBatch() : cancelJob()),
      onOpenSettings: () => {
        ensureSettings().then(() => panel.open());
      },
      onPick: (formatId, target) => {
        rememberedTarget = target;
        runConversion(target, formatId);
      },
      onAction: (actionId, target) => {
        rememberedTarget = target;
        onMenuAction(actionId, target);
      },
    });

    const jobbar = createJobBar({
      document: doc,
      onCancel: () => cancelBatch(),
      onRetry: () => {
        if (state.batch) {
          toaster.error('siat-retry-wait', 'Wait for this batch to finish', 'Retry is available after the run settles; partial and unconfirmed saves are never replayed.');
        } else retryFailedBatch();
      },
      onClose: () => jobbar.hide(),
    });

    const picker = createImagePicker({
      document: doc,
      settings: () => resolveSettings(),
      formats: getMenuFormats,
      scan: (overrides) => scanPage(overrides),
      thumbnail: (entry) =>
        createThumbnail(entry, {
          size: 88,
          createCanvas,
          // Both are local: an inline <svg> is serialised to a blob URL, never fetched.
          svgToObjectUrl: svgElementToObjectUrl,
          loadImage,
        }),
      actions: {
        convert: ({ entries, formatId, destination }) => {
          // The user ticked these rows, so a deferred image is fetched on purpose.
          startBatch({ entries, formatId, extraFormats: [], destination, includeNotLoaded: true, fromPicker: true });
        },
        copy: (entry) => {
          const target = targetForEntry(entry);
          if (target) copyImage(target);
        },
        inspect: (entry) => {
          const target = targetForEntry(entry);
          if (target) inspectTarget(target);
        },
        transform: (entry) => {
          const target = targetForEntry(entry);
          if (target) transformTarget(target);
        },
        compare: (entry) => {
          const target = targetForEntry(entry);
          if (target) compareTarget(target);
        },
        loadNotLoaded: async (entries) => {
          const targets = entries.filter((entry) => entry.lazyUrl && entry.element);
          for (const entry of targets.slice(0, 40)) {
            // Explicit user action: the page fetches an image it had deferred.
            try {
              entry.element.loading = 'eager';
              entry.element.src = entry.lazyUrl;
            } catch {
              /* a page that blocks this simply stays unloaded */
            }
          }
          await waitForImages(targets.slice(0, 40), 8000);
          return targets.length;
        },
      },
    });

    function waitForImages(entries, timeoutMs) {
      return new Promise((resolve) => {
        const pending = entries.filter((entry) => entry.element && entry.element.tagName === 'IMG');
        if (!pending.length) {
          resolve();
          return;
        }
        let remaining = pending.length;
        let settled = false;
        const timer = setTimeout(done, timeoutMs);
        function done() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        }
        for (const entry of pending) {
          const image = entry.element;
          let counted = false;
          const settle = () => {
            if (counted) return;
            counted = true;
            remaining -= 1;
            image.removeEventListener('load', guardUserEvent(settle));
            image.removeEventListener('error', guardUserEvent(settle));
            if (remaining <= 0) done();
          };
          image.addEventListener('load', guardUserEvent(settle));
          image.addEventListener('error', guardUserEvent(settle));
          if (image.complete) settle();
        }
      });
    }

    const transformDialog = createTransformDialog({
      document: doc,
      settings: () => resolveSettings(),
      formats: getMenuFormats,
      createCanvas,
      loadPreview: loadTransformPreview,
      onSubmit: async ({ target, transform, formatId, makeDefault }) => {
        rememberedTarget = target;
        if (makeDefault) {
          const result = await store.save({ defaultTransform: transform });
          toaster.progress(
            'siat-transform',
            result && result.ok ? 'Transform saved as your default' : 'Transform applies to this save only',
            result && result.ok ? 'Every conversion now starts from it; clear it in Settings → Batch and transforms.' : 'Your settings could not be written, so it was not stored.',
            null,
            null,
          );
          setTimeout(() => toaster.dismiss('siat-transform'), 6000);
        }
        runConversion(target, formatId, { transform });
      },
    });

    const compareDialog = createCompareDialog({
      document: doc,
      compare: (target, helpers) => runComparison(target, helpers),
      onSave: (target, formatId) => {
        rememberedTarget = target;
        runConversion(target, formatId);
      },
    });

    const inspector = createMetadataInspector({
      document: doc,
      settings: () => resolveSettings(),
      loadBytes: (target) =>
        readBytesFor(target).then((file) => {
          if (!file) throw new ConversionError('no-original-bytes', 'This image has no original file to inspect (it may be generated in the page).');
          return file;
        }),
      onSave: (target, saveOptions) => {
        rememberedTarget = target;
        runConversion(target, 'original', { stripMetadata: Boolean(saveOptions && saveOptions.stripMetadata) });
      },
    });

    const shortcutHelp = createShortcutHelp({
      document: doc,
      settings: () => store.get(),
      onOpenSettings: () => panel.open(),
    });

    const batchDialog = createBatchDialog({
      document: doc,
      settings: () => resolveSettings(),
      formats: getMenuFormats,
      plan: (runOptions) => planBatch(runOptions),
      onStart: (runOptions) => {
        startBatch(runOptions);
      },
      onOpenPicker: () => picker.open(),
    });

    function applySettingsSideEffects(settings) {
      if (state.disposed) return;
      if (settings.interceptContextMenu && !state.paused) menu.attach();
      else menu.detach();
    }

    /* ---------------- keyboard shortcuts ---------------- */

    function onGlobalKeydown(event) {
      const settings = getSettings();
      if (settings.enableShortcuts === false) return;
      if (event.defaultPrevented) return;
      const checked = checkedShortcuts(settings);
      if (isTypingTarget(event.target) && !event.ctrlKey && !event.altKey && !event.metaKey) return;
      for (const action of SHORTCUT_ACTIONS) {
        const binding = checked.shortcuts[action.id];
        if (!binding) continue;
        if (!matchesBinding(event, binding)) continue;
        event.preventDefault();
        event.stopPropagation();
        handleShortcut(action.id);
        return;
      }
    }

    function handleShortcut(actionId) {
      switch (actionId) {
        case 'quickSave': {
          const target = menu.hoveredTarget() || lastTarget();
          if (!target) {
            noTargetToast('Point the mouse at an image first, then press the shortcut again.');
            return;
          }
          const settings = resolveSettings();
          rememberedTarget = target;
          runConversion(target, settings.presetFormatId || state.lastFormat || (settings.formats || [])[0] || 'png');
          break;
        }
        case 'copyImage': {
          const target = menu.hoveredTarget() || lastTarget();
          if (!target) {
            noTargetToast('Point the mouse at an image first, then press the shortcut again.');
            return;
          }
          rememberedTarget = target;
          copyImage(target);
          break;
        }
        case 'openPicker':
          openPicker();
          break;
        case 'saveAll':
          openBatchDialog();
          break;
        case 'cancelJob':
          if (!cancelBatch() && !cancelJob()) {
            toaster.progress('siat-cancel', 'Nothing is running', 'There is no conversion or batch to cancel.', null, null);
            setTimeout(() => toaster.dismiss('siat-cancel'), 4000);
          }
          break;
        default:
          break;
      }
    }

    function noTargetToast(detail) {
      toaster.error('siat-no-target', 'No image to act on', detail, [], null, 8000);
    }

    /**
     * Validated bindings, recomputed only when the stored settings object changes:
     * validating on every keypress would allocate a fresh binding map per key.
     */
    function checkedShortcuts(settings) {
      if (state.shortcutCache && state.shortcutCache.source === settings.shortcuts) return state.shortcutCache.checked;
      const checked = validateShortcuts(settings.shortcuts || {});
      state.shortcutCache = { source: settings.shortcuts, checked };
      return checked;
    }

    function attachShortcuts() {
      const handler = onGlobalKeydown;
      doc.addEventListener('keydown', guardUserEvent(handler), true);
      disposers.push(() => doc.removeEventListener('keydown', guardUserEvent(handler), true));
    }

    /* ---------------- manager menu commands ---------------- */

    gm.registerMenuCommand('Save Image as Type — Settings…', () => {
      ensureSettings().then(() => panel.open());
    });
    gm.registerMenuCommand('Save Image as Type — Convert the last image I pointed at…', () => {
      ensureSettings().then(() => {
        if (!menu.openForLastHovered()) {
          toaster.error('siat-no-target', 'No image to convert yet', 'Point at an image on the page first, then use this command (or right-click the image).');
        }
      });
    });
    gm.registerMenuCommand('Save Image as Type — Browse page images…', () => {
      ensureSettings().then(() => picker.open());
    });
    gm.registerMenuCommand('Save Image as Type — Convert every image on this page…', () => {
      ensureSettings().then(() => openBatchDialog());
    });
    gm.registerMenuCommand('Save Image as Type — Copy the last image I pointed at', () => {
      ensureSettings().then(() => {
        const target = menu.hoveredTarget();
        if (!target) {
          noTargetToast('Point at an image on the page first, then run this command.');
          return;
        }
        rememberedTarget = target;
        copyImage(target);
      });
    });
    gm.registerMenuCommand('Save Image as Type — Keyboard shortcut help', () => {
      ensureSettings().then(() => shortcutHelp.open());
    });
    gm.registerMenuCommand('Save Image as Type — Capability report', () => {
      ensureSettings()
        .then(ensureCapabilities)
        .then(() => {
          const d = diagnostics();
          const lines = [
            `Encoders: ${Object.keys(d.encoders).map((k) => `${k.split('/')[1]}=${d.encoders[k] ? 'yes' : 'no'}`).join(', ')}`,
            `Frame decoding: ${d.animation.decoderAvailable ? `yes (${d.animation.supportedTypes.join(', ') || 'none probed'})` : `no — ${d.animation.reason || 'unavailable'}`}`,
            `Clipboard images: ${d.clipboard.supported ? 'yes' : `no — ${d.clipboard.reasons[0] || 'unavailable'}`}`,
            describeDownloadCapability(gm, d.downloadMode),
            `Settings storage: ${d.storage === 'gm' ? 'userscript manager' : 'memory only'}`,
            `Presets: ${(getSettings().presets || []).length} stored${activePresetLabel() ? `, active: ${activePresetLabel()}` : ''}`,
            `Grants: ${Object.keys(d.capabilities).filter((k) => d.capabilities[k]).join(', ') || 'none'}`,
          ];
          if (store.info().warnings && store.info().warnings.length) lines.push(...store.info().warnings);
          toaster.success('siat-report', 'Capability report', capabilityReport(), lines, [{ label: 'Open settings', variant: 'ghost', onClick: () => panel.open() }], 20000);
        });
    });
    gm.registerMenuCommand('Save Image as Type — Pause on this page', () => {
      state.paused = !state.paused;
      if (state.paused) menu.detach();
      else applySettingsSideEffects(getSettings());
      toaster.progress('siat-pause', state.paused ? 'Paused on this page' : 'Resumed on this page', state.paused ? 'Right-click is untouched here until you resume from the manager menu.' : 'Right-click an image to save it again.', null, null);
      setTimeout(() => toaster.dismiss('siat-pause'), 5000);
    });

    /* ---------------- start ---------------- */

    const instance = {
      version: SCRIPT_VERSION_REPORTED,
      gm,
      store,
      menu,
      panel,
      toaster,
      picker,
      jobbar,
      transformDialog,
      compareDialog,
      inspector,
      shortcutHelp,
      batchDialog,
      diagnostics,
      capabilityReport,
      ensureSettings,
      ensureCapabilities,
      runConversion,
      produceOutput,
      copyImage,
      startBatch,
      planBatch,
      cancelBatch,
      cancelJob,
      scanPage,
      resolveSettings,
      resolveTarget: (element) => resolveImageTarget(element, { enableBackgroundImages: getSettings().enableBackgroundImages }),
      get paused() {
        return state.paused;
      },
      get batch() {
        return state.batch ? { stats: state.batch.queue.stats(), items: state.batch.queue.items(), state: state.batch.queue.state } : null;
      },
      get jobState() {
        return state.batch ? state.batch.queue.state : state.job ? JOB_STATES.RUNNING : JOB_STATES.IDLE;
      },
      destroy() {
        state.disposed = true;
        cancelBatch();
        cancelJob();
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            /* noop */
          }
        }
        disposers.length = 0;
        menu.destroy();
        panel.destroy();
        picker.destroy();
        jobbar.destroy();
        transformDialog.destroy();
        compareDialog.destroy();
        inspector.destroy();
        shortcutHelp.destroy();
        batchDialog.destroy();
        toaster.destroy();
        store.dispose();
        revokeAllPending();
        bootstrapInstances.delete(doc);
      },
    };

    // The only thing that must exist before a user can right-click is the
    // listener, so attach it now with defaults and reconcile once settings load.
    menu.attach();
    attachShortcuts();

    store.subscribe((settings, reason) => {
      if (reason === 'remote' || reason === 'save') applySettingsSideEffects(settings);
    });

    ensureSettings().then((settings) => {
      if (state.disposed) return;
      applySettingsSideEffects(settings);
      if (store.info().recovered && store.info().warnings.length) {
        toaster.progress('siat-settings', 'Settings were repaired', store.info().warnings.join(' '), store.info().warnings, [{ label: 'Open settings', variant: 'ghost', onClick: () => panel.open() }], 12000);
      } else if (store.info().migratedFrom !== null && store.info().migratedFrom !== undefined) {
        toaster.progress(
          'siat-settings',
          `Settings updated to version ${settings.schemaVersion}`,
          `Migrated from schema v${store.info().migratedFrom}; nothing was reset.`,
          store.info().warnings,
          [{ label: 'Open settings', variant: 'ghost', onClick: () => panel.open() }],
          10000,
        );
      }
    });

    const idle = win.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    idle(() => {
      if (!state.disposed) ensureCapabilities();
    });

    const onPageHide = () => {
      cancelBatch();
      cancelJob();
      revokeAllPending();
    };
    win.addEventListener('pagehide', guardUserEvent(onPageHide), { once: true });
    disposers.push(() => win.removeEventListener('pagehide', guardUserEvent(onPageHide)));

    // This API is returned only to trusted source-module callers. Production
    // entry discards it; offline verification imports this module explicitly.
    for (const key of Reflect.ownKeys(instance)) {
      Object.defineProperty(api, key, Object.getOwnPropertyDescriptor(instance, key));
    }
    api.ready = true;
    return api;
  } catch (error) {
    bootstrapInstances.delete(doc);
    throw error;
  }
}

/**
 * Replaced with the real version by build.mjs from src/meta.js, so the version
 * shown in diagnostics can never drift from the metadata block. A test asserts
 * that no placeholder survives into the built artifact.
 */
export const SCRIPT_VERSION_REPORTED = '__SIAT_BUILD_VERSION__';

/**
 * Owned startup funnel. Catch the async result, not just synchronous throws.
 * An injected reporter is a trusted verifier dependency; production uses the
 * local console only on startup failure. Host-page errors are never collected.
 */
export async function startProduction(start = bootstrap, report = reportStartupFailure) {
  try {
    return await start();
  } catch (error) {
    try { report(error); } catch { /* a reporter must not reject into the page */ }
    return null;
  }
}
function reportStartupFailure(error) {
  try {
    console.error('[Save Image as Type] failed to start:', error && error.message ? error.message : error);
  } catch { /* console may not exist in a manager sandbox */ }
}
