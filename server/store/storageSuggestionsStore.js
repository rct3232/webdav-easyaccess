'use strict';

/**
 * storageSuggestionsStore facade — persisted cleanup/duplicate suggestions
 * (docs/spec/server/store/storageSuggestionsStore.md). Thin dialect dispatch on
 * `storage.getExecutor()` — no SQL here (PLAN §6 persistence rule). `*Tx`
 * methods forward a caller-owned queryable (the actionJournalStore
 * commit/undo transaction or the executor itself).
 */
const storage = require('./storage');
const createStorageSuggestionsRepository = require('./repositories/StorageSuggestionsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override) — recentFiles precedent.
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createStorageSuggestionsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function insert(row) {
  return getRepository().insert(row);
}

async function listPending(userId) {
  return getRepository().listPending(userId);
}

async function listKeys(userId) {
  return getRepository().listKeys(userId);
}

async function dismiss(userId, id) {
  return getRepository().dismiss(userId, id);
}

async function updateReason(userId, id, reason) {
  return getRepository().updateReason(userId, id, reason);
}

async function listIdsByNodesTx(tx, userId, nodeIds, state) {
  return getRepository().listIdsByNodesTx(tx, userId, nodeIds, state);
}

async function flipStatesTx(tx, spec) {
  return getRepository().flipStatesTx(tx, spec);
}

async function expireStale({ now, limit } = {}) {
  return getRepository().expireStale({ now, limit });
}

module.exports = {
  insert,
  listPending,
  listKeys,
  dismiss,
  updateReason,
  listIdsByNodesTx,
  flipStatesTx,
  expireStale,
};
