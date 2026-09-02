import React from 'react';
import { Box } from '@mui/material';

const TextPreview = ({ textContent, textContainerRef, textPreRef, textOverflows, isMobile }) => (
  <Box
    ref={textContainerRef}
    sx={{
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: textOverflows ? 'flex-start' : 'center',
      alignItems: 'stretch',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
      '&::-webkit-scrollbar': { display: 'none' },
    }}
  >
    <Box
      ref={textPreRef}
      component="pre"
      sx={{
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
  </Box>
);

export default TextPreview;
