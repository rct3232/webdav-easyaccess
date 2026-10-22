'use strict';

/**
 * mediaBackfillScope — media coverage classification and the admin re-embed
 * plan (aiJobService.md §2.4 media branch + backfill ownership).
 *
 * Hermetic: REAL node/embeddings/enrichment stores over the test database;
 * only the capability probe is injected.
 */

const {
  createTestDatabase,
  createTestUser,
  createTestFileNode,
  createUserRootNode,
} = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const aiJobsStore = require('@server/store/aiJobsStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const {
  classifyMediaNode,
  mediaFallbackCorpus,
  buildMediaBackfillScope,
  planMediaBackfill,
} = require('../media/mediaBackfillScope');

async function makeEmbedModel(revisionSuffix) {
  const { id } = await llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    modelRevision: `rev-scope-${revisionSuffix}-${Date.now()}-${Math.random()}`,
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
  });
  return Number(id);
}

async function putPooled(nodeId, modelId, source) {
  await embeddingsStore.upsert(nodeId, {
    modelId,
    dim: 4,
    vector: [0.1, 0.2, 0.3, 0.4],
    source,
    contentHash: null,
  });
}

describe('mediaBackfillScope', () => {
  let dbCleanup;
  let fileNodesStore;
  let userId;
  let otherUserId;
  let ownRootId;
  let otherRootId;
  let modelId;
  let staleModelId;
  const nodeIds = {};

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    userId = (await createTestUser({ username: 'scope-owner' })).id;
    otherUserId = (await createTestUser({ username: 'scope-other' })).id;
    ownRootId = (await createUserRootNode({ userId })).nodeId;
    otherRootId = (await createUserRootNode({ userId: otherUserId })).nodeId;
    modelId = await makeEmbedModel('current');
    staleModelId = await makeEmbedModel('previous');
  });

  afterAll(async () => {
    await dbCleanup();
  });

  async function addNode(key, name, parentId, mimeType) {
    const created = await createTestFileNode({ name, type: 'file', parentId });
    nodeIds[key] = Number(created.nodeId);
    if (mimeType) {
      await fileNodesStore.upsertCache(Number(created.nodeId), 10, mimeType, null);
    }
    return Number(created.nodeId);
  }

  describe('classifyMediaNode / mediaFallbackCorpus', () => {
    it('classifies media by extension, then by stored mime, and rejects non-media', () => {
      expect(classifyMediaNode({ name: 'a.JPG' })).toBe('image');
      expect(classifyMediaNode({ name: 'a.webm' })).toBe('video');
      expect(classifyMediaNode({ name: 'a.flac' })).toBe('audio');
      expect(classifyMediaNode({ name: 'no-extension', mimeType: 'video/mp4' })).toBe('video');
      expect(classifyMediaNode({ name: 'notes.txt', mimeType: 'text/plain' })).toBeNull();
      expect(classifyMediaNode({ name: 'photos', type: 'directory' })).toBeNull();
      expect(classifyMediaNode(null)).toBeNull();
    });

    it('selects the caption/transcript corpus and never feeds music rows into it', () => {
      expect(mediaFallbackCorpus('image', { caption: '바다' })).toEqual({
        source: 'caption_fallback',
        text: '바다',
      });
      expect(mediaFallbackCorpus('video', { caption: '공원' })).toEqual({
        source: 'caption_fallback',
        text: '공원',
      });
      expect(mediaFallbackCorpus('audio', { transcript: '회의 녹음' })).toEqual({
        source: 'transcript_fallback',
        text: '회의 녹음',
      });
      expect(
        mediaFallbackCorpus('audio', { transcript: 'we will rock you', mediaKind: 'music' })
      ).toBeNull();
      expect(mediaFallbackCorpus('audio', { transcript: '' })).toBeNull();
      expect(mediaFallbackCorpus('image', { caption: null })).toBeNull();
      expect(mediaFallbackCorpus('image', null)).toBeNull();
    });
  });

  describe('buildMediaBackfillScope', () => {
    it('classifies own-root media nodes into the six coverage states', async () => {
      await addNode('directImage', 'direct.jpg', ownRootId);
      await addNode('captionImage', 'caption.png', ownRootId);
      await addNode('captionVideo', 'clip.mp4', ownRootId);
      await addNode('transcriptAudio', 'talk.m4a', ownRootId);
      await addNode('musicAudio', 'song.mp3', ownRootId);
      await addNode('missingImage', 'new.jpg', ownRootId);
      await addNode('staleVideo', 'old.mkv', ownRootId);
      await addNode('doc', 'report.pdf', ownRootId);
      await addNode('mimeOnly', 'voice-note', ownRootId, 'audio/webm');
      await addNode('otherUserImage', 'theirs.jpg', otherRootId);

      await putPooled(nodeIds.directImage, modelId, 'media_direct');
      await putPooled(nodeIds.captionImage, modelId, 'chunk_pool');
      await putPooled(nodeIds.captionVideo, modelId, 'head');
      await putPooled(nodeIds.transcriptAudio, modelId, 'chunk_pool');
      await putPooled(nodeIds.musicAudio, modelId, 'metadata_only');
      await putPooled(nodeIds.staleVideo, staleModelId, 'media_direct');
      await putPooled(nodeIds.otherUserImage, modelId, 'media_direct');

      await aiEnrichmentsStore.upsert(nodeIds.captionImage, { caption: '바다가 보이는 사진' });
      await aiEnrichmentsStore.upsert(nodeIds.captionVideo, { caption: '공원을 걷는 사람들' });
      await aiEnrichmentsStore.upsert(nodeIds.transcriptAudio, { transcript: '회의 녹음 전사' });
      await aiEnrichmentsStore.upsert(nodeIds.musicAudio, {
        transcript: 'we will rock you',
        mediaKind: 'music',
      });

      const caps = { image_embed: true, video_embed: false, audio_embed: true };
      const scope = await buildMediaBackfillScope({
        userId,
        modelId,
        fileNodesStore,
        embeddingsStore,
        aiEnrichmentsStore,
        capabilityEnabled: (capability) => caps[capability] === true,
      });

      // 8 own-root media nodes (direct, caption-image, caption-video,
      // transcript, music, missing, stale, mime-only) — doc + other user out.
      expect(scope.userId).toBe(Number(userId));
      expect(scope.modelId).toBe(modelId);
      expect(scope.totals).toEqual({ media: 8, embedded: 5, missing: 2, stale: 1 });
      expect(scope.bySource).toEqual({
        media_direct: 1,
        caption_fallback: 2,
        transcript_fallback: 1,
        metadata_only: 1,
        missing: 2,
        stale_space: 1,
      });
      expect(scope.byMediaKind).toEqual({
        image: { media: 3, embedded: 2, missing: 1, stale: 0 },
        video: { media: 2, embedded: 1, missing: 0, stale: 1 },
        audio: { media: 3, embedded: 2, missing: 1, stale: 0 },
      });
      expect(scope.byCapability).toEqual({ enabled: 6, disabled: 2 });
      // Fallback-corpus availability: caption ×2, transcript ×1, none ×5 —
      // the music transcript never counts as a corpus.
      expect(scope.byCorpus).toEqual({ caption: 2, transcript: 1, none: 5 });
      expect(scope.missingIds).toEqual(
        [nodeIds.missingImage, nodeIds.mimeOnly].sort((a, b) => a - b)
      );
      expect(scope.staleIds).toEqual([nodeIds.staleVideo]);
      expect(scope.sampleMissing).toEqual(scope.missingIds);
      expect(scope.sampleStale).toEqual([nodeIds.staleVideo]);
    });

    it('scopes to one requester: another user sees only their own root', async () => {
      const scope = await buildMediaBackfillScope({
        userId: otherUserId,
        modelId,
        fileNodesStore,
        embeddingsStore,
        aiEnrichmentsStore,
        capabilityEnabled: () => false,
      });
      expect(scope.totals).toEqual({ media: 1, embedded: 1, missing: 0, stale: 0 });
      expect(scope.bySource).toMatchObject({ media_direct: 1, missing: 0, stale_space: 0 });
    });

    it('admin path (no userId) covers every live root subtree', async () => {
      const scope = await buildMediaBackfillScope({
        modelId,
        fileNodesStore,
        embeddingsStore,
        aiEnrichmentsStore,
        capabilityEnabled: () => true,
      });
      expect(scope.userId).toBeNull();
      expect(scope.totals).toEqual({ media: 9, embedded: 6, missing: 2, stale: 1 });
      expect(scope.byCapability).toEqual({ enabled: 9, disabled: 0 });
    });

    it('samples are bounded and deterministic (lowest ids), repeat runs identical', async () => {
      const call = () =>
        buildMediaBackfillScope({
          userId,
          modelId,
          fileNodesStore,
          embeddingsStore,
          aiEnrichmentsStore,
          capabilityEnabled: () => true,
          sampleSize: 1,
        });
      const first = await call();
      const second = await call();
      expect(first.sampleMissing).toHaveLength(1);
      expect(first.sampleMissing).toEqual([first.missingIds[0]]);
      expect(second.sampleMissing).toEqual(first.sampleMissing);
      expect(first.sampleStale).toEqual([nodeIds.staleVideo]);
      expect(second).toEqual(first);
    });

    it('returns an empty scope when the requester has no root node', async () => {
      const strangerId = (await createTestUser({ username: 'scope-stranger' })).id;
      const scope = await buildMediaBackfillScope({
        userId: strangerId,
        modelId,
        fileNodesStore,
        embeddingsStore,
        aiEnrichmentsStore,
        capabilityEnabled: () => true,
      });
      expect(scope.totals).toEqual({ media: 0, embedded: 0, missing: 0, stale: 0 });
      expect(scope.missingIds).toEqual([]);
      expect(scope.sampleMissing).toEqual([]);
    });
  });

  describe('planMediaBackfill', () => {
    it('plans missing ∪ stale id-ascending, capped by limit, and enqueues nothing', async () => {
      const scope = await buildMediaBackfillScope({
        userId,
        modelId,
        fileNodesStore,
        embeddingsStore,
        aiEnrichmentsStore,
        capabilityEnabled: () => false,
      });
      const before = await aiJobsStore.countByStatus();

      const full = planMediaBackfill({ scope });
      const expected = [...scope.missingIds, ...scope.staleIds].sort((a, b) => a - b);
      expect(full).toEqual(expected);

      const capped = planMediaBackfill({ scope, limit: 2 });
      expect(capped).toEqual(expected.slice(0, 2));
      expect(planMediaBackfill({ scope, limit: 0 })).toEqual([]);

      const after = await aiJobsStore.countByStatus();
      expect(after).toEqual(before);
    });

    it('returns an empty plan for a missing scope', () => {
      expect(planMediaBackfill({})).toEqual([]);
      expect(planMediaBackfill()).toEqual([]);
    });
  });
});
