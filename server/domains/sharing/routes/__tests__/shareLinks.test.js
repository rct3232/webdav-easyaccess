/**
 * Share links routes integration tests (nodeId contract).
 * @see docs/api.md, docs/spec/server/routes/shareLinks.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('../../../../service/composition');

let fileNodeService;
let webdavMock;

async function createUserWithHomeNode(opts = {}) {
  const { user, token } = await createAuthenticatedTestUser(opts);
  const node = await fileNodeService.createDirectory(null, user.username);
  return { user, token, homeNodeId: node.id };
}

async function createFileForUser({ user, homeNodeId, name }) {
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: homeNodeId, permission: 'write' });
  const file = await fileNodeService.createFile(homeNodeId, name);
  return file.id;
}

let app;
let dbCleanup;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  process.env.WEA_SKIP_BULK_WORKER = '1';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });

  webdavMock = createWebdavMock();
  const blobStore = new WebdavBlobStore(webdavMock);
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore,
    fileNodeService,
  });

  app = require('../../../../index');
});

afterAll(async () => {
  delete process.env.WEA_SKIP_BULK_WORKER;
  await dbCleanup?.();
});

describe('POST /api/share-links', () => {
  it('creates share link for a file node', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-create-${Date.now()}`,
    });
    const fileNodeId = await createFileForUser({ user, homeNodeId, name: 'doc.pdf' });

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: expect.any(String),
      nodeId: fileNodeId,
      fileName: 'doc.pdf',
      fileType: 'pdf',
      isDirectory: false,
      displayPath: expect.any(String),
      createdAt: expect.any(String),
      downloadCount: expect.any(Number),
    });
    expect(res.body.filePath).toBeUndefined();
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('returns 400 when fileNodeId missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `share-create2-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.pathRequired);
  });

  it('returns 404 when file node does not exist', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `share-404-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId: 999999 });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.fileNotFound);
  });
});

describe('GET /api/share-links', () => {
  it('lists own share links with nodeId', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-list-${Date.now()}`,
    });
    const fileNodeId = await createFileForUser({ user, homeNodeId, name: 'a.pdf' });
    await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId });

    const res = await request(app)
      .get('/api/share-links')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({
      token: expect.any(String),
      nodeId: expect.any(Number),
      downloadCount: expect.any(Number),
    });
    expect(res.body[0].filePath).toBeUndefined();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/share-links');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/share-links/:token (expired link)', () => {
  it('allows owner to delete expired link', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-del-expired-${Date.now()}`,
    });
    const fileNodeId = await createFileForUser({ user, homeNodeId, name: 'del.pdf' });

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId, expiresInDays: 1 });
    const linkToken = createRes.body.token;

    const ShareLink = require('../../../../models/ShareLink');
    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app)
      .delete(`/api/share-links/${linkToken}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.shareLinks.shareLinkDeleted);
  });
});

describe('PUT /api/share-links/:token', () => {
  it('allows owner to update expired link (extend expiry)', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-update-expired-${Date.now()}`,
    });
    const fileNodeId = await createFileForUser({ user, homeNodeId, name: 'doc.pdf' });

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId, expiresInDays: 1 });
    const linkToken = createRes.body.token;

    const ShareLink = require('../../../../models/ShareLink');
    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app)
      .put(`/api/share-links/${linkToken}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresInDays: 30 });

    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBeDefined();
    expect(res.body.isExpired).toBe(false);
  });
});

describe('DELETE /api/share-links/:token', () => {
  it('deletes own share link', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-del-${Date.now()}`,
    });
    const fileNodeId = await createFileForUser({ user, homeNodeId, name: 'del.pdf' });
    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileNodeId });
    const linkToken = createRes.body.token;

    const res = await request(app)
      .delete(`/api/share-links/${linkToken}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();

    const listRes = await request(app)
      .get('/api/share-links')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.some((l) => l.token === linkToken)).toBe(false);
  });
});
