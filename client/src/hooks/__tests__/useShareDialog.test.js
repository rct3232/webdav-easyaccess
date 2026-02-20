/**
 * useShareDialog tests.
 * @see docs/spec/client/hooks/useShareDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShareDialog } from '../useShareDialog';
import { usePermissionManager } from '../usePermissionManager';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

jest.mock('../../services/userService', () => ({
  getApprovedUsers: jest.fn(),
  updateUserPermissions: jest.fn(),
}));

jest.mock('../../services/permissionService', () => ({
  getUserPermissions: jest.fn(),
  getFolderPermissions: jest.fn(),
  grantPermission: jest.fn(),
  revokePermission: jest.fn(),
}));

jest.mock('../../services/fileService', () => ({
  listFiles: jest.fn(),
}));

jest.mock('../../services/permissionRequestService', () => ({
  approvePermissionRequest: jest.fn(),
}));

jest.mock('../../utils/errorUtils', () => ({
  getServerErrorDisplay: jest.fn((data) => data?.errorCode || 'error'),
}));

import * as userService from '../../services/userService';
import * as permissionService from '../../services/permissionService';
import * as fileService from '../../services/fileService';
import * as permissionRequestService from '../../services/permissionRequestService';

const mockOnMessage = jest.fn();
const mockOnSave = jest.fn();
const mockOnApprove = jest.fn();
const mockOnClose = jest.fn();

function useShareDialogWithPermissionManager(props) {
  const pm = usePermissionManager({
    mode: props.mode,
    userId: props.userId,
    username: props.username,
    permissionRequest: props.permissionRequest,
    onMessage: props.onMessage,
    onSave: props.onSave,
    onApprove: props.onApprove,
    onClose: props.onClose,
  });
  const sd = useShareDialog({
    ...props,
    folderPermissions: pm.folderPermissions,
    setFolderPermissions: pm.setFolderPermissions,
    initialFolderPermissions: pm.initialFolderPermissions,
    setInitialFolderPermissions: pm.setInitialFolderPermissions,
    userInfoMap: pm.userInfoMap,
    setUserInfoMap: pm.setUserInfoMap,
    setSaving: pm.setSaving,
    setLoadingPermissions: pm.setLoadingPermissions,
    handleAddUserPermission: pm.handleAddUserPermission,
    handleRemoveUserPermission: pm.handleRemoveUserPermission,
    handleToggleUserPermission: pm.handleToggleUserPermission,
  });
  return { ...sd, permissionManager: pm };
}

describe('useShareDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userService.getApprovedUsers.mockResolvedValue([{ id: '1', username: 'user1' }]);
    permissionService.getFolderPermissions.mockResolvedValue([]);
    permissionService.getUserPermissions.mockResolvedValue([]);
    fileService.listFiles.mockResolvedValue([]);
    userService.updateUserPermissions.mockResolvedValue();
    permissionService.grantPermission.mockResolvedValue();
    permissionService.revokePermission.mockResolvedValue();
    permissionRequestService.approvePermissionRequest.mockResolvedValue();
  });

  it('returns rootPath, users, folderTree, expandedPaths, handlers', () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: false,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    expect(typeof result.current.rootPath).toBe('string');
    expect(Array.isArray(result.current.users)).toBe(true);
    expect(result.current.folderTree).toBeInstanceOf(Map);
    expect(result.current.expandedPaths).toBeInstanceOf(Set);
    expect(typeof result.current.toggleExpand).toBe('function');
    expect(typeof result.current.handleSave).toBe('function');
    expect(typeof result.current.handleClose).toBe('function');
  });

  it('rootPath is folderPath when mode is share', () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: false,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    expect(result.current.rootPath).toBe('/docs');
    expect(result.current.isShareMode).toBe(true);
  });

  it('rootPath is folderPath when mode is share with different path', () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: false,
        mode: 'share',
        folderPath: '/shared/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    expect(result.current.rootPath).toBe('/shared/docs');
  });

  it('rootPath is folderPath when mode is review with permissionRequest', () => {
    const permissionRequest = {
      id: 'req-1',
      requester_id: '2',
      requested_paths: ['/shared/item'],
      requester_username: 'bob',
    };
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: false,
        mode: 'review',
        folderPath: '/shared/item',
        folderName: 'item',
        permissionRequest,
        onClose: mockOnClose,
      })
    );

    expect(result.current.rootPath).toBe('/shared/item');
    expect(result.current.isReviewMode).toBe(true);
  });

  it('rootPath from mode admin with startFromUserHome uses getUserBaseFolder', async () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'admin',
        userId: '1',
        username: 'alice',
        startFromUserHome: true,
        folderPath: '/',
        folderName: 'Root',
        onClose: mockOnClose,
      })
    );

    expect(result.current.rootPath).toBe('/alice');
    expect(result.current.isAdminMode).toBe(true);
  });

  it('loads users when open and mode is share', async () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    await waitFor(() => {
      expect(userService.getApprovedUsers).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.users).toEqual([{ id: '1', username: 'user1' }]);
    });
  });

  it('loads folder tree when open', async () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    await waitFor(() => {
      expect(fileService.listFiles).toHaveBeenCalled();
    });
  });

  it('handleSave in share mode calls grantPermission and onClose on success', async () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission('/docs', '2', 'read', []);
    });

    await waitFor(() => {
      expect(result.current.permissionManager.folderPermissions.size).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(permissionService.grantPermission).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleSave in share mode on API failure does not call onClose', async () => {
    permissionService.grantPermission.mockRejectedValue(new Error('Grant failed'));
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission('/docs', '2', 'read', []);
    });

    await waitFor(() => {
      expect(result.current.permissionManager.folderPermissions.size).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.handleSave().catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    );
  });

  it('handleSave in admin mode calls updateUserPermissions and onClose on success', async () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'admin',
        userId: '1',
        username: 'alice',
        startFromUserHome: false,
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission('/alice', '1', 'write', []);
    });

    await waitFor(() => {
      expect(result.current.permissionManager.folderPermissions.size).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(userService.updateUserPermissions).toHaveBeenCalledWith(
      '1',
      expect.any(Array)
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleSave in admin mode on API failure does not call onClose', async () => {
    userService.updateUserPermissions.mockRejectedValue(new Error('Update failed'));
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'admin',
        userId: '1',
        username: 'alice',
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission('/', '1', 'write', []);
    });

    await waitFor(() => {
      expect(result.current.permissionManager.folderPermissions.size).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.handleSave().catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    );
  });

  it('handleClose calls onClose', () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: false,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.handleClose();
    });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('toggleExpand toggles path in expandedPaths and loads children when expanding', async () => {
    fileService.listFiles.mockImplementation((path) => {
      if (path === '/docs') {
        return Promise.resolve([
          { path: '/docs/sub', type: 'directory', basename: 'sub' },
        ]);
      }
      if (path === '/docs/sub') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    expect(result.current.expandedPaths.has('/docs/sub')).toBe(true);

    await act(async () => {
      await result.current.toggleExpand('/docs/sub');
    });

    expect(result.current.expandedPaths.has('/docs/sub')).toBe(false);

    await act(async () => {
      await result.current.toggleExpand('/docs/sub');
    });

    expect(result.current.expandedPaths.has('/docs/sub')).toBe(true);
    expect(fileService.listFiles).toHaveBeenCalledWith('/docs/sub');
  });

  it('handleSave in review mode calls approvePermissionRequest and onApprove on success', async () => {
    const permissionRequest = {
      id: 'req-1',
      requester_id: '2',
      requested_paths: ['/docs'],
      requested_permission: 'read',
      requester_username: 'bob',
    };
    permissionService.getUserPermissions.mockResolvedValue([
      { folder_path: '/docs', permission: 'read', id: '2' },
    ]);
    fileService.listFiles.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'review',
        folderPath: '/docs',
        folderName: 'docs',
        permissionRequest,
        onClose: mockOnClose,
        onApprove: mockOnApprove,
        onMessage: mockOnMessage,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(permissionRequestService.approvePermissionRequest).toHaveBeenCalledWith(
      'req-1'
    );
    expect(mockOnApprove).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleSave in review mode on approve failure does not call onClose', async () => {
    const permissionRequest = {
      id: 'req-1',
      requester_id: '2',
      requested_paths: ['/docs'],
      requested_permission: 'read',
      requester_username: 'bob',
    };
    permissionService.getUserPermissions.mockResolvedValue([
      { folder_path: '/docs', permission: 'read', id: '2' },
    ]);
    permissionRequestService.approvePermissionRequest.mockRejectedValue(
      new Error('Approve failed')
    );
    fileService.listFiles.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'review',
        folderPath: '/docs',
        folderName: 'docs',
        permissionRequest,
        onClose: mockOnClose,
        onApprove: mockOnApprove,
        onMessage: mockOnMessage,
      })
    );

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    await act(async () => {
      await result.current.handleSave().catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    );
  });

  it('returns externalShare state when enableExternalShare', () => {
    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        enableExternalShare: true,
        onClose: mockOnClose,
      })
    );

    expect(typeof result.current.externalShareLoading).toBe('boolean');
    expect(result.current.externalShareLink).toBeNull();
  });
});
