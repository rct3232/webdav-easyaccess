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

async function claimNext() {
  return getRepository().claimNext();
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

module.exports = {
  enqueue,
  enqueueMany,
  claimNext,
  markDone,
  markFailed,
  markSkipped,
  recoverStaleRunning,
  getById,
  listByNode,
  countByStatus,
  listFailed,
};
