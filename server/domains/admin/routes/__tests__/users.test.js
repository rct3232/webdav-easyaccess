/**
 * Users routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/users.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createTestUser,
} = require('../../../../test-utils');

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../../index');
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/users', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns user array when authenticated', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `users-list-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((u) => u.username && u.id)).toBe(true);
  });
});

describe('GET /api/users/approved', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/users/approved');
    expect(res.status).toBe(401);
  });

  it('returns approved users array when authenticated', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `users-approved-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/users/approved')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Current user excluded per route logic
    expect(res.body.some((u) => u.id === user.id)).toBe(false);
  });
});

describe('GET /api/users/:id', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/users/1');
    expect(res.status).toBe(401);
  });

  it('returns user when found', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `users-get-${Date.now()}`,
    });

    const res = await request(app)
      .get(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      username: user.username,
      email: user.email,
    });
  });

  it('returns 404 when user not found', async () => {
    const { token } = await createAuthenticatedTestUser({
      username: `users-get2-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/users/999999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });
});

describe('PUT /api/users/:id/password', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/users/1/password')
      .send({ password: 'newpass123' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when updating other user password', async () => {
    const { user: otherUser } = await createAuthenticatedTestUser({
      username: `users-other-${Date.now()}`,
    });
    const { token } = await createAuthenticatedTestUser({
      username: `users-self-${Date.now()}`,
    });

    const res = await request(app)
      .put(`/api/users/${otherUser.id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'newpass123' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 when updating own password', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `users-pw-${Date.now()}`,
    });

    const res = await request(app)
      .put(`/api/users/${user.id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'newpassword456' });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });

  it('invalidates existing token after password change', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `users-invalidate-${Date.now()}`,
    });

    const putRes = await request(app)
      .put(`/api/users/${user.id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'newpassword456' });
    expect(putRes.status).toBe(200);

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(401);
    expect(meRes.body.errorCode).toBeDefined();
  });
});

describe('PUT /api/users/:id/email', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/users/1/email')
      .send({ email: 'new@example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when updating other user email', async () => {
    const { user: otherUser } = await createAuthenticatedTestUser({
      username: `users-other-email-${Date.now()}`,
    });
    const { token } = await createAuthenticatedTestUser({
      username: `users-self-email-${Date.now()}`,
    });

    const res = await request(app)
      .put(`/api/users/${otherUser.id}/email`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'other@example.com' });

    expect(res.status).toBe(403);
  });

  it('returns 200 when updating own email', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `users-email-${Date.now()}`,
    });
    const newEmail = `updated-${Date.now()}@example.com`;

    const res = await request(app)
      .put(`/api/users/${user.id}/email`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: newEmail });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
  });
});
