/**
 * useShareLinkOverlay tests.
 * @see docs/spec/client/hooks/useShareLinkOverlay.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';

import {
  addShareLinkToMyPermissions,
  checkMyPermissionForShare,
} from '../../../../services/shareLinkService';
import { useShareLinkOverlay } from '../useShareLinkOverlay';

jest.mock('../../../../services/shareLinkService', () => ({
  addShareLinkToMyPermissions: jest.fn(),
  checkMyPermissionForShare: jest.fn(),
}));

function createDefaultProps(overrides = {}) {
  return {
    isShareLinkMode: true,
    shareToken: 'share-token',
    linkInfo: {
      filePath: '/shared/root',
      nodeId: 5,
      isDirectory: true,
    },
    user: { id: 'user-1' },
    navigate: jest.fn(),
    showError: jest.fn(),
    setDrawerOpen: jest.fn(),
    t: (key) => key,
    ...overrides,
  };
}

describe('useShareLinkOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bootstraps add-to-shared modal for authenticated share entry and settles to confirm state', async () => {
    checkMyPermissionForShare.mockResolvedValue({ hasSufficientPermission: false });

    const { result } = renderHook(() => useShareLinkOverlay(createDefaultProps()));

    await waitFor(() => {
      expect(result.current.addToSharedModalOpen).toBe(true);
      expect(result.current.addToSharedStatus).toBe('confirm');
    });

    expect(checkMyPermissionForShare).toHaveBeenCalledWith('share-token');
  });

  it('closes the modal and routes to the shared directory by nodeId when permission already exists', async () => {
    const props = createDefaultProps();
    checkMyPermissionForShare.mockResolvedValue({ hasSufficientPermission: true });

    const { result } = renderHook(() => useShareLinkOverlay(props));

    await waitFor(() => {
      expect(result.current.addToSharedModalOpen).toBe(false);
    });

    expect(props.navigate).toHaveBeenCalledWith('/files/node/5');
  });

  it('routes to the root path when linkInfo carries no nodeId', async () => {
    const props = createDefaultProps({
      linkInfo: { filePath: '/shared/root', isDirectory: true },
    });
    checkMyPermissionForShare.mockResolvedValue({ hasSufficientPermission: true });

    const { result } = renderHook(() => useShareLinkOverlay(props));

    await waitFor(() => {
      expect(result.current.addToSharedModalOpen).toBe(false);
    });

    expect(props.navigate).toHaveBeenCalledWith('/');
  });

  it('confirms add-to-shared, keeps loading state, and routes to the shared directory by nodeId on success', async () => {
    const props = createDefaultProps({
      isShareLinkMode: false,
      user: null,
    });
    let resolveAdd;
    addShareLinkToMyPermissions.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        })
    );

    const { result } = renderHook(() => useShareLinkOverlay(props));
    let pendingConfirm;

    act(() => {
      pendingConfirm = result.current.handleAddToSharedConfirm();
    });

    await waitFor(() => {
      expect(result.current.addToSharedConfirmLoading).toBe(true);
    });

    await act(async () => {
      resolveAdd();
      await pendingConfirm;
    });

    expect(addShareLinkToMyPermissions).toHaveBeenCalledWith('share-token');
    expect(result.current.addToSharedConfirmLoading).toBe(false);
    expect(props.navigate).toHaveBeenCalledWith('/files/node/5');
  });

  it('opens leave-share confirmation for a node id target and routes by nodeId after confirm', () => {
    const props = createDefaultProps();

    const { result } = renderHook(() => useShareLinkOverlay(props));

    act(() => {
      result.current.handleLeaveSharePathClick(42);
    });

    expect(result.current.leaveShareConfirmOpen).toBe(true);
    expect(result.current.leaveShareConfirmTargetNodeId).toBe(42);
    expect(result.current.leaveShareConfirmTargetPath).toBe(null);

    act(() => {
      result.current.handleLeaveShareConfirm();
    });

    expect(props.navigate).toHaveBeenCalledWith('/files/node/42');
    expect(props.setDrawerOpen).toHaveBeenCalledWith(false);
    expect(result.current.leaveShareConfirmOpen).toBe(false);
    expect(result.current.leaveShareConfirmTargetNodeId).toBe(null);
    expect(result.current.leaveShareConfirmTargetPath).toBe(null);
  });

  it('opens leave-share confirmation for a path target and routes via toFilesPath after confirm', () => {
    const props = createDefaultProps();

    const { result } = renderHook(() => useShareLinkOverlay(props));

    act(() => {
      result.current.handleLeaveSharePathClick('/__shared__');
    });

    expect(result.current.leaveShareConfirmOpen).toBe(true);
    expect(result.current.leaveShareConfirmTargetPath).toBe('/__shared__');
    expect(result.current.leaveShareConfirmTargetNodeId).toBe(null);

    act(() => {
      result.current.handleLeaveShareConfirm();
    });

    expect(props.navigate).toHaveBeenCalledWith('/files/__shared__');
    expect(result.current.leaveShareConfirmOpen).toBe(false);
  });

  it('normalizes a null/undefined leave-share target to the explorer home route', () => {
    const props = createDefaultProps();

    const { result } = renderHook(() => useShareLinkOverlay(props));

    act(() => {
      result.current.handleLeaveSharePathClick(null);
    });

    expect(result.current.leaveShareConfirmOpen).toBe(true);
    expect(result.current.leaveShareConfirmTargetPath).toBe('/');

    act(() => {
      result.current.handleLeaveShareConfirm();
    });

    expect(props.navigate).toHaveBeenCalledWith('/files');
    expect(result.current.leaveShareConfirmOpen).toBe(false);
  });

  it('does not navigate when leave-share is confirmed without a pending target', () => {
    const props = createDefaultProps();

    const { result } = renderHook(() => useShareLinkOverlay(props));

    act(() => {
      result.current.handleLeaveShareConfirm();
    });

    expect(props.navigate).not.toHaveBeenCalled();
    expect(result.current.leaveShareConfirmOpen).toBe(false);
  });

  it('does not re-run bootstrap for the same share token after rerender', async () => {
    checkMyPermissionForShare.mockResolvedValue({ hasSufficientPermission: false });
    const props = createDefaultProps();

    const { rerender } = renderHook(({ hookProps }) => useShareLinkOverlay(hookProps), {
      initialProps: { hookProps: props },
    });

    await waitFor(() => {
      expect(checkMyPermissionForShare).toHaveBeenCalledTimes(1);
    });

    rerender({ hookProps: createDefaultProps() });

    await waitFor(() => {
      expect(checkMyPermissionForShare).toHaveBeenCalledTimes(1);
    });
  });
});
