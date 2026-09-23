'use strict';

/**
 * aiTagStore facade — tag vocabulary substrate
 * (docs/spec/server/store/aiTagStore.md). Thin dialect dispatch over
 * AiTagRepository (no SQL here, PLAN §6). Batch/raw writers run in ONE TX
 * (§2.5); reads and single-statement writes dispatch directly. The store
 * applies NO normalization — callers pass orthographically folded tags
 * (§4.18, domains/ai/tagVocabulary.foldTag).
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

// --- tag_embeddings (§2.3) --------------------------------------------------

async function getTagVector(tag, modelId) {
  return getRepository().getTagVector(tag, modelId);
}

async function getTagVectors(tags, modelId) {
  return getRepository().getTagVectors(tags, modelId);
}

async function findTagsWithoutEmbedding(tags, modelId) {
  return getRepository().findTagsWithoutEmbedding(tags, modelId);
}

async function upsertTagVector(tag, modelId, vector) {
  return getRepository().upsertTagVector(tag, modelId, vector);
}

async function upsertTagVectors(items, modelId) {
  const repo = getRepository();
  return storage.getExecutor().transaction((tx) => repo.upsertTagVectors(tx, items, modelId));
}

async function deleteByModel(modelId) {
  return getRepository().deleteByModel(modelId);
}

// --- tag_parents (§2.4) -----------------------------------------------------

async function getParent(child) {
  return getRepository().getParent(child);
}

async function listParentHints() {
  return getRepository().listParentHints();
}

async function upsertAutoParent(child, parent) {
  return getRepository().upsertAutoParent(child, parent);
}

async function setAdminParent(child, parent) {
  return getRepository().setAdminParent(child, parent);
}

async function deleteParent(child) {
  return getRepository().deleteParent(child);
}

// --- ai_tag_raw (§2.4.5) ----------------------------------------------------

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

module.exports = {
  getTagVector,
  getTagVectors,
  findTagsWithoutEmbedding,
  upsertTagVector,
  upsertTagVectors,
  deleteByModel,
  getParent,
  listParentHints,
  upsertAutoParent,
  setAdminParent,
  deleteParent,
  listRawTags,
  listNodeIdsByRawTag,
  replaceRawTags,
};
