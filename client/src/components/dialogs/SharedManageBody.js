import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const name = displayName || '';
  const label = (isDirectory ? t('actions.folder') : t('actions.file')) + ': ' + name;
  const revokeConfirmBody = t('dialogs.revokeConfirmBody', { name });

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
          {t('dialogs.ownerDeleted')}
        </Typography>
      )}

      <Dialog open={confirmDialogOpen} onClose={() => !loading && setConfirmDialogOpen(false)}>
        <DialogTitle>{t('dialogs.revokeConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {revokeConfirmBody}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('dialogs.revokeConfirmFooter')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={onRevokePermission}
            variant="contained"
            color="error"
            disabled={loading}
          >
            {loading ? t('dialogs.processing') : t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
