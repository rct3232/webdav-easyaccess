'use strict';

/**
 * Enrichment hooks (B6 / T1.3c — collections-platform.md §4.1).
 *
 * Verifies the four post-commit seams from the outside (what a caller can
 * observe), not how they are wired internally:
 *   Seam 1 — uploadFile      → enqueue(nodeId, 'embed', 1, contentHash)
 *   Seam 2 — overwriteFile   → enqueue(nodeId, 'embed', 1, contentHash)
 *   Seam 3 — deleteNode      → enqueue(nodeId, 'delete', 1, null)
 *   Seam 4 — restoreVersion  → enqueue(nodeId, 'embed', 1, null)
 *
 * Contract under test (aiJobsStore.md §2.3): enqueue(nodeId, kind, generation,
 * contentHash?) with generation as an INTEGER — a string generation ('v1')
 * would violate the `ai_jobs.generation INTEGER NOT NULL` column and the
 * UNIQUE(node_id, kind, generation) idempotency key.
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
const { createInMemoryBlobStore, createAclServiceMock } = require('@testing/mocks/serviceMocks');

/** Independent reference implementation of the write-side content hash. */
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

describe('enrichment hooks — post-commit enqueue + content_hash write-side', () => {
  let dbCleanup;
  let fileNodesStore;
  let fileNodeService;
  let blobStorageService;
  let blobStore;
  let aiJobsRepository;

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
    blobStorageService = createBlobStorageService({ blobStore, fileNodesStore });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  let seq = 0;
  const unique = (prefix) => `${prefix}-${Date.now()}-${(seq += 1)}`;

  /** Remove a node (and cascade its ai_jobs rows) to keep the shared DB clean. */
  async function cleanupNode(nodeId) {
    if (nodeId != null) {
      await dbRun('DELETE FROM file_nodes WHERE id = ?', [nodeId]);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Seam 1 — uploadFile                                               */
  /* ------------------------------------------------------------------ */

  describe('Seam 1 — uploadFile', () => {
    const buildService = () =>
      createUploadService({
        fileNodeService,
        blobStorageService,
        blobStore,
        fileNodesStore,
        aiJobsRepository,
      });

    it('enqueues an embed job with integer generation 1 and the sha256 content hash after TX2 commit', async () => {
      const content = Buffer.from('seam1-upload-content');
      const uploadSvc = buildService();

      const result = await uploadSvc.uploadFile(null, unique('seam1.txt'), content, 'text/plain');

      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(
        result.nodeId,
        'embed',
        1,
        sha256(content)
      );
      const [, kind, generation] = aiJobsRepository.enqueue.mock.calls[0];
      expect(kind).toBe('embed');
      expect(typeof generation).toBe('number'); // INTEGER, not 'v1' (regression guard)
      await cleanupNode(result.nodeId);
    });

    it('populates filecache.content_hash with the sha256 of the uploaded bytes', async () => {
      const content = Buffer.from('seam1-hash-content');
      const uploadSvc = buildService();

      const result = await uploadSvc.uploadFile(
        null,
        unique('seam1-hash.txt'),
        content,
        'text/plain'
      );

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
        aiJobsRepository,
      });

      await expect(
        uploadSvc.uploadFile(null, unique('seam1-fail.txt'), Buffer.from('x'), 'text/plain')
      ).rejects.toThrow('s3 down');

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });

    it('isolates hook failure: enqueue rejection does not fail the upload', async () => {
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));
      const content = Buffer.from('seam1-isolated-content');
      const uploadSvc = buildService();

      const result = await uploadSvc.uploadFile(
        null,
        unique('seam1-iso.txt'),
        content,
        'text/plain'
      );

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
      const uploadSvc = buildService();

      const result = await uploadSvc.uploadFile(
        null,
        unique('seam1-cachefail.txt'),
        content,
        'text/plain'
      );

      expect(result.contentHash).toBe(sha256(content));
      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      await cleanupNode(result.nodeId);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Seam 2 — overwriteFile                                            */
  /* ------------------------------------------------------------------ */

  describe('Seam 2 — overwriteFile', () => {
    const buildService = () =>
      createUploadService({
        fileNodeService,
        blobStorageService,
        blobStore,
        fileNodesStore,
        aiJobsRepository,
      });

    it('enqueues an embed job with the NEW sha256 content hash after the overwrite commits', async () => {
      const uploadSvc = buildService();
      const seeded = await uploadSvc.uploadFile(
        null,
        unique('seam2.txt'),
        Buffer.from('seam2-v1'),
        'text/plain'
      );
      aiJobsRepository.enqueue.mockClear();

      const newContent = Buffer.from('seam2-v2-with-different-bytes');
      const result = await uploadSvc.overwriteFile(seeded.nodeId, newContent, 'text/plain');

      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(
        seeded.nodeId,
        'embed',
        1,
        sha256(newContent)
      );
      const [, kind, generation] = aiJobsRepository.enqueue.mock.calls[0];
      expect(kind).toBe('embed');
      expect(typeof generation).toBe('number');
      expect(result.contentHash).toBe(sha256(newContent));
      await cleanupNode(seeded.nodeId);
    });

    it('updates filecache.content_hash to the new sha256', async () => {
      const uploadSvc = buildService();
      const seeded = await uploadSvc.uploadFile(
        null,
        unique('seam2-hash.txt'),
        Buffer.from('seam2-hash-v1'),
        'text/plain'
      );
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
      const uploadSvc = buildService();
      const seeded = await uploadSvc.uploadFile(
        null,
        unique('seam2-fail.txt'),
        Buffer.from('seam2-fail-v1'),
        'text/plain'
      );
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
        aiJobsRepository,
      });

      await expect(
        failingSvc.overwriteFile(seeded.nodeId, Buffer.from('v2'), 'text/plain')
      ).rejects.toThrow('s3 down');

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
      await cleanupNode(seeded.nodeId);
    });

    it('isolates hook failure: enqueue rejection does not fail the overwrite', async () => {
      const uploadSvc = buildService();
      const seeded = await uploadSvc.uploadFile(
        null,
        unique('seam2-iso.txt'),
        Buffer.from('seam2-iso-v1'),
        'text/plain'
      );
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
  /*  Seam 3 — fileService.deleteNode                                   */
  /* ------------------------------------------------------------------ */

  describe('Seam 3 — fileService.deleteNode', () => {
    const buildService = (nodeOrOverrides) => {
      const nodeValue =
        nodeOrOverrides === null
          ? null
          : { id: 77, type: 'file', name: 'doomed.txt', ...nodeOrOverrides };
      const fileNodeServiceMock = {
        getNode: jest.fn().mockResolvedValue(nodeValue),
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
        aiJobsRepository,
      });
      return { svc, fileNodeServiceMock };
    };

    it('enqueues a delete job (generation 1, null contentHash) after the subtree soft-delete commits', async () => {
      const { svc } = buildService();

      const result = await svc.deleteNode(77, 'user-1', { is_admin: 1 });

      expect(result).toEqual({ deletedCount: 3 });
      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(77, 'delete', 1, null);
      const [, kind, generation, contentHash] = aiJobsRepository.enqueue.mock.calls[0];
      expect(kind).toBe('delete');
      expect(typeof generation).toBe('number');
      expect(contentHash).toBeNull();
    });

    it('marks the subtree deleted BEFORE the enqueue (hook is post-commit)', async () => {
      const { svc, fileNodeServiceMock } = buildService();
      const order = [];
      fileNodeServiceMock.markSubtreeDeleted.mockImplementation(() => {
        order.push('markSubtreeDeleted');
        return Promise.resolve();
      });
      aiJobsRepository.enqueue.mockImplementation(() => {
        order.push('enqueue');
        return Promise.resolve({ id: 1 });
      });

      await svc.deleteNode(77, 'user-1', { is_admin: 1 });

      expect(order).toEqual(['markSubtreeDeleted', 'enqueue']);
    });

    it('isolates hook failure: enqueue rejection does not fail the deletion', async () => {
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));
      const { svc, fileNodeServiceMock } = buildService();

      const result = await svc.deleteNode(77, 'user-1', { is_admin: 1 });

      expect(result).toEqual({ deletedCount: 3 });
      expect(fileNodeServiceMock.markSubtreeDeleted).toHaveBeenCalledWith([77, 78, 79]);
    });

    it('does not enqueue when the node does not exist', async () => {
      const { svc } = buildService(null);

      await expect(svc.deleteNode(77, 'user-1', { is_admin: 1 })).rejects.toThrow();

      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Seam 4 — versionsService.restoreVersion                           */
  /* ------------------------------------------------------------------ */

  describe('Seam 4 — versionsService.restoreVersion', () => {
    const buildService = () =>
      createVersionsService({
        fileNodesStore,
        fileNodeService,
        blobStore,
        fileStorageMode: 's3',
        aclService: createAclServiceMock(),
        aiJobsRepository,
      });

    /** Seed a node with an active v1 and a history v2 (restorable shape). */
    async function seedVersionedNode() {
      const node = await fileNodeService.createFile(null, unique('seam4-node'));
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

    it('enqueues an embed job (generation 1, null contentHash) after the version swap commits', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildService();

      const result = await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(result.restoredVersionNumber).toBe(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(aiJobsRepository.enqueue).toHaveBeenCalledWith(node.id, 'embed', 1, null);
      const [, kind, generation, contentHash] = aiJobsRepository.enqueue.mock.calls[0];
      expect(kind).toBe('embed');
      expect(typeof generation).toBe('number');
      expect(contentHash).toBeNull();
      await cleanupNode(node.id);
    });

    it('re-asserts filecache from the blob HEAD with content_hash null (repair-complete precedent)', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildService();

      await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      const cache = await dbQuery(
        'SELECT content_hash, size FROM filecache WHERE file_node_id = ?',
        [node.id]
      );
      expect(cache.rows[0].content_hash).toBeNull();
      expect(cache.rows[0].size).toBe(Buffer.from('seam4-v1-content').length);
      await cleanupNode(node.id);
    });

    it('does not enqueue when the target version is already current', async () => {
      const { node } = await seedVersionedNode();
      const svc = buildService();

      const result = await svc.restoreVersion('user-1', node.id, 2, { is_admin: 0 });

      expect(result.alreadyCurrent).toBe(true);
      expect(aiJobsRepository.enqueue).not.toHaveBeenCalled();
      await cleanupNode(node.id);
    });

    it('isolates hook failure: enqueue rejection does not fail the restore', async () => {
      const { node } = await seedVersionedNode();
      aiJobsRepository.enqueue = jest.fn().mockRejectedValue(new Error('queue down'));
      const svc = buildService();

      const result = await svc.restoreVersion('user-1', node.id, 1, { is_admin: 0 });

      expect(result.restoredVersionNumber).toBe(1);
      await cleanupNode(node.id);
    });
  });
});
