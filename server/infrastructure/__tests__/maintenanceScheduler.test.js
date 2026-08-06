'use strict';

const {
  startGcScheduler,
  runStartupFailSafeRecovery,
  shouldSkip,
  resolveIntervalMs,
} = require('../maintenanceScheduler');

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
    const saved = process.env.GC_INTERVAL_MS;

    afterEach(() => {
      if (saved === undefined) delete process.env.GC_INTERVAL_MS;
      else process.env.GC_INTERVAL_MS = saved;
    });

    it('returns 0 when unset', () => {
      delete process.env.GC_INTERVAL_MS;
      expect(resolveIntervalMs()).toBe(0);
    });

    it('returns the configured positive interval', () => {
      process.env.GC_INTERVAL_MS = '3600000';
      expect(resolveIntervalMs()).toBe(3600000);
    });

    it('returns 0 for zero or invalid values', () => {
      process.env.GC_INTERVAL_MS = '0';
      expect(resolveIntervalMs()).toBe(0);
      process.env.GC_INTERVAL_MS = 'not-a-number';
      expect(resolveIntervalMs()).toBe(0);
    });
  });

  describe('startGcScheduler', () => {
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
      const prev = process.env.GC_INTERVAL_MS;
      delete process.env.GC_INTERVAL_MS;
      try {
        const timer = startGcScheduler({ gcService: { runGcCycle: jest.fn() } });
        expect(timer).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.GC_INTERVAL_MS;
        else process.env.GC_INTERVAL_MS = prev;
      }
    });

    it('schedules a periodic run when configured', () => {
      jest.useFakeTimers();
      const prev = process.env.GC_INTERVAL_MS;
      const prevSkip = process.env.WEA_SKIP_GC_SCHEDULER;
      process.env.GC_INTERVAL_MS = '1000';
      delete process.env.WEA_SKIP_GC_SCHEDULER;

      try {
        const runGcCycle = jest.fn(() => Promise.resolve({ tier1: {}, tier2: {} }));
        const timer = startGcScheduler({ gcService: { runGcCycle } });

        expect(timer).not.toBeNull();
        jest.advanceTimersByTime(3000);
        expect(runGcCycle).toHaveBeenCalledTimes(3);

        clearInterval(timer);
      } finally {
        if (prev === undefined) delete process.env.GC_INTERVAL_MS;
        else process.env.GC_INTERVAL_MS = prev;
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
        runStartupRecovery: jest.fn(() => Promise.resolve({ scanned: 1, resolved: 0, manualReview: [{ nodeId: 1, path: '/x' }] })),
      };
      const report = await runStartupFailSafeRecovery({ failSafeService });
      expect(report.scanned).toBe(1);
      expect(report.manualReview).toHaveLength(1);
    });
  });
});
