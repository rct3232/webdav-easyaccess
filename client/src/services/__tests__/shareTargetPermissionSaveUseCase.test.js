import sharePermissionGateway from '../sharePermissionGateway';
import { shareTargetPermissionSaveUseCase } from '../shareTargetPermissionSaveUseCase';

jest.mock('../sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
  },
}));

describe('shareTargetPermissionSaveUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
  });

  it('saves directory permissions for nodeId', async () => {
    await shareTargetPermissionSaveUseCase({
      targetNodeId: 42,
      isDirectory: true,
      initialAccessList: [{ id: 'u1', permission: 'read' }],
      accessList: [{ id: 'u2', permission: 'write' }],
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u1',
      nodeId: 42,
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u2',
      nodeId: 42,
      permission: 'write',
    });
  });

  it('saves file permissions with path-only revoke semantics', async () => {
    await shareTargetPermissionSaveUseCase({
      targetNodeId: 55,
      isDirectory: false,
      initialAccessList: [{ id: 'u1', permission: 'read', filePermission: 'read' }],
      accessList: [
        { id: 'u1', permission: 'revoke', pathPermission: 'read', filePermission: 'read' },
      ],
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u1',
      nodeId: 55,
      scope: 'pathOnly',
    });
  });

  it('rejects when grant fails', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('grant failed'));

    await expect(
      shareTargetPermissionSaveUseCase({
        targetNodeId: 55,
        isDirectory: false,
        initialAccessList: [],
        accessList: [{ id: 'u1', permission: 'write', pathPermission: null, filePermission: null }],
      })
    ).rejects.toThrow('grant failed');
  });
});
