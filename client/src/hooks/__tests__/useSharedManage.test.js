/**
 * useSharedManage tests.
 * @see docs/spec/client/hooks/useSharedManage.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSharedManage } from '../useSharedManage';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

jest.mock('../../services/permissionService', () => ({
  checkPermission: jest.fn(),
  revokePermission: jest.fn(),
}));

jest.mock('../../services/permissionRequestService', () => ({
  checkOwnerExists: jest.fn(),
  createPermissionRequest: jest.fn(),
  cancelPermissionRequest: jest.fn(),
  listOutboxPermissionRequests: jest.fn(),
}));

import * as permissionService from '../../services/permissionService';
import * as permissionRequestService from '../../services/permissionRequestService';

const mockUser = { id: '1', username: 'user1', is_admin: false };
const mockAdminUser = { id: 'admin', username: 'admin', is_admin: true };
const mockOnMessage = jest.fn();
const mockOnClose = jest.fn();
const mockOnActionComplete = jest.fn();

const defaultProps = {
  open: true,
  targetPath: '/shared/folder',
  displayName: 'folder',
  isDirectory: true,
  user: mockUser,
};

describe('useSharedManage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    permissionService.checkPermission.mockResolvedValue({ hasRead: true, hasWrite: false });
    permissionRequestService.checkOwnerExists.mockResolvedValue({ ownerExists: true });
    permissionRequestService.listOutboxPermissionRequests.mockResolvedValue([]);
  });

  it('returns loading, permission state, handlers', () => {
    const { result } = renderHook(() => useSharedManage(defaultProps));

    expect(typeof result.current.loading).toBe('boolean');
    expect(typeof result.current.initialLoading).toBe('boolean');
    expect(typeof result.current.hasReadPermission).toBe('boolean');
    expect(typeof result.current.hasWritePermission).toBe('boolean');
    expect(typeof result.current.handlePermissionRequest).toBe('function');
    expect(typeof result.current.handleCancelPendingRequest).toBe('function');
    expect(typeof result.current.handleRevokePermission).toBe('function');
    expect(typeof result.current.pendingRequest).toBe('object');
  });

  it('admin user has hasRead and hasWrite true without API call', async () => {
    const { result } = renderHook(() =>
      useSharedManage({ ...defaultProps, user: mockAdminUser })
    );

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(result.current.hasReadPermission).toBe(true);
    expect(result.current.hasWritePermission).toBe(true);
    expect(permissionService.checkPermission).not.toHaveBeenCalled();
  });

  it('loads permission info via checkPermission when open', async () => {
    const { result } = renderHook(() => useSharedManage(defaultProps));

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(permissionService.checkPermission).toHaveBeenCalledWith('/shared/folder');
    expect(result.current.hasReadPermission).toBe(true);
    expect(result.current.hasWritePermission).toBe(false);
  });

  it('ownerExists reflects checkOwnerExists result', async () => {
    permissionRequestService.checkOwnerExists.mockResolvedValue({ ownerExists: true });
    const { result } = renderHook(() => useSharedManage(defaultProps));

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(result.current.ownerExists).toBe(true);
  });

  it('handlePermissionRequest calls createPermissionRequest and onMessage on success', async () => {
    permissionRequestService.createPermissionRequest.mockResolvedValue({ id: 'req-1' });
    const { result } = renderHook(() =>
      useSharedManage({ ...defaultProps, onMessage: mockOnMessage })
    );

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handlePermissionRequest(PERMISSIONS.READ);
    });

    expect(permissionRequestService.createPermissionRequest).toHaveBeenCalledWith({
      folderPath: '/shared/folder',
      permission: PERMISSIONS.READ,
    });
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ show: true, type: 'success' })
    );
  });

  it('handleRevokePermission calls revokePermission and onClose on success', async () => {
    permissionService.revokePermission.mockResolvedValue();
    const { result } = renderHook(() =>
      useSharedManage({ ...defaultProps, onMessage: mockOnMessage, onClose: mockOnClose, onActionComplete: mockOnActionComplete })
    );

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleRevokePermission();
    });

    expect(permissionService.revokePermission).toHaveBeenCalledWith({
      userId: mockUser.id,
      folderPath: '/shared/folder',
      includeSubfolders: true,
    });
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnActionComplete).toHaveBeenCalled();
  });

  it('handleRevokePermission on API failure does not call onClose', async () => {
    permissionService.revokePermission.mockRejectedValue(new Error('Revoke failed'));
    const { result } = renderHook(() =>
      useSharedManage({ ...defaultProps, onMessage: mockOnMessage, onClose: mockOnClose })
    );

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleRevokePermission().catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    );
  });

  it('handleCancelPendingRequest calls cancelPermissionRequest when pending request exists', async () => {
    permissionRequestService.listOutboxPermissionRequests.mockResolvedValue([
      { id: 'req-1', folder_path: '/shared/folder', requested_permission: PERMISSIONS.READ },
    ]);
    permissionRequestService.cancelPermissionRequest.mockResolvedValue();

    const { result } = renderHook(() =>
      useSharedManage({ ...defaultProps, onMessage: mockOnMessage })
    );

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
      expect(result.current.pendingRequest?.read?.pending).toBe(true);
    });

    await act(async () => {
      await result.current.handleCancelPendingRequest(PERMISSIONS.READ);
    });

    expect(permissionRequestService.cancelPermissionRequest).toHaveBeenCalledWith('req-1');
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' })
    );
  });
});
