import React from 'react';
import { Box } from '@mui/material';

/**
 * 검색어 하이라이트 함수
 * @param {string} text - 원본 텍스트
 * @param {string} query - 검색어
 * @returns {Array<React.ReactNode>} 하이라이트된 텍스트 배열
 */
export const highlightText = (text, query) => {
  if (!query || !text) return text;
  
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
  
  return parts.map((part, index) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      return (
        <Box
          key={`match-${index}-${part}`}
          component="span"
          sx={{
            backgroundColor: 'warning.light',
            color: 'warning.contrastText',
            fontWeight: 600,
          }}
        >
          {part}
        </Box>
      );
    }
    return <React.Fragment key={`text-${index}-${part}`}>{part}</React.Fragment>;
  });
};
