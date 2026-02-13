import React from 'react';
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

  return (
    <>
      <Dialog open={open && !confirmDialogOpen} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>공유 관리</DialogTitle>
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
              소유자가 삭제되어 권한을 요청할 수 없습니다.
            </Typography>
          )}
          <Button onClick={onClose} disabled={loading}>
            닫기
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SharedManageDialog;
