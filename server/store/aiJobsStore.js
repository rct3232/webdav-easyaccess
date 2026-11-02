'use strict';

/**
 * aiJobsStore facade — persistent AI enrichment queue
 * (docs/spec/server/store/aiJobsStore.md). Thin dialect dispatch over
 * AiJobsRepository (no SQL here, PLAN §6). Queue truth is `ai_jobs` only:
 * jobs survive restarts, the worker is stateless (no in-memory state).
 */
const storage = require('./storage');
const createAiJobsRepository = require('./repositories/AiJobsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createAiJobsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function enqueue(nodeId, kind, generation, contentHash) {
  return getRepository().enqueue(nodeId, kind, generation, contentHash);
}

async function enqueueMany(items) {
  return getRepository().enqueueMany(items);
}

async function enqueueManyTx(tx, items) {
  return getRepository().enqueueManyTx(tx, items);
}

async function cancelPending(opts) {
  return getRepository().cancelPending(opts);
}

async function cancelPendingTx(tx, opts) {
  return getRepository().cancelPendingTx(tx, opts);
}

async function claimNext(opts) {
  return getRepository().claimNext(opts);
}

async function markDone(jobId) {
  return getRepository().markDone(jobId);
}

async function markFailed(jobId, error) {
  return getRepository().markFailed(jobId, error);
}

async function markSkipped(jobId, reason) {
  return getRepository().markSkipped(jobId, reason);
}

async function recoverStaleRunning(staleMs) {
  return getRepository().recoverStaleRunning(staleMs);
}

async function getById(jobId) {
  return getRepository().getById(jobId);
}

async function listByNode(nodeId, opts) {
  return getRepository().listByNode(nodeId, opts);
}

async function countByStatus() {
  return getRepository().countByStatus();
}

async function listFailed(opts) {
  return getRepository().listFailed(opts);
}

async function countFailedSince(sinceIso) {
  return getRepository().countFailedSince(sinceIso);
}

async function countFinishedSince(sinceIso) {
  return getRepository().countFinishedSince(sinceIso);
}

async function countActiveByIds(jobIds) {
  return getRepository().countActiveByIds(jobIds);
}

module.exports = {
  enqueue,
  enqueueMany,
  enqueueManyTx,
  cancelPending,
  cancelPendingTx,
  claimNext,
  markDone,
  markFailed,
  markSkipped,
  recoverStaleRunning,
  getById,
  listByNode,
  countByStatus,
  listFailed,
  countFailedSince,
  countFinishedSince,
  countActiveByIds,
};
