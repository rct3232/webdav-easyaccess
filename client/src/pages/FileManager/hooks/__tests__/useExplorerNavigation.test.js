/**
 * useExplorerNavigation tests.
 * @see docs/spec/client/hooks/useExplorerNavigation.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useExplorerNavigation } from '../useExplorerNavigation';

describe('useExplorerNavigation', () => {
  it('optimistically sets the node and tracks node history', async () => {
    const setCurrentNodeId = jest.fn();
    const canNavigateToNode = jest.fn().mockResolvedValue(true);
    const onTrackNodeHistory = jest.fn();
    const onAfterNavigate = jest.fn();

    const { result } = renderHook(() => useExplorerNavigation({
      currentNodeId: 1,
      getPreviousNodeId: () => 1,
      setCurrentNodeId,
      onAfterNavigate,
      onTrackNodeHistory,
      canNavigateToNode,
    }));

    await act(async () => {
      await result.current.navigateToNode(2);
    });

    expect(setCurrentNodeId).toHaveBeenCalledWith(2);
    expect(onAfterNavigate).toHaveBeenCalledWith(2);
    expect(onTrackNodeHistory).toHaveBeenCalledTimes(1);
    expect(onTrackNodeHistory).toHaveBeenCalledWith(2, 1);
    expect(canNavigateToNode).toHaveBeenCalledWith(2);
    expect(result.current.isNavigating).toBe(false);
  });

  it('rolls back to the previous node and rethrows when guard rejects', async () => {
    const setCurrentNodeId = jest.fn();
    const error = new Error('network failed');
    const canNavigateToNode = jest.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useExplorerNavigation({
      currentNodeId: 1,
      getPreviousNodeId: () => 1,
      setCurrentNodeId,
      canNavigateToNode,
    }));

    let thrown;
    await act(async () => {
      try {
        await result.current.navigateToNode(2);
      } catch (caught) {
        thrown = caught;
      }
    });

    expect(thrown).toBe(error);
    expect(setCurrentNodeId).toHaveBeenNthCalledWith(1, 2);
    expect(setCurrentNodeId).toHaveBeenNthCalledWith(2, 1);
  });

  it('rolls back and throws a forbidden-shaped error when guard returns false', async () => {
    const setCurrentNodeId = jest.fn();
    const canNavigateToNode = jest.fn().mockResolvedValue(false);

    const { result } = renderHook(() => useExplorerNavigation({
      currentNodeId: 1,
      getPreviousNodeId: () => 1,
      setCurrentNodeId,
      canNavigateToNode,
    }));

    let thrown;
    await act(async () => {
      try {
        await result.current.handleFolderOpen(2);
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeDefined();
    expect(thrown.response?.status).toBe(403);
    expect(setCurrentNodeId).toHaveBeenNthCalledWith(1, 2);
    expect(setCurrentNodeId).toHaveBeenNthCalledWith(2, 1);
  });

  it('is a no-op when navigating to the same node', async () => {
    const setCurrentNodeId = jest.fn();
    const canNavigateToNode = jest.fn();

    const { result } = renderHook(() => useExplorerNavigation({
      currentNodeId: 2,
      getPreviousNodeId: () => 2,
      setCurrentNodeId,
      canNavigateToNode,
    }));

    await act(async () => {
      await result.current.navigateToNode(2);
    });

    expect(setCurrentNodeId).not.toHaveBeenCalled();
    expect(canNavigateToNode).not.toHaveBeenCalled();
  });

  it('is a no-op for empty nodeId inputs', async () => {
    const setCurrentNodeId = jest.fn();
    const canNavigateToNode = jest.fn();

    const { result } = renderHook(() => useExplorerNavigation({
      currentNodeId: null,
      getPreviousNodeId: () => null,
      setCurrentNodeId,
      canNavigateToNode,
    }));

    await act(async () => {
      await result.current.navigateToNode(null);
      await result.current.handleFolderOpen(undefined);
    });

    expect(setCurrentNodeId).not.toHaveBeenCalled();
    expect(canNavigateToNode).not.toHaveBeenCalled();
  });
});
