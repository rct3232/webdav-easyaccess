import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, CircularProgress } from '@mui/material';

const FolderShareSection = ({
  loadingAllFolders,
  folderTree,
  isAdminMode,
  startFromUserHome,
  username,
  isShareMode,
  isReviewMode,
  user,
  rootPath,
  renderFolderTreeWrapper,
}) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      {loadingAllFolders ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 4,
          }}
        >
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t('dialogs.loadingFolders')}
          </Typography>
        </Box>
      ) : folderTree.size === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('dialogs.loadingFolders')}
        </Typography>
      ) : (isAdminMode && startFromUserHome && username) ||
        ((isShareMode || isReviewMode) && user && rootPath === `/${user.username}`) ? (
        // 관리자 모드에서 startFromUserHome이 true이거나 공유 모드에서 사용자 홈 디렉토리: 사용자 홈 디렉토리는 표시하지 않고 하위 폴더들만 표시
        (() => {
          const userBaseNode = folderTree.get(rootPath);
          if (!userBaseNode || !userBaseNode.children || userBaseNode.children.length === 0) {
            return (
              <Typography variant="body2" color="text.secondary">
                {t('dialogs.noSubfolders')}
              </Typography>
            );
          }
          return userBaseNode.children.map((child) => (
            <React.Fragment key={child.path}>
              {renderFolderTreeWrapper(child.path, 0)}
            </React.Fragment>
          ));
        })()
      ) : (
        renderFolderTreeWrapper(rootPath, 0)
      )}
    </Box>
  );
};

export default FolderShareSection;
