'use strict';

const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../../../utils/errorHandler');
const { sha256HexLower } = require('../../../store/metaPaths');
const { getSqliteConnection, withSqliteTransaction } = require('../../../store/storage');

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
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

function SqliteMetadataAdapter() {
  return {
    async ensureUserIndexFile() {
      // No-op for SQLite; schema is managed externally
    },

    async findByUsername(username) {
      try {
        const db = getSqliteConnection();
        const res = await new Promise((resolve, reject) => {
          db.all(
            `SELECT *
               FROM users
              WHERE username = ?
              LIMIT 1`,
            [String(username)],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        });
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
        const db = getSqliteConnection();
        const res = await new Promise((resolve, reject) => {
          db.all(
            `SELECT *
               FROM users
              WHERE email_hash = ?
              LIMIT 1`,
            [emailHash],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        });
        return mapUserRow(res.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findById(id) {
      try {
        const db = getSqliteConnection();
        const res = await new Promise((resolve, reject) => {
          db.all(
            `SELECT *
               FROM users
              WHERE id = ?
              LIMIT 1`,
            [Number(id)],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        });
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
        return await withSqliteTransaction(async (client) => {
          const dupUsername = await client.query(
            `SELECT 1 FROM users WHERE username = ? LIMIT 1`,
            [String(username)]
          );
          if (dupUsername.rows.length > 0) {
            throw createError(SERVER_ERROR_CODES.admin.usernameTaken, 409);
          }

          const dupEmail = await client.query(
            `SELECT 1 FROM users WHERE email_hash = ? LIMIT 1`,
            [emailHash]
          );
          if (dupEmail.rows.length > 0) {
            throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
          }

          await client.query(
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
              VALUES (?,?,?,?,?,?,?,?,?)`,
            [
              String(username),
              emailNorm,
              emailHash,
              String(passwordHash),
              isAdmin ? USER_STATUS.APPROVED : USER_STATUS.PENDING,
              Boolean(isAdmin),
              0,
              createdAt,
              createdAt,
            ]
          );

          const inserted = await client.query(
            `SELECT * FROM users WHERE id = last_insert_rowid() LIMIT 1`
          );
          return mapUserRow(inserted.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateStatus(userId, status) {
      try {
        await withSqliteTransaction(async (client) => {
          await client.query(
            `UPDATE users
                SET status = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [status, Number(userId)]
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
        return await withSqliteTransaction(async (client) => {
          const currentUserRes = await client.query(
            `SELECT *
               FROM users
              WHERE id = ?
              LIMIT 1`,
            [userIdNum]
          );
          if (currentUserRes.rows.length === 0) {
            throw createError(SERVER_ERROR_CODES.admin.userNotFound, 404);
          }

          const dupEmailRes = await client.query(
            `SELECT id
               FROM users
              WHERE email_hash = ?
              LIMIT 1`,
            [newHash]
          );
          if (dupEmailRes.rows.length > 0 && Number(dupEmailRes.rows[0].id) !== userIdNum) {
            throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
          }

          await client.query(
            `UPDATE users
                SET email = ?,
                    email_hash = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [newNorm, newHash, userIdNum]
          );
          return { success: true };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updatePassword(userId, passwordHash) {
      try {
        await withSqliteTransaction(async (client) => {
          await client.query(
            `UPDATE users
                SET password = ?,
                    token_version = token_version + 1,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [String(passwordHash), Number(userId)]
          );
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteUser(userId) {
      try {
        await withSqliteTransaction(async (client) => {
          await client.query(`DELETE FROM users WHERE id = ?`, [Number(userId)]);
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findAll() {
      try {
        const db = getSqliteConnection();
        const res = await new Promise((resolve, reject) => {
          db.all(
            `SELECT *
               FROM users
              ORDER BY created_at DESC`,
            [],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        });
        return res.rows.map(mapUserRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findByStatus(status) {
      try {
        const db = getSqliteConnection();
        const res = await new Promise((resolve, reject) => {
          db.all(
            `SELECT *
               FROM users
              WHERE status = ?
              ORDER BY created_at DESC`,
            [status],
            (err, rows) => {
              if (err) reject(err);
              else resolve({ rows: rows || [] });
            }
          );
        });
        return res.rows.map(mapUserRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
}

module.exports = SqliteMetadataAdapter;
