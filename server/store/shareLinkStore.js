'use strict';

const storage = require('./storage');
const { mapDatabaseError, createError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { toIsoString } = require('../utils/sharedHelpers');
const { isLinkExpired } = require('../infrastructure/adapters/metadata/isLinkExpired');

function isPostgresqlBackend() {
  return storage.getBackend() === 'postgresql';
}

function isSqliteBackend() {
  return storage.getBackend() === 'sqlite';
}

/**
 * Map a share_links row to the canonical link object.
 * @param {Object} row
 * @returns {Object|null}
 */
function mapShareLinkRow(row) {
  if (!row) return null;
  return {
    token: row.token,
    nodeId: Number(row.file_node_id),
    fileNodeId: Number(row.file_node_id),
    createdBy: Number(row.created_by),
    createdAt: toIsoString(row.created_at),
    expiresAt: row.expires_at ? toIsoString(row.expires_at) : null,
    downloadCount: Number(row.download_count || 0),
  };
}

/**
 * Create a share link; existing token returns the existing link.
 * @param {Object} linkData
 * @param {string} linkData.token
 * @param {number} linkData.fileNodeId
 * @param {number} linkData.createdBy
 * @param {number|null} [linkData.expiresInDays]
 * @returns {Promise<Object>}
 */
async function createShareLink({ token, fileNodeId, createdBy, expiresInDays }) {
  let expiresAt = null;
  if (expiresInDays !== null && expiresInDays !== undefined) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);
    expiresAt = expiryDate.toISOString();
  }
  const tokenStr = String(token);
  const fileNodeIdNum = Number(fileNodeId);
  const createdByNum = Number(createdBy);

  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT * FROM share_links WHERE token = $1 LIMIT 1`,
          [tokenStr]
        );
        if (existing.rows.length > 0) {
          return mapShareLinkRow(existing.rows[0]);
        }
        const inserted = await client.query(
          `INSERT INTO share_links (token, file_node_id, created_by, created_at, expires_at, download_count)
           VALUES ($1, $2, $3, NOW(), $4, 0) RETURNING *`,
          [tokenStr, fileNodeIdNum, createdByNum, expiresAt]
        );
        return mapShareLinkRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await storage.withSqliteTransaction(async (client) => {
        const existing = await client.query(
          `SELECT * FROM share_links WHERE token = ? LIMIT 1`,
          [tokenStr]
        );
        if (existing.rows.length > 0) {
          return mapShareLinkRow(existing.rows[0]);
        }
        await client.query(
          `INSERT INTO share_links (token, file_node_id, created_by, created_at, expires_at, download_count)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 0)`,
          [tokenStr, fileNodeIdNum, createdByNum, expiresAt]
        );
        const inserted = await client.query(
          `SELECT * FROM share_links WHERE token = ? LIMIT 1`,
          [tokenStr]
        );
        return mapShareLinkRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * Fetch a share link by token.
 * @param {string} token
 * @returns {Promise<Object|null>}
 */
async function getShareLink(token) {
  const tokenStr = String(token);
  if (isPostgresqlBackend()) {
    try {
      const pool = storage.getPgPool();
      const res = await pool.query(
        `SELECT * FROM share_links WHERE token = $1 LIMIT 1`,
        [tokenStr]
      );
      return mapShareLinkRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const res = await storage.sqliteQuery(
        `SELECT * FROM share_links WHERE token = ? LIMIT 1`,
        [tokenStr]
      );
      return mapShareLinkRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * List all share links created by a user, newest first.
 * @param {number} userId
 * @returns {Promise<Array>}
 */
async function getUserShareLinks(userId) {
  const userIdNum = Number(userId);
  if (isPostgresqlBackend()) {
    try {
      const pool = storage.getPgPool();
      const res = await pool.query(
        `SELECT * FROM share_links WHERE created_by = $1 ORDER BY created_at DESC`,
        [userIdNum]
      );
      return res.rows.map(mapShareLinkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const res = await storage.sqliteQuery(
        `SELECT * FROM share_links WHERE created_by = ? ORDER BY created_at DESC`,
        [userIdNum]
      );
      return res.rows.map(mapShareLinkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * Partial update of a share link. Only expiry/download fields are mutable;
 * file_node_id is immutable. Throws 404 when the token does not exist.
 * @param {string} token
 * @param {Object} updates - { expiresAt?, downloadCount? }
 * @returns {Promise<Object>}
 */
async function updateShareLink(token, updates) {
  const tokenStr = String(token);
  const hasExpiresAt = updates.expiresAt !== undefined;
  const hasDownloadCount = updates.downloadCount !== undefined;
  const expiresAt = hasExpiresAt ? updates.expiresAt : null;
  const downloadCount = hasDownloadCount ? Number(updates.downloadCount) : null;

  const setClause = [];
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (hasExpiresAt) setClause.push(`expires_at = ${param(expiresAt)}`);
  if (hasDownloadCount) setClause.push(`download_count = ${param(downloadCount)}`);

  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT * FROM share_links WHERE token = $1 LIMIT 1`,
          [tokenStr]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }
        if (setClause.length === 0) {
          return mapShareLinkRow(existing.rows[0]);
        }
        const updated = await client.query(
          `UPDATE share_links SET ${setClause.join(', ')}
            WHERE token = $${params.length + 1} RETURNING *`,
          [...params, tokenStr]
        );
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await storage.withSqliteTransaction(async (client) => {
        const existing = await client.query(
          `SELECT * FROM share_links WHERE token = ? LIMIT 1`,
          [tokenStr]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }
        if (setClause.length === 0) {
          return mapShareLinkRow(existing.rows[0]);
        }
        const sqliteSet = setClause.map((c) => c.replace(/\$\d+/g, '?'));
        await client.query(
          `UPDATE share_links SET ${sqliteSet.join(', ')} WHERE token = ?`,
          [...params, tokenStr]
        );
        const updated = await client.query(
          `SELECT * FROM share_links WHERE token = ? LIMIT 1`,
          [tokenStr]
        );
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

/**
 * Delete a share link by token.
 * @param {string} token
 * @returns {Promise<void>}
 */
async function deleteShareLink(token) {
  const tokenStr = String(token);
  if (isPostgresqlBackend()) {
    try {
      await storage.withTransaction(async (client) => {
        await client.query(`DELETE FROM share_links WHERE token = $1`, [tokenStr]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
    return;
  }

  if (isSqliteBackend()) {
    try {
      await storage.withSqliteTransaction(async (client) => {
        await client.query(`DELETE FROM share_links WHERE token = ?`, [tokenStr]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
    return;
  }

  throw new Error('No database backend configured');
}

/**
 * Increment download count atomically and return the updated link.
 * @param {string} token
 * @returns {Promise<Object>}
 */
async function incrementDownloadCount(token) {
  const tokenStr = String(token);
  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const updated = await client.query(
          `UPDATE share_links SET download_count = download_count + 1
            WHERE token = $1 RETURNING *`,
          [tokenStr]
        );
        if (updated.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      return await storage.withSqliteTransaction(async (client) => {
        await client.query(
          `UPDATE share_links SET download_count = download_count + 1
            WHERE token = ?`,
          [tokenStr]
        );
        const updated = await client.query(
          `SELECT * FROM share_links WHERE token = ? LIMIT 1`,
          [tokenStr]
        );
        if (updated.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

module.exports = {
  createShareLink,
  getShareLink,
  getUserShareLinks,
  updateShareLink,
  deleteShareLink,
  incrementDownloadCount,
  isLinkExpired,
};
