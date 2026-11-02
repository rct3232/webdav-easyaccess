'use strict';

/**
 * StorageUsageSnapshotsRepository — domain interface over the
 * `storage_usage_snapshots` table (docs/spec/server/store/
 * storageUsageSnapshotsStore.md). One logical-storage row per user per UTC
 * day; the daily capture upserts the day and the retention pass prunes old
 * rows. `day` is the caller's UTC `YYYY-MM-DD` string, persisted verbatim.
 *
 * Rows are domain-shaped `{ userId, day, bytes, createdAt }` with an ISO
 * timestamp. `createdAt` is stamped on the first insert for the day and is
 * preserved by same-day upserts.
 *
 * @typedef {Object} StorageUsageSnapshot
 * @property {number} userId
 * @property {string} day — UTC `YYYY-MM-DD`
 * @property {number} bytes
 * @property {string} createdAt — ISO-8601 UTC
 *
 * @typedef {Object} StorageUsageSnapshotsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(snapshot: { userId, day, bytes }) => Promise<{changes: number}>} upsertSnapshot
 *   One row per (user_id, day): a same-day replay overwrites `bytes` and
 *   keeps `created_at`.
 * @property {(userId: number, range?: { fromDay?: string, toDay?: string }) => Promise<StorageUsageSnapshot[]>} listForUser
 *   Rows ascending by `day`; the optional day bounds are inclusive.
 * @property {(cutoffDay: string) => Promise<{changes: number}>} deleteOlderThan
 *   Deletes rows whose `day < cutoffDay` (UTC day string comparison).
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {StorageUsageSnapshotsRepository}
 */
module.exports = function createStorageUsageSnapshotsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createStorageUsageSnapshotsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/StorageUsageSnapshotsRepository.sqlite')
      : require('./postgres/StorageUsageSnapshotsRepository.postgres');
  return impl(executor);
};
