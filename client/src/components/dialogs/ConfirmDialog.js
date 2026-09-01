import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Box,
  CircularProgress,
} from '@mui/material';

/**
 * 재사용 가능한 확인 다이얼로그 컴포넌트
 * 화면 정중앙에 적당한 사이즈의 팝업으로 표시
 * variant="loading"이면 제목/메시지/버튼 없이 스피너만 표시
 */
const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  confirmColor = 'primary',
  loading = false,
  variant,
}) => {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('common.confirm');
  const resolvedConfirmText = confirmText ?? t('common.confirm');
  const resolvedCancelText = cancelText ?? t('common.cancel');
  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
  };

  const handleCancel = () => {
    if (onClose) {
      onClose();
    }
  };

  if (variant === 'loading') {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{resolvedTitle}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button data-testid="confirm-dialog-cancel" onClick={handleCancel} disabled={loading}>
          {resolvedCancelText}
        </Button>
        <Button
          data-testid="confirm-dialog-confirm"
          onClick={handleConfirm}
          variant="contained"
          color={confirmColor}
          disabled={loading}
        >
          {resolvedConfirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
