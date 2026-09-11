/**
 * Trash route tests (DEF-16 P2/P3/P9): listing (topmost + parentId
 * navigation), restore, purge, empty.
 * @see docs/spec/server/routes/files.md (Trash routes)
 *
 * Visibility contract: a trashed row is visible iff the caller has WRITE
 * permission on it (permission rows survive the trash) or is an admin;
 * read-only grantees are invisible; share tokens are refused 403. Restore is
 * write-gated (403), purge uses the delete perm (write, admin bypasses, 409
 * files.notTrashed for a live node), empty trash is admin-only (403).
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const permissionStore = require('../../../../store/permissionStore');
const composition = require('../../../../service/composition');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');

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

  it('A22: trashed file rows carry the filecache-backed size', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-size-${Date.now()}` });
    const file = await fileNodeService.createFile(owner.homeId, 'big.bin');
    const store = createFileNodesStore();
    await store.upsertCache(file.id, 12345, 'application/octet-stream', null);

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(del.status).toBe(200);

    const res = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i) => i.nodeId === file.id);
    expect(row).toBeDefined();
    expect(row.size).toBe(12345);
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

  it('A22: the perm-revoked-while-trashed degenerate case — revoking the grant makes the ex-deleter\u2019s item invisible to them (documented, no restore path left for them)', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-revoke-${Date.now()}` });
    const writer = await createAuthenticatedTestUser({
      username: `trash-revoke-w-${Date.now()}`,
    });
    const folder = await fileNodeService.createDirectory(owner.homeId, `revoke-${Date.now()}`);
    await grantTestPermissionByNodeId({
      userId: writer.user.id,
      fileNodeId: folder.id,
      permission: 'write',
    });

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: folder.id });
    expect(del.status).toBe(200);

    // While the write grant survives the trash, the grantee sees the row...
    const visible = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${writer.token}`);
    expect(visible.body.items.some((i) => i.nodeId === folder.id)).toBe(true);

    // ...revoking the perm entirely (P7 degenerate case) makes it invisible to
    // them — only the owner/admin retain access (restore/purge through them).
    await permissionStore.revoke(writer.user.id, folder.id);
    const revoked = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${writer.token}`);
    expect(revoked.body.items.some((i) => i.nodeId === folder.id)).toBe(false);
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

  it('A22: the root listing shows only TOPMOST trashed rows; nested children are reachable via parentId navigation', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-nav-${Date.now()}` });
    const folder = await fileNodeService.createDirectory(owner.homeId, `nav-folder-${Date.now()}`);
    const child = await fileNodeService.createFile(folder.id, `nav-child-${Date.now()}.txt`);

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: folder.id });
    expect(del.status).toBe(200);

    // Root-level listing: the trashed FOLDER is topmost; its nested child is
    // NOT part of the flat root listing (hierarchical navigation).
    const rootList = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(rootList.status).toBe(200);
    expect(rootList.body.items.some((i) => i.nodeId === folder.id)).toBe(true);
    expect(rootList.body.items.some((i) => i.nodeId === child.id)).toBe(false);

    // parentId navigation: the trashed folder's trashed children.
    const navRes = await request(app)
      .get('/api/files/trash')
      .query({ parentId: folder.id })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(navRes.status).toBe(200);
    expect(navRes.body.items.map((i) => i.nodeId)).toEqual([child.id]);
    expect(navRes.body.total).toBe(1);
    const navRow = navRes.body.items[0];
    expect(navRow.deletedAt).not.toBeNull();
    expect(navRow.displayPath).toBe(`/${owner.user.username}/${folder.name}/${child.name}`);
  });

  it('returns 404 for an unknown trash parentId', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-nav-404-${Date.now()}` });
    const res = await request(app)
      .get('/api/files/trash')
      .query({ parentId: 99999999 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);
  });
});

describe('POST /api/files/trash/restore', () => {
  beforeAll(async () => {
    await useS3Mode();
    app = require('../../../../index');
  });

  it('restores a trashed file in place; auto-restores trashed ancestors; siblings of restored ancestors stay trashed', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-restore-${Date.now()}` });
    const parent = await fileNodeService.createDirectory(owner.homeId, `restore-p-${Date.now()}`);
    const sibling = await fileNodeService.createDirectory(
      owner.homeId,
      `restore-sib-${Date.now()}`
    );
    const file = await fileNodeService.createFile(parent.id, `restore-me-${Date.now()}.txt`);

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: parent.id });
    expect(del.status).toBe(200);
    await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: sibling.id });

    const res = await request(app)
      .post('/api/files/trash/restore')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.files.trashRestored);
    expect(res.body.nodeId).toBe(file.id);
    expect(res.body.restoredNodes).toEqual(expect.arrayContaining([parent.id, file.id]));
    expect(res.body.restoredNodes).not.toContain(sibling.id);
    expect(res.body.finalPath).toBe(`/${owner.user.username}/${parent.name}/${file.name}`);

    // The restored subtree is live again: the folder lists its child.
    const list = await request(app)
      .get('/api/files/list')
      .query({ nodeId: parent.id })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((i) => i.nodeId === file.id)).toBe(true);

    // The sibling of the restored ancestor is still in the trash.
    const trash = await request(app)
      .get('/api/files/trash')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(trash.body.items.some((i) => i.nodeId === sibling.id)).toBe(true);
    expect(trash.body.items.some((i) => i.nodeId === file.id)).toBe(false);
  });

  it('suffixes the restored name against a LIVE sibling (name (2).ext) and refuses a live node with 409', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-suffix-${Date.now()}` });
    const file = await fileNodeService.createFile(owner.homeId, `dup-${Date.now()}.txt`);
    const trashedDel = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(trashedDel.status).toBe(200);
    await fileNodeService.createFile(owner.homeId, file.name);

    const res = await request(app)
      .post('/api/files/trash/restore')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(res.status).toBe(200);
    expect(res.body.finalPath).toBe(
      `/${owner.user.username}/${file.name.replace(/\.txt$/, '')} (2).txt`
    );

    // A LIVE node is not restorable: 409 files.notTrashed.
    const liveFile = await fileNodeService.createFile(owner.homeId, `alive-${Date.now()}.txt`);
    const liveRes = await request(app)
      .post('/api/files/trash/restore')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: liveFile.id });
    expect(liveRes.status).toBe(409);
    expect(liveRes.body.errorCode).toBe(SERVER_ERROR_CODES.files.notTrashed);
  });

  it('returns 403 for a read-only grantee restore and 403 for a share token', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-rest-403-${Date.now()}` });
    const reader = await createAuthenticatedTestUser({
      username: `trash-rest-reader-${Date.now()}`,
    });
    const folder = await fileNodeService.createDirectory(owner.homeId, `rest-403-${Date.now()}`);
    const file = await fileNodeService.createFile(folder.id, `rest-403-f-${Date.now()}.txt`);
    await grantTestPermissionByNodeId({
      userId: reader.user.id,
      fileNodeId: folder.id,
      permission: 'read',
    });
    // Share link created while the file is still LIVE (share routes gate on
    // live rows — a trashed row is not shareable).
    const fileLink = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fileNodeId: file.id });
    expect(fileLink.status).toBe(200);

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(del.status).toBe(200);

    const denied = await request(app)
      .post('/api/files/trash/restore')
      .set('Authorization', `Bearer ${reader.token}`)
      .send({ nodeId: file.id });
    expect(denied.status).toBe(403);

    // Share tokens are refused on every trash route.
    const shareRes = await request(app)
      .post('/api/files/trash/restore')
      .set('X-Share-Token', fileLink.body.token)
      .send({ nodeId: file.id });
    expect(shareRes.status).toBe(403);
  });
});

describe('POST /api/files/trash/purge', () => {
  beforeAll(async () => {
    await useS3Mode();
    app = require('../../../../index');
  });

  it('owner purges ONE trashed item permanently (rows gone); a live node gets 409; a read-only grantee gets 403', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-purge-${Date.now()}` });
    const reader = await createAuthenticatedTestUser({
      username: `trash-purge-reader-${Date.now()}`,
    });
    const file = await fileNodeService.createFile(owner.homeId, `purge-me-${Date.now()}.txt`);
    await grantTestPermissionByNodeId({
      userId: reader.user.id,
      fileNodeId: file.id,
      permission: 'read',
    });

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(del.status).toBe(200);

    // Read-only grantee: the item is invisible (write-based visibility) and
    // the purge is refused.
    const denied = await request(app)
      .post('/api/files/trash/purge')
      .set('Authorization', `Bearer ${reader.token}`)
      .send({ nodeId: file.id });
    expect(denied.status).toBe(403);

    const purge = await request(app)
      .post('/api/files/trash/purge')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(purge.status).toBe(200);
    expect(purge.body.messageCode).toBe(SERVER_MESSAGE_CODES.files.trashPurged);
    expect(purge.body.purgedNodes).toBe(1);

    const { dbQuery } = require('../../../../test-utils');
    const row = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [file.id]);
    expect(row.rows).toHaveLength(0);

    // A live node cannot be purged through the trash route (409 notTrashed).
    const liveFile = await fileNodeService.createFile(owner.homeId, `alive-${Date.now()}.txt`);
    const liveRes = await request(app)
      .post('/api/files/trash/purge')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: liveFile.id });
    expect(liveRes.status).toBe(409);
    expect(liveRes.body.errorCode).toBe(SERVER_ERROR_CODES.files.notTrashed);
  });
});

describe('POST /api/files/trash/empty', () => {
  beforeAll(async () => {
    await useS3Mode();
    app = require('../../../../index');
  });

  it('admin-only: purges all topmost trashed items; non-admin receives 403; share token 403', async () => {
    const owner = await createUserWithHomeNode({ username: `trash-empty-${Date.now()}` });
    const admin = await createAuthenticatedTestUser({
      username: `trash-empty-admin-${Date.now()}`,
      isAdmin: true,
    });
    const file = await fileNodeService.createFile(owner.homeId, `empty-me-${Date.now()}.txt`);
    // Share link created while the file is still LIVE; a SECOND share link on
    // a live file survives the empty (its target is never purged) so the
    // share-refusal assertion exercises requireTokenNotShare, not a missing
    // link (404).
    const survivor = await fileNodeService.createFile(owner.homeId, `survivor-${Date.now()}.txt`);
    const survivorLink = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fileNodeId: survivor.id });
    expect(survivorLink.status).toBe(200);
    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: file.id });
    expect(del.status).toBe(200);

    // Non-admin: 403.
    const denied = await request(app)
      .post('/api/files/trash/empty')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.errorCode).toBe(SERVER_ERROR_CODES.admin.adminRequired);

    // Admin: purges everything (owner's trashed item included).
    const empty = await request(app)
      .post('/api/files/trash/empty')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(empty.status).toBe(200);
    expect(empty.body.purgedNodes).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(empty.body.errors)).toBe(true);

    const { dbQuery } = require('../../../../test-utils');
    const row = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [file.id]);
    expect(row.rows).toHaveLength(0);

    // Share tokens are refused.
    const shareRes = await request(app)
      .post('/api/files/trash/empty')
      .set('X-Share-Token', survivorLink.body.token);
    expect(shareRes.status).toBe(403);
  });
});
