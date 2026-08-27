/**
 * shareReviewUseCase tests.
 * @see docs/spec/client/services/shareReviewUseCase.md
 */
import { shareReviewUseCase } from '../shareReviewUseCase';
import * as sharePermissionGateway from '../sharePermissionGateway';

jest.mock('../sharePermissionGateway', () => ({
  revokePermission: jest.fn(),
  grantPermission: jest.fn(),
  approvePermissionRequest: jest.fn(),
}));

describe('shareReviewUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharePermissionGateway.revokePermission.mockResolvedValue(undefined);
    sharePermissionGateway.grantPermission.mockResolvedValue(undefined);
    sharePermissionGateway.approvePermissionRequest.mockResolvedValue(undefined);
  });

  it('revokes removed assignments (best-effort), never pre-grants, then approves', async () => {
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
          ['u1', 'write'], // permission change
          ['u3', 'read'], // extra user
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

    // The requested permission is granted atomically by the server on approve;
    // the client must not issue a pre-approve grant.
    expect(sharePermissionGateway.grantPermission).not.toHaveBeenCalled();

    expect(sharePermissionGateway.approvePermissionRequest).toHaveBeenCalledWith('req-1');
  });

  it('propagates approve failures to the caller', async () => {
    sharePermissionGateway.approvePermissionRequest.mockRejectedValueOnce(
      new Error('Approve failed')
    );

    const initialNodePermissions = new Map([[1001, new Map([['u1', 'read']])]]);
    const nodePermissions = new Map([[1001, new Map([['u1', 'write']])]]);

    await expect(
      shareReviewUseCase({
        permissionRequestId: 'req-1',
        initialNodePermissions,
        nodePermissions,
      })
    ).rejects.toBeTruthy();
  });
});
