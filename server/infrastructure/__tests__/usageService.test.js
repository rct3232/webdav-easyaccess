'use strict';

/**
 * usageService unit contract (docs/spec/server/store/usageStore.md §2.1):
 * recording-path validation, §3.4 config resolution (T2/dbOnly weights/H),
 * rollup orchestration (read → pure-math accumulate → upsert) and the
 * retention roll-off. All IO through DI seams — no real DB here.
 */

const { DAY_MS } = require('@server/infrastructure/usage/activityScore');

jest.mock('@server/infrastructure/configResolver', () => ({
  getSharedResolver: () => mockResolver,
}));

const mockResolver = { getConfig: jest.fn() };
const { createUsageService } = require('@server/infrastructure/usageService');

const DEFAULT_CONFIG = {
  AI_USAGE_W_OPEN: '1',
  AI_USAGE_W_PREVIEW: '2',
  AI_USAGE_W_DOWNLOAD: '3',
  AI_USAGE_W_SEARCH_HIT: '1',
  AI_USAGE_W_LIKE: '5',
  AI_ACTIVITY_HALF_LIFE_DAYS: '30',
  AI_USAGE_EVENT_RETENTION_DAYS: '90',
};

function stubConfig(overrides = {}) {
  const values = { ...DEFAULT_CONFIG, ...overrides };
  mockResolver.getConfig.mockImplementation(async (key) => values[key]);
}

describe('usageService', () => {
  let usageStore;
  const NOW = Date.UTC(2026, 8, 22, 3, 0, 0);

  beforeEach(() => {
    jest.resetModules();
    usageStore = {
      insertUsageEvent: jest.fn(async () => ({ changes: 1 })),
      readRollupGroups: jest.fn(async () => []),
      upsertNodeActivity: jest.fn(async () => ({ changes: 0 })),
      deleteUsageEventsOlderThan: jest.fn(async () => ({ changes: 0 })),
    };
    stubConfig();
  });

  describe('recordEvent (recording path)', () => {
    it('inserts a validated §3.4 event (repo owns the at-default)', async () => {
      const service = createUsageService({ usageStore });
      const result = await service.recordEvent({ userId: 7, nodeId: 9, action: 'download' });

      expect(result).toEqual({ changes: 1 });
      expect(usageStore.insertUsageEvent).toHaveBeenCalledWith({
        userId: 7,
        nodeId: 9,
        action: 'download',
        at: undefined,
      });
    });

    it('honors an explicit event timestamp (deterministic decay tests)', async () => {
      const service = createUsageService({ usageStore });
      await service.recordEvent({ userId: 7, nodeId: 9, action: 'like', at: new Date(NOW) });

      expect(usageStore.insertUsageEvent).toHaveBeenCalledWith(
        expect.objectContaining({ at: new Date(NOW).toISOString() })
      );
    });

    it('rejects actions outside the §3.4 enum', async () => {
      await expect(
        createUsageService({ usageStore }).recordEvent({ userId: 7, nodeId: 9, action: 'list' })
      ).rejects.toThrow(/action/);
      expect(usageStore.insertUsageEvent).not.toHaveBeenCalled();
    });

    it('rejects missing userId/nodeId', async () => {
      const service = createUsageService({ usageStore });
      await expect(service.recordEvent({ nodeId: 9, action: 'open' })).rejects.toThrow();
      await expect(service.recordEvent({ userId: 7, action: 'open' })).rejects.toThrow();
      expect(usageStore.insertUsageEvent).not.toHaveBeenCalled();
    });
  });

  describe('rollupNodeActivity (S_k accumulation)', () => {
    it('resolves the shipped §3.4 constants; nothing to consume → no upsert', async () => {
      const service = createUsageService({ usageStore, now: () => new Date(NOW) });
      const report = await service.rollupNodeActivity();

      expect(report).toEqual({ groups: 0, changes: 0 });
      expect(usageStore.readRollupGroups).toHaveBeenCalledTimes(1);
      expect(usageStore.upsertNodeActivity).not.toHaveBeenCalled();
    });

    it('maps watermark groups through the accumulator into upsert rows', async () => {
      usageStore.readRollupGroups.mockResolvedValue([
        {
          userId: 7,
          nodeId: 9,
          counts: { open: 2, download: 1, preview: 0, search_hit: 0, like: 0 },
          lastSeenAtMs: NOW - DAY_MS,
          prevScore: 5,
          prevCounts: { open: 1, download: 0, preview: 1, search_hit: 0, like: 1 },
          prevUpdatedAtMs: NOW - 30 * DAY_MS,
        },
      ]);
      usageStore.upsertNodeActivity.mockResolvedValue({ changes: 1 });

      const service = createUsageService({ usageStore, now: () => new Date(NOW) });
      const report = await service.rollupNodeActivity();

      expect(report).toEqual({ groups: 1, changes: 1 });
      expect(usageStore.upsertNodeActivity).toHaveBeenCalledWith([
        {
          userId: 7,
          nodeId: 9,
          // lifetime totals: prev + new
          counts: { open: 3, download: 1, preview: 1, search_hit: 0, like: 1 },
          lastSeenAtMs: NOW - DAY_MS,
          // 5·2^(−30/30) + (2·1 + 1·3) = 2.5 + 5 = 7.5
          score: expect.closeTo(7.5, 9),
          updatedAtMs: NOW,
        },
      ]);
    });

    it('falls back to shipped defaults on invalid config values', async () => {
      stubConfig({ AI_USAGE_W_OPEN: 'not-a-number', AI_ACTIVITY_HALF_LIFE_DAYS: '-4' });
      usageStore.readRollupGroups.mockResolvedValue([
        {
          userId: 1,
          nodeId: 2,
          counts: { open: 1, download: 0, preview: 0, search_hit: 0, like: 0 },
          lastSeenAtMs: NOW,
          prevScore: null,
          prevCounts: { open: 0, download: 0, preview: 0, search_hit: 0, like: 0 },
          prevUpdatedAtMs: null,
        },
      ]);
      const service = createUsageService({ usageStore, now: () => new Date(NOW) });
      await service.rollupNodeActivity();

      // invalid w_open → shipped default 1; invalid H → shipped default 30
      expect(usageStore.upsertNodeActivity).toHaveBeenCalledWith([
        expect.objectContaining({ score: expect.closeTo(1, 9) }),
      ]);
    });
  });

  describe('rollOffExpiredEvents (retention tail)', () => {
    it('deletes raw events older than the 90d horizon', async () => {
      const service = createUsageService({ usageStore, now: () => new Date(NOW) });
      const report = await service.rollOffExpiredEvents();

      expect(report).toEqual({ changes: 0 });
      expect(usageStore.deleteUsageEventsOlderThan).toHaveBeenCalledWith(NOW - 90 * DAY_MS);
    });

    it('honors a tuned retention and treats 0 as retention off', async () => {
      stubConfig({ AI_USAGE_EVENT_RETENTION_DAYS: '7' });
      const service = createUsageService({ usageStore, now: () => new Date(NOW) });
      await service.rollOffExpiredEvents();
      expect(usageStore.deleteUsageEventsOlderThan).toHaveBeenCalledWith(NOW - 7 * DAY_MS);

      stubConfig({ AI_USAGE_EVENT_RETENTION_DAYS: '0' });
      await service.rollOffExpiredEvents();
      expect(usageStore.deleteUsageEventsOlderThan).toHaveBeenCalledTimes(1);
    });
  });
});
