import { guardUserEvent } from './events.js';
/**
 * Page image picker.
 *
 * Answers "what images does this page actually have?" and lets the user choose
 * which ones to convert — the batch runner's front end, and useful on its own
 * for spotting icons, duplicates, lazy placeholders and cross-origin sources.
 *
 * Privacy and performance rules, all visible in the UI rather than hidden:
 *   - opening the picker issues **no** network requests. Thumbnails are drawn
 *     from pixels the page already decoded; anything not loaded shows a
 *     placeholder, and loading it is an explicit button press.
 *   - the inventory is re-scanned only when the DOM actually changes (scoped,
 *     debounced, capped MutationObserver) or when the user asks.
 *   - rendering is bounded: a page with 3 000 images shows the first rows and
 *     says how many were left out, instead of building 3 000 nodes.
 *   - selection survives a re-scan because it is keyed by the source URL or the
 *     element itself, not by a row position.
 */

import { createDialog, dialogEl, dialogButton, dialogTextControl, dialogSelectControl, dialogField, dialogCheckboxRow } from './dialog.js';
import { dedupeEntries, filterEntries, sortEntries, summarizeInventory, describeEntryState, observeInventory } from '../core/scan.js';

const PICKER_HOST_ID = 'siat-picker-host';
const PICKER_MAX_ROWS = 200;
const THUMBNAIL_BATCH = 48;

const PICKER_STYLE = `
.siat-toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; padding: 10px 0 4px; }
.siat-toolbar .siat-field { margin-bottom: 0; }
.siat-toolbar input[type="search"], .siat-toolbar input[type="number"] { max-width: 150px; }
.siat-filters { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 4px 0 8px; }
.siat-filters .siat-check { padding: 3px 6px; }
.siat-count { font-size: max(0.75rem, 12px); color: #5c6472; padding: 2px 0 8px; }
@media (prefers-color-scheme: dark) { .siat-count { color: #a3acbb; } }
.siat-row-thumb-empty { display: flex; align-items: center; justify-content: center; font-size: max(0.75rem, 12px); color: #5c6472; text-align: center; }
.siat-row-actions { display: flex; gap: 4px; flex: 0 0 auto; }
.siat-mini-btn {
  font: inherit; font-size: max(0.75rem, 12px); padding: 3px 7px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.08); color: inherit;
}
.siat-mini-btn:hover { filter: brightness(1.06); }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {(options: object) => object} deps.scan          core/scan.js scanImages bound to the document
 * @param {() => object} deps.settings
 * @param {() => Array<{id: string, label: string, ext: string, disabled?: boolean, hint?: string}>} deps.formats
 * @param {object} deps.actions   {convert, copy, inspect, transform, compare, loadNotLoaded}
 */
export function createImagePicker(deps) {
  const doc = deps.document || document;
  const selected = new Map();
  let entries = [];
  let visible = [];
  let notes = [];
  let truncated = false;
  let observer = null;
  let generation = 0;
  let listEl = null;
  let summaryEl = null;
  let countEl = null;
  let formatSelect = null;
  let saveButton = null;
  let zipButton = null;
  let loadButton = null;
  let selectionLabel = null;
  let filterState = {
    query: '',
    minWidth: 0,
    minHeight: 0,
    kinds: [],
    sameOriginOnly: false,
    loadedOnly: false,
    excludeTiny: true,
    dedupe: true,
  };
  let sortKey = 'area-desc';

  const dialog = createDialog({
    document: doc,
    hostId: PICKER_HOST_ID,
    marker: 'picker',
    titleId: 'siat-picker-title',
    title: 'Images on this page',
    closeLabel: 'Close image picker',
    width: 'wide',
    extraStyle: PICKER_STYLE,
    focus: 'first',
    onClose() {
      stopObserving();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      generation += 1;

      summaryEl = dialogEl(doc, 'p', { className: 'siat-count', id: 'siat-picker-summary', text: 'Scanning…' });
      body.appendChild(summaryEl);
      body.appendChild(buildToolbar());
      body.appendChild(buildFilters());
      countEl = dialogEl(doc, 'p', { className: 'siat-count', id: 'siat-picker-count', text: '' });
      body.appendChild(countEl);

      listEl = dialogEl(doc, 'ul', { className: 'siat-listbox', id: 'siat-pick-list', attrs: { 'aria-label': 'Images found on this page' } });
      body.appendChild(listEl);

      selectionLabel = dialogEl(doc, 'span', { className: 'siat-note', id: 'siat-picker-selection', text: 'Nothing selected' });
      foot.appendChild(selectionLabel);
      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));

      const selectAll = dialogButton(doc, 'Select all listed', 'ghost', () => {
        for (const entry of visible) setSelected(entry, true);
        renderList();
      });
      selectAll.id = 'siat-pick-selectall';
      const clearAll = dialogButton(doc, 'Clear', 'ghost', () => {
        selected.clear();
        renderList();
      });
      clearAll.id = 'siat-pick-clear';
      foot.appendChild(selectAll);
      foot.appendChild(clearAll);

      loadButton = dialogButton(doc, 'Load selected images first', 'ghost', () => onLoadSelected());
      loadButton.id = 'siat-pick-load';
      loadButton.title = 'Downloads the selected images the page has not loaded yet, then lists them again.';
      foot.appendChild(loadButton);

      const inspectButton = dialogButton(doc, 'Inspect', 'ghost', () => singleAction('inspect'));
      inspectButton.id = 'siat-pick-inspect';
      const compareButton = dialogButton(doc, 'Compare', 'ghost', () => singleAction('compare'));
      compareButton.id = 'siat-pick-compare';
      const transformButton = dialogButton(doc, 'Transform…', 'ghost', () => singleAction('transform'));
      transformButton.id = 'siat-pick-transform';
      const copyButton = dialogButton(doc, 'Copy', 'ghost', () => singleAction('copy'));
      copyButton.id = 'siat-pick-copy';
      foot.appendChild(inspectButton);
      foot.appendChild(compareButton);
      foot.appendChild(transformButton);
      foot.appendChild(copyButton);

      formatSelect = dialogSelectControl(
        doc,
        (deps.formats ? deps.formats() : []).map((format) => ({ value: format.id, label: format.label, disabled: format.disabled })),
        defaultFormatId(),
      );
      formatSelect.id = 'siat-pick-format';
      formatSelect.setAttribute('aria-label', 'Output format for the selection');
      foot.appendChild(formatSelect);

      saveButton = dialogButton(doc, 'Save selected', 'primary', () => onConvert('files'));
      saveButton.id = 'siat-pick-save';
      zipButton = dialogButton(doc, 'Save as ZIP', 'ghost', () => onConvert('zip'));
      zipButton.id = 'siat-pick-zip';
      foot.appendChild(saveButton);
      foot.appendChild(zipButton);

      const cancelButton = dialogButton(doc, 'Close', 'ghost', () => dialog.close());
      cancelButton.id = 'siat-pick-close';
      foot.appendChild(cancelButton);

      rescan({ initial: true });
      startObserving();
    },
  });

  function buildToolbar() {
    const toolbar = dialogEl(doc, 'div', { className: 'siat-toolbar' });

    const search = dialogTextControl(doc, filterState.query, { type: 'search', placeholder: 'Filter by name, alt text or host', autocomplete: 'off' });
    search.addEventListener('input', guardUserEvent(() => {
      filterState.query = search.value;
      applyFilters();
    }));
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-search', label: 'Search', control: search }));

    const minWidth = dialogTextControl(doc, filterState.minWidth || '', { type: 'number', min: 0, max: 20000, step: 10, placeholder: '0' });
    minWidth.addEventListener('input', guardUserEvent(() => {
      filterState.minWidth = Number(minWidth.value) || 0;
      applyFilters();
    }));
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-minw', label: 'Min width', control: minWidth }));

    const minHeight = dialogTextControl(doc, filterState.minHeight || '', { type: 'number', min: 0, max: 20000, step: 10, placeholder: '0' });
    minHeight.addEventListener('input', guardUserEvent(() => {
      filterState.minHeight = Number(minHeight.value) || 0;
      applyFilters();
    }));
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-minh', label: 'Min height', control: minHeight }));

    const kind = dialogSelectControl(
      doc,
      [
        { value: '', label: 'All kinds' },
        { value: 'img', label: '<img> elements' },
        { value: 'background', label: 'CSS backgrounds' },
        { value: 'svg', label: 'Inline SVG' },
        { value: 'poster', label: 'Video posters' },
      ],
      filterState.kinds.length ? filterState.kinds[0] : '',
      (value) => {
        filterState.kinds = value ? [value] : [];
        applyFilters();
      },
    );
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-kind', label: 'Kind', control: kind }));

    const sort = dialogSelectControl(
      doc,
      [
        { value: 'area-desc', label: 'Largest first' },
        { value: 'area-asc', label: 'Smallest first' },
        { value: 'name', label: 'By name' },
        { value: 'type', label: 'By type' },
        { value: 'state', label: 'By state' },
        { value: 'order', label: 'Page order' },
      ],
      sortKey,
      (value) => {
        sortKey = value;
        applyFilters();
      },
    );
    toolbar.appendChild(dialogField(doc, { id: 'siat-pick-sort', label: 'Sort', control: sort }));

    const refresh = dialogButton(doc, 'Re-scan', 'ghost', () => rescan({}));
    refresh.id = 'siat-pick-refresh';
    toolbar.appendChild(refresh);
    return toolbar;
  }

  function buildFilters() {
    const wrap = dialogEl(doc, 'div', { className: 'siat-filters' });
    const toggles = [
      { id: 'siat-pick-notiny', label: 'Hide icons', key: 'excludeTiny' },
      { id: 'siat-pick-dedupe', label: 'One row per URL', key: 'dedupe' },
      { id: 'siat-pick-loaded', label: 'Loaded only', key: 'loadedOnly' },
      { id: 'siat-pick-sameorigin', label: 'Same origin only', key: 'sameOriginOnly' },
    ];
    for (const toggle of toggles) {
      wrap.appendChild(
        dialogCheckboxRow(doc, {
          id: toggle.id,
          label: toggle.label,
          checked: filterState[toggle.key],
          onChange: (checked) => {
            filterState[toggle.key] = checked;
            applyFilters();
          },
        }),
      );
    }
    return wrap;
  }

  function rescan({ initial = false } = {}) {
    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const result = deps.scan({
      includeBackgrounds: settings.scanBackgrounds !== false,
      maxStyleScan: Number(settings.scanElementCap) || 2500,
      maxEntries: 1000,
    });
    entries = result.entries || [];
    notes = (result.notes || []).slice();
    truncated = Boolean(result.truncated);
    applyFilters();
    if (initial) {
      const settingsSummary = [];
      if (filterState.excludeTiny) settingsSummary.push('icons hidden');
      if (filterState.dedupe) settingsSummary.push('duplicates merged');
      if (settingsSummary.length && countEl) countEl.textContent = `Default view: ${settingsSummary.join(', ')}. Change the filters above to see more.`;
    }
  }

  function applyFilters() {
    let list = filterEntries(entries, filterState);
    if (filterState.dedupe !== false) list = dedupeEntries(list);
    visible = sortEntries(list, sortKey);
    renderSummary();
    renderList();
  }

  function renderSummary() {
    if (!summaryEl) return;
    const all = summarizeInventory(entries);
    const shown = summarizeInventory(visible);
    const parts = [`${all.total} found`, `${all.loaded} loaded`];
    if (all.notLoaded) parts.push(`${all.notLoaded} not loaded`);
    if (all.broken) parts.push(`${all.broken} broken`);
    if (all.crossOrigin) parts.push(`${all.crossOrigin} cross-origin`);
    if (all.tiny) parts.push(`${all.tiny} icon-sized`);
    if (all.uniqueUrls !== all.total) parts.push(`${all.uniqueUrls} distinct URLs`);
    parts.push(`${shown.total} listed`);
    if (selected.size) parts.push(`${selected.size} selected`);
    summaryEl.textContent = parts.join(' · ');
    if (truncated) summaryEl.textContent += ' — the page was too large to list completely.';
  }

  function renderList() {
    if (!listEl) return;
    const shown = generation;
    listEl.textContent = '';
    const slice = visible.slice(0, PICKER_MAX_ROWS);
    if (!slice.length) {
      const empty = dialogEl(doc, 'li', {
        className: 'siat-empty',
        text: entries.length ? 'No image matches these filters.' : 'No images were found on this page.',
      });
      listEl.appendChild(empty);
    }
    for (const entry of slice) listEl.appendChild(renderRow(entry));
    if (visible.length > slice.length) {
      listEl.appendChild(
        dialogEl(doc, 'li', {
          className: 'siat-empty',
          text: `${visible.length - slice.length} more match — narrow the filters to see them.`,
        }),
      );
    }
    if (notes.length) {
      dialog.showBanner('', 'About this scan', notes);
    }
    updateSelectionLabel();
    requestThumbnails(slice, shown);
  }

  function renderRow(entry) {
    const isSelected = selected.has(keyOf(entry));
    const row = dialogEl(doc, 'li', {
      className: 'siat-row',
      dataset: { selected: isSelected ? 'true' : 'false', id: entry.id, kind: entry.kind, state: entry.state },
    });
    row.id = `siat-pick-row-${entry.id}`;

    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isSelected;
    checkbox.id = `siat-pick-check-${entry.id}`;
    checkbox.setAttribute('aria-label', describeEntry(entry));
    checkbox.addEventListener('change', guardUserEvent(() => {
      setSelected(entry, checkbox.checked);
      row.dataset.selected = checkbox.checked ? 'true' : 'false';
      renderSummary();
    }));
    row.appendChild(checkbox);

    const thumb = dialogEl(doc, 'span', {
      className: 'siat-row-thumb siat-row-thumb-empty',
      attrs: { 'aria-hidden': 'true', title: 'No preview without downloading the image' },
    });
    thumb.id = `siat-pick-thumb-${entry.id}`;
    thumb.textContent = entry.state === 'loaded' ? '…' : 'no preview';
    row.appendChild(thumb);

    const main = dialogEl(doc, 'span', { className: 'siat-row-main' });
    main.appendChild(dialogEl(doc, 'span', { className: 'siat-row-title', text: titleOf(entry) }));
    main.appendChild(dialogEl(doc, 'span', { className: 'siat-row-meta', text: metaOf(entry) }));
    row.appendChild(main);

    const badges = dialogEl(doc, 'span', { className: 'siat-row-actions' });
    if (!entry.sameOrigin && entry.kind !== 'svg') badges.appendChild(badge('cross-origin', 'warn'));
    if (entry.state === 'lazy' || entry.state === 'not-loaded') badges.appendChild(badge('not loaded', 'warn'));
    if (entry.state === 'broken') badges.appendChild(badge('broken', 'bad'));
    if (entry.state === 'loaded') badges.appendChild(badge('ready', 'good'));
    if (entry.largest) badges.appendChild(badge(`up to ${entry.largest.width}px`, 'good'));
    if (entry.tiny) badges.appendChild(badge('icon', ''));
    row.appendChild(badges);

    const openButton = dialogEl(doc, 'button', {
      className: 'siat-mini-btn',
      text: 'This one',
      attrs: { type: 'button', title: 'Convert just this image', 'aria-label': `Convert ${titleOf(entry)}` },
    });
    openButton.id = `siat-pick-one-${entry.id}`;
    openButton.addEventListener('click', guardUserEvent(() => {
      selected.clear();
      setSelected(entry, true);
      // onConvert(destination, explicitFormat): the row converts this one image
      // as separate files, in the format chosen in the footer.
      onConvert('files', formatSelect ? formatSelect.value : defaultFormatId());
    }));
    row.appendChild(openButton);
    return row;
  }

  function badge(text, tone) {
    const node = dialogEl(doc, 'span', { className: 'siat-badge', text });
    if (tone) node.dataset.tone = tone;
    return node;
  }

  function requestThumbnails(slice, shown) {
    if (typeof deps.thumbnail !== 'function') return;
    const queue = slice.filter((entry) => entry.state === 'loaded' || entry.kind === 'svg');
    let index = 0;
    const next = async () => {
      while (index < queue.length && index < THUMBNAIL_BATCH) {
        const entry = queue[index];
        index += 1;
        if (generation !== shown || !dialog.isOpen) return;
        try {
          const result = await deps.thumbnail(entry);
          if (generation !== shown || !dialog.isOpen) return;
          const slot = listEl && listEl.querySelector(`#siat-pick-thumb-${cssEscape(entry.id)}`);
          if (!slot) return;
          if (result && result.dataUrl) {
            const image = doc.createElement('img');
            image.className = 'siat-row-thumb';
            image.src = result.dataUrl;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            slot.replaceWith(image);
            image.id = `siat-pick-thumb-${entry.id}`;
          } else {
            slot.textContent = 'no preview';
            slot.title = (result && result.reason) || 'No preview available.';
          }
        } catch {
          /* a failed preview is cosmetic; the row still works */
        }
      }
    };
    setTimeout(() => {
      next().catch(() => {});
    }, 0);
  }

  function setSelected(entry, value) {
    const key = keyOf(entry);
    if (value) selected.set(key, entry);
    else selected.delete(key);
    updateSelectionLabel();
  }

  function updateSelectionLabel() {
    if (!selectionLabel) return;
    const count = selected.size;
    const notLoaded = [...selected.values()].filter((entry) => entry.state !== 'loaded').length;
    selectionLabel.textContent = count
      ? `${count} selected${notLoaded ? ` (${notLoaded} not loaded yet)` : ''}`
      : 'Nothing selected';
    if (saveButton) saveButton.textContent = count ? `Save ${count}` : 'Save selected';
    if (zipButton) zipButton.textContent = count ? `ZIP ${count}` : 'Save as ZIP';
    if (loadButton) loadButton.style.display = notLoaded ? '' : 'none';
  }

  function selectedEntries() {
    return [...selected.values()];
  }

  function singleAction(name) {
    const list = selectedEntries();
    if (list.length !== 1) {
      dialog.showBanner('error', `Select exactly one image`, [
        list.length ? `${list.length} images are selected; "${name}" works on one at a time.` : 'Tick one image in the list first.',
      ]);
      return;
    }
    const action = deps.actions && deps.actions[name];
    if (typeof action !== 'function') return;
    dialog.close();
    action(list[0]);
  }

  function onConvert(destination, explicitFormat) {
    const list = selectedEntries();
    if (!list.length) {
      dialog.showBanner('error', 'Nothing selected', ['Tick at least one image, or press "Select all listed".']);
      return;
    }
    const formatId = explicitFormat || (formatSelect ? formatSelect.value : defaultFormatId());
    if (typeof deps.actions === 'object' && deps.actions && typeof deps.actions.convert === 'function') {
      dialog.close();
      deps.actions.convert({ entries: list, formatId, destination });
    }
  }

  async function onLoadSelected() {
    const list = selectedEntries().filter((entry) => entry.state !== 'loaded');
    if (!list.length || typeof deps.actions !== 'object' || !deps.actions || typeof deps.actions.loadNotLoaded !== 'function') return;
    loadButton.disabled = true;
    loadButton.textContent = 'Loading…';
    try {
      await deps.actions.loadNotLoaded(list);
    } finally {
      rescan({});
      if (loadButton) {
        loadButton.disabled = false;
        loadButton.textContent = 'Load selected images first';
      }
    }
  }

  function startObserving() {
    stopObserving();
    observer = observeInventory(doc, () => {
      if (!dialog.isOpen) return;
      rescan({});
    }, { debounceMs: 500, maxNotifications: 30 });
  }

  function stopObserving() {
    if (observer && typeof observer.disconnect === 'function') observer.disconnect();
    observer = null;
  }

  function defaultFormatId() {
    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const formats = deps.formats ? deps.formats() : [];
    const enabled = formats.filter((format) => !format.disabled);
    if (settings.activeFormatId && enabled.some((format) => format.id === settings.activeFormatId)) return settings.activeFormatId;
    const preferred = (settings.formats || []).find((id) => enabled.some((format) => format.id === id && id !== 'original'));
    return preferred || (enabled[0] ? enabled[0].id : 'png');
  }

  function keyOf(entry) {
    if (entry && entry.url) return `url:${entry.url}`;
    return entry && entry.element ? entry.element : `id:${entry ? entry.id : 'unknown'}`;
  }

  function titleOf(entry) {
    if (entry.kind === 'svg') return entry.alt || 'Inline SVG image';
    const fromUrl = String(entry.url || '').split('/').pop().split('?')[0];
    return fromUrl || entry.alt || entry.title || `${entry.kind} image`;
  }

  function metaOf(entry) {
    const parts = [];
    if (entry.natural && entry.natural.width) parts.push(`${entry.natural.width}×${entry.natural.height}px`);
    else if (entry.displayed && entry.displayed.width) parts.push(`${entry.displayed.width}×${entry.displayed.height} displayed`);
    if (entry.mime) parts.push(entry.mime.replace('image/', ''));
    parts.push(describeEntryState(entry));
    if (entry.host) parts.push(entry.host);
    if (entry.frame && entry.frame !== 'this page') parts.push(entry.frame);
    return parts.filter(Boolean).join(' · ');
  }

  function describeEntry(entry) {
    return `${titleOf(entry)}, ${metaOf(entry)}`;
  }

  return {
    open(options = {}) {
      if (options.filter) filterState = Object.assign({}, filterState, options.filter);
      if (options.sort) sortKey = options.sort;
      dialog.open();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.isOpen;
    },
    refresh: () => rescan({}),
    get shadowRoot() {
      return dialog.shadowRoot;
    },
    get element() {
      return dialog.element;
    },
    /** Test/automation seam: the entries currently listed and selected. */
    state: () => ({
      found: entries.length,
      listed: visible.length,
      selected: selectedEntries().map((entry) => ({ id: entry.id, url: entry.url, kind: entry.kind, state: entry.state })),
      truncated,
      notes,
    }),
    destroy() {
      stopObserving();
      selected.clear();
      dialog.destroy();
    },
  };
}

function cssEscape(value) {
  const text = String(value || '');
  return typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function' ? CSS.escape(text) : text.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
