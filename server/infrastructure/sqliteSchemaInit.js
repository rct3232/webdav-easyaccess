#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const storage = require('../store/storage');

const DDL_DIR = path.join(__dirname, '../store/postgresql/ddl');

function convertPostgresToSqlite(ddl) {
  let sql = ddl;

  sql = sql.replace(/BEGIN\s*;/gi, '');
  sql = sql.replace(/COMMIT\s*;/gi, '');

  sql = sql.replace(/BIGSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  sql = sql.replace(/BIGSERIAL/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  sql = sql.replace(/\bBIGINT\b/gi, 'INTEGER');
  sql = sql.replace(/TIMESTAMPTZ/gi, 'TEXT');
  sql = sql.replace(/JSONB/gi, 'TEXT');
  sql = sql.replace(/BOOLEAN/gi, 'INTEGER');

  sql = sql.replace(/DEFAULT\s+NOW\(\)/gi, 'DEFAULT CURRENT_TIMESTAMP');
  sql = sql.replace(/DEFAULT\s+FALSE/gi, 'DEFAULT 0');
  sql = sql.replace(/DEFAULT\s+TRUE/gi, 'DEFAULT 1');

  return sql;
}

function splitStatements(sql) {
  const statements = [];
  let current = '';

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('--')) continue;

    current += trimmed + '\n';

    if (trimmed.endsWith(';')) {
      statements.push(current.trim().slice(0, -1));
      current = '';
    }
  }

  return statements.filter((s) => s.length > 0);
}

// Run every DDL statement serially on the supplied node:sqlite connection.
// DatabaseSync executes synchronously, so the sqlite3-npm-era db.serialize()
// guard against statement/close interleaving is no longer needed.
function runStatementsOn(db, statements) {
  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[init-sqlite-schema] Failed to execute: ${statement.slice(0, 80)}...`,
        err.message
      );
      throw err;
    }
  }
  return Promise.resolve();
}

function openDatabaseAt(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  return DatabaseSync(dbPath);
}

function closeDatabase(db) {
  try {
    db.close();
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Apply the converted sqlite DDL.
 *
 * - `initSqliteSchema()` — unchanged behavior: applies to the active backend
 *   connection (storage.getSqliteConnection()).
 * - `initSqliteSchema({ connection })` — applies to a caller-supplied
 *   node:sqlite DatabaseSync connection (e.g. a migration-target connection).
 *   The caller owns the connection lifecycle.
 * - `initSqliteSchema({ path })` — opens a temporary database at `path`,
 *   applies the DDL, then closes it.
 *
 * @param {{ connection?: object, path?: string }} [options]
 * @returns {Promise<{ connection: object }>}
 */
async function initSqliteSchema(options = {}) {
  const files = (await fs.readdir(DDL_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const contents = await Promise.all(files.map((f) => fs.readFile(path.join(DDL_DIR, f), 'utf8')));
  const ddlSource = contents.join('\n');
  const sqliteDdl = convertPostgresToSqlite(ddlSource);

  const connection = (options && options.connection) || null;
  const dbPath = (options && options.path) || null;

  let db = connection;
  let owned = false;
  if (!db) {
    if (dbPath) {
      db = await openDatabaseAt(dbPath);
      db.exec('PRAGMA foreign_keys = ON');
      owned = true;
    } else {
      db = storage.getSqliteConnection();
    }
  }

  const statements = splitStatements(sqliteDdl);
  await runStatementsOn(db, statements);

  if (owned) {
    await closeDatabase(db);
  } else if (!connection) {
    // eslint-disable-next-line no-console
    console.log('[init-sqlite-schema] Schema initialized successfully');
  }

  return { connection: db };
}

module.exports = { initSqliteSchema, convertPostgresToSqlite };
