/**
 * aclService tests — nodeId-based permission checks.
 *
 * Verifies that checkFilePermission and checkFolderPermission operate on nodeIds,
 * use the closure table for ancestor inheritance via Permission model, support
 * admin bypass, and resolve share principals through token-based lookups.
 */

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

describe('aclService (nodeId)', () => {
  let aclService;
  let mockUserFindById;
  let mockPermissionCheckPermission;
  let mockPermissionGetFilePermission;
  let mockPermissionCheckSharePermission;

  beforeEach(() => {
    jest.resetModules();

    mockUserFindById = jest.fn();
    mockPermissionCheckPermission = jest.fn();
    mockPermissionGetFilePermission = jest.fn();
    mockPermissionCheckSharePermission = jest.fn();

    // aclService.js requires '../../../models/User' from services/ dir.
    // From __tests__/ subdir, that's '../../../../models/User'.
    jest.doMock('../../../../models/User', () => ({
      findById: mockUserFindById,
    }));

    jest.doMock('../../../../store/permissionStore', () => {
      const { createPermissionStoreMock } = require('@testing/mocks/storeMocks');
      return createPermissionStoreMock({
        checkPermission: mockPermissionCheckPermission,
        getFilePermission: mockPermissionGetFilePermission,
        checkSharePermission: mockPermissionCheckSharePermission,
      });
    });

    jest.doMock('@webdav-easyaccess/shared/pathUtils', () => ({
      normalizePath: (p) => p,
      getParentPath: (p) => p,
    }));

    aclService = require('../aclService');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /* V1: Direct file permission                                         */
  /* ------------------------------------------------------------------ */
  it('V1: checkFilePermission returns true when direct file permission exists', async () => {
    const principalId = 42;
    const fileNodeId = 100;

    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionGetFilePermission.mockResolvedValue({
      userId: 42,
      fileNodeId: 100,
      permission: PERMISSIONS.READ,
    });

    const result = await aclService.checkFilePermission(principalId, fileNodeId, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermissionGetFilePermission).toHaveBeenCalledWith(42, 100);
  });

  /* ------------------------------------------------------------------ */
  /* V2: Inherited from parent folder via closure table                 */
  /* ------------------------------------------------------------------ */
  it('V2: checkFilePermission returns true when inherited from ancestor folder', async () => {
    const principalId = 42;
    const fileNodeId = 100;

    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionGetFilePermission.mockResolvedValue(null);
    mockPermissionCheckPermission.mockResolvedValue(true);

    const result = await aclService.checkFilePermission(principalId, fileNodeId, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermissionCheckPermission).toHaveBeenCalledWith(42, 100, PERMISSIONS.READ);
  });

  it('V2b: checkFilePermission returns false when no direct or inherited permission', async () => {
    const principalId = 42;
    const fileNodeId = 100;

    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionGetFilePermission.mockResolvedValue(null);
    mockPermissionCheckPermission.mockResolvedValue(false);

    const result = await aclService.checkFilePermission(principalId, fileNodeId, PERMISSIONS.READ);
    expect(result).toBe(false);
  });

  it('V2c: checkFilePermission respects required permission rank', async () => {
    const principalId = 42;
    const fileNodeId = 100;

    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionGetFilePermission.mockResolvedValue({
      userId: 42,
      fileNodeId: 100,
      permission: PERMISSIONS.READ,
    });

    const result = await aclService.checkFilePermission(principalId, fileNodeId, PERMISSIONS.WRITE);
    expect(result).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* V3: Direct folder permission                                       */
  /* ------------------------------------------------------------------ */
  it('V3: checkFolderPermission returns true when direct folder permission exists', async () => {
    const principalId = 42;
    const dirNodeId = 50;

    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionCheckPermission.mockResolvedValue(true);

    const result = await aclService.checkFolderPermission(principalId, dirNodeId, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermissionCheckPermission).toHaveBeenCalledWith(42, 50, PERMISSIONS.READ);
  });

  /* ------------------------------------------------------------------ */
  /* V4: Inherited from grandparent via closure table                   */
  /* ------------------------------------------------------------------ */
  it('V4: checkFolderPermission returns true when inherited from grandparent', async () => {
    const principalId = 42;
    const dirNodeId = 75;

    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionCheckPermission.mockResolvedValue(true);

    const result = await aclService.checkFolderPermission(principalId, dirNodeId, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermissionCheckPermission).toHaveBeenCalledWith(42, 75, PERMISSIONS.READ);
  });

  /* ------------------------------------------------------------------ */
  /* V6: Admin bypass                                                    */
  /* ------------------------------------------------------------------ */
  it('V6a: checkFilePermission returns true for admin regardless of permissions', async () => {
    const principalId = 1;
    const fileNodeId = 999;

    mockUserFindById.mockResolvedValue({ id: 1, username: 'admin', is_admin: true });

    const result = await aclService.checkFilePermission(principalId, fileNodeId, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermissionGetFilePermission).not.toHaveBeenCalled();
    expect(mockPermissionCheckPermission).not.toHaveBeenCalled();
  });

  it('V6b: checkFolderPermission returns true for admin regardless of permissions', async () => {
    const principalId = 1;
    const dirNodeId = 999;

    mockUserFindById.mockResolvedValue({ id: 1, username: 'admin', is_admin: true });

    const result = await aclService.checkFolderPermission(principalId, dirNodeId, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermissionCheckPermission).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ */
  /* V7: Share principal access                                         */
  /* ------------------------------------------------------------------ */
  it('V7a: checkFilePermission resolves share principal via token', async () => {
    const fileNodeId = 100;
    mockPermissionCheckSharePermission.mockResolvedValue(true);

    const result = await aclService.checkFilePermission(
      'share:abc123',
      fileNodeId,
      PERMISSIONS.READ
    );
    expect(result).toBe(true);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockPermissionCheckSharePermission).toHaveBeenCalledWith(
      'abc123',
      100,
      PERMISSIONS.READ
    );
  });

  it('V7b: checkFolderPermission resolves share principal via token', async () => {
    const dirNodeId = 50;
    mockPermissionCheckSharePermission.mockResolvedValue(true);

    const result = await aclService.checkFolderPermission(
      'share:abc123',
      dirNodeId,
      PERMISSIONS.READ
    );
    expect(result).toBe(true);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockPermissionCheckSharePermission).toHaveBeenCalledWith('abc123', 50, PERMISSIONS.READ);
  });

  it('V7c: share principal returns false when no share permission found', async () => {
    const fileNodeId = 100;
    mockPermissionCheckSharePermission.mockResolvedValue(false);

    const result = await aclService.checkFilePermission(
      'share:noperm',
      fileNodeId,
      PERMISSIONS.READ
    );
    expect(result).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* Edge cases                                                          */
  /* ------------------------------------------------------------------ */
  it('returns false when user is not found', async () => {
    const principalId = 999;
    mockUserFindById.mockResolvedValue(undefined);

    const result = await aclService.checkFilePermission(principalId, 100, PERMISSIONS.READ);
    expect(result).toBe(false);
  });

  it('isAdminUser correctly identifies admin object', () => {
    expect(aclService.isAdminUser({ is_admin: true })).toBe(true);
    expect(aclService.isAdminUser({ is_admin: false })).toBe(false);
    expect(aclService.isAdminUser(null)).toBe(false);
    expect(aclService.isAdminUser(undefined)).toBe(false);
  });

  it('isSharePrincipal correctly identifies share principals', () => {
    expect(aclService.isSharePrincipal('share:abc123')).toBe(true);
    expect(aclService.isSharePrincipal(42)).toBe(false);
    expect(aclService.isSharePrincipal('user:abc123')).toBe(false);
  });

  it('extractShareToken returns the token portion', () => {
    expect(aclService.extractShareToken('share:mytoken')).toBe('mytoken');
    expect(aclService.extractShareToken(42)).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* canWrite helpers                                                    */
  /* ------------------------------------------------------------------ */
  it('canWriteFile returns true for admin user', async () => {
    mockUserFindById.mockResolvedValue({ id: 1, username: 'admin', is_admin: true });
    const result = await aclService.canWriteFile({ id: 1 }, 100);
    expect(result).toBe(true);
  });

  it('canWriteFolder returns true for admin user', async () => {
    mockUserFindById.mockResolvedValue({ id: 1, username: 'admin', is_admin: true });
    const result = await aclService.canWriteFolder({ id: 1 }, 50);
    expect(result).toBe(true);
  });

  it('canWriteFile delegates to checkFilePermission for non-admin', async () => {
    mockUserFindById.mockResolvedValue({ id: 42, username: 'alice', is_admin: false });
    mockPermissionGetFilePermission.mockResolvedValue(null);
    mockPermissionCheckPermission.mockResolvedValue(true);

    const result = await aclService.canWriteFile({ id: 42 }, 100);
    expect(result).toBe(true);
  });
});
