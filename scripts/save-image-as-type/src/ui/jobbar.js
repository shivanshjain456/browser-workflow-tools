import { guardUserEvent } from './events.js';
import { ACCESSIBILITY_STYLE } from './accessibility.js';
/**
 * Batch job bar.
 *
 * A long-running, many-step action needs visible state: how far along it is,
 * which item failed and why, and a way to stop. This is that surface.
 *
 * Placement is bottom-left because toasts already own bottom-right; the bar is
 * collapsible so it cannot trap the user, and it never intercepts pointer events
 * outside its own box.
 *
 * Accessibility: the summary line is an aria-live region (polite — a batch of
 * 200 items must not become a machine-gun announcement), the progress element
 * carries real valuemin/valuemax/valuenow, and every control is a real button.
 * Per-item rows live in a disclosure so the DOM stays bounded.
 */

import { dialogEl, dialogButton } from './dialog.js';

const JOBBAR_HOST_ID = 'siat-jobbar-host';
const MAX_ROWS = 40;

const JOBBAR_STYLE = `
.siat-jobbar {
  position: fixed; left: 14px; bottom: 14px; z-index: 2147483645;
  width: min(360px, calc(100vw - 28px)); max-height: min(60vh, 460px);
  display: flex; flex-direction: column;
  background: #fff; color: #16181d; border: 1px solid rgba(0,0,0,.16); border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0,0,0,.34); overflow: hidden;
  font: max(0.78125rem, 12.5px)/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .siat-jobbar { background: #1e2128; color: #edf0f6; border-color: rgba(255,255,255,.16); }
}
.siat-jobbar[data-collapsed="true"] .siat-jobbar-body { display: none; }
.siat-jobbar-head { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-bottom: 1px solid rgba(127,127,127,.22); }
.siat-jobbar-title { font-weight: 680; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.siat-jobbar-body { padding: 9px 11px 11px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.siat-jobbar-bar { height: 7px; border-radius: 999px; background: rgba(127,127,127,.22); overflow: hidden; }
.siat-jobbar-fill { height: 100%; width: 0%; background: #2f6fdb; transition: width .18s ease; }
.siat-jobbar-fill[data-state="done"] { background: #1a7f37; }
.siat-jobbar-fill[data-state="cancelled"] { background: #b4232a; }
.siat-jobbar-status { color: #5c6472; font-size: max(0.75rem, 12px); }
@media (prefers-color-scheme: dark) { .siat-jobbar-status { color: #a3acbb; } }
.siat-jobbar-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.siat-jobbar-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.siat-jobbar-item { display: flex; gap: 7px; align-items: baseline; font-size: max(0.75rem, 12px); }
.siat-jobbar-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.siat-jobbar-item-state { flex: 0 0 auto; font-weight: 650; }
.siat-jobbar-item-state[data-state="done"] { color: #1a7f37; }
.siat-jobbar-item-state[data-state="failed"] { color: #b4232a; }
.siat-jobbar-item-state[data-state="running"] { color: #2f6fdb; }
.siat-jobbar-item-state[data-state="skipped"], .siat-jobbar-item-state[data-state="cancelled"] { color: #6b7280; }
@media (prefers-color-scheme: dark) {
  .siat-jobbar-item-state[data-state="done"] { color: #56d364; }
  .siat-jobbar-item-state[data-state="failed"] { color: #ff8f8f; }
}
.siat-jobbar details summary { cursor: pointer; font-size: max(0.75rem, 12px); color: #5c6472; }
@media (prefers-color-scheme: dark) { .siat-jobbar details summary { color: #a3acbb; } }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onCancel]
 * @param {() => void} [deps.onRetry]
 * @param {() => void} [deps.onClose]
 */
export function createJobBar(deps = {}) {
  const doc = deps.document || document;
  let host = null;
  let shadow = null;
  let bar = null;
  let titleEl = null;
  let fillEl = null;
  let progressEl = null;
  let statusEl = null;
  let listEl = null;
  let listWrap = null;
  let summaryEl = null;
  let cancelButton = null;
  let retryButton = null;
  let closeButton = null;
  let collapseButton = null;
  let attached = false;
  let lastStats = null;

  function ensureHost() {
    if (host && host.isConnected && shadow) return;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(JOBBAR_HOST_ID) : null;
    if (existing) existing.remove();
    host = doc.createElement('div');
    host.id = JOBBAR_HOST_ID;
    host.setAttribute('data-siat', 'jobbar');
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = ':host { all: initial; }\n' + JOBBAR_STYLE + ACCESSIBILITY_STYLE;
    shadow.appendChild(style);
    const root = doc.documentElement || doc.body;
    if (root) root.appendChild(host);
    build();
  }

  function build() {
    bar = dialogEl(doc, 'div', { className: 'siat-jobbar', attrs: { role: 'group', 'aria-label': 'Batch conversion progress' } });

    const head = dialogEl(doc, 'div', { className: 'siat-jobbar-head' });
    titleEl = dialogEl(doc, 'span', { className: 'siat-jobbar-title', text: 'Batch conversion' });
    head.appendChild(titleEl);
    collapseButton = dialogEl(doc, 'button', {
      className: 'siat-icon-btn',
      text: '–',
      attrs: { type: 'button', 'aria-label': 'Collapse progress panel', 'aria-expanded': 'true' },
    });
    collapseButton.addEventListener('click', guardUserEvent(() => {
      const collapsed = bar.dataset.collapsed === 'true';
      bar.dataset.collapsed = collapsed ? 'false' : 'true';
      collapseButton.textContent = collapsed ? '–' : '+';
      collapseButton.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
      collapseButton.setAttribute('aria-label', collapsed ? 'Collapse progress panel' : 'Expand progress panel');
    }));
    head.appendChild(collapseButton);
    bar.appendChild(head);

    const body = dialogEl(doc, 'div', { className: 'siat-jobbar-body' });

    const barTrack = dialogEl(doc, 'div', { className: 'siat-jobbar-bar' });
    fillEl = dialogEl(doc, 'div', { className: 'siat-jobbar-fill' });
    barTrack.appendChild(fillEl);
    progressEl = barTrack;
    body.appendChild(barTrack);

    statusEl = dialogEl(doc, 'div', { className: 'siat-jobbar-status', attrs: { role: 'status', 'aria-live': 'polite', id: 'siat-jobbar-status' } });
    statusEl.textContent = 'Preparing…';
    body.appendChild(statusEl);

    const actions = dialogEl(doc, 'div', { className: 'siat-jobbar-actions' });
    cancelButton = dialogButton(doc, 'Cancel', 'danger', () => {
      if (typeof deps.onCancel === 'function') deps.onCancel();
    });
    cancelButton.id = 'siat-jobbar-cancel';
    retryButton = dialogButton(doc, 'Retry failed', 'ghost', () => {
      if (typeof deps.onRetry === 'function') deps.onRetry();
    });
    retryButton.id = 'siat-jobbar-retry';
    retryButton.disabled = true;
    closeButton = dialogButton(doc, 'Close', 'ghost', () => {
      hide();
      if (typeof deps.onClose === 'function') deps.onClose();
    });
    closeButton.id = 'siat-jobbar-close';
    closeButton.style.display = 'none';
    actions.appendChild(cancelButton);
    actions.appendChild(retryButton);
    actions.appendChild(closeButton);
    body.appendChild(actions);

    listWrap = doc.createElement('details');
    summaryEl = doc.createElement('summary');
    summaryEl.textContent = 'Details';
    summaryEl.id = 'siat-jobbar-summary';
    listWrap.appendChild(summaryEl);
    listEl = dialogEl(doc, 'ul', { className: 'siat-jobbar-list', attrs: { 'aria-label': 'Per-image results' } });
    listEl.id = 'siat-jobbar-list';
    listWrap.appendChild(listEl);
    body.appendChild(listWrap);

    bar.appendChild(body);
    shadow.appendChild(bar);
  }

  /** Make the bar visible and reset it for a new run. */
  function show(title) {
    ensureHost();
    attached = true;
    host.style.display = '';
    bar.dataset.collapsed = 'false';
    if (collapseButton) collapseButton.textContent = '–';
    titleEl.textContent = String(title || 'Batch conversion');
    statusEl.textContent = 'Preparing…';
    fillEl.style.width = '0%';
    fillEl.dataset.state = 'running';
    listEl.textContent = '';
    listWrap.open = false;
    summaryEl.textContent = 'Details';
    cancelButton.disabled = false;
    cancelButton.style.display = '';
    retryButton.disabled = true;
    closeButton.style.display = 'none';
    return bar;
  }

  function summaryText() {
    if (!lastStats) return 'Details';
    const parts = [];
    if (lastStats.done) parts.push(`${lastStats.done} saved`);
    if (lastStats.failed) parts.push(`${lastStats.failed} failed`);
    if (lastStats.skipped) parts.push(`${lastStats.skipped} skipped`);
    if (lastStats.cancelled) parts.push(`${lastStats.cancelled} cancelled`);
    if (lastStats.queued || lastStats.running) parts.push(`${lastStats.queued + lastStats.running} to go`);
    return parts.length ? `Details (${parts.join(', ')})` : 'Details';
  }

  /**
   * Update from a queue snapshot. Cheap enough to call per item: rows are capped
   * and only the visible slice is rewritten.
   */
  function update(stats, items) {
    if (!attached || !bar) return;
    lastStats = stats;
    const total = Math.max(1, stats.total || 1);
    const finished = (stats.done || 0) + (stats.failed || 0) + (stats.skipped || 0) + (stats.cancelled || 0);
    const percent = Math.min(100, Math.round((finished / total) * 100));
    fillEl.style.width = `${percent}%`;
    progressEl.setAttribute('role', 'progressbar');
    progressEl.setAttribute('aria-valuemin', '0');
    progressEl.setAttribute('aria-valuemax', String(total));
    progressEl.setAttribute('aria-valuenow', String(finished));
    progressEl.setAttribute('aria-labelledby', 'siat-jobbar-status');

    const bits = [`${finished}/${total}`];
    if (stats.running) bits.push(`${stats.running} running`);
    if (stats.done) bits.push(`${stats.done} saved`);
    if (stats.failed) bits.push(`${stats.failed} failed`);
    if (stats.skipped) bits.push(`${stats.skipped} skipped`);
    if (stats.cancelled) bits.push(`${stats.cancelled} cancelled`);
    if (stats.bytes) bits.push(formatSize(stats.bytes));
    statusEl.textContent = `${titleEl.textContent}: ${bits.join(' · ')}`;

    if (summaryEl) summaryEl.textContent = summaryText();
    const interesting = (items || []).filter((item) => item.state !== 'queued').slice(-MAX_ROWS);
    listEl.textContent = '';
    for (const item of interesting) {
      const row = dialogEl(doc, 'li', { className: 'siat-jobbar-item' });
      const name = dialogEl(doc, 'span', { className: 'siat-jobbar-item-name', text: item.label });
      name.title = item.state === 'failed' ? `${item.label}: ${item.error || item.errorCode}` : item.label;
      row.appendChild(name);
      row.appendChild(
        dialogEl(doc, 'span', {
          className: 'siat-jobbar-item-state',
          dataset: { state: item.state },
          text: stateLabel(item),
        }),
      );
      listEl.appendChild(row);
    }

    const running = stats.state === 'running' || stats.state === 'paused';
    cancelButton.disabled = !running;
    cancelButton.style.display = running ? '' : 'none';
    retryButton.disabled = !(stats.failed > 0);
    retryButton.style.display = stats.failed > 0 ? '' : 'none';
    if (stats.complete || stats.state === 'cancelled' || stats.state === 'done') {
      closeButton.style.display = '';
      fillEl.dataset.state = stats.cancelled ? 'cancelled' : stats.failed ? 'done' : 'done';
    }
  }

  function stateLabel(item) {
    if (item.state === 'done') return 'saved';
    if (item.state === 'failed') return item.uncertain ? 'unknown' : 'failed';
    if (item.state === 'skipped') return 'skipped';
    if (item.state === 'cancelled') return 'cancelled';
    if (item.state === 'running') return 'working…';
    return 'queued';
  }

  /** Replace the status line with a final summary and show the Close button. */
  function finish(summaryTextValue, { failed = 0 } = {}) {
    if (!attached || !statusEl) return;
    statusEl.textContent = String(summaryTextValue || 'Finished.');
    cancelButton.style.display = 'none';
    cancelButton.disabled = true;
    closeButton.style.display = '';
    retryButton.disabled = !(failed > 0);
    retryButton.style.display = failed > 0 ? '' : 'none';
    fillEl.dataset.state = failed ? 'done' : 'done';
  }

  function hide() {
    attached = false;
    if (host) host.style.display = 'none';
  }

  return {
    show,
    update,
    finish,
    hide,
    get isOpen() {
      return attached;
    },
    get element() {
      return bar;
    },
    get shadowRoot() {
      return shadow;
    },
    get host() {
      return host;
    },
    destroy() {
      hide();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      bar = null;
      attached = false;
      lastStats = null;
    },
  };
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}
