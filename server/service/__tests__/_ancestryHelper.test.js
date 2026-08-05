'use strict';

const { createTestDatabase } = require('../../test-utils');
const storage = require('../../store/storage');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createAncestryHelper } = require('../_ancestryHelper');

describe('createAncestryHelper', () => {
  let dbCleanup;
  let store;
  let helper;
  const createdNodeIds = [];

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    store = createFileNodesStore();
    helper = createAncestryHelper(store);
  });

  afterAll(async () => {
    await dbCleanup();
  });

  afterEach(async () => {
    if (createdNodeIds.length > 0) {
      const placeholders = createdNodeIds.map(() => '?').join(', ');
      await storage.sqliteRun(
        `DELETE FROM node_ancestors WHERE descendant_id IN (${placeholders}) OR ancestor_id IN (${placeholders})`,
        [...createdNodeIds, ...createdNodeIds]
      );
      await storage.sqliteRun(
        `DELETE FROM file_nodes WHERE id IN (${placeholders})`,
        createdNodeIds
      );
      createdNodeIds.length = 0;
    }
  });

  // Create a node and register it for cleanup.
  async function createTrackedNode(parentId, name, type = 'directory') {
    const node = await store.createNode(parentId, name, type);
    createdNodeIds.push(node.id);
    return node;
  }

  // Fetch ancestor rows for a descendant ordered by depth ascending.
  async function ancestorRows(descendantId) {
    const res = await storage.sqliteQuery(
      `SELECT ancestor_id, descendant_id, depth
       FROM node_ancestors
       WHERE descendant_id = ?
       ORDER BY depth`,
      [descendantId]
    );
    return res.rows;
  }

  // Reduce ancestor rows into a { ancestorId: depth } map.
  function chainMap(rows) {
    const map = {};
    for (const row of rows) {
      map[Number(row.ancestor_id)] = Number(row.depth);
    }
    return map;
  }

  /* ------------------------------------------------------------------ */
  /*  buildAncestorsForNode                                              */
  /* ------------------------------------------------------------------ */

  describe('buildAncestorsForNode', () => {
    // T1: root node (parent=null) — only the self-row at depth 0
    it('writes a single self-row for a node with null parent', async () => {
      const node = await createTrackedNode(null, 't1-root', 'file');
      await helper.buildAncestorsForNode(node.id, null);

      const rows = await ancestorRows(node.id);
      expect(rows.length).toBe(1);
      expect(rows[0].ancestor_id).toBe(node.id);
      expect(rows[0].descendant_id).toBe(node.id);
      expect(rows[0].depth).toBe(0);
    });

    // T1 edge: undefined parentId behaves like null
    it('writes a single self-row for a node with undefined parent', async () => {
      const node = await createTrackedNode(null, 't1-undefined-parent', 'file');
      await helper.buildAncestorsForNode(node.id, undefined);

      const rows = await ancestorRows(node.id);
      expect(rows.length).toBe(1);
      expect(rows[0].ancestor_id).toBe(node.id);
      expect(rows[0].depth).toBe(0);
    });

    // T2: node at depth 1 — self + parent rows
    it('writes self-row plus the parent chain at depth 1', async () => {
      const root = await createTrackedNode(null, 't2-depth1-root');
      const child = await createTrackedNode(root.id, 't2-depth1-child', 'file');
      await helper.buildAncestorsForNode(root.id, null);
      await helper.buildAncestorsForNode(child.id, root.id);

      const rows = await ancestorRows(child.id);
      expect(rows.length).toBe(2);
      expect(rows[0].ancestor_id).toBe(child.id);
      expect(rows[0].depth).toBe(0);
      expect(rows[1].ancestor_id).toBe(root.id);
      expect(rows[1].depth).toBe(1);
    });

    // T2: node at depth N — depths match the parent chain + 1
    it('writes correct depths at depth N against the parent chain', async () => {
      const root = await createTrackedNode(null, 't2-depthN-root');
      const mid = await createTrackedNode(root.id, 't2-depthN-mid');
      const leaf = await createTrackedNode(mid.id, 't2-depthN-leaf', 'file');
      await helper.buildAncestorsForNode(root.id, null);
      await helper.buildAncestorsForNode(mid.id, root.id);
      await helper.buildAncestorsForNode(leaf.id, mid.id);

      // Every ancestor of the parent must appear for the leaf with depth + 1.
      const parentChain = await store.getAncestorChain(mid.id);
      const leafRows = await ancestorRows(leaf.id);
      expect(leafRows.length).toBe(parentChain.length + 1);

      const leafMap = chainMap(leafRows);
      expect(leafMap[leaf.id]).toBe(0);
      for (const entry of parentChain) {
        expect(leafMap[entry.ancestorId]).toBe(entry.depth + 1);
      }
    });

    // T6 edge: parent exists but has no ancestor rows yet — parent chain is
    // treated as empty, so only a self-row is written (implementation does not throw)
    it('writes only a self-row when the parent chain is empty', async () => {
      const root = await createTrackedNode(null, 't6-no-chain-root');
      const child = await createTrackedNode(root.id, 't6-no-chain-child', 'file');

      await helper.buildAncestorsForNode(child.id, root.id);

      const rows = await ancestorRows(child.id);
      expect(rows.length).toBe(1);
      expect(rows[0].ancestor_id).toBe(child.id);
      expect(rows[0].depth).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  rebuildAncestorsAfterMove                                          */
  /* ------------------------------------------------------------------ */

  describe('rebuildAncestorsAfterMove', () => {
    // T3: move a subtree to a new parent — full closure set recomputed
    it('recomputes the full closure set for the moved subtree', async () => {
      const oldParent = await createTrackedNode(null, 't3-old-parent');
      const newParent = await createTrackedNode(null, 't3-new-parent');
      const branch = await createTrackedNode(oldParent.id, 't3-branch');
      const leaf = await createTrackedNode(branch.id, 't3-leaf', 'file');

      await helper.buildAncestorsForNode(oldParent.id, null);
      await helper.buildAncestorsForNode(newParent.id, null);
      await helper.buildAncestorsForNode(branch.id, oldParent.id);
      await helper.buildAncestorsForNode(leaf.id, branch.id);

      // Move the branch (and therefore the leaf) under the new parent.
      await store.moveNode(branch.id, newParent.id);
      await helper.rebuildAncestorsAfterMove(branch.id, newParent.id);

      // Both moved nodes are still reported as descendants of the branch.
      const descendants = await store.getDescendantIds(branch.id);
      expect(descendants).toEqual(expect.arrayContaining([branch.id, leaf.id]));

      // The full closure set for the moved subtree is exact.
      const res = await storage.sqliteQuery(
        `SELECT ancestor_id, descendant_id, depth
         FROM node_ancestors
         WHERE descendant_id IN (?, ?)
         ORDER BY descendant_id, depth`,
        [branch.id, leaf.id]
      );
      const rows = res.rows.map((r) => ({
        ancestorId: Number(r.ancestor_id),
        descendantId: Number(r.descendant_id),
        depth: Number(r.depth),
      }));
      expect(rows).toEqual([
        { ancestorId: branch.id, descendantId: branch.id, depth: 0 },
        { ancestorId: newParent.id, descendantId: branch.id, depth: 1 },
        { ancestorId: leaf.id, descendantId: leaf.id, depth: 0 },
        { ancestorId: branch.id, descendantId: leaf.id, depth: 1 },
        { ancestorId: newParent.id, descendantId: leaf.id, depth: 2 },
      ]);

      // Old ancestor chain is fully removed for every moved descendant.
      for (const id of [branch.id, leaf.id]) {
        const oldRows = await storage.sqliteQuery(
          `SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ? AND ancestor_id = ?`,
          [id, oldParent.id]
        );
        expect(oldRows.rows[0].cnt).toBe(0);
      }

      // The old parent no longer lists the moved subtree as descendants.
      const oldParentDescendants = await store.getDescendantIds(oldParent.id);
      expect(oldParentDescendants).toEqual([oldParent.id]);
    });

    // T4: move a subtree to root (parent=null) — only self-rows remain
    it('keeps only self-rows after moving to root', async () => {
      const oldParent = await createTrackedNode(null, 't4-old-parent');
      const branch = await createTrackedNode(oldParent.id, 't4-branch');
      const leaf = await createTrackedNode(branch.id, 't4-leaf', 'file');

      await helper.buildAncestorsForNode(oldParent.id, null);
      await helper.buildAncestorsForNode(branch.id, oldParent.id);
      await helper.buildAncestorsForNode(leaf.id, branch.id);

      await store.moveNode(branch.id, null);
      await helper.rebuildAncestorsAfterMove(branch.id, null);

      // The moved node itself becomes root-level: only a self-row.
      const branchRows = await ancestorRows(branch.id);
      expect(branchRows.length).toBe(1);
      expect(branchRows[0].ancestor_id).toBe(branch.id);
      expect(branchRows[0].depth).toBe(0);

      // Its descendants still reference the moved node (now at depth 1).
      const leafRows = await ancestorRows(leaf.id);
      expect(leafRows.length).toBe(2);
      expect(leafRows[0].ancestor_id).toBe(leaf.id);
      expect(leafRows[0].depth).toBe(0);
      expect(leafRows[1].ancestor_id).toBe(branch.id);
      expect(leafRows[1].depth).toBe(1);
      expect(leafRows.some((r) => r.ancestor_id === oldParent.id)).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  cleanupAncestorsForDeletion                                        */
  /* ------------------------------------------------------------------ */

  describe('cleanupAncestorsForDeletion', () => {
    // T5: removes ancestor rows for the given descendant ids
    it('removes ancestor rows for the given node ids', async () => {
      const root = await createTrackedNode(null, 't5-cleanup-root');
      const child = await createTrackedNode(root.id, 't5-cleanup-child', 'file');
      await helper.buildAncestorsForNode(root.id, null);
      await helper.buildAncestorsForNode(child.id, root.id);

      const descendants = await store.getDescendantIds(root.id);
      expect(descendants).toEqual(expect.arrayContaining([root.id, child.id]));

      await helper.cleanupAncestorsForDeletion(descendants);

      for (const id of descendants) {
        const rows = await storage.sqliteQuery(
          `SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ?`,
          [id]
        );
        expect(rows.rows[0].cnt).toBe(0);
      }
    });

    // T5: delete a node tree, then clean up the stale rows for the deleted ids
    it('cleans rows for nodes already removed via deleteNodeTree', async () => {
      const root = await createTrackedNode(null, 't5-deleted-root');
      const child = await createTrackedNode(root.id, 't5-deleted-child', 'file');
      await helper.buildAncestorsForNode(root.id, null);
      await helper.buildAncestorsForNode(child.id, root.id);

      const descendants = await store.getDescendantIds(root.id);
      await store.deleteNodeTree(descendants);
      createdNodeIds.splice(createdNodeIds.indexOf(root.id), 1);
      createdNodeIds.splice(createdNodeIds.indexOf(child.id), 1);

      // Safety-net cleanup must not throw even though rows already cascade-deleted.
      await expect(
        helper.cleanupAncestorsForDeletion(descendants)
      ).resolves.toBeUndefined();
    });

    // T5 edge: empty array / empty value guards do not throw
    it('does not throw for an empty or null node id list', async () => {
      await expect(helper.cleanupAncestorsForDeletion([])).resolves.toBeUndefined();
      await expect(helper.cleanupAncestorsForDeletion(null)).resolves.toBeUndefined();
      await expect(helper.cleanupAncestorsForDeletion(undefined)).resolves.toBeUndefined();
    });
  });
});
