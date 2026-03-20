jest.mock('../sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
  },
}));

jest.mock('../../utils/folderUtils', () => ({
  collectSubfolderPaths: jest.fn(),
}));

import sharePermissionGateway from '../sharePermissionGateway';
import { collectSubfolderPaths } from '../../utils/folderUtils';
import { shareTargetPermissionSaveUseCase } from '../shareTargetPermissionSaveUseCase';

describe('shareTargetPermissionSaveUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
    collectSubfolderPaths.mockResolvedValue(['/docs', '/docs/sub']);
  });

  it('saves directory permissions across the subtree', async () => {
    await shareTargetPermissionSaveUseCase({
      targetPath: '/docs',
      isDirectory: true,
      initialAccessList: [{ id: 'u1', permission: 'read' }],
      accessList: [{ id: 'u2', permission: 'write' }],
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u1',
      folderPath: '/docs',
      includeSubfolders: true,
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u2',
      folderPath: '/docs',
      permission: 'write',
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u2',
      folderPath: '/docs/sub',
      permission: 'write',
    });
  });

  it('saves file permissions with path-only revoke semantics', async () => {
    await shareTargetPermissionSaveUseCase({
      targetPath: '/docs/file.txt',
      isDirectory: false,
      initialAccessList: [{ id: 'u1', permission: 'read', filePermission: 'read' }],
      accessList: [{ id: 'u1', permission: 'revoke', pathPermission: 'read', filePermission: 'read' }],
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u1',
      folderPath: '/docs/file.txt',
      scope: 'pathOnly',
    });
  });

  it('rejects when grant fails', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('grant failed'));

    await expect(
      shareTargetPermissionSaveUseCase({
        targetPath: '/docs/file.txt',
        isDirectory: false,
        initialAccessList: [],
        accessList: [{ id: 'u1', permission: 'write', pathPermission: null, filePermission: null }],
      })
    ).rejects.toThrow('grant failed');
  });
});
