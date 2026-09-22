'use strict';

/**
 * T0.12 driver-migration contract tests
 * (docs/spec/server/store/storage.md "sqlite driver" + executor.md §2.6).
 *
 * - Guard: no `sqlite3` npm require remains anywhere in server/ source.
 * - BigInt PK binding: integer PKs bind as exact 64-bit values through the
 *   DbExecutor interface (the sqlite3 npm driver truncated BigInt binds to
 *   their low 32 bits; node:sqlite stores them exactly).
 * - Driver identity: the storage seam hands out a node:sqlite DatabaseSync
 *   handle, not a sqlite3 npm Database.
 */

const fs = require('fs');
const path = require('path');

describe('sqlite driver migration (node:sqlite, T0.12)', () => {
  it('server source contains no sqlite3 npm requires', () => {
    const serverRoot = path.join(__dirname, '../../..');
    const offenders = [];
    const SKIP_DIRS = new Set(['node_modules', 'coverage', 'stryker-tmp']);

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(path.join(dir, entry.name));
        } else if (entry.name.endsWith('.js')) {
          const file = path.join(dir, entry.name);
          const source = fs.readFileSync(file, 'utf8');
          if (/require\(\s*['"]sqlite3['"]\s*\)/.test(source) || /from\s+['"]sqlite3['"]/.test(source)) {
            offenders.push(path.relative(serverRoot, file));
          }
        }
      }
    }

    walk(serverRoot);
    expect(offenders).toEqual([]);
  });

  describe('BigInt integer-PK binding through the executor', () => {
    let dbPath;

    beforeAll(async () => {
      dbPath = `/tmp/wea-driver-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
      process.env.WEA_SQLITE_PATH = dbPath;
      const { initMetadataStore } = require('@server/store/bootstrap');
      await initMetadataStore();
    });

    afterAll(async () => {
      const storage = require('@server/store/storage');
      try {
        await storage.closeSqliteDb();
      } catch {
        /* ignore */
      }
      delete process.env.WEA_SQLITE_PATH;
      try {
        fs.promises.unlink(dbPath).catch(() => {});
      } catch {
        /* ignore */
      }
    });

    it('binds a BigInt rowid exactly (64-bit, not truncated) via executor.run', async () => {
      const executor = require('@server/infrastructure/db/sqliteExecutor');
      // 2^53 + 1: the sqlite3 npm driver bound BigInts to their low 32 bits
      // (this value collapsed to 1), so an exact rowid is only possible on
      // node:sqlite. Plain-number params in the assertions prove the stored
      // INTEGER is the exact 64-bit value.
      const bigId = 9007199254740993n;

      const res = await executor.run(
        'INSERT INTO file_nodes (id, parent_id, name, type, sync_status) VALUES (?, NULL, ?, ?, ?)',
        [bigId, 'bigint-pk.txt', 'file', 'active']
      );
      expect(res.changes).toBe(1);

      const byBigInt = await executor.query('SELECT COUNT(*) AS n FROM file_nodes WHERE id = ?', [
        bigId,
      ]);
      expect(Number(byBigInt.rows[0].n)).toBe(1);

      // Decisive exactness check: plain-number comparison against the stored
      // rowid (0 rows under the old driver's 32-bit truncation).
      const byExactNumber = await executor.query(
        'SELECT COUNT(*) AS n FROM file_nodes WHERE id = ?',
        [9007199254740993]
      );
      expect(Number(byExactNumber.rows[0].n)).toBe(1);
    });
  });

  describe('storage seam exposes the node:sqlite driver', () => {
    it('getSqliteConnection returns a node:sqlite DatabaseSync handle', () => {
      const { DatabaseSync } = require('node:sqlite');
      const storage = require('@server/store/storage');
      const db = storage.getSqliteConnection();

      expect(db instanceof DatabaseSync).toBe(true);
      expect(typeof db.prepare).toBe('function');
      expect(typeof db.exec).toBe('function');
      // sqlite3 npm callback API is gone from the seam handle.
      expect(typeof db.run).not.toBe('function');
      expect(typeof db.all).not.toBe('function');

      const journalMode = db.prepare('PRAGMA journal_mode').get();
      expect(journalMode.journal_mode).toBe('wal');
    });
  });
});