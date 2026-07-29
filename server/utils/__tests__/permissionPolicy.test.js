/**
 * Unit tests for permissionPolicy utilities.
 * Tests all exported functions with mocked dependencies.
 * @see docs/features/permissions.md
 */
const Permission = require('../../models/Permission');
const User = require('../../models/User');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

jest.mock('../../domains/permissions/services/aclService', () => ({
  checkFilePermission: jest.fn(),
  checkFolderPermission: jest.fn(),
  isSharePrincipal: jest.fn(),
}));

const { checkFilePermission, checkFolderPermission } = require('../../domains/permissions/services/aclService');

const {
  isAdminUser,
  isOwnerPath,
  getHomeOwnerUserIdForPath,
  hasDirectFolderPermission,
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncReadFileChecker,
  buildSyncWriteFileByParentChecker,
  getUserOrNull,
  canGrantPermission,
  canRevokePermission,
  canViewPermissions,
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

describe('isOwnerPath', () => {
  test.each([
    ['owner root path', regularUser, '/alice', true],
    ['owner sub-path', regularUser, '/alice/docs', true],
    ['owner nested path', regularUser, '/alice/docs/notes', true],
    ['different user root', regularUser, '/bob', false],
    ['different user sub-path', regularUser, '/bob/photos', false],
    ['root path', regularUser, '/', false],
    ['null user', null, '/alice', false],
    ['undefined user', undefined, '/alice', false],
    ['empty username object', {}, '/alice', false],
  ])('%s returns %p', (_, user, targetPath, expected) => {
    expect(isOwnerPath(user, targetPath)).toBe(expected);
  });
});

describe('getHomeOwnerUserIdForPath', () => {
  it('returns user id when path is under a valid username', async () => {
    jest.spyOn(User, 'findByUsername').mockResolvedValue({ id: 42, username: 'alice' });
    const result = await getHomeOwnerUserIdForPath('/alice/docs');
    expect(result).toBe(42);
  });

  it('returns user id when path is exactly /{username}', async () => {
    jest.spyOn(User, 'findByUsername').mockResolvedValue({ id: 7, username: 'bob' });
    const result = await getHomeOwnerUserIdForPath('/bob');
    expect(result).toBe(7);
  });

  it('returns null when username does not exist', async () => {
    jest.spyOn(User, 'findByUsername').mockResolvedValue(null);
    const result = await getHomeOwnerUserIdForPath('/unknown/file');
    expect(result).toBeNull();
  });

  it('returns null for root path', async () => {
    jest.spyOn(User, 'findByUsername').mockResolvedValue(null);
    const result = await getHomeOwnerUserIdForPath('/');
    expect(result).toBeNull();
  });
});

describe('hasDirectFolderPermission', () => {
  it('returns true when permission exists with trailing slash', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValueOnce(true);
    const result = await hasDirectFolderPermission(2, '/shared/docs', PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(Permission.checkPermission).toHaveBeenCalledWith(2, '/shared/docs/', PERMISSIONS.READ);
  });

  it('returns true when permission exists without trailing slash fallback', async () => {
    jest.spyOn(Permission, 'checkPermission')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await hasDirectFolderPermission(2, '/shared/docs', PERMISSIONS.READ);
    expect(result).toBe(true);
  });

  it('returns false when no permission exists', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await hasDirectFolderPermission(2, '/shared/docs', PERMISSIONS.WRITE);
    expect(result).toBe(false);
  });

  it('skips no-slash fallback for root path', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValueOnce(false);
    const result = await hasDirectFolderPermission(2, '/', PERMISSIONS.READ);
    expect(result).toBe(false);
    expect(Permission.checkPermission).toHaveBeenCalledTimes(1);
  });
});

describe('canReadFolder', () => {
  it('delegates to checkFolderPermission with correct args', async () => {
    checkFolderPermission.mockResolvedValue(true);
    const result = await canReadFolder(2, '/shared/docs');
    expect(result).toBe(true);
    expect(checkFolderPermission).toHaveBeenCalledWith(2, '/shared/docs', PERMISSIONS.READ);
  });

  it('returns false when checkFolderPermission returns false', async () => {
    checkFolderPermission.mockResolvedValue(false);
    const result = await canReadFolder(3, '/private');
    expect(result).toBe(false);
  });
});

describe('canReadFile', () => {
  it('delegates to checkFilePermission with correct args', async () => {
    checkFilePermission.mockResolvedValue(true);
    const result = await canReadFile(2, '/shared/docs/file.txt');
    expect(result).toBe(true);
    expect(checkFilePermission).toHaveBeenCalledWith(2, '/shared/docs/file.txt', PERMISSIONS.READ);
  });

  it('returns false when checkFilePermission returns false', async () => {
    checkFilePermission.mockResolvedValue(false);
    const result = await canReadFile(3, '/private/secret.txt');
    expect(result).toBe(false);
  });
});

describe('canWriteFolder', () => {
  it('returns true for admin user (bypass)', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canWriteFolder(adminUser, '/shared/docs');
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true for owner path (bypass)', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canWriteFolder(regularUser, '/alice/docs');
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true when user has direct write permission', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValueOnce(true);
    const result = await canWriteFolder(regularUser, '/shared/docs');
    expect(result).toBe(true);
  });

  it('returns false when user has no permission', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canWriteFolder(regularUser, '/shared/locked');
    expect(result).toBe(false);
  });

  it('returns false for null user', async () => {
    const result = await canWriteFolder(null, '/alice/docs');
    expect(result).toBe(false);
  });
});

describe('canWriteFileByParent', () => {
  it('returns true for admin user (bypass)', async () => {
    checkFilePermission.mockResolvedValue(false);
    const result = await canWriteFileByParent(adminUser, '/shared/docs/file.txt');
    expect(result).toBe(true);
    expect(checkFilePermission).not.toHaveBeenCalled();
  });

  it('returns true for owner path (bypass)', async () => {
    checkFilePermission.mockResolvedValue(false);
    const result = await canWriteFileByParent(regularUser, '/alice/docs/file.txt');
    expect(result).toBe(true);
    expect(checkFilePermission).not.toHaveBeenCalled();
  });

  it('delegates to checkFilePermission for non-admin/owner', async () => {
    checkFilePermission.mockResolvedValue(true);
    const result = await canWriteFileByParent(regularUser, '/shared/docs/file.txt');
    expect(result).toBe(true);
    expect(checkFilePermission).toHaveBeenCalledWith(2, '/shared/docs/file.txt', PERMISSIONS.WRITE);
  });

  it('returns false when checkFilePermission returns false', async () => {
    checkFilePermission.mockResolvedValue(false);
    const result = await canWriteFileByParent(regularUser, '/shared/docs/file.txt');
    expect(result).toBe(false);
  });

  it('returns false for null user', async () => {
    const result = await canWriteFileByParent(null, '/alice/docs/file.txt');
    expect(result).toBe(false);
  });
});

describe('buildSyncWriteChecker', () => {
  it('returns true for admin user', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(false);
    const checker = buildSyncWriteChecker(adminUser, { permissions: {} });
    expect(checker('/shared/docs')).toBe(true);
    expect(Permission.checkPermissionSync).not.toHaveBeenCalled();
  });

  it('returns true for owner path', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(false);
    const checker = buildSyncWriteChecker(regularUser, { permissions: {} });
    expect(checker('/alice/docs')).toBe(true);
    expect(Permission.checkPermissionSync).not.toHaveBeenCalled();
  });

  it('returns true when sync check passes', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(true);
    const checker = buildSyncWriteChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs')).toBe(true);
  });

  it('returns false when sync check fails', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(false);
    const checker = buildSyncWriteChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs')).toBe(false);
  });

  it('returns false for null user', () => {
    const checker = buildSyncWriteChecker(null, { permissions: {} });
    expect(checker('/alice/docs')).toBe(false);
  });
});

describe('buildSyncReadChecker', () => {
  it('returns true for admin user', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(false);
    const checker = buildSyncReadChecker(adminUser, { permissions: {} });
    expect(checker('/shared/docs')).toBe(true);
    expect(Permission.checkPermissionSync).not.toHaveBeenCalled();
  });

  it('returns true for owner path', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(false);
    const checker = buildSyncReadChecker(regularUser, { permissions: {} });
    expect(checker('/alice/docs')).toBe(true);
    expect(Permission.checkPermissionSync).not.toHaveBeenCalled();
  });

  it('returns true when sync check passes with READ permission', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(true);
    const checker = buildSyncReadChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs')).toBe(true);
    expect(Permission.checkPermissionSync).toHaveBeenCalledWith(
      { permissions: {} },
      '/shared/docs',
      PERMISSIONS.READ,
    );
  });

  it('returns false when sync check fails', () => {
    jest.spyOn(Permission, 'checkPermissionSync').mockReturnValue(false);
    const checker = buildSyncReadChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs')).toBe(false);
  });

  it('returns false for null user', () => {
    const checker = buildSyncReadChecker(null, { permissions: {} });
    expect(checker('/alice/docs')).toBe(false);
  });
});

describe('buildSyncReadFileChecker', () => {
  it('returns true for admin user', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(false);
    const checker = buildSyncReadFileChecker(adminUser, { permissions: {} });
    expect(checker('/shared/docs/file.txt')).toBe(true);
    expect(Permission.checkFilePermissionSync).not.toHaveBeenCalled();
  });

  it('returns true for owner path', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(false);
    const checker = buildSyncReadFileChecker(regularUser, { permissions: {} });
    expect(checker('/alice/docs/file.txt')).toBe(true);
  });

  it('returns true when sync file check passes', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(true);
    const checker = buildSyncReadFileChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs/file.txt')).toBe(true);
  });

  it('returns false when sync file check fails', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(false);
    const checker = buildSyncReadFileChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs/file.txt')).toBe(false);
  });

  it('returns false for null user', () => {
    const checker = buildSyncReadFileChecker(null, { permissions: {} });
    expect(checker('/alice/docs/file.txt')).toBe(false);
  });
});

describe('buildSyncWriteFileByParentChecker', () => {
  it('returns true for admin user', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(false);
    const checker = buildSyncWriteFileByParentChecker(adminUser, { permissions: {} });
    expect(checker('/shared/docs/file.txt')).toBe(true);
  });

  it('returns true for owner path', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(false);
    const checker = buildSyncWriteFileByParentChecker(regularUser, { permissions: {} });
    expect(checker('/alice/docs/file.txt')).toBe(true);
  });

  it('returns true when sync file check passes with WRITE', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(true);
    const checker = buildSyncWriteFileByParentChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs/file.txt')).toBe(true);
    expect(Permission.checkFilePermissionSync).toHaveBeenCalledWith(
      { permissions: {} },
      '/shared/docs/file.txt',
      PERMISSIONS.WRITE,
    );
  });

  it('returns false when sync file check fails', () => {
    jest.spyOn(Permission, 'checkFilePermissionSync').mockReturnValue(false);
    const checker = buildSyncWriteFileByParentChecker(regularUser, { permissions: {} });
    expect(checker('/shared/docs/file.txt')).toBe(false);
  });

  it('returns false for null user', () => {
    const checker = buildSyncWriteFileByParentChecker(null, { permissions: {} });
    expect(checker('/alice/docs/file.txt')).toBe(false);
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

describe('canGrantPermission', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canGrantPermission(adminUser, '/shared/docs', 1);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true for owner path', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canGrantPermission(regularUser, '/alice/docs', 2);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true when user has ADMIN permission on folder', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValueOnce(true);
    const result = await canGrantPermission(regularUser, '/shared/docs', 2);
    expect(result).toBe(true);
    expect(Permission.checkPermission).toHaveBeenCalledWith(2, '/shared/docs/', PERMISSIONS.ADMIN);
  });

  it('returns false when user has no ADMIN permission', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canGrantPermission(regularUser, '/shared/docs', 2);
    expect(result).toBe(false);
  });

  it('returns false for null user', async () => {
    const result = await canGrantPermission(null, '/alice/docs', 1);
    expect(result).toBe(false);
  });
});

describe('canRevokePermission', () => {
  it('returns true when revoking own permission', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canRevokePermission(regularUser, '/shared/docs', 2, 2);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true for admin user revoking others', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canRevokePermission(adminUser, '/shared/docs', 1, 3);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true for owner revoking others', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canRevokePermission(regularUser, '/alice/docs', 2, 3);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true when user has ADMIN permission on folder', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValueOnce(true);
    const result = await canRevokePermission(regularUser, '/shared/docs', 2, 3);
    expect(result).toBe(true);
    expect(Permission.checkPermission).toHaveBeenCalledWith(2, '/shared/docs/', PERMISSIONS.ADMIN);
  });

  it('returns false when no permission to revoke others', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canRevokePermission(regularUser, '/shared/docs', 2, 3);
    expect(result).toBe(false);
  });

  it('returns false for null user', async () => {
    const result = await canRevokePermission(null, '/alice/docs', 1, 3);
    expect(result).toBe(false);
  });
});

describe('canViewPermissions', () => {
  it('returns true for admin user', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canViewPermissions(adminUser, '/shared/docs', 1);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true for owner path', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canViewPermissions(regularUser, '/alice/docs', 2);
    expect(result).toBe(true);
    expect(Permission.checkPermission).not.toHaveBeenCalled();
  });

  it('returns true when user has ADMIN permission on folder', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValueOnce(true);
    const result = await canViewPermissions(regularUser, '/shared/docs', 2);
    expect(result).toBe(true);
    expect(Permission.checkPermission).toHaveBeenCalledWith(2, '/shared/docs/', PERMISSIONS.ADMIN);
  });

  it('returns false when user has no ADMIN permission', async () => {
    jest.spyOn(Permission, 'checkPermission').mockResolvedValue(false);
    const result = await canViewPermissions(regularUser, '/shared/docs', 2);
    expect(result).toBe(false);
  });

  it('returns false for null user', async () => {
    const result = await canViewPermissions(null, '/alice/docs', 1);
    expect(result).toBe(false);
  });
});
