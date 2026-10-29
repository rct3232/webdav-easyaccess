'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const {
  normalizeDay,
  normalizeSnapshot,
  mapSnapshotRow,
} = require('../storageUsageSnapshotsShared');

/**
 * sqlite implementation of StorageUsageSnapshotsRepository (`?`
 * placeholders). `day` is the caller's UTC `YYYY-MM-DD` text (lexicographic
 * comparison matches chronological order); a same-day upsert overwrites
 * `bytes` without touching `created_at`.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteStorageUsageSnapshotsRepository(executor) {
  return {
    dialect: 'sqlite',

    async upsertSnapshot(snapshot) {
      const row = normalizeSnapshot(snapshot);
      try {
        const result = await executor.run(
          `INSERT INTO storage_usage_snapshots (user_id, day, bytes, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, day) DO UPDATE SET bytes = excluded.bytes`,
          [row.userId, row.day, row.bytes]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listForUser(userId, range = {}) {
      const params = [Number(userId)];
      let where = 'user_id = ?';
      if (range.fromDay !== undefined && range.fromDay !== null) {
        where += ' AND day >= ?';
        params.push(normalizeDay(range.fromDay, 'fromDay'));
      }
      if (range.toDay !== undefined && range.toDay !== null) {
        where += ' AND day <= ?';
        params.push(normalizeDay(range.toDay, 'toDay'));
      }
      try {
        const { rows } = await executor.query(
          `SELECT * FROM storage_usage_snapshots WHERE ${where} ORDER BY day ASC`,
          params
        );
        return rows.map(mapSnapshotRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteOlderThan(cutoffDay) {
      const cutoff = normalizeDay(cutoffDay, 'cutoffDay');
      try {
        const result = await executor.run('DELETE FROM storage_usage_snapshots WHERE day < ?', [
          cutoff,
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
