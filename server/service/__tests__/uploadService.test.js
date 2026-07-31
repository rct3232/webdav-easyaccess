'use strict';

const { createTestDatabase } = require('../../test-utils');
const storage = require('../../store/storage');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createFileNodeService } = require('../fileNodeService');
const { createBlobStorageService } = require('../blobStorageService');
const { createUploadService } = require('../uploadService');

describe('createUploadService', () => {
  let dbCleanup;
  let fileNodesStore;
  let blobStore;
  let fileNodeService;
  let blobStorageService;
  let uploadSvc;

  function createInMemoryBlobStore() {
    const data = new Map();
    return {
      store: data,
      uploadBlob: jest.fn((key, buffer) => {
        data.set(key, Buffer.from(buffer));
      }),
      downloadBlob: jest.fn((key) => {
        const buf = data.get(key);
        return Promise.resolve(buf || null);
      }),
    };
  }

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    fileNodesStore = createFileNodesStore();
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(() => {
    blobStore = createInMemoryBlobStore();
    fileNodeService = createFileNodeService({ fileNodesStore });
    blobStorageService = createBlobStorageService({ blobStore, fileNodesStore });
    uploadSvc = createUploadService({
      fileNodeService,
      blobStorageService,
      blobStore,
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V1: uploadFile success                                            */
  /* ------------------------------------------------------------------ */

  describe('uploadFile', () => {
    it('creates node (pending->active), uploads S3 blob, and populates filecache', async () => {
      const content = Buffer.from('test-upload-content');
      const mimeType = 'text/plain';

      const result = await uploadSvc.uploadFile(null, 'upload-test.txt', content, mimeType);

      expect(result.nodeId).toBeDefined();
      expect(result.s3Key).toBeDefined();
      expect(result.size).toBe(content.length);
      expect(result.mimeType).toBe(mimeType);

      // Node exists and is active
      const node = await storage.sqliteQuery(
        'SELECT * FROM file_nodes WHERE id = ?',
        [result.nodeId]
      );
      expect(node.rows.length).toBe(1);
      expect(node.rows[0].name).toBe('upload-test.txt');
      expect(node.rows[0].type).toBe('file');
      expect(node.rows[0].sync_status).toBe('active');

      // object_map is active
      const objMap = await storage.sqliteQuery(
        'SELECT * FROM object_map WHERE file_node_id = ?',
        [result.nodeId]
      );
      expect(objMap.rows.length).toBeGreaterThan(0);
      const activeRow = objMap.rows.find(r => r.status === 'active');
      expect(activeRow).toBeDefined();
      expect(activeRow.s3_key).toBe(result.s3Key);

      // filecache populated
      const cache = await storage.sqliteQuery(
        'SELECT * FROM filecache WHERE file_node_id = ?',
        [result.nodeId]
      );
      expect(cache.rows.length).toBe(1);
      expect(cache.rows[0].size).toBe(content.length);
      expect(cache.rows[0].mime_type).toBe(mimeType);

      // S3 blob stored
      expect(blobStore.uploadBlob).toHaveBeenCalledWith(result.s3Key, content);
      const s3Content = blobStore.store.get(result.s3Key);
      expect(s3Content).toBeDefined();
      expect(Buffer.compare(s3Content, content)).toBe(0);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [result.nodeId]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V2: uploadFile TX1 failure — ROLLBACK                             */
  /* ------------------------------------------------------------------ */

  describe('uploadFile TX1 failure', () => {
    it('rolls back so nothing is persisted in DB when createFile throws', async () => {
      jest.spyOn(fileNodeService, 'createFile').mockRejectedValueOnce(
        new Error('TX1 simulated failure')
      );

      const content = Buffer.from('should-not-persist');

      await expect(
        uploadSvc.uploadFile(null, 'fail-tx1.txt', content, 'text/plain')
      ).rejects.toThrow();

      // No node created with this name
      const nodes = await storage.sqliteQuery(
        "SELECT * FROM file_nodes WHERE name = 'fail-tx1.txt'",
        []
      );
      expect(nodes.rows.length).toBe(0);

      // No blob uploaded to S3
      expect(blobStore.uploadBlob).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V3: uploadFile S3 PUT failure                                     */
  /* ------------------------------------------------------------------ */

  describe('uploadFile S3 PUT failure', () => {
    it('leaves object_map as pending with no blob in S3', async () => {
      const content = Buffer.from('s3-fail-content');

      blobStore.uploadBlob.mockRejectedValueOnce(new Error('S3 connection refused'));

      await expect(
        uploadSvc.uploadFile(null, 'fail-s3.txt', content, 'text/plain')
      ).rejects.toThrow();

      // Node was created (TX1 committed before S3 attempt)
      const node = await storage.sqliteQuery(
        "SELECT * FROM file_nodes WHERE name = 'fail-s3.txt'",
        []
      );
      expect(node.rows.length).toBe(1);
      const nodeId = node.rows[0].id;

      // object_map is pending (not active, because TX2 never ran)
      const objMap = await storage.sqliteQuery(
        'SELECT * FROM object_map WHERE file_node_id = ?',
        [nodeId]
      );
      expect(objMap.rows.length).toBeGreaterThan(0);
      const pendingRow = objMap.rows.find(r => r.status === 'pending');
      expect(pendingRow).toBeDefined();

      // No active row
      const activeRows = objMap.rows.filter(r => r.status === 'active');
      expect(activeRows.length).toBe(0);

      // sync_status is still pending_upload (TX2 never ran to set active)
      expect(node.rows[0].sync_status).toBe('pending_upload');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [nodeId]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V4: uploadFile TX2 failure                                        */
  /* ------------------------------------------------------------------ */

  describe('uploadFile TX2 failure', () => {
    it('leaves object_map pending, sync_status pending_upload, blob in S3 — GC Tier 2 recoverable', async () => {
      const content = Buffer.from('tx2-fail-content');

      // Let TX1 and S3 PUT succeed, then mock completeUpload to throw during TX2
      jest.spyOn(blobStorageService, 'completeUpload').mockRejectedValueOnce(
        new Error('TX2 simulated failure')
      );

      await expect(
        uploadSvc.uploadFile(null, 'fail-tx2.txt', content, 'text/plain')
      ).rejects.toThrow();

      // Node was created by TX1
      const node = await storage.sqliteQuery(
        "SELECT * FROM file_nodes WHERE name = 'fail-tx2.txt'",
        []
      );
      expect(node.rows.length).toBe(1);
      const nodeId = node.rows[0].id;

      // object_map stays pending (TX2 never activated it)
      const objMap = await storage.sqliteQuery(
        'SELECT * FROM object_map WHERE file_node_id = ?',
        [nodeId]
      );
      expect(objMap.rows.length).toBeGreaterThan(0);
      const pendingRow = objMap.rows.find(r => r.status === 'pending');
      expect(pendingRow).toBeDefined();

      // sync_status is still pending_upload (TX2 never set active)
      expect(node.rows[0].sync_status).toBe('pending_upload');

      // Blob was uploaded to S3 (orphaned / untracked — GC Tier 2 cleanup target)
      const s3Key = pendingRow.s3_key;
      const s3Blob = blobStore.store.get(s3Key);
      expect(s3Blob).toBeDefined();
      expect(Buffer.compare(s3Blob, content)).toBe(0);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [nodeId]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V5: overwriteFile success                                         */
  /* ------------------------------------------------------------------ */

  describe('overwriteFile', () => {
    it('orphans old key, activates new key, and updates filecache', async () => {
      // First do a clean upload to establish an active object
      const originalContent = Buffer.from('original-content');
      const origResult = await uploadSvc.uploadFile(null, 'overwrite-target.txt', originalContent, 'text/plain');

      // Now overwrite
      const newContent = Buffer.from('new-overwritten-content');
      const newMimeType = 'application/octet-stream';

      const overwriteResult = await uploadSvc.overwriteFile(origResult.nodeId, newContent, newMimeType);

      expect(overwriteResult.nodeId).toBe(origResult.nodeId);
      expect(overwriteResult.s3Key).not.toBe(origResult.s3Key);
      expect(overwriteResult.size).toBe(newContent.length);
      expect(overwriteResult.mimeType).toBe(newMimeType);

      // Old s3_key is orphaned
      const oldObjMap = await storage.sqliteQuery(
        'SELECT status FROM object_map WHERE s3_key = ?',
        [origResult.s3Key]
      );
      expect(oldObjMap.rows.length).toBeGreaterThan(0);
      expect(oldObjMap.rows[0].status).toBe('orphaned');

      // New s3_key is active
      const newObjMap = await storage.sqliteQuery(
        'SELECT status FROM object_map WHERE s3_key = ?',
        [overwriteResult.s3Key]
      );
      expect(newObjMap.rows.length).toBeGreaterThan(0);
      expect(newObjMap.rows[0].status).toBe('active');

      // filecache updated with new size and mime_type
      const cache = await storage.sqliteQuery(
        'SELECT * FROM filecache WHERE file_node_id = ?',
        [origResult.nodeId]
      );
      expect(cache.rows.length).toBe(1);
      expect(cache.rows[0].size).toBe(newContent.length);
      expect(cache.rows[0].mime_type).toBe(newMimeType);

      // sync_status is active
      const updatedNode = await storage.sqliteQuery(
        'SELECT sync_status FROM file_nodes WHERE id = ?',
        [origResult.nodeId]
      );
      expect(updatedNode.rows[0].sync_status).toBe('active');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [origResult.nodeId]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V6: overwriteFile TX1 failure — ROLLBACK                          */
  /* ------------------------------------------------------------------ */

  describe('overwriteFile TX1 failure', () => {
    it('rolls back preserving original state when prepareUpload throws', async () => {
      // First do a clean upload to establish an active object
      const originalContent = Buffer.from('original-for-tx1-fail');
      const origResult = await uploadSvc.uploadFile(null, 'overwrite-tx1fail.txt', originalContent, 'text/plain');

      const oldS3Key = origResult.s3Key;

      // Mock prepareUpload to throw during TX1 of overwrite
      jest.spyOn(blobStorageService, 'prepareUpload').mockRejectedValueOnce(
        new Error('TX1 overwrite failure')
      );

      const newContent = Buffer.from('should-not-appear');
      await expect(
        uploadSvc.overwriteFile(origResult.nodeId, newContent, 'text/plain')
      ).rejects.toThrow();

      // Original object_map row should still be active (ROLLBACK preserved it)
      const objMap = await storage.sqliteQuery(
        'SELECT status FROM object_map WHERE file_node_id = ? AND s3_key = ?',
        [origResult.nodeId, oldS3Key]
      );
      expect(objMap.rows.length).toBe(1);
      expect(objMap.rows[0].status).toBe('active');

      // sync_status should still be active (TX1 rollback)
      const node = await storage.sqliteQuery(
        'SELECT sync_status FROM file_nodes WHERE id = ?',
        [origResult.nodeId]
      );
      expect(node.rows[0].sync_status).toBe('active');

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [origResult.nodeId]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V7: downloadFile success                                          */
  /* ------------------------------------------------------------------ */

  describe('downloadFile', () => {
    it('returns buffer matching uploaded content', async () => {
      const content = Buffer.from('downloadable-content-for-verification');
      const mimeType = 'text/plain';

      const uploadResult = await uploadSvc.uploadFile(null, 'download-test.txt', content, mimeType);

      const downloaded = await uploadSvc.downloadFile(uploadResult.nodeId);

      expect(downloaded).not.toBeNull();
      expect(Buffer.compare(downloaded, content)).toBe(0);

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [uploadResult.nodeId]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  V8: downloadFile non-existent node                                */
  /* ------------------------------------------------------------------ */

  describe('downloadFile non-existent', () => {
    it('returns null for a node with no active object', async () => {
      const content = Buffer.from('temp-content');
      const uploadResult = await uploadSvc.uploadFile(null, 'null-download.txt', content, 'text/plain');

      // Delete the active object to simulate non-existent blob
      await storage.sqliteRun(
        'DELETE FROM object_map WHERE file_node_id = ?',
        [uploadResult.nodeId]
      );
      await storage.sqliteRun('DELETE FROM filecache WHERE file_node_id = ?', [uploadResult.nodeId]);

      const downloaded = await uploadSvc.downloadFile(uploadResult.nodeId);
      expect(downloaded).toBeNull();

      await storage.sqliteRun('DELETE FROM file_nodes WHERE id = ?', [uploadResult.nodeId]);
    });
  });
});
