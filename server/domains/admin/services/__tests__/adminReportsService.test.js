'use strict';

/**
 * admin_reports plumbing (§4.14 Tier A / T0.7b) + T0.8 store wiring, boot
 * completeness probe (T0.1) and the kind/action repair dispatch.
 *
 * @see docs/spec/server/routes/admin.md §2.2.6, §2.4 reports, §2.5
 */

jest.mock('../../../../store/adminReportsStore', () => ({
  insertReport: jest.fn(() => Promise.resolve({ id: 7 })),
  listReports: jest.fn(() => Promise.resolve([])),
  getReport: jest.fn(() => Promise.resolve(null)),
  updateReport: jest.fn(() => Promise.resolve(null)),
  deleteReportsOlderThan: jest.fn(() => Promise.resolve({ changes: 0 })),
}));

jest.mock('../../../../infrastructure/configResolver', () => ({
  getSharedResolver: jest.fn(() => ({ getConfig: jest.fn(() => Promise.resolve('30')) })),
  setSharedResolver: jest.fn(),
  createConfigResolver: jest.fn(),
  populateT1Env: jest.fn(),
}));

const {
  ADMIN_REPORT_KINDS,
  ADMIN_REPORT_STATUSES,
  ADMIN_REPAIR_ACTIONS,
  DEFAULT_ADMIN_REPORTS_RETENTION_DAYS,
  createAdminReportsWriter,
  getAdminReportsWriter,
  repairAdminReport,
  resolveAdminReportStatus,
  collectContentHashCompleteness,
  backfillContentHashes,
} = require('../adminReportsService');
const adminReportsStore = require('../../../../store/adminReportsStore');
const { sha256HexLower } = require('../../../../utils/hash');

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

  it('ships the admin_reports retention default (30 days; 0 = off)', () => {
    expect(DEFAULT_ADMIN_REPORTS_RETENTION_DAYS).toBe(30);
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

  it('routes through the admin_reports store when no insertReport is injected (T0.8 wiring)', async () => {
    const writer = createAdminReportsWriter({});
    await expect(
      writer.writeReport({ kind: ADMIN_REPORT_KINDS.gc, status: 'ok', payload: {} })
    ).resolves.toMatchObject({ id: expect.any(Number) });
    expect(adminReportsStore.insertReport).toHaveBeenCalled();
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

describe('createAdminReportsWriter — append-only', () => {
  it('never prunes on a successful write', async () => {
    adminReportsStore.deleteReportsOlderThan.mockClear();
    const writer = createAdminReportsWriter({
      insertReport: jest.fn(() => Promise.resolve({ id: 1 })),
    });

    await expect(
      writer.writeReport({ kind: ADMIN_REPORT_KINDS.gc, status: 'ok', payload: {} })
    ).resolves.toMatchObject({ id: 1 });
    expect(adminReportsStore.deleteReportsOlderThan).not.toHaveBeenCalled();
  });

  it('keeps the shared writer append-only (retention belongs to maintenanceScheduler)', async () => {
    adminReportsStore.deleteReportsOlderThan.mockClear();
    const writer = getAdminReportsWriter();

    await writer.writeReport({ kind: ADMIN_REPORT_KINDS.cleanup, status: 'ok', payload: {} });
    expect(adminReportsStore.deleteReportsOlderThan).not.toHaveBeenCalled();
  });
});

describe('ADMIN_REPAIR_ACTIONS (T0.8 dispatch table)', () => {
  it('freezes the dispatch action enum', () => {
    expect(ADMIN_REPAIR_ACTIONS).toEqual({
      content_hash: 'content_hash',
      repair_sync: 'repair-sync',
      perm_delete: 'perm-delete',
    });
    expect(Object.isFrozen(ADMIN_REPAIR_ACTIONS)).toBe(true);
  });
});

describe('collectContentHashCompleteness (T0.1 boot probe section)', () => {
  const fileNodesStore = (nullCount) => ({
    countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(nullCount)),
  });

  it('warn-logs and returns the contentHashCompleteness section when NULL rows exist', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const section = await collectContentHashCompleteness({
        fileNodesStore: fileNodesStore(2),
        now: () => '2026-09-22T08:00:00.000Z',
      });
      expect(section).toEqual({ nullCount: 2, checkedAt: '2026-09-22T08:00:00.000Z' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('content_hash'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns nullCount 0 and stays silent when no NULL rows exist', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const section = await collectContentHashCompleteness({
        fileNodesStore: fileNodesStore(0),
        now: () => '2026-09-22T08:01:00.000Z',
      });
      expect(section).toEqual({ nullCount: 0, checkedAt: '2026-09-22T08:01:00.000Z' });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never throws when the count fails — returns a null-count section and warns (best-effort)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const section = await collectContentHashCompleteness({
        fileNodesStore: {
          countCacheRowsWithNullContentHash: jest.fn(() => Promise.reject(new Error('db down'))),
        },
        now: () => '2026-09-22T08:02:00.000Z',
      });
      expect(section).toMatchObject({ nullCount: null, error: 'db down' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('probe skipped'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('backfillContentHashes (T0.1 repair backfill)', () => {
  it('streams batches, hashes each blob and updates WHERE content_hash IS NULL only', async () => {
    const rows = [{ nodeId: 1, name: 'a.txt', type: 'file', deletedAt: null }];
    const fileNodesStore = {
      listCacheRowsWithNullContentHash: jest
        .fn()
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([]),
      countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(0)),
      setCacheContentHash: jest.fn(() => Promise.resolve({ changes: 1 })),
    };
    const fileNodeService = { getNodePath: jest.fn(() => Promise.resolve('/a.txt')) };
    const blobStore = { downloadBlob: jest.fn(() => Promise.resolve(Buffer.from('alpha'))) };

    const result = await backfillContentHashes({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode: 'webdav',
      batchSize: 1,
      now: () => '2026-09-22T09:00:00.000Z',
    });

    expect(blobStore.downloadBlob).toHaveBeenCalledWith('/a.txt');
    expect(fileNodesStore.setCacheContentHash).toHaveBeenCalledWith(
      1,
      sha256HexLower(Buffer.from('alpha'))
    );
    expect(result).toEqual({
      backfilled: 1,
      nullCount: 0,
      errors: [],
      checkedAt: '2026-09-22T09:00:00.000Z',
    });
  });

  it('keeps going across batches via keyset pagination (cursor moves past processed rows)', async () => {
    const fileNodesStore = {
      listCacheRowsWithNullContentHash: jest
        .fn()
        .mockResolvedValueOnce([{ nodeId: 1, name: 'a', type: 'file', deletedAt: null }])
        .mockResolvedValueOnce([{ nodeId: 5, name: 'b', type: 'file', deletedAt: null }])
        .mockResolvedValueOnce([]),
      countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(0)),
      setCacheContentHash: jest.fn(() => Promise.resolve({ changes: 1 })),
    };
    const progress = jest.fn();

    const result = await backfillContentHashes({
      fileNodesStore,
      fileNodeService: { getNodePath: jest.fn((id) => Promise.resolve(`/p${id}`)) },
      blobStore: { downloadBlob: jest.fn(() => Promise.resolve(Buffer.from('x'))) },
      fileStorageMode: 'webdav',
      batchSize: 1,
      onProgress: progress,
      now: () => '2026-09-22T09:05:00.000Z',
    });

    expect(result.backfilled).toBe(2);
    expect(fileNodesStore.listCacheRowsWithNullContentHash).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ afterId: 1 })
    );
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('resolves trashed WebDAV rows to their /.wea-trash/ io path (topmost trashed ancestor)', async () => {
    const fileNodesStore = {
      listCacheRowsWithNullContentHash: jest
        .fn()
        .mockResolvedValueOnce([
          { nodeId: 31, name: 'child.txt', type: 'file', deletedAt: '2026-09-01T00:00:00.000Z' },
        ])
        .mockResolvedValueOnce([]),
      countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(0)),
      setCacheContentHash: jest.fn(() => Promise.resolve({ changes: 1 })),
      getAncestorChain: jest.fn(() =>
        Promise.resolve([
          { ancestorId: 30, depth: 1 },
          { ancestorId: 31, depth: 0 },
        ])
      ),
      getNodeIncludingTrashed: jest.fn((id) =>
        Promise.resolve(
          id === 30
            ? { id: 30, name: 'dir', deletedAt: '2026-09-01T00:00:00.000Z' }
            : { id: 31, name: 'child.txt', deletedAt: '2026-09-01T00:00:00.000Z' }
        )
      ),
    };
    const fileNodeService = {
      getNodePath: jest.fn((id) => Promise.resolve(id === 30 ? '/dir' : '/dir/child.txt')),
    };
    const blobStore = {
      downloadBlob: jest.fn((p) =>
        Promise.resolve(p === '/.wea-trash/30/child.txt' ? Buffer.from('trashed') : null)
      ),
    };

    const result = await backfillContentHashes({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode: 'webdav',
      now: () => '2026-09-22T09:10:00.000Z',
    });

    expect(blobStore.downloadBlob).toHaveBeenCalledWith('/.wea-trash/30/child.txt');
    expect(fileNodesStore.setCacheContentHash).toHaveBeenCalledWith(31, sha256HexLower('trashed'));
    expect(result.errors).toEqual([]);
  });

  it('uses the active object s3_key in S3 mode', async () => {
    const fileNodesStore = {
      listCacheRowsWithNullContentHash: jest
        .fn()
        .mockResolvedValueOnce([{ nodeId: 9, name: 'a', type: 'file', deletedAt: null }])
        .mockResolvedValueOnce([]),
      countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(0)),
      setCacheContentHash: jest.fn(() => Promise.resolve({ changes: 1 })),
      getActiveObject: jest.fn(() => Promise.resolve({ id: 1, s3_key: 'uuid-1' })),
    };
    const blobStore = { downloadBlob: jest.fn(() => Promise.resolve(Buffer.from('s3bytes'))) };

    const result = await backfillContentHashes({
      fileNodesStore,
      blobStore,
      fileStorageMode: 's3',
      now: () => '2026-09-22T09:15:00.000Z',
    });

    expect(blobStore.downloadBlob).toHaveBeenCalledWith('uuid-1');
    expect(fileNodesStore.setCacheContentHash).toHaveBeenCalledWith(9, sha256HexLower('s3bytes'));
    expect(result.backfilled).toBe(1);
  });

  it('records a missing blob as an error without touching the row and keeps streaming', async () => {
    const fileNodesStore = {
      listCacheRowsWithNullContentHash: jest
        .fn()
        .mockResolvedValueOnce([
          { nodeId: 1, name: 'missing', type: 'file', deletedAt: null },
          { nodeId: 2, name: 'ok', type: 'file', deletedAt: null },
        ])
        .mockResolvedValueOnce([]),
      countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(1)),
      setCacheContentHash: jest.fn(() => Promise.resolve({ changes: 1 })),
    };
    const fileNodeService = { getNodePath: jest.fn((id) => Promise.resolve(`/p${id}`)) };
    const blobStore = {
      downloadBlob: jest.fn((p) => Promise.resolve(p === '/p1' ? null : Buffer.from('ok'))),
    };

    const result = await backfillContentHashes({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode: 'webdav',
      now: () => '2026-09-22T09:20:00.000Z',
    });

    expect(result.backfilled).toBe(1);
    expect(result.errors).toEqual([{ nodeId: 1, path: '/p1', error: 'blob not found' }]);
    expect(fileNodesStore.setCacheContentHash).not.toHaveBeenCalledWith(1, expect.anything());
    expect(fileNodesStore.setCacheContentHash).toHaveBeenCalledWith(
      2,
      sha256HexLower(Buffer.from('ok'))
    );
  });

  it('does not count a raced update (changes=0) as backfilled', async () => {
    const fileNodesStore = {
      listCacheRowsWithNullContentHash: jest
        .fn()
        .mockResolvedValueOnce([{ nodeId: 3, name: 'a', type: 'file', deletedAt: null }])
        .mockResolvedValueOnce([]),
      countCacheRowsWithNullContentHash: jest.fn(() => Promise.resolve(0)),
      setCacheContentHash: jest.fn(() => Promise.resolve({ changes: 0 })),
    };

    const result = await backfillContentHashes({
      fileNodesStore,
      fileNodeService: { getNodePath: jest.fn(() => Promise.resolve('/a')) },
      blobStore: { downloadBlob: jest.fn(() => Promise.resolve(Buffer.from('x'))) },
      fileStorageMode: 'webdav',
      now: () => '2026-09-22T09:20:00.000Z',
    });

    expect(result.backfilled).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe('repairAdminReport (T0.8 kind/action dispatch)', () => {
  const makeReportsStore = (row) => ({
    getReport: jest.fn(() => Promise.resolve(row)),
    updateReport: jest.fn((id, patch) =>
      Promise.resolve({
        ...row,
        ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })
    ),
  });

  const failsafeRow = {
    id: 21,
    kind: 'failsafe',
    status: 'partial',
    payload: {
      scanned: 0,
      resolved: 0,
      manualReview: [],
      contentHashCompleteness: { nullCount: 2, checkedAt: '2026-09-22T08:00:00.000Z' },
    },
    createdAt: '2026-09-22T08:00:00.000Z',
  };

  it('throws 404 reportNotFound for an unknown row id', async () => {
    const reportsStore = { getReport: jest.fn(() => Promise.resolve(null)) };

    await expect(
      repairAdminReport(404, { action: 'content_hash' }, { reportsStore })
    ).rejects.toMatchObject({ status: 404, errorCode: 'serverErrors.admin.reportNotFound' });
  });

  it('throws 400 repairNotAvailable for an unknown action', async () => {
    const reportsStore = makeReportsStore(failsafeRow);

    await expect(
      repairAdminReport(21, { action: 'nonsense' }, { reportsStore })
    ).rejects.toMatchObject({ status: 400, errorCode: 'serverErrors.admin.repairNotAvailable' });
  });

  it('throws 400 repairNotAvailable when content_hash targets a non-failsafe row', async () => {
    const reportsStore = makeReportsStore({ ...failsafeRow, kind: 'gc' });

    await expect(
      repairAdminReport(21, { action: 'content_hash' }, { reportsStore })
    ).rejects.toMatchObject({ status: 400, errorCode: 'serverErrors.admin.repairNotAvailable' });
  });

  it('throws 400 repairNotAvailable when the failsafe row has no contentHashCompleteness section', async () => {
    const reportsStore = makeReportsStore({ ...failsafeRow, payload: { scanned: 1 } });

    await expect(
      repairAdminReport(21, { action: 'content_hash' }, { reportsStore })
    ).rejects.toMatchObject({ status: 400, errorCode: 'serverErrors.admin.repairNotAvailable' });
  });

  it('runs the content_hash backfill and re-renders the row (nullCount 0, status ok)', async () => {
    const reportsStore = makeReportsStore(failsafeRow);
    const backfill = jest.fn(() =>
      Promise.resolve({
        backfilled: 2,
        nullCount: 0,
        errors: [],
        checkedAt: '2026-09-22T10:00:00.000Z',
      })
    );

    const { report, result } = await repairAdminReport(
      21,
      { action: 'content_hash' },
      { reportsStore, backfill }
    );

    expect(backfill).toHaveBeenCalled();
    expect(reportsStore.updateReport).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ status: 'ok' })
    );
    expect(report.payload.contentHashCompleteness).toMatchObject({
      nullCount: 0,
      backfilled: 2,
      backfilledAt: '2026-09-22T10:00:00.000Z',
    });
    expect(report.payload).toMatchObject({ scanned: 0, resolved: 0, manualReview: [] });
    expect(result).toMatchObject({ backfilled: 2, nullCount: 0 });
  });

  it('keeps status partial when NULL rows remain (e.g. missing blobs) and records the errors', async () => {
    const reportsStore = makeReportsStore(failsafeRow);
    const backfill = jest.fn(() =>
      Promise.resolve({
        backfilled: 1,
        nullCount: 1,
        errors: [{ nodeId: 5, path: '/x', error: 'blob not found' }],
        checkedAt: '2026-09-22T10:05:00.000Z',
      })
    );

    const { report } = await repairAdminReport(
      21,
      { action: 'content_hash' },
      { reportsStore, backfill }
    );

    expect(reportsStore.updateReport).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ status: 'partial' })
    );
    expect(report.payload.contentHashCompleteness.errors).toEqual([
      { nodeId: 5, path: '/x', error: 'blob not found' },
    ]);
  });

  it('dispatches repair-sync to the existing fail-safe repair core', async () => {
    const reportsStore = makeReportsStore(failsafeRow);
    const failSafeService = {
      repairNode: jest.fn(() =>
        Promise.resolve({
          nodeId: 5,
          action: 'force-active',
          status: 'resolved',
          path: '/x',
          detail: 'd',
        })
      ),
    };

    const { report, result } = await repairAdminReport(
      21,
      { action: 'repair-sync', nodeId: 5, repairAction: 'force-active' },
      { reportsStore, failSafeService }
    );

    expect(failSafeService.repairNode).toHaveBeenCalledWith(5, { action: 'force-active' });
    expect(result).toMatchObject({ status: 'resolved' });
    expect(report.id).toBe(21);
  });

  it('dispatches perm-delete to the shared trash purge core and validates the nodeId', async () => {
    const reportsStore = makeReportsStore(failsafeRow);
    const trashService = {
      purgeNode: jest.fn(() => Promise.resolve({ purgedNodes: 3, deletedBlobs: 1 })),
    };

    const { result } = await repairAdminReport(
      21,
      { action: 'perm-delete', nodeId: 5 },
      { reportsStore, trashService }
    );
    expect(trashService.purgeNode).toHaveBeenCalledWith(5);
    expect(result).toEqual({ nodeId: 5, deletedCount: 3 });

    await expect(
      repairAdminReport(21, { action: 'perm-delete' }, { reportsStore, trashService })
    ).rejects.toMatchObject({ status: 400 });
    expect(trashService.purgeNode).toHaveBeenCalledTimes(1);
  });

  it('surfaces the delegation errors of the existing repair cores unchanged', async () => {
    const reportsStore = makeReportsStore(failsafeRow);
    const failSafeService = {
      repairNode: jest.fn(() => Promise.reject(Object.assign(new Error('nope'), { status: 409 }))),
    };

    await expect(
      repairAdminReport(
        21,
        { action: 'repair-sync', nodeId: 5, repairAction: 'force-active' },
        { reportsStore, failSafeService }
      )
    ).rejects.toMatchObject({ status: 409 });
  });
});
