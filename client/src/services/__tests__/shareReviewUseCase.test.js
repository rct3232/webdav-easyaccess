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
          ['u1', 'write'], // permission change => grant
          ['u3', 'read'], // extra user => grant
        ]),
      ],
    ]);

    sharePermissionGateway.revokePermission.mockRejectedValueOnce(new Error('Revoke failed'));

    await shareReviewUseCase({
      permissionRequestId: 'req-1',
      initialNodePermissions,
      nodePermissions,
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: 'u2',
      nodeId: 1001,
    });

    // Grants for u1 and u3 should be attempted.
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

    expect(sharePermissionGateway.approvePermissionRequest).toHaveBeenCalledWith('req-1');
  });

  it('does not approve when grant fails', async () => {
    sharePermissionGateway.grantPermission.mockRejectedValueOnce(new Error('Grant failed'));

    const initialNodePermissions = new Map([[1001, new Map([['u1', 'read']])]]);
    const nodePermissions = new Map([[1001, new Map([['u1', 'write']])]]);

    await expect(
      shareReviewUseCase({
        permissionRequestId: 'req-1',
        initialNodePermissions,
        nodePermissions,
      })
    ).rejects.toBeTruthy();

    expect(sharePermissionGateway.approvePermissionRequest).not.toHaveBeenCalled();
  });
});

