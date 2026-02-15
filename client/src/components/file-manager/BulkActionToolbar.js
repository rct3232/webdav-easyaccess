import React from 'react';
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
          읽기 전용 파일이 포함되어있습니다
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
        {selectedFiles.size}개 선택
      </Typography>
      {!downloadOnly && (
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkMove}
        disabled={moveDeleteDisabled}
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
      )}
      {!downloadOnly && (
      <IconButton
        color="primary"
        size={isMobile ? "medium" : "small"}
        onClick={handleBulkCopy}
        disabled={copyDisabled}
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
      )}
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
      )}
      </Box>
    </Paper>
  );
};

export default BulkActionToolbar;
