import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { Document, Page } from 'react-pdf';

// 공통 상수
export const PREVIEW_MAX_HEIGHT = 'calc(100vh - 64px)';

/**
 * 이미지 미리보기 컴포넌트
 */
export const ShareLinkPreviewImage = ({ previewUrl, fileName }) => (
  <Box
    component="img"
    src={previewUrl}
    alt={fileName}
    sx={{
      maxWidth: '100%',
      maxHeight: PREVIEW_MAX_HEIGHT,
      height: 'auto',
      objectFit: 'contain',
      margin: 'auto',
      display: 'block',
    }}
  />
);

/**
 * 비디오 미리보기 컴포넌트
 */
export const ShareLinkPreviewVideo = ({ previewUrl }) => (
  <Box
    component="video"
    controls
    src={previewUrl}
    sx={{
      maxWidth: '100%',
      maxHeight: PREVIEW_MAX_HEIGHT,
      height: 'auto',
      width: '100%',
      margin: 'auto',
      display: 'block',
    }}
  />
);

/**
 * 오디오 미리보기 컴포넌트
 */
export const ShareLinkPreviewAudio = ({ previewUrl, fileName }) => (
  <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={4}>
    <Typography variant="h6">{fileName}</Typography>
    <Box
      component="audio"
      controls
      src={previewUrl}
      sx={{ width: '100%', maxWidth: 500 }}
    />
  </Box>
);

/**
 * PDF 미리보기 컴포넌트
 */
export const ShareLinkPreviewPdf = ({
  previewBlob,
  previewUrl,
  pdfContainerRef,
  numPages,
  pageArray,
  calculatedWidth,
  pageInfo,
  setPageInfo,
  setNumPages,
  setError,
}) => {
  if (!previewBlob && !previewUrl) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={PREVIEW_MAX_HEIGHT}>
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
        height: PREVIEW_MAX_HEIGHT,
        overflow: 'auto',
        px: 2,
        touchAction: 'pan-y pan-x',
        WebkitOverflowScrolling: 'touch',
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
        }}
      >
        <Document
          file={previewBlob || previewUrl}
          onLoadSuccess={({ numPages: docNumPages }) => {
            setNumPages((prev) => {
              if (prev === docNumPages) return prev;
              return docNumPages;
            });
          }}
          onLoadError={(error) => {
            console.error('PDF load error:', error);
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
};

/**
 * 텍스트 미리보기 컴포넌트
 */
export const ShareLinkPreviewText = ({ textContent }) => (
  <Box
    component="pre"
    sx={{
      maxHeight: PREVIEW_MAX_HEIGHT,
      height: '100%',
      overflow: 'auto',
      backgroundColor: 'grey.100',
      p: 2,
      borderRadius: 0,
      fontFamily: 'monospace',
      fontSize: '0.875rem',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      margin: 0,
    }}
  >
    {textContent}
  </Box>
);

/**
 * 미지원 파일 형식 컴포넌트
 */
export const ShareLinkPreviewUnsupported = () => (
  <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight={PREVIEW_MAX_HEIGHT} gap={2} px={2}>
    <Typography variant="h6">이 파일 형식은 미리보기를 지원하지 않습니다.</Typography>
    <Typography variant="body2" color="text.secondary">
      다운로드 버튼을 클릭하여 파일을 다운로드하세요.
    </Typography>
  </Box>
);
