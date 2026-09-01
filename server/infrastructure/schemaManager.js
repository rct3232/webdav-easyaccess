#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const storage = require('../store/storage');
const { convertPostgresToSqlite } = require('./sqliteSchemaInit');

const DDL_DIR = path.join(__dirname, '../store/postgresql/ddl');

function computeChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
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

// DDL applied to an explicit PG client runs inside a caller-owned transaction,
// so the file's own BEGIN/COMMIT wrapper must be dropped (the boot path keeps
// the wrapper and relies on storage.withTransaction instead).
function stripTransactionWrapper(sql) {
  return sql.replace(/BEGIN\s*;/gi, '').replace(/COMMIT\s*;/gi, '');
}

function sqliteQueryOn(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve({ rows: rows || [] })));
  });
}

function sqliteRunOn(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// Resolve the PG executor: an explicit client wins; otherwise the active pool.
function resolvePgExecutor(options = {}) {
  return options.pgClient || storage.getPgPool();
}

// Resolve the sqlite executor: an explicit connection wins; otherwise the
// storage-backed helpers (which resolve the active connection internally).
function resolveSqliteExecutor(options = {}) {
  if (options.sqliteConnection) {
    return {
      query: (sql, params = []) => sqliteQueryOn(options.sqliteConnection, sql, params),
      run: (sql, params = []) => sqliteRunOn(options.sqliteConnection, sql, params),
    };
  }
  return { query: storage.sqliteQuery, run: storage.sqliteRun };
}

async function createMigrationTable(backend, options = {}) {
  const ddl = backend === 'postgresql'
    ? 'CREATE TABLE IF NOT EXISTS _schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), checksum TEXT NOT NULL)'
    : convertPostgresToSqlite('CREATE TABLE IF NOT EXISTS _schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), checksum TEXT NOT NULL)');

  if (backend === 'postgresql') {
    await resolvePgExecutor(options).query(ddl);
  } else {
    await resolveSqliteExecutor(options).run(ddl);
  }
}

async function isApplied(backend, filename, options = {}) {
  if (backend === 'postgresql') {
    const { rows } = await resolvePgExecutor(options).query(
      'SELECT 1 FROM _schema_migrations WHERE filename = $1',
      [filename]
    );
    return rows.length > 0;
  }

  const result = await resolveSqliteExecutor(options).query(
    'SELECT 1 FROM _schema_migrations WHERE filename = ?',
    [filename]
  );
  return result.rows && result.rows.length > 0;
}

async function recordMigration(backend, filename, checksum, options = {}) {
  if (backend === 'postgresql') {
    await resolvePgExecutor(options).query(
      'INSERT INTO _schema_migrations (filename, applied_at, checksum) VALUES ($1, NOW(), $2)',
      [filename, checksum]
    );
  } else {
    await resolveSqliteExecutor(options).run(
      'INSERT INTO _schema_migrations (filename, applied_at, checksum) VALUES (?, CURRENT_TIMESTAMP, ?)',
      [filename, checksum]
    );
  }
}

async function applyIfPending(backend, filename, options = {}) {
  const applied = await isApplied(backend, filename, options);
  if (applied) return;

  const filePath = path.join(DDL_DIR, filename);
  const content = await fs.readFile(filePath, 'utf8');
  const checksum = computeChecksum(content);

  let ddl = backend === 'sqlite' ? convertPostgresToSqlite(content) : content;

  if (backend === 'postgresql') {
    if (options.pgClient) {
      // Explicit target client: the caller owns the transaction, so the DDL
      // must not carry its own BEGIN/COMMIT wrapper.
      await options.pgClient.query(stripTransactionWrapper(ddl));
    } else {
      await storage.withTransaction(async (client) => {
        await client.query(ddl);
      });
    }
  } else {
    const sqlite = resolveSqliteExecutor(options);
    const statements = splitStatements(ddl);
    for (const stmt of statements) {
      if (!stmt || stmt.trim().length === 0) continue;
      await sqlite.run(stmt);
    }
  }

  await recordMigration(backend, filename, checksum, options);
}

/**
 * Apply pending DDL migrations.
 *
 * @param {'sqlite'|'postgresql'} backend
 * @param {object} [options]
 * @param {object} [options.pgClient] Explicit pg.Client to apply PG DDL to
 *   (caller owns the transaction). Defaults to the active backend pool.
 * @param {object} [options.sqliteConnection] Explicit sqlite connection to
 *   apply sqlite DDL to. Defaults to storage.getSqliteConnection().
 */
async function applyPendingMigrations(backend, options = {}) {
  await createMigrationTable(backend, options);

  const files = (await fs.readdir(DDL_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    await applyIfPending(backend, filename, options);
  }
}

module.exports = { applyPendingMigrations };
