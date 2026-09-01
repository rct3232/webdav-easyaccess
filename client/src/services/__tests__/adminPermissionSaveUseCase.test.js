import sharePermissionGateway from '../sharePermissionGateway';
import { adminPermissionSaveUseCase } from '../adminPermissionSaveUseCase';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

jest.mock('../sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
  },
}));

describe('adminPermissionSaveUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
  });

  it('grants each current nodeId assignment for the target user', async () => {
    const folderPermissions = new Map([
      [1, new Map([['target', 'read']])],
      [2, new Map([['target', 'write']])],
    ]);
    const initialFolderPermissions = new Map();

    await adminPermissionSaveUseCase({
      userId: 'target',
      folderPermissions,
      initialFolderPermissions,
    });

    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'target',
      nodeId: 1,
      permission: 'read',
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'target',
      nodeId: 2,
      permission: 'write',
    });
    expect(sharePermissionGateway.revokePermission).not.toHaveBeenCalled();
  });

  it('revokes nodeId assignments removed from the current map', async () => {
    const initialFolderPermissions = new Map([
      [1, new Map([['target', 'read']])],
      [2, new Map([['target', 'write']])],
    ]);
    const folderPermissions = new Map([[2, new Map([['target', 'write']])]]);

    await adminPermissionSaveUseCase({
      userId: 'target',
      folderPermissions,
      initialFolderPermissions,
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'target',
      nodeId: 1,
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'target',
      nodeId: 2,
      permission: 'write',
    });
  });

  it('never revokes the target user home folder and guarantees write access there', async () => {
    const initialFolderPermissions = new Map([[7, new Map([['target', PERMISSIONS.READ]])]]);
    const folderPermissions = new Map();

    await adminPermissionSaveUseCase({
      userId: 'target',
      homeFolderNodeId: 7,
      folderPermissions,
      initialFolderPermissions,
    });

    expect(sharePermissionGateway.revokePermission).not.toHaveBeenCalled();
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'target',
      nodeId: 7,
      permission: PERMISSIONS.WRITE,
    });
  });

  it('does not double-grant the home folder when it is already part of the diff', async () => {
    const folderPermissions = new Map([[7, new Map([['target', PERMISSIONS.WRITE]])]]);
    const initialFolderPermissions = new Map();

    await adminPermissionSaveUseCase({
      userId: 'target',
      homeFolderNodeId: 7,
      folderPermissions,
      initialFolderPermissions,
    });

    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledTimes(1);
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'target',
      nodeId: 7,
      permission: PERMISSIONS.WRITE,
    });
  });

  it('propagates persistence failures on grant', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('failed'));

    await expect(
      adminPermissionSaveUseCase({
        userId: 'target',
        folderPermissions: new Map([[1, new Map([['target', 'read']])]]),
        initialFolderPermissions: new Map(),
      })
    ).rejects.toThrow('failed');
  });
});
