/**
 * Folders routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/folders.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('../../../../service/composition');

let fileNodeService;
let webdavMock;
let blobStore;

async function createUserWithHomeNode(opts = {}) {
  const { user, token } = await createAuthenticatedTestUser(opts);
  const node = await fileNodeService.createDirectory(null, user.username);
  return { user, token, homeNodeId: node.id };
}

async function grantHomePermission({ userId, homeNodeId, permission }) {
  await grantTestPermissionByNodeId({ userId, fileNodeId: homeNodeId, permission });
}

let app;
let dbCleanup;
let homeNodeId, userId, userToken;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });

  webdavMock = createWebdavMock();
  blobStore = new WebdavBlobStore(webdavMock);
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore,
  });

  app = require('../../../../index');

  const created = await createUserWithHomeNode({ username: `folders-shared-${Date.now()}` });
  userId = created.user.id;
  userToken = created.token;
  homeNodeId = created.homeNodeId;
  await grantHomePermission({ userId, homeNodeId, permission: 'write' });
});

beforeEach(() => {
  webdavMock.pathExists.mockResolvedValue(false);
  webdavMock.createDirectory.mockResolvedValue(undefined);
  webdavMock.createDirectory.mockClear();
  webdavMock.getRecursiveFolderStats.mockResolvedValue({ fileCount: 5, totalSize: 1200 });
});

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('POST /api/folders/create', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/folders/create')
      .send({ parentNodeId: homeNodeId, name: 'new-folder' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 when folder created with write permission', async () => {
    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ parentNodeId: homeNodeId, name: 'newdir' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.nodeId).toBeDefined();
  });

  it('returns 409 when folder already exists', async () => {
    const res1 = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ parentNodeId: homeNodeId, name: 'dupdir' });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ parentNodeId: homeNodeId, name: 'dupdir' });
    expect(res2.status).toBe(409);
    expect(res2.body.errorCode).toBeDefined();
  });

  it('returns 403 when parent does not exist (permission check fails)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `folders-parent-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ parentNodeId: 999, name: 'newdir' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 403 for meta path when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `folders-meta-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ parentNodeId: homeNodeId, name: '.wea_secret' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('GET /api/folders/stats', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/folders/stats')
      .query({ nodeId: homeNodeId });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 400 when path is missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `folders-stats-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/folders/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with stats when user has read permission', async () => {
    const res = await request(app)
      .get('/api/folders/stats')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: homeNodeId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalFiles');
    expect(res.body).toHaveProperty('totalSize');
  });

  it('returns 403 when non-admin lacks read permission on folder', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `folders-stats-403-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .get('/api/folders/stats')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: homeNodeId });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});
