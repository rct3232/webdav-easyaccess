import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Fab,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
} from '@mui/material';
import {
  Upload as UploadIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Login as LoginIcon,
  AddLink as AddLinkIcon,
} from '@mui/icons-material';

const fabGradientSx = {
  width: 56,
  height: 56,
  background: `
    radial-gradient(ellipse 250px 150px at 0% 0%, #4167ba 0%, transparent 60%),
    radial-gradient(ellipse 250px 150px at 50% 100%, #52c597 0%, transparent 60%),
    radial-gradient(ellipse 300px 200px at 100% 15%, rgba(251, 229, 89, 0.6) 0%, transparent 40%),
    linear-gradient(135deg, #4167ba, #52c597 85%, rgba(251, 229, 89, 0.5) 98%)
  `.trim(),
  '&:hover': {
    background: `
      radial-gradient(ellipse 250px 150px at 0% 0%, #4167ba 0%, transparent 60%),
      radial-gradient(ellipse 250px 150px at 50% 100%, #52c597 0%, transparent 60%),
      radial-gradient(ellipse 180px 100px at 100% 30%, #fbe559 0%, transparent 50%),
      linear-gradient(135deg, #4167ba, #52c597 80%, #fbe559 95%)
    `.trim(),
  },
};

/**
 * Floating Action Button with speed dial
 * Provides quick access to common actions.
 * shareLinkMode: { user, onLoginClick, onAddToSharedClick } — 공유 링크 모드일 때 단일 Fab (로그인/공유됨 추가)
 */
const FAB = ({
  onUpload,
  onCreateFolder,
  hasWritePermission = true,
  disabled = false,
  shareLinkMode,
  isMobile = false,
}) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const handleSpeedDialOpen = () => {
    if (isMobile) return;
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
    setOpen(prevOpen => !prevOpen);
  };

  const offset = isMobile ? 16 : 48; // PC: 3x more inward (16 * 3)
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
  ].filter(action => action.show);

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
        '& .MuiFab-primary': {
          ...fabGradientSx,
        },
        // Account for iOS safe area
        paddingBottom: 'env(safe-area-inset-bottom)',
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
