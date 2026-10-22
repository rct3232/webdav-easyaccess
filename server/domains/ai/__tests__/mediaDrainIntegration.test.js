'use strict';

/**
 * Worker drain integration for the media wave (aiJobService.md §2.3/§2.4):
 * ONE `drainPass` runs the embed, caption and asr pipelines behind their own
 * role gates; kinds without an executor (features, backfill) stay parked with
 * attempt 0.
 *
 * Hermetic: real queue + real enrichment/embedding stores over the test
 * database; fake LLM adapter, fake blob source and fake ffprobe seam.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiJobsStore = require('@server/store/aiJobsStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const { createAiJobService } = require('../jobService');

async function makeModel(role, engine = 'remote') {
  const { id } = await llmModelsStore.upsertModel({
    role,
    provider: engine === 'embedded' ? 'embedded' : 'llama.cpp',
    engine,
    baseUrlKey: engine === 'embedded' ? '' : 'LLM_TEST',
    modelName: `${role}-model`,
    modelRevision: `rev-drain-${role}-${Date.now()}-${Math.random()}`,
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
  });
  return Number(id);
}

describe('AI worker drain integration (embed + caption + asr)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('drains embed/caption/asr in one pass, chains media embeds, parks features/backfill', async () => {
    const text = await createTestFileNode({ name: `drain-text-${Date.now()}.txt` });
    const image = await createTestFileNode({ name: `drain-image-${Date.now()}.jpg` });
    const audio = await createTestFileNode({ name: `drain-audio-${Date.now()}.mp3` });

    const embedModelId = await makeModel('embed', 'embedded');
    const visionModelId = await makeModel('vision');
    const asrModelId = await makeModel('asr');

    await aiJobsStore.enqueue(text.nodeId, 'embed', 1, 'hash-text');
    await aiJobsStore.enqueue(text.nodeId, 'features', 1, 'hash-text');
    await aiJobsStore.enqueue(text.nodeId, 'backfill', 1, 'hash-text');
    await aiJobsStore.enqueue(image.nodeId, 'caption', 1, 'hash-image');
    await aiJobsStore.enqueue(audio.nodeId, 'asr', 1, 'hash-audio');

    const nodes = {
      [text.nodeId]: { name: text.path.split('/').pop(), mimeType: 'text/plain', type: 'file' },
      [image.nodeId]: { name: 'drain-image.jpg', mimeType: 'image/jpeg', type: 'file' },
      [audio.nodeId]: { name: 'drain-audio.mp3', mimeType: 'audio/mpeg', type: 'file' },
    };
    const buffers = {
      [text.nodeId]: Buffer.from('document body'),
      [image.nodeId]: Buffer.from('image-bytes'),
      [audio.nodeId]: Buffer.from('audio-bytes'),
    };

    const embedCalls = [];
    const adapter = {
      roleConfigured: jest.fn(async () => true),
      async embed(texts) {
        embedCalls.push(texts);
        return {
          vectors: texts.map((_, i) => [1 + i, 0.5, 0.25, 0.125]),
          dim: 4,
          modelId: embedModelId,
        };
      },
      embedMedia: jest.fn(async (items) => ({
        vectors: items.map(() => [0.5, 0.5, 0.5, 0.5]),
        dim: 4,
        modelId: embedModelId,
      })),
      visionCaption: jest.fn(async () => ({ text: '나무가 있는 풍경' })),
      asrTranscribe: jest.fn(async () => ({ text: 'front center' })),
    };

    const service = createAiJobService({
      adapter,
      readText: async () => 'document body',
      readNode: async (nodeId) => nodes[nodeId] ?? null,
      readBlob: async (nodeId) => buffers[nodeId] ?? null,
      // image_embed ON ⇒ direct media; audio_embed OFF ⇒ transcript corpus.
      capabilityEnabled: (capability) =>
        capability === 'image_embed' || capability === 'vision_chat' || capability === 'asr',
      probe: async () => ({
        durationSec: 1.428,
        width: null,
        height: null,
        streams: [{ index: 0, codecType: 'audio', codecName: 'mp3' }],
        tags: {},
      }),
    });

    await service.drainPass();

    // All three pipelines ran; caption/asr wrote their enrichments and
    // chained exactly one embed each.
    expect(adapter.visionCaption).toHaveBeenCalledTimes(1);
    expect(adapter.asrTranscribe).toHaveBeenCalledTimes(1);
    expect(await aiEnrichmentsStore.get(image.nodeId)).toMatchObject({
      caption: '나무가 있는 풍경',
      captionModelId: visionModelId,
    });
    expect(await aiEnrichmentsStore.get(audio.nodeId)).toMatchObject({
      transcript: 'front center',
      asrModelId,
    });

    const imageJobs = await aiJobsStore.listByNode(image.nodeId);
    expect(imageJobs.find((job) => job.kind === 'caption')).toMatchObject({ status: 'done' });
    expect(imageJobs.filter((job) => job.kind === 'embed')).toHaveLength(1);
    const audioJobs = await aiJobsStore.listByNode(audio.nodeId);
    expect(audioJobs.find((job) => job.kind === 'asr')).toMatchObject({ status: 'done' });
    expect(audioJobs.filter((job) => job.kind === 'embed')).toHaveLength(1);

    // Second pass drains the chained media embeds (one direct, one transcript).
    await service.drainPass();

    expect(await embeddingsStore.get(image.nodeId)).toMatchObject({
      modelId: embedModelId,
      source: 'media_direct',
    });
    expect(await embeddingsStore.get(audio.nodeId)).toMatchObject({
      modelId: embedModelId,
      source: 'chunk_pool',
    });
    expect(embedCalls.some((texts) => texts.includes('front center'))).toBe(true);

    // Kinds without a landed executor stay parked: pending, attempt 0.
    const textJobs = await aiJobsStore.listByNode(text.nodeId);
    for (const kind of ['features', 'backfill']) {
      expect(textJobs.find((job) => job.kind === kind)).toMatchObject({
        status: 'pending',
        attempt: 0,
        startedAt: null,
      });
    }
    const counts = await aiJobsStore.countByStatus();
    expect(counts.failed).toBe(0);
    expect(counts.running).toBe(0);
  });

  it('per-role gates park only that role: caption stays queued while embed/asr drain', async () => {
    const text = await createTestFileNode({ name: `drain-gate-text-${Date.now()}.txt` });
    const image = await createTestFileNode({ name: `drain-gate-image-${Date.now()}.jpg` });
    await makeModel('embed', 'embedded');
    await makeModel('vision');
    await makeModel('asr');

    await aiJobsStore.enqueue(text.nodeId, 'embed', 1, 'hash-gate-text');
    await aiJobsStore.enqueue(image.nodeId, 'caption', 1, 'hash-gate-image');

    const adapter = {
      roleConfigured: jest.fn(async (role) => role !== 'vision'),
      embed: jest.fn(async (texts) => ({
        vectors: texts.map(() => [1, 0, 0, 0]),
        dim: 4,
      })),
      visionCaption: jest.fn(),
      asrTranscribe: jest.fn(),
    };

    const service = createAiJobService({
      adapter,
      readText: async () => 'document body',
      readNode: async (nodeId) => ({
        name: nodeId === image.nodeId ? 'gate.jpg' : 'gate.txt',
        mimeType: nodeId === image.nodeId ? 'image/jpeg' : 'text/plain',
        type: 'file',
      }),
      readBlob: async () => Buffer.from('bytes'),
      capabilityEnabled: () => true,
    });

    await service.drainPass();

    expect(adapter.visionCaption).not.toHaveBeenCalled();
    const captionJob = (await aiJobsStore.listByNode(image.nodeId)).find(
      (job) => job.kind === 'caption'
    );
    expect(captionJob).toMatchObject({ status: 'pending', attempt: 0, startedAt: null });
    expect(
      (await aiJobsStore.listByNode(text.nodeId)).find((job) => job.kind === 'embed')
    ).toMatchObject({ status: 'done' });
  });
});
