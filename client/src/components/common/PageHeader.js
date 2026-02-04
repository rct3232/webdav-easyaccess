import React from 'react';
import { AppBar, Toolbar, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * 페이지 헤더 컴포넌트
 * @param {string} title - 페이지 제목
 * @param {function} onBack - 뒤로가기 핸들러 (선택사항)
 * @param {React.ReactNode} actions - 우측 액션 버튼들 (선택사항)
 * @param {object} sx - 추가 스타일
 */
const PageHeader = ({ title, onBack, actions, sx }) => (
  <AppBar 
    position="sticky" 
    sx={{ 
      top: 0, 
      zIndex: (theme) => theme.zIndex.appBar,
      backgroundColor: 'transparent',
      backgroundImage: 'none',
      ...sx,
    }}
    elevation={0}
  >
    <Toolbar>
      {onBack && (
        <IconButton 
          edge="start" 
          color="inherit" 
          onClick={onBack} 
          sx={{ mr: 2 }}
        >
          <ArrowBackIcon />
        </IconButton>
      )}
      <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
        {title}
      </Typography>
      {actions}
    </Toolbar>
  </AppBar>
);

export default PageHeader;
