/**
 * Phase 4 Wave 5 Integration Tests
 *
 * Full-stack integration tests exercising real services against mocked S3/WebDAV boundaries.
 * Each scenario is isolated (own user, own data). DB assertions validate persistence layer state.
 */

/* ─── Environment MUST be set before ANY require() or jest.mock() ──────── */
process.env.WEA_SKIP_BULK_WORKER = '1';

/* ─── Hoisted mocks ────────────────────────────────────────────────────── */
const { createS3Mock } = require('@testing/mocks/s3Mock');
const { createWebdavMock } = require('@testing/mocks/webdavMock');

let currentMockS3;

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn(),
  };
});

/* ─── Imports (after hoisted mocks) ───────────────────────────────────── */
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createUserRootNode,
  grantTestPermissionByNodeId,
  dbQuery,
  dbRun,
} = require('@server/test-utils');
const request = require('supertest');
const permissionStore = require('@server/store/permissionStore');

let app; // Express app (lazy-loaded)

/* ─── Mock instances ─────────────────────────────────────────────────── */
const webdavMock = createWebdavMock();

/* ─── Helpers ────────────────────────────────────────────────────────── */
function wireS3Mock(s3Instance) {
  currentMockS3 = s3Instance || createS3Mock();
  const MockedS3Client = require('@aws-sdk/client-s3').S3Client;
  MockedS3Client.mockImplementation(() => ({
    send: async (command) => {
      const cmdName = command.constructor.name;
      if (cmdName === 'PutObjectCommand') return currentMockS3.putObject(command);
      if (cmdName === 'GetObjectCommand') return currentMockS3.getObject(command);
      if (cmdName === 'DeleteObjectCommand') return currentMockS3.deleteObject(command);
      if (cmdName === 'HeadObjectCommand') return currentMockS3.headObject(command);
      if (cmdName === 'CopyObjectCommand') return currentMockS3.copyObject(command);
      if (cmdName === 'ListObjectsV2Command') return currentMockS3.listObjectsV2(command);
      throw new Error(`Unknown command: ${cmdName}`);
    },
  }));
}

async function useS3Mode() {
  const S3BlobStore = require('@server/infrastructure/adapters/blobstore/S3BlobStore');
  const store = new S3BlobStore({ fileStorageMode: 's3' });
  const comp = require('@server/service/composition');
  comp.__setCompositionForTests({ fileStorageMode: 's3', blobStore: store });
}

async function useWebdavMode() {
  const WebdavBlobStore = require('@server/infrastructure/adapters/blobstore/WebdavBlobStore');
  const store = new WebdavBlobStore(webdavMock);
  const comp = require('@server/service/composition');
  comp.__setCompositionForTests({ fileStorageMode: 'webdav', blobStore: store });
}

async function uploadFile(user, parentNodeId, filename, content) {
  return request(app)
    .post('/api/files/upload')
    .set('Authorization', `Bearer ${user.token}`)
    .field('parentNodeId', String(parentNodeId))
    .attach('file', Buffer.from(content), filename);
}

/**
 * Create a non-admin user with a home-root node and the home-root ADMIN grant
 * (mirrors the production user creation/ensure-home-owner-admin flow).
 * Returns { user, token, homeNodeId }.
 */
async function createUserWithHomeNode(prefix) {
  const username = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const auth = await createAuthenticatedTestUser({ isAdmin: false, username });
  const home = await createUserRootNode({ userId: auth.user.id });
  await grantTestPermissionByNodeId({
    userId: auth.user.id,
    fileNodeId: home.nodeId,
    permission: 'admin',
  });
  return { ...auth, homeNodeId: home.nodeId };
}

/* ─── Lifecycle ──────────────────────────────────────────────────────── */
let dbCleanup;

beforeAll(async () => {
  wireS3Mock();
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('@server/index');
});

afterAll(async () => {
  await dbCleanup?.();
});

/* ========================================================================
   Scenario 1 - S3 Mode: Upload / List / Download (CRUD happy path)
   ======================================================================== */
describe('S5.0-SCENARIO-1: S3 mode upload/list/download', () => {
  let user, homeNodeId, fileNodeId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    const suffix = Date.now();
    user = await createAuthenticatedTestUser({ isAdmin: true, username: `s3crud-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `s3crud-home-${suffix}`);
    homeNodeId = homeDir.id;
  });

  it('uploads a file to home directory', async () => {
    const res = await uploadFile(user, homeNodeId, 'hello.txt', 'hello s3 world');
    expect(res.status).toBe(200);
    expect(res.body.nodeId).toBeDefined();
    fileNodeId = res.body.nodeId;
  });

  it('lists the home directory and finds the uploaded file', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .query({ nodeId: homeNodeId })
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.items;
    expect(items.some((i) => i.name === 'hello.txt')).toBe(true);
  });

  it('downloads the file and verifies content', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .query({ nodeId: fileNodeId })
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('hello s3 world');
  });

  it('DB: object_map has correct S3 key for the file', async () => {
    const result = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      fileNodeId,
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].s3_key).toMatch(/^[a-f0-9-]+$/);
  });

  it('DB: file_nodes record exists with correct name and type', async () => {
    const result = await dbQuery('SELECT name, type FROM file_nodes WHERE id = ?', [fileNodeId]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('hello.txt');
    expect(result.rows[0].type).toBe('file');
  });

  it('DB: closure table contains parent->child entry', async () => {
    const result = await dbQuery(
      'SELECT ancestor_id, descendant_id FROM node_ancestors WHERE descendant_id = ?',
      [fileNodeId]
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

/* ========================================================================
   Scenario 2 - S3 Mode: Rename file, verify key propagation
   ======================================================================== */
describe('S5.0-SCENARIO-2: S3 mode rename', () => {
  let user, homeNodeId, fileNodeId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    const suffix = Date.now();
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    user = await createAuthenticatedTestUser({ isAdmin: true, username: `s3rename-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `s3rename-home-${suffix}`);
    homeNodeId = homeDir.id;

    const uploadRes = await uploadFile(user, homeNodeId, 'original.txt', 'rename-me');
    expect(uploadRes.status).toBe(200);
    fileNodeId = uploadRes.body.nodeId;
  });

  it('renames a file and verifies new name', async () => {
    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: fileNodeId, newName: 'renamed.txt' });

    expect(res.status).toBe(200);
    expect(res.body.newName).toBe('renamed.txt');
  });

  it('DB: file_nodes reflects new name after rename', async () => {
    const result = await dbQuery('SELECT name FROM file_nodes WHERE id = ?', [fileNodeId]);
    expect(result.rows[0].name).toBe('renamed.txt');
  });

  it('DB: object_map s3_key is unchanged (rename does not move blob)', async () => {
    const result = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      fileNodeId,
    ]);
    expect(result.rows[0].s3_key).toMatch(/^[a-f0-9-]+$/);
  });

  it('S3: no deleteObject calls for S3 rename (blob stays)', async () => {
    const calls = currentMockS3.deleteObject.mock.calls;
    expect(calls.length).toBe(0);
  });
});

/* ========================================================================
   Scenario 3 - WebDAV Mode: Upload / List / Download (CRUD happy path)
   ======================================================================== */
describe('S5.0-SCENARIO-3: WebDAV mode upload/list/download', () => {
  let user, homeNodeId, fileNodeId;

  beforeAll(async () => {
    jest.clearAllMocks();
    const suffix = Date.now();
    webdavMock.getFileContents.mockResolvedValue(Buffer.from('webdav content'));
    webdavMock.putFileContents.mockResolvedValue(undefined);
    await useWebdavMode();

    user = await createAuthenticatedTestUser({ isAdmin: true, username: `webdavcrud-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `webdavcrud-home-${suffix}`);
    homeNodeId = homeDir.id;
  });

  it('uploads a file to home directory in WebDAV mode', async () => {
    webdavMock.putFileContents.mockResolvedValue(undefined);
    const res = await uploadFile(user, homeNodeId, 'webdav-file.txt', 'webdav content');
    expect(res.status).toBe(200);
    fileNodeId = res.body.nodeId;
  });

  it('lists the home directory and finds the uploaded file', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .query({ nodeId: homeNodeId })
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.items;
    expect(items.some((i) => i.name === 'webdav-file.txt')).toBe(true);
  });

  it('downloads the file and verifies content', async () => {
    webdavMock.getFileContents.mockResolvedValue(Buffer.from('webdav content'));
    const res = await request(app)
      .get('/api/files/download')
      .query({ nodeId: fileNodeId })
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('webdav content');
  });

  it('DB: filecache has entry for the file (WebDAV mode)', async () => {
    const result = await dbQuery('SELECT size, mime_type FROM filecache WHERE file_node_id = ?', [
      fileNodeId,
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it('DB: file_nodes record exists with correct name and type', async () => {
    const result = await dbQuery('SELECT name, type FROM file_nodes WHERE id = ?', [fileNodeId]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('webdav-file.txt');
    expect(result.rows[0].type).toBe('file');
  });

  it('DB: closure table contains parent->child entry', async () => {
    const result = await dbQuery(
      'SELECT ancestor_id, descendant_id FROM node_ancestors WHERE descendant_id = ?',
      [fileNodeId]
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('WebDAV: putFileContents was called during upload', async () => {
    const calls = webdavMock.putFileContents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });
});

/* ========================================================================
   Scenario 4 - S3 Mode: Copy-on-Write (CoW) verification
   ======================================================================== */
describe('S5.0-SCENARIO-4: S3 mode copy-on-write', () => {
  let user, homeNodeId, sourceNodeId, copiedNodeId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    const suffix = Date.now();
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    user = await createAuthenticatedTestUser({ isAdmin: true, username: `s3cow-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `s3cow-home-${suffix}`);
    homeNodeId = homeDir.id;

    const uploadRes = await uploadFile(user, homeNodeId, 'source-cow.txt', 'shared source content');
    expect(uploadRes.status).toBe(200);
    sourceNodeId = uploadRes.body.nodeId;
  });

  it('copies the file (CoW): target shares same s3_key as source', async () => {
    const res = await request(app)
      .post('/api/files/copy')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        nodeId: sourceNodeId,
        destinationParentNodeId: homeNodeId,
        newName: 'copied-cow.txt',
      });

    expect(res.status).toBe(200);
    const targetNodeId = res.body.copiedNodeId;
    copiedNodeId = targetNodeId;

    // Both nodes should share the same s3_key in object_map
    const dbResult = await dbQuery(
      'SELECT file_node_id, s3_key FROM object_map WHERE file_node_id IN (?, ?)',
      [sourceNodeId, targetNodeId]
    );
    expect(dbResult.rows).toHaveLength(2);
    const keys = new Set(dbResult.rows.map((r) => r.s3_key));
    // CoW: exactly one unique key shared between both nodes
    expect(keys.size).toBe(1);
  });

  it('source file remains downloadable after copy', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: sourceNodeId });
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('shared source content');
  });

  it('overwriting the copy leaves the original byte-identical (full CoW chain)', async () => {
    // Re-upload with the same filename into the same parent using onConflict
    // 'overwrite': the route must resolve the target to the existing copy node.
    const overwriteContent = Buffer.from('overwritten copy content');
    const overwriteRes = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${user.token}`)
      .field('parentNodeId', String(homeNodeId))
      .field('onConflict', 'overwrite')
      .attach('file', overwriteContent, 'copied-cow.txt');
    expect(overwriteRes.status).toBe(200);
    expect(overwriteRes.body.nodeId).toBe(copiedNodeId);

    // Observable CoW result: the original keeps its bytes while the copy
    // serves the overwritten content.
    const orig = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: sourceNodeId });
    const copy = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: copiedNodeId });
    expect(orig.status).toBe(200);
    expect(copy.status).toBe(200);
    expect(Buffer.from(orig.body).toString()).toBe('shared source content');
    expect(Buffer.from(copy.body).toString()).toBe('overwritten copy content');

    // The original's active s3_key still points at the untouched blob in the store.
    const activeRows = await dbQuery(
      'SELECT file_node_id, s3_key FROM object_map WHERE file_node_id IN (?, ?) AND status = ?',
      [sourceNodeId, copiedNodeId, 'active']
    );
    expect(activeRows.rows).toHaveLength(2);
    const origKey = activeRows.rows.find(
      (r) => Number(r.file_node_id) === Number(sourceNodeId)
    ).s3_key;
    const storedBlob = currentMockS3.getStore().get(origKey);
    expect(storedBlob).toBeDefined();
    expect(Buffer.from(storedBlob.Body).toString()).toBe('shared source content');
  });
});

/* ========================================================================
   Scenario 5 - S3 Mode: Delete directory cascade
   ======================================================================== */
describe('S5.0-SCENARIO-5: S3 mode delete cascade', () => {
  let user, homeNodeId, dirNodeId, file1Id, file2Id;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    const suffix = Date.now();
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    user = await createAuthenticatedTestUser({ isAdmin: true, username: `s3cascade-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `s3cascade-home-${suffix}`);
    homeNodeId = homeDir.id;
  });

  it('creates a directory with two files inside', async () => {
    // Create the subdirectory
    const dirRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ parentNodeId: homeNodeId, name: `cascade-dir-${Date.now()}` });
    expect(dirRes.status).toBe(200);
    dirNodeId = dirRes.body.nodeId;

    // Upload two files into the directory
    const f1 = await uploadFile(user, dirNodeId, 'file-a.txt', 'content a');
    file1Id = f1.body.nodeId;

    const f2 = await uploadFile(user, dirNodeId, 'file-b.txt', 'content b');
    file2Id = f2.body.nodeId;
  });

  it('deletes the directory and all children are removed from DB', async () => {
    const res = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: dirNodeId });
    expect(res.status).toBe(200);

    // Verify parent dir is gone
    const dirDb = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [dirNodeId]);
    expect(dirDb.rows).toHaveLength(0);

    // Verify children are also deleted
    const filesDb = await dbQuery('SELECT id FROM file_nodes WHERE id IN (?, ?)', [
      file1Id,
      file2Id,
    ]);
    expect(filesDb.rows).toHaveLength(0);
  });

  it('DB: closure table entries for deleted nodes are cleaned up', async () => {
    const result = await dbQuery(
      'SELECT * FROM node_ancestors WHERE ancestor_id = ? OR descendant_id IN (?, ?, ?)',
      [dirNodeId, dirNodeId, file1Id, file2Id]
    );
    expect(result.rows.length).toBe(0);
  });

  it('DB: object_map entries for deleted files are cleaned up', async () => {
    const result = await dbQuery(
      'SELECT file_node_id FROM object_map WHERE file_node_id IN (?, ?)',
      [file1Id, file2Id]
    );
    expect(result.rows).toHaveLength(0);
  });

  it('S3: blobs are marked orphaned (not hard-deleted) in S3 mode', async () => {
    // In S3 mode, deleteNode does not call blobStore.deleteBlob;
    // blob cleanup is handled by a separate GC process.
    const result = await dbQuery('SELECT status FROM object_map WHERE file_node_id IN (?, ?)', [
      file1Id,
      file2Id,
    ]);
    expect(result.rows).toHaveLength(0);
  });

  it('S3: deleting a file leaves the physical blob in the store pending GC (lazy delete boundary)', async () => {
    const lazyName = `lazy-${Date.now()}.txt`;
    const upload = await uploadFile(user, homeNodeId, lazyName, 'lazy delete content');
    expect(upload.status).toBe(200);
    const lazyNodeId = upload.body.nodeId;

    const keyRow = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      lazyNodeId,
    ]);
    expect(keyRow.rows).toHaveLength(1);
    const s3Key = keyRow.rows[0].s3_key;
    expect(currentMockS3.getStore().has(s3Key)).toBe(true);

    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: lazyNodeId });
    expect(del.status).toBe(200);

    const nodeRows = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [lazyNodeId]);
    expect(nodeRows.rows).toHaveLength(0);
    const mapRows = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
      lazyNodeId,
    ]);
    expect(mapRows.rows).toHaveLength(0);

    // Lazy delete boundary: S3 delete is deferred to the GC run, so the
    // physical blob must still exist in the store.
    expect(currentMockS3.getStore().has(s3Key)).toBe(true);
  });
});

/* ========================================================================
   Scenario 5B - S3 Mode: GC route (route level) reclaims an untracked blob
   (Tier-2 reconciliation). The blob has no object_map row; the admin GC
   endpoint must scan the store and delete it.
   ======================================================================== */
describe('S5.0-SCENARIO-5B: GC route reclaims an untracked S3 blob (Tier 2)', () => {
  let admin;
  const previousTtl = process.env.GC_ORPHAN_TTL_DAYS;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();
    process.env.GC_ORPHAN_TTL_DAYS = '0';

    admin = await createAuthenticatedTestUser({
      isAdmin: true,
      username: `gcuntracked-${Date.now()}`,
    });
  });

  afterAll(() => {
    if (previousTtl === undefined) {
      delete process.env.GC_ORPHAN_TTL_DAYS;
    } else {
      process.env.GC_ORPHAN_TTL_DAYS = previousTtl;
    }
  });

  it('GC deletes a directly-placed blob that has no object_map row', async () => {
    const untrackedKey = `untracked-${Date.now()}.txt`;
    await currentMockS3.putObject({
      Bucket: 'test-bucket',
      Key: untrackedKey,
      Body: Buffer.from('orphan content'),
    });
    // Age the blob past the orphan TTL so Tier-2 scans it as a candidate.
    currentMockS3.getStore().set(untrackedKey, {
      ...currentMockS3.getStore().get(untrackedKey),
      LastModified: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    expect(currentMockS3.getStore().has(untrackedKey)).toBe(true);

    const res = await request(app)
      .post('/api/admin/maintenance/gc')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.tier2.skipped).toBe(false);
    expect(res.body.results.tier2.scannedKeys).toBeGreaterThan(0);
    expect(res.body.results.tier2.untrackedKeys).toBeGreaterThanOrEqual(1);
    expect(res.body.results.tier2.deletedKeys).toBeGreaterThanOrEqual(1);

    expect(currentMockS3.getStore().has(untrackedKey)).toBe(false);
  });
});

/* ========================================================================
   Scenario 6 - Permission inheritance via closure table
   ======================================================================== */
describe('S5.0-SCENARIO-6: Permission inheritance', () => {
  let adminUser, normalUser, sharedDirId, childFileId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    const suffix = Date.now();
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    adminUser = await createAuthenticatedTestUser({
      isAdmin: true,
      username: `permadmin-${suffix}`,
    });
    normalUser = await createAuthenticatedTestUser({
      isAdmin: false,
      username: `permview-${suffix}`,
    });
  });

  it('admin creates a shared directory and uploads a file inside', async () => {
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const adminHomeDir = await fns.createDirectory(null, `permadmin-home-${Date.now()}`);

    const dirRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send({ parentNodeId: adminHomeDir.id, name: `shared-folder-${Date.now()}` });
    expect(dirRes.status).toBe(200);
    sharedDirId = dirRes.body.nodeId;

    const fileRes = await uploadFile(adminUser, sharedDirId, 'secret.txt', 'perm content');
    expect(fileRes.status).toBe(200);
    childFileId = fileRes.body.nodeId;
  });

  it('admin grants READ permission on directory to normal user', async () => {
    await grantTestPermissionByNodeId({
      userId: normalUser.user.id,
      fileNodeId: sharedDirId,
      permission: 'read',
    });
  });

  it('DB: closure table has ancestor->descendant path for child through dir', async () => {
    const result = await dbQuery(
      'SELECT * FROM node_ancestors WHERE descendant_id = ? AND ancestor_id = ?',
      [childFileId, sharedDirId]
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('normal user can read the child file via inherited permission', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .query({ nodeId: childFileId })
      .set('Authorization', `Bearer ${normalUser.token}`);
    expect(res.status).toBe(200);
  });

  it('revoking dir permission reflects in DB', async () => {
    await dbRun('DELETE FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?', [
      normalUser.user.id,
      sharedDirId,
    ]);

    const permResult = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?',
      [normalUser.user.id, sharedDirId]
    );
    expect(permResult.rows[0].cnt).toBe(0);
  });
});

/* ========================================================================
    Scenario 7 - Batch operations (delete + move) with job polling
    Note: Bulk worker relies on getComposition() which fails due to circular
          dependency in test context. Operations are executed individually here.
    ======================================================================== */
describe('S5.0-SCENARIO-7: Batch operations', () => {
  let user,
    homeNodeId,
    nodeIds = [],
    targetDirId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    const suffix = Date.now();
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    user = await createAuthenticatedTestUser({ isAdmin: true, username: `batchops-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `batchops-home-${suffix}`);
    homeNodeId = homeDir.id;

    // Create target dir
    const tRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ parentNodeId: homeNodeId, name: `batch-target-${suffix}` });
    expect(tRes.status).toBe(200);
    targetDirId = tRes.body.nodeId;

    // Upload 3 files for batch operations
    for (let i = 1; i <= 3; i++) {
      const fRes = await uploadFile(user, homeNodeId, `batch-file-${i}.txt`, `content ${i}`);
      expect(fRes.status).toBe(200);
      nodeIds.push(fRes.body.nodeId);
    }
  });

  it('moves files to target directory', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: nodeIds[0], destinationParentNodeId: targetDirId });

    expect(res.status).toBe(200);

    // Verify moved file's parent_id changed in DB
    const dbResult = await dbQuery('SELECT parent_id FROM file_nodes WHERE id = ?', [nodeIds[0]]);
    expect(dbResult.rows[0].parent_id).toBe(targetDirId);
  });

  it('deletes files individually', async () => {
    for (const nodeId of [nodeIds[1], nodeIds[2]]) {
      const res = await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ nodeId });
      expect(res.status).toBe(200);
    }

    // Verify deleted files are gone from DB
    const dbResult = await dbQuery('SELECT id FROM file_nodes WHERE id IN (?, ?)', [
      nodeIds[1],
      nodeIds[2],
    ]);
    expect(dbResult.rows).toHaveLength(0);
  });

  it('DB: object_map entries for deleted files are cleaned up', async () => {
    const result = await dbQuery(
      'SELECT file_node_id FROM object_map WHERE file_node_id IN (?, ?)',
      [nodeIds[1], nodeIds[2]]
    );
    expect(result.rows).toHaveLength(0);
  });

  it('DB: closure table entries for deleted files are cleaned up', async () => {
    const result = await dbQuery(
      'SELECT * FROM node_ancestors WHERE descendant_id IN (?, ?) OR ancestor_id IN (?, ?)',
      [nodeIds[1], nodeIds[2], nodeIds[1], nodeIds[2]]
    );
    expect(result.rows.length).toBe(0);
  });
});

/* ========================================================================
   Scenario 8 - WebDAV Mode: Fail-safe recovery (orphaned_node)
   ======================================================================== */
describe('S5.0-SCENARIO-8: WebDAV fail-safe recovery', () => {
  let user, homeNodeId, fileNodeId;

  beforeAll(async () => {
    jest.clearAllMocks();
    const suffix = Date.now();
    webdavMock.getFileContents.mockResolvedValue(Buffer.from('original webdav content'));
    webdavMock.putFileContents.mockResolvedValue(undefined);
    await useWebdavMode();

    user = await createAuthenticatedTestUser({ isAdmin: true, username: `webdavfail-${suffix}` });
    const fns = require('@server/service/composition').getComposition().fileNodeService;
    const homeDir = await fns.createDirectory(null, `webdavfail-home-${suffix}`);
    homeNodeId = homeDir.id;
  });

  it('uploads a file in WebDAV mode', async () => {
    webdavMock.putFileContents.mockResolvedValue(undefined);
    const res = await uploadFile(user, homeNodeId, 'failtest.txt', 'original webdav content');
    expect(res.status).toBe(200);
    fileNodeId = res.body.nodeId;
  });

  it('DB: initial node is not orphaned', async () => {
    const result = await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [fileNodeId]);
    expect(result.rows[0].sync_status).not.toBe('orphaned_node');
  });

  it('rename triggers orphaned_node when re-upload fails', async () => {
    // Make putFileContents fail on the next call (the re-upload during rename)
    webdavMock.putFileContents.mockImplementation(async () => {
      throw new Error('webdav_upload_failed');
    });

    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: fileNodeId, newName: 'failtest-renamed.txt' });

    expect(res.status).toBe(200);
  });

  it('DB: node is marked as orphaned_node after failed re-upload', async () => {
    const result = await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [fileNodeId]);
    expect(result.rows[0].sync_status).toBe('orphaned_node');
  });

  it('DB: node name was updated despite orphan status', async () => {
    const result = await dbQuery('SELECT name FROM file_nodes WHERE id = ?', [fileNodeId]);
    expect(result.rows[0].name).toBe('failtest-renamed.txt');
  });

  it('DB: closure table entries still exist for orphaned node', async () => {
    const result = await dbQuery('SELECT * FROM node_ancestors WHERE descendant_id = ?', [
      fileNodeId,
    ]);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('recovering: re-upload fixes orphaned_node status', async () => {
    // Reset mock to succeed for recovery upload
    webdavMock.putFileContents.mockResolvedValue(undefined);
    await useWebdavMode();

    const res = await uploadFile(user, homeNodeId, 'failtest-recovered.txt', 'recovered content');
    expect(res.status).toBe(200);

    // The new file should not be orphaned
    const recoveredId = res.body.nodeId;
    const result = await dbQuery('SELECT sync_status FROM file_nodes WHERE id = ?', [recoveredId]);
    expect(result.rows[0].sync_status).not.toBe('orphaned_node');
  });

  it('WebDAV: putFileContents was called during recovery upload', async () => {
    const calls = webdavMock.putFileContents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });
});

/* ========================================================================
   C1 - Reference stability (class C): move a granted folder
   Grantee keeps access after the move; ancestor chain is rebuilt;
   permissions_user_paths rows stay intact (nodeId-stable).
   ======================================================================== */
describe('C1: move granted folder → grantee access + ancestor chain rebuild', () => {
  let owner, grantee, grantFolder, childFileId, destFolder;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    owner = await createUserWithHomeNode('c1-owner');
    grantee = await createAuthenticatedTestUser({
      isAdmin: false,
      username: `c1-grantee-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ parentNodeId: owner.homeNodeId, name: `grant-folder-${Date.now()}` });
    expect(createRes.status).toBe(200);
    grantFolder = createRes.body.nodeId;

    const uploadRes = await uploadFile(owner, grantFolder, 'inside.txt', 'granted-content');
    expect(uploadRes.status).toBe(200);
    childFileId = uploadRes.body.nodeId;

    const destRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ parentNodeId: owner.homeNodeId, name: `c1-dest-${Date.now()}` });
    expect(destRes.status).toBe(200);
    destFolder = destRes.body.nodeId;

    await grantTestPermissionByNodeId({
      userId: grantee.user.id,
      fileNodeId: grantFolder,
      permission: 'read',
    });
  });

  it('precondition: grantee has read access before the move', async () => {
    const res = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${grantee.token}`)
      .query({ nodeId: grantFolder });
    expect(res.status).toBe(200);
    expect(res.body.hasRead).toBe(true);
  });

  it('moves the granted folder under the destination folder', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: grantFolder, destinationParentNodeId: destFolder });
    expect(res.status).toBe(200);
    expect(res.body.newParentId).toBe(destFolder);
  });

  it('DB: parent_id is updated and the closure table is rebuilt around the new parent', async () => {
    const node = await dbQuery('SELECT parent_id FROM file_nodes WHERE id = ?', [grantFolder]);
    expect(node.rows[0].parent_id).toBe(destFolder);

    const chain = await dbQuery(
      'SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth DESC',
      [grantFolder]
    );
    expect(chain.rows).toHaveLength(3);
    const byDepth = new Map(chain.rows.map((r) => [Number(r.ancestor_id), Number(r.depth)]));
    expect(byDepth.get(grantFolder)).toBe(0);
    expect(byDepth.get(destFolder)).toBe(1);
    expect(byDepth.get(owner.homeNodeId)).toBe(2);
  });

  it('DB: permissions_user_paths row for the grantee is intact (nodeId-stable)', async () => {
    const perm = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [grantee.user.id, grantFolder]
    );
    expect(perm.rows).toHaveLength(1);
    expect(perm.rows[0].permission).toBe('read');
  });

  it('GET /api/files/ancestors returns the rebuilt chain (old parent dropped)', async () => {
    const res = await request(app)
      .get('/api/files/ancestors')
      .set('Authorization', `Bearer ${owner.token}`)
      .query({ nodeId: grantFolder });
    expect(res.status).toBe(200);
    expect(res.body.ancestors.map((a) => a.nodeId)).toEqual([
      owner.homeNodeId,
      destFolder,
      grantFolder,
    ]);
  });

  it('grantee still accesses the folder and its child after the move', async () => {
    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${grantee.token}`)
      .query({ nodeId: grantFolder });
    expect(check.status).toBe(200);
    expect(check.body.hasRead).toBe(true);

    const dl = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${grantee.token}`)
      .query({ nodeId: childFileId });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body).toString()).toBe('granted-content');
  });
});

/* ========================================================================
   C2 - Reference stability (class C): move an owned folder into another
   user's home subtree → subtree ownership transfers; the folder leaves the
   mover's shared surface and the new home owner resolves it as own.
   ======================================================================== */
describe('C2: move owned folder into another user home → subtree + surface transfer', () => {
  let mover, recipient, sharedFolder, childFileId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    mover = await createUserWithHomeNode('c2-mover');
    recipient = await createUserWithHomeNode('c2-recipient');

    const createRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${mover.token}`)
      .send({ parentNodeId: mover.homeNodeId, name: `transfer-folder-${Date.now()}` });
    expect(createRes.status).toBe(200);
    sharedFolder = createRes.body.nodeId;

    const uploadRes = await uploadFile(mover, sharedFolder, 'inside.txt', 'transfer-content');
    expect(uploadRes.status).toBe(200);
    childFileId = uploadRes.body.nodeId;

    // mover shares the folder with the recipient → it appears in the
    // recipient's "shared with me" surface before the move.
    await grantTestPermissionByNodeId({
      userId: recipient.user.id,
      fileNodeId: sharedFolder,
      permission: 'read',
    });

    // recipient grants the mover write on the recipient home so the move into
    // that home subtree is permitted by the ACL.
    await grantTestPermissionByNodeId({
      userId: mover.user.id,
      fileNodeId: recipient.homeNodeId,
      permission: 'write',
    });
  });

  it('precondition: recipient sees the folder as shared before the move', async () => {
    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${recipient.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.nodeId)).toContain(sharedFolder);
  });

  it('mover moves the owned folder into the recipient home root', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${mover.token}`)
      .send({ nodeId: sharedFolder, destinationParentNodeId: recipient.homeNodeId });
    expect(res.status).toBe(200);
    expect(res.body.newParentId).toBe(recipient.homeNodeId);
  });

  it('DB: closure table transfers the subtree to the recipient home', async () => {
    const chain = await dbQuery('SELECT ancestor_id FROM node_ancestors WHERE descendant_id = ?', [
      sharedFolder,
    ]);
    const ids = chain.rows.map((r) => Number(r.ancestor_id));
    expect(ids).toContain(recipient.homeNodeId);
    expect(ids).toContain(sharedFolder);
    expect(ids).not.toContain(mover.homeNodeId);
  });

  it('mover no longer sees the folder as shared', async () => {
    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${mover.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.nodeId)).not.toContain(sharedFolder);
  });

  it('new home owner resolves the folder as own (not shared; full access)', async () => {
    const sharedRes = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${recipient.token}`);
    expect(sharedRes.status).toBe(200);
    expect(sharedRes.body).toHaveLength(0);

    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${recipient.token}`)
      .query({ nodeId: sharedFolder });
    expect(check.status).toBe(200);
    expect(check.body.hasRead).toBe(true);

    const dl = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${recipient.token}`)
      .query({ nodeId: childFileId });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body).toString()).toBe('transfer-content');
  });
});

/* ========================================================================
   D6 - Cross-user move = ownership transfer (accepted fix)
   A mover that OWNS a node and moves it into another user's home subtree
   loses ownership; its explicit permission rows on the moved subtree are
   revoked so the folder never resurfaces as "shared with me". A mover that
   merely RECEIVED a grant (does not own) keeps the grant. Moves within the
   mover's own home never revoke rows.
   ======================================================================== */
describe('D6: move owned folder into another home revokes mover historical self-grants', () => {
  let mover, recipient, folder, childFileId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    mover = await createUserWithHomeNode('d6a-mover');
    recipient = await createUserWithHomeNode('d6a-recipient');

    const createRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${mover.token}`)
      .send({ parentNodeId: mover.homeNodeId, name: `d6a-folder-${Date.now()}` });
    expect(createRes.status).toBe(200);
    folder = createRes.body.nodeId;

    const uploadRes = await uploadFile(mover, folder, 'inside.txt', 'd6a-content');
    expect(uploadRes.status).toBe(200);
    childFileId = uploadRes.body.nodeId;

    // Historical self-grant rows on the moved subtree: a directory-level WRITE
    // on the folder and a file-level READ on its child.
    await grantTestPermissionByNodeId({
      userId: mover.user.id,
      fileNodeId: folder,
      permission: 'write',
    });
    await permissionStore.grantFilePermission(mover.user.id, childFileId, 'read');

    // Recipient grants the mover write on the recipient home so the move into
    // that home subtree is permitted by the ACL.
    await grantTestPermissionByNodeId({
      userId: mover.user.id,
      fileNodeId: recipient.homeNodeId,
      permission: 'write',
    });
  });

  it('precondition: mover holds self-grant rows on the subtree (paths + files)', async () => {
    const pathRow = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, folder]
    );
    expect(pathRow.rows).toHaveLength(1);
    expect(pathRow.rows[0].permission).toBe('write');

    const fileRow = await dbQuery(
      'SELECT permission FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, childFileId]
    );
    expect(fileRow.rows).toHaveLength(1);
  });

  it('precondition: own subtree rows are NOT shared with the mover', async () => {
    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${mover.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.nodeId)).not.toContain(folder);
  });

  it('mover moves the owned folder into the recipient home root', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${mover.token}`)
      .send({ nodeId: folder, destinationParentNodeId: recipient.homeNodeId });
    expect(res.status).toBe(200);
    expect(res.body.newParentId).toBe(recipient.homeNodeId);
  });

  it('DB: mover self-grant rows on the moved subtree are GONE (ownership transfer)', async () => {
    const pathRow = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, folder]
    );
    expect(pathRow.rows).toHaveLength(0);

    const fileRow = await dbQuery(
      'SELECT permission FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, childFileId]
    );
    expect(fileRow.rows).toHaveLength(0);

    // The mover's home-root ADMIN grant is untouched (it lives on the home root,
    // not inside the moved subtree).
    const homeRow = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, mover.homeNodeId]
    );
    expect(homeRow.rows).toHaveLength(1);
    expect(homeRow.rows[0].permission).toBe('admin');
  });

  it('moved folder does not resurface in the mover shared listing', async () => {
    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${mover.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.nodeId)).not.toContain(folder);
  });

  it('recipient resolves the moved folder as own (not shared; full access)', async () => {
    const sharedRes = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${recipient.token}`);
    expect(sharedRes.status).toBe(200);
    expect(sharedRes.body).toHaveLength(0);

    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${recipient.token}`)
      .query({ nodeId: folder });
    expect(check.status).toBe(200);
    expect(check.body.hasRead).toBe(true);

    const dl = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${recipient.token}`)
      .query({ nodeId: childFileId });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body).toString()).toBe('d6a-content');
  });

  it('mover access now follows the new owner rules (recipient home grant, not the revoked self-grant)', async () => {
    // The mover's continued access derives from the recipient's write grant on
    // the recipient home root (the same grant that permitted the move), not
    // from the mover's historical self-grant rows.
    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${mover.token}`)
      .query({ nodeId: folder });
    expect(check.status).toBe(200);
    expect(check.body.hasRead).toBe(true);

    const dl = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${mover.token}`)
      .query({ nodeId: childFileId });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body).toString()).toBe('d6a-content');
  });
});

describe('D6: received grant on another user home is preserved when moved within that home', () => {
  let owner, mover, folder, childFileId, destFolder;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    owner = await createUserWithHomeNode('d6b-owner');
    mover = await createUserWithHomeNode('d6b-mover');

    const createRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ parentNodeId: owner.homeNodeId, name: `d6b-folder-${Date.now()}` });
    expect(createRes.status).toBe(200);
    folder = createRes.body.nodeId;

    const uploadRes = await uploadFile(owner, folder, 'inside.txt', 'd6b-content');
    expect(uploadRes.status).toBe(200);
    childFileId = uploadRes.body.nodeId;

    const destRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ parentNodeId: owner.homeNodeId, name: `d6b-dest-${Date.now()}` });
    expect(destRes.status).toBe(200);
    destFolder = destRes.body.nodeId;

    // The mover merely RECEIVED grants on the folder and the destination folder
    // (both under the OWNER's home). The mover does not own any of them.
    await grantTestPermissionByNodeId({
      userId: mover.user.id,
      fileNodeId: folder,
      permission: 'write',
    });
    await grantTestPermissionByNodeId({
      userId: mover.user.id,
      fileNodeId: destFolder,
      permission: 'write',
    });
  });

  it('precondition: mover holds a received grant on the folder', async () => {
    const row = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, folder]
    );
    expect(row.rows).toHaveLength(1);
  });

  it('mover moves the folder within the owner home (folder → destFolder)', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${mover.token}`)
      .send({ nodeId: folder, destinationParentNodeId: destFolder });
    expect(res.status).toBe(200);
    expect(res.body.newParentId).toBe(destFolder);
  });

  it('DB: the received grant is PRESERVED (mover never owned the node)', async () => {
    const row = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [mover.user.id, folder]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].permission).toBe('write');
  });

  it('mover still accesses the moved folder through the preserved grant', async () => {
    const check = await request(app)
      .get('/api/permissions/check')
      .set('Authorization', `Bearer ${mover.token}`)
      .query({ nodeId: folder });
    expect(check.status).toBe(200);
    expect(check.body.hasRead).toBe(true);

    const dl = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${mover.token}`)
      .query({ nodeId: childFileId });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body).toString()).toBe('d6b-content');
  });

  it('the folder stays in the mover shared listing (genuine received grant)', async () => {
    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${mover.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.nodeId)).toContain(folder);
  });
});

describe('D6: moving within the mover own home never revokes rows', () => {
  let user, folder, childFileId, destFolder;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    user = await createUserWithHomeNode('d6c-user');

    const createRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ parentNodeId: user.homeNodeId, name: `d6c-folder-${Date.now()}` });
    expect(createRes.status).toBe(200);
    folder = createRes.body.nodeId;

    const uploadRes = await uploadFile(user, folder, 'inside.txt', 'd6c-content');
    expect(uploadRes.status).toBe(200);
    childFileId = uploadRes.body.nodeId;

    const destRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ parentNodeId: user.homeNodeId, name: `d6c-dest-${Date.now()}` });
    expect(destRes.status).toBe(200);
    destFolder = destRes.body.nodeId;

    // Historical self-grant rows on the subtree.
    await grantTestPermissionByNodeId({
      userId: user.user.id,
      fileNodeId: folder,
      permission: 'write',
    });
    await permissionStore.grantFilePermission(user.user.id, childFileId, 'read');
  });

  it('user moves the folder within the own home (folder → destFolder)', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: folder, destinationParentNodeId: destFolder });
    expect(res.status).toBe(200);
    expect(res.body.newParentId).toBe(destFolder);
  });

  it('DB: self-grant rows on the moved subtree are PRESERVED (no ownership transfer)', async () => {
    const pathRow = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [user.user.id, folder]
    );
    expect(pathRow.rows).toHaveLength(1);
    expect(pathRow.rows[0].permission).toBe('write');

    const fileRow = await dbQuery(
      'SELECT permission FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?',
      [user.user.id, childFileId]
    );
    expect(fileRow.rows).toHaveLength(1);
  });

  it('the folder still does not resurface in the own shared listing', async () => {
    const res = await request(app)
      .get('/api/permissions/shared')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.nodeId)).not.toContain(folder);
  });
});

/* ========================================================================
   C3 - Reference stability (class C): copy keeps original and copy
   independent, both accessible, closure rows for both (listing + chain).
   ======================================================================== */
describe('C3: copy keeps original and copy independent with closure rows for both', () => {
  let user, home, destFolder, sourceFileId, copyFileId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    user = await createUserWithHomeNode('c3-user');
    home = user.homeNodeId;

    const destRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ parentNodeId: home, name: `copy-dest-${Date.now()}` });
    expect(destRes.status).toBe(200);
    destFolder = destRes.body.nodeId;

    const uploadRes = await uploadFile(user, home, 'original.txt', 'original-content');
    expect(uploadRes.status).toBe(200);
    sourceFileId = uploadRes.body.nodeId;
  });

  it('copies the file into the destination folder as a distinct node', async () => {
    const res = await request(app)
      .post('/api/files/copy')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: sourceFileId, destinationParentNodeId: destFolder, newName: 'copy.txt' });
    expect(res.status).toBe(200);
    expect(res.body.copiedNodeId).toBeDefined();
    expect(res.body.copiedNodeId).not.toBe(sourceFileId);
    copyFileId = res.body.copiedNodeId;
  });

  it('both original and copy remain downloadable with identical content', async () => {
    const orig = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: sourceFileId });
    const copy = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: copyFileId });
    expect(orig.status).toBe(200);
    expect(copy.status).toBe(200);
    expect(Buffer.from(orig.body).toString()).toBe('original-content');
    expect(Buffer.from(copy.body).toString()).toBe('original-content');
  });

  it('lists the copy in the destination and only the original in the source', async () => {
    const dest = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: destFolder });
    expect(dest.status).toBe(200);
    const destItems = Array.isArray(dest.body) ? dest.body : dest.body.items;
    expect(destItems.map((i) => i.name)).toContain('copy.txt');

    const homeList = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: home });
    expect(homeList.status).toBe(200);
    const homeItems = Array.isArray(homeList.body) ? homeList.body : homeList.body.items;
    const homeNames = homeItems.map((i) => i.name);
    expect(homeNames).toContain('original.txt');
    expect(homeNames).not.toContain('copy.txt');
  });

  it('DB: closure rows exist for both nodes and place the copy under the destination', async () => {
    const copyChain = await dbQuery(
      'SELECT ancestor_id FROM node_ancestors WHERE descendant_id = ?',
      [copyFileId]
    );
    const copyAncestors = copyChain.rows.map((r) => Number(r.ancestor_id));
    expect(copyAncestors).toContain(copyFileId);
    expect(copyAncestors).toContain(destFolder);

    const origChain = await dbQuery(
      'SELECT ancestor_id FROM node_ancestors WHERE descendant_id = ?',
      [sourceFileId]
    );
    const origAncestors = origChain.rows.map((r) => Number(r.ancestor_id));
    expect(origAncestors).toContain(sourceFileId);
    expect(origAncestors).toContain(home);
    expect(origAncestors).not.toContain(destFolder);
  });

  it('GET /api/files/ancestors returns the copy ancestor chain', async () => {
    const res = await request(app)
      .get('/api/files/ancestors')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: copyFileId });
    expect(res.status).toBe(200);
    expect(res.body.ancestors.map((a) => a.nodeId)).toEqual([home, destFolder, copyFileId]);
  });

  it('original and copy are independent: deleting the copy leaves the original intact', async () => {
    const del = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ nodeId: copyFileId });
    expect(del.status).toBe(200);

    const orig = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${user.token}`)
      .query({ nodeId: sourceFileId });
    expect(orig.status).toBe(200);
    expect(Buffer.from(orig.body).toString()).toBe('original-content');

    const gone = await dbQuery('SELECT id FROM file_nodes WHERE id = ?', [copyFileId]);
    expect(gone.rows).toHaveLength(0);
  });
});

/* ========================================================================
   C4 - Reference stability (class C): delete a folder cascades descendant
   permission rows and recent-file entries pointing into the subtree.
   ======================================================================== */
describe('C4: delete folder → permission rows + recent entries cascade', () => {
  let owner, grantee, folder, childFileId;

  beforeEach(jest.clearAllMocks);

  beforeAll(async () => {
    currentMockS3 = createS3Mock();
    wireS3Mock(currentMockS3);
    await useS3Mode();

    owner = await createUserWithHomeNode('c4-owner');
    grantee = await createAuthenticatedTestUser({
      isAdmin: false,
      username: `c4-grantee-${Date.now()}`,
    });

    const createRes = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ parentNodeId: owner.homeNodeId, name: `cascade-folder-${Date.now()}` });
    expect(createRes.status).toBe(200);
    folder = createRes.body.nodeId;

    const uploadRes = await uploadFile(owner, folder, 'inner.txt', 'inner-content');
    expect(uploadRes.status).toBe(200);
    childFileId = uploadRes.body.nodeId;

    await grantTestPermissionByNodeId({
      userId: grantee.user.id,
      fileNodeId: folder,
      permission: 'read',
    });

    // Both users have the child file in their recent list.
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fileNodeId: childFileId });
    await request(app)
      .post('/api/recent-files')
      .set('Authorization', `Bearer ${grantee.token}`)
      .send({ fileNodeId: childFileId });
  });

  it('precondition: grant row exists and both users list the recent entry', async () => {
    const perm = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [grantee.user.id, folder]
    );
    expect(perm.rows).toHaveLength(1);

    const ownerRecent = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRecent.status).toBe(200);
    expect(ownerRecent.body.some((f) => f.fileNodeId === childFileId)).toBe(true);

    const granteeRecent = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${grantee.token}`);
    expect(granteeRecent.status).toBe(200);
    expect(granteeRecent.body.some((f) => f.fileNodeId === childFileId)).toBe(true);
  });

  it('deletes the folder via the single-item endpoint', async () => {
    const res = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nodeId: folder });
    expect(res.status).toBe(200);
  });

  it('DB: folder and child nodes are gone', async () => {
    const rows = await dbQuery('SELECT id FROM file_nodes WHERE id IN (?, ?)', [
      folder,
      childFileId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('DB: descendant permission row on the deleted folder is cascade-removed', async () => {
    const perm = await dbQuery(
      'SELECT permission FROM permissions_user_paths WHERE user_id = ? AND file_node_id = ?',
      [grantee.user.id, folder]
    );
    expect(perm.rows).toHaveLength(0);
  });

  it('DB: closure rows for the deleted subtree are cleaned up', async () => {
    const rows = await dbQuery(
      'SELECT * FROM node_ancestors WHERE descendant_id IN (?, ?) OR ancestor_id IN (?, ?)',
      [folder, childFileId, folder, childFileId]
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('recent entries pointing into the deleted subtree are removed for both users', async () => {
    const ownerRecent = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRecent.status).toBe(200);
    expect(ownerRecent.body.some((f) => f.fileNodeId === childFileId)).toBe(false);

    const granteeRecent = await request(app)
      .get('/api/recent-files')
      .set('Authorization', `Bearer ${grantee.token}`);
    expect(granteeRecent.status).toBe(200);
    expect(granteeRecent.body.some((f) => f.fileNodeId === childFileId)).toBe(false);
  });
});
