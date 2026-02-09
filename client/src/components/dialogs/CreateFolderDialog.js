import React from 'react';
import {
  Button,
  TextField,
} from '@mui/material';
import { createFolder } from '../../services/fileService';
import BaseDialog from './BaseDialog';
import { useFormState } from '../../hooks/useFormState';
import { validateFileName } from '../../utils/validation';

const CreateFolderDialog = ({ open, onClose, onComplete, currentPath, onProgress }) => {
  const {
    values,
    isSubmitting,
    setValue,
    handleChange,
    handleSubmit,
    reset,
    getFieldError,
  } = useFormState(
    { folderName: '' },
    { folderName: validateFileName },
    {
      onSubmit: async (formValues) => {
        const finalFolderName = formValues.folderName.trim();
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
          reset();
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
          setValue('folderName', values.folderName); // Trigger validation

          if (onProgress) {
            onProgress({
              ...progressItem,
              status: 'error',
              error: errorMsg,
              keepOnError: true,
            });
          }
        }
      },
    }
  );


  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <BaseDialog
      open={open}
      onClose={handleClose}
      title="새 폴더 만들기"
      actions={
        <>
          <Button onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} variant="contained" disabled={isSubmitting}>
            만들기
          </Button>
        </>
      }
    >
        <TextField
          autoFocus
          margin="dense"
          label="폴더 이름"
          fullWidth
          variant="outlined"
          value={values.folderName}
          onChange={(e) => handleChange('folderName', e.target.value)}
          error={!!getFieldError('folderName')}
          helperText={getFieldError('folderName')}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !isSubmitting) {
              handleSubmit(e);
            }
          }}
        />
    </BaseDialog>
  );
};

export default CreateFolderDialog;

