'use strict';

const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createGcService } = require('../gcService');
const { getSharedResolver } = require('../../infrastructure/configResolver');

function createFakeBlobStore({ listOrphaned = [] } = {}) {
  const deleted = [];
  return {
    deleteBlob: jest.fn((key) => {
      deleted.push(key);
      return Promise.resolve();
    }),
    listOrphanedKeys: jest.fn((olderThan) => {
      const cutoff = olderThan instanceof Date ? olderThan.getTime() : olderThan;
      return Promise.resolve(
        listOrphaned
          .map((entry) => (typeof entry === 'string' ? { key: entry } : entry))
          .filter((entry) => !entry.lastModified || entry.lastModified.getTime() < cutoff)
          .map((entry) => entry.key)
      );
    }),
    getDeleted: () => deleted,
  };
}

async function insertObjectMapRow({ fileNodeId, s3Key, status, daysAgo = 0, versionNumber = 1 }) {
  const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const res = await dbRun(
    `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status, created_at)
     VALUES (?, ?, 's3', ?, ?, ?)`,
    [fileNodeId, s3Key, versionNumber, status, created]
  );
  return res.lastID;
}

async function getObjectMapRowByKey(s3Key) {
  const res = await dbQuery('SELECT s3_key, status FROM object_map WHERE s3_key = ?', [s3Key]);
  return res.rows[0] || null;
}

describe('createGcService', () => {
  let dbCleanup;
  let fileNodesStore;
  let blobStore;
  let gcService;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createFakeBlobStore();
    gcService = createGcService({ blobStore, fileNodesStore, fileStorageMode: 's3' });
  });

  /* ------------------------------------------------------------------ */
  /*  Tier 1 — DB-driven orphan cleanup                                  */
  /* ------------------------------------------------------------------ */

  describe('Tier 1 (DB-driven)', () => {
    it('deletes S3 blobs and object_map rows for orphaned entries older than the TTL', async () => {
      const orphanedNode = await fileNodesStore.createNode(null, `t1-orphan-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(orphanedNode.id, 'active');
      const orphanedKey = `t1-orphaned-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: orphanedNode.id,
        s3Key: orphanedKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.orphanedRows).toBe(1);
      expect(results.tier1.deletedBlobs).toBe(1);
      expect(results.tier1.deletedRows).toBe(1);
      expect(blobStore.getDeleted()).toContain(orphanedKey);
      expect(await getObjectMapRowByKey(orphanedKey)).toBeNull();
    });

    it('leaves active blobs untouched', async () => {
      const activeNode = await fileNodesStore.createNode(null, `t1-active-${Date.now()}`, 'file');
      const activeKey = `t1-active-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: activeNode.id, s3Key: activeKey, status: 'active' });

      const orphanedNode = await fileNodesStore.createNode(
        null,
        `t1-orphan2-${Date.now()}`,
        'file'
      );
      await fileNodesStore.updateSyncStatus(orphanedNode.id, 'active');
      const orphanedKey = `t1-orphaned-key-2-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: orphanedNode.id,
        s3Key: orphanedKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.orphanedRows).toBe(1);
      expect(blobStore.getDeleted()).toEqual([orphanedKey]);
      expect(blobStore.getDeleted()).not.toContain(activeKey);

      const activeRow = await dbQuery(`SELECT s3_key, status FROM object_map WHERE s3_key = ?`, [
        activeKey,
      ]);
      expect(activeRow.rows).toHaveLength(1);
      expect(activeRow.rows[0].status).toBe('active');
    });

    it('leaves orphaned entries younger than the TTL untouched', async () => {
      const freshNode = await fileNodesStore.createNode(null, `t1-fresh-${Date.now()}`, 'file');
      const freshKey = `t1-fresh-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: freshNode.id,
        s3Key: freshKey,
        status: 'orphaned',
        daysAgo: 0,
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.orphanedRows).toBe(0);
      expect(blobStore.getDeleted()).toHaveLength(0);

      const freshRow = await getObjectMapRowByKey(freshKey);
      expect(freshRow).not.toBeNull();
      expect(freshRow.status).toBe('orphaned');
    });

    it('collects row-delete errors without throwing', async () => {
      const node = await fileNodesStore.createNode(null, `t1-err-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(node.id, 'active');
      const key = `t1-err-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: key,
        status: 'orphaned',
        daysAgo: 10,
      });

      const failingStore = {
        getOrphanedObjects: fileNodesStore.getOrphanedObjects.bind(fileNodesStore),
        deleteObjectMapRows: jest.fn(() => Promise.reject(new Error('boom'))),
      };
      const failingGc = createGcService({
        blobStore,
        fileNodesStore: { ...fileNodesStore, ...failingStore },
        fileStorageMode: 's3',
      });

      const results = await failingGc.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.deletedBlobs).toBe(1);
      expect(results.tier1.errors.some((e) => e.includes('boom'))).toBe(true);
    });

    it('WebDAV mode: orphaned object_map rows are deleted but blobStore.deleteBlob is NOT called', async () => {
      const orphanedNode = await fileNodesStore.createNode(null, `t1-wd-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(orphanedNode.id, 'active');
      const orphanedKey = `preserved-uuid-marker-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: orphanedNode.id,
        s3Key: orphanedKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      const wdBlobStore = createFakeBlobStore();
      const webdavGc = createGcService({
        blobStore: wdBlobStore,
        fileNodesStore,
        fileStorageMode: 'webdav',
      });

      const results = await webdavGc.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.orphanedRows).toBeGreaterThanOrEqual(1);
      expect(results.tier1.deletedBlobs).toBe(0);
      expect(results.tier1.deletedRows).toBe(results.tier1.orphanedRows);
      expect(wdBlobStore.deleteBlob).not.toHaveBeenCalled();
      expect(await getObjectMapRowByKey(orphanedKey)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tier 2 — S3 bucket reconciliation                                  */
  /* ------------------------------------------------------------------ */

  describe('Tier 2 (S3 scan)', () => {
    it('deletes S3 keys with no active object_map reference', async () => {
      const untrackedKey = `t2-untracked-${Date.now()}`;
      const activeKey = `t2-active-${Date.now()}`;
      const activeNode = await fileNodesStore.createNode(null, `t2-node-${Date.now()}`, 'file');
      await insertObjectMapRow({ fileNodeId: activeNode.id, s3Key: activeKey, status: 'active' });

      const tier2BlobStore = createFakeBlobStore({ listOrphaned: [untrackedKey, activeKey] });
      gcService = createGcService({
        blobStore: tier2BlobStore,
        fileNodesStore,
        fileStorageMode: 's3',
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier2.skipped).toBe(false);
      expect(results.tier2.scannedKeys).toBe(2);
      expect(results.tier2.untrackedKeys).toBe(1);
      expect(results.tier2.deletedKeys).toBe(1);
      expect(tier2BlobStore.getDeleted()).toContain(untrackedKey);
      expect(tier2BlobStore.getDeleted()).not.toContain(activeKey);
    });

    it('passes a Date cutoff and ignores keys younger than the TTL', async () => {
      const oldUntrackedKey = `t2-old-${Date.now()}`;
      const freshUntrackedKey = `t2-fresh-${Date.now()}`;
      const activeKey = `t2-active-2-${Date.now()}`;
      const activeNode = await fileNodesStore.createNode(null, `t2-node-2-${Date.now()}`, 'file');
      await insertObjectMapRow({ fileNodeId: activeNode.id, s3Key: activeKey, status: 'active' });

      const now = Date.now();
      const tier2BlobStore = createFakeBlobStore({
        listOrphaned: [
          { key: oldUntrackedKey, lastModified: new Date(now - 10 * 86400000) },
          { key: freshUntrackedKey, lastModified: new Date(now - 60 * 1000) },
          { key: activeKey, lastModified: new Date(now - 10 * 86400000) },
        ],
      });
      gcService = createGcService({
        blobStore: tier2BlobStore,
        fileNodesStore,
        fileStorageMode: 's3',
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      const cutoffArg = tier2BlobStore.listOrphanedKeys.mock.calls[0][0];
      expect(cutoffArg).toBeInstanceOf(Date);
      expect(results.tier2.scannedKeys).toBe(2);
      expect(results.tier2.untrackedKeys).toBe(1);
      expect(results.tier2.deletedKeys).toBe(1);
      expect(tier2BlobStore.getDeleted()).toContain(oldUntrackedKey);
      expect(tier2BlobStore.getDeleted()).not.toContain(freshUntrackedKey);
      expect(tier2BlobStore.getDeleted()).not.toContain(activeKey);
    });

    it('is skipped in WebDAV mode', async () => {
      const webdavGc = createGcService({
        blobStore: createFakeBlobStore(),
        fileNodesStore,
        fileStorageMode: 'webdav',
      });

      const results = await webdavGc.runGcCycle({ olderThanDays: 1 });

      expect(results.tier2.skipped).toBe(true);
      expect(results.tier2.scannedKeys).toBe(0);
      expect(blobStore.listOrphanedKeys).not.toHaveBeenCalled();
    });

    it('is skipped when the blob store exposes no listOrphanedKeys', async () => {
      const minimalStore = { deleteBlob: jest.fn(() => Promise.resolve()) };
      const noListGc = createGcService({
        blobStore: minimalStore,
        fileNodesStore,
        fileStorageMode: 's3',
      });

      const results = await noListGc.runGcCycle({ olderThanDays: 1 });

      expect(results.tier2.skipped).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Threshold / default TTL                                            */
  /* ------------------------------------------------------------------ */

  describe('orphan TTL', () => {
    it('defaults to the DB-sourced GC_ORPHAN_TTL_DAYS when no config is supplied', async () => {
      const resolver = getSharedResolver();
      await dbRun(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        ['GC_ORPHAN_TTL_DAYS', '30']
      );
      resolver.invalidateCache('GC_ORPHAN_TTL_DAYS');
      try {
        const dbGc = createGcService({ blobStore, fileNodesStore, fileStorageMode: 's3' });
        const node = await fileNodesStore.createNode(null, `ttl-${Date.now()}`, 'file');
        const key = `ttl-key-${Date.now()}`;
        await insertObjectMapRow({
          fileNodeId: node.id,
          s3Key: key,
          status: 'orphaned',
          daysAgo: 10,
        });

        const results = await dbGc.runGcCycle();

        // 10 days old < 30 day TTL → not collected
        expect(results.tier1.orphanedRows).toBe(0);
      } finally {
        await dbRun('DELETE FROM settings WHERE key = ?', ['GC_ORPHAN_TTL_DAYS']);
        resolver.invalidateCache('GC_ORPHAN_TTL_DAYS');
      }
    });

    it('prefers an explicit olderThanDays argument over the TTL', async () => {
      const node = await fileNodesStore.createNode(null, `ttl-arg-${Date.now()}`, 'file');
      const key = `ttl-arg-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: key,
        status: 'orphaned',
        daysAgo: 10,
      });

      const results = await gcService.runGcCycle({ olderThanDays: 30 });

      expect(results.tier1.orphanedRows).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tier 1 — last-good guard + retention categories                    */
  /* ------------------------------------------------------------------ */

  describe('last-good guard (Tier 1)', () => {
    it('keeps a stuck node orphaned + pending rows and their blobs while the guard holds', async () => {
      const node = await fileNodesStore.createNode(null, `guard-stuck-${Date.now()}`, 'file');
      const orphanedKey = `guard-orphan-key-${Date.now()}`;
      const pendingKey = `guard-pending-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: orphanedKey,
        status: 'orphaned',
        daysAgo: 10,
        versionNumber: 1,
      });
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: pendingKey,
        status: 'pending',
        daysAgo: 2,
        versionNumber: 2,
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.guardedRows).toBeGreaterThanOrEqual(1);
      expect(await getObjectMapRowByKey(orphanedKey)).not.toBeNull();
      expect(await getObjectMapRowByKey(pendingKey)).not.toBeNull();
      expect(blobStore.getDeleted()).not.toContain(orphanedKey);
      expect(blobStore.getDeleted()).not.toContain(pendingKey);
      expect(results.tier1.deletedRows).toBe(0);
    });

    it('releases the guard once the node has an active row (orphan deleted as version)', async () => {
      const node = await fileNodesStore.createNode(null, `guard-release-${Date.now()}`, 'file');
      const activeKey = `guard-release-active-key-${Date.now()}`;
      const orphanedKey = `guard-release-orphan-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: node.id, s3Key: activeKey, status: 'active' });
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: orphanedKey,
        status: 'orphaned',
        daysAgo: 10,
        versionNumber: 2,
      });

      await gcService.runGcCycle({ olderThanDays: 1 });

      expect(await getObjectMapRowByKey(orphanedKey)).toBeNull();
      expect(blobStore.getDeleted()).toContain(orphanedKey);
      expect(await getObjectMapRowByKey(activeKey)).not.toBeNull();
    });

    it('deletes live-node orphaned rows as version category (historical parity)', async () => {
      const node = await fileNodesStore.createNode(null, `guard-version-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(node.id, 'active');
      const orphanedKey = `guard-version-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: orphanedKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      await gcService.runGcCycle({ olderThanDays: 1 });

      expect(await getObjectMapRowByKey(orphanedKey)).toBeNull();
      expect(blobStore.getDeleted()).toContain(orphanedKey);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tier 1 — pending-live cleanup                                      */
  /* ------------------------------------------------------------------ */

  describe('pending-live cleanup (Tier 1)', () => {
    it('deletes stale pending rows with their blobs and keeps fresh pending rows', async () => {
      const node = await fileNodesStore.createNode(null, `pending-live-${Date.now()}`, 'file');
      const staleKey = `pending-live-stale-key-${Date.now()}`;
      const freshKey = `pending-live-fresh-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: staleKey,
        status: 'pending',
        daysAgo: 5,
        versionNumber: 1,
      });
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: freshKey,
        status: 'pending',
        daysAgo: 0,
        versionNumber: 2,
      });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.pendingDeletedRows).toBe(1);
      expect(await getObjectMapRowByKey(staleKey)).toBeNull();
      expect(await getObjectMapRowByKey(freshKey)).not.toBeNull();
      expect(blobStore.getDeleted()).toContain(staleKey);
      expect(blobStore.getDeleted()).not.toContain(freshKey);
    });

    it('skips pending-live cleanup entirely when pendingStaleDays is 0', async () => {
      const node = await fileNodesStore.createNode(null, `pending-off-${Date.now()}`, 'file');
      const key = `pending-off-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: key,
        status: 'pending',
        daysAgo: 10,
      });

      const offBlobStore = createFakeBlobStore();
      const offGc = createGcService({
        blobStore: offBlobStore,
        fileNodesStore,
        fileStorageMode: 's3',
        gcConfig: { pendingStaleDays: 0 },
      });

      const results = await offGc.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.pendingDeletedRows).toBe(0);
      expect(await getObjectMapRowByKey(key)).not.toBeNull();
      expect(offBlobStore.getDeleted()).not.toContain(key);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Tier 2 — widened keep-set                                          */
  /* ------------------------------------------------------------------ */

  describe('Tier 2 keep-set', () => {
    it('preserves guarded orphan and live pending blobs, deletes the pending blob after cleanup', async () => {
      const guardedNode = await fileNodesStore.createNode(
        null,
        `t2-ks-guarded-${Date.now()}`,
        'file'
      );
      const guardedKey = `t2-ks-guarded-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: guardedNode.id,
        s3Key: guardedKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      const pendingNode = await fileNodesStore.createNode(
        null,
        `t2-ks-pending-${Date.now()}`,
        'file'
      );
      const pendingKey = `t2-ks-pending-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: pendingNode.id,
        s3Key: pendingKey,
        status: 'pending',
        daysAgo: 2,
      });

      const activeNode = await fileNodesStore.createNode(
        null,
        `t2-ks-active-${Date.now()}`,
        'file'
      );
      const activeKey = `t2-ks-active-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: activeNode.id, s3Key: activeKey, status: 'active' });

      const untrackedKey = `t2-ks-untracked-key-${Date.now()}`;
      const now = Date.now();
      const ksBlobStore = createFakeBlobStore({
        listOrphaned: [
          { key: guardedKey, lastModified: new Date(now - 10 * 86400000) },
          { key: pendingKey, lastModified: new Date(now - 10 * 86400000) },
          { key: activeKey, lastModified: new Date(now - 10 * 86400000) },
          { key: untrackedKey, lastModified: new Date(now - 10 * 86400000) },
        ],
      });
      const ksGc = createGcService({
        blobStore: ksBlobStore,
        fileNodesStore,
        fileStorageMode: 's3',
      });

      await ksGc.runGcCycle({ olderThanDays: 1 });

      expect(ksBlobStore.getDeleted()).not.toContain(guardedKey);
      expect(ksBlobStore.getDeleted()).not.toContain(pendingKey);
      expect(ksBlobStore.getDeleted()).not.toContain(activeKey);
      expect(ksBlobStore.getDeleted()).toContain(untrackedKey);

      const row = await dbQuery('SELECT id FROM object_map WHERE s3_key = ?', [pendingKey]);
      await fileNodesStore.deleteObjectMapRows([Number(row.rows[0].id)]);

      await ksGc.runGcCycle({ olderThanDays: 1 });

      expect(ksBlobStore.getDeleted()).toContain(pendingKey);
      expect(ksBlobStore.getDeleted()).not.toContain(guardedKey);
      expect(ksBlobStore.getDeleted()).not.toContain(activeKey);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  WebDAV mode — category parity                                      */
  /* ------------------------------------------------------------------ */

  describe('WebDAV category parity', () => {
    it('deletes version rows rows-only, keeps guarded rows, never calls deleteBlob', async () => {
      const guardedNode = await fileNodesStore.createNode(null, `wd-guard-${Date.now()}`, 'file');
      const guardedKey = `wd-guard-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: guardedNode.id,
        s3Key: guardedKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      const liveNode = await fileNodesStore.createNode(null, `wd-live-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(liveNode.id, 'active');
      const versionKey = `wd-version-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: liveNode.id,
        s3Key: versionKey,
        status: 'orphaned',
        daysAgo: 10,
      });

      const wdBlobStore = createFakeBlobStore();
      const webdavGc = createGcService({
        blobStore: wdBlobStore,
        fileNodesStore,
        fileStorageMode: 'webdav',
      });

      await webdavGc.runGcCycle({ olderThanDays: 1 });

      expect(wdBlobStore.deleteBlob).not.toHaveBeenCalled();
      expect(await getObjectMapRowByKey(versionKey)).toBeNull();
      expect(await getObjectMapRowByKey(guardedKey)).not.toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  version TTL                                                        */
  /* ------------------------------------------------------------------ */

  describe('version TTL', () => {
    it('defaults to the DB-sourced GC_VERSION_TTL_DAYS when no config is supplied', async () => {
      const resolver = getSharedResolver();
      await dbRun(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        ['GC_VERSION_TTL_DAYS', '30']
      );
      resolver.invalidateCache('GC_VERSION_TTL_DAYS');
      try {
        const dbGc = createGcService({ blobStore, fileNodesStore, fileStorageMode: 's3' });
        const node = await fileNodesStore.createNode(null, `vtl-${Date.now()}`, 'file');
        await fileNodesStore.updateSyncStatus(node.id, 'active');
        const key = `vtl-key-${Date.now()}`;
        await insertObjectMapRow({
          fileNodeId: node.id,
          s3Key: key,
          status: 'orphaned',
          daysAgo: 10,
        });

        await dbGc.runGcCycle();

        // 10 days old < 30 day version TTL → not collected (default 1 would delete it)
        expect(await getObjectMapRowByKey(key)).not.toBeNull();
        expect(blobStore.getDeleted()).not.toContain(key);
      } finally {
        await dbRun('DELETE FROM settings WHERE key = ?', ['GC_VERSION_TTL_DAYS']);
        resolver.invalidateCache('GC_VERSION_TTL_DAYS');
      }
    });

    it('prefers an explicit olderThanDays argument over the version TTL', async () => {
      const node = await fileNodesStore.createNode(null, `vtl-arg-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(node.id, 'active');
      const key = `vtl-arg-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: node.id,
        s3Key: key,
        status: 'orphaned',
        daysAgo: 10,
      });

      await gcService.runGcCycle({ olderThanDays: 30 });

      expect(await getObjectMapRowByKey(key)).not.toBeNull();
      expect(blobStore.getDeleted()).not.toContain(key);
    });

    it('gcConfig.versionTtlDays overrides the default TTL (2 keeps a 1.5d row that 1 deletes)', async () => {
      const nodeA = await fileNodesStore.createNode(null, `vtl-cfg-a-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(nodeA.id, 'active');
      const keyA = `vtl-cfg-a-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: nodeA.id,
        s3Key: keyA,
        status: 'orphaned',
        daysAgo: 1.5,
      });

      await gcService.runGcCycle();

      expect(await getObjectMapRowByKey(keyA)).toBeNull();
      expect(blobStore.getDeleted()).toContain(keyA);

      const overrideBlobStore = createFakeBlobStore();
      const overrideGc = createGcService({
        blobStore: overrideBlobStore,
        fileNodesStore,
        fileStorageMode: 's3',
        gcConfig: { versionTtlDays: 2 },
      });
      const nodeB = await fileNodesStore.createNode(null, `vtl-cfg-b-${Date.now()}`, 'file');
      await fileNodesStore.updateSyncStatus(nodeB.id, 'active');
      const keyB = `vtl-cfg-b-key-${Date.now()}`;
      await insertObjectMapRow({
        fileNodeId: nodeB.id,
        s3Key: keyB,
        status: 'orphaned',
        daysAgo: 1.5,
      });

      await overrideGc.runGcCycle();

      expect(await getObjectMapRowByKey(keyB)).not.toBeNull();
      expect(overrideBlobStore.getDeleted()).not.toContain(keyB);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  pending stale TTL                                                  */
  /* ------------------------------------------------------------------ */

  describe('pending stale TTL', () => {
    it('defaults to the DB-sourced GC_PENDING_STALE_DAYS when no config is supplied', async () => {
      const resolver = getSharedResolver();
      await dbRun(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        ['GC_PENDING_STALE_DAYS', '30']
      );
      resolver.invalidateCache('GC_PENDING_STALE_DAYS');
      try {
        const dbGc = createGcService({ blobStore, fileNodesStore, fileStorageMode: 's3' });
        const node = await fileNodesStore.createNode(null, `pstl-${Date.now()}`, 'file');
        const key = `pstl-key-${Date.now()}`;
        await insertObjectMapRow({
          fileNodeId: node.id,
          s3Key: key,
          status: 'pending',
          daysAgo: 10,
        });

        const results = await dbGc.runGcCycle({ olderThanDays: 1 });

        // 10 days old < 30 day stale cutoff → not collected (default 3 would delete it)
        expect(results.tier1.pendingDeletedRows).toBe(0);
        expect(await getObjectMapRowByKey(key)).not.toBeNull();
        expect(blobStore.getDeleted()).not.toContain(key);
      } finally {
        await dbRun('DELETE FROM settings WHERE key = ?', ['GC_PENDING_STALE_DAYS']);
        resolver.invalidateCache('GC_PENDING_STALE_DAYS');
      }
    });

    it('gcConfig.pendingStaleDays overrides the DB setting', async () => {
      const resolver = getSharedResolver();
      await dbRun(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        ['GC_PENDING_STALE_DAYS', '30']
      );
      resolver.invalidateCache('GC_PENDING_STALE_DAYS');
      try {
        const cfgBlobStore = createFakeBlobStore();
        const cfgGc = createGcService({
          blobStore: cfgBlobStore,
          fileNodesStore,
          fileStorageMode: 's3',
          gcConfig: { pendingStaleDays: 1 },
        });
        const node = await fileNodesStore.createNode(null, `pstl-cfg-${Date.now()}`, 'file');
        const key = `pstl-cfg-key-${Date.now()}`;
        await insertObjectMapRow({
          fileNodeId: node.id,
          s3Key: key,
          status: 'pending',
          daysAgo: 10,
        });

        const results = await cfgGc.runGcCycle({ olderThanDays: 1 });

        expect(results.tier1.pendingDeletedRows).toBeGreaterThanOrEqual(1);
        expect(await getObjectMapRowByKey(key)).toBeNull();
        expect(cfgBlobStore.getDeleted()).toContain(key);
      } finally {
        await dbRun('DELETE FROM settings WHERE key = ?', ['GC_PENDING_STALE_DAYS']);
        resolver.invalidateCache('GC_PENDING_STALE_DAYS');
      }
    });
  });
});
