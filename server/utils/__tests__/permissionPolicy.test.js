/**
 * Unit tests for permissionPolicy utilities.
 * Tests nodeId-based API and identity helpers.
 */
const User = require('../../models/User');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

jest.mock('../../domains/permissions/services/aclService', () => ({
  checkFilePermission: jest.fn(),
}));

const { checkFilePermission } = require('../../domains/permissions/services/aclService');

const {
  isAdminUser,
  getUserOrNull,
  canReadFolderNode,
  canWriteFolderNode,
  canReadFileNode,
  canWriteFileNode,
  canGrantPermissionNode,
  canRevokePermissionNode,
  canViewPermissionsNode,
} = require('../../domains/permissions/policy/permissionPolicy');

const adminUser = { id: 1, username: 'admin', is_admin: true };
const regularUser = { id: 2, username: 'alice', is_admin: false };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isAdminUser', () => {
  test.each([
    ['admin user', adminUser, true],
    ['regular user', regularUser, false],
    ['null user', null, false],
    ['undefined user', undefined, false],
    ['empty object', {}, false],
  ])('%s returns %p', (_, user, expected) => {
    expect(isAdminUser(user)).toBe(expected);
  });
});

describe('getUserOrNull', () => {
  it('returns the user when found', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue({ id: 1, username: 'admin' });
    const result = await getUserOrNull(1);
    expect(result).toMatchObject({ id: 1, username: 'admin' });
  });

  it('returns falsy when user not found', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(undefined);
    const result = await getUserOrNull(999);
    expect(result).toBeFalsy();
  });

  it('returns null for falsy userId', async () => {
    const result = await getUserOrNull(null);
    expect(result).toBeNull();
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('returns null when findById throws', async () => {
    jest.spyOn(User, 'findById').mockRejectedValue(new Error('DB error'));
    const result = await getUserOrNull(1);
    expect(result).toBeNull();
  });
});

describe('canReadFolderNode', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canReadFolderNode(1, 100);
    expect(result).toBe(true);
  });

  it('delegates to checkFolderPermission for non-admin', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(regularUser);
  });
});

describe('canReadFileNode', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canReadFileNode(1, 100);
    expect(result).toBe(true);
  });

  it('delegates to checkFilePermission for non-admin', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(regularUser);
    checkFilePermission.mockResolvedValue(true);
    const result = await canReadFileNode(2, 100);
    expect(result).toBe(true);
    expect(checkFilePermission).toHaveBeenCalledWith(2, 100, PERMISSIONS.READ);
  });
});

describe('canWriteFolderNode', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canWriteFolderNode(1, 100);
    expect(result).toBe(true);
  });
});

describe('canWriteFileNode', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canWriteFileNode(1, 100);
    expect(result).toBe(true);
  });

  it('delegates to checkFilePermission for non-admin', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(regularUser);
    checkFilePermission.mockResolvedValue(true);
    const result = await canWriteFileNode(2, 100);
    expect(result).toBe(true);
    expect(checkFilePermission).toHaveBeenCalledWith(2, 100, PERMISSIONS.WRITE);
  });
});

describe('canGrantPermissionNode', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canGrantPermissionNode(1, 100);
    expect(result).toBe(true);
  });
});

describe('canRevokePermissionNode', () => {
  it('returns true when revoking own permission', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(regularUser);
    const result = await canRevokePermissionNode(2, 100, 2);
    expect(result).toBe(true);
  });

  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canRevokePermissionNode(1, 100, 3);
    expect(result).toBe(true);
  });

  it('returns false for null user', async () => {
    const result = await canRevokePermissionNode(null, 100, 3);
    expect(result).toBe(false);
  });
});

describe('canViewPermissionsNode', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue(adminUser);
    const result = await canViewPermissionsNode(1, 100);
    expect(result).toBe(true);
  });

  it('returns false for null user', async () => {
    const result = await canViewPermissionsNode(null, 100);
    expect(result).toBe(false);
  });
});
