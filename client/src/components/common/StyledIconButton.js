import React from 'react';
import { IconButton } from '@mui/material';

/**
 * 스타일이 적용된 IconButton 컴포넌트
 * @param {boolean} isMobile - 모바일 여부 (크기 조절)
 * @param {string} color - 색상 (primary, secondary, error 등 MUI 테마 색상)
 * @param {object} sx - 추가 스타일
 * @param {React.ReactNode} children - 아이콘
 */
const StyledIconButton = ({ 
  isMobile, 
  color = 'primary',
  children, 
  sx,
  ...props 
}) => (
  <IconButton
    color={color}
    size={isMobile ? "medium" : "small"}
    sx={{ 
      backgroundColor: `${color}.main`,
      color: 'white',
      '&:hover': { backgroundColor: `${color}.dark` },
      '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
      ...sx,
    }}
    {...props}
  >
    {children}
  </IconButton>
);

export default StyledIconButton;
