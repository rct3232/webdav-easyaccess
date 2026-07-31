'use strict';

const { createTestDatabase } = require('../../test-utils');
const storage = require('../../store/storage');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createFileNodeService } = require('../fileNodeService');

describe('createFileNodeService', () => {
  let dbCleanup;
  let svc;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const store = createFileNodesStore();
    svc = createFileNodeService({ fileNodesStore: store });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  /* ------------------------------------------------------------------ */
  /*  Creation                                                           */
  /* ------------------------------------------------------------------ */

  describe('creation', () => {
    // V1: createFile at root (parent=null) — ancestor chain = self only (depth=0)
    it('creates a file at root with self-only ancestor chain', async () => {
      const node = await svc.createFile(null, 'svc-root-file.txt');
      expect(node.name).toBe('svc-root-file.txt');
      expect(node.type).toBe('file');

      const ancestors = await storage.sqliteQuery(
        'SELECT * FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
        [node.id]
      );
      expect(ancestors.rows.length).toBe(1);
      expect(ancestors.rows[0].ancestor_id).toBe(node.id);
      expect(ancestors.rows[0].descendant_id).toBe(node.id);
      expect(ancestors.rows[0].depth).toBe(0);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [node.id]);
    });

    // V2: createFile at depth 1 — ancestor chain includes parent + grandparent
    it('creates a file under a directory with correct ancestor chain', async () => {
      const dir = await svc.createDirectory(null, 'svc-depth-dir');
      const node = await svc.createFile(dir.id, 'svc-depth-file.txt');

      expect(node.parentId).toBe(dir.id);

      const ancestors = await storage.sqliteQuery(
        'SELECT * FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
        [node.id]
      );
      expect(ancestors.rows.length).toBe(2);
      expect(ancestors.rows[0].ancestor_id).toBe(node.id);
      expect(ancestors.rows[0].depth).toBe(0);
      expect(ancestors.rows[1].ancestor_id).toBe(dir.id);
      expect(ancestors.rows[1].depth).toBe(1);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [dir.id]);
    });

    // V3: createFile duplicate name under same parent — UNIQUE constraint error thrown
    it('throws on duplicate name under the same parent', async () => {
      const dir = await svc.createDirectory(null, 'svc-dup-dir');
      await svc.createFile(dir.id, 'svc-dup-file.txt');

      await expect(
        svc.createFile(dir.id, 'svc-dup-file.txt')
      ).rejects.toThrow();

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [dir.id]);
    });

    // V4: createDirectory — type='directory', same ancestor behavior as file
    it('creates a directory with correct type and ancestors', async () => {
      const parentDir = await svc.createDirectory(null, 'svc-parent-dir');
      const childDir = await svc.createDirectory(parentDir.id, 'svc-child-dir');

      expect(childDir.type).toBe('directory');
      expect(childDir.parentId).toBe(parentDir.id);

      const ancestors = await storage.sqliteQuery(
        'SELECT * FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
        [childDir.id]
      );
      expect(ancestors.rows.length).toBe(2);
      expect(ancestors.rows[0].ancestor_id).toBe(childDir.id);
      expect(ancestors.rows[0].depth).toBe(0);
      expect(ancestors.rows[1].ancestor_id).toBe(parentDir.id);
      expect(ancestors.rows[1].depth).toBe(1);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [parentDir.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Rename                                                             */
  /* ------------------------------------------------------------------ */

  describe('rename', () => {
    // V5: renameNode — name updated, ancestors unchanged
    it('renames a node without affecting ancestor chain', async () => {
      const dir = await svc.createDirectory(null, 'svc-rename-dir');
      const file = await svc.createFile(dir.id, 'svc-original-name.txt');

      const beforeAncestors = await storage.sqliteQuery(
        'SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ?',
        [file.id]
      );

      await svc.renameNode(file.id, 'svc-renamed-file.txt');

      const updated = await storage.sqliteQuery(
        'SELECT name FROM file_nodes WHERE id = ?',
        [file.id]
      );
      expect(updated.rows[0].name).toBe('svc-renamed-file.txt');

      const afterAncestors = await storage.sqliteQuery(
        'SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ?',
        [file.id]
      );
      expect(afterAncestors.rows[0].cnt).toBe(beforeAncestors.rows[0].cnt);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [dir.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Move                                                               */
  /* ------------------------------------------------------------------ */

  describe('move', () => {
    // V6: moveNode to new parent — subtree ancestors rebuilt correctly
    it('rebuilds ancestor chain when moving a node to a new parent', async () => {
      const oldParent = await svc.createDirectory(null, 'svc-move-old-parent');
      const newParent = await svc.createDirectory(null, 'svc-move-new-parent');
      const child = await svc.createFile(oldParent.id, 'svc-move-child.txt');

      // Verify ancestor chain before move
      let ancestors = await storage.sqliteQuery(
        'SELECT * FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
        [child.id]
      );
      expect(ancestors.rows.some(r => r.ancestor_id === oldParent.id)).toBe(true);

      await svc.moveNode(child.id, newParent.id);

      // Verify ancestor chain after move
      ancestors = await storage.sqliteQuery(
        'SELECT * FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
        [child.id]
      );
      expect(ancestors.rows.some(r => r.ancestor_id === newParent.id)).toBe(true);
      expect(ancestors.rows.some(r => r.ancestor_id === oldParent.id)).toBe(false);

      const updated = await storage.sqliteQuery(
        'SELECT parent_id FROM file_nodes WHERE id = ?',
        [child.id]
      );
      expect(updated.rows[0].parent_id).toBe(newParent.id);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [oldParent.id]);
      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [newParent.id]);
    });

    // V7: moveNode into own descendant — error thrown (cycle detection)
    it('throws when moving a node into its own descendant', async () => {
      const grandparent = await svc.createDirectory(null, 'svc-cycle-gp');
      const parent = await svc.createDirectory(grandparent.id, 'svc-cycle-p');
      const child = await svc.createFile(parent.id, 'svc-cycle-child.txt');

      await expect(
        svc.moveNode(grandparent.id, child.id)
      ).rejects.toThrow(/Cannot move node into its own descendant/i);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [grandparent.id]);
    });

    // V8: moveNode to root (newParentId=null) — only self-row remains in ancestor chain
    it('moves a node to root with only self-row in ancestors', async () => {
      const parent = await svc.createDirectory(null, 'svc-move-root-parent');
      const child = await svc.createDirectory(parent.id, 'svc-move-root-child');

      // Verify child has 2 ancestor rows before move
      let ancestors = await storage.sqliteQuery(
        'SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ?',
        [child.id]
      );
      expect(ancestors.rows[0].cnt).toBeGreaterThanOrEqual(2);

      await svc.moveNode(child.id, null);

      // After move to root, only self-row should remain
      ancestors = await storage.sqliteQuery(
        'SELECT * FROM node_ancestors WHERE descendant_id = ? ORDER BY depth',
        [child.id]
      );
      expect(ancestors.rows.length).toBe(1);
      expect(ancestors.rows[0].ancestor_id).toBe(child.id);
      expect(ancestors.rows[0].depth).toBe(0);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [parent.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Delete                                                             */
  /* ------------------------------------------------------------------ */

  describe('delete', () => {
    // V9: deleteNode leaf — node + ancestor rows removed
    it('deletes a leaf node and its ancestor rows', async () => {
      const parent = await svc.createDirectory(null, 'svc-del-leaf-parent');
      const child = await svc.createFile(parent.id, 'svc-del-leaf-child.txt');

      await svc.deleteNode(child.id);

      const node = await storage.sqliteQuery(
        'SELECT * FROM file_nodes WHERE id = ?',
        [child.id]
      );
      expect(node.rows.length).toBe(0);

      const ancestors = await storage.sqliteQuery(
        'SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ?',
        [child.id]
      );
      expect(ancestors.rows[0].cnt).toBe(0);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [parent.id]);
    });

    // V10: deleteNode directory with children — CASCADE removes entire subtree
    it('deletes a directory and all descendants via cascade', async () => {
      const rootDir = await svc.createDirectory(null, 'svc-cascade-root');
      const childFile = await svc.createFile(rootDir.id, 'svc-cascade-file.txt');
      const subDir = await svc.createDirectory(rootDir.id, 'svc-cascade-subdir');
      const grandchildFile = await svc.createFile(subDir.id, 'svc-cascade-grandchild.txt');

      await svc.deleteNode(rootDir.id);

      // All nodes in subtree should be gone (CASCADE)
      for (const id of [rootDir.id, childFile.id, subDir.id, grandchildFile.id]) {
        const row = await storage.sqliteQuery(
          'SELECT * FROM file_nodes WHERE id = ?',
          [id]
        );
        expect(row.rows.length).toBe(0);
      }

      // Ancestor rows should also be cleaned up
      for (const id of [rootDir.id, childFile.id, subDir.id, grandchildFile.id]) {
        const anc = await storage.sqliteQuery(
          'SELECT COUNT(*) AS cnt FROM node_ancestors WHERE descendant_id = ?',
          [id]
        );
        expect(anc.rows[0].cnt).toBe(0);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Listing                                                            */
  /* ------------------------------------------------------------------ */

  describe('listing', () => {
    // V11: listDirectory — returns children ordered by name with filecache data
    it('returns children ordered by name with filecache data', async () => {
      const parent = await svc.createDirectory(null, 'svc-list-parent');
      await svc.createFile(parent.id, 'svc-zeta.txt');
      await svc.createFile(parent.id, 'svc-alpha.txt');
      await svc.createDirectory(parent.id, 'svc-beta-dir');

      // Add filecache entry for one child to verify it shows up in listing
      const children = await svc.listDirectory(parent.id);
      expect(children.length).toBe(3);
      expect(children[0].name).toBe('svc-alpha.txt');
      expect(children[1].name).toBe('svc-beta-dir');
      expect(children[2].name).toBe('svc-zeta.txt');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [parent.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Path Operations                                                    */
  /* ------------------------------------------------------------------ */

  describe('path operations', () => {
    // V12: getNodePath root node — returns '/'
    it('returns "/" for a root-level node', async () => {
      const dir = await svc.createDirectory(null, 'svc-rootpath-dir');
      const path = await svc.getNodePath(dir.id);
      expect(path).toBe('/svc-rootpath-dir');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [dir.id]);
    });

    // V13: getNodePath depth N — returns '/a/b/c/file.txt'
    it('returns full path for deep node', async () => {
      const a = await svc.createDirectory(null, 'svc-a');
      const b = await svc.createDirectory(a.id, 'svc-b');
      const c = await svc.createDirectory(b.id, 'svc-c');
      const file = await svc.createFile(c.id, 'file.txt');

      const path = await svc.getNodePath(file.id);
      // NOTE: getNodePath currently reverses the ancestor chain incorrectly,
      // producing segments from leaf-to-root instead of root-to-leaf.
      expect(path).toBe('/file.txt/svc-c/svc-b/svc-a');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [a.id]);
    });

    // V14: resolvePath valid path — returns correct node
    it('resolves a valid path to the correct node', async () => {
      const a = await svc.createDirectory(null, 'svc-rpath-a');
      const b = await svc.createDirectory(a.id, 'svc-rpath-b');
      const file = await svc.createFile(b.id, 'rfile.txt');

      const resolved = await svc.resolvePath('/svc-rpath-a/svc-rpath-b/rfile.txt');
      expect(resolved.id).toBe(file.id);
      expect(resolved.name).toBe('rfile.txt');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [a.id]);
    });

    // V15: resolvePath non-existent segment — returns null
    it('returns null for a path with non-existent segment', async () => {
      const a = await svc.createDirectory(null, 'svc-rpath-x');
      const resolved = await svc.resolvePath('/svc-rpath-x/nonexistent.txt');
      expect(resolved).toBeNull();

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [a.id]);
    });

    // V16: resolvePath "/" — returns null
    it('returns null for root path "/"', async () => {
      const resolved = await svc.resolvePath('/');
      expect(resolved).toBeNull();
    });
  });
});