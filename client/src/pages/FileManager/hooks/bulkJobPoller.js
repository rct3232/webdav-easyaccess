/**
 * Framework-free poller for job-backed bulk operations
 * (docs/spec/client/hooks/useBulkOperations.md §2.6.1).
 *
 * Contract:
 * - first read immediately, then a self-scheduling `setTimeout` chain at
 *   `intervalMs` (no `setInterval`, at most one request in flight);
 * - a read that rejects is a failure: 5 consecutive failures end the poll with
 *   `{ reason: 'failures' }`; backoff after failures 1..4 is
 *   `backoffMs[0..3]`; a success resets the counter;
 * - `404` is terminal-unknown (`{ reason: 'expired' }`) with no retry — the
 *   in-memory job store can never bring the record back;
 * - terminal and stalled callbacks each fire exactly once, and never after
 *   `dispose()`;
 * - `dispose()` clears the timer and aborts the in-flight request.
 *
 * The hook owns all UI state; this module owns scheduling only. Snapshot /
 * terminal / stalled callbacks are host code — an exception inside them is
 * reported but never mistaken for a transport failure.
 */
export const BULK_POLL_INTERVAL_MS = 400;
export const BULK_POLL_BACKOFF_MS = [400, 800, 1600, 3200, 5000];
export const BULK_POLL_MAX_FAILURES = 5;
export const BULK_POLL_STATUS_TIMEOUT_MS = 10_000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const defaultIsTerminal = (job) => TERMINAL_STATUSES.has(job?.status);
const defaultIsExpired = (error) => error?.response?.status === 404;

function reportCallbackError(label, error) {
  // eslint-disable-next-line no-console
  console.error(`[bulkJobPoller] ${label} callback failed:`, error);
}

export function createBulkJobPoller({
  jobId,
  fetchStatus,
  onSnapshot,
  onTerminal,
  onStalled,
  isTerminal = defaultIsTerminal,
  isExpired = defaultIsExpired,
  intervalMs = BULK_POLL_INTERVAL_MS,
  backoffMs = BULK_POLL_BACKOFF_MS,
  maxFailures = BULK_POLL_MAX_FAILURES,
  statusTimeoutMs = BULK_POLL_STATUS_TIMEOUT_MS,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (id) => clearTimeout(id),
} = {}) {
  let disposed = false;
  let finished = false;
  let started = false;
  let timerId = null;
  let inFlight = false;
  let failures = 0;
  let controller = null;

  function clearTimer() {
    if (timerId != null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  function abortInFlight() {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  function finish(kind, payload) {
    if (finished || disposed) return;
    finished = true;
    clearTimer();
    abortInFlight();
    try {
      if (kind === 'terminal') onTerminal?.(payload);
      else onStalled?.(payload);
    } catch (error) {
      reportCallbackError(kind, error);
    }
  }

  function schedule(delayMs) {
    if (disposed || finished) return;
    clearTimer();
    timerId = setTimeoutFn(() => {
      timerId = null;
      void poll();
    }, delayMs);
  }

  function backoffFor(failureCount) {
    const index = Math.min(Math.max(failureCount - 1, 0), backoffMs.length - 1);
    return backoffMs[index];
  }

  async function readStatus() {
    controller = new AbortController();
    try {
      return await fetchStatus(jobId, {
        signal: controller.signal,
        timeout: statusTimeoutMs,
      });
    } finally {
      controller = null;
    }
  }

  async function poll() {
    if (disposed || finished || inFlight) return;
    inFlight = true;

    let nextDelay = null;
    let outcome = null;

    try {
      const job = await readStatus();
      if (disposed || finished) return;

      failures = 0;
      if (typeof onSnapshot === 'function') {
        try {
          onSnapshot(job);
        } catch (error) {
          reportCallbackError('snapshot', error);
        }
      }
      outcome = isTerminal(job) ? { kind: 'terminal', job } : null;
    } catch (error) {
      if (disposed || finished) return;

      if (isExpired(error)) {
        outcome = { kind: 'stalled', reason: 'expired', error };
      } else {
        failures += 1;
        if (failures >= maxFailures) {
          outcome = { kind: 'stalled', reason: 'failures', error, failureCount: failures };
        } else {
          nextDelay = backoffFor(failures);
        }
      }
    } finally {
      inFlight = false;
    }

    if (disposed || finished) return;
    if (outcome?.kind === 'terminal') {
      finish('terminal', outcome.job);
      return;
    }
    if (outcome?.kind === 'stalled') {
      finish('stalled', outcome);
      return;
    }
    schedule(nextDelay ?? intervalMs);
  }

  return {
    /** Starts the chain (idempotent). The first read runs on the next timer tick. */
    start() {
      if (disposed || finished || started) return;
      started = true;
      schedule(0);
    },
    /**
     * Forces one immediate read (cancel path). `failFast` makes a single failed
     * read count as the whole budget so the caller can surface the stalled state
     * right after an explicit user action.
     */
    async checkNow({ failFast = false } = {}) {
      if (disposed || finished) return;
      if (failFast) failures = maxFailures;
      clearTimer();
      await poll();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      abortInFlight();
    },
    isFinished() {
      return finished || disposed;
    },
  };
}

export default createBulkJobPoller;
