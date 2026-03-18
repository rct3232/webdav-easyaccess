/**
 * Long-press touch handlers for file items. On mobile, a long press (without move)
 * enters selection mode and selects the file (callback), with optional haptic feedback.
 * @see docs/spec/client/components/file-manager/hooks/useLongPressSelect.md
 */
import { useRef, useCallback, useEffect } from 'react';

const LONG_PRESS_MS = 500;

/**
 * @param {Object} options
 * @param {boolean} options.isMobile - Whether the view is in mobile breakpoint; when false, returns no handlers.
 * @param {boolean} options.selectionMode - When true, long-press is disabled.
 * @param {(file: { path: string }) => void} [options.onLongPressSelect] - Callback when long-press is detected. When falsy, returns no handlers.
 * @returns {{ getLongPressHandlers: (file: { path: string }) => { onTouchStart?: () => void; onTouchEnd?: () => void; onTouchMove?: () => void } }}
 */
export function useLongPressSelect({ isMobile, selectionMode, onLongPressSelect }) {
  const longPressTimersRef = useRef(new Map());
  const touchMovedRef = useRef(new Map());

  const getLongPressHandlers = useCallback(
    (file) => {
      if (!isMobile || selectionMode || !onLongPressSelect) return {};

      const handleTouchStart = () => {
        touchMovedRef.current.set(file.path, false);
        const timer = setTimeout(() => {
          if (!touchMovedRef.current.get(file.path)) {
            if (navigator.vibrate) navigator.vibrate(50);
            onLongPressSelect(file);
          }
        }, LONG_PRESS_MS);
        longPressTimersRef.current.set(file.path, timer);
      };

      const handleTouchEnd = () => {
        const timer = longPressTimersRef.current.get(file.path);
        if (timer) {
          clearTimeout(timer);
          longPressTimersRef.current.delete(file.path);
        }
      };

      const handleTouchMove = () => {
        touchMovedRef.current.set(file.path, true);
        const timer = longPressTimersRef.current.get(file.path);
        if (timer) {
          clearTimeout(timer);
          longPressTimersRef.current.delete(file.path);
        }
      };

      return {
        onTouchStart: handleTouchStart,
        onTouchEnd: handleTouchEnd,
        onTouchMove: handleTouchMove,
      };
    },
    [isMobile, selectionMode, onLongPressSelect]
  );

  useEffect(() => {
    const timers = longPressTimersRef.current;
    const touchMoved = touchMovedRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      touchMoved.clear();
    };
  }, []);

  return { getLongPressHandlers };
}
