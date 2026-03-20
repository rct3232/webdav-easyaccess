import { useState, useCallback, useEffect, useRef } from 'react';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';

export const useGalleryNavigation = ({
  open,
  isGalleryMode,
  file,
  mediaFiles,
  isMobile,
  setHeaderVisible,
  resetHideTimer,
}) => {
  const [navigationOffset, setNavigationOffset] = useState(0);
  const touchStartX = useRef(null);
  const touchStartedOnPlyrControls = useRef(false);

  const openedIndex =
    isGalleryMode && file?.path && Array.isArray(mediaFiles) && mediaFiles.length > 0
      ? mediaFiles.findIndex((f) => f?.path === file.path)
      : -1;

  const currentMediaIndex =
    openedIndex >= 0
      ? Math.max(0, Math.min(openedIndex + navigationOffset, mediaFiles.length - 1))
      : 0;

  const currentDisplayFile = isGalleryMode && mediaFiles[currentMediaIndex]
    ? mediaFiles[currentMediaIndex]
    : file;
  const currentPreviewFileType = currentDisplayFile
    ? getFileType(currentDisplayFile.name || currentDisplayFile.basename)
    : null;

  useEffect(() => {
    if (!open) {
      setNavigationOffset(0);
    }
  }, [open]);

  useEffect(() => {
    setNavigationOffset(0);
  }, [file?.path]);

  const setCurrentMediaIndex = useCallback(
    (index) => {
      const idx = Math.max(0, Math.min(index, mediaFiles.length - 1));
      setNavigationOffset(idx - (openedIndex >= 0 ? openedIndex : 0));
    },
    [openedIndex, mediaFiles.length]
  );

  const goPrev = useCallback(() => {
    if (isGalleryMode && currentMediaIndex > 0) {
      setNavigationOffset((prev) => prev - 1);
    }
  }, [isGalleryMode, currentMediaIndex]);

  const goNext = useCallback(() => {
    if (isGalleryMode && currentMediaIndex < mediaFiles.length - 1) {
      setNavigationOffset((prev) => prev + 1);
    }
  }, [isGalleryMode, currentMediaIndex, mediaFiles.length]);

  const handleTouchStart = useCallback((e) => {
    const target = e.target;
    touchStartedOnPlyrControls.current = !!(
      target?.closest?.('.plyr__controls') || target?.closest?.('.plyr__control')
    );
    if (!touchStartedOnPlyrControls.current) {
      touchStartX.current = e.touches[0].clientX;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e) => {
      if (touchStartedOnPlyrControls.current) {
        touchStartedOnPlyrControls.current = false;
        touchStartX.current = null;
        return;
      }
      if (touchStartX.current == null) return;
      const endX = e.changedTouches[0].clientX;
      const diff = touchStartX.current - endX;
      if (isGalleryMode && Math.abs(diff) > 50) {
        if (diff > 50) goNext();
        else goPrev();
        touchStartX.current = null;
        return;
      }
      // Tap (not swipe): on mobile video, toggle header to sync with Plyr controls
      if (isMobile && currentPreviewFileType === 'video' && Math.abs(diff) < 50) {
        e.stopPropagation(); // Prevent DialogContent onClick from double-toggling
        setHeaderVisible((prev) => {
          const next = !prev;
          if (next && isGalleryMode) resetHideTimer();
          return next;
        });
      }
      touchStartX.current = null;
    },
    [isGalleryMode, isMobile, currentPreviewFileType, goPrev, goNext, setHeaderVisible, resetHideTimer]
  );

  return {
    currentMediaIndex,
    setCurrentMediaIndex,
    currentDisplayFile,
    currentPreviewFileType,
    goPrev,
    goNext,
    handleTouchStart,
    handleTouchEnd,
    touchStartX,
    touchStartedOnPlyrControls,
  };
};
