/**
 * Thumbnails routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/thumbnails.md
 *
 * Mocks thumbnail util to avoid ffmpeg/sharp and control token/hash validation.
 */
const request = require('supertest');
const { createTestDatabase } = require('../../test-utils');

const mockVerifyThumbnailToken = jest.fn();
const mockGetThumbnailHash = jest.fn();
const mockThumbnailCache = new Map();

jest.mock('../../utils/thumbnail', () => ({
  thumbnailCache: mockThumbnailCache,
  getThumbnailHash: (...args) => mockGetThumbnailHash(...args),
  verifyThumbnailToken: (...args) => mockVerifyThumbnailToken(...args),
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
});

beforeEach(() => {
  mockThumbnailCache.clear();
  mockVerifyThumbnailToken.mockReturnValue(false);
  mockGetThumbnailHash.mockImplementation((path) =>
    require('crypto').createHash('md5').update(path).digest('hex')
  );
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/thumbnails/:hash.:ext', () => {
  it('returns 401 when token missing or invalid', async () => {
    const res = await request(app).get('/api/thumbnails/abc123.jpeg');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 401 when token invalid', async () => {
    const res = await request(app)
      .get('/api/thumbnails/abc123.jpeg')
      .query({ token: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 404 when token valid but hash not in cache', async () => {
    mockVerifyThumbnailToken.mockReturnValue(true);

    const res = await request(app)
      .get('/api/thumbnails/unknownhash.jpeg')
      .query({ token: 'valid-token' });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 with image when token valid and hash in cache', async () => {
    const hash = require('crypto').createHash('md5').update('/test/image.jpg').digest('hex');
    mockVerifyThumbnailToken.mockReturnValue(true);
    mockGetThumbnailHash.mockReturnValue(hash);
    mockThumbnailCache.set('/test/image.jpg', {
      buffer: Buffer.from('fake-jpeg-content'),
      extension: 'jpeg',
      mimeType: 'image/jpeg',
    });

    const res = await request(app)
      .get(`/api/thumbnails/${hash}.jpeg`)
      .query({ token: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.body).toBeDefined();
  });
});
