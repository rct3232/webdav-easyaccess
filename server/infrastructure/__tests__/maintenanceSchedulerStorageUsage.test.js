'use strict';

/**
 * Storage-usage snapshot core + scheduler
 * (docs/spec/server/infrastructure/maintenanceScheduler.md §3.7). Unit
 * suite — no test database: user/file/snapshot stores are fakes, the config
 * resolver is stubbed and the lock is a fake seam.
 */

let mockGetConfigSync = () => undefined;

jest.mock('../configResolver', () => ({
  getSharedResolver: () => ({
    getConfigSync: (key) => (mockGetConfigSync ? mockGetConfigSync(key) : undefined),
  }),
}));

const {
  shouldSkipStorageUsageSnapshot,
  resolveStorageUsageSnapshotIntervalMs,
  resolveStorageUsageRetentionDays,
  runStorageUsageSnapshot,
  startStorageUsageSnapshotScheduler,
} = require('../maintenanceScheduler');

const DAY_MS = 86400000;
const NOW = Date.UTC(2030, 0, 15, 12); // 2030-01-15 UTC

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

function fakeUsers() {
  return {
    findAll: jest.fn(async () => [
      { id: 1, is_admin: 0 },
      { id: 2, is_admin: 1 },
      { id: 3, is_admin: 0 },
      { id: 4, is_admin: 0 },
    ]),
  };
}

function fakeFileNodes() {
  return {
    getUserRootNode: jest.fn(async (userId) => (Number(userId) === 4 ? null : { id: userId * 10 })),
    summarizeSubtreeStorageUsage: jest.fn(async (rootId) =>
      Number(rootId) === 30
        ? { bytes: 222, itemCount: 2, nullSizeCount: 2 }
        : { bytes: 111, itemCount: 1, nullSizeCount: 0 }
    ),
  };
}

function fakeSnapshots() {
  return {
    upsertSnapshot: jest.fn(async () => ({ changes: 1 })),
    deleteOlderThan: jest.fn(async () => ({ changes: 5 })),
  };
}

describe('runStorageUsageSnapshot (§3.7)', () => {
  afterEach(() => {
    mockGetConfigSync = () => undefined;
    delete process.env.WEA_SKIP_STORAGE_USAGE_SNAPSHOT;
  });

  it('captures one UTC-day snapshot per non-admin user with a root, under the cross-replica lock', async () => {
    const users = fakeUsers();
    const nodes = fakeFileNodes();
    const snapshots = fakeSnapshots();
    const locks = fakeLockManager();
    const log = { log: jest.fn(), warn: jest.fn() };

    const result = await runStorageUsageSnapshot({
      userStore: users,
      fileNodesStore: nodes,
      snapshotsStore: snapshots,
      now: () => NOW,
      retentionDays: 30,
      lockManager: locks,
      storageMode: 's3',
      log,
    });

    expect(locks.acquireLock).toHaveBeenCalledWith('storage-usage-snapshot', {
      ttlMs: 30 * 60 * 1000,
      waitMs: 0,
    });
    expect(locks.release).toHaveBeenCalledTimes(1);
    // admin (2) and root-less user (4) never snapshot; user 3 is skipped for
    // its NULL sizes — only user 1 is persisted.
    expect(snapshots.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshots.upsertSnapshot).toHaveBeenCalledWith({
      userId: 1,
      day: '2030-01-15',
      bytes: 111,
    });
    expect(nodes.summarizeSubtreeStorageUsage).toHaveBeenCalledWith(10, {
      includeVersions: true,
    });
    expect(nodes.summarizeSubtreeStorageUsage).toHaveBeenCalledWith(30, {
      includeVersions: true,
    });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('user 3 skipped'));
    expect(result).toEqual({
      captured: 1,
      skippedUsers: 1,
      pruned: 5,
      day: '2030-01-15',
    });
  });

  it('prunes rows older than the UTC retention cutoff', async () => {
    const snapshots = fakeSnapshots();
    await runStorageUsageSnapshot({
      userStore: fakeUsers(),
      fileNodesStore: fakeFileNodes(),
      snapshotsStore: snapshots,
      now: () => NOW,
      retentionDays: 30,
      lockManager: fakeLockManager(),
      storageMode: 's3',
      log: { log: jest.fn(), warn: jest.fn() },
    });

    expect(snapshots.deleteOlderThan).toHaveBeenCalledWith('2029-12-16');
  });

  it('WebDAV mode aggregates current filecache sizes (includeVersions=false)', async () => {
    const nodes = fakeFileNodes();
    await runStorageUsageSnapshot({
      userStore: fakeUsers(),
      fileNodesStore: nodes,
      snapshotsStore: fakeSnapshots(),
      now: () => NOW,
      retentionDays: 30,
      lockManager: fakeLockManager(),
      storageMode: 'webdav',
      log: { log: jest.fn(), warn: jest.fn() },
    });

    expect(nodes.summarizeSubtreeStorageUsage).toHaveBeenCalledWith(10, {
      includeVersions: false,
    });
  });

  it('skips the whole run when another replica holds the lock', async () => {
    const users = fakeUsers();
    const snapshots = fakeSnapshots();
    const result = await runStorageUsageSnapshot({
      userStore: users,
      fileNodesStore: fakeFileNodes(),
      snapshotsStore: snapshots,
      now: () => NOW,
      lockManager: fakeLockManager(false),
      storageMode: 's3',
    });

    expect(result).toEqual({ captured: 0, skipped: 'locked' });
    expect(users.findAll).not.toHaveBeenCalled();
    expect(snapshots.upsertSnapshot).not.toHaveBeenCalled();
  });

  it('rejections propagate to the caller (the scheduler logs)', async () => {
    const snapshots = fakeSnapshots();
    snapshots.upsertSnapshot.mockRejectedValueOnce(new Error('db down'));
    await expect(
      runStorageUsageSnapshot({
        userStore: fakeUsers(),
        fileNodesStore: fakeFileNodes(),
        snapshotsStore: snapshots,
        now: () => NOW,
        retentionDays: 30,
        lockManager: fakeLockManager(),
        storageMode: 's3',
      })
    ).rejects.toThrow('db down');
  });
});

describe('startStorageUsageSnapshotScheduler (§3.7)', () => {
  afterEach(() => {
    mockGetConfigSync = () => undefined;
    delete process.env.WEA_SKIP_STORAGE_USAGE_SNAPSHOT;
    jest.useRealTimers();
  });

  it('returns null under the WEA_SKIP_STORAGE_USAGE_SNAPSHOT seam', () => {
    process.env.WEA_SKIP_STORAGE_USAGE_SNAPSHOT = '1';
    expect(startStorageUsageSnapshotScheduler({ userStore: fakeUsers() })).toBeNull();
  });

  it('returns null when the interval resolves to 0 (disabled)', () => {
    mockGetConfigSync = (key) => (key === 'STORAGE_USAGE_SNAPSHOT_INTERVAL_MS' ? '0' : undefined);
    expect(startStorageUsageSnapshotScheduler({ userStore: fakeUsers() })).toBeNull();
  });

  it('re-arms at the hot interval and captures per tick (never at boot)', async () => {
    jest.useFakeTimers();
    const users = fakeUsers();
    const snapshots = fakeSnapshots();
    mockGetConfigSync = (key) =>
      key === 'STORAGE_USAGE_SNAPSHOT_INTERVAL_MS' ? String(DAY_MS) : undefined;

    const timer = startStorageUsageSnapshotScheduler({
      userStore: users,
      fileNodesStore: fakeFileNodes(),
      snapshotsStore: snapshots,
      now: () => NOW,
      retentionDays: 30,
      lockManager: fakeLockManager(),
      storageMode: 's3',
      log: { log: jest.fn(), warn: jest.fn() },
    });
    expect(timer).not.toBeNull();
    expect(snapshots.upsertSnapshot).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(DAY_MS);
    await Promise.resolve();
    expect(snapshots.upsertSnapshot).toHaveBeenCalled();

    jest.clearAllTimers();
  });
});

describe('storage-usage seam resolvers', () => {
  afterEach(() => {
    mockGetConfigSync = () => undefined;
  });

  it('shouldSkipStorageUsageSnapshot follows the truthy env idiom', () => {
    delete process.env.WEA_SKIP_STORAGE_USAGE_SNAPSHOT;
    expect(shouldSkipStorageUsageSnapshot()).toBe(false);
    process.env.WEA_SKIP_STORAGE_USAGE_SNAPSHOT = 'true';
    expect(shouldSkipStorageUsageSnapshot()).toBe(true);
    delete process.env.WEA_SKIP_STORAGE_USAGE_SNAPSHOT;
  });

  it('interval default is 24h; retention default is 30 days', () => {
    expect(resolveStorageUsageSnapshotIntervalMs()).toBe(DAY_MS);
    expect(resolveStorageUsageRetentionDays()).toBe(30);
  });
});
