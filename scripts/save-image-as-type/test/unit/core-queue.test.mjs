import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createJobQueue, JOB_STATES, ITEM_STATES, QUEUE_LIMITS } from '../../src/core/queue.js';

/**
 * Feature: batch conversion — the state machine underneath it.
 *
 * A batch performs many non-idempotent actions (file saves) in a row, so the
 * properties tested here are the ones a user can be harmed by:
 *   - bounded concurrency (a 500-image page must not open 500 fetches);
 *   - one failure never aborts the run;
 *   - cancel really stops it, and never leaves work half-claimed;
 *   - an item whose outcome is *unknown* is never repeated automatically;
 *   - a retry can only touch items that failed, so a file that already saved is
 *     never written twice.
 */

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function list(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => Object.assign({ id: `item-${i}`, label: `image ${i}`, payload: { index: i } }, extra));
}

describe('queue — normal runs', () => {
  test('every item runs exactly once and the job reports done', async () => {
    const seen = [];
    const queue = createJobQueue({
      concurrency: 2,
      run: async (item) => {
        seen.push(item.id);
        return { bytes: 10 };
      },
    });
    queue.add(list(6));
    assert.deepEqual(queue.start(), { started: true });
    await tick(20);
    const stats = queue.stats();
    assert.equal(seen.length, 6, 'six items ran');
    assert.equal(new Set(seen).size, 6, 'no item ran twice');
    assert.equal(stats.state, JOB_STATES.DONE);
    assert.equal(stats.total, 6);
    assert.equal(stats.done, 6);
    assert.equal(stats.failed, 0);
    assert.equal(stats.bytes, 60, 'result bytes are summed');
    assert.equal(stats.complete, true);
    assert.ok(stats.durationMs >= 0);
  });

  test('concurrency is bounded at every moment, and clamped to the documented maximum', async () => {
    let active = 0;
    let peak = 0;
    const queue = createJobQueue({
      concurrency: 3,
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(5);
        active -= 1;
        return {};
      },
    });
    queue.add(list(12));
    queue.start();
    await tick(120);
    assert.equal(peak, 3, `peak concurrency was ${peak}`);
    assert.equal(queue.stats().done, 12);
    assert.equal(queue.concurrency, 3);

    const wild = createJobQueue({ concurrency: 99, run: async () => ({}) });
    assert.equal(wild.concurrency, QUEUE_LIMITS.maxConcurrency, 'an absurd concurrency is clamped, not honoured');
    const zero = createJobQueue({ concurrency: 0, run: async () => ({}) });
    assert.equal(zero.concurrency, QUEUE_LIMITS.defaultConcurrency, 'a nonsense concurrency falls back to the default');
  });

  test('a start with no queued work is refused with a reason (all-skipped selection)', () => {
    const queue = createJobQueue({ run: async () => ({}) });
    queue.add(list(3, { skipReason: 'not loaded yet' }));
    assert.deepEqual(queue.start(), { started: false, reason: 'no-work' });
    const stats = queue.stats();
    assert.equal(stats.skipped, 3);
    assert.equal(stats.done, 0);
    assert.equal(stats.complete, true, 'an all-skipped run is complete, so a waiter cannot hang');
    assert.equal(queue.state, JOB_STATES.IDLE);
  });

  test('skipped items are never handed to the runner', async () => {
    const ran = [];
    const queue = createJobQueue({
      run: async (item) => {
        ran.push(item.id);
        return {};
      },
    });
    queue.add([
      { id: 'a', label: 'a' },
      { id: 'b', label: 'b', skipReason: 'broken source' },
      { id: 'c', label: 'c' },
    ]);
    queue.start();
    await tick(10);
    assert.deepEqual(ran, ['a', 'c']);
    const skipped = queue.item('b');
    assert.equal(skipped.state, ITEM_STATES.SKIPPED);
    assert.equal(skipped.skipReason, 'broken source');
    assert.equal(skipped.attempts, 0);
  });

  test('re-adding the same id is ignored, so a re-scan cannot enqueue an image twice', () => {
    const queue = createJobQueue({ run: async () => ({}) });
    assert.deepEqual(queue.add(list(3)), { added: 3, duplicates: 0, overLimit: 0 });
    assert.deepEqual(queue.add(list(3)), { added: 0, duplicates: 3, overLimit: 0 });
    assert.equal(queue.stats().total, 3);
  });

  test('the item cap is enforced and reported rather than silently dropping work', () => {
    const queue = createJobQueue({ run: async () => ({}) });
    const result = queue.add(list(QUEUE_LIMITS.maxItems + 50));
    assert.equal(result.added, QUEUE_LIMITS.maxItems);
    assert.equal(result.overLimit, 50);
    assert.equal(queue.stats().total, QUEUE_LIMITS.maxItems);
  });

  test('a runner is mandatory: a queue without one cannot be built', () => {
    assert.throws(() => createJobQueue({}), /needs a run function/);
    assert.throws(() => createJobQueue(), /needs a run function/);
  });

  test('pause stops picking up work and resume continues from where it left off', async () => {
    const ran = [];
    const queue = createJobQueue({
      concurrency: 1,
      run: async (item) => {
        ran.push(item.id);
        await tick(5);
        return {};
      },
    });
    queue.add(list(4));
    queue.start();
    await tick(2);
    assert.equal(queue.pause(), true);
    assert.equal(queue.state, JOB_STATES.PAUSED);
    await tick(30);
    const afterPause = ran.length;
    assert.ok(afterPause <= 1, `no new work started while paused (${afterPause} ran)`);
    assert.equal(queue.resume(), true);
    await tick(60);
    assert.equal(queue.stats().done, 4, 'the rest finished after resume');
    assert.equal(queue.pause(), false, 'pausing a finished run does nothing');
  });
});

describe('queue — failure isolation and retry semantics', () => {
  test('one failing item never stops the others, and the failure is described', async () => {
    const queue = createJobQueue({
      concurrency: 1,
      run: async (item) => {
        if (item.id === 'item-1') {
          const error = new Error('The encoder produced no data.');
          error.code = 'encode-failed';
          throw error;
        }
        return { bytes: 5 };
      },
    });
    queue.add(list(4));
    queue.start();
    await tick(30);
    const stats = queue.stats();
    assert.equal(stats.done, 3);
    assert.equal(stats.failed, 1);
    assert.equal(stats.complete, true);
    const failed = queue.item('item-1');
    assert.equal(failed.state, ITEM_STATES.FAILED);
    assert.equal(failed.errorCode, 'encode-failed');
    assert.match(failed.error, /no data/);
    assert.equal(failed.retryable, false, 'an ordinary error is not marked retryable');
    assert.equal(failed.uncertain, false);
  });

  test('a retryable error is auto-retried within the budget, then recorded as failed', async () => {
    let attempts = 0;
    const queue = createJobQueue({
      concurrency: 1,
      autoRetries: 2,
      run: async () => {
        attempts += 1;
        const error = new Error('transient');
        error.retryable = true;
        throw error;
      },
    });
    queue.add(list(1));
    queue.start();
    await tick(30);
    assert.equal(attempts, 3, 'one attempt plus two automatic retries');
    const item = queue.item('item-0');
    assert.equal(item.state, ITEM_STATES.FAILED);
    assert.equal(item.autoRetries, 2);
    assert.equal(item.attempts, 3);
  });

  test('an auto-retry that succeeds reports success', async () => {
    let attempts = 0;
    const queue = createJobQueue({
      autoRetries: 1,
      run: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('transient');
          error.retryable = true;
          throw error;
        }
        return { bytes: 7 };
      },
    });
    queue.add(list(1));
    queue.start();
    await tick(20);
    assert.equal(queue.stats().done, 1);
    assert.equal(queue.stats().failed, 0);
    assert.equal(queue.stats().bytes, 7);
  });

  test('REGRESSION: an uncertain outcome is never auto-retried', async () => {
    // A save that timed out may already be on disk. Repeating it silently is how
    // a batch produces duplicate files the user then has to find and delete.
    let attempts = 0;
    const queue = createJobQueue({
      autoRetries: 3,
      run: async () => {
        attempts += 1;
        const error = new Error('The manager did not confirm the download.');
        error.uncertain = true;
        error.retryable = true; // even when the error claims to be retryable
        throw error;
      },
    });
    queue.add(list(1));
    queue.start();
    await tick(30);
    assert.equal(attempts, 1, 'exactly one attempt');
    const item = queue.item('item-0');
    assert.equal(item.state, ITEM_STATES.FAILED);
    assert.equal(item.uncertain, true);
    assert.equal(item.retryable, false, 'uncertain wins over retryable');
    assert.equal(queue.stats().uncertain, 1, 'the summary can count uncertain saves');
  });

  test('retryFailed() re-queues failures only: a finished save is never repeated', async () => {
    const runs = [];
    let failFirst = true;
    const queue = createJobQueue({
      concurrency: 1,
      run: async (item) => {
        runs.push(item.id);
        if (item.id === 'item-1' && failFirst) {
          failFirst = false;
          throw new Error('nope');
        }
        return { bytes: 1 };
      },
    });
    queue.add(list(3));
    queue.start();
    await tick(30);
    assert.equal(queue.stats().done, 2);
    assert.equal(queue.stats().failed, 1);

    assert.equal(queue.retryFailed(), 1, 'only the failed item was re-queued');
    await tick(30);
    assert.equal(queue.stats().done, 3);
    assert.equal(queue.stats().failed, 0);
    assert.deepEqual(runs.filter((id) => id === 'item-0').length, 1, 'the successful item never ran again');
    assert.deepEqual(runs.filter((id) => id === 'item-2').length, 1, 'nor did the other successful one');
    assert.equal(queue.retryFailed(), 0, 'a second retry with nothing failed is a no-op');
  });

  test('retryFailed() leaves uncertain items alone unless the caller insists', async () => {
    let attempts = 0;
    const queue = createJobQueue({
      run: async () => {
        attempts += 1;
        const error = new Error('unknown outcome');
        error.uncertain = true;
        throw error;
      },
    });
    queue.add(list(1));
    queue.start();
    await tick(20);
    assert.equal(queue.retryFailed(), 0, 'not re-queued by default');
    assert.equal(queue.retryFailed({ includeUncertain: true }), 1, 'the user can insist explicitly');
    await tick(20);
    assert.equal(attempts, 2);
  });

  test('an item that never settles is timed out, marked uncertain and reported', async () => {
    // The timeout aborts the item's signal; a runner that checks it (every real
    // runner in this script does) then ends the item as a failure rather than
    // holding a worker slot forever.
    const gate = deferred();
    const queue = createJobQueue({
      itemTimeoutMs: 1000,
      run: async (item, helpers) => {
        await gate.promise;
        if (helpers.signal && helpers.signal.aborted) {
          const error = new Error('Timed out after 1s.');
          error.code = 'aborted';
          throw error;
        }
        return {};
      },
    });
    queue.add(list(1));
    queue.start();
    await tick(1100);
    assert.equal(queue.item('item-0').state, ITEM_STATES.RUNNING, 'still in flight, but its signal is now aborted');
    gate.resolve();
    await tick(20);
    const item = queue.item('item-0');
    assert.equal(item.state, ITEM_STATES.FAILED, 'a wedged item ends as a failure, not a hang');
    assert.equal(item.errorCode, 'timeout', 'the timeout is named, not reported as a generic error');
    assert.equal(item.uncertain, true, 'a timeout is an uncertain outcome: the file may exist');
    assert.equal(queue.stats().uncertain, 1);
    assert.equal(queue.stats().complete, true);
  });
});

describe('queue — cancellation', () => {
  test('cancel marks queued items cancelled, aborts running ones and keeps finished results', async () => {
    const started = [];
    const gate = deferred();
    const queue = createJobQueue({
      concurrency: 1,
      run: async (item, helpers) => {
        started.push(item.id);
        if (item.id === 'item-1') {
          await gate.promise;
          if (helpers.signal && helpers.signal.aborted) {
            const error = new Error('cancelled by the user');
            error.code = 'aborted';
            throw error;
          }
        }
        return { bytes: 3 };
      },
    });
    queue.add(list(4));
    queue.start();
    await tick(10);
    assert.deepEqual(started, ['item-0', 'item-1'], 'the second item was in flight');

    const result = queue.cancel();
    gate.resolve();
    await tick(20);

    assert.equal(queue.state, JOB_STATES.CANCELLED);
    assert.ok(result.cancelled >= 2, `queued items were cancelled (${result.cancelled})`);
    const stats = queue.stats();
    assert.equal(stats.done, 1, 'the finished item kept its result');
    assert.equal(stats.bytes, 3);
    assert.equal(stats.cancelled + stats.failed, 3, 'the rest are cancelled or reported as aborted');
    assert.equal(stats.complete, true);
    assert.deepEqual(queue.cancel(), { cancelled: 0, state: JOB_STATES.CANCELLED }, 'a second cancel is a no-op');
  });

  test('the runner sees an aborted signal, so no further work is started', async () => {
    let sawAbort = false;
    const gate = deferred();
    const queue = createJobQueue({
      concurrency: 1,
      run: async (item, helpers) => {
        await gate.promise;
        sawAbort = Boolean(helpers.signal && helpers.signal.aborted);
        return {};
      },
    });
    queue.add(list(1));
    queue.start();
    queue.cancel();
    gate.resolve();
    await tick(20);
    assert.equal(sawAbort, true, 'the in-flight item was told to stop');
  });

  test('destroy() cancels, clears listeners and makes the queue inert', async () => {
    let events = 0;
    const queue = createJobQueue({
      run: async () => {
        await tick(30);
        return {};
      },
      onEvent: () => {
        events += 1;
      },
    });
    queue.add(list(2));
    queue.start();
    await tick(5);
    queue.destroy();
    const afterDestroy = events;
    await tick(60);
    assert.equal(events, afterDestroy, 'no events are emitted after destroy');
    assert.deepEqual(queue.start(), { started: false, reason: 'destroyed' });
    assert.equal(queue.add(list(1)).added, 0);
    assert.equal(queue.retryFailed(), 0);
    assert.deepEqual(queue.items(), []);
  });
});

describe('queue — events and snapshots', () => {
  test('the event stream describes the run in order', async () => {
    const types = [];
    const queue = createJobQueue({
      concurrency: 1,
      onEvent: (event) => types.push(event.type),
      run: async () => ({}),
    });
    queue.add(list(2));
    queue.start();
    await tick(20);
    assert.deepEqual(types, ['added', 'started', 'item-start', 'item-end', 'item-start', 'item-end', 'finished']);
    for (const event of ['added', 'started', 'finished']) {
      assert.ok(types.includes(event), `${event} was emitted`);
    }
  });

  test('every event carries the job label and live stats, so a progress bar needs no polling', async () => {
    const events = [];
    const queue = createJobQueue({
      label: 'Batch conversion',
      concurrency: 1,
      onEvent: (event) => events.push(event),
      run: async () => ({ bytes: 4 }),
    });
    queue.add(list(2));
    queue.start();
    await tick(20);
    const end = events.filter((event) => event.type === 'item-end');
    assert.equal(end.length, 2);
    assert.equal(end[0].jobLabel, 'Batch conversion');
    assert.equal(end[0].stats.done, 1, 'stats are attached to the event');
    assert.equal(end[1].stats.bytes, 8);
    assert.equal(end[1].item.state, ITEM_STATES.DONE);
    assert.equal(end[1].item.label, 'image 1');
  });

  test('a listener that throws cannot break the run', async () => {
    const queue = createJobQueue({
      concurrency: 1,
      onEvent: () => {
        throw new Error('broken listener');
      },
      run: async () => ({ bytes: 1 }),
    });
    queue.add(list(2));
    queue.start();
    await tick(20);
    assert.equal(queue.stats().done, 2, 'the run finished anyway');
  });

  test('subscribe() adds a listener and returns a working unsubscribe', async () => {
    const seen = [];
    const queue = createJobQueue({ concurrency: 1, run: async () => ({}) });
    const off = queue.subscribe((event) => seen.push(event.type));
    queue.add(list(1));
    off();
    queue.start();
    await tick(20);
    assert.deepEqual(seen, ['added'], 'events after unsubscribing are not delivered');
    assert.equal(queue.stats().done, 1);
  });

  test('item snapshots expose state but no payload, so progress data cannot leak page objects', async () => {
    const element = { tagName: 'IMG', src: 'https://page.example/secret.jpg' };
    const queue = createJobQueue({
      concurrency: 1,
      run: async (item) => {
        assert.equal(item.payload.element, element, 'the runner still gets the payload');
        return { bytes: 1 };
      },
    });
    queue.add([{ id: 'x', label: 'x', payload: { element } }]);
    queue.start();
    await tick(20);
    const snapshot = queue.item('x');
    assert.deepEqual(
      Object.keys(snapshot).sort(),
      ['attempts', 'autoRetries', 'durationMs', 'error', 'errorCode', 'id', 'label', 'result', 'retryable', 'skipReason', 'state', 'uncertain'].sort(),
      'the snapshot shape is fixed',
    );
    assert.equal('payload' in snapshot, false, 'no payload in the snapshot');
    assert.equal(JSON.stringify(queue.items()).includes('secret.jpg'), false, 'no page data in the progress list');
    assert.equal(queue.item('missing'), null);
  });

  test('an injected clock makes durations deterministic', async () => {
    let now = 1000;
    const queue = createJobQueue({
      concurrency: 1,
      now: () => now,
      run: async () => {
        now += 250;
        return {};
      },
    });
    queue.add(list(2));
    queue.start();
    await tick(20);
    const stats = queue.stats();
    assert.equal(stats.durationMs, 500, 'the job duration comes from the injected clock');
    assert.equal(queue.item('item-0').durationMs, 250);
    assert.equal(stats.startedAt, 1000);
    assert.equal(stats.endedAt, 1500);
  });
});
