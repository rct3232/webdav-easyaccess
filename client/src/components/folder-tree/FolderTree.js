import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, List } from '@mui/material';
import { Home as HomeIcon } from '@mui/icons-material';
import BaseFolderTreeItem from './BaseFolderTreeItem';
import SharedFoldersSection from './SharedFoldersSection';
import RecentFilesSection from './RecentFilesSection';
import ShareLinkSection from './ShareLinkSection';
import useFolderTreeController from './hooks/useFolderTreeController';

const FolderTree = ({
  currentPath,
  onPathClick,
  onFileClick,
  user,
  treeUpdateTrigger,
  hasWritePermission,
  onExplorerDrop,
  onInternalFileDrop,
  onInternalDragStart,
  onInternalDragEnd,
  internalDraggedPath,
  isMobile = false,
  shareLinkSection,
}) => {
  const { t } = useTranslation();
  const {
    homePath,
    expandedPaths,
    onToggleExpand,
    sharedFolders,
    sharedExpanded,
    handleSharedToggle,
    handleSharedClick,
    handleSharedFolderClick,
    buildSharedFolderTree,
    recentExpanded,
    handleRecentToggle,
    handleRecentClick,
    recentFilesList,
  } = useFolderTreeController({ currentPath, user, onPathClick });

  return (
    <Box
      sx={{
        width: isMobile ? '100%' : 240,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      <Box sx={{ flex: 1, overflow: 'auto', px: '5px', pt: isMobile ? 2 : 0 }}>
        <List dense sx={{ py: 1 }}>
          {shareLinkSection && (
            <ShareLinkSection
              shareRootPath={shareLinkSection.shareRootPath}
              shareRootName={shareLinkSection.shareRootName}
              shareToken={shareLinkSection.shareToken}
              currentPath={currentPath}
              onShareLinkPathClick={shareLinkSection.onShareLinkPathClick}
              isMobile={isMobile}
            />
          )}
          {(!shareLinkSection || user) && (
            <>
              <BaseFolderTreeItem
                path={homePath}
                name={user?.is_admin ? t('nav.home') : user?.username || t('nav.home')}
                level={0}
                currentPath={currentPath}
                onPathClick={onPathClick}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
                user={user}
                isHome={true}
                treeUpdateTrigger={treeUpdateTrigger}
                hasWritePermission={true}
                onExplorerDrop={onExplorerDrop}
                onInternalFileDrop={onInternalFileDrop}
                onInternalDragStart={onInternalDragStart}
                onInternalDragEnd={onInternalDragEnd}
                internalDraggedPath={internalDraggedPath}
                isMobile={isMobile}
                icon={<HomeIcon fontSize="small" />}
              />

              <SharedFoldersSection
                sharedFolders={sharedFolders}
                sharedExpanded={sharedExpanded}
                handleSharedToggle={handleSharedToggle}
                handleSharedClick={handleSharedClick}
                currentPath={currentPath}
                buildSharedFolderTree={buildSharedFolderTree}
                handleSharedFolderClick={handleSharedFolderClick}
                expandedPaths={expandedPaths}
                handleToggleExpand={onToggleExpand}
                user={user}
                treeUpdateTrigger={treeUpdateTrigger}
                onExplorerDrop={onExplorerDrop}
                onInternalFileDrop={onInternalFileDrop}
                onInternalDragStart={onInternalDragStart}
                onInternalDragEnd={onInternalDragEnd}
                internalDraggedPath={internalDraggedPath}
                isMobile={isMobile}
              />

              <RecentFilesSection
                recentExpanded={recentExpanded}
                handleRecentToggle={handleRecentToggle}
                handleRecentClick={handleRecentClick}
                currentPath={currentPath}
                recentFilesList={recentFilesList}
                onPathClick={onPathClick}
                onFileClick={onFileClick}
              />
            </>
          )}
        </List>
      </Box>
    </Box>
  );
};

export default FolderTree;
