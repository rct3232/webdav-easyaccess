'use strict';

/**
 * embeddingsChunkStore facade — chunked (segment-level) embedding rows per
 * node (docs/spec/server/store/embeddingsChunkStore.md). Thin dialect
 * dispatch over EmbeddingsChunkRepository (no SQL here, repository-contract
 * rule 5). Chunk rows are derived-cache data: `replaceChunks` is the only
 * write — wholesale DELETE of the node's incoming-model-space set + INSERT,
 * one TX.
 */
const storage = require('./storage');
const createEmbeddingsChunkRepository = require('./repositories/EmbeddingsChunkRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createEmbeddingsChunkRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function listByNode(nodeId, opts) {
  return getRepository().listByNode(nodeId, opts);
}

async function get(nodeId, chunkIdx) {
  return getRepository().get(nodeId, chunkIdx);
}

async function replaceChunks(nodeId, modelId, chunks) {
  return getRepository().replaceChunks(nodeId, modelId, chunks);
}

async function deleteByNode(nodeId) {
  return getRepository().deleteByNode(nodeId);
}

async function deleteSpace(modelId) {
  return getRepository().deleteSpace(modelId);
}

async function countByNode(nodeId, opts) {
  return getRepository().countByNode(nodeId, opts);
}

async function listAllByModel(modelId, opts) {
  return getRepository().listAllByModel(modelId, opts);
}

module.exports = {
  listByNode,
  get,
  replaceChunks,
  deleteByNode,
  deleteSpace,
  countByNode,
  listAllByModel,
};
