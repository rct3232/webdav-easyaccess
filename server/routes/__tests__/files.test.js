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
  grantTestPermission,
} = require('../../test-utils');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

var mockWebdav;
jest.mock('../../utils/webdav', () => {
  const { createWebdavMock } = require('../../testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});

mockWebdav.listDirectory.mockImplementation((path) => {
  const p = String(path).replace(/\/$/, '');
  if (p && /\.\w+$/.test(p)) {
    return Promise.reject(Object.assign(new Error('Not a directory'), { status: 404 }));
  }
  return Promise.resolve([
    { basename: 'file1.txt', type: 'file' },
    { basename: 'subdir', type: 'directory' },
  ]);
});
mockWebdav.pathExists.mockResolvedValue(true);
mockWebdav.getFileContents.mockResolvedValue(Buffer.from('content'));
mockWebdav.getFileMetadata.mockResolvedValue({ size: 7, lastmod: '2024-01-01', mime: 'text/plain' });
mockWebdav.isVideoFile.mockImplementation((filename) => String(filename).toLowerCase().endsWith('.mp4'));


let app;
let dbCleanup;

beforeAll(async () => {
  process.env.WEA_SKIP_BULK_WORKER = '1';
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
});

afterAll(async () => {
  delete process.env.WEA_SKIP_BULK_WORKER;
  await dbCleanup?.();
});

beforeEach(() => {
  mockWebdav.listDirectory.mockResolvedValue([
    { basename: 'file1.txt', type: 'file' },
    { basename: 'subdir', type: 'directory' },
  ]);
  mockWebdav.pathExists.mockResolvedValue(true);
  mockWebdav.getFileContents.mockResolvedValue(Buffer.from('content'));
  mockWebdav.isVideoFile.mockImplementation((filename) => String(filename).toLowerCase().endsWith('.mp4'));
});

describe('GET /api/files/list', () => {
  it('returns folder contents for authenticated user', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-list-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: `/${user.username}` });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body.items) || Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/files/list')
      .query({ path: '/docs' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has no read permission on path', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-list-403-${Date.now()}`,
    });
    // Path outside user's home with no granted permission
    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: '/other-user/no-access' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with items when admin lists folder (admin bypass)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-list-admin-${Date.now()}`,
      isAdmin: true,
    });

    const res = await request(app)
      .get('/api/files/list')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: `/${user.username}` });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body.items) || Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/files/download', () => {
  it('returns file content for user with permission', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-dl-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: `/${user.username}/file1.txt` });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/files/download')
      .query({ path: '/docs/file.txt' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has no read permission on file path', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `files-dl-403-${Date.now()}`,
    });
    const res = await request(app)
      .get('/api/files/download')
      .set('Authorization', `Bearer ${token}`)
      .query({ path: '/other-user/no-access/file.txt' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/files/preview-ticket', () => {
  it('returns a ticket for video file when user has permission', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-preview-ticket-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const res = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: `/${user.username}/video.mp4` });

    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
    expect(typeof res.body.ticket).toBe('string');
  });

  it('returns 400 when file is not video', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-preview-ticket-nv-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const res = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: `/${user.username}/not-video.txt` });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.previewNotVideo);
  });
});

describe('GET /api/files/preview-stream', () => {
  it('streams video inline with valid ticket', async () => {
    mockWebdav.getFileContents.mockResolvedValueOnce(Buffer.from('video-content'));

    const { user, token } = await createAuthenticatedTestUser({
      username: `files-preview-stream-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const ticketRes = await request(app)
      .post('/api/files/preview-ticket')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: `/${user.username}/video.mp4` });

    expect(ticketRes.status).toBe(200);
    const ticket = ticketRes.body.ticket;

    const res = await request(app)
      .get('/api/files/preview-stream')
      .query({ path: `/${user.username}/video.mp4`, ticket });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-type']).toContain('video/');
  });

  it('returns 403 for invalid ticket', async () => {
    const res = await request(app)
      .get('/api/files/preview-stream')
      .query({ path: '/any/video.mp4', ticket: 'nope' });

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
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-batch-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const res = await request(app)
      .post('/api/files/batch-move')
      .set('Authorization', `Bearer ${token}`)
      .send({
        moves: [
          { sourcePath: `/${user.username}/a.txt`, destinationPath: `/${user.username}/b.txt` },
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
      .field('path', '/other-user/no-write')
      .attach('file', Buffer.from('x'), 'test.txt');

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('accepts multipart upload and returns 200', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-upload-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    // Simulate new file upload: destination file does not exist yet.
    mockWebdav.pathExists.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('path', `/${user.username}`)
      .attach('file', Buffer.from('test content'), 'test.txt');

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });
});

describe('POST /api/files/batch-delete', () => {
  it('returns 202 and jobId for valid batch-delete', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-del-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const res = await request(app)
      .post('/api/files/batch-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ paths: [`/${user.username}/a.txt`, `/${user.username}/subdir`] });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
  });

  it('returns 403 when paths include meta path for non-admin', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-del-403-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const res = await request(app)
      .post('/api/files/batch-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ paths: [`/${user.username}/a.txt`, '/.wea/permissions/x'] });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/files/batch-copy', () => {
  it('returns 202 and jobId for valid batch-copy', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-copy-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const res = await request(app)
      .post('/api/files/batch-copy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        copies: [
          { sourcePath: `/${user.username}/a.txt`, destinationPath: `/${user.username}/copy.txt` },
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
  it('returns 403 when using share token (share is read-only)', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-rename-share-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/file1.txt`, expiresInDays: 7 });
    expect(createRes.status).toBe(200);
    const shareToken = createRes.body.token;

    const res = await request(app)
      .put('/api/files/rename')
      .set('X-Share-Token', shareToken)
      .send({
        oldPath: `/${user.username}/file1.txt`,
        newName: 'renamed.txt',
      });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 400 when oldPath or newName missing', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-rename-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const missingNewName = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPath: `/${user.username}/a.txt` });

    expect(missingNewName.status).toBe(400);
    expect(missingNewName.body.errorCode).toBe(SERVER_ERROR_CODES.files.sourceDestRequired);

    const missingOldPath = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ newName: 'b.txt' });

    expect(missingOldPath.status).toBe(400);
    expect(missingOldPath.body.errorCode).toBe(SERVER_ERROR_CODES.files.sourceDestRequired);
  });

  it('returns 200 when renamed successfully', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-rename-ok-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    mockWebdav.pathExists.mockResolvedValue(false);

    const res = await request(app)
      .put('/api/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({
        oldPath: `/${user.username}/file1.txt`,
        newName: 'renamed.txt',
      });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBe(SERVER_MESSAGE_CODES.files.renameSuccess);
    expect(res.body.path).toContain('renamed.txt');
  });
});

describe('POST /api/files/check-conflicts', () => {
  it('returns 200 with conflicts array', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-conflicts-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

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
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-meta-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const res = await request(app)
      .post('/api/files/metadata')
      .set('Authorization', `Bearer ${token}`)
      .send({ paths: [`/${user.username}/file1.txt`] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 200 with metadata when using X-Share-Token', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-meta-share-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ filePath: `/${user.username}/file1.txt`, expiresInDays: 7 });

    expect(createRes.status).toBe(200);
    const shareToken = createRes.body.token;

    const res = await request(app)
      .post('/api/files/metadata')
      .set('X-Share-Token', shareToken)
      .send({ paths: [`/${user.username}/file1.txt`] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
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
      .send({ paths: [] });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with zip content for valid paths', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-dl-multi-ok-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'read');

    const res = await request(app)
      .post('/api/files/download-multiple')
      .set('Authorization', `Bearer ${token}`)
      .send({ paths: [`/${user.username}/file1.txt`] });

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
      .send({ paths: ['/other-user/no-access/file.txt'] });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('POST /api/files/bulk-operation/:jobId/cancel', () => {
  it('returns 200 with messageCode and jobId', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `files-cancel-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const moveRes = await request(app)
      .post('/api/files/batch-move')
      .set('Authorization', `Bearer ${token}`)
      .send({
        moves: [
          { sourcePath: `/${user.username}/a.txt`, destinationPath: `/${user.username}/b.txt` },
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
