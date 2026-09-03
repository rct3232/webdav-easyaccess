import { useCallback, useRef, useEffect } from 'react';
import { useDragAndDrop } from '../../../hooks/useDragAndDrop';
import { getFileItemState, getEntryKey } from '../../../utils/fileViewUtils';

// Reusable empty drag/drop handler objects to preserve reference identity.
const emptyDragHandlers = {
  draggable: false,
  onDragStart: undefined,
  onDragEnd: undefined,
};

const emptyDropHandlers = {
  onDragOver: undefined,
  onDragLeave: undefined,
  onDrop: undefined,
};

/**
 * Common hook for file view components
 * Provides shared logic for file list, grid, and detail views
 *
 * @param {Object} options - Hook options
 * @param {Function} options.onFileDrop - Callback for file drop
 * @param {Function} options.onDropPermissionDenied - Callback when drop target has no write permission (destinationPath) => void
 * @param {Function} options.onDragStart - Callback when drag starts (path) => void
 * @param {Function} options.onDragEnd - Callback when drag ends () => void
 * @param {boolean} options.selectionMode - Whether selection mode is active
 * @param {Set} options.selectedFiles - Set of selected entry keys (file.nodeId, path fallback)
 * @param {Function} options.onFileCheck - Callback for file check
 * @param {Map} options.processingMap - Map of file nodeIds to processing types
 * @param {Object} options.theme - MUI theme object
 * @param {boolean} options.isMobile - Whether the device is mobile
 * @returns {Object} Common view logic and handlers
 */
export const useFileViewCommon = ({
  onFileDrop,
  onDropPermissionDenied,
  onDragStart,
  onDragEnd,
  internalDraggedNodeId,
  selectionMode,
  selectedFiles,
  onFileCheck,
  processingMap,
  theme,
  isMobile = false,
}) => {
  // ref로 관리하여 useCallback 의존성에서 제거 (리렌더링 방지)
  const selectionModeRef = useRef(selectionMode);
  const isMobileRef = useRef(isMobile);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  const dragAndDrop = useDragAndDrop(
    onFileDrop,
    selectionMode,
    theme,
    onDropPermissionDenied,
    onDragStart,
    onDragEnd,
    internalDraggedNodeId
  );

  // Destructure the stable handlers so the per-file cache below can depend on
  // stable identifiers (member-expression deps would trip exhaustive-deps).
  const { handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop } =
    dragAndDrop;

  // Per-file drag/drop handler cache (WeakMap keyed by the file object) so rows
  // receive referentially stable handlers across unrelated re-renders. Entries are
  // invalidated when file identity changes (auto) or when the (isDisabled, isMobile,
  // selectionMode) epoch used to build them changes.
  const handlersCacheRef = useRef(new WeakMap());

  const buildFileHandlers = useCallback(
    (file, isDisabled) => {
      const selectionModeNow = selectionModeRef.current;
      const isMobileNow = isMobileRef.current;
      const cached = handlersCacheRef.current.get(file);
      if (
        cached &&
        cached.isDisabled === isDisabled &&
        cached.isMobile === isMobileNow &&
        cached.selectionMode === selectionModeNow
      ) {
        return cached;
      }

      const drag =
        selectionModeNow || isMobileNow || isDisabled || file.hasWritePermission === false
          ? emptyDragHandlers
          : {
              draggable: true,
              onDragStart: (e) => handleDragStart(e, file),
              onDragEnd: handleDragEnd,
            };

      const drop =
        selectionModeNow || isMobileNow || isDisabled
          ? emptyDropHandlers
          : {
              onDragOver: (e) => handleDragOver(e, file),
              onDragLeave: handleDragLeave,
              onDrop: (e) => handleDrop(e, file),
            };

      const entry = {
        isDisabled,
        isMobile: isMobileNow,
        selectionMode: selectionModeNow,
        drag,
        drop,
      };
      handlersCacheRef.current.set(file, entry);
      return entry;
    },
    [handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop]
  );

  /**
   * Get file state for rendering
   */
  const getFileState = useCallback(
    (file) => {
      return getFileItemState(file, selectionMode, selectedFiles, processingMap);
    },
    [selectionMode, selectedFiles, processingMap]
  );

  /**
   * Handle file check (selection)
   */
  const handleFileCheck = useCallback(
    (file, checked, event) => {
      event?.stopPropagation();
      if (onFileCheck) {
        onFileCheck(file, checked);
      }
    },
    [onFileCheck]
  );

  /**
   * Check if file is selected
   */
  const isSelected = useCallback(
    (file) => {
      return selectedFiles && selectedFiles.has(getEntryKey(file));
    },
    [selectedFiles]
  );

  /**
   * Get drag handlers for a file
   * Cached per file (see buildFileHandlers) so identity is stable across
   * unrelated re-renders; selectionMode/isMobile handled via refs.
   */
  const getDragHandlers = useCallback(
    (file, isDisabled) => buildFileHandlers(file, isDisabled).drag,
    [buildFileHandlers]
  );

  /**
   * Get drop handlers for a file
   * Cached per file (see buildFileHandlers) so identity is stable across
   * unrelated re-renders; selectionMode/isMobile handled via refs.
   */
  const getDropHandlers = useCallback(
    (file, isDisabled) => buildFileHandlers(file, isDisabled).drop,
    [buildFileHandlers]
  );

  return {
    ...dragAndDrop,
    getFileState,
    handleFileCheck,
    isSelected,
    getDragHandlers,
    getDropHandlers,
  };
};
