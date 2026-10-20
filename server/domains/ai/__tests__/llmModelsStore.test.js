'use strict';

/**
 * llmModelsStore facade test (docs/spec/server/store/llmModelsStore.md §2.1).
 * L1: thin dialect dispatch + the registry restart-survival idempotency —
 * after a real close/reopen of the persisted database the same model identity
 * resolves to the SAME llm_models.id (lineage columns stay stable).
 */

const { createTestDatabase, isSqliteBackend } = require('@server/test-utils');
const storage = require('@server/store/storage');
const llmModelsStore = require('@server/store/llmModelsStore');

const SPEC = {
  role: 'embed',
  provider: 'embedded',
  engine: 'embedded',
  baseUrlKey: '',
  modelName: 'embeddinggemma-2-ONNX',
  modelRevision: `rev-${Date.now()}`,
  precision: 'q4',
  maxInputChars: 12288,
  chunkBudget: 4,
  batchSize: 8,
};

describe('llmModelsStore facade', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('delegates upsert/get/active/list/setReasoning', async () => {
    const { id } = await llmModelsStore.upsertModel(SPEC);
    expect(Number(id)).toBeGreaterThan(0);

    await expect(llmModelsStore.getModel(id)).resolves.toMatchObject({
      id: Number(id),
      role: 'embed',
      engine: 'embedded',
      modelName: SPEC.modelName,
      enabled: true,
    });

    const active = await llmModelsStore.getActiveByRole('embed');
    expect(active.id).toBe(Number(id));

    const history = await llmModelsStore.listByRole('embed');
    expect(history.map((row) => row.id)).toContain(Number(id));

    await expect(llmModelsStore.setReasoning(id, 'on')).resolves.toEqual({ changes: 1 });
    await expect(llmModelsStore.getModel(id)).resolves.toMatchObject({ reasoning: 'on' });
  });

  it('restart survival: the registry persists and upsert re-attaches to the SAME id', async () => {
    const before = await llmModelsStore.upsertModel(SPEC);

    if (isSqliteBackend()) {
      // Simulate the restart: drop the process-level DB handle; the next
      // store call reopens the SAME persisted file.
      await storage.closeSqliteDb();
    }

    const after = await llmModelsStore.upsertModel({ ...SPEC, maxInputChars: 7777 });
    expect(Number(after.id)).toBe(Number(before.id));

    const revived = await llmModelsStore.getModel(before.id);
    expect(revived.maxInputChars).toBe(7777);
    expect(revived.modelRevision).toBe(SPEC.modelRevision);
  });

  it('upsert with a NEW model_revision yields a NEW model_id (model-version key)', async () => {
    const old = await llmModelsStore.upsertModel({
      ...SPEC,
      modelRevision: `${SPEC.modelRevision}-a`,
    });
    const next = await llmModelsStore.upsertModel({
      ...SPEC,
      modelRevision: `${SPEC.modelRevision}-b`,
    });
    expect(Number(next.id)).not.toBe(Number(old.id));
  });
});
