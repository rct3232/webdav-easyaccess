const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');
const ShareLink = require('../../models/ShareLink');
const webdav = require('../../utils/webdav');

// Mock webdav
jest.mock('../../utils/webdav', () => ({
  pathExists: jest.fn(),
  getFileContents: jest.fn(),
  listDirectory: jest.fn(),
}));

describe('ShareLink Routes', () => {
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

  describe('POST /api/share-links (S1: 공유 링크 생성)', () => {
    it('creates a share link successfully', async () => {
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/share-links')
        .set('Authorization', `Bearer ${token}`)
        .send({
          filePath: '/testuser/document.pdf',
          expiresInDays: 7,
        });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.filePath).toBe('/testuser/document.pdf');
      expect(response.body.expiresAt).toBeDefined();
    });

    it('creates a share link with no expiration', async () => {
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/share-links')
        .set('Authorization', `Bearer ${token}`)
        .send({
          filePath: '/testuser/document.pdf',
          expiresInDays: null,
        });

      expect(response.status).toBe(200);
      expect(response.body.expiresAt).toBeNull();
    });

    it('fails if file path is missing', async () => {
      const response = await request(app)
        .post('/api/share-links')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('File path is required');
    });

    it('fails if file does not exist', async () => {
      webdav.pathExists.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/share-links')
        .set('Authorization', `Bearer ${token}`)
        .send({
          filePath: '/testuser/nonexistent.pdf',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('fails without authentication', async () => {
      const response = await request(app)
        .post('/api/share-links')
        .send({
          filePath: '/testuser/document.pdf',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/share-links (목록 조회)', () => {
    it('returns list of share links created by user', async () => {
      // Create some share links directly
      webdav.pathExists.mockResolvedValue(true);
      await ShareLink.create('/testuser/file1.pdf', user.id, 7);
      await ShareLink.create('/testuser/file2.pdf', user.id, null);

      const response = await request(app)
        .get('/api/share-links')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('token');
      expect(response.body[0]).toHaveProperty('filePath');
      expect(response.body[0]).toHaveProperty('isExpired');
    });

    it('returns empty list for user with no share links', async () => {
      const response = await request(app)
        .get('/api/share-links')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('DELETE /api/share-links/:token (링크 삭제)', () => {
    it('deletes a share link successfully', async () => {
      const link = await ShareLink.create('/testuser/file.pdf', user.id, 7);

      const response = await request(app)
        .delete(`/api/share-links/${link.token}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      // Verify deletion
      const deleted = await ShareLink.findByToken(link.token);
      expect(deleted).toBeNull();
    });

    it('fails to delete another user\'s share link', async () => {
      const otherUser = await createTestUser({ username: 'otheruser', status: 'approved' });
      const link = await ShareLink.create('/otheruser/file.pdf', otherUser.id, 7);

      const response = await request(app)
        .delete(`/api/share-links/${link.token}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });
});

describe('SharePublic Routes (공개 접근)', () => {
  let user, shareLink;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    user = await createTestUser({ username: 'testuser', status: 'approved' });
    shareLink = await ShareLink.create('/testuser/document.pdf', user.id, 7);
    jest.clearAllMocks();
  });

  describe('GET /api/share/:token/info (S5: 공유 링크 정보)', () => {
    it('returns share link info without authentication', async () => {
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .get(`/api/share/${shareLink.token}/info`);

      expect(response.status).toBe(200);
      expect(response.body.token).toBe(shareLink.token);
      expect(response.body.filePath).toBe('/testuser/document.pdf');
      expect(response.body.fileName).toBe('document.pdf');
    });

    it('returns 404 for invalid token', async () => {
      const response = await request(app)
        .get('/api/share/invalid-token/info');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('returns 410 for expired link (S7)', async () => {
      // Create an expired link
      const expiredLink = await ShareLink.create('/testuser/old.pdf', user.id, -1);
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .get(`/api/share/${expiredLink.token}/info`);

      expect(response.status).toBe(410);
      expect(response.body.error).toContain('expired');
    });

    it('returns 404 if file no longer exists', async () => {
      webdav.pathExists.mockResolvedValue(false);

      const response = await request(app)
        .get(`/api/share/${shareLink.token}/info`);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('File not found');
    });
  });

  describe('GET /api/share/:token (S6: 공유 링크 다운로드)', () => {
    it('downloads file without authentication', async () => {
      webdav.pathExists.mockResolvedValue(true);
      webdav.getFileContents.mockResolvedValue(Buffer.from('file content'));

      const response = await request(app)
        .get(`/api/share/${shareLink.token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.body.toString()).toBe('file content');
    });

    it('increments download count on download', async () => {
      webdav.pathExists.mockResolvedValue(true);
      webdav.getFileContents.mockResolvedValue(Buffer.from('file content'));

      const initialCount = shareLink.downloadCount;

      await request(app).get(`/api/share/${shareLink.token}`);

      const updated = await ShareLink.findByToken(shareLink.token);
      expect(updated.downloadCount).toBe(initialCount + 1);
    });

    it('returns 404 for invalid token', async () => {
      const response = await request(app)
        .get('/api/share/invalid-token');

      expect(response.status).toBe(404);
    });

    it('returns 410 for expired link', async () => {
      const expiredLink = await ShareLink.create('/testuser/old.pdf', user.id, -1);
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .get(`/api/share/${expiredLink.token}`);

      expect(response.status).toBe(410);
      expect(response.body.error).toContain('expired');
    });
  });

  describe('GET /api/share/:token/preview (미리보기)', () => {
    it('previews file without authentication', async () => {
      webdav.pathExists.mockResolvedValue(true);
      webdav.getFileContents.mockResolvedValue(Buffer.from('file content'));

      const response = await request(app)
        .get(`/api/share/${shareLink.token}/preview`);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('inline');
    });
  });
});
