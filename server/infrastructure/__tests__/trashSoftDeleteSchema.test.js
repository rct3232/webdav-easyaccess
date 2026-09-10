'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { applyPendingMigrations } = require('../schemaManager');

// sqlite-only describes are gated off the PG adapter leg (it exports WEA_TEST_PG_HOST)
const describeSqliteOnly = process.env.WEA_TEST_PG_HOST ? describe.skip : describe;

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

describe('trash soft-delete schema (ddl/001)', () => {
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

  describeSqliteOnly('schema-less sqlite target via explicit connection', () => {
    it('applies the full DDL chain and records the 001 migration', async () => {
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
