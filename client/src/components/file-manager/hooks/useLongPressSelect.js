/**
 * Long-press selection policy hook.
 * Determines if long-press should be enabled based on mobile status and selection mode.
 * @see docs/spec/client/components/file-manager/hooks/useLongPressSelect.md
 */
import { useCallback, useRef, useEffect } from 'react';

const LONG_PRESS_MS = 500;

/**
 * @param {Object} options
 * @param {boolean} options.isMobile - Whether the view is in mobile breakpoint.
 * @param {boolean} options.selectionMode - When true, long-press is disabled.
 * @param {(file: { path: string }) => void} [options.onLongPressSelect] - Callback when long-press is detected.
 * @returns {{ isLongPressEnabled: boolean, onLongPressSelect: Function, getLongPressHandlers: (file) => { onTouchStart, onTouchEnd, onTouchMove } | {} }}
 */
export function useLongPressSelect({ isMobile, selectionMode, onLongPressSelect }) {
  const isLongPressEnabled = isMobile && !selectionMode && !!onLongPressSelect;

  const timersRef = useRef(new Map()); // file.path -> timer id
  const movedRef = useRef(new Set()); // file.paths where touch moved

  useEffect(() => () => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current.clear();
    movedRef.current.clear();
  }, []);

  const getLongPressHandlers = useCallback(
    (file) => {
      if (!isLongPressEnabled) return {};

      const filePath = file.path;

      const onTouchStart = () => {
        movedRef.current.delete(filePath);
        const id = setTimeout(() => {
          if (!movedRef.current.has(filePath)) {
            onLongPressSelect(file);
            try { navigator.vibrate?.(50); } catch {}
          }
        }, LONG_PRESS_MS);
        timersRef.current.set(filePath, id);
      };

      const onTouchEnd = () => {
        const id = timersRef.current.get(filePath);
        if (id != null) { clearTimeout(id); timersRef.current.delete(filePath); }
      };

      const onTouchMove = () => {
        movedRef.current.add(filePath);
        const id = timersRef.current.get(filePath);
        if (id != null) { clearTimeout(id); timersRef.current.delete(filePath); }
      };

      return { onTouchStart, onTouchEnd, onTouchMove };
    },
    [isLongPressEnabled, onLongPressSelect],
  );

  return { isLongPressEnabled, onLongPressSelect, getLongPressHandlers };
}
