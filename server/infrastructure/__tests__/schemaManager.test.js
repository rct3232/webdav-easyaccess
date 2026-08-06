const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DDL_DIR = path.join(__dirname, '../../store/postgresql/ddl');

// ---------------------------------------------------------------------------
// Helpers for raw sqlite3 operations (bypass storage module entirely)
// ---------------------------------------------------------------------------

function openMemoryDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Test suite: each describe block gets its own DB + mock to guarantee isolation.
// We use jest.doMock() so the factory can capture a real in-memory DB instance.
// ---------------------------------------------------------------------------

describe('schemaManager — applyPendingMigrations (sqlite)', () => {
  // =========================================================================
  // Group 1: _schema_migrations table auto-creation
  // =========================================================================
  describe('_schema_migrations table auto-created if missing', () => {
    let db;
    let SchemaManager;

    beforeAll(async () => {
      db = await openMemoryDb();
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA defer_foreign_keys = ON');

      jest.doMock('../../store/storage', () => {
        const { createStorageMock } = require('@testing/mocks/storeMocks');
        return createStorageMock({
          getSqliteConnection: () => db,
          sqliteQuery: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.all(sql, params || [], (err, rows) =>
                err ? reject(err) : resolve({ rows: rows || [] }),
              );
            }),
          sqliteRun: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.run(sql, params || [], function (err) {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
              });
            }),
          withSqliteTransaction: async (callback) => {
            await new Promise((resolve, reject) =>
              db.run('BEGIN', (err) => (err ? reject(err) : resolve())),
            );
            try {
              const client = {
                query: (sql, params) =>
                  new Promise((resolve, reject) => {
                    db.all(sql, params || [], (err, rows) =>
                      err ? reject(err) : resolve({ rows: rows || [] }),
                    );
                  }),
              };
              const result = await callback(client);
              await new Promise((resolve, reject) =>
                db.run('COMMIT', (err) => (err ? reject(err) : resolve())),
              );
              return result;
            } catch (e) {
              await new Promise((resolve) => db.run('ROLLBACK', resolve));
              throw e;
            }
          },
        });
      });

      jest.isolateModules(() => {
        SchemaManager = require('../schemaManager');
      });
    });

    afterAll(async () => {
      await closeDb(db);
    });

    function query(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });
    }

    it('creates _schema_migrations on a completely empty database', async () => {
      const tables = await query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );
      expect(tables).toEqual([]);

      await SchemaManager.applyPendingMigrations('sqlite');

      const afterTables = await query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );
      const names = afterTables.map((r) => r.name);
      expect(names).toContain('_schema_migrations');
    });

    it('creates _schema_migrations before executing any DDL', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const cols = await query("PRAGMA table_info(_schema_migrations)");
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('filename');
      expect(colNames).toContain('applied_at');
      expect(colNames).toContain('checksum');
    });

    it('_schema_migrations has correct column types', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const cols = await query("PRAGMA table_info(_schema_migrations)");
      const filenameCol = cols.find((c) => c.name === 'filename');
      expect(filenameCol.type).toBe('TEXT');

      const checksumCol = cols.find((c) => c.name === 'checksum');
      expect(checksumCol.type).toBe('TEXT');
    });
  });

  // =========================================================================
  // Group 2: Pending migration detection
  // =========================================================================
  describe('pending migration detection', () => {
    let db;
    let SchemaManager;

    beforeAll(async () => {
      db = await openMemoryDb();
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA defer_foreign_keys = ON');

      jest.doMock('../../store/storage', () => {
        const { createStorageMock } = require('@testing/mocks/storeMocks');
        return createStorageMock({
          getSqliteConnection: () => db,
          sqliteQuery: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.all(sql, params || [], (err, rows) =>
                err ? reject(err) : resolve({ rows: rows || [] }),
              );
            }),
          sqliteRun: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.run(sql, params || [], function (err) {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
              });
            }),
          withSqliteTransaction: async (callback) => {
            await new Promise((resolve, reject) =>
              db.run('BEGIN', (err) => (err ? reject(err) : resolve())),
            );
            try {
              const client = {
                query: (sql, params) =>
                  new Promise((resolve, reject) => {
                    db.all(sql, params || [], (err, rows) =>
                      err ? reject(err) : resolve({ rows: rows || [] }),
                    );
                  }),
              };
              const result = await callback(client);
              await new Promise((resolve, reject) =>
                db.run('COMMIT', (err) => (err ? reject(err) : resolve())),
              );
              return result;
            } catch (e) {
              await new Promise((resolve) => db.run('ROLLBACK', resolve));
              throw e;
            }
          },
        });
      });

      jest.isolateModules(() => {
        SchemaManager = require('../schemaManager');
      });
    });

    afterAll(async () => {
      await closeDb(db);
    });

    function query(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });
    }

    async function getUserTables() {
      const rows = await query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      return rows.map((r) => r.name);
    }

    it('executes all pending DDL files', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const tables = await getUserTables();

      const expectedDdlTables = [
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

      for (const tableName of expectedDdlTables) {
        expect(tables).toContain(tableName);
      }
    });

    it('skips already-applied migrations on second call', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');
      const firstCount = (
        await query('SELECT COUNT(*) as cnt FROM _schema_migrations')
      )[0].cnt;

      expect(firstCount).toBeGreaterThan(0);

      await SchemaManager.applyPendingMigrations('sqlite');
      const secondCount = (
        await query('SELECT COUNT(*) as cnt FROM _schema_migrations')
      )[0].cnt;

      expect(secondCount).toBe(firstCount);
    });

    it('only applies files not already in _schema_migrations', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const applied = await query(
        'SELECT filename FROM _schema_migrations ORDER BY filename',
      );

      const ddlFiles = fs
        .readdirSync(DDL_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      expect(applied.map((r) => r.filename)).toEqual(ddlFiles);
    });
  });

  // =========================================================================
  // Group 3: Idempotency
  // =========================================================================
  describe('idempotency', () => {
    let db;
    let SchemaManager;

    beforeAll(async () => {
      db = await openMemoryDb();
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA defer_foreign_keys = ON');

      jest.doMock('../../store/storage', () => {
        const { createStorageMock } = require('@testing/mocks/storeMocks');
        return createStorageMock({
          getSqliteConnection: () => db,
          sqliteQuery: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.all(sql, params || [], (err, rows) =>
                err ? reject(err) : resolve({ rows: rows || [] }),
              );
            }),
          sqliteRun: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.run(sql, params || [], function (err) {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
              });
            }),
          withSqliteTransaction: async (callback) => {
            await new Promise((resolve, reject) =>
              db.run('BEGIN', (err) => (err ? reject(err) : resolve())),
            );
            try {
              const client = {
                query: (sql, params) =>
                  new Promise((resolve, reject) => {
                    db.all(sql, params || [], (err, rows) =>
                      err ? reject(err) : resolve({ rows: rows || [] }),
                    );
                  }),
              };
              const result = await callback(client);
              await new Promise((resolve, reject) =>
                db.run('COMMIT', (err) => (err ? reject(err) : resolve())),
              );
              return result;
            } catch (e) {
              await new Promise((resolve) => db.run('ROLLBACK', resolve));
              throw e;
            }
          },
        });
      });

      jest.isolateModules(() => {
        SchemaManager = require('../schemaManager');
      });
    });

    afterAll(async () => {
      await closeDb(db);
    });

    function query(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });
    }

    async function getUserTables() {
      const rows = await query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      return rows.map((r) => r.name);
    }

    it('calling applyPendingMigrations twice produces no additional records', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');
      const afterFirst = await query(
        'SELECT * FROM _schema_migrations ORDER BY filename',
      );

      await SchemaManager.applyPendingMigrations('sqlite');
      const afterSecond = await query(
        'SELECT * FROM _schema_migrations ORDER BY filename',
      );

      expect(afterSecond).toEqual(afterFirst);
    });

    it('calling applyPendingMigrations three times produces no additional records', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');
      await SchemaManager.applyPendingMigrations('sqlite');
      const afterTwo = await query(
        'SELECT * FROM _schema_migrations ORDER BY filename',
      );

      await SchemaManager.applyPendingMigrations('sqlite');
      const afterThree = await query(
        'SELECT * FROM _schema_migrations ORDER BY filename',
      );

      expect(afterThree).toEqual(afterTwo);
    });

    it('tables are not duplicated on repeated calls', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');
      await SchemaManager.applyPendingMigrations('sqlite');
      await SchemaManager.applyPendingMigrations('sqlite');

      const tables = await getUserTables();
      expect(new Set(tables).size).toBe(tables.length);
    });
  });

  // =========================================================================
  // Group 4: SHA-256 checksum recorded
  // =========================================================================
  describe('SHA-256 checksum recorded', () => {
    let db;
    let SchemaManager;

    beforeAll(async () => {
      db = await openMemoryDb();
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA defer_foreign_keys = ON');

      jest.doMock('../../store/storage', () => {
        const { createStorageMock } = require('@testing/mocks/storeMocks');
        return createStorageMock({
          getSqliteConnection: () => db,
          sqliteQuery: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.all(sql, params || [], (err, rows) =>
                err ? reject(err) : resolve({ rows: rows || [] }),
              );
            }),
          sqliteRun: (sql, params = []) =>
            new Promise((resolve, reject) => {
              db.run(sql, params || [], function (err) {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
              });
            }),
          withSqliteTransaction: async (callback) => {
            await new Promise((resolve, reject) =>
              db.run('BEGIN', (err) => (err ? reject(err) : resolve())),
            );
            try {
              const client = {
                query: (sql, params) =>
                  new Promise((resolve, reject) => {
                    db.all(sql, params || [], (err, rows) =>
                      err ? reject(err) : resolve({ rows: rows || [] }),
                    );
                  }),
              };
              const result = await callback(client);
              await new Promise((resolve, reject) =>
                db.run('COMMIT', (err) => (err ? reject(err) : resolve())),
              );
              return result;
            } catch (e) {
              await new Promise((resolve) => db.run('ROLLBACK', resolve));
              throw e;
            }
          },
        });
      });

      jest.isolateModules(() => {
        SchemaManager = require('../schemaManager');
      });
    });

    afterAll(async () => {
      await closeDb(db);
    });

    function query(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });
    }

    it('stores correct SHA-256 checksum for each applied migration', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const records = await query(
        'SELECT filename, checksum FROM _schema_migrations ORDER BY filename',
      );

      expect(records.length).toBeGreaterThan(0);

      for (const record of records) {
        const filePath = path.join(DDL_DIR, record.filename);
        const content = fs.readFileSync(filePath, 'utf8');
        const expectedChecksum = crypto
          .createHash('sha256')
          .update(content)
          .digest('hex');

        expect(record.checksum).toBe(expectedChecksum);
      }
    });

    it('checksum is non-empty 64-char hex for every record', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const records = await query(
        'SELECT filename, checksum FROM _schema_migrations',
      );

      for (const r of records) {
        expect(r.checksum).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('applied_at is populated for every record', async () => {
      await SchemaManager.applyPendingMigrations('sqlite');

      const records = await query(
        'SELECT filename, applied_at FROM _schema_migrations',
      );

      for (const r of records) {
        expect(r.applied_at).toBeDefined();
        expect(r.applied_at).not.toBe(null);
        expect(r.applied_at).not.toBe('');
      }
    });
  });
});
