'use strict';

/**
 * aiTagStore facade — the `ai_tag_raw` store
 * (docs/spec/server/store/aiTagStore.md). Thin dialect dispatch over
 * AiTagRepository (no SQL here, PLAN §6). The raw writer runs in ONE TX
 * (§2.4); reads dispatch directly. The store applies NO normalization —
 * callers pass orthographically folded tags (§4.18,
 * domains/ai/tagVocabulary.foldTag).
 */
const storage = require('./storage');
const createAiTagRepository = require('./repositories/AiTagRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createAiTagRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

// --- ai_tag_raw (§2.3) ------------------------------------------------------

async function listRawTags(nodeId) {
  return getRepository().listRawTags(nodeId);
}

async function listNodeIdsByRawTag(tag) {
  return getRepository().listNodeIdsByRawTag(tag);
}

async function replaceRawTags(nodeId, tags) {
  const repo = getRepository();
  return storage.getExecutor().transaction((tx) => repo.replaceRawTags(tx, nodeId, tags));
}

module.exports = { listRawTags, listNodeIdsByRawTag, replaceRawTags };
