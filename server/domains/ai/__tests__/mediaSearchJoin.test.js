'use strict';

/**
 * Media embed → semantic search join (docs/E2E_COVERAGE_PLAN.md E2E-S3-AI-010).
 *
 * The demoted browser case proved the WIRE to the DOM; this suite proves the
 * server join it depended on: the embed pipeline's media ladder writes a
 * pooled row whose `source` selects whether the caption query can find the
 * node in the REAL search service's semantic section.
 *
 *   - image_embed ON  ⇒ `media_direct` (image direction = the caption's
 *     text direction) ⇒ the caption query reaches `result.semantic`.
 *   - image_embed OFF ⇒ `metadata_only` (V0 name/mime/path/date floor) ⇒ the
 *     caption query is an HONEST MISS; the V0 row still proves the leg works
 *     by matching a metadata token.
 *
 * Hermetic: real queue + real embedding stores over the test database, real
 * searchService + production scorer; the provider, blob source, node lookup
 * and capability probe are injected fakes (no network, no model, no boot of
 * server/index.js). The fake provider's vector rule mirrors
 * `e2e/helpers/fakeLlm.ts` (`textVector`, 768-dim; image = caption text
 * direction; text-only media requests never reach the pipeline because the
 * capability probe turns image_embed OFF).
 *
 * @see docs/spec/server/services/aiJobService.md §2.4 (media ladder)
 * @see docs/spec/server/services/searchService.md §2.3 (semantic leg)
 */

const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createUserRootNode,
  createTestFileNode,
} = require('@server/test-utils');
const aiJobsStore = require('@server/store/aiJobsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const { createEmbedPipeline } = require('../pipelines/embed');
const { createSearchService } = require('../searchService');
const { resetVectorStore } = require('../vectorStoreRuntime');

const DIM = 768;
const TEXT_SLOTS = DIM - 1; // 0..766; 767 is the empty basis (fakeLlm.ts)
const EMPTY_INDEX = DIM - 1;
const IMAGE_CAPTION = 'A red bicycle leans against a brick wall in the sunlight.';

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

/** Deterministic bag-of-words unit vector — same rule as e2e/helpers/fakeLlm.ts. */
function textVector(text) {
  const tokens =
    String(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) {
    const vector = new Array(DIM).fill(0);
    vector[EMPTY_INDEX] = 1;
    return vector;
  }
  const vector = new Array(DIM).fill(0);
  for (const token of tokens) vector[hashToken(token) % TEXT_SLOTS] += 1;
  return normalizeVector(vector);
}

async function makeEmbedModel() {
  const { id } = await llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    precision: 'q4',
    modelRevision: `rev-media-join-${Date.now()}-${Math.random()}`,
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
  });
  return Number(id);
}

/** Drain one image's embed job through the injected fake provider. */
async function drainImageEmbed({ name, modelId, mediaCapable }) {
  const { user } = await createAuthenticatedTestUser({
    username: `mediajoin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await createUserRootNode({ userId: user.id });
  const image = await createTestFileNode({ name, parentId: root.nodeId });

  await aiJobsStore.enqueue(
    image.nodeId,
    'embed',
    1,
    `hash-media-join-${Date.now()}-${Math.random()}`
  );

  const adapter = {
    embed: jest.fn(async (texts) => ({
      vectors: texts.map((text) => textVector(text)),
      dim: DIM,
      modelId,
    })),
    embedMedia: jest.fn(async (items) => ({
      // Image/video share the image direction (fakeLlm.ts).
      vectors: items.map(() => textVector(IMAGE_CAPTION)),
      dim: DIM,
      modelId,
    })),
  };

  const done = await createEmbedPipeline().runPendingEmbedJobs({
    adapter,
    activeModelId: async () => modelId,
    readNode: async () => ({
      name,
      mimeType: 'image/png',
      type: 'file',
      path: `/mediajoin-root/${name}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    readBlob: async () => Buffer.from('image-bytes'),
    // Text-only: image_embed is OFF, so the pipeline never calls embedMedia.
    capabilityEnabled: (capability) => mediaCapable && capability === 'image_embed',
    aiEnrichmentsStore: { get: async () => null },
  });

  return { user, image, done, adapter };
}

/** The real search service + production scorer over the real stores. */
function createSearchHarness(modelId) {
  return createSearchService({
    usageService: { recordEvent: jest.fn(async () => ({ changes: 1 })) },
    configResolver: { getConfig: async () => undefined },
    llmAdapter: {
      roleConfigured: async (role) => role === 'embed',
      embedQuery: async (text) => ({ vectors: [textVector(text)], dim: DIM, modelId }),
    },
  });
}

describe('media embed pipeline joins semantic search (E2E-S3-AI-010)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    resetVectorStore();
  });

  afterEach(() => {
    resetVectorStore();
  });

  afterAll(async () => {
    resetVectorStore();
    await dbCleanup?.();
  });

  it('E2E-S3-AI-010 positive: a media_direct image row joins semantic search for its caption', async () => {
    const modelId = await makeEmbedModel();
    const { user, image, done } = await drainImageEmbed({
      name: 'mediajoin-positive-caption.png',
      modelId,
      mediaCapable: true,
    });
    expect(done).toBe(1);

    const pooled = await embeddingsStore.get(image.nodeId);
    expect(pooled).toMatchObject({ modelId, dim: DIM, source: 'media_direct' });

    const result = await createSearchHarness(modelId).search(user.id, { query: IMAGE_CAPTION });

    expect(result.semanticUnavailableReason).toBeUndefined();
    expect(result.semantic.map((row) => row.nodeId)).toContain(image.nodeId);
    expect(result.semantic.find((row) => row.nodeId === image.nodeId)).toMatchObject({
      name: 'mediajoin-positive-caption.png',
    });
  }, 30000);

  it('E2E-S3-AI-010 negative: a metadata_only image row honestly misses the caption query', async () => {
    const modelId = await makeEmbedModel();
    const { user, image, done } = await drainImageEmbed({
      name: 'mediajoin-negative-caption.png',
      modelId,
      mediaCapable: false,
    });
    expect(done).toBe(1);

    const pooled = await embeddingsStore.get(image.nodeId);
    expect(pooled).toMatchObject({ modelId, dim: DIM, source: 'metadata_only' });

    const service = createSearchHarness(modelId);
    const missed = await service.search(user.id, { query: IMAGE_CAPTION });

    // The leg RAN (semantic key present) and still missed — not a degrade.
    expect(Array.isArray(missed.semantic)).toBe(true);
    expect(missed.semanticUnavailableReason).toBeUndefined();
    expect(missed.semantic.map((row) => row.nodeId)).not.toContain(image.nodeId);
    expect(missed.semantic).toEqual([]);

    // Control: the V0 row is searchable in its own metadata direction, so the
    // empty caption section is the honest source-dependent miss.
    const metadataHit = await service.search(user.id, { query: 'image' });
    expect(metadataHit.semantic.map((row) => row.nodeId)).toContain(image.nodeId);
  }, 30000);
});
