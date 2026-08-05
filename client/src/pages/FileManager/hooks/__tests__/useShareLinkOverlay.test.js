/**
 * useShareLinkOverlay tests.
 * @see docs/spec/client/hooks/useShareLinkOverlay.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';

jest.mock('../../../../services/shareLinkService', () => ({
  addShareLinkToMyPermissions: jest.fn(),
  checkMyPermissionForShare: jest.fn(),
}));

import {
  addShareLinkToMyPermissions,
  checkMyPermissionForShare,
} from '../../../../services/shareLinkService';
import { useShareLinkOverlay } from '../useShareLinkOverlay';

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

  it('routes to the legacy path route when linkInfo carries no nodeId', async () => {
    const props = createDefaultProps({
      linkInfo: { filePath: '/shared/root', isDirectory: true },
    });
    checkMyPermissionForShare.mockResolvedValue({ hasSufficientPermission: true });

    const { result } = renderHook(() => useShareLinkOverlay(props));

    await waitFor(() => {
      expect(result.current.addToSharedModalOpen).toBe(false);
    });

    expect(props.navigate).toHaveBeenCalledWith('/files/shared/root');
  });

  it('confirms add-to-shared, keeps loading state, and routes to the shared directory by nodeId on success', async () => {
    const props = createDefaultProps({
      isShareLinkMode: false,
      user: null,
    });
    let resolveAdd;
    addShareLinkToMyPermissions.mockImplementation(() => new Promise((resolve) => {
      resolveAdd = resolve;
    }));

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

  it('opens leave-share confirmation and routes to files path after confirm', () => {
    const props = createDefaultProps({
      isShareLinkMode: false,
      user: null,
    });

    const { result } = renderHook(() => useShareLinkOverlay(props));

    act(() => {
      result.current.handleLeaveSharePathClick('/docs');
    });

    expect(result.current.leaveShareConfirmOpen).toBe(true);
    expect(result.current.leaveShareConfirmTargetPath).toBe('/docs');

    act(() => {
      result.current.handleLeaveShareConfirm();
    });

    expect(props.navigate).toHaveBeenCalledWith('/files/docs');
    expect(props.setDrawerOpen).toHaveBeenCalledWith(false);
    expect(result.current.leaveShareConfirmOpen).toBe(false);
    expect(result.current.leaveShareConfirmTargetPath).toBe(null);
  });

  it('does not re-run bootstrap for the same share token after rerender', async () => {
    checkMyPermissionForShare.mockResolvedValue({ hasSufficientPermission: false });
    const props = createDefaultProps();

    const { rerender } = renderHook(
      ({ hookProps }) => useShareLinkOverlay(hookProps),
      { initialProps: { hookProps: props } }
    );

    await waitFor(() => {
      expect(checkMyPermissionForShare).toHaveBeenCalledTimes(1);
    });

    rerender({ hookProps: createDefaultProps() });

    await waitFor(() => {
      expect(checkMyPermissionForShare).toHaveBeenCalledTimes(1);
    });
  });
});
