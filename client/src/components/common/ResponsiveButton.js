import React from 'react';
import { Button, IconButton } from '@mui/material';

/**
 * 반응형 버튼 컴포넌트
 * 모바일에서는 IconButton, 데스크톱에서는 텍스트가 있는 Button으로 렌더링
 * @param {boolean} isMobile - 모바일 여부
 * @param {React.ReactNode} icon - 아이콘 컴포넌트
 * @param {string} label - 버튼 레이블 (데스크톱에서 표시)
 * @param {string} size - 버튼 크기 (기본값: small)
 */
const ResponsiveButton = ({ 
  isMobile, 
  icon, 
  label, 
  size = 'small',
  ...props 
}) => (
  isMobile ? (
    <IconButton size={size} {...props}>
      {icon}
    </IconButton>
  ) : (
    <Button size={size} startIcon={icon} {...props}>
      {label}
    </Button>
  )
);

export default ResponsiveButton;
