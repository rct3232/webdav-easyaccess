const { withLock } = require('./locks');
const { SETTINGS_PATH, META_ROOT } = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile, getBackend, withTransaction, getPgPool, isSqliteBackend, getSqliteConnection, withSqliteTransaction } = require('./storage');
const { mapDatabaseError } = require('../utils/errorHandler');

function nowIso() {
  return new Date().toISOString();
}

function isPostgresqlBackend() {
  return getBackend() === 'postgresql';
}

async function ensureSettingsFile() {
  if (isPostgresqlBackend() || isSqliteBackend()) return;
  await ensureDir(META_ROOT);
  const ok = await exists(SETTINGS_PATH);
  if (!ok) {
    const initial = {
      registration_enabled: 'false',
      updated_at: nowIso(),
    };
    await writeFile(SETTINGS_PATH, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }
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

  await ensureSettingsFile();
  const buf = await readFile(SETTINGS_PATH);
  const text = Buffer.from(buf).toString('utf8');
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') return obj;
  } catch {
    // fall through
  }
  // If corrupted, reset to safe defaults
  const fallback = {
    registration_enabled: 'false',
    updated_at: nowIso(),
  };
  await writeFile(SETTINGS_PATH, JSON.stringify(fallback, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  return fallback;
}

async function writeSettings(obj) {
  obj.updated_at = nowIso();
  await writeFile(SETTINGS_PATH, JSON.stringify(obj, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
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

  const s = await readSettings();
  return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : null;
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
          [String(key), JSON.stringify(String(value))]
        );
      });
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  await ensureSettingsFile();
  return await withLock('settings', async () => {
    const s = await readSettings();
    s[key] = String(value);
    await writeSettings(s);
    return { success: true };
  });
}

async function getAll() {
  if (isPostgresqlBackend()) {
    return await readSettings();
  }

  const s = await readSettings();
  const { updated_at, ...rest } = s;
  return rest;
}

async function isRegistrationEnabled() {
  const v = await get('registration_enabled');
  return v === 'true';
}

module.exports = {
  ensureSettingsFile,
  get,
  set,
  getAll,
  isRegistrationEnabled,
};

