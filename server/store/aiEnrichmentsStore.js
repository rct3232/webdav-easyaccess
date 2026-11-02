'use strict';

/**
 * aiEnrichmentsStore facade — AI-derived descriptive metadata per node
 * (docs/spec/server/store/aiEnrichmentsStore.md). Thin dialect dispatch over
 * AiEnrichmentsRepository (no SQL here, repository-contract rule 5).
 *
 * Consumers: the `caption`/`asr` producers (their worker write), the media
 * embed fallback corpus read, AI Info display, llmNamer and the merge-arbiter
 * text material. `upsert` is a partial producer-family patch — unspecified
 * columns are untouched (caption-only re-runs never clobber a transcript).
 */
const storage = require('./storage');
const createAiEnrichmentsRepository = require('./repositories/AiEnrichmentsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createAiEnrichmentsRepository(executor);
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

async function listByModel(modelColumn, modelId, opts) {
  return getRepository().listByModel(modelColumn, modelId, opts);
}

async function countByModel(modelColumn, modelId) {
  return getRepository().countByModel(modelColumn, modelId);
}

module.exports = {
  get,
  getByNodeIds,
  upsert,
  delete: deleteNode,
  listByModel,
  countByModel,
};
