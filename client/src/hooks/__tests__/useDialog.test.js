import { renderHook, act } from '@testing-library/react';
import useDialog from '../useDialog';

describe('useDialog', () => {
  it('initializes with default state', () => {
    const { result } = renderHook(() => useDialog());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.data).toBe(null);
  });

  it('initializes with custom initialState', () => {
    const { result } = renderHook(() => useDialog({ initialState: true }));
    expect(result.current.isOpen).toBe(true);
  });

  it('opens and sets data', () => {
    const onOpen = jest.fn();
    const { result } = renderHook(() => useDialog({ onOpen }));
    const mockData = { id: 1, name: 'test' };

    act(() => {
      result.current.open(mockData);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.data).toBe(mockData);
    expect(onOpen).toHaveBeenCalledWith(mockData);
  });

  it('closes and clears data', () => {
    const onClose = jest.fn();
    const { result } = renderHook(() => useDialog({ onClose, initialState: true }));
    
    act(() => {
      result.current.setData({ id: 1 });
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.data).toBe(null);
    expect(onClose).toHaveBeenCalled();
  });

  it('manually sets data', () => {
    const { result } = renderHook(() => useDialog());
    const mockData = { val: 'test' };

    act(() => {
      result.current.setData(mockData);
    });

    expect(result.current.data).toBe(mockData);
  });
});
