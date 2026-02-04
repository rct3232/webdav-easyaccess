import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

/**
 * 로딩 상태를 표시하는 공용 컴포넌트
 * @param {number} size - CircularProgress 크기 (기본값: 40)
 * @param {string} text - 로딩 텍스트 (선택사항)
 * @param {object} sx - 추가 스타일
 * @param {number} minHeight - 최소 높이 (선택사항)
 */
const LoadingState = ({ size = 40, text, sx, minHeight }) => (
  <Box 
    sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      py: 4,
      minHeight,
      ...sx 
    }}
  >
    <CircularProgress size={size} />
    {text && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {text}
      </Typography>
    )}
  </Box>
);

export default LoadingState;
