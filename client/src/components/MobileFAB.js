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

  // 쓰기 권한이 없거나 액션이 없으면 스피드 다이얼을 렌더링하지 않음
  if (!hasWritePermission || actions.length === 0) {
    return null;
  }

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

