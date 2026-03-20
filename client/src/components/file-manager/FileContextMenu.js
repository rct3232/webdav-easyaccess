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
        <MenuItem data-testid="file-action-download" onClick={() => handleAction(onDownload)}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('actions.download')}</ListItemText>
        </MenuItem>
      )}
      {onRename && (
        <MenuItem
          data-testid="file-action-rename"
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
          data-testid="file-action-move"
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
        <MenuItem data-testid="file-action-copy" onClick={() => handleAction(onCopy)}>
          <ListItemIcon>
            <CopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('actions.copy')}</ListItemText>
        </MenuItem>
      )}
      {onShare && (
        <MenuItem data-testid="file-action-share" onClick={() => handleAction(onShare)}>
          <ListItemIcon>
            <ShareIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('actions.share')}</ListItemText>
        </MenuItem>
      )}
      {onProperties && (
            <MenuItem data-testid="file-action-properties" onClick={() => handleAction(onProperties)}>
              <ListItemIcon>
                <InfoIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('actions.properties')}</ListItemText>
            </MenuItem>
          )}
      {onDelete && (
        <MenuItem
          data-testid="file-action-delete"
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
