'use strict';

/**
 * Shared per-kind drain mechanics for the AI worker pipelines
 * (docs/spec/server/services/aiJobService.md §2.3 step 5/§2.4).
 *
 * Each pipeline owns ONE job kind and passes its own `excludeKinds` set to
 * `claimNext` (park&drain — every other kind's rows stay untouched with zero
 * attempt inflation, so pipelines sharing a drain pass can never double-claim).
 * The wall-clock guard, the markFailed/backoff handoff and the late-write drop
 * are identical for every kind, so they live here.
 */

const DEFAULT_JOB_TIMEOUT_MS = 120000;

function defaultLog() {
  return { warn: console.warn.bind(console) };
}

/**
 * Race one job execution against AI_JOB_TIMEOUT_MS. On timeout the rejection
 * hits the drain's catch ⇒ markFailed ⇒ backoff; the underlying execution
 * keeps running and its late markDone is a {changes:0} no-op (§2.3 step 6).
 */
async function runWithTimeout(fn, { timeoutMs, label } = {}) {
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
  if (!limit) return fn();
  let timer = null;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${limit}ms`)), limit);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Drain every claimable job of `kind` this pass.
 *
 * @param {Object} opts
 * @param {Object} opts.jobs aiJobsStore facade
 * @param {string} opts.kind the pipeline's own kind
 * @param {string[]} opts.excludeKinds all other kinds (predicate-level park)
 * @param {Function} opts.execute async (job) => 'done'|'skipped'
 * @param {number} [opts.jobTimeoutMs]
 * @param {Object} [opts.log]
 * @returns {Promise<number>} jobs driven to a terminal state
 */
async function drainKind({ jobs, kind, excludeKinds, execute, jobTimeoutMs, log }) {
  const logger = log || defaultLog();
  let terminal = 0;
  for (;;) {
    const job = await jobs.claimNext({ excludeKinds });
    if (!job) break;
    if (job.kind !== kind) continue; // filter-parity guard, never execute
    try {
      const outcome = await runWithTimeout(() => execute(job), {
        timeoutMs: jobTimeoutMs,
        label: `${kind} job ${job.id}`,
      });
      if (outcome !== 'failed') terminal += 1;
    } catch (error) {
      const flipped = await jobs.markFailed(job.id, error?.message ?? String(error));
      if (flipped.changes === 0) {
        logger.warn(
          `[aiWorker] late write on ${kind} job ${job.id} dropped (${error?.message ?? error})`
        );
      }
    }
  }
  return terminal;
}

module.exports = { DEFAULT_JOB_TIMEOUT_MS, runWithTimeout, drainKind };
