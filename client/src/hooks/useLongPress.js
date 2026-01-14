import { useCallback, useRef } from 'react';

/**
 * Long-press 이벤트 훅
 * @param {Function} onLongPress - long-press 시 실행할 콜백
 * @param {number} delay - long-press 감지 시간 (ms, 기본 500ms)
 */
export const useLongPress = (onLongPress, delay = 500) => {
  const timeoutRef = useRef(null);
  const touchMoveRef = useRef(false);

  const start = useCallback((e) => {
    touchMoveRef.current = false;
    timeoutRef.current = setTimeout(() => {
      if (!touchMoveRef.current) {
        // 햅틱 피드백
        if (navigator.vibrate) {
          navigator.vibrate(50); // 50ms 진동
        }
        onLongPress(e);
      }
    }, delay);
  }, [onLongPress, delay]);

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const move = useCallback(() => {
    touchMoveRef.current = true;
    clear();
  }, [clear]);

  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: move,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
  };
};

