/**
 * storage tests.
 * Verifies getBackend() deprecation logic and postgres infrastructure helpers.
 */

jest.mock('../../infrastructure/backendHealth', () => {
  const report = jest.fn();
  return { getBackendHealth: () => ({ report }) };
});

const healthReport = () =>
  require('../../infrastructure/backendHealth').getBackendHealth().report;

describe('getBackend', () => {
  const originalEnv = process.env.WEA_STORAGE_BACKEND;
  const originalConsoleWarn = console.warn;

  afterEach(() => {
    // Reset environment and modules
    if (originalEnv === undefined) {
      delete process.env.WEA_STORAGE_BACKEND;
    } else {
      process.env.WEA_STORAGE_BACKEND = originalEnv;
    }
    jest.resetModules();
    console.warn = originalConsoleWarn;
  });

  it('throws for fs backend (removed in Phase 7)', () => {
    process.env.WEA_STORAGE_BACKEND = 'fs';
    const storage = require('@server/store/storage');
    expect(() => storage.getBackend()).toThrow(/Invalid WEA_STORAGE_BACKEND='fs'/);
  });

  it('throws for webdav backend (removed in Phase 7)', () => {
    process.env.WEA_STORAGE_BACKEND = 'webdav';
    const storage = require('@server/store/storage');
    expect(() => storage.getBackend()).toThrow(/Invalid WEA_STORAGE_BACKEND='webdav'/);
  });

  it('passes through postgresql unchanged', () => {
    process.env.WEA_STORAGE_BACKEND = 'postgresql';
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
  });

  it('passes through sqlite unchanged', () => {
    process.env.WEA_STORAGE_BACKEND = 'sqlite';
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('sqlite');
  });

  it('defaults to sqlite for empty/undefined value', () => {
    delete process.env.WEA_STORAGE_BACKEND;
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('sqlite');
  });

  it('passes through pg alias', () => {
    process.env.WEA_STORAGE_BACKEND = 'pg';
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
  });

  it('passes through postgres alias', () => {
    process.env.WEA_STORAGE_BACKEND = 'postgres';
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
  });
});

describe('postgres infrastructure helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    jest.dontMock('pg');
    const isolatedStorage = require('@server/store/storage');
    await isolatedStorage.closePgPool();
    process.env = { ...originalEnv };
  });

  it('getBackend resolves postgresql backend', () => {
    process.env.WEA_STORAGE_BACKEND = 'postgresql';
    const isolatedStorage = require('@server/store/storage');
    expect(isolatedStorage.getBackend()).toBe('postgresql');
  });

  it('withTransaction commits on success', async () => {
    process.env.WEA_STORAGE_BACKEND = 'postgresql';
    process.env.WEA_PG_HOST = 'localhost';
    process.env.WEA_PG_PORT = '5432';
    process.env.WEA_PG_DATABASE = 'testdb';
    process.env.WEA_PG_USER = 'test';
    process.env.WEA_PG_PASSWORD = 'secret';

    const query = jest.fn(async (sql) => ({ rows: [{ sql }] }));
    const client = {
      query,
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);
    const Pool = jest.fn(() => ({ connect, end: jest.fn(), on: jest.fn() }));
    jest.doMock('pg', () => ({ Pool }));

    let isolatedStorage;
    jest.isolateModules(() => {
      isolatedStorage = require('@server/store/storage');
    });
    const result = await isolatedStorage.withTransaction(async (dbClient) => {
      const q = await dbClient.query('SELECT 1');
      return q.rows[0].sql;
    });

    expect(result).toBe('SELECT 1');
    expect(query.mock.calls.map((args) => args[0])).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });

  it('withTransaction rolls back and maps DB errors', async () => {
    process.env.WEA_STORAGE_BACKEND = 'postgresql';
    process.env.WEA_PG_HOST = 'localhost';
    process.env.WEA_PG_PORT = '5432';
    process.env.WEA_PG_DATABASE = 'testdb';
    process.env.WEA_PG_USER = 'test';
    process.env.WEA_PG_PASSWORD = 'secret';

    const query = jest.fn(async () => ({ rows: [] }));
    const client = {
      query,
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);
    const Pool = jest.fn(() => ({ connect, end: jest.fn(), on: jest.fn() }));
    jest.doMock('pg', () => ({ Pool }));

    let isolatedStorage;
    jest.isolateModules(() => {
      isolatedStorage = require('@server/store/storage');
    });
    await expect(
      isolatedStorage.withTransaction(async () => {
        throw { code: '23505', constraint: 'users_email_key' };
      })
    ).rejects.toMatchObject({
      status: 409,
      errorCode: 'serverErrors.errorHandler.databaseConflict',
    });

    expect(query.mock.calls.map((args) => args[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('postgres backend health reporting', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.WEA_STORAGE_BACKEND = 'postgresql';
    process.env.WEA_PG_HOST = 'localhost';
    process.env.WEA_PG_PORT = '5432';
    process.env.WEA_PG_DATABASE = 'testdb';
    process.env.WEA_PG_USER = 'test';
    process.env.WEA_PG_PASSWORD = 'secret';
  });

  afterEach(async () => {
    jest.dontMock('pg');
    const isolatedStorage = require('@server/store/storage');
    await isolatedStorage.closePgPool();
    process.env = { ...originalEnv };
  });

  it('pool error handler reports postgresql unreachable', async () => {
    let poolErrorHandler;
    const connect = jest.fn().mockResolvedValue({ query: jest.fn(), release: jest.fn() });
    const Pool = jest.fn(() => ({
      connect,
      end: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'error') poolErrorHandler = cb;
      }),
    }));
    jest.doMock('pg', () => ({ Pool }));

    let isolatedStorage;
    jest.isolateModules(() => {
      isolatedStorage = require('@server/store/storage');
    });

    const pool = isolatedStorage.getPgPool();
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));

    poolErrorHandler(new Error('Connection terminated unexpectedly'));

    expect(healthReport()).toHaveBeenCalledWith('postgresql', {
      ok: false,
      code: 'unreachable',
      reason: 'Connection terminated unexpectedly',
    });
  });

  it('withTransaction reports postgresql ok after connect succeeds', async () => {
    const query = jest.fn(async (sql) => ({ rows: [{ sql }] }));
    const client = { query, release: jest.fn() };
    const connect = jest.fn().mockResolvedValue(client);
    const Pool = jest.fn(() => ({ connect, end: jest.fn(), on: jest.fn() }));
    jest.doMock('pg', () => ({ Pool }));

    let isolatedStorage;
    jest.isolateModules(() => {
      isolatedStorage = require('@server/store/storage');
    });

    await isolatedStorage.withTransaction(async (dbClient) => {
      const q = await dbClient.query('SELECT 1');
      return q.rows[0].sql;
    });

    expect(healthReport()).toHaveBeenCalledWith('postgresql', { ok: true });
  });

  it('withTransaction reports postgresql unreachable when connect fails', async () => {
    const connect = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const Pool = jest.fn(() => ({ connect, end: jest.fn(), on: jest.fn() }));
    jest.doMock('pg', () => ({ Pool }));

    let isolatedStorage;
    jest.isolateModules(() => {
      isolatedStorage = require('@server/store/storage');
    });

    await expect(isolatedStorage.withTransaction(async () => {})).rejects.toThrow();

    expect(healthReport()).toHaveBeenCalledWith('postgresql', {
      ok: false,
      code: 'unreachable',
      reason: 'connect ECONNREFUSED',
    });
  });
});
