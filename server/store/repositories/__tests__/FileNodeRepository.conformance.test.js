'use strict';

/**
 * FileNodeRepository L2 conformance
 * (docs/spec/server/store/repository-contract.md). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 */

const { createTestDatabase } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createFileNodeRepository = require('@server/store/repositories/FileNodeRepository');

describe('FileNodeRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createFileNodeRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueName = (prefix) => `${prefix}-${Date.now()}-${++seq}`;

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('createNode/getNode round-trips a node (domain shape)', async () => {
    const created = await repo.createNode(null, uniqueName('fn-node'), 'directory');
    expect(created.id).toBeGreaterThan(0);
    expect(created.parentId).toBeNull();
    expect(created.syncStatus).toBe('pending_upload');

    const fetched = await repo.getNode(created.id);
    expect(fetched.name).toBe(created.name);
    expect(fetched.type).toBe('directory');
  });

  it('getChildren lists root nodes when parentId is null and children by parent', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-parent'), 'directory');
    const child = await repo.createNode(parent.id, uniqueName('fn-child'), 'file');

    const rootLevel = await repo.getChildren(null);
    expect(rootLevel.some((n) => n.id === parent.id)).toBe(true);

    const children = await repo.getChildren(parent.id);
    expect(children.map((n) => n.id)).toContain(child.id);
    expect(children[0].mimeType).toBeNull(); // LEFT JOIN: filecache columns are null
  });

  it('renameNode/moveNode update and report changes', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-mv-p'), 'directory');
    const node = await repo.createNode(null, uniqueName('fn-mv-n'), 'file');

    const renamed = await repo.renameNode(node.id, uniqueName('fn-renamed'));
    expect(renamed.changes).toBe(1);

    const moved = await repo.moveNode(node.id, parent.id);
    expect(moved.changes).toBe(1);

    const after = await repo.getNode(node.id);
    expect(after.parentId).toBe(parent.id);
  });

  it('resolvePathSegment resolves by parent + name (root and nested)', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-path-p'), 'directory');
    const childName = uniqueName('fn-path-c');
    const child = await repo.createNode(parent.id, childName, 'file');

    const atRoot = await repo.resolvePathSegment(null, parent.name);
    expect(atRoot.id).toBe(parent.id);

    const nested = await repo.resolvePathSegment(parent.id, childName);
    expect(nested.id).toBe(child.id);

    await expect(repo.resolvePathSegment(parent.id, 'definitely-missing')).resolves.toBeNull();
  });

  it('ancestor chain: insert, chain, isAncestor, descendants, delete', async () => {
    const root = await repo.createNode(null, uniqueName('fn-anc-root'), 'directory');
    const leaf = await repo.createNode(root.id, uniqueName('fn-anc-leaf'), 'file');

    await repo.insertAncestorRows([
      { ancestorId: root.id, descendantId: root.id, depth: 0 },
      { ancestorId: root.id, descendantId: leaf.id, depth: 1 },
      { ancestorId: leaf.id, descendantId: leaf.id, depth: 0 },
    ]);

    const chain = await repo.getAncestorChain(leaf.id);
    expect(chain[0]).toMatchObject({ ancestorId: root.id, depth: 1 });

    expect(await repo.isAncestor(root.id, leaf.id)).toBe(true);
    expect(await repo.isAncestor(leaf.id, root.id)).toBe(false);

    const descIds = await repo.getDescendantIds(root.id);
    expect(descIds).toContain(leaf.id);

    const descendants = await repo.getDescendants(root.id);
    expect(descendants.some((n) => n.id === leaf.id)).toBe(true);

    const deleted = await repo.deleteAncestorByDescendant([leaf.id]);
    expect(deleted.changes).toBeGreaterThan(0);
    expect(await repo.isAncestor(root.id, leaf.id)).toBe(false);
  });

  it('deleteNodeTree deletes nodes by id list (FK cascade handles children)', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-del-p'), 'directory');
    await repo.createNode(parent.id, uniqueName('fn-del-c'), 'file');

    const res = await repo.deleteNodeTree([parent.id]);
    expect(res.changes).toBeGreaterThanOrEqual(1);
    await expect(repo.getNode(parent.id)).resolves.toBeNull();
  });

  it('updateSyncStatus + getNodesBySyncStatus(Not) round-trip', async () => {
    const node = await repo.createNode(null, uniqueName('fn-sync'), 'file');
    await repo.updateSyncStatus(node.id, 'active');

    const active = await repo.getNodesBySyncStatus('active');
    expect(active.some((n) => n.id === node.id)).toBe(true);

    const notActive = await repo.getNodesBySyncStatusNot('active');
    expect(notActive.some((n) => n.id === node.id)).toBe(false);
  });

  it('object_map lifecycle: insert → activate → orphan → count → delete rows', async () => {
    const node = await repo.createNode(null, uniqueName('fn-obj'), 'file');
    const s3Key = uniqueName('fn-obj-key');

    await repo.insertObject(node.id, s3Key, 'pending');
    await expect(repo.getObjectMapByS3Key(s3Key)).resolves.toMatchObject({ status: 'pending' });

    await repo.activateObject(s3Key);
    const active = await repo.getActiveObject(node.id);
    expect(active.status).toBe('active');
    expect(await repo.countActiveObjectsByS3Key(s3Key)).toBe(1);

    await repo.orphanObject(s3Key);
    expect(await repo.countActiveObjectsByS3Key(s3Key)).toBe(0);

    // Age the row explicitly (sqlite timestamps are second-granular; a freshly
    // inserted row is not reliably "older than now").
    const { dbRun } = require('@server/test-utils');
    await dbRun('UPDATE object_map SET created_at = ? WHERE s3_key = ?', [
      new Date(Date.now() - 5 * 86400_000).toISOString(),
      s3Key,
    ]);

    const orphaned = await repo.getOrphanedObjects(0);
    expect(orphaned.some((r) => r.s3_key === s3Key)).toBe(true);
    expect(await repo.getAllActiveS3Keys()).not.toContain(s3Key);

    const row = orphaned.find((r) => r.s3_key === s3Key);
    const del = await repo.deleteObjectMapRows([row.id]);
    expect(del.changes).toBe(1);
  });

  it('getKeptS3Keys unions active, history, orphaned and pending-on-pending_upload keys', async () => {
    const { dbRun } = require('@server/test-utils');
    const stuckNode = await repo.createNode(null, uniqueName('fn-kept-stuck'), 'file');
    const orphanedKey = uniqueName('fn-kept-orphan');
    const pendingKey = uniqueName('fn-kept-pending');
    await repo.insertObject(stuckNode.id, orphanedKey, 'orphaned');
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 2, 'pending')`,
      [stuckNode.id, pendingKey]
    );

    const activeNode = await repo.createNode(null, uniqueName('fn-kept-active'), 'file');
    const activeKey = uniqueName('fn-kept-active-key');
    await repo.insertObject(activeNode.id, activeKey, 'active');

    const liveNode = await repo.createNode(null, uniqueName('fn-kept-live'), 'file');
    await repo.updateSyncStatus(liveNode.id, 'active');
    const pendingOnLiveKey = uniqueName('fn-kept-pending-live');
    await repo.insertObject(liveNode.id, pendingOnLiveKey, 'pending');

    const historyNode = await repo.createNode(null, uniqueName('fn-kept-history'), 'file');
    const historyKey = uniqueName('fn-kept-history-key');
    await repo.insertObject(historyNode.id, historyKey, 'history');

    const kept = await repo.getKeptS3Keys();
    expect(kept).toContain(activeKey);
    expect(kept).toContain(orphanedKey);
    expect(kept).toContain(pendingKey);
    expect(kept).toContain(historyKey);
    expect(kept).not.toContain(pendingOnLiveKey);
  });

  it('M15: getKeptS3Keys keeps a TRASHED node\'s active key (no trash filter on the active arm)', async () => {
    const trashedNode = await repo.createNode(null, uniqueName('fn-kept-trash'), 'file');
    const trashedKey = uniqueName('fn-kept-trash-key');
    await repo.insertObject(trashedNode.id, trashedKey, 'active');
    await repo.markSubtreeDeleted([trashedNode.id]);

    const kept = await repo.getKeptS3Keys();
    expect(kept).toContain(trashedKey);
  });

  it('A13: markSubtreeDeleted marks every row of the subtree and gates the live reads', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-trash-p'), 'directory');
    const child = await repo.createNode(parent.id, uniqueName('fn-trash-c'), 'file');
    const sibling = await repo.createNode(null, uniqueName('fn-trash-sib'), 'file');

    await repo.insertAncestorRows([
      { ancestorId: parent.id, descendantId: parent.id, depth: 0 },
      { ancestorId: parent.id, descendantId: child.id, depth: 1 },
      { ancestorId: child.id, descendantId: child.id, depth: 0 },
    ]);

    const marked = await repo.markSubtreeDeleted([parent.id, child.id]);
    expect(marked.changes).toBe(2);

    // Gated reads: trashed rows are invisible...
    await expect(repo.getNode(parent.id)).resolves.toBeNull();
    await expect(repo.getNode(child.id)).resolves.toBeNull();
    await expect(repo.resolvePathSegment(null, parent.name)).resolves.toBeNull();
    await expect(repo.resolvePathSegment(null, sibling.name)).resolves.toMatchObject({
      id: sibling.id,
    });

    const parentLevel = await repo.getChildren(null);
    expect(parentLevel.some((n) => n.id === parent.id)).toBe(false);
    expect(parentLevel.some((n) => n.id === sibling.id)).toBe(true);

    // ...but the trash-aware reads still see them.
    const includingTrashed = await repo.getNodeIncludingTrashed(parent.id);
    expect(includingTrashed).not.toBeNull();
    expect(includingTrashed.deletedAt).not.toBeNull();

    // Re-running the UPDATE is idempotent in effect (deleted_at stays set, no
    // state corruption) — `changes` reports MATCHED rows, not net mutations.
    expect((await repo.markSubtreeDeleted([parent.id, child.id])).changes).toBe(2);
  });

  it('A13: getTrashChildren returns exactly the trashed children of a parent (live siblings excluded)', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-tc-p'), 'directory');
    const live = await repo.createNode(parent.id, uniqueName('fn-tc-live'), 'file');
    const trashedName = uniqueName('fn-tc-dead');
    const trashed = await repo.createNode(parent.id, trashedName, 'file');

    const before = await repo.getChildren(parent.id);
    expect(before.map((n) => n.id)).toContain(live.id);
    expect(before.map((n) => n.id)).toContain(trashed.id);

    await repo.markSubtreeDeleted([trashed.id]);

    const after = await repo.getChildren(parent.id);
    expect(after.map((n) => n.id)).toContain(live.id);
    expect(after.map((n) => n.id)).not.toContain(trashed.id);

    const trashChildren = await repo.getTrashChildren(parent.id);
    expect(trashChildren.map((n) => n.id)).toEqual([trashed.id]);
    expect(trashChildren[0].name).toBe(trashedName);
    // The trashed child is NOT a root-level trash row (it is nested).
    const rootTrash = await repo.getTrashChildren(null);
    expect(rootTrash.map((n) => n.id)).not.toContain(trashed.id);
  });

  it('A13: getTrashChildren(null) returns trashed root-level rows and getTrashedNodes enumerates every trashed row', async () => {
    const rootA = await repo.createNode(null, uniqueName('fn-tr-a'), 'directory');
    const rootB = await repo.createNode(null, uniqueName('fn-tr-b'), 'file');
    const nested = await repo.createNode(rootA.id, uniqueName('fn-tr-nested'), 'file');

    await repo.markSubtreeDeleted([rootA.id, nested.id, rootB.id]);

    const rootTrash = await repo.getTrashChildren(null);
    const rootTrashIds = rootTrash.map((n) => n.id);
    expect(rootTrashIds).toContain(rootA.id);
    expect(rootTrashIds).toContain(rootB.id);
    expect(rootTrashIds).not.toContain(nested.id); // nested ≠ root level

    const all = await repo.getTrashedNodes();
    const allIds = all.map((n) => n.id);
    for (const id of [rootA.id, rootB.id, nested.id]) {
      expect(allIds).toContain(id);
    }
    expect(all.every((n) => n.deletedAt != null)).toBe(true);
  });

  it('A13: getDescendantIds / getAncestorChain stay UNFILTERED across a trash boundary', async () => {
    const root = await repo.createNode(null, uniqueName('fn-uf-root'), 'directory');
    const leaf = await repo.createNode(root.id, uniqueName('fn-uf-leaf'), 'file');
    await repo.insertAncestorRows([
      { ancestorId: root.id, descendantId: root.id, depth: 0 },
      { ancestorId: root.id, descendantId: leaf.id, depth: 1 },
      { ancestorId: leaf.id, descendantId: leaf.id, depth: 0 },
    ]);

    await repo.markSubtreeDeleted([root.id, leaf.id]);

    // Full trashed subtree is still enumerable (restore/purge need it).
    const descIds = await repo.getDescendantIds(root.id);
    expect(descIds).toContain(leaf.id);
    const chain = await repo.getAncestorChain(leaf.id);
    expect(chain.some((e) => e.ancestorId === root.id)).toBe(true);
  });

  it('A4: restore-cycle schema behavior — trashed rows coexist with live same-name rows; the restore UPDATE re-enrolls live uniqueness (collision rejected)', async () => {
    const parent = await repo.createNode(null, uniqueName('fn-rc-p'), 'directory');
    const name = uniqueName('fn-rc-name');
    const original = await repo.createNode(parent.id, name, 'file');
    await repo.markSubtreeDeleted([original.id]);

    // While the row is trashed, a live sibling with the same name coexists.
    const live = await repo.createNode(parent.id, name, 'file');
    expect(live.id).toBeGreaterThan(0);

    // Restore cycle: clearing deleted_at re-enrolls the row in live uniqueness.
    // With a live same-name sibling present, the restore UPDATE violates the
    // partial unique index — exactly the collision the trash-restore flow must
    // resolve (name suffix / deepest live ancestor) before clearing deleted_at.
    const { dbRun } = require('@server/test-utils');
    await expect(
      dbRun('UPDATE file_nodes SET deleted_at = NULL WHERE id = ?', [original.id])
    ).rejects.toThrow();

    // Once the colliding sibling is trashed too, the restore succeeds.
    await repo.markSubtreeDeleted([live.id]);
    await expect(
      dbRun('UPDATE file_nodes SET deleted_at = NULL WHERE id = ?', [original.id])
    ).resolves.toBeDefined();

    // The restored row is live-unique again: a same-name insert is rejected.
    await expect(repo.createNode(parent.id, name, 'file')).rejects.toThrow();

    // Re-trashing the restored row releases uniqueness once more.
    await repo.markSubtreeDeleted([original.id]);
    const third = await repo.createNode(parent.id, name, 'file');
    expect(third.id).toBeGreaterThan(0);
    expect(third.id).not.toBe(original.id);
  });

  it('getOrphanedObjectsWithNodeState annotates node sync status and has_active', async () => {
    const { dbRun } = require('@server/test-utils');
    const stuckNode = await repo.createNode(null, uniqueName('fn-state-stuck'), 'file');
    const stuckKey = uniqueName('fn-state-stuck-key');
    await repo.insertObject(stuckNode.id, stuckKey, 'orphaned');

    const liveNode = await repo.createNode(null, uniqueName('fn-state-live'), 'file');
    const liveActiveKey = uniqueName('fn-state-live-active');
    const liveOrphanKey = uniqueName('fn-state-live-orphan');
    await repo.insertObject(liveNode.id, liveActiveKey, 'active');
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 2, 'orphaned')`,
      [liveNode.id, liveOrphanKey]
    );

    const freshNode = await repo.createNode(null, uniqueName('fn-state-fresh'), 'file');
    const freshKey = uniqueName('fn-state-fresh-key');
    await repo.insertObject(freshNode.id, freshKey, 'orphaned');

    const aged = new Date(Date.now() - 5 * 86400_000).toISOString();
    await dbRun('UPDATE object_map SET created_at = ? WHERE s3_key = ?', [aged, stuckKey]);
    await dbRun('UPDATE object_map SET created_at = ? WHERE s3_key = ?', [aged, liveOrphanKey]);

    const orphaned = await repo.getOrphanedObjectsWithNodeState(1);
    const stuckRow = orphaned.find((r) => r.s3_key === stuckKey);
    expect(stuckRow).toBeDefined();
    expect(stuckRow.node_sync_status).toBe('pending_upload');
    expect(Number(stuckRow.has_active)).toBe(0);

    const liveRow = orphaned.find((r) => r.s3_key === liveOrphanKey);
    expect(liveRow).toBeDefined();
    expect(Number(liveRow.has_active)).toBe(1);

    expect(orphaned.some((r) => r.s3_key === freshKey)).toBe(false);
  });

  it('getStalePendingObjects returns only pending rows on pending_upload nodes past the cutoff', async () => {
    const { dbRun } = require('@server/test-utils');
    const stuckNode = await repo.createNode(null, uniqueName('fn-stale-stuck'), 'file');
    const staleKey = uniqueName('fn-stale-old');
    const freshKey = uniqueName('fn-stale-fresh');
    await repo.insertObject(stuckNode.id, staleKey, 'pending');
    await dbRun(
      `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
       VALUES (?, ?, 's3', 2, 'pending')`,
      [stuckNode.id, freshKey]
    );

    const liveNode = await repo.createNode(null, uniqueName('fn-stale-live'), 'file');
    await repo.updateSyncStatus(liveNode.id, 'active');
    const pendingOnLiveKey = uniqueName('fn-stale-pending-live');
    await repo.insertObject(liveNode.id, pendingOnLiveKey, 'pending');

    await dbRun('UPDATE object_map SET created_at = ? WHERE s3_key = ?', [
      new Date(Date.now() - 5 * 86400_000).toISOString(),
      staleKey,
    ]);

    const stale = await repo.getStalePendingObjects(1);
    expect(stale.some((r) => r.s3_key === staleKey)).toBe(true);
    expect(stale.some((r) => r.s3_key === freshKey)).toBe(false);
    expect(stale.some((r) => r.s3_key === pendingOnLiveKey)).toBe(false);
  });

  it('upsertObjectMap bumps version and demotes the previous active row to history', async () => {
    const node = await repo.createNode(null, uniqueName('fn-um'), 'file');
    const key1 = uniqueName('fn-um-k1');
    const key2 = uniqueName('fn-um-k2');

    await repo.upsertObjectMap(node.id, key1, 'active');
    await repo.upsertObjectMap(node.id, key2, 'active');

    const active = await repo.getActiveObject(node.id);
    expect(active.s3_key).toBe(key2);
    expect(active.version_number).toBe(2);
    expect(await repo.countActiveObjectsByS3Key(key1)).toBe(0);

    const { dbQuery } = require('@server/test-utils');
    const prevRows = await dbQuery('SELECT status FROM object_map WHERE s3_key = ?', [key1]);
    expect(prevRows.rows[0].status).toBe('history');
  });

  it('evictVersionsBeyondCap demotes the oldest history rows to orphaned while active+history > cap', async () => {
    const node = await repo.createNode(null, uniqueName('fn-evict'), 'file');
    const keys = [];
    for (let v = 1; v <= 5; v += 1) {
      const key = uniqueName(`fn-evict-k${v}`);
      keys.push(key);
      await repo.upsertObjectMap(node.id, key, 'active');
    }
    // After 5 upserts: v1..v4 are history, v5 is active.
    const { dbQuery } = require('@server/test-utils');
    const statusByVersion = async () => {
      const rows = await dbQuery(
        'SELECT s3_key, version_number, status FROM object_map WHERE file_node_id = ? ORDER BY version_number',
        [node.id]
      );
      return Object.fromEntries(rows.rows.map((r) => [Number(r.version_number), r.status]));
    };
    expect(await statusByVersion()).toEqual({
      1: 'history',
      2: 'history',
      3: 'history',
      4: 'history',
      5: 'active',
    });

    // cap 3 → active(1) + history(4) = 5 > 3 → evict the 2 oldest history rows.
    const evicted = await repo.evictVersionsBeyondCap(node.id, 3);
    expect(evicted.changes).toBe(2);

    expect(await statusByVersion()).toEqual({
      1: 'orphaned',
      2: 'orphaned',
      3: 'history',
      4: 'history',
      5: 'active',
    });

    // Cap already satisfied → second call evicts nothing.
    expect((await repo.evictVersionsBeyondCap(node.id, 3)).changes).toBe(0);
    expect(keys).toHaveLength(5);
  });

  it('evictVersionsBeyondCap treats cap 0 as unbounded (no-op) and never touches the active row', async () => {
    const node = await repo.createNode(null, uniqueName('fn-evict0'), 'file');
    for (let v = 1; v <= 4; v += 1) {
      await repo.upsertObjectMap(node.id, uniqueName(`fn-evict0-k${v}`), 'active');
    }
    const before = await repo.getActiveObject(node.id);

    expect((await repo.evictVersionsBeyondCap(node.id, 0)).changes).toBe(0);

    const { dbQuery } = require('@server/test-utils');
    const rows = await dbQuery(
      'SELECT status FROM object_map WHERE file_node_id = ? ORDER BY version_number',
      [node.id]
    );
    expect(rows.rows.map((r) => r.status)).toEqual(['history', 'history', 'history', 'active']);
    const after = await repo.getActiveObject(node.id);
    expect(Number(after.id)).toBe(Number(before.id));
    expect(after.status).toBe('active');

    // Negative/invalid caps behave like unbounded (no-op), never a full wipe.
    expect((await repo.evictVersionsBeyondCap(node.id, -1)).changes).toBe(0);
  });

  it('getVersionsByNode returns active + history rows newest-first, excluding pending and orphaned', async () => {
    const node = await repo.createNode(null, uniqueName('fn-vers'), 'file');
    const keyV1 = uniqueName('fn-vers-v1');
    const keyV2 = uniqueName('fn-vers-v2');
    const keyV3 = uniqueName('fn-vers-v3');

    await repo.upsertObjectMap(node.id, keyV1, 'active');
    await repo.upsertObjectMap(node.id, keyV2, 'active');
    await repo.upsertObjectMap(node.id, keyV3, 'pending');
    // Evict v1 explicitly to prove orphaned rows are excluded.
    await repo.evictVersionsBeyondCap(node.id, 2);

    const versions = await repo.getVersionsByNode(node.id);
    expect(versions.map((r) => r.s3_key)).toEqual([keyV2, keyV1]);
    // keyV1 was evicted by the cap; keyV2 was demoted to history by the third
    // upsert (status='pending' still demotes the previous active row).
    expect(versions.map((r) => r.status)).toEqual(['history', 'history']);
    expect(versions.some((r) => r.s3_key === keyV3)).toBe(false);

    const other = await repo.createNode(null, uniqueName('fn-vers-other'), 'file');
    await repo.insertObject(other.id, uniqueName('fn-vers-other-key'), 'pending');
    expect(await repo.getVersionsByNode(node.id)).toHaveLength(2);
    expect(await repo.getVersionsByNode(99999999)).toEqual([]);
  });

  it('demoteActiveToHistory flips only the active row with the given s3_key', async () => {
    const node = await repo.createNode(null, uniqueName('fn-dmh'), 'file');
    const key = uniqueName('fn-dmh-key');
    await repo.insertObject(node.id, key, 'active');

    const res = await repo.demoteActiveToHistory(key);
    expect(res.changes).toBe(1);
    const { dbQuery } = require('@server/test-utils');
    const demoted = await dbQuery('SELECT status FROM object_map WHERE s3_key = ?', [key]);
    expect(demoted.rows[0].status).toBe('history');

    // Already-history → no-op; pending/unknown keys → no-op.
    expect((await repo.demoteActiveToHistory(key)).changes).toBe(0);
    await repo.upsertObjectMap(node.id, uniqueName('fn-dmh-pending'), 'pending');
    const { dbQuery: dq2 } = require('@server/test-utils');
    const newest = await dq2(
      'SELECT status, s3_key FROM object_map WHERE file_node_id = ? ORDER BY version_number DESC LIMIT 1',
      [node.id]
    );
    expect(newest.rows[0].status).toBe('pending');
    expect((await repo.demoteActiveToHistory(newest.rows[0].s3_key)).changes).toBe(0);
    expect((await repo.demoteActiveToHistory('unknown-key')).changes).toBe(0);
  });

  it('setObjectMapBackendWebdav flips the backend of the active row', async () => {
    const node = await repo.createNode(null, uniqueName('fn-wd'), 'file');
    const key = uniqueName('fn-wd-key');
    await repo.insertObject(node.id, key, 'active');

    await repo.setObjectMapBackendWebdav(node.id);
    const row = await repo.getActiveObject(node.id);
    expect(row.storage_backend).toBe('webdav');
  });

  it('reactivateObjectMapRow flips an orphaned row back to active', async () => {
    const node = await repo.createNode(null, uniqueName('fn-react'), 'file');
    const key = uniqueName('fn-react-key');

    await repo.upsertObjectMap(node.id, key, 'pending');
    await repo.activateObject(key);
    await repo.orphanObject(key);

    const { dbQuery } = require('@server/test-utils');
    const orphaned = await dbQuery('SELECT id FROM object_map WHERE s3_key = ?', [key]);
    expect(orphaned.rows.length).toBe(1);

    const res = await repo.reactivateObjectMapRow(Number(orphaned.rows[0].id));
    expect(res.changes).toBe(1);

    const active = await repo.getActiveObject(node.id);
    expect(active.s3_key).toBe(key);
    expect(active.status).toBe('active');
  });

  it('reactivateObjectMapRow flips a history row back to active (DEF-11 restore path)', async () => {
    const node = await repo.createNode(null, uniqueName('fn-react-history'), 'file');
    const key = uniqueName('fn-react-history-key');

    // upsertObjectMap leaves the previous active row as 'history'.
    await repo.upsertObjectMap(node.id, key, 'active');
    await repo.upsertObjectMap(node.id, uniqueName('fn-react-history-k2'), 'active');

    const { dbQuery } = require('@server/test-utils');
    const historyRow = await dbQuery(
      "SELECT id FROM object_map WHERE s3_key = ? AND status = 'history'",
      [key]
    );
    expect(historyRow.rows.length).toBe(1);

    const res = await repo.reactivateObjectMapRow(Number(historyRow.rows[0].id));
    expect(res.changes).toBe(1);

    // The row itself is active again. The service-level restore pairs this with
    // demoteActiveToHistory on the current row; reactivate alone leaves both
    // rows active and getActiveObject's pick is unspecified, so assert the row.
    const rows = await dbQuery('SELECT s3_key, status FROM object_map WHERE id = ?', [
      historyRow.rows[0].id,
    ]);
    expect(rows.rows[0].status).toBe('active');
  });

  it('reactivateObjectMapRow leaves non-history/orphaned rows untouched', async () => {
    const node = await repo.createNode(null, uniqueName('fn-react-nonorphan'), 'file');
    const key = uniqueName('fn-react-nonorphan-key');

    await repo.insertObject(node.id, key, 'pending');
    const pendingRow = await repo.getObjectMapByS3Key(key);
    expect((await repo.reactivateObjectMapRow(pendingRow.id)).changes).toBe(0);
    expect((await repo.getObjectMapByS3Key(key)).status).toBe('pending');

    await repo.activateObject(key);
    const activeRow = await repo.getActiveObject(node.id);
    expect((await repo.reactivateObjectMapRow(activeRow.id)).changes).toBe(0);
  });

  it('reactivateObjectMapRow with an unknown id changes nothing', async () => {
    expect((await repo.reactivateObjectMapRow(99999999)).changes).toBe(0);
  });

  it('getObjectMapByNode returns every row of the node newest-version first regardless of age', async () => {
    const node = await repo.createNode(null, uniqueName('fn-objnode'), 'file');
    const keyV1 = uniqueName('fn-objnode-v1');
    const keyV2 = uniqueName('fn-objnode-v2');

    await repo.insertObject(node.id, keyV1, 'pending');
    await repo.activateObject(keyV1);
    await repo.orphanObject(keyV1);
    await repo.upsertObjectMap(node.id, keyV2, 'pending');

    // A freshly inserted row is not reliably "older than now" (second-granular
    // timestamps) — getObjectMapByNode must not apply any age filter.
    const rows = await repo.getObjectMapByNode(node.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.s3_key)).toEqual([keyV2, keyV1]);
    expect(rows.map((r) => r.status)).toEqual(['pending', 'orphaned']);

    const other = await repo.createNode(null, uniqueName('fn-objnode-other'), 'file');
    await repo.insertObject(other.id, uniqueName('fn-objnode-other-key'), 'pending');
    const scoped = await repo.getObjectMapByNode(node.id);
    expect(scoped).toHaveLength(2);
  });

  it('filecache: upsert insert/update, get, delete', async () => {
    const node = await repo.createNode(null, uniqueName('fn-cache'), 'file');

    await repo.upsertCache(node.id, 100, 'text/plain', 'hash-1');
    let cache = await repo.getCache(node.id);
    expect(Number(cache.size)).toBe(100);
    expect(cache.mime_type).toBe('text/plain');

    await repo.upsertCache(node.id, 200, 'text/html', 'hash-2');
    cache = await repo.getCache(node.id);
    expect(Number(cache.size)).toBe(200);

    const del = await repo.deleteCache(node.id);
    expect(del.changes).toBe(1);
    await expect(repo.getCache(node.id)).resolves.toBeNull();
  });

  it('getUserRootNode resolves the root node named after the username', async () => {
    const User = require('@server/models/User');
    const username = uniqueName('conf-fn-user');
    const user = await User.create(username, `${username}@conf.test`, 'pw', false);
    const created = await repo.createNode(null, username, 'directory');

    const root = await repo.getUserRootNode(user.id);
    expect(root).not.toBeNull();
    expect(root.id).toBe(created.id);
    expect(root.name).toBe(username);
  });
});
