/**
 * Settings routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/settings.md
 */
const request = require('supertest');
const { createTestDatabase } = require('../../../../test-utils');
const { initMetadataStore } = require('../../../../store/bootstrap');
const { initFfmpegOnce } = require('../../../../domains/thumbnails/services/videoProcessor');

// index.js runs a startup WebDAV connection probe; without this mock it would
// hit the real server configured in .env from an unawaited startup hook.
jest.mock('../../../../infrastructure/webdavTest', () => ({
  testConnection: jest.fn().mockResolvedValue({ success: true }),
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../../../index');
  // index.js fires initMetadataStore() + ffmpeg/webdav probes at require-time.
  // Await the same shared init promises so startup settles before teardown.
  await initMetadataStore();
  await initFfmpegOnce();
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/settings/public', () => {
  it('returns settings without auth', async () => {
    const res = await request(app).get('/api/settings/public');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      registration_enabled: expect.anything(),
      email_enabled: expect.anything(),
    });
    expect(typeof res.body.registration_enabled).toBe('boolean');
    expect(typeof res.body.email_enabled).toBe('boolean');
  });
});
