/**
 * storage tests.
 * Verifies presence-based backend selection in getBackend() and postgres
 * infrastructure helpers. Backend decision: any of the four WEA_DB_* identity
 * keys set → remote PostgreSQL; none set → sqlite (docs/spec/server/store/
 * storage.md §2.4). There is no WEA_STORAGE_BACKEND key anymore.
 */

jest.mock('../../infrastructure/backendHealth', () => {
  const report = jest.fn();
  return { getBackendHealth: () => ({ report }) };
});

const healthReport = () => require('../../infrastructure/backendHealth').getBackendHealth().report;

const DB_IDENTITY_KEYS = ['WEA_DB_HOST', 'WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD'];

function setRemoteDbEnv() {
  process.env.WEA_DB_HOST = 'localhost';
  process.env.WEA_DB_PORT = '5432';
  process.env.WEA_DB_DATABASE = 'testdb';
  process.env.WEA_DB_USER = 'test';
  process.env.WEA_DB_PASSWORD = 'secret';
  delete process.env.WEA_STORAGE_BACKEND;
}

function clearRemoteDbEnv() {
  for (const key of DB_IDENTITY_KEYS) delete process.env[key];
}

describe('getBackend (presence-based metadata backend)', () => {
  const originalEnv = {};
  for (const key of DB_IDENTITY_KEYS) originalEnv[key] = process.env[key];
  const originalConsoleWarn = console.warn;

  afterEach(() => {
    // Reset environment and modules
    for (const key of DB_IDENTITY_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    delete process.env.WEA_STORAGE_BACKEND;
    jest.resetModules();
    console.warn = originalConsoleWarn;
  });

  it('defaults to sqlite when no WEA_DB_* identity key is set', () => {
    clearRemoteDbEnv();
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('sqlite');
    expect(storage.hasRemoteDbCredentials()).toBe(false);
  });

  it('resolves postgresql when all four WEA_DB_* identity keys are set', () => {
    setRemoteDbEnv();
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
    expect(storage.hasRemoteDbCredentials()).toBe(true);
  });

  it('throws listing the missing WEA_DB_* keys on a partial credential set', () => {
    process.env.WEA_DB_HOST = 'db.local';
    process.env.WEA_DB_USER = 'user';
    const storage = require('@server/store/storage');
    expect(storage.hasRemoteDbCredentials()).toBe(true);
    expect(() => storage.getBackend()).toThrow(/Partial WEA_DB_\* configuration/);
    expect(() => storage.getBackend()).toThrow(/WEA_DB_DATABASE/);
    expect(() => storage.getBackend()).toThrow(/WEA_DB_PASSWORD/);
  });

  it('a single WEA_DB_* identity key opts into the remote backend and fails loudly', () => {
    process.env.WEA_DB_HOST = 'db.local';
    const storage = require('@server/store/storage');
    expect(storage.hasRemoteDbCredentials()).toBe(true);
    expect(() => storage.getBackend()).toThrow(/missing WEA_DB_DATABASE/);
  });

  it('silently ignores a leftover WEA_STORAGE_BACKEND value (presence decides)', () => {
    clearRemoteDbEnv();
    process.env.WEA_STORAGE_BACKEND = 'postgresql';
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('sqlite');
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
    setRemoteDbEnv();
    const isolatedStorage = require('@server/store/storage');
    expect(isolatedStorage.getBackend()).toBe('postgresql');
  });

  it('withTransaction commits on success', async () => {
    setRemoteDbEnv();

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
    setRemoteDbEnv();

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
    setRemoteDbEnv();
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
