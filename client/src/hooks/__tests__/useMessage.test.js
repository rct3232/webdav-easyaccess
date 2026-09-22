/**
 * useMessage tests.
 * @see docs/spec/client/hooks/useMessage.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useMessage } from '../useMessage';

import { getServerErrorDisplay } from '../../utils/errorUtils';

jest.mock('../../i18n', () => ({
  __esModule: true,
  default: { t: (key) => key },
}));

jest.mock('../../utils/errorUtils', () => ({
  getServerErrorDisplay: jest.fn((data, t) =>
    data?.errorCode ? t(data.errorCode, data.params) : t('errors.unknown')
  ),
}));

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

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.type).toBe('error');
    expect(result.current.message.text).toBe('Translated error');
  });

  // -- action-slot extension (useMessage.md §3 D2) ---------------------------

  it('message state gains action/icon null defaults', () => {
    const { result } = renderHook(() => useMessage());

    expect(result.current.message.action).toBeNull();
    expect(result.current.message.icon).toBeNull();
  });

  it('with an action, no auto-hide fires at the default duration (persists until replaced)', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Move completed (12 items)', 'success', null, {
        labelKey: 'actions.undo',
        onClick: jest.fn(),
      });
    });

    expect(result.current.message.show).toBe(true);
    expect(result.current.message.action).toMatchObject({ labelKey: 'actions.undo' });

    act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(result.current.message.show).toBe(true);
  });

  it('with an action, an explicit 8000 hides at 8 s', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Move completed', 'success', 8000, {
        labelKey: 'actions.undo',
        onClick: jest.fn(),
      });
    });
    expect(result.current.message.show).toBe(true);
    expect(result.current.message.action).toMatchObject({ labelKey: 'actions.undo' });

    act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(result.current.message.show).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.message.show).toBe(false);
  });

  it('clearMessage dismisses an action toast immediately', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Move completed', 'success', null, {
        labelKey: 'actions.undo',
        onClick: jest.fn(),
      });
    });
    expect(result.current.message.show).toBe(true);
    expect(result.current.message.action?.labelKey).toBe('actions.undo');

    act(() => {
      result.current.clearMessage();
    });
    expect(result.current.message.show).toBe(false);
  });

  it('an icon may ride the message alongside the action', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Move completed', 'success', null, {
        labelKey: 'actions.undo',
        onClick: jest.fn(),
      }, 'move');
    });

    expect(result.current.message.icon).toBe('move');
  });

  it('without an action, showMessage keeps today\'s duration behavior', () => {
    const { result } = renderHook(() => useMessage());

    act(() => {
      result.current.showMessage('Plain', 'success');
    });
    expect(result.current.message.action).toBeNull();

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current.message.show).toBe(false);
  });
});
