/**
 * Owned UI event boundary. The page may dispatch DOM events but cannot make
 * browser-dispatched interaction events trusted. Reject synthetic interactions
 * before invoking script callbacks; never preventDefault on the host's behalf.
 * Non-interaction lifecycle/media events keep their existing semantics.
 *
 * Offline verification uses an explicit compiler/loader transform of this one
 * policy function. There is NO runtime flag, attribute, option or global hook.
 * As with all DOM code, native EventTarget/Event integrity is assumed: a hostile
 * same-world party replacing browser intrinsics is not a userscript sandbox.
 */
const UI_INTERACTION_EVENTS = new Set([
  'click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'contextmenu',
  'mousedown', 'mouseup', 'mouseover', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
]);
const uiGuardedHandlers = new WeakMap();

export function isUserEventAllowed(event) {
  return event !== null && event !== undefined && event.isTrusted === true;
}

export function guardUserEvent(handler) {
  if (typeof handler !== 'function') return handler;
  if (uiGuardedHandlers.has(handler)) return uiGuardedHandlers.get(handler);
  const wrapped = function (event) {
    if (UI_INTERACTION_EVENTS.has(event.type) && !isUserEventAllowed(event)) return;
    return handler.call(this, event);
  };
  uiGuardedHandlers.set(handler, wrapped);
  return wrapped;
}
