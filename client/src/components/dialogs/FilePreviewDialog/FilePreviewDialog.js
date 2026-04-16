import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
  Popover,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { downloadFile } from '../../../services/fileService';
import { pdfjs } from 'react-pdf';
import { useResponsive } from '../../../hooks/useResponsive';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';
import PreviewThumbnailBar from './PreviewThumbnailBar';
import HeaderZoomControls, { ZoomControlButtons } from './HeaderZoomControls';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { usePreviewLoader } from './hooks/usePreviewLoader';
import { useUIVisibility } from './hooks/useUIVisibility';
import { useGalleryNavigation } from './hooks/useGalleryNavigation';
import { usePlyrPlayer } from './hooks/usePlyrPlayer';
import { usePdfLayout } from './hooks/usePdfLayout';
import { useHeaderTruncation } from './hooks/useHeaderTruncation';
import { usePreviewZoom } from './hooks/usePreviewZoom';
import { useZoomInputs } from './hooks/useZoomInputs';

import ImagePreview from './previews/ImagePreview';
import VideoPreview from './previews/VideoPreview';
import AudioPreview from './previews/AudioPreview';
import PdfPreview from './previews/PdfPreview';
import TextPreview from './previews/TextPreview';
import PreviewUnsupported from './previews/PreviewUnsupported';

// Configure pdf.js worker for react-pdf v10
// Use local file from public folder (copied from pdfjs-dist)
if (typeof window !== 'undefined') {
  const workerPath = window.location.origin + (process.env.PUBLIC_URL || '') + '/pdf.worker.min.js';
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
}

const FilePreviewDialog = ({
  open,
  onClose,
  file,
  mediaFiles = [],
  shareToken,
  onThumbnailsLoaded,
  hideCloseButton = false,
}) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const [floatingZoomOpen, setFloatingZoomOpen] = useState(false);
  const zoomAnchorRef = useRef(null);

  const fileType = file ? getFileType(file.name || file.basename) : null;
  const isGalleryMode =
    file &&
    (fileType === 'image' || fileType === 'video') &&
    mediaFiles?.length > 1;

  // Ensure worker is configured when component mounts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const workerPath = window.location.origin + (process.env.PUBLIC_URL || '') + '/pdf.worker.min.js';
      if (pdfjs.GlobalWorkerOptions.workerSrc !== workerPath) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
        console.log('PDF.js worker configured:', workerPath);
      }
    }
  }, []);

  // Step 1: UI visibility — provides setHeaderVisible/resetHideTimer for gallery navigation
  const {
    headerVisible,
    controlsVisible,
    setHeaderVisible,
    startHideTimer,
    clearHideTimer,
    resetHideTimer,
  } = useUIVisibility({ open, isMobile });

  // Step 2: Gallery navigation (derives currentDisplayFile and currentPreviewFileType internally)
  const {
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
  } = useGalleryNavigation({
    open,
    isGalleryMode,
    file,
    mediaFiles,
    isMobile,
    setHeaderVisible,
    resetHideTimer,
  });

  const displayFile = currentDisplayFile;
  const targetForPreview = displayFile ?? file;
  const previewFileType =
    targetForPreview && (targetForPreview.name || targetForPreview.basename)
      ? getFileType(targetForPreview.name || targetForPreview.basename)
      : null;

  const ZOOMABLE_PREVIEW_TYPES = ['pdf', 'image'];
  const needsZoom = ZOOMABLE_PREVIEW_TYPES.includes(previewFileType);

  // Step 3: Preview loader (must run before useZoomInputs, which depends on loading)
  const { loading, error, previewUrl, previewBlob, textContent } = usePreviewLoader({
    open,
    displayFile,
    file,
    shareToken,
    t,
  });

  const zoomContainerRef = useRef(null);
  const { zoom, zoomIn, zoomOut, resetZoom, setZoom } = usePreviewZoom({
    open,
    previewFileType: needsZoom ? previewFileType : null,
    displayFile: needsZoom ? displayFile : null,
  });
  useZoomInputs({
    containerRef: zoomContainerRef,
    setZoom,
    isMobile,
    enabled: needsZoom && !loading,
    previewFileType: needsZoom ? previewFileType : null,
  });

  // Step 4: Start auto-hide timer when loading completes (gallery or zoomable previews)
  useEffect(() => {
    if (open && (isGalleryMode || needsZoom) && !loading) {
      startHideTimer();
    }
    return () => clearHideTimer();
  }, [open, isGalleryMode, needsZoom, loading, startHideTimer, clearHideTimer]);

  // Close floating zoom when header hides or dialog closes (hide together with header)
  useEffect(() => {
    if (!headerVisible || !open) setFloatingZoomOpen(false);
  }, [headerVisible, open]);

  // Step 5: Plyr player
  const { videoNotPlayable, audioContainerRef, videoContainerRef, mediaTouchRef } = usePlyrPlayer({
    open,
    previewUrl,
    displayFile,
    file,
    headerVisible,
    controlsVisible,
    isMobile,
    currentPreviewFileType,
    loading,
    isGalleryMode,
    touchStartX,
    touchStartedOnPlyrControls,
  });

  // Step 6: PDF layout
  const {
    pdfContainerRef,
    pageArray,
    calculatedWidth,
    pageInfo,
    setNumPages,
    setPageInfo,
  } = usePdfLayout({ open, previewUrl, isMobile });

  // Step 7: Header truncation
  const {
    titleRowRef,
    actionsRef,
    textContainerRef,
    textPreRef,
    truncatedHeaderName,
    isHeaderTruncated,
    textOverflows,
    originalHeaderName,
  } = useHeaderTruncation({
    open,
    hideCloseButton,
    textContent,
    displayFile,
    file,
  });

  const handleDownload = useCallback(() => {
    const targetFile = displayFile || file;
    if (!targetFile) return;
    const fileName = targetFile.name || targetFile.basename;
    downloadFile(targetFile.path, { fileName, shareToken });
  }, [displayFile, file, shareToken]);

  if (!file) return null;

  const targetFile = displayFile || file;

  const renderContent = () => {
    if (targetFile && targetFile.canPreview === false) {
      return <PreviewUnsupported targetFile={targetFile} t={t} />;
    }

    if (loading) {
      return (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <CircularProgress sx={{ color: 'rgba(255, 255, 255, 0.8)' }} />
        </Box>
      );
    }

    if (error) {
      return (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Typography sx={{ color: '#f44336' }}>{error}</Typography>
        </Box>
      );
    }

    if (previewFileType === 'image') {
      return (
        <ImagePreview
          previewUrl={previewUrl}
          targetFile={targetFile}
          isGalleryMode={isGalleryMode}
          isMobile={isMobile}
          headerVisible={headerVisible}
          controlsVisible={controlsVisible}
          currentMediaIndex={currentMediaIndex}
          mediaFilesLength={mediaFiles.length}
          goPrev={goPrev}
          goNext={goNext}
          handleTouchStart={handleTouchStart}
          handleTouchEnd={handleTouchEnd}
          mediaTouchRef={mediaTouchRef}
          zoom={zoom}
          zoomContainerRef={zoomContainerRef}
        />
      );
    }

    if (previewFileType === 'video') {
      return (
        <VideoPreview
          isGalleryMode={isGalleryMode}
          isMobile={isMobile}
          headerVisible={headerVisible}
          controlsVisible={controlsVisible}
          currentMediaIndex={currentMediaIndex}
          mediaFilesLength={mediaFiles.length}
          goPrev={goPrev}
          goNext={goNext}
          handleTouchStart={handleTouchStart}
          handleTouchEnd={handleTouchEnd}
          mediaTouchRef={mediaTouchRef}
          videoContainerRef={videoContainerRef}
          videoNotPlayable={videoNotPlayable}
          t={t}
        />
      );
    }

    if (previewFileType === 'audio') {
      return <AudioPreview audioContainerRef={audioContainerRef} />;
    }

    if (previewFileType === 'pdf') {
      return (
        <PdfPreview
          previewBlob={previewBlob}
          previewUrl={previewUrl}
          pdfContainerRef={pdfContainerRef}
          zoomContainerRef={zoomContainerRef}
          pageArray={pageArray}
          calculatedWidth={calculatedWidth}
          zoom={zoom}
          pageInfo={pageInfo}
          isMobile={isMobile}
          setNumPages={setNumPages}
          setPageInfo={setPageInfo}
          t={t}
        />
      );
    }

    if (previewFileType === 'text') {
      return (
        <TextPreview
          textContent={textContent}
          textContainerRef={textContainerRef}
          textPreRef={textPreRef}
          textOverflows={textOverflows}
          isMobile={isMobile}
        />
      );
    }

    return <PreviewUnsupported targetFile={null} t={t} />;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      data-testid="file-preview-dialog"
      fullScreen
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: isMobile && !headerVisible ? 'rgba(0, 0, 0, 0.95)' : 'rgba(0, 0, 0, 0.6)',
            transition: 'background-color 0.2s ease',
          },
        },
      }}
      PaperProps={{
        sx: {
          backgroundColor: isMobile && !headerVisible ? '#121212' : 'rgba(18, 18, 18, 0.82)',
          transition: 'background-color 0.2s ease',
          width: '100%',
          height: '100%',
          maxHeight: 'none',
          margin: 0,
          borderRadius: 0,
          ...(isMobile && {
            height: 'var(--app-height)',
            maxHeight: 'var(--app-height)',
          }),
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
        onMouseMove={() => !isMobile && (isGalleryMode || needsZoom) && resetHideTimer()}
      >
        <DialogTitle
          sx={{
            flexShrink: 0,
            position: isMobile ? 'absolute' : 'sticky',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            backgroundColor: '#1a1a1a',
            color: '#fff',
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
            py: isMobile ? 1.5 : 2,
            ...(isMobile && {
              opacity: headerVisible ? 1 : 0,
              visibility: headerVisible ? 'visible' : 'hidden',
              transition: 'opacity 0.2s ease, visibility 0.2s ease',
              pointerEvents: headerVisible ? 'auto' : 'none',
            }),
          }}
        >
          <Box
            ref={titleRowRef}
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            width="100%"
            gap={2}
          >
            <Box display="flex" alignItems="center" flex={1} minWidth={0} gap={2}>
              {(() => {
                const typography = (
                  <Typography
                    variant="h6"
                    component="div"
                    sx={{
                      color: 'inherit',
                      minWidth: 0,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      flexShrink: 1,
                      textOverflow: 'clip',
                    }}
                  >
                    {truncatedHeaderName}
                  </Typography>
                );

                if (!isMobile && isHeaderTruncated) {
                  return (
                    <Tooltip title={originalHeaderName} disableInteractive>
                      {typography}
                    </Tooltip>
                  );
                }

                return typography;
              })()}
            </Box>
            <Box ref={actionsRef} display="flex" alignItems="center" gap={1} sx={{ flexShrink: 0 }}>
              {needsZoom && (
                <HeaderZoomControls
                  ref={zoomAnchorRef}
                  zoom={zoom}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onReset={resetZoom}
                  t={t}
                  isMobile={isMobile}
                  onOpenFloating={isMobile ? () => { resetHideTimer(); setFloatingZoomOpen((prev) => !prev); } : undefined}
                />
              )}
              <IconButton onClick={handleDownload} size="small" title={t('actions.download')} sx={{ color: 'inherit' }}>
                <DownloadIcon />
              </IconButton>
              {!hideCloseButton && (
                <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }}>
                  <CloseIcon />
                </IconButton>
              )}
            </Box>
          </Box>
        </DialogTitle>
        <Popover
          open={floatingZoomOpen && headerVisible && isMobile && needsZoom}
          onClose={() => setFloatingZoomOpen(false)}
          anchorEl={zoomAnchorRef.current}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          transformOrigin={{ vertical: 'top', horizontal: 'center' }}
          slotProps={{
            paper: {
              sx: {
                mt: 0.5,
                borderRadius: 2,
                backgroundColor: 'rgba(0,0,0,0.85)',
                color: '#fff',
                boxShadow: 4,
              },
            },
          }}
          disableScrollLock
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, py: 0.5, px: 0.5 }}
          >
            <ZoomControlButtons
              zoom={zoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onReset={resetZoom}
              t={t}
            />
          </Box>
        </Popover>
        <DialogContent
          dividers={false}
          sx={{
            p: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
            touchAction: 'pan-y pan-x',
            position: 'relative',
            ...(isMobile && { pt: headerVisible ? '52px' : 0 }),
          }}
          onClick={() => {
            if (isMobile) {
              setHeaderVisible((prev) => {
                const next = !prev;
                if (next && isGalleryMode) resetHideTimer();
                return next;
              });
            }
          }}
        >
          <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderContent()}
          </Box>
          {isGalleryMode && currentPreviewFileType !== 'video' && (isMobile ? headerVisible : controlsVisible) && (
            <PreviewThumbnailBar
              files={mediaFiles}
              currentIndex={currentMediaIndex}
              onSelect={setCurrentMediaIndex}
              onThumbnailsLoaded={onThumbnailsLoaded}
              shareToken={shareToken}
            />
          )}
        </DialogContent>
      </Box>
    </Dialog>
  );
};

export default FilePreviewDialog;
