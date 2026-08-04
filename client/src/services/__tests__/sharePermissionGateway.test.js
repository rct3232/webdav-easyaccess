/**
 * sharePermissionGateway tests.
 * Verifies that gateway forwards to underlying services.
 * @see docs/spec/client/services/sharePermissionGateway.md
 */
jest.mock('../permissionService', () => ({
  getUserPermissions: jest.fn(),
  getFolderPermissions: jest.fn(),
  checkPermission: jest.fn(),
  grantPermission: jest.fn(),
  revokePermission: jest.fn(),
}));

jest.mock('../permissionRequestService', () => ({
  checkOwnerExists: jest.fn(),
  listOutboxPermissionRequests: jest.fn(),
  createPermissionRequest: jest.fn(),
  cancelPermissionRequest: jest.fn(),
  approvePermissionRequest: jest.fn(),
}));

jest.mock('../userService', () => ({
  updateUserPermissions: jest.fn(),
}));

import * as permissionService from '../permissionService';
import * as permissionRequestService from '../permissionRequestService';
import * as userService from '../userService';

import sharePermissionGateway, {
  getUserPermissions,
  getFolderPermissions,
  checkPermission,
  checkOwnerExists,
  listOutboxPermissionRequests,
  createPermissionRequest,
  cancelPermissionRequest,
  grantPermission,
  revokePermission,
  approvePermissionRequest,
  updateUserPermissions,
} from '../sharePermissionGateway';

describe('sharePermissionGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards getUserPermissions to permissionService', async () => {
    permissionService.getUserPermissions.mockResolvedValueOnce([{ nodeId: 10, permission: 'read' }]);
    const res = await getUserPermissions('u1');
    expect(permissionService.getUserPermissions).toHaveBeenCalledWith('u1', undefined);
    expect(res).toEqual([{ nodeId: 10, permission: 'read' }]);
  });

  it('forwards grant/revoke to permissionService', async () => {
    await grantPermission({ userId: 'u1', nodeId: 42, permission: 'read' });
    await revokePermission({ userId: 'u1', nodeId: 42, scope: 'pathOnly' });

    expect(permissionService.grantPermission).toHaveBeenCalledWith({ userId: 'u1', nodeId: 42, permission: 'read', target: undefined });
    expect(permissionService.revokePermission).toHaveBeenCalledWith({ userId: 'u1', nodeId: 42, scope: 'pathOnly' });
  });

  it('forwards approvePermissionRequest to permissionRequestService', async () => {
    permissionRequestService.approvePermissionRequest.mockResolvedValueOnce({});
    await approvePermissionRequest('req-1');
    expect(permissionRequestService.approvePermissionRequest).toHaveBeenCalledWith('req-1');
  });

  it('exports a default gateway object with all functions', () => {
    expect(typeof sharePermissionGateway.getUserPermissions).toBe('function');
    expect(typeof sharePermissionGateway.updateUserPermissions).toBe('function');
    expect(typeof sharePermissionGateway.grantPermission).toBe('function');
    expect(typeof sharePermissionGateway.revokePermission).toBe('function');
  });

  it('forwards updateUserPermissions to userService', async () => {
    userService.updateUserPermissions.mockResolvedValueOnce({ ok: true });
    const res = await updateUserPermissions('u1', [{ nodeId: 10, permission: 'write' }]);
    expect(userService.updateUserPermissions).toHaveBeenCalledWith('u1', [{ nodeId: 10, permission: 'write' }]);
    expect(res).toEqual({ ok: true });
  });

  it('forwards owner checks and outbox reads', async () => {
    permissionRequestService.checkOwnerExists.mockResolvedValueOnce({ ownerExists: true });
    permissionRequestService.listOutboxPermissionRequests.mockResolvedValueOnce([{ id: 'r1' }]);

    await checkOwnerExists(42);
    await listOutboxPermissionRequests({ status: 'pending' });

    expect(permissionRequestService.checkOwnerExists).toHaveBeenCalledWith(42);
    expect(permissionRequestService.listOutboxPermissionRequests).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('forwards request create/cancel', async () => {
    permissionRequestService.createPermissionRequest.mockResolvedValueOnce({ id: 'req-1' });
    permissionRequestService.cancelPermissionRequest.mockResolvedValueOnce(undefined);

    await createPermissionRequest({ nodeId: 42, permission: 'read' });
    await cancelPermissionRequest('req-1');

    expect(permissionRequestService.createPermissionRequest).toHaveBeenCalledWith({ nodeId: 42, permission: 'read' });
    expect(permissionRequestService.cancelPermissionRequest).toHaveBeenCalledWith('req-1');
  });

  it('forwards checkPermission', async () => {
    permissionService.checkPermission.mockResolvedValueOnce({ hasRead: true, hasWrite: false, source: 'file' });
    const res = await checkPermission(42);
    expect(permissionService.checkPermission).toHaveBeenCalledWith(42);
    expect(res).toEqual({ hasRead: true, hasWrite: false, source: 'file' });
  });

  it('forwards getFolderPermissions', async () => {
    permissionService.getFolderPermissions.mockResolvedValueOnce([]);
    const res = await getFolderPermissions(42, undefined);
    expect(permissionService.getFolderPermissions).toHaveBeenCalledWith(42, undefined);
    expect(res).toEqual([]);
  });
});

