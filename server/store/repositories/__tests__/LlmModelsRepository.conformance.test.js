'use strict';

/**
 * LlmModelsRepository L2 conformance
 * (docs/spec/server/store/llmModelsStore.md §2.8). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 * Covers identity-keyed idempotent upsert (incl. NULL model_revision and the
 * lock-revision ⇒ new-row rule), the active-by-role read, CHECK parity,
 * reasoning toggle and the restart-survival idempotency.
 */

const { createTestDatabase, dbQuery } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createLlmModelsRepository = require('@server/store/repositories/LlmModelsRepository');

const EMBEDDED_SPEC = {
  role: 'embed',
  provider: 'embedded',
  engine: 'embedded',
  baseUrlKey: '',
  modelName: 'embeddinggemma-2-ONNX',
  modelRevision: 'daa72c51',
  precision: 'q4',
  maxInputChars: 12288,
  chunkBudget: 4,
  batchSize: 8,
};

const REMOTE_CHAT_SPEC = {
  role: 'chat',
  provider: 'llamacpp',
  engine: 'remote',
  baseUrlKey: 'llm_chat_base_url',
  modelName: 'gemma-4-12b-it',
};

describe('LlmModelsRepository conformance', () => {
  let dbCleanup;
  let repo;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createLlmModelsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('upsertModel inserts once; the SAME identity again → SAME id, one row, non-identity fields refreshed', async () => {
    const first = await repo.upsertModel(EMBEDDED_SPEC);
    expect(Number(first.id)).toBeGreaterThan(0);

    const second = await repo.upsertModel({ ...EMBEDDED_SPEC, maxInputChars: 9999, precision: 'q8' });
    expect(Number(second.id)).toBe(Number(first.id));

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM llm_models WHERE role = ? AND provider = ? AND model_name = ?',
      [EMBEDDED_SPEC.role, EMBEDDED_SPEC.provider, EMBEDDED_SPEC.modelName]
    );
    expect(Number(rows[0].cnt)).toBe(1);

    const row = await repo.getModel(first.id);
    expect(row).toMatchObject({
      id: Number(first.id),
      role: 'embed',
      provider: 'embedded',
      engine: 'embedded',
      baseUrlKey: '',
      modelName: 'embeddinggemma-2-ONNX',
      modelRevision: 'daa72c51',
      precision: 'q8', // annotation refreshed
      maxInputChars: 9999, // budget chain refresh path
      chunkBudget: 4,
      batchSize: 8,
      reasoning: 'off',
      enabled: true,
    });
    expect(typeof row.createdAt).toBe('string');
    expect(Number.isNaN(new Date(row.createdAt).getTime())).toBe(false);
  });

  it('a NEW model_revision is a NEW row (lock revision change ⇒ new model_id)', async () => {
    const old = await repo.upsertModel({ ...EMBEDDED_SPEC, modelRevision: 'rev-old' });
    const next = await repo.upsertModel({ ...EMBEDDED_SPEC, modelRevision: 'rev-new' });
    expect(Number(next.id)).not.toBe(Number(old.id));

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM llm_models WHERE model_name = ? AND role = ?',
      [EMBEDDED_SPEC.modelName, EMBEDDED_SPEC.role]
    );
    expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(2);
  });

  it('a NULL model_revision matches only NULL (remote rows without a revision never collide)', async () => {
    const first = await repo.upsertModel(REMOTE_CHAT_SPEC);
    const second = await repo.upsertModel(REMOTE_CHAT_SPEC);
    expect(Number(second.id)).toBe(Number(first.id));

    const withRevision = await repo.upsertModel({ ...REMOTE_CHAT_SPEC, modelRevision: 'r1' });
    expect(Number(withRevision.id)).not.toBe(Number(first.id));
  });

  it('CHECK parity: invalid role / engine reject', async () => {
    await expect(
      repo.upsertModel({ ...REMOTE_CHAT_SPEC, role: 'summarize', modelName: 'm-other' })
    ).rejects.toBeDefined();
    await expect(
      repo.upsertModel({ ...REMOTE_CHAT_SPEC, engine: 'quantum', modelName: 'm-other2' })
    ).rejects.toBeDefined();
  });

  it('missing/blank required identity fields → TypeError before SQL', async () => {
    await expect(repo.upsertModel({ ...REMOTE_CHAT_SPEC, role: '' })).rejects.toThrow(TypeError);
    await expect(repo.upsertModel({ ...REMOTE_CHAT_SPEC, modelName: 42 })).rejects.toThrow(TypeError);
  });

  it('getActiveByRole: none → null; multiple enabled → highest id; disabled rows never returned', async () => {
    await expect(repo.getActiveByRole('vision')).resolves.toBeNull();

    const older = await repo.upsertModel({
      role: 'vision',
      provider: 'p1',
      baseUrlKey: 'k-vision-1',
      modelName: 'vision-1',
    });
    const newer = await repo.upsertModel({
      role: 'vision',
      provider: 'p2',
      baseUrlKey: 'k-vision-2',
      modelName: 'vision-2',
    });

    let active = await repo.getActiveByRole('vision');
    expect(active.id).toBe(Number(newer.id));

    await dbQuery('UPDATE llm_models SET enabled = FALSE WHERE id = ?', [Number(newer.id)]);
    active = await repo.getActiveByRole('vision');
    expect(active.id).toBe(Number(older.id));

    await dbQuery('UPDATE llm_models SET enabled = FALSE WHERE id = ?', [Number(older.id)]);
    await expect(repo.getActiveByRole('vision')).resolves.toBeNull();
  });

  it('listByRole returns the history id ASC, domain-shaped; other roles excluded', async () => {
    const a = await repo.upsertModel({
      role: 'asr',
      provider: 'p1',
      baseUrlKey: 'k-asr-1',
      modelName: 'asr-1',
    });
    const b = await repo.upsertModel({
      role: 'asr',
      provider: 'p1',
      baseUrlKey: 'k-asr-1',
      modelName: 'asr-1',
      modelRevision: 'r2',
    });

    const rows = await repo.listByRole('asr');
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(Number(a.id));
    expect(ids).toContain(Number(b.id));
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(rows.every((row) => row.role === 'asr')).toBe(true);
    expect(rows.every((row) => typeof row.enabled === 'boolean')).toBe(true);
  });

  it('setReasoning toggles the experiment switch; other values → TypeError; unknown id → changes 0', async () => {
    const model = await repo.upsertModel(REMOTE_CHAT_SPEC);

    await expect(repo.setReasoning(model.id, 'on')).resolves.toEqual({ changes: 1 });
    expect((await repo.getModel(model.id)).reasoning).toBe('on');
    await expect(repo.setReasoning(model.id, 'off')).resolves.toEqual({ changes: 1 });
    expect((await repo.getModel(model.id)).reasoning).toBe('off');

    await expect(repo.setReasoning(model.id, 'turbo')).rejects.toThrow(TypeError);
    await expect(repo.setReasoning(999999999, 'on')).resolves.toEqual({ changes: 0 });
  });

  it('getModel unknown id → null', async () => {
    await expect(repo.getModel(999999999)).resolves.toBeNull();
  });

  it('restart survival: a fresh repository over the same persisted DB sees the same ids; upsert re-attaches to the SAME row', async () => {
    const before = await repo.upsertModel(REMOTE_CHAT_SPEC);

    // "Restart": brand-new repository instances over the same backend.
    const revivedRepo = createLlmModelsRepository(storage.getExecutor());
    const after = await revivedRepo.upsertModel(REMOTE_CHAT_SPEC);
    expect(Number(after.id)).toBe(Number(before.id));

    const rows = await revivedRepo.listByRole(REMOTE_CHAT_SPEC.role);
    expect(rows.map((row) => row.id)).toContain(Number(before.id));
  });
});
