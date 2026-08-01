# Phase 4 — Wave 5: Integration Tests + Utilities

## Objective

Validate that all Waves 1-4 produced correct, integrated results by exercising full CRUD lifecycle scenarios against a real SQLite-backed database with the complete service layer (fileNodeService, blobStorageService, aclService). Additionally, provide nodeId-based test utility functions so future phases can build integration tests without duplicating setup logic. This wave serves as the Phase 4 completion gate — all scenarios must pass before handoff to Phase 5.

## Prerequisites

- Wave 1 complete (`phase4-sub-plan-wave1.md`): All specs written, test scaffolds in place
- Wave 2 complete (`phase4-sub-plan-wave2.md`): WebdavBlobStore + dual-backend blobStorageService implemented
- Wave 3 complete (`phase4-sub-plan-wave3.md`): Routes accept/return nodeId, operation flows working
- Wave 4 complete (`phase4-sub-plan-wave4.md`): Legacy permission code removed, client migrated to nodeId payloads
- Reference: `server/test-utils.js`, `server/testing/mocks/s3Mock.js`, `server/testing/mocks/webdavMock.js`

## Execution Rules

- **No mocks of service layer**: Integration tests must use real fileNodeService, blobStorageService, and aclService instances. Only external boundaries (S3 client, WebDAV client) are mocked via existing mock factories.
- **Each scenario is isolated**: Every `it()` block creates its own data and cleans up after itself. No cross-test state dependency except shared schema initialization in `beforeAll`.
- **Both storage modes**: Each scenario must verify behavior under S3 mode (using s3Mock) and WebDAV mode (using webdavMock). Scenarios that are inherently single-mode (e.g., copy-on-write is S3-only) still document why.
- **DB state assertions**: Every integration step includes a direct database assertion to verify the internal state matches expectations, not just HTTP response codes.

---

## Task W5.0: Route Integration Tests — Full CRUD Lifecycle

### File: `server/domains/files/__tests__/files.integration.test.js` — CREATE NEW (or REWRITE existing `files.test.js`)

The current `files.test.js` uses WebDAV mocks for all operations with path-based payloads. The new integration test file exercises the full stack through HTTP routes while using real SQLite-backed services. S3 and WebDAV storage boundaries are mocked via existing mock factories.

### Test Infrastructure Setup

```js
/**
 * Integration test setup for files domain.
 * Uses in-memory SQLite, real service layer, mocked external storage.
 */
const request = require('supertest');
const crypto = require('crypto');
const { createTestDatabase, createAuthenticatedTestUser } = require('../../../../test-utils');
const storage = require('../../../../store/storage');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createBlobStorageService } = require('../../../../service/blobStorageService');
const { createS3Mock } = require('../../../../testing/mocks/s3Mock');
const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
const S3BlobStore = require('../../../../infrastructure/adapters/blobstore/S3BlobStore');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const { createComposition, __setCompositionForTests } = require('../../../../service/composition');

// Mock the AWS SDK client so S3BlobStore dispatches to the in-memory s3Mock
// (same pattern as server/infrastructure/adapters/blobstore/__tests__/S3BlobStore.test.js)
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return { ...actual, S3Client: jest.fn() };
});

const S3_TEST_CONFIG = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
};

let app;
let dbCleanup;
let s3Mock;
let webdavMock;
let fileNodeService;
let blobStorageService;

beforeAll(async () => {
  // Force SQLite backend for integration tests
  process.env.WEA_STORAGE_BACKEND = 'sqlite';
  const testDbPath = `/tmp/wea-integ-${crypto.randomUUID()}.db`;
  process.env.WEA_SQLITE_PATH = testDbPath;
  process.env.WEA_SKIP_BULK_WORKER = '1';

  // Initialize metadata store (users, permissions, etc.)
  const { initMetadataStore } = require('../../../../store/bootstrap');
  await initMetadataStore();

  // Initialize file_nodes schema via migration manager or direct DDL
  const { schemaManager } = require('../../../../infrastructure/schemaManager');
  await schemaManager.applyPendingMigrations();

  // Create mock storage backends
  s3Mock = createS3Mock();
  webdavMock = createWebdavMock();

  // Wire the mocked S3Client to s3Mock (set BEFORE constructing S3BlobStore)
  const MockedS3Client = require('@aws-sdk/client-s3').S3Client;
  MockedS3Client.mockImplementation(() => ({
    send: async (command) => {
      const name = command.constructor.name;
      if (name === 'PutObjectCommand') return s3Mock.putObject(command);
      if (name === 'GetObjectCommand') return s3Mock.getObject(command);
      if (name === 'DeleteObjectCommand') return s3Mock.deleteObject(command);
      if (name === 'CopyObjectCommand') return s3Mock.copyObject(command);
      if (name === 'HeadObjectCommand') return s3Mock.headObject(command);
      if (name === 'ListObjectsV2Command') return s3Mock.listObjectsV2(command);
      throw new Error(`Unknown command: ${name}`);
    },
  }));

  // Build the S3-mode composition root and inject it into the routes
  useS3Mode();

  // Load app AFTER all initialization (routes read services from the composition root)
  app = require('../../../../index');
});

afterAll(async () => {
  delete process.env.WEA_STORAGE_BACKEND;
  delete process.env.WEA_SQLITE_PATH;
  delete process.env.WEA_SKIP_BULK_WORKER;

  try {
    storage.closeSqliteDb();
  } catch { /* ignore */ }

  const fs = require('fs');
  if (process.env.WEA_SQLITE_PATH) {
    try {
      await fs.promises.unlink(process.env.WEA_SQLITE_PATH);
    } catch { /* ignore cleanup errors */ }
  }
});

// Helper: rebuild the composition root for a backend mode and inject it into routes.
// Routes read services from the composition root (W3.6), so a mode switch MUST rebuild
// and re-inject the composition — swapping a local variable has no effect.
function buildComposition({ fileStorageMode }) {
  const fileNodesStore = createFileNodesStore();
  fileNodeService = createFileNodeService({ fileNodesStore });

  const blobStore = fileStorageMode === 'webdav'
    ? new WebdavBlobStore(webdavMock)          // wrap the raw webdav mock in the adapter
    : new S3BlobStore(S3_TEST_CONFIG);         // S3Client already mocked to dispatch to s3Mock

  blobStorageService = createBlobStorageService({
    blobStore,
    fileNodesStore,
    fileStorageMode,
    fileNodeService,
  });

  const composition = createComposition({
    fileNodesStore,
    fileStorageMode,
    blobStore,
  });
  __setCompositionForTests(composition);
  return composition;
}

function useWebdavMode() {
  s3Mock.clearStore();
  return buildComposition({ fileStorageMode: 'webdav' });
}

function useS3Mode() {
  s3Mock.clearStore();
  return buildComposition({ fileStorageMode: 's3' });
}
```

### Scenario 1: Upload → List → Download Cycle

#### S3 Mode

**Test file:** `server/domains/files/__tests__/files.integration.test.js`

```js
describe('Scenario 1: Upload → List → Download (S3 mode)', () => {
  let user, token, parentNodeId;

  beforeAll(async () => {
    useS3Mode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-upload-s3-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    // Create root directory for this user via service layer
    const rootDir = await fileNodeService.createDirectory(null, user.username);
    parentNodeId = rootDir.id;
  });

  it('Step A: POST /upload creates file_nodes row + blob in S3', async () => {
    const content = Buffer.from('integration-test-content-scenario1');
    const mimeType = 'text/plain';

    // Upload via HTTP route (nodeId-based payload)
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('parentNodeId', parentNodeId)
      .field('name', 'testfile.txt')
      .field('mimeType', mimeType)
      .attach('file', content, 'testfile.txt');

    // HTTP-level assertion
    expect(res.status).toBe(200);
    expect(res.body.nodeId).toBeDefined();
    const uploadedNodeId = res.body.nodeId;

    // DB state verification: file_nodes row exists with correct data
    const nodeRows = await storage.sqliteQuery(
      'SELECT * FROM file_nodes WHERE id = ?',
      [uploadedNodeId]
    );
    expect(nodeRows.rows.length).toBe(1);
    expect(nodeRows.rows[0].name).toBe('testfile.txt');
    expect(nodeRows.rows[0].type).toBe('file');
    expect(nodeRows.rows[0].parent_id).toBe(parentNodeId);

    // DB state verification: object_map row exists with pending/active status
    const objMapRows = await storage.sqliteQuery(
      'SELECT * FROM object_map WHERE file_node_id = ?',
      [uploadedNodeId]
    );
    expect(objMapRows.rows.length).toBe(1);
    expect(objMapRows.rows[0].status).toBe('active');

    // S3 mock verification: blob was stored
    const s3Store = s3Mock.getStore();
    const s3Key = objMapRows.rows[0].s3_key;
    expect(s3Store.has(s3Key)).toBe(true);
    const s3Obj = s3Store.get(s3Key);
    expect(Buffer.from(s3Obj.Body)).toEqual(content);

    // Store nodeId for subsequent steps
    globalThis._scenario1_nodeId = uploadedNodeId;
  });

  it('Step B: GET /list returns uploaded file with correct nodeId', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: parentNodeId });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);

    const fileItem = items.find(i => i.nodeId === globalThis._scenario1_nodeId);
    expect(fileItem).toBeDefined();
    expect(fileItem.name).toBe('testfile.txt');
    expect(fileItem.type).toBe('file');
  });

  it('Step C: GET /download returns original content buffer', async () => {
    const nodeId = globalThis._scenario1_nodeId;

    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId });

    expect(res.status).toBe(200);

    // Content hash verification: downloaded content matches uploaded content
    const originalContent = Buffer.from('integration-test-content-scenario1');
    const downloadedHash = crypto.createHash('sha256').update(res.body || res.buffer).digest('hex');
    const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');
    expect(downloadedHash).toBe(originalHash);
  });
});
```

#### WebDAV Mode

Same scenario structure, but with these differences:
- Call `useWebdavMode()` in `beforeAll` instead of S3 mode
- After upload, verify `webdavMock.putFileContents` was called with correct path and buffer
- No object_map row created (WebDAV stores blobs directly on remote server; file_nodes tracks metadata only)
- For download, verify `webdavMock.getFileContents` is called with reconstructed WebDAV path

```js
describe('Scenario 1: Upload → List → Download (WebDAV mode)', () => {
  // Same structure as S3 mode but assertions target webdavMock call history
  // and skip object_map verification (WebDAV has no local blob tracking)
});
```

### Scenario 2: Rename (DB-Only Operation)

**Key insight:** Rename is a DB-only metadata update. The closure table (`node_ancestors`) must remain unchanged because the node's position in the tree does not change — only its `name` field updates.

#### S3 Mode

```js
describe('Scenario 2: Rename (S3 mode)', () => {
  let user, token, parentNodeId, fileNodeId;

  beforeAll(async () => {
    useS3Mode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-rename-s3-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    const rootDir = await fileNodeService.createDirectory(null, user.username);
    parentNodeId = rootDir.id;

    // Create a test file
    const fileNode = await fileNodeService.createFile(parentNodeId, 'original-name.txt');
    fileNodeId = fileNode.id;

    // Set up object_map entry for the file (simulating completed upload)
    const s3Key = crypto.randomUUID();
    await storage.sqliteRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 1, 'active')`,
      [fileNodeId, s3Key]
    );

    // Store blob in S3 mock
    s3Mock.putObject({ input: { Bucket: 'test-bucket', Key: s3Key, Body: Buffer.from('rename-test-content'), ContentType: 'text/plain' }});
  });

  it('Step A: PUT /rename updates file_nodes.name, closure table unchanged', async () => {
    const newName = 'renamed-file.txt';

    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: fileNodeId, newName });

    expect(res.status).toBe(200);

    // DB verification: name updated in file_nodes
    const node = await storage.sqliteQuery(
      'SELECT * FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(node.rows[0].name).toBe(newName);

    // Closure table verification: ancestors unchanged (same parent, same depth)
    const ancestors = await storage.sqliteQuery(
      'SELECT ancestor_id, descendant_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
      [fileNodeId]
    );
    expect(ancestors.rows.length).toBeGreaterThanOrEqual(1);
    // Self-reference at depth 0 must still exist
    const selfRef = ancestors.rows.find(r => r.ancestor_id === fileNodeId && r.depth === 0);
    expect(selfRef).toBeDefined();

    // S3 verification: blob key unchanged (no copy operation for rename in S3 mode)
    const objMap = await storage.sqliteQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
      [fileNodeId, 'active']
    );
    expect(objMap.rows.length).toBe(1);
    // s3_key is the same UUID as before — no new blob created
  });

  it('Step B: GET /list shows renamed file at same location', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: parentNodeId });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    const renamedItem = items.find(i => i.nodeId === fileNodeId);
    expect(renamedItem.name).toBe('renamed-file.txt');
  });
});
```

#### WebDAV Mode

For WebDAV mode, rename triggers a best-effort storage-side MOVE:
- `webdavMock.moveFile` is called with source and destination paths
- On success: `sync_status` remains `'active'`
- On failure: `sync_status` set to `'orphaned_node'`, node still listed but flagged

```js
describe('Scenario 2: Rename (WebDAV mode)', () => {
  it('DB rename + WebDAV MOVE success keeps sync_status=active', async () => {
    useWebdavMode();
    // webdavMock.moveFile resolves normally
    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: fileNodeId, newName: 'webdav-renamed.txt' });

    expect(res.status).toBe(200);

    // Verify sync_status is still active (or null/absent for WebDAV nodes that don't track it)
    const node = await storage.sqliteQuery(
      'SELECT sync_status FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(node.rows[0].sync_status).not.toBe('orphaned_node');
  });

  it('WebDAV MOVE failure sets sync_status=orphaned_node', async () => {
    // Override moveFile to throw for this test
    webdavMock.moveFile.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: fileNodeId, newName: 'will-orphan.txt' });

    // Even on storage failure, DB rename succeeds (fail-safe semantics)
    expect(res.status).toBe(200);

    const node = await storage.sqliteQuery(
      'SELECT sync_status FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(node.rows[0].sync_status).toBe('orphaned_node');
  });
});
```

### Scenario 3: Move Across Folders

Move operations update `parent_id` in `file_nodes` AND rebuild the closure table for all descendants. This is a critical test because incorrect closure table updates break permission inheritance and path resolution.

```js
describe('Scenario 3: Move file across folders', () => {
  let user, token;
  let folderA_NodeId, folderB_NodeId, fileNodeId;

  beforeAll(async () => {
    useS3Mode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-move-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    // Create source folder A and destination folder B at root level
    const folderA = await fileNodeService.createDirectory(null, 'FolderA');
    folderA_NodeId = folderA.id;

    const folderB = await fileNodeService.createDirectory(null, 'FolderB');
    folderB_NodeId = folderB.id;

    // Upload a file into Folder A
    const fileInA = await fileNodeService.createFile(folderA_NodeId, 'move-me.txt');
    fileNodeId = fileInA.id;

    // Set up object_map for the file
    const s3Key = crypto.randomUUID();
    await storage.sqliteRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 1, 'active')`,
      [fileNodeId, s3Key]
    );
    s3Mock.putObject({ input: { Bucket: 'test-bucket', Key: s3Key, Body: Buffer.from('move-content'), ContentType: 'text/plain' }});
  });

  it('Step A: Verify initial state — file under FolderA in closure table', async () => {
    const ancestors = await storage.sqliteQuery(
      'SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
      [fileNodeId]
    );

    // Expected chain: self (depth=0), FolderA (depth=1)
    expect(ancestors.rows.length).toBeGreaterThanOrEqual(2);
    const folderARow = ancestors.rows.find(r => r.ancestor_id === folderA_NodeId);
    expect(folderARow).toBeDefined();
    expect(folderARow.depth).toBe(1);

    // FolderB must NOT be an ancestor
    const folderBR = ancestors.rows.find(r => r.ancestor_id === folderB_NodeId);
    expect(folderBR).toBeUndefined();
  });

  it('Step B: Move file from A to B via nodeId', async () => {
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: fileNodeId, destinationParentNodeId: folderB_NodeId });

    expect(res.status).toBe(200);

    // DB verification: parent_id updated to Folder B
    const node = await storage.sqliteQuery(
      'SELECT parent_id FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(node.rows[0].parent_id).toBe(folderB_NodeId);

    // Closure table verification: ancestors rebuilt for new position
    const newAncestors = await storage.sqliteQuery(
      'SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
      [fileNodeId]
    );

    // FolderB must now be an ancestor at depth=1
    const folderBR = newAncestors.rows.find(r => r.ancestor_id === folderB_NodeId);
    expect(folderBR).toBeDefined();
    expect(folderBR.depth).toBe(1);

    // FolderA must no longer be an ancestor
    const folderAR = newAncestors.rows.find(r => r.ancestor_id === folderA_NodeId);
    expect(folderAR).toBeUndefined();
  });

  it('Step C: Old path no longer resolves', async () => {
    // List Folder A — file should NOT appear
    const listA = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: folderA_NodeId });

    expect(listA.status).toBe(200);
    const itemsA = listA.body.items || listA.body;
    const stillInA = itemsA.find(i => i.nodeId === fileNodeId);
    expect(stillInA).toBeUndefined();

    // List Folder B — file SHOULD appear
    const listB = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: folderB_NodeId });

    expect(listB.status).toBe(200);
    const itemsB = listB.body.items || listB.body;
    const nowInB = itemsB.find(i => i.nodeId === fileNodeId);
    expect(nowInB).toBeDefined();
    expect(nowInB.name).toBe('move-me.txt');
  });

  it('Step D: Move entire folder with children — all descendants update', async () => {
    // Create subfolder inside A, then move A itself under B
    const subFolderOfA = await fileNodeService.createDirectory(folderA_NodeId, 'sub-of-A');
    const subFileNodeId = (await fileNodeService.createFile(subFolderOfA.id, 'deep-file.txt')).id;

    // Move Folder A into Folder B
    const res = await request(app)
      .post('/api/files/move')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: folderA_NodeId, destinationParentNodeId: folderB_NodeId });

    expect(res.status).toBe(200);

    // Verify deep-file's closure table now includes Folder B as ancestor
    const deepAncestors = await storage.sqliteQuery(
      'SELECT ancestor_id FROM node_ancestors WHERE descendant_id = ?',
      [subFileNodeId]
    );
    const ancestorIds = deepAncestors.rows.map(r => r.ancestor_id);
    expect(ancestorIds).toContain(folderB_NodeId);
  });
});
```

### Scenario 4: Copy-on-Write (S3 Mode Only)

Copy-on-write is an S3-specific optimization. In WebDAV mode, copy operations download and re-upload the blob (no shared reference semantics). This scenario verifies zero-storage-waste for copies and mutation independence after overwrite.

```js
describe('Scenario 4: Copy-on-Write (S3 only)', () => {
  let user, token, parentNodeId;
  let file1NodeId, file1_S3Key;
  let file2NodeId, file2_S3Key;

  beforeAll(async () => {
    useS3Mode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-cow-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    const rootDir = await fileNodeService.createDirectory(null, user.username);
    parentNodeId = rootDir.id;
  });

  it('Step A: Upload F1 with known content → nodeId=N1, s3_key=K1', async () => {
    const content = Buffer.from('cow-original-content');
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('parentNodeId', parentNodeId)
      .field('name', 'original.txt')
      .attach('file', content, 'original.txt');

    expect(res.status).toBe(200);
    file1NodeId = res.body.nodeId;

    // Verify object_map entry
    const objMap = await storage.sqliteQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
      [file1NodeId, 'active']
    );
    expect(objMap.rows.length).toBe(1);
    file1_S3Key = objMap.rows[0].s3_key;
  });

  it('Step B: Copy F1 → F2 has SAME s3_key (zero storage waste)', async () => {
    const res = await request(app)
      .post('/api/files/copy')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: file1NodeId, destinationParentNodeId: parentNodeId, newName: 'copy-of-original.txt' });

    expect(res.status).toBe(200);
    file2NodeId = res.body.nodeId;

    // Critical assertion: both files share the same S3 key
    const objMapF2 = await storage.sqliteQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
      [file2NodeId, 'active']
    );
    expect(objMapF2.rows.length).toBe(1);
    file2_S3Key = objMapF2.rows[0].s3_key;

    // Copy-on-write: same key = shared blob reference
    expect(file2_S3Key).toBe(file1_S3Key);

    // Verify only ONE blob exists in S3 (not duplicated)
    const s3Store = s3Mock.getStore();
    let count = 0;
    for (const [key] of s3Store.entries()) {
      if (key === file1_S3Key) count++;
    }
    expect(count).toBe(1); // Single blob, two references via object_map
  });

  it('Step C: Overwrite F2 → F2 gets NEW s3_key=K2, F1 still has K1', async () => {
    const newContent = Buffer.from('cow-modified-content');
    // Overwrite via the upload contract: parentNodeId + name + onConflict='overwrite'
    // (an upload that targets an existing name under the parent overwrites that node)
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('parentNodeId', parentNodeId)
      .field('name', 'copy-of-original.txt')
      .field('onConflict', 'overwrite')
      .attach('file', newContent, 'copy-of-original.txt');

    expect(res.status).toBe(200);

    // F2 now has a different S3 key
    const objMapF2After = await storage.sqliteQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
      [file2NodeId, 'active']
    );
    expect(objMapF2After.rows[0].s3_key).not.toBe(file1_S3Key);

    // F1's S3 key is unchanged (mutation independence)
    const objMapF1After = await storage.sqliteQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
      [file1NodeId, 'active']
    );
    expect(objMapF1After.rows[0].s3_key).toBe(file1_S3Key);

    // Old F2 blob (shared with F1) is now orphaned in object_map
    const oldEntry = await storage.sqliteQuery(
      'SELECT status FROM object_map WHERE file_node_id = ? AND s3_key = ?',
      [file2NodeId, file1_S3Key]
    );
    if (oldEntry.rows.length > 0) {
      expect(oldEntry.rows[0].status).toBe('orphaned');
    }
  });

  it('Step D: Download F1 → still returns original content', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: file1NodeId });

    expect(res.status).toBe(200);
    const downloadedHash = crypto.createHash('sha256').update(Buffer.from(res.body)).digest('hex');
    const originalHash = crypto.createHash('sha256').update(Buffer.from('cow-original-content')).digest('hex');
    expect(downloadedHash).toBe(originalHash);
  });
});
```

### Scenario 5: Delete Cascade

SQLite foreign key constraints with `ON DELETE CASCADE` must propagate through `file_nodes.parent_id → file_nodes.id`, `object_map.file_node_id → file_nodes.id`, and `node_ancestors`. This scenario verifies the full cascade chain.

```js
describe('Scenario 5: Delete cascade', () => {
  let user, token;
  let rootNodeId, folderA_Id, folderB_Id, fileId;

  beforeAll(async () => {
    useS3Mode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-delete-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    // Build hierarchy: root → A → B → file
    const rootNode = await fileNodeService.createDirectory(null, user.username);
    rootNodeId = rootNode.id;

    const folderA = await fileNodeService.createDirectory(rootNodeId, 'FolderA');
    folderA_Id = folderA.id;

    const folderB = await fileNodeService.createDirectory(folderA_Id, 'FolderB');
    folderB_Id = folderB.id;

    const fileInB = await fileNodeService.createFile(folderB_Id, 'deep-file.txt');
    fileId = fileInB.id;

    // Set up object_map for the file
    const s3Key = crypto.randomUUID();
    await storage.sqliteRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 1, 'active')`,
      [fileId, s3Key]
    );
  });

  it('Step A: Verify pre-delete state — all nodes exist in closure table', async () => {
    // All four nodes must have ancestor entries
    for (const nodeId of [rootNodeId, folderA_Id, folderB_Id, fileId]) {
      const ancestors = await storage.sqliteQuery(
        'SELECT COUNT(*) as cnt FROM node_ancestors WHERE descendant_id = ?',
        [nodeId]
      );
      expect(ancestors.rows[0].cnt).toBeGreaterThan(0);
    }

    // File must have object_map entry
    const objMapCount = await storage.sqliteQuery(
      'SELECT COUNT(*) as cnt FROM object_map WHERE file_node_id = ?',
      [fileId]
    );
    expect(objMapCount.rows[0].cnt).toBeGreaterThan(0);
  });

  it('Step B: Delete Folder A → all descendants removed via CASCADE', async () => {
    const res = await request(app)
      .delete('/api/files/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: folderA_Id });

    expect(res.status).toBe(200);

    // DB verification: Folder A, B, and file are all gone from file_nodes
    for (const nodeId of [folderA_Id, folderB_Id, fileId]) {
      const node = await storage.sqliteQuery(
        'SELECT COUNT(*) as cnt FROM file_nodes WHERE id = ?',
        [nodeId]
      );
      expect(node.rows[0].cnt).toBe(0);
    }

    // Closure table cleanup: no entries for deleted nodes remain
    for (const nodeId of [folderA_Id, folderB_Id, fileId]) {
      const ancestors = await storage.sqliteQuery(
        'SELECT COUNT(*) as cnt FROM node_ancestors WHERE descendant_id = ? OR ancestor_id = ?',
        [nodeId, nodeId]
      );
      expect(ancestors.rows[0].cnt).toBe(0);
    }

    // object_map entries for deleted file are cleaned up (or orphaned)
    const objMapAfter = await storage.sqliteQuery(
      'SELECT COUNT(*) as cnt FROM object_map WHERE file_node_id = ?',
      [fileId]
    );
    expect(objMapAfter.rows[0].cnt).toBe(0);

    // Root node survives (it was not deleted)
    const rootSurvives = await storage.sqliteQuery(
      'SELECT COUNT(*) as cnt FROM file_nodes WHERE id = ?',
      [rootNodeId]
    );
    expect(rootSurvives.rows[0].cnt).toBe(1);
  });

  it('Step C: Root listing no longer shows deleted children', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: rootNodeId });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    // Folder A and all its descendants must be absent from listing
    for (const item of items) {
      expect(item.nodeId).not.toBe(folderA_Id);
      expect(item.nodeId).not.toBe(folderB_Id);
    }
  });
});
```

### Scenario 6: Permission Inheritance in Directory Listing

Permission inheritance works through the closure table (`node_ancestors`). If user U has READ on folder F (nodeId=Nf), then listing any descendant of F must show `hasReadPermission=true` because the ancestor query finds Nf in the chain. This scenario verifies at depths 0, 1, and N.

```js
describe('Scenario 6: Permission inheritance via closure table', () => {
  let ownerUser, ownerToken;    // Owner who creates structure
  let readerUser, readerToken;   // User granted READ on top-level folder
  let rootFolderId, subFolderId, deepFileId;

  beforeAll(async () => {
    useS3Mode();

    // Create two users: owner and reader
    const ownerAuth = await createAuthenticatedTestUser({
      username: `perm-owner-${Date.now()}`,
    });
    ownerUser = ownerAuth.user;
    ownerToken = ownerAuth.token;

    const readerAuth = await createAuthenticatedTestUser({
      username: `perm-reader-${Date.now()}`,
    });
    readerUser = readerAuth.user;
    readerToken = readerAuth.token;

    // Owner creates folder structure: root → sub → file
    const rootNode = await fileNodeService.createDirectory(null, ownerUser.username);
    rootFolderId = rootNode.id;

    const subNode = await fileNodeService.createDirectory(rootFolderId, 'SharedSub');
    subFolderId = subNode.id;

    const deepFile = await fileNodeService.createFile(subFolderId, 'secret.txt');
    deepFileId = deepFile.id;

    // Grant reader READ permission on root folder via nodeId-based grant
    await grantTestPermissionByNodeId({ userId: readerUser.id, fileNodeId: rootFolderId, permission: 'read' });
  });

  it('Depth 0: Reader lists root folder → sees children with hasRead=true', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${readerToken}`)
      .query({ nodeId: rootFolderId });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    const subItem = items.find(i => i.nodeId === subFolderId);
    expect(subItem).toBeDefined();
    // Reader has READ on root folder, inherited to all children
    expect(subItem.hasReadPermission).toBe(true);
    expect(subItem.hasWritePermission).toBe(false);
  });

  it('Depth 1: Reader lists subfolder → sees file with inherited permissions', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${readerToken}`)
      .query({ nodeId: subFolderId });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    const fileItem = items.find(i => i.nodeId === deepFileId);
    expect(fileItem).toBeDefined();
    // Permission inherited from root folder through closure table traversal
    expect(fileItem.hasReadPermission).toBe(true);
    expect(fileItem.hasWritePermission).toBe(false);
  });

  it('Depth N: Reader can download deeply nested file', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${readerToken}`)
      .query({ nodeId: deepFileId });

    // Should succeed via inherited READ permission from ancestor
    expect(res.status).toBe(200);
  });

  it('Writer test: Grant WRITE at subfolder level only → hasWrite=true for sub, false for root children', async () => {
    await grantTestPermissionByNodeId({ userId: readerUser.id, fileNodeId: subFolderId, permission: 'write' });

    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${readerToken}`)
      .query({ nodeId: rootFolderId });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    const subItem = items.find(i => i.nodeId === subFolderId);
    // Subfolder has WRITE (direct grant), so listing shows write permission
    expect(subItem.hasWritePermission).toBe(true);

    // List subfolder — file inherits WRITE from subfolder grant
    const listSub = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${readerToken}`)
      .query({ nodeId: subFolderId });

    const deepItem = (listSub.body.items || listSub.body).find(i => i.nodeId === deepFileId);
    expect(deepItem.hasWritePermission).toBe(true);
  });
});
```

### Scenario 7: Batch Operations

Batch operations exercise the nodeId-based bulk endpoints. Each operation must process all items atomically (via job system) and produce correct DB state.

```js
describe('Scenario 7: Batch operations', () => {
  let user, token;
  let parentNodeId, nodeIds = [];

  beforeAll(async () => {
    useS3Mode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-batch-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    // Create parent folder and 5 test files
    const rootDir = await fileNodeService.createDirectory(null, user.username);
    parentNodeId = rootDir.id;

    for (let i = 0; i < 5; i++) {
      const node = await fileNodeService.createFile(parentNodeId, `batch-file-${i}.txt`);
      const s3Key = crypto.randomUUID();
      await storage.sqliteRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, 'active')`,
        [node.id, s3Key]
      );
      s3Mock.putObject({ input: { Bucket: 'test-bucket', Key: s3Key, Body: Buffer.from(`content-${i}`), ContentType: 'text/plain' }});
      nodeIds.push(node.id);
    }
  });

  it('Batch-delete: POST /batch-delete with array of nodeIds → all deleted in one job', async () => {
    const deleteTargets = [nodeIds[0], nodeIds[1]];

    const res = await request(app)
      .post('/api/files/batch-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeIds: deleteTargets });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();

    // Wait for job completion (poll or use WEA_SKIP_BULK_WORKER synchronous mode)
    await waitForJobCompletion(res.body.jobId, token);

    // Verify both nodes deleted from file_nodes
    for (const nodeId of deleteTargets) {
      const node = await storage.sqliteQuery(
        'SELECT COUNT(*) as cnt FROM file_nodes WHERE id = ?',
        [nodeId]
      );
      expect(node.rows[0].cnt).toBe(0);
    }

    // Verify remaining nodes untouched
    for (const nodeId of nodeIds.slice(2)) {
      const node = await storage.sqliteQuery(
        'SELECT COUNT(*) as cnt FROM file_nodes WHERE id = ?',
        [nodeId]
      );
      expect(node.rows[0].cnt).toBe(1);
    }
  });

  it('Batch-move: POST /batch-move with nodeId mappings → all moved, closures updated', async () => {
    const newParentDir = await fileNodeService.createDirectory(null, 'BatchDest');

    const moveTargets = [nodeIds[2], nodeIds[3]];

    const res = await request(app)
      .post('/api/files/batch-move')
      .set('Authorization', `Bearer ${token}`)
      .send({
        moves: moveTargets.map(sourceId => ({
          sourceNodeId: sourceId,
          destinationParentNodeId: newParentDir.id,
        })),
      });

    expect(res.status).toBe(202);
    const jobId = res.body.jobId;
    await waitForJobCompletion(jobId, token);

    // Verify closure tables updated: moved nodes now have new parent as ancestor
    for (const nodeId of moveTargets) {
      const ancestors = await storage.sqliteQuery(
        'SELECT ancestor_id FROM node_ancestors WHERE descendant_id = ?',
        [nodeId]
      );
      const ancestorIds = ancestors.rows.map(r => r.ancestor_id);
      expect(ancestorIds).toContain(newParentDir.id);
    }
  });

  it('Batch-copy: POST /batch-copy with nodeId mappings → copy-on-write applied', async () => {
    const destDir = await fileNodeService.createDirectory(null, 'CopyDest');

    const res = await request(app)
      .post('/api/files/batch-copy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        copies: [{ sourceNodeId: nodeIds[4], destinationParentNodeId: destDir.id }],
      });

    expect(res.status).toBe(202);
    const jobId = res.body.jobId;
    await waitForJobCompletion(jobId, token);

    // Verify copy created with shared S3 key (copy-on-write)
    const originalS3Key = (await storage.sqliteQuery(
      'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
      [nodeIds[4], 'active']
    )).rows[0].s3_key;

    // Find the copied node's object_map entry
    const copyNodeRows = await storage.sqliteQuery(
      `SELECT fn.id FROM file_nodes fn
       WHERE fn.parent_id = ? AND fn.name LIKE '%copy%'`,
      [destDir.id]
    );
    if (copyNodeRows.rows.length > 0) {
      const copiedNodeId = copyNodeRows.rows[0].id;
      const copiedS3Key = (await storage.sqliteQuery(
        'SELECT s3_key FROM object_map WHERE file_node_id = ? AND status = ?',
        [copiedNodeId, 'active']
      )).rows[0].s3Key;

      // Copy-on-write: same S3 key as original
      expect(copiedS3Key).toBe(originalS3Key);
    }
  });
});

// Helper: poll job status until completed or timed out
async function waitForJobCompletion(jobId, token, timeoutMs = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await request(app)
      .get(`/api/files/bulk-operation/${jobId}`)
      .set('Authorization', `Bearer ${token}`);

    if (res.body.status === 'completed' || res.body.status === 'failed') {
      return res.body;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Job ${jobId} did not complete within timeout`);
}
```

### Scenario 8: Fail-Safe Recovery

This scenario tests the `sync_status='orphaned_node'` fail-safe mechanism. When WebDAV operations fail during rename/move, the DB transaction still commits but marks the node for admin review.

```js
describe('Scenario 8: Fail-safe recovery', () => {
  let user, token, fileNodeId;

  beforeAll(async () => {
    // Use WebDAV mode to trigger storage-side operations
    useWebdavMode();
    const auth = await createAuthenticatedTestUser({
      username: `integ-failsafe-${Date.now()}`,
    });
    user = auth.user;
    token = auth.token;

    const rootDir = await fileNodeService.createDirectory(null, user.username);
    const fileNode = await fileNodeService.createFile(rootDir.id, 'failsafe-test.txt');
    fileNodeId = fileNode.id;

    // Reset sync_status to active for the test
    await storage.sqliteRun(
      'UPDATE file_nodes SET sync_status = ? WHERE id = ?',
      ['active', fileNodeId]
    );
  });

  it('WebDAV MOVE failure during rename → node marked orphaned_node', async () => {
    // Force WebDAV mock to fail on moveFile
    webdavMock.moveFile.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeId: fileNodeId, newName: 'trigger-orphan.txt' });

    // Route returns 200 (DB rename succeeded) but sync_status reflects failure
    expect(res.status).toBe(200);

    // Critical verification: node exists with orphaned status
    const node = await storage.sqliteQuery(
      'SELECT name, sync_status FROM file_nodes WHERE id = ?',
      [fileNodeId]
    );
    expect(node.rows[0].name).toBe('trigger-orphan.txt');  // DB rename DID happen
    expect(node.rows[0].sync_status).toBe('orphaned_node'); // Storage is out of sync

    // Node still appears in directory listing (not hidden)
    const listRes = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
  });

  it('Orphaned node is still listed but marked for admin review', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: (await storage.sqliteQuery(
        'SELECT parent_id FROM file_nodes WHERE id = ?', [fileNodeId]
      )).rows[0].parent_id });

    expect(res.status).toBe(200);
    const items = res.body.items || res.body;
    const orphanItem = items.find(i => i.nodeId === fileNodeId);
    expect(orphanItem).toBeDefined();
    // Response includes sync_status indicator for admin review UI
    if (orphanItem.syncStatus) {
      expect(orphanItem.syncStatus).toBe('orphaned_node');
    }
  });
});
```

---

## Task W5.1: Test Utilities

### File: `server/test-utils.js` — EXTEND with nodeId-based helpers

The following helper functions are appended to the existing exports in `test-utils.js`. They operate on `nodeId` rather than path strings, matching Phase 4's new API contract.

### Helper Function Implementations

#### `createTestFileNode`

```js
/**
 * Creates a test file node and returns its nodeId.
 * Uses the real fileNodesStore bound to current SQLite connection.
 * Also builds the closure table entry via ancestry helper.
 *
 * @param {object} database - Not used directly; storage module uses global connection.
 *   Kept for API consistency with createTestDatabase pattern.
 * @param {string} name - Node name (file or directory)
 * @param {string} [type='file'] - 'file' | 'directory'
 * @param {number|null} [parentId=null] - Parent node ID, null for root level
 * @returns {Promise<{nodeId: number, path: string}>}
 */
async function createTestFileNode({ database, name, type = 'file', parentId = null }) {
  const { createFileNodesStore } = require('./store/fileNodesStore');
  const { createAncestryHelper } = require('./service/_ancestryHelper');

  const store = createFileNodesStore();
  const ancestry = createAncestryHelper(store);

  // Create the node in file_nodes table
  const node = await store.createNode(parentId, name, type);

  // Build ancestor chain in closure table
  await ancestry.buildAncestorsForNode(node.id, parentId);

  // Resolve display path from ancestor chain
  let path = '';
  if (parentId !== null) {
    const parentRow = await store.getNode(parentId);
    if (parentRow) {
      const parentChain = await store.getAncestorChain(parentId);
      const segments = [];
      for (const entry of [...parentChain].reverse()) {
        const ancNode = await store.getNode(entry.ancestorId);
        if (ancNode) segments.push(ancNode.name);
      }
      path = '/' + segments.join('/') + '/' + name;
    }
  } else {
    path = '/' + name;
  }

  return { nodeId: node.id, path };
}
```

#### `grantTestPermissionByNodeId`

```js
/**
 * Grants a permission to a user on a file node using nodeId.
 * This replaces the path-based grantTestPermission for Phase 4+ tests.
 * Writes directly into permissions_user_paths (matches permissionStore schema, 3 data columns).
 *
 * @param {object} database - Database connection (not used; storage module is global)
 * @param {number} userId - User receiving permission
 * @param {number} fileNodeId - Node to grant access on
 * @param {string} [permission='read'] - 'read' | 'write' | 'admin'
 * @returns {Promise<void>}
 */
async function grantTestPermissionByNodeId({ database, userId, fileNodeId, permission = 'read' }) {
  // Insert into permissions_user_paths with file_node_id reference.
  // Column names match permissionStore.js: (user_id, file_node_id, permission).
  await storage.sqliteRun(
    `INSERT INTO permissions_user_paths (user_id, file_node_id, permission)
     VALUES (?, ?, ?)`,
    [userId, fileNodeId, permission]
  );
}
```

#### `createUserRootNode`

```js
/**
 * Sets up a user's root directory node. Call once per test user.
 * Creates the top-level folder matching the user's username and builds
 * its ancestor chain (self-reference at depth=0).
 *
 * @param {object} database - Database connection (not used directly)
 * @param {number} userId - User ID
 * @returns {Promise<{nodeId: number}>} — the root folder nodeId
 */
async function createUserRootNode({ database, userId }) {
  const userStore = require('./store/userStore');
  const user = await userStore.findById(userId);

  if (!user) {
    throw new Error(`User ${userId} not found for root node creation`);
  }

  const result = await createTestFileNode({ name: user.username, type: 'directory', parentId: null });
  return { nodeId: result.nodeId };
}
```

#### `createNestedStructure`

```js
/**
 * Creates a nested directory structure for testing.
 * Each segment is created as a child of the previous one, with full
 * closure table entries built at each level.
 *
 * @param {object} database - Database connection (not used directly)
 * @param {number} parentId - Starting parent nodeId
 * @param {string[]} segments - Path segments to create: ['level1', 'level2']
 * @returns {Promise<{nodeIds: number[], paths: string[]}>} — nodeIds and paths for each created segment
 */
async function createNestedStructure({ database, parentId, segments }) {
  const nodeIds = [];
  const paths = [];

  let currentParentId = parentId;

  for (const segment of segments) {
    const result = await createTestFileNode({ name: segment, type: 'directory', parentId: currentParentId });
    nodeIds.push(result.nodeId);
    paths.push(result.path);
    currentParentId = result.nodeId;
  }

  return { nodeIds, paths };
}
```

#### `createTestFileWithBlob` (bonus helper for upload scenarios)

```js
/**
 * Creates a file node with an associated blob entry in object_map and S3 mock.
 * Convenience wrapper that combines createTestFileNode + object_map insertion + S3 storage.
 * The caller passes the active s3Mock instance from the W5.0 test setup
 * (S3Client.mockImplementation(() => s3Mock)) — there is no global _s3Mock.
 *
 * @param {number} userId - Owner user ID
 * @param {string} name - File name
 * @param {number|null} parentId - Parent node ID
 * @param {Buffer|string} content - File content to store in mock S3
 * @param {string} [mimeType='text/plain'] - MIME type for the blob
 * @param {object} s3Mock - Active s3Mock instance (createS3Mock()) from test setup
 * @returns {Promise<{nodeId: number, s3Key: string, path: string}>}
 */
async function createTestFileWithBlob(userId, name, parentId, content, mimeType = 'text/plain', s3Mock) {
  const fileResult = await createTestFileNode({ name, type: 'file', parentId });
  const s3Key = crypto.randomUUID();

  // Insert object_map entry
  await storage.sqliteRun(
    `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
     VALUES (?, ?, 's3', 1, 'active')`,
    [fileResult.nodeId, s3Key]
  );

  // Store in S3 mock — caller must provide the active instance from test setup
  if (s3Mock) {
    s3Mock.putObject({
      input: {
        Bucket: 'test-bucket',
        Key: s3Key,
        Body: Buffer.isBuffer(content) ? content : Buffer.from(content),
        ContentType: mimeType,
      },
    });
  }

  return { nodeId: fileResult.nodeId, s3Key, path: fileResult.path };
}
```

### Usage Examples

```js
// Example 1: Setting up a test user with root folder and nested structure
describe('My integration scenario', () => {
  let dbCleanup;
  let userId, rootNodeId, subFolderIds;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;

    // Create user
    const user = await createAuthenticatedTestUser({ username: 'example-user' });
    userId = user.user.id;

    // Set up root folder
    const rootNode = await createUserRootNode({ userId });
    rootNodeId = rootNode.nodeId;

    // Create nested structure: root/Projects/2024/Q1
    const nested = await createNestedStructure({ parentId: rootNodeId, segments: ['Projects', '2024', 'Q1'] });
    subFolderIds = nested.nodeIds;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('can list the deepest folder', async () => {
    const deepestFolderId = subFolderIds[subFolderIds.length - 1]; // Q1
    // ... test logic using nodeId
  });
});

// Example 2: Granting permission and verifying access
it('reader can access shared file via inherited permission', async () => {
  const readerUser = await createAuthenticatedTestUser({ username: 'reader-user' });
  const ownerRoot = await createUserRootNode({ userId });

  // Create a shared folder under owner's root
  const sharedFolder = await createTestFileNode({ name: 'shared', type: 'directory', parentId: ownerRoot.nodeId });

  // Grant read permission to reader on the shared folder
  await grantTestPermissionByNodeId({ userId: readerUser.user.id, fileNodeId: sharedFolder.nodeId, permission: 'read' });

  // Create a file inside shared folder
  const innerFile = await createTestFileNode({ name: 'document.txt', type: 'file', parentId: sharedFolder.nodeId });

  // Reader should be able to list the shared folder and see the file with read permission
  const res = await request(app)
    .get('/api/files/list')
    .set('Authorization', `Bearer ${readerUser.token}`)
    .query({ nodeId: sharedFolder.nodeId });

  expect(res.status).toBe(200);
  const items = res.body.items || res.body;
  const fileItem = items.find(i => i.nodeId === innerFile.nodeId);
  expect(fileItem.hasReadPermission).toBe(true);
});
```

---

## Task W5.2: Full Test Suite Execution

### Expected Results Table

| Test File | Backend | Expected Passes | Notes |
|-----------|---------|-----------------|-------|
| `server/domains/files/__tests__/files.integration.test.js` | SQLite+S3Mock | 8 scenarios × sub-tests ≈ 15-20 assertions | New file, all Phase 4 CRUD lifecycle |
| `server/domains/files/routes/__tests__/files.test.js` | SQLite+WebDAV mock | All existing tests pass | Existing tests updated to nodeId payloads in Wave 3 (no path compat layer — PLAN.md Rule 13) |
| `server/service/__tests__/fileNodeService.test.js` | SQLite | 30+ assertions (existing) | Unchanged, must still pass |
| `server/service/__tests__/blobStorageService.test.js` | SQLite | 25+ assertions (existing) | S3 mode tests must still pass; WebDAV mode tests added in Wave 2 |
| `server/store/__tests__/fileNodesStore.test.js` | SQLite | All existing | Store layer unchanged |
| `server/domains/permissions/services/__tests__/aclService.test.js` | SQLite | All existing | nodeId-based permission checks verified |
| `client/src/**/*test*` | N/A | All existing | Client tests use nodeId fixtures after Wave 4 migration |

### Failure Diagnosis Procedure

If any test fails during W5.2 execution:

1. **Identify the failing scenario**: Note the exact `describe()`/`it()` block and assertion that failed.
2. **Check DB state at failure point**: Add a temporary diagnostic query before the failing assertion:
   ```js
   console.log('DIAG file_nodes:', await storage.sqliteQuery('SELECT * FROM file_nodes'));
   console.log('DIAG node_ancestors:', await storage.sqliteQuery('SELECT * FROM node_ancestors'));
   console.log('DIAG object_map:', await storage.sqliteQuery('SELECT * FROM object_map'));
   ```
3. **Classify the failure**:
   - **Route-level (HTTP status wrong)**: Check if route handler was updated in Wave 3 to accept nodeId payloads. If not, this is a Wave 3 regression — fix before proceeding.
   - **Service-level (wrong DB state)**: Check fileNodeService/blobStorageService method implementation against spec in `docs/spec/`. Likely an implementation bug from Wave 2-3.
   - **Permission-level (hasRead/hasWrite wrong)**: Check aclService.checkFolderPermission for correct nodeId resolution and closure table traversal.
   - **Cascade failure (wrong nodes deleted)**: Verify FK constraints on SQLite schema (`PRAGMA foreign_keys = ON` is set). If missing, add `storage.sqliteRun('PRAGMA foreign_keys = ON')` to test setup.
4. **Record in fail log**: Append incident to `docs/fail_log.md` with scenario name, evidence, classification, and resolution.

### CI Command Sequence

```bash
# 1. Server unit tests (existing + new integration)
npm run test:ci -w server

# 2. Client tests (nodeId fixtures)
npm run test:ci -w client

# 3. If both pass, verify no legacy references remain
grep -rn "checkPermissionSync\|buildSync" server/ --include="*.js" | grep -v "\.test\." | grep -v "node_modules" || echo "CLEAN: zero legacy imports"

grep -rn "folderPath\|file_path" client/src/services/permissionService.js || echo "CLEAN: zero path-based permission payloads"
```

---

## Task W5.3: Regression Verification

### Unchanged Areas Checklist

These areas were NOT touched by Phase 4 and must continue to pass without modification:

- [ ] **Auth routes**: `server/domains/auth/routes/__tests__/auth.test.js` — login, register, token refresh
- [ ] **Settings CRUD**: `server/domains/admin/routes/__tests__/settings.test.js` — get/set application settings
- [ ] **Share link creation/access**: `server/domains/sharing/routes/__tests__/shareLinks.test.js`, `server/domains/sharing/routes/__tests__/sharePublic.test.js` — share links still use path-based mode during transition; Phase 5 will migrate them to nodeId. If a compat layer exists in the route handler, verify it routes correctly for both path and nodeId inputs.
- [ ] **User management**: `server/domains/admin/routes/__tests__/users.test.js` — CRUD operations on users
- [ ] **Permission requests**: `server/domains/permissions/routes/__tests__/permissionRequests.test.js` — request/approve/deny workflow (may need nodeId migration in Phase 5)
- [ ] **Thumbnails**: `server/domains/thumbnails/routes/__tests__/thumbnails.test.js` — thumbnail generation routes
- [ ] **Health check**: `server/infrastructure/__tests__/healthRoutes.test.js` — infrastructure health endpoints

### Regression Test Command

```bash
# Run all server tests except the new integration file to isolate regressions
npm run test:ci -w server -- --testPathIgnorePatterns="files.integration"

# Expected: zero failures, same pass count as pre-Phase 4 baseline
```

---

## Plan Update Guide

When executing this wave, update `PLAN.md` with the following format for each completed task:

```markdown
### Task 4.9: Route Integration Tests — Full CRUD Lifecycle [COMPLETE]
**Status:** Done | **Wave:** W5 (W5.0)
**Evidence:** All 8 integration scenarios pass against SQLite+S3Mock and SQLite+WebDAVMock backends.
**Test file:** `server/domains/files/__tests__/files.integration.test.js`

### Task 4.10: Test Utilities [COMPLETE]
**Status:** Done | **Wave:** W5 (W5.1)
**Evidence:** Four helper functions added to `server/test-utils.js`, exported, and used in integration tests.
**Functions:** createTestFileNode, grantTestPermissionByNodeId, createUserRootNode, createNestedStructure
```

## Execution Log Template

| Timestamp | Action | Result | Notes |
|-----------|--------|--------|-------|
| YYYY-MM-DD HH:MM | Created test infrastructure setup | PASS | In-memory SQLite + schema init confirmed |
| YYYY-MM-DD HH:MM | Scenario 1 (S3) Upload→List→Download | PASS/FAIL | Content hash match verified |
| YYYY-MM-DD HH:MM | Scenario 1 (WebDAV) Upload→List→Download | PASS/FAIL | webdavMock calls verified |
| YYYY-MM-DD HH:MM | Scenario 2 Rename (S3 + WebDAV) | PASS/FAIL | Closure table unchanged confirmed |
| YYYY-MM-DD HH:MM | Scenario 3 Move Across Folders | PASS/FAIL | Ancestor chain rebuilt correctly |
| YYYY-MM-DD HH:MM | Scenario 4 Copy-on-Write | PASS/FAIL | Shared S3 key + mutation independence verified |
| YYYY-MM-DD HH:MM | Scenario 5 Delete Cascade | PASS/FAIL | FK CASCADE propagated through all tables |
| YYYY-MM-DD HH:MM | Scenario 6 Permission Inheritance | PASS/FAIL | Closure table ancestor query correct at depths 0/1/N |
| YYYY-MM-DD HH:MM | Scenario 7 Batch Operations | PASS/FAIL | All three batch types process nodeId payloads |
| YYYY-MM-DD HH:MM | Scenario 8 Fail-Safe Recovery | PASS/FAIL | orphaned_node status set on WebDAV failure |
| YYYY-MM-DD HH:MM | Test utilities added to test-utils.js | PASS/FAIL | Four helpers exported and documented |
| YYYY-MM-DD HH:MM | Full server test suite (test:ci) | PASS/FAIL | Expected: X passes, 0 failures |
| YYYY-MM-DD HH:MM | Client test suite (test:ci) | PASS/FAIL | Expected: Y passes, 0 failures |
| YYYY-MM-DD HH:MM | Legacy reference grep check | CLEAN/DIRTY | Must return zero results |

## Hypothesis Revisions Template

### Initial Hypothesis
> Based on Waves 1-4 implementation evidence (specs aligned, routes accept nodeId, services use fileNodeService + blobStorageService), all CRUD operations should work correctly through the integration layer when tested against SQLite with mocked external storage. Expected outcome: 0 test failures across all scenarios in both S3 and WebDAV modes.

### Revision Log
*(Update this section if any scenario fails unexpectedly)*

| # | Failed Scenario | Original Hypothesis | New Evidence | Revised Hypothesis | Resolution |
|---|-----------------|---------------------|---------------|---------------------|------------|
| — | *(none yet)* | — | — | — | — |

## Phase 4 Completion Gate

After Wave 5 is complete, run the final verification sequence:

```bash
# All server tests must pass on SQLite backend
npm run test:ci -w server

# All client tests must pass with nodeId fixtures
npm run test:ci -w client

# Verify zero legacy references remain in production code (not test files)
grep -rn "checkPermissionSync\|buildSync" server/ --include="*.js" | grep -v "\.test\." | grep -v "node_modules"
# Expected output: (empty — zero results)

grep -rn "folderPath\|file_path" client/src/services/permissionService.js
# Expected output: (empty — all migrated to nodeId)

# Verify W5 integration test file exists and has content
test -s server/domains/files/__tests__/files.integration.test.js && echo "Integration tests present" || echo "MISSING"

# Verify new helpers are exported from test-utils.js
node -e "const u = require('./server/test-utils'); console.log('createTestFileNode:', typeof u.createTestFileNode); console.log('grantTestPermissionByNodeId:', typeof u.grantTestPermissionByNodeId);"
# Expected: both output 'function'
```

### Phase 4 Completion Checklist

- [ ] All W5.0 integration scenarios pass in S3 mode (upload→list→download, rename, move, copy-on-write, delete cascade, batch operations)
- [ ] All W5.0 integration scenarios pass in WebDAV mode (with appropriate adaptations: no object_map for blobs, MOVE fail-safe verified)
- [ ] Scenario 8 fail-safe recovery verified (orphaned_node status on WebDAV failure)
- [ ] Test utilities from W5.1 documented and exported from `server/test-utils.js`
- [ ] Full test suite passes: `npm run test:ci -w server && npm run test:ci -w client` — zero failures
- [ ] Zero legacy sync checker imports remain in non-test production code
- [ ] Zero path-based permission payloads in client `permissionService.js`
- [ ] All 5 wave plan files (wave1 through wave5) have populated Execution Logs with timestamps and results
- [ ] PLAN.md updated with Task 4.9 and Task 4.10 marked COMPLETE

### Handoff to Phase 5

Phase 5 (Sharing & RecentFiles → Node ID) can begin after:

1. This file's completion checklist is all checked off ✅
2. `npm run test:ci -w server` passes with zero failures
3. All wave plan files are updated with final execution logs
4. No open issues or unresolved hypothesis revisions exist in this document
