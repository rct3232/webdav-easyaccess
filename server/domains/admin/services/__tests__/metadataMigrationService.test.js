'use strict';

/**
 * Unit + roundtrip tests for the metadata DB migration engine
 * (docs/spec/server/services/metadataMigrationService.md).
 *
 * Black-box strategy:
 *  - postgresqlToSqlite: the source is a fake pg.Client; the target is a REAL
 *    sqlite file, so serialization/is_admin/FK-order/rollback/sequence resync
 *    are asserted on observable target DB state.
 *  - sqliteToPostgresql: the source is a REAL sqlite file; the target is a
 *    fake pg.Client, so PG-specific serialization (JSON-string settings.value,
 *    real booleans, setval) is asserted on the captured call log.
 *  - A real sqlite -> PG roundtrip runs only under test:ci:pg
 *    (WEA_STORAGE_BACKEND=postgresql), using a dedicated throwaway database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { initSqliteSchema } = require('../../../../infrastructure/sqliteSchemaInit');
const { createMetadataMigrationService } = require('../metadataMigrationService');
const { encryptSecret } = require('../../../../utils/configEncryption');

// ---------------------------------------------------------------------------
// Fake pg.Client: serves scripted source rows or captures target writes.
// ---------------------------------------------------------------------------

class FakePg {
  constructor({ schemaExists = false, tables = {}, columns = {}, failOnTable = null } = {}) {
    this.schemaExists = schemaExists;
    this.tables = tables;
    this.columns = columns;
    this.failOnTable = failOnTable;
    this.calls = [];
    this.transactions = [];
  }

  connect() {
    return Promise.resolve();
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params: params || [] });
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
      this.transactions.push(s);
      return { rows: [], rowCount: 0 };
    }
    if (/information_schema\.tables/.test(s)) {
      return { rows: this.schemaExists ? [{ table_name: params[0] }] : [], rowCount: 0 };
    }
    let m = s.match(/COUNT\(\*\) AS count FROM "([^"]+)"/);
    if (m) {
      const rows = this.tables[m[1]] || [];
      return { rows: [{ count: String(rows.length) }] };
    }
    m = s.match(/COALESCE\(MAX\(id\), 0\) AS max_id FROM "([^"]+)"/);
    if (m) {
      const rows = this.tables[m[1]] || [];
      const maxId = rows.reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0);
      return { rows: [{ max_id: String(maxId) }] };
    }
    if (/information_schema\.columns/.test(s)) {
      const table = params[0];
      const rows = this.tables[table] || [];
      const cols = this.columns[table] || (rows[0] ? Object.keys(rows[0]) : []);
      return { rows: cols.map((name, i) => ({ column_name: name, ordinal_position: i + 1 })) };
    }
    if (/FROM _schema_migrations/.test(s)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO _schema_migrations/.test(s)) return { rows: [], rowCount: 1 };
    if (/SELECT key, value FROM "?settings"?/.test(s)) {
      return { rows: this.tables.settings || [], rowCount: 0 };
    }
    m = s.match(/FROM "([^"]+)"/);
    if (m && /LIMIT/.test(s)) {
      if (this.failOnTable && m[1] === this.failOnTable) throw new Error(`boom on ${m[1]}`);
      const limit = Number(params[0] || 0);
      const offset = Number(params[1] || 0);
      const rows = (this.tables[m[1]] || []).slice(offset, offset + limit);
      return { rows, rowCount: rows.length };
    }
    if (/^INSERT INTO/.test(s)) {
      const count = Math.max(1, (s.match(/\(/g) || []).length - 1);
      return { rows: [], rowCount: count };
    }
    if (/TRUNCATE/.test(s)) return { rows: [], rowCount: 1 };
    if (/setval/.test(s)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }

  end() {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// SQLite helpers (bypass storage; direct file connections)
// ---------------------------------------------------------------------------

function openDb(dbPath, mode) {
  return new Promise((resolve, reject) => {
    if (mode === 'readonly') {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) =>
        err ? reject(err) : resolve(db)
      );
      return db;
    }
    const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function createSchemaDb(dbPath) {
  const db = await openDb(dbPath);
  await initSqliteSchema({ connection: db });
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, 'PRAGMA defer_foreign_keys = ON');
  return db;
}

function ts() {
  return '2026-01-01T00:00:00.000Z';
}

async function seedSourceData(db) {
  await run(db, `INSERT INTO users (id, username, email, email_hash, password, status, is_admin, token_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'approved', 1, 0, ?, ?)`, [1, 'admin', 'admin@x.com', 'h1', 'p1', ts(), ts()]);
  await run(db, `INSERT INTO users (id, username, email, email_hash, password, status, is_admin, token_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'approved', 0, 2, ?, ?)`, [2, 'user', 'user@x.com', 'h2', 'p2', ts(), ts()]);
  await run(db, `INSERT INTO file_nodes (id, parent_id, name, type, sync_status, created_at, updated_at) VALUES (?, NULL, 'root', 'directory', 'active', ?, ?)`, [1, ts(), ts()]);
  await run(db, `INSERT INTO file_nodes (id, parent_id, name, type, sync_status, created_at, updated_at) VALUES (?, ?, 'a.txt', 'file', 'active', ?, ?)`, [2, 1, ts(), ts()]);
  await run(db, `INSERT INTO object_map (id, file_node_id, s3_key, storage_backend, version_number, status, created_at) VALUES (?, ?, 'key-1', 's3', 1, 'active', ?)`, [1, 2, ts()]);
  await run(db, `INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at) VALUES (?, 10, 'text/plain', 'ch', ?)`, [2, ts()]);
  await run(db, `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (1, 1, 0)`);
  await run(db, `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (1, 2, 1)`);
  await run(db, `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (2, 2, 0)`);
  await run(db, `INSERT INTO permissions_user_paths (user_id, file_node_id, permission, updated_at) VALUES (?, ?, 'admin', ?)`, [1, 2, ts()]);
  await run(db, `INSERT INTO share_links (token, file_node_id, created_by, created_at, download_count) VALUES ('tok1', ?, ?, ?, 0)`, [2, 1, ts()]);
  await run(db, `INSERT INTO locks (lock_name_hash, token, owner, created_at, expires_at) VALUES ('lh', 't', 'o', ?, ?)`, [ts(), ts()]);
  await run(db, `INSERT INTO settings (key, value, updated_at) VALUES ('smtp_host', 'smtp.gmail.com', ?)`, [ts()]);
  await run(db, `INSERT INTO settings (key, value, updated_at) VALUES ('registration_enabled', 'true', ?)`, [ts()]);
}

function sourceDataForFake() {
  return {
    users: [
      { id: 1, username: 'admin', email: 'admin@x.com', email_hash: 'h1', password: 'p1', status: 'approved', is_admin: true, token_version: 0, created_at: ts(), updated_at: ts() },
      { id: 2, username: 'user', email: 'user@x.com', email_hash: 'h2', password: 'p2', status: 'approved', is_admin: false, token_version: 2, created_at: ts(), updated_at: ts() },
    ],
    file_nodes: [
      { id: 1, parent_id: null, name: 'root', type: 'directory', sync_status: 'active', created_at: ts(), updated_at: ts() },
      { id: 2, parent_id: 1, name: 'a.txt', type: 'file', sync_status: 'active', created_at: ts(), updated_at: ts() },
    ],
    object_map: [{ id: 1, file_node_id: 2, s3_key: 'key-1', storage_backend: 's3', version_number: 1, status: 'active', created_at: ts() }],
    filecache: [{ file_node_id: 2, size: 10, mime_type: 'text/plain', content_hash: 'ch', updated_at: ts() }],
    node_ancestors: [
      { ancestor_id: 1, descendant_id: 1, depth: 0 },
      { ancestor_id: 1, descendant_id: 2, depth: 1 },
      { ancestor_id: 2, descendant_id: 2, depth: 0 },
    ],
    permissions_user_paths: [{ user_id: 1, file_node_id: 2, permission: 'admin', updated_at: ts() }],
    share_links: [{ token: 'tok1', file_node_id: 2, created_by: 1, created_at: ts(), expires_at: null, download_count: 0 }],
    locks: [{ lock_name_hash: 'lh', token: 't', owner: 'o', created_at: ts(), expires_at: ts() }],
    settings: [
      { key: 'smtp_host', value: 'smtp.gmail.com', updated_at: ts() },
      { key: 'registration_enabled', value: 'true', updated_at: ts() },
    ],
  };
}

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-migr-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SAVED_ENCRYPT_KEY = process.env.encrypt_secret_key;

afterEach(() => {
  if (SAVED_ENCRYPT_KEY === undefined) delete process.env.encrypt_secret_key;
  else process.env.encrypt_secret_key = SAVED_ENCRYPT_KEY;
});

function makeSqlitePath(label) {
  return path.join(tmpDir, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

// ---------------------------------------------------------------------------
// scanTarget
// ---------------------------------------------------------------------------

describe('scanTarget', () => {
  it('reports schemaExists + per-table counts on a populated sqlite target and never writes', async () => {
    const dbPath = makeSqlitePath('scan-src');
    const db = await createSchemaDb(dbPath);
    await seedSourceData(db);
    await closeDb(db);

    const service = createMetadataMigrationService();
    const result = await service.scanTarget({ backend: 'sqlite', sqlitePath: dbPath });

    expect(result.connected).toBe(true);
    expect(result.schemaExists).toBe(true);
    expect(result.backend).toBe('sqlite');
    expect(result.totalRows).toBe(14); // 2 users + 2 nodes + 1 object_map + 1 filecache + 3 ancestors + 1 perm + 1 share + 1 lock + 2 settings
    const byName = Object.fromEntries(result.tables.map((t) => [t.name, t.rows]));
    expect(byName.users).toBe(2);
    expect(byName.settings).toBe(2);
    expect(byName.file_nodes).toBe(2);

    // Read-only: row counts unchanged after the scan.
    const check = await openDb(dbPath, 'readonly');
    const users = await all(check, 'SELECT COUNT(*) AS c FROM users');
    const settings = await all(check, 'SELECT COUNT(*) AS c FROM settings');
    await closeDb(check);
    expect(users[0].c).toBe(2);
    expect(settings[0].c).toBe(2);
  });

  it('reports schemaExists=false, empty tables on an empty sqlite file', async () => {
    const dbPath = makeSqlitePath('scan-empty');
    const db = await openDb(dbPath); // creates a valid empty file
    await closeDb(db);

    const service = createMetadataMigrationService();
    const result = await service.scanTarget({ backend: 'sqlite', sqlitePath: dbPath });
    expect(result.connected).toBe(true);
    expect(result.schemaExists).toBe(false);
    expect(result.tables).toEqual([]);
    expect(result.totalRows).toBe(0);
  });

  it('reports per-table counts on a postgresql target through the pg provider', async () => {
    const fake = new FakePg({ schemaExists: true, tables: sourceDataForFake() });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    const result = await service.scanTarget({
      backend: 'postgresql',
      pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' },
    });
    expect(result.schemaExists).toBe(true);
    expect(result.backend).toBe('postgresql');
    const byName = Object.fromEntries(result.tables.map((t) => [t.name, t.rows]));
    expect(byName.users).toBe(2);
    expect(byName.settings).toBe(2);
    // Scan is read-only: no BEGIN/INSERT/TRUNCATE observed.
    expect(fake.transactions).toEqual([]);
    expect(fake.calls.some((c) => /^INSERT INTO/i.test(c.sql.trim()))).toBe(false);
  });

  it('rejects an unsupported backend', async () => {
    const service = createMetadataMigrationService();
    await expect(service.scanTarget({ backend: 'mysql' })).rejects.toThrow(
      /unsupported backend/
    );
  });
});

// ---------------------------------------------------------------------------
// postgresqlToSqlite — real sqlite target (black-box)
// ---------------------------------------------------------------------------

describe('runMigration postgresqlToSqlite (fake PG source -> real sqlite target)', () => {
  it('copies rows in FK order, maps is_admin to 0/1 and settings.value to raw text', async () => {
    const targetPath = makeSqlitePath('pg2sq');
    const fake = new FakePg({ schemaExists: false, tables: sourceDataForFake() });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    const result = await service.runMigration({
      direction: 'postgresqlToSqlite',
      source: { pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
      target: { backend: 'sqlite', sqlitePath: targetPath },
    });

    expect(result.status).toBe('completed');
    expect(result.schemaApplied).toBe(true);
    expect(result.wiped).toBe(false);
    expect(result.totalRows).toBe(14);
    expect(result.tablesCopied.find((t) => t.name === 'users').rows).toBe(2);

    const db = await openDb(targetPath, 'readonly');
    const users = await all(db, 'SELECT id, username, is_admin FROM users ORDER BY id');
    expect(users).toEqual([
      { id: 1, username: 'admin', is_admin: 1 },
      { id: 2, username: 'user', is_admin: 0 },
    ]);
    const settings = await all(db, 'SELECT key, value FROM settings ORDER BY key');
    expect(settings).toEqual([
      { key: 'registration_enabled', value: 'true' },
      { key: 'smtp_host', value: 'smtp.gmail.com' },
    ]);
    const nodes = await all(db, 'SELECT id, parent_id, name FROM file_nodes ORDER BY id');
    expect(nodes[1]).toEqual({ id: 2, parent_id: 1, name: 'a.txt' });
    await closeDb(db);
  });

  it('resyncs sqlite_sequence so a new insert after migration does not collide', async () => {
    const targetPath = makeSqlitePath('pg2sq-seq');
    const fake = new FakePg({ schemaExists: false, tables: sourceDataForFake() });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    await service.runMigration({
      direction: 'postgresqlToSqlite',
      source: { pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
      target: { backend: 'sqlite', sqlitePath: targetPath },
    });

    const db = await openDb(targetPath);
    const ins = await run(db, `INSERT INTO users (username, email, email_hash, password, status, is_admin) VALUES ('new', 'n@x.com', 'h3', 'p', 'approved', 0)`);
    await closeDb(db);
    expect(ins.lastID).toBe(3); // source max id was 2
  });

  it('wipeTarget deletes existing target rows then copies, inside the same transaction', async () => {
    const targetPath = makeSqlitePath('pg2sq-wipe');
    const db = await createSchemaDb(targetPath);
    await run(db, `INSERT INTO users (id, username, email, email_hash, password, status, is_admin) VALUES (99, 'old', 'o@x.com', 'ho', 'po', 'approved', 0)`);
    await run(db, `INSERT INTO settings (key, value) VALUES ('old_key', 'old_value')`);
    await closeDb(db);

    const fake = new FakePg({ schemaExists: true, tables: sourceDataForFake() });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });
    const result = await service.runMigration({
      direction: 'postgresqlToSqlite',
      source: { pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
      target: { backend: 'sqlite', sqlitePath: targetPath },
      wipeTarget: true,
    });

    expect(result.wiped).toBe(true);
    const check = await openDb(targetPath, 'readonly');
    const users = await all(check, 'SELECT username FROM users ORDER BY id');
    const settings = await all(check, 'SELECT key FROM settings ORDER BY key');
    await closeDb(check);
    expect(users).toEqual([{ username: 'admin' }, { username: 'user' }]);
    expect(settings).toEqual([{ key: 'registration_enabled' }, { key: 'smtp_host' }]);
  });

  it('cancel mid-copy ROLLBACKs — target schema and data are untouched', async () => {
    const targetPath = makeSqlitePath('pg2sq-cancel');
    let cancelled = false;
    const fake = new FakePg({ schemaExists: false, tables: sourceDataForFake() });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    const result = await service.runMigration({
      direction: 'postgresqlToSqlite',
      source: { pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
      target: { backend: 'sqlite', sqlitePath: targetPath },
      isCancelled: () => cancelled,
      onProgress: (stage, table) => {
        if (stage === 'copy' && table === 'users') cancelled = true;
      },
    });

    expect(result.status).toBe('cancelled');
    // Schema apply + users insert happened inside the transaction -> all rolled back.
    const db = await openDb(targetPath, 'readonly');
    const users = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    const settings = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'");
    await closeDb(db);
    expect(users).toEqual([]);
    expect(settings).toEqual([]);
  });

  it('error mid-copy ROLLBACKs — target unchanged', async () => {
    const targetPath = makeSqlitePath('pg2sq-err');
    const fake = new FakePg({
      schemaExists: false,
      tables: sourceDataForFake(),
      failOnTable: 'file_nodes',
    });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    await expect(
      service.runMigration({
        direction: 'postgresqlToSqlite',
        source: { pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
        target: { backend: 'sqlite', sqlitePath: targetPath },
      })
    ).rejects.toThrow('boom on file_nodes');

    const db = await openDb(targetPath, 'readonly');
    const users = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    await closeDb(db);
    expect(users).toEqual([]);
  });

  it('reports encryptSecretKeyMissing when the source holds encrypted settings and no master key', async () => {
    const sourcePath = makeSqlitePath('src-enc');
    const src = await createSchemaDb(sourcePath);
    const payload = JSON.stringify(encryptSecret('s3cr3t', 'master-key'));
    await run(src, `INSERT INTO settings (key, value, updated_at) VALUES ('WEBDAV_PASSWORD', ?, ?)`, [payload, ts()]);
    await closeDb(src);

    delete process.env.encrypt_secret_key;
    const fake = new FakePg({
      schemaExists: true,
      tables: { users: sourceDataForFake().users, file_nodes: sourceDataForFake().file_nodes },
    });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });
    const result = await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
    });

    expect(result.warning).toBe('encryptSecretKeyMissing');
  });

  it('omits the warning when encrypt_secret_key is present', async () => {
    const sourcePath = makeSqlitePath('src-enc2');
    const src = await createSchemaDb(sourcePath);
    const payload = JSON.stringify(encryptSecret('s3cr3t', 'master-key'));
    await run(src, `INSERT INTO settings (key, value, updated_at) VALUES ('WEBDAV_PASSWORD', ?, ?)`, [payload, ts()]);
    await closeDb(src);

    process.env.encrypt_secret_key = 'master-key';
    const fake = new FakePg({ schemaExists: true, tables: {} });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });
    const result = await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
    });
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sqliteToPostgresql — fake PG target (call-log assertions)
// ---------------------------------------------------------------------------

describe('runMigration sqliteToPostgresql (real sqlite source -> fake PG target)', () => {
  async function makeSource() {
    const sourcePath = makeSqlitePath('src');
    const src = await createSchemaDb(sourcePath);
    await seedSourceData(src);
    await closeDb(src);
    return sourcePath;
  }

  it('wraps settings.value as a JSON string, maps is_admin to true/false, and keeps explicit ids', async () => {
    const sourcePath = await makeSource();
    const fake = new FakePg({ schemaExists: true });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    const result = await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
    });
    expect(result.status).toBe('completed');

    const usersInsert = fake.calls.find((c) => /^INSERT INTO "users"/.test(c.sql.trim()));
    // params flatten the 2-row batch; find is_admin + id values.
    const p = usersInsert.params;
    expect(p).toContain(1);
    expect(p).toContain(2);
    expect(p.filter((v) => v === true).length).toBe(1);
    expect(p.filter((v) => v === false).length).toBe(1);

    const settingsInsert = fake.calls.find((c) => /^INSERT INTO "settings"/.test(c.sql.trim()));
    const pairs = [];
    for (let i = 0; i < settingsInsert.params.length; i += 3) {
      pairs.push([settingsInsert.params[i], settingsInsert.params[i + 1]]);
    }
    const settingsMap = Object.fromEntries(pairs);
    expect(settingsMap.smtp_host).toBe('"smtp.gmail.com"');
    expect(settingsMap.registration_enabled).toBe('"true"');
  });

  it('emits copy in FK order (users before file_nodes before settings last)', async () => {
    const sourcePath = await makeSource();
    const fake = new FakePg({ schemaExists: true });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
    });

    const inserts = fake.calls
      .filter((c) => /^INSERT INTO/.test(c.sql.trim()))
      .map((c) => c.sql.trim().match(/^INSERT INTO "([^"]+)"/)[1]);
    // Only tables with rows produce INSERTs; their order must follow COPY_ORDER.
    expect(inserts).toEqual([
      'users',
      'file_nodes',
      'object_map',
      'filecache',
      'node_ancestors',
      'permissions_user_paths',
      'share_links',
      'locks',
      'settings',
    ]);
  });

  it('resyncs PG sequences with setval for the SERIAL-id tables', async () => {
    const sourcePath = await makeSource();
    // The target reports MAX(id) so resyncSequences issues setval for each
    // SERIAL table that has rows on the target.
    const fake = new FakePg({
      schemaExists: true,
      tables: { users: [{ id: 2 }], file_nodes: [{ id: 2 }], permission_requests: [{ id: 3 }] },
    });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
    });

    const setvals = fake.calls.filter((c) => /setval/.test(c.sql));
    expect(setvals.map((c) => c.params[0])).toEqual(['users', 'file_nodes', 'permission_requests']);
    // MAX(id) probes precede setval.
    const maxProbes = fake.calls
      .filter((c) => /COALESCE\(MAX\(id\), 0\)/.test(c.sql))
      .map((c) => c.sql.match(/FROM "([^"]+)"/)[1]);
    expect(maxProbes).toEqual(['users', 'file_nodes', 'permission_requests']);
  });

  it('applies the DDL to a schema-less PG target before copying', async () => {
    const sourcePath = await makeSource();
    const fake = new FakePg({ schemaExists: false });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    const result = await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
    });
    expect(result.schemaApplied).toBe(true);
    // The DDL file text reached the target client (CREATE TABLE ... users).
    const ddl = fake.calls.some((c) => /CREATE TABLE IF NOT EXISTS users/i.test(c.sql));
    expect(ddl).toBe(true);
  });

  it('cancel mid-copy ROLLBACKs the target transaction', async () => {
    const sourcePath = await makeSource();
    const fake = new FakePg({ schemaExists: true });
    const service = createMetadataMigrationService({ pgConnectionProvider: () => fake });

    let cancelled = false;
    const result = await service.runMigration({
      direction: 'sqliteToPostgresql',
      source: { sqlitePath: sourcePath },
      target: { backend: 'postgresql', pg: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } },
      isCancelled: () => cancelled,
      onProgress: (stage, table) => {
        if (stage === 'copy' && table === 'users') cancelled = true;
      },
    });

    expect(result.status).toBe('cancelled');
    expect(fake.transactions).toEqual(['BEGIN', 'ROLLBACK']);
    // No INSERT beyond the first table was attempted.
    const tablesInserted = fake.calls
      .filter((c) => /^INSERT INTO/.test(c.sql.trim()))
      .map((c) => c.sql.trim().match(/^INSERT INTO "([^"]+)"/)[1]);
    expect(tablesInserted.every((t) => t === 'users')).toBe(true);
  });

  it('validates direction and same-backend errors', async () => {
    const service = createMetadataMigrationService();
    await expect(
      service.runMigration({ direction: 'bogus', target: { backend: 'sqlite', sqlitePath: 'x' } })
    ).rejects.toThrow(/invalid direction/);
    await expect(
      service.runMigration({
        direction: 'sqliteToPostgresql',
        source: {},
        target: { backend: 'sqlite', sqlitePath: 'x' },
      })
    ).rejects.toThrow(/must differ/);
  });
});

// ---------------------------------------------------------------------------
// Real sqlite -> PG roundtrip (test:ci:pg only)
// ---------------------------------------------------------------------------

const PG_BASE = {
  host: process.env.WEA_PG_HOST || '127.0.0.1',
  port: Number(process.env.WEA_PG_PORT) || 5432,
  user: process.env.WEA_PG_USER || 'e2etest',
  password: process.env.WEA_PG_PASSWORD || 'e2etest',
};

// The real PG roundtrip runs only under test:ci:pg (WEA_STORAGE_BACKEND=postgresql);
// under the sqlite test:ci run the tests are skipped.
const roundtripIt =
  process.env.WEA_STORAGE_BACKEND === 'postgresql' ? it : it.skip;

describe('roundtrip sqlite -> postgresql (real PG)', () => {
    async function withPgDatabase(name, fn) {
      const { Client } = require('pg');
      const admin = new Client({ ...PG_BASE, database: 'postgres' });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.query(`CREATE DATABASE ${name}`);
      await admin.end();

      const client = new Client({ ...PG_BASE, database: name });
      await client.connect();
      try {
        await fn(client);
      } finally {
        await client.end();
      }

      const dropper = new Client({ ...PG_BASE, database: 'postgres' });
      await dropper.connect();
      await dropper.query(`DROP DATABASE IF EXISTS ${name}`);
      await dropper.end();
    }

    roundtripIt('round-trips data with correct serialization and sequence resync', async () => {
      const { decryptSecret } = require('../../../../utils/configEncryption');
      const sourcePath = makeSqlitePath('roundtrip-src');
      const src = await createSchemaDb(sourcePath);
      await seedSourceData(src);
      const encPayload = JSON.stringify(encryptSecret('secret-val', 'master-key'));
      await run(src, `INSERT INTO settings (key, value, updated_at) VALUES ('WEBDAV_PASSWORD', ?, ?)`, [encPayload, ts()]);
      await closeDb(src);

      const dbName = `wea_migr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      await withPgDatabase(dbName, async (client) => {
        const service = createMetadataMigrationService();
        delete process.env.encrypt_secret_key;
        const result = await service.runMigration({
          direction: 'sqliteToPostgresql',
          source: { sqlitePath: sourcePath },
          target: {
            backend: 'postgresql',
            pg: { ...PG_BASE, database: dbName },
          },
        });
        expect(result.status).toBe('completed');
        expect(result.schemaApplied).toBe(true);
        expect(result.warning).toBe('encryptSecretKeyMissing'); // no env key in this process

        const users = await client.query('SELECT id, username, is_admin FROM users ORDER BY id');
        expect(users.rows).toEqual([
          { id: 1, username: 'admin', is_admin: true },
          { id: 2, username: 'user', is_admin: false },
        ]);

        const settings = await client.query('SELECT key, value FROM settings ORDER BY key');
        const byKey = Object.fromEntries(settings.rows.map((r) => [r.key, r.value]));
        expect(byKey.smtp_host).toBe('smtp.gmail.com'); // JSON-string unwrapped by node-pg
        expect(byKey.registration_enabled).toBe('true');
        // Encrypted row survived verbatim and decrypts with the same master key.
        expect(decryptSecret(JSON.parse(byKey.WEBDAV_PASSWORD), 'master-key')).toBe('secret-val');

        // Sequence resync: a new insert does not collide with the copied ids.
        const ins = await client.query(
          `INSERT INTO users (username, email, email_hash, password, status, is_admin)
           VALUES ('new', 'n@x.com', 'h3', 'p', 'approved', false) RETURNING id`
        );
        expect(Number(ins.rows[0].id)).toBe(3);
      });
    });

    roundtripIt('cancel mid-copy rolls back schema + copy on the real target', async () => {
      const sourcePath = makeSqlitePath('roundtrip-cancel-src');
      const src = await createSchemaDb(sourcePath);
      await seedSourceData(src);
      await closeDb(src);

      const dbName = `wea_migr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      await withPgDatabase(dbName, async (client) => {
        const service = createMetadataMigrationService();
        let cancelled = false;
        const result = await service.runMigration({
          direction: 'sqliteToPostgresql',
          source: { sqlitePath: sourcePath },
          target: { backend: 'postgresql', pg: { ...PG_BASE, database: dbName } },
          isCancelled: () => cancelled,
          onProgress: (stage, table) => {
            if (stage === 'copy' && table === 'users') cancelled = true;
          },
        });

        expect(result.status).toBe('cancelled');
        // Everything ran in one transaction -> schema + copy rolled back.
        const tables = await client.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_schema_migrations'`
        );
        expect(tables.rows).toEqual([]);
      });
    });
  }
);
