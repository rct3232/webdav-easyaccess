'use strict';

/**
 * asr pipeline tests (aiJobService.md §2.4 `asr`, §5 scenario list).
 *
 * Hermetic: the REAL queue + `ai_enrichments` rows over the test database,
 * a fake asr adapter, a fake blob source and a fake ffprobe seam. The E13
 * field freeze is asserted structurally: only `transcript`/`asr_model_id`/
 * `probe`/`media_kind` are written — there is no audio_desc/genre/mood field.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiJobsStore = require('@server/store/aiJobsStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const { createAsrPipeline } = require('../pipelines/asr');

async function makeModel() {
  const { id } = await llmModelsStore.upsertModel({
    role: 'asr',
    provider: 'remote',
    engine: 'remote',
    baseUrlKey: 'LLM_TEST',
    modelName: 'asr-model',
    modelRevision: `rev-asr-${Date.now()}-${Math.random()}`,
  });
  return Number(id);
}

const audioProbe = {
  durationSec: 1.428,
  width: null,
  height: null,
  streams: [{ index: 0, codecType: 'audio', codecName: 'pcm_s16le' }],
  tags: { encoder: 'Lavf' },
};

describe('asr pipeline', () => {
  let dbCleanup;
  let pipeline;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    pipeline = createAsrPipeline();
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const asrJobs = async (nodeId) =>
    (await aiJobsStore.listByNode(nodeId)).filter((job) => job.kind === 'asr');
  const embedJobs = async (nodeId) =>
    (await aiJobsStore.listByNode(nodeId)).filter((job) => job.kind === 'embed');

  it('transcribes with the mandatory escape prompt and writes transcript/asr_model_id/probe', async () => {
    const node = await createTestFileNode({ name: `asr-speech-${Date.now()}.wav` });
    const asrModelId = await makeModel();
    const buffer = Buffer.from('wav-bytes');
    const asrTranscribe = jest.fn(async () => ({ text: 'front center' }));
    const adapter = { roleConfigured: jest.fn(async () => true), asrTranscribe };
    const probe = jest.fn(async () => audioProbe);

    await aiJobsStore.enqueue(node.nodeId, 'asr', 1, 'hash-asr-speech');
    const done = await pipeline.runPendingAsrJobs({
      adapter,
      readNode: async () => ({ name: node.name, mimeType: 'audio/wav', type: 'file' }),
      readBlob: async () => buffer,
      probe,
      asrModelId: async () => asrModelId,
      capabilityEnabled: () => true,
    });
    expect(done).toBe(1);

    // The escape-prompt flag is ALWAYS sent (the adapter owns the template).
    expect(asrTranscribe).toHaveBeenCalledTimes(1);
    expect(asrTranscribe).toHaveBeenCalledWith(buffer, { escapePrompt: true });
    expect(probe).toHaveBeenCalledWith(buffer, { mimeType: 'audio/wav' });

    const row = await aiEnrichmentsStore.get(node.nodeId);
    expect(row).toMatchObject({
      transcript: 'front center',
      asrModelId,
      probe: audioProbe,
      mediaKind: null,
    });
    // E13 freeze: no generated descriptive fields exist on the row shape.
    expect(row).not.toHaveProperty('audioDesc');
    expect(row).not.toHaveProperty('genre');
    expect(row).not.toHaveProperty('mood');

    expect(await embedJobs(node.nodeId)).toHaveLength(1);
    expect((await asrJobs(node.nodeId))[0]).toMatchObject({ status: 'done' });
  });

  it('a `none` answer writes NO transcript but still chains the metadata_only embed', async () => {
    const node = await createTestFileNode({ name: `asr-none-${Date.now()}.wav` });
    await aiJobsStore.enqueue(node.nodeId, 'asr', 1, null);

    const done = await pipeline.runPendingAsrJobs({
      adapter: {
        roleConfigured: jest.fn(async () => true),
        asrTranscribe: jest.fn(async () => ({ text: 'None.' })),
      },
      readNode: async () => ({ name: node.name, mimeType: 'audio/wav', type: 'file' }),
      readBlob: async () => Buffer.from('silence'),
      probe: async () => audioProbe,
      asrModelId: async () => null,
      capabilityEnabled: () => true,
    });
    expect(done).toBe(1);

    expect(await aiEnrichmentsStore.get(node.nodeId)).toBeNull();
    expect(await embedJobs(node.nodeId)).toHaveLength(1);
  });

  it('music-tagged audio ⇒ media_kind=music stored with the lyrics transcript', async () => {
    const node = await createTestFileNode({ name: `asr-music-${Date.now()}.mp3` });
    await aiJobsStore.enqueue(node.nodeId, 'asr', 1, null);

    const done = await pipeline.runPendingAsrJobs({
      adapter: {
        roleConfigured: jest.fn(async () => true),
        asrTranscribe: jest.fn(async () => ({ text: 'we will rock you' })),
      },
      readNode: async () => ({ name: node.name, mimeType: 'audio/mpeg', type: 'file' }),
      readBlob: async () => Buffer.from('mp3'),
      probe: async () => ({ ...audioProbe, tags: { artist: 'Queen', genre: 'Rock' } }),
      asrModelId: async () => null,
      capabilityEnabled: () => true,
    });
    expect(done).toBe(1);

    const row = await aiEnrichmentsStore.get(node.nodeId);
    expect(row).toMatchObject({ transcript: 'we will rock you', mediaKind: 'music' });
    expect(await embedJobs(node.nodeId)).toHaveLength(1);
  });

  it('capability absent ⇒ typed skip, no provider call, no transcript', async () => {
    const node = await createTestFileNode({ name: `asr-off-${Date.now()}.wav` });
    const asrTranscribe = jest.fn();

    await aiJobsStore.enqueue(node.nodeId, 'asr', 1, null);
    const done = await pipeline.runPendingAsrJobs({
      adapter: { roleConfigured: jest.fn(async () => true), asrTranscribe },
      readNode: async () => ({ name: node.name, mimeType: 'audio/wav', type: 'file' }),
      readBlob: async () => Buffer.from('wav'),
      capabilityEnabled: () => false,
    });
    expect(done).toBe(1);
    expect(asrTranscribe).not.toHaveBeenCalled();
    expect(await aiEnrichmentsStore.get(node.nodeId)).toBeNull();
    expect(await embedJobs(node.nodeId)).toHaveLength(0);
    expect((await asrJobs(node.nodeId))[0]).toMatchObject({
      status: 'skipped',
      lastError: 'capability_absent',
    });
  });

  it('asr role unconfigured ⇒ asr jobs stay queued (attempt 0)', async () => {
    const node = await createTestFileNode({ name: `asr-park-${Date.now()}.wav` });
    const asrTranscribe = jest.fn();

    await aiJobsStore.enqueue(node.nodeId, 'asr', 1, null);
    const done = await pipeline.runPendingAsrJobs({
      adapter: { roleConfigured: jest.fn(async () => false), asrTranscribe },
      readNode: async () => ({ name: node.name, mimeType: 'audio/wav', type: 'file' }),
      readBlob: async () => Buffer.from('wav'),
      capabilityEnabled: () => true,
    });
    expect(done).toBe(0);
    expect(asrTranscribe).not.toHaveBeenCalled();
    expect((await asrJobs(node.nodeId))[0]).toMatchObject({
      status: 'pending',
      attempt: 0,
      startedAt: null,
    });
  });
});
