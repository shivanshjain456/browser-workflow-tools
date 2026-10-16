import { guardUserEvent } from './events.js';
import { configMessage } from '../core/messages.js';
/**
 * Settings dialog.
 *
 * A modal in a shadow root: role="dialog", aria-modal, real form controls with
 * labels, a focus trap, Escape to close and focus returned to whatever had it
 * before. Changes are staged in a draft and only written to storage on Save, so
 * "Cancel" means what it says.
 *
 * The diagnostics section exists because most support questions about this kind
 * of script are really "which of these browser/manager capabilities do I have?"
 * It reports the *probed* facts (manager name and version, GM download mode,
 * which encoders this browser really has, whether animated frames can be
 * decoded, where settings are stored) instead of a static compatibility claim.
 *
 * Everything is built with createElement/textContent; the imported JSON is
 * validated by core/settings.js before any of it reaches a control.
 */

import { FORMATS } from '../core/formats.js';
import { validateImportedSettings, MENU_ACTION_IDS, MENU_ACTION_LABELS } from '../core/settings.js';
import { describeDownloadCapability } from '../core/download.js';
import { TEMPLATE_TOKENS, renderTemplate, validateTemplate } from '../core/template.js';
import { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, validateShortcuts, formatBinding } from '../core/shortcuts.js';
import { PRESET_LIMITS, sanitizeHostPattern, presetSummary } from '../core/presets.js';
import { PROFILE_LIMITS, applyProfile, captureProfile, profileSummary, removeProfile } from '../core/profiles.js';
import { createTranslator, languageFromDocument } from '../core/messages.js';
import { RESIZE_PRESETS } from '../core/transform.js';
import {
  createDialog,
  dialogButton,
  dialogSection,
  dialogCheckboxRow,
  dialogField,
  dialogTextControl,
  dialogSelectControl,
} from './dialog.js';

const PANEL_HOST_ID = 'siat-panel-host';

/**
 * Styles for the configuration-profile section only. Logical properties
 * (`inline-start`, `block-start`) are used so the same rules work in a
 * right-to-left document; direction itself comes from the message catalogue's
 * language, never from the page's text content.
 */
export const PROFILES_STYLE = `
#siat-profiles-section .siat-profile-list { display: flex; flex-direction: column; gap: 4px; margin-block-start: 4px; }
#siat-profiles-section .siat-profile-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding-block: 6px; border-block-start: 1px solid currentColor;
  border-block-start-color: color-mix(in srgb, currentColor 18%, transparent);
}
#siat-profiles-section .siat-profile-row .siat-profile-label { flex: 1 1 14ch; min-inline-size: 14ch; }
#siat-profiles-section .siat-profile-row .siat-profile-actions { display: flex; gap: 6px; margin-inline-start: auto; }
#siat-profiles-section[dir="rtl"] { text-align: start; }
#siat-profiles-section[dir="rtl"] .siat-profile-row .siat-profile-actions { margin-inline-start: initial; margin-inline-end: auto; }
#siat-profiles-section .siat-profile-name-field { flex: 1 1 16ch; min-inline-size: 12ch; }
#siat-profiles-section .siat-profile-new { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
`;


/**
 * @param {object} deps
 * @param {() => object} deps.getSettings
 * @param {(patch:object) => Promise<{ok:boolean, warnings:string[]}>} deps.saveSettings
 * @param {() => Promise<object>} deps.resetSettings
 * @param {() => object} deps.diagnostics   see main.js buildDiagnostics()
 * @param {() => string[]} [deps.settingsWarnings]
 */
export function createSettingsPanel(deps) {
  const doc = deps.document || document;
  let draft = null;
  let fileInput = null;

  // Thin wrappers so the fifty-odd call sites below keep reading the same way,
  // while the implementation lives once in ui/dialog.js.
  const button = (label, variant, handler) => dialogButton(doc, label, variant, handler);

  const dialog = createDialog({
    document: doc,
    hostId: PANEL_HOST_ID,
    marker: 'panel',
    titleId: 'siat-panel-title',
    title: 'Save Image as Type — settings',
    closeLabel: 'Close settings',
    extraStyle: PROFILES_STYLE,
    beforeBuild() {
      draft = Object.assign({}, deps.getSettings());
      draft.formats = (draft.formats || []).slice();
      draft.presets = Array.isArray(draft.presets) ? draft.presets.slice() : [];
      draft.shortcuts = Object.assign({}, draft.shortcuts || {});
      draft.batchFormats = (draft.batchFormats || []).slice();
      draft.compareFormats = (draft.compareFormats || []).slice();
      draft.menuActions = (draft.menuActions || []).slice();
      draft.profiles = Array.isArray(draft.profiles) ? draft.profiles.map((profile) => ({ ...profile, values: profile.values })) : [];
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      body.appendChild(buildFormatsSection());
      body.appendChild(buildFilenameSection());
      body.appendChild(buildQualitySection());
      body.appendChild(buildAnimationSection());
      body.appendChild(buildBatchSection());
      body.appendChild(buildPresetsSection());
      body.appendChild(buildProfilesSection());
      body.appendChild(buildShortcutsSection());
      body.appendChild(buildBehaviourSection());
      body.appendChild(buildPrivacySection());
      body.appendChild(buildDiagnosticsSection());

      const note = doc.createElement('span');
      note.className = 'siat-note';
      note.textContent = 'Changes apply to every tab once saved.';
      foot.appendChild(note);
      const spacer = doc.createElement('span');
      spacer.className = 'siat-spacer';
      foot.appendChild(spacer);
      foot.appendChild(button('Reset defaults', 'ghost', onReset));
      foot.appendChild(button('Export JSON', 'ghost', onExport));
      foot.appendChild(button('Import JSON', 'ghost', onImportClick));
      foot.appendChild(button('Cancel', 'ghost', () => close()));
      foot.appendChild(button('Save', 'primary', onSave));

      fileInput = doc.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      fileInput.addEventListener('change', guardUserEvent(onImportFile));
      context.shadowRoot.appendChild(fileInput);
    },
    afterBuild() {
      const warnings = deps.settingsWarnings ? deps.settingsWarnings() : [];
      showBanner(warnings.length ? 'info' : '', warnings.length ? 'Some stored settings needed attention' : '', warnings);
    },
  });

  // Local bindings on purpose: a bare `close()` inside this module would
  // otherwise resolve to `window.close()` (lint rule no-implicit-page-globals).
  const open = () => dialog.open();
  const close = () => dialog.close();
  const showBanner = (kind, title, lines) => dialog.showBanner(kind, title, lines);

  const section = (legendText, description) => dialogSection(doc, legendText, description);


  const checkboxRow = (spec) => dialogCheckboxRow(doc, spec);
  const field = (spec) => dialogField(doc, spec);
  const textControl = (value, attrs) => dialogTextControl(doc, value, attrs);

  function buildFormatsSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section('Formats in the right-click menu', 'Tick the formats you want offered. Unticked formats stay available in Settings only.');
    const grid = doc.createElement('div');
    grid.className = 'siat-grid';
    for (const format of FORMATS) {
      const unavailable = Boolean(format.requiresEncodeProbe && !diagnostics.encoders[format.mime]);
      grid.appendChild(
        checkboxRow({
          id: `siat-fmt-${format.id}`,
          label: format.id === 'original' ? 'Original file' : format.label,
          hint: unavailable ? `Not available: ${diagnostics.encoderNotes[format.mime] || 'this browser cannot encode it'}` : format.hint,
          checked: draft.formats.includes(format.id),
          unavailable,
          onChange: (checked) => {
            const list = draft.formats.slice();
            const index = list.indexOf(format.id);
            if (checked && index < 0) list.splice(format.alwaysLast ? list.length : index + 1, 0, format.id);
            if (!checked && index >= 0) list.splice(index, 1);
            draft.formats = list;
          },
        }),
      );
    }
    fieldset.appendChild(grid);
    return fieldset;
  }

  function buildFilenameSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section(
      'File names',
      'Names are derived from the image URL, then its alt text, then the page title. Unsafe characters are always removed.',
    );
    const prefix = textControl(draft.filenamePrefix, { maxlength: 60, placeholder: 'e.g. reference' });
    prefix.addEventListener('input', guardUserEvent(() => {
      draft.filenamePrefix = prefix.value;
    }));
    fieldset.appendChild(
      field({ id: 'siat-prefix', label: 'Prefix every file name with', hint: 'Joined with a hyphen. Path separators are removed, so a prefix can never change the folder.', control: prefix }),
    );

    const subfolder = textControl(draft.subfolder, { maxlength: 80, placeholder: 'e.g. images/references' });
    subfolder.addEventListener('input', guardUserEvent(() => {
      draft.subfolder = subfolder.value;
    }));
    const subfolderWorks = diagnostics.downloadMode === 'browser';
    fieldset.appendChild(
      field({
        id: 'siat-subfolder',
        label: 'Save into this sub-folder of your downloads',
        hint: subfolderWorks
          ? 'Your manager uses the browser download API, so sub-folders work.'
          : `Not supported by your current setup (${describeDownloadCapability(deps.gm ? deps.gm() : null, diagnostics.downloadMode)}) — the file will be saved with its name only.`,
        control: subfolder,
      }),
    );

    const maxLen = textControl(draft.maxFilenameLength, { type: 'number', min: 8, max: 120, step: 1 });
    maxLen.addEventListener('input', guardUserEvent(() => {
      draft.maxFilenameLength = Number(maxLen.value);
    }));
    fieldset.appendChild(
      field({ id: 'siat-maxlen', label: 'Maximum file name length', hint: 'Between 8 and 120 characters; the extension always fits.', control: maxLen }),
    );

    // Template naming. An empty template means the classic "prefix-source name"
    // behaviour, so upgrading changes nothing until one is typed in.
    const templateControl = textControl(draft.filenameTemplate, {
      maxlength: 200,
      placeholder: '{host}-{date}-{w}x{h}-{index3}',
      spellcheck: 'false',
      autocomplete: 'off',
    });
    const preview = doc.createElement('p');
    preview.className = 'siat-desc';
    preview.id = 'siat-template-preview';
    const sampleContext = {
      base: 'photo-0142',
      path: 'photo-0142',
      host: 'cdn.example.com',
      origin: 'example.com',
      title: 'Gallery',
      alt: 'Red fox',
      w: 1920,
      h: 1080,
      format: 'jpg',
      ext: 'jpeg',
      mime: 'jpeg',
      bytes: 284193,
    };
    const renderPreview = () => {
      const text = String(templateControl.value || '').trim();
      if (!text) {
        preview.textContent = 'No template: names stay "<prefix>-<source name>", exactly as before.';
        return;
      }
      const checked = validateTemplate(text);
      if (!checked.ok) {
        preview.textContent = `Not usable yet — ${checked.errors[0]}`;
        return;
      }
      const rendered = renderTemplate(text, sampleContext, { counter: 3, preset: 'Archive PNG' });
      preview.textContent = `Preview: ${rendered.text || '(empty)'}.jpeg${checked.warnings.length ? ` — ${checked.warnings[0]}` : ''}`;
    };
    templateControl.addEventListener('input', guardUserEvent(() => {
      draft.filenameTemplate = templateControl.value;
      renderPreview();
    }));
    renderPreview();
    fieldset.appendChild(
      field({
        id: 'siat-template',
        label: 'File-name template (optional)',
        hint: 'Replaces the prefix above. {index3} counts within one run, so a 200-image batch keeps unique names.',
        control: templateControl,
      }),
    );
    fieldset.appendChild(preview);

    const tokenBox = doc.createElement('details');
    tokenBox.className = 'siat-desc';
    const tokenSummary = doc.createElement('summary');
    tokenSummary.textContent = `Available tokens (${TEMPLATE_TOKENS.length})`;
    tokenBox.appendChild(tokenSummary);
    const tokenList = doc.createElement('div');
    tokenList.id = 'siat-template-tokens';
    tokenList.textContent = TEMPLATE_TOKENS.map((entry) => `{${entry.token}} = ${entry.label} (e.g. ${entry.example})`).join(' · ');
    tokenBox.appendChild(tokenList);
    fieldset.appendChild(tokenBox);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-collision',
        label: 'Add a counter when two files in one run would share a name',
        hint: 'Stops a batch from silently overwriting its own output.',
        checked: draft.filenameCollisionSuffix,
        onChange: (checked) => {
          draft.filenameCollisionSuffix = checked;
        },
      }),
    );
    return fieldset;
  }

  function buildQualitySection() {
    const fieldset = section('Output quality');
    const jpeg = textControl(draft.jpegQuality, { type: 'number', min: 0.5, max: 1, step: 0.01 });
    jpeg.addEventListener('input', guardUserEvent(() => {
      draft.jpegQuality = Number(jpeg.value);
    }));
    fieldset.appendChild(field({ id: 'siat-jpegq', label: 'JPG quality', hint: '0.5 – 1.0. Also used for the image inside a PDF.', control: jpeg }));

    const webp = textControl(draft.webpQuality, { type: 'number', min: 0.1, max: 1, step: 0.01 });
    webp.addEventListener('input', guardUserEvent(() => {
      draft.webpQuality = Number(webp.value);
    }));
    fieldset.appendChild(field({ id: 'siat-webpq', label: 'WebP quality', hint: '0.1 – 1.0.', control: webp }));

    const pdfSelect = doc.createElement('select');
    for (const [value, label] of [['a4', 'A4 (fit with margins)'], ['letter', 'US Letter (fit with margins)'], ['pixel', 'Exactly the image size']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      if (draft.pdfPageFit === value) option.selected = true;
      pdfSelect.appendChild(option);
    }
    pdfSelect.addEventListener('change', guardUserEvent(() => {
      draft.pdfPageFit = pdfSelect.value;
    }));
    fieldset.appendChild(field({ id: 'siat-pdffit', label: 'PDF page size', hint: 'A4 and Letter keep the aspect ratio and centre the image.', control: pdfSelect }));

    const bgSelect = doc.createElement('select');
    for (const [value, label] of [['white', 'White'], ['black', 'Black'], ['checker', 'Light grey checkerboard']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      if (draft.flattenBackground === value) option.selected = true;
      bgSelect.appendChild(option);
    }
    bgSelect.addEventListener('change', guardUserEvent(() => {
      draft.flattenBackground = bgSelect.value;
    }));
    fieldset.appendChild(
      field({ id: 'siat-bg', label: 'Flatten transparency onto', hint: 'Used for JPG, PDF and 24-bit BMP, which cannot store alpha.', control: bgSelect }),
    );

    const downscale = textControl(draft.downscaleAboveMegapixels, { type: 'number', min: 0, max: 400, step: 1 });
    downscale.addEventListener('input', guardUserEvent(() => {
      draft.downscaleAboveMegapixels = Number(downscale.value);
    }));
    fieldset.appendChild(
      field({ id: 'siat-downscale', label: 'Downscale images above (megapixels)', hint: '0 = never downscale. Keeps huge images from freezing the tab.', control: downscale }),
    );
    return fieldset;
  }

  function buildAnimationSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section('Animation and memory limits');
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-keepanim',
        label: 'Keep animation when converting to GIF',
        hint: diagnostics.animation.decoderAvailable
          ? `Frame decoding available for: ${diagnostics.animation.supportedTypes.join(', ') || 'none probed'}.`
          : 'This browser cannot read individual frames (no WebCodecs ImageDecoder), so GIF output is the first frame. "Original file" always keeps animation.',
        checked: draft.keepAnimation,
        onChange: (checked) => {
          draft.keepAnimation = checked;
        },
      }),
    );

    const maxFrames = textControl(draft.gifMaxFrames, { type: 'number', min: 2, max: 200, step: 1 });
    maxFrames.addEventListener('input', guardUserEvent(() => {
      draft.gifMaxFrames = Number(maxFrames.value);
    }));
    fieldset.appendChild(field({ id: 'siat-maxframes', label: 'Maximum frames per GIF', hint: 'Extra frames are skipped evenly and delays stretched to keep the timing.', control: maxFrames }));

    const memLimit = textControl(draft.gifMemoryLimitMB, { type: 'number', min: 16, max: 4096, step: 16 });
    memLimit.addEventListener('input', guardUserEvent(() => {
      draft.gifMemoryLimitMB = Number(memLimit.value);
    }));
    fieldset.appendChild(
      field({ id: 'siat-memlimit', label: 'GIF memory limit (MB)', hint: 'Frames are scaled down to stay under this; a single frame above it is refused rather than crashing the tab.', control: memLimit }),
    );
    return fieldset;
  }

  function buildBatchSection() {
    const fieldset = section(
      'Batch conversion and archives',
      'Applies to "Save all images on this page" and to selections in the image picker. Scanning a page never downloads anything; a run only fetches what you start.',
    );

    const concurrency = textControl(draft.batchConcurrency, { type: 'number', min: 1, max: 4, step: 1 });
    concurrency.addEventListener('input', guardUserEvent(() => {
      draft.batchConcurrency = Number(concurrency.value);
    }));
    fieldset.appendChild(
      field({
        id: 'siat-batch-concurrency',
        label: 'Images converted at the same time',
        hint: '1–4. Higher is faster but uses more memory; browsers also throttle many simultaneous downloads.',
        control: concurrency,
      }),
    );

    const maxImages = textControl(draft.batchMaxImages, { type: 'number', min: 1, max: 2000, step: 10 });
    maxImages.addEventListener('input', guardUserEvent(() => {
      draft.batchMaxImages = Number(maxImages.value);
    }));
    fieldset.appendChild(
      field({ id: 'siat-batch-max', label: 'Maximum images per run', hint: 'Anything above this is reported as skipped, not silently dropped.', control: maxImages }),
    );

    const grid = doc.createElement('div');
    grid.className = 'siat-grid';
    const minWidth = textControl(draft.batchMinWidth, { type: 'number', min: 0, max: 20000, step: 10 });
    minWidth.addEventListener('input', guardUserEvent(() => {
      draft.batchMinWidth = Number(minWidth.value);
    }));
    grid.appendChild(field({ id: 'siat-batch-minw', label: 'Minimum width (px, 0 = off)', control: minWidth }));
    const minHeight = textControl(draft.batchMinHeight, { type: 'number', min: 0, max: 20000, step: 10 });
    minHeight.addEventListener('input', guardUserEvent(() => {
      draft.batchMinHeight = Number(minHeight.value);
    }));
    grid.appendChild(field({ id: 'siat-batch-minh', label: 'Minimum height (px, 0 = off)', control: minHeight }));
    fieldset.appendChild(grid);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-batch-skiptiny',
        label: 'Skip icons and tracking pixels',
        hint: 'Leaves out images smaller than 64×64 px, which are usually UI chrome.',
        checked: draft.batchSkipTiny,
        onChange: (checked) => {
          draft.batchSkipTiny = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-batch-dedupe',
        label: 'Save each distinct image URL once',
        hint: 'A gallery showing one photo six times produces one file.',
        checked: draft.batchDedupe,
        onChange: (checked) => {
          draft.batchDedupe = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-batch-notloaded',
        label: 'Also convert images the page has not loaded yet',
        hint: 'Off by default: forcing lazy images to load costs bandwidth and can change what the page shows. The picker can load selected images on demand instead.',
        checked: draft.batchIncludeNotLoaded,
        onChange: (checked) => {
          draft.batchIncludeNotLoaded = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-jobbar',
        label: 'Show the batch progress bar',
        hint: 'Bottom-left overlay with per-image state, Cancel and Retry failed.',
        checked: draft.showJobBar,
        onChange: (checked) => {
          draft.showJobBar = checked;
        },
      }),
    );

    const destination = dialogSelectControl(
      doc,
      [
        { value: 'files', label: 'One file per image' },
        { value: 'zip', label: 'A single .zip archive' },
      ],
      draft.batchDestination,
      (value) => {
        draft.batchDestination = value;
      },
    );
    fieldset.appendChild(
      field({
        id: 'siat-batch-dest',
        label: 'Where a batch run puts its output',
        hint: 'Browsers block or throttle many automatic downloads; an archive avoids that and is built entirely in memory.',
        control: destination,
      }),
    );

    const zipMax = textControl(draft.zipMaxMB, { type: 'number', min: 1, max: 4096, step: 64 });
    zipMax.addEventListener('input', guardUserEvent(() => {
      draft.zipMaxMB = Number(zipMax.value);
    }));
    fieldset.appendChild(
      field({
        id: 'siat-zip-max',
        label: 'Archive size limit (MB)',
        hint: 'If a run would exceed this, the remaining images are saved as separate files and the report says so.',
        control: zipMax,
      }),
    );

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-scan-backgrounds',
        label: 'Include CSS background images in the inventory',
        hint: 'Needs a computed-style read per element, so it is capped below.',
        checked: draft.scanBackgrounds,
        onChange: (checked) => {
          draft.scanBackgrounds = checked;
        },
      }),
    );

    const scanCap = textControl(draft.scanElementCap, { type: 'number', min: 100, max: 20000, step: 100 });
    scanCap.addEventListener('input', guardUserEvent(() => {
      draft.scanElementCap = Number(scanCap.value);
    }));
    fieldset.appendChild(
      field({ id: 'siat-scan-cap', label: 'Elements inspected while scanning', hint: 'Very large pages are truncated rather than frozen; the picker says when that happened.', control: scanCap }),
    );

    const compareBox = section('Formats offered by "Compare formats…"', 'Each candidate is encoded in memory from the same pixels — one download of the source, never more.');
    const compareGrid = doc.createElement('div');
    compareGrid.className = 'siat-grid';
    for (const format of FORMATS) {
      if (format.id === 'original') continue;
      compareGrid.appendChild(
        checkboxRow({
          id: `siat-cmp-${format.id}`,
          label: format.label,
          checked: (draft.compareFormats || []).includes(format.id),
          onChange: (checked) => {
            const list = (draft.compareFormats || []).slice();
            const index = list.indexOf(format.id);
            if (checked && index < 0) list.push(format.id);
            if (!checked && index >= 0) list.splice(index, 1);
            draft.compareFormats = list;
          },
        }),
      );
    }
    compareBox.appendChild(compareGrid);
    fieldset.appendChild(compareBox);
    return fieldset;
  }

  function buildPresetsSection() {
    const fieldset = section(
      'Presets',
      `A preset bundles format, quality, resize, file-name template, destination and (optionally) the sites it applies to automatically. Up to ${PRESET_LIMITS.max} presets are stored.`,
    );

    const active = doc.createElement('p');
    active.className = 'siat-desc';
    active.id = 'siat-preset-active';
    const list = doc.createElement('div');
    list.id = 'siat-preset-list';

    const renderActive = () => {
      const preset = draft.presets.find((item) => item.id === draft.activePresetId);
      active.textContent = preset ? `Active preset: ${preset.name} — ${presetSummary(preset) || 'no overrides'}` : 'No preset is active; your normal settings are used.';
    };

    const renderList = () => {
      list.textContent = '';
      if (!draft.presets.length) {
        const empty = doc.createElement('p');
        empty.className = 'siat-empty';
        empty.textContent = 'No presets yet. Add one to capture the current settings.';
        list.appendChild(empty);
      }
      draft.presets.forEach((preset) => list.appendChild(presetRow(preset, renderList, renderActive)));
      renderActive();
    };

    fieldset.appendChild(active);
    fieldset.appendChild(list);

    const addButton = button(`Add preset from current settings`, 'ghost', () => {
      if (draft.presets.length >= PRESET_LIMITS.max) {
        showBanner('error', 'Preset limit reached', [`Delete one of the ${PRESET_LIMITS.max} presets first.`]);
        return;
      }
      const index = draft.presets.length + 1;
      draft.presets.push({
        id: `preset-${Date.now().toString(36)}-${index}`,
        name: `Preset ${index}`,
        formatId: (draft.formats && draft.formats[0]) || 'png',
        jpegQuality: draft.jpegQuality,
        webpQuality: draft.webpQuality,
        filenameTemplate: draft.filenameTemplate || '',
        subfolder: draft.subfolder || '',
        destination: draft.batchDestination === 'zip' ? 'zip' : 'file',
        stripMetadata: false,
        transform: draft.defaultTransform ? JSON.parse(JSON.stringify(draft.defaultTransform)) : null,
        hosts: [],
      });
      renderList();
      showBanner('info', 'Preset added', ['It is not saved until you press Save at the bottom.']);
    });
    addButton.id = 'siat-preset-new';
    const clearButton = button('Clear active preset', 'ghost', () => {
      draft.activePresetId = '';
      renderActive();
    });
    clearButton.id = 'siat-preset-clear';
    const row = doc.createElement('div');
    row.className = 'siat-foot';
    row.style.padding = '8px 0 0';
    row.appendChild(addButton);
    row.appendChild(clearButton);
    fieldset.appendChild(row);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-preset-autohost',
        label: 'Apply a preset automatically on the hosts it lists',
        hint: 'Matching happens on the page host only. The most specific rule wins; the menu still shows which preset is in effect.',
        checked: draft.autoApplyPresetByHost,
        onChange: (checked) => {
          draft.autoApplyPresetByHost = checked;
        },
      }),
    );

    renderList();
    return fieldset;
  }

  function presetRow(preset, renderList, renderActive) {
    const box = doc.createElement('fieldset');
    box.className = 'siat-section';
    box.id = `siat-preset-${preset.id}`;
    const legend = doc.createElement('legend');
    legend.className = 'siat-legend';
    legend.textContent = preset.name || 'Preset';
    box.appendChild(legend);

    const nameControl = textControl(preset.name, { maxlength: PRESET_LIMITS.nameChars });
    nameControl.addEventListener('input', guardUserEvent(() => {
      preset.name = nameControl.value;
      legend.textContent = preset.name || 'Preset';
    }));
    box.appendChild(field({ id: `siat-preset-${preset.id}-name`, label: 'Name', control: nameControl }));

    const formatControl = dialogSelectControl(
      doc,
      FORMATS.map((format) => ({ value: format.id, label: format.id === 'original' ? 'Original file' : format.label })),
      preset.formatId,
      (value) => {
        preset.formatId = value;
      },
    );
    box.appendChild(field({ id: `siat-preset-${preset.id}-format`, label: 'Output format', control: formatControl }));

    const resizeControl = dialogSelectControl(
      doc,
      RESIZE_PRESETS.map((entry) => ({ value: entry.id, label: entry.label })),
      resizePresetIdOf(preset.transform),
      (value) => {
        const found = RESIZE_PRESETS.find((entry) => entry.id === value);
        preset.transform = found && found.mode !== 'none' ? { resize: { mode: found.mode, width: found.width || 0, height: 0, keepAspect: true }, crop: null, rotate: 0, flipH: false, flipV: false } : null;
      },
    );
    box.appendChild(field({ id: `siat-preset-${preset.id}-resize`, label: 'Resize', hint: 'Cropping and rotation stay one-off actions in the Transform dialog.', control: resizeControl }));

    const destControl = dialogSelectControl(
      doc,
      [
        { value: 'file', label: 'One file per image' },
        { value: 'zip', label: 'A single .zip archive' },
      ],
      preset.destination || 'file',
      (value) => {
        preset.destination = value;
      },
    );
    box.appendChild(field({ id: `siat-preset-${preset.id}-dest`, label: 'Destination', control: destControl }));

    const templateControl = textControl(preset.filenameTemplate, { maxlength: 200, placeholder: '{host}-{date}-{index3}' });
    templateControl.addEventListener('input', guardUserEvent(() => {
      preset.filenameTemplate = templateControl.value;
    }));
    box.appendChild(field({ id: `siat-preset-${preset.id}-template`, label: 'File-name template', control: templateControl }));

    const hostsControl = textControl((preset.hosts || []).join(', '), { maxlength: 200, placeholder: 'example.com, *.photos.example.com' });
    hostsControl.addEventListener('input', guardUserEvent(() => {
      preset.hosts = hostsControl.value
        .split(',')
        .map((part) => sanitizeHostPattern(part))
        .filter(Boolean);
    }));
    box.appendChild(
      field({
        id: `siat-preset-${preset.id}-hosts`,
        label: 'Apply automatically on these hosts (comma separated)',
        hint: 'Empty means the preset is only applied by hand, from the right-click menu.',
        control: hostsControl,
      }),
    );

    const actions = doc.createElement('div');
    actions.className = 'siat-radios';
    const useButton = button('Use now', 'ghost', () => {
      draft.activePresetId = preset.id;
      renderActive();
      showBanner('info', `Preset "${preset.name}" is active`, ['Press Save to keep it after this page.']);
    });
    useButton.id = `siat-preset-${preset.id}-activate`;
    const deleteButton = button('Delete', 'ghost', () => {
      const index = draft.presets.findIndex((item) => item.id === preset.id);
      if (index >= 0) draft.presets.splice(index, 1);
      if (draft.activePresetId === preset.id) draft.activePresetId = '';
      renderList();
    });
    deleteButton.id = `siat-preset-${preset.id}-delete`;
    actions.appendChild(useButton);
    actions.appendChild(deleteButton);
    box.appendChild(actions);
    return box;
  }

  /**
   * Configuration profiles (G-67). Applying a profile is a real configuration
   * switch: it is written through the same save path the Save button uses, then
   * the dialog is rebuilt so every control shows the configuration that is now
   * in effect — no control can silently keep a stale value.
   */
  function buildProfilesSection() {
    const translator = createTranslator(languageFromDocument(doc));
    const { t } = translator;
    const fieldset = section(t('profileSection'), t('profileIntro'));
    fieldset.id = 'siat-profiles-section';
    if (translator.direction === 'rtl') fieldset.setAttribute('dir', 'rtl');

    const list = doc.createElement('div');
    list.className = 'siat-profile-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', t('profileListLabel'));

    const renderList = () => {
      list.textContent = '';
      list.dataset.siatProfileCount = String(draft.profiles.length);
      if (!draft.profiles.length) {
        const empty = doc.createElement('p');
        empty.className = 'siat-empty';
        empty.textContent = t('profileEmpty');
        list.appendChild(empty);
      }
      for (const profile of draft.profiles) list.appendChild(profileRow(profile, renderList, t));
    };

    const nameControl = textControl('', { maxlength: PROFILE_LIMITS.nameChars, placeholder: t('profileNamePlaceholder') });
    nameControl.id = 'siat-profile-new-name';
    const saveButton = button(t('profileSave'), 'ghost', () => {
      const named = captureProfile(draft, nameControl.value);
      if (!named.profile) {
        showBanner('error', t('profileNameRequired'), named.warnings);
        return;
      }
      draft.profiles = named.profiles;
      nameControl.value = '';
      renderList();
      showBanner('info', t('profileSaved', { name: named.profile.name }), named.warnings);
    });
    saveButton.id = 'siat-profile-new-save';
    const newRow = doc.createElement('div');
    newRow.className = 'siat-profile-new';
    const nameField = field({ id: 'siat-profile-new-name', label: t('profileName'), control: nameControl });
    nameField.className = 'siat-profile-name-field';
    newRow.appendChild(nameField);
    newRow.appendChild(saveButton);

    fieldset.appendChild(list);
    fieldset.appendChild(newRow);
    renderList();
    return fieldset;
  }

  function profileRow(profile, renderList, t) {
    const row = doc.createElement('div');
    row.className = 'siat-profile-row';
    row.setAttribute('role', 'listitem');
    const label = doc.createElement('span');
    label.className = 'siat-profile-label';
    const strong = doc.createElement('strong');
    strong.textContent = profile.name;
    const detail = doc.createElement('small');
    detail.textContent = profileSummary(profile);
    label.appendChild(strong);
    label.appendChild(doc.createElement('br'));
    label.appendChild(detail);
    row.appendChild(label);

    const actions = doc.createElement('span');
    actions.className = 'siat-profile-actions';
    const applyButton = button(t('profileApply'), 'primary', async () => {
      const applied = applyProfile(deps.getSettings(), profile.values);
      const result = await deps.saveSettings(applied);
      if (!result || result.ok === false) {
        showBanner('error', t('profileApplyFailed', { reason: (result && result.warnings && result.warnings[0]) || 'unknown error' }), result && result.warnings ? result.warnings : []);
        return;
      }
      if (deps.notify) deps.notify(t('profileApplied', { name: profile.name }), profileSummary(profile));
      close();
      open();
    });
    applyButton.id = `siat-profile-${profile.id}-apply`;
    const deleteButton = button(t('profileDelete'), 'ghost', () => {
      draft.profiles = removeProfile(draft, profile.id);
      renderList();
      showBanner('info', t('profileDeleted', { name: profile.name }), []);
    });
    deleteButton.id = `siat-profile-${profile.id}-delete`;
    actions.appendChild(applyButton);
    actions.appendChild(deleteButton);
    row.appendChild(actions);
    return row;
  }

  function buildShortcutsSection() {
    const fieldset = section(
      'Keyboard shortcuts',
      'Every chord needs Ctrl, Alt or Meta, so plain typing on a page is never captured. Empty disables one action. On Windows, Alt+Shift is also the language-switch chord — rebind if your system grabs it first.',
    );

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-shortcuts-enable',
        label: 'Enable keyboard shortcuts',
        checked: draft.enableShortcuts,
        onChange: (checked) => {
          draft.enableShortcuts = checked;
        },
      }),
    );

    const feedback = doc.createElement('p');
    feedback.className = 'siat-desc';
    feedback.id = 'siat-shortcuts-feedback';
    const showFeedback = () => {
      const checked = validateShortcuts(draft.shortcuts);
      const problems = checked.errors.concat(checked.warnings);
      feedback.textContent = problems.length ? problems[0] : 'All shortcuts are valid.';
    };

    for (const action of SHORTCUT_ACTIONS) {
      const value = draft.shortcuts && draft.shortcuts[action.id] !== undefined ? draft.shortcuts[action.id] : DEFAULT_SHORTCUTS[action.id];
      const control = textControl(value, { placeholder: DEFAULT_SHORTCUTS[action.id], spellcheck: 'false', autocomplete: 'off', maxlength: 40 });
      control.addEventListener('input', guardUserEvent(() => {
        draft.shortcuts = Object.assign({}, draft.shortcuts, { [action.id]: control.value });
        showFeedback();
      }));
      fieldset.appendChild(
        field({ id: `siat-sc-${action.id}`, label: action.label, hint: `Default ${DEFAULT_SHORTCUTS[action.id]}.`, control }),
      );
    }
    showFeedback();
    fieldset.appendChild(feedback);

    const helpNote = doc.createElement('p');
    helpNote.className = 'siat-desc';
    helpNote.textContent = 'In the right-click menu you can also press a digit (1–9) to pick that format directly, or Escape to close it. "Shortcut help" in your manager menu lists every binding.';
    fieldset.appendChild(helpNote);
    return fieldset;
  }

  /** Which resize preset (if any) a stored transform corresponds to. */
  function resizePresetIdOf(transform) {
    if (!transform || !transform.resize) return 'none';
    const mode = transform.resize.mode;
    if (!mode || mode === 'none') return 'none';
    const found = RESIZE_PRESETS.find(
      (entry) => entry.mode === mode && (entry.width || 0) === (Number(transform.resize.width) || 0),
    );
    return found ? found.id : 'none';
  }

  function buildBehaviourSection() {
    const fieldset = section('Menu and download behaviour');

    const radios = doc.createElement('div');
    radios.className = 'siat-radios';
    radios.setAttribute('role', 'radiogroup');
    radios.setAttribute('aria-label', 'Download behaviour');
    for (const [value, label, hint] of [
      ['instant', 'Save instantly', 'No dialog where the manager allows it'],
      ['ask', 'Ask where to save', 'Only honoured in browser download API mode'],
    ]) {
      const wrapper = doc.createElement('label');
      wrapper.className = 'siat-radio';
      const input = doc.createElement('input');
      input.type = 'radio';
      input.className = 'siat-radio-input';
      input.name = 'siat-download-behavior';
      input.value = value;
      input.checked = draft.downloadBehavior === value;
      input.addEventListener('change', guardUserEvent(() => {
        if (input.checked) draft.downloadBehavior = value;
      }));
      wrapper.appendChild(input);
      const text = doc.createElement('span');
      text.textContent = label;
      wrapper.appendChild(text);
      const hintEl = doc.createElement('small');
      hintEl.className = 'siat-check-hint';
      hintEl.textContent = hint;
      wrapper.appendChild(hintEl);
      radios.appendChild(wrapper);
    }
    fieldset.appendChild(radios);
    const behaviourSpacer = doc.createElement('div');
    behaviourSpacer.style.height = '10px';
    fieldset.appendChild(behaviourSpacer);

    fieldset.appendChild(
      checkboxRow({
        id: 'siat-intercept',
        label: 'Replace the right-click menu on images',
        hint: 'Off = the script never touches right-click; use the manager menu command instead.',
        checked: draft.interceptContextMenu,
        onChange: (checked) => {
          draft.interceptContextMenu = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-shift',
        label: 'Only open when Shift is held',
        hint: 'Inverts the default: right-click gives the browser menu, Shift + right-click gives this one.',
        checked: draft.requireShift,
        onChange: (checked) => {
          draft.requireShift = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-bgimg',
        label: 'Also offer CSS background images',
        hint: 'Covers background-image, list-style-image and ::before/::after decorations.',
        checked: draft.enableBackgroundImages,
        onChange: (checked) => {
          draft.enableBackgroundImages = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-longpress',
        label: 'Open on long-press (touch)',
        hint: 'For phones and tablets, where there is no right-click.',
        checked: draft.enableLongPress,
        onChange: (checked) => {
          draft.enableLongPress = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-remember',
        label: 'Show the last format used first',
        checked: draft.rememberLastFormat,
        onChange: (checked) => {
          draft.rememberLastFormat = checked;
        },
      }),
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-notify',
        label: 'Also raise a system notification on failure',
        hint: 'In addition to the on-page message.',
        checked: draft.notifyOnError,
        onChange: (checked) => {
          draft.notifyOnError = checked;
        },
      }),
    );

    const actionsBox = section(
      'Extra actions in the right-click menu',
      'Untick anything you do not use and the menu stays short. Formats are always listed.',
    );
    const actionsGrid = doc.createElement('div');
    actionsGrid.className = 'siat-grid';
    for (const id of MENU_ACTION_IDS) {
      const meta = MENU_ACTION_LABELS[id] || { label: id, hint: '' };
      actionsGrid.appendChild(
        checkboxRow({
          id: `siat-menuact-${id}`,
          label: meta.label,
          hint: meta.hint,
          checked: (draft.menuActions || []).includes(id),
          onChange: (checked) => {
            const list = (draft.menuActions || []).slice();
            const index = list.indexOf(id);
            if (checked && index < 0) list.push(id);
            if (!checked && index >= 0) list.splice(index, 1);
            draft.menuActions = list;
          },
        }),
      );
    }
    actionsBox.appendChild(actionsGrid);
    fieldset.appendChild(actionsBox);

    const copyControl = dialogSelectControl(
      doc,
      [
        { value: 'png', label: 'PNG (re-encoded, works everywhere)' },
        { value: 'original', label: 'Original bytes when the browser accepts them' },
      ],
      draft.copyFormat,
      (value) => {
        draft.copyFormat = value;
      },
    );
    fieldset.appendChild(
      field({
        id: 'siat-copy-format',
        label: 'What "Copy image" puts on the clipboard',
        hint: 'Most browsers only accept PNG there, so an original-bytes copy falls back to PNG and the toast says so.',
        control: copyControl,
      }),
    );
    return fieldset;
  }

  function buildPrivacySection() {
    const fieldset = section(
      'Privacy and network',
      'This script never uploads anything. The only network request it can make is a GET for the image you asked it to convert, issued through your userscript manager (that is what @connect * is for). Turn it off and cross-origin images whose servers send no CORS header can no longer be converted.',
    );
    fieldset.appendChild(
      checkboxRow({
        id: 'siat-cors',
        label: 'Fetch cross-origin images through the manager',
        hint: 'Needed for CDN-hosted images that block cross-origin canvas reads.',
        checked: draft.allowCrossOriginFetch,
        onChange: (checked) => {
          draft.allowCrossOriginFetch = checked;
        },
      }),
    );
    const storageNote = doc.createElement('p');
    storageNote.className = 'siat-desc';
    storageNote.textContent = `Stored on this device only: your settings (${deps.diagnostics().storage === 'gm' ? 'in your userscript manager' : 'in memory for this page load — no storage permission available'}). Images and page data are never stored or transmitted.`;
    fieldset.appendChild(storageNote);

    const metaBox = section(
      'Embedded metadata in saved originals',
      'Re-saving the original file copies it byte for byte — including EXIF (camera, timestamps, sometimes GPS), XMP and colour profiles. "Inspect metadata" on any image shows exactly what a file carries.',
    );
    metaBox.appendChild(
      checkboxRow({
        id: 'siat-strip-metadata',
        label: 'Strip EXIF/XMP when saving the original file',
        hint: 'Removes metadata segments only; the image data is never re-encoded, so quality is untouched.',
        checked: draft.stripMetadataOnOriginal,
        onChange: (checked) => {
          draft.stripMetadataOnOriginal = checked;
        },
      }),
    );
    metaBox.appendChild(
      checkboxRow({
        id: 'siat-drop-icc',
        label: 'Also remove the ICC colour profile',
        hint: 'Only with stripping on. Colours may shift slightly in apps that ignore the profile, so this is off by default.',
        checked: draft.dropIccWhenStripping,
        onChange: (checked) => {
          draft.dropIccWhenStripping = checked;
        },
      }),
    );
    metaBox.appendChild(
      checkboxRow({
        id: 'siat-warn-gps',
        label: 'Warn when a file contains GPS coordinates',
        hint: 'Shown in the inspector and in the save report. Coordinates are only ever displayed rounded to about 1 km, and never leave this device.',
        checked: draft.warnAboutGps,
        onChange: (checked) => {
          draft.warnAboutGps = checked;
        },
      }),
    );
    const metaNote = doc.createElement('p');
    metaNote.className = 'siat-desc';
    metaNote.textContent = 'Converted formats (PNG, JPG, WebP, GIF, BMP, PDF) are re-encoded from pixels, so they never carry the source metadata in the first place.';
    metaBox.appendChild(metaNote);
    fieldset.appendChild(metaBox);
    return fieldset;
  }

  function buildDiagnosticsSection() {
    const diagnostics = deps.diagnostics();
    const fieldset = section('Diagnostics (read-only)', 'Probed live in this browser and manager — useful when reporting a problem.');
    const table = doc.createElement('table');
    table.className = 'siat-table';
    const rows = [
      ['Userscript manager', `${diagnostics.handler} ${diagnostics.managerVersion}`.trim() || 'unknown'],
      ['Script version', diagnostics.scriptVersion || 'unknown'],
      ['Injection mode', diagnostics.injectInto || 'unknown'],
      ['GM download mode', `${diagnostics.downloadMode} — ${describeDownloadCapability(deps.gm ? deps.gm() : null, diagnostics.downloadMode)}`],
      ['Settings storage', diagnostics.storage === 'gm' ? 'manager storage (survives restarts)' : 'memory only (no GM_getValue grant)'],
      ['PNG / JPG / WebP encoders', encodersLabel(diagnostics, ['image/png', 'image/jpeg', 'image/webp'])],
      ['AVIF encoder', encodersLabel(diagnostics, ['image/avif'])],
      ['BMP / GIF / PDF encoders', 'built into this script (no browser support needed)'],
      ['Animated frame decoding', diagnostics.animation.decoderAvailable ? `available (${diagnostics.animation.supportedTypes.join(', ') || 'no formats probed'})` : 'unavailable in this browser'],
    ];
    for (const [label, value] of rows) {
      const tr = doc.createElement('tr');
      const th = doc.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      const td = doc.createElement('td');
      td.textContent = value;
      tr.appendChild(th);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    fieldset.appendChild(table);

    if (deps.capabilityReport) {
      const pre = doc.createElement('p');
      pre.className = 'siat-desc';
      pre.textContent = 'Copy this when reporting a problem: ' + deps.capabilityReport();
      fieldset.appendChild(pre);
    }
    return fieldset;
  }

  function encodersLabel(diagnostics, mimes) {
    const parts = mimes.map((mime) => `${mime.split('/')[1]}: ${diagnostics.encoders[mime] ? 'yes' : 'no'}`);
    return parts.join(' · ');
  }

  async function onSave() {
    const result = await deps.saveSettings(draft);
    if (result && result.ok === false) {
      showBanner('error', 'Settings could not be saved.', ['Your manager did not accept the write (storage may be unavailable). The changes apply to this page only.']);
      return;
    }
    close();
  }

  async function onReset() {
    draft = await deps.resetSettings();
    close();
    open();
  }

  function onExport() {
    const payload = JSON.stringify(Object.assign({}, draft, { exportedBy: 'save-image-as-type', exportedAt: new Date().toISOString() }), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = 'save-image-as-type-settings.json';
    anchor.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
    (doc.documentElement || doc.body).appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function onImportClick() {
    if (!fileInput) return;
    fileInput.value = '';
    fileInput.click();
  }

  async function onImportFile() {
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size > 200000) {
      showBanner('error', configMessage('importTooLarge'), []);
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch (err) {
      showBanner('error', 'Could not read that file.', [err && err.message ? err.message : String(err)]);
      return;
    }
    if (text.length > 200000) {
      showBanner('error', configMessage('importTooLarge'), [`Received ${text.length.toLocaleString()} characters.`]);
      return;
    }
    const result = validateImportedSettings(text);
    if (!result.ok) {
      showBanner('error', 'Import rejected.', result.errors);
      return;
    }
    draft = result.settings;
    showBanner('info', 'Imported — review, then press Save.', result.warnings);
    close();
    open();
  }

  return {
    open,
    close,
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    destroy() {
      dialog.destroy();
      fileInput = null;
      draft = null;
    },
  };
}
