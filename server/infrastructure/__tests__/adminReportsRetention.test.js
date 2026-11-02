'use strict';

/**
 * Admin-reports retention (admin.md §2.2.6 / maintenanceScheduler §3.4):
 * append-only writer + scheduled, lock-guarded, bounded-batch prune.
 */
const {
  runAdminReportsRetention,
  startAdminReportsRetentionScheduler,
  shouldSkipAdminReportsRetention,
} = require('../maintenanceScheduler');

const DAY_MS = 86400000;
const NOW = Date.parse('2026-10-23T00:00:00.000Z');

function fakeStore(rows) {
  const state = rows.slice();
  const calls = [];
  return {
    state,
    calls,
    async deleteReportsOlderThan(cutoffMs, opts = {}) {
      calls.push({ cutoffMs, opts });
      const limit = Number(opts.limit) || Infinity;
      const victims = state
        .filter((row) => row.createdAt < cutoffMs)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      const ids = new Set(victims.map((row) => row.id));
      for (let i = state.length - 1; i >= 0; i -= 1) {
        if (ids.has(state[i].id)) state.splice(i, 1);
      }
      return { changes: victims.length };
    },
  };
}

function fakeLock({ held = false } = {}) {
  const acquired = [];
  const released = [];
  return {
    acquired,
    released,
    async acquireLock(name, opts) {
      if (held) {
        const err = new Error('locked');
        err.code = 'LOCK_TIMEOUT';
        throw err;
      }
      const lock = { name, opts, release: async () => released.push(name) };
      acquired.push(lock);
      return lock;
    },
  };
}

describe('runAdminReportsRetention', () => {
  const old = (id, days) => ({ id, createdAt: NOW - days * DAY_MS });
  const fresh = (id) => ({ id, createdAt: NOW });

  it('deletes rows older than the horizon in bounded batches and releases the lock', async () => {
    const store = fakeStore([old(1, 40), old(2, 35), old(3, 31), fresh(4)]);
    const locks = fakeLock();

    const result = await runAdminReportsRetention({
      store,
      now: () => NOW,
      retentionDays: 30,
      batchSize: 2,
      lockManager: locks,
    });

    expect(result).toEqual({ deleted: 3, cutoffMs: NOW - 30 * DAY_MS });
    expect(store.calls).toHaveLength(2);
    expect(store.calls[0].opts).toEqual({ limit: 2 });
    expect(store.state.map((row) => row.id)).toEqual([4]);
    expect(locks.acquired).toHaveLength(1);
    expect(locks.released).toEqual(['admin-reports-retention']);
  });

  it('resolves the hot retention horizon from the service when not overridden', async () => {
    const service = require('../../domains/admin/services/adminReportsService');
    const spy = jest.spyOn(service, 'resolveAdminReportsRetentionDays').mockResolvedValue(30);
    const store = fakeStore([old(1, 40), fresh(2)]);
    try {
      const result = await runAdminReportsRetention({
        store,
        now: () => NOW,
        batchSize: 10,
        lockManager: fakeLock(),
      });
      expect(spy).toHaveBeenCalled();
      expect(result).toMatchObject({ deleted: 1, cutoffMs: NOW - 30 * DAY_MS });
    } finally {
      spy.mockRestore();
    }
  });

  it('is a no-op when the retention horizon is 0 (off)', async () => {
    const store = fakeStore([old(1, 400)]);
    const result = await runAdminReportsRetention({
      store,
      now: () => NOW,
      retentionDays: 0,
      batchSize: 10,
      lockManager: fakeLock(),
    });
    expect(result).toEqual({ deleted: 0, skipped: 'retention_off' });
    expect(store.calls).toHaveLength(0);
  });

  it('skips when another replica holds the retention lock', async () => {
    const store = fakeStore([old(1, 400)]);
    const result = await runAdminReportsRetention({
      store,
      now: () => NOW,
      retentionDays: 30,
      batchSize: 10,
      lockManager: fakeLock({ held: true }),
    });
    expect(result).toEqual({ deleted: 0, skipped: 'locked' });
    expect(store.calls).toHaveLength(0);
  });

  it('propagates store failures to the caller (scheduler logs/retries)', async () => {
    const store = {
      deleteReportsOlderThan: jest.fn(() => Promise.reject(new Error('db gone'))),
    };
    await expect(
      runAdminReportsRetention({
        store,
        now: () => NOW,
        retentionDays: 30,
        batchSize: 10,
        lockManager: fakeLock(),
      })
    ).rejects.toThrow('db gone');
  });
});

describe('startAdminReportsRetentionScheduler', () => {
  const saved = process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION;
  afterEach(() => {
    jest.useRealTimers();
    if (saved === undefined) delete process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION;
    else process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION = saved;
  });

  it('returns null under the skip seam', () => {
    process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION = '1';
    expect(shouldSkipAdminReportsRetention()).toBe(true);
    expect(
      startAdminReportsRetentionScheduler({
        store: fakeStore([]),
        intervalMs: 1000,
        lockManager: fakeLock(),
      })
    ).toBeNull();
  });

  it('returns null when the interval is 0', () => {
    delete process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION;
    expect(
      startAdminReportsRetentionScheduler({
        store: fakeStore([]),
        intervalMs: 0,
        lockManager: fakeLock(),
      })
    ).toBeNull();
  });

  it('runs the prune on the interval', async () => {
    delete process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION;
    jest.useFakeTimers();
    const store = fakeStore([{ id: 1, createdAt: NOW - 400 * DAY_MS }]);
    const timer = startAdminReportsRetentionScheduler({
      store,
      now: () => NOW,
      retentionDays: 30,
      batchSize: 10,
      lockManager: fakeLock(),
      intervalMs: 1000,
    });
    expect(timer).not.toBeNull();
    await jest.advanceTimersByTimeAsync(1000);
    expect(store.state).toHaveLength(0);
    clearTimeout(timer);
  });
});
