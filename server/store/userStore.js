'use strict';

/**
 * userStore facade — delegates to UserRepository (the backend-neutral
 * repository pattern, docs/spec/server/store/repository-contract.md). The
 * exported getter surface is unchanged for all consumers (models/User, auth,
 * admin, setup, bootstrap, test-utils).
 */
const storage = require('./storage');
const createUserRepository = require('./repositories/UserRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createUserRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

module.exports = {
  get findByUsername() {
    return getRepository().findByUsername;
  },
  get findByEmail() {
    return getRepository().findByEmail;
  },
  get findById() {
    return getRepository().findById;
  },
  get findAll() {
    return getRepository().findAll;
  },
  get findByStatus() {
    return getRepository().findByStatus;
  },
  get createUser() {
    return getRepository().createUser;
  },
  get updateStatus() {
    return getRepository().updateStatus;
  },
  get updateEmail() {
    return getRepository().updateEmail;
  },
  get updatePassword() {
    return getRepository().updatePassword;
  },
  get deleteUser() {
    return getRepository().deleteUser;
  },
};
