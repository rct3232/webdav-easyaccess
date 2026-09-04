/**
 * locks store tests.
 * Verifies acquireLock, withLock: acquire and release, exclusive access.
 */
const locks = require('../lockManager');
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
        WEA_DB_HOST: 'localhost',
        WEA_DB_DATABASE: 'testdb',
        WEA_DB_USER: 'test',
        WEA_DB_PASSWORD: 'secret',
      };
      delete process.env.WEA_STORAGE_BACKEND;
    });

    afterEach(() => {
      jest.dontMock('../../store/storage');
      process.env = { ...originalEnv };
    });

    function createFakePgPool(seed = {}) {
      const state = {
        row: seed.row || null,
      };

      // Operation-keyed routing (no full SQL-text matching): the two DELETE
      // operations are distinguished by param count — stale cleanup passes only
      // the lock key, release passes lock key + ownership token.
      return {
        state,
        query: jest.fn(async (sql, params) => {
          const s = String(sql);

          if (s.includes('INSERT INTO locks')) {
            // acquireLock: INSERT ... ON CONFLICT DO NOTHING
            const [lockKey, token, owner, createdAt, expiresAt] = params;
            if (state.row && state.row.lockKey === lockKey) {
              return { rowCount: 0, rows: [] };
            }
            state.row = { lockKey, token, owner, createdAt, expiresAt };
            return { rowCount: 1, rows: [{ lock_name_hash: lockKey }] };
          }

          if (s.includes('DELETE FROM locks')) {
            const [lockKey] = params;
            if (params.length === 1) {
              // stale cleanup: remove only when the held row is expired
              if (
                state.row &&
                state.row.lockKey === lockKey &&
                state.row.expiresAt.getTime() < Date.now()
              ) {
                state.row = null;
                return { rowCount: 1, rows: [] };
              }
              return { rowCount: 0, rows: [] };
            }
            // release: remove only when the ownership token matches
            const token = params[1];
            if (state.row && state.row.lockKey === lockKey && state.row.token === token) {
              state.row = null;
              return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
          }

          throw new Error(`Unexpected SQL in test: ${s}`);
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
      const { sha256HexLower } = require('../../utils/hash');
      const expectedKey = sha256HexLower('pg-lock-stale-cleanup');
      fakePool.state.row.lockKey = expectedKey;

      jest.doMock('../../store/storage', () => ({
        getBackend: () => 'postgresql',
        getPgPool: () => fakePool,
        ensureDir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        deletePath: jest.fn(),
      }));

      jest.isolateModules(() => {
        isolatedLocks = require('../lockManager');
      });

      const lock = await isolatedLocks.acquireLock('pg-lock-stale-cleanup', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      // Acquiring despite a pre-seeded stale row proves the stale-cleanup ran
      // and the insert succeeded (otherwise the acquire would time out).
      expect(lock.token).toBeDefined();
      expect(typeof lock.release).toBe('function');
      await lock.release();

      // Release is effective: the lock can be acquired again immediately.
      const relock = await isolatedLocks.acquireLock('pg-lock-stale-cleanup', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(relock.token).toBeDefined();
      await relock.release();
    });

    it('does not release when ownership token no longer matches', async () => {
      const fakePool = createFakePgPool();
      let isolatedLocks;

      jest.doMock('../../store/storage', () => ({
        getBackend: () => 'postgresql',
        getPgPool: () => fakePool,
        ensureDir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        deletePath: jest.fn(),
      }));

      jest.isolateModules(() => {
        isolatedLocks = require('../lockManager');
      });

      const lock = await isolatedLocks.acquireLock('pg-lock-ownership', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(lock.token).toBeDefined();

      // Simulate ownership change by another contender before release. This
      // requires the fake row — there is no public API to change a lock owner.
      fakePool.state.row.token = 'different-token';
      await lock.release();

      // Public API verification: the mismatched-token release must NOT free the
      // lock, so a fresh acquire with the foreign owner must time out.
      await expect(
        isolatedLocks.acquireLock('pg-lock-ownership', {
          ttlMs: 1000,
          waitMs: 20,
          retryDelayMs: 1,
        })
      ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });

      // Make lock stale so the cleanup path can recover. This requires the fake
      // row — there is no public API to expire a held lock.
      fakePool.state.row.expiresAt = new Date(Date.now() - 1000);
      const reacquired = await isolatedLocks.acquireLock('pg-lock-ownership', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(reacquired.token).toBeDefined();
      await reacquired.release();

      // Release is effective: the lock can be acquired again immediately.
      const relock = await isolatedLocks.acquireLock('pg-lock-ownership', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(relock.token).toBeDefined();
      await relock.release();
    });

    it('allows a single owner at a time under contention and times out contenders', async () => {
      const fakePool = createFakePgPool();
      let isolatedLocks;

      jest.doMock('../../store/storage', () => ({
        getBackend: () => 'postgresql',
        getPgPool: () => fakePool,
        ensureDir: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn(),
        deletePath: jest.fn(),
      }));

      jest.isolateModules(() => {
        isolatedLocks = require('../lockManager');
      });

      const owner = await isolatedLocks.acquireLock('pg-lock-contention', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(owner.token).toBeDefined();

      // Contender times out while the owner holds the lock.
      await expect(
        isolatedLocks.acquireLock('pg-lock-contention', {
          ttlMs: 1000,
          waitMs: 15,
          retryDelayMs: 1,
        })
      ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });

      await owner.release();

      // Owner release frees the lock: a new acquire succeeds immediately.
      const nextOwner = await isolatedLocks.acquireLock('pg-lock-contention', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(nextOwner.token).toBeDefined();
      await nextOwner.release();

      // Second release is also effective: the lock is free again.
      const relock = await isolatedLocks.acquireLock('pg-lock-contention', {
        ttlMs: 1000,
        waitMs: 100,
        retryDelayMs: 1,
      });
      expect(relock.token).toBeDefined();
      await relock.release();
    });
  });
});
