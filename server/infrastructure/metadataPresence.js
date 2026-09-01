'use strict';

/**
 * Passive metadata-presence detector (PLAN D13, docs/spec/server/tools/
 * metadata-migration.md §4). Detects whether the NON-active metadata backend
 * holds metadata (settings/users) so System Settings can render the
 * ".env setup needed" banner. Never throws to the caller — it is a passive
 * detector; connection/query failures are surfaced as `error` in the result.
 */

const fs = require('fs');
const path = require('path');

const { getBackend } = require('../store/storage');

const CACHE_TTL_MS = 60_000;
const SETTINGS_TABLE = 'settings';
const DEFAULT_SQLITE_PATH = path.join(__dirname, '../../data/webdav.db');

let cache = { key: null, checkedAt: 0, result: null };

/** The backend that is NOT the active metadata backend. */
function getOtherBackend() {
  return getBackend() === 'postgresql' ? 'sqlite' : 'postgresql';
}

function parseBooleanEnv(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseNumberEnv(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Resolve the PostgreSQL connection from env. Mirrors storage.js
 * `resolvePgConfig` (same WEA_PG_* keys + defaults); the storage module does
 * not export it and it must not be modified for this passive detector.
 */
function resolvePgConfigFromEnv() {
  const requiredKeys = [
    'WEA_PG_HOST',
    'WEA_PG_PORT',
    'WEA_PG_DATABASE',
    'WEA_PG_USER',
    'WEA_PG_PASSWORD',
  ];
  const missing = requiredKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const error = new Error(`PostgreSQL is not configured (missing ${missing.join(', ')})`);
    error.code = 'postgresql_not_configured';
    throw error;
  }

  return {
    host: process.env.WEA_PG_HOST,
    port: parseNumberEnv(process.env.WEA_PG_PORT, 5432),
    database: process.env.WEA_PG_DATABASE,
    user: process.env.WEA_PG_USER,
    password: process.env.WEA_PG_PASSWORD,
    ssl: parseBooleanEnv(process.env.WEA_PG_SSL) ? { rejectUnauthorized: false } : false,
  };
}

/**
 * Probe PostgreSQL with a direct pg.Client (mirrors probePostgresql's
 * direct-client approach, backendProbe.js). Returns `{ otherHasData, rows }`
 * or `{ error }` — never throws.
 */
async function detectPostgresPresence() {
  let client;
  try {
    let Client;
    try {
      ({ Client } = require('pg'));
    } catch (error) {
      return { error: `pg module unavailable: ${error.message}` };
    }

    const config = resolvePgConfigFromEnv();
    client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      connectionTimeoutMillis: 5000,
    });

    await client.connect();
    const reg = await client.query(
      `SELECT to_regclass('public.${SETTINGS_TABLE}') AS relation`
    );
    if (!reg.rows[0] || !reg.rows[0].relation) {
      return { otherHasData: false, rows: null };
    }
    const count = await client.query(`SELECT COUNT(*) AS count FROM ${SETTINGS_TABLE}`);
    const rows = Number(count.rows[0] && count.rows[0].count) || 0;
    return { otherHasData: rows > 0, rows };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

/**
 * Probe SQLite with a fresh sqlite3.Database (closed afterwards so the app's
 * cached handle is never touched). Returns `{ otherHasData, rows }` or
 * `{ error }` — never throws. When the file does not exist no DB is opened
 * (opening would create an empty file on a PostgreSQL deployment).
 */
async function detectSqlitePresence() {
  const dbPath = process.env.WEA_SQLITE_PATH || DEFAULT_SQLITE_PATH;
  if (!fs.existsSync(dbPath)) {
    return { otherHasData: false, rows: null };
  }

  let sqlite3;
  try {
    sqlite3 = require('sqlite3').verbose();
  } catch (error) {
    return { error: `sqlite3 module unavailable: ${error.message}` };
  }

  const db = new sqlite3.Database(dbPath);
  try {
    const table = await new Promise((resolve, reject) => {
      db.get(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [SETTINGS_TABLE],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
    if (!table) return { otherHasData: false, rows: null };
    const countRow = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) AS count FROM ${SETTINGS_TABLE}`, (err, row) =>
        err ? reject(err) : resolve(row)
      );
    });
    const rows = Number(countRow && countRow.count) || 0;
    return { otherHasData: rows > 0, rows };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

function toPresenceResult(backend, { otherHasData, rows, error }) {
  const result = {
    otherBackend: backend,
    otherHasData: Boolean(otherHasData),
    settingsRows: rows === undefined || rows === null ? null : rows,
    checkedAt: new Date().toISOString(),
  };
  if (error) result.error = error;
  return result;
}

/**
 * Detect metadata presence in the non-active backend with a short TTL cache
 * keyed by the active backend (avoids DB I/O on every request).
 */
async function checkMetadataPresence() {
  const backend = getOtherBackend();
  const cacheKey = `metadataPresence:${getBackend()}`;
  const now = Date.now();

  if (cache.key === cacheKey && cache.result && now - cache.checkedAt < CACHE_TTL_MS) {
    return { ...cache.result };
  }

  const detected =
    backend === 'postgresql' ? await detectPostgresPresence() : await detectSqlitePresence();
  const result = toPresenceResult(backend, detected);
  cache = { key: cacheKey, checkedAt: now, result };
  return { ...result };
}

/** Test hook: drop the TTL cache. */
function clearPresenceCache() {
  cache = { key: null, checkedAt: 0, result: null };
}

module.exports = {
  getOtherBackend,
  checkMetadataPresence,
  clearPresenceCache,
};
