'use strict';

/**
 * admin_reports plumbing (§4.14 Tier A / T0.7b): constants + best-effort
 * report-writer seam. The admin_reports TABLE DDL is owned by T0.2
 * (001_initial_normalized_schema.sql) and the store/routes by T0.8 — until
 * then the writer is injected (DI) or inert. Writes are best-effort: a
 * missing/throwing insertReport is caught and warn-logged; GC/cleanup/boot
 * must never fail because reporting failed.
 *
 * @see docs/spec/server/routes/admin.md §3.2
 */

const {
  ADMIN_REPORT_KINDS,
  ADMIN_REPORT_STATUSES,
  createAdminReportsWriter,
  getAdminReportsWriter,
  resolveAdminReportStatus,
} = require('../adminReportsService');

function savedEnv(name) {
  const value = process.env[name];
  return () => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
}

describe('adminReportsService constants', () => {
  it('freezes the admin_reports.kind CHECK enum (§5)', () => {
    expect(ADMIN_REPORT_KINDS).toEqual({
      gc: 'gc',
      migration: 'migration',
      failsafe: 'failsafe',
      night_eval: 'night_eval',
      cleanup: 'cleanup',
    });
    expect(Object.isFrozen(ADMIN_REPORT_KINDS)).toBe(true);
  });

  it('freezes the status enum (ok | partial)', () => {
    expect(ADMIN_REPORT_STATUSES).toEqual({ ok: 'ok', partial: 'partial' });
    expect(Object.isFrozen(ADMIN_REPORT_STATUSES)).toBe(true);
  });
});

describe('resolveAdminReportStatus', () => {
  it('reports ok when there are no errors', () => {
    expect(resolveAdminReportStatus({ errors: [] })).toBe('ok');
    expect(resolveAdminReportStatus({})).toBe('ok');
    expect(resolveAdminReportStatus(undefined)).toBe('ok');
  });

  it('reports partial when top-level errors exist (cleanup result shape)', () => {
    expect(resolveAdminReportStatus({ errors: ['boom'] })).toBe('partial');
  });

  it('reports partial when a nested section carries errors (gc tier shape)', () => {
    const gcResult = {
      tier1: { orphanedRows: 1, errors: ['blob delete failed'] },
      tier2: { scannedKeys: 0, errors: [] },
      tier3: { purgedNodes: 0, errors: [] },
    };
    expect(resolveAdminReportStatus(gcResult)).toBe('partial');
    expect(resolveAdminReportStatus({ tier1: { errors: [] }, tier2: { errors: [] } })).toBe('ok');
  });
});

describe('createAdminReportsWriter', () => {
  it('writes a row through the injected insertReport with kind/status/payload/createdAt', async () => {
    const insertReport = jest.fn((row) => Promise.resolve({ id: 1, ...row }));
    const now = jest.fn(() => '2026-09-22T00:00:00.000Z');
    const writer = createAdminReportsWriter({ insertReport, now });

    const payload = { gc: { tier1: {}, tier2: {} }, orphanedNodes: [] };
    const row = await writer.writeReport({
      kind: ADMIN_REPORT_KINDS.cleanup,
      status: ADMIN_REPORT_STATUSES.ok,
      payload,
    });

    expect(insertReport).toHaveBeenCalledWith({
      kind: 'cleanup',
      status: 'ok',
      payload,
      created_at: '2026-09-22T00:00:00.000Z',
    });
    expect(row).toMatchObject({ id: 1, kind: 'cleanup', status: 'ok' });
  });

  it('is inert without an insertReport (graceful absence — store lands with T0.8)', async () => {
    const writer = createAdminReportsWriter({});
    await expect(
      writer.writeReport({ kind: ADMIN_REPORT_KINDS.gc, status: 'ok', payload: {} })
    ).resolves.toBeNull();
  });

  it('returns null when the insertReport throws (e.g. admin_reports table not yet migrated)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const insertReport = jest.fn(() => {
        throw new Error('no such table: admin_reports');
      });
      const writer = createAdminReportsWriter({ insertReport });

      await expect(
        writer.writeReport({ kind: ADMIN_REPORT_KINDS.gc, status: 'ok', payload: { x: 1 } })
      ).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('admin report persistence skipped')
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no-ops under the WEA_SKIP_ADMIN_REPORTS test seam', async () => {
    const restore = savedEnv('WEA_SKIP_ADMIN_REPORTS');
    process.env.WEA_SKIP_ADMIN_REPORTS = '1';
    try {
      const insertReport = jest.fn();
      const writer = createAdminReportsWriter({ insertReport });

      await expect(
        writer.writeReport({ kind: ADMIN_REPORT_KINDS.gc, status: 'ok', payload: {} })
      ).resolves.toBeNull();
      expect(insertReport).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('rejects an unknown kind (call sites must use ADMIN_REPORT_KINDS)', async () => {
    const writer = createAdminReportsWriter({ insertReport: jest.fn() });
    await expect(writer.writeReport({ kind: 'bogus', status: 'ok', payload: {} })).rejects.toThrow(
      TypeError
    );
  });

  it('normalizes an undefined payload to null', async () => {
    const insertReport = jest.fn((row) => Promise.resolve(row));
    const writer = createAdminReportsWriter({ insertReport });

    await writer.writeReport({ kind: ADMIN_REPORT_KINDS.failsafe, status: 'ok' });
    expect(insertReport).toHaveBeenCalledWith(expect.objectContaining({ payload: null }));
  });
});

describe('getAdminReportsWriter (shared singleton)', () => {
  it('returns the same writer instance and is inert by default (pre-T0.8)', async () => {
    const writer = getAdminReportsWriter();
    expect(getAdminReportsWriter()).toBe(writer);
    await expect(
      writer.writeReport({ kind: ADMIN_REPORT_KINDS.gc, status: 'ok', payload: {} })
    ).resolves.toBeNull();
  });
});
