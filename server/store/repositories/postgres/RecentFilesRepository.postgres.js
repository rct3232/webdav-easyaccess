'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

/**
 * postgres implementation of RecentFilesRepository (`$n` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 * @param {{ MAX_RECENT_FILES: number, mapRecentFileRow: Function }} shared
 */
module.exports = function createPostgresRecentFilesRepository(executor, { MAX_RECENT_FILES, mapRecentFileRow }) {
  return {
    dialect: 'postgres',

    async getUserRecentFiles(userId) {
      try {
        const { rows } = await executor.query(
          `SELECT file_node_id, last_accessed
             FROM recent_files
            WHERE user_id = $1
            ORDER BY last_accessed DESC`,
          [Number(userId)]
        );
        return rows.map(mapRecentFileRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async addRecentFile(userId, fileNodeId) {
      const userIdNum = Number(userId);
      const fileNodeIdNum = Number(fileNodeId);
      try {
        return await executor.transaction(async (tx) => {
          await tx.run(
            `INSERT INTO recent_files (user_id, file_node_id, last_accessed)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, file_node_id)
             DO UPDATE SET last_accessed = NOW()`,
            [userIdNum, fileNodeIdNum]
          );

          await tx.run(
            `DELETE FROM recent_files
              WHERE user_id = $1
                AND file_node_id NOT IN (
                  SELECT file_node_id
                    FROM recent_files
                   WHERE user_id = $1
                   ORDER BY last_accessed DESC
                   LIMIT $2
                )`,
            [userIdNum, MAX_RECENT_FILES]
          );

          const { rows } = await tx.query(
            `SELECT file_node_id, last_accessed
               FROM recent_files
              WHERE user_id = $1
              ORDER BY last_accessed DESC`,
            [userIdNum]
          );
          return rows.map(mapRecentFileRow);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async removeRecentFile(userId, fileNodeId) {
      const userIdNum = Number(userId);
      const fileNodeIdNum = Number(fileNodeId);
      try {
        return await executor.transaction(async (tx) => {
          await tx.run(
            `DELETE FROM recent_files
              WHERE user_id = $1
                AND file_node_id = $2`,
            [userIdNum, fileNodeIdNum]
          );
          const { rows } = await tx.query(
            `SELECT file_node_id, last_accessed
               FROM recent_files
              WHERE user_id = $1
              ORDER BY last_accessed DESC`,
            [userIdNum]
          );
          return rows.map(mapRecentFileRow);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async clearRecentFiles(userId) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM recent_files WHERE user_id = $1', [Number(userId)]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
