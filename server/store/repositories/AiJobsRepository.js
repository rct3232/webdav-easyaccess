'use strict';

/**
 * AiJobsRepository — domain interface over the persistent AI job queue table
 * `ai_jobs` (docs/spec/server/store/aiJobsStore.md). DB-backed only: jobs
 * survive restarts, the worker is stateless — restart survival is the
 * `recoverStaleRunning` reap + the idempotent per-generation enqueue dedupe
 * (§2.9). NO journal writes: jobs are internal mechanics, not user-undoable
 * acts (§2.6). The dialect split of `claimNext` atomicity is sealed inside
 * the twins (§2.4) — callers see one zero-arg method.
 *
 * @typedef {Object} AiJob
 * @property {number} id
 * @property {number} nodeId
 * @property {'embed'|'features'|'caption'|'asr'|'backfill'} kind
 * @property {number} generation
 * @property {'pending'|'running'|'done'|'failed'|'skipped'} status
 * @property {number} attempt
 * @property {string|null} nextRetryAt
 * @property {string|null} lastError
 * @property {string|null} contentHash
 * @property {string} createdAt
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 *
 * @typedef {Object} AiJobsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(nodeId, kind, generation, contentHash?) => Promise<{id: number}|null>} enqueue
 *   INSERT ON CONFLICT (node,kind,generation) DO NOTHING; `null` = duplicate
 *   already present (the dedupe-skip contract).
 * @property {(items: Array<{nodeId, kind, generation, contentHash?}>) => Promise<{enqueued: number}>} enqueueMany
 *   One TX, per-item ON CONFLICT DO NOTHING — backfill seeding.
 * @property {(opts?: { excludeKinds?: string[] }) => Promise<AiJob|null>} claimNext
 *   Atomically move the oldest claimable row to `running` (started_at=now);
 *   `null` when nothing is claimable — never throws on "nothing to do".
 *   `opts.excludeKinds` is a predicate-level filter: rows of the listed kinds
 *   stay parked (status and attempt untouched — zero attempt inflation) and
 *   drain in claim order once the filter is removed.
 * @property {(jobId) => Promise<{changes: number}>} markDone
 *   `running → done`, finished_at=now; guarded on status='running'.
 * @property {(jobId, error) => Promise<{changes: number}>} markFailed
 *   `running → failed`, attempt+1, last_error ≤1KB truncated,
 *   next_retry_at = now + backoff(attempt) (§2.5); guarded on 'running'.
 * @property {(jobId, reason?) => Promise<{changes: number}>} markSkipped
 *   `running → skipped`, finished_at=now, last_error=reason (note channel);
 *   guarded on 'running'.
 * @property {(staleMs) => Promise<{changes: number}>} recoverStaleRunning
 *   Startup/periodic reap: `running` rows with started_at older than the
 *   cutoff → `failed`, attempt+1, next_retry_at=now (re-claimable at once).
 * @property {(jobId) => Promise<AiJob|null>} getById
 * @property {(nodeId, opts?: {generation?: number}) => Promise<AiJob[]>} listByNode
 *   Per-file job history, id ASC; optional generation filter.
 * @property {() => Promise<{pending: number, running: number, done: number, failed: number, skipped: number}>} countByStatus
 * @property {(opts?: {limit?: number}) => Promise<AiJob[]>} listFailed
 *   Recent `failed` rows, newest first (default limit 50).
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {AiJobsRepository}
 */
module.exports = function createAiJobsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createAiJobsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/AiJobsRepository.sqlite')
      : require('./postgres/AiJobsRepository.postgres');
  return impl(executor);
};
