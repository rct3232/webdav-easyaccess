'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const {
  createTestDatabase,
  dbQuery,
  dbRun,
} = require('../../test-utils');
const storage = require('../../store/storage');
const { initMetadataStore } = require('../../store/bootstrap');
const { applyPendingMigrations } = require('../schemaManager');
const { convertPostgresToSqlite } = require('../sqliteSchemaInit');

function runOn(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function allOn(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function insertNode(parentId, name, type = 'file') {
  const res = await dbRun(
    'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, ?)',
    [parentId, name, type, 'active']
  );
  return res.lastID ?? res.lastId ?? (res.rows && res.rows[0] ? res.rows[0].id : undefined);
}

describe('trash soft-delete schema (ddl/002)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  describe('live/trashed name uniqueness (active backend)', () => {
    it('rejects a duplicate (parent_id, name) among live rows', async () => {
      const name = `dup-live-${Date.now()}`;
      await insertNode(null, name, 'directory');
      await expect(insertNode(null, name, 'file')).rejects.toThrow();
    });

    it('allows a trashed row and a live row to share (parent_id, name)', async () => {
      const name = `dup-mixed-${Date.now()}`;
      const first = await insertNode(null, name, 'file');
      await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [first]);
      const second = await insertNode(null, name, 'file');
      expect(second).toBeGreaterThan(first);
    });

    it('allows two trashed siblings to share a name while the live one stays unique', async () => {
      const name = `dup-trashed-${Date.now()}`;
      const a = await insertNode(null, name, 'file');
      const b = await insertNode(null, name, 'file').catch(() => null);
      if (b === null) {
        // a was still live; trash it first, then seed the second trashed row
        await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [a]);
        const b2 = await insertNode(null, name, 'file');
        await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [b2]);
      } else {
        await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [a]);
        await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [b]);
      }
      const live = await insertNode(null, name, 'file');
      const rows = await dbQuery('SELECT id, deleted_at FROM file_nodes WHERE name = ?', [name]);
      expect(rows.rows).toHaveLength(3);
      const trashedCount = rows.rows.filter((r) => r.deleted_at !== null).length;
      expect(trashedCount).toBe(2);
      expect(live).toBeGreaterThan(0);
      await expect(insertNode(null, name, 'file')).rejects.toThrow();
    });

    it('applies the same rules to the root (parent_id IS NULL) variant', async () => {
      const name = `dup-root-${Date.now()}`;
      const root = await insertNode(null, name, 'directory');
      await expect(insertNode(null, name, 'file')).rejects.toThrow();
      await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [root]);
      const again = await insertNode(null, name, 'directory');
      expect(again).toBeGreaterThan(root);
    });

    it('defaults deleted_at to NULL on insert', async () => {
      const name = `trash-default-${Date.now()}`;
      const id = await insertNode(null, name, 'file');
      const rows = await dbQuery('SELECT deleted_at FROM file_nodes WHERE id = ?', [id]);
      expect(rows.rows[0].deleted_at).toBeNull();
    });
  });

  describe('existing pre-002 sqlite database migrated via the real boot path', () => {
    it('rebuilds file_nodes preserving data and enforces the new uniqueness', async () => {
      const prevPath = process.env.WEA_SQLITE_PATH;
      const oldDbPath = path.join(os.tmpdir(), `wea-pre002-${crypto.randomUUID()}.db`);

      // Build the OLD (pre-002) shape from the transpiled 001 chain.
      const raw = new sqlite3.Database(oldDbPath);
      await runOn(raw, 'PRAGMA foreign_keys = ON');
      const ddl001 = convertPostgresToSqlite(
        fs.readFileSync(
          path.join(__dirname, '../../store/postgresql/ddl/001_initial_normalized_schema.sql'),
          'utf8'
        )
      );
      await new Promise((resolve, reject) => raw.exec(ddl001, (e) => (e ? reject(e) : resolve())));

      const rootId = (
        await runOn(
          raw,
          'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (NULL, ?, ?, ?)',
          [`pre002-root-${Date.now()}`, 'directory', 'active']
        )
      ).lastID;
      const childId = (
        await runOn(
          raw,
          'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, ?)',
          [rootId, `pre002-child-${Date.now()}`, 'file', 'active']
        )
      ).lastID;
      await new Promise((resolve, reject) => raw.close((e) => (e ? reject(e) : resolve())));

      // Boot through the real tracked migration path.
      process.env.WEA_SQLITE_PATH = oldDbPath;
      await storage.closeSqliteDb();
      await initMetadataStore();

      try {
        const ledger = await dbQuery(
          'SELECT filename FROM _schema_migrations ORDER BY filename'
        );
        const files = ledger.rows.map((r) => r.filename);
        expect(files.some((f) => f.startsWith('001_'))).toBe(true);
        expect(files.some((f) => f.startsWith('002_'))).toBe(true);

        const rows = await dbQuery(
          'SELECT id, name, type, deleted_at FROM file_nodes ORDER BY id'
        );
        expect(rows.rows.map((r) => r.id)).toEqual([rootId, childId]);
        expect(rows.rows.every((r) => r.deleted_at === null)).toBe(true);

        const childName = rows.rows[1].name;
        await expect(
          dbRun(
            'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, ?)',
            [rootId, childName, 'file', 'active']
          )
        ).rejects.toThrow();
        await dbRun('UPDATE file_nodes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [childId]);
        await dbRun(
          'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, ?)',
          [rootId, childName, 'file', 'active']
        );

        const residue = await dbQuery(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%rebuild%'"
        );
        expect(residue.rows).toHaveLength(0);

        const fk = await dbQuery('PRAGMA foreign_keys');
        expect(fk.rows[0].foreign_keys).toBe(1);
        const fkIssues = await dbQuery('PRAGMA foreign_key_check');
        expect(fkIssues.rows).toHaveLength(0);

        const newNode = await dbRun(
          'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (NULL, ?, ?, ?)',
          [`post-migration-${Date.now()}`, 'file', 'active']
        );
        expect(newNode.lastID).toBeGreaterThan(childId);

        await applyPendingMigrations('sqlite');
        const ledgerAfter = await dbQuery('SELECT COUNT(*) AS n FROM _schema_migrations');
        expect(ledgerAfter.rows[0].n).toBe(files.length);
      } finally {
        process.env.WEA_SQLITE_PATH = prevPath;
        await storage.closeSqliteDb().catch(() => {});
        await fs.promises.unlink(oldDbPath).catch(() => {});
      }
    });
  });

  describe('schema-less sqlite target via explicit connection', () => {
    it('applies the full DDL chain and records both migrations', async () => {
      const targetPath = path.join(os.tmpdir(), `wea-target-${crypto.randomUUID()}.db`);
      const raw = new sqlite3.Database(targetPath);

      try {
        await applyPendingMigrations('sqlite', { sqliteConnection: raw });

        const columns = await allOn(raw, 'PRAGMA table_info(file_nodes)');
        expect(columns.map((c) => c.name)).toContain('deleted_at');

        const ledger = await allOn(
          raw,
          'SELECT filename FROM _schema_migrations ORDER BY filename'
        );
        expect(ledger.some((r) => r.filename.startsWith('001_'))).toBe(true);
        expect(ledger.some((r) => r.filename.startsWith('002_'))).toBe(true);

        const rootId = (
          await runOn(
            raw,
            'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (NULL, ?, ?, ?)',
            [`target-root-${Date.now()}`, 'directory', 'active']
          )
        ).lastID;
        const dup = `target-child-${Date.now()}`;
        await runOn(
          raw,
          'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, ?)',
          [rootId, dup, 'file', 'active']
        );
        await expect(
          runOn(
            raw,
            'INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, ?)',
            [rootId, dup, 'file', 'active']
          )
        ).rejects.toThrow();
      } finally {
        await new Promise((resolve) => raw.close(() => resolve()));
        await fs.promises.unlink(targetPath).catch(() => {});
      }
    });
  });
});
