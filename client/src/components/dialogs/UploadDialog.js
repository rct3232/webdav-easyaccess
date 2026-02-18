import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { Close as CloseIcon } from '@mui/icons-material';
import BaseDialog from './BaseDialog';

const UploadDialog = ({ open, onClose, currentPath, onUploadStart }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState([]);

  const onDrop = useCallback((acceptedFiles) => {
    setFiles((prev) => {
      const newFiles = [...prev, ...acceptedFiles.map(file => ({ file }))];
      return newFiles;
    });
  }, []);

  // 다이얼로그가 닫힐 때 파일 목록 초기화
  useEffect(() => {
    if (!open) {
      setFiles([]);
    }
  }, [open]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const handleRemove = (index) => {
    setFiles((prev) => {
      const newFiles = prev.filter((_, i) => i !== index);
      return newFiles;
    });
  };

  const handleUpload = () => {
    if (files.length === 0) return;

    // 업로드 시작 시 기존 실패 항목 dismiss
    if (onUploadStart) {
      onUploadStart();
    }

    // 선택된 파일 목록을 콜백으로 전달하고 다이얼로그 닫기
    const fileList = files.map(item => item.file);
    if (onUploadStart) {
      onUploadStart(fileList, currentPath);
    }
    
    setFiles([]);
    onClose();
  };

  const handleClose = () => {
    setFiles([]);
    onClose();
  };

  return (
    <BaseDialog
      open={open}
      onClose={handleClose}
      title={t('dialogs.uploadTitle')}
      actions={
        <>
          <Button onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleUpload} variant="contained" disabled={files.length === 0}>
            {t('dialogs.upload')}
          </Button>
        </>
      }
    >
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
          {isDragActive ? t('dialogs.uploadDropHere') : t('dialogs.uploadDropOrClick')}
        </Typography>
      </Box>

      {files.length > 0 && (
        <List>
          {files.map((fileItem, index) => (
            <ListItem
              key={index}
              secondaryAction={
                <IconButton 
                  edge="end" 
                  onClick={() => handleRemove(index)}
                  size="small"
                >
                  <CloseIcon />
                </IconButton>
              }
            >
              <ListItemText
                primary={fileItem.file.name}
                secondary={`${(fileItem.file.size / 1024 / 1024).toFixed(2)} MB`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </BaseDialog>
  );
};

export default UploadDialog;
