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

// Run every DDL statement serially on the supplied connection. Using
// db.serialize() guarantees the run() calls are queued in order, which
// prevents coverage instrumentation from interleaving a later statement
// with a close from another suite.
function runStatementsOn(db, statements) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      let index = 0;
      const next = () => {
        if (index >= statements.length) {
          finish();
          return;
        }
        const statement = statements[index];
        index += 1;
        db.run(statement, (err) => {
          if (err) {
            // eslint-disable-next-line no-console
            console.error(`[init-sqlite-schema] Failed to execute: ${statement.slice(0, 80)}...`, err.message);
            finish(err);
            return;
          }
          next();
        });
      };
      next();
    });
  });
}

function openDatabaseAt(dbPath) {
  const sqlite3 = require('sqlite3');
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Apply the converted sqlite DDL.
 *
 * - `initSqliteSchema()` — unchanged behavior: applies to the active backend
 *   connection (storage.getSqliteConnection()).
 * - `initSqliteSchema({ connection })` — applies to a caller-supplied
 *   sqlite3.Database (e.g. a migration-target connection). The caller owns the
 *   connection lifecycle.
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
      await new Promise((resolve, reject) => {
        db.run('PRAGMA foreign_keys = ON', (err) => (err ? reject(err) : resolve()));
      });
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
