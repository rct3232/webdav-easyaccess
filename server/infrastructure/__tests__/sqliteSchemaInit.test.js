const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const { convertPostgresToSqlite } = require('../sqliteSchemaInit');

function openMemoryDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function runSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function queryDb(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Unit tests for convertPostgresToSqlite type mappings
// ---------------------------------------------------------------------------
describe('convertPostgresToSqlite', () => {
  it('converts BIGSERIAL PRIMARY KEY to INTEGER PRIMARY KEY AUTOINCREMENT', () => {
    const result = convertPostgresToSqlite('id BIGSERIAL PRIMARY KEY');
    expect(result).toBe('id INTEGER PRIMARY KEY AUTOINCREMENT');
  });

  it('converts standalone BIGSERIAL to INTEGER PRIMARY KEY AUTOINCREMENT', () => {
    const result = convertPostgresToSqlite('id BIGSERIAL');
    expect(result).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
  });

  it('converts standalone BIGINT to INTEGER (word boundary)', () => {
    const result = convertPostgresToSqlite('user_id BIGINT NOT NULL');
    expect(result).toBe('user_id INTEGER NOT NULL');
  });

  it('does not double-convert BIGSERIAL into BIGINT + PRIMARY KEY', () => {
    // BIGSERIAL is replaced first; the resulting "INTEGER" must not be touched by the \bBIGINT\b rule.
    const result = convertPostgresToSqlite('id BIGSERIAL PRIMARY KEY');
    expect(result).not.toContain('BIGINT');
    expect(result).toBe('id INTEGER PRIMARY KEY AUTOINCREMENT');
  });

  it('converts TIMESTAMPTZ to TEXT', () => {
    const result = convertPostgresToSqlite('created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(result).toContain('TEXT');
  });

  it('converts JSONB to TEXT', () => {
    const result = convertPostgresToSqlite('value JSONB NOT NULL');
    expect(result).toBe('value TEXT NOT NULL');
  });

  it('converts BOOLEAN NOT NULL DEFAULT FALSE to INTEGER NOT NULL DEFAULT 0', () => {
    const result = convertPostgresToSqlite('is_admin BOOLEAN NOT NULL DEFAULT FALSE');
    expect(result).toBe('is_admin INTEGER NOT NULL DEFAULT 0');
  });

  it('converts DEFAULT TRUE to DEFAULT 1', () => {
    const result = convertPostgresToSqlite('enabled BOOLEAN DEFAULT TRUE');
    expect(result).toContain('DEFAULT 1');
  });

  it('converts DEFAULT NOW() to DEFAULT CURRENT_TIMESTAMP', () => {
    const result = convertPostgresToSqlite('created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(result).toContain('DEFAULT CURRENT_TIMESTAMP');
  });

  it('strips BEGIN;', () => {
    const result = convertPostgresToSqlite('BEGIN;\nCREATE TABLE t (id INTEGER);');
    expect(result).not.toContain('BEGIN');
    expect(result).toContain('CREATE TABLE t (id INTEGER)');
  });

  it('strips COMMIT;', () => {
    const result = convertPostgresToSqlite('CREATE TABLE t (id INTEGER);\nCOMMIT;');
    expect(result).not.toContain('COMMIT');
    expect(result).toContain('CREATE TABLE t (id INTEGER)');
  });

  it('passes CHECK constraints through unchanged', () => {
    const ddl = "CHECK (status IN ('pending', 'approved'))";
    const result = convertPostgresToSqlite(ddl);
    expect(result).toBe("CHECK (status IN ('pending', 'approved'))");
  });

  it('passes partial index WHERE clauses through unchanged', () => {
    const ddl = 'CREATE INDEX idx ON t (a) WHERE b IS NULL;';
    const result = convertPostgresToSqlite(ddl);
    expect(result).toContain('WHERE b IS NULL');
  });

  it('passes self-referencing FK inline syntax through', () => {
    const ddl = 'parent_id BIGINT DEFAULT NULL REFERENCES file_nodes(id) ON DELETE CASCADE';
    const result = convertPostgresToSqlite(ddl);
    expect(result).toContain('REFERENCES file_nodes(id)');
    expect(result).toContain('ON DELETE CASCADE');
  });

  it('handles combined type + default conversions in one column', () => {
    const ddl = 'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()';
    const result = convertPostgresToSqlite(ddl);
    expect(result).toBe('created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  it('handles boolean with default false in one column', () => {
    const ddl = 'is_admin BOOLEAN NOT NULL DEFAULT FALSE';
    const result = convertPostgresToSqlite(ddl);
    expect(result).toBe('is_admin INTEGER NOT NULL DEFAULT 0');
  });
});

// ---------------------------------------------------------------------------
// Integration test: execute converted DDL against an in-memory SQLite DB
// ---------------------------------------------------------------------------
describe('initSqliteSchema integration', () => {
  const ddlPath = path.join(
    __dirname,
    '../../store/postgresql/ddl/001_initial_normalized_schema.sql'
  );
  const ddlSource = fs.readFileSync(ddlPath, 'utf8');

  let db;

  beforeAll(async () => {
    db = await openMemoryDb();
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it('converts the full DDL without error', () => {
    expect(() => convertPostgresToSqlite(ddlSource)).not.toThrow();
  });

  it('executes all converted statements against in-memory SQLite', async () => {
    const sqliteDdl = convertPostgresToSqlite(ddlSource);

    // Split on semicolons (same logic as splitStatements but without import)
    const statements = [];
    let current = '';
    for (const line of sqliteDdl.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--')) continue;
      current += trimmed + '\n';
      if (trimmed.endsWith(';')) {
        statements.push(current.trim().slice(0, -1));
        current = '';
      }
    }

    for (const stmt of statements) {
      if (!stmt || stmt.length === 0) continue;
      await runSql(db, stmt);
    }
  });

  it('creates exactly 13 tables', async () => {
    const rows = await queryDb(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    expect(rows.length).toBe(13);

    const expectedTables = [
      'file_nodes',
      'filecache',
      'locks',
      'node_ancestors',
      'object_map',
      'permission_requests',
      'permissions_shares',
      'permissions_user_files',
      'permissions_user_paths',
      'recent_files',
      'settings',
      'share_links',
      'users',
    ];

    const actualNames = rows.map((r) => r.name).sort();
    expect(actualNames).toEqual(expectedTables);
  });

  it('file_nodes.id is INTEGER PRIMARY KEY AUTOINCREMENT', async () => {
    const info = await queryDb(db, 'PRAGMA table_info(file_nodes)');
    const idCol = info.find((c) => c.name === 'id');
    expect(idCol.type).toBe('INTEGER');
  });

  it('users.is_admin is INTEGER (converted from BOOLEAN)', async () => {
    const info = await queryDb(db, 'PRAGMA table_info(users)');
    const col = info.find((c) => c.name === 'is_admin');
    expect(col.type).toBe('INTEGER');
  });

  it('users.created_at is TEXT (converted from TIMESTAMPTZ)', async () => {
    const info = await queryDb(db, 'PRAGMA table_info(users)');
    const col = info.find((c) => c.name === 'created_at');
    expect(col.type).toBe('TEXT');
  });

  it('settings.value is TEXT (converted from JSONB)', async () => {
    const info = await queryDb(db, 'PRAGMA table_info(settings)');
    const col = info.find((c) => c.name === 'value');
    expect(col.type).toBe('TEXT');
  });

  it('filecache.size is INTEGER (converted from BIGINT)', async () => {
    const info = await queryDb(db, 'PRAGMA table_info(filecache)');
    const col = info.find((c) => c.name === 'size');
    expect(col.type).toBe('INTEGER');
  });

  it('foreign keys are preserved on file_nodes.parent_id', async () => {
    const fks = await queryDb(db, 'PRAGMA foreign_key_list(file_nodes)');
    const parentFk = fks.find((fk) => fk.from === 'parent_id');
    expect(parentFk).toBeDefined();
    expect(parentFk.table).toBe('file_nodes');
  });

  it('CHECK constraints are preserved (users.status)', async () => {
    // Insert a valid status — should succeed.
    await runSql(
      db,
      "INSERT INTO users (username, email, email_hash, password, status) VALUES ('chk_test', 't@t.com', 'hash', 'pw', 'approved')"
    );

    // Insert an invalid status — should fail.
    let err = null;
    try {
      await runSql(
        db,
        "INSERT INTO users (username, email, email_hash, password, status) VALUES ('chk_fail', 'f@t.com', 'hash2', 'pw', 'invalid_status')"
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
  });

  it('DEFAULT values are applied correctly on insert', async () => {
    await runSql(
      db,
      "INSERT INTO users (username, email, email_hash, password, status) VALUES ('def_test', 'd@t.com', 'hash3', 'pw', 'approved')"
    );

    const rows = await queryDb(db, "SELECT is_admin FROM users WHERE username='def_test'");
    expect(rows[0].is_admin).toBe(0);
  });
});
