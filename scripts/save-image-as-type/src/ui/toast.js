import { guardUserEvent } from './events.js';
import { ACCESSIBILITY_STYLE } from './accessibility.js';
/**
 * Status/error toasts.
 *
 * Rendered inside a closed-by-default shadow root so hostile or aggressive page
 * CSS cannot restyle or hide it, and so our styles cannot leak into the page.
 * Text is only ever written with textContent — the file name, the image URL and
 * the page's own strings all pass through here, so an innerHTML sink would be an
 * injection hole.
 *
 * Accessibility: progress uses role="status" (polite), failures use role="alert"
 * (assertive), the details disclosure is a real <details>/<summary>, and the
 * toast never steals focus (it is supplementary to the menu the user just used).
 */

const TOAST_HOST_ID = 'siat-toast-host';
// Hard bound on how many toasts are on screen at once. Older ones are dropped
// rather than queued: a notification stack that grows covers the page.
const MAX_VISIBLE_TOASTS = 4;
const TOAST_STYLE = `
:host { all: initial; }
.siat-toast-stack {
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
  font: max(0.8125rem, 13px)/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-width: min(92vw, 420px); pointer-events: none;
}
.siat-toast {
  pointer-events: auto; background: #1f2430; color: #f4f6fb;
  border: 1px solid rgba(255,255,255,.14); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.35); padding: 10px 12px;
  display: flex; gap: 10px; align-items: flex-start; min-width: 220px;
}
.siat-toast[data-kind="error"] { border-color: #b4232a; background: #2a1416; }
.siat-toast[data-kind="progress"] { border-color: #2c4a7c; }
.siat-badge { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; }
.siat-body { flex: 1 1 auto; min-width: 0; }
.siat-title { font-weight: 650; letter-spacing: .1px; }
.siat-meta { color: #c3cad8; font-size: max(0.75rem, 12px); margin-top: 2px; word-break: break-word; }
.siat-close {
  flex: 0 0 auto; background: transparent; border: 0; color: #c3cad8; cursor: pointer;
  font-size: max(1rem, 16px); line-height: 1; padding: 2px 4px; border-radius: 6px;
}
.siat-close:hover { background: rgba(255,255,255,.12); color: #fff; }
.siat-close:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 1px; }
.siat-details { margin-top: 6px; }
.siat-details summary { cursor: pointer; color: #9fb3d9; font-size: max(0.75rem, 12px); user-select: none; }
.siat-details ul { margin: 6px 0 0; padding-left: 18px; color: #d7dce6; font-size: max(0.75rem, 12px); }
.siat-details li { margin-bottom: 3px; }
.siat-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.siat-btn {
  background: #2f6fdb; color: #fff; border: 0; border-radius: 7px; padding: 5px 10px;
  font: inherit; font-size: max(0.75rem, 12px); cursor: pointer;
}
.siat-btn[data-variant="ghost"] { background: rgba(255,255,255,.1); color: #e8ecf5; }
.siat-btn:hover { filter: brightness(1.08); }
.siat-btn:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 2px; }
.siat-spinner { transform-origin: 50% 50%; animation: siat-spin 1s linear infinite; }
@keyframes siat-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .siat-spinner { animation: none; } }
@media (max-width: 560px) {
  .siat-toast-stack { left: 8px; right: 8px; bottom: 8px; align-items: stretch; max-width: none; }
}
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Icons are built with createElementNS rather than innerHTML: this script runs
 * on arbitrary pages and the project keeps a hard "no HTML sinks" rule (enforced
 * by lint.mjs), so there is no path by which page text could reach a parser.
 */
function svgIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'siat-badge');
  const add = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    svg.appendChild(el);
    return el;
  };
  if (kind === 'progress') {
    add('circle', {
      class: 'siat-spinner', cx: 9, cy: 9, r: 7, fill: 'none', stroke: '#7aa2f7',
      'stroke-width': 2.4, 'stroke-dasharray': '30 14', 'stroke-linecap': 'round',
    });
  } else if (kind === 'error') {
    add('path', { d: 'M9 2.6 16.2 15H1.8z', fill: 'none', stroke: '#ff8f8f', 'stroke-width': 1.7, 'stroke-linejoin': 'round' });
    add('path', { d: 'M9 7v3.4', stroke: '#ff8f8f', 'stroke-width': 1.8, 'stroke-linecap': 'round' });
    add('circle', { cx: 9, cy: 12.7, r: 0.95, fill: '#ff8f8f' });
  } else {
    add('path', { d: 'M3 9.5 7 13.5 15 4.5', fill: 'none', stroke: '#59d98a', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  }
  return svg;
}

export function createToaster(rootDocument = document) {
  let host = null;
  let shadow = null;
  let stack = null;
  const active = new Map();

  function ensureHost() {
    if (host && host.isConnected) return;
    host = rootDocument.getElementById(TOAST_HOST_ID);
    if (!host) {
      host = rootDocument.createElement('div');
      host.id = TOAST_HOST_ID;
      shadow = host.attachShadow({ mode: 'open' });
      const style = rootDocument.createElement('style');
      style.textContent = TOAST_STYLE + ACCESSIBILITY_STYLE;
      stack = rootDocument.createElement('div');
      stack.className = 'siat-toast-stack';
      shadow.appendChild(style);
      shadow.appendChild(stack);
      (rootDocument.documentElement || rootDocument.body).appendChild(host);
    } else if (!shadow) {
      shadow = host.shadowRoot;
      stack = shadow.querySelector('.siat-toast-stack');
    }
  }

  function dismiss(id) {
    const entry = active.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    try {
      entry.node.remove();
    } catch {
      /* noop */
    }
    active.delete(id);
  }

  function render(id, { kind, title, meta, notes, actions, ttl }) {
    ensureHost();
    const existing = active.get(id);
    if (existing) {
      clearTimeout(existing.timer);
      existing.node.remove();
      active.delete(id);
    }
    const node = rootDocument.createElement('div');
    node.className = 'siat-toast';
    node.dataset.kind = kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');

    node.appendChild(svgIcon(kind));

    const body = rootDocument.createElement('div');
    body.className = 'siat-body';
    const titleNode = rootDocument.createElement('div');
    titleNode.className = 'siat-title';
    titleNode.textContent = title;
    body.appendChild(titleNode);

    if (meta) {
      const metaNode = rootDocument.createElement('div');
      metaNode.className = 'siat-meta';
      metaNode.textContent = meta;
      body.appendChild(metaNode);
    }
    if (notes && notes.length) {
      const details = rootDocument.createElement('details');
      details.className = 'siat-details';
      const summary = rootDocument.createElement('summary');
      summary.textContent = `${notes.length} detail${notes.length === 1 ? '' : 's'}`;
      const list = rootDocument.createElement('ul');
      for (const note of notes) {
        const li = rootDocument.createElement('li');
        li.textContent = String(note);
        list.appendChild(li);
      }
      details.appendChild(summary);
      details.appendChild(list);
      body.appendChild(details);
    }
    if (actions && actions.length) {
      const row = rootDocument.createElement('div');
      row.className = 'siat-actions';
      for (const action of actions) {
        const button = rootDocument.createElement('button');
        button.type = 'button';
        button.className = 'siat-btn';
        if (action.variant) button.dataset.variant = action.variant;
        button.textContent = action.label;
        button.addEventListener('click', guardUserEvent(() => {
          dismiss(id);
          try {
            action.onClick();
          } catch {
            /* a broken action must not break the toast */
          }
        }));
        row.appendChild(button);
      }
      body.appendChild(row);
    }
    node.appendChild(body);

    const close = rootDocument.createElement('button');
    close.type = 'button';
    close.className = 'siat-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', guardUserEvent(() => dismiss(id)));
    node.appendChild(close);

    stack.appendChild(node);
    const entry = { node, timer: null };
    active.set(id, entry);
    if (ttl) entry.timer = setTimeout(() => dismiss(id), ttl);
    // Never let toasts pile up without bound. The stack element can be shared
    // with a second instance of this script (installed in two managers, or
    // re-injected), so the bound is enforced on the nodes actually on screen
    // rather than only on this instance's own entries: the oldest node goes,
    // whoever owns it.
    while (stack.children.length > MAX_VISIBLE_TOASTS) {
      const oldestNode = stack.firstElementChild;
      if (!oldestNode || oldestNode === node) break;
      const owner = [...active].find(([, candidate]) => candidate.node === oldestNode);
      if (owner) dismiss(owner[0]);
      else oldestNode.remove();
    }
    return id;
  }

  return {
    progress(id, title, meta, notes, actions, ttl = 0) {
      return render(id, { kind: 'progress', title, meta, notes, actions, ttl });
    },
    success(id, title, meta, notes, actions, ttl = 9000) {
      return render(id, { kind: 'success', title, meta, notes, actions, ttl });
    },
    error(id, title, meta, notes, actions, ttl = 14000) {
      return render(id, { kind: 'error', title, meta, notes, actions, ttl });
    },
    dismiss,
    dismissAll() {
      for (const id of [...active.keys()]) dismiss(id);
    },
    get element() {
      ensureHost();
      return host;
    },
    destroy() {
      this.dismissAll();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      stack = null;
    },
  };
}

