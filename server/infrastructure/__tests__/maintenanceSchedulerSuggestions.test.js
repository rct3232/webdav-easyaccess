'use strict';

/**
 * File-suggestions expiry core + scheduler
 * (docs/spec/server/infrastructure/maintenanceScheduler.md §3.6). Unit suite —
 * no test database: the store facade is mocked, configResolver is stubbed, the
 * lock is a fake seam (the admin-reports retention tests are the precedent).
 */

let mockGetConfigSync = () => undefined;

jest.mock('../../store/fileSuggestionsStore', () => ({
  expireStale: jest.fn(() => Promise.resolve({ changes: 0, ids: [] })),
}));

jest.mock('../configResolver', () => ({
  getSharedResolver: () => ({
    getConfigSync: (key) => (mockGetConfigSync ? mockGetConfigSync(key) : undefined),
  }),
}));

const fileSuggestionsStore = require('../../store/fileSuggestionsStore');
const {
  shouldSkipSuggestionExpiry,
  resolveSuggestionExpiryIntervalMs,
  resolveSuggestionExpiryBatch,
  runFileSuggestionsExpiry,
  startFileSuggestionsExpiryScheduler,
} = require('../maintenanceScheduler');

const DAY_MS = 86400000;

function fakeLockManager(acquired = true) {
  const release = jest.fn(async () => {});
  return {
    acquireLock: jest.fn(async () => {
      if (!acquired) {
        const err = new Error('lock held');
        err.code = 'LOCK_TIMEOUT';
        throw err;
      }
      return { release };
    }),
    release,
  };
}

function fakeStore(batches) {
  const queue = [...batches];
  return {
    expireStale: jest.fn(async () => {
      const next = queue.length > 0 ? queue.shift() : 0;
      return { changes: next, ids: Array.from({ length: next }, (_, i) => i + 1) };
    }),
  };
}

describe('runFileSuggestionsExpiry (§3.6)', () => {
  afterEach(() => {
    mockGetConfigSync = () => undefined;
    delete process.env.WEA_SKIP_SUGGESTION_EXPIRY;
  });

  it('flips pending-past-expiry rows in bounded batches under the expiry lock', async () => {
    const store = fakeStore([3, 3, 1]);
    const locks = fakeLockManager();
    const now = () => Date.UTC(2030, 0, 1);
    mockGetConfigSync = (key) => (key === 'AI_SUGGESTION_EXPIRY_BATCH' ? '3' : undefined);

    const result = await runFileSuggestionsExpiry({ store, now, lockManager: locks });

    expect(result).toEqual({
      expired: 7,
      cutoffMs: Date.UTC(2030, 0, 1),
    });
    expect(store.expireStale).toHaveBeenCalledTimes(3);
    expect(store.expireStale).toHaveBeenCalledWith({
      now: Date.UTC(2030, 0, 1),
      limit: 3,
    });
    expect(locks.acquireLock).toHaveBeenCalledWith('file-suggestions-expiry', {
      ttlMs: 30 * 60 * 1000,
      waitMs: 0,
    });
    expect(locks.release).toHaveBeenCalledTimes(1);
  });

  it('a held lock ⇒ skipped (no store call)', async () => {
    const store = fakeStore([5]);
    const locks = fakeLockManager(false);
    await expect(runFileSuggestionsExpiry({ store, now: () => 1234, lockManager: locks })).resolves.toEqual({
      expired: 0,
      skipped: 'locked',
    });
    expect(store.expireStale).not.toHaveBeenCalled();
  });

  it('rejections propagate to the caller (the scheduler logs)', async () => {
    const store = { expireStale: jest.fn(() => Promise.reject(new Error('db down'))) };
    await expect(
      runFileSuggestionsExpiry({ store, now: () => Date.UTC(2030, 0, 1), lockManager: fakeLockManager() })
    ).rejects.toThrow('db down');
  });
});

describe('startFileSuggestionsExpiryScheduler (§3.6)', () => {
  afterEach(() => {
    mockGetConfigSync = () => undefined;
    delete process.env.WEA_SKIP_SUGGESTION_EXPIRY;
    jest.useRealTimers();
  });

  it('returns null under the WEA_SKIP_SUGGESTION_EXPIRY seam', () => {
    process.env.WEA_SKIP_SUGGESTION_EXPIRY = '1';
    expect(startFileSuggestionsExpiryScheduler({ store: fakeStore([0]) })).toBeNull();
  });

  it('returns null when the interval resolves to 0 (disabled)', () => {
    mockGetConfigSync = (key) => (key === 'AI_SUGGESTION_EXPIRY_INTERVAL_MS' ? '0' : undefined);
    expect(startFileSuggestionsExpiryScheduler({ store: fakeStore([0]) })).toBeNull();
  });

  it('re-arms at the hot interval and runs the expiry pass per tick', async () => {
    jest.useFakeTimers();
    const store = fakeStore([2, 0]);
    mockGetConfigSync = (key) =>
      key === 'AI_SUGGESTION_EXPIRY_INTERVAL_MS' ? String(DAY_MS) : undefined;
    const locks = fakeLockManager();

    const timer = startFileSuggestionsExpiryScheduler({ store, lockManager: locks, now: () => 999 });
    expect(timer).not.toBeNull();

    jest.advanceTimersByTime(DAY_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.expireStale).toHaveBeenCalled();

    jest.clearAllTimers();
  });
});

describe('expiry seam resolvers', () => {
  afterEach(() => {
    mockGetConfigSync = () => undefined;
  });

  it('shouldSkipSuggestionExpiry follows the truthy env idiom', () => {
    delete process.env.WEA_SKIP_SUGGESTION_EXPIRY;
    expect(shouldSkipSuggestionExpiry()).toBe(false);
    process.env.WEA_SKIP_SUGGESTION_EXPIRY = 'true';
    expect(shouldSkipSuggestionExpiry()).toBe(true);
    delete process.env.WEA_SKIP_SUGGESTION_EXPIRY;
  });

  it('interval default is 24h; batch default is 1000', () => {
    expect(resolveSuggestionExpiryIntervalMs()).toBe(DAY_MS);
    expect(resolveSuggestionExpiryBatch()).toBe(1000);
  });
});
