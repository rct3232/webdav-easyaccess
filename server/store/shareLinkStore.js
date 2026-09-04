'use strict';

/**
 * shareLinkStore facade — delegates to ShareLinkRepository (the backend-neutral
 * repository pattern, docs/spec/server/store/repository-contract.md). The
 * exported function surface is unchanged (including the pure `isLinkExpired`
 * helper re-export).
 */
const storage = require('./storage');
const createShareLinkRepository = require('./repositories/ShareLinkRepository');
const { isLinkExpired } = require('./isLinkExpired');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createShareLinkRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function createShareLink(linkData) {
  return getRepository().createShareLink(linkData);
}

async function getShareLink(token) {
  return getRepository().getShareLink(token);
}

async function getUserShareLinks(userId) {
  return getRepository().getUserShareLinks(userId);
}

async function updateShareLink(token, updates) {
  return getRepository().updateShareLink(token, updates);
}

async function deleteShareLink(token) {
  return getRepository().deleteShareLink(token);
}

async function incrementDownloadCount(token) {
  return getRepository().incrementDownloadCount(token);
}

module.exports = {
  createShareLink,
  getShareLink,
  getUserShareLinks,
  updateShareLink,
  deleteShareLink,
  incrementDownloadCount,
  isLinkExpired,
};
