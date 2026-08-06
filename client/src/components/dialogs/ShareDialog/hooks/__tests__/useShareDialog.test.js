/**
 * useShareDialog tests (nodeId-based).
 * @see docs/spec/client/hooks/useShareDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShareDialog } from '../useShareDialog';
import { usePermissionManager } from '../usePermissionManager';

import * as userService from '../../../../../services/userService';
import * as permissionService from '../../../../../services/permissionService';
import * as fileService from '../../../../../services/fileService';
import * as permissionRequestService from '../../../../../services/permissionRequestService';
import { sharePermissionSaveUseCase } from '../../../../../services/sharePermissionSaveUseCase';
import { adminPermissionSaveUseCase } from '../../../../../services/adminPermissionSaveUseCase';
import { shareReviewUseCase } from '../../../../../services/shareReviewUseCase';
jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});
jest.mock('../../../../../services/userService', () => {
  const { createUserServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createUserServiceMock();
});
jest.mock('../../../../../services/permissionService', () => {
  const { createPermissionServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createPermissionServiceMock();
});
jest.mock('../../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createFileServiceMock({ resolvePath: jest.fn() });
});
jest.mock('../../../../../services/permissionRequestService', () => {
  const { createPermissionRequestServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createPermissionRequestServiceMock();
});
jest.mock('../../../../../utils/errorUtils', () => {
  const { createErrorUtilsMock } = require('../../../../../testing/mocks/serviceMocks');
  return createErrorUtilsMock();
});
jest.mock('../../../../../services/sharePermissionSaveUseCase', () => ({
  sharePermissionSaveUseCase: jest.fn(),
}));
jest.mock('../../../../../services/adminPermissionSaveUseCase', () => ({
  adminPermissionSaveUseCase: jest.fn(),
}));
jest.mock('../../../../../services/shareReviewUseCase', () => ({
  shareReviewUseCase: jest.fn(),
}));

const mockOnMessage = jest.fn();
const mockOnSave = jest.fn();
const mockOnApprove = jest.fn();
const mockOnClose = jest.fn();

async function renderOpenUseShareDialog(props) {
  const rendered = renderHook(
    (hookProps) => useShareDialogWithPermissionManager(hookProps),
    { initialProps: { ...props, open: false } }
  );
  await act(async () => {
    rendered.rerender(props);
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

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
  let consoleErrorSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    userService.getApprovedUsers.mockResolvedValue([{ id: '1', username: 'user1' }]);
    permissionService.getFolderPermissions.mockResolvedValue([]);
    permissionService.getUserPermissions.mockResolvedValue([]);
    fileService.listFiles.mockResolvedValue([]);
    fileService.resolvePath.mockResolvedValue({ nodeId: 1 });
    permissionService.grantPermission.mockResolvedValue();
    permissionService.revokePermission.mockResolvedValue();
    permissionRequestService.approvePermissionRequest.mockResolvedValue();
    sharePermissionSaveUseCase.mockResolvedValue();
    adminPermissionSaveUseCase.mockResolvedValue();
    shareReviewUseCase.mockResolvedValue();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('returns rootPath, users, folderTree, expandedNodeIds, handlers', () => {
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
    expect(result.current.expandedNodeIds).toBeInstanceOf(Set);
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
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'admin',
        userId: '1',
        username: 'alice',
        startFromUserHome: true,
        folderPath: '/',
        folderName: 'Root',
        onClose: mockOnClose,
      });

    expect(result.current.rootPath).toBe('/alice');
    expect(result.current.isAdminMode).toBe(true);
  });

  it('loads users when open and mode is share', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      });

    await waitFor(() => {
      expect(userService.getApprovedUsers).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.users).toEqual([{ id: '1', username: 'user1' }]);
    });
  });

  it('loads folder tree when open', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      });

    await waitFor(() => {
      expect(fileService.listFiles).toHaveBeenCalled();
    });
  });

  it('resolves the root path to a nodeId when open', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      });

    await waitFor(() => {
      expect(fileService.resolvePath).toHaveBeenCalledWith('/docs');
      expect(result.current.rootNodeId).toBe(1);
    });
  });

  it('prefers folderNodeId over path resolution when provided', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        folderNodeId: 42,
        onClose: mockOnClose,
      });

    await waitFor(() => {
      expect(result.current.rootNodeId).toBe(42);
    });
    expect(fileService.listFiles).toHaveBeenCalledWith(42);
  });

  it('reuses in-flight load for the same nodeId and resolves all callers', async () => {
    let resolveListFiles;
    fileService.listFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListFiles = resolve;
        })
    );

    const { result } = renderHook(() =>
      useShareDialogWithPermissionManager({
        open: false,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      })
    );

    let firstCall;
    let secondCall;
    act(() => {
      firstCall = result.current.loadFolderChildren(1);
      secondCall = result.current.loadFolderChildren(1);
    });

    expect(fileService.listFiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveListFiles([
        { nodeId: 11, path: '/docs/sub', type: 'directory', basename: 'sub' },
      ]);
      await Promise.all([firstCall, secondCall]);
    });

    await waitFor(() => {
      const root = result.current.folderTree.get(1);
      expect(root).toBeDefined();
      expect(root.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 11, name: 'sub' }),
        ])
      );
    });
  });

  it('handleSave in share mode calls sharePermissionSaveUseCase and onClose on success', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      });

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission(1, '2', 'read', []);
    });

    await waitFor(() => {
      expect(result.current.permissionManager.folderPermissions.size).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(sharePermissionSaveUseCase).toHaveBeenCalledWith({
      initialNodePermissions: expect.any(Map),
      nodePermissions: expect.any(Map),
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleSave in share mode on API failure does not call onClose', async () => {
    sharePermissionSaveUseCase.mockRejectedValue(new Error('Grant failed'));
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      });

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission(1, '2', 'read', []);
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

  it('handleSave in admin mode calls adminPermissionSaveUseCase and onClose on success', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'admin',
        userId: '1',
        username: 'alice',
        startFromUserHome: false,
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      });

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission(1, '1', 'write', []);
    });

    await waitFor(() => {
      expect(result.current.permissionManager.folderPermissions.size).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(adminPermissionSaveUseCase).toHaveBeenCalledWith({
      userId: '1',
      username: 'alice',
      homeFolderNodeId: expect.any(Number),
      initialFolderPermissions: expect.any(Map),
      folderPermissions: expect.any(Map),
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleSave in admin mode on API failure does not call onClose', async () => {
    adminPermissionSaveUseCase.mockRejectedValue(new Error('Update failed'));
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'admin',
        userId: '1',
        username: 'alice',
        onClose: mockOnClose,
        onMessage: mockOnMessage,
      });

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    act(() => {
      result.current.permissionManager.handleAddUserPermission(1, '1', 'write', []);
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

  it('toggleExpand toggles nodeId in expandedNodeIds and loads children when expanding', async () => {
    fileService.listFiles.mockImplementation((nodeId) => {
      if (nodeId === 1) {
        return Promise.resolve([
          { nodeId: 11, path: '/docs/sub', type: 'directory', basename: 'sub' },
        ]);
      }
      if (nodeId === 11) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        onClose: mockOnClose,
      });

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    expect(result.current.expandedNodeIds.has(11)).toBe(true);

    await act(async () => {
      await result.current.toggleExpand(11);
    });

    expect(result.current.expandedNodeIds.has(11)).toBe(false);

    await act(async () => {
      await result.current.toggleExpand(11);
    });

    expect(result.current.expandedNodeIds.has(11)).toBe(true);
    expect(fileService.listFiles).toHaveBeenCalledWith(11);
  });

  it('handleSave in review mode calls shareReviewUseCase and onApprove on success', async () => {
    const permissionRequest = {
      id: 'req-1',
      requester_id: '2',
      requested_paths: ['/docs'],
      file_node_id: 1,
      requested_permission: 'read',
      requester_username: 'bob',
    };
    permissionService.getUserPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read', id: '2' },
    ]);
    fileService.listFiles.mockResolvedValue([]);

    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'review',
        folderPath: '/docs',
        folderName: 'docs',
        permissionRequest,
        onClose: mockOnClose,
        onApprove: mockOnApprove,
        onMessage: mockOnMessage,
      });

    await waitFor(() => {
      expect(result.current.loadingAllFolders).toBe(false);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(shareReviewUseCase).toHaveBeenCalledWith({
      permissionRequestId: 'req-1',
      initialNodePermissions: expect.any(Map),
      nodePermissions: expect.any(Map),
    });
    expect(mockOnApprove).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleSave in review mode on approve failure does not call onClose', async () => {
    const permissionRequest = {
      id: 'req-1',
      requester_id: '2',
      requested_paths: ['/docs'],
      file_node_id: 1,
      requested_permission: 'read',
      requester_username: 'bob',
    };
    permissionService.getUserPermissions.mockResolvedValue([
      { nodeId: 10, permission: 'read', id: '2' },
    ]);
    shareReviewUseCase.mockRejectedValue(
      new Error('Approve failed')
    );
    fileService.listFiles.mockResolvedValue([]);

    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'review',
        folderPath: '/docs',
        folderName: 'docs',
        permissionRequest,
        onClose: mockOnClose,
        onApprove: mockOnApprove,
        onMessage: mockOnMessage,
      });

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

  it('returns externalShare state when enableExternalShare', async () => {
    const { result } = await renderOpenUseShareDialog({
        open: true,
        mode: 'share',
        folderPath: '/docs',
        folderName: 'docs',
        enableExternalShare: true,
        onClose: mockOnClose,
      });

    expect(typeof result.current.externalShareLoading).toBe('boolean');
    expect(result.current.externalShareLink).toBeNull();
  });
});
