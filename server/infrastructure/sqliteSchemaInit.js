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

async function initSqliteSchema() {
  const files = (await fs.readdir(DDL_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const contents = await Promise.all(files.map((f) => fs.readFile(path.join(DDL_DIR, f), 'utf8')));
  const ddlSource = contents.join('\n');
  const sqliteDdl = convertPostgresToSqlite(ddlSource);

  const db = storage.getSqliteConnection();
  const statements = splitStatements(sqliteDdl);

  // Run every DDL statement serially inside a single connection. Using
  // db.serialize() guarantees the run() calls are queued in order, which
  // prevents coverage instrumentation from interleaving a later statement
  // with a close from another suite.
  await new Promise((resolve, reject) => {
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

  // eslint-disable-next-line no-console
  console.log('[init-sqlite-schema] Schema initialized successfully');
}

module.exports = { initSqliteSchema, convertPostgresToSqlite };
