import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  parseBinding,
  bindingId,
  formatBinding,
  bindingFromEvent,
  matchesBinding,
  validateShortcuts,
  describeShortcuts,
  isTypingTarget,
} from '../../src/core/shortcuts.js';

/**
 * Feature: keyboard workflow.
 *
 * The safety property that matters most is negative: this script runs on every
 * page, so a shortcut must never steal a keystroke the page (or the browser)
 * needs. Everything below is about that boundary, plus the deterministic
 * matching that makes "press the chord, get the file" reliable.
 */

/** A minimal keyboard event, shaped like the real thing (code + modifiers). */
function keyEvent(code, mods = {}) {
  return {
    code,
    key: mods.key || code,
    ctrlKey: Boolean(mods.ctrl),
    altKey: Boolean(mods.alt),
    shiftKey: Boolean(mods.shift),
    metaKey: Boolean(mods.meta),
    target: mods.target || null,
    defaultPrevented: false,
  };
}

describe('shortcuts — the documented defaults', () => {
  test('five actions ship with five distinct, modifier-bearing defaults', () => {
    assert.equal(SHORTCUT_ACTIONS.length, 5);
    const ids = SHORTCUT_ACTIONS.map((action) => action.id);
    assert.deepEqual(ids, ['quickSave', 'copyImage', 'openPicker', 'saveAll', 'cancelJob']);
    assert.equal(new Set(Object.values(DEFAULT_SHORTCUTS)).size, 5, 'no two actions share a default chord');
    for (const action of SHORTCUT_ACTIONS) {
      assert.ok(action.label.length > 10, `${action.id} has a real description`);
      assert.equal(DEFAULT_SHORTCUTS[action.id], action.default);
      const binding = parseBinding(action.default);
      assert.ok(binding, `${action.default} parses`);
      assert.ok(binding.ctrl || binding.alt || binding.meta, `${action.default} cannot capture plain typing`);
    }
  });

  test('the defaults survive validation unchanged', () => {
    const checked = validateShortcuts(DEFAULT_SHORTCUTS);
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.errors, []);
    assert.deepEqual(checked.warnings, []);
    assert.deepEqual(checked.disabled, []);
    for (const action of SHORTCUT_ACTIONS) {
      assert.equal(formatBinding(checked.shortcuts[action.id]), action.default, `${action.id} keeps ${action.default}`);
    }
  });
});

describe('shortcuts — parsing and formatting', () => {
  test('modifier aliases all parse to the same binding', () => {
    const variants = ['Alt+Shift+S', 'alt + shift + s', 'Option+Shift+S', 'ALT+SHIFT+S'];
    const ids = variants.map((text) => bindingId(parseBinding(text)));
    assert.deepEqual(ids, ['alt+shift+s', 'alt+shift+s', 'alt+shift+s', 'alt+shift+s']);
    assert.equal(formatBinding(parseBinding('ctrl+meta+7')), 'Ctrl+Meta+7');
    assert.equal(bindingId(parseBinding('Ctrl+Alt+Delete')), 'ctrl+alt+delete');
  });

  test('named keys and punctuation are normalised', () => {
    assert.equal(bindingId(parseBinding('Ctrl+Space')), 'ctrl+space');
    assert.equal(bindingId(parseBinding('Ctrl+ArrowUp')), 'ctrl+arrowup');
    assert.equal(bindingId(parseBinding('Ctrl+F7')), 'ctrl+f7');
    assert.equal(bindingId(parseBinding('Ctrl+Minus')), 'ctrl+-');
    assert.equal(formatBinding(parseBinding('Ctrl+ArrowLeft')), 'Ctrl+ArrowLeft');
    assert.equal(formatBinding(parseBinding('Ctrl+Space')), 'Ctrl+Space');
  });

  test('unparsable input returns null instead of a half-binding', () => {
    for (const value of ['', '   ', null, undefined, 42, {}, 'Shift', 'Ctrl+Banana+S', 'Ctrl++', 'Alt+Shift+Supercalifragilistic']) {
      assert.equal(parseBinding(value), null, `${JSON.stringify(value)} is rejected`);
    }
    // A trailing "+" is just the letter S: parseable, but validation is what
    // stops it from being usable (see the modifier rule below).
    assert.equal(bindingId(parseBinding('S+')), 's');
    assert.equal(validateShortcuts({ quickSave: 'S+' }).ok, false);
    assert.equal(formatBinding(null), '');
    assert.equal(formatBinding({ key: '' }), '');
    assert.equal(bindingId(null), '');
    assert.equal(formatBinding('Alt+Shift+S'), 'Alt+Shift+S', 'a string passes through for display');
  });
});

describe('shortcuts — matching live events', () => {
  test('a chord matches on the physical key, whatever the layout produces', () => {
    const binding = parseBinding('Alt+Shift+S');
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true, shift: true, key: 'S' }), binding), true);
    // A German layout sends "ſ"-ish symbols in event.key; event.code stays KeyS.
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true, shift: true, key: 'ſ' }), binding), true, 'event.code wins over event.key');
  });

  test('modifiers must match exactly: no extra, no missing', () => {
    const binding = parseBinding('Alt+Shift+S');
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true, shift: true }), binding), true);
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true }), binding), false, 'missing Shift');
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true, shift: true, ctrl: true }), binding), false, 'extra Ctrl');
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true, shift: true, meta: true }), binding), false, 'extra Meta');
    assert.equal(matchesBinding(keyEvent('KeyA', { alt: true, shift: true }), binding), false, 'a different key');
    assert.equal(matchesBinding(keyEvent('KeyS', {}), binding), false, 'plain typing never matches');
    assert.equal(matchesBinding(null, binding), false);
    assert.equal(matchesBinding(keyEvent('KeyS', { alt: true, shift: true }), null), false);
  });

  test('bindingFromEvent normalises codes, keys and digits', () => {
    assert.deepEqual(bindingFromEvent(keyEvent('Digit3', { ctrl: true })), { ctrl: true, alt: false, shift: false, meta: false, key: '3' });
    assert.deepEqual(bindingFromEvent(keyEvent('F9', { alt: true })), { ctrl: false, alt: true, shift: false, meta: false, key: 'f9' });
    assert.deepEqual(bindingFromEvent(keyEvent('NumpadEnter', {})), { ctrl: false, alt: false, shift: false, meta: false, key: 'enter' });
    // No code (older engines / synthetic events): fall back to event.key.
    assert.deepEqual(bindingFromEvent({ key: 'P', altKey: true, shiftKey: true }), { ctrl: false, alt: true, shift: true, meta: false, key: 'p' });
    assert.equal(bindingFromEvent(null), null);
    assert.equal(bindingFromEvent({}), null, 'an event with no usable key is not a binding');
  });
});

describe('shortcuts — validation rules', () => {
  test('a plain letter is refused because it would capture ordinary typing', () => {
    const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { quickSave: 'S' }));
    assert.equal(checked.ok, false);
    assert.ok(checked.errors.some((e) => /no Ctrl\/Alt\/Meta modifier/.test(e)), checked.errors.join(' | '));
    assert.equal(formatBinding(checked.shortcuts.quickSave), 'Alt+Shift+S', 'the default is kept, not the broken value');
  });

  test('browser-reserved chords are refused with an explanation', () => {
    for (const reserved of ['Ctrl+W', 'Ctrl+T', 'Ctrl+S', 'Ctrl+Shift+T', 'Alt+Tab', 'Alt+F4', 'F5', 'F11', 'F12', 'Ctrl+L', 'Ctrl+P']) {
      const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { quickSave: reserved }));
      assert.equal(checked.ok, false, `${reserved} is refused`);
      assert.ok(checked.errors.some((e) => /reserved by the browser/.test(e)), `${reserved}: ${checked.errors.join(' | ')}`);
      assert.equal(formatBinding(checked.shortcuts.quickSave), 'Alt+Shift+S', `${reserved} falls back to the default`);
    }
  });

  test('function keys are allowed without a modifier (they are not typing keys)', () => {
    const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { quickSave: 'F8' }));
    assert.equal(checked.ok, true, checked.errors.join(' | '));
    assert.equal(formatBinding(checked.shortcuts.quickSave), 'F8');
  });

  test('two actions cannot share one chord: the second keeps its default', () => {
    const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { copyImage: 'Alt+Shift+S' }));
    assert.equal(checked.ok, true, 'a duplicate is a warning, not a hard error');
    assert.ok(checked.warnings.some((w) => /already used for another action/.test(w)), checked.warnings.join(' | '));
    assert.equal(formatBinding(checked.shortcuts.copyImage), 'Alt+Shift+C');
    assert.equal(formatBinding(checked.shortcuts.quickSave), 'Alt+Shift+S');
  });

  test('an unreadable value warns and keeps the default', () => {
    const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { openPicker: 'Ctrl+Banana' }));
    assert.ok(checked.warnings.some((w) => /not a readable shortcut/.test(w)), checked.warnings.join(' | '));
    assert.equal(formatBinding(checked.shortcuts.openPicker), 'Alt+Shift+P');
  });

  test('an action can be turned off, and the help overlay says so', () => {
    for (const off of ['', 'off', null]) {
      const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { saveAll: off }));
      assert.deepEqual(checked.disabled, ['saveAll'], `${JSON.stringify(off)} disables the action`);
      assert.equal(checked.shortcuts.saveAll, undefined, 'a disabled action has no binding to match');
      assert.equal(checked.ok, true);
    }
    const rows = describeShortcuts(validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { saveAll: '' })).shortcuts, { disabled: ['saveAll'] });
    assert.equal(rows.length, SHORTCUT_ACTIONS.length);
    const saveAll = rows.find((row) => row.id === 'saveAll');
    assert.equal(saveAll.disabled, true);
    assert.equal(saveAll.binding, '');
    assert.equal(rows[0].binding, 'Alt+Shift+S', 'the enabled rows show their chord');
  });

  test('missing, empty and hostile input never throws', () => {
    for (const value of [undefined, null, {}, 'Alt+Shift+S', 42, []]) {
      const checked = validateShortcuts(value);
      assert.equal(typeof checked.ok, 'boolean');
      assert.equal(Object.keys(checked.shortcuts).length <= SHORTCUT_ACTIONS.length, true);
    }
    // Nothing stored at all means "use the defaults", not "no shortcuts".
    const empty = validateShortcuts({});
    assert.equal(empty.ok, true);
    assert.equal(formatBinding(empty.shortcuts.quickSave), 'Alt+Shift+S');
  });

  test('an unknown action id in storage is ignored, not invented', () => {
    const checked = validateShortcuts(Object.assign({}, DEFAULT_SHORTCUTS, { launchMissiles: 'Ctrl+Alt+M' }));
    assert.equal(checked.shortcuts.launchMissiles, undefined);
    assert.deepEqual(Object.keys(checked.shortcuts).sort(), SHORTCUT_ACTIONS.map((a) => a.id).sort());
  });
});

describe('shortcuts — staying out of the page\'s way', () => {
  test('form fields and editable widgets are recognised as typing targets', () => {
    assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
    assert.equal(isTypingTarget({ tagName: 'input' }), true, 'the tag check is case-insensitive');
    assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (name) => (name === 'role' ? 'textbox' : null) }), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (name) => (name === 'role' ? 'searchbox' : null) }), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'combobox' }), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: () => null }), false);
    assert.equal(isTypingTarget({ tagName: 'IMG' }), false);
    assert.equal(isTypingTarget(null), false);
    assert.equal(isTypingTarget(undefined), false);
  });
});
