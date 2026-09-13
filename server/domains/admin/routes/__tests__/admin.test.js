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
  dbRun,
  USER_STATUS,
  PERMISSIONS,
} = require('../../../../test-utils');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
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
    ['post', '/api/admin/permissions/ensure-home-owner-admin'],
    ['post', '/api/admin/cleanup/orphaned'],
    ['post', '/api/admin/maintenance/repair-sync'],
    ['delete', '/api/admin/maintenance/perm-delete'],
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

describe('POST /api/admin/maintenance/repair-sync — pending_upload repair (S3 mode)', () => {
  const { createFileNodesStore } = require('../../../../store/fileNodesStore');

  beforeAll(async () => {
    wireS3Mock();
    await useS3Mode();
  });

  afterAll(async () => {
    await useWebdavMode();
  });

  async function seedPendingNode(name) {
    const { nodeId } = await createTestFileNode({ name });
    return nodeId;
  }

  async function seedPendingObjectMapRow(nodeId, s3Key) {
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 1, 'pending')`,
      [nodeId, s3Key]
    );
  }

  it('auto deletes a new-file pending node with no object_map rows and no blob', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-pu-auto-${Date.now()}`,
      isAdmin: true,
    });
    const nodeId = await seedPendingNode(`pu-auto-${Date.now()}`);

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'auto' });

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ nodeId, action: 'auto', status: 'resolved' });
    expect(await createFileNodesStore().getNode(nodeId)).toBeNull();
  });

  it('complete activates a pending row and returns 200', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-pu-complete-${Date.now()}`,
      isAdmin: true,
    });
    const nodeId = await seedPendingNode(`pu-complete-${Date.now()}`);
    const s3Key = `pu-complete-key-${Date.now()}`;
    await seedPendingObjectMapRow(nodeId, s3Key);
    const S3BlobStore = require('../../../../infrastructure/adapters/blobstore/S3BlobStore');
    await new S3BlobStore({ fileStorageMode: 's3' }).uploadBlob(
      s3Key,
      Buffer.from('complete-content')
    );

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'complete' });

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ nodeId, action: 'complete', status: 'resolved' });

    const store = createFileNodesStore();
    const after = await store.getNode(nodeId);
    expect(after.syncStatus).toBe('active');
    const active = await store.getActiveObject(nodeId);
    expect(active.s3_key).toBe(s3Key);
  });

  it('complete returns 409 when the blob is absent', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-pu-blobmissing-${Date.now()}`,
      isAdmin: true,
    });
    const nodeId = await seedPendingNode(`pu-blobmissing-${Date.now()}`);
    await seedPendingObjectMapRow(nodeId, `pu-blobmissing-key-${Date.now()}`);

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'complete' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.repairUploadBlobMissing);
  });
});

describe('DELETE /api/admin/maintenance/perm-delete', () => {
  const { createFileNodesStore: createNodesStore } = require('../../../../store/fileNodesStore');

  let localWebdav;

  beforeAll(async () => {
    const { createWebdavMock } = require('@testing/mocks/webdavMock');
    const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
    const composition = require('../../../../service/composition');
    localWebdav = createWebdavMock();
    // Destination probe for the trash MOVE must see a free /.wea-trash target.
    localWebdav.getFileMetadata.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));
    composition.__setCompositionForTests({
      fileStorageMode: 'webdav',
      blobStore: new WebdavBlobStore(localWebdav),
    });
  });

  afterAll(async () => {
    await useWebdavMode();
  });

  it('returns 403 for a non-admin (admin-only hard delete)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-permdel-${Date.now()}`,
    });

    const res = await request(app)
      .delete('/api/admin/maintenance/perm-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 1 });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);
  });

  it('returns 400 when nodeId is missing and 404 for an unknown node', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-permdel-bad-${Date.now()}`,
      isAdmin: true,
    });

    const missing = await request(app)
      .delete('/api/admin/maintenance/perm-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(missing.status).toBe(400);

    const unknown = await request(app)
      .delete('/api/admin/maintenance/perm-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 999999 });
    expect(unknown.status).toBe(404);
  });

  it('A3: permanently deletes a TRASHED node — remote trash path deleted first, FK cascade removes dependent rows', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-permdel-trash-${Date.now()}`,
      isAdmin: true,
    });
    const { nodeId, path } = await createTestFileNode({ name: `permdel-trash-${Date.now()}` });
    // Dependent rows that FK-cascade at purge time.
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 1, 'active')`,
      [nodeId, `permdel-key-${Date.now()}`]
    );
    await dbRun('INSERT INTO filecache (file_node_id, size) VALUES (?, ?)', [nodeId, 42]);

    // Trash the node first (user-facing delete = trash).
    const fileService = require('../../../../service/composition').getComposition().fileService;
    await fileService.deleteNode(nodeId, 1, { id: 1, is_admin: true });
    const trashedRow = await dbQuery('SELECT deleted_at FROM file_nodes WHERE id = ?', [nodeId]);
    expect(trashedRow.rows[0].deleted_at).not.toBeNull();
    localWebdav.deleteFile.mockClear();

    const res = await request(app)
      .delete('/api/admin/maintenance/perm-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId });
    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.admin.permDeleteDone);
    expect(res.body.result).toMatchObject({ nodeId, deletedCount: 1 });

    // WebDAV remote cleanup went to the TRASH path (the content was MOVE'd
    // there by the trash flow), not the original display path.
    expect(localWebdav.deleteFile).toHaveBeenCalledWith(
      `/.wea-trash/${nodeId}`,
      expect.objectContaining({ isDirectory: false })
    );
    expect(localWebdav.deleteFile).not.toHaveBeenCalledWith(path, expect.anything());

    // Physical removal + FK cascade: file_nodes, object_map, filecache, closure gone.
    const nodeRow = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [nodeId]);
    expect(nodeRow.rows).toHaveLength(0);
    const mapRow = await dbQuery('SELECT file_node_id FROM object_map WHERE file_node_id = ?', [
      nodeId,
    ]);
    expect(mapRow.rows).toHaveLength(0);
    const cacheRow = await dbQuery('SELECT file_node_id FROM filecache WHERE file_node_id = ?', [
      nodeId,
    ]);
    expect(cacheRow.rows).toHaveLength(0);
    const closureRow = await dbQuery('SELECT * FROM node_ancestors WHERE descendant_id = ?', [
      nodeId,
    ]);
    expect(closureRow.rows).toHaveLength(0);
  });

  it('A3: permanently deletes a LIVE node via the display-path bottom-up remote cleanup', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-permdel-live-${Date.now()}`,
      isAdmin: true,
    });
    const store = createNodesStore();
    const { nodeId, path } = await createTestFileNode({ name: `permdel-live-${Date.now()}` });
    localWebdav.deleteFile.mockClear();

    const res = await request(app)
      .delete('/api/admin/maintenance/perm-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId });
    expect(res.status).toBe(200);

    // Live node: remote content deleted at its display path (bottom-up helper).
    expect(localWebdav.deleteFile).toHaveBeenCalledWith(path, expect.anything());
    expect(await store.getNode(nodeId)).toBeNull();
  });
});

describe('POST /api/admin/maintenance/repair-sync — WebDAV orphaned_node remote checks + mode gate', () => {
  const { createFileNodesStore } = require('../../../../store/fileNodesStore');
  let localWebdav;

  beforeAll(async () => {
    const { createWebdavMock } = require('@testing/mocks/webdavMock');
    const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
    const composition = require('../../../../service/composition');
    localWebdav = createWebdavMock();
    composition.__setCompositionForTests({
      fileStorageMode: 'webdav',
      blobStore: new WebdavBlobStore(localWebdav),
    });
  });

  afterAll(async () => {
    await useWebdavMode();
  });

  it('force-active returns 409 when the remote file is absent (D5d)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-d5d-missing-${Date.now()}`,
      isAdmin: true,
    });
    const { nodeId } = await createTestFileNode({ name: `d5d-missing-${Date.now()}` });
    const store = createFileNodesStore();
    await store.updateSyncStatus(nodeId, 'orphaned_node');
    localWebdav.getFileMetadata.mockRejectedValueOnce(
      Object.assign(new Error('404'), { status: 404 })
    );

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'force-active' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.repairSyncRemoteMissing);
    expect((await store.getNode(nodeId)).syncStatus).toBe('orphaned_node');
  });

  it('force-active resolves an orphaned node whose remote file exists', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-d5d-present-${Date.now()}`,
      isAdmin: true,
    });
    const name = `d5d-present-${Date.now()}`;
    const { nodeId, path } = await createTestFileNode({ name });
    const store = createFileNodesStore();
    await store.updateSyncStatus(nodeId, 'orphaned_node');
    localWebdav.getFileMetadata.mockResolvedValueOnce({ size: 7, mime: 'text/plain' });

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'force-active' });

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ nodeId, action: 'force-active', status: 'resolved' });
    expect((await store.getNode(nodeId)).syncStatus).toBe('active');
    expect(path).toBe(`/${name}`);
  });

  it('pending_upload repair is refused with 409 in WebDAV mode (S3-only gate)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-pu-webdav-${Date.now()}`,
      isAdmin: true,
    });
    const { nodeId } = await createTestFileNode({ name: `pu-webdav-${Date.now()}` });

    const res = await request(app)
      .post('/api/admin/maintenance/repair-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId, action: 'auto' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.admin.repairUploadNotPending);
    expect((await createFileNodesStore().getNode(nodeId)).syncStatus).toBe('pending_upload');
  });
});
