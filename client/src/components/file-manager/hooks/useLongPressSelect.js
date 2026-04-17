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
  const longPressOccurredRef = useRef(new Map());

  const getLongPressHandlers = useCallback(
    (file) => {
      if (!isMobile || selectionMode || !onLongPressSelect) return {};

      const handleStart = () => {
        console.log(`[LongPress] Start: ${file.path}`);
        touchMovedRef.current.set(file.path, false);
        longPressOccurredRef.current.set(file.path, false);
        const timer = setTimeout(() => {
          console.log(`[LongPress] Timer fired: ${file.path}`);
          if (!touchMovedRef.current.get(file.path)) {
            if (navigator.vibrate) navigator.vibrate(50);
            longPressOccurredRef.current.set(file.path, true);
            onLongPressSelect(file);
          }
        }, LONG_PRESS_MS);
        longPressTimersRef.current.set(file.path, timer);
      };

      const handleEnd = () => {
        console.log(`[LongPress] End: ${file.path}`);
        const timer = longPressTimersRef.current.get(file.path);
        if (timer) {
          clearTimeout(timer);
          longPressTimersRef.current.delete(file.path);
        }
      };

      const handleMove = () => {
        console.log(`[LongPress] Move: ${file.path}`);
        touchMovedRef.current.set(file.path, true);
        const timer = longPressTimersRef.current.get(file.path);
        if (timer) {
          clearTimeout(timer);
          longPressTimersRef.current.delete(file.path);
        }
      };

      return {
        onTouchStart: handleStart,
        onTouchEnd: handleEnd,
        onTouchMove: handleMove,
        onMouseDown: handleStart,
        onMouseUp: handleEnd,
        onMouseMove: handleMove,
      };
    },
    [isMobile, selectionMode, onLongPressSelect]
  );

  const wasLongPress = useCallback(
    (filePath) => {
      const occurred = longPressOccurredRef.current.get(filePath);
      if (occurred) {
        longPressOccurredRef.current.set(filePath, false);
      }
      return occurred;
    },
    []
  );

  useEffect(() => {
    const timers = longPressTimersRef.current;
    const touchMoved = touchMovedRef.current;
    const occurred = longPressOccurredRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      touchMoved.clear();
      occurred.clear();
    };
  }, []);

  return { getLongPressHandlers, wasLongPress };
}
