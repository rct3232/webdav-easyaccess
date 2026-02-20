/**
 * useLongPress tests.
 * @see docs/spec/client/hooks/useLongPress.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useLongPress } from '../useLongPress';

describe('useLongPress', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    if (navigator.vibrate) {
      navigator.vibrate = jest.fn();
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns touch and mouse handlers', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    expect(typeof result.current.onTouchStart).toBe('function');
    expect(typeof result.current.onTouchEnd).toBe('function');
    expect(typeof result.current.onTouchMove).toBe('function');
    expect(typeof result.current.onMouseDown).toBe('function');
    expect(typeof result.current.onMouseUp).toBe('function');
    expect(typeof result.current.onMouseLeave).toBe('function');
  });

  it('calls onLongPress after delay with no move', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 500));

    act(() => {
      result.current.onTouchStart({});
    });

    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('onTouchMove cancels long press', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 500));

    act(() => {
      result.current.onTouchStart({});
    });
    act(() => {
      result.current.onTouchMove();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('onMouseLeave cancels long press', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 500));

    act(() => {
      result.current.onMouseDown({});
    });
    act(() => {
      result.current.onMouseLeave();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('delay option applies custom duration', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 1000));

    act(() => {
      result.current.onTouchStart({});
    });
    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(501);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('onTouchEnd clears timer before fire', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 500));

    act(() => {
      result.current.onTouchStart({});
    });
    act(() => {
      result.current.onTouchEnd();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('onMouseUp clears timer before fire', () => {
    const onLongPress = jest.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, 500));

    act(() => {
      result.current.onMouseDown({});
    });
    act(() => {
      result.current.onMouseUp();
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
