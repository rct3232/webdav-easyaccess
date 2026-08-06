'use strict';

/**
 * batchOperationService test scaffold.
 * Verifies nodeId-based batch operations per spec.
 * @see docs/spec/server/services/batchOperationService.md
 */

const { createBatchOperationService } = require('../batchOperationService');
const {
  createFileNodeServiceMock,
  createAclServiceMock,
} = require('@testing/mocks/serviceMocks');

// ─── Mock factories ────────────────────────────────────────────────

function createMockFileService(overrides = {}) {
  const defaults = {
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    moveNode: jest.fn().mockResolvedValue(true),
    copyFile: jest.fn().mockResolvedValue({ copiedNodeId: 30 }),
  };
  return { ...defaults, ...overrides };
}

// ─── batchDelete ──────────────────────────────────────────────────────

describe('batchOperationService', () => {
  describe('batchDelete', () => {
    it('deletes single node successfully', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createAclServiceMock({
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([42], 1, { id: 1 });

      expect(result.deletedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).toHaveBeenCalledWith(42, 1, { id: 1 });
    });

    it('deletes multiple nodes in sequence', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([42, 43, 44], 1, { id: 1 });

      expect(result.deletedCount).toBe(3);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).toHaveBeenCalledTimes(3);
      expect(fileService.deleteNode).toHaveBeenCalledWith(42, 1, { id: 1 });
      expect(fileService.deleteNode).toHaveBeenCalledWith(43, 1, { id: 1 });
      expect(fileService.deleteNode).toHaveBeenCalledWith(44, 1, { id: 1 });
      expect(aclService.checkFilePermission).toHaveBeenCalledTimes(3);
    });

    it('checks async write permission for each top-level nodeId before deletion', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([42, 43], 1, { id: 1 });

      expect(result.deletedCount).toBe(2);
      expect(result.errors).toEqual([]);
      expect(aclService.checkFilePermission).toHaveBeenCalledTimes(2);
    });

    it('skips nodes where user lacks delete permission and records error', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([42, 43, 44], 1, { id: 1 });

      expect(result.deletedCount).toBe(2);
      expect(result.errors).toEqual([{ nodeId: 43, status: 'skipped', reason: 'permission_denied' }]);
      expect(fileService.deleteNode).toHaveBeenCalledTimes(2);
      expect(fileService.deleteNode).not.toHaveBeenCalledWith(43, 1, { id: 1 });
    });

    it('removes descendants via closure table (getDescendantIds) for directory nodes', async () => {
      const fileNodeService = createFileNodeServiceMock({
        getDescendantIds: jest.fn().mockResolvedValue([101, 102]),
      });
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 3 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([50], 1, { id: 1 });

      expect(result.deletedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).toHaveBeenCalledWith(50, 1, { id: 1 });
      expect(fileNodeService.getDescendantIds).not.toHaveBeenCalled();
    });

    it('returns { deletedCount, errors[] } with correct counts after partial failure', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        deleteNode: jest.fn()
          .mockResolvedValueOnce({ deletedCount: 1 }) // first succeeds
          .mockRejectedValueOnce(new Error('node_not_found')) // second fails
          .mockResolvedValueOnce({ deletedCount: 1 }), // third succeeds
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([42, 57, 60], 1, { id: 1 });

      expect(result.deletedCount).toBe(2);
      expect(result.errors).toEqual([{ nodeId: 57, status: 'failed', reason: 'node_not_found' }]);
    });

    it('handles empty nodeIds array gracefully (no-op, returns 0 count)', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService();
      const aclService = createAclServiceMock();

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchDelete([], 1, { id: 1 });

      expect(result.deletedCount).toBe(0);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).not.toHaveBeenCalled();
      expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    });
  });

  // ─── batchMove ──────────────────────────────────────────────────────

  describe('batchMove', () => {
    it('moves single node to new parent successfully', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockResolvedValue(true),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true), // source write
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true),  // dest parent write
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchMove(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.moveNode).toHaveBeenCalledWith(10, 20, 1, { id: 1 });
      expect(aclService.checkFilePermission).toHaveBeenCalledTimes(1);
      expect(aclService.checkFolderPermission).toHaveBeenCalledTimes(1);
    });

    it('moves multiple nodes independently', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockResolvedValue(true),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true) // source 1
          .mockResolvedValueOnce(true), // source 2
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true) // dest 1
          .mockResolvedValueOnce(true), // dest 2
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchMove(
        [
          { sourceNodeId: 10, destinationParentNodeId: 20 },
          { sourceNodeId: 30, destinationParentNodeId: 40 },
        ],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(2);
      expect(result.errors).toEqual([]);
      expect(fileService.moveNode).toHaveBeenCalledTimes(2);
      expect(fileService.moveNode).toHaveBeenCalledWith(10, 20, 1, { id: 1 });
      expect(fileService.moveNode).toHaveBeenCalledWith(30, 40, 1, { id: 1 });
    });

    it('checks async write permission on source and destination parent for each move', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockResolvedValue(true),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true), // source 10 -> write
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true),  // dest parent 20 -> write
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchMove(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
      expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    });

    it('rejects moves that would create a cycle (target is descendant of source)', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockRejectedValue(new Error('cycle detected')),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn()
          .mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchMove(
        [{ sourceNodeId: 10, destinationParentNodeId: 50 }],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(0);
      expect(result.errors).toEqual([
        { sourceNodeId: 10, destinationParentNodeId: 50, status: 'failed', reason: 'cycle detected' },
      ]);
    });

    it('records per-item errors without aborting remaining operations', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        moveNode: jest.fn()
          .mockRejectedValueOnce(new Error('cycle detected')) // first fails
          .mockResolvedValueOnce(true),                       // second succeeds
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchMove(
        [
          { sourceNodeId: 10, destinationParentNodeId: 5 },
          { sourceNodeId: 12, destinationParentNodeId: 8 },
        ],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toEqual({ sourceNodeId: 10, destinationParentNodeId: 5, status: 'failed', reason: 'cycle detected' });
    });

    it('returns { movedCount, errors[] } with correct counts', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        moveNode: jest.fn()
          .mockResolvedValueOnce(true)
          .mockRejectedValueOnce(new Error('cycle detected'))
          .mockResolvedValueOnce(true),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchMove(
        [
          { sourceNodeId: 10, destinationParentNodeId: 5 },
          { sourceNodeId: 20, destinationParentNodeId: 6 },
          { sourceNodeId: 30, destinationParentNodeId: 7 },
        ],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(2);
      expect(result.errors.length).toBe(1);
    });
  });

  // ─── batchCopy — S3 mode ──────────────────────────────────────────────

  describe('batchCopy — S3 mode', () => {
    it('creates new file_node pointing to same s3_key (copy-on-write)', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ sourceNodeId: 10, copiedNodeId: 50 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.copyFile).toHaveBeenCalledWith(10, 20, null, 1, { id: 1 });
      expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
      expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    });

    it('creates new object_map entry referencing original s3_key', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ sourceNodeId: 10, copiedNodeId: 50 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.copyFile).toHaveBeenCalledWith(10, 20, null, 1, { id: 1 });
    });

    it('checks async read permission on source and write permission on destination parent', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ copiedNodeId: 50 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
      expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    });

    it('returns { copiedCount, errors[] } with correct counts', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        copyFile: jest.fn()
          .mockResolvedValueOnce({ sourceNodeId: 10, copiedNodeId: 50 })
          .mockRejectedValueOnce(new Error('no_active_blob')),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchCopy(
        [
          { sourceNodeId: 10, destinationParentNodeId: 20 },
          { sourceNodeId: 30, destinationParentNodeId: 40 },
        ],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toEqual({ sourceNodeId: 30, destinationParentNodeId: 40, status: 'failed', reason: 'no_active_blob' });
    });
  });

  // ─── batchCopy — WebDAV mode ──────────────────────────────────────────

  describe('batchCopy — WebDAV mode', () => {
    it('performs actual blob copy via blobStorageService for each file', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ sourceNodeId: 10, copiedNodeId: 60 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchCopy(
        [
          { sourceNodeId: 10, destinationParentNodeId: 20 },
          { sourceNodeId: 30, destinationParentNodeId: 40 },
        ],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(2);
      expect(result.errors).toEqual([]);
      expect(fileService.copyFile).toHaveBeenCalledTimes(2);
      expect(fileService.copyFile).toHaveBeenCalledWith(10, 20, null, 1, { id: 1 });
      expect(fileService.copyFile).toHaveBeenCalledWith(30, 40, null, 1, { id: 1 });
    });

    it('creates new file_node + object_map entry with new webdav path', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ sourceNodeId: 10, copiedNodeId: 60 }),
      });
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      const result = await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.copyFile).toHaveBeenCalledWith(10, 20, null, 1, { id: 1 });
      expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
      expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    });
  });
});
