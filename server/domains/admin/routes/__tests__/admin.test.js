/**
 * Admin routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/admin.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestUser,
  createTestFileNode,
  createUserRootNode,
  dbQuery,
  USER_STATUS,
  PERMISSIONS,
} = require('../../../../test-utils');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const permissionStore = require('../../../../domains/permissions/stores/permissionStore');

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

/* ─── Hoisted S3 mock (for the S3-mode GC suite) ─────────────────────── */
const { createS3Mock } = require('@testing/mocks/s3Mock');

let currentMockS3;

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn(),
  };
});

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
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore: new WebdavBlobStore(createWebdavMock()),
  });
  app = require('../../../../index');
});

afterAll(async () => {
  await dbCleanup?.();
  process.env.WEA_FILE_STORAGE = previousFileStorage;
});

beforeEach(jest.clearAllMocks);

/* ─── S3/WebDAV mode helpers (replicate files.integration.test.js) ──── */
function wireS3Mock(s3Instance) {
  currentMockS3 = s3Instance || createS3Mock();
  const MockedS3Client = require('@aws-sdk/client-s3').S3Client;
  MockedS3Client.mockImplementation(() => ({
    send: async (command) => {
      const cmdName = command.constructor.name;
      if (cmdName === 'PutObjectCommand') return currentMockS3.putObject(command);
      if (cmdName === 'GetObjectCommand') return currentMockS3.getObject(command);
      if (cmdName === 'DeleteObjectCommand') return currentMockS3.deleteObject(command);
      if (cmdName === 'HeadObjectCommand') return currentMockS3.headObject(command);
      if (cmdName === 'CopyObjectCommand') return currentMockS3.copyObject(command);
      if (cmdName === 'ListObjectsV2Command') return currentMockS3.listObjectsV2(command);
      throw new Error(`Unknown command: ${cmdName}`);
    },
  }));
}

async function useS3Mode() {
  const S3BlobStore = require('../../../../infrastructure/adapters/blobstore/S3BlobStore');
  const store = new S3BlobStore({ fileStorageMode: 's3' });
  const comp = require('../../../../service/composition');
  comp.__setCompositionForTests({ fileStorageMode: 's3', blobStore: store });
}

async function useWebdavMode() {
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
  const comp = require('../../../../service/composition');
  comp.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore: new WebdavBlobStore(createWebdavMock()),
  });
}

describe('Route matrix: non-admin denied on every /api/admin/* route', () => {
  const ADMIN_ROUTES = [
    ['get', '/api/admin/settings'],
    ['put', '/api/admin/settings'],
    ['get', '/api/admin/users'],
    ['get', '/api/admin/users/pending'],
    ['post', '/api/admin/users'],
    ['post', '/api/admin/users/1/approve'],
    ['post', '/api/admin/users/1/reject'],
    ['delete', '/api/admin/users/1'],
    ['put', '/api/admin/users/1/permissions'],
    ['get', '/api/admin/folders/list'],
    ['post', '/api/admin/permissions/ensure-home-owner-admin'],
    ['post', '/api/admin/cleanup/orphaned'],
    ['post', '/api/admin/maintenance/gc'],
    ['post', '/api/admin/maintenance/repair-sync'],
  ];

  it('returns 403 for a non-admin on every admin route', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-matrix-${Date.now()}`,
      isAdmin: false,
    });

    for (const [method, url] of ADMIN_ROUTES) {
      const res = await request(app)[method](url).set('Authorization', `Bearer ${token}`).send({});

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);
    }
  });
});

describe('GET /api/admin/settings', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns settings when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });
});

describe('PUT /api/admin/settings', () => {
  it('updates settings when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-put-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ registration_enabled: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.settings).toBeDefined();
  });
});

describe('GET /api/admin/users/pending', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin2-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .get('/api/admin/users/pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns pending users when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-pending-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .get('/api/admin/users/pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/admin/users/:id/approve', () => {
  it('approves user when admin', async () => {
    const admin = await createAuthenticatedTestUser({
      username: `admin-approve-${Date.now()}`,
      isAdmin: true,
    });
    const pendingUser = await createTestUser({
      username: `pending-approve-${Date.now()}`,
      status: USER_STATUS.PENDING,
    });

    const res = await request(app)
      .post(`/api/admin/users/${pendingUser.id}/approve`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();

    const { createFileNodesStore } = require('../../../../store/fileNodesStore');
    const homeNode = await createFileNodesStore().getUserRootNode(pendingUser.id);
    expect(homeNode).not.toBeNull();
    const hasAdmin = await permissionStore.checkPermission(pendingUser.id, homeNode.id, 'admin');
    expect(hasAdmin).toBe(true);
  });
});

describe('POST /api/admin/users/:id/reject', () => {
  it('rejects user when admin', async () => {
    const admin = await createAuthenticatedTestUser({
      username: `admin-reject-${Date.now()}`,
      isAdmin: true,
    });
    const pendingUser = await createTestUser({
      username: `pending-reject-${Date.now()}`,
      status: USER_STATUS.PENDING,
    });

    const res = await request(app)
      .post(`/api/admin/users/${pendingUser.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });
});

describe('POST /api/admin/cleanup/orphaned', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-cleanup-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/admin/cleanup/orphaned')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with messageCode and results shape when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-cleanup-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .post('/api/admin/cleanup/orphaned')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.results).toBeDefined();
    expect(res.body.results).toMatchObject({
      errors: expect.any(Array),
      gc: expect.anything(),
      orphanedNodes: expect.any(Array),
    });
  });
});

describe('POST /api/admin/permissions/ensure-home-owner-admin', () => {
  it('removes redundant self-grants on the user own subtree while preserving home admin', async () => {
    const user = await createAuthenticatedTestUser({ username: `clean-self-${Date.now()}` });
    const home = await createUserRootNode({ userId: user.user.id });
    const ownDir = await createTestFileNode({
      name: `own-${Date.now()}`,
      type: 'directory',
      parentId: home.nodeId,
    });
    await permissionStore.grant(user.user.id, ownDir.nodeId, PERMISSIONS.WRITE);

    const admin = await createAuthenticatedTestUser({
      username: `clean-admin-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .post('/api/admin/permissions/ensure-home-owner-admin')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.removedSelfGrants).toBeGreaterThanOrEqual(1);

    const perms = await permissionStore.getUserPermissions(user.user.id);
    const ids = perms.map((p) => p.file_node_id);
    expect(ids).toContain(home.nodeId); // home-root admin preserved
    expect(ids).not.toContain(ownDir.nodeId); // descendant self-grant removed
  });

  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-ensure-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/admin/permissions/ensure-home-owner-admin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/admin/maintenance/gc', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-gc-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/admin/maintenance/gc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with messageCode and two-tier results shape when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-gc-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .post('/api/admin/maintenance/gc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.results).toBeDefined();
    expect(res.body.results.tier1).toMatchObject({
      orphanedRows: expect.any(Number),
      deletedBlobs: expect.any(Number),
      deletedRows: expect.any(Number),
      errors: expect.any(Array),
    });
    expect(res.body.results.tier2).toMatchObject({
      scannedKeys: expect.any(Number),
      untrackedKeys: expect.any(Number),
      deletedKeys: expect.any(Number),
      skipped: expect.any(Boolean),
      errors: expect.any(Array),
    });
  });
});

describe('POST /api/admin/maintenance/repair-sync', () => {
  const { createFileNodesStore } = require('../../../../store/fileNodesStore');

  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-repair-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 1, action: 'force-active' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 400 for an invalid action', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-repair-bad-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 1, action: 'delete-now' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 404 for a missing node', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-repair-missing-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 999999, action: 'force-active' });

    expect(res.status).toBe(404);
  });

  it('force-active resolves an orphaned node', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-repair-force-${Date.now()}`,
      isAdmin: true,
    });
    const { nodeId } = await createTestFileNode({ name: `repair-force-${Date.now()}` });
    const store = createFileNodesStore();
    await store.updateSyncStatus(nodeId, 'orphaned_node');

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'force-active' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.result).toMatchObject({ nodeId, action: 'force-active', status: 'resolved' });

    const after = await store.getNode(nodeId);
    expect(after.syncStatus).toBe('active');
  });

  it('retry-delete removes an orphaned node from the DB', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-repair-delete-${Date.now()}`,
      isAdmin: true,
    });
    const { nodeId } = await createTestFileNode({ name: `repair-del-${Date.now()}` });
    const store = createFileNodesStore();
    await store.updateSyncStatus(nodeId, 'orphaned_node');

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'retry-delete' });

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ nodeId, action: 'retry-delete', status: 'resolved' });
    expect(await store.getNode(nodeId)).toBeNull();
  });
});

describe('POST /api/admin/maintenance/gc (S3 mode): delete -> lazy blob -> GC reclaims it', () => {
  let admin, homeNodeId;
  const previousTtl = process.env.GC_ORPHAN_TTL_DAYS;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    process.env.WEA_FILE_STORAGE = 's3';
    wireS3Mock();
    await useS3Mode();
    process.env.GC_ORPHAN_TTL_DAYS = '0';

    admin = await createAuthenticatedTestUser({
      username: `admin-gc-s3-${Date.now()}`,
      isAdmin: true,
    });
    const fns = require('../../../../service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `admin-gc-s3-home-${Date.now()}`);
    homeNodeId = homeDir.id;
  });

  afterAll(async () => {
    process.env.WEA_FILE_STORAGE = 'webdav';
    await useWebdavMode();
    if (previousTtl === undefined) {
      delete process.env.GC_ORPHAN_TTL_DAYS;
    } else {
      process.env.GC_ORPHAN_TTL_DAYS = previousTtl;
    }
  });

  it('delete leaves the blob in the store; GC removes it while the active control survives', async () => {
    // Orphaned candidate: uploaded, then deleted below (S3 delete is lazy).
    const orphanUpload = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('parentNodeId', String(homeNodeId))
      .attach('file', Buffer.from('gc-orphan content'), `gc-orphan-${Date.now()}.txt`);
    expect(orphanUpload.status).toBe(200);
    const orphanNodeId = orphanUpload.body.nodeId;

    const orphanKeyRow = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      orphanNodeId,
    ]);
    expect(orphanKeyRow.rows).toHaveLength(1);
    const orphanKey = orphanKeyRow.rows[0].s3_key;
    expect(currentMockS3.getStore().has(orphanKey)).toBe(true);

    // Active control: uploaded before the GC run; its blob must survive.
    const activeContent = Buffer.from('gc-active-control-content');
    const activeUpload = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${admin.token}`)
      .field('parentNodeId', String(homeNodeId))
      .attach('file', activeContent, `gc-active-${Date.now()}.txt`);
    expect(activeUpload.status).toBe(200);
    const activeNodeId = activeUpload.body.nodeId;

    const activeKeyRow = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      activeNodeId,
    ]);
    expect(activeKeyRow.rows).toHaveLength(1);
    const activeKey = activeKeyRow.rows[0].s3_key;
    expect(currentMockS3.getStore().has(activeKey)).toBe(true);

    // Age both blobs past the orphan TTL so Tier-2 scans them as candidates.
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const key of [orphanKey, activeKey]) {
      currentMockS3.getStore().set(key, {
        ...currentMockS3.getStore().get(key),
        LastModified: oldDate,
      });
    }

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ nodeId: orphanNodeId });
    expect(del.status).toBe(200);

    // Lazy delete: the DB reference is gone but the physical blob remains.
    const orphanMapAfter = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      orphanNodeId,
    ]);
    expect(orphanMapAfter.rows).toHaveLength(0);
    expect(currentMockS3.getStore().has(orphanKey)).toBe(true);

    // GC run: Tier-2 must reclaim the untracked blob but keep the active one.
    const gcRes = await request(app)
      .post('/api/admin/maintenance/gc')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(gcRes.status).toBe(200);
    expect(gcRes.body.results.tier2.skipped).toBe(false);
    expect(gcRes.body.results.tier2.untrackedKeys).toBeGreaterThanOrEqual(1);
    expect(gcRes.body.results.tier2.deletedKeys).toBeGreaterThanOrEqual(1);

    expect(currentMockS3.getStore().has(orphanKey)).toBe(false);
    expect(currentMockS3.getStore().has(activeKey)).toBe(true);

    // The active control is still downloadable byte-for-byte with an intact row.
    const activeDownload = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${admin.token}`)
      .query({ nodeId: activeNodeId });
    expect(activeDownload.status).toBe(200);
    expect(Buffer.from(activeDownload.body).toString()).toBe('gc-active-control-content');

    const activeRowAfter = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      activeNodeId,
    ]);
    expect(activeRowAfter.rows).toHaveLength(1);
    expect(activeRowAfter.rows[0].s3_key).toBe(activeKey);
  });
});
