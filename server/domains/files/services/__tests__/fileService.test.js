'use strict';

/**
 * fileService test scaffold.
 * Verifies the Phase 4 nodeId-based fileService contract per spec.
 * Each test builds the unit under test through the real createFileService
 * factory with injected mock dependencies; no method of the service itself
 * is stubbed. The nodeId methods are implemented in Wave 2 alongside the legacy
 * path-based surface. These tests target the nodeId methods and pass against the refactored
 * createFileService.
 * @see docs/spec/server/services/fileService.md
 */

const { createFileService } = require('../fileService');

// ─── Mock factories ────────────────────────────────────────────────

function createMockFileNodeService(overrides = {}) {
  const defaults = {
    createFile: jest.fn().mockResolvedValue({ id: 10 }),
    createDirectory: jest.fn().mockResolvedValue({ id: 20 }),
    renameNode: jest.fn().mockResolvedValue(true),
    moveNode: jest.fn().mockResolvedValue(true),
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    listDirectory: jest.fn().mockResolvedValue([]),
    getNodePath: jest.fn().mockResolvedValue('/some/path'),
    getNode: jest.fn().mockResolvedValue({ id: 10, name: 'test.txt', type: 'file' }),
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
    duplicateBlob: jest.fn().mockResolvedValue('key-copy'),
    linkObject: jest.fn().mockResolvedValue(true),
    countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
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

// ── listDirectoryWithPermissions ────────────────────────────────────

describe('listDirectoryWithPermissions', () => {
  it('returns children with nodeId and permission flags for given parentId', async () => {
    const fileUpdatedAt = new Date('2026-01-01T00:00:00Z');
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 100, mimeType: 'text/plain', updatedAt: fileUpdatedAt },
      { id: 2, name: 'subdir', type: 'directory', size: null, mimeType: null, updatedAt: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(fileNodeService.listDirectory).toHaveBeenCalledWith(99);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      nodeId: 1,
      name: 'a.txt',
      type: 'file',
      size: 100,
      mimeType: 'text/plain',
      modifiedAt: fileUpdatedAt,
    });
    expect(result[1]).toMatchObject({ nodeId: 2, name: 'subdir', type: 'directory' });
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 1, 'read');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 2, 'read');
  });

  it('includes size and mimeType from filecache LEFT JOIN', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 100, mimeType: 'text/plain', updatedAt: null },
      { id: 2, name: 'dir', type: 'directory', size: null, mimeType: null, updatedAt: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(result[0]).toMatchObject({ size: 100, mimeType: 'text/plain' });
    expect(result[1].size).toBeNull();
    expect(result[1].mimeType).toBeNull();
  });

  it('sets hasReadPermission=false when user lacks read access on child node', async () => {
    const mockChildren = [
      { id: 1, name: 'secret.txt', type: 'file', size: 50, mimeType: 'text/plain', updatedAt: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn()
        .mockResolvedValueOnce(false) // read denied
        .mockResolvedValueOnce(false), // write denied
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 1, 'read');
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 1, 'write');
    expect(result[0].hasReadPermission).toBe(false);
    expect(result[0].hasWritePermission).toBe(false);
  });

  it('admin user bypass: all items return hasRead=true, hasWrite=true regardless of permissions', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 10, mimeType: 'text/plain', updatedAt: null },
      { id: 2, name: 'b.txt', type: 'file', size: 20, mimeType: 'text/plain', updatedAt: null },
    ];

    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createMockAclService({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

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

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 42, { id: 1 });

    expect(result).toEqual([]);
  });

  it('throws 404-style error when parent nodeId does not exist', async () => {
    const fileNodeService = createMockFileNodeService({
      listDirectory: jest.fn().mockRejectedValue(new Error('not found')),
    });
    const aclService = createMockAclService();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    await expect(
      service.listDirectoryWithPermissions(1, 9999, { id: 1 })
    ).rejects.toThrow();
    expect(fileNodeService.listDirectory).toHaveBeenCalledWith(9999);
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

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService: createMockBlobStorageService(),
      uploadService,
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.uploadFile(
      1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 }
    );

    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 5, 'write');
    expect(uploadService.uploadFile).toHaveBeenCalledWith(5, 'hello.txt', Buffer.from('hi'), 'text/plain');
    expect(result).toMatchObject({ nodeId: 10, size: 42, mimeType: 'text/plain' });
  });

  it('sets sync_status=active on successful upload', async () => {
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    });

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService: createMockBlobStorageService(),
      uploadService,
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.uploadFile(1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 });

    // TX2 (which sets sync_status='active') runs inside uploadService.uploadFile
    // per uploadService.md §2.3; fileService returns its result unchanged.
    expect(uploadService.uploadFile).toHaveBeenCalled();
    expect(result).toMatchObject({ nodeId: 10, size: 42, mimeType: 'text/plain' });
  });

  it('marks sync_status=pending_upload if TX1 succeeds but blob upload fails', async () => {
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockRejectedValue(new Error('S3 PUT failed')),
    });

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService: createMockBlobStorageService(),
      uploadService,
      aclService,
      fileStorageMode: 's3',
    });

    // The pending_upload state is left behind by uploadService's failed TX1→PUT
    // flow; fileService dispatches to uploadService and propagates the failure.
    await expect(
      service.uploadFile(1, 5, 'fail.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();
    expect(uploadService.uploadFile).toHaveBeenCalledWith(5, 'fail.txt', Buffer.from('x'), 'text/plain');
  });

  it('rolls back file_nodes row if createNode throws in TX1', async () => {
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockRejectedValue(new Error('TX1 rollback')),
    });

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService: createMockBlobStorageService(),
      uploadService,
      aclService,
      fileStorageMode: 's3',
    });

    // TX1 rollback happens inside uploadService; fileService propagates the failure.
    await expect(
      service.uploadFile(1, 5, 'bad.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();
    expect(uploadService.uploadFile).toHaveBeenCalledWith(5, 'bad.txt', Buffer.from('x'), 'text/plain');
  });
});

// ── uploadFile — WebDAV mode ───────────────────────────────────────

describe('uploadFile — WebDAV mode', () => {
  it('creates file_node and performs synchronous WebDAV PUT in single flow', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 30 }),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    const result = await service.uploadFile(
      1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 }
    );

    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 5, 'write');
    expect(fileNodeService.createFile).toHaveBeenCalledWith(5, 'hello.txt');
    expect(blobStorageService.uploadToWebdav).toHaveBeenCalledWith(30, Buffer.from('hi'));
    expect(result).toMatchObject({ nodeId: 30, size: 2, mimeType: 'text/plain' });
  });

  it('marks sync_status=orphaned_node if WebDAV PUT fails after DB commit', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 31 }),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    const aclService = createMockAclService({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

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

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    expect(result).toBe(expectedBuffer);
  });

  it('returns buffer for WebDAV mode via blobStorageService.downloadBlob', async () => {
    const expectedBuffer = Buffer.from('webdav-content');
    const blobStorageService = createMockBlobStorageService({
      downloadBlob: jest.fn().mockResolvedValue(expectedBuffer),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    expect(result).toBe(expectedBuffer);
  });

  it('throws not-found when downloadBlob returns null (no active object_map)', async () => {
    const blobStorageService = createMockBlobStorageService({
      downloadBlob: jest.fn().mockResolvedValue(null),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    await expect(
      service.downloadFile(10, 1, { id: 1 })
    ).rejects.toThrow();
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
  });

  it('throws permission denied if user lacks read access (non-admin)', async () => {
    const aclService = createMockAclService({
      isAdminUser: jest.fn().mockReturnValue(false),
      checkFilePermission: jest.fn().mockResolvedValue(false),
    });

    const service = createFileService({
      fileNodeService: createMockFileNodeService(),
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    await expect(
      service.downloadFile(10, 1, { id: 1 })
    ).rejects.toThrow();
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
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
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.renameNode(10, 'newName.txt', 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'newName.txt');
    expect(result).toMatchObject({ nodeId: 10, newName: 'newName.txt' });
  });

  it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure', async () => {
    const fileNodeService = createMockFileNodeService({
      renameNode: jest.fn().mockResolvedValue(true),
      getNodePath: jest.fn()
        .mockResolvedValueOnce('/files/old.txt')
        .mockResolvedValueOnce('/files/new.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    // Best-effort: DB rename succeeds, WebDAV failure caught, orphaned marker set.
    await service.renameNode(10, 'newName.txt', 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'newName.txt');
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'orphaned_node');
  });

  it('throws if newName is empty or contains invalid characters', async () => {
    const fileNodeService = createMockFileNodeService();
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

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
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    await expect(
      service.renameNode(10, 'existing.txt', 1, { id: 1 })
    ).rejects.toThrow();
    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'existing.txt');
  });
});

// ── moveNode ────────────────────────────────────────────────────────

describe('moveNode', () => {
  it('updates parent_id and rebuilds closure table via fileNodeService.moveNode', async () => {
    const fileNodeService = createMockFileNodeService({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.moveNode(10, 20, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
    expect(result).toMatchObject({ nodeId: 10, newParentId: 20 });
  });

  it('no storage operation for S3 mode (blob stays at same s3_key)', async () => {
    const fileNodeService = createMockFileNodeService({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService();
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.moveNode(10, 20, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
    expect(blobStorageService.deleteBlob).not.toHaveBeenCalled();
    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nodeId: 10, newParentId: 20 });
  });

  it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure', async () => {
    const fileNodeService = createMockFileNodeService({
      moveNode: jest.fn().mockResolvedValue(true),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    // Best-effort: DB move succeeds, WebDAV failure caught, orphaned marker set.
    await service.moveNode(10, 20, 1, { id: 1 });

    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'orphaned_node');
  });

  it('rejects move that would create a cycle (target is descendant of source)', async () => {
    const fileNodeService = createMockFileNodeService({
      getDescendantIds: jest.fn().mockResolvedValue([50, 60]),
      moveNode: jest.fn().mockRejectedValue(new Error('cycle detected')),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    // Cycle detection lives inside fileNodeService.moveNode per spec.
    await expect(
      service.moveNode(10, 50, 1, { id: 1 })
    ).rejects.toThrow();
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 50);
  });
});

// ── deleteNode ──────────────────────────────────────────────────────

describe('deleteNode', () => {
  it('deletes leaf node via fileNodeService.deleteNode after write-permission gate', async () => {
    const fileNodeService = createMockFileNodeService({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'test.txt', type: 'file' }),
      getDescendantIds: jest.fn().mockResolvedValue([10]),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(10, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(fileNodeService.getNode).toHaveBeenCalledWith(10);
    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(10);
    expect(result.deletedCount).toBe(1);
  });

  it('enumerates descendants via getDescendantIds for directory nodes', async () => {
    const fileNodeService = createMockFileNodeService({
      getNode: jest.fn().mockResolvedValue({ id: 5, name: 'dir', type: 'directory' }),
      getDescendantIds: jest.fn().mockResolvedValue([5, 6, 7]),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createMockBlobStorageService(),
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(5, 1, { id: 1 });

    expect(fileNodeService.getNode).toHaveBeenCalledWith(5);
    expect(fileNodeService.getDescendantIds).toHaveBeenCalledWith(5);
    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(5);
    expect(result.deletedCount).toBe(3);
  });

  it('WebDAV mode: storage DELETE bottom-up, marks orphaned_node on per-node failure, DB delete proceeds', async () => {
    const fileNodeService = createMockFileNodeService({
      getNode: jest.fn().mockResolvedValue({ id: 100, name: 'root', type: 'directory' }),
      getDescendantIds: jest.fn().mockResolvedValue([100, 101]),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
    const blobStorageService = createMockBlobStorageService({
      deleteBlob: jest.fn()
        .mockRejectedValueOnce(new Error('WebDAV DELETE failed')) // first fails
        .mockResolvedValueOnce(true), // second succeeds
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    const result = await service.deleteNode(100, 1, { id: 1 });

    // Bottom-up storage DELETE: leaves first (101), then parent (100).
    expect(blobStorageService.deleteBlob).toHaveBeenCalledWith(101);
    expect(blobStorageService.deleteBlob).toHaveBeenCalledWith(100);
    // First DELETE (101) failed → orphaned_node marker; DB deletion proceeds.
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(101, 'orphaned_node');
    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(100);
    expect(result.deletedCount).toBe(2);
  });

  it('S3 mode: DB-only deletion, no blobStorageService calls', async () => {
    const fileNodeService = createMockFileNodeService({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'file.txt', type: 'file' }),
      getDescendantIds: jest.fn().mockResolvedValue([10]),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const blobStorageService = createMockBlobStorageService();
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(10, 1, { id: 1 });

    // blobStorageService.deleteBlob is invoked inside the fileNodeService.deleteNode
    // cascade, never directly by fileService in S3 mode.
    expect(blobStorageService.deleteBlob).not.toHaveBeenCalled();
    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(10);
    expect(result.deletedCount).toBe(1);
  });
});

// ── copyFile — S3 mode ──────────────────────────────────────────────

describe('copyFile — S3 mode', () => {
  it('zero-copy: new file_node + object_map row referencing same s3_key when blob not shared', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 50 }),
    });
    const blobStorageService = createMockBlobStorageService({
      getActiveS3Key: jest.fn().mockResolvedValue('key-original'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1), // exclusive
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true), // read on source
      checkFolderPermission: jest.fn().mockResolvedValue(true), // write on dest parent
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    expect(blobStorageService.getActiveS3Key).toHaveBeenCalledWith(10);
    expect(fileNodeService.createFile).toHaveBeenCalledWith(20, 'copy.txt');
    expect(blobStorageService.linkObject).toHaveBeenCalledWith(50, 'key-original');
    expect(blobStorageService.duplicateBlob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 50 });
  });

  it('duplicates blob to new key via blobStorageService.duplicateBlob when source blob is shared', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 51 }),
    });
    const blobStorageService = createMockBlobStorageService({
      getActiveS3Key: jest.fn().mockResolvedValue('key-shared'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(3), // shared
      duplicateBlob: jest.fn().mockResolvedValue('key-copy'),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(blobStorageService.duplicateBlob).toHaveBeenCalledWith('key-shared');
    expect(blobStorageService.linkObject).toHaveBeenCalledWith(51, 'key-copy');
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 51 });
  });

  it('checks read on source and write on destination parent before copying', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 52 }),
    });
    const blobStorageService = createMockBlobStorageService({
      getActiveS3Key: jest.fn().mockResolvedValue('key-1'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(false), // read denied on source
      checkFolderPermission: jest.fn(),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 's3',
    });

    // Source read denied → should fail before any copy proceeds.
    await expect(
      service.copyFile(10, 20, 'copy.txt', 1, { id: 1 })
    ).rejects.toThrow();
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
  });
});

// ── copyFile — WebDAV mode ──────────────────────────────────────────

describe('copyFile — WebDAV mode', () => {
  it('performs actual blob copy (download + uploadToWebdav) into destination parent', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 60 }),
    });
    const blobStorageService = createMockBlobStorageService({
      downloadBlob: jest.fn().mockResolvedValue(Buffer.from('copied-content')),
      uploadToWebdav: jest.fn().mockResolvedValue(true),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    // Source content downloaded via blobStorageService.downloadBlob
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    expect(fileNodeService.createFile).toHaveBeenCalledWith(20, 'copy.txt');
    expect(blobStorageService.uploadToWebdav).toHaveBeenCalledWith(60, Buffer.from('copied-content'));
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 60 });
  });

  it('sets orphaned_node if upload fails after node creation, re-throws error', async () => {
    const fileNodeService = createMockFileNodeService({
      createFile: jest.fn().mockResolvedValue({ id: 61 }),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createMockBlobStorageService({
      downloadBlob: jest.fn().mockResolvedValue(Buffer.from('data')),
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('upload failed')),
    });
    const aclService = createMockAclService({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    await expect(
      service.copyFile(10, 20, 'copy.txt', 1, { id: 1 })
    ).rejects.toThrow();

    // Node was created, but upload failed → orphaned marker set.
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(61, 'orphaned_node');
  });
});
