'use strict';

const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createGcService } = require('../gcService');

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

async function insertObjectMapRow({ fileNodeId, s3Key, status, daysAgo = 0 }) {
  const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const res = await dbRun(
    `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status, created_at)
     VALUES (?, ?, 's3', 1, ?, ?)`,
    [fileNodeId, s3Key, status, created]
  );
  return res.lastID;
}

async function getObjectMapRowByKey(s3Key) {
  const res = await dbQuery(
    'SELECT s3_key, status FROM object_map WHERE s3_key = ?',
    [s3Key]
  );
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
      const orphanedKey = `t1-orphaned-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: orphanedNode.id, s3Key: orphanedKey, status: 'orphaned', daysAgo: 10 });

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

      const orphanedNode = await fileNodesStore.createNode(null, `t1-orphan2-${Date.now()}`, 'file');
      const orphanedKey = `t1-orphaned-key-2-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: orphanedNode.id, s3Key: orphanedKey, status: 'orphaned', daysAgo: 10 });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.orphanedRows).toBe(1);
      expect(blobStore.getDeleted()).toEqual([orphanedKey]);
      expect(blobStore.getDeleted()).not.toContain(activeKey);

      const activeRow = await dbQuery(
        `SELECT s3_key, status FROM object_map WHERE s3_key = ?`,
        [activeKey]
      );
      expect(activeRow.rows).toHaveLength(1);
      expect(activeRow.rows[0].status).toBe('active');
    });

    it('leaves orphaned entries younger than the TTL untouched', async () => {
      const freshNode = await fileNodesStore.createNode(null, `t1-fresh-${Date.now()}`, 'file');
      const freshKey = `t1-fresh-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: freshNode.id, s3Key: freshKey, status: 'orphaned', daysAgo: 0 });

      const results = await gcService.runGcCycle({ olderThanDays: 1 });

      expect(results.tier1.orphanedRows).toBe(0);
      expect(blobStore.getDeleted()).toHaveLength(0);

      const freshRow = await getObjectMapRowByKey(freshKey);
      expect(freshRow).not.toBeNull();
      expect(freshRow.status).toBe('orphaned');
    });

    it('collects row-delete errors without throwing', async () => {
      const node = await fileNodesStore.createNode(null, `t1-err-${Date.now()}`, 'file');
      const key = `t1-err-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: node.id, s3Key: key, status: 'orphaned', daysAgo: 10 });

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
      const orphanedKey = `preserved-uuid-marker-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: orphanedNode.id, s3Key: orphanedKey, status: 'orphaned', daysAgo: 10 });

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
    it('defaults to GC_ORPHAN_TTL_DAYS env when no config is supplied', async () => {
      const prev = process.env.GC_ORPHAN_TTL_DAYS;
      process.env.GC_ORPHAN_TTL_DAYS = '30';
      try {
        const envGc = createGcService({ blobStore, fileNodesStore, fileStorageMode: 's3' });
        const node = await fileNodesStore.createNode(null, `ttl-${Date.now()}`, 'file');
        const key = `ttl-key-${Date.now()}`;
        await insertObjectMapRow({ fileNodeId: node.id, s3Key: key, status: 'orphaned', daysAgo: 10 });

        const results = await envGc.runGcCycle();

        // 10 days old < 30 day TTL → not collected
        expect(results.tier1.orphanedRows).toBe(0);
      } finally {
        if (prev === undefined) {
          delete process.env.GC_ORPHAN_TTL_DAYS;
        } else {
          process.env.GC_ORPHAN_TTL_DAYS = prev;
        }
      }
    });

    it('prefers an explicit olderThanDays argument over the TTL', async () => {
      const node = await fileNodesStore.createNode(null, `ttl-arg-${Date.now()}`, 'file');
      const key = `ttl-arg-key-${Date.now()}`;
      await insertObjectMapRow({ fileNodeId: node.id, s3Key: key, status: 'orphaned', daysAgo: 10 });

      const results = await gcService.runGcCycle({ olderThanDays: 30 });

      expect(results.tier1.orphanedRows).toBe(0);
    });
  });
});
