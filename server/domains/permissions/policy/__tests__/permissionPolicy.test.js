/**
 * permissionPolicy tests — nodeId-based permission checks.
 *
 * Verifies that canReadFolderNode, canWriteFolderNode, canGrantPermissionNode,
 * and canViewPermissionsNode operate on nodeIds with closure table inheritance.
 */

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

describe('permissionPolicy (nodeId)', () => {
  let permissionPolicy;
  let mockPermStore;
  let mockOwnerNodeResolver;
  let mockAclService;
  let mockUserModel;

  beforeEach(() => {
    jest.resetModules();

    mockPermStore = {
      checkPermission: jest.fn(),
      getEffectivePermission: jest.fn(),
      getFilePermission: jest.fn(),
    };

    mockOwnerNodeResolver = {
      isOwnerNode: jest.fn(),
      canAccessNode: jest.fn(),
    };

    mockAclService = {
      checkFilePermission: jest.fn(),
      checkFolderPermission: jest.fn(),
    };

    mockUserModel = {
      findById: jest.fn(),
    };

    jest.doMock('../../stores/permissionStore', () => mockPermStore);
    jest.doMock('../ownerNodeResolver', () => mockOwnerNodeResolver);
    jest.doMock('../../services/aclService', () => mockAclService);
    jest.doMock('../../../../models/User', () => mockUserModel);

    permissionPolicy = require('../permissionPolicy');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // V8: canReadFolder — TRUE if user has read permission on node or ancestor
  it('V8: returns true when user has READ permission via closure table', async () => {
    const userId = 1;
    const dirNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(true);

    const result = await permissionPolicy.canReadFolderNode(userId, dirNodeId);
    expect(result).toBe(true);
    expect(mockPermStore.checkPermission).toHaveBeenCalledWith(
      userId, dirNodeId, PERMISSIONS.READ
    );
  });

  it('V8b: returns false when user has no READ permission', async () => {
    const userId = 1;
    const dirNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(false);

    const result = await permissionPolicy.canReadFolderNode(userId, dirNodeId);
    expect(result).toBe(false);
  });

  it('V8c: returns true when user is owner of the node', async () => {
    const userId = 1;
    const dirNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(true);

    const result = await permissionPolicy.canReadFolderNode(userId, dirNodeId);
    expect(result).toBe(true);
    expect(mockPermStore.checkPermission).not.toHaveBeenCalled();
  });

  it('V8d: returns true for admin user', async () => {
    const userId = 1;
    const dirNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'admin', is_admin: true });

    const result = await permissionPolicy.canReadFolderNode(userId, dirNodeId);
    expect(result).toBe(true);
    expect(mockOwnerNodeResolver.isOwnerNode).not.toHaveBeenCalled();
  });

  // V9: canGrantPermission — TRUE if user has admin permission on node or ancestor
  it('V9: returns true when user has ADMIN permission', async () => {
    const userId = 1;
    const targetNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(true);

    const result = await permissionPolicy.canGrantPermissionNode(userId, targetNodeId);
    expect(result).toBe(true);
    expect(mockPermStore.checkPermission).toHaveBeenCalledWith(
      userId, targetNodeId, PERMISSIONS.ADMIN
    );
  });

  it('V9b: returns true when user is owner of the node', async () => {
    const userId = 1;
    const targetNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(true);

    const result = await permissionPolicy.canGrantPermissionNode(userId, targetNodeId);
    expect(result).toBe(true);
  });

  it('V9c: returns true for admin user', async () => {
    const userId = 1;
    const targetNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'admin', is_admin: true });

    const result = await permissionPolicy.canGrantPermissionNode(userId, targetNodeId);
    expect(result).toBe(true);
  });

  it('V9d: returns false when user has no ADMIN and is not owner', async () => {
    const userId = 1;
    const targetNodeId = 20;

    mockUserModel.findById.mockResolvedValue({ id: userId, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(false);

    const result = await permissionPolicy.canGrantPermissionNode(userId, targetNodeId);
    expect(result).toBe(false);
  });

  // canWriteFolder
  it('canWriteFolderNode returns true for owner', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(true);

    const result = await permissionPolicy.canWriteFolderNode(1, 20);
    expect(result).toBe(true);
  });

  it('canWriteFolderNode returns true when user has WRITE permission', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(true);

    const result = await permissionPolicy.canWriteFolderNode(1, 20);
    expect(result).toBe(true);
    expect(mockPermStore.checkPermission).toHaveBeenCalledWith(1, 20, PERMISSIONS.WRITE);
  });

  it('canWriteFolderNode returns false when no write access', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(false);

    const result = await permissionPolicy.canWriteFolderNode(1, 20);
    expect(result).toBe(false);
  });

  // canViewPermissions
  it('canViewPermissionsNode returns true for owner', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(true);

    const result = await permissionPolicy.canViewPermissionsNode(1, 20);
    expect(result).toBe(true);
  });

  // isAdminUser helper
  it('isAdminUser correctly identifies admin user object', () => {
    expect(permissionPolicy.isAdminUser({ is_admin: true })).toBe(true);
    expect(permissionPolicy.isAdminUser({ is_admin: false })).toBe(false);
    expect(permissionPolicy.isAdminUser(null)).toBe(false);
    expect(permissionPolicy.isAdminUser(undefined)).toBe(false);
  });

  // canRevokePermissionNode
  it('canRevokePermissionNode returns true when user revokes own permission', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });

    const result = await permissionPolicy.canRevokePermissionNode(1, 20, 1);
    expect(result).toBe(true);
  });

  it('canRevokePermissionNode returns true for admin', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'admin', is_admin: true });

    const result = await permissionPolicy.canRevokePermissionNode(1, 20, 2);
    expect(result).toBe(true);
  });

  it('canRevokePermissionNode returns false for non-admin non-owner without admin perm', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });
    mockOwnerNodeResolver.isOwnerNode.mockResolvedValue(false);
    mockPermStore.checkPermission.mockResolvedValue(false);

    const result = await permissionPolicy.canRevokePermissionNode(1, 20, 2);
    expect(result).toBe(false);
  });
});
