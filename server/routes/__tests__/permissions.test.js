/**
 * Permissions routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/permissions.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
  PERMISSIONS,
} = require('../../test-utils');

jest.mock('../../utils/webdav', () => ({
  testConnection: jest.fn().mockResolvedValue({ success: true }),
  pathExists: jest.fn().mockResolvedValue(true),
  listDirectory: jest.fn().mockResolvedValue([]),
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

afterAll(async () => {
  await dbCleanup?.();
});

describe('POST /api/permissions/grant', () => {
  it('grants permission when user has grant rights', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}/shared`, PERMISSIONS.ADMIN);
    const targetUser = await createAuthenticatedTestUser({
      username: `target-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        userId: targetUser.user.id,
        folderPath: `/${owner.user.username}/shared`,
        permission: PERMISSIONS.READ,
      });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });

  it('returns 403 when user lacks grant permission', async () => {
    const regular = await createAuthenticatedTestUser({
      username: `regular-${Date.now()}`,
    });
    const targetUser = await createAuthenticatedTestUser({
      username: `target2-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${regular.token}`)
      .send({
        userId: targetUser.user.id,
        folderPath: '/other-user/folder',
        permission: PERMISSIONS.READ,
      });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 400 when required fields missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ folderPath: '/shared' }); // missing userId, permission

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/permissions/revoke', () => {
  it('revokes permission when user has revoke rights', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `revoke-owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}/shared`, PERMISSIONS.ADMIN);
    const targetUser = await createAuthenticatedTestUser({
      username: `revoke-target-${Date.now()}`,
    });
    await grantTestPermission(targetUser.user.id, `/${owner.user.username}/shared`, PERMISSIONS.READ);

    const res = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ userId: targetUser.user.id, folderPath: `/${owner.user.username}/shared` });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });

  it('returns 400 when required fields missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${token}`)
      .query({ folderPath: '/shared' }); // missing userId

    expect(res.status).toBe(400);
  });
});

describe('GET /api/permissions/check', () => {
  it('returns 400 when path query is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns permission for path user can read', async () => {
    const { user, token } = await createAuthenticatedTestUser();
    await grantTestPermission(user.id, '/shared', PERMISSIONS.READ);

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: '/shared/file.txt' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      path: '/shared/file.txt',
      hasRead: true,
      hasWrite: expect.any(Boolean),
      source: expect.any(String),
    });
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/permissions/check')
      .query({ path: '/docs' });
    expect(res.status).toBe(401);
  });

  it('returns hasRead false after revoke', async () => {
    const owner = await createAuthenticatedTestUser({ username: `revoke-check-owner-${Date.now()}` });
    await grantTestPermission(owner.user.id, `/${owner.user.username}/revoke-check`, PERMISSIONS.ADMIN);
    const target = await createAuthenticatedTestUser({ username: `revoke-check-target-${Date.now()}` });
    await grantTestPermission(target.user.id, `/${owner.user.username}/revoke-check`, PERMISSIONS.READ);

    const beforeRes = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${target.token}`)
      .query({ path: `/${owner.user.username}/revoke-check/file.txt` });
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.hasRead).toBe(true);

    await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ userId: target.user.id, folderPath: `/${owner.user.username}/revoke-check` });

    const afterRes = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${target.token}`)
      .query({ path: `/${owner.user.username}/revoke-check/file.txt` });
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.hasRead).toBe(false);
  });
});
