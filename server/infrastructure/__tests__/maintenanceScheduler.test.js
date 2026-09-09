'use strict';

let mockGetConfigSync;

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
  });

  describe('runStartupFailSafeRecovery', () => {
    it('returns an empty report when no service is provided', async () => {
      const report = await runStartupFailSafeRecovery({});
      expect(report).toEqual({ scanned: 0, resolved: 0, manualReview: [] });
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
          Promise.resolve({ scanned: 0, resolved: 0, manualReview: [], pendingUpload: { scanned: 0, nodes: [] } })
        );
        await runStartupFailSafeRecovery({ failSafeService });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });
});
