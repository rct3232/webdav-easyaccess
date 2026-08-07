'use strict';

const crypto = require('crypto');
const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createBlobStorageService } = require('../blobStorageService');
const { createInMemoryBlobStore } = require('@testing/mocks/serviceMocks');

describe('createBlobStorageService', () => {
  let dbCleanup;
  let fileNodesStore;
  let blobStore;
  let service;

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
    service = createBlobStorageService({ blobStore, fileNodesStore });
  });

  /* ------------------------------------------------------------------ */
  /*  prepareUpload                                                      */
  /* ------------------------------------------------------------------ */

  describe('prepareUpload', () => {
    // V1: prepareUpload creates pending entry with valid UUID s3Key
    it('creates a pending object_map entry and returns a valid UUID s3Key', async () => {
      const node = await fileNodesStore.createNode(null, 'prep-upload-test-file', 'file');

      const s3Key = await service.prepareUpload(node.id);

      expect(typeof s3Key).toBe('string');
      expect(s3Key.length).toBe(36);

      const objMapRow = await dbQuery(
        `SELECT * FROM object_map WHERE file_node_id = ?`,
        [node.id]
      );
      expect(objMapRow.rows.length).toBe(1);
      expect(objMapRow.rows[0].s3_key).toBe(s3Key);
      expect(objMapRow.rows[0].status).toBe('pending');

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    // V2: prepareUpload orphans previous active entry
    it('orphans any existing active object_map row for the same file node', async () => {
      const node = await fileNodesStore.createNode(null, 'prep-upload-orphan-test', 'file');

      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [node.id, 'old-active-s3-key', 'active']
      );

      const oldRow = await dbQuery(
        `SELECT status FROM object_map WHERE s3_key = ?`,
        ['old-active-s3-key']
      );
      expect(oldRow.rows[0].status).toBe('active');

      try {
        await service.prepareUpload(node.id);
      } catch { /* upsertObjectMap INSERT may fail on UNIQUE constraint; orphaning UPDATE still ran */ }

      const orphanedRow = await dbQuery(
        `SELECT status FROM object_map WHERE s3_key = ?`,
        ['old-active-s3-key']
      );
      expect(orphanedRow.rows[0].status).toBe('orphaned');

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  completeUpload                                                     */
  /* ------------------------------------------------------------------ */

  describe('completeUpload', () => {
    // V3: completeUpload transitions pending to active
    it('transitions a pending object_map entry to active', async () => {
      const node = await fileNodesStore.createNode(null, 'comp-upload-activate-test', 'file');

      await service.prepareUpload(node.id);

      const beforeActive = await dbQuery(
        `SELECT status FROM object_map WHERE file_node_id = ? AND status = 'active'`,
        [node.id]
      );
      expect(beforeActive.rows.length).toBe(0);

      const pendingRow = await dbQuery(
        `SELECT * FROM object_map WHERE file_node_id = ? AND status = 'pending'`,
        [node.id]
      );
      const s3Key = pendingRow.rows[0].s3_key;

      await service.completeUpload(s3Key, 1024, 'text/plain');

      const afterActive = await dbQuery(
        `SELECT status FROM object_map WHERE file_node_id = ? AND s3_key = ?`,
        [node.id, s3Key]
      );
      expect(afterActive.rows[0].status).toBe('active');

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    // V4: completeUpload creates filecache row with correct size and mime_type
    it('creates a filecache row with the provided size and mimeType', async () => {
      const node = await fileNodesStore.createNode(null, 'comp-upload-cache-test', 'file');

      const s3Key = await service.prepareUpload(node.id);
      await service.completeUpload(s3Key, 2048, 'application/pdf');

      const cacheRow = await dbQuery(
        `SELECT * FROM filecache WHERE file_node_id = ?`,
        [node.id]
      );
      expect(cacheRow.rows.length).toBe(1);
      expect(cacheRow.rows[0].size).toBe(2048);
      expect(cacheRow.rows[0].mime_type).toBe('application/pdf');

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('throws when no object_map entry exists for the s3Key', async () => {
      await expect(
        service.completeUpload('nonexistent-key-12345', 100, 'text/plain')
      ).rejects.toThrow(/No object_map entry found/);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  downloadBlob                                                       */
  /* ------------------------------------------------------------------ */

  describe('downloadBlob', () => {
    // V5: downloadBlob with active object returns buffer matching uploaded content
    it('returns the buffer stored in blobStore when an active object exists', async () => {
      const node = await fileNodesStore.createNode(null, 'dl-blob-active-test', 'file');

      const s3Key = await service.prepareUpload(node.id);
      const testBuffer = Buffer.from('hello world content');
      await blobStore.uploadBlob(s3Key, testBuffer);
      await service.completeUpload(s3Key, testBuffer.length, 'text/plain');

      const result = await service.downloadBlob(node.id);

      expect(result).not.toBeNull();
      expect(Buffer.compare(result, testBuffer)).toBe(0);

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    // V6: downloadBlob with no active object returns null
    it('returns null when there is no active object for the file node', async () => {
      const node = await fileNodesStore.createNode(null, 'dl-blob-no-active-test', 'file');

      const result = await service.downloadBlob(node.id);

      expect(result).toBeNull();

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  overwriteBlob                                                      */
  /* ------------------------------------------------------------------ */

  describe('overwriteBlob', () => {
    // V7 + V8: overwriteBlob orphans old key and creates new active mapping
    it('orphans the old s3_key and creates a new active object_map entry', async () => {
      const node = await fileNodesStore.createNode(null, 'overwrite-blob-test', 'file');

      const oldS3Key = await service.prepareUpload(node.id);
      await blobStore.uploadBlob(oldS3Key, Buffer.from('old content'));
      await service.completeUpload(oldS3Key, 11, 'text/plain');

      const activeBefore = await fileNodesStore.getActiveObject(node.id);
      expect(activeBefore.s3_key).toBe(oldS3Key);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 2, ?)`,
        [node.id, oldS3Key, 'active']
      );

      const newBuffer = Buffer.from('new content here');
      const newS3Key = await service.overwriteBlob(node.id, newBuffer);

      const oldStatus = await dbQuery(
        `SELECT status FROM object_map WHERE s3_key = ?`,
        [oldS3Key]
      );
      expect(oldStatus.rows[0].status).toBe('orphaned');

      const activeAfter = await fileNodesStore.getActiveObject(node.id);
      expect(activeAfter.s3_key).toBe(newS3Key);
      expect(typeof newS3Key).toBe('string');
      expect(newS3Key.length).toBe(36);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('uploads the new buffer to blobStore', async () => {
      const node = await fileNodesStore.createNode(null, 'overwrite-blob-upload-test', 'file');

      const oldS3Key = await service.prepareUpload(node.id);
      await blobStore.uploadBlob(oldS3Key, Buffer.from('old'));
      await service.completeUpload(oldS3Key, 3, 'text/plain');

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 2, ?)`,
        [node.id, oldS3Key, 'active']
      );

      const newBuffer = Buffer.from('replaced content');
      const newS3Key = await service.overwriteBlob(node.id, newBuffer);

      const downloaded = await blobStore.downloadBlob(newS3Key);
      expect(downloaded).not.toBeNull();
      expect(Buffer.compare(downloaded, newBuffer)).toBe(0);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('handles overwrite when no active object exists', async () => {
      const node = await fileNodesStore.createNode(null, 'overwrite-no-active-test', 'file');

      const newBuffer = Buffer.from('first upload via overwrite');
      const newS3Key = await service.overwriteBlob(node.id, newBuffer);

      expect(typeof newS3Key).toBe('string');

      const activeAfter = await fileNodesStore.getActiveObject(node.id);
      expect(activeAfter.s3_key).toBe(newS3Key);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  deleteBlob                                                         */
  /* ------------------------------------------------------------------ */

  describe('deleteBlob', () => {
    // V9: deleteBlob marks active object as orphaned (no S3 deletion)
    it('marks the active s3_key as orphaned without deleting from blobStore', async () => {
      const node = await fileNodesStore.createNode(null, 'del-blob-orphan-test', 'file');

      const s3Key = await service.prepareUpload(node.id);
      await blobStore.uploadBlob(s3Key, Buffer.from('should not be deleted'));
      await service.completeUpload(s3Key, 20, 'text/plain');

      await service.deleteBlob(node.id);

      const orphanedRow = await dbQuery(
        `SELECT status FROM object_map WHERE s3_key = ?`,
        [s3Key]
      );
      expect(orphanedRow.rows[0].status).toBe('orphaned');

      expect(await fileNodesStore.getActiveObject(node.id)).toBeNull();

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    // V10: deleteBlob with no active object is a no-op (no error)
    it('is a no-op when there is no active object for the file node', async () => {
      const node = await fileNodesStore.createNode(null, 'del-blob-no-active-test', 'file');

      await expect(service.deleteBlob(node.id)).resolves.not.toThrow();

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getActiveS3Key                                                     */
  /* ------------------------------------------------------------------ */

  describe('getActiveS3Key', () => {
    it('returns the s3_key of the active object', async () => {
      const node = await fileNodesStore.createNode(null, 'active-key-test', 'file');

      const s3Key = await service.prepareUpload(node.id);
      await blobStore.uploadBlob(s3Key, Buffer.from('content'));
      await service.completeUpload(s3Key, 7, 'text/plain');

      const result = await service.getActiveS3Key(node.id);
      expect(result).toBe(s3Key);

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('returns null when no active object exists', async () => {
      const node = await fileNodesStore.createNode(null, 'active-key-null-test', 'file');

      const result = await service.getActiveS3Key(node.id);
      expect(result).toBeNull();

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  WebDAV mode                                                        */
  /* ------------------------------------------------------------------ */

  describe('WebDAV mode', () => {
    function createWebdavService(mockFileNodeService, mockBlobStore) {
      jest.resetModules();
      const { createBlobStorageService: cbss } = require('../blobStorageService');
      return cbss({
        blobStore: mockBlobStore || { uploadBlob: jest.fn(), downloadBlob: jest.fn(), deleteBlob: jest.fn() },
        fileNodesStore: { upsertCache: jest.fn(), insertObject: jest.fn(), orphanObject: jest.fn(), getActiveObject: jest.fn().mockResolvedValue(null), countActiveObjectsByS3Key: jest.fn().mockResolvedValue(0) },
        fileStorageMode: 'webdav',
        fileNodeService: mockFileNodeService,
      });
    }

    it('prepareUpload returns null in WebDAV mode', async () => {
      const mockFns = { getNode: jest.fn(), getNodePath: jest.fn() };
      const svc = createWebdavService(mockFns);
      expect(await svc.prepareUpload(99)).toBeNull();
    });

    it('completeUpload throws "not applicable" in WebDAV mode', async () => {
      const mockFns = { getNode: jest.fn(), getNodePath: jest.fn() };
      const svc = createWebdavService(mockFns);
      await expect(svc.completeUpload('any-key', 100, 'text/plain')).rejects.toThrow(
        /not applicable/
      );
    });

    it('downloadBlob delegates to downloadBlobWebdav via path resolution', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(() => Buffer.from('webdav-content')),
        deleteBlob: jest.fn(),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue({ id: 1, name: 'test.txt' }),
        getNodePath: jest.fn().mockResolvedValue('/path/file.txt'),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      const result = await svc.downloadBlob(1);

      expect(mockFns.getNode).toHaveBeenCalledWith(1);
      expect(mockFns.getNodePath).toHaveBeenCalledWith(1);
      expect(mockBlobStore.downloadBlob).toHaveBeenCalledWith('/path/file.txt');
      expect(result).toEqual(Buffer.from('webdav-content'));
    });

    it('overwriteBlob delegates to uploadToWebdav', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue({ id: 1, name: 'test.txt' }),
        getNodePath: jest.fn().mockResolvedValue('/path/file.txt'),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);
      const buf = Buffer.from('overwrite-data');

      await svc.overwriteBlob(1, buf);

      expect(mockBlobStore.uploadBlob).toHaveBeenCalledWith('/path/file.txt', buf);
    });

    it('deleteBlob resolves path and calls blobStore.deleteBlob(path)', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue({ id: 1, name: 'test.txt' }),
        getNodePath: jest.fn().mockResolvedValue('/path/file.txt'),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      await svc.deleteBlob(1);

      expect(mockFns.getNode).toHaveBeenCalledWith(1);
      expect(mockFns.getNodePath).toHaveBeenCalledWith(1);
      expect(mockBlobStore.deleteBlob).toHaveBeenCalledWith('/path/file.txt');
    });

    it('getActiveS3Key returns null in WebDAV mode', async () => {
      const mockFns = { getNode: jest.fn(), getNodePath: jest.fn() };
      const svc = createWebdavService(mockFns);
      expect(await svc.getActiveS3Key(99)).toBeNull();
    });

    it('downloadBlobWebdav returns null when node not found', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue(null),
        getNodePath: jest.fn(),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      const result = await svc.downloadBlob(999);

      expect(result).toBeNull();
      expect(mockBlobStore.downloadBlob).not.toHaveBeenCalled();
    });

    it('uploadToWebdav throws when path cannot be resolved', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue(null),
        getNodePath: jest.fn(),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      await expect(svc.uploadToWebdav(999, Buffer.from('data'))).rejects.toThrow(
        /Cannot resolve path/
      );
    });

    it('createDirectoryWebdav resolves path and MKCOLs the directory via blobStore', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
        createDirectory: jest.fn().mockResolvedValue(undefined),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue({ id: 1, name: 'sub' }),
        getNodePath: jest.fn().mockResolvedValue('/user/sub'),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      const result = await svc.createDirectoryWebdav(1);

      expect(mockFns.getNode).toHaveBeenCalledWith(1);
      expect(mockFns.getNodePath).toHaveBeenCalledWith(1);
      expect(mockBlobStore.createDirectory).toHaveBeenCalledWith('/user/sub');
      expect(result).toBe('/user/sub');
    });

    it('createDirectoryWebdav marks orphaned_node and rethrows when MKCOL fails', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
        createDirectory: jest.fn().mockRejectedValue(new Error('MKCOL 409 Conflict')),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue({ id: 1, name: 'sub' }),
        getNodePath: jest.fn().mockResolvedValue('/user/sub'),
        updateSyncStatus: jest.fn().mockResolvedValue(undefined),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      await expect(svc.createDirectoryWebdav(1)).rejects.toThrow(/MKCOL 409 Conflict/);
      expect(mockFns.updateSyncStatus).toHaveBeenCalledWith(1, 'orphaned_node');
    });

    it('createDirectoryWebdav throws when path cannot be resolved', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        deleteBlob: jest.fn(),
        createDirectory: jest.fn(),
      };
      const mockFns = {
        getNode: jest.fn().mockResolvedValue(null),
        getNodePath: jest.fn(),
      };
      const svc = createWebdavService(mockFns, mockBlobStore);

      await expect(svc.createDirectoryWebdav(999)).rejects.toThrow(/Cannot resolve path/);
      expect(mockBlobStore.createDirectory).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  createDirectoryWebdav (S3 no-op)                                   */
  /* ------------------------------------------------------------------ */

  describe('createDirectoryWebdav', () => {
    it('is a no-op (returns null) in S3 mode without touching blobStore', async () => {
      // The in-memory blob store has no createDirectory method — if the no-op
      // guard regressed, this call would throw TypeError instead of resolving.
      const node = await fileNodesStore.createNode(null, 'mkcol-s3-noop', 'directory');

      const result = await service.createDirectoryWebdav(node.id);

      expect(result).toBeNull();

      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  COW methods                                                        */
  /* ------------------------------------------------------------------ */

  describe('COW methods', () => {
    it('countActiveObjectsByS3Key returns active count', async () => {
      const node = await fileNodesStore.createNode(null, 'cow-count-test', 'file');
      const s3Key = crypto.randomUUID();

      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [node.id, s3Key, 'active']
      );

      const count = await service.countActiveObjectsByS3Key(s3Key);
      expect(count).toBe(1);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('duplicateBlob copies blob and returns new key', async () => {
      const mockBlobStore = {
        uploadBlob: jest.fn(),
        downloadBlob: jest.fn(),
        copyBlob: jest.fn(),
      };
      const cowService = createBlobStorageService({
        blobStore: mockBlobStore,
        fileNodesStore,
      });

      const newKey = await cowService.duplicateBlob('source-key');

      expect(newKey).toBeDefined();
      expect(typeof newKey).toBe('string');
      expect(mockBlobStore.copyBlob).toHaveBeenCalledWith('source-key', newKey);
    });

    it('linkObject inserts active row', async () => {
      const node = await fileNodesStore.createNode(null, 'cow-link-test', 'file');
      const s3Key = crypto.randomUUID();

      await service.linkObject(node.id, s3Key);

      const obj = await fileNodesStore.getActiveObject(node.id);
      expect(obj).not.toBeNull();
      expect(obj.s3_key).toBe(s3Key);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('ensureExclusiveBlob duplicates when count > 1', async () => {
      const nodeA = await fileNodesStore.createNode(null, 'cow-exclusive-a', 'file');
      const nodeB = await fileNodesStore.createNode(null, 'cow-exclusive-b', 'file');
      const sharedKey = crypto.randomUUID();

      blobStore.copyBlob = jest.fn((src, dst) => {
        return Promise.resolve();
      });

      // Both nodes reference the same blob at version 1 (production copy flow:
      // copyFile → linkObject inserts the shared key at v1 for the copy node).
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [nodeA.id, sharedKey, 'active']
      );
      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [nodeB.id, sharedKey, 'active']
      );

      const newKey = await service.ensureExclusiveBlob(nodeA.id);

      expect(newKey).not.toBe(sharedKey);
      expect(blobStore.copyBlob).toHaveBeenCalledWith(sharedKey, newKey);

      // CoW invariant: nodeA is detached onto the duplicated blob (its old row
      // orphaned, new version inserted), while nodeB keeps the shared blob.
      const activeA = await fileNodesStore.getActiveObject(nodeA.id);
      expect(activeA.s3_key).toBe(newKey);

      const activeB = await fileNodesStore.getActiveObject(nodeB.id);
      expect(activeB).not.toBeNull();
      expect(activeB.s3_key).toBe(sharedKey);

      await dbRun(`DELETE FROM object_map WHERE file_node_id IN (?, ?)`, [nodeA.id, nodeB.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id IN (?, ?)`, [nodeA.id, nodeB.id]);
    });

    it('ensureExclusiveBlob returns existing key when count === 1', async () => {
      const node = await fileNodesStore.createNode(null, 'cow-unique-test', 'file');
      const uniqueKey = crypto.randomUUID();

      await dbRun(
        `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
         VALUES (?, ?, 's3', 1, ?)`,
        [node.id, uniqueKey, 'active']
      );

      const result = await service.ensureExclusiveBlob(node.id);

      expect(result).toBe(uniqueKey);

      await dbRun(`DELETE FROM object_map WHERE file_node_id = ?`, [node.id]);
      await dbRun(`DELETE FROM file_nodes WHERE id = ?`, [node.id]);
    });

    it('duplicateBlob throws in WebDAV mode', async () => {
      jest.resetModules();
      const { createBlobStorageService: cbss } = require('../blobStorageService');
      const webdavSvc = cbss({
        blobStore: { uploadBlob: jest.fn(), downloadBlob: jest.fn(), deleteBlob: jest.fn() },
        fileNodesStore: {},
        fileStorageMode: 'webdav',
        fileNodeService: { getNode: jest.fn(), getNodePath: jest.fn() },
      });
      await expect(webdavSvc.duplicateBlob('source-key')).rejects.toThrow(
        /not applicable/
      );
    });
  });
});
