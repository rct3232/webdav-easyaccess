import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from '@mui/material';

const RenameDialog = ({
  open,
  onClose,
  value,
  onChange,
  error,
  onClearError,
  loading,
  onConfirm,
  fullScreen = false,
}) => {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen}>
      <DialogTitle>{t('dialogs.renameTitle')}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label={t('dialogs.newName')}
          fullWidth
          variant="outlined"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (error && onClearError) onClearError();
          }}
          error={Boolean(error)}
          helperText={error || ' '}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !loading) {
              onConfirm();
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          disabled={loading || !(value || '').trim()}
        >
          {t('dialogs.change')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RenameDialog;
