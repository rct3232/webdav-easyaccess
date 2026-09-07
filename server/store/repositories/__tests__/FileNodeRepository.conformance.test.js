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

  it('upsertObjectMap bumps version and orphans the previous active row', async () => {
    const node = await repo.createNode(null, uniqueName('fn-um'), 'file');
    const key1 = uniqueName('fn-um-k1');
    const key2 = uniqueName('fn-um-k2');

    await repo.upsertObjectMap(node.id, key1, 'active');
    await repo.upsertObjectMap(node.id, key2, 'active');

    const active = await repo.getActiveObject(node.id);
    expect(active.s3_key).toBe(key2);
    expect(await repo.countActiveObjectsByS3Key(key1)).toBe(0);
  });

  it('setObjectMapBackendWebdav flips the backend of the active row', async () => {
    const node = await repo.createNode(null, uniqueName('fn-wd'), 'file');
    const key = uniqueName('fn-wd-key');
    await repo.insertObject(node.id, key, 'active');

    await repo.setObjectMapBackendWebdav(node.id);
    const row = await repo.getActiveObject(node.id);
    expect(row.storage_backend).toBe('webdav');
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
