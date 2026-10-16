import { guardUserEvent } from './events.js';
/**
 * Batch confirmation dialog.
 *
 * Converting a whole page writes many files at once, so it is a consequential
 * action: this dialog shows exactly what will happen — how many images qualify,
 * how many are skipped and why, which formats will be written, whether the
 * output lands as separate files or one archive — and only starts on an explicit
 * press. Options that change the plan re-plan it live, so the numbers shown are
 * the numbers acted on.
 */

import { createDialog, dialogEl, dialogButton, dialogTextControl, dialogSelectControl, dialogField, dialogCheckboxRow, dialogTable } from './dialog.js';

const BATCH_HOST_ID = 'siat-batch-host';

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => object} deps.settings
 * @param {() => Array<{id: string, label: string, disabled?: boolean}>} deps.formats
 * @param {(options: object) => object} deps.plan      recompute the plan for the chosen options
 * @param {(options: object) => void} deps.onStart
 * @param {() => void} [deps.onOpenPicker]
 */
export function createBatchDialog(deps) {
  const doc = deps.document || document;
  // Null until the first build seeds it from the stored settings, then kept: a
  // second "Convert every image" in the same page session should still show the
  // choices the user just made rather than silently resetting them.
  let options = null;
  let presetOptions = null;
  let plan = null;
  let tableHost = null;
  let startButton = null;
  let controls = {};

  const dialog = createDialog({
    document: doc,
    hostId: BATCH_HOST_ID,
    marker: 'batch',
    titleId: 'siat-batch-title',
    title: 'Convert every image on this page',
    closeLabel: 'Close batch dialog',
    width: 'wide',
    focus: 'first',
    build(context) {
      const body = context.body;
      const foot = context.foot;
      const settings = typeof deps.settings === 'function' ? deps.settings() : {};

      if (!options) {
        options = {
          formatId: settings.activeFormatId || firstFormatId(),
          extraFormats: (settings.batchFormats || []).slice(),
          destination: (settings.presetDestination || settings.batchDestination) === 'zip' ? 'zip' : 'files',
          includeNotLoaded: Boolean(settings.batchIncludeNotLoaded),
          minWidth: Number(settings.batchMinWidth) || 0,
          minHeight: Number(settings.batchMinHeight) || 0,
          skipTiny: settings.batchSkipTiny !== false,
          dedupe: settings.batchDedupe !== false,
        };
      }
      if (presetOptions) {
        options = Object.assign({}, options, presetOptions);
        presetOptions = null;
      }
      // Encoder support is probed after boot, so the list can change between
      // opens: never keep a choice this browser cannot honour.
      const available = (deps.formats ? deps.formats() : []).filter((entry) => !entry.disabled);
      if (!available.some((entry) => entry.id === options.formatId)) {
        options.formatId = firstFormatId();
      }
      options.extraFormats = (options.extraFormats || []).filter((id) => id !== options.formatId && available.some((entry) => entry.id === id));

      const intro = dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: 'Scanning reads what the page already has; nothing is downloaded until you press Start. Each image is converted independently, so one failure never stops the run.',
      });
      body.appendChild(intro);

      body.appendChild(buildOptionsSection());
      tableHost = dialogEl(doc, 'div', { id: 'siat-batch-plan' });
      body.appendChild(tableHost);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-note', id: 'siat-batch-note', text: '' }));
      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      if (typeof deps.onOpenPicker === 'function') {
        const pickerButton = dialogButton(doc, 'Choose images instead…', 'ghost', () => {
          dialog.close();
          deps.onOpenPicker();
        });
        pickerButton.id = 'siat-batch-open-picker';
        foot.appendChild(pickerButton);
      }
      foot.appendChild(dialogButton(doc, 'Cancel', 'ghost', () => dialog.close()));
      startButton = dialogButton(doc, 'Start', 'primary', () => {
        // `disabled` stops a mouse click, but not every activation path goes
        // through it, so the guard is in the handler too: an empty plan must
        // never reach the runner.
        if (!(plan && plan.eligible > 0)) return;
        dialog.close();
        deps.onStart(Object.assign({}, options));
      });
      startButton.id = 'siat-batch-start';
      foot.appendChild(startButton);

      replan();
    },
  });

  function buildOptionsSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'This run' }));

    const format = dialogSelectControl(
      doc,
      (deps.formats ? deps.formats() : []).map((entry) => ({ value: entry.id, label: entry.label, disabled: entry.disabled })),
      options.formatId,
      (value) => {
        options.formatId = value;
        replan();
      },
    );
    controls.format = format;
    section.appendChild(dialogField(doc, { id: 'siat-batch-format', label: 'Write every image as', control: format }));

    const extraBox = dialogEl(doc, 'div', { className: 'siat-grid' });
    for (const entry of deps.formats ? deps.formats() : []) {
      if (entry.id === 'original') continue;
      extraBox.appendChild(
        dialogCheckboxRow(doc, {
          id: `siat-batch-also-${entry.id}`,
          label: `also ${entry.label}`,
          unavailable: Boolean(entry.disabled),
          checked: options.extraFormats.includes(entry.id),
          onChange: (checked) => {
            const list = options.extraFormats.slice();
            const index = list.indexOf(entry.id);
            if (checked && index < 0) list.push(entry.id);
            if (!checked && index >= 0) list.splice(index, 1);
            options.extraFormats = list;
            replan();
          },
        }),
      );
    }
    section.appendChild(extraBox);

    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-zip',
        label: 'Put everything in one .zip archive',
        hint: 'Browsers throttle or block many automatic downloads; an archive is built in memory and saved as a single file.',
        checked: options.destination === 'zip',
        onChange: (checked) => {
          options.destination = checked ? 'zip' : 'files';
          replan();
        },
      }),
    );
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-notloaded',
        label: 'Also download images the page has not loaded yet',
        hint: 'Uses bandwidth and may change what the page shows (lazy galleries often load more as a result).',
        checked: options.includeNotLoaded,
        onChange: (checked) => {
          options.includeNotLoaded = checked;
          replan();
        },
      }),
    );
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-skiptiny',
        label: 'Skip icons and tracking pixels (under 64×64)',
        checked: options.skipTiny,
        onChange: (checked) => {
          options.skipTiny = checked;
          replan();
        },
      }),
    );
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-batch-dedupe',
        label: 'Save each distinct URL once',
        checked: options.dedupe,
        onChange: (checked) => {
          options.dedupe = checked;
          replan();
        },
      }),
    );

    const sizes = dialogEl(doc, 'div', { className: 'siat-grid' });
    const minWidth = dialogTextControl(doc, options.minWidth || '', { type: 'number', min: 0, max: 20000, step: 10 });
    minWidth.addEventListener('input', guardUserEvent(() => {
      options.minWidth = Number(minWidth.value) || 0;
      replan();
    }));
    sizes.appendChild(dialogField(doc, { id: 'siat-batch-minw', label: 'Minimum width (0 = off)', control: minWidth }));
    const minHeight = dialogTextControl(doc, options.minHeight || '', { type: 'number', min: 0, max: 20000, step: 10 });
    minHeight.addEventListener('input', guardUserEvent(() => {
      options.minHeight = Number(minHeight.value) || 0;
      replan();
    }));
    sizes.appendChild(dialogField(doc, { id: 'siat-batch-minh', label: 'Minimum height (0 = off)', control: minHeight }));
    section.appendChild(sizes);
    return section;
  }

  function replan() {
    if (typeof deps.plan !== 'function') return;
    try {
      plan = deps.plan(Object.assign({}, options)) || {};
    } catch (err) {
      plan = { eligible: 0, notes: [`The page could not be scanned: ${err && err.message ? err.message : 'unknown error'}`] };
    }
    render();
  }

  function render() {
    if (!tableHost) return;
    tableHost.textContent = '';
    const rows = [
      ['Images found', String(plan.found || 0)],
      ['Will be converted', String(plan.eligible || 0)],
      ['Files that produces', String(plan.files || 0)],
    ];
    if (plan.skippedTiny) rows.push(['Skipped: icon-sized', String(plan.skippedTiny)]);
    if (plan.skippedNotLoaded) rows.push(['Skipped: not loaded yet', String(plan.skippedNotLoaded)]);
    if (plan.skippedBroken) rows.push(['Skipped: broken source', String(plan.skippedBroken)]);
    if (plan.skippedDuplicate) rows.push(['Skipped: duplicate URL', String(plan.skippedDuplicate)]);
    if (plan.skippedTooSmall) rows.push(['Skipped: below the minimum size', String(plan.skippedTooSmall)]);
    if (plan.skippedLimit) rows.push(['Skipped: over the per-run limit', String(plan.skippedLimit)]);
    if (plan.crossOrigin) rows.push(['Cross-origin (fetched through your manager)', String(plan.crossOrigin)]);
    rows.push(['Output', plan.destination === 'zip' ? 'one .zip archive' : 'one file per image']);
    rows.push(['Concurrency', String(plan.concurrency || 1)]);

    tableHost.appendChild(
      dialogTable(doc, {
        head: ['Plan', 'Count'],
        caption: 'What this run will do',
        rows: rows.map(([label, value]) => [{ text: label }, { text: value, num: true }]),
      }),
    );

    const notes = (plan.notes || []).slice(0, 8);
    dialog.showBanner(plan.eligible ? '' : 'error', plan.eligible ? '' : 'Nothing to convert', notes);
    if (startButton) {
      startButton.disabled = !(plan.eligible > 0);
      startButton.textContent = plan.eligible ? `Start (${plan.files || plan.eligible} file${(plan.files || plan.eligible) === 1 ? '' : 's'})` : 'Nothing to do';
    }
    const noteEl = dialog.shadowRoot ? dialog.shadowRoot.querySelector('#siat-batch-note') : null;
    if (noteEl) {
      noteEl.textContent = plan.estimateLabel
        ? `About ${plan.estimateLabel} of work · cancel at any time from the progress bar`
        : 'Cancel at any time from the progress bar.';
    }
  }

  function firstFormatId() {
    const formats = deps.formats ? deps.formats() : [];
    const usable = formats.filter((entry) => !entry.disabled && entry.id !== 'original');
    return usable.length ? usable[0].id : 'png';
  }

  return {
    open(nextOptions) {
      // One-shot overrides for this open (e.g. "convert these as WebP"), applied
      // after the dialog is built so a stored choice cannot swallow them.
      if (nextOptions && typeof nextOptions === 'object') presetOptions = Object.assign({}, presetOptions || {}, nextOptions);
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Automation seam: the plan currently on screen. */
    state: () => ({ options: Object.assign({}, options), plan: plan ? Object.assign({}, plan) : null }),
    destroy() {
      dialog.destroy();
    },
  };
}
