'use strict';

/**
 * llmModelsStore facade — persistent model registry
 * (docs/spec/server/store/llmModelsStore.md). Thin dialect dispatch over
 * LlmModelsRepository (no SQL here, PLAN §6). The registry is llmAdapter's
 * persisted view; the model-version key (llm_models.id) is stable across
 * restarts — upsert is idempotent per identity.
 */
const storage = require('./storage');
const createLlmModelsRepository = require('./repositories/LlmModelsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createLlmModelsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function upsertModel(spec) {
  return getRepository().upsertModel(spec);
}

async function getModel(id) {
  return getRepository().getModel(id);
}

async function activateModel(role, id) {
  return getRepository().activateModel(role, id);
}

async function disableRole(role) {
  return getRepository().disableRole(role);
}

async function getActiveByRole(role) {
  return getRepository().getActiveByRole(role);
}

async function listByRole(role) {
  return getRepository().listByRole(role);
}

async function setReasoning(id, reasoning) {
  return getRepository().setReasoning(id, reasoning);
}

module.exports = {
  upsertModel,
  activateModel,
  disableRole,
  getModel,
  getActiveByRole,
  listByRole,
  setReasoning,
};
