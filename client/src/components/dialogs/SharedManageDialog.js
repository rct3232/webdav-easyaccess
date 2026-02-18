import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@mui/material';
import { useSharedManage } from '../../hooks/useSharedManage';
import SharedManageBody from './SharedManageBody';

const SharedManageDialog = ({
  open,
  onClose,
  targetPath,
  displayName,
  isDirectory,
  user,
  directHasReadPermission,
  onMessage,
  onActionComplete,
}) => {
  const {
    loading,
    initialLoading,
    confirmDialogOpen,
    setConfirmDialogOpen,
    hasReadPermission,
    hasWritePermission,
    pathPermission,
    filePermissionLevel,
    pendingRequest,
    ownerExists,
    handleCancelPendingRequest,
    handlePermissionRequest,
    handleRevokePermission,
  } = useSharedManage({
    open,
    targetPath,
    displayName,
    isDirectory,
    user,
    directHasReadPermission,
    onMessage,
    onActionComplete,
    onClose,
  });

  const { t } = useTranslation();

  return (
    <>
      <Dialog open={open && !confirmDialogOpen} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('dialogs.sharedManageTitle')}</DialogTitle>
        <DialogContent>
          <SharedManageBody
            displayName={displayName}
            isDirectory={isDirectory}
            loading={loading}
            initialLoading={initialLoading}
            confirmDialogOpen={confirmDialogOpen}
            setConfirmDialogOpen={setConfirmDialogOpen}
            hasReadPermission={hasReadPermission}
            hasWritePermission={hasWritePermission}
            pathPermission={pathPermission}
            filePermissionLevel={filePermissionLevel}
            pendingRequest={pendingRequest}
            ownerExists={ownerExists}
            onRequestPermission={handlePermissionRequest}
            onCancelPendingRequest={handleCancelPendingRequest}
            onRevokePermission={handleRevokePermission}
            loadingVariant="spinner"
          />
        </DialogContent>
        <DialogActions>
          {ownerExists === false && (
            <Typography variant="caption" color="error.main" sx={{ mr: 'auto' }}>
              {t('dialogs.ownerDeleted')}
            </Typography>
          )}
          <Button onClick={onClose} disabled={loading}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SharedManageDialog;
