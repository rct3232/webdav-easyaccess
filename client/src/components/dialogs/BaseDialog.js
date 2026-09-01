/**
 * Base dialog component with common structure and responsive behavior
 * Provides standardized layout for all dialogs
 */

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { useResponsive } from '../../hooks/useResponsive';

/**
 * Base dialog component
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether dialog is open
 * @param {Function} props.onClose - Close handler
 * @param {string} props.title - Dialog title
 * @param {React.ReactNode} props.children - Dialog content
 * @param {React.ReactNode} props.actions - Dialog actions (buttons)
 * @param {string} props.maxWidth - Max width ('xs' | 'sm' | 'md' | 'lg' | 'xl')
 * @param {boolean} props.fullWidth - Whether dialog should be full width
 * @param {boolean} props.disableRestoreFocus - Whether to disable restore focus
 * @param {Object} props.sx - Additional styles
 */
const BaseDialog = ({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  disableRestoreFocus = true,
  sx = {},
}) => {
  const { isMobile } = useResponsive();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      fullScreen={isMobile}
      disableRestoreFocus={disableRestoreFocus}
      sx={sx}
    >
      {title && <DialogTitle>{title}</DialogTitle>}
      {children && <DialogContent>{children}</DialogContent>}
      {actions && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  );
};

export default BaseDialog;
