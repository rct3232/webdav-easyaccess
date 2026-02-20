/**
 * useDialog tests.
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import useDialog from '../useDialog';

describe('useDialog', () => {
  it('returns closed state by default', () => {
    const { result } = renderHook(() => useDialog());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('uses initialState when provided', () => {
    const { result } = renderHook(() => useDialog({ initialState: true }));

    expect(result.current.isOpen).toBe(true);
  });

  it('open sets isOpen true and stores data', () => {
    const { result } = renderHook(() => useDialog());

    act(() => {
      result.current.open({ id: '123', name: 'test' });
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.data).toEqual({ id: '123', name: 'test' });
  });

  it('close sets isOpen false and clears data', () => {
    const { result } = renderHook(() => useDialog());

    act(() => {
      result.current.open({ id: '123' });
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('calls onOpen when open is invoked', () => {
    const onOpen = jest.fn();
    const { result } = renderHook(() => useDialog({ onOpen }));

    act(() => {
      result.current.open({ foo: 'bar' });
    });

    expect(onOpen).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('calls onClose when close is invoked', () => {
    const onClose = jest.fn();
    const { result } = renderHook(() => useDialog({ onClose }));

    act(() => {
      result.current.open({});
    });
    act(() => {
      result.current.close();
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('setData updates data without changing isOpen', () => {
    const { result } = renderHook(() => useDialog());

    act(() => {
      result.current.open({ a: 1 });
    });
    expect(result.current.data).toEqual({ a: 1 });

    act(() => {
      result.current.setData({ b: 2 });
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.data).toEqual({ b: 2 });
  });
});
