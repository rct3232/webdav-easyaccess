import React, { useState, useCallback, useRef } from 'react';
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
import { useResponsive } from '../hooks/useResponsive';

// 성공/실패 아이콘 표시용 애니메이션
const popIn = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const UploadDialog = ({ open, onClose, onComplete, currentPath, onUploadStart }) => {
  const { isMobile } = useResponsive();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const filesRef = useRef([]);

  const onDrop = useCallback((acceptedFiles) => {
    setFiles((prev) => {
      const newFiles = [...prev, ...acceptedFiles.map(file => ({ file, status: 'pending', abortController: null }))];
      filesRef.current = newFiles;
      return newFiles;
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const handleRemove = (index) => {
    setFiles((prev) => {
      const newFiles = prev.filter((_, i) => i !== index);
      filesRef.current = newFiles;
      return newFiles;
    });
  };

  const handleCancelFile = useCallback((index) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      const fileItem = newFiles[index];
      
      // pending 상태의 파일만 취소 가능 (abortController가 없어도 됨 - 아직 업로드 시작 전)
      if (fileItem.status === 'pending') {
        if (fileItem.abortController) {
          fileItem.abortController.abort();
        }
        newFiles[index] = { ...fileItem, status: 'cancelled', abortController: null };
      }
      
      filesRef.current = newFiles;
      return newFiles;
    });
  }, []);

  const handleCancelAll = useCallback(() => {
    setFiles((prev) => {
      const newFiles = prev.map((fileItem) => {
        // pending 상태의 파일만 취소
        if (fileItem.status === 'pending') {
          if (fileItem.abortController) {
            fileItem.abortController.abort();
          }
          return { ...fileItem, status: 'cancelled', abortController: null };
        }
        return fileItem;
      });
      filesRef.current = newFiles;
      return newFiles;
    });
  }, []);

  const handleUpload = async () => {
    if (files.length === 0) return;

    // 업로드 시작 시 기존 실패 항목 dismiss
    if (onUploadStart) {
      onUploadStart();
    }

    setUploading(true);
    filesRef.current = [...files];

    try {
      // 현재 경로에 동일 이름이 있는지 사전 확인
      let existingNames = new Set();
      try {
        const existing = await listFiles(currentPath || '/');
        existingNames = new Set(existing.map(item => item.basename || item.name));
      } catch (e) {
        console.error('Failed to fetch existing files before upload:', e);
      }

      for (let i = 0; i < filesRef.current.length; i++) {
        // 최신 상태 확인
        const fileItem = filesRef.current[i];
        
        // 취소된 파일은 스킵
        if (!fileItem || fileItem.status === 'cancelled') {
          continue;
        }

        // AbortController 생성 및 상태 업데이트
        const abortController = new AbortController();
        setFiles((prev) => {
          const newFiles = [...prev];
          if (newFiles[i]) {
            newFiles[i] = {
              ...newFiles[i],
              status: 'uploading',
              errorMessage: '',
              abortController: abortController,
            };
          }
          filesRef.current = newFiles;
          return newFiles;
        });

        // 동일 이름 존재 시 업로드 스킵 및 실패 처리
        if (existingNames.has(fileItem.file.name)) {
          setFiles((prev) => {
            const newFiles = [...prev];
            if (newFiles[i]) {
              newFiles[i] = {
                ...newFiles[i],
                status: 'error',
                errorMessage: '같은 이름의 파일이 이미 존재합니다.',
                abortController: null,
              };
            }
            filesRef.current = newFiles;
            return newFiles;
          });
          continue;
        }

        try {
          await uploadFile(fileItem.file, currentPath, abortController.signal);
          setFiles((prev) => {
            const newFiles = [...prev];
            if (newFiles[i]) {
              newFiles[i] = {
                ...newFiles[i],
                status: 'success',
                errorMessage: '',
                abortController: null,
              };
            }
            filesRef.current = newFiles;
            return newFiles;
          });
          existingNames.add(fileItem.file.name); // 이후 파일에서 중복 방지
        } catch (error) {
          // 취소 에러는 정상적인 취소로 처리
          if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
            setFiles((prev) => {
              const newFiles = [...prev];
              if (newFiles[i]) {
                newFiles[i] = {
                  ...newFiles[i],
                  status: 'cancelled',
                  abortController: null,
                };
              }
              filesRef.current = newFiles;
              return newFiles;
            });
          } else {
            setFiles((prev) => {
              const newFiles = [...prev];
              if (newFiles[i]) {
                newFiles[i] = {
                  ...newFiles[i],
                  status: 'error',
                  errorMessage: error?.response?.data?.error || error?.message || '업로드 실패',
                  abortController: null,
                };
              }
              filesRef.current = newFiles;
              return newFiles;
            });
          }
          console.error('Upload error:', error);
        }
      }

      onComplete();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
      filesRef.current = [];
      setFiles([]);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      onClose();
    }
  };

  // 대기 중인 파일 개수 확인
  const pendingFilesCount = files.filter(f => f.status === 'pending').length;
  const hasPendingFiles = pendingFilesCount > 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
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
            {files.map((fileItem, index) => {
              const isPending = fileItem.status === 'pending';
              const isUploading = fileItem.status === 'uploading';
              const isSuccess = fileItem.status === 'success';
              const isError = fileItem.status === 'error';
              const isCancelled = fileItem.status === 'cancelled';

              return (
                <ListItem
                  key={index}
                  secondaryAction={
                    uploading ? (
                      isSuccess ? (
                        <CheckCircleIcon
                          fontSize="small"
                          color="success"
                          sx={{ animation: `${popIn} 0.3s ease-out` }}
                        />
                      ) : isError ? (
                        <ErrorIcon
                          fontSize="small"
                          color="error"
                          sx={{ animation: `${popIn} 0.3s ease-out` }}
                        />
                      ) : isUploading ? (
                        <CircularProgress size={18} />
                      ) : isCancelled ? (
                        <Typography variant="caption" color="text.secondary">
                          취소됨
                        </Typography>
                      ) : isPending ? (
                        <IconButton 
                          edge="end" 
                          onClick={() => handleCancelFile(index)}
                          size="small"
                        >
                          <CloseIcon />
                        </IconButton>
                      ) : null
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
                      isSuccess ? (
                        <Typography component="span" color="success.main">업로드 완료</Typography>
                      ) : isError ? (
                        <Typography component="span" color="error.main">
                          {fileItem.errorMessage || '업로드 실패'}
                        </Typography>
                      ) : isUploading ? (
                        <Typography component="span" color="text.secondary">업로드 중...</Typography>
                      ) : isCancelled ? (
                        <Typography component="span" color="text.secondary">취소됨</Typography>
                      ) : (
                        <Typography component="span" color="text.secondary">대기 중</Typography>
                      )
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button 
          onClick={uploading ? handleCancelAll : handleClose} 
          disabled={uploading && !hasPendingFiles}
        >
          {uploading ? '전체 취소' : '취소'}
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
