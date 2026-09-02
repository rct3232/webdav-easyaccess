import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Box, TextField, Divider, Alert, Typography } from '@mui/material';
import BaseDialog from './BaseDialog';

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
  const { t } = useTranslation();
  const passwordMismatch = String(confirmPassword || '').length > 0 && password !== confirmPassword;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) onSave();
  };

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title={t('dialogs.accountEditTitle')}
      actions={
        <>
          <Button onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!canSave || loading}
            form="account-edit-form"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="account-edit-form" onSubmit={handleSubmit}>
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
          {t('dialogs.email')}
        </Typography>
        <TextField
          fullWidth
          label={t('dialogs.email')}
          type="email"
          value={email}
          onChange={(e) => (onEmailChange ? onEmailChange(e.target.value) : undefined)}
          autoComplete="email"
        />

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          {t('register.password')}
        </Typography>
        <TextField
          fullWidth
          label={t('dialogs.newPassword')}
          type="password"
          value={password}
          onChange={(e) => (onPasswordChange ? onPasswordChange(e.target.value) : undefined)}
          autoComplete="new-password"
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label={t('dialogs.confirmPassword')}
          type="password"
          value={confirmPassword}
          onChange={(e) =>
            onConfirmPasswordChange ? onConfirmPasswordChange(e.target.value) : undefined
          }
          autoComplete="new-password"
          error={passwordMismatch}
          helperText={passwordMismatch ? t('dialogs.passwordMismatch') : ' '}
        />
      </Box>
    </BaseDialog>
  );
};

export default AccountEditDialog;
