const fs = require('fs');
const path = require('path');

const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../utils/errorHandler');

let pgPool = null;
let sqliteDb = null;

function getBackend() {
  const forced = (process.env.WEA_STORAGE_BACKEND || '').toLowerCase();
  if (forced === 'postgresql' || forced === 'postgres' || forced === 'pg') return 'postgresql';
  if (forced === 'sqlite') return 'sqlite';
  console.warn(`DEPRECATION: WEA_STORAGE_BACKEND=${forced || '(default)'} is deprecated. Falling back to sqlite.`);
  return 'sqlite';
}

function isSqliteBackend() {
  return getBackend() === 'sqlite';
}

function parseBooleanEnv(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseNumberEnv(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolvePgConfig() {
  const requiredKeys = [
    'WEA_PG_HOST',
    'WEA_PG_PORT',
    'WEA_PG_DATABASE',
    'WEA_PG_USER',
    'WEA_PG_PASSWORD',
  ];
  const missing = requiredKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw createError(
      SERVER_ERROR_CODES.storage.postgresqlNotConfigured,
      500,
      { missing: missing.join(',') }
    );
  }

  return {
    host: process.env.WEA_PG_HOST,
    port: parseNumberEnv(process.env.WEA_PG_PORT, 5432),
    database: process.env.WEA_PG_DATABASE,
    user: process.env.WEA_PG_USER,
    password: process.env.WEA_PG_PASSWORD,
    max: parseNumberEnv(process.env.WEA_PG_MAX, 10),
    idleTimeoutMillis: parseNumberEnv(process.env.WEA_PG_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: parseNumberEnv(process.env.WEA_PG_CONNECTION_TIMEOUT_MS, 10_000),
    ssl: parseBooleanEnv(process.env.WEA_PG_SSL) ? { rejectUnauthorized: false } : false,
  };
}

function getPgPool() {
  if (pgPool) return pgPool;
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (error) {
    throw createError(
      SERVER_ERROR_CODES.storage.postgresqlNotConfigured,
      500,
      { reason: 'pg_module_missing' }
    );
  }

  pgPool = new Pool(resolvePgConfig());
  pgPool.on('error', (err) => {
    // node-pg emits 'error' for idle-client failures (e.g. PostgreSQL
    // restart or dropped connection). Without a listener the event is
    // unhandled and crashes the process.
    // eslint-disable-next-line no-console
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
  });
  return pgPool;
}

async function closePgPool() {
  if (!pgPool) return;
  const pool = pgPool;
  pgPool = null;
  await pool.end();
}

function getSqliteConnection() {
  const dbPath = process.env.WEA_SQLITE_PATH || path.join(__dirname, '../../data/webdav.db');

  // Reuse the cached connection only when it targets the same file and is
  // still open. Cross-suite test runs change WEA_SQLITE_PATH between suites;
  // reusing a stale (closed or different-path) handle causes
  // SQLITE_MISUSE "Database handle is closed".
  if (sqliteDb && sqliteDb.__weaPath === dbPath && !sqliteDb.__weaClosed) {
    return sqliteDb;
  }

  if (sqliteDb) {
    try { sqliteDb.close(); } catch { /* ignore */ }
    sqliteDb = null;
  }

  let sqlite3;
  try {
    sqlite3 = require('sqlite3').verbose();
  } catch (error) {
    throw createError(
      SERVER_ERROR_CODES.storage.postgresqlNotConfigured,
      500,
      { reason: 'sqlite3_module_missing' }
    );
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to open SQLite database:', err.message);
    }
  });
  sqliteDb.__weaPath = dbPath;
  sqliteDb.__weaClosed = false;

  sqliteDb.run('PRAGMA journal_mode = WAL', () => {});
  sqliteDb.run('PRAGMA foreign_keys = ON', () => {});

  return sqliteDb;
}

function closeSqliteDb() {
  if (!sqliteDb) return;
  const db = sqliteDb;
  sqliteDb = null;
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sqliteQuery(sql, params = []) {
  const db = getSqliteConnection();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve({ rows: rows || [] });
    });
  });
}

function sqliteRun(sql, params = []) {
  const db = getSqliteConnection();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function withSqliteTransaction(callback) {
  const db = getSqliteConnection();
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        await sqliteRun('BEGIN');
        const client = {
          query: (sql, params = []) => sqliteQuery(sql, params),
          release: () => {},
        };
        const result = await callback(client);
        await sqliteRun('COMMIT');
        resolve(result);
      } catch (error) {
        try {
          await sqliteRun('ROLLBACK');
        } catch {
          // ignore rollback errors and surface the original failure
        }
        reject(mapDatabaseError(error));
      }
    });
  });
}

async function withTransaction(callback) {
  const pool = getPgPool();
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw mapDatabaseError(error);
  }

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors and surface the original failure
    }
    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}

module.exports = {
  getBackend,
  isSqliteBackend,
  getPgPool,
  withTransaction,
  closePgPool,
  getSqliteConnection,
  sqliteQuery,
  sqliteRun,
  withSqliteTransaction,
  closeSqliteDb,
};
