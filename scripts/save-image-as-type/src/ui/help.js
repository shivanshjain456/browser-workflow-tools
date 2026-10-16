/**
 * Shortcut help overlay.
 *
 * A short, honest reference: which chords do what, what the menu itself accepts
 * from the keyboard, and where to change any of it. Kept separate from the
 * settings dialog so it can be opened from a manager menu command in one step.
 */

import { createDialog, dialogEl, dialogButton, dialogTable } from './dialog.js';
import { describeShortcuts, validateShortcuts } from '../core/shortcuts.js';

const HELP_HOST_ID = 'siat-help-host';

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => object} deps.settings
 * @param {() => void} [deps.onOpenSettings]
 */
export function createShortcutHelp(deps) {
  const doc = deps.document || document;

  const dialog = createDialog({
    document: doc,
    hostId: HELP_HOST_ID,
    marker: 'help',
    titleId: 'siat-help-title',
    title: 'Keyboard shortcuts',
    closeLabel: 'Close shortcut help',
    focus: 'first',
    build(context) {
      const body = context.body;
      const foot = context.foot;
      const settings = typeof deps.settings === 'function' ? deps.settings() : {};
      const checked = validateShortcuts(settings.shortcuts || {});
      const rows = describeShortcuts(checked.shortcuts, { disabled: checked.disabled });

      body.appendChild(
        dialogEl(doc, 'p', {
          className: 'siat-desc',
          text: settings.enableShortcuts === false
            ? 'Shortcuts are turned off in your settings, so none of these will fire.'
            : 'Every chord needs Ctrl, Alt or Meta, so plain typing on a page is never captured. The hovered image is the one the shortcut acts on.',
        }),
      );

      body.appendChild(
        dialogTable(doc, {
          head: ['Action', 'Keys'],
          caption: 'Configured shortcuts',
          emptyText: 'No shortcuts are configured.',
          rows: rows.map((row) => [{ text: row.label }, { text: row.disabled ? 'disabled' : row.binding || 'not set' }]),
        }),
      );

      const menuBox = dialogEl(doc, 'fieldset', { className: 'siat-section' });
      menuBox.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Inside the right-click menu' }));
      const tips = [
        ['Arrow keys', 'Move between entries'],
        ['1 – 9', 'Pick that format immediately'],
        ['Enter or Space', 'Activate the highlighted entry'],
        ['Escape', 'Close the menu without saving'],
        ['Tab', 'Moves through the menu only; focus is trapped while it is open'],
        ['Shift + right-click', settings.requireShift ? 'Opens this menu (required by your settings)' : 'Leaves the browser menu alone'],
      ];
      menuBox.appendChild(
        dialogTable(doc, {
          head: ['Key', 'Effect'],
          caption: 'Menu keyboard behaviour',
          rows: tips.map(([key, effect]) => [{ text: key }, { text: effect }]),
        }),
      );
      body.appendChild(menuBox);

      const note = dialogEl(doc, 'p', {
        className: 'siat-desc',
        // No hard-coded example chord: the table above lists the bindings that
        // are really configured, and an example would read like one of them.
        text: 'Shortcuts can be changed in Settings → Keyboard shortcuts. On Windows, Alt+Shift is also the system language-switch chord — rebind there if your system grabs it first.',
      });
      body.appendChild(note);

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      if (typeof deps.onOpenSettings === 'function') {
        const settingsButton = dialogButton(doc, 'Open settings', 'ghost', () => {
          dialog.close();
          deps.onOpenSettings();
        });
        settingsButton.id = 'siat-help-settings';
        foot.appendChild(settingsButton);
      }
      const closeButton = dialogButton(doc, 'Close', 'primary', () => dialog.close());
      closeButton.id = 'siat-help-close';
      foot.appendChild(closeButton);
    },
  });

  return {
    open: () => dialog.open(),
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
    destroy() {
      dialog.destroy();
    },
  };
}
