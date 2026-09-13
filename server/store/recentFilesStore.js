'use strict';

/**
 * recentFilesStore facade — delegates to RecentFilesRepository (the
 * backend-neutral repository pattern, docs/spec/server/store/
 * repository-contract.md). The exported function surface is unchanged.
 */
const storage = require('./storage');
const createRecentFilesRepository = require('./repositories/RecentFilesRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createRecentFilesRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function getUserRecentFiles(userId) {
  return getRepository().getUserRecentFiles(userId);
}

async function addRecentFile(userId, fileNodeId) {
  return getRepository().addRecentFile(userId, fileNodeId);
}

async function removeRecentFile(userId, fileNodeId) {
  return getRepository().removeRecentFile(userId, fileNodeId);
}

module.exports = {
  getUserRecentFiles,
  addRecentFile,
  removeRecentFile,
};
