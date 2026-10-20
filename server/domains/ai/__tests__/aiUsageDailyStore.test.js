'use strict';

/**
 * aiUsageDailyStore facade test (docs/spec/server/store/aiUsageDailyStore.md
 * §2.1). L1: thin dialect dispatch + the usage-ledger restart-survival rule —
 * history is DB truth, never reset by store code (llmAdapter §2.9: day
 * rollover is a new PK row; reconfig resets breakers, not history).
 */

const { createTestDatabase, isSqliteBackend } = require('@server/test-utils');
const storage = require('@server/store/storage');
const aiUsageDailyStore = require('@server/store/aiUsageDailyStore');

const day = () => new Date().toISOString().slice(0, 10);

describe('aiUsageDailyStore facade', () => {
  let dbCleanup;
  let seq = 0;
  const uniqueRole = () => `facade-usage-${Date.now()}-${(seq += 1)}`;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('delegates recordUsage / getByDay / summarizeRange', async () => {
    const role = uniqueRole();
    await aiUsageDailyStore.recordUsage({ day: day(), role, calls: 1, inputChars: 100 });
    // A 429-only round-trip moves exactly its counter (columns move only on
    // their events — calls/input_chars untouched by this event).
    await aiUsageDailyStore.recordUsage({ day: day(), role, failed429: 1 });

    const rows = await aiUsageDailyStore.getByDay(day());
    const row = rows.find((entry) => entry.role === role);
    expect(row).toMatchObject({ day: day(), role, calls: 1, inputChars: 100, failed429: 1 });

    const summary = await aiUsageDailyStore.summarizeRange({ fromDay: day(), toDay: day() });
    expect(summary.map((entry) => entry.role)).toContain(role);
  });

  it('restart survival: the persisted ledger row keeps accumulating after a close/reopen', async () => {
    const role = uniqueRole();
    await aiUsageDailyStore.recordUsage({ day: day(), role, calls: 1, inputChars: 10 });

    if (isSqliteBackend()) {
      // Simulate the restart: drop the process-level DB handle; the next
      // store call reopens the SAME persisted file.
      await storage.closeSqliteDb();
    }

    await aiUsageDailyStore.recordUsage({ day: day(), role, calls: 1, inputChars: 25, cached: 1 });

    const row = (await aiUsageDailyStore.getByDay(day())).find((entry) => entry.role === role);
    expect(row).toMatchObject({ calls: 2, inputChars: 35, cached: 1 });
  });

  it('rejects counter-decreasing deltas (TypeError through the facade)', async () => {
    await expect(
      aiUsageDailyStore.recordUsage({ day: day(), role: uniqueRole(), calls: -5 })
    ).rejects.toThrow(TypeError);
  });
});
