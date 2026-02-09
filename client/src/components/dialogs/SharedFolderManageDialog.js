import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import { useSharedFolderManage } from '../../hooks/useSharedFolderManage';
import SharedFolderPermissionList from './SharedFolderPermissionList';

const SharedFolderManageDialog = ({
  open,
  onClose,
  folderPath,
  folderName,
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
    pendingRequest,
    ownerExists,
    handleCancelPendingRequest,
    handlePermissionRequest,
    handleRevokePermission,
  } = useSharedFolderManage({
    open,
    folderPath,
    folderName,
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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            폴더: {folderName}
          </Typography>

          {initialLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <SharedFolderPermissionList
              hasReadPermission={hasReadPermission}
              hasWritePermission={hasWritePermission}
              pendingRequest={pendingRequest}
              loading={loading}
              ownerExists={ownerExists}
              onRequestPermission={handlePermissionRequest}
              onCancelPendingRequest={handleCancelPendingRequest}
              onRevokeClick={() => setConfirmDialogOpen(true)}
            />
          )}
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

      <Dialog open={confirmDialogOpen} onClose={() => !loading && setConfirmDialogOpen(false)}>
        <DialogTitle>권한 반납 확인</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 1 }}>
            정말로 &quot;{folderName}&quot; 폴더와 하위 폴더의 모든 권한을 반납하시겠습니까?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            이 작업은 되돌릴 수 없습니다.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)} disabled={loading}>
            취소
          </Button>
          <Button
            onClick={handleRevokePermission}
            variant="contained"
            color="error"
            disabled={loading}
          >
            {loading ? '처리 중...' : '확인'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SharedFolderManageDialog;
