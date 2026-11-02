'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

/**
 * sqlite implementation of FileLikesRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteFileLikesRepository(executor) {
  return {
    dialect: 'sqlite',

    async isLiked(userId, nodeId) {
      try {
        const { rows } = await executor.query(
          'SELECT 1 AS liked FROM file_likes WHERE user_id = ? AND node_id = ? LIMIT 1',
          [Number(userId), Number(nodeId)]
        );
        return rows.length > 0;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listLikedNodeIds(userId) {
      try {
        const { rows } = await executor.query(
          'SELECT node_id FROM file_likes WHERE user_id = ? ORDER BY node_id',
          [Number(userId)]
        );
        return rows.map((row) => Number(row.node_id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async filterLiked(userId, nodeIds) {
      if (!nodeIds || nodeIds.length === 0) return [];
      try {
        const placeholders = nodeIds.map(() => '?').join(', ');
        const { rows } = await executor.query(
          `SELECT node_id FROM file_likes
            WHERE user_id = ? AND node_id IN (${placeholders})`,
          [Number(userId), ...nodeIds.map(Number)]
        );
        const liked = new Set(rows.map((row) => Number(row.node_id)));
        return nodeIds.map(Number).filter((nodeId) => liked.has(nodeId));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async addLike(userId, nodeId) {
      try {
        const result = await executor.run(
          `INSERT INTO file_likes (user_id, node_id, created_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, node_id) DO NOTHING`,
          [Number(userId), Number(nodeId)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async removeLike(userId, nodeId) {
      try {
        const result = await executor.run(
          'DELETE FROM file_likes WHERE user_id = ? AND node_id = ?',
          [Number(userId), Number(nodeId)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
