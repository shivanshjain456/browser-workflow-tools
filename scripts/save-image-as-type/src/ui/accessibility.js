/** Shared preference overrides, appended LAST inside every owned shadow tree.
 * Uses system colours rather than fighting the browser's forced-colour palette.
 * This is a stylesheet helper, not a surface that constructs another host.
 */
export const ACCESSIBILITY_STYLE = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
@media (prefers-contrast: more) {
  button, input, select, textarea, [role="dialog"], [role="menu"] { border-width: 2px; }
  :focus-visible { outline: 3px solid currentColor !important; outline-offset: 3px; }
}
@media (forced-colors: active) {
  * { box-shadow: none !important; text-shadow: none !important; }
  [role="dialog"], [role="menu"], [role="status"], [role="alert"],
  .siat-jobbar, .siat-toast, .siat-body, .siat-dialog-head, .siat-dialog-foot {
    background: Canvas !important; color: CanvasText !important; border-color: CanvasText !important;
  }
  small, label, summary, p, li, td, th, span, .siat-hint, .siat-meta, .siat-desc,
  .siat-note, .siat-dialog-subtitle { color: CanvasText !important; }
  button { background: ButtonFace !important; color: ButtonText !important; border: 1px solid ButtonText !important; }
  input, select, textarea { background: Field !important; color: FieldText !important; border-color: FieldText !important; accent-color: Highlight; }
  a { color: LinkText !important; }
  :focus-visible { outline: 3px solid Highlight !important; outline-offset: 3px; }
  [aria-selected="true"], [aria-checked="true"] { outline: 2px solid Highlight; }
  img, canvas { forced-color-adjust: none; }
}
`;
