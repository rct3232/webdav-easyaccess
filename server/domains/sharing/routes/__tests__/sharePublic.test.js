/**
 * Share public routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/sharePublic.md, docs/features/files-sharing.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
} = require('../../../../test-utils');
const ShareLink = require('../../../../models/ShareLink');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

mockWebdav.pathExists.mockResolvedValue(true);
mockWebdav.getFileContents.mockResolvedValue(Buffer.from('file content'));
mockWebdav.listDirectory.mockResolvedValue([]);

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../../index');
});

beforeEach(() => {
  mockWebdav.pathExists.mockResolvedValue(true);
  mockWebdav.getFileContents.mockResolvedValue(Buffer.from('file content'));
  mockWebdav.listDirectory.mockResolvedValue([]);
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

describe('GET /api/share/:token/preview', () => {
  it('returns inline preview with correct content-type and body', async () => {
    const videoBytes = Buffer.from('video-bytes');
    mockWebdav.getFileContents.mockResolvedValueOnce(videoBytes);

    const { user, token } = await createAuthenticatedTestUser({
      username: `share-preview-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/movie.mp4` });

    const linkToken = createRes.body.token;

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
