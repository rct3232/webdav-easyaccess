import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Paper,
  Typography,
  IconButton,
  Box,
} from '@mui/material';
import {
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

const BulkActionToolbar = ({
  isMobile,
  selectedFiles,
  handleBulkMove,
  handleBulkCopy,
  handleBulkDownload,
  openBulkDeleteDialog,
  hasWritePermission,
  hasReadOnlyInSelection = false,
  disabled: bulkActionsDisabled = false,
  downloadOnly = false,
}) => {
  const { t } = useTranslation();
  const moveDeleteDisabled = bulkActionsDisabled || !hasWritePermission;
  const copyDisabled = bulkActionsDisabled; // destination permission checked separately
  const downloadDisabled = bulkActionsDisabled;
  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: isMobile ? 0 : 24,
        left: isMobile ? 0 : '50%',
        right: isMobile ? 0 : 'auto',
        transform: isMobile ? 'none' : 'translateX(-50%)',
        width: isMobile ? '100%' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        alignItems: 'center',
        justifyContent: 'center',
        p: isMobile ? 1 : 1.5,
        borderRadius: isMobile ? 0 : 3,
        zIndex: 1000,
        backgroundColor: 'background.paper',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        paddingBottom: isMobile ? 'calc(8px + env(safe-area-inset-bottom))' : 1.5,
      }}
    >
      {hasReadOnlyInSelection && (
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontSize: '0.75rem',
          }}
        >
          {t('fileManager.readOnlyInSelection')}
        </Typography>
      )}
      <Box
        sx={{
          display: 'flex',
          gap: isMobile ? 0.5 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
      <Typography
        variant="body2"
        sx={{ fontWeight: 500, color: 'text.primary', flexShrink: 0 }}
      >
        {t('fileManager.selected', { count: selectedFiles.size })}
      </Typography>
      {!downloadOnly && (
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkMove}
        disabled={moveDeleteDisabled}
        title={t('actions.move')}
        sx={{ 
          backgroundColor: 'primary.main',
          color: 'white',
          '&:hover': { backgroundColor: 'primary.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <MoveIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      )}
      {!downloadOnly && (
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkCopy}
        disabled={copyDisabled}
        title={t('actions.copy')}
        sx={{ 
          backgroundColor: 'primary.main',
          color: 'white',
          '&:hover': { backgroundColor: 'primary.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <CopyIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      )}
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkDownload}
        disabled={downloadDisabled}
        title={t('actions.download')}
        sx={{ 
          backgroundColor: 'primary.main',
          color: 'white',
          '&:hover': { backgroundColor: 'primary.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <DownloadIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      {!downloadOnly && (
      <IconButton
        color="error"
        size={isMobile ? "medium" : "small"}
        onClick={() => {
          const filePaths = Array.from(selectedFiles);
          if (filePaths.length > 0) {
            openBulkDeleteDialog(filePaths);
          }
        }}
        disabled={moveDeleteDisabled}
        title={t('actions.delete')}
        sx={{ 
          backgroundColor: 'error.main',
          color: 'white',
          '&:hover': { backgroundColor: 'error.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <DeleteIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      )}
      </Box>
    </Paper>
  );
};

export default BulkActionToolbar;
