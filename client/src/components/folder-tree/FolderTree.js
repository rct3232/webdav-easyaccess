import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, List } from '@mui/material';
import { Home as HomeIcon } from '@mui/icons-material';
import { getRecentFiles, onRecentFilesChange } from '../../utils/recentFiles';
import { normalizePath } from '../../utils/pathUtils';
import { getUserBaseFolder, filterOutUserOwnFolders } from '../../utils/userUtils';
import { getUserPermissions } from '../../services/permissionService';
import BaseFolderTreeItem from './BaseFolderTreeItem';
import SharedFoldersSection from './SharedFoldersSection';
import RecentFilesSection from './RecentFilesSection';
import ShareLinkSection from './ShareLinkSection';

const FolderTree = ({
  currentPath,
  onPathClick,
  onFileClick,
  user,
  treeUpdateTrigger,
  hasWritePermission,
  onExplorerDrop,
  isMobile = false,
  shareLinkSection,
}) => {
  const { t } = useTranslation();
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [sharedFolders, setSharedFolders] = useState([]);
  const [recentFilesList, setRecentFilesList] = useState([]);
  const [sharedExpanded, setSharedExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const homePath = user?.is_admin ? '/' : getUserBaseFolder(user);

  useEffect(() => {
    if (!user) {
      setRecentFilesList([]);
      return;
    }
    const loadRecentFiles = async () => {
      try {
        const files = await getRecentFiles();
        setRecentFilesList(files);
      } catch (error) {
        console.error('Failed to load recent files:', error);
        setRecentFilesList([]);
      }
    };

    loadRecentFiles();
    const unsubscribe = onRecentFilesChange(() => {
      loadRecentFiles();
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  const loadSharedFolders = useCallback(async () => {
    if (!user || !user.id || user.is_admin) return;

    try {
      const data = await getUserPermissions(user.id);
      const filtered = filterOutUserOwnFolders(data || [], user);
      setSharedFolders(filtered);
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolders([]);
    }
  }, [user]);

  useEffect(() => {
    if (user && user.id && !user.is_admin) {
      loadSharedFolders();
    } else {
      setSharedFolders([]);
    }
  }, [user, loadSharedFolders]);

  const buildSharedFolderTree = () => {
    if (sharedFolders.length === 0) return [];

    const permissionPaths = new Map();
    sharedFolders.forEach(perm => {
      const normalized = normalizePath(perm.folder_path);
      permissionPaths.set(normalized, perm);
    });

    const pathMap = new Map();
    permissionPaths.forEach((perm, normalizedPath) => {
      const parts = normalizedPath.split('/').filter(Boolean);
      const name = parts[parts.length - 1] || normalizedPath;
      let parentPath = null;

      for (let i = parts.length - 1; i > 0; i--) {
        const parentCandidate = '/' + parts.slice(0, i).join('/');
        if (permissionPaths.has(parentCandidate)) {
          parentPath = parentCandidate;
          break;
        }
      }

      pathMap.set(normalizedPath, {
        path: normalizedPath,
        name: name,
        children: [],
        parentPath: parentPath,
        permission: perm.permission,
        hasReadPermission: true
      });
    });

    const buildTree = (parentPath) => {
      const children = [];
      pathMap.forEach((node, path) => {
        if (node.parentPath === parentPath) {
          const childNode = {
            ...node,
            children: buildTree(path)
          };
          children.push(childNode);
        }
      });
      return children.sort((a, b) => a.name.localeCompare(b.name));
    };

    return buildTree(null);
  };

  useEffect(() => {
    if (currentPath) {
      const paths = currentPath.split('/').filter(Boolean);
      const pathsToExpand = new Set();
      let current = '';

      paths.forEach((part) => {
        current = current ? `${current}/${part}` : `/${part}`;
        pathsToExpand.add(current);
      });

      pathsToExpand.add(homePath);
      setExpandedPaths(pathsToExpand);

      if (currentPath === '/__shared__') {
        setSharedExpanded(true);
      } else {
        const isSharedPath = sharedFolders.some(perm => currentPath.startsWith(perm.folder_path));
        if (isSharedPath) {
          setSharedExpanded(true);
        }
      }

      if (currentPath === '/__recent__') {
        setRecentExpanded(true);
      }
    } else {
      setExpandedPaths(new Set([homePath]));
    }
  }, [currentPath, homePath, sharedFolders]);

  const handleToggleExpand = useCallback((path) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  const handleSharedToggle = (e) => {
    e.stopPropagation();
    const newExpanded = !sharedExpanded;
    setSharedExpanded(newExpanded);
    if (newExpanded) {
      onPathClick('/__shared__');
    }
  };

  const handleRecentToggle = (e) => {
    e.stopPropagation();
    setRecentExpanded(prev => !prev);
  };

  const handleSharedClick = () => {
    onPathClick('/__shared__');
  };

  const handleRecentClick = () => {
    onPathClick('/__recent__');
  };

  const handleSharedFolderClick = (folderPath) => {
    onPathClick(folderPath);
  };

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
                onToggleExpand={handleToggleExpand}
                user={user}
                isHome={true}
                treeUpdateTrigger={treeUpdateTrigger}
                hasWritePermission={true}
                onExplorerDrop={onExplorerDrop}
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
                handleToggleExpand={handleToggleExpand}
                user={user}
                treeUpdateTrigger={treeUpdateTrigger}
                onExplorerDrop={onExplorerDrop}
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
