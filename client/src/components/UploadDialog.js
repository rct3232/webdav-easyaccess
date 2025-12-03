import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  IconButton,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { Close as CloseIcon } from '@mui/icons-material';
import { uploadFile } from '../services/fileService';

const UploadDialog = ({ open, onClose, onComplete, currentPath }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({});

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
    const newProgress = {};

    try {
      for (let i = 0; i < files.length; i++) {
        const fileItem = files[i];
        newProgress[fileItem.file.name] = 0;
        setProgress({ ...newProgress });

        try {
          await uploadFile(fileItem.file, currentPath);
          fileItem.status = 'success';
          newProgress[fileItem.file.name] = 100;
        } catch (error) {
          fileItem.status = 'error';
          console.error('Upload error:', error);
        }
        
        setProgress({ ...newProgress });
        setFiles([...files]);
      }

      onComplete();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
      setFiles([]);
      setProgress({});
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setProgress({});
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
                  fileItem.status !== 'uploading' && (
                    <IconButton edge="end" onClick={() => handleRemove(index)}>
                      <CloseIcon />
                    </IconButton>
                  )
                }
              >
                <ListItemText
                  primary={fileItem.file.name}
                  secondary={
                    fileItem.status === 'success' ? (
                      <Typography color="success.main">업로드 완료</Typography>
                    ) : fileItem.status === 'error' ? (
                      <Typography color="error.main">업로드 실패</Typography>
                    ) : (
                      <LinearProgress
                        variant="determinate"
                        value={progress[fileItem.file.name] || 0}
                        sx={{ mt: 1 }}
                      />
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

