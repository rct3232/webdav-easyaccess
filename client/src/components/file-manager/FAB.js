import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fab, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import {
  Upload as UploadIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Login as LoginIcon,
  AddLink as AddLinkIcon,
} from '@mui/icons-material';
import { FAB_GRADIENT_BACKGROUND, FAB_GRADIENT_BACKGROUND_HOVER } from './fabGradient';

const fabGradientSx = {
  width: 56,
  height: 56,
  background: FAB_GRADIENT_BACKGROUND,
  '&:hover': {
    background: FAB_GRADIENT_BACKGROUND_HOVER,
  },
};

// Controlled-mount morph visibility (FloatingSearchBar.md §2.5): while the search bar
// is expanded the FAB stays MOUNTED and fades/scales out (instant out, delayed back-in
// so the search button leads the reverse swap) instead of vanishing. It keeps the fab
// slot occupied (self-report stays true) — only the search button covers the spot.
// Root level: opacity + hit-testing only (E2E reads the root opacity seam).
const getMorphFadeSx = (morphed) => ({
  opacity: morphed ? 0 : 1,
  pointerEvents: morphed ? 'none' : 'auto',
  transition: morphed ? 'opacity 0.16s ease-in' : 'opacity 0.16s ease-out 0.14s',
});

// Disc level: the 56px circle scales about its own center (element-self origin —
// mirrors the SearchActionButton fabSlotIn/fabSlotOut geometry; no px constants).
// MUI pins pointer-events:auto on the SpeedDial fab, so the morphed disc must opt
// out explicitly: scaled over the ghost submit button it would swallow its clicks.
const getMorphScaleSx = (morphed) => ({
  transform: morphed ? 'scale(0.6)' : 'scale(1)',
  pointerEvents: morphed ? 'none' : 'auto',
  transition: morphed ? 'transform 0.16s ease-in' : 'transform 0.16s ease-out 0.14s',
});

// The share-link Fab IS the disc: it carries both halves on itself.
const getMorphVisibilitySx = (morphed) => ({
  ...getMorphFadeSx(morphed),
  ...getMorphScaleSx(morphed),
});

/**
 * Floating Action Button with speed dial
 * Provides quick access to common actions.
 * shareLinkMode: { user, onLoginClick, onAddToSharedClick } — 공유 링크 모드일 때 단일 Fab (로그인/공유됨 추가)
 * onVisibilityChange: reports actual visibility (true while rendering, false on hide/unmount)
 * morphed: controlled-mount swap signal — the search bar owns the fab slot right now;
 * the FAB animates out but keeps mounting and keeps reporting visibility true.
 */
const FAB = ({
  onUpload,
  onCreateFolder,
  hasWritePermission = true,
  disabled = false,
  shareLinkMode,
  isMobile = false,
  onVisibilityChange,
  morphed = false,
}) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const handleSpeedDialOpen = (_event, reason) => {
    if (isMobile) return;
    if (reason !== 'toggle') return; // PC: click-only open, ignore hover/focus
    setOpen(true);
  };

  const handleSpeedDialClose = (_event, reason) => {
    // Mobile/WebKit can emit a toggle-close immediately after the first tap.
    // Drive mobile opening from the trigger click path instead.
    if (isMobile && reason === 'toggle') return;
    setOpen(false);
  };

  const handleFabTriggerClick = () => {
    if (!isMobile) return;
    setOpen((prevOpen) => !prevOpen);
  };

  const offset = isMobile ? 16 : 48; // PC: 3x more inward (16 * 3)

  // 실제 렌더링 여부(self-hide/unmount 포함)를 부모에게 보고 — FloatingSearchBar 확장 트리거의 단일 출처
  const isVisible = Boolean(shareLinkMode) || hasWritePermission;
  useEffect(() => {
    if (!isVisible || !onVisibilityChange) return undefined;
    onVisibilityChange(true);
    return () => onVisibilityChange(false);
  }, [isVisible, onVisibilityChange]);

  // The morph owns the slot: never keep the dial expanded underneath it.
  useEffect(() => {
    if (morphed) setOpen(false);
  }, [morphed]);

  if (shareLinkMode) {
    const { user, onLoginClick, onAddToSharedClick } = shareLinkMode;
    const isLoggedIn = !!user;
    return (
      <Fab
        data-testid="share-link-fab"
        color="primary"
        aria-label={isLoggedIn ? t('nav.addToShared') : t('nav.login')}
        onClick={isLoggedIn ? onAddToSharedClick : onLoginClick}
        sx={{
          position: 'fixed',
          bottom: offset,
          right: offset,
          zIndex: 1050,
          paddingBottom: 'env(safe-area-inset-bottom)',
          ...fabGradientSx,
          ...getMorphVisibilitySx(morphed),
        }}
      >
        {isLoggedIn ? <AddLinkIcon /> : <LoginIcon />}
      </Fab>
    );
  }

  const actions = [
    {
      testId: 'file-actions-create-folder',
      icon: <CreateNewFolderIcon />,
      name: t('fileManager.createFolder'),
      onClick: onCreateFolder,
      show: hasWritePermission,
    },
    {
      testId: 'file-actions-upload',
      icon: <UploadIcon />,
      name: t('fileManager.uploadFile'),
      onClick: onUpload,
      show: hasWritePermission,
    },
  ].filter((action) => action.show);

  const handleActionClick = (onClick) => {
    onClick();
    setOpen(false);
  };

  // 쓰기 권한이 없거나 액션이 없으면 스피드 다이얼을 렌더링하지 않음
  if (!hasWritePermission || actions.length === 0) {
    return null;
  }

  return (
    <SpeedDial
      data-testid="file-actions-speed-dial"
      ariaLabel={t('fileManager.fileActions')}
      sx={{
        position: 'fixed',
        bottom: offset,
        right: offset,
        zIndex: 1050,
        '& .MuiFab-primary': {
          ...fabGradientSx,
        },
        // Account for iOS safe area
        paddingBottom: 'env(safe-area-inset-bottom)',
        ...getMorphFadeSx(morphed),
      }}
      icon={<SpeedDialIcon />}
      open={open}
      onClose={handleSpeedDialClose}
      onOpen={handleSpeedDialOpen}
      FabProps={{
        'data-testid': 'file-actions-fab',
        disabled: disabled,
        onClick: handleFabTriggerClick,
        tabIndex: -1, // 포커스를 받지 않도록 설정하여 Dialog 닫힘 후 포커스 이동 시 onOpen이 호출되는 것을 방지
        sx: getMorphScaleSx(morphed),
      }}
    >
      {actions.map((action) => (
        <SpeedDialAction
          key={action.name}
          data-testid={action.testId}
          icon={action.icon}
          tooltipTitle={action.name}
          onClick={() => handleActionClick(action.onClick)}
          FabProps={{
            sx: {
              minWidth: 48,
              minHeight: 48,
            },
          }}
        />
      ))}
    </SpeedDial>
  );
};

export default FAB;
