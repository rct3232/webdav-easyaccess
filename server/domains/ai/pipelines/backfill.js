'use strict';

/**
 * backfill pipeline — the per-job executor of the `backfill` kind
 * (docs/spec/server/services/aiJobService.md §2.4).
 *
 * A claimed backfill row is a DERIVED-INDEX driver: it asks the active
 * vectorStore seam to rebuild the adapter-managed shadow from the canonical
 * `embeddings`/`embeddings_chunk` rows. It performs NO provider calls, writes
 * no canonical row and enqueues nothing — the admin launcher owns generation
 * bumps and seed enqueues (`T4.1`), the embed pipeline owns fresh-space writes.
 *
 * The engine is an injected seam (`vectorStore`), defaulting to the boot
 * singleton. No installed store (no active embed model / pre-boot) means the
 * kind stays parked, exactly like an unconfigured role. Rebuild failures
 * propagate to the shared drain catch (`pipelineRunner.drainKind`), which
 * marks the job failed and arms the store's backoff; a re-run after success
 * finds no claimable row and does no work.
 */

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { drainKind } = require('./pipelineRunner');

/** Every kind except the pipeline's own: predicate-level park (§2.3). */
const NON_BACKFILL_KINDS = AI_JOB_KIND.ALL.filter((kind) => kind !== AI_JOB_KIND.BACKFILL);

function defaultLog() {
  return { warn: console.warn.bind(console) };
}

/**
 * @param {Object} [deps]
 * @param {Object} [deps.aiJobsStore] queue facade (default: server/store/aiJobsStore)
 * @param {Object} [deps.vectorStore] vectorStore seam (default: the boot singleton)
 * @param {Function} [deps.getVectorStore] lazy store seam (default: vectorStoreRuntime)
 * @param {number} [deps.jobTimeoutMs] per-job timeout (0 = no guard)
 * @param {Object} [deps.log] logger seam
 */
function createBackfillPipeline(deps = {}) {
  function jobsStore() {
    return deps.aiJobsStore || require('../../../store/aiJobsStore');
  }

  function vectorStore() {
    if (deps.vectorStore !== undefined) return deps.vectorStore;
    if (typeof deps.getVectorStore === 'function') return deps.getVectorStore();
    return require('../vectorStoreRuntime').getVectorStore();
  }

  function log() {
    return deps.log || defaultLog();
  }

  async function runPendingBackfillJobs(overrides = {}) {
    const merged = { ...deps, ...overrides };
    const jobs = merged.aiJobsStore || jobsStore();
    const store =
      merged.vectorStore !== undefined
        ? merged.vectorStore
        : typeof merged.getVectorStore === 'function'
          ? merged.getVectorStore()
          : vectorStore();

    // Absent store ⇒ park (no claim, zero attempt inflation).
    if (!store || typeof store.rebuildShadow !== 'function') return 0;
    const logger = merged.log || log();

    return drainKind({
      jobs,
      kind: AI_JOB_KIND.BACKFILL,
      excludeKinds: NON_BACKFILL_KINDS,
      jobTimeoutMs: Number(merged.jobTimeoutMs) || 0,
      log: logger,
      execute: async (job) => {
        try {
          await store.rebuildShadow();
        } catch (error) {
          logger.warn(
            `[backfillPipeline] shadow rebuild failed for job ${job.id}: ${error?.message ?? error}`
          );
          throw error;
        }
        await jobs.markDone(job.id);
        return 'done';
      },
    });
  }

  return { runPendingBackfillJobs };
}

const shared = createBackfillPipeline();

module.exports = {
  createBackfillPipeline,
  runPendingBackfillJobs: shared.runPendingBackfillJobs,
  NON_BACKFILL_KINDS,
};
