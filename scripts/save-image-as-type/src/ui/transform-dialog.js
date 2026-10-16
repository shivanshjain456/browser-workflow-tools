import { guardUserEvent } from './events.js';
/**
 * Transform dialog: resize, crop, rotate, flip — with a live preview.
 *
 * The preview is drawn from a proportionally scaled copy of the source, so
 * dragging a crop box stays responsive on a 40-megapixel photo; the exact output
 * size shown next to it is computed from the real pixel dimensions by
 * `planTransform`, never from the preview. What you see is a scaled rendering of
 * what you get, and the numbers beside it are the truth.
 *
 * Interaction covers mouse, touch (pointer events) and keyboard: the crop box is
 * focusable and moves with the arrow keys (Shift = resize instead of move), and
 * every value also has a numeric field, so the dialog is usable without a
 * pointing device.
 */

import { createDialog, dialogEl, dialogButton, dialogTextControl, dialogSelectControl, dialogField, dialogCheckboxRow } from './dialog.js';
import { applyTransform, validateTransform, planTransform, isTransformActive, describeTransform, RESIZE_PRESETS, TRANSFORM_DEFAULTS } from '../core/transform.js';

const TRANSFORM_HOST_ID = 'siat-transform-host';
const PREVIEW_MAX = 420;
const PREVIEW_MAX_HEIGHT = 300;

const TRANSFORM_STYLE = `
.siat-tf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 14px; }
.siat-tf-output { font-size: max(0.78125rem, 12.5px); padding: 8px 10px; border-radius: 9px; background: rgba(127,127,127,.1); margin: 8px 0; }
.siat-tf-warn { color: #b4232a; font-size: max(0.75rem, 12px); margin: 4px 0 0; }
@media (prefers-color-scheme: dark) { .siat-tf-warn { color: #ff8f8f; } }
.siat-tf-rotate { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.siat-cropwrap:focus-visible { outline: 2px solid #2f6fdb; outline-offset: 2px; }
.siat-cropdims { position: absolute; left: 4px; bottom: -18px; font-size: max(0.75rem, 12px); color: #edf0f6; background: rgba(10,12,18,.72); padding: 1px 5px; border-radius: 5px; line-height: 1.4; }
`;

/**
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => object} deps.settings
 * @param {() => Array<{id: string, label: string, disabled?: boolean}>} deps.formats
 * @param {(target: object) => Promise<{drawable: object, width: number, height: number, release?: () => void}>} deps.loadPreview
 * @param {(payload: {target: object, transform: object, formatId: string, makeDefault: boolean}) => void} deps.onSubmit
 * @param {(w: number, h: number, options?: object) => {canvas: object, ctx: object}} [deps.createCanvas]
 */
export function createTransformDialog(deps) {
  const doc = deps.document || document;
  let target = null;
  let source = null; // {drawable, width, height, release}
  let previewCanvas = null;
  let previewEl = null;
  let previewScale = 1;
  let spec = cloneSpec(TRANSFORM_DEFAULTS);
  let cropEnabled = false;
  let controls = {};
  let outputEl = null;
  let warnEl = null;
  let previewHost = null;
  let cropBox = null;
  let cropHandle = null;
  let cropDims = null;
  let loading = false;
  let previewGeneration = 0;

  const dialog = createDialog({
    document: doc,
    hostId: TRANSFORM_HOST_ID,
    marker: 'transform',
    titleId: 'siat-transform-title',
    title: 'Transform and save',
    closeLabel: 'Close transform dialog',
    width: 'wide',
    extraStyle: TRANSFORM_STYLE,
    focus: 'first',
    onClose() {
      previewGeneration += 1;
      loading = false;
      releaseSource();
    },
    build(context) {
      const body = context.body;
      const foot = context.foot;
      controls = {};

      const previewSection = dialogEl(doc, 'fieldset', { className: 'siat-section' });
      previewSection.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Preview' }));
      previewHost = dialogEl(doc, 'div', { className: 'siat-preview', id: 'siat-tf-preview', attrs: { 'aria-label': 'Transform preview' } });
      previewSection.appendChild(previewHost);
      outputEl = dialogEl(doc, 'div', { className: 'siat-tf-output', id: 'siat-tf-output', text: 'Loading image…' });
      previewSection.appendChild(outputEl);
      warnEl = dialogEl(doc, 'p', { className: 'siat-tf-warn', id: 'siat-tf-warn', text: '' });
      previewSection.appendChild(warnEl);
      body.appendChild(previewSection);

      body.appendChild(buildResizeSection());
      body.appendChild(buildCropSection());
      body.appendChild(buildRotateSection());
      body.appendChild(buildOutputSection());

      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-note', text: 'Applied to pixels, so the saved file is re-encoded.' }));
      foot.appendChild(dialogEl(doc, 'span', { className: 'siat-spacer' }));
      const resetButton = dialogButton(doc, 'Reset', 'ghost', () => {
        spec = cloneSpec(TRANSFORM_DEFAULTS);
        cropEnabled = false;
        syncControls();
        refresh();
      });
      resetButton.id = 'siat-tf-reset';
      foot.appendChild(resetButton);
      const defaultButton = dialogButton(doc, 'Make default', 'ghost', () => submit(true));
      defaultButton.id = 'siat-tf-makedefault';
      defaultButton.title = 'Use this transform for every conversion until you change it in settings.';
      foot.appendChild(defaultButton);
      foot.appendChild(dialogButton(doc, 'Cancel', 'ghost', () => dialog.close()));
      const saveButton = dialogButton(doc, 'Save', 'primary', () => submit(false));
      saveButton.id = 'siat-tf-save';
      foot.appendChild(saveButton);

      syncControls();
      loadSource();
    },
  });

  function buildResizeSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Resize' }));

    const preset = dialogSelectControl(
      doc,
      RESIZE_PRESETS.map((entry) => ({ value: entry.id, label: entry.label })),
      'none',
      (value) => {
        const found = RESIZE_PRESETS.find((entry) => entry.id === value);
        if (!found) return;
        spec.resize = { mode: found.mode, width: found.width || 0, height: found.height || 0, keepAspect: spec.resize.keepAspect };
        if (found.mode === 'exact') {
          spec.resize.width = Number(controls.width && controls.width.value) || sourceWidth();
          spec.resize.height = Number(controls.height && controls.height.value) || sourceHeight();
        }
        refresh();
      },
    );
    controls.preset = preset;
    section.appendChild(dialogField(doc, { id: 'siat-tf-resize-preset', label: 'Preset', control: preset }));

    const grid = dialogEl(doc, 'div', { className: 'siat-tf-grid' });
    const width = dialogTextControl(doc, '', { type: 'number', min: 1, max: 20000, step: 1 });
    width.addEventListener('input', guardUserEvent(() => {
      spec.resize.mode = 'exact';
      spec.resize.width = Number(width.value) || 0;
      if (spec.resize.keepAspect && sourceWidth() && sourceHeight()) {
        const aspect = aspectPlan();
        spec.resize.height = Math.max(1, Math.round((spec.resize.width * aspect.height) / aspect.width));
        if (controls.height) controls.height.value = String(spec.resize.height);
      }
      refresh();
    }));
    controls.width = width;
    grid.appendChild(dialogField(doc, { id: 'siat-tf-width', label: 'Width (px)', control: width }));

    const height = dialogTextControl(doc, '', { type: 'number', min: 1, max: 20000, step: 1 });
    height.addEventListener('input', guardUserEvent(() => {
      spec.resize.mode = 'exact';
      spec.resize.height = Number(height.value) || 0;
      if (spec.resize.keepAspect && sourceWidth() && sourceHeight()) {
        const aspect = aspectPlan();
        spec.resize.width = Math.max(1, Math.round((spec.resize.height * aspect.width) / aspect.height));
        if (controls.width) controls.width.value = String(spec.resize.width);
      }
      refresh();
    }));
    controls.height = height;
    grid.appendChild(dialogField(doc, { id: 'siat-tf-height', label: 'Height (px)', control: height }));
    section.appendChild(grid);

    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-aspect',
        label: 'Keep aspect ratio',
        hint: 'Typing one dimension fills in the other.',
        checked: true,
        onChange: (checked) => {
          spec.resize.keepAspect = checked;
        },
      }),
    );
    return section;
  }

  function buildCropSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Crop' }));
    section.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-crop-enable',
        label: 'Crop to a region',
        hint: 'Drag the blue box on the preview, use the arrow keys when it has focus (Shift+arrow resizes), or type exact pixels below.',
        checked: false,
        onChange: (checked) => {
          cropEnabled = checked;
          if (checked && !spec.crop) {
            spec.crop = {
              x: Math.round(sourceWidth() * 0.1),
              y: Math.round(sourceHeight() * 0.1),
              width: Math.max(1, Math.round(sourceWidth() * 0.8)),
              height: Math.max(1, Math.round(sourceHeight() * 0.8)),
            };
          }
          if (!checked) spec.crop = null;
          syncControls();
          refresh();
        },
      }),
    );

    const grid = dialogEl(doc, 'div', { className: 'siat-tf-grid' });
    for (const [key, label] of [
      ['x', 'Left (px)'],
      ['y', 'Top (px)'],
      ['width', 'Width (px)'],
      ['height', 'Height (px)'],
    ]) {
      const input = dialogTextControl(doc, '', { type: 'number', min: 0, max: 100000, step: 1 });
      input.addEventListener('input', guardUserEvent(() => {
        if (!spec.crop) spec.crop = { x: 0, y: 0, width: sourceWidth(), height: sourceHeight() };
        spec.crop[key] = Number(input.value) || 0;
        cropEnabled = true;
        // Sync first: the "Crop to a region" checkbox has to show that typing a
        // region turned cropping on, or the UI contradicts the readout.
        syncControls();
        refresh();
      }));
      controls[`crop-${key}`] = input;
      grid.appendChild(dialogField(doc, { id: `siat-tf-crop-${key}`, label, control: input }));
    }
    section.appendChild(grid);
    return section;
  }

  function buildRotateSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Rotate and flip' }));
    const row = dialogEl(doc, 'div', { className: 'siat-tf-rotate' });

    const left = dialogButton(doc, '⟲ Rotate left', 'ghost', () => {
      spec.rotate = (spec.rotate + 270) % 360;
      refresh();
    });
    left.id = 'siat-tf-rot-left';
    const right = dialogButton(doc, '⟳ Rotate right', 'ghost', () => {
      spec.rotate = (spec.rotate + 90) % 360;
      refresh();
    });
    right.id = 'siat-tf-rot-right';
    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-fliph',
        label: 'Flip horizontally',
        checked: false,
        onChange: (checked) => {
          spec.flipH = checked;
          refresh();
        },
      }),
    );
    row.appendChild(
      dialogCheckboxRow(doc, {
        id: 'siat-tf-flipv',
        label: 'Flip vertically',
        checked: false,
        onChange: (checked) => {
          spec.flipV = checked;
          refresh();
        },
      }),
    );
    controls.rotateLabel = dialogEl(doc, 'span', { className: 'siat-note', id: 'siat-tf-rotate-label', text: '0°' });
    row.appendChild(controls.rotateLabel);
    section.appendChild(row);
    return section;
  }

  function buildOutputSection() {
    const section = dialogEl(doc, 'fieldset', { className: 'siat-section' });
    section.appendChild(dialogEl(doc, 'legend', { className: 'siat-legend', text: 'Output' }));
    const formats = (deps.formats ? deps.formats() : []).filter((format) => format.id !== 'original' && !format.disabled);
    const settings = typeof deps.settings === 'function' ? deps.settings() : {};
    const select = dialogSelectControl(
      doc,
      formats.map((format) => ({ value: format.id, label: format.label })),
      formats.some((format) => format.id === settings.activeFormatId) ? settings.activeFormatId : formats.length ? formats[0].id : 'png',
      // The readout names the format that will be written, so it has to follow
      // the select instead of showing the format that was selected on open.
      () => refresh(),
    );
    select.setAttribute('aria-label', 'Output format');
    controls.format = select;
    // dialogField owns the control's id (it is the label's `for` target), so the
    // id is given once, here, instead of being silently overwritten afterwards.
    section.appendChild(dialogField(doc, { id: 'siat-tf-format', label: 'Save as', hint: '"Original file" is not offered: cropping or resizing means re-encoding.', control: select }));
    return section;
  }

  async function loadSource() {
    if (loading) return;
    loading = true;
    const generation = ++previewGeneration;
    try {
      if (typeof deps.loadPreview !== 'function') throw new Error('No preview loader was provided.');
      const loadedSource = await deps.loadPreview(target);
      if (generation !== previewGeneration || !dialog.isOpen) {
        if (loadedSource && typeof loadedSource.release === 'function') loadedSource.release();
        return;
      }
      source = loadedSource;
      if (!source || !source.drawable) return;
      previewScale = buildPreviewCanvas();
      buildPreviewHost();
      if (deps.settings) {
        const settings = deps.settings();
        if (settings.defaultTransform && isTransformActive(settings.defaultTransform)) {
          spec = cloneSpec(settings.defaultTransform);
          cropEnabled = Boolean(spec.crop);
        }
      }
      syncControls();
      refresh();
    } catch (err) {
      if (generation !== previewGeneration || !dialog.isOpen) return;
      outputEl.textContent = 'The image could not be loaded for preview.';
      warnEl.textContent = err && err.message ? err.message : String(err);
    } finally {
      if (generation === previewGeneration) loading = false;
    }
  }

  function buildPreviewCanvas() {
    const create = deps.createCanvas;
    if (typeof create !== 'function') return 1;
    const width = sourceWidth();
    const height = sourceHeight();
    if (!(width > 0) || !(height > 0)) return 1;
    const scale = Math.min(PREVIEW_MAX / width, PREVIEW_MAX_HEIGHT / height, 1);
    const preview = create(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    try {
      preview.ctx.drawImage(source.drawable, 0, 0, preview.canvas.width, preview.canvas.height);
    } catch {
      return scale;
    }
    previewCanvas = preview.canvas;
    return scale;
  }

  function sourceWidth() {
    return (source && source.width) || 0;
  }

  function sourceHeight() {
    return (source && source.height) || 0;
  }

  /** Push the current spec into every control without re-rendering the dialog. */
  function syncControls() {
    if (!controls.width) return;
    const plan = currentPlan();
    controls.width.value = spec.resize.mode === 'exact' ? String(spec.resize.width || plan.width) : String(plan.width);
    controls.height.value = spec.resize.mode === 'exact' ? String(spec.resize.height || plan.height) : String(plan.height);
    if (controls.preset) controls.preset.value = presetIdFor(spec.resize);
    for (const key of ['x', 'y', 'width', 'height']) {
      const input = controls[`crop-${key}`];
      if (input) input.value = String(spec.crop ? spec.crop[key] || 0 : 0);
    }
    if (dialog.shadowRoot) {
      const cropInput = dialog.shadowRoot.querySelector('#siat-tf-crop-enable');
      if (cropInput) cropInput.checked = cropEnabled;
      const aspectInput = dialog.shadowRoot.querySelector('#siat-tf-aspect');
      if (aspectInput) aspectInput.checked = spec.resize.keepAspect !== false;
      const flipH = dialog.shadowRoot.querySelector('#siat-tf-fliph');
      if (flipH) flipH.checked = Boolean(spec.flipH);
      const flipV = dialog.shadowRoot.querySelector('#siat-tf-flipv');
      if (flipV) flipV.checked = Boolean(spec.flipV);
    }
    if (controls.rotateLabel) controls.rotateLabel.textContent = `${spec.rotate}°`;
  }

  function presetIdFor(resize) {
    const found = RESIZE_PRESETS.find((entry) => entry.mode === resize.mode && (entry.width || 0) === (Number(resize.width) || 0));
    return found ? found.id : 'none';
  }

  function aspectPlan() {
    return planTransform({ sourceWidth: sourceWidth(), sourceHeight: sourceHeight(), transform: { ...spec, resize: { mode: 'none' } } });
  }

  function currentPlan() {
    return planTransform({ sourceWidth: sourceWidth() || 1, sourceHeight: sourceHeight() || 1, transform: spec });
  }

  /**
   * Recompute the preview, the output readout and any warnings.
   *
   * The preview canvas is created once per image, so refreshing never rebuilds
   * the DOM: focus stays where the user put it and a pointer drag is not
   * interrupted by the element being replaced underneath.
   *
   * While cropping, the preview shows the whole image with the crop region
   * highlighted (the conventional crop UI); otherwise it shows the rotate/flip
   * result. Resize is never previewed at preview scale — the exact output size
   * is computed from the real pixels and printed beside it.
   */
  function refresh() {
    if (!dialog.isOpen) return;
    if (controls.rotateLabel) controls.rotateLabel.textContent = `${spec.rotate}°`;
    const plan = currentPlan();
    const active = isTransformActive(spec);

    if (previewCanvas && deps.createCanvas) {
      const previewSpec = {
        resize: { mode: 'none', width: 0, height: 0, keepAspect: true },
        crop: null,
        rotate: cropEnabled ? 0 : spec.rotate,
        flipH: cropEnabled ? false : spec.flipH,
        flipV: cropEnabled ? false : spec.flipV,
      };
      let drawable = previewCanvas;
      if (isTransformActive(previewSpec)) {
        try {
          drawable = applyTransform({
            source: previewCanvas,
            transform: previewSpec,
            createCanvas: deps.createCanvas,
            sourceWidth: previewCanvas.width,
            sourceHeight: previewCanvas.height,
          }).canvas;
        } catch {
          drawable = previewCanvas;
        }
      }
      drawPreview(drawable);
    }

    const checked = validateTransform(spec, { sourceWidth: sourceWidth(), sourceHeight: sourceHeight() });
    const problems = checked.errors.slice();
    if (!(sourceWidth() > 0)) problems.push('The source has no pixel size yet.');
    if (!active) problems.push('No transform selected — the image will be re-encoded and saved as-is.');
    warnEl.textContent = problems.join(' ');

    const format = controls.format ? controls.format.value : 'png';
    outputEl.textContent =
      `${sourceWidth()}×${sourceHeight()} → ${plan.width}×${plan.height} px` +
      ` · ${active ? describeTransform(spec) : 'no transform'}` +
      ` · saved as ${String(format).toUpperCase()}` +
      (plan.steps.length ? ` · steps: ${plan.steps.join(' → ')}` : '');
    renderCropBox();
    if (controls.preset) controls.preset.value = presetIdFor(spec.resize);
  }

  /** Create the preview structure once per loaded image. */
  function buildPreviewHost() {
    if (!previewHost) return;
    previewHost.textContent = '';
    const wrap = dialogEl(doc, 'div', {
      className: 'siat-cropwrap',
      attrs: { tabindex: '0', role: 'group', 'aria-label': 'Crop region. Arrow keys move it; Shift plus arrow keys resize it.' },
    });
    wrap.id = 'siat-tf-cropwrap';
    const canvas = doc.createElement('canvas');
    canvas.id = 'siat-tf-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Preview of the image');
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '34vh';
    canvas.style.display = 'block';
    wrap.appendChild(canvas);
    cropBox = dialogEl(doc, 'div', { className: 'siat-cropbox', attrs: { 'aria-hidden': 'true' } });
    cropHandle = dialogEl(doc, 'div', { className: 'siat-crophandle' });
    cropHandle.style.right = '-6px';
    cropHandle.style.bottom = '-6px';
    cropBox.appendChild(cropHandle);
    cropDims = dialogEl(doc, 'span', { className: 'siat-cropdims', text: '' });
    cropBox.appendChild(cropDims);
    wrap.appendChild(cropBox);
    previewHost.appendChild(wrap);
    previewEl = canvas;
    attachCropDrag(wrap);
    attachCropKeys(wrap);
  }

  function drawPreview(canvas) {
    if (!previewEl) buildPreviewHost();
    if (!previewEl) return;
    if (previewEl.width !== canvas.width || previewEl.height !== canvas.height) {
      previewEl.width = canvas.width;
      previewEl.height = canvas.height;
    }
    const ctx = previewEl.getContext ? previewEl.getContext('2d') : null;
    if (!ctx) return;
    try {
      ctx.clearRect(0, 0, previewEl.width, previewEl.height);
      ctx.drawImage(canvas, 0, 0);
    } catch {
      /* a preview failure is cosmetic; the numbers beside it are authoritative */
    }
  }

  /** Natural pixels → displayed pixels, for the crop overlay and drag maths. */
  function previewRatio() {
    if (!previewEl || !previewCanvas || !previewCanvas.width) return 0;
    const displayed = previewEl.clientWidth || previewEl.width || 0;
    if (!(displayed > 0)) return 0;
    return previewScale * (displayed / previewCanvas.width);
  }

  function renderCropBox() {
    if (!cropBox) return;
    cropBox.style.display = cropEnabled && spec.crop ? '' : 'none';
    if (!cropEnabled || !spec.crop) return;
    const ratio = previewRatio();
    if (!(ratio > 0)) return;
    cropBox.style.left = `${Math.round(spec.crop.x * ratio)}px`;
    cropBox.style.top = `${Math.round(spec.crop.y * ratio)}px`;
    cropBox.style.width = `${Math.max(4, Math.round(spec.crop.width * ratio))}px`;
    cropBox.style.height = `${Math.max(4, Math.round(spec.crop.height * ratio))}px`;
    if (cropDims) cropDims.textContent = `${spec.crop.width}×${spec.crop.height} at ${spec.crop.x},${spec.crop.y}`;
  }

  function attachCropDrag(wrap) {
    if (!cropBox) return;
    let mode = null;
    let startX = 0;
    let startY = 0;
    let startCrop = null;

    // Displayed pixels → natural pixels.
    const naturalPerPixel = () => {
      const ratio = previewRatio();
      return ratio > 0 ? 1 / ratio : 1;
    };

    const onDown = (event) => {
      if (!cropEnabled) return;
      mode = event.target === cropHandle ? 'resize' : 'move';
      startX = event.clientX;
      startY = event.clientY;
      startCrop = Object.assign({}, spec.crop);
      try {
        cropBox.setPointerCapture(event.pointerId);
      } catch {
        /* older engines: mouse events still work */
      }
      event.preventDefault();
    };
    const onMove = (event) => {
      if (!mode || !startCrop) return;
      const ratio = naturalPerPixel();
      const deltaX = Math.round((event.clientX - startX) * ratio);
      const deltaY = Math.round((event.clientY - startY) * ratio);
      const next = Object.assign({}, startCrop);
      if (mode === 'move') {
        next.x = clampTransformValue(startCrop.x + deltaX, 0, Math.max(0, sourceWidth() - startCrop.width));
        next.y = clampTransformValue(startCrop.y + deltaY, 0, Math.max(0, sourceHeight() - startCrop.height));
      } else {
        next.width = clampTransformValue(startCrop.width + deltaX, 8, sourceWidth() - startCrop.x);
        next.height = clampTransformValue(startCrop.height + deltaY, 8, sourceHeight() - startCrop.y);
      }
      spec.crop = next;
      syncControls();
      refresh();
    };
    const onUp = () => {
      mode = null;
      startCrop = null;
    };
    cropBox.addEventListener('pointerdown', guardUserEvent(onDown));
    cropBox.addEventListener('pointermove', guardUserEvent(onMove));
    cropBox.addEventListener('pointerup', guardUserEvent(onUp));
    cropBox.addEventListener('pointercancel', guardUserEvent(onUp));
    wrap.addEventListener('pointerdown', guardUserEvent((event) => {
      if (event.target === cropBox || event.target === cropHandle) return;
      onDown(event);
    }));
  }

  function attachCropKeys(wrap) {
    wrap.addEventListener('keydown', guardUserEvent((event) => {
      if (!cropEnabled || !spec.crop) return;
      const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const delta = keys[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const next = Object.assign({}, spec.crop);
      if (event.shiftKey) {
        next.width = clampTransformValue(next.width + delta[0] * step, 8, sourceWidth() - next.x);
        next.height = clampTransformValue(next.height + delta[1] * step, 8, sourceHeight() - next.y);
      } else {
        next.x = clampTransformValue(next.x + delta[0] * step, 0, Math.max(0, sourceWidth() - next.width));
        next.y = clampTransformValue(next.y + delta[1] * step, 0, Math.max(0, sourceHeight() - next.height));
      }
      spec.crop = next;
      syncControls();
      refresh();
    }));
  }

  function submit(makeDefault) {
    if (!source) {
      warnEl.textContent = 'The image is still loading — try again in a moment.';
      return;
    }
    const checked = validateTransform(spec, { sourceWidth: sourceWidth(), sourceHeight: sourceHeight() });
    if (!checked.ok) { warnEl.textContent = checked.errors.join(' '); return; }
    const formatId = controls.format ? controls.format.value : 'png';
    const payload = { target, transform: cloneSpec(spec), formatId, makeDefault: Boolean(makeDefault) };
    dialog.close();
    if (typeof deps.onSubmit === 'function') deps.onSubmit(payload);
  }

  function releaseSource() {
    if (source && typeof source.release === 'function') {
      try {
        source.release();
      } catch {
        /* noop */
      }
    }
    source = null;
    previewCanvas = null;
    previewEl = null;
  }

  return {
    open(nextTarget, options = {}) {
      previewGeneration += 1;
      loading = false;
      target = nextTarget || null;
      releaseSource();
      spec = cloneSpec(options.transform || TRANSFORM_DEFAULTS);
      cropEnabled = Boolean(spec.crop);
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
    /** Automation/test seam: the spec the dialog would submit right now. */
    currentSpec: () => cloneSpec(spec),
    currentPlan: () => currentPlan(),
    destroy() {
      releaseSource();
      dialog.destroy();
    },
  };
}

function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec || TRANSFORM_DEFAULTS));
}

function clampTransformValue(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.max(min, max), number));
}
