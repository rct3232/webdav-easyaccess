jest.mock('../sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    updateUserPermissions: jest.fn(),
  },
}));

import sharePermissionGateway from '../sharePermissionGateway';
import { adminPermissionSaveUseCase } from '../adminPermissionSaveUseCase';

describe('adminPermissionSaveUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.updateUserPermissions.mockResolvedValue(undefined);
  });

  it('persists only the target user permissions and forces the user base folder to write', async () => {
    const folderPermissions = new Map([
      [
        '/alice',
        new Map([
          ['target', 'read'],
          ['other', 'write'],
        ]),
      ],
      [
        '/alice/docs',
        new Map([
          ['target', 'read'],
          ['other', 'read'],
        ]),
      ],
    ]);

    await adminPermissionSaveUseCase({
      userId: 'target',
      username: 'alice',
      folderPermissions,
    });

    expect(sharePermissionGateway.updateUserPermissions).toHaveBeenCalledWith('target', [
      { folderPath: '/alice', permission: 'write' },
      { folderPath: '/alice/docs', permission: 'read' },
    ]);
  });

  it('propagates persistence failures', async () => {
    sharePermissionGateway.updateUserPermissions.mockRejectedValueOnce(new Error('failed'));

    await expect(
      adminPermissionSaveUseCase({
        userId: 'target',
        username: 'alice',
        folderPermissions: new Map(),
      })
    ).rejects.toThrow('failed');
  });
});
