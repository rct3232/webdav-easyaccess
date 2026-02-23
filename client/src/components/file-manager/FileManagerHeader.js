import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppBar,
  Toolbar,
  Box,
  IconButton,
} from '@mui/material';
import { Person as PersonIcon } from '@mui/icons-material';

const FileManagerHeader = ({
  isMobile,
  user,
  navigate,
}) => {
  const { t } = useTranslation();
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            component="img"
            src="/logo_white.png"
            alt={t('nav.logoAlt')}
            sx={{
              height: isMobile ? '27px' : '33.75px',
              maxWidth: '100%',
              objectFit: 'contain',
            }}
          />
        </Box>
        <Box
          id="file-progress-slot"
          sx={{
            flexGrow: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            pr: 1,
          }}
        />
        <IconButton color="inherit" onClick={() => navigate('/mypage')} title={t('nav.mypage')}>
          <PersonIcon />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
};

export default FileManagerHeader;
