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

describe('GET /api/settings/public ai flags (§4.12 — live from the ai.<role> tracker rows)', () => {
  const { getBackendHealth } = require('../../../../infrastructure/backendHealth');

  afterEach(() => {
    // Clear only the AI role slots my reports touched; reset() also clears
    // backend rows, which no test in this file asserts on.
    getBackendHealth().reset();
  });

  it('exposes ai: { embed, chat } booleans defaulting to false with no probe state', async () => {
    const res = await request(app).get('/api/settings/public');

    expect(res.status).toBe(200);
    expect(res.body.ai).toEqual({ embed: false, chat: false });
  });

  it('flips to true only for roles whose tracker row reports ok', async () => {
    getBackendHealth().report('ai.embed', { ok: true });
    getBackendHealth().report('ai.chat', { ok: false, code: 'unknown', reason: 'probe failed' });

    const res = await request(app).get('/api/settings/public');

    expect(res.status).toBe(200);
    expect(res.body.ai).toEqual({ embed: true, chat: false });
  });

  it('reflects a failed report and a reset as false (live derivation, no restart)', async () => {
    getBackendHealth().report('ai.chat', { ok: true });
    await expect(request(app).get('/api/settings/public')).resolves.toMatchObject({
      body: { ai: { embed: false, chat: true } },
    });

    getBackendHealth().report('ai.chat', { ok: false, code: 'unknown' });
    const failed = await request(app).get('/api/settings/public');
    expect(failed.body.ai.chat).toBe(false);

    getBackendHealth().reset();
    const reset = await request(app).get('/api/settings/public');
    expect(reset.body.ai).toEqual({ embed: false, chat: false });
  });
});
