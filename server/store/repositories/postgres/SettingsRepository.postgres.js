'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

/**
 * postgres implementation of SettingsRepository (JSONB values, `$n`
 * placeholders). Values are stored as JSON-encoded plaintext strings, matching
 * the pre-existing behaviour of `server/store/settingsStore.js`.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresSettingsRepository(executor) {
  return {
    dialect: 'postgres',

    async get(key) {
      try {
        const { rows } = await executor.query(
          `SELECT value
             FROM settings
            WHERE key = $1
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
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key)
             DO UPDATE
               SET value = EXCLUDED.value,
                   updated_at = NOW()`,
            [String(key), JSON.stringify(String(value))]
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
