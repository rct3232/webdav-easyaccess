'use strict';

/**
 * Enrichment hooks (B6 / T1.3c — collections-platform.md §4.1, aiJobService.md §2.2).
 *
 * Verifies the four post-commit content-commit seams from the outside (what a
 * caller can observe), not how they are wired internally:
 *   Seam 1 — S3 upload      (uploadService uploadFile + overwriteFile)
 *   Seam 2 — WebDAV upload  (fileService.uploadFile, webdav storage mode)
 *   Seam 3 — Copy           (fileService.copyFile)
 *   Seam 4 — Version restore (versionsService.restoreVersion)
 *
 * There is NO delete seam: a soft-delete enqueues nothing (aiJobService.md
 * §2.2 lists exactly four seams, and the ai_jobs kind CHECK has no 'delete'
 * kind — a delete enqueue violates the schema).
 *
 * The hook owns the enqueue decision table (aiJobService.md §2.2):
 *   text/document → embed (+features when the chat role is probed on)
 *   image/video   → caption when the vision role is probed on, else embed
 *   audio         → asr when the asr role is probed on, else embed
 *   directories   → nothing
 *
 * The same commit points populate filecache.content_hash (§2.2), and the hook
 * receives the fresh hash:
 *   upload/overwrite → sha256 of the in-memory buffer (the write-side convention)
 *   copy             → the SOURCE node's content_hash (the copied blob is
 *                      byte-identical — reuse, never recompute)
 *   restore          → sha256 of the RE-READ restored blob content (a null
 *                      hash here would break the (content_hash, modelId)
 *                      dedupe skip-key — §2.2)
 *
 * Isolation rule: every hook is best-effort AFTER the user-facing operation
 * has committed — a hook failure (enqueue or content_hash population) must
 * never fail the operation itself, and a failed operation must never enqueue.
 *
 * The aiJobsRepository is a mock here: these tests pin the seam behavior
 * (call shape + isolation), while the store's own contract (ON CONFLICT DO
 * NOTHING → null dedupe, claim semantics) is covered by the repository
 * conformance suites.
 */

const crypto = require('crypto');
const { createTestDatabase, dbQuery, dbRun } = require('../../test-utils');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { createFileNodeService } = require('../fileNodeService');
const { createBlobStorageService } = require('../blobStorageService');
const { createUploadService } = require('../uploadService');
const { createFileService } = require('../../domains/files/services/fileService');
const { createVersionsService } = require('../../domains/files/services/versionsService');
const { createNodeContentHook } = require('../../domains/ai/nodeContentHook');
const { createInMemoryBlobStore, createAclServiceMock } = require('@testing/mocks/serviceMocks');

/** Independent reference implementation of the write-side content hash. */
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

describe('enrichment hooks — post-commit seams + enqueue decision table', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStore;
  let aiJobsRepository;
  /** Role → boolean; which AI capabilities the hook sees as probed on. */
  let probeOn;

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
    aiJobsRepository = { enqueue: jest.fn().mockResolvedValue({ id: 1 }) };
    blobStore = createInMemoryBlobStore();
    probeOn = {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  let seq = 0;
  const unique = (prefix) => `${prefix}-${Date.now()}-${(seq += 1)}`;

  /** Unique FILE name that PRESERVES the extension (the decision table and
   * the hook classify by extension — a suffix must never eat it). */
  const uniqueName = (filename) => {
    const dot = filename.lastIndexOf('.');
    if (dot <= 0) return unique(filename);
    return `${filename.slice(0, dot)}-${Date.now()}-${(seq += 1)}${filename.slice(dot)}`;
  };

  /** Remove a node (and cascade its ai_jobs rows) to keep the shared DB clean. */
  async function cleanupNode(nodeId) {
    if (nodeId != null) {
      await dbRun('DELETE FROM file_nodes WHERE id = ?', [nodeId]);
    }
  }

  /** Hook under test — capability probe is table-driven per test. */
  const buildHook = () =>
    createNodeContentHook({
      aiJobsRepository,
      fileNodesStore,
      capabilityProbe: async (role) => !!(probeOn && probeOn[role]),
    });

  const buildUploadService = () =>
    createUploadService({
      fileNodeService,
      blobStorageService: createBlobStorageService({ blobStore, fileNodesStore }),
      blobStore,
      fileNodesStore,
      nodeContentHook: buildHook(),
    });

  const buildVersionsService = () =>
    createVersionsService({
      fileNodesStore,
      fileNodeService,
      blobStore,
      fileStorageMode: 's3',
      aclService: createAclServiceMock(),
      nodeContentHook: buildHook(),
    });

  /** Kinds observed on the enqueue mock, in call order. */
  const enqueuedKinds = () => aiJobsRepository.enqueue.mock.calls.map((call) => call[1]);

  /* ------------------------------------------------------------------ */
  /*  Seam 1 — S3 upload / overwrite                                     */
  /* ------------------------------------------------------------------ */

  describe('Seam 1 — S3 upload (uploadFile / overwriteFile)', () => {
    it('enqueues an embed job with integer generation 1 and the sha256 of the uploaded bytes', async () => {
      const content = Buffer.from('seam1-upload-content');
      const uploadSvc = buildUploadService();

      const result = await uploadSvc.uploadFile(null, uniqueName('seam1.txt'), content, 'text/plain');

      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(result.nodeId, 'embed', 1, sha256(content));
      const [, kind, generation] = aiJobsRepository.enqueue.mock.calls[0];
      expect(typeof generation).toBe('number'); // INTEGER, not 'v1' (regression guard)
      await cleanupNode(result.nodeId);
    });

    it('a text upload with the chat role probed on enqueues embed AND features (decision table)', async () => {
      const content = Buffer.from('seam1-chat-content');
      probeOn = { chat: true };
      const uploadSvc = buildUploadService();

      const result = await uploadSvc.uploadFile(null, uniqueName('seam1-doc.txt'), content, 'text/plain');

      expect(enqueuedKinds()).toEqual(['embed', 'features']);
      const [, , featuresGen, featuresHash] = aiJobsRepository.enqueue.mock.calls[1];
      expect(featuresGen).toBe(1);
      expect(featuresHash).toBe(sha256(content));
      await cleanupNode(result.nodeId);
    });

    it('populates filecache.content_hash with the sha256 of the uploaded bytes', async () => {
      const content = Buffer.from('seam1-hash-content');
      const uploadSvc = buildUploadService();

      const result = await uploadSvc.uploadFile(null, uniqueName('seam1-hash.txt'), content, 'text/plain');

      const cache = await dbQuery(
        'SELECT content_hash, size, mime_type FROM filecache WHERE file_node_id = ?',
        [result.nodeId]
      );
      expect(cache.rows).toHaveLength(1);
      expect(cache.rows[0].content_hash).toBe(sha256(content));
      expect(cache.rows[0].size).toBe(content.length);
      await cleanupNode(result.nodeId);
    });

    it('does not enqueue when the upload fails (S3 PUT failure → node rolled back)', async () => {
      const failingBlobStore = createInMemoryBlobStore({
        uploadBlob: jest.fn().mockRejectedValue(new Error('s3 down')),
      });
      const uploadSvc = createUploadService({
        fileNodeService,
        blobStorageService: createBlobStorageService({
          blobStore: failingBlobStore,
          fileNodesStore,
        }),
        blobStore: failingBlobStore,
        fileNodesStore,
        nodeContentHook: buildHook(),
      });

      await expect(
        uploadSvc.uploadFile(null, uniqueName('seam1-fail.txt'), Buffer.from('x'), 'text/plain')
      ).rejects.toThrow('s3 down');

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });

    it('isolates hook failure: enqueue rejection does not fail the upload', async () => {
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));
      const content = Buffer.from('seam1-isolated-content');
      const uploadSvc = buildUploadService();

      const result = await uploadSvc.uploadFile(null, uniqueName('seam1-iso.txt'), content, 'text/plain');

      expect(result.contentHash).toBe(sha256(content));
      const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
        result.nodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(content));
      await cleanupNode(result.nodeId);
    });

    it('isolates hash-write failure: a failed post-commit cache write does not fail the upload and enqueue still fires', async () => {
      const realUpsert = fileNodesStore.upsertCache.bind(fileNodesStore);
      // Only the post-commit hook writes a non-null content_hash — TX2's
      // completeUpload writes null. Rejecting on the hash-bearing call
      // therefore targets the hook's cache write without disturbing the TX.
      jest
        .spyOn(fileNodesStore, 'upsertCache')
        .mockImplementation((...args) =>
          args[3] ? Promise.reject(new Error('cache write failed')) : realUpsert(...args)
        );
      const content = Buffer.from('seam1-cache-fail-content');
      const uploadSvc = buildUploadService();

      const result = await uploadSvc.uploadFile(null, uniqueName('seam1-cachefail.txt'), content, 'text/plain');

      expect(result.contentHash).toBe(sha256(content));
      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      await cleanupNode(result.nodeId);
    });
  });

  describe('Seam 1 — S3 overwrite (overwriteFile)', () => {
    it('enqueues an embed job with the NEW sha256 content hash after the overwrite commits', async () => {
      const uploadSvc = buildUploadService();
      const seeded = await uploadSvc.uploadFile(null, uniqueName('seam2.txt'), Buffer.from('seam2-v1'), 'text/plain');
      aiJobsRepository.enqueue.mockClear();

      const newContent = Buffer.from('seam2-v2-with-different-bytes');
      const result = await uploadSvc.overwriteFile(seeded.nodeId, newContent, 'text/plain');

      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(seeded.nodeId, 'embed', 1, sha256(newContent));
      const [, kind, generation] = aiJobsRepository.enqueue.mock.calls[0];
      expect(typeof generation).toBe('number');
      expect(result.contentHash).toBe(sha256(newContent));
      await cleanupNode(seeded.nodeId);
    });

    it('updates filecache.content_hash to the new sha256', async () => {
      const uploadSvc = buildUploadService();
      const seeded = await uploadSvc.uploadFile(null, uniqueName('seam2-hash.txt'), Buffer.from('seam2-hash-v1'), 'text/plain');
      aiJobsRepository.enqueue.mockClear();

      const newContent = Buffer.from('seam2-hash-v2-updated');
      await uploadSvc.overwriteFile(seeded.nodeId, newContent, 'text/plain');

      const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
        seeded.nodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(newContent));
      expect(cache.rows[0].content_hash).not.toBe(sha256(Buffer.from('seam2-hash-v1')));
      await cleanupNode(seeded.nodeId);
    });

    it('does not enqueue when the overwrite fails (S3 PUT failure → pre-state rolled back)', async () => {
      const uploadSvc = buildUploadService();
      const seeded = await uploadSvc.uploadFile(null, uniqueName('seam2-fail.txt'), Buffer.from('seam2-fail-v1'), 'text/plain');
      aiJobsRepository.enqueue.mockClear();

      const failingBlobStore = createInMemoryBlobStore({
        uploadBlob: jest.fn().mockRejectedValue(new Error('s3 down')),
      });
      const failingSvc = createUploadService({
        fileNodeService,
        blobStorageService: createBlobStorageService({
          blobStore: failingBlobStore,
          fileNodesStore,
        }),
        blobStore: failingBlobStore,
        fileNodesStore,
        nodeContentHook: buildHook(),
      });

      await expect(
        failingSvc.overwriteFile(seeded.nodeId, Buffer.from('v2'), 'text/plain')
      ).rejects.toThrow('s3 down');

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
      await cleanupNode(seeded.nodeId);
    });

    it('isolates hook failure: enqueue rejection does not fail the overwrite', async () => {
      const uploadSvc = buildUploadService();
      const seeded = await uploadSvc.uploadFile(null, uniqueName('seam2-iso.txt'), Buffer.from('seam2-iso-v1'), 'text/plain');
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));

      const newContent = Buffer.from('seam2-iso-v2');
      const result = await uploadSvc.overwriteFile(seeded.nodeId, newContent, 'text/plain');

      expect(result.contentHash).toBe(sha256(newContent));
      const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
        seeded.nodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(newContent));
      await cleanupNode(seeded.nodeId);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Seam 2 — WebDAV upload success                                     */
  /* ------------------------------------------------------------------ */

  describe('Seam 2 — WebDAV upload success (fileService.uploadFile, webdav mode)', () => {
    const buildWebdavFileService = () =>
      createFileService({
        fileNodeService,
        blobStorageService: createBlobStorageService({
          blobStore,
          fileNodesStore,
          fileStorageMode: 'webdav',
          fileNodeService,
        }),
        uploadService: { uploadFile: jest.fn(), overwriteFile: jest.fn() },
        aclService: createAclServiceMock({ isAdminUser: jest.fn().mockReturnValue(true) }),
        fileStorageMode: 'webdav',
        blobStore,
        fileNodesStore,
        nodeContentHook: buildHook(),
      });

    it('enqueues an embed job with the sha256 of the uploaded buffer after a WebDAV upload', async () => {
      const content = Buffer.from('webdav-seam-content');
      const svc = buildWebdavFileService();

      const result = await svc.uploadFile('user-1', null, uniqueName('webdav-seam.txt'), content, 'text/plain', { is_admin: 1 });

      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(result.nodeId, 'embed', 1, sha256(content));
      await cleanupNode(result.nodeId);
    });

    it('populates filecache.content_hash with the sha256 of the uploaded buffer', async () => {
      const content = Buffer.from('webdav-hash-content');
      const svc = buildWebdavFileService();

      const result = await svc.uploadFile('user-1', null, uniqueName('webdav-hash.txt'), content, 'text/plain', { is_admin: 1 });

      const cache = await dbQuery('SELECT content_hash, size FROM filecache WHERE file_node_id = ?', [
        result.nodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(content));
      expect(cache.rows[0].size).toBe(content.length);
      await cleanupNode(result.nodeId);
    });

    it('does not enqueue when the WebDAV PUT fails (new node rolled back)', async () => {
      const failingBlobStore = createInMemoryBlobStore({
        uploadBlob: jest.fn().mockRejectedValue(new Error('webdav down')),
      });
      const svc = createFileService({
        fileNodeService,
        blobStorageService: createBlobStorageService({
          blobStore: failingBlobStore,
          fileNodesStore,
          fileStorageMode: 'webdav',
          fileNodeService,
        }),
        uploadService: { uploadFile: jest.fn(), overwriteFile: jest.fn() },
        aclService: createAclServiceMock({ isAdminUser: jest.fn().mockReturnValue(true) }),
        fileStorageMode: 'webdav',
        blobStore: failingBlobStore,
        fileNodesStore,
        nodeContentHook: buildHook(),
      });

      await expect(
        svc.uploadFile('user-1', null, uniqueName('webdav-fail.txt'), Buffer.from('x'), 'text/plain', { is_admin: 1 })
      ).rejects.toThrow('webdav down');

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });

    it('isolates hook failure: enqueue rejection does not fail the WebDAV upload', async () => {
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));
      const content = Buffer.from('webdav-iso-content');
      const svc = buildWebdavFileService();

      const result = await svc.uploadFile('user-1', null, uniqueName('webdav-iso.txt'), content, 'text/plain', { is_admin: 1 });

      expect(result.nodeId).toBeDefined();
      const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
        result.nodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(content));
      await cleanupNode(result.nodeId);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Seam 3 — Copy                                                      */
  /* ------------------------------------------------------------------ */

  describe('Seam 3 — copy (fileService.copyFile, s3 mode)', () => {
    const buildFileService = () => {
      const uploadSvc = buildUploadService();
      const svc = createFileService({
        fileNodeService,
        blobStorageService: createBlobStorageService({ blobStore, fileNodesStore }),
        uploadService: uploadSvc,
        aclService: createAclServiceMock({ isAdminUser: jest.fn().mockReturnValue(true) }),
        fileStorageMode: 's3',
        blobStore,
        fileNodesStore,
        nodeContentHook: buildHook(),
      });
      return { svc, uploadSvc };
    };

    it('enqueues with the REUSED source content_hash (the copied blob is byte-identical)', async () => {
      const { svc, uploadSvc } = buildFileService();
      const content = Buffer.from('copy-seam-content');
      const seeded = await uploadSvc.uploadFile(null, uniqueName('copy-src.txt'), content, 'text/plain');
      aiJobsRepository.enqueue.mockClear();

      const result = await svc.copyFile(seeded.nodeId, null, 'copy-dest.txt', 'user-1', { is_admin: 1 });

      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(result.copiedNodeId, 'embed', 1, sha256(content));
      await cleanupNode(seeded.nodeId);
      await cleanupNode(result.copiedNodeId);
    });

    it('mirrors the source content_hash onto the copied filecache row', async () => {
      const { svc, uploadSvc } = buildFileService();
      const content = Buffer.from('copy-hash-content');
      const seeded = await uploadSvc.uploadFile(null, uniqueName('copy-hash.txt'), content, 'text/plain');
      aiJobsRepository.enqueue.mockClear();

      const result = await svc.copyFile(seeded.nodeId, null, uniqueName('copy-dest2.txt'), 'user-1', { is_admin: 1 });

      const cache = await dbQuery('SELECT content_hash FROM filecache WHERE file_node_id = ?', [
        result.copiedNodeId,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(content));
      await cleanupNode(seeded.nodeId);
      await cleanupNode(result.copiedNodeId);
    });

    it('an image copy with the vision role probed on enqueues caption with the reused hash', async () => {
      probeOn = { vision: true };
      const { svc, uploadSvc } = buildFileService();
      const content = Buffer.from('copy-image-content');
      const seeded = await uploadSvc.uploadFile(null, uniqueName('copy-pic.jpg'), content, 'image/jpeg');
      aiJobsRepository.enqueue.mockClear();

      const result = await svc.copyFile(seeded.nodeId, null, uniqueName('copy-pic2.jpg'), 'user-1', { is_admin: 1 });

      expect(enqueuedKinds()).toEqual(['caption']);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(result.copiedNodeId, 'caption', 1, sha256(content));
      await cleanupNode(seeded.nodeId);
      await cleanupNode(result.copiedNodeId);
    });

    it('isolates hook failure: enqueue rejection does not fail the copy', async () => {
      const { svc, uploadSvc } = buildFileService();
      const seeded = await uploadSvc.uploadFile(null, uniqueName('copy-iso.txt'), Buffer.from('copy-iso'), 'text/plain');
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));

      const result = await svc.copyFile(seeded.nodeId, null, uniqueName('copy-iso2.txt'), 'user-1', { is_admin: 1 });

      expect(result.copiedNodeId).toBeDefined();
      await cleanupNode(seeded.nodeId);
      await cleanupNode(result.copiedNodeId);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  NO delete seam — soft-deletes enqueue nothing                      */
  /* ------------------------------------------------------------------ */

  describe('fileService.deleteNode — no delete seam', () => {
    const buildService = (nodeValue) => {
      const fileNodeServiceMock = {
        getNode: jest.fn().mockResolvedValue(
          nodeValue === undefined ? { id: 77, type: 'file', name: 'doomed.txt' } : nodeValue
        ),
        getDescendantIds: jest.fn().mockResolvedValue([78, 79]),
        markSubtreeDeleted: jest.fn().mockResolvedValue(undefined),
        updateSyncStatus: jest.fn().mockResolvedValue(true),
      };
      const svc = createFileService({
        fileNodeService: fileNodeServiceMock,
        uploadService: { uploadFile: jest.fn(), overwriteFile: jest.fn() },
        aclService: createAclServiceMock({ isAdminUser: jest.fn().mockReturnValue(true) }),
        fileStorageMode: 's3',
        fileNodesStore,
        nodeContentHook: buildHook(),
      });
      return { svc, fileNodeServiceMock };
    };

    it('a soft-delete enqueues NOTHING (the spec has no delete seam)', async () => {
      const { svc, fileNodeServiceMock } = buildService();

      const result = await svc.deleteNode(77, 'user-1', { is_admin: 1 });

      expect(result).toEqual({ deletedCount: 3 });
      expect(fileNodeServiceMock.markSubtreeDeleted).toHaveBeenCalledWith([77, 78, 79]);
      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });

    it('a failed delete (node missing) never enqueues', async () => {
      const { svc } = buildService(null);

      await expect(svc.deleteNode(77, 'user-1', { is_admin: 1 })).rejects.toThrow();

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Seam 4 — versionsService.restoreVersion                            */
  /* ------------------------------------------------------------------ */

  describe('Seam 4 — version restore (versionsService.restoreVersion)', () => {
    /** Seed a node with an active v2 and a history v1 (restorable shape). */
    async function seedVersionedNode(name) {
      const node = await fileNodeService.createFile(null, name || uniqueName('seam4-node.txt'));
      const keyV1 = unique('seam4-v1');
      const keyV2 = unique('seam4-v2');

      await fileNodesStore.upsertObjectMap(node.id, keyV1, 'pending');
      await blobStore.uploadBlob(keyV1, Buffer.from('seam4-v1-content'));
      await fileNodesStore.activateObject(keyV1);
      await fileNodeService.updateSyncStatus(node.id, 'active');

      // Overwrite shape: v1 demoted to history, v2 active.
      await fileNodesStore.upsertObjectMap(node.id, keyV2, 'pending');
      await blobStore.uploadBlob(keyV2, Buffer.from('seam4-v2-content-longer'));
      await fileNodesStore.activateObject(keyV2);
      await fileNodesStore.upsertCache(node.id, 24, 'text/plain', 'stale-hash');

      return { node, keyV1, keyV2 };
    }

    it('enqueues embed with the FRESH sha256 hash of the restored version content (never null)', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildVersionsService();

      const result = await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(result.restoredVersionNumber).toBe(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(node.id, 'embed', 1, sha256(Buffer.from('seam4-v1-content')));
      const [, kind, generation, contentHash] = aiJobsRepository.enqueue.mock.calls[0];
      expect(kind).toBe('embed');
      expect(typeof generation).toBe('number');
      expect(contentHash).not.toBeNull();
      await cleanupNode(node.id);
    });

    it('populates filecache.content_hash with the restored content hash', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildVersionsService();

      await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      const cache = await dbQuery('SELECT content_hash, size FROM filecache WHERE file_node_id = ?', [
        node.id,
      ]);
      expect(cache.rows[0].content_hash).toBe(sha256(Buffer.from('seam4-v1-content')));
      expect(cache.rows[0].content_hash).not.toBe('stale-hash');
      expect(cache.rows[0].size).toBe(Buffer.from('seam4-v1-content').length);
      await cleanupNode(node.id);
    });

    it('an image restore with the vision role probed on enqueues caption with the fresh hash', async () => {
      probeOn = { vision: true };
      const { node } = await seedVersionedNode(uniqueName('seam4-pic.jpg'));
      const svc = buildVersionsService();

      const result = await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(enqueuedKinds()).toEqual(['caption']);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(node.id, 'caption', 1, sha256(Buffer.from('seam4-v1-content')));
      await cleanupNode(node.id);
    });

    it('restoring the current version is a no-op — no enqueue', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildVersionsService();

      const result = await svc.restoreVersion('user-1', node.id, 2, { is_admin: 0 });

      expect(result.alreadyCurrent).toBe(true);
      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
      await cleanupNode(node.id);
    });

    it('degraded: a failed content re-read still restores and enqueues (null hash), never fails the restore', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildVersionsService();
      jest.spyOn(blobStore, 'downloadBlob').mockRejectedValue(new Error('blob re-read down'));

      const result = await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(result.restoredVersionNumber).toBe(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(node.id, 'embed', 1, null);
      await cleanupNode(node.id);
    });

    it('isolates hook failure: enqueue rejection does not fail the restore', async () => {
      const { node } = await seedVersionedNode();
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));
      const svc = buildVersionsService();

      const result = await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(result.restoredVersionNumber).toBe(1);
      await cleanupNode(node.id);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Decision table — onNodeContentCommitted (aiJobService.md §2.2)     */
  /* ------------------------------------------------------------------ */

  describe('decision table — onNodeContentCommitted', () => {
    const commit = async (name) => {
      const node = await fileNodeService.createFile(null, uniqueName(name));
      await buildHook().onNodeContentCommitted(node.id, 'hash-value');
      return node;
    };

    it('text node, chat probed on → embed + features, in order', async () => {
      probeOn = { chat: true };
      const node = await commit('doc.txt');

      expect(enqueuedKinds()).toEqual(['embed', 'features']);
      aiJobsRepository.enqueue.mock.calls.forEach((call) => {
        expect(call[0]).toBe(node.id);
        expect(call[2]).toBe(1);
        expect(call[3]).toBe('hash-value');
      });
      await cleanupNode(node.id);
    });

    it('text node, chat probed off → embed only', async () => {
      const node = await commit('doc.md');

      expect(enqueuedKinds()).toEqual(['embed']);
      await cleanupNode(node.id);
    });

    it('pdf node → embed (chat probed on adds features — local extractor applies)', async () => {
      probeOn = { chat: true };
      const node = await commit('doc.pdf');

      expect(enqueuedKinds()).toEqual(['embed', 'features']);
      await cleanupNode(node.id);
    });

    it('image node, vision probed on → caption only (caption chains embed at completion)', async () => {
      probeOn = { vision: true };
      const node = await commit('photo.jpg');

      expect(enqueuedKinds()).toEqual(['caption']);
      await cleanupNode(node.id);
    });

    it('image node, vision probed off → embed immediately (V0 metadata_only floor)', async () => {
      const node = await commit('photo.jpg');

      expect(enqueuedKinds()).toEqual(['embed']);
      await cleanupNode(node.id);
    });

    it('video node, vision probed on → caption', async () => {
      probeOn = { vision: true };
      const node = await commit('clip.mp4');

      expect(enqueuedKinds()).toEqual(['caption']);
      await cleanupNode(node.id);
    });

    it('audio node, asr probed on → asr only (asr chains embed at completion)', async () => {
      probeOn = { asr: true };
      const node = await commit('voice.mp3');

      expect(enqueuedKinds()).toEqual(['asr']);
      await cleanupNode(node.id);
    });

    it('audio node, asr probed off → embed immediately', async () => {
      const node = await commit('voice.mp3');

      expect(enqueuedKinds()).toEqual(['embed']);
      await cleanupNode(node.id);
    });

    it('directory node → nothing enqueued', async () => {
      const node = await fileNodeService.createDirectory(null, unique('folder'));
      await buildHook().onNodeContentCommitted(node.id, 'hash-value');

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
      await cleanupNode(node.id);
    });

    it('unknown file type → embed floor only (no features)', async () => {
      const node = await commit('archive.bin');

      expect(enqueuedKinds()).toEqual(['embed']);
      await cleanupNode(node.id);
    });

    it('a missing node resolves without enqueueing (no throw into the committed caller)', async () => {
      await expect(buildHook().onNodeContentCommitted(999999999, 'hash-value')).resolves.toBeUndefined();
      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });

    it('a node lookup failure is isolated — the hook never throws', async () => {
      const brokenStore = { getNode: jest.fn().mockRejectedValue(new Error('db down')) };
      const hook = createNodeContentHook({
        aiJobsRepository,
        fileNodesStore: brokenStore,
        capabilityProbe: async () => false,
      });

      await expect(hook.onNodeContentCommitted(123, 'hash-value')).resolves.toBeUndefined();
      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });

    it('a per-kind enqueue failure does not prevent the remaining kinds', async () => {
      probeOn = { chat: true };
      const node = await fileNodeService.createFile(null, uniqueName('partial.txt'));
      aiJobsRepository.enqueue = jest.fn().mockImplementation((nodeId, kind) =>
        kind === 'embed' ? Promise.reject(new Error('queue down')) : Promise.resolve({ id: 1 })
      );

      await buildHook().onNodeContentCommitted(node.id, 'hash-value');

      expect(enqueuedKinds()).toEqual(['embed', 'features']);
      await cleanupNode(node.id);
    });
  });
});
