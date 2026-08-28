/**
 * withSqliteTransaction concurrency regression.
 *
 * node-sqlite3's db.serialize() only covers the synchronous portion of an async
 * callback, so concurrent withSqliteTransaction() calls could interleave
 * BEGIN/COMMIT and fail with "cannot start a transaction within a transaction".
 * Transactions are now serialized on a single promise chain (see storage.js).
 */
const storage = require('@server/store/storage');
const { createTestDatabase } = require('@server/test-utils');

describe('withSqliteTransaction concurrency', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  it('serializes concurrent transactions without nested BEGIN errors', async () => {
    await storage.sqliteRun(
      'CREATE TABLE IF NOT EXISTS wea_txn_test (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)'
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        storage.withSqliteTransaction(async (client) => {
          await client.query('INSERT INTO wea_txn_test (v) VALUES (?)', [`v${i}`]);
          const res = await client.query('SELECT COUNT(*) AS n FROM wea_txn_test');
          return res.rows[0].n;
        })
      )
    );

    expect(results).toHaveLength(10);
    expect(Math.max(...results)).toBe(10);
  });

  it('rolls back on error and does not poison the queue', async () => {
    await storage.sqliteRun(
      'CREATE TABLE IF NOT EXISTS wea_txn_rollback (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)'
    );

    await expect(
      storage.withSqliteTransaction(async (client) => {
        await client.query('INSERT INTO wea_txn_rollback (v) VALUES (?)', ['ok']);
        throw new Error('boom');
      })
    ).rejects.toThrow();

    const res = await storage.withSqliteTransaction(async (client) => {
      const out = await client.query('SELECT COUNT(*) AS n FROM wea_txn_rollback');
      return out.rows[0].n;
    });
    expect(res).toBe(0);
  });
});
