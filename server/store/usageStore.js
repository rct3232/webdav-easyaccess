'use strict';

/**
 * usageStore facade — usage signals + per-(user,node) activity accumulator
 * (docs/spec/server/store/usageStore.md). Direct twin of fileLikesStore: thin
 * dialect dispatch over UsageRepository (no SQL here). NO journal involvement
 * — usage signals are telemetry, not undoable user actions (§4.11). The rollup
 * orchestration (§3.4 accumulator math, config resolution) lives in
 * server/infrastructure/usageService.js; this facade owns the store surface
 * (writes + the per-node accumulator read).
 */
const storage = require('./storage');
const createUsageRepository = require('./repositories/UsageRepository');

/**
 * Bound on ids per `listNodeActivity` bind-parameter list (sqlite builds ship
 * varying SQLITE_MAX_VARIABLE_NUMBER; 400 keeps the statement portable).
 */
const ACTIVITY_ID_BATCH = 400;

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

/**
 * Per-node accumulator read for one user. Chunked so an id list is never an
 * unbounded bind parameter list (a collection's materialized set is capped by
 * the create size caps); rows come back ascending by node id.
 *
 * @param {number} userId
 * @param {number[]} nodeIds
 * @returns {Promise<Array<{userId, nodeId, counts, lastSeenAtMs, score, updatedAtMs}>>}
 */
async function listNodeActivity(userId, nodeIds) {
  const ids = [...new Set((Array.isArray(nodeIds) ? nodeIds : []).map(Number))].filter((id) =>
    Number.isInteger(id)
  );
  if (ids.length === 0) return [];
  const rows = [];
  for (let i = 0; i < ids.length; i += ACTIVITY_ID_BATCH) {
    const batch = await getRepository().listNodeActivity(
      userId,
      ids.slice(i, i + ACTIVITY_ID_BATCH)
    );
    rows.push(...batch);
  }
  return rows.sort((a, b) => a.nodeId - b.nodeId);
}

async function deleteUsageEventsOlderThan(cutoffMs) {
  return getRepository().deleteUsageEventsOlderThan(cutoffMs);
}

module.exports = {
  insertUsageEvent,
  readRollupGroups,
  upsertNodeActivity,
  listNodeActivity,
  deleteUsageEventsOlderThan,
};
