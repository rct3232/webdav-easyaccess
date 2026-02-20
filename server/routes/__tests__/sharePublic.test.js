/**
 * Share public routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/sharePublic.md, docs/features/files-sharing.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
} = require('../../test-utils');
const ShareLink = require('../../models/ShareLink');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');

const mockPathExists = jest.fn().mockResolvedValue(true);
const mockGetFileContents = jest.fn().mockResolvedValue(Buffer.from('file content'));
const mockListDirectory = jest.fn().mockResolvedValue([]);

jest.mock('../../utils/webdav', () => ({
  pathExists: (...args) => mockPathExists(...args),
  getFileContents: (...args) => mockGetFileContents(...args),
  listDirectory: (...args) => mockListDirectory(...args),
  putFileContents: jest.fn().mockResolvedValue(undefined),
  putFileContentsAdvanced: jest.fn().mockResolvedValue(undefined),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  moveFile: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  createDirectory: jest.fn().mockResolvedValue(undefined),
  getFileMetadata: jest.fn().mockResolvedValue({}),
  testConnection: jest.fn().mockResolvedValue({ success: true }),
  isImageFile: () => false,
  isVideoFile: () => false,
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
});

beforeEach(() => {
  mockPathExists.mockResolvedValue(true);
  mockGetFileContents.mockResolvedValue(Buffer.from('file content'));
  mockListDirectory.mockResolvedValue([]);
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/share/:token/info', () => {
  it('returns 404 for invalid token', async () => {
    const res = await request(app).get('/api/share/invalid-token-xyz/info');

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns info without auth when token valid', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-pub-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/doc.pdf` });

    const linkToken = createRes.body.token;

    const res = await request(app).get(`/api/share/${linkToken}/info`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: linkToken,
      filePath: expect.any(String),
      fileName: expect.any(String),
      isDirectory: expect.any(Boolean),
      isExpired: false,
    });
  });

  it('returns 410 when share link is expired (info)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-expired-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/doc.pdf`, expiresInDays: 7 });
    const linkToken = createRes.body.token;

    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app).get(`/api/share/${linkToken}/info`);

    expect(res.status).toBe(HTTP_STATUS.GONE);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkExpired);
  });
});

describe('GET /api/share/:token (download)', () => {
  it('returns 410 when share link is expired', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-dl-expired-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/doc.pdf`, expiresInDays: 7 });
    const linkToken = createRes.body.token;

    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app).get(`/api/share/${linkToken}`);

    expect([HTTP_STATUS.FORBIDDEN, HTTP_STATUS.GONE]).toContain(res.status);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.share.shareLinkExpired);
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
