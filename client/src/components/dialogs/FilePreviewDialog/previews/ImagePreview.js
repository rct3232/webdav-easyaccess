import React, { useRef, useState, useLayoutEffect } from 'react';
import { Box, IconButton } from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';

const outerWrapperSx = {
  position: 'relative',
  display: 'flex',
  flex: 1,
  minHeight: 0,
  width: '100%',
  overflow: 'hidden',
};

const scrollBoxBaseSx = {
  flex: 1,
  overflow: 'auto',
  touchAction: 'pan-x pan-y',
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { display: 'none' },
};

const chevronSx = {
  color: 'white',
  backgroundColor: 'rgba(0,0,0,0.5)',
  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
};

const ImagePreview = ({
  previewUrl,
  targetFile,
  isGalleryMode,
  isMobile,
  headerVisible,
  controlsVisible,
  currentMediaIndex,
  mediaFilesLength,
  goPrev,
  goNext,
  handleTouchStart,
  handleTouchEnd,
  mediaTouchRef,
  zoom = 1,
  zoomContainerRef,
}) => {
  const showChevrons = isGalleryMode && (isMobile ? headerVisible : controlsVisible);
  const imgRef = useRef(null);
  const [baseSize, setBaseSize] = useState(null);

  // Synchronously (before browser paint) scroll the scroll container to its
  // center so the zoomed image always appears to expand from the center.
  // useLayoutEffect runs after DOM commit but before paint — no visible flash.
  useLayoutEffect(() => {
    const el = zoomContainerRef?.current;
    if (!el || !baseSize || zoom <= 1) return;
    const maxScrollX = el.scrollWidth - el.clientWidth;
    const maxScrollY = el.scrollHeight - el.clientHeight;
    if (maxScrollX > 0) el.scrollLeft = maxScrollX / 2;
    if (maxScrollY > 0) el.scrollTop = maxScrollY / 2;
  }, [zoom, baseSize, zoomContainerRef]);

  const handleImgLoad = () => {
    if (imgRef.current) {
      setBaseSize({
        width: imgRef.current.offsetWidth,
        height: imgRef.current.offsetHeight,
      });
    }
  };

  // Once the image's base render size is known (after onLoad), always use
  // explicit pixel dimensions so zoom values below 1 visually shrink the image.
  // baseSize is NOT reset on previewUrl change — onLoad naturally updates it
  // when the src changes, avoiding a race where useEffect runs after onLoad
  // (which happens for cached images) and overwrites the valid baseSize with null.
  //
  // centerBox min-height uses max(100%, ...) because block elements auto-fill
  // width but not height: without it, a short image would sit at the top
  // instead of staying vertically centered when smaller than the viewport.
  const isZoomed = baseSize !== null;
  const centerBoxSx = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: isZoomed ? baseSize.width * zoom : '100%',
    minHeight: isZoomed ? `max(100%, ${baseSize.height * zoom}px)` : '100%',
  };

  const imgSx = isZoomed
    ? {
        width: baseSize.width * zoom,
        height: baseSize.height * zoom,
        objectFit: 'contain',
        display: 'block',
        flexShrink: 0,
      }
    : {
        maxWidth: '100%',
        maxHeight: isMobile ? '100%' : '70vh',
        height: isMobile ? '100%' : 'auto',
        objectFit: 'contain',
        display: 'block',
      };

  return (
    <Box
      ref={mediaTouchRef}
      sx={outerWrapperSx}
      onTouchStart={zoom > 1 ? undefined : handleTouchStart}
      onTouchEnd={zoom > 1 ? undefined : handleTouchEnd}
    >
      <Box ref={zoomContainerRef} sx={scrollBoxBaseSx}>
        <Box sx={centerBoxSx}>
          <Box
            ref={imgRef}
            component="img"
            src={previewUrl}
            alt={targetFile.name}
            onLoad={handleImgLoad}
            sx={imgSx}
          />
        </Box>
      </Box>
      {showChevrons && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          disabled={currentMediaIndex <= 0}
          sx={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 5,
            ...chevronSx,
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
      )}
      {showChevrons && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          disabled={currentMediaIndex >= mediaFilesLength - 1}
          sx={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 5,
            ...chevronSx,
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      )}
    </Box>
  );
};

export default ImagePreview;
