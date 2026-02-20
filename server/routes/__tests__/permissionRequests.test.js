/**
 * Permission requests routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/permissionRequests.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
  PERMISSIONS,
} = require('../../test-utils');
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

describe('POST /api/permission-requests', () => {
  it('creates permission request', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `requester-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/shared`,
        permission: PERMISSIONS.READ,
        message: 'Please grant access',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      requester_id: requester.user.id,
      owner_id: owner.user.id,
      requested_permission: PERMISSIONS.READ,
      status: 'pending',
    });
  });

  it('returns 400 when folderPath missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `req-400-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ permission: PERMISSIONS.READ });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('GET /api/permission-requests/inbox', () => {
  it('returns inbox for owner', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `inbox-owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `inbox-req-${Date.now()}`,
    });
    await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/folder`,
        permission: PERMISSIONS.READ,
      });

    const res = await request(app)
      .get('/api/permission-requests/inbox')
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/permission-requests/inbox');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/permission-requests/outbox', () => {
  it('returns outbox for requester', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `outbox-owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `outbox-req-${Date.now()}`,
    });
    await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/folder`,
        permission: PERMISSIONS.READ,
      });

    const res = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${requester.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/permission-requests/:id/approve', () => {
  it('approves request when owner', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `approve-owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `approve-req-${Date.now()}`,
    });
    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/approve-folder`,
        permission: PERMISSIONS.READ,
      });
    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });
});

describe('POST /api/permission-requests/:id/cancel', () => {
  it('returns 200 when requester cancels', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `cancel-owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `cancel-req-${Date.now()}`,
    });
    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/cancel-folder`,
        permission: PERMISSIONS.READ,
      });
    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/cancel`)
      .set('Authorization', `Bearer ${requester.token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('returns 403 when owner attempts to cancel', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `cancel-owner-403-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `cancel-req-403-${Date.now()}`,
    });
    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/cancel-403-folder`,
        permission: PERMISSIONS.READ,
      });
    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/permission-requests/:id/reject', () => {
  it('rejects request when owner', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `reject-owner-${Date.now()}`,
    });
    await grantTestPermission(owner.user.id, `/${owner.user.username}`, PERMISSIONS.ADMIN);
    const requester = await createAuthenticatedTestUser({
      username: `reject-req-${Date.now()}`,
    });
    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        folderPath: `/${owner.user.username}/reject-folder`,
        permission: PERMISSIONS.READ,
      });
    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});
