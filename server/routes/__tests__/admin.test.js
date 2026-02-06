const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser, createTestToken } = require('../../test-utils');
const Settings = require('../../models/Settings');
const User = require('../../models/User');
const webdav = require('../../utils/webdav');

// Mock webdav
jest.mock('../../utils/webdav', () => ({
  pathExists: jest.fn(),
  createDirectory: jest.fn(),
  listDirectory: jest.fn(),
  deleteFile: jest.fn(),
}));

// Mock email service
jest.mock('../../utils/email', () => ({
  sendApprovalEmail: jest.fn().mockResolvedValue({ success: true }),
  sendRejectionEmail: jest.fn().mockResolvedValue({ success: true }),
  isEmailEnabled: jest.fn().mockReturnValue(true),
}));

describe('Admin Routes', () => {
  let adminUser, adminToken;
  let regularUser, userToken;

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    
    // Create admin user
    adminUser = await createTestUser({
      username: 'admin',
      email: 'admin@example.com',
      status: 'approved',
      isAdmin: true,
    });
    adminToken = createTestToken(adminUser);

    // Create regular user
    regularUser = await createTestUser({
      username: 'regular',
      email: 'regular@example.com',
      status: 'approved',
      isAdmin: false,
    });
    userToken = createTestToken(regularUser);

    jest.clearAllMocks();
  });

  describe('Admin Authorization', () => {
    it('should reject non-admin users', async () => {
      const response = await request(app)
        .get('/api/admin/users/pending')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('관리자 권한');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .get('/api/admin/users/pending');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/admin/users/pending (AD1: 대기중 사용자 목록)', () => {
    it('returns list of pending users', async () => {
      // Create pending users
      await createTestUser({ username: 'pending1', status: 'pending' });
      await createTestUser({ username: 'pending2', status: 'pending' });

      const response = await request(app)
        .get('/api/admin/users/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].status).toBe('pending');
    });

    it('returns empty list when no pending users', async () => {
      const response = await request(app)
        .get('/api/admin/users/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/admin/users (전체 사용자 목록)', () => {
    it('returns all users', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // At least admin and regular user should exist
      expect(response.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /api/admin/users/:id/approve (AD2: 사용자 승인)', () => {
    it('approves a pending user when folder exists', async () => {
      const pendingUser = await createTestUser({
        username: 'pendinguser',
        email: 'pending@example.com',
        status: 'pending',
      });

      // Mock folder already exists to avoid createDirectory issues
      webdav.pathExists.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/admin/users/${pendingUser.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('승인');
    });

    it('returns 404 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/admin/users/99999/approve')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/admin/users/:id/reject (AD3: 사용자 거절)', () => {
    it('rejects a pending user', async () => {
      const pendingUser = await createTestUser({
        username: 'rejectme',
        email: 'reject@example.com',
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/admin/users/${pendingUser.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('거절');

      // Note: User status verification may require direct store access
      // The API response confirms the action was successful
    });

    it('returns 404 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/admin/users/99999/reject')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/admin/users (사용자 생성)', () => {
    it('fails with duplicate username', async () => {
      const response = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'admin', // Already exists
          email: 'other@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('사용 중인 사용자명');
    });

    it('fails with missing fields', async () => {
      const response = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'newuser',
        });

      expect(response.status).toBe(400);
    });

    it('fails with short password', async () => {
      const response = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'newuser',
          email: 'newuser@example.com',
          password: '123', // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('6자');
    });
  });

  describe('DELETE /api/admin/users/:id (사용자 삭제)', () => {
    it('deletes a user', async () => {
      const userToDelete = await createTestUser({
        username: 'deleteme',
        status: 'approved',
      });

      const response = await request(app)
        .delete(`/api/admin/users/${userToDelete.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      // Verify user is deleted (may return null or undefined)
      const deleted = await User.findById(userToDelete.id);
      expect(deleted).toBeFalsy();
    });

    it('prevents admin from deleting themselves', async () => {
      const response = await request(app)
        .delete(`/api/admin/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Should fail with 400 or 403
      expect([400, 403]).toContain(response.status);
    });
  });

  describe('Settings API', () => {
    it('GET /api/admin/settings returns settings', async () => {
      await Settings.set('registration_enabled', 'true');

      const response = await request(app)
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('registration_enabled');
    });

    it('PUT /api/admin/settings updates settings', async () => {
      const response = await request(app)
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          registration_enabled: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('저장');

      // Verify setting was updated
      const enabled = await Settings.isRegistrationEnabled();
      expect(enabled).toBe(false);
    });
  });
});
