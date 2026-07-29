/**
 * Folders routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/folders.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
} = require('../../../../test-utils');

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../../index');
});

beforeEach(() => {
  mockWebdav.pathExists.mockResolvedValue(false);
  mockWebdav.createDirectory.mockResolvedValue(undefined);
  mockWebdav.createDirectory.mockClear();
  mockWebdav.getRecursiveFolderStats.mockResolvedValue({ fileCount: 5, totalSize: 1200 });
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('POST /api/folders/create', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/folders/create')
      .send({ path: '/user1/new-folder' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 when folder created with write permission', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-create-${Date.now()}`,
    });
    const folderPath = `/${user.username}/newdir`;
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: folderPath });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.path).toBeDefined();
    expect(mockWebdav.createDirectory).toHaveBeenCalled();
  });

  it('returns 409 when folder already exists', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-dup-${Date.now()}`,
    });
    const folderPath = `/${user.username}/dupdir`;
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    mockWebdav.pathExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockWebdav.createDirectory.mockResolvedValueOnce(undefined);

    const res1 = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: folderPath });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: folderPath });
    expect(res2.status).toBe(409);
    expect(res2.body.errorCode).toBeDefined();
  });

  it('returns 404 when parent path does not exist', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-parent-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    mockWebdav.pathExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mockWebdav.createDirectory.mockRejectedValueOnce(Object.assign(new Error('Parent not found'), { status: 404 }));

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: `/${user.username}/nonexistent-parent/newdir` });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 403 for meta path when non-admin', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-meta-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/.wea/secret' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
    expect(mockWebdav.createDirectory).not.toHaveBeenCalled();
  });
});

describe('GET /api/folders/stats', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/folders/stats')
      .query({ path: '/user1/folder' });

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

  it('returns 200 with fileCount and totalSize when user has read permission', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-stats-ok-${Date.now()}`,
    });
    const folderPath = `/${user.username}/docs`;
    await grantTestPermission(user.id, folderPath, 'read');

    const res = await request(app)
      .get('/api/folders/stats')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: folderPath });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fileCount', 5);
    expect(res.body).toHaveProperty('totalSize', 1200);
    expect(mockWebdav.getRecursiveFolderStats).toHaveBeenCalled();
  });

  it('returns 403 for path without read permission when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `folders-stats-403-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .get('/api/folders/stats')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: '/other-user/no-access' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});
