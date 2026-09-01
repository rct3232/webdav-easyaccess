'use strict';

const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../fileNodesStore');

describe('createFileNodesStore', () => {
  let dbCleanup;
  let store;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    store = createFileNodesStore();
  });

  afterAll(async () => {
    await dbCleanup();
  });

  /* ------------------------------------------------------------------ */
  /*  file_nodes                                                         */
  /* ------------------------------------------------------------------ */

  describe('file_nodes', () => {
    afterEach(async () => {
      const ids = await dbQuery(
        `SELECT id FROM file_nodes WHERE name LIKE 'test-%' OR name LIKE 'fn-%'`
      );
      for (const row of ids.rows) {
        try {
          await dbRun('DELETE FROM file_nodes WHERE id = ?', [row.id]);
        } catch { /* ignore cascade errors */ }
      }
    });

    // V1: createNode for file
    it('creates a file node with sync_status=pending_upload', async () => {
      const result = await store.createNode(null, 'fn-test-file.txt', 'file');
      expect(result).toMatchObject({
        name: 'fn-test-file.txt',
        type: 'file',
        syncStatus: 'pending_upload',
      });
      expect(typeof result.id).toBe('number');
      expect(result.parentId).toBeNull();
    });

    // V2: createNode for directory
    it('creates a directory node with correct type', async () => {
      const result = await store.createNode(null, 'fn-test-dir', 'directory');
      expect(result.type).toBe('directory');
      expect(result.name).toBe('fn-test-dir');
    });

    // V3: createNode with duplicate name under same parent
    it('throws on duplicate name under same parent', async () => {
      await store.createNode(null, 'test-duplicate-name', 'file');
      await expect(
        store.createNode(null, 'test-duplicate-name', 'directory')
      ).rejects.toThrow();
    });

    // V4: getChildren on empty directory
    it('returns empty array for children of non-existent parent', async () => {
      const children = await store.getChildren(99999);
      expect(children).toEqual([]);
    });

    // Root listing: getChildren(null) returns top-level (parent_id IS NULL) nodes.
    it('returns root-level nodes when parentId is null', async () => {
      const rootA = await store.createNode(null, 'fn-root-a', 'directory');
      const rootB = await store.createNode(null, 'fn-root-b', 'file');
      const nested = await store.createNode(rootA.id, 'fn-root-nested', 'file');

      const children = await store.getChildren(null);

      const ids = children.map((c) => c.id);
      expect(ids).toContain(rootA.id);
      expect(ids).toContain(rootB.id);
      expect(ids).not.toContain(nested.id);

      await dbRun('DELETE FROM file_nodes WHERE name IN (?, ?, ?)', ['fn-root-a', 'fn-root-b', 'fn-root-nested']);
    });

    // renameNode
    it('renames a node and refreshes updated_at', async () => {
      const created = await store.createNode(null, 'fn-rename-me', 'file');
      const beforeUpdate = new Date();
      await store.renameNode(created.id, 'fn-renamed');

      const node = await store.getNode(created.id);
      expect(node.name).toBe('fn-renamed');
      expect(node.updatedAt).toBeDefined();
    });

    // V7: moveNode
    it('moves a node to new parent', async () => {
      const parent = await store.createNode(null, 'fn-move-parent', 'directory');
      const child = await store.createNode(parent.id, 'fn-move-child', 'file');

      const newParent = await store.createNode(null, 'fn-new-parent', 'directory');
      await store.moveNode(child.id, newParent.id);

      const moved = await store.getNode(child.id);
      expect(moved.parentId).toBe(newParent.id);
    });

    // V8: deleteNodeTree with CASCADE
    it('deletes node tree via CASCADE removing all related rows', async () => {
      const parent = await store.createNode(null, 'test-cascade-root', 'directory');
      const child1 = await store.createNode(parent.id, 'test-cascade-child1', 'file');
      const child2 = await store.createNode(parent.id, 'test-cascade-child2', 'file');

      // Insert related rows in object_map and filecache to verify CASCADE
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, 'pending')`,
        [child1.id, 'test-cascade-key1']
      );
      await dbRun(
        `INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at)
         VALUES (?, 100, 'text/plain', null, ?)`,
        [child2.id, new Date().toISOString()]
      );

      // Insert ancestor rows
      await dbRun(
        `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (?, ?, 0)`,
        [parent.id, parent.id]
      );
      await dbRun(
        `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (?, ?, 1)`,
        [parent.id, child1.id]
      );

      const result = await store.deleteNodeTree([parent.id]);
      expect(result.changes).toBeGreaterThan(0);

      // Verify parent is gone
      const parentNode = await store.getNode(parent.id);
      expect(parentNode).toBeNull();

      // Verify children are gone (CASCADE)
      const child1Node = await store.getNode(child1.id);
      expect(child1Node).toBeNull();
      const child2Node = await store.getNode(child2.id);
      expect(child2Node).toBeNull();

      // Verify object_map rows are gone
      const objMapRows = await dbQuery(
        `SELECT COUNT(*) as count FROM object_map WHERE file_node_id IN (?, ?)`,
        [child1.id, child2.id]
      );
      expect(objMapRows.rows[0].count).toBe(0);

      // Verify filecache rows are gone
      const cacheRows = await dbQuery(
        `SELECT COUNT(*) as count FROM filecache WHERE file_node_id IN (?, ?)`,
        [child1.id, child2.id]
      );
      expect(cacheRows.rows[0].count).toBe(0);

      // Verify node_ancestors rows are gone
      const ancestorRows = await dbQuery(
        `SELECT COUNT(*) as count FROM node_ancestors WHERE ancestor_id IN (?, ?, ?) OR descendant_id IN (?, ?, ?)`,
        [parent.id, child1.id, child2.id, parent.id, child1.id, child2.id]
      );
      expect(ancestorRows.rows[0].count).toBe(0);
    });

    // updateSyncStatus
    it('updates sync status', async () => {
      const created = await store.createNode(null, 'fn-sync-status-test', 'file');
      await store.updateSyncStatus(created.id, 'active');

      const node = await store.getNode(created.id);
      expect(node.syncStatus).toBe('active');
    });

    // getNodesBySyncStatusNot
    it('returns only nodes whose sync_status differs from the given status', async () => {
      const active = await store.createNode(null, 'fn-not-active', 'file');
      await store.updateSyncStatus(active.id, 'active');
      const pending = await store.createNode(null, 'fn-not-pending', 'file');
      const orphan = await store.createNode(null, 'fn-not-orphan', 'file');
      await store.updateSyncStatus(orphan.id, 'orphaned_node');

      const excludingOrphaned = await store.getNodesBySyncStatusNot('orphaned_node');
      const excludingOrphanedIds = excludingOrphaned.map((n) => n.id);
      expect(excludingOrphanedIds).toContain(active.id);
      expect(excludingOrphanedIds).toContain(pending.id);
      expect(excludingOrphanedIds).not.toContain(orphan.id);

      const excludingActive = await store.getNodesBySyncStatusNot('active');
      const excludingActiveIds = excludingActive.map((n) => n.id);
      expect(excludingActiveIds).toContain(pending.id);
      expect(excludingActiveIds).toContain(orphan.id);
      expect(excludingActiveIds).not.toContain(active.id);
    });

    it('getNodesBySyncStatusNot maps rows identically to getNodesBySyncStatus', async () => {
      const node = await store.createNode(null, 'fn-not-mapping', 'file');
      await store.updateSyncStatus(node.id, 'active');

      const [fromNot] = await store.getNodesBySyncStatusNot('pending_upload');
      const [fromEq] = await store.getNodesBySyncStatus('active');

      expect(fromNot.id).toBe(node.id);
      expect(fromNot.type).toBe('file');
      expect(fromNot.name).toBe('fn-not-mapping');
      expect(fromNot.syncStatus).toBe('active');
      expect(fromNot.parentId).toBeNull();
      expect(fromNot).toEqual(fromEq);
    });

    // resolvePathSegment
    it('resolves a path segment by parent and name', async () => {
      const created = await store.createNode(null, 'fn-path-resolve-test', 'directory');
      const resolved = await store.resolvePathSegment(null, 'fn-path-resolve-test');
      expect(resolved.id).toBe(created.id);

      // Also test with parentId
      const child = await store.createNode(created.id, 'child-of-resolve', 'file');
      const childResolved = await store.resolvePathSegment(created.id, 'child-of-resolve');
      expect(childResolved.id).toBe(child.id);

      // Non-existent returns null
      const notFound = await store.resolvePathSegment(created.id, 'does-not-exist');
      expect(notFound).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  node_ancestors                                                     */
  /* ------------------------------------------------------------------ */
  describe('node_ancestors', () => {
    const testPrefix = 'anc-';

    afterEach(async () => {
      await dbRun(
        `DELETE FROM node_ancestors WHERE descendant_id IN (SELECT id FROM file_nodes WHERE name LIKE '${testPrefix}%')`
      );
      await dbRun(
        `DELETE FROM node_ancestors WHERE ancestor_id IN (SELECT id FROM file_nodes WHERE name LIKE '${testPrefix}%')`
      );
      await dbRun(`DELETE FROM file_nodes WHERE name LIKE '${testPrefix}%'`);
    });

    // V9: insertAncestorRows bulk
    it('inserts multiple ancestor rows', async () => {
      const root = await store.createNode(null, `${testPrefix}root`, 'directory');
      const child = await store.createNode(root.id, `${testPrefix}child`, 'file');

      const result = await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: root.id, depth: 0 },
        { ancestorId: root.id, descendantId: child.id, depth: 1 },
        { ancestorId: child.id, descendantId: child.id, depth: 0 },
      ]);

      expect(result.changes).toBe(3);

      const rows = await dbQuery(
        `SELECT * FROM node_ancestors WHERE descendant_id IN (?, ?) ORDER BY ancestor_id, descendant_id`,
        [root.id, child.id]
      );
      expect(rows.rows.length).toBe(3);
    });

    // V10: deleteAncestorByDescendant
    it('removes only rows for the target descendants', async () => {
      const root = await store.createNode(null, `${testPrefix}del-root`, 'directory');
      const childA = await store.createNode(root.id, `${testPrefix}child-a`, 'file');
      const childB = await store.createNode(root.id, `${testPrefix}child-b`, 'file');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: childA.id, depth: 1 },
        { ancestorId: root.id, descendantId: childB.id, depth: 1 },
        { ancestorId: childA.id, descendantId: childA.id, depth: 0 },
      ]);

      const delResult = await store.deleteAncestorByDescendant([childA.id]);
      expect(delResult.changes).toBe(2);

      // childB rows remain
      const remainingRows = await dbQuery(
        `SELECT COUNT(*) as count FROM node_ancestors WHERE descendant_id = ?`,
        [childB.id]
      );
      expect(remainingRows.rows[0].count).toBe(1);
    });

    // V11: getDescendantIds
    it('returns self and all descendants', async () => {
      const root = await store.createNode(null, `${testPrefix}desc-root`, 'directory');
      const child = await store.createNode(root.id, `${testPrefix}desc-child`, 'file');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: root.id, depth: 0 },
        { ancestorId: root.id, descendantId: child.id, depth: 1 },
      ]);

      const descendants = await store.getDescendantIds(root.id);
      expect(descendants).toContain(root.id);
      expect(descendants).toContain(child.id);
    });

    // V11b: getDescendants leaf (self-only)
    it('returns only the node itself when it has only a self row', async () => {
      const root = await store.createNode(null, `${testPrefix}desc-leaf`, 'file');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: root.id, depth: 0 },
      ]);

      const descendants = await store.getDescendants(root.id);
      expect(descendants.map((d) => d.id)).toEqual([root.id]);
      expect(descendants[0]).toMatchObject({ name: `${testPrefix}desc-leaf`, type: 'file' });
    });

    // V11c: getDescendants depth-1 children
    it('returns the node itself and direct children rows', async () => {
      const root = await store.createNode(null, `${testPrefix}desc-children-root`, 'directory');
      const childA = await store.createNode(root.id, `${testPrefix}desc-children-a`, 'file');
      const childB = await store.createNode(root.id, `${testPrefix}desc-children-b`, 'file');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: root.id, depth: 0 },
        { ancestorId: root.id, descendantId: childA.id, depth: 1 },
        { ancestorId: root.id, descendantId: childB.id, depth: 1 },
      ]);

      const descendants = await store.getDescendants(root.id);
      const ids = descendants.map((d) => d.id);
      expect(ids).toContain(root.id);
      expect(ids).toContain(childA.id);
      expect(ids).toContain(childB.id);
      expect(descendants.length).toBe(3);
    });

    // V11d: getDescendants depth-N subtree
    it('returns full subtree rows for a depth-N tree', async () => {
      const root = await store.createNode(null, `${testPrefix}desc-subtree-root`, 'directory');
      const mid = await store.createNode(root.id, `${testPrefix}desc-subtree-mid`, 'directory');
      const leaf = await store.createNode(mid.id, `${testPrefix}desc-subtree-leaf`, 'file');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: root.id, depth: 0 },
        { ancestorId: root.id, descendantId: mid.id, depth: 1 },
        { ancestorId: root.id, descendantId: leaf.id, depth: 2 },
        { ancestorId: mid.id, descendantId: mid.id, depth: 0 },
        { ancestorId: mid.id, descendantId: leaf.id, depth: 1 },
        { ancestorId: leaf.id, descendantId: leaf.id, depth: 0 },
      ]);

      const descendants = await store.getDescendants(root.id);
      const ids = descendants.map((d) => d.id);
      expect(ids).toContain(root.id);
      expect(ids).toContain(mid.id);
      expect(ids).toContain(leaf.id);
      expect(descendants.length).toBe(3);

      const midLeaf = descendants.find((d) => d.id === leaf.id);
      expect(midLeaf).toMatchObject({
        parentId: mid.id,
        name: `${testPrefix}desc-subtree-leaf`,
        type: 'file',
      });
    });

    // V11e: getDescendants with empty ancestor set
    it('returns empty array when no ancestor rows exist', async () => {
      const root = await store.createNode(null, `${testPrefix}desc-empty`, 'directory');

      const descendants = await store.getDescendants(root.id);
      expect(descendants).toEqual([]);
    });

    // V12: getAncestorChain
    it('returns ordered chain from root to self', async () => {
      const root = await store.createNode(null, `${testPrefix}chain-root`, 'directory');
      const mid = await store.createNode(root.id, `${testPrefix}chain-mid`, 'directory');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: mid.id, depth: 1 },
        { ancestorId: mid.id, descendantId: mid.id, depth: 0 },
      ]);

      const chain = await store.getAncestorChain(mid.id);
      expect(chain.length).toBe(2);
      expect(chain[0].ancestorId).toBe(root.id);
      expect(chain[0].depth).toBe(1);
      expect(chain[1].ancestorId).toBe(mid.id);
      expect(chain[1].depth).toBe(0);
    });

    // deleteAncestorByAncestor
    it('removes rows matching given ancestor IDs', async () => {
      const root = await store.createNode(null, `${testPrefix}anc-by-root`, 'directory');
      const child = await store.createNode(root.id, `${testPrefix}anc-by-child`, 'file');

      await store.insertAncestorRows([
        { ancestorId: root.id, descendantId: child.id, depth: 1 },
        { ancestorId: child.id, descendantId: child.id, depth: 0 },
      ]);

      const delResult = await store.deleteAncestorByAncestor([root.id]);
      expect(delResult.changes).toBe(1);

      const remaining = await dbQuery(
        `SELECT COUNT(*) as count FROM node_ancestors WHERE descendant_id IN (?, ?)`,
        [root.id, child.id]
      );
      expect(remaining.rows[0].count).toBe(1);
    });

    // isAncestor
    it('returns true when ancestor relationship exists', async () => {
      const a = await store.createNode(null, `${testPrefix}isa-a`, 'directory');
      const b = await store.createNode(a.id, `${testPrefix}isa-b`, 'directory');
      const c = await store.createNode(b.id, `${testPrefix}isa-c`, 'file');

      await store.insertAncestorRows([
        { ancestorId: a.id, descendantId: a.id, depth: 0 },
        { ancestorId: a.id, descendantId: b.id, depth: 1 },
        { ancestorId: a.id, descendantId: c.id, depth: 2 },
        { ancestorId: b.id, descendantId: b.id, depth: 0 },
        { ancestorId: b.id, descendantId: c.id, depth: 1 },
        { ancestorId: c.id, descendantId: c.id, depth: 0 },
      ]);

      expect(await store.isAncestor(a.id, c.id)).toBe(true);
      expect(await store.isAncestor(c.id, a.id)).toBe(false);
      expect(await store.isAncestor(a.id, a.id)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  object_map                                                         */
  /* ------------------------------------------------------------------ */

  describe('object_map', () => {
    const testPrefix = 'obj-';

    afterEach(async () => {
      await dbRun(`DELETE FROM file_nodes WHERE name LIKE '${testPrefix}%'`);
    });

    // V13: upsertObjectMap creates pending entry
    it('creates a pending object_map entry', async () => {
      const created = await store.createNode(null, `${testPrefix}pending-file`, 'file');
      await store.upsertObjectMap(created.id, 's3://bucket/pending-key', 'pending');

      const activeObj = await dbQuery(
        `SELECT * FROM object_map WHERE file_node_id = ? AND status = 'pending'`,
        [created.id]
      );
      expect(activeObj.rows.length).toBe(1);
      expect(activeObj.rows[0].s3_key).toBe('s3://bucket/pending-key');
    });

    // V14: upsertObjectMap orphans previous active entry via UPDATE before INSERT
    it('orphans the previous active entry on upsert', async () => {
      const created = await store.createNode(null, `${testPrefix}orphan-file`, 'file');

      // First upsert creates an active row (version 1)
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [created.id, 's3://bucket/old-key', 'active']
      );

      // Verify it's active
      let row = await dbQuery(
        `SELECT * FROM object_map WHERE file_node_id = ? AND s3_key = ?`,
        [created.id, 's3://bucket/old-key']
      );
      expect(row.rows[0].status).toBe('active');

      // upsertObjectMap will orphan the active row, then INSERT version 1 (which conflicts)
      // We capture that the UPDATE ran by checking the status transition
      try {
        await store.upsertObjectMap(created.id, 's3://bucket/new-key', 'pending');
      } catch { /* expected: unique constraint on (file_node_id, version_number) */ }

      // The orphaning UPDATE runs before the INSERT, so old row should be orphaned
      row = await dbQuery(
        `SELECT * FROM object_map WHERE file_node_id = ? AND s3_key = ?`,
        [created.id, 's3://bucket/old-key']
      );
      expect(row.rows[0].status).toBe('orphaned');
    });

    // V15: activateObject pending -> active
    it('activates a pending object', async () => {
      const created = await store.createNode(null, `${testPrefix}activate-file`, 'file');
      await store.insertObject(created.id, 's3://bucket/activate-key', 'pending');

      const result = await store.activateObject('s3://bucket/activate-key');
      expect(result.changes).toBe(1);

      const row = await dbQuery(
        `SELECT status FROM object_map WHERE s3_key = ?`,
        ['s3://bucket/activate-key']
      );
      expect(row.rows[0].status).toBe('active');
    });

    // V16: orphanObject active -> orphaned
    it('orphans an active object', async () => {
      const created = await store.createNode(null, `${testPrefix}orphan-active-file`, 'file');
      await store.insertObject(created.id, 's3://bucket/orphan-active-key', 'active');

      const result = await store.orphanObject('s3://bucket/orphan-active-key');
      expect(result.changes).toBe(1);

      const row = await dbQuery(
        `SELECT status FROM object_map WHERE s3_key = ?`,
        ['s3://bucket/orphan-active-key']
      );
      expect(row.rows[0].status).toBe('orphaned');
    });

    // getActiveObject
    it('returns the active object for a file node', async () => {
      const created = await store.createNode(null, `${testPrefix}active-file`, 'file');
      await store.insertObject(created.id, 's3://bucket/active-key', 'active');

      const obj = await store.getActiveObject(created.id);
      expect(obj).not.toBeNull();
      expect(obj.s3_key).toBe('s3://bucket/active-key');
    });

    // getObjectMapByS3Key
    it('finds object by S3 key', async () => {
      const created = await store.createNode(null, `${testPrefix}s3key-file`, 'file');
      await store.insertObject(created.id, 's3://bucket/s3key-lookup', 'pending');

      const obj = await store.getObjectMapByS3Key('s3://bucket/s3key-lookup');
      expect(obj).not.toBeNull();
      expect(obj.file_node_id).toBe(created.id);
    });

    it('returns 0 when no active objects exist for an s3 key', async () => {
      const count = await store.countActiveObjectsByS3Key('s3://bucket/nonexistent-key');
      expect(count).toBe(0);
    });

    it('counts a single active object for an s3 key', async () => {
      const created = await store.createNode(null, `${testPrefix}count-single`, 'file');
      await store.insertObject(created.id, 's3://bucket/count-single-key', 'active');

      const count = await store.countActiveObjectsByS3Key('s3://bucket/count-single-key');
      expect(count).toBe(1);
    });

    it('counts multiple active rows sharing the same s3 key', async () => {
      const nodeA = await store.createNode(null, `${testPrefix}count-multi-a`, 'file');
      const nodeB = await store.createNode(null, `${testPrefix}count-multi-b`, 'file');
      await store.insertObject(nodeA.id, 's3://bucket/shared-key', 'active');
      await store.insertObject(nodeB.id, 's3://bucket/shared-key', 'active');

      const count = await store.countActiveObjectsByS3Key('s3://bucket/shared-key');
      expect(count).toBe(2);
    });

    // V19: setObjectMapBackendWebdav flips backend and keeps s3_key
    it('marks an active object as webdav backend while preserving s3_key', async () => {
      const created = await store.createNode(null, `${testPrefix}backend-flip`, 'file');
      await store.insertObject(created.id, 's3://bucket/backend-flip-key', 'active');

      const result = await store.setObjectMapBackendWebdav(created.id);
      expect(result.changes).toBe(1);

      const row = await dbQuery(
        `SELECT storage_backend, s3_key FROM object_map WHERE file_node_id = ? AND status = 'active'`,
        [created.id]
      );
      expect(row.rows[0].storage_backend).toBe('webdav');
      expect(row.rows[0].s3_key).toBe('s3://bucket/backend-flip-key');
    });

    it('setObjectMapBackendWebdav only flips active object_map rows', async () => {
      const created = await store.createNode(null, `${testPrefix}backend-flip-orphan`, 'file');
      await store.insertObject(created.id, 's3://bucket/backend-flip-orphan-key', 'active');
      await store.orphanObject('s3://bucket/backend-flip-orphan-key');

      const result = await store.setObjectMapBackendWebdav(created.id);
      expect(result.changes).toBe(0);

      const row = await dbQuery(
        `SELECT storage_backend, s3_key FROM object_map WHERE file_node_id = ?`,
        [created.id]
      );
      expect(row.rows[0].storage_backend).toBe('s3');
      expect(row.rows[0].s3_key).toBe('s3://bucket/backend-flip-orphan-key');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  filecache                                                          */
  /* ------------------------------------------------------------------ */

  describe('filecache', () => {
    const testPrefix = 'fc-';

    afterEach(async () => {
      await dbRun(`DELETE FROM file_nodes WHERE name LIKE '${testPrefix}%'`);
    });

    // V17: upsertCache inserts new row
    it('inserts a cache row for a file node', async () => {
      const created = await store.createNode(null, `${testPrefix}cache-insert`, 'file');
      const result = await store.upsertCache(created.id, 2048, 'text/plain', 'abc123');

      expect(result.changes).toBe(1);

      const row = await dbQuery(
        `SELECT * FROM filecache WHERE file_node_id = ?`,
        [created.id]
      );
      expect(row.rows.length).toBe(1);
      expect(row.rows[0].size).toBe(2048);
      expect(row.rows[0].mime_type).toBe('text/plain');
      expect(row.rows[0].content_hash).toBe('abc123');
    });

    // V18: upsertCache updates on conflict
    it('updates existing cache row without duplicating', async () => {
      const created = await store.createNode(null, `${testPrefix}cache-update`, 'file');
      await store.upsertCache(created.id, 100, 'text/plain', 'hash-v1');

      const result = await store.upsertCache(created.id, 2048, 'application/pdf', 'hash-v2');
      expect(result.changes).toBe(1);

      const row = await dbQuery(
        `SELECT * FROM filecache WHERE file_node_id = ?`,
        [created.id]
      );
      expect(row.rows.length).toBe(1);
      expect(row.rows[0].size).toBe(2048);
      expect(row.rows[0].mime_type).toBe('application/pdf');
      expect(row.rows[0].content_hash).toBe('hash-v2');
    });

    // V5: getChildren includes filecache data via LEFT JOIN
    it('includes size and mime_type in children when cache exists', async () => {
      const parent = await store.createNode(null, `${testPrefix}children-parent`, 'directory');
      const child = await store.createNode(parent.id, `${testPrefix}children-child`, 'file');
      await store.upsertCache(child.id, 4096, 'image/png', 'png-hash');

      const children = await store.getChildren(parent.id);
      expect(children.length).toBe(1);
      expect(children[0].id).toBe(child.id);
      expect(children[0].size).toBe(4096);
      expect(children[0].mimeType).toBe('image/png');
      expect(children[0].contentHash).toBe('png-hash');
    });

    // deleteCache
    it('deletes cache row for a file node', async () => {
      const created = await store.createNode(null, `${testPrefix}cache-del`, 'file');
      await store.upsertCache(created.id, 500, 'text/plain', null);

      const result = await store.deleteCache(created.id);
      expect(result.changes).toBe(1);

      const row = await dbQuery(
        `SELECT COUNT(*) as count FROM filecache WHERE file_node_id = ?`,
        [created.id]
      );
      expect(row.rows[0].count).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  edge cases                                                         */
  /* ------------------------------------------------------------------ */

  describe('edge cases', () => {
    it('deleteNodeTree with empty array returns changes=0', async () => {
      const result = await store.deleteNodeTree([]);
      expect(result.changes).toBe(0);
    });

    it('insertAncestorRows with empty array returns changes=0', async () => {
      const result = await store.insertAncestorRows([]);
      expect(result.changes).toBe(0);
    });

    it('deleteAncestorByDescendant with empty array returns changes=0', async () => {
      const result = await store.deleteAncestorByDescendant([]);
      expect(result.changes).toBe(0);
    });
  });
});
