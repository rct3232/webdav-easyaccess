/**
 * usePullToRefresh tests.
 * @see docs/spec/client/hooks/usePullToRefresh.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { render, screen, renderHook, act } from '@testing-library/react';
import { usePullToRefresh } from '../usePullToRefresh';

function TestComponent({ onRefresh, options = {} }) {
  const scrollContainerRef = React.useRef(null);
  const result = usePullToRefresh(onRefresh, { ...options, scrollContainerRef });
  return (
    <div>
      <div
        ref={scrollContainerRef}
        data-testid="scroll-container"
        style={{ height: 200, overflow: 'auto' }}
      />
      <span data-testid="pull-distance">{result.pullDistance}</span>
      <span data-testid="can-pull">{String(result.canPull)}</span>
      <span data-testid="is-pulling">{String(result.isPulling)}</span>
      <span data-testid="is-refreshing">{String(result.isRefreshing)}</span>
      <button
        data-testid="reset-pull"
        onClick={result.resetPull}
      >
        Reset
      </button>
    </div>
  );
}

function triggerTouchEvent(element, type, { clientY = 0, clientX = 0 }) {
  const touch = { clientY, clientX };
  const ev = new TouchEvent(type, {
    touches: type === 'touchend' ? [] : [touch],
    changedTouches: [touch],
    cancelable: true,
    bubbles: true,
  });
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [touch] });
  element.dispatchEvent(ev);
  return ev;
}

describe('usePullToRefresh', () => {
  it('returns pullDistance, isPulling, isRefreshing, canPull, resetPull', () => {
    const mockOnRefresh = jest.fn();
    render(<TestComponent onRefresh={mockOnRefresh} />);

    expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    expect(screen.getByTestId('can-pull').textContent).toBe('true');
    expect(screen.getByTestId('is-pulling').textContent).toBe('false');
    expect(screen.getByTestId('is-refreshing').textContent).toBe('false');
    expect(screen.getByTestId('reset-pull')).toBeInTheDocument();
  });

  it('canPull is false when scrollContainerRef has no current', () => {
    const mockOnRefresh = jest.fn();
    const { result } = renderHook(() =>
      usePullToRefresh(mockOnRefresh, { scrollContainerRef: { current: null } })
    );

    expect(result.current.canPull).toBe(false);
  });

  it('resetPull clears pullDistance and isPulling', () => {
    const mockOnRefresh = jest.fn();
    render(<TestComponent onRefresh={mockOnRefresh} />);

    const container = screen.getByTestId('scroll-container');
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true });

    act(() => {
      triggerTouchEvent(container, 'touchstart', { clientY: 100, clientX: 50 });
    });
    act(() => {
      triggerTouchEvent(container, 'touchmove', { clientY: 150, clientX: 50 });
    });

    const pullDistanceEl = screen.getByTestId('pull-distance');
    const isPullingEl = screen.getByTestId('is-pulling');
    expect(Number(pullDistanceEl.textContent)).toBeGreaterThan(0);
    expect(isPullingEl.textContent).toBe('true');

    act(() => {
      screen.getByTestId('reset-pull').click();
    });

    expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    expect(screen.getByTestId('is-pulling').textContent).toBe('false');
  });

  it('calls onRefresh when pull exceeds threshold', async () => {
    const mockOnRefresh = jest.fn().mockResolvedValue();
    render(<TestComponent onRefresh={mockOnRefresh} options={{ threshold: 50 }} />);

    const container = screen.getByTestId('scroll-container');
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 500 });
    Object.defineProperty(container, 'clientHeight', { value: 200 });
    container.getBoundingClientRect = () => ({ top: 0 });

    act(() => {
      triggerTouchEvent(container, 'touchstart', { clientY: 100, clientX: 50 });
    });
    act(() => {
      triggerTouchEvent(container, 'touchmove', { clientY: 200, clientX: 50 });
    });
    act(() => {
      triggerTouchEvent(container, 'touchend', { clientY: 200, clientX: 50 });
    });

    await act(async () => {
      await mockOnRefresh;
    });

    expect(mockOnRefresh).toHaveBeenCalled();
  });
});
