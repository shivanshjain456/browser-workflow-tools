/**
 * Format-comparison dialog.
 *
 * Encodes the same image several ways in memory and shows what each costs, so
 * "which format should I use?" is answered with the actual numbers for *this*
 * image instead of a rule of thumb. Nothing is written to disk until a Save
 * button is pressed, and cancelling stops the encoders rather than letting them
 * finish in the background.
 */

import { createDialog, dialogEl, dialogButton, dialogTable } from './dialog.js';
import { comparisonRows } from '../core/compare.js';

const COMPARE_HOST_ID = 'siat-compare-host';

const COMPARE_STYLE = `
.siat-cmp-status { font-size: max(0.78125rem, 12.5px); color: #5c6472; padding: 8px 0; min-height: 1.4em; }
@media (prefers-color-scheme: dark) { .siat-cmp-status { color: #a3acbb; } }
.siat-table td .siat-btn { padding: 4px 9px; font-size: max(0.75rem, 12px); }
.siat-row-recommended { background: rgba(47,111,219,.1); }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {(target: object, helpers: {onProgress: Function, signal: AbortSignal}) => Promise<object>} deps.compare
 * @param {(target: object, formatId: string) => void} deps.onSave
 * @param {() => void} [deps.onCancel]
 */
export function createCompareDialog(deps) {
  const doc = deps.document || document;
  let target = null;
  let statusEl = null;
  let tableHost = null;
  let saveSmallestButton = null;
  let cancelButton = null;
  let controller = null;
  let recommended = null;
  let rows = [];
  let generation = 0;

  const dialog = createDialog({
    document: doc,
    hostId: COMPARE_HOST_ID,
    marker: 'compare',
    titleId: 'siat-compare-title',
    title: 'Compare formats',
    closeLabel: 'Close comparison',
    width: 'wide',
    extraStyle: COMPARE_STYLE,
    focus: 'first',
    onClose() {
      abortRun();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      generation += 1;

      statusEl = dialogEl(doc, 'p', { className: 'siat-cmp-status', id: 'siat-cmp-status', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Preparing…' });
      body.appendChild(statusEl);
      tableHost = dialogEl(doc, 'div', { id: 'siat-cmp-table' });
      body.appendChild(tableHost);
      const note = dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: 'Every candidate is encoded from the same pixels in memory. Sizes are the real encoded file sizes; nothing is saved until you press a Save button.',
      });
      body.appendChild(note);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      cancelButton = dialogButton(doc, 'Stop comparing', 'danger', () => abortRun());
      cancelButton.id = 'siat-cmp-cancel';
      foot.appendChild(cancelButton);
      saveSmallestButton = dialogButton(doc, 'Save smallest', 'primary', () => {
        if (recommended && typeof deps.onSave === 'function') {
          dialog.close();
          deps.onSave(target, recommended.formatId);
        }
      });
      saveSmallestButton.id = 'siat-cmp-save-smallest';
      saveSmallestButton.disabled = true;
      foot.appendChild(saveSmallestButton);
      foot.appendChild(dialogButton(doc, 'Close', 'ghost', () => dialog.close()));

      run();
    },
  });

  async function run() {
    // A new run supersedes the old one; that is not the user cancelling, so the
    // owner is not told (it would otherwise see a "cancel" for every re-open).
    abortRun(false);
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const thisRun = generation;
    rows = [];
    recommended = null;
    if (saveSmallestButton) saveSmallestButton.disabled = true;
    if (cancelButton) cancelButton.disabled = false;
    setStatus('Encoding candidates…');
    try {
      const result = await deps.compare(target, {
        signal: controller ? controller.signal : null,
        onProgress: (stage, detail) => {
          if (thisRun !== generation) return;
          setStatus(`${stage}${detail && detail.formatId ? ` (${detail.formatId})` : ''}…`);
        },
      });
      if (thisRun !== generation || !dialog.isOpen) return;
      rows = comparisonRows(result ? result.results : [], result ? result.recommended : null);
      recommended = result ? result.recommended : null;
      render(result);
    } catch (err) {
      if (thisRun !== generation) return;
      const cancelled = controller && controller.signal && controller.signal.aborted;
      setStatus(cancelled ? 'Comparison stopped.' : `Comparison failed: ${err && err.message ? err.message : 'unknown error'}`);
      if (cancelButton) cancelButton.disabled = true;
    }
  }

  function render(result) {
    if (!tableHost) return;
    tableHost.textContent = '';
    const succeeded = rows.filter((row) => row.ok);
    if (!succeeded.length) {
      tableHost.appendChild(
        dialogEl(doc, 'p', {
          className: 'siat-empty',
          text: 'No format could be encoded. The notes below say why.',
        }),
      );
    } else {
      const table = dialogTable(doc, {
        head: ['Format', 'Size', 'vs smallest', 'Transparency', 'Encode time', 'Notes', ''],
        caption: 'Encoded size comparison for this image',
        rows: rows.map((row) => [
          { text: row.label + (row.recommended ? ' ← smallest good' : '') },
          { text: row.ok ? row.sizeLabel : '—', num: true },
          { text: row.ok ? `${row.relative}%` : '—', num: true },
          { text: row.alpha },
          { text: row.ok ? `${row.ms} ms` : '—', num: true },
          { text: row.note || (row.dimensions ? row.dimensions : '') },
          { text: '' },
        ]),
      });
      // Save buttons are real elements, not table text.
      const actionCells = table.querySelectorAll('tbody tr td:last-child');
      rows.forEach((row, index) => {
        const cell = actionCells[index];
        if (!cell) return;
        if (!row.ok) {
          cell.appendChild(dialogEl(doc, 'span', { className: 'siat-no', text: 'failed' }));
          return;
        }
        const button = dialogButton(doc, 'Save', row.recommended ? 'primary' : 'ghost', () => {
          if (typeof deps.onSave === 'function') {
            dialog.close();
            deps.onSave(target, row.formatId);
          }
        });
        button.id = `siat-cmp-save-${row.formatId}`;
        button.setAttribute('aria-label', `Save as ${row.label}`);
        cell.appendChild(button);
        if (row.recommended) {
          const tr = cell.parentNode;
          if (tr) tr.className = 'siat-row-recommended';
        }
      });
      tableHost.appendChild(table);
    }

    const notes = (result && result.notes ? result.notes : []).slice();
    if (recommended) {
      notes.unshift(`Recommended: ${recommended.label} — ${recommended.reason}.`);
    }
    dialog.showBanner(recommended ? 'ok' : '', recommended ? '' : 'No recommendation', notes);
    setStatus(
      succeeded.length
        ? `${succeeded.length} format${succeeded.length === 1 ? '' : 's'} encoded in ${result && result.elapsedMs ? result.elapsedMs : 0} ms.`
        : 'Nothing could be encoded.',
    );
    if (saveSmallestButton) saveSmallestButton.disabled = !recommended;
    if (cancelButton) cancelButton.disabled = true;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = String(text || '');
  }

  function abortRun(notify = true) {
    generation += 1;
    const hadRun = Boolean(controller);
    if (controller) {
      try {
        controller.abort();
      } catch {
        /* noop */
      }
    }
    controller = null;
    // A run that was stopped has to look stopped: the button goes dead and the
    // status line says so, instead of leaving "Encoding candidates…" up forever.
    if (hadRun) {
      setStatus('Comparison stopped.');
      if (cancelButton) cancelButton.disabled = true;
    }
    if (notify && typeof deps.onCancel === 'function') {
      try {
        deps.onCancel();
      } catch {
        /* noop */
      }
    }
  }

  return {
    open(nextTarget) {
      target = nextTarget || null;
      dialog.open();
    },
    close: () => dialog.close(),
    rerun: () => run(),
    get isOpen() {
      return dialog.isOpen;
    },
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Automation seam: what the last run produced. */
    state: () => ({ rows, recommended }),
    destroy() {
      abortRun();
      dialog.destroy();
    },
  };
}
