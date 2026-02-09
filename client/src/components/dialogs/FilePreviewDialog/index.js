import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  CircularProgress,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { Document, Page, pdfjs } from 'react-pdf';
import { useResponsive } from '../../../hooks/useResponsive';
import { getFileType } from '../../../utils/fileTypeUtils';
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

const FilePreviewDialog = ({ open, onClose, file }) => {
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
  const pdfContainerRef = useRef(null);
  const stableWidthRef = useRef(null);

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
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get('/api/files/download', {
        params: { 
          path: file.path,
          inline: 'true'
        },
        responseType: 'blob',
      });

      const blob = response.data;
      const filename = file.name || file.basename;
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
      setError('파일을 불러올 수 없습니다.');
      setLoading(false);
    }
  }, [file]);

  useEffect(() => {
    if (open && file) {
      if (file.canPreview !== false) {
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
  }, [open, file, loadPreview]);

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


  const handleDownload = () => {
    if (previewUrl) {
      const link = document.createElement('a');
      link.href = previewUrl;
      link.download = file.name || file.basename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const renderPreview = () => {
    // Check if file can be previewed
    if (file && file.canPreview === false) {
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
          <Typography variant="h6" color="text.secondary">
            미리보기를 지원하지 않는 파일입니다
          </Typography>
          <Typography variant="body2" color="text.secondary">
            파일 형식: {file.name?.split('.').pop()?.toUpperCase() || 'Unknown'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            우측 상단의 다운로드 버튼을 클릭하세요
          </Typography>
        </Box>
      );
    }
    
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <Typography color="error">{error}</Typography>
        </Box>
      );
    }

    const filename = file.name || file.basename;
    const fileType = getFileType(filename);

    switch (fileType) {
      case 'image':
        return (
          <Box
            component="img"
            src={previewUrl}
            alt={file.name}
            sx={{
              maxWidth: '100%',
              maxHeight: isMobile ? '100%' : '70vh',
              height: isMobile ? '100%' : 'auto',
              objectFit: 'contain',
              margin: 'auto',
              display: 'block',
            }}
          />
        );

      case 'video':
        return (
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
        );

      case 'audio':
        return (
          <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={4}>
            <Typography variant="h6">{file.name || file.basename}</Typography>
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
              <CircularProgress />
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
                  setError(`PDF 파일을 불러올 수 없습니다: ${error.message || '알 수 없는 오류'}`);
                }}
                loading={
                  <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
                    <CircularProgress />
                  </Box>
                }
                error={
                  <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
                    <Typography color="error">PDF 파일을 불러올 수 없습니다.</Typography>
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
              maxHeight: isMobile ? '100%' : '70vh',
              height: isMobile ? '100%' : 'auto',
              overflow: 'auto',
              backgroundColor: 'grey.100',
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
            <Typography>이 파일 형식은 미리보기를 지원하지 않습니다.</Typography>
          </Box>
        );
    }
  };

  if (!file) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={file?.canPreview === false ? 'sm' : 'lg'}
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        sx: {
          minHeight: file?.canPreview === false ? 'auto' : '80vh',
          ...(isMobile && {
            height: 'var(--app-height)',
            maxHeight: 'var(--app-height)',
            margin: 0,
            borderRadius: 0,
          }),
        },
      }}
    >
      <DialogTitle sx={isMobile ? { flexShrink: 0 } : { pb: 1.5 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
          <Typography variant="h6" component="div" noWrap sx={{ flex: 1, mr: 2 }}>
            {file.name || file.basename}
          </Typography>
          <Box display="flex" gap={1} sx={{ flexShrink: 0 }}>
            <IconButton onClick={handleDownload} size="small" title="다운로드">
              <DownloadIcon />
            </IconButton>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
        {!isMobile && (
          <Typography 
            variant="caption" 
            color="text.secondary" 
            sx={{ 
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '0.75rem',
              lineHeight: 1.4,
              mt: 0.5,
            }}
          >
            {file.path}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent 
        dividers={!isMobile}
        sx={{ 
          p: 0,
          touchAction: 'pan-y pan-x',
          ...(isMobile && {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
            borderTop: '1px solid',
            borderColor: 'divider',
            touchAction: 'pan-y pan-x',
          }),
        }}
      >
        {renderPreview()}
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;

