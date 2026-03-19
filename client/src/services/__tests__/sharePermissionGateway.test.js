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
    permissionService.getUserPermissions.mockResolvedValueOnce([{ folder_path: '/a', permission: 'read' }]);
    const res = await getUserPermissions('u1');
    expect(permissionService.getUserPermissions).toHaveBeenCalledWith('u1', undefined);
    expect(res).toEqual([{ folder_path: '/a', permission: 'read' }]);
  });

  it('forwards grant/revoke to permissionService', async () => {
    await grantPermission({ userId: 'u1', folderPath: '/a', permission: 'read' });
    await revokePermission({ userId: 'u1', folderPath: '/a', includeSubfolders: true });

    expect(permissionService.grantPermission).toHaveBeenCalledWith({ userId: 'u1', folderPath: '/a', permission: 'read', target: undefined });
    expect(permissionService.revokePermission).toHaveBeenCalledWith({ userId: 'u1', folderPath: '/a', includeSubfolders: true, scope: undefined });
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
    const res = await updateUserPermissions('u1', [{ folderPath: '/a', permission: 'write' }]);
    expect(userService.updateUserPermissions).toHaveBeenCalledWith('u1', [{ folderPath: '/a', permission: 'write' }]);
    expect(res).toEqual({ ok: true });
  });

  it('forwards owner checks and outbox reads', async () => {
    permissionRequestService.checkOwnerExists.mockResolvedValueOnce({ ownerExists: true });
    permissionRequestService.listOutboxPermissionRequests.mockResolvedValueOnce([{ id: 'r1' }]);

    await checkOwnerExists('/a', { forFile: true });
    await listOutboxPermissionRequests({ status: 'pending' });

    expect(permissionRequestService.checkOwnerExists).toHaveBeenCalledWith('/a', { forFile: true });
    expect(permissionRequestService.listOutboxPermissionRequests).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('forwards request create/cancel', async () => {
    permissionRequestService.createPermissionRequest.mockResolvedValueOnce({ id: 'req-1' });
    permissionRequestService.cancelPermissionRequest.mockResolvedValueOnce(undefined);

    await createPermissionRequest({ folderPath: '/a', permission: 'read' });
    await cancelPermissionRequest('req-1');

    expect(permissionRequestService.createPermissionRequest).toHaveBeenCalledWith({ folderPath: '/a', permission: 'read' });
    expect(permissionRequestService.cancelPermissionRequest).toHaveBeenCalledWith('req-1');
  });

  it('forwards checkPermission', async () => {
    permissionService.checkPermission.mockResolvedValueOnce({ hasRead: true, hasWrite: false, source: 'path' });
    const res = await checkPermission('/a');
    expect(permissionService.checkPermission).toHaveBeenCalledWith('/a');
    expect(res).toEqual({ hasRead: true, hasWrite: false, source: 'path' });
  });

  it('forwards getFolderPermissions', async () => {
    permissionService.getFolderPermissions.mockResolvedValueOnce([]);
    const res = await getFolderPermissions('/a', true, undefined);
    expect(permissionService.getFolderPermissions).toHaveBeenCalledWith('/a', true, undefined);
    expect(res).toEqual([]);
  });
});

