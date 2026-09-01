'use strict';

/**
 * Metadata DB migration engine (sqlite <-> postgresql).
 *
 * Operates on direct connections (pg.Client for PostgreSQL, sqlite3.Database
 * for SQLite) following the probePostgresql pattern in
 * server/infrastructure/backendProbe.js — it never touches the app's own
 * metadata adapter/store layer, which is bound to the active backend. The
 * active backend is only ever read (the source); the target is only ever
 * written.
 *
 * A migration runs in ONE target transaction:
 *
 *   BEGIN
 *     [schema apply to the explicit target if missing]   (D6)
 *     [wipe all copyable tables if wipeTarget]           (D5)
 *     copy users -> file_nodes -> object_map/filecache/node_ancestors
 *       -> permissions_* -> share_links/recent_files/permission_requests
 *       -> locks -> settings                              (FK order)
 *     sequence resync (setval / sqlite_sequence)
 *   COMMIT  (or ROLLBACK on error/cancel)
 *
 * Cancellation (isCancelled) checked between tables and between batches of a
 * large table -> ROLLBACK, both sides unharmed (D4).
 *
 * See docs/spec/server/services/metadataMigrationService.md and PLAN.md (D4-D6).
 */

const path = require('path');

const schemaManager = require('../../../infrastructure/schemaManager');
const { initSqliteSchema } = require('../../../infrastructure/sqliteSchemaInit');
const { hasEncryptedRows } = require('../../../utils/configEncryption');

// Copy order = FK dependency order (matches docs/spec §2.7).
const COPY_ORDER = [
  'users',
  'file_nodes',
  'object_map',
  'filecache',
  'node_ancestors',
  'permissions_user_paths',
  'permissions_user_files',
  'permissions_shares',
  'share_links',
  'recent_files',
  'permission_requests',
  'locks',
  'settings',
];

// Wipe order = children before parents (FK-safe for DELETE-based sqlite wipes).
const WIPE_ORDER = [
  'permission_requests',
  'permissions_shares',
  'permissions_user_files',
  'permissions_user_paths',
  'share_links',
  'recent_files',
  'node_ancestors',
  'locks',
  'object_map',
  'filecache',
  'settings',
  'file_nodes',
  'users',
];

// Columns used for a deterministic batch ORDER BY (the primary key).
const TABLE_ORDER_BY = {
  users: ['id'],
  file_nodes: ['id'],
  object_map: ['id'],
  filecache: ['file_node_id'],
  node_ancestors: ['ancestor_id', 'descendant_id'],
  permissions_user_paths: ['user_id', 'file_node_id'],
  permissions_user_files: ['user_id', 'file_node_id'],
  permissions_shares: ['token'],
  share_links: ['token'],
  recent_files: ['user_id', 'file_node_id'],
  permission_requests: ['id'],
  locks: ['lock_name_hash'],
  settings: ['key'],
};

// BIGSERIAL tables whose target sequences must be resynced after explicit-id
// inserts (users, file_nodes, permission_requests).
const SERIAL_ID_TABLES = ['users', 'file_nodes', 'permission_requests'];

// users.is_admin is the only BOOLEAN column in the schema
// (server/store/postgresql/ddl/001_initial_normalized_schema.sql).
const BOOLEAN_COLUMNS = { users: ['is_admin'] };

const BATCH_SIZE = 500;
const VALID_DIRECTIONS = ['sqliteToPostgresql', 'postgresqlToSqlite'];

class MigrationCancelledError extends Error {
  constructor() {
    super('Metadata migration cancelled');
    this.name = 'MigrationCancelledError';
  }
}

// Mirrors storage.getSqliteConnection()'s default path
// (server/store/storage.js) but resolved from this file's location.
function defaultSqlitePath() {
  return process.env.WEA_SQLITE_PATH || path.join(__dirname, '../../../../data/webdav.db');
}

// Resolve PG connection config from an explicit payload or the WEA_PG_* env
// (mirrors storage.resolvePgConfig, which is not exported).
function resolvePgConfig(pg) {
  if (!pg) {
    const required = [
      'WEA_PG_HOST',
      'WEA_PG_PORT',
      'WEA_PG_DATABASE',
      'WEA_PG_USER',
      'WEA_PG_PASSWORD',
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`PostgreSQL is not configured; missing env: ${missing.join(', ')}`);
    }
    return {
      host: process.env.WEA_PG_HOST,
      port: Number(process.env.WEA_PG_PORT) || 5432,
      database: process.env.WEA_PG_DATABASE,
      user: process.env.WEA_PG_USER,
      password: process.env.WEA_PG_PASSWORD,
      connectionTimeoutMillis: Number(process.env.WEA_PG_CONNECTION_TIMEOUT_MS) || 5000,
      ssl: ['1', 'true', 'yes', 'on'].includes((process.env.WEA_PG_SSL || '').trim().toLowerCase())
        ? { rejectUnauthorized: false }
        : false,
    };
  }

  const required = ['host', 'port', 'database', 'user', 'password'];
  for (const key of required) {
    if (pg[key] == null || String(pg[key]).trim() === '') {
      throw new Error(`metadataMigrationService: missing pg.${key}`);
    }
  }
  return {
    host: String(pg.host),
    port: Number(pg.port) || 5432,
    database: String(pg.database),
    user: String(pg.user),
    password: String(pg.password),
    connectionTimeoutMillis: 5000,
    ssl: pg.ssl ? { rejectUnauthorized: false } : false,
  };
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// Convert ? placeholders to $1, $2, ... (skipping ? inside single-quoted
// string literals). Mirrors server/testing/dbUtils.js convertPlaceholders.
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

function pgExec(client) {
  return {
    query: (sql, params = []) =>
      client
        .query(sql, params)
        .then((result) => ({ rows: result.rows || [], rowCount: result.rowCount })),
    run: (sql, params = []) =>
      client.query(sql, params).then((result) => ({ changes: result.rowCount, lastID: undefined })),
  };
}

function sqliteExec(db) {
  return {
    query: (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve({ rows: rows || [] })));
      }),
    run: (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        });
      }),
  };
}

async function openPgClient(config) {
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (error) {
    throw new Error('pg module unavailable');
  }
  const client = new Client(config);
  await client.connect();
  return client;
}

async function openSqliteDatabase(dbPath, { readonly = false } = {}) {
  const sqlite3 = require('sqlite3');
  return new Promise((resolve, reject) => {
    const db = readonly
      ? new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) =>
          err ? reject(err) : resolve(db)
        )
      : new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function closeSqliteDatabase(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function pgTableExists(exec, name) {
  const { rows } = await exec.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function sqliteTableExists(exec, name) {
  const { rows } = await exec.query(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name]
  );
  return rows.length > 0;
}

async function targetSchemaExists(targetBackend, targetExec) {
  for (const name of ['users', 'settings']) {
    const exists =
      targetBackend === 'postgresql'
        ? await pgTableExists(targetExec, name)
        : await sqliteTableExists(targetExec, name);
    if (exists) return true;
  }
  return false;
}

async function countRows(sourceBackend, sourceExec, table) {
  const { rows } = await sourceExec.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`);
  return Number(rows[0].count);
}

async function getColumns(sourceBackend, sourceExec, table) {
  if (sourceBackend === 'postgresql') {
    const { rows } = await sourceExec.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table]
    );
    return rows.map((r) => r.column_name);
  }
  const { rows } = await sourceExec.query(`PRAGMA table_info(${quoteIdent(table)})`);
  return rows.map((r) => r.name);
}

async function selectBatch(sourceBackend, sourceExec, table, columns, orderBy, offset) {
  const colSql = columns.map(quoteIdent).join(', ');
  const orderSql = orderBy.map(quoteIdent).join(', ');
  const sql = `SELECT ${colSql} FROM ${quoteIdent(table)} ORDER BY ${orderSql} LIMIT ? OFFSET ?`;
  const params = [BATCH_SIZE, offset];
  const { rows } = await sourceExec.query(
    sourceBackend === 'postgresql' ? convertPlaceholders(sql) : sql,
    params
  );
  return rows;
}

async function insertBatch(targetBackend, targetExec, table, columns, rows) {
  if (rows.length === 0) return 0;
  const colSql = columns.map(quoteIdent).join(', ');
  const valueGroup = `(${columns.map(() => '?').join(', ')})`;
  const sql = `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES ${rows
    .map(() => valueGroup)
    .join(', ')}`;
  const params = [];
  for (const row of rows) {
    for (const col of columns) params.push(row[col]);
  }
  await targetExec.run(targetBackend === 'postgresql' ? convertPlaceholders(sql) : sql, params);
  return rows.length;
}

// Per-row column transforms for the two backend storage differences:
//   settings.value — JSON-string (PG) <-> raw TEXT (sqlite)
//   users.is_admin — real BOOLEAN (PG) <-> INTEGER 0/1 (sqlite)
//   timestamps     — pass through as strings (PG Date -> ISO string)
function transformRow(row, { table, direction, targetBackend }) {
  const out = { ...row };

  if (table === 'settings') {
    if (direction === 'sqliteToPostgresql') {
      out.value = JSON.stringify(String(row.value));
    } else {
      const value = row.value;
      out.value =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    }
  } else {
    const boolCols = BOOLEAN_COLUMNS[table];
    if (boolCols) {
      for (const col of boolCols) {
        const value = row[col];
        if (value == null) continue;
        if (targetBackend === 'postgresql') {
          out[col] = value === true || value === 1 || value === '1';
        } else {
          out[col] = value === true || value === 1 || value === '1' ? 1 : 0;
        }
      }
    }
  }

  // Timestamps arrive as JS Date from node-pg; pass them through as strings
  // (applies to settings.updated_at too).
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) out[key] = out[key].toISOString();
  }

  return out;
}

async function copyTable(ctx, table, doneSoFar) {
  const total = ctx.totals[table];
  if (total === 0) return 0;

  const columns = await getColumns(ctx.sourceBackend, ctx.sourceExec, table);
  const orderBy = TABLE_ORDER_BY[table] || columns.slice(0, 1);

  let offset = 0;
  let copied = 0;
  while (offset < total) {
    if (ctx.isCancelled()) throw new MigrationCancelledError();
    const rows = await selectBatch(
      ctx.sourceBackend,
      ctx.sourceExec,
      table,
      columns,
      orderBy,
      offset
    );
    const transformed = rows.map((row) =>
      transformRow(row, { table, direction: ctx.direction, targetBackend: ctx.targetBackend })
    );
    await insertBatch(ctx.targetBackend, ctx.targetExec, table, columns, transformed);
    copied += rows.length;
    offset += rows.length;
    ctx.emit('copy', table, doneSoFar + copied, ctx.grandTotal);
  }
  return copied;
}

async function wipeTargetTables(targetBackend, targetExec) {
  if (targetBackend === 'postgresql') {
    const tableList = WIPE_ORDER.map(quoteIdent).join(', ');
    await targetExec.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  } else {
    for (const table of WIPE_ORDER) {
      await targetExec.run(`DELETE FROM ${quoteIdent(table)}`);
    }
  }
}

async function resyncSequences(targetBackend, targetExec) {
  for (const table of SERIAL_ID_TABLES) {
    const maxRow = await targetExec.query(
      `SELECT COALESCE(MAX(id), 0) AS max_id FROM ${quoteIdent(table)}`
    );
    const maxId = Number(maxRow.rows[0].max_id);
    if (maxId <= 0) continue;

    if (targetBackend === 'postgresql') {
      await targetExec.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2)`, [table, maxId]);
    } else {
      // AUTOINCREMENT already bumps sqlite_sequence on explicit-id inserts, so
      // this is a defensive resync for stale/missing rows after a DELETE wipe.
      const res = await targetExec.run('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', [
        maxId,
        table,
      ]);
      if (res.changes === 0) {
        await targetExec.run('INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)', [
          table,
          maxId,
        ]);
      }
    }
  }
}

async function sourceHasEncryptedRows(sourceBackend, sourceExec) {
  try {
    const { rows } = await sourceExec.query('SELECT key, value FROM settings');
    return hasEncryptedRows(rows);
  } catch {
    return false;
  }
}

async function buildScanResult(backend, tables) {
  const schemaExists = tables.some((t) => t.name === 'users' || t.name === 'settings');
  return {
    backend,
    connected: true,
    schemaExists,
    tables,
    totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
    checkedAt: new Date().toISOString(),
  };
}

async function scanPostgresTarget(client) {
  const exec = pgExec(client);
  const tables = [];
  for (const name of COPY_ORDER) {
    if (!(await pgTableExists(exec, name))) continue;
    tables.push({ name, rows: await countRows('postgresql', exec, name) });
  }
  return buildScanResult('postgresql', tables);
}

async function scanSqliteTarget(exec) {
  const tables = [];
  for (const name of COPY_ORDER) {
    if (!(await sqliteTableExists(exec, name))) continue;
    tables.push({ name, rows: await countRows('sqlite', exec, name) });
  }
  return buildScanResult('sqlite', tables);
}

function createMetadataMigrationService(deps = {}) {
  const pgConnectionProvider = deps.pgConnectionProvider || openPgClient;
  const sqliteFactory = deps.sqliteFactory || openSqliteDatabase;

  function emit(onProgress, stage, table, done, total) {
    if (typeof onProgress === 'function') onProgress(stage, table, done, total);
  }

  async function openSource(sourceBackend, source) {
    if (sourceBackend === 'postgresql') {
      return pgConnectionProvider(resolvePgConfig(source && source.pg));
    }
    const dbPath = (source && source.sqlitePath) || defaultSqlitePath();
    return sqliteFactory(dbPath, { readonly: true });
  }

  async function openTarget(targetBackend, target) {
    if (targetBackend === 'postgresql') {
      return pgConnectionProvider(resolvePgConfig(target.pg));
    }
    const dbPath = (target && target.sqlitePath) || defaultSqlitePath();
    return sqliteFactory(dbPath, { readonly: false });
  }

  async function closeSource(sourceBackend, conn) {
    if (sourceBackend === 'postgresql') await conn.end();
    else await closeSqliteDatabase(conn);
  }

  async function closeTarget(targetBackend, conn) {
    if (targetBackend === 'postgresql') await conn.end();
    else await closeSqliteDatabase(conn);
  }

  /**
   * Read-only scan of an explicit target backend.
   *
   * @param {{ backend: 'postgresql'|'sqlite', pg?: object, sqlitePath?: string }} args
   * @returns {Promise<{ backend, connected, schemaExists, tables: [{name, rows}], totalRows, checkedAt }>}
   */
  async function scanTarget({ backend, pg, sqlitePath }) {
    if (backend === 'postgresql') {
      const client = await pgConnectionProvider(resolvePgConfig(pg));
      try {
        return await scanPostgresTarget(client);
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (backend === 'sqlite') {
      const db = await sqliteFactory(sqlitePath || defaultSqlitePath(), { readonly: true });
      try {
        return await scanSqliteTarget(sqliteExec(db));
      } finally {
        await closeSqliteDatabase(db).catch(() => {});
      }
    }
    throw new Error(`metadataMigrationService: unsupported backend '${backend}'`);
  }

  /**
   * Single-transaction metadata migration.
   *
   * @param {{
   *   direction: 'sqliteToPostgresql'|'postgresqlToSqlite',
   *   source?: { pg?: object, sqlitePath?: string },
   *   target: { backend: 'postgresql'|'sqlite', pg?: object, sqlitePath?: string },
   *   wipeTarget?: boolean,
   *   onProgress?: (stage: string, table: string|null, done: number, total: number) => void,
   *   isCancelled?: () => boolean,
   * }} args
   * @returns {Promise<{ status: 'completed', tablesCopied: [{name, rows}], totalRows, schemaApplied, wiped, warning? } | { status: 'cancelled' }>}
   */
  async function runMigration({
    direction,
    source = {},
    target,
    wipeTarget = false,
    onProgress = () => {},
    isCancelled = () => false,
  }) {
    if (!VALID_DIRECTIONS.includes(direction)) {
      throw new Error(`metadataMigrationService: invalid direction '${direction}'`);
    }
    if (!target || !target.backend) {
      throw new Error('metadataMigrationService: target.backend is required');
    }
    const sourceBackend = direction === 'sqliteToPostgresql' ? 'sqlite' : 'postgresql';
    const targetBackend = target.backend;
    if (sourceBackend === targetBackend) {
      throw new Error('metadataMigrationService: source and target backends must differ');
    }

    const sourceConn = await openSource(sourceBackend, source);
    let targetConn;
    try {
      targetConn = await openTarget(targetBackend, target);
    } catch (error) {
      await closeSource(sourceBackend, sourceConn).catch(() => {});
      throw error;
    }

    try {
      const runSteps = async (targetExec) => {
        const sourceExec =
          sourceBackend === 'postgresql' ? pgExec(sourceConn) : sqliteExec(sourceConn);

        // --- scan: per-source-table COUNT(*) pre-aggregation for progress ---
        emit(onProgress, 'scan', null, 0, 0);
        const totals = {};
        let grandTotal = 0;
        for (const table of COPY_ORDER) {
          totals[table] = await countRows(sourceBackend, sourceExec, table);
          grandTotal += totals[table];
        }
        if (isCancelled()) throw new MigrationCancelledError();

        // --- schema apply to the explicit target (D6) ---
        let schemaApplied = false;
        if (!(await targetSchemaExists(targetBackend, targetExec))) {
          emit(onProgress, 'schema', null, 0, grandTotal);
          await applySchema(targetBackend, targetConn);
          schemaApplied = true;
        }

        // --- wipe inside the same transaction (D5) ---
        let wiped = false;
        if (wipeTarget) {
          emit(onProgress, 'wipe', null, 0, grandTotal);
          await wipeTargetTables(targetBackend, targetExec);
          wiped = true;
        }

        // --- copy in FK order ---
        emit(onProgress, 'copy', null, 0, grandTotal);
        const tablesCopied = [];
        const ctx = {
          sourceBackend,
          sourceExec,
          targetBackend,
          targetExec,
          direction,
          totals,
          grandTotal,
          emit: (stage, table, done, total) => emit(onProgress, stage, table, done, total),
          isCancelled,
        };

        let done = 0;
        let totalRows = 0;
        for (const table of COPY_ORDER) {
          if (isCancelled()) throw new MigrationCancelledError();
          const rows = await copyTable(ctx, table, done);
          tablesCopied.push({ name: table, rows });
          done += rows;
          totalRows += rows;
        }

        // --- sequence resync (setval / sqlite_sequence) ---
        await resyncSequences(targetBackend, targetExec);

        // --- encrypt_secret_key warning (spec §2.11) ---
        const hasEncrypted = await sourceHasEncryptedRows(sourceBackend, sourceExec);
        const warning =
          hasEncrypted && !process.env.encrypt_secret_key ? 'encryptSecretKeyMissing' : undefined;

        emit(onProgress, 'done', null, grandTotal, grandTotal);
        return { status: 'completed', tablesCopied, totalRows, schemaApplied, wiped, warning };
      };

      return await runInTargetTransaction(targetBackend, targetConn, runSteps);
    } finally {
      await closeSource(sourceBackend, sourceConn).catch(() => {});
      await closeTarget(targetBackend, targetConn).catch(() => {});
    }
  }

  async function applySchema(targetBackend, targetConn) {
    if (targetBackend === 'postgresql') {
      await schemaManager.applyPendingMigrations('postgresql', { pgClient: targetConn });
    } else {
      await initSqliteSchema({ connection: targetConn });
    }
  }

  async function runInTargetTransaction(targetBackend, conn, runSteps) {
    if (targetBackend === 'postgresql') {
      const exec = pgExec(conn);
      await conn.query('BEGIN');
      try {
        const result = await runSteps(exec);
        if (result.status === 'cancelled') await conn.query('ROLLBACK');
        else await conn.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await conn.query('ROLLBACK');
        } catch {
          // ignore rollback errors and surface the original failure
        }
        if (error instanceof MigrationCancelledError) return { status: 'cancelled' };
        throw error;
      }
    }

    // sqlite: defer_foreign_keys + foreign_keys must be set before BEGIN.
    const exec = sqliteExec(conn);
    await exec.run('PRAGMA defer_foreign_keys = ON');
    await exec.run('PRAGMA foreign_keys = ON');
    await exec.run('BEGIN');
    try {
      const result = await runSteps(exec);
      if (result.status === 'cancelled') await exec.run('ROLLBACK');
      else await exec.run('COMMIT');
      return result;
    } catch (error) {
      try {
        await exec.run('ROLLBACK');
      } catch {
        // ignore rollback errors and surface the original failure
      }
      if (error instanceof MigrationCancelledError) return { status: 'cancelled' };
      throw error;
    }
  }

  return { scanTarget, runMigration };
}

let serviceSingleton = null;

/**
 * Process-wide singleton. The migration gate/worker (route layer) uses this.
 * @returns {ReturnType<typeof createMetadataMigrationService>}
 */
function getService() {
  if (!serviceSingleton) serviceSingleton = createMetadataMigrationService();
  return serviceSingleton;
}

module.exports = { createMetadataMigrationService, getService };
