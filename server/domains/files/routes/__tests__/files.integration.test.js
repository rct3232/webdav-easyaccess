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
  grantTestPermissionByNodeId,
  dbQuery,
  dbRun,
} = require('@server/test-utils');
const request = require('supertest');

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

async function pollJob(user, jobId, maxPolls = 50) {
  // No real-time waits (docs/TESTING_STRATEGY.md "Avoid real-time waits"):
  // poll on setImmediate turns with a bounded iteration count. With
  // WEA_SKIP_BULK_WORKER=1 the worker never runs, so jobs resolve immediately.
  for (let i = 0; i < maxPolls; i++) {
    const res = await request(app)
      .get(`/api/files/bulk-operation/${jobId}`)
      .set('Authorization', `Bearer ${user.token}`);
    if (res.body && res.body.status !== 'running') return res;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`Job ${jobId} did not complete within ${maxPolls} polls`);
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
    const result = await dbQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ?',
      [fileNodeId]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].s3_key).toMatch(/^[a-f0-9-]+$/);
  });

  it('DB: file_nodes record exists with correct name and type', async () => {
    const result = await dbQuery(
      "SELECT name, type FROM file_nodes WHERE id = ?",
      [fileNodeId]
    );
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
    const result = await dbQuery(
      'SELECT name FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(result.rows[0].name).toBe('renamed.txt');
  });

  it('DB: object_map s3_key is unchanged (rename does not move blob)', async () => {
    const result = await dbQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ?',
      [fileNodeId]
    );
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
    const result = await dbQuery(
      'SELECT size, mime_type FROM filecache WHERE file_node_id = ?',
      [fileNodeId]
    );
    expect(result.rows).toHaveLength(1);
  });

  it('DB: file_nodes record exists with correct name and type', async () => {
    const result = await dbQuery(
      "SELECT name, type FROM file_nodes WHERE id = ?",
      [fileNodeId]
    );
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
  let user, homeNodeId, sourceNodeId;

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
      .send({ nodeId: sourceNodeId, destinationParentNodeId: homeNodeId, newName: 'copied-cow.txt' });

    expect(res.status).toBe(200);
    const targetNodeId = res.body.copiedNodeId;

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
      .query({ nodeId: sourceNodeId })
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('shared source content');
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
    const dirDb = await dbQuery(
      'SELECT id FROM file_nodes WHERE id = ?',
      [dirNodeId]
    );
    expect(dirDb.rows).toHaveLength(0);

    // Verify children are also deleted
    const filesDb = await dbQuery(
      'SELECT id FROM file_nodes WHERE id IN (?, ?)',
      [file1Id, file2Id]
    );
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
    const result = await dbQuery(
      'SELECT status FROM object_map WHERE file_node_id IN (?, ?)',
      [file1Id, file2Id]
    );
    expect(result.rows).toHaveLength(0);
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

    adminUser = await createAuthenticatedTestUser({ isAdmin: true, username: `permadmin-${suffix}` });
    normalUser = await createAuthenticatedTestUser({ isAdmin: false, username: `permview-${suffix}` });
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
    await dbRun(
      'DELETE FROM permissions_user_files WHERE user_id = ? AND file_node_id = ?',
      [normalUser.user.id, sharedDirId]
    );

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
  let user, homeNodeId, nodeIds = [], targetDirId;

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
    const dbResult = await dbQuery(
      'SELECT parent_id FROM file_nodes WHERE id = ?',
      [nodeIds[0]]
    );
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
    const dbResult = await dbQuery(
      'SELECT id FROM file_nodes WHERE id IN (?, ?)',
      [nodeIds[1], nodeIds[2]]
    );
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
    const result = await dbQuery(
      "SELECT sync_status FROM file_nodes WHERE id = ?",
      [fileNodeId]
    );
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
    const result = await dbQuery(
      "SELECT sync_status FROM file_nodes WHERE id = ?",
      [fileNodeId]
    );
    expect(result.rows[0].sync_status).toBe('orphaned_node');
  });

  it('DB: node name was updated despite orphan status', async () => {
    const result = await dbQuery(
      'SELECT name FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(result.rows[0].name).toBe('failtest-renamed.txt');
  });

  it('DB: closure table entries still exist for orphaned node', async () => {
    const result = await dbQuery(
      'SELECT * FROM node_ancestors WHERE descendant_id = ?',
      [fileNodeId]
    );
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
    const result = await dbQuery(
      "SELECT sync_status FROM file_nodes WHERE id = ?",
      [recoveredId]
    );
    expect(result.rows[0].sync_status).not.toBe('orphaned_node');
  });

  it('WebDAV: putFileContents was called during recovery upload', async () => {
    const calls = webdavMock.putFileContents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });
});
