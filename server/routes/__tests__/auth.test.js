const request = require('supertest');
const app = require('../../index');
const { resetTestStore, teardownTestStore, createTestUser } = require('../../test-utils');
const Settings = require('../../models/Settings');
const User = require('../../models/User');

// Mock email service
jest.mock('../../utils/email', () => ({
  sendRegistrationPendingEmail: jest.fn().mockResolvedValue({ success: true }),
  sendApprovalEmail: jest.fn().mockResolvedValue({ success: true }),
  sendRejectionEmail: jest.fn().mockResolvedValue({ success: true }),
  isEmailEnabled: jest.fn().mockReturnValue(true),
}));

describe('Auth Routes', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
    // Default registration enabled for tests
    await Settings.set('registration_enabled', 'true');
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'newuser',
          email: 'new@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('회원가입이 완료되었습니다');
      expect(response.body.user.username).toBe('newuser');
      expect(response.body.user.status).toBe('pending');
    });

    it('fails when registration is disabled', async () => {
      await Settings.set('registration_enabled', 'false');

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'newuser',
          email: 'new@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('회원가입이 비활성화');
    });

    it('fails with missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'newuser'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('모두 입력해주세요');
    });
  });

  describe('POST /api/auth/login', () => {
    it('successfully logs in an approved user', async () => {
      // Create and approve user
      const user = await createTestUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        status: 'approved'
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.username).toBe('testuser');
    });

    it('fails to log in a pending user', async () => {
      await createTestUser({
        username: 'pendinguser',
        status: 'pending'
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'pendinguser',
          password: 'password123'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('승인 대기 중');
    });

    it('fails with wrong credentials', async () => {
      await createTestUser({
        username: 'testuser',
        password: 'password123',
        status: 'approved'
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('올바르지 않습니다');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user info when authenticated', async () => {
      const user = await createTestUser({
        username: 'testuser',
        status: 'approved'
      });

      // Login to get token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'password123'
        });
      const token = loginRes.body.token;

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.username).toBe('testuser');
    });

    it('fails without token', async () => {
      const response = await request(app).get('/api/auth/me');
      expect(response.status).toBe(401);
    });
  });
});
