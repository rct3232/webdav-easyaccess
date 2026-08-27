import sharePermissionGateway from '../sharePermissionGateway';
import { sharePermissionSaveUseCase } from '../sharePermissionSaveUseCase';

jest.mock('../sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    revokePermission: jest.fn(),
    grantPermission: jest.fn(),
  },
}));

describe('sharePermissionSaveUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
  });

  it('revokes removed assignments and grants current assignments', async () => {
    const initialNodePermissions = new Map([
      [
        1001,
        new Map([
          ['u1', 'read'],
          ['u2', 'write'],
        ]),
      ],
    ]);
    const nodePermissions = new Map([
      [
        1001,
        new Map([
          ['u1', 'write'],
          ['u3', 'read'],
        ]),
      ],
    ]);

    await sharePermissionSaveUseCase({
      initialNodePermissions,
      nodePermissions,
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u2',
      nodeId: 1001,
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u1',
      nodeId: 1001,
      permission: 'write',
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u3',
      nodeId: 1001,
      permission: 'read',
    });
  });

  it('continues when revoke fails but still grants remaining assignments', async () => {
    sharePermissionGateway.revokePermission.mockRejectedValueOnce(new Error('revoke failed'));

    await sharePermissionSaveUseCase({
      initialNodePermissions: new Map([[1001, new Map([['u1', 'read']])]]),
      nodePermissions: new Map([[1001, new Map([['u2', 'write']])]]),
    });

    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u2',
      nodeId: 1001,
      permission: 'write',
    });
  });

  it('rejects when a grant fails', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('grant failed'));

    await expect(
      sharePermissionSaveUseCase({
        initialNodePermissions: new Map(),
        nodePermissions: new Map([[1001, new Map([['u1', 'read']])]]),
      })
    ).rejects.toThrow('grant failed');
  });
});
