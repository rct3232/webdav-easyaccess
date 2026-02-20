/**
 * Auth routes integration tests.
 * @see docs/spec/server/routes/auth.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  createAuthenticatedTestUser,
  USER_STATUS,
} = require('../../test-utils');
const Settings = require('../../models/Settings');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

jest.mock('../../utils/email', () => ({
  sendRegistrationPendingEmail: jest.fn().mockResolvedValue(undefined),
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('POST /api/auth/register', () => {
  beforeEach(async () => {
    await Settings.set('registration_enabled', 'true');
  });

  it('returns 201 and user on success', async () => {
    const username = `reg-${Date.now()}`;
    const email = `reg-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      messageCode: expect.any(String),
      status: USER_STATUS.PENDING,
      user: { username, email, status: USER_STATUS.PENDING },
    });
    expect(res.body.user.id).toBeDefined();
  });

  it('returns 403 when registration is disabled', async () => {
    await Settings.set('registration_enabled', 'false');
    const username = `reg-disabled-${Date.now()}`;
    const email = `reg-disabled-${Date.now()}@example.com`;

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'user', email: 'a@b.com' }); // no password

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 400 when username taken', async () => {
    const user = await createTestUser({ username: 'takenuser', email: 'taken@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: user.username, email: 'other@example.com', password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toMatch(/usernameTaken|requiredFields/);
  });

  it('returns 400 when email already taken', async () => {
    const existing = await createTestUser({
      username: `existing-${Date.now()}`,
      email: 'taken-email@example.com',
    });
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: `newuser-${Date.now()}`,
        email: existing.email,
        password: 'pass123',
      });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.auth.emailTaken);
  });

  it('returns 400 with errorCode when both username and email taken', async () => {
    const existing = await createTestUser({
      username: 'dualtakenuser',
      email: 'dualtaken@example.com',
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: existing.username,
        email: existing.email,
        password: 'pass123',
      });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
    expect(
      [SERVER_ERROR_CODES.auth.usernameTaken, SERVER_ERROR_CODES.auth.emailTaken].includes(res.body.errorCode)
    ).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  it('returns token and user on success', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `login-${Date.now()}`,
      password: 'secret123',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toMatchObject({
      id: user.id,
      username: user.username,
      email: user.email,
      status: USER_STATUS.APPROVED,
    });
  });

  it('returns 401 on invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 403 when user is pending', async () => {
    const user = await createTestUser({
      username: `pending-${Date.now()}`,
      password: 'pass123',
      status: USER_STATUS.PENDING,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'pass123' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
    expect(res.body.status).toBe(USER_STATUS.PENDING);
  });

  it('returns 400 when credentials missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'u' }); // no password

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 403 when user status is REJECTED', async () => {
    const user = await createTestUser({
      username: `rejected-${Date.now()}`,
      password: 'pass123',
      status: USER_STATUS.REJECTED,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'pass123' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.auth.rejected);
    expect(res.body.status).toBe(USER_STATUS.REJECTED);
  });

  it('returns 429 when rate limit exceeded', async () => {
    const isolatedIp = `10.0.0.${Date.now() % 256}`;
    let got429 = false;
    const limit = 20;
    for (let i = 0; i < limit + 1; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', isolatedIp)
        .send({ username: 'nonexistent-rate-user', password: 'wrong' });

      if (i < limit) {
        expect(res.status).toBe(401);
      } else {
        expect(res.status).toBe(429);
        expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.auth.loginRateLimit);
        expect(res.headers['retry-after']).toBeDefined();
        expect(parseInt(res.headers['retry-after'], 10)).toBeGreaterThanOrEqual(1);
        got429 = true;
      }
    }
    expect(got429).toBe(true);
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns new token when refresh token valid', async () => {
    const { user } = await createAuthenticatedTestUser({
      username: `refresh-${Date.now()}`,
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'password123' });
    const refreshToken = loginRes.body.refreshToken;

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
  });

  it('returns 401 when refresh token invalid', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 401 when refreshToken empty or missing', async () => {
    const emptyRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: '' });

    expect(emptyRes.status).toBe(401);
    expect(emptyRes.body.errorCode).toBeDefined();

    const missingRes = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(missingRes.status).toBe(401);
    expect(missingRes.body.errorCode).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  it('returns user when authenticated', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `me-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      username: user.username,
      email: user.email,
    });
  });

  it('returns 401 when no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 or 403 when invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.jwt');
    expect([401, 403]).toContain(res.status);
    expect(res.body.errorCode).toBeDefined();
  });
});
