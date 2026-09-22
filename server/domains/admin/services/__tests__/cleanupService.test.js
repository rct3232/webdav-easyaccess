'use strict';

/**
 * cleanupOrphanedData admin_reports persistence (§4.14 Tier A / T0.7b) +
 * the T0.1 boot content-hash completeness probe kick. The GC/cleanup result
 * bodies are unchanged (additive row persistence only); composition is mocked
 * so no real store/blob access happens.
 *
 * @see docs/spec/server/routes/admin.md §2.2.3, §2.2.6, §2.5
 */

jest.mock('../../../../store/adminReportsStore', () => ({
  insertReport: jest.fn(() => Promise.resolve({ id: 1 })),
  listReports: jest.fn(() => Promise.resolve([])),
  getReport: jest.fn(() => Promise.resolve(null)),
  updateReport: jest.fn(() => Promise.resolve(null)),
}));

const mockRunContentHashCompletenessProbe = jest.fn(() =>
  Promise.resolve({ nullCount: 0, checkedAt: '', row: null })
);

jest.mock('../adminReportsService', () => {
  const actual = jest.requireActual('../adminReportsService');
  return {
    ...actual,
    runContentHashCompletenessProbe: (...args) => mockRunContentHashCompletenessProbe(...args),
  };
});

jest.mock('../../../../service/composition', () => ({
  getComposition: jest.fn(() => ({
    gcService: {
      runGcCycle: jest.fn(() =>
        Promise.resolve({ tier1: { errors: [] }, tier2: { errors: [] }, tier3: { errors: [] } })
      ),
    },
    failSafeService: {
      scanOrphanedNodes: jest.fn(() => Promise.resolve([{ nodeId: 1, path: '/a' }])),
      scanPendingUploadNodes: jest.fn(() => Promise.resolve([])),
    },
    blobStorageService: {},
  })),
}));

jest.mock('../../../../models/User', () => ({ findById: jest.fn(), findAll: jest.fn() }));

jest.mock('../../../../store/permissionStore', () => ({
  checkPermission: jest.fn(),
  grant: jest.fn(),
  removeOwnSubtreePermissions: jest.fn(),
}));

const { cleanupOrphanedData } = require('../cleanupService');

describe('cleanupOrphanedData admin_reports persistence (T0.7b)', () => {
  it('persists the full cleanup result as a kind=cleanup row (status ok, no errors)', async () => {
    const writeReport = jest.fn(() => Promise.resolve({ id: 3 }));
    const results = await cleanupOrphanedData({ adminReportsWriter: { writeReport } });

    expect(writeReport).toHaveBeenCalledTimes(1);
    expect(writeReport).toHaveBeenCalledWith({
      kind: 'cleanup',
      status: 'ok',
      payload: results,
    });
  });

  it('persists status=partial when the run collected errors', async () => {
    const { getComposition } = require('../../../../service/composition');
    getComposition.mockImplementationOnce(() => ({
      gcService: {
        runGcCycle: jest.fn(() => Promise.reject(new Error('gc exploded'))),
      },
      failSafeService: {
        scanOrphanedNodes: jest.fn(() => Promise.resolve([])),
        scanPendingUploadNodes: jest.fn(() => Promise.resolve([])),
      },
      blobStorageService: {},
    }));

    const writeReport = jest.fn(() => Promise.resolve(null));
    const results = await cleanupOrphanedData({ adminReportsWriter: { writeReport } });

    expect(results.errors.length).toBeGreaterThan(0);
    expect(writeReport).toHaveBeenCalledWith({
      kind: 'cleanup',
      status: 'partial',
      payload: results,
    });
  });

  it('is inert without an injected writer (graceful absence until the store lands)', async () => {
    const results = await cleanupOrphanedData();
    expect(results.gc).toEqual(
      expect.objectContaining({ tier1: expect.anything(), tier2: expect.anything() })
    );
  });

  it('a persisting failure never fails the cleanup itself', async () => {
    const writeReport = jest.fn(() => Promise.reject(new Error('writer down')));
    const results = await cleanupOrphanedData({ adminReportsWriter: { writeReport } });

    expect(writeReport).toHaveBeenCalledTimes(1);
    expect(results.gc).toBeDefined();
  });
});

describe('ensureHomeOwnerAdminForAllUsers boot probe kick (T0.1)', () => {
  it('kicks the content-hash completeness probe fire-and-forget (non-blocking)', async () => {
    const { ensureHomeOwnerAdminForAllUsers } = require('../cleanupService');
    const User = require('../../../../models/User');

    User.findAll.mockResolvedValue([]);
    await ensureHomeOwnerAdminForAllUsers();

    expect(mockRunContentHashCompletenessProbe).toHaveBeenCalledTimes(1);
  });

  it('a probe failure never fails the permission cleanup (fire-and-forget contract)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { ensureHomeOwnerAdminForAllUsers } = require('../cleanupService');
    const User = require('../../../../models/User');

    mockRunContentHashCompletenessProbe.mockImplementationOnce(() =>
      Promise.reject(new Error('probe down'))
    );
    User.findAll.mockResolvedValue([]);

    try {
      await expect(ensureHomeOwnerAdminForAllUsers()).resolves.toMatchObject({
        updatedUsers: 0,
        errors: [],
      });
      // Let the floating rejection settle.
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
