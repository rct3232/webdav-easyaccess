/**
 * storage tests.
 * Verifies getBackend() deprecation logic and postgres infrastructure helpers.
 */
const storage = require('@server/store/storage');

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

  it('returns postgresql for fs backend with deprecation warning', () => {
    process.env.WEA_STORAGE_BACKEND = 'fs';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
    expect(warnSpy).toHaveBeenCalledWith(
      'DEPRECATION: WEA_STORAGE_BACKEND=fs is deprecated. Falling back to postgresql.'
    );
    warnSpy.mockRestore();
  });

  it('returns postgresql for webdav backend with deprecation warning', () => {
    process.env.WEA_STORAGE_BACKEND = 'webdav';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
    expect(warnSpy).toHaveBeenCalledWith(
      "DEPRECATION: WEA_STORAGE_BACKEND=webdav is deprecated. Falling back to postgresql."
    );
    warnSpy.mockRestore();
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

  it('defaults to postgresql for empty/undefined value with deprecation warning', () => {
    delete process.env.WEA_STORAGE_BACKEND;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = require('@server/store/storage');
    expect(storage.getBackend()).toBe('postgresql');
    expect(warnSpy).toHaveBeenCalledWith(
      "DEPRECATION: WEA_STORAGE_BACKEND=(default) is deprecated. Falling back to postgresql."
    );
    warnSpy.mockRestore();
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
    const Pool = jest.fn(() => ({ connect, end: jest.fn() }));
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
    const Pool = jest.fn(() => ({ connect, end: jest.fn() }));
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
