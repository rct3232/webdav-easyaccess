const {
  getBackend,
  withTransaction,
  getPgPool,
  isSqliteBackend,
  withSqliteTransaction,
} = require('./storage');
const { mapDatabaseError } = require('../utils/errorHandler');

function isPostgresqlBackend() {
  return getBackend() === 'postgresql';
}

async function readSettings() {
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(`SELECT key, value FROM settings`);
      const out = {};
      for (const row of res.rows) {
        out[row.key] = row.value;
      }
      return out;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const res = await withSqliteTransaction(async (client) => {
        return client.query(`SELECT key, value FROM settings`);
      });
      const out = {};
      for (const row of res.rows) {
        out[row.key] = row.value;
      }
      return out;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function get(key) {
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT value
           FROM settings
          WHERE key = $1
          LIMIT 1`,
        [String(key)]
      );
      if (res.rows.length === 0) return null;
      return res.rows[0].value;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const res = await withSqliteTransaction(async (client) => {
        return client.query(
          `SELECT value
             FROM settings
            WHERE key = ?
            LIMIT 1`,
          [String(key)]
        );
      });
      if (res.rows.length === 0) return null;
      return res.rows[0].value;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function set(key, value) {
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
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
  }

  if (isSqliteBackend()) {
    try {
      await withSqliteTransaction(async (client) => {
        await client.query(
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
  }

  throw new Error('No database backend configured');
}

async function listRows() {
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(`SELECT key, value, updated_at FROM settings`);
      return res.rows.map((row) => ({
        key: row.key,
        value: row.value,
        updated_at: row.updated_at,
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  if (isSqliteBackend()) {
    try {
      const res = await withSqliteTransaction(async (client) => {
        return client.query(`SELECT key, value, updated_at FROM settings`);
      });
      return res.rows.map((row) => ({
        key: row.key,
        value: row.value,
        updated_at: row.updated_at,
      }));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  throw new Error('No database backend configured');
}

async function getAll() {
  const s = await readSettings();
  const rest = { ...s };
  delete rest.updated_at;
  return rest;
}

async function isRegistrationEnabled() {
  const v = await get('registration_enabled');
  return v === 'true';
}

module.exports = {
  get,
  set,
  getAll,
  listRows,
  isRegistrationEnabled,
};
