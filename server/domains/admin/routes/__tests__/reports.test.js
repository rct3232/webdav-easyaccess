'use strict';

/**
 * Admin reports routes (T0.8): GET /reports, GET /reports/:id,
 * POST /reports/:id/repair (kind/action dispatch: content_hash backfill +
 * repair-sync/perm-delete delegation) + the cleanup/orphaned → admin_reports
 * row parity (§4.14 Tier A).
 *
 * @see docs/spec/server/routes/admin.md §2.2.6, §2.4 reports, §2.7
 */

const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestFileNode,
  dbQuery,
  dbRun,
} = require('../../../../test-utils');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { sha256HexLower } = require('../../../../utils/hash');

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

// The composition's blob store wraps THIS client instance (per-test
// implementations are configured on it).
let webdav;
let app;
let dbCleanup;
const previousFileStorage = process.env.WEA_FILE_STORAGE;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
  const composition = require('../../../../service/composition');
  webdav = createWebdavMock();
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore: new WebdavBlobStore(webdav),
    gcService: {
      runGcCycle: jest.fn(() =>
        Promise.resolve({ tier1: { errors: [] }, tier2: { errors: [] }, tier3: { errors: [] } })
      ),
    },
    // failSafeService stays the real composition core so the repair-sync /
    // perm-delete delegations exercise the §2.2.3 implementations.
  });
  app = require('../../../../index');
});

afterAll(async () => {
  await dbCleanup?.();
  process.env.WEA_FILE_STORAGE = previousFileStorage;
});

beforeEach(jest.clearAllMocks);

async function adminUser(prefix) {
  return createAuthenticatedTestUser({ username: `${prefix}-${Date.now()}`, isAdmin: true });
}

async function insertReportRow(kind, status, payload, createdAt) {
  const result = await dbRun(
    `INSERT INTO admin_reports (kind, status, payload, created_at) VALUES (?, ?, ?, ?)`,
    [kind, status, payload === null ? null : JSON.stringify(payload), createdAt]
  );
  return result.lastID;
}

async function countReports(kind) {
  const res = await dbQuery(
    kind
      ? 'SELECT COUNT(*) AS cnt FROM admin_reports WHERE kind = ?'
      : 'SELECT COUNT(*) AS cnt FROM admin_reports',
    kind ? [kind] : []
  );
  return Number(res.rows[0].cnt);
}

describe('Route matrix: non-admin denied on the reports routes', () => {
  it('returns 403 for a non-admin on GET /reports, GET /reports/:id and POST /reports/:id/repair', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `reports-nonadmin-${Date.now()}`,
      isAdmin: false,
    });

    const list = await request(app)
      .get('/api/admin/reports')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);
    expect(list.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);

    const one = await request(app)
      .get('/api/admin/reports/1')
      .set('Authorization', `Bearer ${token}`);
    expect(one.status).toBe(403);

    const repair = await request(app)
      .post('/api/admin/reports/1/repair')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });
    expect(repair.status).toBe(403);
  });
});

describe('GET /api/admin/reports', () => {
  it('lists persisted rows newest first with the parsed payload', async () => {
    const { token } = await adminUser('reports-list');
    const olderId = await insertReportRow(
      'gc',
      'ok',
      { tier1: { errors: [] } },
      '2026-09-22T06:00:00.000Z'
    );
    const newerId = await insertReportRow(
      'cleanup',
      'partial',
      { errors: ['boom'] },
      '2026-09-22T07:00:00.000Z'
    );

    const res = await request(app)
      .get('/api/admin/reports')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.reports.map((r) => r.id);
    expect(ids.indexOf(newerId)).toBeLessThan(ids.indexOf(olderId));

    const newer = res.body.reports.find((r) => r.id === newerId);
    expect(newer).toMatchObject({ kind: 'cleanup', status: 'partial' });
    expect(newer.payload).toEqual({ errors: ['boom'] });
    expect(newer.created_at).toBe('2026-09-22T07:00:00.000Z');
  });
});

describe('GET /api/admin/reports/:id', () => {
  it('returns the row for an admin and 404 for an unknown id', async () => {
    const { token } = await adminUser('reports-read');
    const rowId = await insertReportRow(
      'failsafe',
      'ok',
      { scanned: 0 },
      '2026-09-22T06:30:00.000Z'
    );

    const res = await request(app)
      .get(`/api/admin/reports/${rowId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({ id: rowId, kind: 'failsafe', status: 'ok' });

    const missing = await request(app)
      .get('/api/admin/reports/999999999')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/admin/reports/:id/repair — content_hash backfill (T0.1)', () => {
  it('backfills all NULL filecache.content_hash rows, re-renders the row and is idempotent', async () => {
    const { token } = await adminUser('reports-backfill');

    const fileA = await createTestFileNode({ name: `a-${Date.now()}.txt`, parentId: null });
    const fileB = await createTestFileNode({ name: `b-${Date.now()}.txt`, parentId: null });
    const fileC = await createTestFileNode({ name: `c-${Date.now()}.txt`, parentId: null });

    const bufA = Buffer.from('alpha-content');
    const bufB = Buffer.from('beta-content');
    await webdav.getFileContents.mockImplementation((p) => {
      if (p === fileA.path) return Promise.resolve(bufA);
      if (p === fileB.path) return Promise.resolve(bufB);
      return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
    });

    const store = require('../../../../store/fileNodesStore').createFileNodesStore();
    await store.upsertCache(fileA.nodeId, bufA.length, 'text/plain', null);
    await store.upsertCache(fileB.nodeId, bufB.length, 'text/plain', null);
    await store.upsertCache(fileC.nodeId, 1, 'text/plain', 'preset-hash'); // non-NULL: never touched

    const rowId = await insertReportRow(
      'failsafe',
      'partial',
      { contentHashCompleteness: { nullCount: 2, checkedAt: '2026-09-22T06:00:00.000Z' } },
      '2026-09-22T06:00:00.000Z'
    );

    const res = await request(app)
      .post(`/api/admin/reports/${rowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.admin.reportRepaired);
    expect(res.body.report.status).toBe('ok');
    expect(res.body.report.payload.contentHashCompleteness).toMatchObject({
      nullCount: 0,
      backfilled: 2,
    });
    expect(res.body.result).toEqual({
      backfilled: 2,
      nullCount: 0,
      errors: [],
      checkedAt: expect.any(String),
    });

    const hashA = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
      fileA.nodeId,
    ]);
    expect(hashA.rows[0].content_hash).toBe(sha256HexLower(bufA));
    const hashC = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
      fileC.nodeId,
    ]);
    expect(hashC.rows[0].content_hash).toBe('preset-hash');

    // Idempotency: a second run changes nothing.
    const again = await request(app)
      .post(`/api/admin/reports/${rowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });

    expect(again.status).toBe(200);
    expect(again.body.result.backfilled).toBe(0);
    expect(again.body.report.payload.contentHashCompleteness.nullCount).toBe(0);
  });

  it('covers trashed WebDAV rows via their /.wea-trash/ io path', async () => {
    const { token } = await adminUser('reports-trash');
    const dirName = `trashdir-${Date.now()}`;
    const fileName = `trashfile-${Date.now()}.txt`;
    const dir = await createTestFileNode({ name: dirName, type: 'directory' });
    const file = await createTestFileNode({ name: fileName, parentId: dir.nodeId });

    const buf = Buffer.from('trashed-content');
    await webdav.getFileContents.mockImplementation((p) =>
      Promise.resolve(
        p === `/.wea-trash/${dir.nodeId}/${fileName}`
          ? buf
          : Promise.reject(Object.assign(new Error('nf'), { status: 404 }))
      )
    );

    const store = require('../../../../store/fileNodesStore').createFileNodesStore();
    await store.upsertCache(file.nodeId, buf.length, 'text/plain', null);
    await store.markSubtreeDeleted([dir.nodeId, file.nodeId]);

    const rowId = await insertReportRow(
      'failsafe',
      'partial',
      { contentHashCompleteness: { nullCount: 1, checkedAt: '2026-09-22T06:00:00.000Z' } },
      '2026-09-22T06:00:00.000Z'
    );

    const res = await request(app)
      .post(`/api/admin/reports/${rowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });

    expect(res.status).toBe(200);
    expect(res.body.report.payload.contentHashCompleteness.nullCount).toBe(0);
    const hash = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
      file.nodeId,
    ]);
    expect(hash.rows[0].content_hash).toBe(sha256HexLower(buf));
  });

  it('404 for an unknown report id; 400 repairNotAvailable for undispatchable rows/actions', async () => {
    const { token } = await adminUser('reports-err');
    const gcRowId = await insertReportRow('gc', 'ok', { tier1: {} }, '2026-09-22T06:10:00.000Z');
    const bareFailsafeId = await insertReportRow(
      'failsafe',
      'ok',
      { scanned: 0 },
      '2026-09-22T06:11:00.000Z'
    );

    const missing = await request(app)
      .post('/api/admin/reports/999999999/repair')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe(SERVER_ERROR_CODES.admin.reportNotFound);

    const wrongKind = await request(app)
      .post(`/api/admin/reports/${gcRowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.errorCode).toBe(SERVER_ERROR_CODES.admin.repairNotAvailable);

    const noSection = await request(app)
      .post(`/api/admin/reports/${bareFailsafeId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'content_hash' });
    expect(noSection.status).toBe(400);
    expect(noSection.body.errorCode).toBe(SERVER_ERROR_CODES.admin.repairNotAvailable);

    const unknownAction = await request(app)
      .post(`/api/admin/reports/${gcRowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'nonsense' });
    expect(unknownAction.status).toBe(400);
    expect(unknownAction.body.errorCode).toBe(SERVER_ERROR_CODES.admin.repairNotAvailable);
  });

  it('delegates repair-sync to the existing fail-safe repair core', async () => {
    const { token } = await adminUser('reports-rsync');
    const dir = await createTestFileNode({ name: `rsync-${Date.now()}`, type: 'directory' });
    await dbRun('UPDATE file_nodes SET sync_status = ? WHERE id = ?', [
      'orphaned_node',
      dir.nodeId,
    ]);
    const rowId = await insertReportRow(
      'failsafe',
      'partial',
      { scanned: 1 },
      '2026-09-22T06:20:00.000Z'
    );

    const res = await request(app)
      .post(`/api/admin/reports/${rowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'repair-sync', nodeId: dir.nodeId, repairAction: 'force-active' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.admin.repairSyncDone);
    expect(res.body.result).toMatchObject({ nodeId: dir.nodeId, status: 'resolved' });
    expect(res.body.report.id).toBe(rowId);
  });

  it('delegates perm-delete to the shared purge core and validates the nodeId', async () => {
    const { token } = await adminUser('reports-pdel');
    const node = await createTestFileNode({ name: `pdel-${Date.now()}.txt` });
    const rowId = await insertReportRow(
      'failsafe',
      'partial',
      { scanned: 1 },
      '2026-09-22T06:25:00.000Z'
    );

    const res = await request(app)
      .post(`/api/admin/reports/${rowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'perm-delete', nodeId: node.nodeId });
    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.admin.permDeleteDone);
    expect(res.body.result).toEqual({ nodeId: node.nodeId, deletedCount: 1 });

    const gone = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [node.nodeId]);
    expect(gone.rows).toHaveLength(0);

    const invalid = await request(app)
      .post(`/api/admin/reports/${rowId}/repair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'perm-delete', nodeId: 0 });
    expect(invalid.status).toBe(400);
  });
});

describe('cleanup/orphaned → admin_reports row parity (§4.14 Tier A)', () => {
  it('persists exactly one new cleanup row with the same result body the response returned', async () => {
    const { token } = await adminUser('reports-parity');
    const before = await countReports('cleanup');

    const res = await request(app)
      .post('/api/admin/cleanup/orphaned')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    const after = await countReports('cleanup');
    expect(after).toBe(before + 1);

    const latest = await dbQuery(
      'SELECT kind, status, payload FROM admin_reports WHERE kind = ? ORDER BY id DESC LIMIT 1',
      ['cleanup']
    );
    expect(latest.rows[0].kind).toBe('cleanup');
    const payload =
      typeof latest.rows[0].payload === 'string'
        ? JSON.parse(latest.rows[0].payload)
        : latest.rows[0].payload;
    expect(payload).toEqual(res.body.results);
  });
});
