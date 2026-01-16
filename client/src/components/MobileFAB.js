import React, { useState } from 'react';
import {
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
} from '@mui/material';
import {
  Upload as UploadIcon,
  CreateNewFolder as CreateNewFolderIcon,
} from '@mui/icons-material';

/**
 * Floating Action Button with speed dial for mobile
 * Provides quick access to common actions
 */
const MobileFAB = ({ 
  onUpload, 
  onCreateFolder, 
  hasWritePermission = true,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);

  const actions = [
    { 
      icon: <CreateNewFolderIcon />, 
      name: '폴더 생성', 
      onClick: onCreateFolder,
      show: hasWritePermission,
    },
    { 
      icon: <UploadIcon />, 
      name: '파일 업로드', 
      onClick: onUpload,
      show: hasWritePermission,
    },
  ].filter(action => action.show);

  const handleActionClick = (onClick) => {
    onClick();
    setOpen(false);
  };

  return (
    <SpeedDial
      ariaLabel="파일 작업"
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        '& .MuiFab-primary': {
          width: 56,
          height: 56,
        },
        // Account for iOS safe area
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      icon={<SpeedDialIcon />}
      open={open}
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      FabProps={{
        disabled: disabled,
        tabIndex: -1, // 포커스를 받지 않도록 설정하여 Dialog 닫힘 후 포커스 이동 시 onOpen이 호출되는 것을 방지
      }}
    >
      {actions.map((action) => (
        <SpeedDialAction
          key={action.name}
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

export default MobileFAB;

