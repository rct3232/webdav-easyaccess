/**
 * GET /api/ai/enrichments/:nodeId integration tests.
 * @see docs/spec/server/routes/aiEnrichments.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbQuery,
} = require('../../../test-utils');
const { createFileNodeService } = require('../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const aiEnrichmentsStore = require('../../../store/aiEnrichmentsStore');
const llmModelsStore = require('../../../store/llmModelsStore');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createInMemoryBlobStore } = require('@testing/mocks/serviceMocks');
const composition = require('../../../service/composition');

let app;
let dbCleanup;
let ownerToken;
let otherToken;
let readableFileId;
let emptyFileId;
let trashedFileId;
let shareToken;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  composition.__setCompositionForTests({ blobStore: createInMemoryBlobStore() });
  app = require('../../../index');

  const fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });

  const owner = await createAuthenticatedTestUser({
    username: `enrich-owner-${Date.now()}`,
    status: 'active',
  });
  ownerToken = owner.token;
  const home = await fileNodeService.createDirectory(null, owner.user.username);
  await grantTestPermissionByNodeId({
    userId: owner.user.id,
    fileNodeId: home.id,
    permission: 'write',
  });

  const other = await createAuthenticatedTestUser({
    username: `enrich-other-${Date.now()}`,
    status: 'active',
  });
  otherToken = other.token;

  const readable = await fileNodeService.createFile(home.id, 'enriched.txt');
  readableFileId = readable.id;
  const empty = await fileNodeService.createFile(home.id, 'empty.txt');
  emptyFileId = empty.id;
  const trashed = await fileNodeService.createFile(home.id, 'trashed.txt');
  trashedFileId = trashed.id;
  await dbQuery('UPDATE file_nodes SET deleted_at = ? WHERE id = ?', [
    new Date().toISOString(),
    trashedFileId,
  ]);

  const features = await llmModelsStore.upsertModel({
    role: 'chat',
    provider: 'test',
    baseUrlKey: '',
    modelName: 'qwen-features',
  });
  const caption = await llmModelsStore.upsertModel({
    role: 'vision',
    provider: 'test',
    baseUrlKey: '',
    modelName: 'qwen-vision',
  });
  const asr = await llmModelsStore.upsertModel({
    role: 'asr',
    provider: 'test',
    baseUrlKey: '',
    modelName: 'whisper-large',
  });

  await aiEnrichmentsStore.upsert(readableFileId, {
    featuresModelId: features.id,
    schemaVersion: 1,
    tags: ['beach', 'sunset'],
    summary: 'A sunset over the beach.',
    caption: 'Waves at golden hour.',
    captionModelId: caption.id,
    transcript: 'hello world',
    asrModelId: asr.id,
    probe: {
      durationSec: 12.5,
      width: 1920,
      height: 1080,
      streams: [{ codecName: 'h264' }, { codecName: 'aac' }],
      tags: { artist: 'hidden artist' },
    },
    truncated: true,
    mediaKind: 'music',
  });

  // A real share link on the file: the route is JWT-only, so the token alone
  // must stay unauthenticated (401).
  const ShareLink = require('../../../models/ShareLink');
  const link = await ShareLink.create(readableFileId, owner.user.id);
  shareToken = link.token;
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('GET /api/ai/enrichments/:nodeId', () => {
  it('401 without a JWT', async () => {
    const res = await request(app).get(`/api/ai/enrichments/${readableFileId}`);
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.utilsAuth.accessTokenRequired);
  });

  it('excludes share-link tokens (401 even for a valid token)', async () => {
    const res = await request(app)
      .get(`/api/ai/enrichments/${readableFileId}`)
      .set('X-Share-Token', shareToken);
    expect(res.status).toBe(401);
  });

  it('400 for a non-numeric nodeId', async () => {
    const res = await request(app)
      .get('/api/ai/enrichments/not-a-number')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.files.invalidPath);
  });

  it('404-masquerades unknown, trashed, and unreadable nodes with files.notFound', async () => {
    const unknown = await request(app)
      .get('/api/ai/enrichments/999999')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);

    const trashed = await request(app)
      .get(`/api/ai/enrichments/${trashedFileId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(trashed.status).toBe(404);
    expect(trashed.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);

    const unreadable = await request(app)
      .get(`/api/ai/enrichments/${readableFileId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(unreadable.status).toBe(404);
    expect(unreadable.body.errorCode).toBe(SERVER_ERROR_CODES.files.notFound);
  });

  it('200 { node_id, enrichment: null } for a readable node without a row', async () => {
    const res = await request(app)
      .get(`/api/ai/enrichments/${emptyFileId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ node_id: emptyFileId, enrichment: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('200 full whitelist shape with safe media facts and model-name provenance', async () => {
    const res = await request(app)
      .get(`/api/ai/enrichments/${readableFileId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.node_id).toBe(readableFileId);
    expect(res.body.enrichment).toEqual({
      tags: ['beach', 'sunset'],
      summary: 'A sunset over the beach.',
      caption: 'Waves at golden hour.',
      transcript: 'hello world',
      media_kind: 'music',
      media: { duration_sec: 12.5, width: 1920, height: 1080, codecs: ['h264', 'aac'] },
      truncated: true,
      schema_version: 1,
      updated_at: expect.any(String),
      provenance: {
        features: { model_name: 'qwen-features' },
        caption: { model_name: 'qwen-vision' },
        asr: { model_name: 'whisper-large' },
      },
    });

    // Whitelist: no raw probe payload, category/degraded, ids, keys or URLs.
    expect(Object.keys(res.body.enrichment).sort()).toEqual([
      'caption',
      'media',
      'media_kind',
      'provenance',
      'schema_version',
      'summary',
      'tags',
      'transcript',
      'truncated',
      'updated_at',
    ]);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('hidden artist');
    expect(serialized).not.toContain('streams');
    expect(serialized).not.toContain('base_url');
    expect(serialized).not.toContain('model_id');
    expect(serialized).not.toContain('category');
    expect(serialized).not.toContain('degraded');
  });
});
