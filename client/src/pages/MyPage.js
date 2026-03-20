import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, AppBar, Toolbar, IconButton, SwipeableDrawer } from '@mui/material';
import { Menu as MenuIcon, Close as CloseIcon } from '@mui/icons-material';
import { useResponsive } from '../hooks/useResponsive';
import MyPageSidebar from '../components/mypage/MyPageSidebar';
import MyPageContentArea from '../components/mypage/MyPageContentArea';
import { useMyPageController } from './MyPage/hooks/useMyPageController';

const MyPage = () => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const {
    user,
    selectedCategory,
    selectedContentItem,
    categoryDrawerOpen,
    sidebarItems,
    onSelectCategory,
    onSelectContentItem,
    onOpenCategoryDrawer,
    onCloseCategoryDrawer,
    onCloseMyPage,
  } = useMyPageController({ isMobile });

  if (!user) return null;

  const sidebarContent = (
    <MyPageSidebar
      categories={sidebarItems}
      selectedCategory={selectedCategory}
      onSelectCategory={onSelectCategory}
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
              onClick={onOpenCategoryDrawer}
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
          <IconButton color="inherit" onClick={onCloseMyPage} aria-label={t('common.close')}>
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {isMobile ? (
          <SwipeableDrawer
            anchor="left"
            open={categoryDrawerOpen}
            onClose={onCloseCategoryDrawer}
            onOpen={onOpenCategoryDrawer}
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
            onSelectContentItem={onSelectContentItem}
            user={user}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default MyPage;
