import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, AppBar, Toolbar, IconButton, SwipeableDrawer } from '@mui/material';
import { Menu as MenuIcon, Close as CloseIcon } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useResponsive } from '../hooks/useResponsive';
import MyPageSidebar from '../components/mypage/MyPageSidebar';
import MyPageContentArea from '../components/mypage/MyPageContentArea';

const DEFAULT_CATEGORY = 'account';

const MyPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useResponsive();

  const resolveCategory = useCallback(
    (cat) => {
      if (!cat) return DEFAULT_CATEGORY;
      if (cat === 'admin' && user?.is_admin) return 'admin-users';
      if (cat === 'admin' && !user?.is_admin) return DEFAULT_CATEGORY;
      if (cat === 'admin-users' || cat === 'admin-settings') return user?.is_admin ? cat : DEFAULT_CATEGORY;
      if (cat === 'sharing' && user?.is_admin) return DEFAULT_CATEGORY;
      return cat;
    },
    [user?.is_admin]
  );
  const initCategory = resolveCategory(location.state?.category ?? DEFAULT_CATEGORY);
  const [selectedCategory, setSelectedCategory] = useState(initCategory);
  const [selectedContentItem, setSelectedContentItem] = useState(null);
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);

  useEffect(() => {
    const cat = resolveCategory(location.state?.category);
    if (cat) {
      setSelectedCategory(cat);
      setSelectedContentItem(null);
    }
  }, [location.state?.category, resolveCategory]);

  const handleSelectCategory = (categoryId) => {
    setSelectedCategory(categoryId);
    setSelectedContentItem(null);
    if (isMobile) setCategoryDrawerOpen(false);
  };

  const handleClose = () => navigate('/');

  const handleSelectContentItem = (itemId) => {
    setSelectedContentItem(itemId);
  };

  if (!user) return null;

  const sidebarContent = (
    <MyPageSidebar
      selectedCategory={selectedCategory}
      onSelectCategory={handleSelectCategory}
      user={user}
      isMobile={isMobile}
    />
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--app-height)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
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
          {isMobile ? (
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setCategoryDrawerOpen(true)}
              sx={{ mr: 2 }}
              aria-label={t('nav.mypage')}
            >
              <MenuIcon />
            </IconButton>
          ) : (
            <Box
              component="img"
              src="/logo_white.png"
              alt={t('nav.logoAlt')}
              sx={{
                height: 33.75,
                maxWidth: '100%',
                objectFit: 'contain',
              }}
            />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <IconButton color="inherit" onClick={handleClose} aria-label={t('common.close')}>
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {isMobile ? (
          <SwipeableDrawer
            anchor="left"
            open={categoryDrawerOpen}
            onClose={() => setCategoryDrawerOpen(false)}
            onOpen={() => setCategoryDrawerOpen(true)}
            PaperProps={{ sx: { width: 280 } }}
          >
            {sidebarContent}
          </SwipeableDrawer>
        ) : (
          <Box
            sx={{
              width: 240,
              flexShrink: 0,
              overflowY: 'auto',
            }}
          >
            {sidebarContent}
          </Box>
        )}

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <MyPageContentArea
            selectedCategory={selectedCategory}
            selectedContentItem={selectedContentItem}
            onSelectContentItem={handleSelectContentItem}
            user={user}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default MyPage;
