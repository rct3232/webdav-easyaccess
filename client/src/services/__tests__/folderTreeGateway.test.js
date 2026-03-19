/**
 * folderTreeGateway tests.
 * @see docs/spec/client/services/folderTreeGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
import folderTreeGateway, { getUserSharedFolderPermissions, listFolderChildren } from '../folderTreeGateway';
import { listFiles } from '../fileService';
import { getUserPermissions } from '../permissionService';
import { getShowHiddenFiles } from '../../utils/localStorage';

jest.mock('../fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../permissionService', () => ({
  getUserPermissions: jest.fn(),
}));

jest.mock('../../utils/localStorage', () => ({
  getShowHiddenFiles: jest.fn(),
}));

describe('folderTreeGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only directories, filters hidden, applies filterChildNames, and sorts by name', async () => {
    getShowHiddenFiles.mockReturnValue(false);
    listFiles.mockResolvedValue([
      { path: '/root/a', basename: 'a', name: 'a', type: 'directory', isHidden: false, hasReadPermission: true, hasWritePermission: true },
      { path: '/root/b', basename: 'b', name: 'b', type: 'directory', isHidden: true, hasReadPermission: true, hasWritePermission: false },
      { path: '/root/c', basename: 'c', name: 'c', type: 'directory', isHidden: false, hasReadPermission: true, hasWritePermission: false },
      { path: '/root/file.txt', basename: 'file.txt', name: 'file.txt', type: 'file', isHidden: false },
    ]);

    const result = await listFolderChildren({
      path: '/root',
      listFilesOptions: { shareToken: 'token-1' },
      useHiddenFilesFilter: true,
      filterChildNames: ['c'],
    });

    expect(listFiles).toHaveBeenCalledWith('/root', { shareToken: 'token-1' });
    expect(result).toEqual([
      {
        path: '/root/a',
        name: 'a',
        hasReadPermission: true,
        hasWritePermission: true,
        isHidden: false,
      },
    ]);
  });

  it('includes hidden directories when useHiddenFilesFilter is false', async () => {
    getShowHiddenFiles.mockReturnValue(false);
    listFiles.mockResolvedValue([
      { path: '/root/hidden', basename: 'hidden', name: 'hidden', type: 'directory', isHidden: true, hasReadPermission: true, hasWritePermission: false },
    ]);

    const result = await listFolderChildren({
      path: '/root',
      useHiddenFilesFilter: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: '/root/hidden', name: 'hidden', isHidden: true });
  });

  it('filters out folders owned by the current user', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false };
    getUserPermissions.mockResolvedValue([
      { folder_path: '/alice/home', permission: 'write' },
      { folder_path: '/bob/shared', permission: 'read' },
    ]);

    const result = await getUserSharedFolderPermissions({ user });

    expect(getUserPermissions).toHaveBeenCalledWith(user.id, undefined);
    expect(result).toEqual([{ folder_path: '/bob/shared', permission: 'read' }]);
  });

  it('returns an empty shared-folder list for admin users without calling the service', async () => {
    const result = await getUserSharedFolderPermissions({
      user: { id: 'admin', username: 'admin', is_admin: true },
    });

    expect(result).toEqual([]);
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it('propagates listFolderChildren errors', async () => {
    const error = new Error('list failed');
    listFiles.mockRejectedValue(error);

    await expect(
      listFolderChildren({
        path: '/root',
      })
    ).rejects.toThrow('list failed');
  });

  it('propagates getUserSharedFolderPermissions errors for non-admin users', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false };
    getUserPermissions.mockRejectedValue(new Error('permissions failed'));

    await expect(getUserSharedFolderPermissions({ user })).rejects.toThrow('permissions failed');
  });

  it('exposes the same gateway functions through the default export', () => {
    expect(folderTreeGateway).toMatchObject({
      listFolderChildren,
      getUserSharedFolderPermissions,
    });
  });
});

