import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  TextField,
} from '@mui/material';
import { createFolder } from '../../services/fileService';
import BaseDialog from './BaseDialog';
import { useFormState } from '../../hooks/useFormState';
import { validateFileName } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../utils/validationMessage';
import { getServerErrorDisplay } from '../../utils/errorUtils';

const CreateFolderDialog = ({ open, onClose, onComplete, currentPath, onProgress }) => {
  const { t } = useTranslation();
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
          name: `"${finalFolderName}" ${t('fileManager.createFolder')}`,
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
              current: t('fileManager.statusCreatingFolder'),
            });
          }

          await createFolder(currentPath, finalFolderName);
          reset();
          onComplete(folderPath, finalFolderName);

          if (onProgress) {
            onProgress({
              ...progressItem,
              status: 'completed',
              progress: 1,
              total: 1,
              current: t('common.confirm'),
            });
            setTimeout(() => {
              onProgress({ id: progressId, remove: true });
            }, 3000);
          }
        } catch (error) {
          const errorMsg = getServerErrorDisplay(error?.response?.data, t) || t('dialogs.createFolderFail');
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
      title={t('dialogs.createFolderTitle')}
      actions={
        <>
          <Button onClick={handleClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="create-folder-submit" onClick={handleSubmit} variant="contained" disabled={isSubmitting}>
            {t('dialogs.create')}
          </Button>
        </>
      }
    >
        <TextField
          autoFocus
          margin="dense"
          label={t('dialogs.folderName')}
          fullWidth
          variant="outlined"
          value={values.folderName}
          inputProps={{ 'data-testid': 'create-folder-name-input' }}
          onChange={(e) => handleChange('folderName', e.target.value)}
          error={!!getFieldError('folderName')}
          helperText={getValidationMessage(getFieldError('folderName'), t)}
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

