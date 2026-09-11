/**
 * permissionPolicy tests — nodeId-based permission checks.
 *
 * Verifies that canGrantPermissionNode, canRevokePermissionNode,
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
      userId,
      targetNodeId,
      PERMISSIONS.ADMIN
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

  // getUserOrNull helper
  it('getUserOrNull returns the user when found', async () => {
    mockUserModel.findById.mockResolvedValue({ id: 1, username: 'alice' });

    const result = await permissionPolicy.getUserOrNull(1);
    expect(result).toMatchObject({ id: 1, username: 'alice' });
  });

  it('getUserOrNull returns falsy when user not found', async () => {
    mockUserModel.findById.mockResolvedValue(undefined);

    const result = await permissionPolicy.getUserOrNull(999);
    expect(result).toBeFalsy();
  });

  it('getUserOrNull returns null for falsy userId without calling findById', async () => {
    const result = await permissionPolicy.getUserOrNull(null);
    expect(result).toBeNull();
    expect(mockUserModel.findById).not.toHaveBeenCalled();
  });

  it('getUserOrNull returns null when findById throws', async () => {
    mockUserModel.findById.mockRejectedValue(new Error('DB error'));

    const result = await permissionPolicy.getUserOrNull(1);
    expect(result).toBeNull();
  });
});
