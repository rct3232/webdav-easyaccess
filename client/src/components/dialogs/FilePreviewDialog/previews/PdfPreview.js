import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { Document, Page } from 'react-pdf';

const PdfPreview = ({
  previewBlob,
  previewUrl,
  pdfContainerRef,
  pageArray,
  calculatedWidth,
  pageInfo,
  isMobile,
  setNumPages,
  setPageInfo,
  t,
}) => {
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
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
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
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
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
              if (prev === docNumPages) return prev;
              return docNumPages;
            });
          }}
          onLoadError={(error) => {
            console.error('PDF load error:', error);
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

export default PdfPreview;
