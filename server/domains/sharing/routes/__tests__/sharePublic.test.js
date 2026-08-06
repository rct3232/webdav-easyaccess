/**
 * Share public routes integration tests (nodeId contract).
 * @see docs/api.md, docs/spec/server/routes/sharePublic.md, docs/features/files-sharing.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const ShareLink = require('../../../../models/ShareLink');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { createWebdavMock } = require('@testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('../../../../service/composition');

let fileNodeService;
let webdavMock;
let blobStorageService;

async function createUserWithHomeNode(opts = {}) {
  const { user, token } = await createAuthenticatedTestUser(opts);
  const node = await fileNodeService.createDirectory(null, user.username);
  return { user, token, homeNodeId: node.id };
}

async function createFileWithBlob({ user, homeNodeId, name, content, mimeType }) {
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: homeNodeId, permission: 'write' });
  const file = await fileNodeService.createFile(homeNodeId, name);
  await blobStorageService.uploadToWebdav(file.id, Buffer.from(content), mimeType);
  return file.id;
}

async function createShareLinkForNode(token, fileNodeId) {
  const res = await request(app)
    .post('/api/share-links')
    .set('Authorization', `Bearer ${token}`)
    .send({ fileNodeId });
  expect(res.status).toBe(200);
  return res.body.token;
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
  blobStorageService = composition.getComposition().blobStorageService;

  app = require('../../../../index');
});

afterAll(async () => {
  delete process.env.WEA_SKIP_BULK_WORKER;
  await dbCleanup?.();
});

beforeEach(jest.clearAllMocks);

describe('GET /api/share/:token/info', () => {
  it('returns 404 for invalid token', async () => {
    const res = await request(app).get('/api/share/invalid-token-xyz/info');

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkNotFound);
  });

  it('returns info without auth when token valid (nodeId contract)', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-pub-${Date.now()}`,
    });
    const fileNodeId = await createFileWithBlob({
      user,
      homeNodeId,
      name: 'doc.pdf',
      content: 'pdf-bytes',
      mimeType: 'application/pdf',
    });
    const linkToken = await createShareLinkForNode(token, fileNodeId);

    const res = await request(app).get(`/api/share/${linkToken}/info`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: linkToken,
      nodeId: fileNodeId,
      fileName: 'doc.pdf',
      isDirectory: false,
      displayPath: expect.any(String),
      isExpired: false,
    });
    expect(res.body.filePath).toBeUndefined();
  });

  it('returns 410 when share link is expired (info)', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-expired-${Date.now()}`,
    });
    const fileNodeId = await createFileWithBlob({
      user,
      homeNodeId,
      name: 'doc.pdf',
      content: 'pdf-bytes',
      mimeType: 'application/pdf',
    });
    const linkToken = await createShareLinkForNode(token, fileNodeId);

    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app).get(`/api/share/${linkToken}/info`);

    expect(res.status).toBe(HTTP_STATUS.GONE);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkExpired);
  });
});

describe('GET /api/share/:token (download)', () => {
  it('returns 410 when share link is expired', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-dl-expired-${Date.now()}`,
    });
    const fileNodeId = await createFileWithBlob({
      user,
      homeNodeId,
      name: 'doc.pdf',
      content: 'pdf-bytes',
      mimeType: 'application/pdf',
    });
    const linkToken = await createShareLinkForNode(token, fileNodeId);

    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app).get(`/api/share/${linkToken}`);

    expect([HTTP_STATUS.FORBIDDEN, HTTP_STATUS.GONE]).toContain(res.status);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkExpired);
  });
});

describe('GET /api/share/:token/preview', () => {
  it('returns inline preview with correct content-type and body', async () => {
    const videoBytes = Buffer.from('video-bytes');
    webdavMock.getFileContents.mockResolvedValueOnce(videoBytes);

    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-preview-${Date.now()}`,
    });
    const fileNodeId = await createFileWithBlob({
      user,
      homeNodeId,
      name: 'movie.mp4',
      content: videoBytes,
      mimeType: 'video/mp4',
    });
    const linkToken = await createShareLinkForNode(token, fileNodeId);

    const res = await request(app).get(`/api/share/${linkToken}/preview`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(Buffer.from(res.body)).toEqual(videoBytes);
  });
});

describe('GET /api/share/:token/check-my-permission', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/share/some-token/check-my-permission');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/share/:token/add-to-my-permissions', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/share/some-token/add-to-my-permissions');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });
});
