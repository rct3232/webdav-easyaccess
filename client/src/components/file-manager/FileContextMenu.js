import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          <ListItemText>{t('actions.download')}</ListItemText>
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
          <ListItemText>{t('actions.rename')}</ListItemText>
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
          <ListItemText>{t('actions.move')}</ListItemText>
        </MenuItem>
      )}
      {onCopy && (
        <MenuItem onClick={() => handleAction(onCopy)}>
          <ListItemIcon>
            <CopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('actions.copy')}</ListItemText>
        </MenuItem>
      )}
      {onShare && (
        <MenuItem onClick={() => handleAction(onShare)}>
          <ListItemIcon>
            <ShareIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('actions.share')}</ListItemText>
        </MenuItem>
      )}
      {onProperties && (
            <MenuItem onClick={() => handleAction(onProperties)}>
              <ListItemIcon>
                <InfoIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('actions.properties')}</ListItemText>
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
          <ListItemText>{t('actions.delete')}</ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
};

export default FileContextMenu;
