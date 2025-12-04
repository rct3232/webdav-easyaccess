import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from '@mui/material';
import { createFolder } from '../services/fileService';

const CreateFolderDialog = ({ open, onClose, onComplete, currentPath, onMessage }) => {
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!folderName.trim()) {
      setError('폴더 이름을 입력하세요');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const folderPath = currentPath === '/' 
        ? `/${folderName}` 
        : `${currentPath}/${folderName}`;
      
      await createFolder(folderPath);
      setFolderName('');
      onComplete();
      
      // Show success toast message
      if (onMessage) {
        onMessage({
          show: true,
          text: `"${folderName}" 폴더를 생성했습니다`,
          type: 'success'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 3000);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || '폴더 생성에 실패했습니다';
      setError(errorMsg);
      
      // Show error toast message
      if (onMessage) {
        onMessage({
          show: true,
          text: errorMsg,
          type: 'error'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFolderName('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>새 폴더 만들기</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="폴더 이름"
          fullWidth
          variant="outlined"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          error={!!error}
          helperText={error}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !loading) {
              handleCreate();
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          취소
        </Button>
        <Button onClick={handleCreate} variant="contained" disabled={loading}>
          만들기
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateFolderDialog;

