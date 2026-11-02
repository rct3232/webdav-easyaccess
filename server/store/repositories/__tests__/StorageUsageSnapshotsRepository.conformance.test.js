'use strict';

/**
 * StorageUsageSnapshotsRepository L2 conformance
 * (docs/spec/server/store/storageUsageSnapshotsStore.md §2.4). Runs against
 * the ACTIVE backend via createTestDatabase() (sqlite default leg; real PG
 * adapter leg). Covers the one-row-per-user/day upsert (same-day bytes
 * overwrite, created_at preserved), ascending/inclusive range reads,
 * user scoping, retention deletion and FK cascade.
 */

const { createTestDatabase, dbQuery } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createStorageUsageSnapshotsRepository = require('@server/store/repositories/StorageUsageSnapshotsRepository');

describe('StorageUsageSnapshotsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let user;
  let otherUser;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createStorageUsageSnapshotsRepository(storage.getExecutor());
    const User = require('@server/models/User');
    seq += 1;
    const stamp = `${Date.now()}-${seq}`;
    user = await User.create(`conf-sus-${stamp}`, `conf-sus-${stamp}@conf.test`, 'pw', false);
    otherUser = await User.create(
      `conf-sus-o-${stamp}`,
      `conf-sus-o-${stamp}@conf.test`,
      'pw',
      false
    );
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('upserts a row and lists it domain-shaped, ascending by day', async () => {
    await repo.upsertSnapshot({ userId: user.id, day: '2099-01-02', bytes: 20 });
    await repo.upsertSnapshot({ userId: user.id, day: '2099-01-01', bytes: 10 });

    const rows = await repo.listForUser(user.id);
    const scoped = rows.filter((row) => row.day.startsWith('2099-01'));
    expect(scoped.map((row) => row.day)).toEqual(['2099-01-01', '2099-01-02']);
    expect(scoped[0]).toMatchObject({ userId: Number(user.id), day: '2099-01-01', bytes: 10 });
    expect(Number.isNaN(Date.parse(scoped[0].createdAt))).toBe(false);
  });

  it('a same-day upsert overwrites bytes and preserves created_at (PK collapse)', async () => {
    const day = '2098-12-05';
    await repo.upsertSnapshot({ userId: user.id, day, bytes: 100 });
    const before = (await repo.listForUser(user.id)).find((row) => row.day === day);
    expect(before.bytes).toBe(100);

    await repo.upsertSnapshot({ userId: user.id, day, bytes: 250 });
    const after = (await repo.listForUser(user.id)).find((row) => row.day === day);
    expect(after.bytes).toBe(250);
    expect(after.createdAt).toBe(before.createdAt);

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS count FROM storage_usage_snapshots WHERE user_id = ? AND day = ?',
      [Number(user.id), day]
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('scopes rows per user and supports inclusive day bounds', async () => {
    const base = '2098-11';
    await repo.upsertSnapshot({ userId: user.id, day: `${base}-10`, bytes: 10 });
    await repo.upsertSnapshot({ userId: user.id, day: `${base}-11`, bytes: 11 });
    await repo.upsertSnapshot({ userId: user.id, day: `${base}-12`, bytes: 12 });
    await repo.upsertSnapshot({ userId: otherUser.id, day: `${base}-11`, bytes: 99 });

    const bounded = await repo.listForUser(user.id, {
      fromDay: `${base}-11`,
      toDay: `${base}-12`,
    });
    expect(bounded.map((row) => row.bytes)).toEqual([11, 12]);
    expect(bounded.every((row) => row.userId === Number(user.id))).toBe(true);

    const other = await repo.listForUser(otherUser.id);
    expect(other.map((row) => row.bytes)).toEqual([99]);
  });

  it('deleteOlderThan deletes strictly older days and returns changes', async () => {
    const base = '2098-10';
    await repo.upsertSnapshot({ userId: user.id, day: `${base}-01`, bytes: 1 });
    await repo.upsertSnapshot({ userId: user.id, day: `${base}-02`, bytes: 2 });
    await repo.upsertSnapshot({ userId: user.id, day: `${base}-03`, bytes: 3 });

    const result = await repo.deleteOlderThan(`${base}-02`);
    expect(result.changes).toBeGreaterThanOrEqual(1);

    const remaining = (await repo.listForUser(user.id))
      .filter((row) => row.day.startsWith(base))
      .map((row) => row.day);
    expect(remaining).toEqual([`${base}-02`, `${base}-03`]);
  });

  it('deleting a user cascades their snapshot rows', async () => {
    const User = require('@server/models/User');
    const prefix = '2098-09';
    const temp = await User.create(
      `conf-sus-cascade-${Date.now()}-${seq}`,
      `conf-sus-cascade-${Date.now()}-${seq}@conf.test`,
      'pw',
      false
    );
    await repo.upsertSnapshot({ userId: temp.id, day: `${prefix}-01`, bytes: 1 });
    await User.delete(temp.id);

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS count FROM storage_usage_snapshots WHERE user_id = ?',
      [Number(temp.id)]
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it('rejects malformed days and negative bytes before SQL', async () => {
    await expect(
      repo.upsertSnapshot({ userId: user.id, day: '2026/01/01', bytes: 1 })
    ).rejects.toThrow(TypeError);
    await expect(
      repo.upsertSnapshot({ userId: user.id, day: '2026-01-01', bytes: -1 })
    ).rejects.toThrow(TypeError);
    await expect(repo.listForUser(user.id, { fromDay: 'nope' })).rejects.toThrow(TypeError);
    await expect(repo.deleteOlderThan('nope')).rejects.toThrow(TypeError);
  });
});
