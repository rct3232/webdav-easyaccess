'use strict';

/**
 * Backend-neutral DB helpers for server tests.
 *
 * Test setup/assertions should use dbQuery()/dbRun() instead of reaching into
 * SQLite-specific helpers (storage.sqliteQuery/sqliteRun). The helpers dispatch
 * to the active backend (storage.getBackend()):
 *   - SQLite:     storage.sqliteQuery / storage.sqliteRun
 *   - PostgreSQL: storage.getPgPool().query with ? → $n placeholder conversion
 *
 * PostgreSQL differs from SQLite in two ways that these helpers paper over:
 *   1. Parameter placeholders are `$1`, `$2`, ... instead of `?`.
 *   2. sqliteRun returns { changes, lastID }; pg returns { rowCount, rows }.
 *      For single-column-PK tables dbRun() appends `RETURNING <pk>` to INSERT
 *      statements so lastID keeps working. Composite-PK tables (e.g. settings,
 *      filecache, node_ancestors) get no RETURNING — lastID is undefined.
 */
const storage = require('../store/storage');

// Convert ? placeholders to $1, $2, ... (skipping ? inside single-quoted
// string literals). Only used for the PostgreSQL branch.
function convertPlaceholders(sql) {
  let out = '';
  let index = 0;
  let inQuote = false;
  for (const ch of sql) {
    if (ch === "'") inQuote = !inQuote;
    if (ch === '?' && !inQuote) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

const pgPrimaryKeyCache = new Map();

async function getPgPrimaryKeyColumn(table) {
  if (pgPrimaryKeyCache.has(table)) return pgPrimaryKeyCache.get(table);
  const pool = storage.getPgPool();
  const { rows } = await pool.query(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a
         ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
        AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [table]
  );
  // Only a single-column primary key yields a usable lastID.
  const column = rows.length === 1 ? rows[0].column_name : null;
  pgPrimaryKeyCache.set(table, column);
  return column;
}

async function pgQuery(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const result = await storage.getPgPool().query(pgSql, params);
  return { rows: result.rows || [] };
}

async function pgRun(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  let runSql = pgSql;
  const insertMatch = /^\s*INSERT\s+INTO\s+([^\s(]+)/i.exec(pgSql);
  if (insertMatch && !/RETURNING/i.test(pgSql)) {
    const pk = await getPgPrimaryKeyColumn(insertMatch[1]);
    if (pk) runSql = `${pgSql} RETURNING ${pk}`;
  }
  const result = await storage.getPgPool().query(runSql, params);
  const lastID =
    result.rows && result.rows[0] ? result.rows[0][Object.keys(result.rows[0])[0]] : undefined;
  return { changes: result.rowCount, lastID };
}

/**
 * Run a SELECT (or any read) and return { rows }.
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<{ rows: Array<Object> }>}
 */
async function dbQuery(sql, params = []) {
  if (storage.getBackend() === 'sqlite') {
    return storage.sqliteQuery(sql, params);
  }
  return pgQuery(sql, params);
}

/**
 * Run a write statement and return { changes, lastID }.
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<{ changes: number, lastID?: number }>}
 */
async function dbRun(sql, params = []) {
  if (storage.getBackend() === 'sqlite') {
    return storage.sqliteRun(sql, params);
  }
  return pgRun(sql, params);
}

/**
 * TRUNCATE every public table (RESTART IDENTITY CASCADE) so each suite starts
 * from a clean slate. The migration-tracking table is preserved.
 * @returns {Promise<void>}
 */
async function truncateAllTables() {
  const pool = storage.getPgPool();
  const { rows } = await pool.query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> '_schema_migrations'`
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => r.tablename).join(', ');
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

module.exports = {
  dbQuery,
  dbRun,
  truncateAllTables,
};
