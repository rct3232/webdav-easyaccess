'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

/**
 * postgres implementation of FileLikesRepository (`$n` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresFileLikesRepository(executor) {
  return {
    dialect: 'postgres',

    async isLiked(userId, nodeId) {
      try {
        const { rows } = await executor.query(
          'SELECT 1 AS liked FROM file_likes WHERE user_id = $1 AND node_id = $2 LIMIT 1',
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
          'SELECT node_id FROM file_likes WHERE user_id = $1 ORDER BY node_id',
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
        const params = [Number(userId)];
        const placeholders = nodeIds
          .map(Number)
          .map((nodeId) => `$${params.push(nodeId)}`)
          .join(', ');
        const { rows } = await executor.query(
          `SELECT node_id FROM file_likes
            WHERE user_id = $1 AND node_id IN (${placeholders})`,
          params
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
           VALUES ($1, $2, NOW())
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
          'DELETE FROM file_likes WHERE user_id = $1 AND node_id = $2',
          [Number(userId), Number(nodeId)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
