import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, IconButton, Button } from '@mui/material';
import {
  CreateNewFolder as CreateNewFolderIcon,
  Upload as UploadIcon,
  Login as LoginIcon,
  AddLink as AddLinkIcon,
} from '@mui/icons-material';

const FolderTreeActionBar = ({
  showShareLinkActions = false,
  shareLinkActions,
  onCreateFolder,
  onUploadFile,
  hasWritePermission,
}) => {
  const { t } = useTranslation();
  const shouldShowShareLinkActions = showShareLinkActions && shareLinkActions && (shareLinkActions.onLoginClick || shareLinkActions.onAddToSharedClick);

  return (
    <Box sx={{ p: 3, display: 'flex', gap: 0 }}>
      {shouldShowShareLinkActions ? (
        shareLinkActions.user ? (
          <Button
            onClick={shareLinkActions.onAddToSharedClick}
            startIcon={<AddLinkIcon />}
            sx={{
              flex: 1,
              borderRadius: '20px',
              backgroundColor: 'white',
              color: 'text.secondary',
              boxShadow: 2,
              textTransform: 'none',
              '&:hover': { backgroundColor: 'grey.100', boxShadow: 3 },
            }}
          >
            {t('nav.addToShared')}
          </Button>
        ) : (
          <Button
            onClick={shareLinkActions.onLoginClick}
            startIcon={<LoginIcon />}
            sx={{
              flex: 1,
              borderRadius: '20px',
              backgroundColor: 'white',
              color: 'text.secondary',
              boxShadow: 2,
              textTransform: 'none',
              '&:hover': { backgroundColor: 'grey.100', boxShadow: 3 },
            }}
          >
            {t('nav.login')}
          </Button>
        )
      ) : (
        <>
          <IconButton
            onClick={onCreateFolder}
            disabled={!hasWritePermission}
            title={t('fileManager.createFolder')}
            sx={{
              flex: 1,
              borderRadius: '20px 0 0 20px',
              backgroundColor: 'white',
              color: 'text.secondary',
              boxShadow: 2,
              '&:hover': { backgroundColor: 'grey.100', boxShadow: 3 },
            }}
          >
            <CreateNewFolderIcon />
          </IconButton>
          <IconButton
            onClick={onUploadFile}
            disabled={!hasWritePermission}
            title={t('fileManager.uploadFile')}
            sx={{
              flex: 1,
              borderRadius: '0 20px 20px 0',
              backgroundColor: 'white',
              color: 'text.secondary',
              boxShadow: 2,
              '&:hover': { backgroundColor: 'grey.100', boxShadow: 3 },
            }}
          >
            <UploadIcon />
          </IconButton>
        </>
      )}
    </Box>
  );
};

export default FolderTreeActionBar;
