/**
 * useExplorerRefreshIndicator tests.
 * @see docs/spec/client/hooks/useExplorerRefreshIndicator.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';

jest.mock('../../../../hooks/usePullToRefresh', () => ({
  usePullToRefresh: jest.fn(),
}));

import { usePullToRefresh } from '../../../../hooks/usePullToRefresh';
import { useExplorerRefreshIndicator } from '../useExplorerRefreshIndicator';

function createDefaultProps(overrides = {}) {
  return {
    isMobile: true,
    loading: false,
    loadFiles: jest.fn(),
    scrollContainerRef: { current: { scrollTop: 0 } },
    t: (key) => key,
    ...overrides,
  };
}

function mockPullState(overrides = {}) {
  const resetPull = jest.fn();
  usePullToRefresh.mockReturnValue({
    pullDistance: 0,
    isPulling: false,
    isRefreshing: false,
    threshold: 240,
    resetPull,
    ...overrides,
  });
  return { resetPull };
}

describe('useExplorerRefreshIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('shows success state on mobile refresh completion, then hides it and resets pull state', () => {
    const { resetPull } = mockPullState();
    const { result } = renderHook(() => useExplorerRefreshIndicator(createDefaultProps()));

    act(() => {
      result.current.handleRefreshComplete();
    });

    expect(result.current.showRefreshSuccess).toBe(true);
    expect(result.current.textContent).toBe('fileManager.pullRefreshDone');

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.showRefreshSuccess).toBe(false);
    expect(resetPull).toHaveBeenCalled();
  });

  it('stays inert on desktop even when refresh completion callback is triggered', () => {
    mockPullState();
    const { result } = renderHook(() => useExplorerRefreshIndicator(createDefaultProps({
      isMobile: false,
    })));

    act(() => {
      result.current.handleRefreshComplete();
      jest.advanceTimersByTime(500);
    });

    expect(result.current.showRefreshSuccess).toBe(false);
    expect(result.current.shouldShowIndicator).toBe(false);
  });

  it('does not show success indicator from load completion while pull refresh is still active', () => {
    mockPullState({
      isRefreshing: true,
    });
    const { result } = renderHook(() => useExplorerRefreshIndicator(createDefaultProps()));

    act(() => {
      result.current.handleLoadComplete();
      jest.advanceTimersByTime(500);
    });

    expect(result.current.showRefreshSuccess).toBe(false);
    expect(result.current.textContent).toBe('fileManager.pullRefreshLoading');
  });

  it('returns pulling state for determinate progress before reaching the threshold', () => {
    mockPullState({
      pullDistance: 120,
      isPulling: true,
      threshold: 240,
    });

    const { result } = renderHook(() => useExplorerRefreshIndicator(createDefaultProps()));

    expect(result.current.progress).toBe(0.5);
    expect(result.current.isDeterminateProgress).toBe(true);
    expect(result.current.textContent).toBe('fileManager.pullRefreshPull');
    expect(result.current.progressColor).toBe('text.disabled');
    expect(result.current.shouldShowIndicator).toBe(true);
  });

  it('returns release-to-refresh state after reaching the threshold', () => {
    mockPullState({
      pullDistance: 240,
      isPulling: true,
      threshold: 240,
    });

    const { result } = renderHook(() => useExplorerRefreshIndicator(createDefaultProps()));

    expect(result.current.textContent).toBe('fileManager.pullRefreshRelease');
    expect(result.current.progressColor).toBe('primary.main');
    expect(result.current.textColor).toBe('primary.main');
  });
});
