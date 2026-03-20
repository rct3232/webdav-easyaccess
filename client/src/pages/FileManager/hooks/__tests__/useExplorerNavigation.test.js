/**
 * useExplorerNavigation tests.
 * @see docs/spec/client/hooks/useExplorerNavigation.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useExplorerNavigation } from '../useExplorerNavigation';

describe('useExplorerNavigation', () => {
  it('optimistically sets the normalized path and tracks history', async () => {
    const setCurrentPath = jest.fn();
    const canNavigateToPath = jest.fn().mockResolvedValue(true);
    const onTrackPathHistory = jest.fn();
    const onAfterNavigate = jest.fn();

    const { result } = renderHook(() => useExplorerNavigation({
      currentPath: '/docs',
      getPreviousPath: () => '/docs',
      setCurrentPath,
      onAfterNavigate,
      onTrackPathHistory,
      canNavigateToPath,
    }));

    await act(async () => {
      await result.current.navigateToPath('/docs/reports/');
    });

    expect(setCurrentPath).toHaveBeenCalledWith('/docs/reports');
    expect(onAfterNavigate).toHaveBeenCalledWith('/docs/reports');
    expect(onTrackPathHistory).toHaveBeenNthCalledWith(1, '/docs/reports', '/docs');
    expect(onTrackPathHistory).toHaveBeenNthCalledWith(2, '/docs/reports/', '/docs');
    expect(canNavigateToPath).toHaveBeenCalledWith('/docs/reports');
    expect(result.current.isNavigating).toBe(false);
  });

  it('rolls back to the previous path and rethrows when guard rejects', async () => {
    const setCurrentPath = jest.fn();
    const error = new Error('network failed');
    const canNavigateToPath = jest.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useExplorerNavigation({
      currentPath: '/docs',
      getPreviousPath: () => '/docs',
      setCurrentPath,
      canNavigateToPath,
    }));

    let thrown;
    await act(async () => {
      try {
        await result.current.navigateToPath('/docs/private');
      } catch (caught) {
        thrown = caught;
      }
    });

    expect(thrown).toBe(error);
    expect(setCurrentPath).toHaveBeenNthCalledWith(1, '/docs/private');
    expect(setCurrentPath).toHaveBeenNthCalledWith(2, '/docs');
  });

  it('rolls back and throws a forbidden-shaped error when guard returns false', async () => {
    const setCurrentPath = jest.fn();
    const canNavigateToPath = jest.fn().mockResolvedValue(false);

    const { result } = renderHook(() => useExplorerNavigation({
      currentPath: '/docs',
      getPreviousPath: () => '/docs',
      setCurrentPath,
      canNavigateToPath,
    }));

    let thrown;
    await act(async () => {
      try {
        await result.current.handleFolderOpen('/docs/private');
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeDefined();
    expect(thrown.response?.status).toBe(403);
    expect(setCurrentPath).toHaveBeenNthCalledWith(1, '/docs/private');
    expect(setCurrentPath).toHaveBeenNthCalledWith(2, '/docs');
  });

  it('is a no-op when navigating to the same normalized path', async () => {
    const setCurrentPath = jest.fn();
    const canNavigateToPath = jest.fn();

    const { result } = renderHook(() => useExplorerNavigation({
      currentPath: '/docs/reports',
      getPreviousPath: () => '/docs/reports',
      setCurrentPath,
      canNavigateToPath,
    }));

    await act(async () => {
      await result.current.navigateToPath('/docs/reports/');
    });

    expect(setCurrentPath).not.toHaveBeenCalled();
    expect(canNavigateToPath).not.toHaveBeenCalled();
  });
});
