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

jest.mock('../../services/sharePermissionGateway', () => ({
  checkPermission: jest.fn(),
  checkOwnerExists: jest.fn(),
  listOutboxPermissionRequests: jest.fn(),
  createPermissionRequest: jest.fn(),
  cancelPermissionRequest: jest.fn(),
  revokePermission: jest.fn(),
}));

import * as sharePermissionGateway from '../../services/sharePermissionGateway';

const mockUser = { id: '1', username: 'user1', is_admin: false };
const mockAdminUser = { id: 'admin', username: 'admin', is_admin: true };
const mockOnMessage = jest.fn();
const mockOnClose = jest.fn();
const mockOnActionComplete = jest.fn();

async function renderOpenUseSharedManage(props) {
  const rendered = renderHook(
    (hookProps) => useSharedManage(hookProps),
    { initialProps: { ...props, open: false } }
  );
  await act(async () => {
    rendered.rerender(props);
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

const defaultProps = {
  open: true,
  targetNodeId: 100,
  displayName: 'folder',
  isDirectory: true,
  user: mockUser,
};

describe('useSharedManage', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    sharePermissionGateway.checkPermission.mockResolvedValue({ hasRead: true, hasWrite: false });
    sharePermissionGateway.checkOwnerExists.mockResolvedValue({ ownerExists: true });
    sharePermissionGateway.listOutboxPermissionRequests.mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
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
    const { result } = await renderOpenUseSharedManage({ ...defaultProps, user: mockAdminUser });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(result.current.hasReadPermission).toBe(true);
    expect(result.current.hasWritePermission).toBe(true);
    expect(sharePermissionGateway.checkPermission).not.toHaveBeenCalled();
  });

  it('loads permission info via checkPermission when open', async () => {
    const { result } = await renderOpenUseSharedManage(defaultProps);

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(sharePermissionGateway.checkPermission).toHaveBeenCalledWith(100);
    expect(result.current.hasReadPermission).toBe(true);
    expect(result.current.hasWritePermission).toBe(false);
  });

  it('derives file target pathPermission and filePermissionLevel from file and parent checks', async () => {
    sharePermissionGateway.checkPermission
      .mockResolvedValueOnce({ hasRead: true, hasWrite: false, source: 'file' })
      .mockResolvedValueOnce({ hasRead: true, hasWrite: false });

    const { result } = await renderOpenUseSharedManage({
      ...defaultProps,
      targetNodeId: 200,
      parentNodeId: 150,
      displayName: 'file.txt',
      isDirectory: false,
    });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(sharePermissionGateway.checkPermission).toHaveBeenNthCalledWith(1, 200);
    expect(sharePermissionGateway.checkPermission).toHaveBeenNthCalledWith(2, 150);
    expect(result.current.pathPermission).toBe('read');
    expect(result.current.filePermissionLevel).toBe('read');
  });

  it('directHasReadPermission overrides computed read access', async () => {
    sharePermissionGateway.checkPermission.mockResolvedValue({ hasRead: true, hasWrite: true });

    const { result } = await renderOpenUseSharedManage({
      ...defaultProps,
      directHasReadPermission: false,
    });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(result.current.hasReadPermission).toBe(false);
    expect(result.current.hasWritePermission).toBe(true);
  });

  it('ownerExists reflects checkOwnerExists result', async () => {
    sharePermissionGateway.checkOwnerExists.mockResolvedValue({ ownerExists: true });
    const { result } = await renderOpenUseSharedManage(defaultProps);

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    expect(result.current.ownerExists).toBe(true);
  });

  it('handlePermissionRequest calls createPermissionRequest and onMessage on success', async () => {
    sharePermissionGateway.createPermissionRequest.mockResolvedValue({ id: 'req-1' });
    const { result } = await renderOpenUseSharedManage({ ...defaultProps, onMessage: mockOnMessage });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handlePermissionRequest(PERMISSIONS.READ);
    });

    expect(sharePermissionGateway.createPermissionRequest).toHaveBeenCalledWith({
      nodeId: 100,
      permission: PERMISSIONS.READ,
    });
    expect(mockOnMessage).toHaveBeenCalledWith({
      show: true,
      text: 'sharedManage.requestSentSuccess',
      type: 'success',
    });

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockOnMessage).toHaveBeenLastCalledWith({
      show: false,
      text: '',
      type: 'success',
    });
  });

  it('handleRevokePermission calls revokePermission and onClose on success', async () => {
    sharePermissionGateway.revokePermission.mockResolvedValue();
    const { result } = await renderOpenUseSharedManage({
      ...defaultProps,
      onMessage: mockOnMessage,
      onClose: mockOnClose,
      onActionComplete: mockOnActionComplete,
    });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleRevokePermission();
    });

    expect(sharePermissionGateway.revokePermission).toHaveBeenCalledWith({
      userId: mockUser.id,
      nodeId: 100,
    });
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnActionComplete).toHaveBeenCalled();
  });

  it('handleRevokePermission on API failure does not call onClose', async () => {
    sharePermissionGateway.revokePermission.mockRejectedValue(new Error('Revoke failed'));
    const { result } = await renderOpenUseSharedManage({
      ...defaultProps,
      onMessage: mockOnMessage,
      onClose: mockOnClose,
    });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleRevokePermission().catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnMessage).toHaveBeenCalledWith({
      show: true,
      text: 'errors.unknown',
      type: 'error',
    });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockOnMessage).toHaveBeenLastCalledWith({
      show: false,
      text: '',
      type: 'success',
    });
  });

  it('handleCancelPendingRequest calls cancelPermissionRequest when pending request exists', async () => {
    sharePermissionGateway.listOutboxPermissionRequests.mockResolvedValue([
      { id: 'req-1', file_node_id: 100, requested_permission: PERMISSIONS.READ },
    ]);
    sharePermissionGateway.cancelPermissionRequest.mockResolvedValue();

    const { result } = await renderOpenUseSharedManage({ ...defaultProps, onMessage: mockOnMessage });

    await waitFor(() => {
      expect(result.current.initialLoading).toBe(false);
      expect(result.current.pendingRequest?.read?.pending).toBe(true);
    });

    await act(async () => {
      await result.current.handleCancelPendingRequest(PERMISSIONS.READ);
    });

    expect(sharePermissionGateway.cancelPermissionRequest).toHaveBeenCalledWith('req-1');
    expect(mockOnMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' })
    );
  });

  it('maps pending file requests by file_node_id', async () => {
    sharePermissionGateway.checkPermission
      .mockResolvedValueOnce({ hasRead: true, hasWrite: false, source: 'path' })
      .mockResolvedValueOnce({ hasRead: true, hasWrite: false });
    sharePermissionGateway.listOutboxPermissionRequests.mockResolvedValue([
      { id: 'req-file', file_node_id: 200, requested_permission: PERMISSIONS.WRITE },
    ]);

    const { result } = await renderOpenUseSharedManage({
      ...defaultProps,
      targetNodeId: 200,
      parentNodeId: 150,
      displayName: 'file.txt',
      isDirectory: false,
    });

    await waitFor(() => {
      expect(result.current.pendingRequest.write).toEqual({ pending: true, id: 'req-file' });
    });
  });
});
