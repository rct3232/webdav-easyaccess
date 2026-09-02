import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';

/**
 * 전역 앱바 배경을 유지하기 위한 레이아웃 컴포넌트
 * 페이지 이동 시에도 그래디언트 애니메이션이 초기화되지 않도록 합니다.
 */
const MainLayout = () => {
  return (
    <Box
      sx={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* 고정된 전역 앱바 배경 */}
      <Box
        className="dynamic-appbar-gradient"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: { xs: 56, sm: 64 }, // MUI AppBar 기본 높이 (모바일/데스크톱)
          zIndex: (theme) => theme.zIndex.appBar - 1, // 앱바 바로 뒤에 위치
          pointerEvents: 'none',
        }}
      >
        <div className="gradient-bg-green" />
      </Box>

      {/* 실제 페이지 콘텐츠 */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Outlet />
      </Box>
    </Box>
  );
};

export default MainLayout;
