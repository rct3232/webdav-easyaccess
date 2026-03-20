/**
 * shareReviewUseCase tests.
 * @see docs/spec/client/services/shareReviewUseCase.md
 */
jest.mock('../sharePermissionGateway', () => ({
  revokePermission: jest.fn(),
  grantPermission: jest.fn(),
  approvePermissionRequest: jest.fn(),
}));

import { shareReviewUseCase } from '../shareReviewUseCase';
import * as sharePermissionGateway from '../sharePermissionGateway';

describe('shareReviewUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
    sharePermissionGateway.approvePermissionRequest.mockResolvedValue(undefined);
  });

  it('revokes removed assignments (best-effort), grants changes, then approves', async () => {
    const initialFolderPermissions = new Map([
      [
        '/a',
        new Map([
          ['u1', 'read'],
          ['u2', 'write'],
        ]),
      ],
    ]);

    const folderPermissions = new Map([
      [
        '/a',
        new Map([
          ['u1', 'write'], // permission change => grant
          ['u3', 'read'], // extra user => grant
        ]),
      ],
    ]);

    sharePermissionGateway.revokePermission.mockRejectedValueOnce(new Error('Revoke failed'));

    await shareReviewUseCase({
      permissionRequestId: 'req-1',
      initialFolderPermissions,
      folderPermissions,
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u2',
      folderPath: '/a',
      includeSubfolders: true,
    });

    // Grants for u1 and u3 should be attempted.
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u1',
      folderPath: '/a',
      permission: 'write',
    });
    expect(sharePermissionGateway.grantPermission).toHaveBeenCalledWith({
      userId: 'u3',
      folderPath: '/a',
      permission: 'read',
    });

    expect(sharePermissionGateway.approvePermissionRequest).toHaveBeenCalledWith('req-1');
  });

  it('does not approve when grant fails', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('Grant failed'));

    const initialFolderPermissions = new Map([
      ['/a', new Map([['u1', 'read']])],
    ]);
    const folderPermissions = new Map([
      ['/a', new Map([['u1', 'write']])],
    ]);

    await expect(
      shareReviewUseCase({
        permissionRequestId: 'req-1',
        initialFolderPermissions,
        folderPermissions,
      })
    ).rejects.toBeTruthy();

    expect(sharePermissionGateway.approvePermissionRequest).not.toHaveBeenCalled();
  });
});

