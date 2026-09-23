'use strict';

/**
 * AiTagRepository L2 conformance (docs/spec/server/store/aiTagStore.md §2.7).
 * Runs against the ACTIVE backend via createTestDatabase() (sqlite default
 * leg; real PG adapter leg). Covers the three table surfaces:
 * tag_embeddings (PK-pair space keying, comma-float TEXT codec, batch
 * expansion, FK model_id mapping, deleteByModel isolation),
 * tag_parents (conditional auto-upsert guard `WHERE source <> 'admin'`,
 * admin flip, CHECK parity, non-destructive proof) and
 * ai_tag_raw (replace semantics, reverse lookup, FK cascade).
 */

const { createTestDatabase, createTestFileNode, dbQuery, dbRun } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createAiTagRepository = require('@server/store/repositories/AiTagRepository');

const VEC_A = [0.5, -2.25, 1e-7, 3];
const VEC_B = [-1.5, 0.125, 7.25, -0.5];

describe('AiTagRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createAiTagRepository(storage.getExecutor());
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

  const upsertVectors = (items, modelId) =>
    storage.getExecutor().transaction((tx) => repo.upsertTagVectors(tx, items, modelId));

  const replaceRaw = (nodeId, tags) =>
    storage.getExecutor().transaction((tx) => repo.replaceRawTags(tx, nodeId, tags));

  // ---------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  // ---------------------------------------------------------------------
  // tag_embeddings
  // ---------------------------------------------------------------------

  it('upsertTagVector twice → ONE row (tag,modelId); missing read → null', async () => {
    const modelId = await embedModel();
    const tag = `conf-sunset-${stamp()}`;

    expect(await repo.getTagVector(tag, modelId)).toBeNull();

    const first = await repo.upsertTagVector(tag, modelId, VEC_A);
    expect(first.changes).toBe(1);
    const second = await repo.upsertTagVector(tag, modelId, VEC_B);
    expect(second.changes).toBeGreaterThanOrEqual(0);

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM tag_embeddings WHERE tag = ? AND model_id = ?',
      [tag, modelId]
    );
    expect(Number(rows[0].cnt)).toBe(1);

    const row = await repo.getTagVector(tag, modelId);
    expect(row).toMatchObject({ tag, modelId, dim: VEC_B.length });
    expect(row.vector).toEqual(VEC_B);
    expect(typeof row.updatedAt).toBe('string');
    expect(Number.isNaN(new Date(row.updatedAt).getTime())).toBe(false);
  });

  it('stores the vector as comma-separated float TEXT (canonical codec parity)', async () => {
    const modelId = await embedModel();
    const tag = `conf-codec-${stamp()}`;
    await repo.upsertTagVector(tag, modelId, VEC_A);

    const { rows } = await dbQuery('SELECT vector FROM tag_embeddings WHERE tag = ?', [tag]);
    expect(typeof rows[0].vector).toBe('string');
    expect(rows[0].vector.split(',').map(Number)).toEqual(VEC_A);

    // writer also accepts an already-serialized string (round-trip identity)
    const serialized = await repo.upsertTagVector(`${tag}-s`, modelId, VEC_A.join(','));
    expect(serialized.changes).toBe(1);
    expect((await repo.getTagVector(`${tag}-s`, modelId)).vector).toEqual(VEC_A);
  });

  it('the same tag under a SECOND modelId is its own row (space keying, no overwrite)', async () => {
    const modelOne = await embedModel();
    const modelTwo = await embedModel();
    const tag = `conf-space-${stamp()}`;

    await repo.upsertTagVector(tag, modelOne, VEC_A);
    await repo.upsertTagVector(tag, modelTwo, VEC_B);

    const one = await repo.getTagVector(tag, modelOne);
    const two = await repo.getTagVector(tag, modelTwo);
    expect(one.vector).toEqual(VEC_A);
    expect(two.vector).toEqual(VEC_B);
  });

  it('getTagVectors batch read returns present rows only', async () => {
    const modelId = await embedModel();
    const present = `conf-batch-${stamp()}`;
    const absent = `conf-batch-missing-${stamp()}`;
    await repo.upsertTagVector(present, modelId, VEC_A);

    const rows = await repo.getTagVectors([present, absent], modelId);
    expect(rows.map((row) => row.tag)).toEqual([present]);
    expect(rows[0].dim).toBe(VEC_A.length);

    expect(await repo.getTagVectors([], modelId)).toEqual([]);
  });

  it('findTagsWithoutEmbedding returns exactly the uncached subset in input order', async () => {
    const modelId = await embedModel();
    const cachedA = `conf-wo-a-${stamp()}`;
    const cachedB = `conf-wo-b-${stamp()}`;
    const missing = `conf-wo-m-${stamp()}`;
    await repo.upsertTagVector(cachedA, modelId, VEC_A);
    await repo.upsertTagVector(cachedB, modelId, VEC_A);

    const result = await repo.findTagsWithoutEmbedding(
      [missing, cachedA, `${missing}2`, cachedB],
      modelId
    );
    expect(result).toEqual([missing, `${missing}2`]);
    expect(await repo.findTagsWithoutEmbedding([], modelId)).toEqual([]);
  });

  it('upsertTagVectors batch upserts in one pass and counts only NEW rows', async () => {
    const modelId = await embedModel();
    const one = `conf-bu-1-${stamp()}`;
    const two = `conf-bu-2-${stamp()}`;
    await repo.upsertTagVector(one, modelId, VEC_A);

    const result = await upsertVectors(
      [
        { tag: one, vector: VEC_B },
        { tag: two, vector: VEC_A },
      ],
      modelId
    );
    expect(result.inserted).toBe(1);
    expect((await repo.getTagVector(one, modelId)).vector).toEqual(VEC_B);
    expect((await repo.getTagVector(two, modelId)).vector).toEqual(VEC_A);
  });

  it('deleteByModel retires only that model space', async () => {
    const modelOne = await embedModel();
    const modelTwo = await embedModel();
    const tag = `conf-del-${stamp()}`;
    await repo.upsertTagVector(tag, modelOne, VEC_A);
    await repo.upsertTagVector(tag, modelTwo, VEC_A);

    const deleted = await repo.deleteByModel(modelOne);
    expect(deleted.changes).toBe(1);
    expect(await repo.getTagVector(tag, modelOne)).toBeNull();
    expect(await repo.getTagVector(tag, modelTwo)).not.toBeNull();
  });

  it('FK model_id violation surfaces as a mapped error', async () => {
    await expect(
      repo.upsertTagVector(`conf-fk-${stamp()}`, 999999999, VEC_A)
    ).rejects.toBeDefined();
    await expect(
      upsertVectors([{ tag: `conf-fk-batch-${stamp()}`, vector: VEC_A }], 999999999)
    ).rejects.toBeDefined();
  });

  it('applies NO normalization: "wasted time" and "wastedtime" are independent rows', async () => {
    const modelId = await embedModel();
    const spaced = 'wasted time';
    const tight = 'wastedtime';
    await repo.upsertTagVector(spaced, modelId, VEC_A);

    expect(await repo.getTagVector(tight, modelId)).toBeNull();
    expect((await repo.getTagVector(spaced, modelId)).tag).toBe('wasted time');
  });

  // ---------------------------------------------------------------------
  // tag_parents
  // ---------------------------------------------------------------------

  it('upsertAutoParent creates source=auto and a second auto write replaces the parent', async () => {
    const child = `conf-auto-${stamp()}`;
    expect(await repo.getParent(child)).toBeNull();

    const created = await repo.upsertAutoParent(child, 'casting');
    expect(created.changes).toBeGreaterThanOrEqual(1);
    let row = await repo.getParent(child);
    expect(row).toMatchObject({ child, parent: 'casting', source: 'auto' });
    expect(typeof row.createdAt).toBe('string');

    await repo.upsertAutoParent(child, 'acting');
    row = await repo.getParent(child);
    expect(row).toMatchObject({ parent: 'acting', source: 'auto' });

    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM tag_parents WHERE child = ?', [
      child,
    ]);
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it('an auto pass NEVER overwrites an admin decision; admin writes still replace', async () => {
    const child = `conf-guard-${stamp()}`;
    await repo.setAdminParent(child, 'official-parent');

    const ignored = await repo.upsertAutoParent(child, 'auto-would-overwrite');
    expect(ignored.changes).toBe(0);
    expect(await repo.getParent(child)).toMatchObject({
      parent: 'official-parent',
      source: 'admin',
    });

    await repo.setAdminParent(child, 'revised-official');
    expect(await repo.getParent(child)).toMatchObject({
      parent: 'revised-official',
      source: 'admin',
    });
  });

  it('setAdminParent on an existing auto row flips source to admin', async () => {
    const child = `conf-flip-${stamp()}`;
    await repo.upsertAutoParent(child, 'auto-parent');
    await repo.setAdminParent(child, 'admin-parent');
    expect(await repo.getParent(child)).toMatchObject({ parent: 'admin-parent', source: 'admin' });
  });

  it('deleteParent on unknown child → changes 0; known child → gone', async () => {
    expect((await repo.deleteParent(`conf-missing-${stamp()}`)).changes).toBe(0);

    const child = `conf-delete-${stamp()}`;
    await repo.upsertAutoParent(child, 'parent');
    expect((await repo.deleteParent(child)).changes).toBe(1);
    expect(await repo.getParent(child)).toBeNull();
  });

  it('listParentHints returns the full table ordered by child', async () => {
    const suffix = stamp();
    await repo.upsertAutoParent(`conf-list-b-${suffix}`, 'beta');
    await repo.setAdminParent(`conf-list-a-${suffix}`, 'alpha');

    const hints = await repo.listParentHints();
    const children = hints.map((hint) => hint.child);
    expect(children).toEqual([...children].sort());
    expect(children).toEqual(
      expect.arrayContaining([`conf-list-a-${suffix}`, `conf-list-b-${suffix}`])
    );
    expect(hints.every((hint) => ['auto', 'admin'].includes(hint.source))).toBe(true);
  });

  it('CHECK constraint rejects source outside auto|admin (both dialects)', async () => {
    await expect(
      dbRun("INSERT INTO tag_parents (child, parent, source) VALUES (?, ?, 'bogus')", [
        `conf-check-${stamp()}`,
        'whatever',
      ])
    ).rejects.toBeDefined();
  });

  it('hint writes/deletes never touch ai_features.tags or ai_tag_raw (non-destructive)', async () => {
    const node = await createTestFileNode({ name: `conf-nondesc-${Date.now()}.txt` });
    await replaceRaw(node.nodeId, ['conf-anchor-tag']);

    const child = `conf-nondesc-${stamp()}`;
    await repo.upsertAutoParent(child, 'parent');
    await repo.setAdminParent(child, 'parent');
    await repo.deleteParent(child);

    expect(await repo.listRawTags(node.nodeId)).toEqual(['conf-anchor-tag']);
    const features = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_features WHERE node_id = ?', [
      Number(node.nodeId),
    ]);
    expect(Number(features.rows[0].cnt)).toBe(0);
  });

  // ---------------------------------------------------------------------
  // ai_tag_raw
  // ---------------------------------------------------------------------

  it('replaceRawTags round-trips, is idempotent, and drops stale tags', async () => {
    const node = await createTestFileNode({ name: `conf-raw-${Date.now()}.txt` });

    expect(await repo.listRawTags(node.nodeId)).toEqual([]);

    const first = await replaceRaw(node.nodeId, ['ext:jpg', 'month:2026-09']);
    expect(first.inserted).toBe(2);
    expect(await repo.listRawTags(node.nodeId)).toEqual(['ext:jpg', 'month:2026-09']);

    const again = await replaceRaw(node.nodeId, ['ext:jpg', 'month:2026-09']);
    expect(again.inserted).toBe(2);
    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_tag_raw WHERE node_id = ?', [
      Number(node.nodeId),
    ]);
    expect(Number(rows[0].cnt)).toBe(2);

    await replaceRaw(node.nodeId, ['ext:png']);
    expect(await repo.listRawTags(node.nodeId)).toEqual(['ext:png']);

    await replaceRaw(node.nodeId, []);
    expect(await repo.listRawTags(node.nodeId)).toEqual([]);
  });

  it('listNodeIdsByRawTag reverse lookup asc, only matching nodes', async () => {
    const a = await createTestFileNode({ name: `conf-rev-a-${Date.now()}.txt` });
    const b = await createTestFileNode({ name: `conf-rev-b-${Date.now()}.txt` });
    await replaceRaw(a.nodeId, ['shared:tag', 'only-a']);
    await replaceRaw(b.nodeId, ['shared:tag']);

    const ids = await repo.listNodeIdsByRawTag('shared:tag');
    expect(ids).toEqual([Number(a.nodeId), Number(b.nodeId)].sort((x, y) => x - y));
    expect(await repo.listNodeIdsByRawTag('only-a')).toEqual([Number(a.nodeId)]);
    expect(await repo.listNodeIdsByRawTag('nobody')).toEqual([]);
  });

  it('purging the node cascades its raw tag rows away (FK parity)', async () => {
    const node = await createTestFileNode({ name: `conf-cascade-${Date.now()}.txt` });
    await replaceRaw(node.nodeId, ['conf-cascade-tag']);

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.deleteNodeTree([node.nodeId]);

    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_tag_raw WHERE node_id = ?', [
      Number(node.nodeId),
    ]);
    expect(Number(rows[0].cnt)).toBe(0);
  });

  it('ai_tag_raw FK to a missing node rejects (mapped error)', async () => {
    await expect(replaceRaw(999999999, ['conf-badfk'])).rejects.toBeDefined();
  });
});
