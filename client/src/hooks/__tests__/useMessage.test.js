import { renderHook, act } from '@testing-library/react';
import { useMessage } from '../useMessage';

describe('useMessage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useMessage());

    expect(result.current.message).toEqual({
      show: false,
      text: '',
      type: 'success',
    });
  });

  it('should show success message and hide after default duration', () => {
    const { result } = renderHook(() => useMessage({ successDuration: 1000 }));

    act(() => {
      result.current.showSuccess('Success!');
    });

    expect(result.current.message).toEqual({
      show: true,
      text: 'Success!',
      type: 'success',
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.message.show).toBe(false);
  });

  it('should show error message and hide after error duration', () => {
    const { result } = renderHook(() => useMessage({ errorDuration: 5000 }));

    act(() => {
      result.current.showError('Error!');
    });

    expect(result.current.message).toEqual({
      show: true,
      text: 'Error!',
      type: 'error',
    });

    act(() => {
      jest.advanceTimersByTime(4999);
    });
    expect(result.current.message.show).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.message.show).toBe(false);
  });

  it('should clear message immediately', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showInfo('Info');
    });

    expect(result.current.message.show).toBe(true);

    act(() => {
      result.current.clearMessage();
    });

    expect(result.current.message.show).toBe(false);
    expect(result.current.message.text).toBe('');
  });

  it('should show error from error object', () => {
    const { result } = renderHook(() => useMessage());
    const error = { response: { data: { error: 'Server Error' } } };

    act(() => {
      result.current.showErrorFromError(error);
    });

    expect(result.current.message).toEqual({
      show: true,
      text: 'Server Error',
      type: 'error',
    });
  });

  it('should use default message if error object has no details', () => {
    const { result } = renderHook(() => useMessage());
    
    act(() => {
      result.current.showErrorFromError({}, 'Default Message');
    });

    expect(result.current.message.text).toBe('Default Message');
  });

  it('should override duration', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showWarning('Warning', 10000);
    });

    act(() => {
      jest.advanceTimersByTime(9999);
    });
    expect(result.current.message.show).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.message.show).toBe(false);
  });
});
