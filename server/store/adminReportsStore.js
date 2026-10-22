'use strict';

/**
 * adminReportsStore facade — delegates to AdminReportsRepository (the
 * backend-neutral repository pattern, docs/spec/server/store/
 * repository-contract.md).
 *
 * Consumed by the shared admin-reports writer (T0.7b seam, wired T0.8), the
 * reports routes (list/read/repair) and the T0.1 boot completeness probe.
 */
const storage = require('./storage');
const createAdminReportsRepository = require('./repositories/AdminReportsRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createAdminReportsRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function insertReport(row) {
  return getRepository().insertReport(row);
}

async function listReports() {
  return getRepository().listReports();
}

async function getReport(id) {
  return getRepository().getReport(id);
}

async function updateReport(id, patch) {
  return getRepository().updateReport(id, patch);
}

async function deleteReportsOlderThan(cutoffMs, opts) {
  return getRepository().deleteReportsOlderThan(cutoffMs, opts);
}

module.exports = {
  insertReport,
  listReports,
  getReport,
  updateReport,
  deleteReportsOlderThan,
};
