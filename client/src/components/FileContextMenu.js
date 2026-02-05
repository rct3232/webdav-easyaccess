import React from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  DriveFileMove as MoveIcon,
  Share as ShareIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

const FileContextMenu = ({
  contextMenu,
  onClose,
  file,
  user,
  hasWritePermission,
  onDownload,
  onRename,
  onMove,
  onCopy,
  onShare,
  onManageShared,
  onDelete,
}) => {
  // 공유 버튼 표시 조건:
  // 1. 디렉토리이고, 사용자 디렉토리 하위에 있는 경우 (폴더 공유)
  // 2. 파일인 경우 (외부 공유 링크)
  const canShare = (
    (file?.type === 'directory' && user && !user.is_admin && file.path.startsWith(`/${user.username}/`)) ||
    (file?.type !== 'directory')
  );

  // 공유받은 폴더인지 확인: 디렉토리이고, 사용자 디렉토리 하위가 아닌 경우
  const isSharedFolder = file?.type === 'directory' && user && !user.is_admin && !file.path.startsWith(`/${user.username}/`);

  // Direct read permission missing on directory (disabled in list UI)
  const isPermissionDisabled = file?.type === 'directory' && file?.hasReadPermission === false;

  // Prefer per-item permission if available
  const fileWritePermission = file?.hasWritePermission !== undefined ? file.hasWritePermission : hasWritePermission;

  if (!file) return null;

  const closeMenu = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleAction = (callback) => {
    closeMenu();
    if (callback) {
      callback(file);
    }
  };

  return (
    <Menu
      open={contextMenu !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu !== null
          ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
          : undefined
      }
    >
      {isPermissionDisabled ? (
        // Permission-less folders: allow only "공유 관리" to request access
        isSharedFolder && onManageShared && (
          <MenuItem onClick={() => handleAction(onManageShared)}>
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>공유 관리</ListItemText>
          </MenuItem>
        )
      ) : (
        <>
          {onDownload && (
            <MenuItem onClick={() => handleAction(onDownload)}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>다운로드</ListItemText>
            </MenuItem>
          )}
          {onRename && (
            <MenuItem
              onClick={() => handleAction(onRename)}
              disabled={!fileWritePermission}
            >
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>이름 변경</ListItemText>
            </MenuItem>
          )}
          {onMove && (
            <MenuItem
              onClick={() => handleAction(onMove)}
              disabled={!fileWritePermission}
            >
              <ListItemIcon>
                <MoveIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>이동</ListItemText>
            </MenuItem>
          )}
          {onCopy && (
            <MenuItem onClick={() => handleAction(onCopy)}>
              <ListItemIcon>
                <CopyIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>복사</ListItemText>
            </MenuItem>
          )}
          {canShare && onShare && (
            <MenuItem onClick={() => handleAction(onShare)}>
              <ListItemIcon>
                <ShareIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>공유</ListItemText>
            </MenuItem>
          )}
          {isSharedFolder && onManageShared && (
            <MenuItem onClick={() => handleAction(onManageShared)}>
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>공유 관리</ListItemText>
            </MenuItem>
          )}
          {onDelete && (
            <MenuItem
              onClick={() => handleAction(onDelete)}
              disabled={!fileWritePermission}
            >
              <ListItemIcon>
                <DeleteIcon fontSize="small" color="error" />
              </ListItemIcon>
              <ListItemText>삭제</ListItemText>
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  );
};

export default FileContextMenu;
