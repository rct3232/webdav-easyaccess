/**
 * useLongPressSelect tests.
 * @see docs/spec/client/components/file-manager/hooks/useLongPressSelect.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useLongPressSelect } from '../useLongPressSelect';

const file = { path: '/test/file.txt', basename: 'file.txt', type: 'file' };

describe('useLongPressSelect', () => {
  let onLongPressSelect;

  beforeEach(() => {
    jest.useFakeTimers();
    onLongPressSelect = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty object when !isMobile', () => {
    const { result } = renderHook(() =>
      useLongPressSelect({ isMobile: false, selectionMode: false, onLongPressSelect })
    );

    const handlers = result.current.getLongPressHandlers(file);

    expect(handlers).toEqual({});
  });

  it('returns empty object when selectionMode', () => {
    const { result } = renderHook(() =>
      useLongPressSelect({ isMobile: true, selectionMode: true, onLongPressSelect })
    );

    const handlers = result.current.getLongPressHandlers(file);

    expect(handlers).toEqual({});
  });

  it('returns empty object when !onLongPressSelect', () => {
    const { result } = renderHook(() =>
      useLongPressSelect({ isMobile: true, selectionMode: false, onLongPressSelect: null })
    );

    const handlers = result.current.getLongPressHandlers(file);

    expect(handlers).toEqual({});
  });

  it('returns onTouchStart, onTouchEnd, onTouchMove when enabled', () => {
    const { result } = renderHook(() =>
      useLongPressSelect({ isMobile: true, selectionMode: false, onLongPressSelect })
    );

    const handlers = result.current.getLongPressHandlers(file);

    expect(handlers).toMatchObject({
      onTouchStart: expect.any(Function),
      onTouchEnd: expect.any(Function),
      onTouchMove: expect.any(Function),
    });
  });

  it('calls onLongPressSelect with file when long-press completes without touch move', () => {
    const { result } = renderHook(() =>
      useLongPressSelect({ isMobile: true, selectionMode: false, onLongPressSelect })
    );

    const handlers = result.current.getLongPressHandlers(file);

    act(() => {
      handlers.onTouchStart();
    });

    expect(onLongPressSelect).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPressSelect).toHaveBeenCalledTimes(1);
    expect(onLongPressSelect).toHaveBeenCalledWith(file);
  });

  it('does not call onLongPressSelect when touch move occurs before timer fires', () => {
    const { result } = renderHook(() =>
      useLongPressSelect({ isMobile: true, selectionMode: false, onLongPressSelect })
    );

    const handlers = result.current.getLongPressHandlers(file);

    act(() => {
      handlers.onTouchStart();
    });

    act(() => {
      handlers.onTouchMove();
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPressSelect).not.toHaveBeenCalled();
  });

  it('does not call onLongPressSelect after unmount (cleanup clears timers)', () => {
    const { result, unmount } = renderHook(() =>
      useLongPressSelect({ isMobile: true, selectionMode: false, onLongPressSelect })
    );

    const handlers = result.current.getLongPressHandlers(file);

    act(() => {
      handlers.onTouchStart();
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onLongPressSelect).not.toHaveBeenCalled();
  });
});
