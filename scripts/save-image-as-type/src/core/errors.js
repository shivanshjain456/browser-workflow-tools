/**
 * Small shared error type.
 *
 * Every failure this script reports to a user carries a stable `code` so the UI
 * can pick an explanation (and so tests can assert on the reason rather than on
 * prose that may be reworded). `detail` holds structured context that must never
 * be interpolated into HTML — it is only ever rendered as text.
 */

export class ScriptError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ScriptError';
    this.code = String(code || 'error');
    this.detail = detail;
  }
}

/** True for anything thrown by this script with a stable code. */
export function isCodedError(err) {
  return Boolean(err && typeof err.code === 'string' && err.code.length > 0);
}

/** Human text for any thrown value, never empty and never a stack trace. */
export function messageOf(err, fallback = 'Something went wrong.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const text = err.message || err.reason || '';
  return typeof text === 'string' && text.trim() ? text.trim() : fallback;
}
