'use strict';

/**
 * EmbeddingsRepository L2 conformance (docs/spec/server/store/
 * embeddingsStore.md §2.9). Runs against the ACTIVE backend via
 * createTestDatabase() (sqlite default leg; real PG adapter leg). Covers:
 * node-PK upsert idempotency (ONE pooled row per node), model-space keying
 * (model_id filters), keyset pagination, content_hash dedupe-skip data
 * supply, source CHECK parity, cascade parity, row-shape mapping, and the
 * canonical TEXT vector codec round-trip.
 */

const { createTestDatabase, createTestFileNode, dbQuery, dbRun } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createEmbeddingsRepository = require('@server/store/repositories/EmbeddingsRepository');

const VEC_A = [0.5, -2.25, 1e-7, 3];
const VEC_B = [-1.5, 0.125, 7.25, -0.5];

describe('EmbeddingsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createEmbeddingsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const stamp = () => `${Date.now()}-${(seq += 1)}`;

  const embedModel = async (name = 'embed') => {
    const res = await dbRun(
      'INSERT INTO llm_models (role, provider, base_url_key, model_name) VALUES (?, ?, ?, ?)',
      [name, 'conformance', `key-${stamp()}`, `model-${stamp()}`]
    );
    return Number(res.lastID ?? res.rows?.[0]);
  };

  const node = async (label) =>
    createTestFileNode({ name: `conf-emb-${label}-${stamp()}.txt` });

  const countRows = async (where = '1=1', params = []) => {
    const { rows } = await dbQuery(`SELECT COUNT(*) AS cnt FROM embeddings WHERE ${where}`, params);
    return Number(rows[0].cnt);
  };

  const upsert = (nodeId, modelId, vector, source = 'fulltext', contentHash = null) =>
    repo.upsert(nodeId, { modelId, dim: vector.length, vector, source, contentHash });

  // ---------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  // ---------------------------------------------------------------------
  // upsert idempotency + row shape
  // ---------------------------------------------------------------------

  it('upsert twice for one node → exactly ONE row, latest vector/modelId/source wins', async () => {
    const n = await node('patch');
    const modelId = await embedModel();
    const modelId2 = await embedModel();

    const first = await upsert(n.nodeId, modelId, VEC_A, 'fulltext', 'hash-a');
    expect(first.changes).toBe(1);
    const second = await upsert(n.nodeId, modelId2, VEC_B, 'head', 'hash-b');
    expect(second.changes).toBeGreaterThanOrEqual(1);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(1);

    const row = await repo.get(n.nodeId);
    expect(row).toMatchObject({
      nodeId: Number(n.nodeId),
      modelId: modelId2,
      dim: VEC_B.length,
      source: 'head',
      contentHash: 'hash-b',
    });
    expect(row.vector).toEqual(VEC_B);
    expect(typeof row.updatedAt).toBe('string');
    expect(Number.isNaN(new Date(row.updatedAt).getTime())).toBe(false);
  });

  it('model migration overwrite: a new modelId (different dim) replaces the row cleanly', async () => {
    const n = await node('migrate');
    const oldModel = await embedModel();
    const newModel = await embedModel();

    await upsert(n.nodeId, oldModel, [1, 2, 3], 'fulltext', 'old-hash');
    await upsert(n.nodeId, newModel, [4, 5, 6, 7, 8], 'chunk_pool', 'new-hash');

    const row = await repo.get(n.nodeId);
    expect(row.modelId).toBe(newModel);
    expect(row.dim).toBe(5);
    expect(row.vector).toEqual([4, 5, 6, 7, 8]);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(1);
  });

  it('dedupe-skip data: same contentHash + same modelId is what the worker compares', async () => {
    const n = await node('dedupe');
    const modelId = await embedModel();
    await upsert(n.nodeId, modelId, VEC_A, 'fulltext', 'hash-1');

    const row = await repo.get(n.nodeId);
    // worker logic: row.modelId === activeModelId && row.contentHash === fileHash
    expect(row.modelId).toBe(modelId);
    expect(row.contentHash).toBe('hash-1');
    // changed hash → row replaced
    await upsert(n.nodeId, modelId, VEC_B, 'fulltext', 'hash-2');
    expect((await repo.get(n.nodeId)).contentHash).toBe('hash-2');
    // changed modelId → row replaced (never a second live row per node)
    const newModel = await embedModel();
    await upsert(n.nodeId, newModel, VEC_B, 'fulltext', 'hash-2');
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(1);
    expect((await repo.get(n.nodeId)).modelId).toBe(newModel);
  });

  // ---------------------------------------------------------------------
  // canonical TEXT codec (vector is the SYSTEM OF RECORD)
  // ---------------------------------------------------------------------

  it('stores the vector as comma-separated float TEXT; round-trips bit-stably', async () => {
    const n = await node('codec');
    const modelId = await embedModel();
    await upsert(n.nodeId, modelId, VEC_A);

    const { rows } = await dbQuery('SELECT vector FROM embeddings WHERE node_id = ?', [
      Number(n.nodeId),
    ]);
    expect(typeof rows[0].vector).toBe('string');
    expect(rows[0].vector.split(',').map(Number)).toEqual(VEC_A);

    // writer also accepts an already-serialized string (round-trip identity)
    const n2 = await node('codec2');
    await upsert(n2.nodeId, modelId, VEC_A.join(','));
    expect((await repo.get(n2.nodeId)).vector).toEqual(VEC_A);
  });

  it('malformed vector TEXT raises at the repository boundary (never stored half-written)', async () => {
    const n = await node('codec-bad');
    const modelId = await embedModel();
    await expect(upsert(n.nodeId, modelId, 'not,numbers')).rejects.toBeDefined();
    await expect(upsert(n.nodeId, modelId, '')).rejects.toBeDefined();
    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM embeddings WHERE node_id = ?', [
      Number(n.nodeId),
    ]);
    expect(Number(rows[0].cnt)).toBe(0);
  });

  // ---------------------------------------------------------------------
  // batch reads + pagination
  // ---------------------------------------------------------------------

  it('getByNodeIds returns present rows only', async () => {
    const a = await node('batch-a');
    const b = await node('batch-b');
    const modelId = await embedModel();
    await upsert(a.nodeId, modelId, VEC_A);
    await upsert(b.nodeId, modelId, VEC_A);

    const rows = await repo.getByNodeIds([a.nodeId, b.nodeId, a.nodeId + 999999]);
    expect(rows).toHaveLength(2);
    expect(await repo.getByNodeIds([])).toEqual([]);
  });

  it('listAll(modelId) excludes other modelIds; keyset pagination returns every row once, in nodeId order', async () => {
    const modelId = await embedModel();
    const otherModel = await embedModel();
    const ids = [];
    for (const label of ['page-a', 'page-b', 'page-c']) {
      const n = await node(label);
      ids.push(Number(n.nodeId));
    }
    ids.sort((x, y) => x - y);
    for (const nodeId of ids) {
      await upsert(nodeId, modelId, VEC_A);
    }
    // one node in a DIFFERENT space must be excluded
    const other = await node('page-other');
    await upsert(other.nodeId, otherModel, VEC_A);

    const page1 = await repo.listAll(modelId, { limit: 2 });
    expect(page1.map((row) => row.nodeId)).toEqual(ids.slice(0, 2));
    expect(page1.every((row) => row.modelId === modelId)).toBe(true);

    const page2 = await repo.listAll(modelId, {
      afterNodeId: page1[page1.length - 1].nodeId,
      limit: 2,
    });
    expect(page2.map((row) => row.nodeId)).toEqual([ids[2]]);

    expect([...page1.map((r) => r.nodeId), ...page2.map((r) => r.nodeId)]).toEqual(ids);
    // no pagination → all rows of the space
    expect(await repo.listAll(modelId)).toHaveLength(3);
  });

  it('countByModel counts only that space', async () => {
    const modelId = await embedModel();
    const otherModel = await embedModel();
    const a = await node('count-a');
    const b = await node('count-b');
    await upsert(a.nodeId, modelId, VEC_A);
    await upsert(b.nodeId, otherModel, VEC_A);

    expect(await repo.countByModel(modelId)).toBe(1);
    expect(await repo.countByModel(otherModel)).toBe(1);
    expect(await repo.countByModel(999999999)).toBe(0);
  });

  // ---------------------------------------------------------------------
  // source CHECK + delete / cascade / FK
  // ---------------------------------------------------------------------

  it('source CHECK rejects an out-of-enum value (mapped error)', async () => {
    const n = await node('source-bad');
    const modelId = await embedModel();
    await expect(
      repo.upsert(n.nodeId, { modelId, dim: 4, vector: VEC_A, source: 'bogus', contentHash: null })
    ).rejects.toBeDefined();
  });

  it('delete on unknown node → changes 0; known node → gone', async () => {
    expect((await repo.delete(999999998)).changes).toBe(0);

    const n = await node('delete');
    const modelId = await embedModel();
    await upsert(n.nodeId, modelId, VEC_A);
    expect((await repo.delete(n.nodeId)).changes).toBe(1);
    expect(await repo.get(n.nodeId)).toBeNull();
  });

  it('deleteMany batch drops in one call; missing rows change nothing', async () => {
    const a = await node('delmany-a');
    const b = await node('delmany-b');
    const modelId = await embedModel();
    await upsert(a.nodeId, modelId, VEC_A);
    await upsert(b.nodeId, modelId, VEC_A);

    const result = await repo.deleteMany([a.nodeId, b.nodeId, 999999998]);
    expect(result.changes).toBe(2);
    expect(await repo.get(a.nodeId)).toBeNull();
    expect(await repo.get(b.nodeId)).toBeNull();
  });

  it('purging the node cascades the pooled row; trashing does NOT', async () => {
    const purged = await node('cascade');
    const trashed = await node('trash');
    const modelId = await embedModel();
    await upsert(purged.nodeId, modelId, VEC_A);
    await upsert(trashed.nodeId, modelId, VEC_A);

    await dbRun('UPDATE file_nodes SET deleted_at = NOW() WHERE id = ?', [Number(trashed.nodeId)]);
    expect(await repo.get(trashed.nodeId)).not.toBeNull();

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.deleteNodeTree([purged.nodeId]);
    expect(await repo.get(purged.nodeId)).toBeNull();
    expect(await countRows('node_id = ?', [Number(trashed.nodeId)])).toBe(1);
  });

  it('FK violation (unknown node) surfaces as a mapped error', async () => {
    const modelId = await embedModel();
    await expect(upsert(999999999, modelId, VEC_A)).rejects.toBeDefined();
  });
});
