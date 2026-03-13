import { useState, useCallback, useLayoutEffect, useEffect, useRef } from 'react';
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
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const touchStartX = useRef(null);
  const touchStartedOnPlyrControls = useRef(false);
  const lastSyncedFilePathRef = useRef(null);

  const currentDisplayFile = isGalleryMode && mediaFiles[currentMediaIndex]
    ? mediaFiles[currentMediaIndex]
    : file;
  const currentPreviewFileType = currentDisplayFile
    ? getFileType(currentDisplayFile.name || currentDisplayFile.basename)
    : null;

  // Sync currentMediaIndex from file.path only when a new file is opened (not on arrow nav).
  // Must not run during render; use layout effect so the first paint uses the correct index
  // and PreviewThumbnailBar does not animate scroll on open.
  useLayoutEffect(() => {
    if (!open) return;
    if (!isGalleryMode) return;
    if (!file?.path) return;
    if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) return;
    if (lastSyncedFilePathRef.current === file.path) return;

    const idx = mediaFiles.findIndex((f) => f?.path === file.path);
    if (idx < 0) {
      // mediaFiles might be populated asynchronously; do not lock to index 0.
      return;
    }

    lastSyncedFilePathRef.current = file.path;
    setCurrentMediaIndex(idx);
  }, [open, isGalleryMode, file?.path, mediaFiles]);

  useEffect(() => {
    if (!open) {
      lastSyncedFilePathRef.current = null;
      setCurrentMediaIndex(0);
    }
  }, [open]);

  const goPrev = useCallback(() => {
    if (isGalleryMode && currentMediaIndex > 0) {
      setCurrentMediaIndex((i) => i - 1);
    }
  }, [isGalleryMode, currentMediaIndex]);

  const goNext = useCallback(() => {
    if (isGalleryMode && currentMediaIndex < mediaFiles.length - 1) {
      setCurrentMediaIndex((i) => i + 1);
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
