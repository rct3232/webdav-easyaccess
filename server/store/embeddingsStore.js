'use strict';

/**
 * embeddingsStore facade — canonical pooled embedding row per node
 * (docs/spec/server/store/embeddingsStore.md). Thin dialect dispatch over
 * EmbeddingsRepository (no SQL here, repository-contract rule 5). `vector`
 * TEXT is the system of record; reads deserialize to number[] at the
 * repository boundary.
 */
const storage = require('./storage');
const createEmbeddingsRepository = require('./repositories/EmbeddingsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createEmbeddingsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function get(nodeId) {
  return getRepository().get(nodeId);
}

async function getByNodeIds(nodeIds) {
  return getRepository().getByNodeIds(nodeIds);
}

async function upsert(nodeId, patch) {
  return getRepository().upsert(nodeId, patch);
}

async function deleteNode(nodeId) {
  return getRepository().delete(nodeId);
}

async function deleteMany(nodeIds) {
  return getRepository().deleteMany(nodeIds);
}

async function listAll(modelId, opts) {
  return getRepository().listAll(modelId, opts);
}

async function countByModel(modelId) {
  return getRepository().countByModel(modelId);
}

module.exports = {
  get,
  getByNodeIds,
  upsert,
  delete: deleteNode,
  deleteMany,
  listAll,
  countByModel,
};
