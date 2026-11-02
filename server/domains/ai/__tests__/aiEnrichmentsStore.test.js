'use strict';

/**
 * aiEnrichmentsStore facade test (docs/spec/server/store/aiEnrichmentsStore.md
 * §2.1). L1: observable behavior only, over the real repository twin selected
 * by the test database.
 */

const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiEnrichmentsStore = require('@server/store/aiEnrichmentsStore');
const llmModelsStore = require('@server/store/llmModelsStore');

async function makeModel(role, name) {
  const { id } = await llmModelsStore.upsertModel({
    role,
    provider: 'remote',
    engine: 'remote',
    baseUrlKey: 'LLM_TEST',
    modelName: name,
    modelRevision: `rev-${role}-${Date.now()}-${Math.random()}`,
  });
  return Number(id);
}

describe('aiEnrichmentsStore facade', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('get on an unenriched node resolves null', async () => {
    const node = await createTestFileNode({ name: `enrich-empty-${Date.now()}.txt` });
    await expect(aiEnrichmentsStore.get(node.nodeId)).resolves.toBeNull();
  });

  it('upsert is a partial producer-family patch: caption and asr writes coexist', async () => {
    const node = await createTestFileNode({ name: `enrich-patch-${Date.now()}.txt` });
    const captionModelId = await makeModel('vision', 'vision-model');
    const asrModelId = await makeModel('asr', 'asr-model');

    await expect(
      aiEnrichmentsStore.upsert(node.nodeId, {
        caption: '바다가 보이는 사진',
        captionModelId,
      })
    ).resolves.toEqual({ changes: 1 });

    await expect(
      aiEnrichmentsStore.upsert(node.nodeId, {
        transcript: 'front center',
        asrModelId,
        probe: { durationSec: 1.4, streams: [] },
        mediaKind: 'music',
      })
    ).resolves.toEqual({ changes: 1 });

    const row = await aiEnrichmentsStore.get(node.nodeId);
    expect(row).toMatchObject({
      nodeId: Number(node.nodeId),
      caption: '바다가 보이는 사진',
      captionModelId,
      transcript: 'front center',
      asrModelId,
      probe: { durationSec: 1.4, streams: [] },
      mediaKind: 'music',
      truncated: false,
    });
  });

  it('getByNodeIds batch read omits unknown nodes', async () => {
    const a = await createTestFileNode({ name: `enrich-batch-a-${Date.now()}.txt` });
    const b = await createTestFileNode({ name: `enrich-batch-b-${Date.now()}.txt` });
    await aiEnrichmentsStore.upsert(a.nodeId, { summary: 'a' });
    await aiEnrichmentsStore.upsert(b.nodeId, { summary: 'b' });

    const rows = await aiEnrichmentsStore.getByNodeIds([a.nodeId, b.nodeId, 999999]);
    expect(rows.map((row) => row.nodeId).sort((x, y) => x - y)).toEqual(
      [Number(a.nodeId), Number(b.nodeId)].sort((x, y) => x - y)
    );
  });

  it('delete removes the row and is a no-op afterwards', async () => {
    const node = await createTestFileNode({ name: `enrich-delete-${Date.now()}.txt` });
    await aiEnrichmentsStore.upsert(node.nodeId, { summary: 'gone' });

    await expect(aiEnrichmentsStore.delete(node.nodeId)).resolves.toEqual({ changes: 1 });
    await expect(aiEnrichmentsStore.delete(node.nodeId)).resolves.toEqual({ changes: 0 });
    await expect(aiEnrichmentsStore.get(node.nodeId)).resolves.toBeNull();
  });
});
