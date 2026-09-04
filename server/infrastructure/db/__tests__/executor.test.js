'use strict';

/**
 * Executor conformance tests (docs/spec/server/store/executor.md).
 * - sqlite: real temp DB via createTestDatabase (default CI leg).
 * - postgres: storage mocked with a jest Pool (real-PG semantics are covered
 *   by the repository conformance suites under the WEA_TEST_PG_* adapter leg).
 */

const { createTestDatabase } = require('@server/test-utils');

describe('sqliteExecutor (real temp sqlite DB)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('exposes the sqlite dialect via storage.getExecutor()', () => {
    const storage = require('@server/store/storage');
    const executor = storage.getExecutor();
    expect(executor.dialect).toBe('sqlite');
  });

  it('run returns changes and lastId for an autoincrement INSERT', async () => {
    const executor = require('@server/infrastructure/db/sqliteExecutor');
    const res = await executor.run(
      'INSERT INTO settings (key, value) VALUES (?, ?)',
      ['executor.spec.key', 'v1']
    );
    expect(res.changes).toBe(1);
    expect(res.lastId).toBeGreaterThan(0);
  });

  it('query returns plain rows', async () => {
    const executor = require('@server/infrastructure/db/sqliteExecutor');
    const { rows } = await executor.query('SELECT value FROM settings WHERE key = ?', [
      'executor.spec.key',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('v1');
  });

  it('transaction commits on success', async () => {
    const executor = require('@server/infrastructure/db/sqliteExecutor');
    await executor.transaction(async (tx) => {
      await tx.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['tx.key.ok', 'committed']);
    });
    const { rows } = await executor.query('SELECT value FROM settings WHERE key = ?', ['tx.key.ok']);
    expect(rows[0].value).toBe('committed');
  });

  it('transaction rolls back on throw (errors are mapped by the shared handler)', async () => {
    const executor = require('@server/infrastructure/db/sqliteExecutor');
    await expect(
      executor.transaction(async (tx) => {
        await tx.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['tx.key.rollback', 'x']);
        throw new Error('boom');
      })
    ).rejects.toMatchObject({ errorCode: 'serverErrors.errorHandler.databaseQueryFailed' });

    const { rows } = await executor.query('SELECT value FROM settings WHERE key = ?', [
      'tx.key.rollback',
    ]);
    expect(rows).toHaveLength(0);
  });

  it('isUniqueConflict classifies raw sqlite unique violations (raw driver shape)', async () => {
    const executor = require('@server/infrastructure/db/sqliteExecutor');
    // Raw driver shapes: node-sqlite3 reports code SQLITE_CONSTRAINT (+ suffix)
    // and a message naming the constraint. mapDatabaseError does NOT preserve
    // these, so callers must classify before mapping (see executor spec §2.2).
    expect(executor.isUniqueConflict({ code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'x' })).toBe(true);
    expect(
      executor.isUniqueConflict({ message: 'UNIQUE constraint failed: settings.key' })
    ).toBe(true);
    expect(executor.isUniqueConflict(new Error('something else'))).toBe(false);
    expect(executor.isUniqueConflict(null)).toBe(false);
  });
});

describe('postgresExecutor (storage/pool mocked)', () => {
  const originalEnv = { ...process.env };

  function setRemoteDbEnv() {
    process.env.WEA_DB_HOST = 'localhost';
    process.env.WEA_DB_PORT = '5432';
    process.env.WEA_DB_DATABASE = 'testdb';
    process.env.WEA_DB_USER = 'test';
    process.env.WEA_DB_PASSWORD = 'secret';
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    setRemoteDbEnv();
  });

  afterEach(async () => {
    jest.dontMock('pg');
    const isolatedStorage = require('@server/store/storage');
    await isolatedStorage.closePgPool();
    process.env = { ...originalEnv };
  });

  function isolateWithMockPool() {
    const connect = jest.fn();
    const poolQuery = jest.fn().mockResolvedValue({ rows: [] });
    const Pool = jest.fn(() => ({ connect, end: jest.fn(), on: jest.fn(), query: poolQuery }));
    jest.doMock('pg', () => ({ Pool }));

    // Require storage + executor fresh (after jest.resetModules in beforeEach)
    // so the pool built by storage.getPgPool() is the mocked Pool instance.
    const storage = require('@server/store/storage');
    const executor = require('@server/infrastructure/db/postgresExecutor');
    return { executor, storage, connect, poolQuery };
  }

  it('exposes the postgres dialect and getPgPool-based query', async () => {
    const { executor, storage, poolQuery } = isolateWithMockPool();
    expect(executor.dialect).toBe('postgres');

    poolQuery.mockResolvedValueOnce({ rows: [{ one: 1 }] });
    const { rows } = await executor.query('SELECT 1 AS one');
    expect(rows).toEqual([{ one: 1 }]);
    // The pool used is storage.getPgPool() (built once from the mocked Pool).
    const pool = storage.getPgPool();
    expect(pool.query).toBe(poolQuery);
  });

  it('run injects RETURNING <pk> once for single-PK INSERT and reports lastId', async () => {
    const { executor, poolQuery } = isolateWithMockPool();

    // 1st pool.query: PK introspection (pg_index); 2nd: the INSERT … RETURNING.
    poolQuery.mockResolvedValueOnce({ rows: [{ column_name: 'key' }] });
    poolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ key: 'k1' }] });

    const res = await executor.run('INSERT INTO settings (key, value) VALUES ($1, $2)', [
      'k1',
      'v',
    ]);
    expect(res.changes).toBe(1);
    expect(res.lastId).toBe('k1');
    expect(poolQuery.mock.calls[1][0]).toBe(
      'INSERT INTO settings (key, value) VALUES ($1, $2) RETURNING key'
    );
  });

  it('run leaves statements that already contain RETURNING untouched', async () => {
    const { executor, poolQuery } = isolateWithMockPool();
    poolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });

    const res = await executor.run('INSERT INTO users (username) VALUES ($1) RETURNING id', [
      'u',
    ]);
    expect(res.lastId).toBe(7);
    expect(poolQuery.mock.calls[0][0]).toMatch(/RETURNING id$/);
  });

  it('transaction issues BEGIN/COMMIT and releases the client', async () => {
    const { executor, connect } = isolateWithMockPool();
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const release = jest.fn();
    connect.mockResolvedValue({ query, release });

    await executor.transaction(async (tx) => {
      await tx.run('INSERT INTO settings (key, value) VALUES ($1, $2)', ['a', 'b']);
    });

    expect(query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'INSERT INTO settings (key, value) VALUES ($1, $2)',
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalled();
  });

  it('transaction rolls back and rethrows (mapped) on error', async () => {
    const { executor, connect } = isolateWithMockPool();
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const release = jest.fn();
    connect.mockResolvedValue({ query, release });

    await expect(
      executor.transaction(async () => {
        throw new Error('tx fail');
      })
    ).rejects.toMatchObject({ errorCode: 'serverErrors.errorHandler.databaseQueryFailed' });

    expect(query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalled();
  });

  it('isUniqueConflict detects PG 23505 only', () => {
    const { executor } = isolateWithMockPool();
    expect(executor.isUniqueConflict({ code: '23505' })).toBe(true);
    expect(executor.isUniqueConflict({ code: '23503' })).toBe(false);
    expect(executor.isUniqueConflict(new Error('x'))).toBe(false);
  });
});

describe('storage.getExecutor honours the test-only backend override', () => {
  afterEach(() => {
    const storage = require('@server/store/storage');
    storage.clearTestBackend();
  });

  it('returns the postgres executor while the override is active', () => {
    const storage = require('@server/store/storage');
    storage.setTestBackend('postgresql', { query: jest.fn(), end: jest.fn() });
    expect(storage.getExecutor().dialect).toBe('postgres');
  });

  it('returns the sqlite executor after the override is cleared', () => {
    const storage = require('@server/store/storage');
    storage.setTestBackend('postgresql', { query: jest.fn(), end: jest.fn() });
    storage.clearTestBackend();
    expect(storage.getExecutor().dialect).toBe('sqlite');
  });
});
