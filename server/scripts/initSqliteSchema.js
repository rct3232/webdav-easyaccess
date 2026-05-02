#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const storage = require('../store/storage');

const DDL_PATH = path.join(__dirname, '../store/postgresql/ddl/001_initial_normalized_schema.sql');

function convertPostgresToSqlite(ddl) {
  let sql = ddl;

  sql = sql.replace(/BEGIN\s*;/gi, '');
  sql = sql.replace(/COMMIT\s*;/gi, '');

  sql = sql.replace(/BIGSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  sql = sql.replace(/BIGSERIAL/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
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

async function initSqliteSchema() {
  const ddlSource = await fs.readFile(DDL_PATH, 'utf8');
  const sqliteDdl = convertPostgresToSqlite(ddlSource);

  const db = storage.getSqliteConnection();
  const statements = splitStatements(sqliteDdl);

  for (const statement of statements) {
    await new Promise((resolve, reject) => {
      db.run(statement, (err) => {
        if (err) {
          // eslint-disable-next-line no-console
          console.error(`[init-sqlite-schema] Failed to execute: ${statement.slice(0, 80)}...`, err.message);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // eslint-disable-next-line no-console
  console.log('[init-sqlite-schema] Schema initialized successfully');
}

module.exports = { initSqliteSchema };
