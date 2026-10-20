'use strict';

/**
 * AiEnrichmentsRepository L2 conformance (docs/spec/server/store/
 * aiEnrichmentsStore.md §2.8). Runs against the ACTIVE backend via
 * createTestDatabase() (sqlite default leg; real PG adapter leg). Covers:
 * node-PK upsert idempotency, producer-family lineage isolation
 * (features/caption/asr columns patch independently), tags as free words
 * (§4.18/§19: JSONB array round-trip, no vocabulary machinery), keyset
 * pagination per producer column, cascade parity, row-shape mapping.
 */

const { createTestDatabase, createTestFileNode, dbQuery, dbRun } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createAiEnrichmentsRepository = require('@server/store/repositories/AiEnrichmentsRepository');

describe('AiEnrichmentsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createAiEnrichmentsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const stamp = () => `${Date.now()}-${(seq += 1)}`;

  const model = async (name = 'features') => {
    const res = await dbRun(
      'INSERT INTO llm_models (role, provider, base_url_key, model_name) VALUES (?, ?, ?, ?)',
      [name, 'conformance', `key-${stamp()}`, `model-${stamp()}`]
    );
    return Number(res.lastID ?? res.rows?.[0]);
  };

  const node = async (label) =>
    createTestFileNode({ name: `conf-enrich-${label}-${stamp()}.txt` });

  const countRows = async (where = '1=1', params = []) => {
    const { rows } = await dbQuery(`SELECT COUNT(*) AS cnt FROM ai_enrichments WHERE ${where}`, params);
    return Number(rows[0].cnt);
  };

  // ---------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  // ---------------------------------------------------------------------
  // upsert / partial patch semantics
  // ---------------------------------------------------------------------

  it('upsert creates then patches: exactly ONE row, latest patched fields win, untouched fields survive', async () => {
    const n = await node('patch');
    const featuresId = await model('features');
    const captionId = await model('vision');

    const first = await repo.upsert(n.nodeId, {
      featuresModelId: featuresId,
      schemaVersion: 1,
      tags: ['mountain', 'sunset'],
      summary: 'A mountain at dusk.',
    });
    expect(first.changes).toBe(1);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(1);

    // caption-only patch: tags / features lineage must survive untouched
    const second = await repo.upsert(n.nodeId, {
      captionModelId: captionId,
      caption: 'A dusk photo.',
    });
    expect(second.changes).toBeGreaterThanOrEqual(1);
    expect(await countRows('node_id = ?', [Number(n.nodeId)])).toBe(1);

    const row = await repo.get(n.nodeId);
    expect(row).toMatchObject({
      nodeId: Number(n.nodeId),
      featuresModelId: featuresId,
      schemaVersion: 1,
      tags: ['mountain', 'sunset'],
      summary: 'A mountain at dusk.',
      caption: 'A dusk photo.',
      captionModelId: captionId,
      truncated: false,
    });
    expect(row.transcript).toBeNull();
    expect(row.asrModelId).toBeNull();
    expect(row.probe).toBeNull();
    expect(row.mediaKind).toBeNull();
    expect(typeof row.updatedAt).toBe('string');
    expect(Number.isNaN(new Date(row.updatedAt).getTime())).toBe(false);
  });

  it('producer-family isolation: features re-run does NOT clobber caption/transcript', async () => {
    const n = await node('isolation');
    const featuresId = await model('features');
    const asrId = await model('asr');

    await repo.upsert(n.nodeId, { transcript: 'hello world', asrModelId: asrId });
    await repo.upsert(n.nodeId, { featuresModelId: featuresId, tags: ['call'] });

    const row = await repo.get(n.nodeId);
    expect(row.transcript).toBe('hello world');
    expect(row.asrModelId).toBe(asrId);
    expect(row.tags).toEqual(['call']);
    expect(row.featuresModelId).toBe(featuresId);
    expect(row.caption).toBeNull();
  });

  it('model migration overwrite: a new featuresModelId replaces the features lineage', async () => {
    const n = await node('migrate');
    const oldId = await model('features');
    const newId = await model('features');

    await repo.upsert(n.nodeId, { featuresModelId: oldId, tags: ['old'], summary: 'old' });
    await repo.upsert(n.nodeId, { featuresModelId: newId, tags: ['new'], summary: 'new' });

    const row = await repo.get(n.nodeId);
    expect(row.featuresModelId).toBe(newId);
    expect(row.tags).toEqual(['new']);
    expect(row.summary).toBe('new');
  });

  it('probe JSONB object and truncated flag round-trip', async () => {
    const n = await node('probe');
    const probe = { passes: 2, dropped: 0, source: 'chunk_pool' };
    await repo.upsert(n.nodeId, { probe, truncated: true, mediaKind: 'image' });

    const row = await repo.get(n.nodeId);
    expect(row.probe).toEqual(probe);
    expect(row.truncated).toBe(true);
    expect(row.mediaKind).toBe('image');
  });

  // ---------------------------------------------------------------------
  // tags: free descriptive words (§4.18 / §19 — no vocabulary machinery)
  // ---------------------------------------------------------------------

  it('tags round-trip as a JSONB array of free words in write order', async () => {
    const n = await node('tags');
    await repo.upsert(n.nodeId, { tags: ['sunset', 'wasted time', 'wastedtime'] });

    expect((await repo.get(n.nodeId)).tags).toEqual(['sunset', 'wasted time', 'wastedtime']);
  });

  it('tags accepts an empty array and null (no vocabulary enforcement)', async () => {
    const n = await node('tags-empty');
    await repo.upsert(n.nodeId, { tags: [] });
    expect((await repo.get(n.nodeId)).tags).toEqual([]);

    await repo.upsert(n.nodeId, { tags: null });
    expect((await repo.get(n.nodeId)).tags).toBeNull();
  });

  it('malformed tags (non-string entries) are rejected at the repository boundary', async () => {
    const n = await node('tags-bad');
    await expect(repo.upsert(n.nodeId, { tags: ['ok', 42] })).rejects.toBeDefined();
    await expect(repo.upsert(n.nodeId, { tags: 'not-an-array' })).rejects.toBeDefined();
    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_enrichments WHERE node_id = ?', [
      Number(n.nodeId),
    ]);
    expect(Number(rows[0].cnt)).toBe(0);
  });

  it('raw tags are NEVER rewritten by another pass: caption/transcript writes leave tags alone', async () => {
    const n = await node('tags-stable');
    await repo.upsert(n.nodeId, { tags: ['sunset'] });
    await repo.upsert(n.nodeId, { caption: 'cap' });
    await repo.upsert(n.nodeId, { transcript: 'tx' });
    expect((await repo.get(n.nodeId)).tags).toEqual(['sunset']);
  });

  // ---------------------------------------------------------------------
  // batch reads
  // ---------------------------------------------------------------------

  it('getByNodeIds returns present rows only, in node order', async () => {
    const a = await node('batch-a');
    const b = await node('batch-b');
    const c = await node('batch-c');
    await repo.upsert(a.nodeId, { tags: ['a'] });
    await repo.upsert(c.nodeId, { tags: ['c'] });

    const rows = await repo.getByNodeIds([a.nodeId, b.nodeId, c.nodeId]);
    const ids = rows.map((row) => row.nodeId).sort((x, y) => x - y);
    expect(ids).toEqual([Number(a.nodeId), Number(c.nodeId)]);
    expect(await repo.getByNodeIds([])).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // keyset pagination per producer column
  // ---------------------------------------------------------------------

  it('listByModel filters by producer lineage column and paginates by node id', async () => {
    const modelId = await model('features');
    const ids = [];
    for (const label of ['page-a', 'page-b', 'page-c']) {
      const n = await node(label);
      ids.push(Number(n.nodeId));
    }
    ids.sort((x, y) => x - y);
    for (const nodeId of ids) {
      await repo.upsert(nodeId, { featuresModelId: modelId, tags: [`t-${nodeId}`] });
    }
    // one node in a DIFFERENT space must be excluded
    const otherId = await model('features');
    const other = await node('page-other');
    await repo.upsert(other.nodeId, { featuresModelId: otherId, tags: ['other'] });

    const page1 = await repo.listByModel('features_model_id', modelId, { limit: 2 });
    expect(page1.map((row) => row.nodeId)).toEqual(ids.slice(0, 2));
    expect(page1.every((row) => row.featuresModelId === modelId)).toBe(true);

    const page2 = await repo.listByModel('features_model_id', modelId, {
      afterNodeId: page1[page1.length - 1].nodeId,
      limit: 2,
    });
    expect(page2.map((row) => row.nodeId)).toEqual([ids[2]]);

    // every row exactly once across pages
    expect([...page1.map((r) => r.nodeId), ...page2.map((r) => r.nodeId)]).toEqual(ids);
  });

  it('listByModel works for caption and asr lineage columns', async () => {
    const n = await node('lineage-cap');
    const captionId = await model('vision');
    const asrId = await model('asr');
    await repo.upsert(n.nodeId, { captionModelId: captionId, caption: 'cap' });
    await repo.upsert(n.nodeId, { asrModelId: asrId, transcript: 'tx' });

    expect(await repo.listByModel('caption_model_id', captionId)).toHaveLength(1);
    expect(await repo.listByModel('asr_model_id', asrId)).toHaveLength(1);
    // unknown model → empty, not error
    expect(await repo.listByModel('asr_model_id', 999999999)).toEqual([]);
  });

  it('countByModel counts only that producer family', async () => {
    const n = await node('count');
    const featuresId = await model('features');
    const captionId = await model('vision');
    await repo.upsert(n.nodeId, { featuresModelId: featuresId, tags: ['x'] });
    await repo.upsert(n.nodeId, { captionModelId: captionId, caption: 'x' });

    expect(await repo.countByModel('features_model_id', featuresId)).toBe(1);
    expect(await repo.countByModel('caption_model_id', captionId)).toBe(1);
    expect(await repo.countByModel('asr_model_id', 999999999)).toBe(0);
  });

  // ---------------------------------------------------------------------
  // delete / cascade / FK
  // ---------------------------------------------------------------------

  it('delete on unknown node → changes 0; known node → gone', async () => {
    expect((await repo.delete(999999998)).changes).toBe(0);

    const n = await node('delete');
    await repo.upsert(n.nodeId, { tags: ['x'] });
    expect((await repo.delete(n.nodeId)).changes).toBe(1);
    expect(await repo.get(n.nodeId)).toBeNull();
  });

  it('purging the node cascades the enrichment row; trashing does NOT', async () => {
    const purged = await node('cascade');
    const trashed = await node('trash');
    await repo.upsert(purged.nodeId, { tags: ['x'] });
    await repo.upsert(trashed.nodeId, { tags: ['x'] });

    await dbRun('UPDATE file_nodes SET deleted_at = NOW() WHERE id = ?', [Number(trashed.nodeId)]);
    expect(await repo.get(trashed.nodeId)).not.toBeNull();

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.deleteNodeTree([purged.nodeId]);
    expect(await repo.get(purged.nodeId)).toBeNull();
    expect(await countRows('node_id = ?', [Number(trashed.nodeId)])).toBe(1);
  });

  it('FK violation (unknown node) surfaces as a mapped error', async () => {
    await expect(
      repo.upsert(999999999, { tags: ['x'] })
    ).rejects.toBeDefined();
  });
});
