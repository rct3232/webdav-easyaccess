jest.mock('../sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    revokePermission: jest.fn(),
    grantPermission: jest.fn(),
  },
}));

import sharePermissionGateway from '../sharePermissionGateway';
import { sharePermissionSaveUseCase } from '../sharePermissionSaveUseCase';

describe('sharePermissionSaveUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
  });

  it('revokes removed assignments and grants current assignments', async () => {
    const initialFolderPermissions = new Map([
      [
        '/docs',
        new Map([
          ['u1', 'read'],
          ['u2', 'write'],
        ]),
      ],
    ]);
    const folderPermissions = new Map([
      [
        '/docs',
        new Map([
          ['u1', 'write'],
          ['u3', 'read'],
        ]),
      ],
    ]);

    await sharePermissionSaveUseCase({
      initialFolderPermissions,
      folderPermissions,
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u2',
      folderPath: '/docs',
      includeSubfolders: true,
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u1',
      folderPath: '/docs',
      permission: 'write',
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u3',
      folderPath: '/docs',
      permission: 'read',
    });
  });

  it('continues when revoke fails but still grants remaining assignments', async () => {
    sharePermissionGateway.revokePermission.mockRejectedValueOnce(new Error('revoke failed'));

    await sharePermissionSaveUseCase({
      initialFolderPermissions: new Map([['/docs', new Map([['u1', 'read']])]]),
      folderPermissions: new Map([['/docs', new Map([['u2', 'write']])]]),
    });

    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u2',
      folderPath: '/docs',
      permission: 'write',
    });
  });

  it('rejects when a grant fails', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('grant failed'));

    await expect(
      sharePermissionSaveUseCase({
        initialFolderPermissions: new Map(),
        folderPermissions: new Map([['/docs', new Map([['u1', 'read']])]]),
      })
    ).rejects.toThrow('grant failed');
  });
});
