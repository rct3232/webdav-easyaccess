import React from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  TextField,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Search as SearchIcon,
  Close as CloseIcon,
  AdminPanelSettings as AdminIcon,
  Person as PersonIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material';

const FileManagerHeader = ({
  isMobile,
  isSearchMode,
  setIsSearchMode,
  searchQuery,
  setSearchQuery,
  user,
  navigate,
  handleLogout,
}) => {
  return (
    <AppBar 
      position="sticky" 
      sx={{ 
        top: 0, 
        zIndex: (theme) => theme.zIndex.appBar,
        backgroundColor: 'transparent',
        backgroundImage: 'none',
      }} 
      elevation={0}
    >
      <Toolbar>
        {isMobile && isSearchMode ? (
          // 모바일 검색 모드: 앱바 전체가 검색창
          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="파일 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  '& fieldset': {
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                  },
                  '&:hover fieldset': {
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'rgba(255, 255, 255, 0.7)',
                  },
                  '& input': {
                    color: 'white',
                    '&::placeholder': {
                      color: 'rgba(255, 255, 255, 0.7)',
                      opacity: 1,
                    },
                  },
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.7)' }} />
                  </InputAdornment>
                ),
              }}
            />
            <IconButton
              color="inherit"
              onClick={() => {
                setIsSearchMode(false);
                setSearchQuery('');
              }}
              title="검색 닫기"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        ) : (
          // 일반 모드: 로고와 버튼들 표시
          <>
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                component="img"
                src="/logo_white.png"
                alt="WebDAV EasyAccess"
                sx={{
                  height: isMobile ? '27px' : '33.75px',
                  maxWidth: '100%',
                  objectFit: 'contain',
                }}
              />
            </Box>
            {!isMobile && (
              // 데스크톱: 검색창 항상 표시 (우측)
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
                <TextField
                  size="small"
                  placeholder="파일 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchMode(true)}
                  sx={{
                    width: 300,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'rgba(255, 255, 255, 0.2)',
                      color: 'white',
                      '& fieldset': {
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                      },
                      '&:hover fieldset': {
                        borderColor: 'rgba(255, 255, 255, 0.5)',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: 'rgba(255, 255, 255, 0.7)',
                      },
                      '& input': {
                        color: 'white',
                        '&::placeholder': {
                          color: 'rgba(255, 255, 255, 0.7)',
                          opacity: 1,
                        },
                      },
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.7)' }} />
                      </InputAdornment>
                    ),
                    endAdornment: searchQuery && (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setSearchQuery('');
                            setIsSearchMode(false);
                          }}
                          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            )}
            {isMobile && (
              <IconButton color="inherit" onClick={() => setIsSearchMode(true)} title="검색">
                <SearchIcon />
              </IconButton>
            )}
            {user?.is_admin && (
              <IconButton color="inherit" onClick={() => navigate('/admin')} title="관리자 대시보드">
                <AdminIcon />
              </IconButton>
            )}
            <IconButton color="inherit" onClick={() => navigate('/mypage')} title="마이페이지">
              <PersonIcon />
            </IconButton>
            <IconButton color="inherit" onClick={handleLogout} title="로그아웃">
              <LogoutIcon />
            </IconButton>
          </>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default FileManagerHeader;
