'use strict';

const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { mapDatabaseError } = require('../../../utils/errorHandler');
const { sha256HexLower } = require('../../../utils/hash');
const { nowIso } = require('../../../utils/sharedHelpers');
const {
  normalizeEmail,
  mapUserRow,
  requireCreateFields,
  throwUsernameTaken,
  throwEmailTaken,
  throwUserNotFound,
  throwEmailRequired,
} = require('../userShared');

/**
 * postgres implementation of UserRepository (`$n` placeholders,
 * executor-driven). Same duplicate pre-check contract as the sqlite variant.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresUserRepository(executor) {
  return {
    dialect: 'postgres',

    async findByUsername(username) {
      try {
        const { rows } = await executor.query(
          `SELECT *
             FROM users
            WHERE username = $1
            LIMIT 1`,
          [String(username)]
        );
        return mapUserRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findByEmail(email) {
      const emailNorm = normalizeEmail(email);
      if (!emailNorm) return undefined;
      const emailHash = sha256HexLower(emailNorm);
      try {
        const { rows } = await executor.query(
          `SELECT *
             FROM users
            WHERE email_hash = $1
            LIMIT 1`,
          [emailHash]
        );
        return mapUserRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findById(id) {
      try {
        const { rows } = await executor.query(
          `SELECT *
             FROM users
            WHERE id = $1
            LIMIT 1`,
          [Number(id)]
        );
        return mapUserRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async createUser({ username, email, passwordHash, isAdmin = false }) {
      requireCreateFields({ username, email, passwordHash });

      const emailNorm = normalizeEmail(email);
      const emailHash = sha256HexLower(emailNorm);
      const createdAt = nowIso();
      try {
        return await executor.transaction(async (tx) => {
          const dupUsername = await tx.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [
            String(username),
          ]);
          if (dupUsername.rows.length > 0) throwUsernameTaken();

          const dupEmail = await tx.query('SELECT 1 FROM users WHERE email_hash = $1 LIMIT 1', [
            emailHash,
          ]);
          if (dupEmail.rows.length > 0) throwEmailTaken();

          const inserted = await tx.run(
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
        // The duplicate pre-checks run inside the transaction; the unique
        // constraint is a defensive backstop (raw driver error classification).
        if (executor.isUniqueConflict(error)) throwUsernameTaken();
        throw mapDatabaseError(error);
      }
    },

    async updateStatus(userId, status) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run(
            `UPDATE users
                SET status = $1,
                    updated_at = NOW()
              WHERE id = $2`,
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
      if (!newNorm) throwEmailRequired();

      const userIdNum = Number(userId);
      const newHash = sha256HexLower(newNorm);
      try {
        return await executor.transaction(async (tx) => {
          const currentUserRes = await tx.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [
            userIdNum,
          ]);
          if (currentUserRes.rows.length === 0) throwUserNotFound();

          const dupEmailRes = await tx.query(
            'SELECT id FROM users WHERE email_hash = $1 LIMIT 1',
            [newHash]
          );
          if (dupEmailRes.rows.length > 0 && Number(dupEmailRes.rows[0].id) !== userIdNum) {
            throwEmailTaken();
          }

          await tx.run(
            `UPDATE users
                SET email = $1,
                    email_hash = $2,
                    updated_at = NOW()
              WHERE id = $3`,
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
        await executor.transaction(async (tx) => {
          await tx.run(
            `UPDATE users
                SET password = $1,
                    token_version = token_version + 1,
                    updated_at = NOW()
              WHERE id = $2`,
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
        await executor.transaction(async (tx) => {
          await tx.run('DELETE FROM users WHERE id = $1', [Number(userId)]);
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findAll() {
      try {
        const { rows } = await executor.query('SELECT * FROM users ORDER BY created_at DESC');
        return rows.map(mapUserRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findByStatus(status) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM users WHERE status = $1 ORDER BY created_at DESC',
          [status]
        );
        return rows.map(mapUserRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
