'use strict';

/**
 * embeddingsChunkStore facade test
 * (docs/spec/server/store/embeddingsChunkStore.md §2.1). L1: the facade is a
 * thin dialect dispatch — observable behavior only, over the real repository
 * twins.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const embeddingsChunkStore = require('@server/store/embeddingsChunkStore');
const llmModelsStore = require('@server/store/llmModelsStore');

describe('embeddingsChunkStore facade', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('delegates replaceChunks/listByNode/get/countByNode/deleteByNode', async () => {
    const node = await createTestFileNode({ name: `chunk-facade-${Date.now()}.txt` });
    const { id } = await llmModelsStore.upsertModel({
      role: 'embed',
      provider: 'embedded',
      engine: 'embedded',
      baseUrlKey: '',
      modelName: 'm',
      modelRevision: 'r',
    });
    const modelId = Number(id);

    await expect(
      embeddingsChunkStore.replaceChunks(node.nodeId, modelId, [
        { chunkIdx: 0, vector: [1, 0] },
        { chunkIdx: 1, vector: [0, 1] },
      ])
    ).resolves.toEqual({ inserted: 2 });

    // Wholesale replace within the space: old set fully discarded.
    await expect(
      embeddingsChunkStore.replaceChunks(node.nodeId, modelId, [{ chunkIdx: 0, vector: [1, 1] }])
    ).resolves.toEqual({ inserted: 1 });

    const listed = await embeddingsChunkStore.listByNode(node.nodeId, { modelId });
    expect(listed.map((c) => c.chunkIdx)).toEqual([0]);
    expect(listed[0].vector).toEqual([1, 1]);

    await expect(embeddingsChunkStore.get(node.nodeId, 0)).resolves.toMatchObject({
      chunkIdx: 0,
      modelId,
    });
    await expect(embeddingsChunkStore.get(node.nodeId, 5)).resolves.toBeNull();
    await expect(embeddingsChunkStore.countByNode(node.nodeId, { modelId })).resolves.toBe(1);

    await expect(embeddingsChunkStore.deleteByNode(node.nodeId)).resolves.toEqual({ changes: 1 });
    await expect(embeddingsChunkStore.countByNode(node.nodeId, { modelId })).resolves.toBe(0);
  });
});
