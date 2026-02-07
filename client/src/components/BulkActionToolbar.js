import React from 'react';
import {
  Paper,
  Typography,
  IconButton,
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
  disabled: bulkActionsDisabled = false,
}) => {
  const buttonDisabled = bulkActionsDisabled || !hasWritePermission;
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
        gap: isMobile ? 0.5 : 1,
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
      <Typography 
        variant="body2" 
        sx={{ 
          mr: isMobile ? 0.5 : 1, 
          fontWeight: 500, 
          minWidth: isMobile ? 'auto' : '60px',
          fontSize: isMobile ? '0.875rem' : '0.875rem',
        }}
      >
        {selectedFiles.size}개
      </Typography>
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkMove}
        disabled={buttonDisabled}
        title="이동"
        sx={{ 
          backgroundColor: 'primary.main',
          color: 'white',
          '&:hover': { backgroundColor: 'primary.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <MoveIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkCopy}
        disabled={buttonDisabled}
        title="복사"
        sx={{ 
          backgroundColor: 'primary.main',
          color: 'white',
          '&:hover': { backgroundColor: 'primary.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <CopyIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkDownload}
        disabled={downloadDisabled}
        title="다운로드"
        sx={{ 
          backgroundColor: 'primary.main',
          color: 'white',
          '&:hover': { backgroundColor: 'primary.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <DownloadIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
      <IconButton
        color="error"
        size={isMobile ? "medium" : "small"}
        onClick={() => {
          const filePaths = Array.from(selectedFiles);
          if (filePaths.length > 0) {
            openBulkDeleteDialog(filePaths);
          }
        }}
        disabled={buttonDisabled}
        title="삭제"
        sx={{ 
          backgroundColor: 'error.main',
          color: 'white',
          '&:hover': { backgroundColor: 'error.dark' },
          '&.Mui-disabled': { backgroundColor: 'action.disabledBackground' },
        }}
      >
        <DeleteIcon fontSize={isMobile ? "medium" : "small"} />
      </IconButton>
    </Paper>
  );
};

export default BulkActionToolbar;
