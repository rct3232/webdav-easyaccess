/**
 * Version-history routes integration tests (DEF-11).
 * @see docs/api.md, docs/spec/server/routes/files.md §2.2
 *
 * S3 storage mode only: version rows exist only in S3 mode. The suite builds
 * an S3-mode composition with the in-memory blob store, seeds object_map
 * versions directly, and asserts the API contract.
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbQuery,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createInMemoryBlobStore } = require('@testing/mocks/serviceMocks');
const composition = require('../../../../service/composition');

let fileNodeService;
let blobStore;

let app;
let dbCleanup;
let userToken;
let adminToken;
let otherToken;
let testFileNodeId;
let shareToken;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 's3';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });

  blobStore = createInMemoryBlobStore();
  composition.__setCompositionForTests({
    fileStorageMode: 's3',
    blobStore,
  });

  app = require('../../../../index');

  const owner = await createAuthenticatedTestUser({
    username: `ver-owner-${Date.now()}`,
    status: 'active',
  });
  userToken = owner.token;
  const homeNode = await fileNodeService.createDirectory(null, owner.user.username);
  await grantTestPermissionByNodeId({
    userId: owner.user.id,
    fileNodeId: homeNode.id,
    permission: 'write',
  });

  const other = await createAuthenticatedTestUser({
    username: `ver-other-${Date.now()}`,
    status: 'active',
  });
  otherToken = other.token;

  const admin = await createAuthenticatedTestUser({
    username: `ver-admin-${Date.now()}`,
    status: 'active',
    isAdmin: true,
  });
  adminToken = admin.token;

  // Seed a file with two versions: v1 (history) + v2 (active).
  const file = await fileNodeService.createFile(homeNode.id, 'versioned.txt');
  testFileNodeId = file.id;
  const keyV1 = `ver-route-v1-${Date.now()}`;
  const keyV2 = `ver-route-v2-${Date.now()}`;
  await dbQuery(
    "INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status) VALUES (?, ?, 's3', 1, 'active')",
    [file.id, keyV1]
  );
  await blobStore.uploadBlob(keyV1, Buffer.from('v1-content'));
  await dbQuery(
    "INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status) VALUES (?, ?, 's3', 2, ?)",
    [file.id, keyV2, 'pending']
  );
  await blobStore.uploadBlob(keyV2, Buffer.from('v2-content-new'));
  await dbQuery("UPDATE object_map SET status = 'active' WHERE s3_key = ?", [keyV2]);
  await dbQuery("UPDATE object_map SET status = 'history' WHERE s3_key = ?", [keyV1]);
  await dbQuery("UPDATE file_nodes SET sync_status = 'active' WHERE id = ?", [file.id]);

  // A real share link on the file: the versions routes must refuse it (403).
  const ShareLink = require('../../../../models/ShareLink');
  const link = await ShareLink.create(file.id, owner.user.id);
  shareToken = link.token;
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/files/versions', () => {
  it('returns versions newest first with internals stripped', async () => {
    const res = await request(app)
      .get('/api/files/versions')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(200);
    expect(res.body.nodeId).toBe(testFileNodeId);
    expect(res.body.currentVersionNumber).toBe(2);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions[0]).toMatchObject({ versionNumber: 2, isCurrent: true });
    expect(res.body.versions[1]).toMatchObject({
      versionNumber: 1,
      isCurrent: false,
      status: 'history',
    });
    for (const v of res.body.versions) {
      expect(v.s3_key).toBeUndefined();
      expect(v.storage_backend).toBeUndefined();
      expect(v.id).toBeUndefined();
    }
  });

  it('404-masquerades for a caller without read permission', async () => {
    const res = await request(app)
      .get('/api/files/versions')
      .set('Authorization', `Bearer ${otherToken}`)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);
  });

  it('refuses share-token access with 403', async () => {
    const res = await request(app)
      .get('/api/files/versions')
      .set('X-Share-Token', shareToken)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(403);
  });

  it('400 when nodeId is missing', async () => {
    const res = await request(app)
      .get('/api/files/versions')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/files/versions/restore', () => {
  it('restores a history version in place (no new row)', async () => {
    const { rows: before } = await dbQuery(
      'SELECT COUNT(*) AS count FROM object_map WHERE file_node_id = ?',
      [testFileNodeId]
    );

    const res = await request(app)
      .post('/api/files/versions/restore')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testFileNodeId, versionNumber: 1 });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.files.versionRestored);
    expect(res.body.restoredVersionNumber).toBe(1);

    const { rows: activeRows } = await dbQuery(
      "SELECT s3_key, version_number FROM object_map WHERE file_node_id = ? AND status = 'active'",
      [testFileNodeId]
    );
    expect(activeRows).toHaveLength(1);
    expect(Number(activeRows[0].version_number)).toBe(1);

    const { rows: after } = await dbQuery(
      'SELECT COUNT(*) AS count FROM object_map WHERE file_node_id = ?',
      [testFileNodeId]
    );
    expect(Number(after[0].count)).toBe(Number(before[0].count));

    // Restore the active state for the other suites (restore v2 back).
    await request(app)
      .post('/api/files/versions/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nodeId: testFileNodeId, versionNumber: 2 });
  });

  it('403 when the caller lacks write permission', async () => {
    const res = await request(app)
      .post('/api/files/versions/restore')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ nodeId: testFileNodeId, versionNumber: 1 });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.permissionDenied);
  });

  it('404 for an unknown version', async () => {
    const res = await request(app)
      .post('/api/files/versions/restore')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testFileNodeId, versionNumber: 999 });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.versionNotFound);
  });

  it('400 when versionNumber is missing', async () => {
    const res = await request(app)
      .post('/api/files/versions/restore')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testFileNodeId });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/files/versions/download', () => {
  it('serves the history version attachment-only as octet-stream', async () => {
    const res = await request(app)
      .get('/api/files/versions/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId, versionNumber: 1 });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.toString()).toBe('v1-content');
  });

  it('404-masquerades without read permission', async () => {
    const res = await request(app)
      .get('/api/files/versions/download')
      .set('Authorization', `Bearer ${otherToken}`)
      .query({ nodeId: testFileNodeId, versionNumber: 1 });

    expect(res.status).toBe(404);
  });

  it('404 for an unknown version', async () => {
    const res = await request(app)
      .get('/api/files/versions/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId, versionNumber: 12345 });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.versionNotFound);
  });

  it('refuses share-token access', async () => {
    const res = await request(app)
      .get('/api/files/versions/download')
      .set('X-Share-Token', shareToken)
      .query({ nodeId: testFileNodeId, versionNumber: 1 });

    expect(res.status).toBe(403);
  });
});
