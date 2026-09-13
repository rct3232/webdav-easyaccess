'use strict';

const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createFileNodeService } = require('../fileNodeService');
const { createFailSafeService } = require('../failSafeService');
const { createFakeBlobStore } = require('@testing/mocks/fakeBlobStore');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

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

describe('createFailSafeService — pending_upload scan + repair (DEF-12/13 S2)', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStore;
  let failSafeService;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createFakeBlobStore();
    failSafeService = createFailSafeService({
      fileNodeService,
      fileNodesStore,
      blobStore,
      fileStorageMode: 's3',
    });
    seq += 1;
  });

  const unique = (prefix) => `${prefix}-${Date.now()}-${seq}`;

  /**
   * Seed a file node holding an active version (v1) whose overwrite TX1
   * committed but never finalized: node pending_upload, v1 history
   * (DEF-11 history demotion), v2 pending, both blobs present.
   */
  async function seedOverwriteStuck() {
    const name = unique('pu-overwrite');
    const node = await fileNodeService.createFile(null, name);
    const keyV1 = unique('pu-overwrite-v1');
    const keyV2 = unique('pu-overwrite-v2');

    await fileNodesStore.upsertObjectMap(node.id, keyV1, 'pending');
    await fileNodesStore.activateObject(keyV1);
    await fileNodesStore.upsertCache(node.id, 10, 'text/plain', null);
    await fileNodeService.updateSyncStatus(node.id, 'active');
    await blobStore.uploadBlob(keyV1, Buffer.from('v1-content'));

    await blobStore.uploadBlob(keyV2, Buffer.from('v2-content'));
    await fileNodesStore.upsertObjectMap(node.id, keyV2, 'pending');
    await fileNodeService.updateSyncStatus(node.id, 'pending_upload');

    return { node, name, keyV1, keyV2 };
  }

  /** Seed a crashed new-file upload: node pending_upload + pending row (+ blob). */
  async function seedNewFileStuck({ withBlob = true, withRow = true } = {}) {
    const name = unique('pu-newfile');
    const node = await fileNodeService.createFile(null, name);
    let key = null;
    if (withRow) {
      key = unique('pu-newfile-key');
      await fileNodesStore.upsertObjectMap(node.id, key, 'pending');
      if (withBlob) {
        await blobStore.uploadBlob(key, Buffer.from('abc'));
      }
    }
    return { node, name, key };
  }

  async function objectMapRows(nodeId) {
    const { rows } = await dbQuery('SELECT * FROM object_map WHERE file_node_id = ?', [nodeId]);
    return rows;
  }

  describe('scanPendingUploadNodes', () => {
    it('classifies overwrite residue (history last-good + pending row) as overwrite', async () => {
      const { node, keyV2 } = await seedOverwriteStuck();

      const found = (await failSafeService.scanPendingUploadNodes()).find(
        (n) => n.nodeId === node.id
      );

      expect(found).toBeDefined();
      expect(found.type).toBe('file');
      expect(found.classification).toBe('overwrite');
      expect(found.pendingS3Key).toBe(keyV2);
      expect(found.blobPresent).toBe(true);
      expect(found.path).toBe(`/${node.name}`);
    });

    it('classifies legacy orphaned overwrite residue as overwrite (DEF-11 pre-migration rows)', async () => {
      const name = unique('pu-overwrite-legacy');
      const node = await fileNodeService.createFile(null, name);
      const keyV1 = unique('pu-overwrite-legacy-v1');
      const keyV2 = unique('pu-overwrite-legacy-v2');

      await fileNodesStore.insertObject(node.id, keyV1, 'orphaned');
      await blobStore.uploadBlob(keyV2, Buffer.from('v2-content'));
      await fileNodesStore.upsertObjectMap(node.id, keyV2, 'pending');
      await fileNodeService.updateSyncStatus(node.id, 'pending_upload');

      const found = (await failSafeService.scanPendingUploadNodes()).find(
        (n) => n.nodeId === node.id
      );
      expect(found).toBeDefined();
      expect(found.classification).toBe('overwrite');
    });

    it('classifies new-file residue with blob as new-file', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: true });

      const found = (await failSafeService.scanPendingUploadNodes()).find(
        (n) => n.nodeId === node.id
      );

      expect(found).toBeDefined();
      expect(found.classification).toBe('new-file');
      expect(found.pendingS3Key).toBe(key);
      expect(found.blobPresent).toBe(true);
    });

    it('classifies new-file residue without blob as new-file with blobPresent false', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: false });

      const found = (await failSafeService.scanPendingUploadNodes()).find(
        (n) => n.nodeId === node.id
      );

      expect(found.classification).toBe('new-file');
      expect(found.pendingS3Key).toBe(key);
      expect(found.blobPresent).toBe(false);
    });

    it('reports no pending key/blob for a stuck node without object_map rows', async () => {
      const { node } = await seedNewFileStuck({ withRow: false });

      const found = (await failSafeService.scanPendingUploadNodes()).find(
        (n) => n.nodeId === node.id
      );

      expect(found.classification).toBe('new-file');
      expect(found.pendingS3Key).toBeNull();
      expect(found.blobPresent).toBeNull();
    });

    it('ignores directories and active files', async () => {
      const dir = await fileNodeService.createDirectory(null, unique('pu-dir'));
      const activeName = unique('pu-active');
      const activeNode = await fileNodeService.createFile(null, activeName);
      const key = unique('pu-active-key');
      await fileNodesStore.upsertObjectMap(activeNode.id, key, 'pending');
      await fileNodesStore.activateObject(key);
      await fileNodeService.updateSyncStatus(activeNode.id, 'active');

      const scanned = await failSafeService.scanPendingUploadNodes();

      expect(scanned.find((n) => n.nodeId === dir.id)).toBeUndefined();
      expect(scanned.find((n) => n.nodeId === activeNode.id)).toBeUndefined();
    });
  });

  describe('repairPendingUploadNode — complete', () => {
    it('activates the pending row and populates filecache from blob metadata', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: true });

      const result = await failSafeService.repairPendingUploadNode(node.id, { action: 'complete' });

      expect(result).toMatchObject({ nodeId: node.id, action: 'complete', status: 'resolved' });

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('active');
      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).toBe(key);
      const cache = await fileNodesStore.getCache(node.id);
      expect(Number(cache.size)).toBe(3);
      expect(await blobStore.headBlob(key)).not.toBeNull();
    });

    it('refuses with 409 when the blob is absent and mutates nothing', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: false });

      await expect(
        failSafeService.repairPendingUploadNode(node.id, { action: 'complete' })
      ).rejects.toMatchObject({
        status: 409,
        errorCode: SERVER_ERROR_CODES.admin.repairUploadBlobMissing,
      });

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('pending_upload');
      const rows = await objectMapRows(node.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].s3_key).toBe(key);
    });

    it('refuses with 409 when there is no pending row', async () => {
      const { node } = await seedNewFileStuck({ withRow: false });

      await expect(
        failSafeService.repairPendingUploadNode(node.id, { action: 'complete' })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('repairPendingUploadNode — restore-previous', () => {
    it('reactivates the last-good row, deletes the pending row/blob, keeps the last-good blob', async () => {
      const { node, keyV1, keyV2 } = await seedOverwriteStuck();

      const result = await failSafeService.repairPendingUploadNode(node.id, {
        action: 'restore-previous',
      });

      expect(result).toMatchObject({
        nodeId: node.id,
        action: 'restore-previous',
        status: 'resolved',
      });

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('active');
      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).toBe(keyV1);
      const rows = await objectMapRows(node.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].s3_key).toBe(keyV1);
      expect(await blobStore.headBlob(keyV1)).not.toBeNull();
      expect(await blobStore.headBlob(keyV2)).toBeNull();
      const cache = await fileNodesStore.getCache(node.id);
      expect(Number(cache.size)).toBe(10);
    });

    it('refuses with 409 when no orphaned last-good row exists', async () => {
      const { node } = await seedNewFileStuck({ withBlob: true });

      await expect(
        failSafeService.repairPendingUploadNode(node.id, { action: 'restore-previous' })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('repairPendingUploadNode — delete', () => {
    it('removes the node tree, its object_map rows, and the pending blob', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: true });

      const result = await failSafeService.repairPendingUploadNode(node.id, { action: 'delete' });

      expect(result).toMatchObject({ nodeId: node.id, action: 'delete', status: 'resolved' });
      expect(await fileNodeService.getNode(node.id)).toBeNull();
      expect(await objectMapRows(node.id)).toHaveLength(0);
      expect(await blobStore.headBlob(key)).toBeNull();
    });

    it('keeps the last-good blob for GC when deleting overwrite residue', async () => {
      const { node, keyV1, keyV2 } = await seedOverwriteStuck();

      await failSafeService.repairPendingUploadNode(node.id, { action: 'delete' });

      expect(await fileNodeService.getNode(node.id)).toBeNull();
      expect(await objectMapRows(node.id)).toHaveLength(0);
      expect(await blobStore.headBlob(keyV2)).toBeNull();
      expect(await blobStore.headBlob(keyV1)).not.toBeNull();
    });
  });

  describe('repairPendingUploadNode — auto (D2 policy)', () => {
    it('routes overwrite residue to restore-previous', async () => {
      const { node, keyV1, keyV2 } = await seedOverwriteStuck();

      await failSafeService.repairPendingUploadNode(node.id, { action: 'auto' });

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('active');
      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).toBe(keyV1);
      expect(await blobStore.headBlob(keyV2)).toBeNull();
    });

    it('routes new-file residue with blob to complete', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: true });

      await failSafeService.repairPendingUploadNode(node.id, { action: 'auto' });

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('active');
      const active = await fileNodesStore.getActiveObject(node.id);
      expect(active.s3_key).toBe(key);
      expect(Number((await fileNodesStore.getCache(node.id)).size)).toBe(3);
    });

    it('routes new-file residue without blob to delete', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: false });

      await failSafeService.repairPendingUploadNode(node.id, { action: 'auto' });

      expect(await fileNodeService.getNode(node.id)).toBeNull();
      expect(await objectMapRows(node.id)).toHaveLength(0);
      expect(await blobStore.headBlob(key)).toBeNull();
    });

    it('propagates blob probe errors and mutates nothing', async () => {
      const { node, key } = await seedNewFileStuck({ withBlob: true });
      blobStore.failOn(key);

      await expect(
        failSafeService.repairPendingUploadNode(node.id, { action: 'auto' })
      ).rejects.toThrow(/injected failure/);

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('pending_upload');
      const rows = await objectMapRows(node.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      blobStore.clearFailures();
      expect(await blobStore.headBlob(key)).not.toBeNull();
    });
  });

  describe('repairPendingUploadNode — validation', () => {
    it('rejects an invalid action with 400', async () => {
      const { node } = await seedNewFileStuck({});
      await expect(
        failSafeService.repairPendingUploadNode(node.id, { action: 'nope' })
      ).rejects.toMatchObject({
        status: 400,
        errorCode: SERVER_ERROR_CODES.admin.repairUploadInvalidAction,
      });
    });

    it('returns 404 for a missing node', async () => {
      await expect(
        failSafeService.repairPendingUploadNode(999999, { action: 'complete' })
      ).rejects.toMatchObject({
        status: 404,
        errorCode: SERVER_ERROR_CODES.admin.repairSyncNodeNotFound,
      });
    });

    it('refuses with 409 when the node is not pending_upload', async () => {
      const name = unique('pu-notstuck');
      const node = await fileNodeService.createFile(null, name);
      await fileNodeService.updateSyncStatus(node.id, 'active');

      await expect(
        failSafeService.repairPendingUploadNode(node.id, { action: 'complete' })
      ).rejects.toMatchObject({
        status: 409,
        errorCode: SERVER_ERROR_CODES.admin.repairUploadNotPending,
      });
    });
  });

  describe('runStartupRecovery — pending_upload report', () => {
    it('reports stuck nodes without mutating anything', async () => {
      const { node, keyV1, keyV2 } = await seedOverwriteStuck();

      const report = await failSafeService.runStartupRecovery();

      expect(report.pendingUpload.scanned).toBeGreaterThanOrEqual(1);
      expect(report.pendingUpload.nodes.some((n) => n.nodeId === node.id)).toBe(true);
      expect(report.resolved).toBe(0);

      const after = await fileNodeService.getNode(node.id);
      expect(after.syncStatus).toBe('pending_upload');
      const rows = await objectMapRows(node.id);
      expect(rows.map((r) => r.status).sort()).toEqual(['history', 'pending']);
      expect(await blobStore.headBlob(keyV1)).not.toBeNull();
      expect(await blobStore.headBlob(keyV2)).not.toBeNull();
    });
  });

  describe('repairNode — unknown action (extended action set)', () => {
    it('still rejects unknown actions with 400', async () => {
      const { node } = await seedNewFileStuck({});
      await expect(
        failSafeService.repairNode(node.id, { action: 'delete-now' })
      ).rejects.toMatchObject({
        status: 400,
        errorCode: SERVER_ERROR_CODES.admin.repairSyncInvalidAction,
      });
    });
  });
});

describe('createFailSafeService — WebDAV remote checks (D5a/D5d)', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStore;
  let webdavFailSafeService;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createFakeBlobStore();
    webdavFailSafeService = createFailSafeService({
      fileNodeService,
      fileNodesStore,
      blobStore,
      fileStorageMode: 'webdav',
    });
    seq += 1;
  });

  const unique = (prefix) => `${prefix}-${Date.now()}-${seq}`;

  async function seedOrphanedWithRemote({ withChild = false, withRemote = true } = {}) {
    const name = unique('d5-orphan');
    const dir = await fileNodeService.createDirectory(null, name);
    await fileNodeService.updateSyncStatus(dir.id, 'orphaned_node');
    const paths = [`/${name}`];
    if (withRemote) await blobStore.uploadBlob(`/${name}`, Buffer.from('remote'));
    if (withChild) {
      const childName = unique('d5-orphan-child');
      const child = await fileNodeService.createFile(dir.id, childName);
      await fileNodeService.updateSyncStatus(child.id, 'orphaned_node');
      if (withRemote) await blobStore.uploadBlob(`/${name}/${childName}`, Buffer.from('child'));
      paths.push(`/${name}/${childName}`);
    }
    return { dir, name, paths };
  }

  it('retry-delete removes the remote blob/file in addition to the DB rows', async () => {
    const { dir, paths } = await seedOrphanedWithRemote({ withChild: true, withRemote: true });

    const result = await webdavFailSafeService.repairNode(dir.id, { action: 'retry-delete' });

    expect(result.status).toBe('resolved');
    expect(await fileNodeService.getNode(dir.id)).toBeNull();
    for (const p of paths) {
      expect(await blobStore.headBlob(p)).toBeNull();
    }
  });

  it('retry-delete still deletes the DB rows when the remote is already absent', async () => {
    const { dir } = await seedOrphanedWithRemote({ withRemote: false });

    const result = await webdavFailSafeService.repairNode(dir.id, { action: 'retry-delete' });

    expect(result.status).toBe('resolved');
    expect(await fileNodeService.getNode(dir.id)).toBeNull();
  });

  it('force-active refuses with 409 when the remote file is absent', async () => {
    const { dir } = await seedOrphanedWithRemote({ withRemote: false });

    await expect(
      webdavFailSafeService.repairNode(dir.id, { action: 'force-active' })
    ).rejects.toMatchObject({
      status: 409,
      errorCode: SERVER_ERROR_CODES.admin.repairSyncRemoteMissing,
    });

    const after = await fileNodeService.getNode(dir.id);
    expect(after.syncStatus).toBe('orphaned_node');
  });

  it('force-active activates when the remote file exists', async () => {
    const { dir } = await seedOrphanedWithRemote({ withRemote: true });

    const result = await webdavFailSafeService.repairNode(dir.id, { action: 'force-active' });

    expect(result.status).toBe('resolved');
    const after = await fileNodeService.getNode(dir.id);
    expect(after.syncStatus).toBe('active');
  });

  it('pending_upload scan returns an empty list in WebDAV mode (healthy files stay pending_upload)', async () => {
    const node = await fileNodeService.createFile(null, unique('d5-webdav-file'));

    await expect(webdavFailSafeService.scanPendingUploadNodes()).resolves.toEqual([]);
    expect(await fileNodeService.getNode(node.id)).not.toBeNull();
  });

  it('pending_upload repair is refused with 409 in WebDAV mode', async () => {
    const node = await fileNodeService.createFile(null, unique('d5-webdav-repair'));

    await expect(
      webdavFailSafeService.repairNode(node.id, { action: 'auto' })
    ).rejects.toMatchObject({
      status: 409,
      errorCode: SERVER_ERROR_CODES.admin.repairUploadNotPending,
    });

    const after = await fileNodeService.getNode(node.id);
    expect(after.syncStatus).toBe('pending_upload');
  });
});
