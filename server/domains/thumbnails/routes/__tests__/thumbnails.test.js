/**
 * Thumbnails routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/thumbnails.md
 *
 * Mocks thumbnailService to avoid ffmpeg/sharp and control token/hash validation.
 * Batch permission checks run against the real ACL service + test DB.
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  createTestFileNode,
} = require('../../../../test-utils');
const { initMetadataStore } = require('../../../../store/bootstrap');

const mockVerifyThumbnailToken = jest.fn();
const mockFindCachedThumbnailByHash = jest.fn();
const mockEnsureThumbnailsBatch = jest.fn();

jest.mock('../../services/thumbnailService', () => ({
  verifyThumbnailToken: (...args) => mockVerifyThumbnailToken(...args),
  findCachedThumbnailByHash: (...args) => mockFindCachedThumbnailByHash(...args),
  ensureThumbnailsBatch: (...args) => mockEnsureThumbnailsBatch(...args),
}));

let app;
let dbCleanup;
let userToken;
let readableNodeId;
let forbiddenNodeId;

function waitForAppInit() {
  // index.js fires initMetadataStore() at require-time. Await the same
  // idempotent init (CREATE TABLE IF NOT EXISTS / existing-admin check) so its
  // async schema re-init settles without a fixed real-time wait.
  return initMetadataStore();
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  app = require('../../../../index');
  await waitForAppInit();

  const created = await createAuthenticatedTestUser({
    username: `thumb-batch-${Date.now()}`,
  });
  userToken = created.token;

  readableNodeId = (await createTestFileNode({ name: 'photo.jpg', type: 'file', parentId: null }))
    .nodeId;
  forbiddenNodeId = (
    await createTestFileNode({ name: 'private.pdf', type: 'file', parentId: null })
  ).nodeId;

  await grantTestPermissionByNodeId({
    userId: created.user.id,
    fileNodeId: readableNodeId,
    permission: 'read',
  });
});

beforeEach(() => {
  mockVerifyThumbnailToken.mockReturnValue(false);
  mockFindCachedThumbnailByHash.mockReturnValue(null);
  mockEnsureThumbnailsBatch.mockReset();
  mockEnsureThumbnailsBatch.mockResolvedValue([]);
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
    const nodeId = 42;
    const hash = require('crypto').createHash('md5').update(String(nodeId)).digest('hex');
    mockVerifyThumbnailToken.mockReturnValue(true);
    mockFindCachedThumbnailByHash.mockReturnValue({
      nodeId,
      thumbnail: {
        buffer: Buffer.from('fake-jpeg-content'),
        extension: 'jpeg',
        mimeType: 'image/jpeg',
      },
    });

    const res = await request(app)
      .get(`/api/thumbnails/${hash}.jpeg`)
      .query({ token: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.body).toBeDefined();
  });
});

describe('POST /api/thumbnails/batch', () => {
  it('returns thumbnails keyed by nodeId for nodes the caller can read', async () => {
    mockEnsureThumbnailsBatch.mockImplementation(async (ids) =>
      ids.map((nodeId) => ({ nodeId, thumbnailUrl: `/api/thumbnails/${nodeId}.jpg?token=x` }))
    );

    const res = await request(app)
      .post('/api/thumbnails/batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [readableNodeId, forbiddenNodeId] });

    expect(res.status).toBe(200);
    expect(res.body.thumbnails).toHaveLength(1);
    expect(res.body.thumbnails[0].nodeId).toBe(readableNodeId);
    expect(res.body.thumbnails[0].thumbnailUrl).toContain('/api/thumbnails/');
    expect(mockEnsureThumbnailsBatch).toHaveBeenCalledWith([readableNodeId]);
  });

  it('skips nodes the caller cannot read', async () => {
    const res = await request(app)
      .post('/api/thumbnails/batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [forbiddenNodeId] });

    expect(res.status).toBe(200);
    expect(res.body.thumbnails).toEqual([]);
    expect(mockEnsureThumbnailsBatch).toHaveBeenCalledWith([]);
  });

  it('returns 400 for invalid bodies', async () => {
    const emptyArray = await request(app)
      .post('/api/thumbnails/batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: [] });
    expect(emptyArray.status).toBe(400);

    const missing = await request(app)
      .post('/api/thumbnails/batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(missing.status).toBe(400);

    const nonArray = await request(app)
      .post('/api/thumbnails/batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: 'nope' });
    expect(nonArray.status).toBe(400);

    const nonNumeric = await request(app)
      .post('/api/thumbnails/batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nodeIds: ['abc'] });
    expect(nonNumeric.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/thumbnails/batch')
      .send({ nodeIds: [readableNodeId] });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/thumbnails/thumbnail/:hash (removed)', () => {
  it('returns 404 since the authed single-thumbnail route was removed', async () => {
    const res = await request(app)
      .get('/api/thumbnails/thumbnail/abc123')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(404);
  });
});
