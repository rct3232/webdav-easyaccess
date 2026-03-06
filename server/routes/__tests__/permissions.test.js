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

var mockWebdav;
jest.mock('../../utils/webdav', () => {
  const { createWebdavMock } = require('../../testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

let app;
let dbCleanup;
let resetPermissionExistenceIndex;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
  ({ __resetForTests: resetPermissionExistenceIndex } = require('../../store/permissionExistenceIndex'));
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

describe('GET /api/permissions/user/:userId fast path', () => {
  beforeEach(() => {
    mockWebdav.pathExists.mockReset();
    mockWebdav.pathExists.mockResolvedValue(true);
    resetPermissionExistenceIndex();
  });

  it('returns permission list even when reconciliation check fails', async () => {
    const unique = Date.now();
    const owner = await createAuthenticatedTestUser({
      username: `perm-fast-owner-${unique}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}/shared`, PERMISSIONS.READ);
    mockWebdav.pathExists.mockRejectedValueOnce(new Error('webdav unavailable'));

    const res = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          folder_path: `/${owner.user.username}/shared`,
          permission: PERMISSIONS.READ,
        }),
      ])
    );
  });

  it('filters path after missing state is reconciled in background', async () => {
    const unique = Date.now();
    const owner = await createAuthenticatedTestUser({
      username: `perm-fast-missing-${unique}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}/missing-target`, PERMISSIONS.READ);
    mockWebdav.pathExists.mockResolvedValue(false);

    const firstRes = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(firstRes.status).toBe(200);
    expect(firstRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          folder_path: `/${owner.user.username}/missing-target`,
          permission: PERMISSIONS.READ,
        }),
      ])
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondRes = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          folder_path: `/${owner.user.username}/missing-target`,
        }),
      ])
    );
  });

  it('returns 304 when If-None-Match matches response ETag', async () => {
    const user = await createAuthenticatedTestUser({
      username: `perm-fast-etag-${Date.now()}`,
    });

    const firstRes = await request(app)
      .get(`/api/permissions/user/${user.user.id}`)
      .set('Authorization', `Bearer ${user.token}`);

    expect(firstRes.status).toBe(200);
    expect(firstRes.headers.etag).toBeDefined();

    const secondRes = await request(app)
      .get(`/api/permissions/user/${user.user.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('If-None-Match', firstRes.headers.etag);

    expect(secondRes.status).toBe(304);
  });

  it('invalidates existence index on ACL mutation and re-shows unknown entries', async () => {
    const unique = Date.now();
    const owner = await createAuthenticatedTestUser({
      username: `perm-fast-invalidate-${unique}`,
    });
    const targetPath = `/${owner.user.username}/invalidate-target`;
    await grantTestPermission(owner.user.id, targetPath, PERMISSIONS.READ);
    mockWebdav.pathExists.mockResolvedValue(false);

    const firstRes = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(firstRes.status).toBe(200);
    expect(firstRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ folder_path: targetPath }),
      ])
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondRes = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(secondRes.status).toBe(200);
    expect(secondRes.body).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ folder_path: targetPath }),
      ])
    );

    await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        userId: owner.user.id,
        folderPath: targetPath,
        permission: PERMISSIONS.READ,
      });

    const thirdRes = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(thirdRes.status).toBe(200);
    expect(thirdRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ folder_path: targetPath }),
      ])
    );
  });

  it('keeps response latency bounded with many permissions and slow pathExists', async () => {
    const unique = Date.now();
    const owner = await createAuthenticatedTestUser({
      username: `perm-fast-perf-${unique}`,
    });

    const permissionCount = 30;
    const pathExistsDelayMs = 80;
    for (let i = 0; i < permissionCount; i++) {
      await grantTestPermission(
        owner.user.id,
        `/${owner.user.username}/perf-target-${i}`,
        PERMISSIONS.READ
      );
    }

    mockWebdav.pathExists.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, pathExistsDelayMs));
      return true;
    });

    const legacySequentialEstimateMs = permissionCount * pathExistsDelayMs;
    const startedAt = Date.now();
    const res = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    const routeElapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(permissionCount);
    expect(routeElapsedMs).toBeLessThan(1200);
    expect(routeElapsedMs).toBeLessThan(legacySequentialEstimateMs / 2);
  });
});
