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
 * @property {string} kind one of `AI_JOB_KIND.ALL` (`shared/constants.js`);
 *   the `ai_jobs.kind` DDL CHECK is the persistence source of truth
 * @property {number} generation
 * @property {'pending'|'running'|'done'|'failed'|'skipped'|'cancelled'} status
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
 *   INSERT ON CONFLICT (node,kind,generation); a fresh row is `pending`. On
 *   conflict, a DIFFERENT non-null content hash resets the SAME row to a fresh
 *   attempt (`pending`, attempt 0, retry/start/finish/last_error cleared);
 *   an identical or absent hash performs no update and returns `null` (the
 *   dedupe-skip contract).
 * @property {(items: Array<{nodeId, kind, generation, contentHash?}>) => Promise<{enqueued: number, ids: number[]}>} enqueueMany
 *   One TX, per-item ON CONFLICT DO NOTHING — admin re-embed seeding (no
 *   content-change reset: driver keys are opaque, not file hashes). `ids`
 *   lists the newly inserted rows in insertion order.
 * @property {(tx, items: Array<{nodeId, kind, generation, contentHash?}>) => Promise<{enqueued: number, ids: number[]}>} enqueueManyTx
 *   Caller-owned-TX variant (the launcher writes generation bump + seed +
 *   journal row atomically).
 * @property {(opts: { jobIds: number[] }) => Promise<{cancelledIds: number[], skippedIds: number[]}>} cancelPending
 *   ONE TX: only `pending` rows → terminal `cancelled` (finished_at=now).
 *   Running jobs finish; done/failed/skipped/cancelled ids are skipped.
 * @property {(tx, opts: { jobIds: number[] }) => Promise<{cancelledIds: number[], skippedIds: number[]}>} cancelPendingTx
 *   Caller-owned-TX variant used by the settings-journal inverse.
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
 *   next_retry_at = now + backoff(attempt) (§2.5), finished_at=now
 *   (the admin 24h failure-rate window); guarded on 'running'.
 * @property {(jobId, reason?) => Promise<{changes: number}>} markSkipped
 *   `running → skipped`, finished_at=now, last_error=reason (note channel);
 *   guarded on 'running'.
 * @property {(staleMs) => Promise<{changes: number}>} recoverStaleRunning
 *   Startup/periodic reap: `running` rows with started_at older than the
 *   cutoff → `failed`, attempt+1, next_retry_at=now (re-claimable at once).
 * @property {(jobId) => Promise<AiJob|null>} getById
 * @property {(nodeId, opts?: {generation?: number}) => Promise<AiJob[]>} listByNode
 *   Per-file job history, id ASC; optional generation filter.
 * @property {() => Promise<{pending: number, running: number, done: number, failed: number, skipped: number, cancelled: number}>} countByStatus
 * @property {(opts?: {limit?: number}) => Promise<AiJob[]>} listFailed
 *   Recent `failed` rows, newest first (default limit 50).
 * @property {(sinceIso: string) => Promise<number>} countFailedSince
 *   Failed rows with finished_at >= sinceIso (admin 24h count).
 * @property {(sinceIso: string) => Promise<number>} countFinishedSince
 *   Rows with finished_at >= sinceIso (failure-rate denominator).
 * @property {(jobIds: number[]) => Promise<number>} countActiveByIds
 *   pending|running rows among the ids (launcher single-active guard).
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
