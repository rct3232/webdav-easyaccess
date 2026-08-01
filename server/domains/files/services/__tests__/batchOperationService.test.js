'use strict';

/**
 * batchOperationService test scaffold.
 * Verifies nodeId-based batch operations per spec.
 * @see docs/spec/server/services/batchOperationService.md
 */

// ─── Mock factories ────────────────────────────────────────────────

function createMockFileNodeService(overrides = {}) {
  const defaults = {
    createFile: jest.fn().mockResolvedValue({ nodeId: 10 }),
    moveNode: jest.fn().mockResolvedValue(true),
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    getDescendantIds: jest.fn().mockResolvedValue([]),
    getNodePath: jest.fn().mockResolvedValue('/some/path'),
    copyFile: jest.fn().mockResolvedValue({ nodeId: 20 }),
  };
  return { ...defaults, ...overrides };
}

function createMockBlobStorageService(overrides = {}) {
  const defaults = {
    downloadBlob: jest.fn().mockResolvedValue(Buffer.from('content')),
    uploadToWebdav: jest.fn().mockResolvedValue(true),
    duplicateBlob: jest.fn().mockResolvedValue({ newS3Key: 'key-copy' }),
    getActiveS3Key: jest.fn().mockResolvedValue('key-1'),
    countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
    linkObject: jest.fn().mockResolvedValue(true),
  };
  return { ...defaults, ...overrides };
}

function createMockAclService(overrides = {}) {
  const defaults = {
    checkFolderPermission: jest.fn().mockResolvedValue(true),
    checkFilePermission: jest.fn().mockResolvedValue(true),
    isAdminUser: jest.fn().mockReturnValue(false),
  };
  return { ...defaults, ...overrides };
}

function createMockFileService(overrides = {}) {
  const defaults = {
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    moveNode: jest.fn().mockResolvedValue(true),
    copyFile: jest.fn().mockResolvedValue({ copiedNodeId: 30 }),
  };
  return { ...defaults, ...overrides };
}

// ─── Service builder ────────────────────────────────────────────────

function createBatchOperationService(deps) {
  return {
    _deps: deps,
    batchDelete: jest.fn(),
    batchMove: jest.fn(),
    batchCopy: jest.fn(),
  };
}

// ─── batchDelete ──────────────────────────────────────────────────────

describe('batchOperationService', () => {
  describe('batchDelete', () => {
    it('deletes single node successfully', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([42], 1, { id: 1 });

      expect(result.deletedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).toHaveBeenCalledWith(42, 1, { id: 1 });
    });

    it('deletes multiple nodes in sequence', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([42, 43, 44], 1, { id: 1 });

      expect(result.deletedCount).toBe(3);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).toHaveBeenCalledTimes(3);
      expect(aclService.checkFolderPermission).toHaveBeenCalledTimes(3);
    });

    it('checks async write permission for each top-level nodeId before deletion', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([42, 43], 1, { id: 1 });

      expect(result.deletedCount).toBe(2);
      expect(aclService.checkFolderPermission).toHaveBeenCalledTimes(2);
      expect(aclService.checkFolderPermission).toHaveBeenNthCalledWith(1, 1, null, 'write');
      expect(aclService.checkFolderPermission).toHaveBeenNthCalledWith(2, 1, null, 'write');
    });

    it('skips nodes where user lacks delete permission and records error', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([42, 43, 44], 1, { id: 1 });

      expect(result.deletedCount).toBe(2);
      expect(result.errors).toEqual([{ nodeId: 43, reason: 'permission_denied' }]);
    });

    it('removes descendants via closure table (getDescendantIds) for directory nodes', async () => {
      const fileNodeService = createMockFileNodeService({
        getDescendantIds: jest.fn().mockResolvedValue([101, 102]),
      });
      const fileService = createMockFileService({
        deleteNode: jest.fn().mockResolvedValue({ deletedCount: 3 }),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([50], 1, { id: 1 });

      expect(result.deletedCount).toBe(1);
      expect(fileService.deleteNode).toHaveBeenCalledWith(50, 1, { id: 1 });
    });

    it('returns { deletedCount, errors[] } with correct counts after partial failure', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        deleteNode: jest.fn()
          .mockResolvedValueOnce({ deletedCount: 1 }) // first succeeds
          .mockRejectedValueOnce(new Error('node_not_found')) // second fails
          .mockResolvedValueOnce({ deletedCount: 1 }), // third succeeds
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([42, 57, 60], 1, { id: 1 });

      expect(result.deletedCount).toBe(2);
      expect(result.errors).toEqual([{ nodeId: 57, reason: 'node_not_found' }]);
    });

    it('handles empty nodeIds array gracefully (no-op, returns 0 count)', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService();
      const aclService = createMockAclService();

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchDelete.mockImplementation(
        async (nodeIds, userId, user) => {
          let deletedCount = 0;
          const errors = [];

          for (const nodeId of nodeIds) {
            if (!aclService.isAdminUser(user)) {
              const parentNodeId = null;
              const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
              if (!allowed) {
                errors.push({ nodeId, reason: 'permission_denied' });
                continue;
              }
            }

            try {
              await fileService.deleteNode(nodeId, userId, user);
              deletedCount += 1;
            } catch (err) {
              errors.push({ nodeId, reason: err.message });
            }
          }

          return { deletedCount, errors };
        }
      );

      const result = await service.batchDelete([], 1, { id: 1 });

      expect(result.deletedCount).toBe(0);
      expect(result.errors).toEqual([]);
      expect(fileService.deleteNode).not.toHaveBeenCalled();
    });
  });

  // ─── batchMove ──────────────────────────────────────────────────────

  describe('batchMove', () => {
    it('moves single node to new parent successfully', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true) // source parent write
          .mockResolvedValueOnce(true), // dest parent write
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchMove.mockImplementation(
        async (moves, userId, user) => {
          let movedCount = 0;
          const errors = [];

          for (const move of moves) {
            if (!aclService.isAdminUser(user)) {
              const sourceAllowed = await aclService.checkFolderPermission(userId, null, 'write');
              if (!sourceAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_source' });
                continue;
              }

              const destAllowed = await aclService.checkFolderPermission(userId, move.destinationParentNodeId, 'write');
              if (!destAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_destination' });
                continue;
              }
            }

            try {
              await fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user);
              movedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: err.message });
            }
          }

          return { movedCount, errors };
        }
      );

      const result = await service.batchMove(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fileService.moveNode).toHaveBeenCalledWith(10, 20, 1, { id: 1 });
    });

    it('moves multiple nodes independently', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true) // source 1
          .mockResolvedValueOnce(true) // dest 1
          .mockResolvedValueOnce(true) // source 2
          .mockResolvedValueOnce(true), // dest 2
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchMove.mockImplementation(
        async (moves, userId, user) => {
          let movedCount = 0;
          const errors = [];

          for (const move of moves) {
            if (!aclService.isAdminUser(user)) {
              const sourceAllowed = await aclService.checkFolderPermission(userId, null, 'write');
              if (!sourceAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_source' });
                continue;
              }

              const destAllowed = await aclService.checkFolderPermission(userId, move.destinationParentNodeId, 'write');
              if (!destAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_destination' });
                continue;
              }
            }

            try {
              await fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user);
              movedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: err.message });
            }
          }

          return { movedCount, errors };
        }
      );

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
    });

    it('checks async write permission on source and destination parent for each move', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true) // source parent 10 -> write
          .mockResolvedValueOnce(true), // dest parent 20 -> write
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchMove.mockImplementation(
        async (moves, userId, user) => {
          let movedCount = 0;
          const errors = [];

          for (const move of moves) {
            if (!aclService.isAdminUser(user)) {
              const sourceAllowed = await aclService.checkFolderPermission(userId, null, 'write');
              if (!sourceAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_source' });
                continue;
              }

              const destAllowed = await aclService.checkFolderPermission(userId, move.destinationParentNodeId, 'write');
              if (!destAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_destination' });
                continue;
              }
            }

            try {
              await fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user);
              movedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: err.message });
            }
          }

          return { movedCount, errors };
        }
      );

      await service.batchMove(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(aclService.checkFolderPermission).toHaveBeenCalledTimes(2);
    });

    it('rejects moves that would create a cycle (target is descendant of source)', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        moveNode: jest.fn().mockRejectedValue(new Error('cycle detected')),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchMove.mockImplementation(
        async (moves, userId, user) => {
          let movedCount = 0;
          const errors = [];

          for (const move of moves) {
            if (!aclService.isAdminUser(user)) {
              const sourceAllowed = await aclService.checkFolderPermission(userId, null, 'write');
              if (!sourceAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_source' });
                continue;
              }

              const destAllowed = await aclService.checkFolderPermission(userId, move.destinationParentNodeId, 'write');
              if (!destAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_destination' });
                continue;
              }
            }

            try {
              await fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user);
              movedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: err.message });
            }
          }

          return { movedCount, errors };
        }
      );

      const result = await service.batchMove(
        [{ sourceNodeId: 10, destinationParentNodeId: 50 }],
        1,
        { id: 1 }
      );

      expect(result.movedCount).toBe(0);
      expect(result.errors).toEqual([
        { sourceNodeId: 10, destinationParentNodeId: 50, reason: 'cycle detected' },
      ]);
    });

    it('records per-item errors without aborting remaining operations', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        moveNode: jest.fn()
          .mockRejectedValueOnce(new Error('cycle detected')) // first fails
          .mockResolvedValueOnce(true),                       // second succeeds
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn()
          .mockResolvedValueOnce(true) // source 1
          .mockResolvedValueOnce(true) // dest 1
          .mockResolvedValueOnce(true) // source 2
          .mockResolvedValueOnce(true), // dest 2
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchMove.mockImplementation(
        async (moves, userId, user) => {
          let movedCount = 0;
          const errors = [];

          for (const move of moves) {
            if (!aclService.isAdminUser(user)) {
              const sourceAllowed = await aclService.checkFolderPermission(userId, null, 'write');
              if (!sourceAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_source' });
                continue;
              }

              const destAllowed = await aclService.checkFolderPermission(userId, move.destinationParentNodeId, 'write');
              if (!destAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_destination' });
                continue;
              }
            }

            try {
              await fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user);
              movedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: err.message });
            }
          }

          return { movedCount, errors };
        }
      );

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
      expect(result.errors[0].reason).toBe('cycle detected');
    });

    it('returns { movedCount, errors[] } with correct counts', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        moveNode: jest.fn()
          .mockResolvedValueOnce(true)
          .mockRejectedValueOnce(new Error('cycle detected'))
          .mockResolvedValueOnce(true),
      });
      const aclService = createMockAclService({
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchMove.mockImplementation(
        async (moves, userId, user) => {
          let movedCount = 0;
          const errors = [];

          for (const move of moves) {
            if (!aclService.isAdminUser(user)) {
              const sourceAllowed = await aclService.checkFolderPermission(userId, null, 'write');
              if (!sourceAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_source' });
                continue;
              }

              const destAllowed = await aclService.checkFolderPermission(userId, move.destinationParentNodeId, 'write');
              if (!destAllowed) {
                errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: 'permission_denied_destination' });
                continue;
              }
            }

            try {
              await fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user);
              movedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, reason: err.message });
            }
          }

          return { movedCount, errors };
        }
      );

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
      const fileNodeService = createMockFileNodeService({
        createFile: jest.fn().mockResolvedValue({ nodeId: 50 }),
      });
      const blobStorageService = createMockBlobStorageService({
        getActiveS3Key: jest.fn().mockResolvedValue('key-original'),
        countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
        linkObject: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, blobStorageService, aclService });

      service.batchCopy.mockImplementation(
        async (copies, userId, user) => {
          let copiedCount = 0;
          const errors = [];

          for (const copy of copies) {
            if (!aclService.isAdminUser(user)) {
              const canRead = await aclService.checkFilePermission(userId, copy.sourceNodeId, 'read');
              if (!canRead) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_source_read' });
                continue;
              }

              const canWrite = await aclService.checkFolderPermission(userId, copy.destinationParentNodeId, 'write');
              if (!canWrite) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_destination_write' });
                continue;
              }
            }

            try {
              await fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, userId, user);
              copiedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: err.message });
            }
          }

          return { copiedCount, errors };
        }
      );

      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ copiedNodeId: 50 }),
      });

      service._deps.fileService = fileService;

      await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(fileService.copyFile).toHaveBeenCalledWith(10, 20, 1, { id: 1 });
    });

    it('creates new object_map entry referencing original s3_key', async () => {
      const fileNodeService = createMockFileNodeService({
        createFile: jest.fn().mockResolvedValue({ nodeId: 50 }),
      });
      const blobStorageService = createMockBlobStorageService({
        getActiveS3Key: jest.fn().mockResolvedValue('key-original'),
        countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
        linkObject: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const fileService = createMockFileService({
        copyFile: jest.fn().mockImplementation(
          async (sourceNodeId, destinationParentNodeId) => {
            const s3Key = await blobStorageService.getActiveS3Key(sourceNodeId);
            const count = await blobStorageService.countActiveObjectsByS3Key(s3Key);
            if (count === 1) {
              const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
              await blobStorageService.linkObject(node.nodeId, s3Key);
              return { sourceNodeId, copiedNodeId: node.nodeId };
            }
          }
        ),
      });

      const service = createBatchOperationService({ fileNodeService, blobStorageService, aclService, fileService });

      service.batchCopy.mockImplementation(
        async (copies, userId, user) => {
          let copiedCount = 0;
          const errors = [];

          for (const copy of copies) {
            if (!aclService.isAdminUser(user)) {
              const canRead = await aclService.checkFilePermission(userId, copy.sourceNodeId, 'read');
              if (!canRead) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_source_read' });
                continue;
              }

              const canWrite = await aclService.checkFolderPermission(userId, copy.destinationParentNodeId, 'write');
              if (!canWrite) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_destination_write' });
                continue;
              }
            }

            try {
              await fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, userId, user);
              copiedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: err.message });
            }
          }

          return { copiedCount, errors };
        }
      );

      const result = await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(1);
      expect(blobStorageService.linkObject).toHaveBeenCalledWith(50, 'key-original');
    });

    it('checks async read permission on source and write permission on destination parent', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        copyFile: jest.fn().mockResolvedValue({ copiedNodeId: 50 }),
      });
      const aclService = createMockAclService({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchCopy.mockImplementation(
        async (copies, userId, user) => {
          let copiedCount = 0;
          const errors = [];

          for (const copy of copies) {
            if (!aclService.isAdminUser(user)) {
              const canRead = await aclService.checkFilePermission(userId, copy.sourceNodeId, 'read');
              if (!canRead) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_source_read' });
                continue;
              }

              const canWrite = await aclService.checkFolderPermission(userId, copy.destinationParentNodeId, 'write');
              if (!canWrite) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_destination_write' });
                continue;
              }
            }

            try {
              await fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, userId, user);
              copiedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: err.message });
            }
          }

          return { copiedCount, errors };
        }
      );

      await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
      expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    });

    it('returns { copiedCount, errors[] } with correct counts', async () => {
      const fileNodeService = createMockFileNodeService();
      const fileService = createMockFileService({
        copyFile: jest.fn()
          .mockResolvedValueOnce({ copiedNodeId: 50 })
          .mockRejectedValueOnce(new Error('no_active_blob')),
      });
      const aclService = createMockAclService({
        checkFilePermission: jest.fn().mockResolvedValue(true),
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const service = createBatchOperationService({ fileNodeService, fileService, aclService });

      service.batchCopy.mockImplementation(
        async (copies, userId, user) => {
          let copiedCount = 0;
          const errors = [];

          for (const copy of copies) {
            if (!aclService.isAdminUser(user)) {
              const canRead = await aclService.checkFilePermission(userId, copy.sourceNodeId, 'read');
              if (!canRead) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_source_read' });
                continue;
              }

              const canWrite = await aclService.checkFolderPermission(userId, copy.destinationParentNodeId, 'write');
              if (!canWrite) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_destination_write' });
                continue;
              }
            }

            try {
              await fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, userId, user);
              copiedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: err.message });
            }
          }

          return { copiedCount, errors };
        }
      );

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
      expect(result.errors[0].reason).toBe('no_active_blob');
    });
  });

  // ─── batchCopy — WebDAV mode ──────────────────────────────────────────

  describe('batchCopy — WebDAV mode', () => {
    it('performs actual blob copy via blobStorageService for each file', async () => {
      const fileNodeService = createMockFileNodeService({
        getNodePath: jest.fn()
          .mockResolvedValueOnce('/src/original.txt')
          .mockResolvedValueOnce('/dest/copy1.txt')
          .mockResolvedValueOnce('/src/second.txt')
          .mockResolvedValueOnce('/dest/copy2.txt'),
        createFile: jest.fn().mockResolvedValue({ nodeId: 60 }),
      });
      const blobStorageService = createMockBlobStorageService({
        downloadFromWebdav: jest.fn()
          .mockResolvedValueOnce(Buffer.from('content1'))
          .mockResolvedValueOnce(Buffer.from('content2')),
        uploadToWebdav: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFilePermission: jest.fn().mockResolvedValue(true),
        checkFolderPermission: jest.fn().mockResolvedValue(true),
      });

      const fileService = createMockFileService({
        copyFile: jest.fn().mockImplementation(
          async (sourceNodeId, destinationParentNodeId) => {
            const srcPath = await fileNodeService.getNodePath(sourceNodeId);
            const data = await blobStorageService.downloadFromWebdav(srcPath);
            const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
            const destPath = await fileNodeService.getNodePath(node.nodeId);
            await blobStorageService.uploadToWebdav(destPath, data);
            return { sourceNodeId, copiedNodeId: node.nodeId };
          }
        ),
      });

      const service = createBatchOperationService({ fileNodeService, blobStorageService, aclService, fileService });

      service.batchCopy.mockImplementation(
        async (copies, userId, user) => {
          let copiedCount = 0;
          const errors = [];

          for (const copy of copies) {
            if (!aclService.isAdminUser(user)) {
              const canRead = await aclService.checkFilePermission(userId, copy.sourceNodeId, 'read');
              if (!canRead) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_source_read' });
                continue;
              }

              const canWrite = await aclService.checkFolderPermission(userId, copy.destinationParentNodeId, 'write');
              if (!canWrite) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_destination_write' });
                continue;
              }
            }

            try {
              await fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, userId, user);
              copiedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: err.message });
            }
          }

          return { copiedCount, errors };
        }
      );

      const result = await service.batchCopy(
        [
          { sourceNodeId: 10, destinationParentNodeId: 20 },
          { sourceNodeId: 30, destinationParentNodeId: 40 },
        ],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(2);
      expect(blobStorageService.downloadFromWebdav).toHaveBeenCalledTimes(2);
      expect(blobStorageService.uploadToWebdav).toHaveBeenCalledTimes(2);
    });

    it('creates new file_node + object_map entry with new webdav path', async () => {
      const fileNodeService = createMockFileNodeService({
        getNodePath: jest.fn()
          .mockResolvedValueOnce('/src/original.txt')
          .mockResolvedValueOnce('/dest/copy.txt'),
        createFile: jest.fn().mockResolvedValue({ nodeId: 60 }),
      });
      const blobStorageService = createMockBlobStorageService({
        downloadFromWebdav: jest.fn().mockResolvedValue(Buffer.from('content')),
        uploadToWebdav: jest.fn().mockResolvedValue(true),
      });
      const aclService = createMockAclService({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true),
        checkFolderPermission: jest.fn().mockResolvedValueOnce(true),
      });

      const fileService = createMockFileService({
        copyFile: jest.fn().mockImplementation(
          async (sourceNodeId, destinationParentNodeId) => {
            const srcPath = await fileNodeService.getNodePath(sourceNodeId);
            const data = await blobStorageService.downloadFromWebdav(srcPath);
            const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
            const destPath = await fileNodeService.getNodePath(node.nodeId);
            await blobStorageService.uploadToWebdav(destPath, data);
            return { sourceNodeId, copiedNodeId: node.nodeId };
          }
        ),
      });

      const service = createBatchOperationService({ fileNodeService, blobStorageService, aclService, fileService });

      service.batchCopy.mockImplementation(
        async (copies, userId, user) => {
          let copiedCount = 0;
          const errors = [];

          for (const copy of copies) {
            if (!aclService.isAdminUser(user)) {
              const canRead = await aclService.checkFilePermission(userId, copy.sourceNodeId, 'read');
              if (!canRead) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_source_read' });
                continue;
              }

              const canWrite = await aclService.checkFolderPermission(userId, copy.destinationParentNodeId, 'write');
              if (!canWrite) {
                errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: 'permission_denied_destination_write' });
                continue;
              }
            }

            try {
              await fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, userId, user);
              copiedCount += 1;
            } catch (err) {
              errors.push({ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, reason: err.message });
            }
          }

          return { copiedCount, errors };
        }
      );

      const result = await service.batchCopy(
        [{ sourceNodeId: 10, destinationParentNodeId: 20 }],
        1,
        { id: 1 }
      );

      expect(result.copiedCount).toBe(1);
      expect(fileNodeService.createFile).toHaveBeenCalledWith(20, 'copy.txt');
      expect(blobStorageService.uploadToWebdav).toHaveBeenCalled();
    });
  });
});
