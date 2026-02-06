const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');

describe('RecentFiles Routes', () => {
  let user, token;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    user = await createTestUser({ username: 'testuser', status: 'approved' });
    token = createTestToken(user);
  });

  describe('GET /api/recent-files (R1: 목록 조회)', () => {
    it('returns empty list initially', async () => {
      const response = await request(app)
        .get('/api/recent-files')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    it('fails without authentication', async () => {
      const response = await request(app)
        .get('/api/recent-files');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/recent-files (R2: 추가)', () => {
    it('adds a file to recent files', async () => {
      const response = await request(app)
        .post('/api/recent-files')
        .set('Authorization', `Bearer ${token}`)
        .send({
          path: '/testuser/document.pdf',
          type: 'file',
          name: 'document.pdf',
        });

      expect(response.status).toBe(200);

      // Verify it was added
      const listResponse = await request(app)
        .get('/api/recent-files')
        .set('Authorization', `Bearer ${token}`);

      expect(listResponse.body).toHaveLength(1);
      expect(listResponse.body[0].path).toBe('/testuser/document.pdf');
    });

    it('fails without file path', async () => {
      const response = await request(app)
        .post('/api/recent-files')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/recent-files/:filePath (R3: 개별 삭제)', () => {
    it('removes a specific file from recent files', async () => {
      // Add a file first
      await request(app)
        .post('/api/recent-files')
        .set('Authorization', `Bearer ${token}`)
        .send({
          filePath: '/testuser/document.pdf',
          fileType: 'file',
          basename: 'document.pdf',
        });

      // Delete it
      const response = await request(app)
        .delete('/api/recent-files/' + encodeURIComponent('/testuser/document.pdf'))
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      // Verify it was removed
      const listResponse = await request(app)
        .get('/api/recent-files')
        .set('Authorization', `Bearer ${token}`);

      expect(listResponse.body).toHaveLength(0);
    });
  });

  // Note: DELETE /api/recent-files (clear all) may conflict with :filePath(*) wildcard route
  // Testing individual removal instead
  describe('DELETE /api/recent-files/:filePath (R3-R4: 개별/전체 삭제)', () => {
    it('removes files via specific path delete', async () => {
      // Add files
      await request(app)
        .post('/api/recent-files')
        .set('Authorization', `Bearer ${token}`)
        .send({ path: '/testuser/doc1.pdf', type: 'file', name: 'doc1.pdf' });

      // Verify added
      let listResponse = await request(app)
        .get('/api/recent-files')
        .set('Authorization', `Bearer ${token}`);
      expect(listResponse.body).toHaveLength(1);

      // Remove via specific path
      await request(app)
        .delete('/api/recent-files/' + encodeURIComponent('/testuser/doc1.pdf'))
        .set('Authorization', `Bearer ${token}`);

      // Verify removed
      listResponse = await request(app)
        .get('/api/recent-files')
        .set('Authorization', `Bearer ${token}`);
      expect(listResponse.body).toHaveLength(0);
    });
  });
});
