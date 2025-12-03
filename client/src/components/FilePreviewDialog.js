import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Button,
  Box,
  Typography,
  CircularProgress,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import axios from 'axios';

const FilePreviewDialog = ({ open, onClose, file }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [textContent, setTextContent] = useState(null);

  const loadPreview = useCallback(async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get('/api/files/download', {
        params: { 
          path: file.path,
          inline: 'true'
        },
        responseType: 'blob',
      });

      const blob = response.data;
      const filename = file.name || file.basename;
      const fileType = getFileType(filename);

      if (fileType === 'text') {
        const text = await blob.text();
        setTextContent(text);
      } else {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }

      setLoading(false);
    } catch (err) {
      console.error('Preview load error:', err);
      setError('파일을 불러올 수 없습니다.');
      setLoading(false);
    }
  }, [file]);

  useEffect(() => {
    if (open && file) {
      if (file.canPreview !== false) {
        loadPreview();
      } else {
        setLoading(false);
      }
    } else {
      setPreviewUrl((prevUrl) => {
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }
        return null;
      });
      setTextContent(null);
      setLoading(true);
      setError(null);
    }
  }, [open, file, loadPreview]);

  const getFileType = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
    const textExts = ['txt', 'md', 'json', 'xml', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'py', 'java', 'c', 'cpp', 'h', 'sh'];
    
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (ext === 'pdf') return 'pdf';
    if (textExts.includes(ext)) return 'text';
    
    return 'unknown';
  };

  const handleDownload = () => {
    if (previewUrl) {
      const link = document.createElement('a');
      link.href = previewUrl;
      link.download = file.name || file.basename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const renderPreview = () => {
    // Check if file can be previewed
    if (file && file.canPreview === false) {
      return (
        <Box 
          display="flex" 
          flexDirection="column" 
          justifyContent="center" 
          alignItems="center" 
          minHeight={200}
          gap={2}
          py={4}
        >
          <Typography variant="h6" color="text.secondary">
            미리보기를 지원하지 않는 파일입니다
          </Typography>
          <Typography variant="body2" color="text.secondary">
            파일 형식: {file.name?.split('.').pop()?.toUpperCase() || 'Unknown'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            우측 상단의 다운로드 버튼을 클릭하세요
          </Typography>
        </Box>
      );
    }
    
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <Typography color="error">{error}</Typography>
        </Box>
      );
    }

    const filename = file.name || file.basename;
    const fileType = getFileType(filename);

    switch (fileType) {
      case 'image':
        return (
          <Box
            component="img"
            src={previewUrl}
            alt={file.name}
            sx={{
              maxWidth: '100%',
              maxHeight: '70vh',
              objectFit: 'contain',
              margin: 'auto',
              display: 'block',
            }}
          />
        );

      case 'video':
        return (
          <Box
            component="video"
            controls
            src={previewUrl}
            sx={{
              maxWidth: '100%',
              maxHeight: '70vh',
              margin: 'auto',
              display: 'block',
            }}
          />
        );

      case 'audio':
        return (
          <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={4}>
            <Typography variant="h6">{file.name || file.basename}</Typography>
            <Box
              component="audio"
              controls
              src={previewUrl}
              sx={{ width: '100%', maxWidth: 500 }}
            />
          </Box>
        );

      case 'pdf':
        return (
          <Box
            component="iframe"
            src={previewUrl}
            sx={{
              width: '100%',
              height: '70vh',
              border: 'none',
            }}
          />
        );

      case 'text':
        return (
          <Box
            component="pre"
            sx={{
              maxHeight: '70vh',
              overflow: 'auto',
              backgroundColor: 'grey.100',
              p: 2,
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {textContent}
          </Box>
        );

      default:
        return (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
            <Typography>이 파일 형식은 미리보기를 지원하지 않습니다.</Typography>
          </Box>
        );
    }
  };

  if (!file) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={file?.canPreview === false ? 'sm' : 'lg'}
      fullWidth
      PaperProps={{
        sx: {
          minHeight: file?.canPreview === false ? 'auto' : '80vh',
        },
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" component="div" noWrap sx={{ flex: 1, mr: 2 }}>
            {file.name || file.basename}
          </Typography>
          <Box display="flex" gap={1}>
            <IconButton onClick={handleDownload} size="small" title="다운로드">
              <DownloadIcon />
            </IconButton>
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {renderPreview()}
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;

