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
const {
  createFileNodeServiceMock,
  createAclServiceMock,
  createBlobStorageServiceMock,
} = require('@testing/mocks/serviceMocks');

// ─── Mock factories ────────────────────────────────────────────────

function createMockUploadService(overrides = {}) {
  const defaults = {
    uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    overwriteFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('downloaded')),
  };
  return { ...defaults, ...overrides };
}

function createOwnerNodeResolverMock(overrides = {}) {
  const defaults = {
    isOwnerNode: jest.fn().mockResolvedValue(false),
  };
  return { ...defaults, ...overrides };
}

function createPermissionStoreMock(overrides = {}) {
  const defaults = {
    revokeUserSubtreePermissions: jest.fn().mockResolvedValue({ removedPaths: 0, removedFiles: 0 }),
    getUserPermissions: jest.fn().mockResolvedValue([]),
  };
  return { ...defaults, ...overrides };
}

// Shared listing deps: the real permissionStore/ownerNodeResolver require a DB,
// so listing tests inject mocks. Ownership (isOwnerNode) is the seam that
// decides hasAdminPermission for own nodes; getUserPermissions provides the
// literal-admin-grant rows (admin received on shared folders).
function createListingDeps(overrides = {}) {
  return {
    ownerNodeResolver: createOwnerNodeResolverMock(overrides.ownerNodeResolver),
    permissionStore: createPermissionStoreMock(overrides.permissionStore),
  };
}

// ── listDirectoryWithPermissions ────────────────────────────────────

describe('listDirectoryWithPermissions', () => {
  it('returns children with nodeId and permission flags for given parentId', async () => {
    const fileUpdatedAt = new Date('2026-01-01T00:00:00Z');
    const mockChildren = [
      {
        id: 1,
        name: 'a.txt',
        type: 'file',
        size: 100,
        mimeType: 'text/plain',
        updatedAt: fileUpdatedAt,
      },
      { id: 2, name: 'subdir', type: 'directory', size: null, mimeType: null, updatedAt: null },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createAclServiceMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
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
    // Default deps: not an owner and no explicit admin grant → no admin capability.
    expect(result[0].hasAdminPermission).toBe(false);
    expect(result[1].hasAdminPermission).toBe(false);
  });

  it('includes size and mimeType from filecache LEFT JOIN', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 100, mimeType: 'text/plain', updatedAt: null },
      { id: 2, name: 'dir', type: 'directory', size: null, mimeType: null, updatedAt: null },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createAclServiceMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(result[0]).toMatchObject({ size: 100, mimeType: 'text/plain' });
    expect(result[1].size).toBeNull();
    expect(result[1].mimeType).toBeNull();
  });

  it('retains unreadable children with hasReadPermission=false for a regular user listing', async () => {
    const mockChildren = [
      {
        id: 1,
        name: 'secret.txt',
        type: 'file',
        size: 50,
        mimeType: 'text/plain',
        updatedAt: null,
      },
      {
        id: 2,
        name: 'readable.txt',
        type: 'file',
        size: 30,
        mimeType: 'text/plain',
        updatedAt: null,
      },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
      getNodePath: jest.fn().mockResolvedValue('/some/path'),
    });
    const aclService = createAclServiceMock({
      isSharePrincipal: jest.fn().mockReturnValue(false), // regular (non-share) user
      checkFilePermission: jest
        .fn()
        // secret.txt: read denied, write denied
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        // readable.txt: read allowed, write allowed
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 1, 'read');
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 1, 'write');
    // Unreadable child is RETAINED with its flags false — the request-access
    // flow (E2E-OVERLAY-003) discovers unreadable children in another user's
    // folder via this listing.
    expect(result.map((i) => i.name)).toEqual(['secret.txt', 'readable.txt']);
    expect(result[0].hasReadPermission).toBe(false);
    expect(result[0].hasWritePermission).toBe(false);
    expect(result[1].hasReadPermission).toBe(true);
    // getNodePath is still resolved for the unreadable child, as before D2.
    expect(fileNodeService.getNodePath).toHaveBeenCalledWith(1);
  });

  it('excludes unreadable children for a share-principal listing', async () => {
    const mockChildren = [
      {
        id: 1,
        name: 'secret.txt',
        type: 'file',
        size: 50,
        mimeType: 'text/plain',
        updatedAt: null,
      },
      {
        id: 2,
        name: 'readable.txt',
        type: 'file',
        size: 30,
        mimeType: 'text/plain',
        updatedAt: null,
      },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
      getNodePath: jest.fn().mockResolvedValue('/some/path'),
    });
    const aclService = createAclServiceMock({
      isSharePrincipal: jest.fn().mockReturnValue(true), // share-token caller
      checkFilePermission: jest
        .fn()
        // secret.txt: read denied, write denied
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        // readable.txt: read allowed, write allowed
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions('share:token', 99, null);

    expect(aclService.checkFilePermission).toHaveBeenCalledWith('share:token', 1, 'read');
    expect(aclService.checkFilePermission).toHaveBeenCalledWith('share:token', 1, 'write');
    // Out-of-scope child is absent — name/path/type never disclosed to a share token.
    expect(result.map((i) => i.name)).toEqual(['readable.txt']);
    expect(fileNodeService.getNodePath).not.toHaveBeenCalledWith(1);
  });

  it('admin user bypass: all items return hasRead=true, hasWrite=true regardless of permissions', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 10, mimeType: 'text/plain', updatedAt: null },
      { id: 2, name: 'b.txt', type: 'file', size: 20, mimeType: 'text/plain', updatedAt: null },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 99, { id: 1 });

    expect(result[0].hasReadPermission).toBe(true);
    expect(result[0].hasWritePermission).toBe(true);
    expect(result[1].hasReadPermission).toBe(true);
    expect(result[1].hasWritePermission).toBe(true);
    expect(result[0].hasAdminPermission).toBe(true);
    // Admin bypass: no per-item permission calls.
    expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    expect(aclService.checkFolderPermission).not.toHaveBeenCalled();
  });

  it('returns empty array for leaf directory (no children)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue([]),
    });
    const aclService = createAclServiceMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 42, { id: 1 });

    expect(result).toEqual([]);
  });

  it('throws 404-style error when parent nodeId does not exist', async () => {
    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockRejectedValue(new Error('not found')),
    });
    const aclService = createAclServiceMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    await expect(service.listDirectoryWithPermissions(1, 9999, { id: 1 })).rejects.toThrow();
    expect(fileNodeService.listDirectory).toHaveBeenCalledWith(9999);
  });

  it('owner listing: every child reports hasAdminPermission=true via home-root ownership (no self-grant rows)', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 10, mimeType: 'text/plain', updatedAt: null },
      { id: 2, name: 'subdir', type: 'directory', size: null, mimeType: null, updatedAt: null },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
      getNodePath: jest.fn().mockResolvedValue('/own/a.txt'),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const { ownerNodeResolver, permissionStore } = createListingDeps({
      ownerNodeResolver: {
        isOwnerNode: jest.fn().mockResolvedValue(true), // parent under own home root
      },
      permissionStore: {
        getUserPermissions: jest.fn().mockResolvedValue([]), // no explicit grants at all
      },
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(2, 42, { id: 2 });

    expect(ownerNodeResolver.isOwnerNode).toHaveBeenCalledWith(2, 42);
    expect(result[0].hasAdminPermission).toBe(true);
    expect(result[1].hasAdminPermission).toBe(true);
  });

  it('non-owned listing: only children with an explicit admin grant report hasAdminPermission', async () => {
    const mockChildren = [
      {
        id: 1,
        name: 'granted.txt',
        type: 'file',
        size: 10,
        mimeType: 'text/plain',
        updatedAt: null,
      },
      { id: 2, name: 'plain.txt', type: 'file', size: 20, mimeType: 'text/plain', updatedAt: null },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
      getNodePath: jest.fn().mockResolvedValue('/shared/granted.txt'),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });
    const { ownerNodeResolver, permissionStore } = createListingDeps({
      ownerNodeResolver: {
        isOwnerNode: jest.fn().mockResolvedValue(false), // not under own home root
      },
      permissionStore: {
        getUserPermissions: jest.fn().mockResolvedValue([
          { file_node_id: 1, permission: 'admin', type: 'file' },
          { file_node_id: 5, permission: 'write', type: 'directory' },
        ]),
      },
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(2, 42, { id: 2 });

    expect(result[0].hasAdminPermission).toBe(true); // explicit admin grant
    expect(result[1].hasAdminPermission).toBe(false);
  });

  it('share-principal listing never reports admin capability and skips ownership queries', async () => {
    const mockChildren = [
      {
        id: 1,
        name: 'readable.txt',
        type: 'file',
        size: 10,
        mimeType: 'text/plain',
        updatedAt: null,
      },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
      getNodePath: jest.fn().mockResolvedValue('/shared/readable.txt'),
    });
    const aclService = createAclServiceMock({
      isSharePrincipal: jest.fn().mockReturnValue(true),
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });
    const { ownerNodeResolver, permissionStore } = createListingDeps();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions('share:tok', 42, null);

    expect(result[0].hasAdminPermission).toBe(false);
    expect(ownerNodeResolver.isOwnerNode).not.toHaveBeenCalled();
    expect(permissionStore.getUserPermissions).not.toHaveBeenCalled();
  });

  it('admin listing reports hasAdminPermission=true without ownership or grant queries', async () => {
    const mockChildren = [
      { id: 1, name: 'a.txt', type: 'file', size: 10, mimeType: 'text/plain', updatedAt: null },
    ];

    const fileNodeService = createFileNodeServiceMock({
      listDirectory: jest.fn().mockResolvedValue(mockChildren),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });
    const { ownerNodeResolver, permissionStore } = createListingDeps();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    const result = await service.listDirectoryWithPermissions(1, 42, { id: 1 });

    expect(result[0].hasAdminPermission).toBe(true);
    expect(ownerNodeResolver.isOwnerNode).not.toHaveBeenCalled();
    expect(permissionStore.getUserPermissions).not.toHaveBeenCalled();
  });
});

// ── uploadFile — S3 mode ───────────────────────────────────────────

describe('uploadFile — S3 mode', () => {
  it('creates file_node via uploadService.uploadFile and returns new nodeId', async () => {
    const aclService = createAclServiceMock({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService: createBlobStorageServiceMock(),
      uploadService,
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.uploadFile(1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', {
      id: 1,
    });

    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 5, 'write');
    expect(uploadService.uploadFile).toHaveBeenCalledWith(
      5,
      'hello.txt',
      Buffer.from('hi'),
      'text/plain'
    );
    expect(result).toMatchObject({ nodeId: 10, size: 42, mimeType: 'text/plain' });
  });

  it('sets sync_status=active on successful upload', async () => {
    const aclService = createAclServiceMock({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockResolvedValue({ nodeId: 10, size: 42, mimeType: 'text/plain' }),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService: createBlobStorageServiceMock(),
      uploadService,
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.uploadFile(1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', {
      id: 1,
    });

    // TX2 (which sets sync_status='active') runs inside uploadService.uploadFile
    // per uploadService.md §2.3; fileService returns its result unchanged.
    expect(result).toMatchObject({ nodeId: 10, size: 42, mimeType: 'text/plain' });
  });

  it('propagates S3 upload failure from uploadService (rollback happens inside uploadService)', async () => {
    const aclService = createAclServiceMock({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockRejectedValue(new Error('S3 PUT failed')),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService: createBlobStorageServiceMock(),
      uploadService,
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    // In S3 mode fileService dispatches to uploadService, which rolls the node
    // back on failure (uploadService.md §2.5); fileService propagates the error.
    await expect(
      service.uploadFile(1, 5, 'fail.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();
    expect(uploadService.uploadFile).toHaveBeenCalledWith(
      5,
      'fail.txt',
      Buffer.from('x'),
      'text/plain'
    );
  });

  it('rolls back file_nodes row if createNode throws in TX1', async () => {
    const aclService = createAclServiceMock({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const uploadService = createMockUploadService({
      uploadFile: jest.fn().mockRejectedValue(new Error('TX1 rollback')),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService: createBlobStorageServiceMock(),
      uploadService,
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    // TX1 rollback happens inside uploadService; fileService propagates the failure.
    await expect(
      service.uploadFile(1, 5, 'bad.txt', Buffer.from('x'), 'text/plain', { id: 1 })
    ).rejects.toThrow();
    expect(uploadService.uploadFile).toHaveBeenCalledWith(
      5,
      'bad.txt',
      Buffer.from('x'),
      'text/plain'
    );
  });
});

it('uses uploadService.overwriteFile when file already exists and onConflict is overwrite', async () => {
  const existingNodeId = 99;
  const mockChildren = [{ id: existingNodeId, name: 'hello.txt', type: 'file' }];

  const fileNodeService = createFileNodeServiceMock({
    listDirectory: jest.fn().mockResolvedValue(mockChildren),
  });

  const aclService = createAclServiceMock({
    checkFolderPermission: jest.fn().mockResolvedValue(true),
  });

  const uploadSvc = createMockUploadService({
    overwriteFile: jest
      .fn()
      .mockResolvedValue({ nodeId: existingNodeId, size: 42, mimeType: 'text/plain' }),
  });

  const service = createFileService({
    fileNodeService,
    blobStorageService: createBlobStorageServiceMock(),
    uploadService: uploadSvc,
    aclService,
    ...createListingDeps(),
    fileStorageMode: 's3',
  });

  const result = await service.uploadFile(
    1,
    5,
    'hello.txt',
    Buffer.from('new-content'),
    'text/plain',
    { id: 1 },
    'overwrite'
  );

  expect(uploadSvc.overwriteFile).toHaveBeenCalledWith(
    existingNodeId,
    Buffer.from('new-content'),
    'text/plain'
  );
  expect(result.nodeId).toBe(existingNodeId);
});

it('returns skipped:true when onConflict is skip and file exists', async () => {
  const existingNodeId = 99;
  const mockChildren = [{ id: existingNodeId, name: 'hello.txt', type: 'file' }];

  const fileNodeService = createFileNodeServiceMock({
    listDirectory: jest.fn().mockResolvedValue(mockChildren),
  });

  const aclService = createAclServiceMock({
    checkFolderPermission: jest.fn().mockResolvedValue(true),
  });

  const uploadSvc = createMockUploadService();

  const service = createFileService({
    fileNodeService,
    blobStorageService: createBlobStorageServiceMock(),
    uploadService: uploadSvc,
    aclService,
    ...createListingDeps(),
    fileStorageMode: 's3',
  });

  const result = await service.uploadFile(
    1,
    5,
    'hello.txt',
    Buffer.from('hi'),
    'text/plain',
    { id: 1 },
    'skip'
  );

  expect(result).toMatchObject({ nodeId: existingNodeId, skipped: true });
  expect(uploadSvc.uploadFile).not.toHaveBeenCalled();
  expect(uploadSvc.overwriteFile).not.toHaveBeenCalled();
});

it('throws conflictError when onConflict is error (default) and file exists', async () => {
  const mockChildren = [{ id: 99, name: 'hello.txt', type: 'file' }];

  const fileNodeService = createFileNodeServiceMock({
    listDirectory: jest.fn().mockResolvedValue(mockChildren),
  });

  const aclService = createAclServiceMock({
    checkFolderPermission: jest.fn().mockResolvedValue(true),
  });

  const service = createFileService({
    fileNodeService,
    blobStorageService: createBlobStorageServiceMock(),
    uploadService: createMockUploadService(),
    aclService,
    ...createListingDeps(),
    fileStorageMode: 's3',
  });

  await expect(
    service.uploadFile(1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', { id: 1 })
  ).rejects.toThrow();
});

// ── uploadFile — WebDAV mode ───────────────────────────────────────

describe('uploadFile — WebDAV mode', () => {
  it('creates file_node and performs synchronous WebDAV PUT in single flow', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 30 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      uploadToWebdav: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      fileStorageMode: 'webdav',
    });

    const result = await service.uploadFile(1, 5, 'hello.txt', Buffer.from('hi'), 'text/plain', {
      id: 1,
    });

    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 5, 'write');
    expect(fileNodeService.createFile).toHaveBeenCalledWith(5, 'hello.txt');
    expect(blobStorageService.uploadToWebdav).toHaveBeenCalledWith(30, Buffer.from('hi'));
    expect(result).toMatchObject({ nodeId: 30, size: 2, mimeType: 'text/plain' });
  });

  it('rolls back the new node if WebDAV PUT fails after DB commit', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 31 }),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    const aclService = createAclServiceMock({
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

    // New node is rolled back — no phantom 0-byte file remains.
    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(31);
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
  });
});

function createOverwriteWebdavMocks({ blobStore, uploadToWebdav } = {}) {
  const existingNodeId = 42;
  const fileNodeService = createFileNodeServiceMock({
    listDirectory: jest
      .fn()
      .mockResolvedValue([{ id: existingNodeId, name: 'hello.txt', type: 'file' }]),
    createFile: jest.fn(),
    getNodePath: jest.fn().mockResolvedValue('/user/hello.txt'),
    updateSyncStatus: jest.fn().mockResolvedValue(true),
    deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  });
  const blobStorageService = createBlobStorageServiceMock({ uploadToWebdav });
  const aclService = createAclServiceMock({
    checkFolderPermission: jest.fn().mockResolvedValue(true),
  });
  const service = createFileService({
    fileNodeService,
    blobStorageService,
    uploadService: createMockUploadService(),
    aclService,
    blobStore,
    fileStorageMode: 'webdav',
  });
  return { existingNodeId, fileNodeService, blobStorageService, service };
}

it('WebDAV overwrite snapshots last-good via native COPY, PUTs, then removes the snapshot', async () => {
  const blobStore = {
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    copyBlob: jest.fn().mockResolvedValue(undefined),
    moveBlob: jest.fn(),
    deleteBlob: jest.fn().mockResolvedValue(undefined),
  };
  const { existingNodeId, fileNodeService, blobStorageService, service } =
    createOverwriteWebdavMocks({
      blobStore,
      uploadToWebdav: jest.fn().mockResolvedValue(true),
    });

  const result = await service.uploadFile(
    1,
    5,
    'hello.txt',
    Buffer.from('new-content'),
    'text/plain',
    { id: 1 },
    'overwrite'
  );

  expect(fileNodeService.createFile).not.toHaveBeenCalled();
  expect(blobStore.ensureDirectoryExists).toHaveBeenCalledWith('/.wea-tmp');
  expect(blobStore.copyBlob).toHaveBeenCalledWith('/user/hello.txt', '/.wea-tmp/42');
  expect(blobStorageService.uploadToWebdav).toHaveBeenCalledWith(
    existingNodeId,
    Buffer.from('new-content')
  );
  expect(blobStore.deleteBlob).toHaveBeenCalledWith('/.wea-tmp/42');
  expect(result.nodeId).toBe(existingNodeId);
});

it('WebDAV overwrite PUT failure restores the snapshot (no marker, node kept)', async () => {
  const blobStore = {
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    copyBlob: jest.fn().mockResolvedValue(undefined),
    moveBlob: jest.fn().mockResolvedValue(undefined),
    deleteBlob: jest.fn(),
  };
  const { fileNodeService, service } = createOverwriteWebdavMocks({
    blobStore,
    uploadToWebdav: jest.fn().mockRejectedValue(new Error('connection refused')),
  });

  await expect(
    service.uploadFile(1, 5, 'hello.txt', Buffer.from('x'), 'text/plain', { id: 1 }, 'overwrite')
  ).rejects.toThrow('connection refused');

  // Last-good restore: MOVE tmp→display with overwrite, nothing marked, node kept.
  expect(blobStore.moveBlob).toHaveBeenCalledWith('/.wea-tmp/42', '/user/hello.txt', true);
  expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
  expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
});

it('WebDAV overwrite PUT failure with failed restore marks orphaned_node', async () => {
  const blobStore = {
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    copyBlob: jest.fn().mockResolvedValue(undefined),
    moveBlob: jest.fn().mockRejectedValue(new Error('restore failed')),
    deleteBlob: jest.fn(),
  };
  const { existingNodeId, fileNodeService, service } = createOverwriteWebdavMocks({
    blobStore,
    uploadToWebdav: jest.fn().mockRejectedValue(new Error('connection refused')),
  });

  // The ORIGINAL PUT error surfaces, not the restore error.
  await expect(
    service.uploadFile(1, 5, 'hello.txt', Buffer.from('x'), 'text/plain', { id: 1 }, 'overwrite')
  ).rejects.toThrow('connection refused');

  expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(existingNodeId, 'orphaned_node');
  expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
});

it('WebDAV overwrite snapshot COPY failure (transient) aborts before the destructive PUT', async () => {
  const blobStore = {
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    copyBlob: jest.fn().mockRejectedValue(new Error('COPY refused')),
    moveBlob: jest.fn(),
    deleteBlob: jest.fn(),
  };
  const { fileNodeService, blobStorageService, service } = createOverwriteWebdavMocks({
    blobStore,
    uploadToWebdav: jest.fn(),
  });

  await expect(
    service.uploadFile(1, 5, 'hello.txt', Buffer.from('x'), 'text/plain', { id: 1 }, 'overwrite')
  ).rejects.toThrow('COPY refused');

  expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
  expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
});

it('WebDAV overwrite with no remote content (snapshot 404) proceeds and marks on PUT failure', async () => {
  const sourceNotFound = new Error('remote source missing');
  sourceNotFound.errorCode = 'serverErrors.webdav.sourceNotFound';
  const blobStore = {
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    copyBlob: jest.fn().mockRejectedValue(sourceNotFound),
    moveBlob: jest.fn(),
    deleteBlob: jest.fn(),
  };
  const { existingNodeId, fileNodeService, blobStorageService, service } =
    createOverwriteWebdavMocks({
      blobStore,
      uploadToWebdav: jest.fn().mockRejectedValue(new Error('connection refused')),
    });

  await expect(
    service.uploadFile(1, 5, 'hello.txt', Buffer.from('x'), 'text/plain', { id: 1 }, 'overwrite')
  ).rejects.toThrow('connection refused');

  // Nothing to restore → no MOVE; the PUT was attempted and the node is flagged.
  expect(blobStorageService.uploadToWebdav).toHaveBeenCalled();
  expect(blobStore.moveBlob).not.toHaveBeenCalled();
  expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(existingNodeId, 'orphaned_node');
});

// ── downloadFile ────────────────────────────────────────────────────

describe('downloadFile', () => {
  it('returns buffer for S3 mode via blobStorageService.downloadBlob', async () => {
    const expectedBuffer = Buffer.from('s3-content');
    const blobStorageService = createBlobStorageServiceMock({
      downloadBlob: jest.fn().mockResolvedValue(expectedBuffer),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    expect(result).toBe(expectedBuffer);
  });

  it('returns buffer for WebDAV mode via blobStorageService.downloadBlob', async () => {
    const expectedBuffer = Buffer.from('webdav-content');
    const blobStorageService = createBlobStorageServiceMock({
      downloadBlob: jest.fn().mockResolvedValue(expectedBuffer),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
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
    const blobStorageService = createBlobStorageServiceMock({
      downloadBlob: jest.fn().mockResolvedValue(null),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    await expect(service.downloadFile(10, 1, { id: 1 })).rejects.toThrow();
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
  });

  it('throws not-found (404) if user lacks read access (non-admin)', async () => {
    const mockNotFound = jest.fn().mockImplementation(() => {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(false),
      checkFilePermission: jest.fn().mockResolvedValue(false),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      notFoundError: mockNotFound,
      fileStorageMode: 's3',
    });

    await expect(service.downloadFile(10, 1, { id: 1 })).rejects.toThrow();
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('admin bypass: downloads without permission check', async () => {
    const expectedBuffer = Buffer.from('admin-download');
    const blobStorageService = createBlobStorageServiceMock({
      downloadBlob: jest.fn().mockResolvedValue(expectedBuffer),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = createFileService({
      fileNodeService: createFileNodeServiceMock(),
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.downloadFile(10, 1, { id: 1 });

    expect(aclService.isAdminUser).toHaveBeenCalled();
    expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    expect(result).toBe(expectedBuffer);
  });
});

// ── renameNode ──────────────────────────────────────────────────────

describe('renameNode', () => {
  it('updates name in file_nodes DB only for S3 mode (no storage operation)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      renameNode: jest.fn().mockResolvedValue(true),
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([]),
    });
    const blobStorageService = createBlobStorageServiceMock();
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.renameNode(10, 'newName.txt', 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(fileNodeService.getNode).toHaveBeenCalledWith(10);
    expect(fileNodeService.listDirectory).toHaveBeenCalledWith(5);
    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'newName.txt');
    expect(result).toMatchObject({ nodeId: 10, newName: 'newName.txt' });
  });

  it('WebDAV mode: one native MOVE old→new path after the DB rename, no marker on success', async () => {
    const fileNodeService = createFileNodeServiceMock({
      renameNode: jest.fn().mockResolvedValue(true),
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([]),
      getNodePath: jest
        .fn()
        .mockResolvedValueOnce('/files/old.txt')
        .mockResolvedValueOnce('/files/newName.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStore = {
      moveBlob: jest.fn().mockResolvedValue(undefined),
      copyBlob: jest.fn().mockResolvedValue(undefined),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 'webdav',
    });

    const result = await service.renameNode(10, 'newName.txt', 1, { id: 1 });

    expect(fileNodeService.renameNode).toHaveBeenCalledTimes(1);
    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'newName.txt');
    expect(blobStore.moveBlob).toHaveBeenCalledWith('/files/old.txt', '/files/newName.txt');
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nodeId: 10, newName: 'newName.txt' });
  });

  it('WebDAV mode: MOVE failure rolls the DB rename back and re-throws (no marker)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      renameNode: jest.fn().mockResolvedValue(true),
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([]),
      getNodePath: jest
        .fn()
        .mockResolvedValueOnce('/files/old.txt')
        .mockResolvedValueOnce('/files/newName.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStore = {
      moveBlob: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 'webdav',
    });

    await expect(service.renameNode(10, 'newName.txt', 1, { id: 1 })).rejects.toThrow(
      'MOVE failed'
    );

    // Rollback: renameNode called again with the ORIGINAL name; no orphan marker.
    expect(fileNodeService.renameNode).toHaveBeenCalledTimes(2);
    expect(fileNodeService.renameNode).toHaveBeenLastCalledWith(10, 'old.txt');
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
  });

  it('WebDAV mode: failed rollback keeps the DB change, marks orphaned_node and re-throws', async () => {
    const fileNodeService = createFileNodeServiceMock({
      renameNode: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('old name taken')),
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([]),
      getNodePath: jest
        .fn()
        .mockResolvedValueOnce('/files/old.txt')
        .mockResolvedValueOnce('/files/newName.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStore = {
      moveBlob: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 'webdav',
    });

    // The ORIGINAL remote-sync error surfaces, not the rollback error.
    await expect(service.renameNode(10, 'newName.txt', 1, { id: 1 })).rejects.toThrow(
      'MOVE failed'
    );
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'orphaned_node');
  });

  it('WebDAV mode: source-not-found MOVE keeps the DB rename, marks orphaned_node, re-throws', async () => {
    const sourceNotFound = new Error('remote source missing');
    sourceNotFound.errorCode = 'serverErrors.webdav.sourceNotFound';
    const fileNodeService = createFileNodeServiceMock({
      renameNode: jest.fn().mockResolvedValue(true),
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([]),
      getNodePath: jest
        .fn()
        .mockResolvedValueOnce('/files/old.txt')
        .mockResolvedValueOnce('/files/newName.txt'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStore = {
      moveBlob: jest.fn().mockRejectedValue(sourceNotFound),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 'webdav',
    });

    await expect(service.renameNode(10, 'newName.txt', 1, { id: 1 })).rejects.toThrow(
      'remote source missing'
    );

    // Nothing to restore → the rename stands and is flagged for repair.
    expect(fileNodeService.renameNode).toHaveBeenCalledTimes(1);
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(10, 'orphaned_node');
  });

  it('throws if newName is empty, whitespace-only, or contains invalid characters', async () => {
    const fileNodeService = createFileNodeServiceMock();
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    // Empty name
    await expect(service.renameNode(10, '', 1, { id: 1 })).rejects.toThrow();

    // Whitespace-only name (trimmed to empty)
    await expect(service.renameNode(10, '   ', 1, { id: 1 })).rejects.toThrow();

    // Contains path separator /
    await expect(service.renameNode(10, 'a/b.txt', 1, { id: 1 })).rejects.toThrow();

    // Contains path separator \
    await expect(service.renameNode(10, 'a\\b.txt', 1, { id: 1 })).rejects.toThrow();
  });

  it('throws if new name conflicts with existing sibling node (pre-check)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([{ id: 20, name: 'existing.txt', type: 'file' }]),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    await expect(service.renameNode(10, 'existing.txt', 1, { id: 1 })).rejects.toThrow();
    // renameNode on fileNodesStore is never called — rejected at pre-check stage
    expect(fileNodeService.renameNode).not.toHaveBeenCalled();
  });

  it('admin bypass: skips permission check and proceeds directly', async () => {
    const fileNodeService = createFileNodeServiceMock({
      renameNode: jest.fn().mockResolvedValue(true),
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'old.txt', type: 'file', parent_id: 5 }),
      listDirectory: jest.fn().mockResolvedValue([]),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    await service.renameNode(10, 'newName.txt', 1, { id: 1 });

    expect(aclService.isAdminUser).toHaveBeenCalled();
    expect(fileNodeService.renameNode).toHaveBeenCalledWith(10, 'newName.txt');
  });
});

// ── moveNode ────────────────────────────────────────────────────────

describe('moveNode', () => {
  it('updates parent_id and rebuilds closure table via fileNodeService.moveNode', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver: createOwnerNodeResolverMock(),
      permissionStore: createPermissionStoreMock(),
      fileStorageMode: 's3',
    });

    const result = await service.moveNode(10, 20, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
    expect(result).toMatchObject({ nodeId: 10, newParentId: 20 });
  });

  it('no storage operation for S3 mode (blob stays at same s3_key)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createBlobStorageServiceMock();
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver: createOwnerNodeResolverMock(),
      permissionStore: createPermissionStoreMock(),
      fileStorageMode: 's3',
    });

    const result = await service.moveNode(10, 20, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nodeId: 10, newParentId: 20 });
  });

  it('WebDAV mode: one native MOVE old→new path after the DB move, no marker on success', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'x', type: 'file', parent_id: 5 }),
      moveNode: jest.fn().mockResolvedValue(true),
      getNodePath: jest.fn().mockResolvedValueOnce('/home/5/x').mockResolvedValueOnce('/home20/x'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStore = {
      moveBlob: jest.fn().mockResolvedValue(undefined),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver: createOwnerNodeResolverMock(),
      permissionStore: createPermissionStoreMock(),
      blobStore,
      fileStorageMode: 'webdav',
    });

    const result = await service.moveNode(10, 20, 1, { id: 1 });

    expect(fileNodeService.moveNode).toHaveBeenCalledTimes(1);
    expect(blobStore.moveBlob).toHaveBeenCalledWith('/home/5/x', '/home20/x');
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nodeId: 10, newParentId: 20 });
  });

  it('WebDAV mode: MOVE failure rolls the DB move back, skips D6 cleanup and re-throws', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'x', type: 'file', parent_id: 5 }),
      moveNode: jest.fn().mockResolvedValue(true),
      getNodePath: jest.fn().mockResolvedValueOnce('/home/5/x').mockResolvedValueOnce('/home20/x'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
    });
    const blobStore = {
      moveBlob: jest.fn().mockRejectedValue(new Error('MOVE failed')),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const ownerNodeResolver = createOwnerNodeResolverMock({
      isOwnerNode: jest.fn().mockImplementation(async (userId, nodeId) => nodeId === 10),
    });
    const permissionStore = createPermissionStoreMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      blobStore,
      fileStorageMode: 'webdav',
    });

    await expect(service.moveNode(10, 20, 1, { id: 1 })).rejects.toThrow('MOVE failed');

    // Rollback to the original parent; no marker, no ownership cleanup for an undone move.
    expect(fileNodeService.moveNode).toHaveBeenCalledTimes(2);
    expect(fileNodeService.moveNode).toHaveBeenLastCalledWith(10, 5);
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
    expect(permissionStore.revokeUserSubtreePermissions).not.toHaveBeenCalled();
  });

  it('rejects move that would create a cycle (target is descendant of source)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getDescendantIds: jest.fn().mockResolvedValue([50, 60]),
      moveNode: jest.fn().mockRejectedValue(new Error('cycle detected')),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver: createOwnerNodeResolverMock(),
      permissionStore: createPermissionStoreMock(),
      fileStorageMode: 's3',
    });

    // Cycle detection lives inside fileNodeService.moveNode per spec.
    await expect(service.moveNode(10, 50, 1, { id: 1 })).rejects.toThrow();
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 50);
  });

  it('admin bypass: skips permission checks and proceeds directly', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver: createOwnerNodeResolverMock(),
      permissionStore: createPermissionStoreMock(),
      fileStorageMode: 's3',
    });

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(aclService.isAdminUser).toHaveBeenCalled();
    expect(fileNodeService.moveNode).toHaveBeenCalledWith(10, 20);
  });

  // ── D6: ownership transfer (cross-user move) ─────────────────────

  it('D6: moving an owned node OUT of the mover home revokes the mover rows on the moved subtree', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const ownerNodeResolver = createOwnerNodeResolverMock({
      // node 10 is under mover home; destination 20 is NOT
      isOwnerNode: jest.fn().mockImplementation(async (userId, nodeId) => nodeId === 10),
    });
    const permissionStore = createPermissionStoreMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(ownerNodeResolver.isOwnerNode).toHaveBeenCalledWith(1, 10);
    expect(ownerNodeResolver.isOwnerNode).toHaveBeenCalledWith(1, 20);
    expect(permissionStore.revokeUserSubtreePermissions).toHaveBeenCalledWith(1, 10);
  });

  it('D6: moving within the mover own home does NOT revoke rows', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const ownerNodeResolver = createOwnerNodeResolverMock({
      isOwnerNode: jest.fn().mockResolvedValue(true), // source AND destination inside own home
    });
    const permissionStore = createPermissionStoreMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(ownerNodeResolver.isOwnerNode).toHaveBeenCalledWith(1, 10);
    expect(permissionStore.revokeUserSubtreePermissions).not.toHaveBeenCalled();
  });

  it('D6: mover that merely RECEIVED a grant (does not own) moving the node does NOT revoke rows', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const ownerNodeResolver = createOwnerNodeResolverMock({
      isOwnerNode: jest.fn().mockResolvedValue(false), // not under mover home
    });
    const permissionStore = createPermissionStoreMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(ownerNodeResolver.isOwnerNode).toHaveBeenCalledWith(1, 10);
    expect(permissionStore.revokeUserSubtreePermissions).not.toHaveBeenCalled();
  });

  it('D6: admin mover skips ownership detection and revocation entirely', async () => {
    const fileNodeService = createFileNodeServiceMock({
      moveNode: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });
    const ownerNodeResolver = createOwnerNodeResolverMock();
    const permissionStore = createPermissionStoreMock();

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ownerNodeResolver,
      permissionStore,
      fileStorageMode: 's3',
    });

    await service.moveNode(10, 20, 1, { id: 1 });

    expect(ownerNodeResolver.isOwnerNode).not.toHaveBeenCalled();
    expect(permissionStore.revokeUserSubtreePermissions).not.toHaveBeenCalled();
  });
});

// ── deleteNode (DEF-16 P2: soft-delete/trash) ───────────────────────

describe('deleteNode', () => {
  it('M1: trashes a leaf node via markSubtreeDeleted after the write-permission gate — fileNodeService.deleteNode is never called', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'test.txt', type: 'file' }),
      getDescendantIds: jest.fn().mockResolvedValue([]),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 1 }),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(10, 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'write');
    expect(fileNodeService.getNode).toHaveBeenCalledWith(10);
    expect(fileNodeService.getDescendantIds).toHaveBeenCalledWith(10);
    // Soft delete: every row of the subtree is marked deleted_at...
    expect(fileNodeService.markSubtreeDeleted).toHaveBeenCalledWith([10]);
    // ...and the hard-delete primitive stays untouched (repair/rollback only).
    expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(1);
  });

  it('M2: enumerates descendants via getDescendantIds and keeps the subtree-count semantics', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 5, name: 'dir', type: 'directory' }),
      getDescendantIds: jest.fn().mockResolvedValue([6, 7]),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 3 }),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(5, 1, { id: 1 });

    expect(fileNodeService.getNode).toHaveBeenCalledWith(5);
    expect(fileNodeService.getDescendantIds).toHaveBeenCalledWith(5);
    expect(fileNodeService.markSubtreeDeleted).toHaveBeenCalledWith([5, 6, 7]);
    // 2 descendants + 1 target node = 3 total trashed (count semantics unchanged)
    expect(result.deletedCount).toBe(3);
    expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
  });

  it('M3: WebDAV mode performs exactly ONE remote MOVE of the subtree root to /.wea-trash/<rootId>', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 100, name: 'root', type: 'directory' }),
      getDescendantIds: jest.fn().mockResolvedValue([101]),
      getNodePath: jest.fn().mockResolvedValue('/user/root'),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 2 }),
    });
    const blobStore = {
      headBlob: jest.fn().mockResolvedValue(null), // trash destination free
      moveBlob: jest.fn().mockResolvedValue(undefined),
      ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 'webdav',
    });

    const result = await service.deleteNode(100, 1, { id: 1 });

    // The destination is probed, then ONE MOVE of the subtree root happens —
    // no per-node remote calls.
    expect(blobStore.headBlob).toHaveBeenCalledWith('/.wea-trash/100');
    expect(blobStore.moveBlob).toHaveBeenCalledTimes(1);
    expect(blobStore.moveBlob).toHaveBeenCalledWith('/user/root', '/.wea-trash/100');
    expect(blobStore.deleteBlob).toBeUndefined();
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
    expect(fileNodeService.markSubtreeDeleted).toHaveBeenCalledWith([100, 101]);
    expect(result.deletedCount).toBe(2);
  });

  it('M3b: WebDAV MOVE failure marks the root orphaned_node, skips the trash marking and re-throws', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 100, name: 'root', type: 'directory' }),
      getDescendantIds: jest.fn().mockResolvedValue([101]),
      getNodePath: jest.fn().mockResolvedValue('/user/root'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 2 }),
    });
    const blobStore = {
      headBlob: jest.fn().mockResolvedValue(null), // destination free
      moveBlob: jest.fn().mockRejectedValue(new Error('MOVE failed')),
      ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 'webdav',
    });

    await expect(service.deleteNode(100, 1, { id: 1 })).rejects.toThrow('MOVE failed');

    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(100, 'orphaned_node');
    // Trash aborted — no deleted_at marking, no hard delete.
    expect(fileNodeService.markSubtreeDeleted).not.toHaveBeenCalled();
    expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
  });

  it('M3c: WebDAV pre-existing /.wea-trash/<nodeId> destination fails with a clear conflict error and no marking', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 100, name: 'root', type: 'directory' }),
      getDescendantIds: jest.fn().mockResolvedValue([101]),
      getNodePath: jest.fn().mockResolvedValue('/user/root'),
      updateSyncStatus: jest.fn().mockResolvedValue(true),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 2 }),
    });
    const blobStore = {
      headBlob: jest.fn().mockResolvedValue({ contentLength: 5 }), // destination exists
      moveBlob: jest.fn().mockResolvedValue(undefined),
      ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      conflictError: jest.fn().mockImplementation(() => {
        const err = new Error('trash target exists');
        err.status = 409;
        throw err;
      }),
      fileStorageMode: 'webdav',
    });

    await expect(service.deleteNode(100, 1, { id: 1 })).rejects.toThrow('trash target exists');

    // Never clobber: no MOVE, no orphaned marker, no deleted_at marking.
    expect(blobStore.moveBlob).not.toHaveBeenCalled();
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
    expect(fileNodeService.markSubtreeDeleted).not.toHaveBeenCalled();
  });

  it('M4: S3 mode does zero physical I/O — no blobStore/blobStorageService calls', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'file.txt', type: 'file' }),
      getDescendantIds: jest.fn().mockResolvedValue([]),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 1 }),
    });
    const blobStorageService = createBlobStorageServiceMock();
    const blobStore = { headBlob: jest.fn(), moveBlob: jest.fn() };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(10, 1, { id: 1 });

    expect(blobStore.headBlob).not.toHaveBeenCalled();
    expect(blobStore.moveBlob).not.toHaveBeenCalled();
    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
    expect(fileNodeService.markSubtreeDeleted).toHaveBeenCalledWith([10]);
    expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(1);
  });

  it('M5: admin bypass skips the permission check and trashes through the same pipeline', async () => {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 42, name: 'admin.txt', type: 'file' }),
      getDescendantIds: jest.fn().mockResolvedValue([]),
      markSubtreeDeleted: jest.fn().mockResolvedValue({ changes: 1 }),
    });
    const aclService = createAclServiceMock({
      isAdminUser: jest.fn().mockReturnValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService: createBlobStorageServiceMock(),
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.deleteNode(42, 1, { id: 1 });

    expect(aclService.isAdminUser).toHaveBeenCalled();
    expect(aclService.checkFilePermission).not.toHaveBeenCalled();
    expect(fileNodeService.markSubtreeDeleted).toHaveBeenCalledWith([42]);
    expect(fileNodeService.deleteNode).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(1);
  });
});

// ── copyFile — S3 mode ──────────────────────────────────────────────

describe('copyFile — S3 mode', () => {
  it('zero-copy: new file_node + object_map row referencing same s3_key when blob not shared', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 50 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      getActiveS3Key: jest.fn().mockResolvedValue('key-original'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1), // exclusive
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true), // read on source
      checkFolderPermission: jest.fn().mockResolvedValue(true), // write on dest parent
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
    expect(aclService.checkFolderPermission).toHaveBeenCalledWith(1, 20, 'write');
    expect(blobStorageService.getActiveS3Key).toHaveBeenCalledWith(10);
    expect(fileNodeService.createFile).toHaveBeenCalledWith(20, 'copy.txt');
    expect(blobStorageService.linkObject).toHaveBeenCalledWith(50, 'key-original');
    // A copy is immediately usable and migratable — never left pending_upload.
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(50, 'active');
    expect(blobStorageService.duplicateBlob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 50 });
  });

  it('duplicates blob to new key via blobStorageService.duplicateBlob when source blob is shared', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 51 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      getActiveS3Key: jest.fn().mockResolvedValue('key-shared'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(3), // shared
      duplicateBlob: jest.fn().mockResolvedValue('key-copy'),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(blobStorageService.duplicateBlob).toHaveBeenCalledWith('key-shared');
    expect(blobStorageService.linkObject).toHaveBeenCalledWith(51, 'key-copy');
    expect(fileNodeService.updateSyncStatus).toHaveBeenCalledWith(51, 'active');
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 51 });
  });

  it('checks read on source and write on destination parent before copying', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 52 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      getActiveS3Key: jest.fn().mockResolvedValue('key-1'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(false), // read denied on source
      checkFolderPermission: jest.fn(),
    });

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileStorageMode: 's3',
    });

    // Source read denied → should fail before any copy proceeds.
    await expect(service.copyFile(10, 20, 'copy.txt', 1, { id: 1 })).rejects.toThrow();
    expect(aclService.checkFilePermission).toHaveBeenCalledWith(1, 10, 'read');
  });

  it('mirrors the source filecache row onto the copied node (listing shows real size)', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 53 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      getActiveS3Key: jest.fn().mockResolvedValue('key-cow'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const fileNodesStore = {
      getCache: jest.fn().mockResolvedValue({ size: '2048', mime_type: 'text/plain' }),
      upsertCache: jest.fn().mockResolvedValue(undefined),
    };

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileNodesStore,
      fileStorageMode: 's3',
    });

    await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(fileNodesStore.getCache).toHaveBeenCalledWith(10);
    expect(fileNodesStore.upsertCache).toHaveBeenCalledWith(53, 2048, 'text/plain', null);
  });

  it('skips the cache mirror without crashing when the source has no filecache row', async () => {
    const fileNodeService = createFileNodeServiceMock({
      createFile: jest.fn().mockResolvedValue({ id: 54 }),
    });
    const blobStorageService = createBlobStorageServiceMock({
      getActiveS3Key: jest.fn().mockResolvedValue('key-nc'),
      countActiveObjectsByS3Key: jest.fn().mockResolvedValue(1),
      linkObject: jest.fn().mockResolvedValue(true),
    });
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const fileNodesStore = {
      getCache: jest.fn().mockResolvedValue(null),
      upsertCache: jest.fn(),
    };

    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      ...createListingDeps(),
      fileNodesStore,
      fileStorageMode: 's3',
    });

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(fileNodesStore.upsertCache).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 54 });
  });
});

// ── copyFile — WebDAV mode ──────────────────────────────────────────

describe('copyFile — WebDAV mode', () => {
  function makeCopyMocks({ type = 'file', copyBlob, headBlob } = {}) {
    const fileNodeService = createFileNodeServiceMock({
      getNode: jest.fn().mockResolvedValue({ id: 10, name: 'src.txt', type, parent_id: 5 }),
      createFile: jest.fn().mockResolvedValue({ id: 60 }),
      getNodePath: jest
        .fn()
        .mockResolvedValueOnce('/user/src.txt')
        .mockResolvedValueOnce('/dest/copy.txt'),
      deleteNode: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const blobStore = {
      copyBlob: copyBlob || jest.fn().mockResolvedValue(undefined),
      headBlob:
        headBlob || jest.fn().mockResolvedValue({ contentLength: 7, contentType: 'text/plain' }),
    };
    const fileNodesStore = { upsertCache: jest.fn().mockResolvedValue(true) };
    const aclService = createAclServiceMock({
      checkFilePermission: jest.fn().mockResolvedValue(true),
      checkFolderPermission: jest.fn().mockResolvedValue(true),
    });
    const blobStorageService = createBlobStorageServiceMock();
    const service = createFileService({
      fileNodeService,
      blobStorageService,
      uploadService: createMockUploadService(),
      aclService,
      blobStore,
      fileNodesStore,
      fileStorageMode: 'webdav',
    });
    return { fileNodeService, blobStore, blobStorageService, fileNodesStore, service };
  }

  it('server-side COPY + listing mirror via headBlob/upsertCache; no download/PUT round-trip', async () => {
    const { fileNodeService, blobStore, blobStorageService, fileNodesStore, service } =
      makeCopyMocks();

    const result = await service.copyFile(10, 20, 'copy.txt', 1, { id: 1 });

    expect(fileNodeService.createFile).toHaveBeenCalledWith(20, 'copy.txt');
    expect(blobStore.copyBlob).toHaveBeenCalledWith('/user/src.txt', '/dest/copy.txt');
    expect(fileNodesStore.upsertCache).toHaveBeenCalledWith(60, 7, 'text/plain', null);
    expect(blobStorageService.downloadBlob).not.toHaveBeenCalled();
    expect(blobStorageService.uploadToWebdav).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sourceNodeId: 10, copiedNodeId: 60 });
  });

  it('directory source: one COPY (subtree), no cache mirror', async () => {
    const { blobStore, fileNodesStore, service } = makeCopyMocks({ type: 'directory' });

    await service.copyFile(10, 20, 'copydir', 1, { id: 1 });

    expect(blobStore.copyBlob).toHaveBeenCalledWith('/user/src.txt', '/dest/copy.txt');
    expect(blobStore.headBlob).not.toHaveBeenCalled();
    expect(fileNodesStore.upsertCache).not.toHaveBeenCalled();
  });

  it('rolls back the copied node if COPY fails after node creation, re-throws error', async () => {
    const { fileNodeService, blobStore, service } = makeCopyMocks({
      copyBlob: jest.fn().mockRejectedValue(new Error('COPY failed')),
    });

    await expect(service.copyFile(10, 20, 'copy.txt', 1, { id: 1 })).rejects.toThrow('COPY failed');

    expect(fileNodeService.deleteNode).toHaveBeenCalledWith(60);
    expect(fileNodeService.updateSyncStatus).not.toHaveBeenCalled();
    expect(blobStore.headBlob).not.toHaveBeenCalled();
  });
});
