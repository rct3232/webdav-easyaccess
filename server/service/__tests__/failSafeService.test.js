'use strict';

const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createFileNodeService } = require('../fileNodeService');
const { createFailSafeService } = require('../failSafeService');

describe('createFailSafeService', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let failSafeService;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
    failSafeService = createFailSafeService({ fileNodeService, fileNodesStore });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  async function createOrphanedNode({ name, parentId = null, type = 'file' }) {
    const node =
      type === 'directory'
        ? await fileNodeService.createDirectory(parentId, name)
        : await fileNodeService.createFile(parentId, name);
    await fileNodeService.updateSyncStatus(node.id, 'orphaned_node');
    return node;
  }

  /* ------------------------------------------------------------------ */
  /*  scanOrphanedNodes                                                  */
  /* ------------------------------------------------------------------ */

  describe('scanOrphanedNodes', () => {
    it('returns orphaned nodes enriched with their display path', async () => {
      const node = await createOrphanedNode({ name: `fs-scan-${Date.now()}` });

      const orphans = await failSafeService.scanOrphanedNodes();

      const found = orphans.find((o) => o.nodeId === node.id);
      expect(found).toBeDefined();
      expect(found.name).toBe(node.name);
      expect(found.type).toBe('file');
      expect(found.path).toBe(`/${node.name}`);
    });

    it('ignores nodes that are not orphaned', async () => {
      const active = await fileNodesStore.createNode(null, `fs-active-${Date.now()}`, 'file');
      await fileNodeService.updateSyncStatus(active.id, 'active');

      const orphans = await failSafeService.scanOrphanedNodes();

      expect(orphans.find((o) => o.nodeId === active.id)).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  repairNode                                                         */
  /* ------------------------------------------------------------------ */

  describe('repairNode', () => {
    it('force-active flips sync_status to active', async () => {
      const node = await createOrphanedNode({ name: `fs-force-${Date.now()}` });

      const result = await failSafeService.repairNode(node.id, { action: 'force-active' });

      expect(result.status).toBe('resolved');
      expect(result.action).toBe('force-active');

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('active');
    });

    it('retry-delete removes the node and its subtree from the DB', async () => {
      const rootDir = await createOrphanedNode({
        name: `fs-del-root-${Date.now()}`,
        type: 'directory',
      });
      const childDir = await fileNodesStore.createNode(
        rootDir.id,
        `fs-del-child-${Date.now()}`,
        'directory'
      );
      const childFile = await fileNodesStore.createNode(
        childDir.id,
        `fs-del-file-${Date.now()}`,
        'file'
      );

      const result = await failSafeService.repairNode(rootDir.id, { action: 'retry-delete' });

      expect(result.status).toBe('resolved');
      expect(result.action).toBe('retry-delete');
      expect(await fileNodeService.getNode(rootDir.id)).toBeNull();
      expect(await fileNodeService.getNode(childDir.id)).toBeNull();
      expect(await fileNodeService.getNode(childFile.id)).toBeNull();
    });

    it('rejects an invalid action with a 400 validation error', async () => {
      const node = await createOrphanedNode({ name: `fs-bad-${Date.now()}` });

      await expect(
        failSafeService.repairNode(node.id, { action: 'delete-now' })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns 404 for a missing node', async () => {
      await expect(
        failSafeService.repairNode(999999, { action: 'force-active' })
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  runStartupRecovery                                                 */
  /* ------------------------------------------------------------------ */

  describe('runStartupRecovery', () => {
    it('reports orphaned nodes for manual review without deleting them', async () => {
      const node = await createOrphanedNode({ name: `fs-startup-${Date.now()}` });

      const report = await failSafeService.runStartupRecovery();

      expect(report.scanned).toBeGreaterThanOrEqual(1);
      expect(report.resolved).toBe(0);
      expect(report.manualReview.some((n) => n.nodeId === node.id)).toBe(true);

      const after = await fileNodeService.getNode(node.id);
      expect(after).not.toBeNull();
      expect(after.syncStatus).toBe('orphaned_node');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  runStartupRecovery (empty DB)                                      */
  /* ------------------------------------------------------------------ */

  describe('runStartupRecovery (fresh DB)', () => {
    let emptyDbCleanup;
    let emptyService;

    beforeAll(async () => {
      const db = await createTestDatabase();
      emptyDbCleanup = db.cleanup;
      const store = createFileNodesStore();
      const nodeService = createFileNodeService({ fileNodesStore: store });
      emptyService = createFailSafeService({ fileNodeService: nodeService, fileNodesStore: store });
    });

    afterAll(async () => {
      await emptyDbCleanup();
    });

    it('returns an empty report when no orphaned nodes exist', async () => {
      const report = await emptyService.runStartupRecovery();

      expect(report.scanned).toBe(0);
      expect(report.resolved).toBe(0);
      expect(report.manualReview).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  DB integrity                                                       */
  /* ------------------------------------------------------------------ */

  describe('store-level queries', () => {
    it('getNodesBySyncStatus returns only rows matching the status', async () => {
      const orphaned = await createOrphanedNode({ name: `store-orphan-${Date.now()}` });
      const active = await fileNodesStore.createNode(null, `store-active-${Date.now()}`, 'file');
      await fileNodeService.updateSyncStatus(active.id, 'active');

      const orphanedRows = await fileNodesStore.getNodesBySyncStatus('orphaned_node');
      const activeRows = await fileNodesStore.getNodesBySyncStatus('active');

      expect(orphanedRows.some((r) => r.id === orphaned.id)).toBe(true);
      expect(orphanedRows.some((r) => r.id === active.id)).toBe(false);
      expect(activeRows.some((r) => r.id === active.id)).toBe(true);
    });

    it('getAllActiveS3Keys returns only active s3_keys', async () => {
      const node = await fileNodesStore.createNode(null, `keys-node-${Date.now()}`, 'file');
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, 'active')`,
        [node.id, `keys-active-${Date.now()}`]
      );
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 2, 'orphaned')`,
        [node.id, `keys-orphan-${Date.now()}`]
      );

      const keys = await fileNodesStore.getAllActiveS3Keys();
      expect(keys.some((k) => k.includes('keys-active'))).toBe(true);
      expect(keys.some((k) => k.includes('keys-orphan'))).toBe(false);
    });

    it('deleteObjectMapRows removes only the given rows', async () => {
      const node = await fileNodesStore.createNode(null, `del-node-${Date.now()}`, 'file');
      const rowA = await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, 'orphaned')`,
        [node.id, `del-a-${Date.now()}`]
      );
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 2, 'orphaned')`,
        [node.id, `del-b-${Date.now()}`]
      );

      const res = await fileNodesStore.deleteObjectMapRows([rowA.lastID]);

      expect(res.changes).toBe(1);
      const remaining = await dbQuery('SELECT s3_key FROM object_map WHERE file_node_id = ?', [
        node.id,
      ]);
      expect(remaining.rows).toHaveLength(1);
      expect(remaining.rows[0].s3_key).toContain('del-b');
    });
  });
});
