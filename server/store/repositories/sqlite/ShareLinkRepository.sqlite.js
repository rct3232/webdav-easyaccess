'use strict';

const { mapDatabaseError, createError } = require('../../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

function throwLinkNotFound() {
  throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
}

/**
 * sqlite implementation of ShareLinkRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 * @param {{ mapShareLinkRow: Function, buildExpiresAt: Function }} shared
 */
module.exports = function createSqliteShareLinkRepository(executor, { mapShareLinkRow, buildExpiresAt }) {
  return {
    dialect: 'sqlite',

    async createShareLink({ token, fileNodeId, createdBy, expiresInDays }) {
      const expiresAt = buildExpiresAt(expiresInDays);
      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query('SELECT * FROM share_links WHERE token = ? LIMIT 1', [
            String(token),
          ]);
          if (existing.rows.length > 0) return mapShareLinkRow(existing.rows[0]);

          await tx.run(
            `INSERT INTO share_links (token, file_node_id, created_by, created_at, expires_at, download_count)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 0)`,
            [String(token), Number(fileNodeId), Number(createdBy), expiresAt]
          );
          const inserted = await tx.query('SELECT * FROM share_links WHERE token = ? LIMIT 1', [
            String(token),
          ]);
          return mapShareLinkRow(inserted.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getShareLink(token) {
      try {
        const { rows } = await executor.query('SELECT * FROM share_links WHERE token = ? LIMIT 1', [
          String(token),
        ]);
        return mapShareLinkRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getUserShareLinks(userId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM share_links WHERE created_by = ? ORDER BY created_at DESC',
          [Number(userId)]
        );
        return rows.map(mapShareLinkRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateShareLink(token, updates) {
      const hasExpiresAt = updates.expiresAt !== undefined;
      const hasDownloadCount = updates.downloadCount !== undefined;
      const setClauses = [];
      const params = [];
      if (hasExpiresAt) {
        params.push(updates.expiresAt);
        setClauses.push('expires_at = ?');
      }
      if (hasDownloadCount) {
        params.push(Number(updates.downloadCount));
        setClauses.push('download_count = ?');
      }

      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query('SELECT * FROM share_links WHERE token = ? LIMIT 1', [
            String(token),
          ]);
          if (existing.rows.length === 0) throwLinkNotFound();
          if (setClauses.length === 0) return mapShareLinkRow(existing.rows[0]);

          await tx.run(
            `UPDATE share_links SET ${setClauses.join(', ')} WHERE token = ?`,
            [...params, String(token)]
          );
          const updated = await tx.query('SELECT * FROM share_links WHERE token = ? LIMIT 1', [
            String(token),
          ]);
          return mapShareLinkRow(updated.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteShareLink(token) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM share_links WHERE token = ?', [String(token)]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async incrementDownloadCount(token) {
      try {
        return await executor.transaction(async (tx) => {
          await tx.run(
            'UPDATE share_links SET download_count = download_count + 1 WHERE token = ?',
            [String(token)]
          );
          const updated = await tx.query('SELECT * FROM share_links WHERE token = ? LIMIT 1', [
            String(token),
          ]);
          if (updated.rows.length === 0) throwLinkNotFound();
          return mapShareLinkRow(updated.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
