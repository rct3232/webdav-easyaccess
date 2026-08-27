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

async function createMigrationTable(backend) {
  const ddl = backend === 'postgresql'
    ? 'CREATE TABLE IF NOT EXISTS _schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), checksum TEXT NOT NULL)'
    : convertPostgresToSqlite('CREATE TABLE IF NOT EXISTS _schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), checksum TEXT NOT NULL)');

  if (backend === 'postgresql') {
    const pool = storage.getPgPool();
    await pool.query(ddl);
  } else {
    const db = storage.getSqliteConnection();
    await new Promise((resolve, reject) => {
      db.run(ddl, (err) => (err ? reject(err) : resolve()));
    });
  }
}

async function isApplied(backend, filename) {
  if (backend === 'postgresql') {
    const pool = storage.getPgPool();
    const { rows } = await pool.query('SELECT 1 FROM _schema_migrations WHERE filename = $1', [filename]);
    return rows.length > 0;
  } else {
    const result = await storage.sqliteQuery(
      'SELECT 1 FROM _schema_migrations WHERE filename = ?',
      [filename]
    );
    return result.rows && result.rows.length > 0;
  }
}

async function recordMigration(backend, filename, checksum) {
  if (backend === 'postgresql') {
    const pool = storage.getPgPool();
    await pool.query(
      'INSERT INTO _schema_migrations (filename, applied_at, checksum) VALUES ($1, NOW(), $2)',
      [filename, checksum]
    );
  } else {
    await storage.sqliteRun(
      'INSERT INTO _schema_migrations (filename, applied_at, checksum) VALUES (?, CURRENT_TIMESTAMP, ?)',
      [filename, checksum]
    );
  }
}

async function applyIfPending(backend, filename) {
  const applied = await isApplied(backend, filename);
  if (applied) return;

  const filePath = path.join(DDL_DIR, filename);
  const content = await fs.readFile(filePath, 'utf8');
  const checksum = computeChecksum(content);

  let ddl = backend === 'sqlite' ? convertPostgresToSqlite(content) : content;

  if (backend === 'postgresql') {
    await storage.withTransaction(async (client) => {
      await client.query(ddl);
    });
  } else {
    const statements = splitStatements(ddl);
    for (const stmt of statements) {
      if (!stmt || stmt.trim().length === 0) continue;
      const db = storage.getSqliteConnection();
      await new Promise((resolve, reject) => {
        db.run(stmt, (err) => (err ? reject(err) : resolve()));
      });
    }
  }

  await recordMigration(backend, filename, checksum);
}

async function applyPendingMigrations(backend) {
  await createMigrationTable(backend);

  const files = (await fs.readdir(DDL_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    await applyIfPending(backend, filename);
  }
}

module.exports = { applyPendingMigrations };
