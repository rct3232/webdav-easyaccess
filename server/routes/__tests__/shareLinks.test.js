/**
 * Share links routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/shareLinks.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
} = require('../../test-utils');

const mockPathExists = jest.fn().mockResolvedValue(true);
const mockListDirectory = jest.fn();
jest.mock('../../utils/webdav', () => ({
  testConnection: jest.fn().mockResolvedValue({ success: true }),
  pathExists: (...args) => mockPathExists(...args),
  listDirectory: (...args) => mockListDirectory(...args),
  getFileContents: jest.fn().mockResolvedValue(Buffer.from('')),
  putFileContents: jest.fn().mockResolvedValue(undefined),
  putFileContentsAdvanced: jest.fn().mockResolvedValue(undefined),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  moveFile: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  createDirectory: jest.fn().mockResolvedValue(undefined),
  getFileMetadata: jest.fn().mockResolvedValue({}),
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
  mockListDirectory.mockRejectedValue(new Error('not a dir'));
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('POST /api/share-links', () => {
  it('creates share link for file', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-create-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/doc.pdf` });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: expect.any(String),
      filePath: expect.any(String),
      createdAt: expect.any(String),
      downloadCount: expect.any(Number),
    });
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('returns 400 when filePath missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `share-create2-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 404 when file does not exist', async () => {
    mockPathExists.mockResolvedValueOnce(false);
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-404-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/nonexistent.pdf` });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('GET /api/share-links', () => {
  it('lists own share links', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-list-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');
    await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/a.pdf` });

    const res = await request(app)
      .get('/api/share-links')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({
      token: expect.any(String),
      filePath: expect.any(String),
      downloadCount: expect.any(Number),
    });
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/share-links');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/share-links/:token (expired link)', () => {
  it('allows owner to delete expired link', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-del-expired-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/del.pdf`, expiresInDays: 1 });
    const linkToken = createRes.body.token;

    const ShareLink = require('../../models/ShareLink');
    await ShareLink.update(linkToken, { expiresAt: new Date(0).toISOString() });

    const res = await request(app)
      .delete(`/api/share-links/${linkToken}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });
});

describe('PUT /api/share-links/:token', () => {
  it('allows owner to update expired link (extend expiry)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-update-expired-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/doc.pdf`, expiresInDays: 1 });
    const linkToken = createRes.body.token;

    const ShareLink = require('../../models/ShareLink');
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
    const { user, token } = await createAuthenticatedTestUser({
      username: `share-del-${Date.now()}`,
    });
    await grantTestPermission(user.id, '/', 'admin');
    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/del.pdf` });
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
