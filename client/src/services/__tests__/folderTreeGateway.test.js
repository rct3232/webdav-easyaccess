/**
 * folderTreeGateway tests.
 * @see docs/spec/client/services/folderTreeGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
import folderTreeGateway, {
  getUserSharedFolderPermissions,
  listFolderChildren,
} from '../folderTreeGateway';
import { listFiles } from '../fileService';
import { getSharedPermissions } from '../permissionService';
import { getShowHiddenFiles } from '../../utils/localStorage';

jest.mock('../fileService', () => {
  const { createFileServiceMock } = require('../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

jest.mock('../permissionService', () => {
  const { createPermissionServiceMock } = require('../../testing/mocks/serviceMocks');
  return createPermissionServiceMock();
});

jest.mock('../../utils/localStorage', () => {
  const { createLocalStorageUiMock } = require('../../testing/mocks/serviceMocks');
  return createLocalStorageUiMock({
    getShowHiddenFiles: jest.fn(() => false),
  });
});

describe('folderTreeGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only directories, filters hidden, applies filterChildNames, and sorts by name', async () => {
    getShowHiddenFiles.mockReturnValue(false);
    listFiles.mockResolvedValue([
      {
        nodeId: 101,
        basename: 'a',
        name: 'a',
        type: 'directory',
        isHidden: false,
        hasReadPermission: true,
        hasWritePermission: true,
      },
      {
        nodeId: 102,
        basename: 'b',
        name: 'b',
        type: 'directory',
        isHidden: true,
        hasReadPermission: true,
        hasWritePermission: false,
      },
      {
        nodeId: 103,
        basename: 'c',
        name: 'c',
        type: 'directory',
        isHidden: false,
        hasReadPermission: true,
        hasWritePermission: false,
      },
      { nodeId: 104, basename: 'file.txt', name: 'file.txt', type: 'file', isHidden: false },
    ]);

    const result = await listFolderChildren({
      nodeId: 10,
      listFilesOptions: { shareToken: 'token-1' },
      useHiddenFilesFilter: true,
      filterChildNames: ['c'],
    });

    expect(listFiles).toHaveBeenCalledWith(10, { shareToken: 'token-1' });
    expect(result).toEqual([
      {
        nodeId: 101,
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
      {
        nodeId: 102,
        basename: 'hidden',
        name: 'hidden',
        type: 'directory',
        isHidden: true,
        hasReadPermission: true,
        hasWritePermission: false,
      },
    ]);

    const result = await listFolderChildren({
      nodeId: 10,
      useHiddenFilesFilter: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ nodeId: 102, name: 'hidden', isHidden: true });
  });

  it('returns only directory entries with real names from shared permissions', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false, rootNodeId: 500 };
    getSharedPermissions.mockResolvedValue([
      { nodeId: 100, name: 'Shared Docs', permission: 'write', type: 'directory' },
      { nodeId: 200, name: 'Read Only', permission: 'read', type: 'directory' },
      { nodeId: 300, name: 'file.txt', permission: 'read', type: 'file' },
    ]);

    const result = await getUserSharedFolderPermissions({ user });

    expect(getSharedPermissions).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { nodeId: 100, name: 'Shared Docs', permission: 'write', type: 'directory' },
      { nodeId: 200, name: 'Read Only', permission: 'read', type: 'directory' },
    ]);
    expect(result).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('node-100');
  });

  it('filters out the user root node defensively when the server still returns it', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false, rootNodeId: 999 };
    getSharedPermissions.mockResolvedValue([
      { nodeId: 999, name: 'alice', permission: 'admin', type: 'directory' },
      { nodeId: 200, name: 'External', permission: 'read', type: 'directory' },
    ]);

    const result = await getUserSharedFolderPermissions({ user });

    expect(result).toEqual([
      { nodeId: 200, name: 'External', permission: 'read', type: 'directory' },
    ]);
  });

  it('returns an empty shared-folder list for admin users without calling the service', async () => {
    const result = await getUserSharedFolderPermissions({
      user: { id: 'admin', username: 'admin', is_admin: true, rootNodeId: 999 },
    });

    expect(result).toEqual([]);
    expect(getSharedPermissions).not.toHaveBeenCalled();
  });

  it('propagates listFolderChildren errors', async () => {
    const error = new Error('list failed');
    listFiles.mockRejectedValue(error);

    await expect(
      listFolderChildren({
        nodeId: 10,
      })
    ).rejects.toThrow('list failed');
  });

  it('propagates getUserSharedFolderPermissions errors for non-admin users', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false, rootNodeId: 500 };
    getSharedPermissions.mockRejectedValue(new Error('permissions failed'));

    await expect(getUserSharedFolderPermissions({ user })).rejects.toThrow('permissions failed');
  });

  it('exposes the same gateway functions through the default export', () => {
    expect(folderTreeGateway).toMatchObject({
      listFolderChildren,
      getUserSharedFolderPermissions,
    });
  });
});
