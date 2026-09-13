'use strict';

/**
 * RecentFilesRepository — domain interface over the `recent_files` table
 * (docs/spec/server/store/repository-contract.md).
 *
 * Rows are returned domain-shaped: `{ fileNodeId, lastAccessed }` with
 * `lastAccessed` normalised to an ISO string by the shared mapper. The list is
 * capped at MAX_RECENT_FILES (20) on add.
 *
 * @typedef {Object} RecentFilesRepository
 * @property {(userId: number|string) => Promise<Array<{ fileNodeId: number, lastAccessed: string|null }>>} getUserRecentFiles
 *   Newest first.
 * @property {(userId, fileNodeId) => Promise<Array>} addRecentFile
 *   Upsert + trim to MAX_RECENT_FILES; returns the updated list.
 * @property {(userId, fileNodeId) => Promise<Array>} removeRecentFile
 *   Removes one entry; returns the updated list.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {RecentFilesRepository}
 */
const MAX_RECENT_FILES = 20;

function mapRecentFileRow(row) {
  const { toIsoString } = require('../../utils/sharedHelpers');
  return {
    fileNodeId: Number(row.file_node_id),
    lastAccessed: toIsoString(row.last_accessed),
  };
}

module.exports = function createRecentFilesRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createRecentFilesRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/RecentFilesRepository.sqlite')
      : require('./postgres/RecentFilesRepository.postgres');
  return impl(executor, { MAX_RECENT_FILES, mapRecentFileRow });
};

module.exports.MAX_RECENT_FILES = MAX_RECENT_FILES;
