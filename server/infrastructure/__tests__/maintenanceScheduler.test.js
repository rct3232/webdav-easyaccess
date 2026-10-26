'use strict';

// The T0.7b admin-reports writer resolves the admin_reports store since T0.8.
// This is a unit suite without a test database — mock the store facade so the
// shared writer never touches a real sqlite file.
jest.mock('../../store/adminReportsStore', () => ({
  insertReport: jest.fn(() => Promise.resolve({ id: 1 })),
  listReports: jest.fn(() => Promise.resolve([])),
  getReport: jest.fn(() => Promise.resolve(null)),
  updateReport: jest.fn(() => Promise.resolve(null)),
  deleteReportsOlderThan: jest.fn(() => Promise.resolve({ changes: 0 })),
}));

let mockGetConfigSync;

jest.mock('../../domains/admin/services/adminReportsService', () => ({
  ...jest.requireActual('../../domains/admin/services/adminReportsService'),
  collectContentHashCompleteness: (...args) => mockCollectContentHashCompleteness(...args),
}));
const mockCollectContentHashCompleteness = jest.fn(() => Promise.resolve(null));

jest.mock('../configResolver', () => ({
  getSharedResolver: () => ({
    getConfigSync: (key) => (mockGetConfigSync ? mockGetConfigSync(key) : undefined),
  }),
}));

const {
  startGcScheduler,
  runStartupFailSafeRecovery,
  shouldSkip,
  resolveIntervalMs,
  shouldSkipRollup,
  resolveAnchorHour,
  resolveNightlyDelayMs,
  startUsageRollupScheduler,
  startEvolutionScheduler,
} = require('../maintenanceScheduler');

function setIntervalValue(value) {
  mockGetConfigSync = (key) => (key === 'GC_INTERVAL_MS' ? value : undefined);
}

describe('maintenanceScheduler', () => {
  describe('shouldSkip', () => {
    const saved = process.env.WEA_SKIP_GC_SCHEDULER;

    afterEach(() => {
      if (saved === undefined) delete process.env.WEA_SKIP_GC_SCHEDULER;
      else process.env.WEA_SKIP_GC_SCHEDULER = saved;
    });

    it('is false when the env flag is unset', () => {
      delete process.env.WEA_SKIP_GC_SCHEDULER;
      expect(shouldSkip()).toBe(false);
    });

    it('is true for truthy values', () => {
      process.env.WEA_SKIP_GC_SCHEDULER = '1';
      expect(shouldSkip()).toBe(true);
      process.env.WEA_SKIP_GC_SCHEDULER = 'true';
      expect(shouldSkip()).toBe(true);
    });
  });

  describe('resolveIntervalMs', () => {
    afterEach(() => {
      mockGetConfigSync = undefined;
    });

    it('returns 0 when the DB-only value is unset', () => {
      setIntervalValue(undefined);
      expect(resolveIntervalMs()).toBe(0);
    });

    it('returns the configured positive interval', () => {
      setIntervalValue('3600000');
      expect(resolveIntervalMs()).toBe(3600000);
    });

    it('returns 0 for zero or invalid values', () => {
      setIntervalValue('0');
      expect(resolveIntervalMs()).toBe(0);
      setIntervalValue('not-a-number');
      expect(resolveIntervalMs()).toBe(0);
    });
  });

  describe('startGcScheduler', () => {
    afterEach(() => {
      mockGetConfigSync = undefined;
    });

    it('returns null when scheduling is disabled (skip flag)', () => {
      const prev = process.env.WEA_SKIP_GC_SCHEDULER;
      process.env.WEA_SKIP_GC_SCHEDULER = '1';
      try {
        const timer = startGcScheduler({ gcService: { runGcCycle: jest.fn() } });
        expect(timer).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.WEA_SKIP_GC_SCHEDULER;
        else process.env.WEA_SKIP_GC_SCHEDULER = prev;
      }
    });

    it('returns null when GC_INTERVAL_MS is unset', () => {
      setIntervalValue(undefined);
      const timer = startGcScheduler({ gcService: { runGcCycle: jest.fn() } });
      expect(timer).toBeNull();
    });

    it('schedules a periodic run when configured', () => {
      jest.useFakeTimers();
      const prevSkip = process.env.WEA_SKIP_GC_SCHEDULER;
      setIntervalValue('1000');
      delete process.env.WEA_SKIP_GC_SCHEDULER;

      try {
        const runGcCycle = jest.fn(() => Promise.resolve({ tier1: {}, tier2: {} }));
        const timer = startGcScheduler({ gcService: { runGcCycle } });

        expect(timer).not.toBeNull();
        jest.advanceTimersByTime(3000);
        expect(runGcCycle).toHaveBeenCalledTimes(3);

        clearInterval(timer);
      } finally {
        if (prevSkip === undefined) delete process.env.WEA_SKIP_GC_SCHEDULER;
        else process.env.WEA_SKIP_GC_SCHEDULER = prevSkip;
        jest.useRealTimers();
      }
    });

    it('persists each scheduled GC run as an admin_reports row (kind gc, §4.14 Tier A)', async () => {
      jest.useFakeTimers();
      const prevSkip = process.env.WEA_SKIP_GC_SCHEDULER;
      setIntervalValue('1000');
      delete process.env.WEA_SKIP_GC_SCHEDULER;

      try {
        const writeReport = jest.fn(() => Promise.resolve({ id: 1 }));
        const runGcCycle = jest.fn(() =>
          Promise.resolve({
            tier1: { orphanedRows: 2, deletedRows: 2, errors: [] },
            tier2: { scannedKeys: 5, deletedKeys: 1, errors: [] },
            tier3: { purgedNodes: 0, errors: [] },
          })
        );
        const timer = startGcScheduler({
          gcService: { runGcCycle },
          adminReportsWriter: { writeReport },
        });

        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
        expect(writeReport).toHaveBeenCalledTimes(1);
        expect(writeReport).toHaveBeenCalledWith({
          kind: 'gc',
          status: 'ok',
          payload: expect.objectContaining({ tier1: expect.anything(), tier2: expect.anything() }),
        });

        clearInterval(timer);
      } finally {
        if (prevSkip === undefined) delete process.env.WEA_SKIP_GC_SCHEDULER;
        else process.env.WEA_SKIP_GC_SCHEDULER = prevSkip;
        jest.useRealTimers();
      }
    });

    it('a failing gc run persists a partial row and never breaks the schedule', async () => {
      jest.useFakeTimers();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const prevSkip = process.env.WEA_SKIP_GC_SCHEDULER;
      setIntervalValue('1000');
      delete process.env.WEA_SKIP_GC_SCHEDULER;

      try {
        const writeReport = jest.fn(() => Promise.resolve(null));
        const runGcCycle = jest.fn(() => Promise.reject(new Error('tier1 exploded')));
        const timer = startGcScheduler({
          gcService: { runGcCycle },
          adminReportsWriter: { writeReport },
        });

        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
        expect(runGcCycle).toHaveBeenCalledTimes(1);
        // A failed run is still a run: partial row with the error payload
        // (§4.14 — no console-only GC reports anymore).
        expect(writeReport).toHaveBeenCalledWith({
          kind: 'gc',
          status: 'partial',
          payload: { error: 'tier1 exploded' },
        });

        jest.advanceTimersByTime(1000);
        expect(runGcCycle).toHaveBeenCalledTimes(2);
        clearInterval(timer);
      } finally {
        errorSpy.mockRestore();
        if (prevSkip === undefined) delete process.env.WEA_SKIP_GC_SCHEDULER;
        else process.env.WEA_SKIP_GC_SCHEDULER = prevSkip;
        jest.useRealTimers();
      }
    });
  });

  describe('runStartupFailSafeRecovery', () => {
    it('returns an empty report when no service is provided', async () => {
      const report = await runStartupFailSafeRecovery({});
      expect(report).toEqual({ scanned: 0, resolved: 0, manualReview: [] });
    });

    it('merges the contentHashCompleteness section into ONE failsafe row (partial while NULL rows exist)', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockCollectContentHashCompleteness.mockImplementationOnce(() =>
        Promise.resolve({ nullCount: 2, checkedAt: 'C1' })
      );
      try {
        const writeReport = jest.fn(() => Promise.resolve({ id: 8 }));
        const report = {
          scanned: 0,
          resolved: 0,
          manualReview: [],
          pendingUpload: { scanned: 0, nodes: [] },
        };
        await runStartupFailSafeRecovery({
          failSafeService: { runStartupRecovery: jest.fn(() => Promise.resolve(report)) },
          adminReportsWriter: { writeReport },
        });

        expect(mockCollectContentHashCompleteness).toHaveBeenCalledTimes(1);
        expect(writeReport).toHaveBeenCalledTimes(1);
        expect(writeReport).toHaveBeenCalledWith({
          kind: 'failsafe',
          status: 'partial',
          payload: { ...report, contentHashCompleteness: { nullCount: 2, checkedAt: 'C1' } },
        });
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it('keeps status ok when the section reports zero NULL rows', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockCollectContentHashCompleteness.mockImplementationOnce(() =>
        Promise.resolve({ nullCount: 0, checkedAt: 'C2' })
      );
      try {
        const writeReport = jest.fn(() => Promise.resolve({ id: 9 }));
        const report = {
          scanned: 0,
          resolved: 0,
          manualReview: [],
          pendingUpload: { scanned: 0, nodes: [] },
        };
        await runStartupFailSafeRecovery({
          failSafeService: { runStartupRecovery: jest.fn(() => Promise.resolve(report)) },
          adminReportsWriter: { writeReport },
        });

        expect(writeReport).toHaveBeenCalledWith({
          kind: 'failsafe',
          status: 'ok',
          payload: { ...report, contentHashCompleteness: { nullCount: 0, checkedAt: 'C2' } },
        });
      } finally {
        logSpy.mockRestore();
      }
    });

    it('omits the section when the probe throws — the boot row still lands', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockCollectContentHashCompleteness.mockImplementationOnce(() =>
        Promise.reject(new Error('probe down'))
      );
      try {
        const writeReport = jest.fn(() => Promise.resolve({ id: 10 }));
        const report = {
          scanned: 0,
          resolved: 0,
          manualReview: [],
          pendingUpload: { scanned: 0, nodes: [] },
        };
        await runStartupFailSafeRecovery({
          failSafeService: { runStartupRecovery: jest.fn(() => Promise.resolve(report)) },
          adminReportsWriter: { writeReport },
        });

        expect(writeReport).toHaveBeenCalledWith({
          kind: 'failsafe',
          status: 'ok',
          payload: report,
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it('returns the fail-safe report', async () => {
      const failSafeService = {
        runStartupRecovery: jest.fn(() =>
          Promise.resolve({ scanned: 1, resolved: 0, manualReview: [{ nodeId: 1, path: '/x' }] })
        ),
      };
      const report = await runStartupFailSafeRecovery({ failSafeService });
      expect(report.scanned).toBe(1);
      expect(report.manualReview).toHaveLength(1);
    });

    it('logs the pending_upload count only when it is non-zero (threshold-gated)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const failSafeService = {
          runStartupRecovery: jest.fn(() =>
            Promise.resolve({
              scanned: 0,
              resolved: 0,
              manualReview: [],
              pendingUpload: { scanned: 2, nodes: [{ nodeId: 7 }, { nodeId: 8 }] },
            })
          ),
        };
        const report = await runStartupFailSafeRecovery({ failSafeService });
        expect(report.pendingUpload.scanned).toBe(2);
        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain('2 pending_upload node(s)');
        expect(warnSpy.mock.calls[1][0]).toContain('repair-sync');
        expect(logSpy).toHaveBeenCalledWith('Fail-safe recovery: no orphaned nodes found');

        warnSpy.mockClear();
        logSpy.mockClear();
        failSafeService.runStartupRecovery.mockReturnValue(
          Promise.resolve({
            scanned: 0,
            resolved: 0,
            manualReview: [],
            pendingUpload: { scanned: 0, nodes: [] },
          })
        );
        await runStartupFailSafeRecovery({ failSafeService });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('persists the startup scan as an admin_reports row (kind failsafe, §4.14 Tier A)', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const writeReport = jest.fn(() => Promise.resolve({ id: 7 }));
        const report = {
          scanned: 1,
          resolved: 0,
          manualReview: [{ nodeId: 1, path: '/x' }],
          pendingUpload: { scanned: 0, nodes: [] },
        };
        await runStartupFailSafeRecovery({
          failSafeService: { runStartupRecovery: jest.fn(() => Promise.resolve(report)) },
          adminReportsWriter: { writeReport },
        });

        expect(writeReport).toHaveBeenCalledWith({
          kind: 'failsafe',
          status: 'ok',
          payload: report,
        });
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('a scan error persists a partial failsafe row and keeps the boot-safe empty report', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const writeReport = jest.fn(() => Promise.resolve(null));
        const report = await runStartupFailSafeRecovery({
          failSafeService: {
            runStartupRecovery: jest.fn(() => Promise.reject(new Error('scan blew up'))),
          },
          adminReportsWriter: { writeReport },
        });

        expect(report.error).toBe('scan blew up');
        expect(writeReport).toHaveBeenCalledWith({
          kind: 'failsafe',
          status: 'partial',
          payload: expect.objectContaining({ error: 'scan blew up' }),
        });
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('reporting never breaks the startup hook (writer throw is swallowed)', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const report = await runStartupFailSafeRecovery({
          failSafeService: {
            runStartupRecovery: jest.fn(() =>
              Promise.resolve({ scanned: 0, resolved: 0, manualReview: [] })
            ),
          },
          adminReportsWriter: {
            writeReport: jest.fn(() => Promise.reject(new Error('writer down'))),
          },
        });
        expect(report.scanned).toBe(0);
      } finally {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  // ── T0.6: nightly usage-rollup scheduler (§3.1/§3.4) ──────────────────────

  describe('shouldSkipRollup', () => {
    const saved = process.env.WEA_SKIP_ROLLUP_SCHEDULER;

    afterEach(() => {
      if (saved === undefined) delete process.env.WEA_SKIP_ROLLUP_SCHEDULER;
      else process.env.WEA_SKIP_ROLLUP_SCHEDULER = saved;
    });

    it('is false when the env flag is unset', () => {
      delete process.env.WEA_SKIP_ROLLUP_SCHEDULER;
      expect(shouldSkipRollup()).toBe(false);
    });

    it('is true for the truthy values 1/true/yes/on', () => {
      for (const value of ['1', 'true', 'yes', 'on']) {
        process.env.WEA_SKIP_ROLLUP_SCHEDULER = value;
        expect(shouldSkipRollup()).toBe(true);
      }
      process.env.WEA_SKIP_ROLLUP_SCHEDULER = '0';
      expect(shouldSkipRollup()).toBe(false);
    });
  });

  describe('resolveAnchorHour (AI_NIGHTLY_ANCHOR_HOUR_UTC, dbOnly)', () => {
    afterEach(() => {
      mockGetConfigSync = undefined;
    });

    it('defaults to 3 when unset', () => {
      mockGetConfigSync = () => undefined;
      expect(resolveAnchorHour()).toBe(3);
    });

    it('honors a configured hour', () => {
      mockGetConfigSync = (key) => (key === 'AI_NIGHTLY_ANCHOR_HOUR_UTC' ? '5' : undefined);
      expect(resolveAnchorHour()).toBe(5);
    });

    it('falls back to 3 for invalid values', () => {
      for (const bad of ['not-a-number', '24', '-1', '3.5']) {
        mockGetConfigSync = (key) => (key === 'AI_NIGHTLY_ANCHOR_HOUR_UTC' ? bad : undefined);
        expect(resolveAnchorHour()).toBe(3);
      }
    });
  });

  describe('resolveNightlyDelayMs (anchor math, §3.4)', () => {
    const DAY = 86400000;
    const anchor = (h) => Date.UTC(2026, 8, 22, h);

    it.each([
      ['before the anchor → same-day delay', anchor(3) - 2 * 3600000, 3, 2 * 3600000],
      ['after the anchor → next-day delay', anchor(3) + 4 * 3600000, 3, 20 * 3600000],
      ['exactly at the anchor → full 24h (never twice a day)', anchor(3), 3, DAY],
      ['one ms past the anchor → ~24h', anchor(3) + 1, 3, DAY - 1],
      ['anchor 0 wraps to the previous day', anchor(0) + 23 * 3600000, 0, 3600000],
    ])('%s', (_label, nowMs, hour, expected) => {
      expect(resolveNightlyDelayMs(nowMs, hour)).toBe(expected);
    });
  });

  describe('startUsageRollupScheduler', () => {
    const DAY = 86400000;
    // 2026-09-22T02:00:00Z — one hour before the default 03:00 anchor.
    const JUST_BEFORE_ANCHOR = Date.UTC(2026, 8, 22, 2, 0, 0);

    function scheduleRollup({ usageService, collectionsStore, actionJournalStore }) {
      mockGetConfigSync = (key) => (key === 'AI_NIGHTLY_ANCHOR_HOUR_UTC' ? '3' : undefined);
      delete process.env.WEA_SKIP_ROLLUP_SCHEDULER;
      jest.useFakeTimers();
      jest.setSystemTime(JUST_BEFORE_ANCHOR);
      return startUsageRollupScheduler({ usageService, collectionsStore, actionJournalStore });
    }

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      delete process.env.WEA_SKIP_ROLLUP_SCHEDULER;
      mockGetConfigSync = undefined;
    });

    const chainFakes = () => ({
      usageService: {
        rollupNodeActivity: jest.fn(async () => ({ groups: 1, changes: 1 })),
        rollOffExpiredEvents: jest.fn(async () => ({ changes: 2 })),
      },
      collectionsStore: {
        recomputeActivityScores: jest.fn(async () => ({ changes: 3 })),
        purgeExpiredTombstones: jest.fn(async () => ({ changes: 0 })),
      },
      actionJournalStore: { expireJournalRows: jest.fn(async () => ({ changes: 2 })) },
    });

    it('returns null under the WEA_SKIP_ROLLUP_SCHEDULER seam', () => {
      const prev = process.env.WEA_SKIP_ROLLUP_SCHEDULER;
      process.env.WEA_SKIP_ROLLUP_SCHEDULER = '1';
      try {
        expect(startUsageRollupScheduler({ usageService: chainFakes().usageService })).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.WEA_SKIP_ROLLUP_SCHEDULER;
        else process.env.WEA_SKIP_ROLLUP_SCHEDULER = prev;
      }
    });

    it('returns null when the usage service is missing', () => {
      expect(startUsageRollupScheduler({})).toBeNull();
    });

    it('runs the five legs in order at the nightly anchor (§3.1 chain)', async () => {
      const fakes = chainFakes();
      const order = [];
      fakes.usageService.rollupNodeActivity.mockImplementation(async () => {
        order.push('rollup');
        return { groups: 0, changes: 0 };
      });
      fakes.collectionsStore.recomputeActivityScores.mockImplementation(async () => {
        order.push('recompute');
        return { changes: 0 };
      });
      fakes.usageService.rollOffExpiredEvents.mockImplementation(async () => {
        order.push('rollOff');
        return { changes: 0 };
      });
      fakes.actionJournalStore.expireJournalRows.mockImplementation(async () => {
        order.push('journal');
        return { changes: 0 };
      });
      fakes.collectionsStore.purgeExpiredTombstones.mockImplementation(async () => {
        order.push('tombstones');
        return { changes: 0 };
      });

      const timer = scheduleRollup(fakes);
      expect(timer).not.toBeNull();

      await jest.advanceTimersByTimeAsync(3600000); // anchor reached
      expect(order).toEqual(['rollup', 'recompute', 'rollOff', 'journal', 'tombstones']);
      expect(fakes.collectionsStore.recomputeActivityScores).toHaveBeenCalledWith();
      expect(fakes.collectionsStore.purgeExpiredTombstones).toHaveBeenCalledWith(
        expect.any(Number)
      );
    });

    it('a rollup failure aborts the retention tail (retried next anchor)', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const fakes = chainFakes();
      fakes.usageService.rollupNodeActivity.mockRejectedValue(new Error('rollup exploded'));

      const timer = scheduleRollup(fakes);
      expect(timer).not.toBeNull();
      await jest.advanceTimersByTimeAsync(3600000);

      expect(fakes.collectionsStore.recomputeActivityScores).not.toHaveBeenCalled();
      expect(fakes.usageService.rollOffExpiredEvents).not.toHaveBeenCalled();
      expect(fakes.actionJournalStore.expireJournalRows).not.toHaveBeenCalled();
      expect(fakes.collectionsStore.purgeExpiredTombstones).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Scheduled usage rollup failed:', 'rollup exploded');
      errorSpy.mockRestore();
    });

    it('a tail-leg failure aborts the later legs and never throws out of the tick', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const fakes = chainFakes();
      fakes.usageService.rollOffExpiredEvents.mockRejectedValue(new Error('rolloff exploded'));

      expect(scheduleRollup(fakes)).not.toBeNull();
      await expect(jest.advanceTimersByTimeAsync(3600000)).resolves.not.toThrow();

      expect(fakes.usageService.rollupNodeActivity).toHaveBeenCalledTimes(1);
      expect(fakes.collectionsStore.recomputeActivityScores).toHaveBeenCalledTimes(1);
      expect(fakes.actionJournalStore.expireJournalRows).not.toHaveBeenCalled();
      expect(fakes.collectionsStore.purgeExpiredTombstones).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('re-arms for the next anchor after each run (drift-tolerant)', async () => {
      const fakes = chainFakes();
      const timer = scheduleRollup(fakes);

      await jest.advanceTimersByTimeAsync(3600000); // anchor day 1
      expect(fakes.usageService.rollupNodeActivity).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(DAY); // next anchor (24h later)
      expect(fakes.usageService.rollupNodeActivity).toHaveBeenCalledTimes(2);
      expect(timer).not.toBeNull();
    });
  });

  describe('startEvolutionScheduler (§3.2 nightly backbone)', () => {
    const DAY = 86400000;
    // 2026-09-22T02:00:00Z — one hour before the default 03:00 anchor.
    const JUST_BEFORE_ANCHOR = Date.UTC(2026, 8, 22, 2, 0, 0);

    function scheduleEvolution(evolutionService, config = {}) {
      mockGetConfigSync = (key) => (key === 'AI_NIGHTLY_ANCHOR_HOUR_UTC' ? '3' : config[key]);
      delete process.env.WEA_SKIP_EVOLUTION_SCHEDULER;
      jest.useFakeTimers();
      jest.setSystemTime(JUST_BEFORE_ANCHOR);
      return startEvolutionScheduler({ evolutionService });
    }

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      delete process.env.WEA_SKIP_EVOLUTION_SCHEDULER;
      mockGetConfigSync = undefined;
    });

    const serviceFake = () => ({
      runEvolutionPass: jest.fn(async () => ({ perUser: [], report: null })),
    });

    it('returns null under the WEA_SKIP_EVOLUTION_SCHEDULER seam', () => {
      const prev = process.env.WEA_SKIP_EVOLUTION_SCHEDULER;
      process.env.WEA_SKIP_EVOLUTION_SCHEDULER = '1';
      try {
        expect(startEvolutionScheduler({ evolutionService: serviceFake() })).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.WEA_SKIP_EVOLUTION_SCHEDULER;
        else process.env.WEA_SKIP_EVOLUTION_SCHEDULER = prev;
      }
    });

    it('returns null when the evolution service is missing', () => {
      expect(startEvolutionScheduler({})).toBeNull();
    });

    it('runs ONE full pass per nightly anchor and re-arms for the next day', async () => {
      const fake = serviceFake();
      const timer = scheduleEvolution(fake);
      expect(timer).not.toBeNull();

      await jest.advanceTimersByTimeAsync(3600000);
      expect(fake.runEvolutionPass).toHaveBeenCalledTimes(1);
      expect(fake.runEvolutionPass).toHaveBeenCalledWith({ passes: 'full' });

      await jest.advanceTimersByTimeAsync(DAY);
      expect(fake.runEvolutionPass).toHaveBeenCalledTimes(2);
    });

    it('AI_EVOLUTION_ENABLED=false at fire time performs zero acts and still re-arms', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const fake = serviceFake();
      scheduleEvolution(fake, { AI_EVOLUTION_ENABLED: 'false' });

      await jest.advanceTimersByTimeAsync(3600000);
      expect(fake.runEvolutionPass).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('AI_EVOLUTION_ENABLED=false'));

      // config flips back on → the next anchor runs the pass
      await jest.advanceTimersByTimeAsync(DAY);
      expect(logSpy).toHaveBeenCalledTimes(2);
      logSpy.mockRestore();
    });

    it('AI_EVOLUTION_NIGHTLY_ENABLED=false pauses the slot', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const fake = serviceFake();
      scheduleEvolution(fake, { AI_EVOLUTION_NIGHTLY_ENABLED: 'false' });

      await jest.advanceTimersByTimeAsync(3600000);
      expect(fake.runEvolutionPass).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('AI_EVOLUTION_NIGHTLY_ENABLED=false')
      );
      logSpy.mockRestore();
    });

    it('a failing pass is logged and never throws out of the tick', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const fake = {
        runEvolutionPass: jest.fn(async () => {
          throw new Error('evolution exploded');
        }),
      };
      scheduleEvolution(fake);

      await expect(jest.advanceTimersByTimeAsync(3600000)).resolves.not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(
        'Scheduled evolution pass failed:',
        'evolution exploded'
      );
      errorSpy.mockRestore();

      // still re-armed
      await jest.advanceTimersByTimeAsync(DAY);
      expect(fake.runEvolutionPass).toHaveBeenCalledTimes(2);
    });
  });
});
