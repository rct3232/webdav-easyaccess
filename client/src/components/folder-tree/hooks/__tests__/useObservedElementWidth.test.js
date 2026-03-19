import { renderHook, act } from '@testing-library/react';

import useObservedElementWidth from '../useObservedElementWidth';

jest.mock('../../../../services/resizeObserverAdapter', () => ({
  observeElementWidth: jest.fn(),
}));

import { observeElementWidth } from '../../../../services/resizeObserverAdapter';

describe('useObservedElementWidth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    observeElementWidth.mockImplementation(() => jest.fn());
  });

  it('returns the initial width before an element is attached', () => {
    const { result } = renderHook(() => useObservedElementWidth(180));

    expect(result.current.width).toBe(180);
    expect(typeof result.current.setObservedElement).toBe('function');
  });

  it('updates width when the observer adapter reports a new value', () => {
    observeElementWidth.mockImplementation((element, onWidthChange) => {
      if (element) {
        onWidthChange(320);
      }
      return jest.fn();
    });

    const { result } = renderHook(() => useObservedElementWidth(180));

    act(() => {
      result.current.setObservedElement({ nodeType: 1 });
    });

    expect(result.current.width).toBe(320);
  });

  it('disconnects the previous observer when the observed element changes and on unmount', () => {
    const cleanupFirst = jest.fn();
    const cleanupSecond = jest.fn();

    observeElementWidth
      .mockImplementationOnce(() => jest.fn())
      .mockImplementationOnce(() => cleanupFirst)
      .mockImplementationOnce(() => cleanupSecond);

    const { result, unmount } = renderHook(() => useObservedElementWidth());

    act(() => {
      result.current.setObservedElement({ id: 'first' });
    });

    act(() => {
      result.current.setObservedElement({ id: 'second' });
    });

    expect(cleanupFirst).toHaveBeenCalledTimes(1);

    unmount();

    expect(cleanupSecond).toHaveBeenCalledTimes(1);
  });
});
