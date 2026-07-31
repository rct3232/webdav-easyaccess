const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createDirectory,
  deleteFile,
  getFileContents,
  listDirectory,
  pathExists,
  putFileContentsAdvanced,
} = require('../utils/webdav');
const { normalizeWebdavPath } = require('./metaPaths');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../utils/errorHandler');

let pgPool = null;
let sqliteDb = null;

function getBackend() {
  const forced = (process.env.WEA_STORAGE_BACKEND || '').toLowerCase();
  if (forced === 'fs' || forced === 'filesystem') {
    console.warn('DEPRECATION: WEA_STORAGE_BACKEND=fs is deprecated. Falling back to sqlite.');
    return 'sqlite';
  }
  if (forced === 'postgresql' || forced === 'postgres' || forced === 'pg') return 'postgresql';
  if (forced === 'sqlite') return 'sqlite';
  if (!['postgresql', 'sqlite'].includes(forced)) {
    console.warn(`DEPRECATION: WEA_STORAGE_BACKEND=${forced || '(default)'} is deprecated. Falling back to postgresql.`);
    return 'postgresql';
  }
  return forced;
}

function isSqliteBackend() {
  return getBackend() === 'sqlite';
}

function getFsBaseDir() {
  const envDir = process.env.WEA_FS_DIR || process.env.WEA_METADATA_DIR;
  return envDir ? path.resolve(envDir) : path.join(os.tmpdir(), 'webdav-easyaccess-meta');
}

function webdavToFsPath(webdavPath) {
  const normalized = normalizeWebdavPath(webdavPath);
  const base = getFsBaseDir();
  // Drop leading slash to avoid absolute join
  const rel = normalized === '/' ? '' : normalized.substring(1);
  const joined = path.join(base, rel);
  // Safety: ensure path stays under base
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(base)) {
    throw createError(SERVER_ERROR_CODES.storage.invalidPathMapping, 400, { path: webdavPath });
  }
  return resolved;
}

function makeStatusError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
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
  return pgPool;
}

async function closePgPool() {
  if (!pgPool) return;
  const pool = pgPool;
  pgPool = null;
  await pool.end();
}

function getSqliteConnection() {
  if (sqliteDb) return sqliteDb;
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

  const dbPath = process.env.WEA_SQLITE_PATH || path.join(__dirname, '../../data/webdav.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to open SQLite database:', err.message);
    }
  });

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

async function ensureDir(dirPath) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(dirPath);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    await fsp.mkdir(local, { recursive: true });
    return;
  }
  // WebDAV MKCOL is not recursive; create step-by-step (mkdir -p)
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current + '/' + part;
    try {
      await createDirectory(current);
    } catch (e) {
      // Ignore "already exists" / conflicts. If a parent was missing, the next
      // iteration would still fail; later writes will surface a clear error.
    }
  }
}

async function exists(p) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    try {
      await fsp.access(local, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  return await pathExists(normalized);
}

async function readFile(p) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    return await fsp.readFile(local);
  }
  const buf = await getFileContents(normalized);
  return Buffer.from(buf);
}

async function writeFile(p, data, options = {}) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');

  const overwrite = options.overwrite !== undefined ? !!options.overwrite : true;
  const ifNoneMatchStar = !!options.ifNoneMatchStar;
  const contentType = options.contentType || 'application/octet-stream';

  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    await fsp.mkdir(path.dirname(local), { recursive: true });
    const flag = ifNoneMatchStar || !overwrite ? 'wx' : 'w';
    try {
      await fsp.writeFile(local, buf, { flag });
      return;
    } catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EISDIR')) {
        throw makeStatusError(412, `Precondition Failed: ${normalized} exists`);
      }
      throw e;
    }
  }

  const headers = {
    'Content-Type': contentType,
    ...(options.headers || {}),
  };
  if (ifNoneMatchStar) {
    headers['If-None-Match'] = '*';
  }

  // webdav putFileContents uses overwrite flag (client-side) + server-side conditional header
  await putFileContentsAdvanced(normalized, buf, {
    overwrite: ifNoneMatchStar ? false : overwrite,
    headers,
  });
}

async function deletePath(p) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    try {
      await fsp.rm(local, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return;
  }
  try {
    await deleteFile(normalized);
  } catch {
    // ignore
  }
}

/**
 * Create directory safely (check existence before creating, retry on failure)
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
async function ensureDirSafe(dirPath) {
  const normalizedPath = normalizeWebdavPath(dirPath);
  try {
    // Check if directory exists
    const dirExists = await exists(normalizedPath);
    if (!dirExists) {
      // Create directory
      await ensureDir(normalizedPath);
    }
  } catch (error) {
    // Attempt to create directory even on error
    try {
      await ensureDir(normalizedPath);
    } catch (e) {
      // Ignore directory creation failure (may already exist)
    }
  }
}

async function listDir(dirPath) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(dirPath);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    try {
      const entries = await fsp.readdir(local, { withFileTypes: true });
      return entries.map((ent) => ({
        basename: ent.name,
        type: ent.isDirectory() ? 'directory' : 'file',
      }));
    } catch (e) {
      // spec 2.6: EACCES etc permission denied → throw; upstream returns 403
      if (e?.code === 'EACCES' || e?.code === 'EPERM') {
        const err = new Error(e.message || 'Permission denied');
        err.code = e.code;
        err.status = 403;
        throw err;
      }
      return [];
    }
  }

  const items = await listDirectory(normalized);
  return items.map((it) => ({
    basename: it.basename,
    type: it.type,
  }));
}

module.exports = {
  getBackend,
  isSqliteBackend,
  getFsBaseDir,
  getPgPool,
  withTransaction,
  closePgPool,
  getSqliteConnection,
  sqliteQuery,
  sqliteRun,
  withSqliteTransaction,
  closeSqliteDb,
  ensureDir,
  ensureDirSafe,
  exists,
  readFile,
  writeFile,
  deletePath,
  listDir,
};

