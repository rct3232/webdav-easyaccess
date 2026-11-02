'use strict';

/**
 * AiTagRepository L2 conformance (docs/spec/server/store/aiTagStore.md §2.6).
 * Runs against the ACTIVE backend via createTestDatabase() (sqlite default
 * leg; real PG adapter leg). Covers the single surviving table surface,
 * ai_tag_raw: replace semantics (ONE TX, idempotent, stale tags vanish),
 * reverse lookup, FK node_id error mapping and FK cascade parity. The
 * vector-cache and parent-hint surfaces are purged (PLAN §19 — the tag
 * layer is dissolved to descriptive-only).
 */

const { createTestDatabase, createTestFileNode, dbQuery } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createAiTagRepository = require('@server/store/repositories/AiTagRepository');

describe('AiTagRepository conformance', () => {
  let dbCleanup;
  let repo;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createAiTagRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const replaceRaw = (nodeId, tags) =>
    storage.getExecutor().transaction((tx) => repo.replaceRawTags(tx, nodeId, tags));

  // ---------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
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

  it('applies NO normalization: "wasted time" and "wastedtime" are independent rows', async () => {
    const node = await createTestFileNode({ name: `conf-nofold-${Date.now()}.txt` });
    await replaceRaw(node.nodeId, ['wasted time', 'wastedtime']);

    expect(await repo.listRawTags(node.nodeId)).toEqual(['wasted time', 'wastedtime']);
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
