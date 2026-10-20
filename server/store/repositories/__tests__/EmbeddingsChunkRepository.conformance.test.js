'use strict';

/**
 * EmbeddingsChunkRepository L2 conformance (docs/spec/server/store/
 * embeddingsChunkStore.md §2.8). Runs against the ACTIVE backend via
 * createTestDatabase() (sqlite default leg; real PG adapter leg). Covers:
 * PK-pair (node, chunk) keying, wholesale replaceChunks semantics
 * (DELETE+INSERT in one TX — no partial chunk updates), model-space keying,
 * chunk_idx ASC ordering, keyset pagination over (node, chunk), cascade
 * parity, row-shape mapping, canonical TEXT codec round-trip.
 */

const {
  createTestDatabase,
  createTestFileNode,
  dbQuery,
  dbRun,
  isSqliteBackend,
} = require('@server/test-utils');
const storage = require('@server/store/storage');
const createEmbeddingsChunkRepository = require('@server/store/repositories/EmbeddingsChunkRepository');

const VEC_A = [0.5, -2.25, 1e-7, 3];
const VEC_B = [-1.5, 0.125, 7.25, -0.5];

describe('EmbeddingsChunkRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createEmbeddingsChunkRepository(storage.getExecutor());
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
    createTestFileNode({ name: `conf-chunk-${label}-${stamp()}.txt` });

  const countRows = async (where = '1=1', params = []) => {
    const { rows } = await dbQuery(
      `SELECT COUNT(*) AS cnt FROM embeddings_chunk WHERE ${where}`,
      params
    );
    return Number(rows[0].cnt);
  };

  const replace = (nodeId, modelId, chunks) =>
    repo.replaceChunks(nodeId, modelId, chunks);

  // ---------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  // ---------------------------------------------------------------------
  // replaceChunks + listByNode
  // ---------------------------------------------------------------------

  it('replaceChunks writes the set; listByNode returns chunks in chunk_idx ASC order', async () => {
    const n = await node('order');
    const modelId = await embedModel();

    const result = await replace(n.nodeId, modelId, [
      { chunkIdx: 2, vector: VEC_A },
      { chunkIdx: 0, vector: VEC_B },
      { chunkIdx: 1, vector: VEC_A },
    ]);
    expect(result.inserted).toBe(3);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(3);

    const rows = await repo.listByNode(n.nodeId);
    expect(rows.map((row) => row.chunkIdx)).toEqual([0, 1, 2]);
    expect(rows[0]).toMatchObject({
      nodeId: Number(n.nodeId),
      chunkIdx: 0,
      modelId,
    });
    expect(rows[0].vector).toEqual(VEC_B);
    expect(typeof rows[0].updatedAt).toBe('string');
    expect(Number.isNaN(new Date(rows[0].updatedAt).getTime())).toBe(false);
  });

  it('re-chunking a node replaces wholesale: old count discarded, new ladder outcome stands', async () => {
    const n = await node('reladder');
    const modelId = await embedModel();

    await replace(n.nodeId, modelId, [
      { chunkIdx: 0, vector: VEC_A },
      { chunkIdx: 1, vector: VEC_A },
      { chunkIdx: 2, vector: VEC_A },
      { chunkIdx: 3, vector: VEC_A },
    ]);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(4);

    // the ladder now produced 2 chunks — the 4 old rows must be gone
    await replace(n.nodeId, modelId, [
      { chunkIdx: 0, vector: VEC_B },
      { chunkIdx: 1, vector: VEC_B },
    ]);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(2);
    const rows = await repo.listByNode(n.nodeId);
    expect(rows.map((row) => row.vector)).toEqual([VEC_B, VEC_B]);
  });

  it('listByNode modelId filter excludes other spaces (space keying)', async () => {
    const n = await node('space');
    const modelOne = await embedModel();
    const modelTwo = await embedModel();

    await replace(n.nodeId, modelOne, [{ chunkIdx: 0, vector: VEC_A }]);
    await replace(n.nodeId, modelTwo, [{ chunkIdx: 0, vector: VEC_B }]);

    // PK(node, chunk_idx): a second space write on the same chunk replaced the first
    expect(await countRows('node_id = ? AND model_id = ?', [Number(n.nodeId), modelOne])).toBe(0);
    expect(await repo.listByNode(n.nodeId, { modelId: modelTwo })).toHaveLength(1);
    expect(await repo.listByNode(n.nodeId, { modelId: modelOne })).toEqual([]);
    expect((await repo.listByNode(n.nodeId))[0].vector).toEqual(VEC_B);
  });

  it('get on a missing (node, chunk) pair → null; present pair → the chunk', async () => {
    const n = await node('get');
    const modelId = await embedModel();
    await replace(n.nodeId, modelId, [{ chunkIdx: 0, vector: VEC_A }]);

    expect(await repo.get(n.nodeId, 0)).toMatchObject({ chunkIdx: 0, modelId });
    expect(await repo.get(n.nodeId, 1)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // pagination + counts
  // ---------------------------------------------------------------------

  it('listAllByModel keyset pagination returns every row once across pages, in (nodeId, chunkIdx) order', async () => {
    const modelId = await embedModel();
    const ids = [];
    for (const label of ['page-a', 'page-b']) {
      const n = await node(label);
      ids.push(Number(n.nodeId));
    }
    ids.sort((x, y) => x - y);
    for (const nodeId of ids) {
      await replace(nodeId, modelId, [
        { chunkIdx: 0, vector: VEC_A },
        { chunkIdx: 1, vector: VEC_A },
      ]);
    }
    const otherModel = await embedModel();
    const other = await node('page-other');
    await replace(other.nodeId, otherModel, [{ chunkIdx: 0, vector: VEC_A }]);

    const page1 = await repo.listAllByModel(modelId, { limit: 3 });
    expect(page1.map((row) => [row.nodeId, row.chunkIdx])).toEqual([
      [ids[0], 0],
      [ids[0], 1],
      [ids[1], 0],
    ]);
    expect(page1.every((row) => row.modelId === modelId)).toBe(true);

    const page2 = await repo.listAllByModel(modelId, {
      afterNodeId: page1[page1.length - 1].nodeId,
      afterChunkIdx: page1[page1.length - 1].chunkIdx,
      limit: 3,
    });
    expect(page2.map((row) => [row.nodeId, row.chunkIdx])).toEqual([[ids[1], 1]]);

    expect(
      [...page1.map((r) => `${r.nodeId}:${r.chunkIdx}`), ...page2.map((r) => `${r.nodeId}:${r.chunkIdx}`)]
    ).toEqual([`${ids[0]}:0`, `${ids[0]}:1`, `${ids[1]}:0`, `${ids[1]}:1`]);
  });

  it('countByNode counts one node (optionally per space)', async () => {
    const n = await node('count');
    const modelId = await embedModel();
    await replace(n.nodeId, modelId, [
      { chunkIdx: 0, vector: VEC_A },
      { chunkIdx: 1, vector: VEC_A },
    ]);

    expect(await repo.countByNode(n.nodeId)).toBe(2);
    expect(await repo.countByNode(n.nodeId, { modelId })).toBe(2);
    expect(await repo.countByNode(n.nodeId, { modelId: 999999999 })).toBe(0);
    expect(await repo.countByNode(999999998)).toBe(0);
  });

  // ---------------------------------------------------------------------
  // delete / cascade / codec / FK
  // ---------------------------------------------------------------------

  it('deleteByNode removes all chunks; missing node → changes 0', async () => {
    expect((await repo.deleteByNode(999999998)).changes).toBe(0);

    const n = await node('delnode');
    const modelId = await embedModel();
    await replace(n.nodeId, modelId, [
      { chunkIdx: 0, vector: VEC_A },
      { chunkIdx: 1, vector: VEC_A },
    ]);
    expect((await repo.deleteByNode(n.nodeId)).changes).toBe(2);
    expect(await repo.listByNode(n.nodeId)).toEqual([]);
  });

  it('deleteByModel retires the whole space', async () => {
    const modelOne = await embedModel();
    const modelTwo = await embedModel();
    const a = await node('delmodel-a');
    const b = await node('delmodel-b');
    await replace(a.nodeId, modelOne, [{ chunkIdx: 0, vector: VEC_A }]);
    await replace(b.nodeId, modelOne, [{ chunkIdx: 0, vector: VEC_A }]);
    // modelTwo's write lands on a chunk index node a's modelOne rows don't
    // occupy — PK (node_id, chunk_idx) is space-exclusive per position, so a
    // cross-space write at a COLLIDING index would claim the position via the
    // PK upsert (see the space-keying scenario above).
    await replace(a.nodeId, modelTwo, [{ chunkIdx: 1, vector: VEC_A }]);

    const deleted = await repo.deleteByModel(modelOne);
    expect(deleted.changes).toBe(2);
    expect(await countRows('model_id = ?', [modelOne])).toBe(0);
    expect(await countRows('model_id = ?', [modelTwo])).toBe(1);
  });

  it('TEXT vector round-trips bit-stably (float count == pooled dim); malformed raises', async () => {
    const n = await node('codec');
    const modelId = await embedModel();
    await replace(n.nodeId, modelId, [{ chunkIdx: 0, vector: VEC_A }]);

    const { rows } = await dbQuery(
      'SELECT vector FROM embeddings_chunk WHERE node_id = ? AND chunk_idx = 0',
      [Number(n.nodeId)]
    );
    expect(typeof rows[0].vector).toBe('string');
    expect(rows[0].vector.split(',').map(Number)).toEqual(VEC_A);

    await expect(
      replace(n.nodeId, modelId, [{ chunkIdx: 0, vector: 'oops' }])
    ).rejects.toBeDefined();
  });

  it('purging the node cascades the chunk rows; trashing does NOT', async () => {
    const purged = await node('cascade');
    const trashed = await node('trash');
    const modelId = await embedModel();
    await replace(purged.nodeId, modelId, [{ chunkIdx: 0, vector: VEC_A }]);
    await replace(trashed.nodeId, modelId, [{ chunkIdx: 0, vector: VEC_A }]);

    await dbRun(
      `UPDATE file_nodes SET deleted_at = ${isSqliteBackend() ? "datetime('now')" : 'NOW()'} WHERE id = ?`,
      [Number(trashed.nodeId)]
    );
    expect(await repo.listByNode(trashed.nodeId)).toHaveLength(1);

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.deleteNodeTree([purged.nodeId]);
    expect(await repo.listByNode(purged.nodeId)).toEqual([]);
    expect(await countRows('node_id = ?', [Number(trashed.nodeId)])).toBe(1);
  });

  it('FK violation (unknown node) surfaces as a mapped error', async () => {
    const modelId = await embedModel();
    await expect(replace(999999999, modelId, [{ chunkIdx: 0, vector: VEC_A }])).rejects.toBeDefined();
  });
});
