/**
 * useMessage tests.
 * @see docs/spec/client/hooks/useMessage.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useMessage } from '../useMessage';

jest.mock('../../i18n', () => ({
  __esModule: true,
  default: { t: (key) => key },
}));

jest.mock('../../utils/errorUtils', () => ({
  getServerErrorDisplay: jest.fn((data, t) => (data?.errorCode ? t(data.errorCode, data.params) : t('errors.unknown'))),
}));

import { getServerErrorDisplay } from '../../utils/errorUtils';

describe('useMessage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initial state has message.show false', () => {
    const { result } = renderHook(() => useMessage());

    expect(result.current.message.show).toBe(false);
    expect(result.current.message.text).toBe('');
    expect(result.current.message.type).toBe('success');
  });

  it('showMessage updates state with text and type', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Saved', 'success');
    });

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.text).toBe('Saved');
    expect(result.current.message.type).toBe('success');
  });

  it('showSuccess sets type success', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showSuccess('Done');
    });

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.type).toBe('success');
    expect(result.current.message.text).toBe('Done');
  });

  it('showError sets type error', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showError('Failed');
    });

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.type).toBe('error');
    expect(result.current.message.text).toBe('Failed');
  });

  it('showWarning sets type warning', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showWarning('Be careful');
    });

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.type).toBe('warning');
    expect(result.current.message.text).toBe('Be careful');
  });

  it('showInfo sets type info', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showInfo('FYI');
    });

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.type).toBe('info');
    expect(result.current.message.text).toBe('FYI');
  });

  it('auto-hides after duration when duration > 0', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Temp', 'success', 2000);
    });

    expect(result.current.message.show).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.message.show).toBe(false);
  });

  it('no auto-hide when duration is 0', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Sticky', 'info', 0);
    });

    expect(result.current.message.show).toBe(true);

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(result.current.message.show).toBe(true);
  });

  it('clearMessage sets show to false', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Hello');
    });
    expect(result.current.message.show).toBe(true);

    act(() => {
      result.current.clearMessage();
    });

    expect(result.current.message.show).toBe(false);
    expect(result.current.message.text).toBe('');
  });

  it('showErrorFromError with errorCode calls getServerErrorDisplay and shows result', () => {
    getServerErrorDisplay.mockReturnValue('Translated error');

    const error = { response: { data: { errorCode: 'errors.custom' } } };
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showErrorFromError(error);
    });

    expect(getServerErrorDisplay).toHaveBeenCalled();
    expect(result.current.message.show).toBe(true);
    expect(result.current.message.type).toBe('error');
    expect(result.current.message.text).toBe('Translated error');
  });
});
