const storage = require('./storage');
const { normalizeWebdavPath } = require('./metaPaths');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../utils/errorHandler');
const { toIsoString } = require('../utils/sharedHelpers');

const SHARE_LINKS_DIR = '/.wea/share-links/';

/**
 * ShareLink storage
 * Stores share link data as JSON files under /.wea/share-links/ on WebDAV
 */

/**
 * Create path for a share link file
 * @param {string} token - Access token
 * @returns {string} WebDAV path
 */

/**
 * Create the file path for a share link entry
 * @param {string} token - Access token
 * @returns {string} WebDAV path
 */
function getShareLinkPath(token) {
  return normalizeWebdavPath(`${SHARE_LINKS_DIR}${token}.json`);
}

function isPostgresqlBackend() {
  return storage.getBackend() === 'postgresql';
}

function isSqliteBackend() {
  return storage.getBackend() === 'sqlite';
}

function mapShareLinkRow(row) {
  if (!row) return null;
  return {
    token: row.token,
    filePath: normalizeWebdavPath(row.file_path),
    createdBy: Number(row.created_by),
    createdAt: toIsoString(row.created_at),
    expiresAt: row.expires_at ? toIsoString(row.expires_at) : null,
    downloadCount: Number(row.download_count || 0),
  };
}

/**
 * Create a new share link
 * @param {Object} linkData - Link data
 * @returns {Promise<Object>} The created link data
 */
async function createShareLink(linkData) {
  const { token, filePath, createdBy, expiresInDays } = linkData;

  if (isPostgresqlBackend()) {
    let expiresAt = null;
    if (expiresInDays !== null && expiresInDays !== undefined) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + expiresInDays);
      expiresAt = expiryDate.toISOString();
    }

    const normalizedFilePath = normalizeWebdavPath(filePath);
    try {
      return await storage.withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM share_links
            WHERE token = $1
            LIMIT 1`,
          [String(token)]
        );
        if (existing.rows.length > 0) {
          return mapShareLinkRow(existing.rows[0]);
        }

        const inserted = await client.query(
          `INSERT INTO share_links (token, file_path, created_by, created_at, expires_at, download_count)
           VALUES ($1, $2, $3, NOW(), $4, 0)
           RETURNING *`,
          [String(token), normalizedFilePath, Number(createdBy), expiresAt]
        );
        return mapShareLinkRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    let expiresAt = null;
    if (expiresInDays !== null && expiresInDays !== undefined) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + expiresInDays);
      expiresAt = expiryDate.toISOString();
    }

    const normalizedFilePath = normalizeWebdavPath(filePath);
    try {
      return await storage.withSqliteTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM share_links
            WHERE token = ?
            LIMIT 1`,
          [String(token)]
        );
        if (existing.rows.length > 0) {
          return mapShareLinkRow(existing.rows[0]);
        }

        const inserted = await client.query(
          `INSERT INTO share_links (token, file_path, created_by, created_at, expires_at, download_count)
           VALUES (?, ?, ?, datetime('now'), ?, 0)
           RETURNING *`,
          [String(token), normalizedFilePath, Number(createdBy), expiresAt]
        );
        return mapShareLinkRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  // Ensure directory exists and create if needed
  await storage.ensureDirSafe(SHARE_LINKS_DIR);

  const createdAt = new Date().toISOString();
  let expiresAt = null;
  if (expiresInDays !== null && expiresInDays !== undefined) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);
    expiresAt = expiryDate.toISOString();
  }
  
  const link = {
    token,
    filePath: normalizeWebdavPath(filePath),
    createdBy,
    createdAt,
    expiresAt,
    downloadCount: 0,
  };
  
  const linkPath = getShareLinkPath(token);
  
  // Check if the file already exists
  const exists = await storage.exists(linkPath);
  if (exists) {
    // If it exists, return the existing link (token collision is nearly impossible but defensive)
    const existingLink = await getShareLink(token);
    if (existingLink) {
      return existingLink;
    }
  }
  
  // Write file (using overwrite option)
  await storage.writeFile(linkPath, JSON.stringify(link, null, 2), { overwrite: true });
  
  return link;
}

/**
 * Retrieve a share link
 * @param {string} token - Access token
 * @returns {Promise<Object|null>} Link data or null
 */
async function getShareLink(token) {
  if (isPostgresqlBackend()) {
    try {
      const pool = storage.getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM share_links
          WHERE token = $1
          LIMIT 1`,
        [String(token)]
      );
      if (res.rows.length === 0) return null;
      return mapShareLinkRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = storage.getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT *
             FROM share_links
            WHERE token = ?
            LIMIT 1`,
          [String(token)],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      if (res.rows.length === 0) return null;
      return mapShareLinkRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    const linkPath = getShareLinkPath(token);
    const content = await storage.readFile(linkPath);
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
      return null;
    }
    throw error;
  }
}

/**
 * Retrieve all share links created by a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of links
 */
async function getUserShareLinks(userId) {
  if (isPostgresqlBackend()) {
    try {
      const pool = storage.getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM share_links
          WHERE created_by = $1
          ORDER BY created_at DESC`,
        [Number(userId)]
      );
      return res.rows.map(mapShareLinkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const db = storage.getSqliteConnection();
      const res = await new Promise((resolve, reject) => {
        db.all(
          `SELECT *
             FROM share_links
            WHERE created_by = ?
            ORDER BY created_at DESC`,
          [Number(userId)],
          (err, rows) => {
            if (err) reject(err);
            else resolve({ rows: rows || [] });
          }
        );
      });
      return res.rows.map(mapShareLinkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  try {
    // Ensure directory exists and create if needed
    await storage.ensureDirSafe(SHARE_LINKS_DIR);
    
    // List all files in the /.wea/share-links/ directory
    const linksDir = normalizeWebdavPath(SHARE_LINKS_DIR);
    const files = await storage.listDir(linksDir);
    
    const links = [];
    for (const file of files) {
      if (file.type === 'file' && file.basename.endsWith('.json')) {
        try {
          const linkPath = normalizeWebdavPath(`${SHARE_LINKS_DIR}${file.basename}`);
          const content = await storage.readFile(linkPath);
          const link = JSON.parse(content);
          
          // Filter to only links created by this user
          if (link.createdBy === userId) {
            links.push(link);
          }
        } catch (error) {
          // Ignore file read failures and continue
          console.error(`Failed to read share link file ${file.basename}:`, error);
        }
      }
    }
    
    // Sort by creation date descending
    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return links;
  } catch (error) {
    // Return empty array if directory missing or other error occurs
    console.error('Failed to get user share links:', error);
    return [];
  }
}

/**
 * Update a share link
 * @param {string} token - Access token
 * @param {Object} updates - Data to update
 * @returns {Promise<Object>} Updated link data
 */
async function updateShareLink(token, updates) {
  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT *
             FROM share_links
            WHERE token = $1
            LIMIT 1`,
          [String(token)]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }

        const current = mapShareLinkRow(existing.rows[0]);
        const merged = {
          ...current,
          ...updates,
        };

        const updated = await client.query(
          `UPDATE share_links
              SET file_path = $2,
                  expires_at = $3,
                  download_count = $4
            WHERE token = $1
            RETURNING *`,
          [
            String(token),
            normalizeWebdavPath(merged.filePath),
            merged.expiresAt || null,
            Number(merged.downloadCount || 0),
          ]
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
          `SELECT *
             FROM share_links
            WHERE token = ?
            LIMIT 1`,
          [String(token)]
        );
        if (existing.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
        }

        const current = mapShareLinkRow(existing.rows[0]);
        const merged = {
          ...current,
          ...updates,
        };

        const updated = await client.query(
          `UPDATE share_links
              SET file_path = ?,
                  expires_at = ?,
                  download_count = ?
            WHERE token = ?
            RETURNING *`,
          [
            normalizeWebdavPath(merged.filePath),
            merged.expiresAt || null,
            Number(merged.downloadCount || 0),
            String(token),
          ]
        );
        return mapShareLinkRow(updated.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const link = await getShareLink(token);
  if (!link) {
    throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
  }
  
  const updatedLink = {
    ...link,
    ...updates,
  };
  
  const linkPath = getShareLinkPath(token);
  await storage.writeFile(linkPath, JSON.stringify(updatedLink, null, 2));
  
  return updatedLink;
}

/**
 * Delete a share link
 * @param {string} token - Access token
 * @returns {Promise<void>}
 */
async function deleteShareLink(token) {
  if (isPostgresqlBackend()) {
    try {
      await storage.withTransaction(async (client) => {
        await client.query(
          `DELETE FROM share_links
            WHERE token = $1`,
          [String(token)]
        );
      });
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      await storage.withSqliteTransaction(async (client) => {
        await client.query(
          `DELETE FROM share_links
            WHERE token = ?`,
          [String(token)]
        );
      });
      return;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  const linkPath = getShareLinkPath(token);
  await storage.deletePath(linkPath);
}

/**
 * Increment download count for a share link
 * @param {string} token - Access token
 * @returns {Promise<Object>} Updated link data
 */
async function incrementDownloadCount(token) {
  if (isPostgresqlBackend()) {
    try {
      return await storage.withTransaction(async (client) => {
        const updated = await client.query(
          `UPDATE share_links
              SET download_count = download_count + 1
            WHERE token = $1
            RETURNING *`,
          [String(token)]
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
        const updated = await client.query(
          `UPDATE share_links
              SET download_count = download_count + 1
            WHERE token = ?
            RETURNING *`,
          [String(token)]
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

  const link = await getShareLink(token);
  if (!link) {
    throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
  }
  
  return await updateShareLink(token, {
    downloadCount: (link.downloadCount || 0) + 1,
  });
}

/**
 * Check if a link is expired
 * @param {Object} link - Link data
 * @returns {boolean} Whether the link is expired
 */
function isLinkExpired(link) {
  if (!link.expiresAt) {
    return false; // unlimited
  }
  
  const now = new Date();
  const expiresAt = new Date(link.expiresAt);
  return now > expiresAt;
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
