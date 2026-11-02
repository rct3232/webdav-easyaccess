'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const {
  normalizeDay,
  normalizeSnapshot,
  mapSnapshotRow,
} = require('../storageUsageSnapshotsShared');

/**
 * postgres implementation of StorageUsageSnapshotsRepository (`$n`
 * placeholders). `day` is the caller's UTC `YYYY-MM-DD` text; a same-day
 * upsert overwrites `bytes` without touching `created_at`.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresStorageUsageSnapshotsRepository(executor) {
  return {
    dialect: 'postgres',

    async upsertSnapshot(snapshot) {
      const row = normalizeSnapshot(snapshot);
      try {
        const result = await executor.run(
          `INSERT INTO storage_usage_snapshots (user_id, day, bytes, created_at)
           VALUES ($1, $2, $3, NOW())
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
      const conditions = ['user_id = $1'];
      if (range.fromDay !== undefined && range.fromDay !== null) {
        params.push(normalizeDay(range.fromDay, 'fromDay'));
        conditions.push(`day >= $${params.length}`);
      }
      if (range.toDay !== undefined && range.toDay !== null) {
        params.push(normalizeDay(range.toDay, 'toDay'));
        conditions.push(`day <= $${params.length}`);
      }
      try {
        const { rows } = await executor.query(
          `SELECT * FROM storage_usage_snapshots WHERE ${conditions.join(' AND ')} ORDER BY day ASC`,
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
        const result = await executor.run('DELETE FROM storage_usage_snapshots WHERE day < $1', [
          cutoff,
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
