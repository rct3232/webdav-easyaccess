'use strict';

/**
 * settingsStore facade — delegates to SettingsRepository (the backend-neutral
 * repository pattern, docs/spec/server/store/repository-contract.md). The
 * public function surface is unchanged for all consumers (configResolver,
 * admin config, configSync, setup, models/Settings).
 */
const storage = require('./storage');
const createSettingsRepository = require('./repositories/SettingsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override), so suites never touch WEA_DB_*.
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createSettingsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function get(key) {
  return getRepository().get(key);
}

async function set(key, value) {
  return getRepository().set(key, value);
}

async function getTx(tx, key) {
  return getRepository().getTx(tx, key);
}

async function setTx(tx, key, value) {
  return getRepository().setTx(tx, key, value);
}

async function deleteTx(tx, key) {
  return getRepository().deleteTx(tx, key);
}

async function getAll() {
  return getRepository().getAll();
}

async function listRows() {
  return getRepository().listRows();
}

async function isRegistrationEnabled() {
  const v = await get('registration_enabled');
  return v === 'true';
}

module.exports = {
  get,
  set,
  getTx,
  setTx,
  deleteTx,
  getAll,
  listRows,
  isRegistrationEnabled,
};
