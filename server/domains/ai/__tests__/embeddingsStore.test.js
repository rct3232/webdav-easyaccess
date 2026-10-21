'use strict';

/**
 * embeddingsStore facade test (docs/spec/server/store/embeddingsStore.md
 * §2.1). L1: the facade is a thin dialect dispatch — observable behavior
 * only, over the real repository twins.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const embeddingsStore = require('@server/store/embeddingsStore');
const llmModelsStore = require('@server/store/llmModelsStore');

describe('embeddingsStore facade', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('delegates upsert/get/listAll/countByModel with domain-shaped rows', async () => {
    const node = await createTestFileNode({ name: `emb-facade-${Date.now()}.txt` });
    const { id } = await llmModelsStore.upsertModel({
      role: 'embed',
      provider: 'embedded',
      engine: 'embedded',
      baseUrlKey: '',
      modelName: 'm',
      modelRevision: 'r',
    });

    await expect(
      embeddingsStore.upsert(node.nodeId, {
        modelId: Number(id),
        dim: 2,
        vector: [1, 0],
        source: 'chunk_pool',
        contentHash: 'h1',
      })
    ).resolves.toEqual({ changes: 1 });

    await expect(embeddingsStore.get(node.nodeId)).resolves.toMatchObject({
      nodeId: Number(node.nodeId),
      modelId: Number(id),
      dim: 2,
      vector: [1, 0],
      source: 'chunk_pool',
      contentHash: 'h1',
    });

    // Upsert-replace: one row per node, latest wins.
    await embeddingsStore.upsert(node.nodeId, {
      modelId: Number(id),
      dim: 4,
      vector: [0.5, 0.5, 0.5, 0.5],
      source: 'head',
      contentHash: 'h2',
    });
    await expect(embeddingsStore.get(node.nodeId)).resolves.toMatchObject({
      dim: 4,
      source: 'head',
    });

    await expect(embeddingsStore.listAll(Number(id))).resolves.toHaveLength(1);
    await expect(embeddingsStore.countByModel(Number(id))).resolves.toBe(1);
    await expect(embeddingsStore.getByNodeIds([Number(node.nodeId)])).resolves.toHaveLength(1);
    await expect(embeddingsStore.get(999999)).resolves.toBeNull();
  });
});
