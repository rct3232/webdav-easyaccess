/**
 * Long-press selection policy hook.
 * Determines if long-press should be enabled based on mobile status and selection mode.
 * @see docs/spec/client/components/file-manager/hooks/useLongPressSelect.md
 */
import { useCallback } from 'react';

/**
 * @param {Object} options
 * @param {boolean} options.isMobile - Whether the view is in mobile breakpoint.
 * @param {boolean} options.selectionMode - When true, long-press is disabled.
 * @param {(file: { path: string }) => void} [options.onLongPressSelect] - Callback when long-press is detected.
 * @returns {{ isLongPressEnabled: boolean, onLongPressSelect: (file: { path: string }) => void }}
 */
export function useLongPressSelect({ isMobile, selectionMode, onLongPressSelect }) {
  const isLongPressEnabled = isMobile && !selectionMode && !!onLongPressSelect;

  return {
    isLongPressEnabled,
    onLongPressSelect,
  };
}
