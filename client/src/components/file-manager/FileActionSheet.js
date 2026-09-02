import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  SwipeableDrawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Typography,
  Avatar,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Edit as EditIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Share as ShareIcon,
  Visibility as VisibilityIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { getFileIcon } from '../../utils/fileIconUtils';

/**
 * Bottom sheet for file actions on mobile
 * Replaces context menu for touch-friendly interface
 */
const FileActionSheet = ({
  open,
  onClose,
  file,
  onDownload,
  onRename,
  onMove,
  onCopy,
  onDelete,
  onShare,
  onPreview,
  onProperties,
  hasWritePermission = true,
}) => {
  const { t } = useTranslation();
  if (!file) return null;
  const handleAction = (action) => {
    action();
    onClose();
  };

  const isDirectory = file.type === 'directory';
  const canPreview = file.canPreview;

  // 파일 객체에 hasWritePermission이 있으면 사용, 없으면 prop의 hasWritePermission 사용
  const fileWritePermission =
    file?.hasWritePermission !== undefined ? file.hasWritePermission : hasWritePermission;

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={() => {}}
      disableSwipeToOpen
      sx={{
        '& .MuiDrawer-paper': {
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 'env(safe-area-inset-bottom)',
        },
      }}
    >
      <Box sx={{ py: 2, px: 3 }}>
        {/* File info header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Avatar
            variant="rounded"
            sx={{
              width: 48,
              height: 48,
              mr: 2,
              bgcolor: 'primary.main',
              '& svg': {
                color: 'white',
                fontSize: 28,
              },
            }}
          >
            {getFileIcon(file)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {file.basename || file.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isDirectory ? t('actions.folder') : t('actions.file')}
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 1 }} />

        {/* Actions */}
        <List sx={{ py: 0 }}>
          {canPreview && onPreview && (
            <ListItemButton
              component="button"
              data-testid="file-action-preview"
              disabled={!file.hasReadPermission}
              onClick={() => handleAction(onPreview)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <VisibilityIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.preview')} />
            </ListItemButton>
          )}

          {onProperties && (
            <ListItemButton
              component="button"
              data-testid="file-action-properties"
              onClick={() => handleAction(onProperties)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <InfoIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.properties')} />
            </ListItemButton>
          )}

          {onDownload && (
            <ListItemButton
              component="button"
              data-testid="file-action-download"
              disabled={file.hasReadPermission === false}
              onClick={() => handleAction(onDownload)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <DownloadIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.download')} />
            </ListItemButton>
          )}

          {fileWritePermission && onRename && (
            <ListItemButton
              component="button"
              data-testid="file-action-rename"
              onClick={() => handleAction(onRename)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <EditIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.rename')} />
            </ListItemButton>
          )}

          {fileWritePermission && onMove && (
            <ListItemButton
              component="button"
              data-testid="file-action-move"
              onClick={() => handleAction(onMove)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <MoveIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.move')} />
            </ListItemButton>
          )}

          {onCopy && (
            <ListItemButton
              component="button"
              data-testid="file-action-copy"
              disabled={file.hasReadPermission === false}
              onClick={() => handleAction(onCopy)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <CopyIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.copy')} />
            </ListItemButton>
          )}

          {onShare && (
            <ListItemButton
              component="button"
              data-testid="file-action-share"
              onClick={() => handleAction(onShare)}
              sx={{ minHeight: 56, borderRadius: 1 }}
            >
              <ListItemIcon>
                <ShareIcon />
              </ListItemIcon>
              <ListItemText primary={t('actions.share')} />
            </ListItemButton>
          )}

          {fileWritePermission && onDelete && (
            <>
              <Divider sx={{ my: 1 }} />
              <ListItemButton
                component="button"
                data-testid="file-action-delete"
                onClick={() => handleAction(onDelete)}
                sx={{
                  minHeight: 56,
                  borderRadius: 1,
                  color: 'error.main',
                }}
              >
                <ListItemIcon sx={{ color: 'error.main' }}>
                  <DeleteIcon />
                </ListItemIcon>
                <ListItemText primary={t('actions.delete')} />
              </ListItemButton>
            </>
          )}
        </List>
      </Box>
    </SwipeableDrawer>
  );
};

export default FileActionSheet;
