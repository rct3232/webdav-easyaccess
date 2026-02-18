import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
} from '@mui/material';
import {
  Description as FileIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';

const ConflictResolveDialog = ({
  open,
  onClose,
  onResolve,
  conflicts = [],
  operationType,
}) => {
  const { t } = useTranslation();
  const handleOverwrite = () => {
    onResolve('overwrite');
  };

  const handleSkip = () => {
    onResolve('skip');
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{t('dialogs.conflictTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('dialogs.conflictMessage')}
        </DialogContentText>
        
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, maxHeight: 200, overflow: 'auto', p: 1 }}>
          <List dense>
            {conflicts.map((conflict, index) => (
              <ListItem key={index}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {conflict.type === 'directory' ? <FolderIcon color="primary" /> : <FileIcon color="action" />}
                </ListItemIcon>
                <ListItemText 
                  primary={conflict.path.split('/').pop()} 
                  secondary={conflict.path}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 'medium' }}
                  secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
        
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          * {t('dialogs.conflictMergeNote')}
          <br />
          * {t('dialogs.conflictSkipNote')}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleCancel} color="inherit">
          {t('common.cancel')}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button 
          onClick={handleSkip} 
          variant="outlined" 
          color="primary"
        >
          {t('dialogs.conflictSkip')}
        </Button>
        <Button
          onClick={handleOverwrite}
          variant="contained"
          color="primary"
        >
          {t('dialogs.conflictMerge')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConflictResolveDialog;
