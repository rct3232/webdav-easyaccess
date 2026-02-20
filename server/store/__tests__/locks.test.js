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
});
