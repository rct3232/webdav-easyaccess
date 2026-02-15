import React, { useState, useEffect, useCallback } from 'react';
import { Box, List } from '@mui/material';
import { normalizePath } from '../../utils/pathUtils';
import BaseFolderTreeItem from './BaseFolderTreeItem';

/**
 * 공유 링크 컨텍스트용 폴더 트리
 * 공유 루트와 하위 폴더만 표시 (읽기 전용)
 */
const ShareLinkFolderTree = ({
  shareRootPath,
  shareRootName,
  shareToken,
  currentPath,
  onPathClick,
  isMobile = false,
}) => {
  const rootPath = normalizePath(shareRootPath || '/');
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));

  const handleToggleExpand = useCallback((path) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  // currentPath 변경 시 해당 경로의 부모들을 확장
  useEffect(() => {
    if (!currentPath || !rootPath || !currentPath.startsWith(rootPath)) return;

    const normRoot = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
    const suffix = currentPath === normRoot ? '' : currentPath.slice(normRoot.length + 1);
    const pathParts = suffix ? suffix.split('/').filter(Boolean) : [];
    const pathsToExpand = new Set([rootPath]);
    let built = normRoot;

    pathParts.forEach((part) => {
      built = built === '/' ? `/${part}` : `${built}/${part}`;
      pathsToExpand.add(built);
    });

    setExpandedPaths(pathsToExpand);
  }, [currentPath, rootPath]);

  const listFilesOptions = shareToken ? { shareToken } : {};

  return (
    <Box
      sx={{
        width: isMobile ? '100%' : 200,
        borderRight: isMobile ? 0 : 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      <Box sx={{ flex: 1, overflow: 'auto', px: '5px', pt: isMobile ? 2 : 2 }}>
        <List dense sx={{ py: 1 }}>
          <BaseFolderTreeItem
            path={rootPath}
            name={shareRootName || '공유 폴더'}
            level={0}
            currentPath={currentPath}
            onPathClick={onPathClick}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
            hasReadPermission={true}
            hasWritePermission={false}
            onExplorerDrop={undefined}
            isMobile={isMobile}
            listFilesOptions={listFilesOptions}
            useHiddenFilesFilter={true}
          />
        </List>
      </Box>
    </Box>
  );
};

export default ShareLinkFolderTree;
