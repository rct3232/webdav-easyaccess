import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { getFileBlob } from '../../../services/fileService';
import { Document, Page, pdfjs } from 'react-pdf';
import { useResponsive } from '../../../hooks/useResponsive';
import { getFileType } from '@webdav-easyaccess/shared/fileTypes';
import { pixelMiddleTruncate } from '../../../utils/stringUtils';
import PreviewThumbnailBar from './PreviewThumbnailBar';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure pdf.js worker for react-pdf v10
// Use local file from public folder (copied from pdfjs-dist)
// Set worker path before any imports that might use it
if (typeof window !== 'undefined') {
  // Use .js extension for better compatibility with Create React App
  const workerPath = window.location.origin + (process.env.PUBLIC_URL || '') + '/pdf.worker.min.js';
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
}

const HIDE_UI_DELAY_MS = 5000;

const FilePreviewDialog = ({ open, onClose, file, mediaFiles = [], shareToken, onThumbnailsLoaded, hideCloseButton = false }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [textContent, setTextContent] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [containerWidth, setContainerWidth] = useState(null);
  const [containerHeight, setContainerHeight] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const touchStartX = useRef(null);
  const hideTimerRef = useRef(null);
  const pdfContainerRef = useRef(null);
  const stableWidthRef = useRef(null);
  const titleRowRef = useRef(null);
  const actionsRef = useRef(null);
  const [titleRowWidth, setTitleRowWidth] = useState(0);
  const [actionsWidth, setActionsWidth] = useState(0);

  const fileType = file ? getFileType(file.name || file.basename) : null;
  const isGalleryMode =
    file &&
    (fileType === 'image' || fileType === 'video') &&
    mediaFiles?.length > 1;
  const displayFile = isGalleryMode && mediaFiles[currentMediaIndex]
    ? mediaFiles[currentMediaIndex]
    : file;

  useEffect(() => {
    if (file && mediaFiles?.length > 0) {
      const idx = mediaFiles.findIndex((f) => f.path === file.path);
      setCurrentMediaIndex(idx >= 0 ? idx : 0);
    }
    // file.path 변경 시에만 동기화 (썸네일 로드 시 mediaFiles 참조 변경에 따른 리셋 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  useEffect(() => {
    if (open) {
      setHeaderVisible(true);
      setControlsVisible(true);
    }
  }, [open]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const startHideTimer = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (isMobile) {
        setHeaderVisible(false);
      } else {
        setControlsVisible(false);
      }
    }, HIDE_UI_DELAY_MS);
  }, [isMobile, clearHideTimer]);

  const resetHideTimer = useCallback(() => {
    if (isMobile) {
      setHeaderVisible(true);
    } else {
      setControlsVisible(true);
    }
    startHideTimer();
  }, [isMobile, startHideTimer]);

  useEffect(() => {
    if (!open) clearHideTimer();
    return () => clearHideTimer();
  }, [open, clearHideTimer]);

  useEffect(() => {
    if (open && isGalleryMode && !loading) {
      startHideTimer();
    }
    return () => clearHideTimer();
  }, [open, isGalleryMode, loading, startHideTimer, clearHideTimer]);

  useEffect(() => {
    if (!open) return;
    if (typeof ResizeObserver === 'undefined') return;

    const updateHeaderSizes = () => {
      setTitleRowWidth(titleRowRef.current?.clientWidth ?? 0);
      setActionsWidth(actionsRef.current?.clientWidth ?? 0);
    };

    let ro = null;
    let cancelled = false;

    const setupObserver = () => {
      if (cancelled) return;
      updateHeaderSizes();
      ro = new ResizeObserver(updateHeaderSizes);
      if (titleRowRef.current) ro.observe(titleRowRef.current);
      if (actionsRef.current) ro.observe(actionsRef.current);
    };

    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      setupObserver();
    });

    window.addEventListener('resize', updateHeaderSizes);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateHeaderSizes);
    };
  }, [open, hideCloseButton]);

  // Ensure worker is configured when component mounts
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Use .js extension for better compatibility with Create React App
      const workerPath = window.location.origin + (process.env.PUBLIC_URL || '') + '/pdf.worker.min.js';
      if (pdfjs.GlobalWorkerOptions.workerSrc !== workerPath) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
        console.log('PDF.js worker configured:', workerPath);
      }
    }
  }, []);

  // PDF 페이지 크기 계산
  const calculatedWidth = useMemo(() => {
    if (!containerWidth) {
      return isMobile ? undefined : Math.min(800, window.innerWidth - 100);
    }

    if (!containerHeight || !pageInfo) {
      // 페이지 정보가 없으면 컨테이너 너비에 맞춤
      return containerWidth;
    }

    // 이미 안정적인 width가 계산되어 있으면 재계산하지 않음
    if (stableWidthRef.current !== null) {
      return stableWidthRef.current;
    }

    const { width: pageWidth, height: pageHeight } = pageInfo;
    const widthRatio = containerWidth / pageWidth;
    const heightRatio = containerHeight / pageHeight;
    // 더 작은 비율을 사용하여 컨테이너에 맞춤
    const scale = Math.min(widthRatio, heightRatio, 1);
    const width = pageWidth * scale;
    
    // 계산된 값 저장 (한 번만 계산)
    stableWidthRef.current = width;
    
    return width;
  }, [containerWidth, containerHeight, pageInfo, isMobile]);

  // 페이지 배열 메모이제이션
  const pageArray = useMemo(() => {
    if (!numPages) return [];
    return Array.from(new Array(numPages), (_, index) => index + 1);
  }, [numPages]);

  const loadPreview = useCallback(async () => {
    const targetFile = displayFile || file;
    if (!targetFile) return;

    setLoading(true);
    setError(null);

    try {
      const blob = await getFileBlob(targetFile.path, { inline: true, shareToken });
      const filename = targetFile.name || targetFile.basename;
      const fileType = getFileType(filename);

      if (fileType === 'text') {
        const text = await blob.text();
        setTextContent(text);
      } else if (fileType === 'pdf') {
        // PDF의 경우 blob과 URL 모두 저장
        setPreviewBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } else {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }

      setLoading(false);
    } catch (err) {
      console.error('Preview load error:', err);
      setError(t('preview.loadFail'));
      setLoading(false);
    }
  }, [displayFile, file, shareToken, t]);

  useEffect(() => {
    const targetFile = displayFile || file;
    if (open && targetFile) {
      if (targetFile.canPreview !== false) {
        loadPreview();
      } else {
        setLoading(false);
      }
    } else {
      setPreviewUrl((prevUrl) => {
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }
        return null;
      });
      setPreviewBlob(null);
      setTextContent(null);
      setNumPages(null);
      setLoading(true);
      setError(null);
      setContainerWidth(null);
      setContainerHeight(null);
      setPageInfo(null);
      stableWidthRef.current = null;
    }
  }, [open, displayFile, file, loadPreview]);

  // 컨테이너 크기 측정
  useEffect(() => {
    if (!open || !pdfContainerRef.current) {
      return;
    }

    const updateContainerSize = () => {
      if (pdfContainerRef.current) {
        const width = pdfContainerRef.current.clientWidth;
        const height = pdfContainerRef.current.clientHeight;
        setContainerWidth(width - 32); // padding 고려
        setContainerHeight(height - 32); // padding 고려
      }
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(pdfContainerRef.current);

    window.addEventListener('resize', updateContainerSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateContainerSize);
    };
  }, [open, previewUrl]);


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

  const handleTouchStart = useCallback(
    (e) => {
      if (isGalleryMode) touchStartX.current = e.touches[0].clientX;
    },
    [isGalleryMode]
  );

  const handleTouchEnd = useCallback(
    (e) => {
      if (!isGalleryMode || !touchStartX.current) return;
      const endX = e.changedTouches[0].clientX;
      const diff = touchStartX.current - endX;
      if (diff > 50) goNext();
      else if (diff < -50) goPrev();
      touchStartX.current = null;
    },
    [isGalleryMode, goPrev, goNext]
  );

  const handleDownload = () => {
    const targetFile = displayFile || file;
    if (previewUrl && targetFile) {
      const link = document.createElement('a');
      link.href = previewUrl;
      link.download = targetFile.name || targetFile.basename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const renderPreview = () => {
    const targetFile = displayFile || file;

    // Check if file can be previewed
    if (targetFile && targetFile.canPreview === false) {
      return (
        <Box
          display="flex"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          minHeight={200}
          gap={2}
          py={4}
        >
          <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
            {t('preview.notSupported')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            {t('preview.fileTypeLabel')} {targetFile.name?.split('.').pop()?.toUpperCase() || t('common.unknown')}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.6)' }}>
            {t('preview.downloadHint')}
          </Typography>
        </Box>
      );
    }

    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <CircularProgress sx={{ color: 'rgba(255, 255, 255, 0.8)' }} />
        </Box>
      );
    }

    if (error) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <Typography sx={{ color: '#f44336' }}>{error}</Typography>
        </Box>
      );
    }

    const filename = targetFile.name || targetFile.basename;
    const previewFileType = getFileType(filename);

    const mediaWrapperSx = {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minHeight: 0,
      width: '100%',
    };

    switch (previewFileType) {
      case 'image':
        return (
          <Box
            sx={mediaWrapperSx}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {isGalleryMode && (isMobile ? headerVisible : controlsVisible) && (
              <IconButton
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                disabled={currentMediaIndex <= 0}
                sx={{
                  position: 'absolute',
                  left: 8,
                  zIndex: 5,
                  color: 'white',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
            )}
            <Box
              component="img"
              src={previewUrl}
              alt={targetFile.name}
              sx={{
                maxWidth: '100%',
                maxHeight: isMobile ? '100%' : '70vh',
                height: isMobile ? '100%' : 'auto',
                objectFit: 'contain',
                margin: 'auto',
                display: 'block',
              }}
            />
            {isGalleryMode && (isMobile ? headerVisible : controlsVisible) && (
              <IconButton
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                disabled={currentMediaIndex >= mediaFiles.length - 1}
                sx={{
                  position: 'absolute',
                  right: 8,
                  zIndex: 5,
                  color: 'white',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
                }}
              >
                <ChevronRightIcon />
              </IconButton>
            )}
          </Box>
        );

      case 'video':
        return (
          <Box
            sx={mediaWrapperSx}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {isGalleryMode && (isMobile ? headerVisible : controlsVisible) && (
              <IconButton
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                disabled={currentMediaIndex <= 0}
                sx={{
                  position: 'absolute',
                  left: 8,
                  zIndex: 5,
                  color: 'white',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
            )}
            <Box
              component="video"
              controls
              src={previewUrl}
              sx={{
                maxWidth: '100%',
                maxHeight: isMobile ? '100%' : '70vh',
                height: isMobile ? '100%' : 'auto',
                width: isMobile ? '100%' : 'auto',
                margin: 'auto',
                display: 'block',
              }}
            />
            {isGalleryMode && (isMobile ? headerVisible : controlsVisible) && (
              <IconButton
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                disabled={currentMediaIndex >= mediaFiles.length - 1}
                sx={{
                  position: 'absolute',
                  right: 8,
                  zIndex: 5,
                  color: 'white',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
                }}
              >
                <ChevronRightIcon />
              </IconButton>
            )}
          </Box>
        );

      case 'audio':
        return (
          <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={4}>
            <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
              {targetFile.name || targetFile.basename}
            </Typography>
            <Box
              component="audio"
              controls
              src={previewUrl}
              sx={{ width: '100%', maxWidth: 500 }}
            />
          </Box>
        );

      case 'pdf':
        if (!previewBlob && !previewUrl) {
          return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
              <CircularProgress sx={{ color: 'rgba(255, 255, 255, 0.8)' }} />
            </Box>
          );
        }
        return (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: '100%',
              height: isMobile ? '100%' : '70vh',
              overflow: 'auto',
              px: 2,
              touchAction: 'pan-y pan-x',
              WebkitOverflowScrolling: 'touch',
              ...(isMobile && {
                position: 'relative',
                overflowY: 'auto',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
              }),
            }}
          >
            <Box
              ref={pdfContainerRef}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flex: 1,
                width: '100%',
                overflow: 'auto',
                touchAction: 'pan-y pan-x pinch-zoom',
                WebkitOverflowScrolling: 'touch',
                position: 'relative',
                ...(isMobile && {
                  minHeight: 0,
                  WebkitOverflowScrolling: 'touch',
                  overflowY: 'auto',
                  overflowX: 'auto',
                }),
                '& .react-pdf__Page': {
                  touchAction: 'pan-y pan-x pinch-zoom',
                  display: 'flex',
                  justifyContent: 'center',
                  '&:not(:last-child)': {
                    marginBottom: 2,
                  },
                  '& > div': {
                    display: 'flex',
                    justifyContent: 'center',
                  },
                },
                '& .react-pdf__Page__canvas': {
                  touchAction: 'pan-y pan-x pinch-zoom',
                  maxWidth: '100%',
                  height: 'auto',
                },
                '& .react-pdf__Page__textContent': {
                  touchAction: 'pan-y pan-x',
                },
                '& .react-pdf__Page__annotations': {
                  touchAction: 'pan-y pan-x',
                },
              }}
            >
              <Document
                file={previewBlob || previewUrl}
                onLoadSuccess={({ numPages: docNumPages }) => {
                  setNumPages((prev) => {
                    // 이미 설정되어 있으면 업데이트하지 않음
                    if (prev === docNumPages) return prev;
                    return docNumPages;
                  });
                }}
                onLoadError={(error) => {
                  console.error('PDF load error:', error);
                  console.error('Error details:', {
                    message: error.message,
                    name: error.name,
                    stack: error.stack,
                    previewUrl,
                    hasBlob: !!previewBlob,
                  });
                  setError(t('preview.pdfLoadFailWithReason', { reason: error.message || t('common.unknownError') }));
                }}
                loading={
                  <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
                    <CircularProgress sx={{ color: 'rgba(255, 255, 255, 0.8)' }} />
                  </Box>
                }
                error={
                  <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
                    <Typography sx={{ color: '#f44336' }}>{t('preview.pdfLoadFail')}</Typography>
                  </Box>
                }
              >
                {pageArray.map((pageNum, index) => (
                  <Page
                    key={`page_${pageNum}`}
                    pageNumber={pageNum}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    onLoadSuccess={(page) => {
                      // 첫 페이지의 크기 정보만 한 번만 저장
                      if (index === 0 && !pageInfo) {
                        setPageInfo({
                          width: page.width,
                          height: page.height,
                        });
                      }
                    }}
                    width={calculatedWidth}
                    className="pdf-page"
                  />
                ))}
              </Document>
            </Box>
          </Box>
        );

      case 'text':
        return (
          <Box
            component="pre"
            sx={{
              maxHeight: isMobile ? '100%' : '100%',
              height: isMobile ? '100%' : 'auto',
              overflow: 'auto',
              backgroundColor: 'rgba(30, 30, 30, 0.8)',
              color: 'rgba(255, 255, 255, 0.9)',
              p: 2,
              borderRadius: isMobile ? 0 : 1,
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {textContent}
          </Box>
        );

      default:
        return (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
            <Typography sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
              {t('preview.notSupported')}
            </Typography>
          </Box>
        );
    }
  };

  const originalHeaderName = (displayFile || file)?.name || (displayFile || file)?.basename || '';
  const headerFont = '500 1.25rem Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
  const headerSafetyPx = 24;
  const headerGapPx = 8; // gap={2} on title row
  const headerFallbackWidthPx = 360;
  const maxHeaderTitleWidth = titleRowWidth > 0
    ? Math.max(40, titleRowWidth - actionsWidth - headerSafetyPx - headerGapPx)
    : headerFallbackWidthPx;
  const truncatedHeaderName = useMemo(
    () => pixelMiddleTruncate(originalHeaderName, maxHeaderTitleWidth, headerFont),
    [originalHeaderName, maxHeaderTitleWidth]
  );
  const isHeaderTruncated = truncatedHeaderName !== originalHeaderName;

  if (!file) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
        onMouseMove={() => !isMobile && isGalleryMode && resetHideTimer()}
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
            <Box ref={actionsRef} display="flex" gap={1} sx={{ flexShrink: 0 }}>
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
          {renderPreview()}
          {isGalleryMode && (isMobile ? headerVisible : controlsVisible) && (
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

