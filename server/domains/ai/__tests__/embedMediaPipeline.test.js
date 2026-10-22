'use strict';

/**
 * embed pipeline — MEDIA branch tests (aiJobService.md §2.4 embed media
 * ladder, llmAdapter.md §2.6).
 *
 * Hermetic: the REAL queue over the test database; the adapter, blob source,
 * enrichment corpus reader and vector-store write hooks are injected fakes
 * (the hooks record the ONE transaction's payload instead of hitting SQL).
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiJobsStore = require('@server/store/aiJobsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const { createEmbedPipeline } = require('../pipelines/embed');

async function makeEmbedModel() {
  const { id } = await llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    modelRevision: `rev-media-${Date.now()}-${Math.random()}`,
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
  });
  return Number(id);
}

function fakeHooks() {
  const state = { transactions: 0, pooled: [], chunks: [] };
  return {
    state,
    hooks: {
      transaction: jest.fn(async (fn) => {
        state.transactions += 1;
        return fn({ tx: state.transactions });
      }),
      upsertPooled: jest.fn(async (tx, row) => {
        state.pooled.push(row);
      }),
      replaceChunks: jest.fn(async (tx, nodeId, modelId, vectorTexts) => {
        state.chunks.push({ nodeId, modelId, vectorTexts });
      }),
    },
  };
}

function vectorsFor(count, dim = 4) {
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: dim }, (_, d) => (i + 1) / (d + 1))
  );
}

describe('embed pipeline media branch', () => {
  let dbCleanup;
  let pipeline;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    pipeline = createEmbedPipeline();
  });

  afterAll(async () => {
    await dbCleanup();
  });

  async function enqueueMediaNode(name) {
    const node = await createTestFileNode({ name });
    await aiJobsStore.enqueue(node.nodeId, 'embed', 1, `hash-${Date.now()}-${Math.random()}`);
    return { ...node, name };
  }

  it('image + image_embed ON ⇒ embedMedia single item, media_direct pooled+chunks, ONE tx', async () => {
    const node = await enqueueMediaNode(`media-image-${Date.now()}.jpg`);
    const modelId = await makeEmbedModel();
    const image = Buffer.from('image-bytes');
    const embedMedia = jest.fn(async () => ({ vectors: vectorsFor(1), dim: 4, modelId }));
    const embed = jest.fn();
    const { hooks, state } = fakeHooks();

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed, embedMedia },
      activeModelId: async () => modelId,
      readNode: async () => ({ name: node.name, mimeType: 'image/jpeg', type: 'file' }),
      readBlob: async () => image,
      capabilityEnabled: (capability) => capability === 'image_embed',
      aiEnrichmentsStore: { get: async () => null },
      vectorStore: hooks,
    });
    expect(done).toBe(1);

    expect(embed).not.toHaveBeenCalled();
    expect(embedMedia).toHaveBeenCalledWith([image], { mediaType: 'image' });
    expect(state.transactions).toBe(1);
    expect(state.pooled).toHaveLength(1);
    expect(state.pooled[0]).toMatchObject({
      nodeId: Number(node.nodeId),
      modelId,
      dim: 4,
      source: 'media_direct',
    });
    expect(state.chunks).toHaveLength(1);
    expect(state.chunks[0].vectorTexts).toHaveLength(1);
  });

  it('video + video_embed ON ⇒ every sampled frame is a segment row (never head-truncated)', async () => {
    const node = await enqueueMediaNode(`media-video-${Date.now()}.mp4`);
    const modelId = await makeEmbedModel();
    const frames = [Buffer.from('f1'), Buffer.from('f2')];
    const sampleFrames = jest.fn(async () => frames);
    const embedMedia = jest.fn(async () => ({ vectors: vectorsFor(2), dim: 4, modelId }));
    const { hooks, state } = fakeHooks();

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed: jest.fn(), embedMedia },
      activeModelId: async () => modelId,
      readNode: async () => ({ name: node.name, mimeType: 'video/mp4', type: 'file' }),
      readBlob: async () => Buffer.from('video-bytes'),
      sampleFrames,
      capabilityEnabled: (capability) => capability === 'video_embed',
      aiEnrichmentsStore: { get: async () => null },
      mediaProfile: async () => ({
        engine: 'embedded',
        windowTokens: 8192,
        budgetTokens: 8192,
        mediaTokenCost: { image: 280, videoFrame: 140, audioPerSec: 25 },
      }),
      vectorStore: hooks,
    });
    expect(done).toBe(1);

    // Embedded budget: floor(8192 / 140) = 58 frames.
    expect(sampleFrames.mock.calls[0][1]).toMatchObject({ maxFrames: 58 });
    expect(embedMedia).toHaveBeenCalledWith(frames, { mediaType: 'image' });
    expect(state.pooled[0].source).toBe('media_direct');
    expect(state.chunks[0].vectorTexts).toHaveLength(2); // one row per segment
    expect(state.transactions).toBe(1);
  });

  it('audio + audio_embed ON ⇒ fixed windows encoded as WAV segments', async () => {
    const node = await enqueueMediaNode(`media-audio-${Date.now()}.wav`);
    const modelId = await makeEmbedModel();
    // 2.5 windows at windowSec=1 keeps the short tail ⇒ 3 segments.
    const decodeAudio = jest.fn(async () => new Float32Array(40000));
    const embedMedia = jest.fn(async (buffers) => ({
      vectors: vectorsFor(buffers.length),
      dim: 4,
      modelId,
    }));
    const { hooks, state } = fakeHooks();

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed: jest.fn(), embedMedia },
      activeModelId: async () => modelId,
      readNode: async () => ({ name: node.name, mimeType: 'audio/wav', type: 'file' }),
      readBlob: async () => Buffer.from('wav-bytes'),
      decodeAudio,
      capabilityEnabled: (capability) => capability === 'audio_embed',
      aiEnrichmentsStore: { get: async () => null },
      // 25 tokens/s ⇒ a 1 s window keeps the fixture segment count observable.
      mediaProfile: async () => ({
        engine: 'remote',
        windowTokens: 8192,
        budgetTokens: 25,
        mediaTokenCost: { image: 280, videoFrame: 140, audioPerSec: 25 },
      }),
      vectorStore: hooks,
    });
    expect(done).toBe(1);

    expect(decodeAudio).toHaveBeenCalledWith(expect.any(Buffer), { mimeType: 'audio/wav' });
    const [buffers, opts] = embedMedia.mock.calls[0];
    expect(opts).toEqual({ mediaType: 'audio' });
    expect(buffers).toHaveLength(3);
    for (const buffer of buffers) {
      expect(buffer.toString('ascii', 0, 4)).toBe('RIFF'); // WAV wire form
    }
    expect(state.pooled[0].source).toBe('media_direct');
    expect(state.chunks[0].vectorTexts).toHaveLength(3);
  });

  it('capability OFF + caption present ⇒ caption is the embed corpus (V2 fallback, chunk_pool)', async () => {
    const node = await enqueueMediaNode(`media-fallback-${Date.now()}.jpg`);
    const modelId = await makeEmbedModel();
    const embed = jest.fn(async (texts) => ({
      vectors: vectorsFor(texts.length),
      dim: 4,
      modelId,
    }));
    const embedMedia = jest.fn();
    const { hooks, state } = fakeHooks();

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed, embedMedia },
      activeModelId: async () => modelId,
      readNode: async () => ({ name: node.name, mimeType: 'image/jpeg', type: 'file' }),
      readBlob: async () => Buffer.from('image-bytes'),
      capabilityEnabled: () => false,
      aiEnrichmentsStore: { get: async () => ({ caption: '바다가 보이는 사진' }) },
      vectorStore: hooks,
    });
    expect(done).toBe(1);

    expect(embedMedia).not.toHaveBeenCalled();
    expect(embed).toHaveBeenCalledWith(['바다가 보이는 사진']);
    expect(state.pooled[0]).toMatchObject({ source: 'chunk_pool' });
    expect(state.transactions).toBe(1);
  });

  it('capability OFF + no caption ⇒ V0 metadata_only corpus (name/mime/path/date)', async () => {
    const node = await enqueueMediaNode(`media-metadata-${Date.now()}.jpg`);
    const modelId = await makeEmbedModel();
    const embed = jest.fn(async () => ({ vectors: vectorsFor(1), dim: 4, modelId }));
    const { hooks, state } = fakeHooks();

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed, embedMedia: jest.fn() },
      activeModelId: async () => modelId,
      readNode: async () => ({
        name: node.name,
        mimeType: 'image/jpeg',
        type: 'file',
        path: '/photos',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      readBlob: async () => Buffer.from('image-bytes'),
      capabilityEnabled: () => false,
      aiEnrichmentsStore: { get: async () => null },
      vectorStore: hooks,
    });
    expect(done).toBe(1);

    const corpus = embed.mock.calls[0][0][0];
    expect(corpus).toContain(node.name);
    expect(corpus).toContain('image/jpeg');
    expect(corpus).toContain('/photos');
    expect(corpus).toContain('2026-01-01');
    expect(state.pooled[0]).toMatchObject({ source: 'metadata_only' });
  });

  it('audio capability OFF + music transcript ⇒ transcript excluded, metadata_only fallback', async () => {
    const node = await enqueueMediaNode(`media-music-${Date.now()}.mp3`);
    const modelId = await makeEmbedModel();
    const embed = jest.fn(async () => ({ vectors: vectorsFor(1), dim: 4, modelId }));
    const { hooks, state } = fakeHooks();
    const enrichments = {
      get: jest.fn(async () => ({ transcript: 'we will rock you', mediaKind: 'music' })),
    };

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed, embedMedia: jest.fn() },
      activeModelId: async () => modelId,
      readNode: async () => ({ name: node.name, mimeType: 'audio/mpeg', type: 'file' }),
      readBlob: async () => Buffer.from('mp3'),
      capabilityEnabled: () => false,
      aiEnrichmentsStore: enrichments,
      vectorStore: hooks,
    });
    expect(done).toBe(1);

    expect(embed).toHaveBeenCalledTimes(1);
    const corpus = embed.mock.calls[0][0][0];
    expect(corpus).not.toBe('we will rock you');
    expect(corpus).toContain(node.name);
    expect(state.pooled[0].source).toBe('metadata_only');
  });

  it('non-media text nodes keep the document pipeline (caption/asr are media-only)', async () => {
    const node = await enqueueMediaNode(`media-text-${Date.now()}.txt`);
    const modelId = await makeEmbedModel();
    const embed = jest.fn(async (texts) => ({
      vectors: vectorsFor(texts.length),
      dim: 4,
      modelId,
    }));
    const embedMedia = jest.fn();
    const { hooks, state } = fakeHooks();

    const done = await pipeline.runPendingEmbedJobs({
      adapter: { embed, embedMedia },
      activeModelId: async () => modelId,
      readText: async () => 'document body',
      readNode: async () => ({ name: node.name, mimeType: 'text/plain', type: 'file' }),
      readBlob: async () => Buffer.from('document body'),
      capabilityEnabled: () => true,
      aiEnrichmentsStore: { get: async () => null },
      vectorStore: hooks,
    });
    expect(done).toBe(1);
    expect(embedMedia).not.toHaveBeenCalled();
    expect(state.pooled[0].source).toBe('chunk_pool');
  });
});
