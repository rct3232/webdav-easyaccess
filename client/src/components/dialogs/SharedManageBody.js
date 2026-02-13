import React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  CircularProgress,
  Skeleton,
} from '@mui/material';
import SharedPermissionList from './SharedPermissionList';

const REVOKE_CONFIRM_TITLE = '권한 반납 확인';
const REVOKE_CONFIRM_FOOTER = '이 작업은 되돌릴 수 없습니다.';

/**
 * 공유 관리 본문 (presentational). 훅 없이 호출부에서 넘긴 값만으로 UI 렌더.
 * ShareManageContent(ShareTargetDialog)와 SharedManageDialog에서 재사용.
 */
export default function SharedManageBody({
  displayName,
  isDirectory,
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
  onRequestPermission,
  onCancelPendingRequest,
  onRevokePermission,
  loadingVariant = 'skeleton',
}) {
  const label = (isDirectory ? '폴더' : '파일') + ': ' + (displayName || '');
  const revokeConfirmBody = `정말로 "${displayName || ''}"에 대한 권한을 반납하시겠습니까?`;

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {label}
      </Typography>

      {initialLoading ? (
        loadingVariant === 'spinner' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Skeleton variant="rounded" height={48} sx={{ width: '100%' }} />
            <Skeleton variant="rounded" height={48} sx={{ width: '100%' }} />
          </Box>
        )
      ) : (
        <SharedPermissionList
          isDirectory={isDirectory}
          hasReadPermission={hasReadPermission}
          hasWritePermission={hasWritePermission}
          pathPermission={pathPermission}
          filePermissionLevel={filePermissionLevel}
          pendingRequest={pendingRequest}
          loading={loading}
          ownerExists={ownerExists}
          onRequestPermission={onRequestPermission}
          onCancelPendingRequest={onCancelPendingRequest}
          onRevokeClick={() => setConfirmDialogOpen(true)}
        />
      )}

      {ownerExists === false && (
        <Typography variant="caption" color="error.main" sx={{ mt: 1, display: 'block' }}>
          소유자가 삭제되어 권한을 요청할 수 없습니다.
        </Typography>
      )}

      <Dialog open={confirmDialogOpen} onClose={() => !loading && setConfirmDialogOpen(false)}>
        <DialogTitle>{REVOKE_CONFIRM_TITLE}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {revokeConfirmBody}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {REVOKE_CONFIRM_FOOTER}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)} disabled={loading}>
            취소
          </Button>
          <Button
            onClick={onRevokePermission}
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
}
