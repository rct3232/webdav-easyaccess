import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Breadcrumbs,
  Link,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { useResponsive } from '../../../hooks/useResponsive';
import { useFolderPicker } from './hooks/useFolderPicker';

const FolderPickerDialog = ({ open, onClose, onSelect, title, currentNodeId, user, action, sourceNodeId, sourceNodeIds }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();

  const {
    selectedNodeId,
    folders,
    loading,
    hasWritePermission,
    breadcrumbs,
    handleFolderClick,
    handleNodeClick,
    handleTogglePath,
    getCurrentPathType,
    isInvalidDestination,
  } = useFolderPicker({
    open,
    currentNodeId,
    user,
    action,
    sourceNodeId,
    sourceNodeIds,
  });

  const isSharedRoot = getCurrentPathType() === 'shared' && selectedNodeId == null;

  const handleSelect = () => {
    if (isSharedRoot) return;
    onSelect(selectedNodeId);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>{title || t('dialogs.folderSelectTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('dialogs.currentPathLabel')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <Breadcrumbs
              separator={<ChevronRightIcon fontSize="small" />}
              aria-label={t('nav.breadcrumb')}
              sx={{
                p: 1.5,
                backgroundColor: 'grey.100',
                borderRadius: (action === 'copy' || action === 'move') && user && !user.is_admin ? '4px 0 0 4px' : '4px',
                flexWrap: 'wrap',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {breadcrumbs.map((crumb, index) => (
                <Link
                  key={index}
                  component="button"
                  variant="body2"
                  onClick={() => handleNodeClick(crumb.nodeId)}
                  sx={{
                    cursor: 'pointer',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  {index === 0 && getCurrentPathType() === 'shared' && <ShareIcon sx={{ mr: 0.5, fontSize: 18 }} />}
                  {index === 0 && getCurrentPathType() === 'home' && <HomeIcon sx={{ mr: 0.5, fontSize: 18 }} />}
                  {crumb.name || t('nav.home')}
                </Link>
              ))}
            </Breadcrumbs>
            {(action === 'copy' || action === 'move') && user && !user.is_admin && (
              <Tooltip title={getCurrentPathType() === 'home' ? t('dialogs.switchToShared') : t('dialogs.switchToHome')}>
                <IconButton
                  onClick={() => handleTogglePath(null, getCurrentPathType() === 'home' ? 'shared' : 'home')}
                  size="small"
                  sx={{
                    border: 1,
                    borderColor: 'grey.100',
                    borderLeft: 'none',
                    borderRadius: '0 4px 4px 0',
                    backgroundColor: 'background.paper',
                    height: '100%',
                    minHeight: '48px',
                    px: 1.5,
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                >
                  {getCurrentPathType() === 'home' ? (
                    <ShareIcon fontSize="small" />
                  ) : (
                    <HomeIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, minHeight: 300, maxHeight: 400, overflow: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <CircularProgress />
            </Box>
          ) : folders.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <Typography color="text.secondary">{t('dialogs.noSubfolders')}</Typography>
            </Box>
          ) : (
            <List>
              {folders.map((folder, index) => {
                const hasReadPermission = folder.hasReadPermission !== false;
                const isDisabled = !hasReadPermission;
                const isHidden = folder.isHidden || (folder.basename && folder.basename.startsWith('.'));

                return (
                  <ListItem key={index} disablePadding>
                    <ListItemButton
                      onClick={() => handleFolderClick(folder)}
                      disabled={isDisabled}
                      sx={{
                        opacity: isDisabled ? 0.5 : (isHidden ? 0.5 : 1),
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        '&:hover': {
                          backgroundColor: isDisabled ? 'transparent' : undefined,
                        },
                      }}
                    >
                      <ListItemIcon>
                        <FolderIcon color={isDisabled ? 'disabled' : 'primary'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={folder.basename || folder.name || ''}
                        primaryTypographyProps={{
                          sx: {
                            color: isDisabled ? 'text.disabled' : 'text.primary',
                          },
                        }}
                      />
                      {!isDisabled && <ChevronRightIcon color="action" />}
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          onClick={handleSelect}
          variant="contained"
          color="primary"
          disabled={
            isSharedRoot ||
            ((action === 'copy' || action === 'move') && !hasWritePermission) ||
            isInvalidDestination()
          }
        >
          {t('dialogs.select')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderPickerDialog;
