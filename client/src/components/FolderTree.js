import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  List,
  IconButton,
} from '@mui/material';
import {
  Home as HomeIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import { getRecentFiles, onRecentFilesChange } from '../utils/recentFiles';
import { normalizePath } from '../utils/pathUtils';
import axios from 'axios';
import BaseFolderTreeItem from './BaseFolderTreeItem';
import SharedFoldersSection from './SharedFoldersSection';
import RecentFilesSection from './RecentFilesSection';

const FolderTree = ({ 
  currentPath, 
  onPathClick, 
  onFileClick,
  user,
  treeUpdateTrigger,
  onCreateFolder,
  onUploadFile,
  hasWritePermission,
  onExplorerDrop,
  isMobile = false,
}) => {
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [sharedFolders, setSharedFolders] = useState([]);
  const [recentFilesList, setRecentFilesList] = useState([]);
  const [sharedExpanded, setSharedExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
  const userBaseFolder = `/${user?.username || ''}`;

  useEffect(() => {
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
  }, []);

  const loadSharedFolders = useCallback(async () => {
    if (!user || !user.id || user.is_admin) return;
    
    try {
      const response = await axios.get(`/api/permissions/user/${user.id}`);
      
      const filtered = response.data.filter(perm => {
        const folderPath = normalizePath(perm.folder_path);
        const normalizedUserBaseFolder = normalizePath(userBaseFolder);
        return !folderPath.startsWith(normalizedUserBaseFolder + '/') && folderPath !== normalizedUserBaseFolder;
      });
      setSharedFolders(filtered);
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolders([]);
    }
  }, [user, userBaseFolder]);

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
        width: isMobile ? '100%' : 200,
        borderRight: isMobile ? 0 : 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      {!isMobile && (
        <Box sx={{ p: 3, display: 'flex', gap: 0 }}>
          <IconButton
            onClick={onCreateFolder}
            disabled={!hasWritePermission}
            title="폴더 생성"
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
            title="파일 업로드"
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
        </Box>
      )}
      <Box sx={{ flex: 1, overflow: 'auto', px: '5px', pt: isMobile ? 2 : 0 }}>
        <List dense sx={{ py: 1 }}>
          <BaseFolderTreeItem
            path={homePath}
            name={user?.is_admin ? '홈' : user?.username || '홈'}
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
        </List>
      </Box>
    </Box>
  );
};

export default FolderTree;
