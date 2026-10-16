/**
 * Job queue for batch work.
 *
 * Batch conversion is the one place where the script performs many
 * non-idempotent actions (file saves) in a row, so the states are modelled
 * explicitly rather than implied by a counter:
 *
 *   queued → running → done
 *                    → failed   (with `retryable` / `uncertain` flags)
 *                    → skipped  (never attempted: filtered out, or no source)
 *   any queued item → cancelled (a cancel never leaves work half-claimed)
 *
 * Rules that matter for correctness:
 *   - bounded concurrency, so a 500-image page cannot open 500 fetches;
 *   - per-item isolation: one failure never aborts the run;
 *   - a save whose *outcome is unknown* is never retried automatically — the
 *     user is told to check the download folder first;
 *   - `retryFailed()` only re-queues FAILED items, so a finished save can never
 *     be repeated by accident;
 *   - cancel is synchronous in intent: running items get an AbortSignal and
 *     queued items are marked cancelled immediately.
 */

import { ScriptError } from './errors.js';

export const JOB_STATES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  DONE: 'done',
  CANCELLED: 'cancelled',
});

export const ITEM_STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});

export const QUEUE_LIMITS = Object.freeze({
  maxItems: 5000,
  maxConcurrency: 4,
  defaultConcurrency: 2,
  defaultItemTimeoutMs: 60000,
});

let itemSequence = 0;

/**
 * @param {object} params
 * @param {(item: object, helpers: {signal: AbortSignal}) => Promise<any>} params.run
 *        Performs the work for one item. Resolve with a result object, or throw.
 *        A thrown error may carry `retryable` and `uncertain` booleans.
 * @param {number} [params.concurrency]
 * @param {number} [params.itemTimeoutMs]
 * @param {number} [params.autoRetries] automatic retries, retryable errors only
 * @param {(event: object) => void} [params.onEvent]
 * @param {() => number} [params.now]
 */
export function createJobQueue({
  run,
  concurrency = QUEUE_LIMITS.defaultConcurrency,
  itemTimeoutMs = QUEUE_LIMITS.defaultItemTimeoutMs,
  autoRetries = 1,
  onEvent = () => {},
  now = () => Date.now(),
  label = 'job',
} = {}) {
  if (typeof run !== 'function') throw new ScriptError('queue-no-runner', 'A job queue needs a run function.');

  const items = [];
  const byId = new Map();
  const listeners = new Set([onEvent]);
  const controllers = new Map();
  let state = JOB_STATES.IDLE;
  let startedAt = 0;
  let endedAt = 0;
  let activeWorkers = 0;
  let destroyed = false;

  const limit = Math.max(1, Math.min(QUEUE_LIMITS.maxConcurrency, Math.round(concurrency) || QUEUE_LIMITS.defaultConcurrency));
  const retries = Math.max(0, Math.min(3, Math.round(autoRetries) || 0));
  const timeoutMs = Math.max(1000, Math.min(600000, Math.round(itemTimeoutMs) || QUEUE_LIMITS.defaultItemTimeoutMs));

  const emit = (event) => {
    if (destroyed) return;
    for (const listener of listeners) {
      try {
        listener(Object.assign({ jobLabel: label, stats: stats() }, event));
      } catch {
        /* a broken listener must not break the run */
      }
    }
  };

  /**
   * Add work. Items already known by id are ignored (a re-scan of a page must
   * not enqueue the same image twice).
   *
   * @param {Array<{id?: string, label?: string, payload?: any, skipReason?: string}>} list
   */
  function add(list) {
    if (destroyed) return { added: 0, duplicates: 0, overLimit: 0 };
    const incoming = Array.isArray(list) ? list : [];
    let added = 0;
    let duplicates = 0;
    let overLimit = 0;
    for (const raw of incoming) {
      if (!raw) continue;
      const id = String(raw.id || `item-${(itemSequence += 1)}`);
      if (byId.has(id)) {
        duplicates += 1;
        continue;
      }
      if (items.length >= QUEUE_LIMITS.maxItems) {
        overLimit += 1;
        continue;
      }
      const item = {
        id,
        label: String(raw.label || id).slice(0, 160),
        payload: raw.payload,
        state: raw.skipReason ? ITEM_STATES.SKIPPED : ITEM_STATES.QUEUED,
        attempts: 0,
        autoRetries: 0,
        result: null,
        error: null,
        errorCode: '',
        retryable: false,
        uncertain: false,
        skipReason: raw.skipReason ? String(raw.skipReason).slice(0, 200) : '',
        startedAt: 0,
        endedAt: 0,
        durationMs: 0,
      };
      items.push(item);
      byId.set(id, item);
      added += 1;
    }
    if (added || duplicates || overLimit) {
      emit({ type: 'added', added, duplicates, overLimit });
    }
    return { added, duplicates, overLimit };
  }

  /**
   * Fill the free worker slots.
   *
   * Deliberately not awaited per item: the slot count is what bounds
   * concurrency, and awaiting inside the loop would serialise the run (a
   * 200-image batch at "4 at a time" would take four times as long). Each
   * worker owns its own error handling, so a rejection cannot escape here.
   */
  function pump() {
    if (destroyed) return;
    while (state === JOB_STATES.RUNNING && activeWorkers < limit) {
      const item = items.find((candidate) => candidate.state === ITEM_STATES.QUEUED);
      if (!item) break;
      activeWorkers += 1;
      item.state = ITEM_STATES.RUNNING;
      item.startedAt = now();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) controllers.set(item.id, controller);
      emit({ type: 'item-start', item: snapshot(item) });

      const releaseSlot = () => {
        controllers.delete(item.id);
        activeWorkers -= 1;
        // Take the next item as soon as a slot frees, then check for the end.
        pump();
        maybeFinish();
      };
      Promise.resolve()
        .then(() => execute(item, controller))
        .then(releaseSlot, releaseSlot);
    }
    maybeFinish();
  }

  async function execute(item, controller) {
    item.attempts += 1;
    const timer = controller && timeoutMs ? setTimeout(() => controller.abort(new ScriptError('timeout', `Timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs) : null;
    try {
      const result = await run(item, { signal: controller ? controller.signal : null, attempt: item.attempts });
      item.state = ITEM_STATES.DONE;
      item.result = result === undefined ? null : result;
      item.error = null;
      item.errorCode = '';
      item.retryable = false;
      item.uncertain = false;
    } catch (err) {
      const cancelled = Boolean(controller && controller.signal && controller.signal.aborted) && state === JOB_STATES.CANCELLED;
      const timedOut = Boolean(controller && controller.signal && controller.signal.aborted) && !cancelled;
      if (cancelled) {
        item.state = ITEM_STATES.CANCELLED;
        item.error = null;
        item.errorCode = 'cancelled';
      } else {
        item.state = ITEM_STATES.FAILED;
        item.error = err && err.message ? err.message : String(err || 'unknown error');
        // A timeout is classified here, not by the runner: the runner only knows
        // its signal fired, and reporting that as "aborted" would hide the real
        // cause (and the advice that goes with it) from the user.
        item.errorCode = timedOut ? 'timeout' : (err && err.code) || 'error';
        // An uncertain outcome means the file may already be on disk: repeating
        // it silently could create duplicates, so it is never auto-retried.
        item.uncertain = Boolean(err && (err.uncertain || item.errorCode === 'timeout'));
        item.retryable = Boolean(err && err.retryable) && !item.uncertain;
        if (item.retryable && item.autoRetries < retries && state === JOB_STATES.RUNNING) {
          item.autoRetries += 1;
          item.state = ITEM_STATES.QUEUED;
          emit({ type: 'item-retry', item: snapshot(item), reason: item.error, autoRetry: item.autoRetries });
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      item.endedAt = now();
      item.durationMs = Math.max(0, item.endedAt - (item.startedAt || item.endedAt));
      emit({ type: 'item-end', item: snapshot(item) });
    }
  }

  function maybeFinish() {
    if (state !== JOB_STATES.RUNNING) return;
    const pending = items.some((item) => item.state === ITEM_STATES.QUEUED || item.state === ITEM_STATES.RUNNING);
    if (pending || activeWorkers > 0) return;
    state = JOB_STATES.DONE;
    endedAt = now();
    emit({ type: 'finished', stats: stats() });
  }

  function start() {
    if (destroyed) return { started: false, reason: 'destroyed' };
    if (state === JOB_STATES.RUNNING) return { started: false, reason: 'already-running' };
    const hasWork = items.some((item) => item.state === ITEM_STATES.QUEUED);
    if (!hasWork) return { started: false, reason: 'no-work' };
    if (!startedAt) startedAt = now();
    state = JOB_STATES.RUNNING;
    endedAt = 0;
    emit({ type: 'started', concurrency: limit });
    try {
      pump();
    } catch (err) {
      state = JOB_STATES.DONE;
      endedAt = now();
      emit({ type: 'error', message: err && err.message ? err.message : 'The job stopped unexpectedly.' });
    }
    return { started: true };
  }

  function pause() {
    if (destroyed) return false;
    if (state !== JOB_STATES.RUNNING) return false;
    state = JOB_STATES.PAUSED;
    emit({ type: 'paused' });
    return true;
  }

  function resume() {
    if (destroyed) return false;
    if (state !== JOB_STATES.PAUSED) return false;
    state = JOB_STATES.RUNNING;
    emit({ type: 'resumed' });
    pump();
    return true;
  }

  /**
   * Stop the run. Running items are aborted and marked cancelled; queued items
   * are cancelled without being touched. Finished items keep their results.
   */
  function cancel() {
    if (destroyed) return { cancelled: 0, state };
    if (state === JOB_STATES.CANCELLED) return { cancelled: 0, state };
    const wasActive = state === JOB_STATES.RUNNING || state === JOB_STATES.PAUSED;
    state = JOB_STATES.CANCELLED;
    let cancelled = 0;
    for (const item of items) {
      if (item.state === ITEM_STATES.QUEUED) {
        item.state = ITEM_STATES.CANCELLED;
        item.endedAt = now();
        cancelled += 1;
        emit({ type: 'item-end', item: snapshot(item) });
      }
    }
    for (const controller of controllers.values()) {
      try {
        controller.abort();
      } catch {
        /* noop */
      }
    }
    endedAt = now();
    emit({ type: 'cancelled', cancelled, wasActive });
    return { cancelled, state };
  }

  /**
   * Re-queue failed items only. Done items are never touched, so a retry cannot
   * produce a second copy of a file that already saved.
   */
  function retryFailed({ includeUncertain = false } = {}) {
    if (destroyed) return 0;
    let requeued = 0;
    for (const item of items) {
      if (item.state !== ITEM_STATES.FAILED) continue;
      if (item.uncertain && !includeUncertain) continue;
      item.state = ITEM_STATES.QUEUED;
      item.error = null;
      item.errorCode = '';
      item.result = null;
      item.autoRetries = 0;
      item.endedAt = 0;
      item.durationMs = 0;
      requeued += 1;
    }
    if (requeued) {
      emit({ type: 'requeued', count: requeued });
      if (state !== JOB_STATES.RUNNING && state !== JOB_STATES.PAUSED) {
        state = JOB_STATES.IDLE;
        start();
      } else if (state === JOB_STATES.RUNNING) {
        pump();
      }
    }
    return requeued;
  }

  function stats() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0, cancelled: 0 };
    let bytes = 0;
    let uncertain = 0;
    for (const item of items) {
      counts[item.state] = (counts[item.state] || 0) + 1;
      if (item.state === ITEM_STATES.DONE && item.result && typeof item.result.bytes === 'number') bytes += item.result.bytes;
      if (item.uncertain) uncertain += 1;
    }
    const attempted = counts.done + counts.failed + counts.cancelled + counts.running;
    return {
      state,
      total: items.length,
      attempted,
      ...counts,
      bytes,
      uncertain,
      concurrency: limit,
      startedAt,
      endedAt,
      durationMs: startedAt ? (endedAt || now()) - startedAt : 0,
      complete: counts.queued === 0 && counts.running === 0 && items.length > 0,
    };
  }

  function snapshot(item) {
    return {
      id: item.id,
      label: item.label,
      state: item.state,
      attempts: item.attempts,
      autoRetries: item.autoRetries,
      error: item.error,
      errorCode: item.errorCode,
      retryable: item.retryable,
      uncertain: item.uncertain,
      skipReason: item.skipReason,
      durationMs: item.durationMs,
      result: item.result,
    };
  }

  return {
    add,
    start,
    pause,
    resume,
    cancel,
    retryFailed,
    stats,
    items: () => items.map(snapshot),
    item: (id) => (byId.has(String(id)) ? snapshot(byId.get(String(id))) : null),
    subscribe(listener) {
      if (typeof listener === 'function') listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get state() {
      return state;
    },
    get concurrency() {
      return limit;
    },
    destroy() {
      destroyed = true;
      cancel();
      listeners.clear();
      controllers.clear();
      items.length = 0;
      byId.clear();
    },
  };
}
