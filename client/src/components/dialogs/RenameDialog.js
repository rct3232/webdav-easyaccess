import React from 'react';
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
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen}>
      <DialogTitle>이름 변경</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="새 이름"
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
          취소
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          disabled={loading || !(value || '').trim()}
        >
          변경
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RenameDialog;
