'use strict';

/**
 * AiUsageDailyRepository L2 conformance
 * (docs/spec/server/store/aiUsageDailyStore.md §2.8). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 * Covers the upsert-increment semantics ("columns move only on their events"),
 * PK-day rollover, per-day/range reads, input validation and the
 * restart-survival accumulation guarantee.
 */

const { createTestDatabase, dbQuery } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createAiUsageDailyRepository = require('@server/store/repositories/AiUsageDailyRepository');

describe('AiUsageDailyRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createAiUsageDailyRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const day = (offsetDays = 0) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  const uniqRole = () => `embed-${Date.now()}-${(seq += 1)}`;

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('first recordUsage inserts; repeated calls INCREMENT the touched counters only', async () => {
    const role = uniqRole();
    await repo.recordUsage({ day: day(0), role, calls: 1, inputChars: 120 });
    await repo.recordUsage({ day: day(0), role, calls: 1, inputChars: 80 });
    await repo.recordUsage({ day: day(0), role, cached: 1 }); // cached-only event

    const rows = await repo.getByDay(day(0));
    const row = rows.find((entry) => entry.role === role);
    expect(row).toMatchObject({
      day: day(0),
      role,
      calls: 2,
      inputChars: 200,
      cached: 1,
      degraded: 0,
      failed429: 0,
    });
  });

  it('a degraded-only and a failed_429-only event move exactly their counter', async () => {
    const role = uniqRole();
    await repo.recordUsage({ day: day(0), role, degraded: 1 });
    await repo.recordUsage({ day: day(0), role, failed429: 2 });

    const row = (await repo.getByDay(day(0))).find((entry) => entry.role === role);
    expect(row).toMatchObject({
      calls: 0,
      inputChars: 0,
      cached: 0,
      degraded: 1,
      failed429: 2,
    });
  });

  it('two roles on one day and two days on one role are separate rows (day rollover = new PK row)', async () => {
    const roleA = uniqRole();
    const roleB = uniqRole();
    await repo.recordUsage({ day: day(1), role: roleA, calls: 1 });
    await repo.recordUsage({ day: day(1), role: roleB, calls: 1 });
    await repo.recordUsage({ day: day(2), role: roleA, calls: 1 });

    const dayOne = (await repo.getByDay(day(1))).filter(
      (entry) => entry.role === roleA || entry.role === roleB
    );
    expect(dayOne.map((entry) => entry.role).sort()).toEqual([roleA, roleB].sort());

    const roleARows = (await repo.getByDay(day(2))).filter((entry) => entry.role === roleA);
    expect(roleARows).toHaveLength(1);
    expect(roleARows[0].calls).toBe(1); // day(1) row was NOT reset/merged
  });

  it('the same (day, role) row is never duplicated', async () => {
    const role = uniqRole();
    await repo.recordUsage({ day: day(0), role, calls: 1 });
    await repo.recordUsage({ day: day(0), role, calls: 1 });

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM ai_usage_daily WHERE role = ?',
      [role]
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it('getByDay returns role ASC and an unknown day → []', async () => {
    const roleA = uniqRole();
    const roleB = uniqRole();
    await repo.recordUsage({ day: day(3), role: roleB, calls: 1 });
    await repo.recordUsage({ day: day(3), role: roleA, calls: 1 });

    const rows = await repo.getByDay(day(3));
    const idxA = rows.findIndex((entry) => entry.role === roleA);
    const idxB = rows.findIndex((entry) => entry.role === roleB);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);

    await expect(repo.getByDay('1999-01-01')).resolves.toEqual([]);
  });

  it('summarizeRange sums per role over the inclusive range and skips absent days', async () => {
    const role = uniqRole();
    await repo.recordUsage({ day: day(10), role, calls: 2, inputChars: 50, failed429: 1 });
    await repo.recordUsage({ day: day(11), role, calls: 3, inputChars: 70, degraded: 1 });
    await repo.recordUsage({ day: day(12), role, calls: 1 }); // outside the range below

    const summary = await repo.summarizeRange({ fromDay: day(10), toDay: day(11) });
    const row = summary.find((entry) => entry.role === role);
    expect(row).toMatchObject({
      role,
      calls: 5,
      inputChars: 120,
      cached: 0,
      degraded: 1,
      failed429: 1,
    });

    const empty = await repo.summarizeRange({ fromDay: '1999-01-01', toDay: '1999-01-02' });
    expect(empty).toEqual([]);
  });

  it('negative or non-integer deltas → TypeError before SQL; non-string day/role → TypeError', async () => {
    await expect(
      repo.recordUsage({ day: day(0), role: 'embed', calls: -1 })
    ).rejects.toThrow(TypeError);
    await expect(
      repo.recordUsage({ day: day(0), role: 'embed', inputChars: 1.5 })
    ).rejects.toThrow(TypeError);
    await expect(repo.recordUsage({ day: 20260101, role: 'embed', calls: 1 })).rejects.toThrow(
      TypeError
    );
    await expect(repo.recordUsage({ day: day(0), role: null, calls: 1 })).rejects.toThrow(TypeError);
  });

  it('restart survival: a persisted row keeps accumulating after a fresh repository over the same DB', async () => {
    const role = uniqRole();
    await repo.recordUsage({ day: day(0), role, calls: 1, inputChars: 10 });

    // "Restart": brand-new repository instances over the same backend.
    const revivedRepo = createAiUsageDailyRepository(storage.getExecutor());
    await revivedRepo.recordUsage({ day: day(0), role, calls: 1, inputChars: 15 });

    const row = (await revivedRepo.getByDay(day(0))).find((entry) => entry.role === role);
    expect(row).toMatchObject({ calls: 2, inputChars: 25, cached: 0, degraded: 0, failed429: 0 });
  });
});
