/**
 * Permissions routes integration tests — nodeId-based payloads.
 * All permission route handlers accept nodeId instead of path strings.
 * @see docs/api.md, docs/spec/server/routes/permissions.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createUserRootNode,
  PERMISSIONS,
} = require('../../../../test-utils');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const permissionStore = require('../../stores/permissionStore');

var mockWebdav;
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('@testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

let app;
let dbCleanup;
let resetPermissionExistenceIndex;
let fileNodesStore;
let fileNodeService;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../../index');
  ({ __resetForTests: resetPermissionExistenceIndex } = require('../../stores/permissionExistenceIndex'));
  fileNodesStore = createFileNodesStore();
  fileNodeService = createFileNodeService({ fileNodesStore });
});

afterAll(async () => {
  await dbCleanup?.();
});

beforeEach(jest.clearAllMocks);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function createTestDirectory(parentNodeId, name) {
  return fileNodeService.createDirectory(parentNodeId, name || `test-dir-${Date.now()}`);
}

async function createTestFile(parentNodeId, name) {
  return fileNodeService.createFile(parentNodeId, name || `test-file-${Date.now()}.txt`);
}

/** Grant permission via store directly (bypasses facade path compat). */
async function grantNodePermission(userId, nodeId, permission) {
  return permissionStore.grant(userId, nodeId, permission);
}

/* ------------------------------------------------------------------ */
/*  POST /api/permissions/grant                                       */
/* ------------------------------------------------------------------ */

describe('POST /api/permissions/grant (nodeId)', () => {
  beforeEach(() => {
    mockWebdav.pathExists.mockReset();
    mockWebdav.pathExists.mockResolvedValue(true);
    resetPermissionExistenceIndex?.();
  });

  // V1: Grant with nodeId, userId, permission → 200
  it('grants permission when nodeId is valid directory and user has grant rights', async () => {
    const owner = await createAuthenticatedTestUser({ username: `grant-owner-${Date.now()}` });
    const dirNode = await createTestDirectory(null);
    await grantNodePermission(owner.user.id, dirNode.id, PERMISSIONS.ADMIN);

    const targetUser = await createAuthenticatedTestUser({ username: `grant-target-${Date.now()}` });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        nodeId: dirNode.id,
        userId: targetUser.user.id,
        permission: PERMISSIONS.READ,
      });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });

  // V2: Missing nodeId → 400
  it('returns 400 when nodeId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 999, permission: PERMISSIONS.READ });

    expect(res.status).toBe(400);
  });

  it('returns 400 when userId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });
    const dirNode = await createTestDirectory(null);

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: dirNode.id, permission: PERMISSIONS.READ });

    expect(res.status).toBe(400);
  });

  it('returns 400 when permission is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });
    const dirNode = await createTestDirectory(null);

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: dirNode.id, userId: 999 });

    expect(res.status).toBe(400);
  });

  it('returns 404 when nodeId does not exist', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: 999999, userId: 1, permission: PERMISSIONS.READ });

    expect(res.status).toBe(404);
  });

  it('returns 400 when nodeId is a file (not directory)', async () => {
    const owner = await createAuthenticatedTestUser({ username: `grant-file-owner-${Date.now()}` });
    const fileNode = await createTestFile(null, `file-grant-test-${Date.now()}.txt`);

    const targetUser = await createAuthenticatedTestUser({ username: `grant-file-target-${Date.now()}` });

    const res = await request(app)
      .post('/api/permissions/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        nodeId: fileNode.id,
        userId: targetUser.user.id,
        permission: PERMISSIONS.READ,
      });

    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/permissions/revoke                                    */
/* ------------------------------------------------------------------ */

describe('DELETE /api/permissions/revoke (nodeId)', () => {
  // V3: Revoke with nodeId → 200, permission removed
  it('revokes permission when user has revoke rights', async () => {
    const owner = await createAuthenticatedTestUser({ username: `revoke-owner-${Date.now()}` });
    const dirNode = await createTestDirectory(null);
    await grantNodePermission(owner.user.id, dirNode.id, PERMISSIONS.ADMIN);

    const targetUser = await createAuthenticatedTestUser({ username: `revoke-target-user-${Date.now()}` });
    await grantNodePermission(targetUser.user.id, dirNode.id, PERMISSIONS.READ);

    const beforeCheck = await permissionStore.checkPermission(
      targetUser.user.id, dirNode.id, PERMISSIONS.READ
    );
    expect(beforeCheck).toBe(true);

    const res = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ userId: targetUser.user.id, nodeId: dirNode.id });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();

    const afterCheck = await permissionStore.checkPermission(
      targetUser.user.id, dirNode.id, PERMISSIONS.READ
    );
    expect(afterCheck).toBe(false);
  });

  it('returns 400 when nodeId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${token}`)
      .query({ userId: 999 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when userId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });
    const dirNode = await createTestDirectory(null);

    const res = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: dirNode.id });

    expect(res.status).toBe(400);
  });

  it('returns 404 when nodeId does not exist', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${token}`)
      .query({ userId: 999, nodeId: 999999 });

    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/permissions/check                                        */
/* ------------------------------------------------------------------ */

describe('GET /api/permissions/check (nodeId)', () => {
  // V4: Check with nodeId → returns hasRead, hasWrite, source
  it('returns permission info for valid nodeId', async () => {
    const user = await createAuthenticatedTestUser({ username: `check-user-${Date.now()}` });
    const dirNode = await createTestDirectory(null);
    await grantNodePermission(user.user.id, dirNode.id, PERMISSIONS.READ);

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: dirNode.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nodeId: dirNode.id,
      hasRead: true,
      hasWrite: false,
      source: 'path',
    });
  });

  it('returns hasRead and hasWrite true for write permission', async () => {
    const user = await createAuthenticatedTestUser({ username: `check-write-${Date.now()}` });
    const dirNode = await createTestDirectory(null);
    await grantNodePermission(user.user.id, dirNode.id, PERMISSIONS.WRITE);

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: dirNode.id });

    expect(res.status).toBe(200);
    expect(res.body.hasRead).toBe(true);
    expect(res.body.hasWrite).toBe(true);
  });

  it('returns false for both when no permission', async () => {
    const user = await createAuthenticatedTestUser({ username: `check-none-${Date.now()}` });
    const dirNode = await createTestDirectory(null);

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: dirNode.id });

    expect(res.status).toBe(200);
    expect(res.body.hasRead).toBe(false);
    expect(res.body.hasWrite).toBe(false);
  });

  it('returns 400 when nodeId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const dirNode = await createTestDirectory(null);

    const res = await request(app)
      .get('/api/permissions/check')
      .query({ nodeId: dirNode.id });

    expect(res.status).toBe(401);
  });

  it('returns 404 when nodeId does not exist', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: 999999 });

    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  V5: Closure table inheritance                                     */
/* ------------------------------------------------------------------ */

describe('Closure table inheritance', () => {
  // V5: Grant on parent → child/grandchild accessible via closure table
  it('grants folder permission inherited by child and grandchild nodes', async () => {
    const owner = await createAuthenticatedTestUser({ username: `inherit-owner-${Date.now()}` });
    const targetUser = await createAuthenticatedTestUser({ username: `inherit-target-${Date.now()}` });

    const parentDir = await createTestDirectory(null, `inherit-parent-${Date.now()}`);
    const childDir = await createTestDirectory(parentDir.id, `inherit-child-${Date.now()}`);
    const grandchildDir = await createTestDirectory(childDir.id, `inherit-grandchild-${Date.now()}`);

    // Grant read on parent directory for target user
    await grantNodePermission(targetUser.user.id, parentDir.id, PERMISSIONS.READ);

    // Verify: child should inherit via closure table
    const childHasRead = await permissionStore.checkPermission(
      targetUser.user.id, childDir.id, PERMISSIONS.READ
    );
    expect(childHasRead).toBe(true);

    // Verify: grandchild should also inherit
    const grandchildHasRead = await permissionStore.checkPermission(
      targetUser.user.id, grandchildDir.id, PERMISSIONS.READ
    );
    expect(grandchildHasRead).toBe(true);

    // Also verify via route check endpoint
    const childCheckRes = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${targetUser.token}`)
      .query({ nodeId: childDir.id });
    expect(childCheckRes.status).toBe(200);
    expect(childCheckRes.body.hasRead).toBe(true);

    const grandchildCheckRes = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${targetUser.token}`)
      .query({ nodeId: grandchildDir.id });
    expect(grandchildCheckRes.status).toBe(200);
    expect(grandchildCheckRes.body.hasRead).toBe(true);
  });

  it('revoking parent permission removes inherited access for descendants', async () => {
    const owner = await createAuthenticatedTestUser({ username: `revoke-inherit-${Date.now()}` });
    const targetUser = await createAuthenticatedTestUser({ username: `revoke-target-${Date.now()}` });

    const parentDir = await createTestDirectory(null, `revoke-parent-${Date.now()}`);
    const childDir = await createTestDirectory(parentDir.id, `revoke-child-${Date.now()}`);

    await grantNodePermission(owner.user.id, parentDir.id, PERMISSIONS.ADMIN);
    await grantNodePermission(targetUser.user.id, parentDir.id, PERMISSIONS.READ);

    // Verify inherited access exists
    let hasRead = await permissionStore.checkPermission(
      targetUser.user.id, childDir.id, PERMISSIONS.READ
    );
    expect(hasRead).toBe(true);

    // Revoke via route
    const revokeRes = await request(app)
      .delete('/api/permissions/revoke')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ userId: targetUser.user.id, nodeId: parentDir.id });
    expect(revokeRes.status).toBe(200);

    // Verify inherited access removed
    hasRead = await permissionStore.checkPermission(
      targetUser.user.id, childDir.id, PERMISSIONS.READ
    );
    expect(hasRead).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/permissions/user/:userId                                 */
/* ------------------------------------------------------------------ */

describe('GET /api/permissions/user/:userId (nodeId)', () => {
  beforeEach(() => {
    mockWebdav.pathExists.mockReset();
    mockWebdav.pathExists.mockResolvedValue(true);
    resetPermissionExistenceIndex?.();
  });

  it('returns permission list for user', async () => {
    const owner = await createAuthenticatedTestUser({ username: `user-perms-${Date.now()}` });
    const dirNode1 = await createTestDirectory(null, `perm-dir-1-${Date.now()}`);
    const dirNode2 = await createTestDirectory(null, `perm-dir-2-${Date.now()}`);

    await grantNodePermission(owner.user.id, dirNode1.id, PERMISSIONS.READ);
    await grantNodePermission(owner.user.id, dirNode2.id, PERMISSIONS.WRITE);

    const res = await request(app)
      .get(`/api/permissions/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 403 when non-admin views other user permissions', async () => {
    const user1 = await createAuthenticatedTestUser({ username: `view-user1-${Date.now()}` });
    const user2 = await createAuthenticatedTestUser({ username: `view-user2-${Date.now()}` });

    const res = await request(app)
      .get(`/api/permissions/user/${user2.user.id}`)
      .set('Authorization', `Bearer ${user1.token}`);

    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/permissions/folder                                       */
/* ------------------------------------------------------------------ */

describe('GET /api/permissions/folder (nodeId)', () => {
  it('returns permissions for a folder nodeId', async () => {
    const owner = await createAuthenticatedTestUser({ username: `folder-perms-${Date.now()}` });
    const dirNode = await createTestDirectory(null, `folder-node-${Date.now()}`);

    await grantNodePermission(owner.user.id, dirNode.id, PERMISSIONS.ADMIN);
    const targetUser = await createAuthenticatedTestUser({ username: `folder-target-${Date.now()}` });
    await grantNodePermission(targetUser.user.id, dirNode.id, PERMISSIONS.READ);

    const res = await request(app)
      .get('/api/permissions/folder')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ nodeId: dirNode.id });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  File permission routes                                            */
/* ------------------------------------------------------------------ */

describe('POST /api/permissions/file/grant (nodeId)', () => {
  it('grants file-level permission with fileNodeId', async () => {
    const owner = await createAuthenticatedTestUser({ username: `file-grant-owner-${Date.now()}` });
    const parentDir = await createTestDirectory(null, `file-parent-${Date.now()}`);
    await grantNodePermission(owner.user.id, parentDir.id, PERMISSIONS.ADMIN);

    const fileNode = await createTestFile(parentDir.id, `file-node-grant-${Date.now()}.txt`);
    const targetUser = await createAuthenticatedTestUser({ username: `file-grant-target-${Date.now()}` });

    const res = await request(app)
      .post('/api/permissions/file/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fileNodeId: fileNode.id,
        userId: targetUser.user.id,
        permission: PERMISSIONS.READ,
      });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .post('/api/permissions/file/grant')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 999, permission: PERMISSIONS.READ });

    expect(res.status).toBe(400);
  });

  it('returns 404 when fileNodeId does not exist', async () => {
    const owner = await createAuthenticatedTestUser({ username: `file-notfound-${Date.now()}` });

    const res = await request(app)
      .post('/api/permissions/file/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fileNodeId: 999999, userId: 1, permission: PERMISSIONS.READ });

    expect(res.status).toBe(404);
  });

  it('returns 400 when nodeId is a directory (not file)', async () => {
    const owner = await createAuthenticatedTestUser({ username: `file-notdir-${Date.now()}` });
    const dirNode = await createTestDirectory(null, `not-a-file-${Date.now()}`);

    const res = await request(app)
      .post('/api/permissions/file/grant')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fileNodeId: dirNode.id, userId: 1, permission: PERMISSIONS.READ });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/permissions/file/revoke (nodeId)', () => {
  it('revokes file-level permission', async () => {
    const owner = await createAuthenticatedTestUser({ username: `file-rev-owner-${Date.now()}` });
    const parentDir = await createTestDirectory(null, `file-rev-parent-${Date.now()}`);
    await grantNodePermission(owner.user.id, parentDir.id, PERMISSIONS.ADMIN);

    const fileNode = await createTestFile(parentDir.id, `file-node-revoke-${Date.now()}.txt`);
    const targetUser = await createAuthenticatedTestUser({ username: `file-rev-target-${Date.now()}` });

    // Grant first
    await permissionStore.grantFilePermission(targetUser.user.id, fileNode.id, PERMISSIONS.READ);
    let perm = await permissionStore.getFilePermission(targetUser.user.id, fileNode.id);
    expect(perm).not.toBeNull();

    // Revoke via route
    const res = await request(app)
      .delete('/api/permissions/file/revoke')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ userId: targetUser.user.id, fileNodeId: fileNode.id });

    expect(res.status).toBe(200);

    perm = await permissionStore.getFilePermission(targetUser.user.id, fileNode.id);
    expect(perm).toBeNull();
  });

  it('returns 400 when required fields are missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .delete('/api/permissions/file/revoke')
      .set('Authorization', `Bearer ${token}`)
      .query({ userId: 999 });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/permissions/file (nodeId)', () => {
  it('updates file-level permission', async () => {
    const owner = await createAuthenticatedTestUser({ username: `file-update-owner-${Date.now()}` });
    const parentDir = await createTestDirectory(null, `file-upd-parent-${Date.now()}`);
    await grantNodePermission(owner.user.id, parentDir.id, PERMISSIONS.ADMIN);

    const fileNode = await createTestFile(parentDir.id, `file-node-update-${Date.now()}.txt`);
    const targetUser = await createAuthenticatedTestUser({ username: `file-upd-target-${Date.now()}` });

    // Grant read first
    await permissionStore.grantFilePermission(targetUser.user.id, fileNode.id, PERMISSIONS.READ);

    // Update to write via route
    const res = await request(app)
      .patch('/api/permissions/file')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fileNodeId: fileNode.id,
        userId: targetUser.user.id,
        permission: PERMISSIONS.WRITE,
      });

    expect(res.status).toBe(200);

    const perm = await permissionStore.getFilePermission(targetUser.user.id, fileNode.id);
    expect(perm.permission).toBe(PERMISSIONS.WRITE);
  });
});

describe('GET /api/permissions/file/check (nodeId)', () => {
  it('returns file permission info for valid fileNodeId', async () => {
    const user = await createAuthenticatedTestUser({ username: `file-check-${Date.now()}` });
    const parentDir = await createTestDirectory(null);
    const fileNode = await createTestFile(parentDir.id, `file-check-node-${Date.now()}.txt`);

    await permissionStore.grantFilePermission(user.user.id, fileNode.id, PERMISSIONS.WRITE);

    const res = await request(app)
      .get('/api/permissions/file/check')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ fileNodeId: fileNode.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nodeId: fileNode.id,
      hasRead: true,
      hasWrite: true,
      source: 'file',
    });
  });

  it('returns 400 when fileNodeId is missing', async () => {
    const { token } = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .get('/api/permissions/file/check')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/permissions/file/list (nodeId)', () => {
  it('returns user file-level permissions', async () => {
    const user = await createAuthenticatedTestUser({ username: `file-list-${Date.now()}` });
    const parentDir = await createTestDirectory(null);
    const fileNode1 = await createTestFile(parentDir.id, `list-file-1-${Date.now()}.txt`);
    const fileNode2 = await createTestFile(parentDir.id, `list-file-2-${Date.now()}.txt`);

    await permissionStore.grantFilePermission(user.user.id, fileNode1.id, PERMISSIONS.READ);
    await permissionStore.grantFilePermission(user.user.id, fileNode2.id, PERMISSIONS.WRITE);

    const res = await request(app)
      .get('/api/permissions/file/list')
      .set('Authorization', `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should have at least the 2 file permissions we set up
    const matchingFiles = res.body.filter(item => item.file_node_id === fileNode1.id || item.file_node_id === fileNode2.id);
    expect(matchingFiles.length).toBeGreaterThanOrEqual(2);
  });

  // Regression: parentNodeId filter calls fileNodesStore.getDescendants (G3)
  it('returns 200 when filtering by parentNodeId (descendant filter)', async () => {
    const user = await createAuthenticatedTestUser({ username: `file-list-filter-${Date.now()}` });
    const parentDir = await createTestDirectory(null, `list-filter-parent-${Date.now()}`);
    const nestedDir = await createTestDirectory(parentDir.id, `list-filter-nested-${Date.now()}`);
    const fileNode1 = await createTestFile(parentDir.id, `list-filter-file-1-${Date.now()}.txt`);
    const fileNode2 = await createTestFile(nestedDir.id, `list-filter-file-2-${Date.now()}.txt`);

    await permissionStore.grantFilePermission(user.user.id, fileNode1.id, PERMISSIONS.READ);
    await permissionStore.grantFilePermission(user.user.id, fileNode2.id, PERMISSIONS.WRITE);

    const res = await request(app)
      .get('/api/permissions/file/list')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ parentNodeId: parentDir.id });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Both direct child and nested descendant files are within the subtree
    const ids = res.body.map(item => item.file_node_id);
    expect(ids).toContain(fileNode1.id);
    expect(ids).toContain(fileNode2.id);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/permissions/shared                                       */
/* ------------------------------------------------------------------ */

describe('GET /api/permissions/shared', () => {
  beforeEach(() => {
    mockWebdav.pathExists.mockReset();
    mockWebdav.pathExists.mockResolvedValue(true);
    resetPermissionExistenceIndex?.();
  });

  it('excludes the user own home subtree and returns real names/types for genuine shares', async () => {
    const owner = await createAuthenticatedTestUser({ username: `shared-owner-${Date.now()}` });
    const recipient = await createAuthenticatedTestUser({ username: `shared-recipient-${Date.now()}` });

    const ownerHome = await createUserRootNode({ userId: owner.user.id });
    const recipientHome = await createUserRootNode({ userId: recipient.user.id });

    // recipient shares a folder with owner (genuine share)
    const sharedDir = await fileNodeService.createDirectory(recipientHome.nodeId, `shared-dir-${Date.now()}`);
    await permissionStore.grant(owner.user.id, sharedDir.id, PERMISSIONS.WRITE);

    // recipient grants a file to owner (genuine share)
    const sharedFile = await fileNodeService.createFile(recipientHome.nodeId, `shared-file-${Date.now()}.txt`);
    await permissionStore.grantFilePermission(owner.user.id, sharedFile.id, PERMISSIONS.READ);

    // owner's own folder with a legacy self-grant (historical pollution) — must NOT appear
    const ownDir = await fileNodeService.createDirectory(ownerHome.nodeId, `own-dir-${Date.now()}`);
    await permissionStore.grant(owner.user.id, ownDir.id, PERMISSIONS.WRITE);

    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    const byId = new Map(res.body.map(p => [p.nodeId, p]));
    expect(byId.has(sharedDir.id)).toBe(true);
    expect(byId.get(sharedDir.id)).toMatchObject({ name: sharedDir.name, permission: 'write', type: 'directory' });
    expect(byId.has(sharedFile.id)).toBe(true);
    expect(byId.get(sharedFile.id)).toMatchObject({ name: sharedFile.name, type: 'file' });
    // own subtree must never surface as shared
    expect(byId.has(ownerHome.nodeId)).toBe(false);
    expect(byId.has(ownDir.id)).toBe(false);
  });

  it('returns an empty array for admin users', async () => {
    const admin = await createAuthenticatedTestUser({ grantRoot: true });

    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
