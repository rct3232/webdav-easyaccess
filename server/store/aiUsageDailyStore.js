'use strict';

/**
 * aiUsageDailyStore facade — provider-traffic counter ledger
 * (docs/spec/server/store/aiUsageDailyStore.md). Thin dialect dispatch over
 * AiUsageDailyRepository (no SQL here, PLAN §6). History is DB truth: a day
 * rollover is a new PK row and no store code path resets it (llmAdapter
 * §2.9 — reconfig resets breakers, not history).
 */
const storage = require('./storage');
const createAiUsageDailyRepository = require('./repositories/AiUsageDailyRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createAiUsageDailyRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function recordUsage(event) {
  return getRepository().recordUsage(event);
}

async function getByDay(day) {
  return getRepository().getByDay(day);
}

async function summarizeRange(opts) {
  return getRepository().summarizeRange(opts);
}

module.exports = {
  recordUsage,
  getByDay,
  summarizeRange,
};
