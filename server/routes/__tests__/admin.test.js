/**
 * Admin routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/admin.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestUser,
  USER_STATUS,
} = require('../../test-utils');
const Settings = require('../../models/Settings');
const Permission = require('../../models/Permission');

var mockEmail;
var mockWebdav;
jest.mock('../../utils/email', () => {
  const { createEmailMock } = require('../../testing/mocks/emailMock');
  mockEmail = createEmailMock();
  return mockEmail;
});
jest.mock('../../utils/webdav', () => {
  const { createWebdavMock } = require('../../testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

let app;
let dbCleanup;
const previousBackend = process.env.WEA_STORAGE_BACKEND;

beforeAll(async () => {
  process.env.WEA_STORAGE_BACKEND = 'fs';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
});

afterAll(async () => {
  await dbCleanup?.();
  process.env.WEA_STORAGE_BACKEND = previousBackend;
});

describe('GET /api/admin/settings', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns settings when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });
});

describe('PUT /api/admin/settings', () => {
  it('updates settings when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-put-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ registration_enabled: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.settings).toBeDefined();
  });
});

describe('GET /api/admin/users/pending', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin2-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .get('/api/admin/users/pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns pending users when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-pending-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .get('/api/admin/users/pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/admin/users/:id/approve', () => {
  it('approves user when admin', async () => {
    const admin = await createAuthenticatedTestUser({
      username: `admin-approve-${Date.now()}`,
      isAdmin: true,
    });
    const pendingUser = await createTestUser({
      username: `pending-approve-${Date.now()}`,
      status: USER_STATUS.PENDING,
    });

    const res = await request(app)
      .post(`/api/admin/users/${pendingUser.id}/approve`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();

    const hasAdmin = await Permission.checkPermission(
      pendingUser.id,
      `/${pendingUser.username}`,
      'admin'
    );
    expect(hasAdmin).toBe(true);
  });
});

describe('POST /api/admin/users/:id/reject', () => {
  it('rejects user when admin', async () => {
    const admin = await createAuthenticatedTestUser({
      username: `admin-reject-${Date.now()}`,
      isAdmin: true,
    });
    const pendingUser = await createTestUser({
      username: `pending-reject-${Date.now()}`,
      status: USER_STATUS.PENDING,
    });

    const res = await request(app)
      .post(`/api/admin/users/${pendingUser.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });
});

describe('POST /api/admin/cleanup/orphaned', () => {
  it('returns 403 when non-admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `nonadmin-cleanup-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/admin/cleanup/orphaned')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with messageCode and results shape when admin', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `admin-cleanup-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .post('/api/admin/cleanup/orphaned')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.results).toBeDefined();
    expect(res.body.results).toMatchObject({
      deletedPermissionFiles: expect.any(Number),
      deletedUserFiles: expect.any(Number),
      deletedEmailIndexFiles: expect.any(Number),
      cleanedPermissionRequests: expect.any(Number),
      errors: expect.any(Array),
    });
  });
});
