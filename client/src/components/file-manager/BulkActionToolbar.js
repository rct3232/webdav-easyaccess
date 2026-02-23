import React from 'react';
import { useTranslation } from 'react-i18next';
import {
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
  const noSelection = selectedFiles.size === 0;
  const moveDeleteDisabled = bulkActionsDisabled || !hasWritePermission || noSelection;
  const copyDisabled = bulkActionsDisabled || noSelection; // destination permission checked separately
  const downloadDisabled = bulkActionsDisabled || noSelection;
  return (
    <Box
      sx={{
        px: 2,
        py: 0.5,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        alignItems: 'flex-start',
        bgcolor: 'background.paper',
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
          gap: 2,
          alignItems: 'center',
        }}
      >
        {!downloadOnly && (
          <IconButton
            size="small"
            color="primary"
            onClick={handleBulkMove}
            disabled={moveDeleteDisabled}
            title={t('actions.move')}
          >
            <MoveIcon fontSize="small" />
          </IconButton>
        )}
        {!downloadOnly && (
          <IconButton
            size="small"
            color="primary"
            onClick={handleBulkCopy}
            disabled={copyDisabled}
            title={t('actions.copy')}
          >
            <CopyIcon fontSize="small" />
          </IconButton>
        )}
        <IconButton
          size="small"
          color="primary"
          onClick={handleBulkDownload}
          disabled={downloadDisabled}
          title={t('actions.download')}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
        {!downloadOnly && (
          <IconButton
            size="small"
            color="error"
            onClick={() => {
              const filePaths = Array.from(selectedFiles);
              if (filePaths.length > 0) {
                openBulkDeleteDialog(filePaths);
              }
            }}
            disabled={moveDeleteDisabled}
            title={t('actions.delete')}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Box>
  );
};

export default BulkActionToolbar;
