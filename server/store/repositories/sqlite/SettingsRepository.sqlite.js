'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

/**
 * sqlite implementation of SettingsRepository (TEXT values, `?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteSettingsRepository(executor) {
  return {
    dialect: 'sqlite',

    async get(key) {
      try {
        const { rows } = await executor.query(
          `SELECT value
             FROM settings
            WHERE key = ?
            LIMIT 1`,
          [String(key)]
        );
        if (rows.length === 0) return null;
        return rows[0].value;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getAll() {
      try {
        const { rows } = await executor.query(`SELECT key, value FROM settings`);
        const out = {};
        for (const row of rows) out[row.key] = row.value;
        return out;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async set(key, value) {
      try {
        await executor.transaction(async (tx) => {
          await tx.run(
            `INSERT INTO settings (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = CURRENT_TIMESTAMP`,
            [String(key), String(value)]
          );
        });
        return { success: true };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listRows() {
      try {
        const { rows } = await executor.query(`SELECT key, value, updated_at FROM settings`);
        return rows.map((row) => ({ key: row.key, value: row.value, updated_at: row.updated_at }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
