/**
 * folderPickerGateway tests.
 * @see docs/spec/client/services/folderPickerGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
import folderPickerGateway, { checkWritePermission, getUserSharedFolderPermissions, listFolderContents } from '../folderPickerGateway';
import { listFiles } from '../fileService';
import { checkPermission, getUserPermissions } from '../permissionService';

jest.mock('../fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../permissionService', () => ({
  checkPermission: jest.fn(),
  getUserPermissions: jest.fn(),
}));

describe('folderPickerGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates directory listing to fileService.listFiles', async () => {
    listFiles.mockResolvedValue([{ nodeId: 10, basename: 'a', type: 'directory' }]);

    const result = await listFolderContents({ nodeId: 10, options: { shareToken: 'token-1' } });

    expect(listFiles).toHaveBeenCalledWith(10, { shareToken: 'token-1' });
    expect(result).toEqual([{ nodeId: 10, basename: 'a', type: 'directory' }]);
  });

  it('delegates permission checking to permissionService.checkPermission', async () => {
    checkPermission.mockResolvedValue({ hasWrite: false, source: 'nodeId' });

    const result = await checkWritePermission({ nodeId: 10 });

    expect(checkPermission).toHaveBeenCalledWith(10);
    expect(result).toEqual({ hasWrite: false, source: 'nodeId' });
  });

  it('filters out folders owned by the current user', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false };
    getUserPermissions.mockResolvedValue([
      { nodeId: 100, permission: 'write' },
      { nodeId: 200, permission: 'read' },
    ]);

    const result = await getUserSharedFolderPermissions({ user });

    expect(getUserPermissions).toHaveBeenCalledWith(user.id, undefined);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an empty shared-folder list for admin users without calling the service', async () => {
    const result = await getUserSharedFolderPermissions({
      user: { id: 'admin', username: 'admin', is_admin: true },
    });

    expect(result).toEqual([]);
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it('propagates listFolderContents errors', async () => {
    listFiles.mockRejectedValue(new Error('list failed'));

    await expect(listFolderContents({ nodeId: 10 })).rejects.toThrow('list failed');
  });

  it('propagates checkWritePermission errors', async () => {
    checkPermission.mockRejectedValue(new Error('check failed'));

    await expect(checkWritePermission({ nodeId: 10 })).rejects.toThrow('check failed');
  });

  it('propagates shared-folder permission errors for non-admin users', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false };
    getUserPermissions.mockRejectedValue(new Error('permissions failed'));

    await expect(getUserSharedFolderPermissions({ user })).rejects.toThrow('permissions failed');
  });

  it('exposes the same gateway functions through the default export', () => {
    expect(folderPickerGateway).toMatchObject({
      listFolderContents,
      checkWritePermission,
      getUserSharedFolderPermissions,
    });
  });
});
