/**
 * folderPickerGateway tests.
 * @see docs/spec/client/services/folderPickerGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
import folderPickerGateway, {
  checkWritePermission,
  getUserSharedFolderPermissions,
  listFolderContents,
} from '../folderPickerGateway';
import { listFiles } from '../fileService';
import { checkPermission, getSharedPermissions } from '../permissionService';

jest.mock('../fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../permissionService', () => ({
  checkPermission: jest.fn(),
  getSharedPermissions: jest.fn(),
}));

describe('folderPickerGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes directory listing entries for the picker (basename fallback)', async () => {
    listFiles.mockResolvedValue([
      { nodeId: 10, name: 'a', type: 'directory' },
      { nodeId: 11, basename: 'b', name: 'b', type: 'directory' },
    ]);

    const result = await listFolderContents({ nodeId: 10, options: { shareToken: 'token-1' } });

    expect(listFiles).toHaveBeenCalledWith(10, { shareToken: 'token-1' });
    expect(result[0]).toMatchObject({ nodeId: 10, basename: 'a', type: 'directory' });
    expect(result[1]).toMatchObject({ nodeId: 11, basename: 'b', type: 'directory' });
  });

  it('delegates permission checking to permissionService.checkPermission', async () => {
    checkPermission.mockResolvedValue({ hasWrite: false, source: 'nodeId' });

    const result = await checkWritePermission({ nodeId: 10 });

    expect(checkPermission).toHaveBeenCalledWith(10);
    expect(result).toEqual({ hasWrite: false, source: 'nodeId' });
  });

  it('returns only directory entries with real names from shared permissions', async () => {
    const user = { id: 'u1', username: 'alice', is_admin: false };
    getSharedPermissions.mockResolvedValue([
      { nodeId: 100, name: 'Shared Docs', permission: 'write', type: 'directory' },
      { nodeId: 200, name: 'file.txt', permission: 'read', type: 'file' },
    ]);

    const result = await getUserSharedFolderPermissions({ user });

    expect(getSharedPermissions).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { nodeId: 100, name: 'Shared Docs', permission: 'write', type: 'directory' },
    ]);
  });

  it('returns an empty shared-folder list for admin users without calling the service', async () => {
    const result = await getUserSharedFolderPermissions({
      user: { id: 'admin', username: 'admin', is_admin: true },
    });

    expect(result).toEqual([]);
    expect(getSharedPermissions).not.toHaveBeenCalled();
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
    getSharedPermissions.mockRejectedValue(new Error('permissions failed'));

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
