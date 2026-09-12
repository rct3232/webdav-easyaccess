'use strict';

const { mapDatabaseError, createError } = require('../../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

function throwLinkNotFound() {
  throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
}

/**
 * postgres implementation of ShareLinkRepository (`$n` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 * @param {{ mapShareLinkRow: Function, buildExpiresAt: Function }} shared
 */
module.exports = function createPostgresShareLinkRepository(
  executor,
  { mapShareLinkRow, buildExpiresAt }
) {
  return {
    dialect: 'postgres',

    async createShareLink({ token, fileNodeId, createdBy, expiresInDays }) {
      const expiresAt = buildExpiresAt(expiresInDays);
      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query('SELECT * FROM share_links WHERE token = $1 LIMIT 1', [
            String(token),
          ]);
          if (existing.rows.length > 0) return mapShareLinkRow(existing.rows[0]);

          const inserted = await tx.run(
            `INSERT INTO share_links (token, file_node_id, created_by, created_at, expires_at, download_count)
             VALUES ($1, $2, $3, NOW(), $4, 0) RETURNING *`,
            [String(token), Number(fileNodeId), Number(createdBy), expiresAt]
          );
          return mapShareLinkRow(inserted.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getShareLink(token) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM share_links WHERE token = $1 LIMIT 1',
          [String(token)]
        );
        return mapShareLinkRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getUserShareLinks(userId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM share_links WHERE created_by = $1 ORDER BY created_at DESC',
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
      const param = (value) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (hasExpiresAt) setClauses.push(`expires_at = ${param(updates.expiresAt)}`);
      if (hasDownloadCount)
        setClauses.push(`download_count = ${param(Number(updates.downloadCount))}`);

      try {
        return await executor.transaction(async (tx) => {
          const existing = await tx.query('SELECT * FROM share_links WHERE token = $1 LIMIT 1', [
            String(token),
          ]);
          if (existing.rows.length === 0) throwLinkNotFound();
          if (setClauses.length === 0) return mapShareLinkRow(existing.rows[0]);

          const updated = await tx.run(
            `UPDATE share_links SET ${setClauses.join(', ')}
              WHERE token = $${params.length + 1} RETURNING *`,
            [...params, String(token)]
          );
          return mapShareLinkRow(updated.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteShareLink(token) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM share_links WHERE token = $1', [String(token)]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async incrementDownloadCount(token) {
      try {
        return await executor.transaction(async (tx) => {
          const updated = await tx.run(
            `UPDATE share_links SET download_count = download_count + 1
              WHERE token = $1 RETURNING *`,
            [String(token)]
          );
          if (updated.rows.length === 0) throwLinkNotFound();
          return mapShareLinkRow(updated.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
