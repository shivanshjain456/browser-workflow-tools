/**
 * Metadata inspector.
 *
 * Shows what a file actually carries — EXIF camera and timestamp fields, XMP,
 * ICC profiles, comments, and above all GPS coordinates — and offers to save the
 * original with that metadata removed.
 *
 * The values come from the file, which is untrusted input: everything is written
 * with textContent, long values are truncated by core/metadata.js, and GPS
 * coordinates are shown rounded to roughly a kilometre rather than at full
 * precision (enough to recognise a location, not enough to copy one out of a
 * dialog by hand).
 */

import { createDialog, dialogEl, dialogButton, dialogTable } from './dialog.js';
import { inspectMetadata, ORIENTATION_LABELS } from '../core/metadata.js';

const INSPECTOR_HOST_ID = 'siat-inspector-host';

const INSPECTOR_STYLE = `
.siat-insp-status { font-size: max(0.78125rem, 12.5px); color: #5c6472; padding: 6px 0; }
@media (prefers-color-scheme: dark) { .siat-insp-status { color: #a3acbb; } }
.siat-insp-thumb { max-width: 120px; max-height: 90px; border-radius: 8px; border: 1px solid rgba(127,127,127,.3); display: block; }
.siat-insp-head { display: flex; gap: 12px; align-items: flex-start; }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {(target: object) => Promise<{bytes: Uint8Array, mime: string, filename: string}>} deps.loadBytes
 * @param {(target: object, options: {stripMetadata: boolean}) => void} deps.onSave
 * @param {() => object} [deps.settings]
 */
export function createMetadataInspector(deps) {
  const doc = deps.document || document;
  let target = null;
  let statusEl = null;
  let tableHost = null;
  let saveButton = null;
  let loaded = null;
  let generation = 0;

  const dialog = createDialog({
    document: doc,
    hostId: INSPECTOR_HOST_ID,
    marker: 'inspector',
    titleId: 'siat-inspector-title',
    title: 'Embedded metadata',
    closeLabel: 'Close metadata inspector',
    width: 'wide',
    extraStyle: INSPECTOR_STYLE,
    focus: 'first',
    build(context) {
      const body = context.body;
      const foot = context.foot;
      generation += 1;

      statusEl = dialogEl(doc, 'p', {
        className: 'siat-insp-status',
        id: 'siat-insp-status',
        attrs: { role: 'status', 'aria-live': 'polite' },
        text: 'Reading the file…',
      });
      body.appendChild(statusEl);
      tableHost = dialogEl(doc, 'div', { id: 'siat-insp-table' });
      body.appendChild(tableHost);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      saveButton = dialogButton(doc, 'Save original without metadata', 'primary', () => {
        if (typeof deps.onSave === 'function') {
          dialog.close();
          deps.onSave(target, { stripMetadata: true });
        }
      });
      saveButton.id = 'siat-insp-save-stripped';
      saveButton.disabled = true;
      foot.appendChild(saveButton);
      const recheck = dialogButton(doc, 'Re-check', 'ghost', () => inspect());
      recheck.id = 'siat-insp-recheck';
      foot.appendChild(recheck);
      foot.appendChild(dialogButton(doc, 'Close', 'ghost', () => dialog.close()));

      inspect();
    },
  });

  async function inspect() {
    const thisRun = generation;
    setStatus('Reading the file…');
    if (saveButton) saveButton.disabled = true;
    try {
      if (typeof deps.loadBytes !== 'function') throw new Error('No file reader was provided.');
      const file = await deps.loadBytes(target);
      if (thisRun !== generation || !dialog.isOpen) return;
      if (!file || !file.bytes || !file.bytes.length) {
        setStatus('This image has no readable file bytes (it may be a canvas or a generated image), so there is no metadata to inspect.');
        renderEmpty();
        return;
      }
      loaded = file;
      const info = inspectMetadata(file.bytes, file.mime);
      render(info, file);
      setStatus(`${info.container} · ${inspectorFormatSize(file.bytes.length)}${info.supported ? '' : ' · metadata not inspectable here'}`);
      if (saveButton) saveButton.disabled = !info.strippable;
    } catch (err) {
      if (thisRun !== generation) return;
      setStatus(`Could not read the file: ${err && err.message ? err.message : 'unknown error'}`);
      renderEmpty();
    }
  }

  function render(info, file) {
    if (!tableHost) return;
    tableHost.textContent = '';

    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const warnings = settings.warnAboutGps === false ? info.warnings.filter((line) => !line.includes('GPS coordinates')) : info.warnings;
    if (warnings.length) {
      const hasGps = settings.warnAboutGps !== false && info.gps && info.gps.present;
      dialog.showBanner(hasGps ? 'error' : '', hasGps ? 'Location data found' : '', warnings);
    } else {
      dialog.showBanner('', '', []);
    }

    const summary = dialogEl(doc, 'div', { className: 'siat-insp-head' });
    const facts = dialogEl(doc, 'div', {});
    facts.appendChild(
      dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: `File: ${file.filename || 'unknown'} · ${info.mime}${info.exif.orientation ? ` · EXIF orientation ${info.exif.orientation} (${ORIENTATION_LABELS[info.exif.orientation] || 'unknown'})` : ''}`,
      }),
    );
    facts.appendChild(
      dialogEl(doc, 'p', {
        className: 'siat-desc',
        text: info.removes.length
          ? `Stripping would remove: ${info.removes.join(', ')}. Image pixels are copied, never re-encoded.`
          : 'Nothing removable was found; a stripped copy would be byte-identical.',
      }),
    );
    summary.appendChild(facts);
    tableHost.appendChild(summary);

    tableHost.appendChild(
      dialogTable(doc, {
        head: ['What', 'Value', 'Where it lives'],
        caption: 'Metadata found in this file',
        emptyText: 'No EXIF, XMP, ICC or comment data was found.',
        rows: info.findings.map((finding) => [
          { text: finding.label + (finding.sensitive ? ' ⚠' : '') },
          { text: truncate(String(finding.detail === undefined ? '' : finding.detail), 120) },
          { text: finding.where || '' },
        ]),
      }),
    );
  }

  function renderEmpty() {
    if (!tableHost) return;
    tableHost.textContent = '';
    tableHost.appendChild(dialogEl(doc, 'p', { className: 'siat-empty', text: 'No metadata information is available for this image.' }));
    dialog.showBanner('', '', []);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = String(text || '');
  }

  return {
    open(nextTarget) {
      target = nextTarget || null;
      loaded = null;
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
    /** Automation seam: the file bytes and MIME the inspector is showing. */
    state: () => ({ loaded: loaded ? { mime: loaded.mime, filename: loaded.filename, bytes: loaded.bytes.length } : null }),
    destroy() {
      generation += 1;
      loaded = null;
      dialog.destroy();
    },
  };
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function inspectorFormatSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
