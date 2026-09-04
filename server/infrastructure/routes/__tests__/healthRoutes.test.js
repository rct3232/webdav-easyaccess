/**
 * Health and WebDAV infrastructure routes integration tests.
 * No auth required. @see docs/features/admin-infrastructure.md
 */
const request = require('supertest');
const { createTestDatabase } = require('@server/test-utils');
const { initMetadataStore } = require('@server/store/bootstrap');
const { initFfmpegOnce } = require('@server/domains/thumbnails/services/videoProcessor');

jest.mock('@server/infrastructure/webdavTest', () => ({
  testConnection: jest.fn().mockResolvedValue({ success: true }),
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('@server/index');
  // index.js fires initMetadataStore() + ffmpeg/webdav probes at require-time.
  // Await the same shared init promises so startup settles before teardown.
  await initMetadataStore();
  await initFfmpegOnce();
});

afterAll(async () => {
  await dbCleanup?.();
});

beforeEach(jest.clearAllMocks);

describe('GET /api/health', () => {
  it('returns 200 with status ok, messageCode, active backends, and backend status strings', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.activeFileStorage).toMatch(/^(s3|webdav)$/);
    expect(res.body.activeMetadataBackend).toMatch(/^(postgresql|sqlite)$/);
    expect(res.body.backends).toEqual({
      postgresql: expect.stringMatching(/^(ok|fail|unknown)$/),
      s3: expect.stringMatching(/^(ok|fail|unknown)$/),
      webdav: expect.stringMatching(/^(ok|fail|unknown)$/),
    });
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
