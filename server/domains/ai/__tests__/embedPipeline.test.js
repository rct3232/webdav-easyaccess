'use strict';

/**
 * B5 (T1.3b) embed-pipeline integration test
 * (docs/spec/server/services/aiJobService.md §2.4, §2.9 — PLAN §27 wave B).
 *
 * RED-first targets per §27: pipeline drain + restart survival. The suite
 * exercises the REAL queue (aiJobsStore) and the REAL canonical embedding
 * stores (via the vectorStore seam's injected write hooks) through
 * createTestDatabase(); the LLM adapter and the blob content source are
 * injected fakes (TESTING_STRATEGY fake-LLM hermeticism — zero HTTP).
 *
 * The module under test is `server/domains/ai/pipelines/embed.js` with
 * `runPendingEmbedJobs(deps)` as the drain entry point.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiJobsStore = require('@server/store/aiJobsStore');
const embeddingsStore = require('@server/store/embeddingsStore');
const embeddingsChunkStore = require('@server/store/embeddingsChunkStore');
const llmModelsStore = require('@server/store/llmModelsStore');
const storage = require('@server/store/storage');
const { createVectorStore } = require('../vectorStore');
const { runPendingEmbedJobs } = require('../pipelines/embed');

async function makeEmbedModel() {
  const { id } = await llmModelsStore.upsertModel({
    role: 'embed',
    provider: 'embedded',
    engine: 'embedded',
    baseUrlKey: '',
    modelName: 'embeddinggemma-2-ONNX',
    modelRevision: `rev-b5-${Date.now()}-${Math.random()}`,
    precision: 'q4',
    maxInputChars: 8192,
    chunkBudget: 4,
    batchSize: 8,
  });
  return Number(id);
}

describe('embed pipeline (B5/T1.3b)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueNode = () =>
    createTestFileNode({ name: `b5-embed-${Date.now()}-${Math.random()}.txt` });

  const enqueueEmbed = async (nodeId, generation, contentHash) =>
    aiJobsStore.enqueue(nodeId, 'embed', generation, contentHash ?? `hash-${Date.now()}`);

  it('pipeline drain: claims the embed job, chunks, embeds, persists pooled + chunk rows, marks done', async () => {
    const node = await uniqueNode();
    const modelId = await makeEmbedModel();
    const embedCalls = [];
    const deps = {
      readText: async () => 'first paragraph\n\nsecond paragraph\n\nthird paragraph',
      adapter: {
        async embed(texts) {
          embedCalls.push(texts);
          return {
            vectors: texts.map((t, i) =>
              Array.from({ length: 8 }, (_, d) => ((i + 1) * (d + 1)) / 16)
            ),
            dim: 8,
            modelId,
          };
        },
      },
      activeModelId: async () => modelId,
    };

    await enqueueEmbed(node.nodeId, 1);
    const done = await runPendingEmbedJobs(deps);
    expect(done).toBe(1);

    // The park&drain contract: the embed job drained, the features job is
    // untouched — its row is the expected leftover pending work.
    const counts = await aiJobsStore.countByStatus();
    expect(counts.done).toBeGreaterThanOrEqual(1);
    expect(counts.failed).toBe(0);
    expect(counts.skipped).toBe(0);

    // Exactly one provider call carrying the SAMPLED chunk set.
    expect(embedCalls).toHaveLength(1);
    expect(embedCalls[0]).toHaveLength(3); // three paragraphs ≤ budget 4 → no sampling

    // Pooled row = mean+renormalized, source=chunk_pool, runtime dim persisted per row.
    const pooled = await embeddingsStore.get(node.nodeId);
    expect(pooled).toMatchObject({ modelId, dim: 8, source: 'chunk_pool' });
    expect(pooled.vector).toHaveLength(8);
    const norm = Math.sqrt(pooled.vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeGreaterThan(0.999);
    expect(norm).toBeLessThan(1.001);

    // Chunk rows = every sampled chunk, dense idx from 0, same space.
    const chunks = await embeddingsChunkStore.listByNode(node.nodeId, { modelId });
    expect(chunks.map((c) => c.chunkIdx)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.vector.length === 8)).toBe(true);
  });

  it('pipeline drain parks kinds without a landed executor (features stays pending, attempt 0)', async () => {
    const node = await uniqueNode();
    const modelId = await makeEmbedModel();
    await enqueueEmbed(node.nodeId, 1);
    await aiJobsStore.enqueue(node.nodeId, 'features', 1);

    const done = await runPendingEmbedJobs({
      readText: async () => 'irrelevant — embed only',
      adapter: {
        async embed(texts) {
          return { vectors: texts.map(() => new Array(8).fill(0.5)), dim: 8, modelId };
        },
      },
      activeModelId: async () => modelId,
    });
    expect(done).toBe(1);

    const history = await aiJobsStore.listByNode(node.nodeId);
    const features = history.find((j) => j.kind === 'features');
    expect(features.status).toBe('pending');
    expect(features.attempt).toBe(0);
    expect(features.startedAt).toBeNull();
  });

  it('restart survival: claimed-but-unfinished job is re-armed by recoverStaleRunning and re-executes to the same single pooled row', async () => {
    const node = await uniqueNode();
    const modelId = await makeEmbedModel();

    // Claim and abandon: the "process death" state is a running row nobody finishes.
    await enqueueEmbed(node.nodeId, 1, 'hash-restart-b5');
    const claimed = await aiJobsStore.claimNext({
      excludeKinds: ['features', 'caption', 'asr', 'backfill'],
    });
    expect(claimed).toMatchObject({ kind: 'embed', status: 'running' });

    // Reap + drain on the restarted worker.
    const reap = await aiJobsStore.recoverStaleRunning(0);
    expect(reap.changes).toBe(1);

    let embedRuns = 0;
    const done = await runPendingEmbedJobs({
      readText: async () => 'survivor text',
      adapter: {
        async embed(texts) {
          embedRuns += 1;
          return { vectors: texts.map(() => new Array(4).fill(0.25)), dim: 4, modelId };
        },
      },
      activeModelId: async () => modelId,
    });
    expect(done).toBe(1);
    expect(embedRuns).toBe(1);

    // Exactly-once per generation: ONE pooled row (upsert-replace), job done.
    // The parked features row from the park test remains the expected
    // leftover pending work (this suite shares one DB).
    const pooled = await embeddingsStore.get(node.nodeId);
    expect(pooled).toMatchObject({
      modelId,
      dim: 4,
      source: 'chunk_pool',
      contentHash: 'hash-restart-b5',
    });
    const counts = await aiJobsStore.countByStatus();
    expect(counts.running).toBe(0);
    expect(counts.failed).toBe(0);
    expect(counts.done).toBeGreaterThanOrEqual(2);
  });

  it('stale-dim: runtime dim ≠ persisted pooled-row dim enqueues ONE backfill rebuild driver (dedupe holds) and still writes the fresh space', async () => {
    const node = await uniqueNode();
    const modelId = await makeEmbedModel();
    const deps = {
      readText: async () => 're-modelled text',
      adapter: {
        async embed(texts) {
          return { vectors: texts.map(() => new Array(4).fill(0.5)), dim: 4, modelId };
        },
      },
      activeModelId: async () => modelId,
    };

    // Seed the node in the SAME model space at a DIFFERENT (stale) dim.
    await embeddingsStore.upsert(node.nodeId, {
      modelId,
      dim: 8,
      vector: new Array(8).fill(0.125),
      source: 'chunk_pool',
      contentHash: 'old',
    });

    await enqueueEmbed(node.nodeId, 1);
    await expect(runPendingEmbedJobs(deps)).resolves.toBe(1);

    const history = await aiJobsStore.listByNode(node.nodeId);
    const drivers = history.filter((j) => j.kind === 'backfill');
    expect(drivers).toHaveLength(1);
    expect(drivers[0].status).toBe('pending');
    expect(drivers[0].contentHash).toBe(`shadow-rebuild:${Number(node.nodeId)}:${modelId}`);

    // Fresh-space write still landed at the runtime dim.
    const pooled = await embeddingsStore.get(node.nodeId);
    expect(pooled).toMatchObject({ modelId, dim: 4 });
    expect(pooled.vector).toHaveLength(4);

    // Re-running under the same condition enqueues nothing new: the
    // re-enqueued embed dedupes to null (UNIQUE per generation) and the ONE
    // existing driver stays the only one.
    await expect(aiJobsStore.enqueue(node.nodeId, 'embed', 1)).resolves.toBeNull();
    await runPendingEmbedJobs(deps);
    const driversAfter = (await aiJobsStore.listByNode(node.nodeId)).filter(
      (j) => j.kind === 'backfill'
    );
    expect(driversAfter).toHaveLength(1);
  });

  it('content-hash skip: same model + same hash ⇒ markSkipped, zero provider calls', async () => {
    const node = await uniqueNode();
    const modelId = await makeEmbedModel();
    await embeddingsStore.upsert(node.nodeId, {
      modelId,
      dim: 4,
      vector: new Array(4).fill(0.5),
      source: 'chunk_pool',
      contentHash: 'same-hash',
    });

    let calls = 0;
    await enqueueEmbed(node.nodeId, 1, 'same-hash');
    const done = await runPendingEmbedJobs({
      readText: async () => 'never read',
      adapter: {
        async embed(texts) {
          calls += 1;
          return { vectors: texts.map(() => new Array(4).fill(0.5)), dim: 4, modelId };
        },
      },
      activeModelId: async () => modelId,
    });
    expect(done).toBe(1);
    expect(calls).toBe(0);
    await expect(aiJobsStore.countByStatus()).resolves.toMatchObject({ skipped: 1 });
    const pooled = await embeddingsStore.get(node.nodeId);
    expect(pooled.contentHash).toBe('same-hash'); // untouched
  });

  it('uses the injected seam hooks: canonical halves + shadow sync in ONE transaction', async () => {
    const node = await uniqueNode();
    const modelId = await makeEmbedModel();
    const executor = storage.getExecutor();

    // Spy on the executor transaction so we can prove the shadow sync ran on
    // the SAME handle as the canonical writes (§2.2 one-TX contract).
    const originalTx = executor.transaction.bind(executor);
    const txHandles = [];
    const txSpy = jest.spyOn(executor, 'transaction').mockImplementation((fn) =>
      originalTx(async (tx) => {
        txHandles.push(tx);
        return fn(tx);
      })
    );

    const shadowCalls = [];
    const engine = {
      init: jest.fn().mockResolvedValue('ok'),
      neighbors: jest.fn(),
      allVectors: jest.fn(),
      rebuildShadow: jest.fn(),
      syncShadow: jest.fn(async (tx, nodeId, pooledText, chunkTexts) => {
        shadowCalls.push({ tx, nodeId, pooledText, chunkTexts });
      }),
    };
    const store = await createVectorStore({
      executor,
      modelId,
      dim: 8,
      health: { report: jest.fn() },
      loadRows: async () => [],
      sqliteDb: { marker: 'sqlite' },
      probeSqlite: () => ({ available: true, reason: null, hint: null }),
      createSqlite: () => engine,
    });

    try {
      const seamHooks = {
        transaction: jest.fn((...args) => store.hooks.transaction(...args)),
        upsertPooled: jest.fn((...args) => store.hooks.upsertPooled(...args)),
        replaceChunks: jest.fn((...args) => store.hooks.replaceChunks(...args)),
      };

      await enqueueEmbed(node.nodeId, 1);
      const done = await runPendingEmbedJobs({
        readText: async () => 'one paragraph\n\ntwo paragraph',
        adapter: {
          async embed(texts) {
            return {
              vectors: texts.map((t, i) => new Array(8).fill((i + 1) / 8)),
              dim: 8,
              modelId,
            };
          },
        },
        activeModelId: async () => modelId,
        vectorStore: seamHooks,
      });
      expect(seamHooks.transaction).toHaveBeenCalledTimes(1);
      expect(seamHooks.upsertPooled).toHaveBeenCalledTimes(1);
      expect(seamHooks.replaceChunks).toHaveBeenCalledTimes(1);
      expect(done).toBe(1);
    } finally {
      txSpy.mockRestore();
    }

    // Canonical halves landed …
    const pooled = await embeddingsStore.get(node.nodeId);
    expect(pooled).toMatchObject({ modelId, dim: 8, source: 'chunk_pool' });
    expect(await embeddingsChunkStore.listByNode(node.nodeId, { modelId })).toHaveLength(2);

    // … and the derived shadow sync rode the SAME tx handle (one transaction).
    expect(txHandles).toHaveLength(1);
    expect(shadowCalls).toHaveLength(1);
    expect(shadowCalls[0].tx).toBe(txHandles[0]);
    expect(shadowCalls[0].nodeId).toBe(Number(node.nodeId));
    expect(String(shadowCalls[0].pooledText).split(',')).toHaveLength(8);
    expect(shadowCalls[0].chunkTexts).toHaveLength(2);
  });

  it('model change: persisted row in another model space enqueues ONE deduped backfill driver', async () => {
    const node = await uniqueNode();
    const oldModelId = await makeEmbedModel();
    const modelId = await makeEmbedModel();

    // Same dim, DIFFERENT model space — the driver condition must catch the
    // model change, not only a dim change (PLAN §28.3.3 B-4).
    await embeddingsStore.upsert(node.nodeId, {
      modelId: oldModelId,
      dim: 4,
      vector: new Array(4).fill(0.25),
      source: 'chunk_pool',
      contentHash: 'old-model-hash',
    });

    await enqueueEmbed(node.nodeId, 1);
    await expect(
      runPendingEmbedJobs({
        readText: async () => 'space moved',
        adapter: {
          async embed(texts) {
            return { vectors: texts.map(() => new Array(4).fill(0.5)), dim: 4, modelId };
          },
        },
        activeModelId: async () => modelId,
      })
    ).resolves.toBe(1);

    const drivers = (await aiJobsStore.listByNode(node.nodeId)).filter(
      (j) => j.kind === 'backfill'
    );
    expect(drivers).toHaveLength(1);
    expect(drivers[0].contentHash).toBe(`shadow-rebuild:${Number(node.nodeId)}:${modelId}`);
    expect(drivers[0].status).toBe('pending'); // executor parked until T4.1

    const pooled = await embeddingsStore.get(node.nodeId);
    expect(pooled).toMatchObject({ modelId, dim: 4 });
  });
});
