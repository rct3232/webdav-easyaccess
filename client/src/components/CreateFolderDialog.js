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
import { useResponsive } from '../hooks/useResponsive';

const CreateFolderDialog = ({ open, onClose, onComplete, currentPath, onProgress }) => {
  const { isMobile } = useResponsive();
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
    const finalFolderName = folderName.trim();
    const progressId = `createFolder_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: 'createFolder',
      status: 'preparing',
      progress: 0,
      total: 1,
      current: '',
      name: `"${finalFolderName}" 폴더 생성`,
    };

    try {
      const folderPath = currentPath === '/' 
        ? `/${finalFolderName}` 
        : `${currentPath}/${finalFolderName}`;
      
      if (onProgress) {
        onProgress(progressItem);
        onProgress({
          ...progressItem,
          status: 'processing',
          current: '(0/1) 생성중...',
        });
      }

      await createFolder(folderPath);
      setFolderName('');
      onComplete(folderPath, finalFolderName);

      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'completed',
          progress: 1,
          total: 1,
          current: '완료',
        });
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 3000);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || '폴더 생성에 실패했습니다';
      setError(errorMsg);

      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'error',
          error: errorMsg,
          keepOnError: true,
        });
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
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="sm" 
      fullWidth 
      fullScreen={isMobile}
      disableRestoreFocus
    >
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

