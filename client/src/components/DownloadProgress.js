import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';

const DownloadProgress = ({ items, onClose }) => {
  const [expanded, setExpanded] = useState(true);

  const getStatusIcon = (type) => {
    switch (type) {
      case 'download':
        return <DownloadIcon />;
      case 'move':
        return <MoveIcon />;
      case 'copy':
        return <CopyIcon />;
      default:
        return <DownloadIcon />;
    }
  };

  const getStatusText = (item) => {
    if (item.status === 'preparing') {
      return '준비 중...';
    } else if (item.status === 'downloading' || item.status === 'processing') {
      return item.current || '처리 중...';
    } else if (item.status === 'completed') {
      return '완료';
    } else if (item.status === 'error') {
      return `오류: ${item.error || '알 수 없는 오류'}`;
    }
    return '대기 중...';
  };

  const getProgress = (item) => {
    // Use percentage if available, otherwise calculate from progress/total
    if (item.percentage !== undefined) {
      return Math.min(100, item.percentage);
    }
    if (item.total === 0) return 0;
    return Math.min(100, (item.progress / item.total) * 100);
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1300,
        maxWidth: 400,
        width: '100%',
      }}
    >
      <Paper
        elevation={6}
        sx={{
          p: 2,
          backgroundColor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
            진행 중인 작업
          </Typography>
          <IconButton
            size="small"
            onClick={() => setExpanded(!expanded)}
            sx={{ mr: 1 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Collapse in={expanded}>
          {items.map((item, index) => (
            <Box key={index} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                {getStatusIcon(item.type)}
                <Typography
                  variant="body2"
                  sx={{
                    ml: 1,
                    flexGrow: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={item.name || item.zipName}
                >
                  {item.name || item.zipName || '작업 중...'}
                </Typography>
              </Box>
              
              <LinearProgress
                variant={
                  item.type === 'move' || item.type === 'copy' || item.status === 'preparing' || item.total === 0
                    ? 'indeterminate'
                    : 'determinate'
                }
                value={item.type === 'move' || item.type === 'copy' ? undefined : getProgress(item)}
                sx={{ mb: 0.5, height: 6, borderRadius: 3 }}
              />
              
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  {getStatusText(item)}
                </Typography>
                {item.total > 0 && item.type !== 'move' && item.type !== 'copy' && (
                  <Typography variant="caption" color="text.secondary">
                    {item.percentage !== undefined 
                      ? `${Math.round(item.percentage)}%`
                      : `${formatBytes(item.progress)} / ${formatBytes(item.total)}`
                    }
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Collapse>
      </Paper>
    </Box>
  );
};

export default DownloadProgress;

