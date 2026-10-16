import { guardUserEvent } from './events.js';
import { ACCESSIBILITY_STYLE } from './accessibility.js';
/**
 * Shared modal-dialog kit.
 *
 * Every dialog this script shows (settings, image picker, transform, format
 * comparison, metadata inspector, batch confirmation, shortcut help) needs the
 * same shell: a shadow
 * root for stylesheet isolation (open roots are page-readable), a backdrop, role="dialog" + aria-modal, a
 * focus trap, Escape to close, focus restored to whatever had it before, and the
 * same visual language. Building that five times is how dialogs drift apart, so
 * it lives here once.
 *
 * Isolation and safety rules, inherited from the settings panel:
 *   - one host element per dialog id; a second injection adopts (removes) the
 *     previous host rather than stacking listeners;
 *   - all content is created with createElement/textContent — page-derived
 *     strings (file names, alt text, EXIF values) are never parsed as markup;
 *   - listeners are tracked and removed on close, so a dialog opened and closed
 *     fifty times leaves nothing behind.
 */

export const DIALOG_STYLE = `
:host { all: initial; }
.siat-backdrop {
  position: fixed; inset: 0; z-index: 2147483646; background: rgba(10,12,18,.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.siat-dialog {
  width: min(680px, 100%); max-height: min(88vh, 780px); overflow: auto; overscroll-behavior: contain;
  background: #fff; color: #16181d; border-radius: 14px;
  border: 1px solid rgba(0,0,0,.14); box-shadow: 0 24px 60px rgba(0,0,0,.4);
  font: max(0.84375rem, 13.5px)/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.siat-dialog[data-width="wide"] { width: min(980px, 100%); }
.siat-dialog[data-width="narrow"] { width: min(460px, 100%); }
@media (prefers-color-scheme: dark) {
  .siat-dialog { background: #1e2128; color: #edf0f6; border-color: rgba(255,255,255,.14); }
}
.siat-dialog-head {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; background: inherit; border-bottom: 1px solid rgba(127,127,127,.25);
}
.siat-dialog-titles { flex: 1 1 auto; min-width: 0; }
.siat-dialog-title { font-size: max(0.9375rem, 15px); font-weight: 680; margin: 0; }
.siat-dialog-subtitle { font-size: max(0.75rem, 12px); color: #5c6472; margin: 2px 0 0; overflow-wrap: anywhere; }
@media (prefers-color-scheme: dark) { .siat-dialog-subtitle { color: #a3acbb; } }
.siat-icon-btn {
  background: transparent; border: 0; color: inherit; cursor: pointer; font-size: max(1.25rem, 20px);
  line-height: 1; padding: 4px 8px; border-radius: 8px; flex: 0 0 auto;
}
.siat-icon-btn:hover { background: rgba(127,127,127,.18); }
.siat-icon-btn:focus-visible, .siat-field input:focus-visible, .siat-field select:focus-visible,
.siat-check:focus-visible, .siat-btn:focus-visible, .siat-radio:focus-visible,
.siat-row:focus-visible, .siat-listbox:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid #2f6fdb; outline-offset: 2px;
}
.siat-body { padding: 4px 16px 16px; }
.siat-section { border: 0; padding: 12px 0 4px; margin: 0; border-bottom: 1px solid rgba(127,127,127,.2); }
.siat-section:last-of-type { border-bottom: 0; }
.siat-legend { font-weight: 680; font-size: max(0.8125rem, 13px); padding: 0; margin-bottom: 8px; }
.siat-desc { color: #5c6472; font-size: max(0.75rem, 12px); margin: -4px 0 10px; }
@media (prefers-color-scheme: dark) { .siat-desc { color: #a3acbb; } }
.siat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 6px 14px; }
.siat-check {
  display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: 8px; cursor: pointer;
}
.siat-check:hover { background: rgba(127,127,127,.1); }
.siat-check input { margin-top: 2px; flex: 0 0 auto; }
.siat-check-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.siat-check-label { font-weight: 620; }
.siat-check-hint { color: #5c6472; font-size: max(0.75rem, 12px); }
@media (prefers-color-scheme: dark) { .siat-check-hint { color: #a3acbb; } }
.siat-check[data-unavailable="true"] { opacity: .55; }
.siat-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.siat-field > label { font-weight: 620; font-size: max(0.78125rem, 12.5px); }
.siat-field input[type="text"], .siat-field input[type="number"], .siat-field input[type="search"], .siat-field select {
  font: inherit; padding: 7px 9px; border-radius: 8px; color: inherit;
  border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.06); max-width: 320px;
}
.siat-field small { color: #5c6472; font-size: max(0.75rem, 12px); }
@media (prefers-color-scheme: dark) { .siat-field small { color: #a3acbb; } }
.siat-radios { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.siat-radio { display: flex; gap: 6px; align-items: center; padding: 4px 6px; border-radius: 8px; cursor: pointer; }
.siat-radio:hover { background: rgba(127,127,127,.1); }
.siat-banner {
  margin: 10px 0 0; padding: 9px 11px; border-radius: 9px; font-size: max(0.78125rem, 12.5px);
  background: rgba(214,158,46,.14); border: 1px solid rgba(214,158,46,.5);
}
.siat-banner[data-kind="error"] { background: rgba(180,35,42,.14); border-color: rgba(180,35,42,.55); }
.siat-banner[data-kind="ok"] { background: rgba(26,127,55,.14); border-color: rgba(26,127,55,.5); }
.siat-banner ul { margin: 6px 0 0; padding-left: 18px; }
.siat-table { width: 100%; border-collapse: collapse; font-size: max(0.78125rem, 12.5px); }
.siat-table th, .siat-table td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid rgba(127,127,127,.2); }
.siat-table th { font-weight: 620; color: #5c6472; }
.siat-table td[data-num="true"] { text-align: right; font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) { .siat-table th { color: #a3acbb; } }
.siat-yes { color: #1a7f37; font-weight: 650; }
.siat-no { color: #b4232a; font-weight: 650; }
@media (prefers-color-scheme: dark) { .siat-yes { color: #56d364; } .siat-no { color: #ff8f8f; } }
.siat-foot {
  position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 12px 16px; background: inherit; border-top: 1px solid rgba(127,127,127,.25);
}
.siat-spacer { flex: 1 1 auto; }
.siat-btn {
  font: inherit; font-size: max(0.78125rem, 12.5px); padding: 8px 13px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.08); color: inherit;
}
.siat-btn[data-variant="primary"] { background: #2f6fdb; border-color: #2f6fdb; color: #fff; font-weight: 620; }
.siat-btn[data-variant="danger"] { background: rgba(180,35,42,.9); border-color: rgba(180,35,42,.9); color: #fff; font-weight: 620; }
.siat-btn:hover { filter: brightness(1.06); }
.siat-btn:disabled { opacity: .5; cursor: default; filter: none; }
.siat-note { font-size: max(0.75rem, 12px); color: #5c6472; }
@media (prefers-color-scheme: dark) { .siat-note { color: #a3acbb; } }
.siat-live { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.siat-listbox { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow: auto; }
.siat-row {
  display: flex; gap: 10px; align-items: center; padding: 7px 8px; border-radius: 9px;
  border-bottom: 1px solid rgba(127,127,127,.16); cursor: pointer;
}
.siat-row:hover { background: rgba(127,127,127,.1); }
.siat-row[data-selected="true"] { background: rgba(47,111,219,.16); }
.siat-row-thumb {
  width: 44px; height: 44px; flex: 0 0 auto; border-radius: 6px; object-fit: contain;
  background: repeating-conic-gradient(#d9dce2 0% 25%, #f4f5f8 0% 50%) 50% / 12px 12px;
  border: 1px solid rgba(127,127,127,.3);
}
@media (prefers-color-scheme: dark) {
  .siat-row-thumb { background: repeating-conic-gradient(#2b2f37 0% 25%, #23262d 0% 50%) 50% / 12px 12px; }
}
.siat-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.siat-row-title { font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.siat-row-meta { font-size: max(0.75rem, 12px); color: #5c6472; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-color-scheme: dark) { .siat-row-meta { color: #a3acbb; } }
.siat-badge {
  display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: max(0.75rem, 12px); font-weight: 650;
  background: rgba(127,127,127,.18); border: 1px solid rgba(127,127,127,.3);
}
.siat-badge[data-tone="warn"] { background: rgba(214,158,46,.2); border-color: rgba(214,158,46,.55); }
.siat-badge[data-tone="bad"] { background: rgba(180,35,42,.18); border-color: rgba(180,35,42,.5); }
.siat-badge[data-tone="good"] { background: rgba(26,127,55,.18); border-color: rgba(26,127,55,.5); }
.siat-empty { padding: 26px 12px; text-align: center; color: #5c6472; font-size: max(0.78125rem, 12.5px); }
@media (prefers-color-scheme: dark) { .siat-empty { color: #a3acbb; } }
.siat-preview {
  display: flex; align-items: center; justify-content: center; gap: 12px; padding: 10px;
  background: repeating-conic-gradient(#dfe2e8 0% 25%, #f6f7f9 0% 50%) 50% / 16px 16px;
  border: 1px solid rgba(127,127,127,.3); border-radius: 10px; min-height: 120px;
}
@media (prefers-color-scheme: dark) {
  .siat-preview { background: repeating-conic-gradient(#2b2f37 0% 25%, #23262d 0% 50%) 50% / 16px 16px; }
}
.siat-preview img, .siat-preview canvas { max-width: 100%; max-height: 34vh; display: block; }
.siat-cropwrap { position: relative; display: inline-block; line-height: 0; touch-action: none; }
.siat-cropbox {
  position: absolute; border: 2px solid #2f6fdb; background: rgba(47,111,219,.14);
  box-shadow: 0 0 0 9999px rgba(10,12,18,.42); cursor: move;
}
.siat-crophandle {
  position: absolute; width: 12px; height: 12px; background: #fff; border: 1px solid #2f6fdb; border-radius: 2px;
}
@media (max-width: 520px) {
  .siat-backdrop { padding: 0; align-items: flex-end; }
  .siat-dialog { border-radius: 14px 14px 0 0; max-height: 92vh; }
}
`;

/** Create an element with class/text/attributes in one call. */
export function dialogEl(doc, tag, options = {}) {
  const node = doc.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  if (options.id) node.id = options.id;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === undefined || value === null || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (value === undefined || value === null) continue;
      node.dataset[key] = String(value);
    }
  }
  if (Array.isArray(options.children)) {
    for (const child of options.children) if (child) node.appendChild(child);
  }
  return node;
}

export function dialogButton(doc, label, variant, handler, options = {}) {
  const node = dialogEl(doc, 'button', { className: 'siat-btn', text: label, attrs: { type: 'button' } });
  if (variant) node.dataset.variant = variant;
  if (options.title) node.title = options.title;
  if (options.disabled) node.disabled = true;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, String(value));
  }
  if (typeof handler === 'function') node.addEventListener('click', guardUserEvent(handler));
  return node;
}

export function dialogSection(doc, legendText, description) {
  const fieldset = dialogEl(doc, 'fieldset', { className: 'siat-section' });
  fieldset.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: legendText }));
  if (description) fieldset.appendChild(dialogEl(doc, 'p', { className: 'siat-desc', text: description }));
  return fieldset;
}

export function dialogCheckboxRow(doc, { id, label, hint, checked, unavailable, onChange }) {
  const wrapper = dialogEl(doc, 'label', { className: 'siat-check' });
  if (unavailable) wrapper.dataset.unavailable = 'true';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  if (id) input.id = id;
  input.checked = Boolean(checked);
  if (unavailable) input.disabled = true;
  if (typeof onChange === 'function') input.addEventListener('change', guardUserEvent(() => onChange(input.checked)));
  wrapper.appendChild(input);
  const text = dialogEl(doc, 'span', { className: 'siat-check-text' });
  text.appendChild(dialogEl(doc, 'span', { className: 'siat-check-label', text: label }));
  if (hint) text.appendChild(dialogEl(doc, 'span', { className: 'siat-check-hint', text: hint }));
  wrapper.appendChild(text);
  return wrapper;
}

export function dialogField(doc, { id, label, hint, control }) {
  const wrapper = dialogEl(doc, 'div', { className: 'siat-field' });
  const labelEl = dialogEl(doc, 'label', { text: label, attrs: { for: id } });
  if (id) control.id = id;
  wrapper.appendChild(labelEl);
  wrapper.appendChild(control);
  if (hint) {
    const hintEl = dialogEl(doc, 'small', { text: hint, id: `${id}-hint` });
    control.setAttribute('aria-describedby', `${id}-hint`);
    wrapper.appendChild(hintEl);
  }
  return wrapper;
}

export function dialogTextControl(doc, value, attrs = {}) {
  const input = doc.createElement('input');
  input.type = attrs.type || 'text';
  input.value = value === undefined || value === null ? '' : String(value);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'type') continue;
    input.setAttribute(key, String(val));
  }
  return input;
}

export function dialogSelectControl(doc, options, value, onChange) {
  const select = doc.createElement('select');
  for (const option of options) {
    const node = dialogEl(doc, 'option', { text: option.label, attrs: { value: option.value } });
    if (option.disabled) node.disabled = true;
    if (String(option.value) === String(value)) node.selected = true;
    select.appendChild(node);
  }
  if (typeof onChange === 'function') select.addEventListener('change', guardUserEvent(() => onChange(select.value)));
  return select;
}

/**
 * A table built from plain strings. Rows are arrays of cells; a cell may be a
 * string or `{text, className, num}`. Never accepts HTML.
 */
export function dialogTable(doc, { head, rows, emptyText = 'Nothing to show.', caption }) {
  const table = dialogEl(doc, 'table', { className: 'siat-table' });
  if (caption) table.appendChild(dialogEl(doc, 'caption', { className: 'siat-live', text: caption }));
  if (Array.isArray(head) && head.length) {
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    for (const cell of head) {
      headRow.appendChild(dialogEl(doc, 'th', { text: cell && cell.scope ? cell.label : cell, attrs: { scope: 'col' } }));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
  }
  const tbody = doc.createElement('tbody');
  if (!rows || !rows.length) {
    const tr = doc.createElement('tr');
    const td = dialogEl(doc, 'td', { className: 'siat-empty', text: emptyText, attrs: { colspan: Math.max(1, (head || []).length) } });
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = doc.createElement('tr');
      for (const cell of row) {
        const spec = typeof cell === 'object' && cell !== null ? cell : { text: cell };
        const td = dialogEl(doc, 'td', { text: spec.text === undefined || spec.text === null ? '' : String(spec.text), className: spec.className });
        if (spec.num) td.dataset.num = 'true';
        if (spec.attrs) {
          for (const [key, value] of Object.entries(spec.attrs)) td.setAttribute(key, String(value));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  return table;
}

/**
 * Build (or rebuild) a dialog shell.
 *
 * `build` runs on every open, so a dialog always reflects current state instead
 * of a stale snapshot; listeners registered through the returned `on` are torn
 * down on close.
 */
export function createDialog(options = {}) {
  const doc = options.document || document;
  const hostId = options.hostId || 'siat-dialog-host';
  const marker = options.marker || 'dialog';
  const titleId = options.titleId || `${hostId}-title`;
  const describedId = options.describedBy || '';

  let host = null;
  let shadow = null;
  let backdrop = null;
  let dialog = null;
  let bannerHost = null;
  let liveRegion = null;
  let restoreFocus = null;
  let listeners = [];
  let openState = false;

  function on(target, type, handler, capture) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(type, guardUserEvent(handler), capture);
    listeners.push([target, type, handler, capture]);
    return () => {
      try {
        target.removeEventListener(type, guardUserEvent(handler), capture);
      } catch {
        /* noop */
      }
    };
  }

  function clearListeners() {
    for (const [target, type, handler, capture] of listeners) {
      try {
        target.removeEventListener(type, guardUserEvent(handler), capture);
      } catch {
        /* noop */
      }
    }
    listeners = [];
  }

  function ensureHost() {
    if (host && host.isConnected && shadow) return;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(hostId) : null;
    if (existing) existing.remove();
    host = doc.createElement('div');
    host.id = hostId;
    host.setAttribute('data-siat', marker);
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = DIALOG_STYLE + (options.extraStyle || '') + ACCESSIBILITY_STYLE;
    shadow.appendChild(style);
    liveRegion = dialogEl(doc, 'div', { className: 'siat-live', attrs: { 'aria-live': 'polite', role: 'status' } });
    shadow.appendChild(liveRegion);
    const root = doc.documentElement || doc.body;
    if (root) root.appendChild(host);
  }

  function buildShell() {
    backdrop = dialogEl(doc, 'div', { className: 'siat-backdrop' });
    on(backdrop, 'mousedown', (event) => {
      if (event.target === backdrop && options.dismissOnBackdrop !== false) closeDialog();
    });

    dialog = dialogEl(doc, 'div', {
      className: 'siat-dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    });
    if (describedId) dialog.setAttribute('aria-describedby', describedId);
    if (options.width) dialog.dataset.width = options.width;

    const head = dialogEl(doc, 'div', { className: 'siat-dialog-head' });
    const titles = dialogEl(doc, 'div', { className: 'siat-dialog-titles' });
    titles.appendChild(dialogEl(doc, 'h2', { className: 'siat-dialog-title', id: titleId, text: options.title || '' }));
    if (options.subtitle !== undefined) {
      titles.appendChild(dialogEl(doc, 'p', { className: 'siat-dialog-subtitle', id: `${titleId}-sub`, text: options.subtitle }));
    }
    head.appendChild(titles);
    head.appendChild(
      dialogEl(doc, 'button', {
        className: 'siat-icon-btn',
        text: '×',
        attrs: { type: 'button', 'aria-label': options.closeLabel || 'Close' },
      }),
    );
    head.lastChild.addEventListener('click', guardUserEvent(() => closeDialog()));
    dialog.appendChild(head);

    const body = dialogEl(doc, 'div', { className: 'siat-body' });
    bannerHost = dialogEl(doc, 'div', {});
    body.appendChild(bannerHost);
    dialog.appendChild(body);

    const foot = dialogEl(doc, 'div', { className: 'siat-foot' });
    dialog.appendChild(foot);

    backdrop.appendChild(dialog);
    shadow.appendChild(backdrop);

    return { head, titles, body, foot };
  }

  function showBanner(kind, title, lines) {
    if (!bannerHost) return;
    bannerHost.textContent = '';
    const messages = (Array.isArray(lines) ? lines : [lines]).filter((line) => line !== undefined && line !== null && String(line).trim() !== '');
    if (!title && !messages.length) return;
    const banner = dialogEl(doc, 'div', { className: 'siat-banner', attrs: { role: kind === 'error' ? 'alert' : 'status' } });
    banner.dataset.kind = String(kind || '');
    if (title) banner.appendChild(dialogEl(doc, 'strong', { text: title }));
    if (messages.length) {
      const list = dialogEl(doc, 'ul', {});
      for (const message of messages.slice(0, 12)) list.appendChild(dialogEl(doc, 'li', { text: message }));
      banner.appendChild(list);
    }
    bannerHost.appendChild(banner);
  }

  function announce(message) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    // A second write makes screen readers re-announce identical text.
    setTimeout(() => {
      if (liveRegion) liveRegion.textContent = String(message || '');
    }, 30);
  }

  function focusables() {
    if (!dialog) return [];
    const found = dialog.querySelectorAll('button, input, select, textarea, [href], summary, details, [tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(found, (node) => !node.disabled && node.offsetParent !== null);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = shadow && shadow.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog() {
    ensureHost();
    clearListeners();
    try {
      shadow.textContent = '';
    } catch {
      /* noop */
    }
    const style = doc.createElement('style');
    style.textContent = DIALOG_STYLE + (options.extraStyle || '') + ACCESSIBILITY_STYLE;
    shadow.appendChild(style);
    liveRegion = dialogEl(doc, 'div', { className: 'siat-live', attrs: { 'aria-live': 'polite', role: 'status' } });
    shadow.appendChild(liveRegion);

    if (typeof options.beforeBuild === 'function') options.beforeBuild();
    const parts = buildShell();
    const context = {
      doc,
      body: parts.body,
      foot: parts.foot,
      head: parts.head,
      dialog,
      shadowRoot: shadow,
      showBanner,
      announce,
      on,
      close: closeDialog,
      api,
    };
    if (typeof options.build === 'function') options.build(context);
    openState = true;
    restoreFocus = doc.activeElement;
    on(doc, 'keydown', onKeydown, true);
    if (typeof options.afterBuild === 'function') options.afterBuild(context);

    const mode = options.focus === undefined ? 'primary' : options.focus;
    const target =
      mode === 'none'
        ? null
        : mode === 'first'
          ? focusables()[0] || dialog
          : typeof mode === 'object' && mode
            ? mode
            : dialog.querySelector('[data-variant="primary"]') || focusables()[0] || dialog;
    setTimeout(() => {
      try {
        if (target && typeof target.focus === 'function') target.focus();
      } catch {
        /* noop */
      }
    }, 0);
    return context;
  }

  function closeDialog() {
    if (!openState && !backdrop) return;
    clearListeners();
    openState = false;
    if (typeof options.onClose === 'function') {
      try {
        options.onClose();
      } catch {
        /* a failing callback must not leave the dialog stuck open */
      }
    }
    if (shadow) {
      try {
        shadow.textContent = '';
      } catch {
        /* noop */
      }
    }
    backdrop = null;
    dialog = null;
    bannerHost = null;
    liveRegion = null;
    if (restoreFocus && restoreFocus.isConnected !== false) {
      try {
        restoreFocus.focus({ preventScroll: true });
      } catch {
        /* noop */
      }
    }
    restoreFocus = null;
  }

  const api = {
    open: openDialog,
    close: closeDialog,
    showBanner,
    announce,
    on,
    get isOpen() {
      return openState;
    },
    get host() {
      return host;
    },
    get shadowRoot() {
      return shadow;
    },
    get element() {
      return dialog;
    },
    setTitle(text) {
      if (!dialog) return;
      const node = dialog.querySelector(`#${titleId}`);
      if (node) node.textContent = String(text);
    },
    setSubtitle(text) {
      if (!dialog) return;
      const node = dialog.querySelector(`#${titleId}-sub`);
      if (node) node.textContent = String(text);
      else if (text) {
        const titles = dialog.querySelector('.siat-dialog-titles');
        if (titles) titles.appendChild(dialogEl(doc, 'p', { className: 'siat-dialog-subtitle', id: `${titleId}-sub`, text }));
      }
    },
    destroy() {
      closeDialog();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      listeners = [];
    },
  };

  return api;
}
