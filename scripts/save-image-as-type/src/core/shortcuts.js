import { configNumber, configString } from './config-data.js';
/**
 * Keyboard shortcuts.
 *
 * Rules that keep this from breaking the pages it runs on:
 *
 *   - a binding must include Ctrl, Alt or Meta, or be a function key. Plain
 *     letters are never captured, so typing in a page's own search box is safe;
 *   - chords the browser reserves (Ctrl+W, Ctrl+T, F5, …) are refused with an
 *     explanation, because the browser will win and the user would see a
 *     shortcut that appears to do nothing;
 *   - no two actions may share a binding;
 *   - keys are matched on `event.code` where available, so the binding means the
 *     same physical key regardless of layout or shift-produced symbols.
 */

export const SHORTCUT_ACTIONS = Object.freeze([
  { id: 'quickSave', label: 'Save the image under the pointer in the last-used format', default: 'Alt+Shift+S' },
  { id: 'copyImage', label: 'Copy the image under the pointer to the clipboard', default: 'Alt+Shift+C' },
  { id: 'openPicker', label: 'Open the page image picker', default: 'Alt+Shift+P' },
  { id: 'saveAll', label: 'Convert every image on this page', default: 'Alt+Shift+A' },
  { id: 'cancelJob', label: 'Cancel the running batch job', default: 'Alt+Shift+X' },
]);

export const DEFAULT_SHORTCUTS = SHORTCUT_ACTIONS.reduce((map, action) => {
  map[action.id] = action.default;
  return map;
}, {});

const MODIFIER_NAMES = Object.freeze(['ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command', 'win']);
const RESERVED = Object.freeze([
  'ctrl+w',
  'ctrl+t',
  'ctrl+n',
  'ctrl+shift+w',
  'ctrl+shift+t',
  'ctrl+shift+n',
  'ctrl+tab',
  'ctrl+shift+tab',
  'ctrl+l',
  'ctrl+f',
  'ctrl+p',
  'ctrl+r',
  'ctrl+d',
  'ctrl+k',
  'ctrl+u',
  'ctrl+s',
  'ctrl+shift+s',
  'alt+tab',
  'alt+f4',
  'f5',
  'f11',
  'f12',
]);

const CODE_MAP = {
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Delete: 'delete',
  Insert: 'insert',
};

/** Parse "Alt+Shift+S" into a normalised binding object. Returns null if unusable. */
export function parseBinding(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;

  const binding = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (let index = 0; index < parts.length - 1; index += 1) {
    const name = parts[index].toLowerCase();
    if (!MODIFIER_NAMES.includes(name)) return null; // a modifier slot held a key
    if (name === 'ctrl' || name === 'control') binding.ctrl = true;
    else if (name === 'alt' || name === 'option') binding.alt = true;
    else if (name === 'shift') binding.shift = true;
    else binding.meta = true;
  }

  const key = normalizeKeyName(parts[parts.length - 1]);
  if (!key) return null;
  binding.key = key;
  return binding;
}

function normalizeKeyName(input) {
  const text = configString(input || '').trim();
  if (!text) return '';
  if (CODE_MAP[text]) return CODE_MAP[text];
  const lower = text.toLowerCase();
  if (/^[a-z]$/.test(lower)) return lower;
  if (/^[0-9]$/.test(lower)) return lower;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower;
  if (CODE_MAP[text.charAt(0).toUpperCase() + text.slice(1)]) return CODE_MAP[text.charAt(0).toUpperCase() + text.slice(1)];
  if (['space', 'enter', 'escape', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'].includes(lower)) return lower;
  if (['-', '=', '[', ']', ';', "'", '`', '\\', ',', '.', '/'].includes(lower)) return lower;
  return '';
}

/** Canonical id used for duplicate/conflict checks: "alt+shift+s". */
export function bindingId(binding) {
  if (!binding || !binding.key) return '';
  const parts = [];
  if (binding.ctrl) parts.push('ctrl');
  if (binding.alt) parts.push('alt');
  if (binding.shift) parts.push('shift');
  if (binding.meta) parts.push('meta');
  parts.push(binding.key);
  return parts.join('+');
}

/** Display text: "Alt+Shift+S". */
export function formatBinding(binding) {
  if (typeof binding === 'string') return binding;
  if (!binding || !binding.key) return '';
  const parts = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  if (binding.meta) parts.push('Meta');
  parts.push(displayKey(binding.key));
  return parts.join('+');
}

// Multi-word key names need their own casing: capitalising the first letter
// only would show "Arrowleft" and "Pageup" in the help overlay and the settings
// panel, which reads like a bug to the user.
const DISPLAY_KEY_NAMES = Object.freeze({
  space: 'Space',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  delete: 'Delete',
  insert: 'Insert',
});

function displayKey(key) {
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  if (DISPLAY_KEY_NAMES[key]) return DISPLAY_KEY_NAMES[key];
  return key.length ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

/** Normalise a live keyboard event into the same shape as a parsed binding. */
export function bindingFromEvent(event) {
  if (!event) return null;
  const code = typeof event.code === 'string' ? event.code : '';
  let key = '';
  if (code) {
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F\d{1,2}$/.test(code)) key = code.toLowerCase();
    else if (CODE_MAP[code]) key = CODE_MAP[code];
  }
  if (!key && typeof event.key === 'string') key = normalizeKeyName(event.key);
  if (!key) return null;
  return {
    ctrl: Boolean(event.ctrlKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
    meta: Boolean(event.metaKey),
    key,
  };
}

/** Does a keyboard event match a binding? Exact on modifiers and key. */
export function matchesBinding(event, binding) {
  const fromEvent = bindingFromEvent(event);
  if (!fromEvent || !binding || !binding.key) return false;
  return (
    fromEvent.ctrl === Boolean(binding.ctrl) &&
    fromEvent.alt === Boolean(binding.alt) &&
    fromEvent.shift === Boolean(binding.shift) &&
    fromEvent.meta === Boolean(binding.meta) &&
    fromEvent.key === binding.key
  );
}

/**
 * Validate a shortcut map.
 *
 * @param {Record<string,string>} raw
 * @returns {{ok: boolean, shortcuts: Record<string,object>, errors: string[], warnings: string[], disabled: string[]}}
 */
export function validateShortcuts(raw) {
  const errors = [];
  const warnings = [];
  const shortcuts = {};
  const disabled = [];
  const taken = new Map();

  for (const action of SHORTCUT_ACTIONS) {
    const value = raw && typeof raw === 'object' ? raw[action.id] : undefined;
    if (value === '' || value === 'off' || value === null) {
      disabled.push(action.id);
      continue;
    }
    const text = value === undefined ? action.default : value;
    const binding = parseBinding(text);
    if (!binding) {
      if (value === undefined) continue;
      warnings.push(`"${configString(text).slice(0, 30)}" is not a readable shortcut for ${action.label}; the default ${action.default} was kept.`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    const id = bindingId(binding);
    const hasModifier = binding.ctrl || binding.alt || binding.meta;
    const isFunctionKey = /^f\d{1,2}$/.test(binding.key);
    if (!hasModifier && !isFunctionKey) {
      errors.push(`${formatBinding(binding)} has no Ctrl/Alt/Meta modifier, so it would capture ordinary typing. It was not applied.`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    if (RESERVED.includes(id)) {
      errors.push(`${formatBinding(binding)} is reserved by the browser and cannot be used here. The default ${action.default} was kept for "${action.label}".`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    if (taken.has(id)) {
      warnings.push(`${formatBinding(binding)} was already used for another action, so "${action.label}" keeps the default ${action.default}.`);
      const fallback = parseBinding(action.default);
      if (fallback) shortcuts[action.id] = fallback;
      continue;
    }
    taken.set(id, action.id);
    shortcuts[action.id] = binding;
  }

  return { ok: errors.length === 0, shortcuts, errors, warnings, disabled };
}

/** Rows for the help overlay, in a stable order. */
export function describeShortcuts(shortcuts, { disabled = [] } = {}) {
  return SHORTCUT_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    binding: shortcuts && shortcuts[action.id] ? formatBinding(shortcuts[action.id]) : '',
    disabled: disabled.includes(action.id),
  }));
}

/** Is this element one where the page expects raw keystrokes? */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = configString(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (typeof target.getAttribute === 'function') {
    const role = target.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  }
  return false;
}
