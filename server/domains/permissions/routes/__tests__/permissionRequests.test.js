/**
 * Permission requests routes integration tests — nodeId-based payloads.
 * @see docs/api.md, docs/spec/server/routes/permissionRequests.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  PERMISSIONS,
} = require('../../../../test-utils');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const permissionStore = require('../../stores/permissionStore');

let app;
let dbCleanup;
let fileNodesStore;
let fileNodeService;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../../index');
  fileNodesStore = createFileNodesStore();
  fileNodeService = createFileNodeService({ fileNodesStore });
});

afterAll(async () => {
  await dbCleanup?.();
});

async function grantNodePermission(userId, nodeId, permission) {
  return permissionStore.grant(userId, nodeId, permission);
}

async function createOwnerDirectory(username) {
  return fileNodeService.createDirectory(null, username);
}

describe('POST /api/permission-requests (nodeId)', () => {
  it('creates permission request with nodeId', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `req-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `req-requester-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        nodeId: ownerDir.id,
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

  it('creates permission request with fileNodeId for files', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `req-file-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const testFile = await fileNodeService.createFile(ownerDir.id, `req-file-${Date.now()}.txt`);

    const requester = await createAuthenticatedTestUser({
      username: `req-file-requester-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({
        fileNodeId: testFile.id,
        permission: PERMISSIONS.READ,
        message: 'Please grant file access',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      status: 'pending',
    });
  });

  it('returns 400 when nodeId and fileNodeId are both missing', async () => {
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

  it('returns 404 when nodeId does not exist', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `req-notfound-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 999999, permission: PERMISSIONS.READ });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/permission-requests/inbox (nodeId)', () => {
  it('returns inbox for owner', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `inbox-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `inbox-req-${Date.now()}`,
    });

    await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

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

describe('GET /api/permission-requests/outbox (nodeId)', () => {
  it('returns outbox for requester', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `outbox-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `outbox-req-${Date.now()}`,
    });

    await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const res = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${requester.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/permission-requests/:id/approve (nodeId)', () => {
  it('approves request when owner', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `approve-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `approve-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });
});

describe('POST /api/permission-requests/:id/cancel (nodeId)', () => {
  it('returns 200 when requester cancels', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `cancel-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `cancel-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

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
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `cancel-req-403-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/permission-requests/:id/reject (nodeId)', () => {
  it('rejects request when owner', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `reject-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `reject-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const requestId = createRes.body.id;

    const res = await request(app)
      .post(`/api/permission-requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});

describe('GET /api/permission-requests/check-owner (nodeId)', () => {
  it('returns owner info for valid nodeId', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `checkowner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);

    const requester = await createAuthenticatedTestUser({
      username: `checkowner-req-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/permission-requests/check-owner')
      .set('Authorization', `Bearer ${requester.token}`)
      .query({ nodeId: ownerDir.id });

    expect(res.status).toBe(200);
    expect(res.body.ownerExists).toBe(true);
    expect(res.body.ownerUsername).toBe(owner.user.username);
  });

  it('returns 400 when nodeId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `checkowner-400-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/permission-requests/check-owner')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});
