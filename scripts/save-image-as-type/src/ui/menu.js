import { guardUserEvent } from './events.js';
import { ACCESSIBILITY_STYLE } from './accessibility.js';
/**
 * The right-click menu.
 *
 * Design constraint, stated plainly because it changes the product: a userscript
 * has no access to `chrome.contextMenus`, so it cannot add an entry to the
 * browser's own right-click menu. What it can do is draw one. This module draws
 * a real menu (role="menu", arrow-key navigation, Escape, focus return) at the
 * pointer position, and only when the pointer is actually over an image — every
 * other right-click is left completely alone, so the browser's native menu still
 * appears everywhere else.
 *
 * Escape hatches for users who want the native menu on an image:
 *   - hold Shift while right-clicking (always available), or
 *   - turn on "Only open with Shift held" in settings, which inverts it.
 *
 * Isolation: the menu lives in a shadow root attached to a host element with a
 * namespaced id, so page CSS cannot restyle it and it cannot restyle the page.
 * All text goes through textContent.
 */

import { resolveImageTarget, describeTarget } from '../core/source.js';
import { getFormat } from '../core/formats.js';

const MENU_HOST_ID = 'siat-menu-host';
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 12;
const DOUBLE_OPEN_GUARD_MS = 700;
// A page often fires one or two `scroll` events *after* a right-click (smooth
// scrolling, `scrollIntoView`, layout settling). Dismissing on those makes the
// menu flash open and shut, so scroll-origin dismissals are ignored for a short
// grace period after opening. Resize/blur/pagehide still dismiss immediately.
const SCROLL_GRACE_MS = 150;

const MENU_STYLE = `
:host { all: initial; }
.siat-menu {
  position: fixed; z-index: 2147483647; min-width: 232px; max-width: min(90vw, 320px);
  max-height: min(72vh, 520px); overflow: auto; overscroll-behavior: contain;
  background: #ffffff; color: #16181d;
  border: 1px solid rgba(0,0,0,.14); border-radius: 11px;
  box-shadow: 0 12px 34px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.14);
  padding: 5px; margin: 0;
  font: max(0.8125rem, 13px)/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}
@media (prefers-color-scheme: dark) {
  .siat-menu { background: #22252c; color: #eef1f6; border-color: rgba(255,255,255,.16); }
}
.siat-head {
  padding: 6px 9px 7px; border-bottom: 1px solid rgba(127,127,127,.25); margin-bottom: 4px;
}
.siat-head-title { font-weight: 650; font-size: max(0.78125rem, 12.5px); }
.siat-head-sub { color: #5c6472; font-size: max(0.75rem, 12px); margin-top: 2px; word-break: break-all; }
@media (prefers-color-scheme: dark) { .siat-head-sub { color: #a7b0bf; } }
.siat-item {
  display: flex; align-items: baseline; gap: 8px; width: 100%; box-sizing: border-box;
  padding: 7px 9px; border: 0; border-radius: 8px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.siat-item:hover:not([aria-disabled="true"]), .siat-item.siat-active { background: rgba(47,111,219,.16); }
.siat-item:focus-visible { outline: 2px solid #2f6fdb; outline-offset: -2px; }
.siat-item[aria-disabled="true"] { opacity: .5; cursor: default; }
.siat-ext {
  flex: 0 0 auto; min-width: 46px; font-weight: 680; letter-spacing: .2px; font-size: max(0.78125rem, 12.5px);
}
.siat-hint { flex: 1 1 auto; color: #5c6472; font-size: max(0.75rem, 12px); }
@media (prefers-color-scheme: dark) { .siat-hint { color: #a7b0bf; } }
.siat-sep { height: 1px; background: rgba(127,127,127,.28); margin: 4px 6px; }
.siat-foot { padding: 6px 9px 3px; color: #6b7280; font-size: max(0.75rem, 12px); }
@media (prefers-color-scheme: dark) { .siat-foot { color: #9aa3b2; } }
.siat-busy { padding: 7px 9px; font-size: max(0.75rem, 12px); color: #2f6fdb; }
.siat-cancel {
  margin: 4px 6px 2px; width: calc(100% - 12px); padding: 6px 8px; border-radius: 8px;
  border: 1px solid rgba(180,35,42,.6); background: transparent; color: #b4232a;
  font: inherit; font-size: max(0.75rem, 12px); cursor: pointer;
}
.siat-cancel:hover { background: rgba(180,35,42,.12); }
.siat-cancel:focus-visible { outline: 2px solid #b4232a; outline-offset: 1px; }
`;

/**
 * @param {object} deps
 * @param {() => object} deps.getSettings          current normalised settings
 * @param {() => Array<{id:string,label:string,ext:string,hint:string,disabled?:string}>} deps.getMenuFormats
 * @param {(formatId:string, target:object) => void} deps.onPick
 * @param {() => Array<{id:string,label:string,hint?:string,disabled?:string}>} [deps.getMenuActions]
 *        Extra actions (copy, transform, compare, inspect, picker, batch). Which ones appear is a
 *        user setting, so the menu never grows past what somebody actually uses.
 * @param {(actionId:string, target:object) => void} [deps.onAction]
 * @param {() => void} deps.onOpenSettings
 * @param {() => void} [deps.onCancel]
 * @param {() => boolean} deps.isBusy
 */
export function createContextMenu(deps) {
  const doc = deps.document || document;
  let host = null;
  let shadow = null;
  let menu = null;
  let openState = null; // {target, items:[HTMLElement], index, restoreFocus}
  let lastHoveredElement = null;
  /** The format entries of the currently open menu, for digit type-ahead. */
  let openStateFormatItems = [];
  let stopLongPress = null;
  let longPressOpenedAt = 0;
  let openedAt = 0;
  let attached = false;
  const listeners = [];
  const menuActivations = new WeakMap();

  // Keyboard activation calls the same owned action directly. Calling .click()
  // here would manufacture an untrusted event and correctly hit the UI gate.
  function bindMenuActivation(button, action) {
    menuActivations.set(button, action);
    button.addEventListener('click', guardUserEvent(action));
  }
  function activateMenuItem(button, event) {
    const action = menuActivations.get(button);
    if (action) action(event);
  }


  function ensureHost() {
    if (host && host.isConnected && shadow) return;
    const existing = doc.getElementById(MENU_HOST_ID);
    if (existing && existing.shadowRoot) {
      // A previous instance — or the same script running in a second execution
      // world — left a host behind. Adopt that element instead of appending a
      // duplicate with the same id, and rebuild the internals so no stale node
      // or stylesheet is reused.
      host = existing;
      shadow = existing.shadowRoot;
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    } else {
      if (existing) existing.remove(); // a host without a shadow root is unusable
      host = doc.createElement('div');
      host.id = MENU_HOST_ID;
      host.setAttribute('data-siat', 'menu');
      shadow = host.attachShadow({ mode: 'open' });
      (doc.documentElement || doc.body).appendChild(host);
    }
    const style = doc.createElement('style');
    style.textContent = MENU_STYLE + ACCESSIBILITY_STYLE;
    shadow.appendChild(style);
    menu = doc.createElement('div');
    menu.className = 'siat-menu';
    menu.hidden = true;
    shadow.appendChild(menu);
  }

  function addListener(target, type, handler, options) {
    target.addEventListener(type, guardUserEvent(handler), options);
    listeners.push([target, type, handler, options]);
  }

  function itemElements() {
    return openState ? openState.items : [];
  }

  function setActive(index) {
    const items = itemElements();
    if (!items.length) return;
    const next = (index + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('siat-active', i === next));
    items[next].focus();
    if (openState) openState.index = next;
  }

  /**
   * Open the menu for a resolved target at viewport coordinates.
   * @returns {boolean} whether the menu is now open
   */
  function open(target, clientX, clientY, { trigger = 'contextmenu' } = {}) {
    const settings = deps.getSettings();
    if (!target) return false;
    ensureHost();
    close({ restoreFocus: false });

    const previousFocus = doc.activeElement;
    menu.textContent = '';
    menu.hidden = false;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Save image as');
    menu.setAttribute('aria-orientation', 'vertical');

    const head = doc.createElement('div');
    head.className = 'siat-head';
    const title = doc.createElement('div');
    title.className = 'siat-head-title';
    title.textContent = `Save ${describeTarget(target).toLowerCase()} as`;
    head.appendChild(title);
    const sub = doc.createElement('div');
    sub.className = 'siat-head-sub';
    sub.textContent = describeSource(target);
    head.appendChild(sub);
    menu.appendChild(head);

    const busy = Boolean(deps.isBusy && deps.isBusy());
    const formats = deps.getMenuFormats() || [];
    const items = [];

    if (busy) {
      const busyLine = doc.createElement('div');
      busyLine.className = 'siat-busy';
      busyLine.setAttribute('role', 'status');
      busyLine.textContent = 'Still converting the previous image…';
      menu.appendChild(busyLine);
    }

    for (const entry of formats) {
      const format = getFormat(entry.id);
      if (!format) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'siat-item';
      button.setAttribute('role', 'menuitem');
      const disabled = busy || Boolean(entry.disabled);
      if (disabled) button.setAttribute('aria-disabled', 'true');
      const ext = doc.createElement('span');
      ext.className = 'siat-ext';
      ext.textContent = format.id === 'original' ? 'Original' : format.label;
      button.appendChild(ext);
      const hint = doc.createElement('span');
      hint.className = 'siat-hint';
      hint.textContent = entry.disabled || format.hint;
      button.appendChild(hint);
      bindMenuActivation(button, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        const picked = openState ? openState.target : target;
        close({ restoreFocus: true });
        deps.onPick(entry.id, picked);
      });
      menu.appendChild(button);
      items.push(button);
    }

    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'siat-foot';
      empty.textContent = 'No formats are enabled. Open Settings to choose at least one.';
      menu.appendChild(empty);
    }
    // Digit type-ahead addresses the format entries specifically, so they are
    // tracked separately from the whole item list.
    openStateFormatItems = items.slice();

    const actions = (typeof deps.getMenuActions === 'function' ? deps.getMenuActions() : []) || [];
    if (actions.length) {
      const actionSeparator = doc.createElement('div');
      actionSeparator.className = 'siat-sep';
      actionSeparator.setAttribute('role', 'separator');
      menu.appendChild(actionSeparator);
      for (const action of actions) {
        if (!action || !action.id) continue;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'siat-item';
        button.setAttribute('role', 'menuitem');
        button.dataset.action = action.id;
        const actionDisabled = busy || Boolean(action.disabled);
        if (actionDisabled) button.setAttribute('aria-disabled', 'true');
        const label = doc.createElement('span');
        label.className = 'siat-ext';
        label.textContent = action.label;
        button.appendChild(label);
        const actionHint = doc.createElement('span');
        actionHint.className = 'siat-hint';
        actionHint.textContent = action.disabled || action.hint || '';
        button.appendChild(actionHint);
        bindMenuActivation(button, (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (actionDisabled) return;
          const picked = openState ? openState.target : target;
          close({ restoreFocus: true });
          if (typeof deps.onAction === 'function') deps.onAction(action.id, picked);
        });
        menu.appendChild(button);
        items.push(button);
      }
    }

    const separator = doc.createElement('div');
    separator.className = 'siat-sep';
    separator.setAttribute('role', 'separator');
    menu.appendChild(separator);

    const settingsButton = doc.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'siat-item';
    settingsButton.setAttribute('role', 'menuitem');
    const settingsLabel = doc.createElement('span');
    settingsLabel.className = 'siat-ext';
    settingsLabel.textContent = 'Settings';
    settingsButton.appendChild(settingsLabel);
    const settingsHint = doc.createElement('span');
    settingsHint.className = 'siat-hint';
    settingsHint.textContent = 'Formats, file names, quality, privacy';
    settingsButton.appendChild(settingsHint);
    bindMenuActivation(settingsButton, (event) => {
      event.preventDefault();
      close({ restoreFocus: true });
      deps.onOpenSettings();
    });
    menu.appendChild(settingsButton);
    items.push(settingsButton);

    if (busy && deps.onCancel) {
      const cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.className = 'siat-cancel';
      cancel.textContent = 'Cancel the running conversion';
      bindMenuActivation(cancel, (event) => {
        event.preventDefault();
        close({ restoreFocus: true });
        deps.onCancel();
      });
      menu.appendChild(cancel);
      items.push(cancel);
    }

    const foot = doc.createElement('div');
    foot.className = 'siat-foot';
    foot.textContent = settings.requireShift
      ? 'Release Shift to use the browser menu · 1–9 pick a format'
      : 'Shift + right-click for the browser menu · 1–9 pick a format · Esc closes';
    menu.appendChild(foot);

    openState = { target, items, index: -1, restoreFocus: previousFocus, trigger, formatItems: openStateFormatItems };
    openedAt = Date.now();
    position(clientX, clientY);
    // Focus after layout so the first item is visible and announced.
    setActive(0);
    return true;
  }

  function position(clientX, clientY) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    const vw = (doc.defaultView && doc.defaultView.innerWidth) || 1024;
    const vh = (doc.defaultView && doc.defaultView.innerHeight) || 768;
    const margin = 8;
    let x = clientX;
    let y = clientY;
    if (x + rect.width + margin > vw) x = Math.max(margin, vw - rect.width - margin);
    if (y + rect.height + margin > vh) y = Math.max(margin, clientY - rect.height);
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
  }

  function close({ restoreFocus = true } = {}) {
    if (!openState) {
      if (menu) menu.hidden = true;
      return;
    }
    const state = openState;
    openState = null;
    openStateFormatItems = [];
    if (menu) menu.hidden = true;
    if (restoreFocus && state.restoreFocus && state.restoreFocus.isConnected !== false) {
      try {
        state.restoreFocus.focus({ preventScroll: true });
      } catch {
        /* element went away */
      }
    }
  }

  function onKeyDown(event) {
    if (!openState) return;
    const items = itemElements();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close({ restoreFocus: true });
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActive(openState.index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(openState.index - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(items.length - 1);
        break;
      case 'Tab':
        // Keep focus inside the menu while it is open; Escape is the way out.
        event.preventDefault();
        setActive(openState.index + (event.shiftKey ? -1 : 1));
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const current = items[openState.index];
        if (current) activateMenuItem(current, event);
        break;
      }
      default: {
        // Type-ahead: a digit picks that format immediately, which is the whole
        // point of a keyboard workflow (right-click, "2", done).
        if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const formatItems = openState.formatItems || [];
          const wanted = formatItems[Number(event.key) - 1];
          if (wanted) {
            event.preventDefault();
            event.stopPropagation();
            setActive(formatItems.indexOf(wanted));
            activateMenuItem(wanted, event);
          }
        }
        break;
      }
    }
  }

  function onContextMenu(event) {
    const settings = deps.getSettings();
    if (!settings.interceptContextMenu) return;
    if (Date.now() - longPressOpenedAt < DOUBLE_OPEN_GUARD_MS) return; // long-press already opened it
    if (settings.requireShift ? !event.shiftKey : event.shiftKey) return; // leave the native menu alone

    const target = resolveImageTarget(event.target, { enableBackgroundImages: settings.enableBackgroundImages });
    if (!target) return;
    event.preventDefault();
    open(target, event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    const settings = deps.getSettings();
    if (!settings.interceptContextMenu || !settings.enableLongPress) return;
    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (!isTouch) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const element = event.target;
    if (stopLongPress) stopLongPress();
    let timer = 0;
    // One-shot local handlers that remove themselves. These must NOT go through
    // addListener(): that array lives as long as the page, and three entries per
    // touch-down would grow without bound on a touch device.
    const release = () => {
      clearTimeout(timer);
      if (stopLongPress === release) stopLongPress = null;
      doc.removeEventListener('pointermove', guardUserEvent(onMove));
      doc.removeEventListener('pointerup', guardUserEvent(onEnd));
      doc.removeEventListener('pointercancel', guardUserEvent(onEnd));
    };
    const onMove = (moveEvent) => {
      // A finger never holds perfectly still, so only a move *beyond* the
      // tolerance cancels the long press; anything smaller is ignored.
      if (moveEvent && typeof moveEvent.clientX === 'number') {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
          release();
        }
      }
    };
    const onEnd = () => {
      release();
    };
    stopLongPress = release;
    timer = setTimeout(() => {
      try {
        const target = resolveImageTarget(element, { enableBackgroundImages: settings.enableBackgroundImages });
        if (!target) return;
        longPressOpenedAt = Date.now();
        open(target, startX, startY, { trigger: 'longpress' });
      } finally {
        release();
      }
    }, LONG_PRESS_MS);
    doc.addEventListener('pointermove', guardUserEvent(onMove), { passive: true });
    doc.addEventListener('pointerup', guardUserEvent(onEnd), { once: true });
    doc.addEventListener('pointercancel', guardUserEvent(onEnd), { once: true });
  }

  function onDocumentClick(event) {
    if (!openState) return;
    if (host && event.composedPath && event.composedPath().includes(host)) return;
    close({ restoreFocus: false });
  }

  function onDismiss(event) {
    if (stopLongPress) stopLongPress();
    if (!openState) return;
    if (event && event.type === 'scroll' && Date.now() - openedAt < SCROLL_GRACE_MS) return;
    close({ restoreFocus: false });
  }

  function onMouseOver(event) {
    // Cheap bookkeeping so the manager menu command can act on the last image
    // the user pointed at (no layout work here, just a reference).
    lastHoveredElement = event.target;
  }

  return {
    attach() {
      // Deliberately no ensureHost() here: at document-start the document may
      // not have a root element yet. The host is created on first open().
      if (attached) return; // re-applying settings must not stack duplicate listeners
      attached = true;
      addListener(doc, 'contextmenu', onContextMenu, true);
      addListener(doc, 'keydown', onKeyDown, true);
      addListener(doc, 'click', onDocumentClick, true);
      addListener(doc, 'pointerdown', onPointerDown, true);
      addListener(doc, 'mouseover', onMouseOver, { passive: true });
      if (doc.defaultView) {
        addListener(doc.defaultView, 'resize', onDismiss);
        addListener(doc.defaultView, 'blur', onDismiss);
        addListener(doc.defaultView, 'pagehide', onDismiss);
      }
      addListener(doc, 'scroll', onDismiss, { passive: true, capture: true });
    },
    detach() {
      if (stopLongPress) stopLongPress();
      for (const [target, type, handler, options] of listeners) {
        try {
          target.removeEventListener(type, guardUserEvent(handler), options);
        } catch {
          /* noop */
        }
      }
      listeners.length = 0;
      attached = false;
      close({ restoreFocus: false });
    },
    destroy() {
      this.detach();
      if (host) {
        try {
          host.remove();
        } catch {
          /* noop */
        }
      }
      host = null;
      shadow = null;
      menu = null;
    },
    open,
    close,
    get isOpen() {
      return Boolean(openState);
    },
    /** Open for the last element the pointer rested on (manager menu command). */
    openForLastHovered() {
      const settings = deps.getSettings();
      const element = lastHoveredElement;
      if (!element || element.isConnected === false) return false;
      const target = resolveImageTarget(element, { enableBackgroundImages: settings.enableBackgroundImages });
      if (!target) return false;
      const box = element.getBoundingClientRect();
      const vw = (doc.defaultView && doc.defaultView.innerWidth) || 1024;
      const vh = (doc.defaultView && doc.defaultView.innerHeight) || 768;
      const x = Math.min(Math.max(12, box.left + box.width / 2), vw - 12);
      const y = Math.min(Math.max(12, box.top + box.height / 2), vh - 12);
      return open(target, x, y, { trigger: 'menu-command' });
    },
    /**
     * The image the pointer last rested on, resolved — used by the keyboard
     * shortcuts, which have no click coordinates to work from.
     */
    hoveredTarget() {
      const settings = deps.getSettings();
      const element = lastHoveredElement;
      if (!element || element.isConnected === false) return null;
      return resolveImageTarget(element, { enableBackgroundImages: settings.enableBackgroundImages });
    },
    get shadowRoot() {
      ensureHost();
      return shadow;
    },
    get element() {
      ensureHost();
      return menu;
    },
  };
}

function describeSource(target) {
  const parts = [];
  if (target.naturalWidth && target.naturalHeight) parts.push(`${target.naturalWidth}×${target.naturalHeight}`);
  else if (target.boxWidth && target.boxHeight) parts.push(`${target.boxWidth}×${target.boxHeight} box`);
  const url = target.url || '';
  if (url) {
    if (/^data:/i.test(url)) parts.push('data: URL');
    else if (/^blob:/i.test(url)) parts.push('blob: URL');
    else {
      try {
        const parsed = new URL(url);
        const tail = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
        parts.push(`${parsed.hostname}/${tail.length > 26 ? `…${tail.slice(-25)}` : tail}`);
      } catch {
        parts.push(url.slice(0, 42));
      }
    }
  }
  if (target.altText) parts.push(`“${target.altText.slice(0, 40)}”`);
  return parts.join(' · ') || 'image';
}
