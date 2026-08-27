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
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
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
  it('returns 404 for invalid token', async () => {
    const res = await request(app).get('/api/share/invalid-token-xyz');

    expect(res.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkNotFound);
  });

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
  it('returns 404 for invalid token', async () => {
    const res = await request(app).get('/api/share/invalid-token-xyz/preview');

    expect(res.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkNotFound);
  });

  it('returns 410 when share link is expired', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-preview-expired-${Date.now()}`,
    });
    const fileNodeId = await createFileWithBlob({
      user,
      homeNodeId,
      name: 'movie.mp4',
      content: 'video-bytes',
      mimeType: 'video/mp4',
    });
    const linkToken = await createShareLinkForNode(token, fileNodeId);

    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app).get(`/api/share/${linkToken}/preview`);

    expect(res.status).toBe(HTTP_STATUS.GONE);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkExpired);
  });

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

  it('grants exactly read for a directory share and lists it under __shared__', async () => {
    const owner = await createUserWithHomeNode({ username: `share-add-dir-${Date.now()}` });
    await grantTestPermissionByNodeId({ userId: owner.user.id, fileNodeId: owner.homeNodeId, permission: 'write' });
    const sharedDir = await fileNodeService.createDirectory(owner.homeNodeId, 'shared-dir');
    const linkToken = await createShareLinkForNode(owner.token, sharedDir.id);

    const recipient = await createUserWithHomeNode({ username: `share-add-bee-${Date.now()}` });

    const addRes = await request(app)
      .post(`/api/share/${linkToken}/add-to-my-permissions`)
      .set('Authorization', `Bearer ${recipient.token}`);

    expect(addRes.status).toBe(200);
    expect(addRes.body.messageCode).toBe(SERVER_MESSAGE_CODES.share.addedToShared);

    const checkRes = await request(app)
      .get(`/api/permissions/check?nodeId=${sharedDir.id}`)
      .set('Authorization', `Bearer ${recipient.token}`);

    expect(checkRes.status).toBe(200);
    expect(checkRes.body).toMatchObject({
      nodeId: sharedDir.id,
      hasRead: true,
      hasWrite: false,
    });

    const sharedRes = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${recipient.token}`);

    expect(sharedRes.status).toBe(200);
    expect(sharedRes.body).toEqual([
      { nodeId: sharedDir.id, name: 'shared-dir', permission: 'read', type: 'directory' },
    ]);
  });

  it('grants exactly read for a file share', async () => {
    const owner = await createUserWithHomeNode({ username: `share-add-file-${Date.now()}` });
    const fileNodeId = await createFileWithBlob({
      user: owner.user,
      homeNodeId: owner.homeNodeId,
      name: 'doc.pdf',
      content: 'pdf-bytes',
      mimeType: 'application/pdf',
    });
    const linkToken = await createShareLinkForNode(owner.token, fileNodeId);

    const recipient = await createUserWithHomeNode({ username: `share-add-file-bee-${Date.now()}` });

    const addRes = await request(app)
      .post(`/api/share/${linkToken}/add-to-my-permissions`)
      .set('Authorization', `Bearer ${recipient.token}`);

    expect(addRes.status).toBe(200);
    expect(addRes.body.messageCode).toBe(SERVER_MESSAGE_CODES.share.addedToShared);

    const checkRes = await request(app)
      .get(`/api/permissions/file/check?fileNodeId=${fileNodeId}`)
      .set('Authorization', `Bearer ${recipient.token}`);

    expect(checkRes.status).toBe(200);
    expect(checkRes.body).toMatchObject({
      nodeId: fileNodeId,
      hasRead: true,
      hasWrite: false,
    });
  });
});

describe('GET /api/files/list with a share token (share scope)', () => {
  it('returns 404 for an invalid share token', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .query({ shareToken: 'invalid-token-xyz', nodeId: 1 });

    expect(res.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.utilsAuth.shareLinkNotFound);
  });

  it('returns 410 for an expired share token', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-list-expired-${Date.now()}`,
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

    const res = await request(app)
      .get('/api/files/list')
      .query({ shareToken: linkToken, nodeId: homeNodeId });

    expect(res.status).toBe(HTTP_STATUS.GONE);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.utilsAuth.shareLinkExpired);
  });

  it('lists only the shared subtree for a directory share', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-scope-inside-${Date.now()}`,
    });
    await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: homeNodeId, permission: 'write' });
    const sharedDir = await fileNodeService.createDirectory(homeNodeId, 'scope-shared');
    await fileNodeService.createFile(sharedDir.id, 'inside.txt');
    const linkToken = await createShareLinkForNode(token, sharedDir.id);

    const res = await request(app)
      .get('/api/files/list')
      .query({ shareToken: linkToken, nodeId: sharedDir.id });

    expect(res.status).toBe(200);
    expect(res.body.map((i) => i.name)).toEqual(['inside.txt']);
    expect(res.body.every((i) => i.hasReadPermission === true)).toBe(true);
  });

  it('does not grant read access to the sibling tree via the share token', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-scope-sibling-${Date.now()}`,
    });
    await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: homeNodeId, permission: 'write' });
    const sharedDir = await fileNodeService.createDirectory(homeNodeId, 'scope-shared');
    const siblingDir = await fileNodeService.createDirectory(homeNodeId, 'scope-sibling');
    await fileNodeService.createFile(sharedDir.id, 'inside.txt');
    await fileNodeService.createFile(siblingDir.id, 'sibling.txt');
    const linkToken = await createShareLinkForNode(token, sharedDir.id);

    const res = await request(app)
      .get('/api/files/list')
      .query({ shareToken: linkToken, nodeId: siblingDir.id });

    // Strict scope invariant: every child of the out-of-scope node is unreadable
    // and therefore excluded — no names/paths from the sibling tree are disclosed.
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not grant read access to the parent tree via the share token', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `share-scope-parent-${Date.now()}`,
    });
    await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: homeNodeId, permission: 'write' });
    const sharedDir = await fileNodeService.createDirectory(homeNodeId, 'scope-shared');
    await fileNodeService.createDirectory(homeNodeId, 'scope-sibling');
    await fileNodeService.createFile(sharedDir.id, 'inside.txt');
    const linkToken = await createShareLinkForNode(token, sharedDir.id);

    const res = await request(app)
      .get('/api/files/list')
      .query({ shareToken: linkToken, nodeId: homeNodeId });

    // Strict scope invariant: only in-scope nodes are listed; out-of-scope
    // siblings are excluded (their names are absent from the response).
    expect(res.status).toBe(200);
    expect(res.body.map((i) => i.name)).toEqual(['scope-shared']);
    expect(res.body.every((i) => i.hasReadPermission === true)).toBe(true);
  });
});

describe('Security surfaces — IDOR between users', () => {
  it('GET /api/share-links does not expose another user share links', async () => {
    const owner = await createUserWithHomeNode({ username: `idor-owner-${Date.now()}` });
    const fileNodeId = await createFileWithBlob({
      user: owner.user,
      homeNodeId: owner.homeNodeId,
      name: 'doc.pdf',
      content: 'pdf-bytes',
      mimeType: 'application/pdf',
    });
    const linkToken = await createShareLinkForNode(owner.token, fileNodeId);

    const other = await createAuthenticatedTestUser({ username: `idor-list-${Date.now()}` });

    const res = await request(app)
      .get('/api/share-links')
      .set('Authorization', `Bearer ${other.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((l) => l.token)).not.toContain(linkToken);
    expect(res.body.map((l) => l.nodeId)).not.toContain(fileNodeId);
  });

  it('GET /api/share-links/:token returns 403 for another user share link', async () => {
    const owner = await createUserWithHomeNode({ username: `idor-owner2-${Date.now()}` });
    const fileNodeId = await createFileWithBlob({
      user: owner.user,
      homeNodeId: owner.homeNodeId,
      name: 'doc.pdf',
      content: 'pdf-bytes',
      mimeType: 'application/pdf',
    });
    const linkToken = await createShareLinkForNode(owner.token, fileNodeId);

    const other = await createAuthenticatedTestUser({ username: `idor-detail-${Date.now()}` });

    const res = await request(app)
      .get(`/api/share-links/${linkToken}`)
      .set('Authorization', `Bearer ${other.token}`);

    expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  });

  it('GET /api/permissions/user/:userId returns 403 for another user permission rows', async () => {
    const owner = await createUserWithHomeNode({ username: `idor-owner3-${Date.now()}` });

    const other = await createUserWithHomeNode({ username: `idor-perm-${Date.now()}` });

    const otherUsersRes = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${other.token}`);

    expect(otherUsersRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(otherUsersRes.body.errorCode).toBe(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);

    const ownRes = await request(app)
      .get(`/api/permissions/user/${other.user.id}`)
      .set('Authorization', `Bearer ${other.token}`);

    expect(ownRes.status).toBe(200);
  });
});
