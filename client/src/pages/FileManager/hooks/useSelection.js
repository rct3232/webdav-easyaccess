import { useState, useRef, useEffect, useCallback } from 'react';
import { getEntryKey } from '../../../utils/fileViewUtils';

export const useSelection = (displayedFiles, allFiles = null) => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const lastSelectedIndexRef = useRef(null);
  const prevSelectedCountRef = useRef(0);
  const skipNextAutoExitRef = useRef(false);

  // allFiles가 제공되면 전체 선택 시 모든 파일 선택, 없으면 displayedFiles만 선택 (하위 호환성)
  const filesForSelectAll = allFiles || displayedFiles;

  // Auto-exit selection mode only when selection goes from non-empty to empty (user deselected last item)
  useEffect(() => {
    const count = selectedFiles.size;
    if (skipNextAutoExitRef.current) {
      skipNextAutoExitRef.current = false;
      prevSelectedCountRef.current = count;
      return;
    }
    if (selectionMode && count === 0 && prevSelectedCountRef.current > 0) {
      setSelectionMode(false);
      lastSelectedIndexRef.current = null;
    }
    prevSelectedCountRef.current = count;
  }, [selectionMode, selectedFiles.size]);

  const handleToggleSelectionMode = () => {
    setSelectionMode((prev) => {
      const next = !prev;
      if (next) skipNextAutoExitRef.current = true;
      return next;
    });
    setSelectedFiles(new Set());
    lastSelectedIndexRef.current = null;
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(filesForSelectAll.map((file) => getEntryKey(file))));
  };

  const handleDeselectAll = () => {
    setSelectedFiles(new Set());
  };

  const handleFileCheck = (file, checked) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(getEntryKey(file));
      } else {
        newSet.delete(getEntryKey(file));
      }
      return newSet;
    });
  };

  const toggleFileSelection = (file) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(getEntryKey(file))) {
        newSet.delete(getEntryKey(file));
      } else {
        newSet.add(getEntryKey(file));
      }
      return newSet;
    });
  };

  const selectRange = useCallback(
    (fromIndex, toIndex) => {
      if (!displayedFiles || displayedFiles.length === 0) return;
      const lo = Math.min(fromIndex, toIndex);
      const hi = Math.max(fromIndex, toIndex);
      const clampedLo = Math.max(0, lo);
      const clampedHi = Math.min(displayedFiles.length - 1, hi);
      const keys = displayedFiles.slice(clampedLo, clampedHi + 1).map((f) => getEntryKey(f));
      setSelectedFiles(new Set(keys));
    },
    [displayedFiles]
  );

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const handleFileClickSelection = useCallback(
    (file, event, fileIndex) => {
      if (!file || !event) return;

      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;

      if (shift) {
        setSelectionMode(true);
        const anchor = lastSelectedIndexRef.current ?? 0;
        selectRange(anchor, fileIndex);
        lastSelectedIndexRef.current = fileIndex;
      } else if (ctrlOrMeta) {
        setSelectionMode(true);
        setSelectedFiles((prev) => {
          const newSet = new Set(prev);
          if (newSet.has(getEntryKey(file))) {
            newSet.delete(getEntryKey(file));
          } else {
            newSet.add(getEntryKey(file));
          }
          return newSet;
        });
        lastSelectedIndexRef.current = fileIndex;
      } else {
        setSelectionMode(true);
        setSelectedFiles(new Set([getEntryKey(file)]));
        lastSelectedIndexRef.current = fileIndex;
      }
    },
    [selectRange]
  );

  return {
    selectionMode,
    setSelectionMode,
    selectedFiles,
    setSelectedFiles,
    handleToggleSelectionMode,
    handleSelectAll,
    handleDeselectAll,
    handleFileCheck,
    toggleFileSelection,
    handleFileClickSelection,
    selectRange,
    lastSelectedIndexRef,
    enterSelectionMode,
  };
};
