import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, List } from '@mui/material';
import { Home as HomeIcon } from '@mui/icons-material';
import BaseFolderTreeItem from './BaseFolderTreeItem';
import SharedFoldersSection from './SharedFoldersSection';
import RecentFilesSection from './RecentFilesSection';
import ShareLinkSection from './ShareLinkSection';
import useFolderTreeController from './hooks/useFolderTreeController';

const EMPTY_ANCESTORS = [];

const FolderTree = ({
  currentNodeId,
  currentPath = '',
  onNodeClick,
  onLeaveShareClick,
  onFileClick,
  user,
  treeUpdateTrigger,
  onExplorerDrop,
  onInternalFileDrop,
  onInternalDragStart,
  onInternalDragEnd,
  internalDraggedNodeId,
  isMobile = false,
  shareLinkSection,
  ancestors = EMPTY_ANCESTORS,
}) => {
  const { t } = useTranslation();
  // In share-link mode the home/shared/recent sections are outside the shared scope:
  // route their clicks through onLeaveShareClick so the host can open the leave-share
  // confirmation. The share-link section keeps onNodeClick (in-scope navigation).
  const nonShareOnNodeClick = shareLinkSection ? (onLeaveShareClick || onNodeClick) : onNodeClick;
  const {
    homeNodeId,
    expandedNodeIds,
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
  } = useFolderTreeController({ currentNodeId, currentPath, user, onNodeClick: nonShareOnNodeClick, ancestors });

  return (
    <Box
      data-testid="folder-tree"
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
              shareRootNodeId={shareLinkSection.shareRootNodeId}
              shareRootPath={shareLinkSection.shareRootPath}
              shareRootName={shareLinkSection.shareRootName}
              shareToken={shareLinkSection.shareToken}
              currentNodeId={currentNodeId}
              onNodeClick={onNodeClick}
              isMobile={isMobile}
            />
          )}
          {(!shareLinkSection || user) && (
            <>
              <BaseFolderTreeItem
                node={{ nodeId: homeNodeId, name: user?.is_admin ? t('nav.home') : user?.username || t('nav.home') }}
                path={undefined}
                name={user?.is_admin ? t('nav.home') : user?.username || t('nav.home')}
                level={0}
                currentNodeId={currentNodeId}
                onNodeClick={nonShareOnNodeClick}
                expandedNodeIds={expandedNodeIds}
                onToggleExpand={onToggleExpand}
                user={user}
                isHome={true}
                treeUpdateTrigger={treeUpdateTrigger}
                hasWritePermission={true}
                onExplorerDrop={onExplorerDrop}
                onInternalFileDrop={onInternalFileDrop}
                onInternalDragStart={onInternalDragStart}
                onInternalDragEnd={onInternalDragEnd}
                internalDraggedNodeId={internalDraggedNodeId}
                isMobile={isMobile}
                icon={<HomeIcon fontSize="small" />}
              />

              <SharedFoldersSection
                sharedFolders={sharedFolders}
                sharedExpanded={sharedExpanded}
                handleSharedToggle={handleSharedToggle}
                handleSharedClick={handleSharedClick}
                currentNodeId={currentNodeId}
                buildSharedFolderTree={buildSharedFolderTree}
                onNodeClick={handleSharedFolderClick}
                expandedNodeIds={expandedNodeIds}
                onToggleExpand={onToggleExpand}
                user={user}
                treeUpdateTrigger={treeUpdateTrigger}
                onExplorerDrop={onExplorerDrop}
                onInternalFileDrop={onInternalFileDrop}
                onInternalDragStart={onInternalDragStart}
                onInternalDragEnd={onInternalDragEnd}
                internalDraggedNodeId={internalDraggedNodeId}
                isMobile={isMobile}
              />

              <RecentFilesSection
                recentExpanded={recentExpanded}
                handleRecentToggle={handleRecentToggle}
                handleRecentClick={handleRecentClick}
                currentPath={currentPath}
                recentFilesList={recentFilesList}
                onNodeClick={nonShareOnNodeClick}
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
