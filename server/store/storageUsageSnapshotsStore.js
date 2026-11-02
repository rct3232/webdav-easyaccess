'use strict';

/**
 * storageUsageSnapshotsStore facade — per-user daily logical-storage series
 * (docs/spec/server/store/storageUsageSnapshotsStore.md). Thin dialect
 * dispatch on `storage.getExecutor()` — no SQL here. The daily scheduler
 * upserts/prunes; the Storage-dashboard read lists the retained rows.
 */
const storage = require('./storage');
const createStorageUsageSnapshotsRepository = require('./repositories/StorageUsageSnapshotsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createStorageUsageSnapshotsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function upsertSnapshot(snapshot) {
  return getRepository().upsertSnapshot(snapshot);
}

async function listForUser(userId, range) {
  return getRepository().listForUser(userId, range);
}

async function deleteOlderThan(cutoffDay) {
  return getRepository().deleteOlderThan(cutoffDay);
}

module.exports = {
  upsertSnapshot,
  listForUser,
  deleteOlderThan,
};
