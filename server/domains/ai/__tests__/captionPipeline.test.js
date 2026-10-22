'use strict';

/**
 * caption pipeline tests (aiJobService.md §2.4 `caption`, §5 scenario list).
 *
 * Hermetic: the REAL queue + `ai_enrichments` rows over the test database,
 * a fake vision adapter and a fake blob source. Frame sampling is stubbed at
 * the pipeline seam; the real ffmpeg sampler has its own fixture test in
 * mediaSampling.test.js.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiJobsStore = require('@server/store/aiJobsStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const { createCaptionPipeline, CAPTION_PROMPT } = require('../pipelines/caption');

async function makeModel(role) {
  const { id } = await llmModelsStore.upsertModel({
    role,
    provider: 'remote',
    engine: 'remote',
    baseUrlKey: 'LLM_TEST',
    modelName: `${role}-model`,
    modelRevision: `rev-${role}-${Date.now()}-${Math.random()}`,
  });
  return Number(id);
}

describe('caption pipeline', () => {
  let dbCleanup;
  let pipeline;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    pipeline = createCaptionPipeline();
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const captionJobs = async (nodeId) =>
    (await aiJobsStore.listByNode(nodeId)).filter((job) => job.kind === 'caption');
  const embedJobs = async (nodeId) =>
    (await aiJobsStore.listByNode(nodeId)).filter((job) => job.kind === 'embed');

  it('image: one frame, Korean caption written with its model, ONE chained embed job', async () => {
    const node = await createTestFileNode({ name: `caption-image-${Date.now()}.jpg` });
    const visionModelId = await makeModel('vision');
    const buffer = Buffer.from('image-bytes');
    const visionCaption = jest.fn(async () => ({ text: ' 바다가 보이는 사진입니다. ' }));
    const adapter = { roleConfigured: jest.fn(async () => true), visionCaption };
    const sampleFrames = jest.fn();

    await aiJobsStore.enqueue(node.nodeId, 'caption', 1, 'hash-caption-image');
    const done = await pipeline.runPendingCaptionJobs({
      adapter,
      readNode: async () => ({ name: node.name, mimeType: 'image/jpeg', type: 'file' }),
      readBlob: async () => buffer,
      sampleFrames,
      visionModelId: async () => visionModelId,
      capabilityEnabled: () => true,
    });
    expect(done).toBe(1);

    // Images are a single frame — no sampling call, the raw bytes go to the VLM.
    expect(sampleFrames).not.toHaveBeenCalled();
    expect(visionCaption).toHaveBeenCalledTimes(1);
    const [frames, opts] = visionCaption.mock.calls[0];
    expect(frames).toEqual([buffer]);
    expect(opts.prompt).toBe(CAPTION_PROMPT);
    expect(CAPTION_PROMPT).toMatch(/한국어/);

    const row = await aiEnrichmentsStore.get(node.nodeId);
    expect(row).toMatchObject({
      caption: '바다가 보이는 사진입니다.',
      captionModelId: visionModelId,
    });

    // ONE chained embed (caption text is the media corpus), same generation.
    const embeds = await embedJobs(node.nodeId);
    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({
      status: 'pending',
      generation: 1,
      contentHash: 'hash-caption-image',
    });

    const jobs = await captionJobs(node.nodeId);
    expect(jobs[0]).toMatchObject({ status: 'done' });
  });

  it('video: samples ≤4 transient frames and hands exactly those buffers to the VLM', async () => {
    const node = await createTestFileNode({ name: `caption-video-${Date.now()}.mp4` });
    const frames = [Buffer.from('f1'), Buffer.from('f2'), Buffer.from('f3')];
    const visionCaption = jest.fn(async () => ({ text: '장면 설명' }));
    const adapter = { roleConfigured: jest.fn(async () => true), visionCaption };
    const sampleFrames = jest.fn(async () => frames);

    await aiJobsStore.enqueue(node.nodeId, 'caption', 1, null);
    const done = await pipeline.runPendingCaptionJobs({
      adapter,
      readNode: async () => ({ name: node.name, mimeType: 'video/mp4', type: 'file' }),
      readBlob: async () => Buffer.from('video-bytes'),
      sampleFrames,
      visionModelId: async () => null,
      capabilityEnabled: () => true,
    });
    expect(done).toBe(1);

    expect(sampleFrames).toHaveBeenCalledTimes(1);
    expect(sampleFrames.mock.calls[0][1]).toMatchObject({ maxFrames: 4 });
    const passedFrames = visionCaption.mock.calls[0][0];
    expect(passedFrames).toHaveLength(3);
    // Same buffer references: frames were never re-encoded or persisted.
    passedFrames.forEach((frame, i) => expect(frame).toBe(frames[i]));

    const row = await aiEnrichmentsStore.get(node.nodeId);
    expect(row.caption).toBe('장면 설명');
    expect(row.captionModelId).toBeNull(); // no vision registry row ⇒ null lineage
    expect(await embedJobs(node.nodeId)).toHaveLength(1);
  });

  it('capability absent ⇒ typed skip, zero provider calls, no enrichment, no embed chain', async () => {
    const node = await createTestFileNode({ name: `caption-off-${Date.now()}.png` });
    const visionCaption = jest.fn();
    const adapter = { roleConfigured: jest.fn(async () => true), visionCaption };

    await aiJobsStore.enqueue(node.nodeId, 'caption', 1, null);
    const done = await pipeline.runPendingCaptionJobs({
      adapter,
      readNode: async () => ({ name: node.name, mimeType: 'image/png', type: 'file' }),
      readBlob: async () => Buffer.from('png'),
      capabilityEnabled: () => false,
    });
    expect(done).toBe(1);
    expect(visionCaption).not.toHaveBeenCalled();
    expect(await aiEnrichmentsStore.get(node.nodeId)).toBeNull();
    expect(await embedJobs(node.nodeId)).toHaveLength(0);
    expect((await captionJobs(node.nodeId))[0]).toMatchObject({
      status: 'skipped',
      lastError: 'capability_absent',
    });
  });

  it('vision role unconfigured ⇒ caption jobs stay queued (attempt 0)', async () => {
    const node = await createTestFileNode({ name: `caption-park-${Date.now()}.jpg` });
    const adapter = {
      roleConfigured: jest.fn(async () => false),
      visionCaption: jest.fn(),
    };

    await aiJobsStore.enqueue(node.nodeId, 'caption', 1, null);
    const done = await pipeline.runPendingCaptionJobs({
      adapter,
      readNode: async () => ({ name: node.name, mimeType: 'image/jpeg', type: 'file' }),
      readBlob: async () => Buffer.from('jpg'),
      capabilityEnabled: () => true,
    });
    expect(done).toBe(0);
    expect(adapter.visionCaption).not.toHaveBeenCalled();
    expect((await captionJobs(node.nodeId))[0]).toMatchObject({
      status: 'pending',
      attempt: 0,
      startedAt: null,
    });
  });

  it('never claims other kinds: parked embed/features/asr/backfill stay untouched', async () => {
    const node = await createTestFileNode({ name: `caption-parking-${Date.now()}.jpg` });
    await aiJobsStore.enqueue(node.nodeId, 'caption', 1, null);
    await aiJobsStore.enqueue(node.nodeId, 'embed', 1, null);
    await aiJobsStore.enqueue(node.nodeId, 'features', 1, null);
    await aiJobsStore.enqueue(node.nodeId, 'asr', 1, null);
    await aiJobsStore.enqueue(node.nodeId, 'backfill', 1, null);

    const done = await pipeline.runPendingCaptionJobs({
      adapter: {
        roleConfigured: jest.fn(async () => true),
        visionCaption: jest.fn(async () => ({ text: '캡션' })),
      },
      readNode: async () => ({ name: node.name, mimeType: 'image/jpeg', type: 'file' }),
      readBlob: async () => Buffer.from('jpg'),
      capabilityEnabled: () => true,
    });
    // A parked caption row from the earlier role-gate test is still claimable
    // now that the fake role reports configured — this drain may pick it up.
    expect(done).toBeGreaterThanOrEqual(1);

    const byKind = new Map(
      (await aiJobsStore.listByNode(node.nodeId)).map((job) => [job.kind, job])
    );
    expect(byKind.get('caption').status).toBe('done');
    for (const kind of ['embed', 'features', 'asr', 'backfill']) {
      expect(byKind.get(kind)).toMatchObject({ status: 'pending', attempt: 0 });
    }
  });
});
