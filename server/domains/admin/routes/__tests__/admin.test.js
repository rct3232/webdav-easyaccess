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
  USER_STATUS,
  PERMISSIONS,
} = require('../../../../test-utils');
const Settings = require('../../../../models/Settings');
const permissionStore = require('../../../../domains/permissions/stores/permissionStore');

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
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
    const hasAdmin = await permissionStore.checkPermission(
      pendingUser.id,
      homeNode.id,
      'admin'
    );
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
    const ids = perms.map(p => p.file_node_id);
    expect(ids).toContain(home.nodeId);       // home-root admin preserved
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
