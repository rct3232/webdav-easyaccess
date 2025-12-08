import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
} from '@mui/material';
import CircularProgress from '@mui/material/CircularProgress';
import { CheckCircle as CheckCircleIcon, ErrorOutline as ErrorIcon } from '@mui/icons-material';
import { keyframes } from '@emotion/react';
import { useDropzone } from 'react-dropzone';
import { Close as CloseIcon } from '@mui/icons-material';
import { uploadFile, listFiles } from '../services/fileService';

// 성공/실패 아이콘 표시용 애니메이션
const popIn = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const UploadDialog = ({ open, onClose, onComplete, currentPath }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles) => {
    setFiles((prev) => [...prev, ...acceptedFiles.map(file => ({ file, status: 'pending' }))]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const handleRemove = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);

    try {
      // 현재 경로에 동일 이름이 있는지 사전 확인
      let existingNames = new Set();
      try {
        const existing = await listFiles(currentPath || '/');
        existingNames = new Set(existing.map(item => item.basename || item.name));
      } catch (e) {
        console.error('Failed to fetch existing files before upload:', e);
      }

      for (let i = 0; i < files.length; i++) {
        const fileItem = files[i];
        fileItem.status = 'uploading';
        fileItem.errorMessage = '';
        setFiles([...files]);

        // 동일 이름 존재 시 업로드 스킵 및 실패 처리
        if (existingNames.has(fileItem.file.name)) {
          fileItem.status = 'error';
          fileItem.errorMessage = '같은 이름의 파일이 이미 존재합니다.';
          setFiles([...files]);
          continue;
        }

        try {
          await uploadFile(fileItem.file, currentPath);
          fileItem.status = 'success';
          fileItem.errorMessage = '';
          existingNames.add(fileItem.file.name); // 이후 파일에서 중복 방지
        } catch (error) {
          fileItem.status = 'error';
          const errMsg = error?.response?.data?.error || error?.message || '업로드 실패';
          fileItem.errorMessage = errMsg;
          console.error('Upload error:', error);
        }
        setFiles([...files]);
      }

      onComplete();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
      setFiles([]);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>파일 업로드</DialogTitle>
      <DialogContent>
        <Box
          {...getRootProps()}
          sx={{
            border: '2px dashed',
            borderColor: isDragActive ? 'primary.main' : 'grey.300',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: isDragActive ? 'action.hover' : 'background.paper',
            mb: 2,
          }}
        >
          <input {...getInputProps()} />
          <Typography variant="body1">
            {isDragActive ? '파일을 여기에 놓으세요' : '파일을 드래그하거나 클릭하여 선택하세요'}
          </Typography>
        </Box>

        {files.length > 0 && (
          <List>
            {files.map((fileItem, index) => (
              <ListItem
                key={index}
                secondaryAction={
                  uploading ? (
                    fileItem.status === 'success' ? (
                      <CheckCircleIcon
                        fontSize="small"
                        color="success"
                        sx={{ animation: `${popIn} 0.3s ease-out` }}
                      />
                    ) : fileItem.status === 'error' ? (
                      <ErrorIcon
                        fontSize="small"
                        color="error"
                        sx={{ animation: `${popIn} 0.3s ease-out` }}
                      />
                    ) : (
                      <CircularProgress size={18} />
                    )
                  ) : (
                    <IconButton 
                      edge="end" 
                      onClick={() => handleRemove(index)}
                      size="small"
                      disabled={uploading}
                    >
                      <CloseIcon />
                    </IconButton>
                  )
                }
              >
                <ListItemText
                  primary={fileItem.file.name}
                  secondary={
                    fileItem.status === 'success' ? (
                      <Typography component="span" color="success.main">업로드 완료</Typography>
                    ) : fileItem.status === 'error' ? (
                      <Typography component="span" color="error.main">
                        {fileItem.errorMessage || '업로드 실패'}
                      </Typography>
                    ) : fileItem.status === 'uploading' ? (
                      <Typography component="span" color="text.secondary">업로드 중...</Typography>
                    ) : (
                      <Typography component="span" color="text.secondary">대기 중</Typography>
                    )
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>
          취소
        </Button>
        <Button
          onClick={handleUpload}
          variant="contained"
          disabled={files.length === 0 || uploading}
        >
          업로드
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UploadDialog;

