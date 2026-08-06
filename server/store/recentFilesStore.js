'use strict';

const storage = require('./storage');
const { mapDatabaseError } = require('../utils/errorHandler');
const { toIsoString } = require('../utils/sharedHelpers');

const MAX_RECENT_FILES = 20;

function isPostgresqlBackend() {
  return storage.getBackend() === 'postgresql';
}

function isSqliteBackend() {
  return storage.getBackend() === 'sqlite';
}

function mapRecentFileRow(row) {
  return {
    fileNodeId: Number(row.file_node_id),
    lastAccessed: toIsoString(row.last_accessed),
  };
}

async function listRecentFilesPg(userId, client = null) {
  const executor = client || storage.getPgPool();
  const res = await executor.query(
    `SELECT file_node_id, last_accessed
       FROM recent_files
      WHERE user_id = $1
      ORDER BY last_accessed DESC`,
    [Number(userId)]
  );
  return res.rows.map(mapRecentFileRow);
}

async function listRecentFilesSqlite(userId, client = null) {
  const query = client ? (sql, params) => client.query(sql, params) : (sql, params) => storage.sqliteQuery(sql, params);
  const res = await query(
    `SELECT file_node_id, last_accessed
       FROM recent_files
      WHERE user_id = ?
      ORDER BY last_accessed DESC`,
    [Number(userId)]
  );
  return res.rows.map(mapRecentFileRow);
}

/**
 * List a user's recent files (newest first).
 * @param {number} userId
 * @returns {Promise<Array<{fileNodeId: number, lastAccessed: string|null}>>}
 */
async function getUserRecentFiles(userId) {
  if (isPostgresqlBackend()) {
    try {
      return await listRecentFilesPg(userId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await listRecentFilesSqlite(userId);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * Add or refresh a recent-file entry, capping the list at MAX_RECENT_FILES.
 * @param {number} userId
 * @param {number} fileNodeId
 * @returns {Promise<Array>} Updated recent file list
 */
async function addRecentFile(userId, fileNodeId) {
  const userIdNum = Number(userId);
  const fileNodeIdNum = Number(fileNodeId);

  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO recent_files (user_id, file_node_id, last_accessed)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, file_node_id)
           DO UPDATE SET last_accessed = NOW()`,
          [userIdNum, fileNodeIdNum]
        );

        await client.query(
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

        return await listRecentFilesPg(userIdNum, client);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await storage.withSqliteTransaction(async (client) => {
        await client.query(
          `INSERT INTO recent_files (user_id, file_node_id, last_accessed)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, file_node_id)
           DO UPDATE SET last_accessed = CURRENT_TIMESTAMP`,
          [userIdNum, fileNodeIdNum]
        );

        await client.query(
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

        return await listRecentFilesSqlite(userIdNum, client);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * Remove one recent-file entry by file node id.
 * @param {number} userId
 * @param {number} fileNodeId
 * @returns {Promise<Array>} Updated recent file list
 */
async function removeRecentFile(userId, fileNodeId) {
  const userIdNum = Number(userId);
  const fileNodeIdNum = Number(fileNodeId);

  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        await client.query(
          `DELETE FROM recent_files
            WHERE user_id = $1
              AND file_node_id = $2`,
          [userIdNum, fileNodeIdNum]
        );
        return await listRecentFilesPg(userIdNum, client);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await storage.withSqliteTransaction(async (client) => {
        await client.query(
          `DELETE FROM recent_files
           WHERE user_id = ?
             AND file_node_id = ?`,
          [userIdNum, fileNodeIdNum]
        );
        return await listRecentFilesSqlite(userIdNum, client);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * Clear all recent-file entries for a user.
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function clearRecentFiles(userId) {
  if (isPostgresqlBackend()) {
    try {
      await storage.withTransaction(async (client) => {
        await client.query(`DELETE FROM recent_files WHERE user_id = $1`, [Number(userId)]);
      });
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await storage.withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM recent_files WHERE user_id = ?`, [Number(userId)]);
      });
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

module.exports = {
  getUserRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
};
