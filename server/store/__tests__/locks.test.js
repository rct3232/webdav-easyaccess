/**
 * locks store tests.
 * Verifies acquireLock, withLock: acquire and release, exclusive access.
 */
const locks = require('../locks');
const { createTestDatabase } = require('../../test-utils');

describe('locks store', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('acquireLock / release', () => {
    it('acquires lock and returns token and release function', async () => {
      const lock = await locks.acquireLock('test-lock-1', { ttlMs: 5000, waitMs: 1000 });
      expect(lock.token).toBeDefined();
      expect(lock.lockPath).toBeDefined();
      expect(typeof lock.release).toBe('function');
      await lock.release();
    });

    it('release allows re-acquisition', async () => {
      const lock1 = await locks.acquireLock('test-lock-2', { ttlMs: 5000, waitMs: 1000 });
      await lock1.release();
      const lock2 = await locks.acquireLock('test-lock-2', { ttlMs: 5000, waitMs: 1000 });
      expect(lock2).toBeDefined();
      await lock2.release();
    });
  });

  describe('release double-call', () => {
    it('second release is no-op and does not throw', async () => {
      const lock = await locks.acquireLock('test-double-release', { ttlMs: 5000, waitMs: 1000 });
      await lock.release();
      await lock.release(); // second call: no-op, must not throw
    });
  });

  describe('withLock', () => {
    it('runs function and releases lock', async () => {
      let executed = false;
      await locks.withLock('test-with-lock', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('returns function result', async () => {
      const result = await locks.withLock('test-with-lock-result', async () => 'hello');
      expect(result).toBe('hello');
    });
  });

  describe('postgresql lock strategy', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      jest.resetModules();
      process.env = {
        ...originalEnv,
        WEA_STORAGE_BACKEND: 'postgresql',
      };
    });

    afterEach(() => {
      jest.dontMock('../storage');
      process.env = { ...originalEnv };
    });

    function createFakePgPool(seed = {}) {
      const state = {
        row: seed.row || null,
      };

      return {
        state,
        query: jest.fn(async (sql, params) => {
          if (sql.startsWith('DELETE FROM locks WHERE lock_name_hash = $1 AND expires_at < NOW()')) {
            const [lockKey] = params;
            if (state.row && state.row.lockKey === lockKey && state.row.expiresAt.getTime() < Date.now()) {
              state.row = null;
              return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
          }

          if (sql.includes('INSERT INTO locks') && sql.includes('ON CONFLICT')) {
            const [lockKey, token, owner, createdAt, expiresAt] = params;
            if (state.row && state.row.lockKey === lockKey) {
              return { rowCount: 0, rows: [] };
            }
            state.row = { lockKey, token, owner, createdAt, expiresAt };
            return { rowCount: 1, rows: [{ lock_name_hash: lockKey }] };
          }

          if (sql.startsWith('DELETE FROM locks WHERE lock_name_hash = $1 AND token = $2')) {
            const [lockKey, token] = params;
            if (state.row && state.row.lockKey === lockKey && state.row.token === token) {
              state.row = null;
              return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
          }

          throw new Error(`Unexpected SQL in test: ${sql}`);
        }),
      };
    }

    it('removes expired row and acquires lock', async () => {
      const fakePool = createFakePgPool({
        row: {
          lockKey: null, // replaced after hash is known
          token: 'stale-token',
          owner: 'old-owner',
          createdAt: new Date(Date.now() - 5_000),
          expiresAt: new Date(Date.now() - 1_000),
        },
      });

      let isolatedLocks;
      const { sha256HexLower } = require('../metaPaths');
      const expectedKey = sha256HexLower('pg-lock-stale-cleanup');
      fakePool.state.row.lockKey = expectedKey;

      jest.doMock('../storage', () => ({
        getBackend: () => 'postgresql',
        getPgPool: () => fakePool,
        ensureDir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        deletePath: jest.fn(),
      }));

      jest.isolateModules(() => {
        isolatedLocks = require('../locks');
      });

      const lock = await isolatedLocks.acquireLock('pg-lock-stale-cleanup', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(lock.token).toBeDefined();
      expect(typeof lock.release).toBe('function');
      expect(fakePool.state.row?.token).toBe(lock.token);
      await lock.release();
      expect(fakePool.state.row).toBeNull();
    });

    it('does not release when ownership token no longer matches', async () => {
      const fakePool = createFakePgPool();
      let isolatedLocks;

      jest.doMock('../storage', () => ({
        getBackend: () => 'postgresql',
        getPgPool: () => fakePool,
        ensureDir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        deletePath: jest.fn(),
      }));

      jest.isolateModules(() => {
        isolatedLocks = require('../locks');
      });

      const lock = await isolatedLocks.acquireLock('pg-lock-ownership', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(fakePool.state.row).not.toBeNull();

      // Simulate ownership change by another contender before release.
      fakePool.state.row.token = 'different-token';
      await lock.release();
      expect(fakePool.state.row).not.toBeNull();

      await expect(
        isolatedLocks.acquireLock('pg-lock-ownership', {
          ttlMs: 1000,
          waitMs: 20,
          retryDelayMs: 1,
        })
      ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });

      // Make lock stale so cleanup path can recover.
      fakePool.state.row.expiresAt = new Date(Date.now() - 1000);
      const reacquired = await isolatedLocks.acquireLock('pg-lock-ownership', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      await reacquired.release();
      expect(fakePool.state.row).toBeNull();
    });

    it('allows a single owner at a time under contention and times out contenders', async () => {
      const fakePool = createFakePgPool();
      let isolatedLocks;

      jest.doMock('../storage', () => ({
        getBackend: () => 'postgresql',
        getPgPool: () => fakePool,
        ensureDir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        deletePath: jest.fn(),
      }));

      jest.isolateModules(() => {
        isolatedLocks = require('../locks');
      });

      const owner = await isolatedLocks.acquireLock('pg-lock-contention', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });

      await expect(
        isolatedLocks.acquireLock('pg-lock-contention', {
          ttlMs: 1000,
          waitMs: 15,
          retryDelayMs: 1,
        })
      ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });

      await owner.release();

      const nextOwner = await isolatedLocks.acquireLock('pg-lock-contention', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(nextOwner.token).toBeDefined();
      await nextOwner.release();
      expect(fakePool.state.row).toBeNull();
    });
  });
});
