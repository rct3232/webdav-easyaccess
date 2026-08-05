/**
 * Files routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/files.md
 *
 * Note: Full batch-move worker execution is complex (selectiveTransfer, etc.).
 * We verify the API contract: batch-move returns 202 + jobId, bulk-operation returns 404 for unknown job.
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
} = require('../../../../test-utils');
const { createFileNodeService } = require('../../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../../store/fileNodesStore');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('../../../../service/composition');

let fileNodeService;
let webdavMock;
let blobStore;

async function createUserWithHomeNode(opts = {}) {
  const { user, token } = await createAuthenticatedTestUser(opts);
  const node = await fileNodeService.createDirectory(null, user.username);
  return { user, token, homeNodeId: node.id };
}

async function grantHomePermission({ userId, homeNodeId, permission }) {
  await grantTestPermissionByNodeId({ userId, fileNodeId: homeNodeId, permission });
}

let app;
let dbCleanup;
let homeNodeId, userId, userToken;
let testFileNodeId, testVideoNodeId, testNonVideoNodeId;

beforeAll(async () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  process.env.WEA_SKIP_BULK_WORKER = '1';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });

  webdavMock = createWebdavMock();
  blobStore = new WebdavBlobStore(webdavMock);
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore,
  });

  app = require('../../../../index');

  // Create a shared user and home node used across tests
  const created = await createUserWithHomeNode({ username: `files-shared-${Date.now()}` });
  userId = created.user.id;
  userToken = created.token;
  homeNodeId = created.homeNodeId;
  await grantHomePermission({ userId, homeNodeId, permission: 'write' });

  // Create test file nodes for download/preview tests
  const testFile = await fileNodeService.createFile(homeNodeId, 'test-file.txt');
  testFileNodeId = testFile.id;
  const testVideo = await fileNodeService.createFile(homeNodeId, 'test-video.mp4');
  testVideoNodeId = testVideo.id;
  const testNonVideo = await fileNodeService.createFile(homeNodeId, 'test-doc.pdf');
  testNonVideoNodeId = testNonVideo.id;
});

afterAll(async () => {
  delete process.env.WEA_SKIP_BULK_WORKER;
  await dbCleanup?.();
});

beforeEach(() => {
  webdavMock.listDirectory.mockImplementation((path) => {
    const p = String(path).replace(/\/$/, '');
    if (p && /\.\w+$/.test(p)) {
      return Promise.reject(Object.assign(new Error('Not a directory'), { status: 404 }));
    }
    return Promise.resolve([
      { basename: 'file1.txt', type: 'file' },
      { basename: 'subdir', type: 'directory' },
    ]);
  });
  webdavMock.getFileContents.mockResolvedValue(Buffer.from('test content'));
  webdavMock.getFileMetadata.mockResolvedValue({ size: 100, lastmod: '2024-01-01', mime: 'text/plain' });
  webdavMock.pathExists.mockResolvedValue(true);
  webdavMock.isVideoFile.mockImplementation((filename) => String(filename).toLowerCase().endsWith('.mp4'));
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/files/list', () => {
  it('returns folder contents for authenticated user', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: homeNodeId });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body.items) || Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .query({ nodeId: homeNodeId });
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty items when listing non-existent parent (no parent permission check)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-list-403-${Date.now()}`,
    });
    // Non-existent node: list endpoint returns empty items (no parent-level permission check)
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: 999 });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('returns 200 with items when admin lists folder (admin bypass)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-list-admin-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: homeNodeId });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body.items) || Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/files/download', () => {
  it('returns file content for user with permission', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ nodeId: testFileNodeId });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .query({ nodeId: testFileNodeId });
    expect(res.status).toBe(401);
  });

  it('returns 404 when user downloads non-existent file', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-dl-403-${Date.now()}`,
    });
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${token}`)
      .query({ nodeId: 999 });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/files/preview-ticket', () => {
  it('returns a ticket for video file when user has permission', async () => {
    const res = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testVideoNodeId });

    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
    expect(typeof res.body.ticket).toBe('string');
  });

  it('returns 400 when file is not video', async () => {
    const res = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testNonVideoNodeId });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.previewNotVideo);
  });
});

describe('GET /api/files/preview-stream', () => {
  it('streams video inline with valid ticket', async () => {
    webdavMock.getFileContents.mockResolvedValueOnce(Buffer.from('video-content'));

    const ticketRes = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testVideoNodeId });

    expect(ticketRes.status).toBe(200);
    const ticket = ticketRes.body.ticket;

    const res = await request(app)
      .get('/api/files/preview-stream')
      .query({ nodeId: testVideoNodeId, ticket });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-type']).toContain('video/');
  });

  it('returns 403 for invalid ticket', async () => {
    const res = await request(app)
      .get('/api/files/preview-stream')
      .query({ nodeId: testVideoNodeId, ticket: 'nope' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.previewTicketInvalid);
  });
});

describe('POST /api/files/batch-move', () => {
  it('returns 400 when moves missing', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-move2-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/files/batch-move')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 202 and jobId for valid batch-move', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `files-batch-${Date.now()}`,
    });
    await grantHomePermission({ userId: user.id, homeNodeId, permission: 'write' });

    const res = await request(app)
      .post('/api/files/batch-move')
      .set('Authorization', `Bearer ${token}`)
      .send({
        moves: [
          { sourceNodeId: 1, destinationParentNodeId: 2 },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
  });
});


describe('POST /api/files/upload', () => {
  it('returns 403 when user has no write permission on path', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-upload-403-${Date.now()}`,
    });
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('parentNodeId', '999')
      .attach('file', Buffer.from('x'), 'test.txt');

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('accepts multipart upload and returns 200', async () => {
    const { user, token, homeNodeId: uploadHomeId } = await createUserWithHomeNode({
      username: `files-upload-${Date.now()}`,
    });
    await grantHomePermission({ userId: user.id, homeNodeId: uploadHomeId, permission: 'write' });

    // Simulate new file upload: destination file does not exist yet.
    webdavMock.pathExists.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('parentNodeId', String(uploadHomeId))
      .attach('file', Buffer.from('test content'), 'test.txt');

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });
});

describe('POST /api/files/batch-delete', () => {
  it('returns 202 and jobId for valid batch-delete', async () => {
    const res = await request(app)
      .post('/api/files/batch-delete')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [homeNodeId, testFileNodeId] });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
  });

  it('returns 202 for batch-delete (permission check is async)', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-del-403-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/files/batch-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeIds: [homeNodeId, 999] });

    // Batch-delete returns 202 immediately; permission check happens asynchronously
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
  });
});

describe('POST /api/files/batch-copy', () => {
  it('returns 202 and jobId for valid batch-copy', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `files-copy-${Date.now()}`,
    });
    await grantHomePermission({ userId: user.id, homeNodeId, permission: 'write' });

    const res = await request(app)
      .post('/api/files/batch-copy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        copies: [
          { sourceNodeId: 1, destinationParentNodeId: 2 },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
  });
});

describe('GET /api/files/bulk-operation/:jobId', () => {
  it('returns 404 for non-existent job', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-job2-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/files/bulk-operation/nonexistent-job-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('PUT /api/files/rename', () => {
  it.skip('returns 403 when using share token (share is read-only) — requires Phase 5 shareLinkStore', async () => {
    // Share link creation requires shareLinkStore migration (Phase 5)
  });

  it('returns 400 when oldPath or newName missing', async () => {
    const missingNewName = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeId: testFileNodeId });

    expect(missingNewName.status).toBe(400);
    expect(missingNewName.body.errorCode).toBe(SERVER_ERROR_CODES.files.sourceDestRequired);

    const missingOldPath = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ newName: 'b.txt' });

    expect(missingOldPath.status).toBe(400);
    expect(missingOldPath.body.errorCode).toBe(SERVER_ERROR_CODES.files.sourceDestRequired);
  });

  it('returns 200 when renamed successfully', async () => {
    webdavMock.pathExists.mockResolvedValue(false);

    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        nodeId: testFileNodeId,
        newName: 'renamed.txt',
      });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.files.renameSuccess);
    expect(res.body.newName).toBe('renamed.txt');
  });
});

describe('POST /api/files/check-conflicts', () => {
  it('returns 200 with conflicts array', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `files-conflicts-${Date.now()}`,
    });
    await grantHomePermission({ userId: user.id, homeNodeId, permission: 'write' });

    const res = await request(app)
      .post('/api/files/check-conflicts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [
          {
            sourcePath: `/${user.username}/a.txt`,
            destinationPath: `/${user.username}/b.txt`,
            type: 'move',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conflicts)).toBe(true);
  });
});

describe('POST /api/files/metadata', () => {
  it('returns 200 with metadata array when authenticated', async () => {
    const res = await request(app)
      .post('/api/files/metadata')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [homeNodeId] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it.skip('returns 200 with metadata when using X-Share-Token — requires Phase 5 shareLinkStore', async () => {
    // Share link creation requires shareLinkStore migration (Phase 5)
  });
});

describe('POST /api/files/download-multiple', () => {
  it('returns 400 when paths is empty array', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-dl-multi-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/files/download-multiple')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with zip content for valid paths', async () => {
    const res = await request(app)
      .post('/api/files/download-multiple')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [testFileNodeId] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
  });

  it('returns 403 when user has no read permission on any path', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-dl-multi-403-${Date.now()}`,
    });

    const res = await request(app)
      .post('/api/files/download-multiple')
      .set('Authorization', `Bearer ${token}`)
      .send({ nodeIds: [999] });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/files/bulk-operation/:jobId/cancel', () => {
  it('returns 200 with messageCode and jobId', async () => {
    const { user, token, homeNodeId } = await createUserWithHomeNode({
      username: `files-cancel-${Date.now()}`,
    });
    await grantHomePermission({ userId: user.id, homeNodeId, permission: 'write' });

    const moveRes = await request(app)
      .post('/api/files/batch-move')
      .set('Authorization', `Bearer ${token}`)
      .send({
        moves: [
          { sourceNodeId: 1, destinationParentNodeId: 2 },
        ],
      });

    expect(moveRes.status).toBe(202);
    const jobId = moveRes.body.jobId;

    const cancelRes = await request(app)
      .post(`/api/files/bulk-operation/${jobId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.messageCode).toBe(SERVER_MESSAGE_CODES.files.cancelRequested);
    expect(cancelRes.body.jobId).toBe(jobId);
  });
});
