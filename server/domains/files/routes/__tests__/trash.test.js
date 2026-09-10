/**
 * Trash listing route tests (DEF-16 P9 companion).
 * @see docs/spec/server/routes/files.md (Trash listing route)
 *
 * Visibility contract: a trashed row is visible iff the caller has WRITE
 * permission on it (permission rows survive the trash) or is an admin;
 * read-only grantees are invisible; share tokens are refused 403.
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const composition = require('../../../../service/composition');

let fileNodeService;

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
});

afterAll(async () => {
  await dbCleanup?.();
});

beforeEach(jest.clearAllMocks);

async function useS3Mode() {
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });
  // The trash listing is storage-mode independent: S3 mode performs zero
  // physical I/O on trash, so a minimal blob-store stub suffices (no S3 env
  // or mocked client needed).
  composition.__setCompositionForTests({
    fileStorageMode: 's3',
    blobStore: {
      downloadBlob: jest.fn(),
      headBlob: jest.fn().mockResolvedValue(null),
      moveBlob: jest.fn().mockResolvedValue(undefined),
      deleteBlob: jest.fn().mockResolvedValue(undefined),
    },
    fileNodeService,
  });
}

async function createUserWithHomeNode(opts = {}) {
  const { user, token } = await createAuthenticatedTestUser(opts);
  const home = await fileNodeService.createDirectory(null, user.username);
  await grantTestPermissionByNodeId({ userId: user.id, fileNodeId: home.id, permission: 'admin' });
  return { user, token, homeId: home.id };
}

async function createTrashedFolder(owner, name) {
  const folder = await fileNodeService.createDirectory(owner.homeId, name);
  const del = await request(app)
    .delete('/api/files/delete')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ nodeId: folder.id });
  expect(del.status).toBe(200);
  return folder;
}

describe('GET /api/files/trash', () => {
  beforeAll(async () => {
    await useS3Mode();
    app = require('../../../../index');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/files/trash');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a share-token caller (trash is never share-scoped)', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-share-${Date.now()}` });
    const file = await fileNodeService.createFile(owner.homeId, 'share-me.txt');
    const linkRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fileNodeId: file.id });
    expect(linkRes.status).toBe(200);
    const shareToken = linkRes.body.token;

    const res = await request(app).get('/api/files/trash').set('X-Share-Token', shareToken);
    expect(res.status).toBe(403);
  });

  it('A22: the deleter (owner) sees the trashed node with deletedAt, displayPath and flags', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `trash-owner-${Date.now()}`,
    });
    const home = await fileNodeService.createDirectory(null, owner.user.username);
    await grantTestPermissionByNodeId({
      userId: owner.user.id,
      fileNodeId: home.id,
      permission: 'admin',
    });
    const folder = await fileNodeService.createDirectory(home.id, `trash-me-${Date.now()}`);
    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: folder.id });
    expect(del.status).toBe(200);

    const res = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);

    const row = res.body.items.find((i) => i.nodeId === folder.id);
    expect(row).toBeDefined();
    expect(row.name).toBe(folder.name);
    expect(row.type).toBe('directory');
    expect(row.deletedAt).not.toBeNull();
    expect(row.displayPath).toBe(`/${owner.user.username}/${folder.name}`);
    expect(row.hasReadPermission).toBe(true);
    expect(row.hasWritePermission).toBe(true);
    expect(row.hasAdminPermission).toBe(true);
  });

  it('A22: a WRITE grantee sees the trashed node; a read-only grantee does NOT', async () => {
    const owner = await createAuthenticatedTestUser({
      username: `trash-owner2-${Date.now()}`,
    });
    const writer = await createAuthenticatedTestUser({ username: `trash-writer-${Date.now()}` });
    const reader = await createAuthenticatedTestUser({ username: `trash-reader-${Date.now()}` });

    const home = await fileNodeService.createDirectory(null, owner.user.username);
    await grantTestPermissionByNodeId({
      userId: owner.user.id,
      fileNodeId: home.id,
      permission: 'admin',
    });
    const folder = await fileNodeService.createDirectory(home.id, `shared-trash-${Date.now()}`);
    await grantTestPermissionByNodeId({
      userId: writer.user.id,
      fileNodeId: folder.id,
      permission: 'write',
    });
    await grantTestPermissionByNodeId({
      userId: reader.user.id,
      fileNodeId: folder.id,
      permission: 'read',
    });

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: folder.id });
    expect(del.status).toBe(200);

    // Write grantee: visible (perm row survives + write perm holds).
    const writerRes = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${writer.token}`);
    expect(writerRes.status).toBe(200);
    expect(writerRes.body.items.some((i) => i.nodeId === folder.id)).toBe(true);

    // Read-only grantee: invisible.
    const readerRes = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${reader.token}`);
    expect(readerRes.status).toBe(200);
    expect(readerRes.body.items.some((i) => i.nodeId === folder.id)).toBe(false);
    expect(readerRes.body.items.some((i) => i.nodeId === home.id)).toBe(false);
  });

  it('A22: admin sees other users\u2019 trashed rows; an unrelated user does not', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-owner3-${Date.now()}` });
    const admin = await createAuthenticatedTestUser({
      username: `trash-admin-${Date.now()}`,
      isAdmin: true,
    });
    const outsider = await createAuthenticatedTestUser({
      username: `trash-outsider-${Date.now()}`,
    });

    const folder = await createTrashedFolder(owner, `admin-sees-${Date.now()}`);

    const adminRes = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(adminRes.status).toBe(200);
    const adminRow = adminRes.body.items.find((i) => i.nodeId === folder.id);
    expect(adminRow).toBeDefined();
    expect(adminRow.hasReadPermission).toBe(true);
    expect(adminRow.hasWritePermission).toBe(true);
    expect(adminRow.hasAdminPermission).toBe(true);

    const outsiderRes = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(outsiderRes.status).toBe(200);
    expect(outsiderRes.body.items.some((i) => i.nodeId === folder.id)).toBe(false);
  });

  it('A22: limit/offset paginate the caller-visible set and total reflects the pre-pagination count', async () => {
    const owner = await createAuthenticatedTestUser({ username: `trash-page-${Date.now()}` });
    const home = await fileNodeService.createDirectory(null, owner.user.username);
    await grantTestPermissionByNodeId({
      userId: owner.user.id,
      fileNodeId: home.id,
      permission: 'admin',
    });

    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const folder = await fileNodeService.createDirectory(home.id, `page-${i}-${Date.now()}`);
      ids.push(folder.id);
      const del = await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ nodeId: folder.id });
      expect(del.status).toBe(200);
    }

    const page = await request(app)
      .get('/api/files/trash')
      .query({ limit: 2, offset: 1 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(page.status).toBe(200);
    expect(page.body.total).toBeGreaterThanOrEqual(3);
    expect(page.body.items).toHaveLength(2);
    const visibleIds = page.body.items.map((i) => i.nodeId);
    for (const id of visibleIds) {
      expect(ids).toContain(id);
    }
    expect(visibleIds[0]).not.toBe(ids[0]); // offset skipped the first item

    const single = await request(app)
      .get('/api/files/trash')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(single.body.items).toHaveLength(1);
  });
});
