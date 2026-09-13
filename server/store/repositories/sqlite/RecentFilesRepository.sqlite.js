'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

/**
 * sqlite implementation of RecentFilesRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 * @param {{ MAX_RECENT_FILES: number, mapRecentFileRow: Function }} shared
 */
module.exports = function createSqliteRecentFilesRepository(
  executor,
  { MAX_RECENT_FILES, mapRecentFileRow }
) {
  return {
    dialect: 'sqlite',

    async getUserRecentFiles(userId) {
      try {
        const { rows } = await executor.query(
          `SELECT file_node_id, last_accessed
             FROM recent_files
            WHERE user_id = ?
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
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, file_node_id)
             DO UPDATE SET last_accessed = CURRENT_TIMESTAMP`,
            [userIdNum, fileNodeIdNum]
          );

          await tx.run(
            `DELETE FROM recent_files
              WHERE user_id = ?
                AND file_node_id NOT IN (
                  SELECT file_node_id
                    FROM recent_files
                   WHERE user_id = ?
                   ORDER BY last_accessed DESC
                   LIMIT ?
                )`,
            [userIdNum, userIdNum, MAX_RECENT_FILES]
          );

          const { rows } = await tx.query(
            `SELECT file_node_id, last_accessed
               FROM recent_files
              WHERE user_id = ?
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
              WHERE user_id = ?
                AND file_node_id = ?`,
            [userIdNum, fileNodeIdNum]
          );
          const { rows } = await tx.query(
            `SELECT file_node_id, last_accessed
               FROM recent_files
              WHERE user_id = ?
              ORDER BY last_accessed DESC`,
            [userIdNum]
          );
          return rows.map(mapRecentFileRow);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
