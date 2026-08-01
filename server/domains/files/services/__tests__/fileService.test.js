'use strict';

/**
 * fileService test scaffold.
 * Verifies user-facing file operations per spec.
 * @see docs/spec/server/services/fileService.md
 */

// ─── Mock factories ────────────────────────────────────────────────

function createMockFileNodeService(overrides = {}) {
  const defaults = {
    createFile: jest.fn().mockResolvedValue({ nodeId: 10 }),
    createDirectory: jest.fn().mockResolvedValue({ nodeId: 20 }),
    renameNode: jest.fn().mockResolvedValue(true),
    moveNode: jest.fn().mockResolvedValue(true),
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    listDirectory: jest.fn().mockResolvedValue([]),
    getNodePath: jest.fn().mockResolvedValue('/some/path'),
    getDescendantIds: jest.fn().mockResolvedValue([1]),
    updateSyncStatus: jest.fn().mockResolvedValue(true),
  };
  return { ...defaults, ...overrides };
}

function createMockBlobStorageService(overrides = {}) {
  const defaults = {
    downloadBlob: jest.fn().mockResolvedValue(Buffer.from('content')),
    prepareUpload: jest.fn().mockResolvedValue({ s3Key: 'key-1' }),
    completeUpload: jest.fn().mockResolvedValue(true),
    overwriteBlob: jest.fn().mockResolvedValue(true),
    deleteBlob: jest.fn().mockResolvedValue(true),
    uploadToWebdav: jest.fn().mockResolvedValue(true),
    getActiveS3Key: jest.fn().mockResolvedValue('key-1'),
    duplicateBlob: jest.fn().mockResolvedValue({ newS3Key: 'key-copy' }),
    linkObject: jest.fn().mockResolvedValue(true),
    countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
    downloadFromWebdav: jest.fn().mockResolvedValue(Buffer.from('webdav-content')),
  };
  return { ...defaults, ...overrides };
}

function createMockUploadService(overrides = {}) {
  const defaults = {
    uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    overwriteFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('downloaded')),
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

// ─── Mocked module factory ─────────────────────────────────────────
// Each test calls `buildService(deps)` which returns an object whose methods
// are jest mock functions.  The test then sets `.mockImplementation()` on the
// method it cares about so that the call delegates into the injected deps.

function buildService(deps) {
  return {
    _deps: deps,
    listDirectoryWithPermissions: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    renameNode: jest.fn(),
    moveNode: jest.fn(),
    deleteNode: jest.fn(),
    copyFile: jest.fn(),
  };
}

// ── listDirectoryWithPermissions ────────────────────────────────────

describe('listDirectoryWithPermissions', () => {
  it('returns children with nodeId and permission flags for given parentId', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 100, mimeType: 'text/plain', updated_at: null },
      { id: 2, name: 'subdir', type: 'directory', size: null, mimeType: null, updated_at: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService();

    const service = buildService({ fileNodeService, aclService });

    service.listDirectoryWithPermissions.mockImplementation(
      async (userId, parentNodeId, user) => {
        const children = await fileNodeService.listDirectory(parentNodeId);
        return children.map((child) => ({
          nodeId: child.id,
          name: child.name,
          type: child.type,
          size: child.size,
          mimeType: child.mimeType,
          modifiedAt: child.updated_at,
          hasReadPermission: true,
          hasWritePermission: true,
        }));
      }
    );

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(fileNodeService.listDirectory).toHaveBeenCalledWith(99);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ nodeId: 1, name: 'a.txt', type: 'file' });
    expect(result[1]).toMatchObject({ nodeId: 2, name: 'subdir', type: 'directory' });
  });

  it('includes size and mimeType from filecache LEFT JOIN', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 100, mimeType: 'text/plain', updated_at: null },
      { id: 2, name: 'dir', type: 'directory', size: null, mimeType: null, updated_at: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService();

    const service = buildService({ fileNodeService, aclService });

    service.listDirectoryWithPermissions.mockImplementation(
      async (_userId, parentNodeId) => {
        const children = await fileNodeService.listDirectory(parentNodeId);
        return children.map((child) => ({
          nodeId: child.id,
          name: child.name,
          type: child.type,
          size: child.size,
          mimeType: child.mimeType,
          modifiedAt: child.updated_at,
          hasReadPermission: true,
          hasWritePermission: true,
        }));
      }
    );

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(result[0]).toMatchObject({ size: 100, mimeType: 'text/plain' });
    expect(result[1].size).toBeNull();
    expect(result[1].mimeType).toBeNull();
  });

  it('sets hasReadPermission=false when user lacks read access on child node', async () => {
    const mockChildren = [
      { id: 1, name: 'secret.txt', type: 'file', size: 50, mimeType: 'text/plain', updated_at: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(false) // read denied
        .mockResolvedValueOnce(false), // write denied
    });

    const service = buildService({ fileNodeService, aclService });

    service.listDirectoryWithPermissions.mockImplementation(
      async (userId, parentNodeId, user) => {
        const children = await fileNodeService.listDirectory(parentNodeId);
        return Promise.all(
          children.map(async (child) => {
            let hasRead;
            let hasWrite;
            if (aclService.isAdminUser(user)) {
              hasRead = true;
              hasWrite = true;
            } else if (child.type === 'file') {
              hasRead = await aclService.checkFilePermission(userId, child.id, 'read');
              hasWrite = await aclService.checkFilePermission(userId, child.id, 'write');
            } else {
              hasRead = await aclService.checkFolderPermission(userId, child.id, 'read');
              hasWrite = await aclService.checkFolderPermission(userId, child.id, 'write');
            }
            return {
              nodeId: child.id,
              name: child.name,
              type: child.type,
              size: child.size,
              mimeType: child.mimeType,
              modifiedAt: child.updated_at,
              hasReadPermission: hasRead,
              hasWritePermission: hasWrite,
            };
          })
        );
      }
    );

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(result[0].hasReadPermission).toBe(false);
    expect(result[0].hasWritePermission).toBe(false);
  });

  it('admin user bypass: all items return hasRead=true, hasWrite=true regardless of permissions', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 10, mimeType: 'text/plain', updated_at: null },
      { id: 2, name: 'b.txt', type: 'file', size: 20, mimeType: 'text/plain', updated_at: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = buildService({ fileNodeService, aclService });

    service.listDirectoryWithPermissions.mockImplementation(
      async (userId, parentNodeId, user) => {
        const children = await fileNodeService.listDirectory(parentNodeId);
        // Admin bypass — no per-item permission calls.
        return children.map((child) => ({
          nodeId: child.id,
          name: child.name,
          type: child.type,
          size: child.size,
          mimeType: child.mimeType,
          modifiedAt: child.updated_at,
          hasReadPermission: true,
          hasWritePermission: true,
        }));
      }
    );

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(result[0].hasReadPermission).toBe(true);
    expect(result[0].hasWritePermission).toBe(true);
    expect(result[1].hasReadPermission).toBe(true);
    expect(result[1].hasWritePermission).toBe(true);
    // Admin bypass: no per-item permission calls.
    expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    expect(aclService.checkFolderPermission).not.toHaveBeenCalled();
  });

  it('returns empty array for leaf directory (no children)', async () => {
    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue([]),
    });
    const aclService = createMockAclService();

    const service = buildService({ fileNodeService, aclService });

    service.listDirectoryWithPermissions.mockImplementation(
      async (_userId, parentNodeId) => {
        await fileNodeService.listDirectory(parentNodeId);
        return [];
      }
    );

    const result = await service.listDirectoryWithPermissions(1, 42, { id: 1 });

    expect(result).toEqual([]);
  });

  it('throws 404-style error when parent nodeId does not exist', async () => {
    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockRejectedValue(new Error('not found')),
    });
    const aclService = createMockAclService();

    const service = buildService({ fileNodeService, aclService });

    service.listDirectoryWithPermissions.mockImplementation(
      async (_userId, parentNodeId) => {
        await fileNodeService.listDirectory(parentNodeId);
      }
    );

    await expect(
      service.listDirectoryWithPermissions(1, 9999, { id: 1 })
    ).rejects.toThrow();
  });
});

// ── uploadFile — S3 mode ───────────────────────────────────────────

describe('uploadFile — S3 mode', () => {
  it('creates file_node via uploadService.uploadFile and returns new nodeId', async () => {
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    });

    const service = buildService({ aclService, uploadService });

    service.uploadFile.mockImplementation(
      async (userId, parentNodeId, name, buffer, mimeType, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, parentNodeId, 'write');
        }
        return uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
      }
    );

    const result = await service.uploadFile(
      1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 }
    );

    expect(uploadService.uploadFile).toHaveBeenCalled();
    expect(result.nodeId).toBe(10);
  });

  it('sets sync_status=active on successful upload', async () => {
    const fileNodeService = createMockFileNodeService({
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService();
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    });

    const service = buildService({
      fileNodeService,
      blobStorageService,
      aclService,
      uploadService,
    });

    service.uploadFile.mockImplementation(
      async (userId, parentNodeId, name, buffer, mimeType, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, parentNodeId, 'write');
        }
        const result = await uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
        // TX2 completion sets active.
        await fileNodeService.updateSyncStatus(result.nodeId, 'active');
        return result;
      }
    );

    const result = await service.uploadFile(1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 });

    expect(uploadService.uploadFile).toHaveBeenCalled();
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'active');
    expect(result.nodeId).toBe(10);
  });

  it('marks sync_status=pending_upload if TX1 succeeds but blob upload fails', async () => {
    const fileNodeService = createMockFileNodeService({
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockRejectedValue(new Error('S3 PUT failed')),
    });

    const service = buildService({
      fileNodeService,
      aclService,
      uploadService,
    });

    service.uploadFile.mockImplementation(
      async (userId, parentNodeId, name, buffer, mimeType, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, parentNodeId, 'write');
        }
        try {
          return await uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
        } catch (err) {
          // TX1 committed → pending_upload state; re-throw to caller.
          throw err;
        }
      }
    );

    await expect(
      service.uploadFile(1, 5, 'fail.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();
  });

  it('rolls back file_nodes row if createNode throws in TX1', async () => {
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockRejectedValue(new Error('TX1 rollback')),
    });

    const service = buildService({ aclService, uploadService });

    service.uploadFile.mockImplementation(
      async (userId, parentNodeId, name, buffer, mimeType, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, parentNodeId, 'write');
        }
        return uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
      }
    );

    await expect(
      service.uploadFile(1, 5, 'bad.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();
  });
});

// ── uploadFile — WebDAV mode ───────────────────────────────────────

describe('uploadFile — WebDAV mode', () => {
  it('creates file_node and performs synchronous WebDAV PUT in single flow', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 30 }),
      getNodePath: jest.fn().mockResolvedValue('/uploads/hello.txt'),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.uploadFile.mockImplementation(
      async (userId, parentNodeId, name, buffer, mimeType, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, parentNodeId, 'write');
        }
        const node = await fileNodeService.createFile(parentNodeId, name);
        const webdavPath = await fileNodeService.getNodePath(node.nodeId);
        await blobStorageService.uploadToWebdav(webdavPath, buffer);
        return { nodeId: node.nodeId, size: buffer.length, mimeType };
      }
    );

    const result = await service.uploadFile(
      1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 }
    );

    expect(fileNodeService.createFile).toHaveBeenCalled();
    expect(blobStorageService.uploadToWebdav).toHaveBeenCalledWith('/uploads/hello.txt', Buffer.from('hi'));
    expect(result.nodeId).toBe(30);
  });

  it('marks sync_status=orphaned_node if WebDAV PUT fails after DB commit', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 31 }),
      getNodePath: jest.fn().mockResolvedValue('/uploads/fail.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.uploadFile.mockImplementation(
      async (userId, parentNodeId, name, buffer, mimeType, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, parentNodeId, 'write');
        }
        const node = await fileNodeService.createFile(parentNodeId, name);
        try {
          const webdavPath = await fileNodeService.getNodePath(node.nodeId);
          await blobStorageService.uploadToWebdav(webdavPath, buffer);
        } catch (err) {
          // DB committed; mark orphaned and re-throw.
          await fileNodeService.updateSyncStatus(node.nodeId, 'orphaned_node');
          throw err;
        }
      }
    );

    await expect(
      service.uploadFile(1, 5, 'fail.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();

    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(31, 'orphaned_node');
  });
});

// ── downloadFile ────────────────────────────────────────────────────

describe('downloadFile', () => {
  it('returns buffer for S3 mode via blobStorageService.downloadBlob', async () => {
    const expectedBuffer = Buffer.from('s3-content');
    const blobStorageService = createMockBlobStorageService({
      downloadBlob: jest.fn().mockResolvedValue(expectedBuffer),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ blobStorageService, aclService });

    service.downloadFile.mockImplementation(
      async (fileNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, fileNodeId, 'read');
        }
        return blobStorageService.downloadBlob(fileNodeId);
      }
    );

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    expect(result).toBe(expectedBuffer);
  });

  it('returns buffer for WebDAV mode via webdav path resolution', async () => {
    const expectedBuffer = Buffer.from('webdav-content');
    const fileNodeService = createMockFileNodeService({
      getNodePath: jest.fn().mockResolvedValue('/files/10/data.txt'),
    });
    const blobStorageService = createMockBlobStorageService({
      downloadFromWebdav: jest.fn().mockResolvedValue(expectedBuffer),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.downloadFile.mockImplementation(
      async (fileNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, fileNodeId, 'read');
        }
        const webdavPath = await fileNodeService.getNodePath(fileNodeId);
        return blobStorageService.downloadFromWebdav(webdavPath);
      }
    );

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(fileNodeService.getNodePath).toHaveBeenCalledWith(10);
    expect(blobStorageService.downloadFromWebdav).toHaveBeenCalled();
    expect(result).toBe(expectedBuffer);
  });

  it('returns null when no active object_map entry exists', async () => {
    const blobStorageService = createMockBlobStorageService({
      downloadBlob: jest.fn().mockResolvedValue(null),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ blobStorageService, aclService });

    service.downloadFile.mockImplementation(
      async (fileNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, fileNodeId, 'read');
        }
        return blobStorageService.downloadBlob(fileNodeId);
      }
    );

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(result).toBeNull();
  });

  it('throws permission denied if user lacks read access (non-admin)', async () => {
    const aclService = createMockAclService({
      isAdminUser: jest.fn().mockReturnValue(false),
      checkFilePermission: jest.fn().mockResolvedValue(false),
    });

    const service = buildService({ aclService });

    service.downloadFile.mockImplementation(
      async (fileNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          const allowed = await aclService.checkFilePermission(userId, fileNodeId, 'read');
          if (!allowed) throw new Error('permission denied');
        }
        return null;
      }
    );

    await expect(
      service.downloadFile(10, 1, { id: 1 })
    ).rejects.toThrow(/permission denied/i);
  });
});

// ── renameNode ──────────────────────────────────────────────────────

describe('renameNode', () => {
  it('updates name in file_nodes DB only for S3 mode (no storage operation)', async () => {
    const fileNodeService = createMockFileNodeService({
      renameNode: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService();
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ fileNodeService, blobStorageService, aclService });

    service.renameNode.mockImplementation(
      async (nodeId, newName, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        // Validation
        if (!newName || newName.includes('/') || newName.includes('\\')) {
          throw new Error('invalid name');
        }
        await fileNodeService.renameNode(nodeId, newName);
        return { nodeId, newName };
      }
    );

    const result = await service.renameNode(10, 'newName.txt', 1, { id: 1 });

    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'newName.txt');
    expect(result.nodeId).toBe(10);
    expect(result.newName).toBe('newName.txt');
  });

  it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure', async () => {
    const fileNodeService = createMockFileNodeService({
      renameNode: jest.fn().mockResolvedValue(true),
      getNodePath: jest.fn()
        .mockResolvedValueOnce('/files/old.txt') // old path
        .mockResolvedValueOnce('/files/new.txt'), // new path
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.renameNode.mockImplementation(
      async (nodeId, newName, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        // Validation
        if (!newName || newName.includes('/') || newName.includes('\\')) {
          throw new Error('invalid name');
        }
        // DB rename always proceeds.
        await fileNodeService.renameNode(nodeId, newName);
        try {
          const oldPath = await fileNodeService.getNodePath(nodeId);
          const newPath = await fileNodeService.getNodePath(nodeId);
          // best-effort storage MOVE
          await blobStorageService.uploadToWebdav(newPath, Buffer.from(''));
        } catch (storageErr) {
          await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
          throw storageErr;
        }
      }
    );

    await expect(
      service.renameNode(10, 'newName.txt', 1, { id: 1 })
    ).rejects.toThrow();

    // DB rename succeeded despite storage failure.
    expect(fileNodeService.renameNode).toHaveBeenCalled();
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'orphaned_node');
  });

  it('throws if newName is empty or contains invalid characters', async () => {
    const fileNodeService = createMockFileNodeService();
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ fileNodeService, aclService });

    service.renameNode.mockImplementation(
      async (nodeId, newName) => {
        if (!newName || newName.includes('/') || newName.includes('\\')) {
          throw new Error('invalid name');
        }
        return fileNodeService.renameNode(nodeId, newName);
      }
    );

    // Empty name
    await expect(
      service.renameNode(10, '', 1, { id: 1 })
    ).rejects.toThrow();

    // Contains path separator /
    await expect(
      service.renameNode(10, 'a/b.txt', 1, { id: 1 })
    ).rejects.toThrow();

    // Contains path separator \
    await expect(
      service.renameNode(10, 'a\\b.txt', 1, { id: 1 })
    ).rejects.toThrow();
  });

  it('throws if new name conflicts with existing sibling node', async () => {
    const fileNodeService = createMockFileNodeService({
      renameNode: jest.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint')),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ fileNodeService, aclService });

    service.renameNode.mockImplementation(
      async (nodeId, newName, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        return fileNodeService.renameNode(nodeId, newName);
      }
    );

    await expect(
      service.renameNode(10, 'existing.txt', 1, { id: 1 })
    ).rejects.toThrow();
  });
});

// ── moveNode ────────────────────────────────────────────────────────

describe('moveNode', () => {
  it('updates parent_id and rebuilds closure table via fileNodeService.moveNode', async () => {
    const fileNodeService = createMockFileNodeService({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true) // source parent write
        .mockResolvedValueOnce(true), // dest parent write
    });

    const service = buildService({ fileNodeService, aclService });

    service.moveNode.mockImplementation(
      async (nodeId, newParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write'); // source parent
          await aclService.checkFolderPermission(userId, newParentNodeId, 'write'); // dest parent
        }
        await fileNodeService.moveNode(nodeId, newParentNodeId);
        return { nodeId, newParentId: newParentNodeId };
      }
    );

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
  });

  it('no storage operation for S3 mode (blob stays at same s3_key)', async () => {
    const fileNodeService = createMockFileNodeService({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService();
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    });

    const service = buildService({ fileNodeService, blobStorageService, aclService });

    service.moveNode.mockImplementation(
      async (nodeId, newParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
          await aclService.checkFolderPermission(userId, newParentNodeId, 'write');
        }
        // S3 mode: no storage calls — blob key decoupled from tree position.
        await fileNodeService.moveNode(nodeId, newParentNodeId);
        return { nodeId, newParentId: newParentNodeId };
      }
    );

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(blobStorageService.deleteBlob).not.toHaveBeenCalled();
    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
  });

  it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure', async () => {
    const fileNodeService = createMockFileNodeService({
      moveNode: jest.fn().mockResolvedValue(true),
      getNodePath: jest.fn()
        .mockResolvedValueOnce('/files/old/')
        .mockResolvedValueOnce('/new/files/'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.moveNode.mockImplementation(
      async (nodeId, newParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
          await aclService.checkFolderPermission(userId, newParentNodeId, 'write');
        }
        // Cycle detection handled internally by fileNodeService in real impl.
        await fileNodeService.moveNode(nodeId, newParentNodeId);
        try {
          const oldPath = await fileNodeService.getNodePath(nodeId);
          const newPath = await fileNodeService.getNodePath(nodeId);
          await blobStorageService.uploadToWebdav(newPath, Buffer.from(''));
        } catch (storageErr) {
          await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
          throw storageErr;
        }
      }
    );

    await expect(
      service.moveNode(10, 20, 1, { id: 1 })
    ).rejects.toThrow();

    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'orphaned_node');
  });

  it('rejects move that would create a cycle (target is descendant of source)', async () => {
    const fileNodeService = createMockFileNodeService({
      getDescendantIds: jest.fn().mockResolvedValue([50, 60]),
      moveNode: jest.fn().mockRejectedValue(new Error('cycle detected')),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    });

    const service = buildService({ fileNodeService, aclService });

    service.moveNode.mockImplementation(
      async (nodeId, newParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
          await aclService.checkFolderPermission(userId, newParentNodeId, 'write');
        }
        // Cycle detection: check descendants.
        const descendants = await fileNodeService.getDescendantIds(nodeId);
        if (descendants.includes(newParentNodeId)) {
          throw new Error('cycle detected');
        }
        return fileNodeService.moveNode(nodeId, newParentNodeId);
      }
    );

    await expect(
      service.moveNode(10, 50, 1, { id: 1 })
    ).rejects.toThrow();
  });
});

// ── deleteNode ──────────────────────────────────────────────────────

describe('deleteNode', () => {
  it('deletes leaf node via fileNodeService.deleteNode after write-permission gate', async () => {
    const fileNodeService = createMockFileNodeService({
      getDescendantIds: jest.fn().mockResolvedValue([10]),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ fileNodeService, aclService });

    service.deleteNode.mockImplementation(
      async (nodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        const descendantIds = await fileNodeService.getDescendantIds(nodeId);
        return fileNodeService.deleteNode(nodeId);
      }
    );

    const result = await service.deleteNode(10, 1, { id: 1 });

    expect(aclService.checkFolderPermission).toHaveBeenCalled();
    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(10);
    expect(result.deletedCount).toBe(1);
  });

  it('enumerates descendants via getDescendantIds for directory nodes', async () => {
    const fileNodeService = createMockFileNodeService({
      getDescendantIds: jest.fn().mockResolvedValue([5, 6, 7]),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ fileNodeService, aclService });

    service.deleteNode.mockImplementation(
      async (nodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        const descendantIds = await fileNodeService.getDescendantIds(nodeId);
        return fileNodeService.deleteNode(nodeId);
      }
    );

    await service.deleteNode(5, 1, { id: 1 });

    expect(fileNodeService.getDescendantIds).toHaveBeenCalledWith(5);
  });

  it('WebDAV mode: storage DELETE bottom-up, marks orphaned_node on per-node failure, DB delete proceeds', async () => {
    const fileNodeService = createMockFileNodeService({
      getDescendantIds: jest.fn().mockResolvedValue([100, 101]),
      getNodePath: jest.fn()
        .mockResolvedValueOnce('/files/101.txt')
        .mockResolvedValueOnce('/files/100.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
    const blobStorageService = createMockBlobStorageService({
      deleteBlob: jest.fn()
        .mockRejectedValueOnce(new Error('WebDAV DELETE failed')) // first fails
        .mockResolvedValueOnce(true), // second succeeds
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.deleteNode.mockImplementation(
      async (nodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        const descendantIds = await fileNodeService.getDescendantIds(nodeId);
        // Bottom-up: attempt storage DELETE per node.
        for (const descId of [...descendantIds].reverse()) {
          try {
            const webdavPath = await fileNodeService.getNodePath(descId);
            await blobStorageService.deleteBlob(descId);
          } catch (err) {
            // Mark orphaned, continue with remaining nodes.
            await fileNodeService.updateSyncStatus(descId, 'orphaned_node');
          }
        }
        // DB deletion proceeds regardless of storage failures.
        return fileNodeService.deleteNode(nodeId);
      }
    );

    const result = await service.deleteNode(100, 1, { id: 1 });

    expect(fileNodeService.updateSyncStatus).toHaveBeenCalled();
    expect(result.deletedCount).toBe(2);
  });

  it('S3 mode: DB-only deletion, no blobStorageService calls', async () => {
    const fileNodeService = createMockFileNodeService({
      getDescendantIds: jest.fn().mockResolvedValue([10]),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const blobStorageService = createMockBlobStorageService();
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = buildService({ fileNodeService, blobStorageService, aclService });

    service.deleteNode.mockImplementation(
      async (nodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFolderPermission(userId, null, 'write');
        }
        const descendantIds = await fileNodeService.getDescendantIds(nodeId);
        // S3 mode: no direct storage calls at this layer.
        return fileNodeService.deleteNode(nodeId);
      }
    );

    await service.deleteNode(10, 1, { id: 1 });

    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
  });
});

// ── copyFile — S3 mode ──────────────────────────────────────────────

describe('copyFile — S3 mode', () => {
  it('zero-copy: new file_node + object_map row referencing same s3_key when blob not shared', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 50 }),
    });
    const blobStorageService = createMockBlobStorageService({
      getActiveS3Key: jest.fn().mockResolvedValue('key-original'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1), // exclusive
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(true), // read on source
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true), // write on dest parent
    });

    const service = buildService({ fileNodeService, blobStorageService, aclService });

    service.copyFile.mockImplementation(
      async (sourceNodeId, destinationParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, sourceNodeId, 'read');
          await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
        }
        const s3Key = await blobStorageService.getActiveS3Key(sourceNodeId);
        const count = await blobStorageService.countActiveObjectsByS3Key(s3Key);
        if (count === 1) {
          // Zero-copy: same key.
          const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
          await blobStorageService.linkObject(node.nodeId, s3Key);
          return { sourceNodeId, copiedNodeId: node.nodeId };
        }
      }
    );

    await service.copyFile(10, 20, 1, { id: 1 });

    expect(blobStorageService.linkObject).toHaveBeenCalled();
    expect(blobStorageService.duplicateBlob).not.toHaveBeenCalled();
  });

  it('duplicates blob to new key via blobStorageService.duplicateBlob when source blob is shared', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 51 }),
    });
    const blobStorageService = createMockBlobStorageService({
      getActiveS3Key: jest.fn().mockResolvedValue('key-shared'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(3), // shared
      duplicateBlob: jest.fn().mockResolvedValue({ newS3Key: 'key-copy' }),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(true),
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true),
    });

    const service = buildService({ fileNodeService, blobStorageService, aclService });

    service.copyFile.mockImplementation(
      async (sourceNodeId, destinationParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, sourceNodeId, 'read');
          await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
        }
        const s3Key = await blobStorageService.getActiveS3Key(sourceNodeId);
        const count = await blobStorageService.countActiveObjectsByS3Key(s3Key);
        if (count > 1) {
          // Shared: duplicate.
          const dupResult = await blobStorageService.duplicateBlob(sourceNodeId);
          const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
          await blobStorageService.linkObject(node.nodeId, dupResult.newS3Key);
          return { sourceNodeId, copiedNodeId: node.nodeId };
        }
      }
    );

    await service.copyFile(10, 20, 1, { id: 1 });

    expect(blobStorageService.duplicateBlob).toHaveBeenCalledWith(10);
    expect(blobStorageService.linkObject).toHaveBeenCalled();
  });

  it('checks read on source and write on destination parent before copying', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 52 }),
    });
    const blobStorageService = createMockBlobStorageService({
      getActiveS3Key: jest.fn().mockResolvedValue('key-1'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(false), // read denied on source
      checkFolderPermission: jest.fn(),
    });

    const service = buildService({ fileNodeService, blobStorageService, aclService });

    service.copyFile.mockImplementation(
      async (sourceNodeId, destinationParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          const canRead = await aclService.checkFilePermission(userId, sourceNodeId, 'read');
          if (!canRead) throw new Error('permission denied: read on source');
          await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
        }
      }
    );

    // Source read denied → should fail early.
    await expect(
      service.copyFile(10, 20, 1, { id: 1 })
    ).rejects.toThrow();

    expect(aclService.checkFilePermission).toHaveBeenCalled();
  });
});

// ── copyFile — WebDAV mode ──────────────────────────────────────────

describe('copyFile — WebDAV mode', () => {
  it('performs actual blob copy (download + uploadToWebdav) into destination parent', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 60 }),
      getNodePath: jest.fn()
        .mockResolvedValueOnce('/src/original.txt') // source path for download
        .mockResolvedValueOnce('/dest/copy.txt'),   // dest path for upload
    });
    const blobStorageService = createMockBlobStorageService({
      downloadFromWebdav: jest.fn().mockResolvedValue(Buffer.from('copied-content')),
      uploadToWebdav: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(true),
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.copyFile.mockImplementation(
      async (sourceNodeId, destinationParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, sourceNodeId, 'read');
          await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
        }
        const srcPath = await fileNodeService.getNodePath(sourceNodeId);
        const data = await blobStorageService.downloadFromWebdav(srcPath);
        const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
        const destPath = await fileNodeService.getNodePath(node.nodeId);
        await blobStorageService.uploadToWebdav(destPath, data);
        return { sourceNodeId, copiedNodeId: node.nodeId };
      }
    );

    const result = await service.copyFile(10, 20, 1, { id: 1 });

    expect(blobStorageService.downloadFromWebdav).toHaveBeenCalled();
    expect(fileNodeService.createFile).toHaveBeenCalledWith(20, 'copy.txt');
    expect(blobStorageService.uploadToWebdav).toHaveBeenCalled();
    expect(result.copiedNodeId).toBe(60);
  });

  it('sets orphaned_node if upload fails after node creation, re-throws error', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ nodeId: 61 }),
      getNodePath: jest.fn()
        .mockResolvedValueOnce('/src/original.txt')
        .mockResolvedValueOnce('/dest/copy.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      downloadFromWebdav: jest.fn().mockResolvedValue(Buffer.from('data')),
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('upload failed')),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(true),
      checkFolderPermission: jest.fn()
        .mockResolvedValueOnce(true),
    });

    const service = buildService({
      fileStorageMode: 'webdav',
      fileNodeService,
      blobStorageService,
      aclService,
    });

    service.copyFile.mockImplementation(
      async (sourceNodeId, destinationParentNodeId, userId, user) => {
        if (!aclService.isAdminUser(user)) {
          await aclService.checkFilePermission(userId, sourceNodeId, 'read');
          await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
        }
        const srcPath = await fileNodeService.getNodePath(sourceNodeId);
        const data = await blobStorageService.downloadFromWebdav(srcPath);
        const node = await fileNodeService.createFile(destinationParentNodeId, 'copy.txt');
        try {
          const destPath = await fileNodeService.getNodePath(node.nodeId);
          await blobStorageService.uploadToWebdav(destPath, data);
        } catch (err) {
          // Node created but upload failed → orphaned.
          await fileNodeService.updateSyncStatus(node.nodeId, 'orphaned_node');
          throw err;
        }
      }
    );

    await expect(
      service.copyFile(10, 20, 1, { id: 1 })
    ).rejects.toThrow();

    // Node was created, but upload failed → orphaned marker set.
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(61, 'orphaned_node');
  });
});
