import { renderHook, act } from '@testing-library/react';
import { useLongPress } from '../useLongPress';

describe('useLongPress', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Mock navigator.vibrate
    navigator.vibrate = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('기본 동작', () => {
    it('should return touch and mouse event handlers', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      expect(result.current).toHaveProperty('onTouchStart');
      expect(result.current).toHaveProperty('onTouchEnd');
      expect(result.current).toHaveProperty('onTouchMove');
      expect(result.current).toHaveProperty('onMouseDown');
      expect(result.current).toHaveProperty('onMouseUp');
      expect(result.current).toHaveProperty('onMouseLeave');
    });

    it('should call onLongPress after default delay (500ms)', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));
      const mockEvent = { target: {} };

      act(() => {
        result.current.onTouchStart(mockEvent);
      });

      expect(onLongPress).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(onLongPress).toHaveBeenCalledWith(mockEvent);
    });

    it('should call onLongPress after custom delay', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress, 300));
      const mockEvent = { target: {} };

      act(() => {
        result.current.onTouchStart(mockEvent);
      });

      act(() => {
        jest.advanceTimersByTime(299);
      });

      expect(onLongPress).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(1);
      });

      expect(onLongPress).toHaveBeenCalledWith(mockEvent);
    });
  });

  describe('터치 이벤트', () => {
    it('should not call onLongPress if touch ends before delay', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      act(() => {
        result.current.onTouchStart({ target: {} });
      });

      act(() => {
        jest.advanceTimersByTime(400);
      });

      act(() => {
        result.current.onTouchEnd();
      });

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('should not call onLongPress if touch moves during press', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      act(() => {
        result.current.onTouchStart({ target: {} });
      });

      act(() => {
        jest.advanceTimersByTime(200);
      });

      act(() => {
        result.current.onTouchMove();
      });

      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });
  });

  describe('마우스 이벤트', () => {
    it('should call onLongPress on mouseDown after delay', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));
      const mockEvent = { target: {} };

      act(() => {
        result.current.onMouseDown(mockEvent);
      });

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(onLongPress).toHaveBeenCalledWith(mockEvent);
    });

    it('should not call onLongPress if mouseUp before delay', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      act(() => {
        result.current.onMouseDown({ target: {} });
      });

      act(() => {
        jest.advanceTimersByTime(400);
      });

      act(() => {
        result.current.onMouseUp();
      });

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('should not call onLongPress if mouseLeave before delay', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      act(() => {
        result.current.onMouseDown({ target: {} });
      });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      act(() => {
        result.current.onMouseLeave();
      });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });
  });

  describe('햅틱 피드백', () => {
    it('should trigger vibration on long press if available', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      act(() => {
        result.current.onTouchStart({ target: {} });
      });

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(navigator.vibrate).toHaveBeenCalledWith(50);
    });

    it('should not throw if navigator.vibrate is not available', () => {
      navigator.vibrate = undefined;
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      expect(() => {
        act(() => {
          result.current.onTouchStart({ target: {} });
        });
        act(() => {
          jest.advanceTimersByTime(500);
        });
      }).not.toThrow();

      expect(onLongPress).toHaveBeenCalled();
    });
  });

  describe('연속 호출', () => {
    it('should handle multiple long press interactions', () => {
      const onLongPress = jest.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      // First long press
      act(() => {
        result.current.onTouchStart({ target: {}, id: 1 });
      });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(onLongPress).toHaveBeenCalledTimes(1);

      // Clear
      act(() => {
        result.current.onTouchEnd();
      });

      // Second long press
      act(() => {
        result.current.onTouchStart({ target: {}, id: 2 });
      });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(onLongPress).toHaveBeenCalledTimes(2);
    });
  });
});
