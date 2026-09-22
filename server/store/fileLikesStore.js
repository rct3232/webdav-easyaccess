'use strict';

/**
 * fileLikesStore facade — per-user likes on files (docs/spec/server/store/
 * fileLikesStore.md). Direct twin of recentFilesStore: thin dialect dispatch
 * over FileLikesRepository (no SQL here). NO journal involvement — a like is
 * self-reversing trivial state (§4.11).
 */
const storage = require('./storage');
const createFileLikesRepository = require('./repositories/FileLikesRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createFileLikesRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function isLiked(userId, nodeId) {
  return getRepository().isLiked(userId, nodeId);
}

async function listLikedNodeIds(userId) {
  return getRepository().listLikedNodeIds(userId);
}

async function filterLiked(userId, nodeIds) {
  return getRepository().filterLiked(userId, nodeIds);
}

async function addLike(userId, nodeId) {
  return getRepository().addLike(userId, nodeId);
}

async function removeLike(userId, nodeId) {
  return getRepository().removeLike(userId, nodeId);
}

async function setLiked(userId, nodeId, liked) {
  return liked ? addLike(userId, nodeId) : removeLike(userId, nodeId);
}

module.exports = {
  isLiked,
  listLikedNodeIds,
  filterLiked,
  addLike,
  removeLike,
  setLiked,
};
