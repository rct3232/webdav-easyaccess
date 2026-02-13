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
  Info as InfoIcon,
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
  onProperties,
  onDelete,
}) => {
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
      {onShare && (
        <MenuItem onClick={() => handleAction(onShare)}>
          <ListItemIcon>
            <ShareIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>공유</ListItemText>
        </MenuItem>
      )}
      {onProperties && (
            <MenuItem onClick={() => handleAction(onProperties)}>
              <ListItemIcon>
                <InfoIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>속성</ListItemText>
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
    </Menu>
  );
};

export default FileContextMenu;
