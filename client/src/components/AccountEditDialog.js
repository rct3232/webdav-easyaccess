import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  TextField,
  Divider,
  Alert,
  Typography,
} from '@mui/material';
import { useResponsive } from '../hooks/useResponsive';

const AccountEditDialog = ({
  open,
  onClose,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  loading = false,
  canSave = false,
  onSave,
  message,
  onClearMessage,
}) => {
  const { isMobile } = useResponsive();
  const passwordMismatch = String(confirmPassword || '').length > 0 && password !== confirmPassword;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) onSave();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
      disableRestoreFocus
    >
      <DialogTitle>정보 변경</DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          {message?.text ? (
            <Alert
              severity={message.type || 'info'}
              sx={{ mb: 2 }}
              onClose={onClearMessage ? () => onClearMessage() : undefined}
            >
              {message.text}
            </Alert>
          ) : null}

          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            이메일
          </Typography>
          <TextField
            fullWidth
            label="이메일"
            type="email"
            value={email}
            onChange={(e) => (onEmailChange ? onEmailChange(e.target.value) : undefined)}
            autoComplete="email"
          />

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            비밀번호
          </Typography>
          <TextField
            fullWidth
            label="새 비밀번호"
            type="password"
            value={password}
            onChange={(e) => (onPasswordChange ? onPasswordChange(e.target.value) : undefined)}
            autoComplete="new-password"
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="비밀번호 확인"
            type="password"
            value={confirmPassword}
            onChange={(e) =>
              onConfirmPasswordChange ? onConfirmPasswordChange(e.target.value) : undefined
            }
            autoComplete="new-password"
            error={passwordMismatch}
            helperText={passwordMismatch ? '비밀번호가 다릅니다.' : ' '}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button type="submit" variant="contained" disabled={!canSave || loading}>
            저장
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};

export default AccountEditDialog;

