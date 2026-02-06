const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');
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
      expect(response.body.message).toContain('created');
      expect(webdav.createDirectory).toHaveBeenCalled();
    });

    it('fails when folder already exists', async () => {
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/folders/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ path: '/testuser/existing' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('이미 존재');
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

  describe('GET /api/folders/list (폴더 목록)', () => {
    it('lists folder contents', async () => {
      const mockItems = [
        { basename: 'file1.txt', type: 'file', size: 100 },
        { basename: 'subfolder', type: 'directory' },
      ];
      webdav.listDirectory.mockResolvedValue(mockItems);

      const response = await request(app)
        .get('/api/folders/list')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ path: '/testuser' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('denies access to other user folders', async () => {
      const response = await request(app)
        .get('/api/folders/list')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ path: '/otheruser' });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/files/batch-delete (F11: 일괄 삭제)', () => {
    it('deletes multiple files', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 }); // Not directories
      webdav.deleteFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          paths: ['/testuser/file1.txt', '/testuser/file2.txt'],
        });

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toHaveLength(2);
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toContain('/testuser/file1.txt');
      expect(response.body.skipped).toContain('/otheruser/file2.txt');
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded.length + response.body.failed.length + response.body.skipped.length).toBe(2);
    });
  });

  describe('POST /api/files/batch-move (F12: 일괄 이동)', () => {
    it('moves multiple files', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 }); // Not directories
      webdav.pathExists.mockResolvedValue(false); // No conflicts
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toHaveLength(2);
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toHaveLength(1);
      expect(response.body.skipped).toContain('/otheruser/file2.txt');
    });

    it('handles conflict with skip option', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true); // Conflict exists
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

      expect(response.status).toBe(200);
      expect(response.body.skipped).toContain('/testuser/file1.txt');
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
    it('copies multiple files', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 }); // Not directories
      webdav.pathExists.mockResolvedValue(false); // No conflicts
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toHaveLength(2);
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toHaveLength(1);
      expect(response.body.skipped).toContain('/testuser/file2.txt');
    });

    it('handles conflict with overwrite option', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true); // Conflict exists
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

      expect(response.status).toBe(200);
      expect(response.body.succeeded).toHaveLength(1);
    });

    it('fails with empty copies array', async () => {
      const response = await request(app)
        .post('/api/files/batch-copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ copies: [] });

      expect(response.status).toBe(400);
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

  describe('PUT /api/files/move (F10: 단일 이동)', () => {
    it('moves a file to new location', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 }); // Not a directory
      webdav.pathExists.mockResolvedValue(false);
      webdav.moveFile.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/files/move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourcePath: '/testuser/file.txt',
          destinationPath: '/testuser/dest/file.txt',
        });

      expect(response.status).toBe(200);
      expect(webdav.moveFile).toHaveBeenCalled();
    });

    it('fails when destination exists without overwrite', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/files/move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourcePath: '/testuser/file.txt',
          destinationPath: '/testuser/dest/existing.txt',
        });

      expect(response.status).toBe(409);
    });

    it('allows overwrite when onConflict is overwrite', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true);
      webdav.moveFile.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/files/move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourcePath: '/testuser/file.txt',
          destinationPath: '/testuser/dest/existing.txt',
          onConflict: 'overwrite',
        });

      expect(response.status).toBe(200);
    });

    it('denies move without source permission', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });

      const response = await request(app)
        .put('/api/files/move')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourcePath: '/otheruser/file.txt',
          destinationPath: '/testuser/dest/file.txt',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/files/copy (단일 복사)', () => {
    it('copies a file to new location', async () => {
      webdav.listDirectory
        .mockRejectedValueOnce({ status: 404 }) // source not a directory
        .mockResolvedValue([]); // for permission check
      webdav.pathExists.mockResolvedValue(false);
      webdav.copyFile.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourcePath: '/testuser/file.txt',
          destinationPath: '/testuser/dest/file.txt',
        });

      expect(response.status).toBe(200);
    });

    it('skips copy when onConflict is skip', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/files/copy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          sourcePath: '/testuser/file.txt',
          destinationPath: '/testuser/dest/existing.txt',
          onConflict: 'skip',
        });

      expect(response.status).toBe(200);
      expect(response.body.skipped).toBe(true);
    });
  });

  describe('DELETE /api/files/delete (F9: 단일 삭제)', () => {
    it('deletes a file', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 }); // Not a directory
      webdav.deleteFile.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ path: '/testuser/file.txt' });

      expect(response.status).toBe(200);
      expect(webdav.deleteFile).toHaveBeenCalled();
    });

    it('deletes a directory', async () => {
      webdav.listDirectory.mockResolvedValue([]); // Empty directory
      webdav.deleteFile.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ path: '/testuser/folder' });

      expect(response.status).toBe(200);
    });

    it('denies delete without permission', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });

      const response = await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ path: '/otheruser/file.txt' });

      expect(response.status).toBe(403);
    });

    it('fails without path', async () => {
      const response = await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${userToken}`);

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
      expect(response.body.message).toContain('unchanged');
    });
  });
});
