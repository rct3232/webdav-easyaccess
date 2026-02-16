import React from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { LoginForm } from '../../pages/Login';

/**
 * Modal dialog that shows the login form. On success, calls onClose (no navigation).
 * Used e.g. when user is on a share link and wants to log in without leaving the page.
 */
const LoginDialog = ({ open, onClose }) => (
  <Dialog
    open={open}
    onClose={onClose}
    maxWidth="sm"
    fullWidth
    PaperProps={{ sx: { m: 1 } }}
    disableRestoreFocus
  >
    <DialogContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
      <LoginForm redirectAfterLogin={false} onSuccess={onClose} />
    </DialogContent>
  </Dialog>
);

export default LoginDialog;
