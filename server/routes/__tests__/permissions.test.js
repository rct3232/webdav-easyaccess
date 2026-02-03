const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');
const Permission = require('../../models/Permission');

// Mock webdav
jest.mock('../../utils/webdav', () => ({
  pathExists: jest.fn().mockResolvedValue(true),
  testConnection: jest.fn().mockResolvedValue({ success: true }),
}));

describe('Permission Routes', () => {
  let admin, user1, user2, adminToken, user1Token;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    
    admin = await createTestUser({ username: 'admin', isAdmin: true });
    user1 = await createTestUser({ username: 'user1' });
    user2 = await createTestUser({ username: 'user2' });
    
    adminToken = createTestToken(admin);
    user1Token = createTestToken(user1);
  });

  describe('POST /api/permissions/grant', () => {
    it('allows owner to grant permission', async () => {
      // user1 is owner of /user1 folder by default policy
      const response = await request(app)
        .post('/api/permissions/grant')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          userId: user2.id,
          folderPath: '/user1/shared',
          permission: 'read'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('successfully');
      
      const perms = await Permission.getUserPermissions(user2.id);
      expect(perms).toHaveLength(1);
      expect(perms[0].folder_path).toBe('/user1/shared');
    });

    it('prevents non-owner from granting permission', async () => {
      const response = await request(app)
        .post('/api/permissions/grant')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          userId: admin.id,
          folderPath: '/user2/secret',
          permission: 'read'
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/permissions/check', () => {
    it('returns correct permission status', async () => {
      await Permission.grant(user1.id, '/shared', 'read');

      const response = await request(app)
        .get('/api/permissions/check')
        .set('Authorization', `Bearer ${user1Token}`)
        .query({ path: '/shared' });

      expect(response.status).toBe(200);
      expect(response.body.hasRead).toBe(true);
      expect(response.body.hasWrite).toBe(false);
    });
  });

  describe('DELETE /api/permissions/revoke', () => {
    it('allows owner to revoke permission', async () => {
      await Permission.grant(user2.id, '/user1/shared', 'read');

      const response = await request(app)
        .delete('/api/permissions/revoke')
        .set('Authorization', `Bearer ${user1Token}`)
        .query({
          userId: user2.id,
          folderPath: '/user1/shared'
        });

      expect(response.status).toBe(200);
      const perms = await Permission.getUserPermissions(user2.id);
      expect(perms).toHaveLength(0);
    });
  });
});
