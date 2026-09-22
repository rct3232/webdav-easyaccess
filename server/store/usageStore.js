'use strict';

/**
 * usageStore facade — usage signals + per-(user,node) activity accumulator
 * (docs/spec/server/store/usageStore.md). Direct twin of fileLikesStore: thin
 * dialect dispatch over UsageRepository (no SQL here). NO journal involvement
 * — usage signals are telemetry, not undoable user actions (§4.11). The rollup
 * orchestration (§3.4 accumulator math, config resolution) lives in
 * server/infrastructure/usageService.js; this facade only persists.
 */
const storage = require('./storage');
const createUsageRepository = require('./repositories/UsageRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createUsageRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function insertUsageEvent(event) {
  return getRepository().insertUsageEvent(event);
}

async function readRollupGroups() {
  return getRepository().readRollupGroups();
}

async function upsertNodeActivity(rows) {
  return getRepository().upsertNodeActivity(rows);
}

async function deleteUsageEventsOlderThan(cutoffMs) {
  return getRepository().deleteUsageEventsOlderThan(cutoffMs);
}

module.exports = {
  insertUsageEvent,
  readRollupGroups,
  upsertNodeActivity,
  deleteUsageEventsOlderThan,
};
