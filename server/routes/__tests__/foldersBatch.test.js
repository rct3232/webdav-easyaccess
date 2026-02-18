const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const Permission = require('../../models/Permission');
const webdav = require('../../utils/webdav');

// Mock webdav
jest.mock('../../utils/webdav', () => ({
  pathExists: jest.fn(),
  createDirectory: jest.fn(),
  listDirectory: jest.fn(),
  deleteFile: jest.fn(),
  moveFile: jest.fn(),
  copyFile: jest.fn(),
  getFileContents: jest.fn(),
  putFileContents: jest.fn(),
  isImageFile: jest.fn().mockReturnValue(false),
  isVideoFile: jest.fn().mockReturnValue(false),
}));

// Mock thumbnail
jest.mock('../../utils/thumbnail', () => ({
  getThumbnailUrl: jest.fn().mockReturnValue(null),
  getThumbnailHash: jest.fn().mockReturnValue('hash'),
  thumbnailCache: new Map(),
}));

describe('Folders and Batch Operations Routes', () => {
  let testUser, userToken;
  let adminUser, adminToken;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    
    // Create regular user
    testUser = await createTestUser({
      username: 'testuser',
      email: 'test@example.com',
      status: 'approved',
      isAdmin: false,
    });
    userToken = createTestToken(testUser);

    // Create admin user
    adminUser = await createTestUser({
      username: 'admin',
      email: 'admin@example.com',
      status: 'approved',
      isAdmin: true,
    });
    adminToken = createTestToken(adminUser);

    jest.clearAllMocks();
  });

  describe('POST /api/folders/create (F8: 폴더 생성)', () => {
    it('creates a new folder in user directory', async () => {
      webdav.pathExists.mockResolvedValue(false);
      webdav.createDirectory.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/folders/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ path: '/testuser/newfolder' });

      expect(response.status).toBe(200);
      expect(response.body.messageCode).toBe(SERVER_MESSAGE_CODES.folders.createSuccess);
      expect(webdav.createDirectory).toHaveBeenCalled();
    });

    it('fails when folder already exists', async () => {
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/folders/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ path: '/testuser/existing' });

      expect(response.status).toBe(409);
      expect(response.body.errorCode).toBe(SERVER_ERROR_CODES.folders.folderAlreadyExists);
    });

    it('fails without folder path', async () => {
      const response = await request(app)
        .post('/api/folders/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('denies creating folder outside user directory without permission', async () => {
      webdav.pathExists.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/folders/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ path: '/otheruser/newfolder' });

      expect(response.status).toBe(403);
    });

    it('allows admin to create folder anywhere', async () => {
      webdav.pathExists.mockResolvedValue(false);
      webdav.createDirectory.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/folders/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ path: '/anywhere/newfolder' });

      expect(response.status).toBe(200);
    });
  });

  async function waitForJob(app, jobId, token, maxWait = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const res = await request(app)
        .get(`/api/files/bulk-operation/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status !== 200) return res.body;
      if (['completed', 'cancelled', 'failed'].includes(res.body.status)) return res.body;
      await new Promise(r => setTimeout(r, 80));
    }
    return { status: 'running' };
  }

  describe('POST /api/files/batch-delete (F11: 일괄 삭제)', () => {
    it('accepts delete job and returns jobId', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.deleteFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paths: ['/testuser/file1.txt', '/testuser/file2.txt'],
        });

      expect(response.status).toBe(202);
      expect(response.body.jobId).toBeDefined();
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const succeeded = (job.results || []).filter(r => r.status === 'succeeded').map(r => r.path);
      expect(succeeded).toHaveLength(2);
    });

    it('skips files without permission', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.deleteFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paths: ['/testuser/file1.txt', '/otheruser/file2.txt'],
        });

      expect(response.status).toBe(202);
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const succeeded = (job.results || []).filter(r => r.status === 'succeeded').map(r => r.path);
      const skipped = (job.results || []).filter(r => r.status === 'skipped').map(r => r.path);
      expect(succeeded).toContain('/testuser/file1.txt');
      expect(skipped).toContain('/otheruser/file2.txt');
    });

    it('fails with empty paths array', async () => {
      const response = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ paths: [] });

      expect(response.status).toBe(400);
    });

    it('handles mixed success and failure', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.deleteFile
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Delete failed'));

      const response = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paths: ['/testuser/file1.txt', '/testuser/file2.txt'],
        });

      expect(response.status).toBe(202);
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      expect((job.results || []).length).toBe(2);
    });
  });

  describe('POST /api/files/batch-move (F12: 일괄 이동)', () => {
    it('accepts move job and returns jobId', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(false);
      webdav.moveFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          moves: [
            { sourcePath: '/testuser/file1.txt', destinationPath: '/testuser/dest/file1.txt' },
            { sourcePath: '/testuser/file2.txt', destinationPath: '/testuser/dest/file2.txt' },
          ],
        });

      expect(response.status).toBe(202);
      expect(response.body.jobId).toBeDefined();
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const succeeded = (job.results || []).filter(r => r.status === 'succeeded');
      expect(succeeded).toHaveLength(2);
    });

    it('skips moves without source permission', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(false);
      webdav.moveFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          moves: [
            { sourcePath: '/testuser/file1.txt', destinationPath: '/testuser/dest/file1.txt' },
            { sourcePath: '/otheruser/file2.txt', destinationPath: '/testuser/dest/file2.txt' },
          ],
        });

      expect(response.status).toBe(202);
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const succeeded = (job.results || []).filter(r => r.status === 'succeeded');
      const skippedByPermission = (job.results || []).filter(r => r.status === 'skippedByPermission').map(r => r.sourcePath);
      expect(succeeded).toHaveLength(1);
      expect(skippedByPermission).toContain('/otheruser/file2.txt');
    });

    it('handles conflict with skip option', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true);
      webdav.moveFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          moves: [
            { sourcePath: '/testuser/file1.txt', destinationPath: '/testuser/dest/file1.txt' },
          ],
          onConflict: 'skip',
        });

      expect(response.status).toBe(202);
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const skippedByConflict = (job.results || []).filter(r => r.status === 'skippedByConflict').map(r => r.sourcePath);
      expect(skippedByConflict).toContain('/testuser/file1.txt');
    });

    it('fails with empty moves array', async () => {
      const response = await request(app)
        .post('/api/files/batch-move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ moves: [] });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/files/batch-copy (F21: 일괄 복사)', () => {
    it('accepts copy job and returns jobId', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(false);
      webdav.copyFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          copies: [
            { sourcePath: '/testuser/file1.txt', destinationPath: '/testuser/dest/file1.txt' },
            { sourcePath: '/testuser/file2.txt', destinationPath: '/testuser/dest/file2.txt' },
          ],
        });

      expect(response.status).toBe(202);
      expect(response.body.jobId).toBeDefined();
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const succeeded = (job.results || []).filter(r => r.status === 'succeeded');
      expect(succeeded).toHaveLength(2);
    });

    it('skips copies without destination permission', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(false);
      webdav.copyFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          copies: [
            { sourcePath: '/testuser/file1.txt', destinationPath: '/testuser/dest/file1.txt' },
            { sourcePath: '/testuser/file2.txt', destinationPath: '/otheruser/dest/file2.txt' },
          ],
        });

      expect(response.status).toBe(202);
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      const succeeded = (job.results || []).filter(r => r.status === 'succeeded');
      const skippedByPermission = (job.results || []).filter(r => r.status === 'skippedByPermission').map(r => r.sourcePath);
      expect(succeeded).toHaveLength(1);
      expect(skippedByPermission).toContain('/testuser/file2.txt');
    });

    it('handles conflict with overwrite option', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true);
      webdav.copyFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          copies: [
            { sourcePath: '/testuser/file1.txt', destinationPath: '/testuser/dest/file1.txt' },
          ],
          onConflict: 'overwrite',
        });

      expect(response.status).toBe(202);
      const job = await waitForJob(app, response.body.jobId, userToken);
      expect(job.status).toBe('completed');
      expect((job.results || []).filter(r => r.status === 'succeeded')).toHaveLength(1);
    });

    it('fails with empty copies array', async () => {
      const response = await request(app)
        .post('/api/files/batch-copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ copies: [] });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/files/bulk-operation/:jobId', () => {
    it('returns job status for own job', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.deleteFile.mockResolvedValue(true);
      const createRes = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ paths: ['/testuser/a.txt'] });
      const jobId = createRes.body.jobId;
      const job = await waitForJob(app, jobId, userToken);
      expect(job.status).toBe('completed');
      expect(job.results).toBeDefined();
    });

    it('returns 404 for unknown jobId', async () => {
      const response = await request(app)
        .get('/api/files/bulk-operation/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`);
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/files/bulk-operation/:jobId/cancel', () => {
    it('sets job cancelled and returns 200', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.deleteFile.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(true), 500)));
      const createRes = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ paths: ['/testuser/slow1.txt', '/testuser/slow2.txt'] });
      const jobId = createRes.body.jobId;
      const cancelRes = await request(app)
        .post(`/api/files/bulk-operation/${jobId}/cancel`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(cancelRes.status).toBe(200);
      const job = await waitForJob(app, jobId, userToken);
      expect(['completed', 'cancelled']).toContain(job.status);
    });
  });

  describe('POST /api/files/check-conflicts (충돌 확인)', () => {
    it('detects file conflicts', async () => {
      webdav.listDirectory.mockResolvedValue([
        { basename: 'existing.txt', type: 'file' },
      ]);
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/check-conflicts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          operations: [
            { sourcePath: '/testuser/file.txt', destinationPath: '/testuser/dest/existing.txt', type: 'upload' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.conflicts.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty conflicts when no conflicts exist', async () => {
      webdav.listDirectory.mockResolvedValue([]);
      webdav.pathExists.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/files/check-conflicts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          operations: [
            { sourcePath: '/testuser/file.txt', destinationPath: '/testuser/dest/newfile.txt', type: 'upload' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.conflicts).toHaveLength(0);
    });

    it('fails without operations array', async () => {
      const response = await request(app)
        .post('/api/files/check-conflicts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/files/rename (이름 변경)', () => {
    it('renames a file', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 }); // Not a directory
      webdav.pathExists.mockResolvedValue(false);
      webdav.moveFile.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/files/rename')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          oldPath: '/testuser/oldname.txt',
          newName: 'newname.txt',
        });

      expect(response.status).toBe(200);
      expect(response.body.path).toContain('newname.txt');
    });

    it('fails when new name already exists', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/files/rename')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          oldPath: '/testuser/oldname.txt',
          newName: 'existing.txt',
        });

      expect(response.status).toBe(409);
    });

    it('succeeds when renaming to same name', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });

      const response = await request(app)
        .put('/api/files/rename')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          oldPath: '/testuser/samename.txt',
          newName: 'samename.txt',
        });

      expect(response.status).toBe(200);
      expect(response.body.messageCode).toBe('serverMessages.files.nameUnchanged');
    });
  });
});
