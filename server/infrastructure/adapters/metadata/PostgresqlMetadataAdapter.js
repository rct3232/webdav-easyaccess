'use strict';

const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../../../utils/errorHandler');
const { sha256HexLower, normalizeWebdavPath } = require('../../../store/metaPaths');
const { nowIso, toIsoString } = require('../../../utils/sharedHelpers');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mapUserRow(row) {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    email_hash: row.email_hash,
    password: row.password,
    status: row.status,
    is_admin: row.is_admin ? 1 : 0,
    token_version: Number.isInteger(row.token_version) ? row.token_version : Number(row.token_version || 0),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

function PostgresqlMetadataAdapter() {
  // Lazy require to ensure Jest mocks on store/storage are picked up
  const { getPgPool, withTransaction } = require('../../../store/storage');
  return {
    async findByUsername(username) {
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT *
             FROM users
            WHERE username = $1
            LIMIT 1`,
          [String(username)]
        );
        return mapUserRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findByEmail(email) {
      const emailNorm = normalizeEmail(email);
      if (!emailNorm) return undefined;
      const emailHash = sha256HexLower(emailNorm);
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT *
             FROM users
            WHERE email_hash = $1
            LIMIT 1`,
          [emailHash]
        );
        return mapUserRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findById(id) {
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT *
             FROM users
            WHERE id = $1
            LIMIT 1`,
          [Number(id)]
        );
        return mapUserRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async createUser({ username, email, passwordHash, isAdmin = false }) {
      if (!username || !email || !passwordHash) {
        throw createError(SERVER_ERROR_CODES.admin.createUserRequiredFields, 400);
      }

      const emailNorm = normalizeEmail(email);
      const emailHash = sha256HexLower(emailNorm);
      const createdAt = nowIso();
      try {
        return await withTransaction(async (client) => {
          const dupUsername = await client.query(
            `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
            [String(username)]
          );
          if (dupUsername.rows.length > 0) {
            throw createError(SERVER_ERROR_CODES.admin.usernameTaken, 409);
          }

          const dupEmail = await client.query(
            `SELECT 1 FROM users WHERE email_hash = $1 LIMIT 1`,
            [emailHash]
          );
          if (dupEmail.rows.length > 0) {
            throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
          }

          const inserted = await client.query(
            `INSERT INTO users (
                username,
                email,
                email_hash,
                password,
                status,
                is_admin,
                token_version,
                created_at,
                updated_at
              )
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
              RETURNING *`,
            [
              String(username),
              emailNorm,
              emailHash,
              String(passwordHash),
              isAdmin ? USER_STATUS.APPROVED : USER_STATUS.PENDING,
              Boolean(isAdmin),
              0,
              createdAt,
            ]
          );
          return mapUserRow(inserted.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateStatus(userId, status) {
      try {
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE users
                SET status = $2,
                    updated_at = NOW()
              WHERE id = $1`,
            [Number(userId), status]
          );
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateEmail(userId, newEmail) {
      const newNorm = normalizeEmail(newEmail);
      if (!newNorm) throw createError(SERVER_ERROR_CODES.users.emailRequired, 400);

      const userIdNum = Number(userId);
      const newHash = sha256HexLower(newNorm);
      try {
        return await withTransaction(async (client) => {
          const currentUserRes = await client.query(
            `SELECT *
               FROM users
              WHERE id = $1
              LIMIT 1`,
            [userIdNum]
          );
          if (currentUserRes.rows.length === 0) {
            throw createError(SERVER_ERROR_CODES.admin.userNotFound, 404);
          }

          const dupEmailRes = await client.query(
            `SELECT id
               FROM users
              WHERE email_hash = $1
              LIMIT 1`,
            [newHash]
          );
          if (dupEmailRes.rows.length > 0 && Number(dupEmailRes.rows[0].id) !== userIdNum) {
            throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
          }

          await client.query(
            `UPDATE users
                SET email = $2,
                    email_hash = $3,
                    updated_at = NOW()
              WHERE id = $1`,
            [userIdNum, newNorm, newHash]
          );
          return { success: true };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updatePassword(userId, passwordHash) {
      try {
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE users
                SET password = $2,
                    token_version = token_version + 1,
                    updated_at = NOW()
              WHERE id = $1`,
            [Number(userId), String(passwordHash)]
          );
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteUser(userId) {
      try {
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM users WHERE id = $1`, [Number(userId)]);
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findAll() {
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT *
             FROM users
            ORDER BY created_at DESC`
        );
        return res.rows.map(mapUserRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findByStatus(status) {
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT *
             FROM users
            WHERE status = $1
            ORDER BY created_at DESC`,
          [status]
        );
        return res.rows.map(mapUserRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async createShareLink(linkData) {
      const { token, filePath, createdBy, expiresInDays } = linkData;
      let expiresAt = null;
      if (expiresInDays !== null && expiresInDays !== undefined) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiresInDays);
        expiresAt = expiryDate.toISOString();
      }
      const normalizedFilePath = normalizeWebdavPath(filePath);
      try {
        return await withTransaction(async (client) => {
          const existing = await client.query(
            `SELECT * FROM share_links WHERE token = $1 LIMIT 1`,
            [String(token)]
          );
          if (existing.rows.length > 0) {
            return mapShareLinkRow(existing.rows[0]);
          }
          const inserted = await client.query(
            `INSERT INTO share_links (token, file_path, created_by, created_at, expires_at, download_count)
             VALUES ($1, $2, $3, NOW(), $4, 0) RETURNING *`,
            [String(token), normalizedFilePath, Number(createdBy), expiresAt]
          );
          return mapShareLinkRow(inserted.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getShareLink(token) {
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT * FROM share_links WHERE token = $1 LIMIT 1`,
          [String(token)]
        );
        if (res.rows.length === 0) return null;
        return mapShareLinkRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getUserShareLinks(userId) {
      try {
        const pool = getPgPool();
        const res = await pool.query(
          `SELECT * FROM share_links WHERE created_by = $1 ORDER BY created_at DESC`,
          [Number(userId)]
        );
        return res.rows.map(mapShareLinkRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateShareLink(token, updates) {
      try {
        return await withTransaction(async (client) => {
          const existing = await client.query(
            `SELECT * FROM share_links WHERE token = $1 LIMIT 1`,
            [String(token)]
          );
          if (existing.rows.length === 0) {
            throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
          }
          const current = mapShareLinkRow(existing.rows[0]);
          const merged = { ...current, ...updates };
          const updated = await client.query(
            `UPDATE share_links SET file_path = $2, expires_at = $3, download_count = $4
             WHERE token = $1 RETURNING *`,
            [String(token), normalizeWebdavPath(merged.filePath), merged.expiresAt || null, Number(merged.downloadCount || 0)]
          );
          return mapShareLinkRow(updated.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteShareLink(token) {
      try {
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM share_links WHERE token = $1`, [String(token)]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async incrementDownloadCount(token) {
      try {
        return await withTransaction(async (client) => {
          const updated = await client.query(
            `UPDATE share_links SET download_count = download_count + 1
             WHERE token = $1 RETURNING *`,
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
    },
  };
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

module.exports = PostgresqlMetadataAdapter;
