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
const composition = require('../../../../service/composition');
const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');

let app;
let dbCleanup;
let fileNodesStore;
let fileNodeService;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodesStore = createFileNodesStore();
  fileNodeService = createFileNodeService({ fileNodesStore });
  const webdavMock = createWebdavMock();
  const blobStore = new WebdavBlobStore(webdavMock);
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore,
    fileNodeService,
  });
  app = require('../../../../index');
});

afterAll(async () => {
  composition.resetComposition();
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
      file_node_id: ownerDir.id,
    });
    expect(res.body.display_path).toBe(`/${owner.user.username}`);
    expect(res.body.target_name).toBe(owner.user.username);
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
      file_node_id: testFile.id,
    });
    expect(res.body.display_path).toBe(`/${owner.user.username}/${testFile.name}`);
    expect(res.body.target_name).toBe(testFile.name);
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

  it('blocks a request against the requester own folder (self-reference)', async () => {
    const user = await createAuthenticatedTestUser({
      username: `self-req-${Date.now()}`,
    });
    const ownDir = await createOwnerDirectory(user.user.username);

    const res = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: ownDir.id, permission: PERMISSIONS.READ });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('serverErrors.permissionRequests.ownPath');

    const inbox = await request(app)
      .get('/api/permission-requests/inbox')
      .set('Authorization', `Bearer ${user.token}`);
    const outbox = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${user.token}`);
    const selfPair = (r) =>
      r.requester_id === user.user.id &&
      r.owner_id === user.user.id &&
      r.file_node_id === ownDir.id;
    expect(inbox.body.some(selfPair)).toBe(false);
    expect(outbox.body.some(selfPair)).toBe(false);
  });
});

describe('Permission request lifecycle (state transitions)', () => {
  it('owner approve grants exactly the requested permission (read)', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });
    expect(createRes.body.status).toBe('pending');

    const approveRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(approveRes.body.status).toBe('approved');

    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${requester.token}`)
      .query({ nodeId: ownerDir.id });
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ hasRead: true, hasWrite: false });

    const shared = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${requester.token}`);
    const entry = shared.body.find((p) => p.nodeId === ownerDir.id);
    expect(entry).toBeDefined();
    expect(entry.permission).toBe(PERMISSIONS.READ);
  });

  it('owner approve grants exactly the requested permission (write)', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-w-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-w-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.WRITE });

    const approveRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(approveRes.body.status).toBe('approved');

    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${requester.token}`)
      .query({ nodeId: ownerDir.id });
    expect(check.body).toMatchObject({ hasRead: true, hasWrite: true });

    const shared = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${requester.token}`);
    const entry = shared.body.find((p) => p.nodeId === ownerDir.id);
    expect(entry).toBeDefined();
    expect(entry.permission).toBe(PERMISSIONS.WRITE);
  });

  it('owner approve on a file request grants the file-level permission', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-f-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const testFile = await fileNodeService.createFile(ownerDir.id, `lifecycle-f-file-${Date.now()}.txt`);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-f-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ fileNodeId: testFile.id, permission: PERMISSIONS.READ });
    expect(createRes.body.status).toBe('pending');

    const approveRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(approveRes.body.status).toBe('approved');

    const filePerm = await permissionStore.getFilePermission(requester.user.id, testFile.id);
    expect(filePerm).not.toBeNull();
    expect(filePerm.permission).toBe(PERMISSIONS.READ);

    const shared = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${requester.token}`);
    const entry = shared.body.find((p) => p.nodeId === testFile.id);
    expect(entry).toBeDefined();
    expect(entry.permission).toBe(PERMISSIONS.READ);
  });

  it('approve on a deleted target node returns 404 and grants nothing', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-d-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-d-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });
    expect(createRes.body.status).toBe('pending');

    await fileNodeService.deleteNode(ownerDir.id);

    const approveRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(approveRes.status).toBe(404);

    const userPerms = await permissionStore.getUserPermissions(requester.user.id);
    expect(userPerms.some((p) => p.file_node_id === ownerDir.id)).toBe(false);
  });

  it('owner reject grants nothing to the requester', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-r-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-r-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const rejectRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(rejectRes.body.status).toBe('rejected');

    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${requester.token}`)
      .query({ nodeId: ownerDir.id });
    expect(check.body).toMatchObject({ hasRead: false, hasWrite: false });

    const shared = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${requester.token}`);
    expect(shared.body.some((p) => p.nodeId === ownerDir.id)).toBe(false);
  });

  it('approve is reflected in inbox and outbox statuses', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-in-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-in-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);

    const inbox = await request(app)
      .get('/api/permission-requests/inbox')
      .set('Authorization', `Bearer ${owner.token}`);
    const inboxTarget = inbox.body.find((r) => r.id === createRes.body.id);
    expect(inboxTarget.status).toBe('approved');

    const outbox = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${requester.token}`);
    const outboxTarget = outbox.body.find((r) => r.id === createRes.body.id);
    expect(outboxTarget.status).toBe('approved');
  });

  it('reject is reflected in inbox and outbox statuses', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-rej-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-rej-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.token}`);

    const inbox = await request(app)
      .get('/api/permission-requests/inbox')
      .set('Authorization', `Bearer ${owner.token}`);
    const inboxTarget = inbox.body.find((r) => r.id === createRes.body.id);
    expect(inboxTarget.status).toBe('rejected');

    const outbox = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${requester.token}`);
    const outboxTarget = outbox.body.find((r) => r.id === createRes.body.id);
    expect(outboxTarget.status).toBe('rejected');
  });

  it('cancel is terminal: later approve fails and the status stays cancelled', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-c-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-c-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const cancelRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(cancelRes.body.status).toBe('cancelled');

    const approveRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(approveRes.status).toBe(400);
    expect(approveRes.body.errorCode).toBe(
      'serverErrors.permissionRequests.onlyPendingApprove'
    );

    const outbox = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${requester.token}`);
    const target = outbox.body.find((r) => r.id === createRes.body.id);
    expect(target.status).toBe('cancelled');

    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${requester.token}`)
      .query({ nodeId: ownerDir.id });
    expect(check.body).toMatchObject({ hasRead: false, hasWrite: false });
  });

  it('cancel is terminal: later reject fails and the status stays cancelled', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `lifecycle-cr-owner-${Date.now()}`,
    });
    const ownerDir = await createOwnerDirectory(owner.user.username);
    await grantNodePermission(owner.user.id, ownerDir.id, PERMISSIONS.ADMIN);

    const requester = await createAuthenticatedTestUser({
      username: `lifecycle-cr-req-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/permission-requests')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ nodeId: ownerDir.id, permission: PERMISSIONS.READ });

    const cancelRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(cancelRes.body.status).toBe('cancelled');

    const rejectRes = await request(app)
      .post(`/api/permission-requests/${createRes.body.id}/reject`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(rejectRes.status).toBe(400);
    expect(rejectRes.body.errorCode).toBe(
      'serverErrors.permissionRequests.onlyPendingApprove'
    );

    const outbox = await request(app)
      .get('/api/permission-requests/outbox')
      .set('Authorization', `Bearer ${requester.token}`);
    const target = outbox.body.find((r) => r.id === createRes.body.id);
    expect(target.status).toBe('cancelled');
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
    const target = res.body.find((r) => r.file_node_id === ownerDir.id);
    expect(target).toBeDefined();
    expect(target.display_path).toBe(`/${owner.user.username}`);
    expect(target.target_name).toBe(owner.user.username);
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
    const target = res.body.find((r) => r.file_node_id === ownerDir.id);
    expect(target).toBeDefined();
    expect(target.display_path).toBe(`/${owner.user.username}`);
    expect(target.target_name).toBe(owner.user.username);
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
