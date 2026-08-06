/**
 * Health and WebDAV infrastructure routes integration tests.
 * No auth required. @see docs/features/admin-infrastructure.md
 */
const request = require('supertest');
const { createTestDatabase } = require('@server/test-utils');

jest.mock('@server/infrastructure/webdavTest', () => ({
  testConnection: jest.fn().mockResolvedValue({ success: true }),
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('@server/index');
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/health', () => {
  it('returns 200 with status ok and messageCode', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.messageCode).toBeDefined();
  });
});

describe('GET /api/webdav/test', () => {
  it('returns 200 and success when connection test passes', async () => {
    const res = await request(app).get('/api/webdav/test');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body.success).toBe('boolean');
  });
});

describe('GET /api/webdav/info', () => {
  it('returns 200 with url field', async () => {
    const res = await request(app).get('/api/webdav/info');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body).toHaveProperty('url');
    expect(typeof res.body.url).toBe('string');
  });
});
