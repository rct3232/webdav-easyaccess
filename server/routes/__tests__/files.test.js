const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');
const webdav = require('../../utils/webdav');

// Mock webdav
jest.mock('../../utils/webdav', () => ({
  listDirectory: jest.fn(),
  getFileContents: jest.fn(),
  putFileContents: jest.fn(),
  deleteFile: jest.fn(),
  moveFile: jest.fn(),
  copyFile: jest.fn(),
  pathExists: jest.fn(),
  isImageFile: jest.fn().mockReturnValue(false),
  isVideoFile: jest.fn().mockReturnValue(false),
  testConnection: jest.fn().mockResolvedValue({ success: true }),
}));

describe('Files Routes', () => {
  let user, token;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    user = await createTestUser({ username: 'testuser', status: 'approved' });
    token = createTestToken(user);
    jest.clearAllMocks();
  });

  describe('GET /api/files/list', () => {
    it('lists files for user directory', async () => {
      const mockItems = [
        { basename: 'file1.txt', type: 'file', size: 100 },
        { basename: 'dir1', type: 'directory' }
      ];
      webdav.listDirectory.mockResolvedValue(mockItems);

      const response = await request(app)
        .get('/api/files/list')
        .set('Authorization', `Bearer ${token}`)
        .query({ path: '/testuser' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].basename).toBe('file1.txt');
    });

    it('prevents access to other user directory without permission', async () => {
      const response = await request(app)
        .get('/api/files/list')
        .set('Authorization', `Bearer ${token}`)
        .query({ path: '/otheruser' });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/files/download', () => {
    it('downloads a file from user directory', async () => {
      webdav.getFileContents.mockResolvedValue(Buffer.from('hello world'));

      const response = await request(app)
        .get('/api/files/download')
        .set('Authorization', `Bearer ${token}`)
        .query({ path: '/testuser/file.txt' });

      expect(response.status).toBe(200);
      expect(response.body.toString()).toBe('hello world');
      expect(response.header['content-disposition']).toContain('attachment');
    });
  });

  describe('POST /api/files/upload', () => {
    it('uploads a file to user directory', async () => {
      webdav.pathExists.mockResolvedValue(false);
      webdav.putFileContents.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('path', '/testuser')
        .attach('file', Buffer.from('new content'), 'new.txt');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('successfully');
      expect(webdav.putFileContents).toHaveBeenCalledWith('/testuser/new.txt', expect.any(Buffer));
    });
  });

  describe('POST /api/files/batch-delete', () => {
    it('accepts delete job and returns 202 with jobId', async () => {
      webdav.listDirectory.mockRejectedValue({ status: 404 });
      webdav.deleteFile.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/files/batch-delete')
        .set('Authorization', `Bearer ${token}`)
        .send({ paths: ['/testuser/file.txt'] });

      expect(response.status).toBe(202);
      expect(response.body.jobId).toBeDefined();
    });
  });
});
