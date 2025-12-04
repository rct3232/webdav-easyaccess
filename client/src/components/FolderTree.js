import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Typography,
  IconButton,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Home as HomeIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import { listFiles } from '../services/fileService';

const FolderTreeItem = ({ 
  path, 
  name, 
  level = 0, 
  currentPath, 
  onPathClick, 
  expandedPaths, 
  onToggleExpand,
  user,
  isHome = false,
  treeUpdateTrigger,
}) => {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const isExpanded = expandedPaths.has(path);
  const isCurrent = currentPath === path;
  const hasChildren = children.length > 0;
  const showExpandIcon = hasChildren || isExpanded || hasLoaded;
  const prevTreeUpdateTriggerRef = useRef(treeUpdateTrigger);

  useEffect(() => {
    if (isExpanded && !hasLoaded && !loading) {
      loadChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, hasLoaded, loading]);

  useEffect(() => {
    if (currentPath && currentPath.startsWith(path + '/') && path !== currentPath) {
      if (!isExpanded) {
        onToggleExpand(path);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, path, isExpanded]);

  useEffect(() => {
    if (treeUpdateTrigger && treeUpdateTrigger !== prevTreeUpdateTriggerRef.current) {
      prevTreeUpdateTriggerRef.current = treeUpdateTrigger;
      
      if (treeUpdateTrigger.type === 'created') {
        const { folderPath, folderName, parentPath } = treeUpdateTrigger;
        if (parentPath === path) {
          setChildren(prev => {
            const exists = prev.some(child => child.path === folderPath);
            if (exists) return prev;
            const newChild = { path: folderPath, name: folderName };
            return [...prev, newChild].sort((a, b) => a.name.localeCompare(b.name));
          });
          if (!isExpanded) {
            onToggleExpand(path);
          }
          setHasLoaded(true);
        }
      } else if (treeUpdateTrigger.type === 'deleted') {
        const { folderPath } = treeUpdateTrigger;
        setChildren(prev => prev.filter(child => child.path !== folderPath));
      } else if (treeUpdateTrigger.type === 'refresh') {
        if (isExpanded || isHome) {
          loadChildren(true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeUpdateTrigger, path, isExpanded, isHome]);

  const loadChildren = async (force = false) => {
    if (loading && !force) return;
    setLoading(true);
    try {
      const data = await listFiles(path);
      const folders = data
        .filter(item => item.type === 'directory')
        .map(item => ({
          path: item.path,
          name: item.basename || item.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setChildren(folders);
      setHasLoaded(true);
    } catch (error) {
      console.error('Failed to load folder children:', error);
      setChildren([]);
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    onPathClick(path);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggleExpand(path);
    if (!isExpanded && children.length === 0) {
      loadChildren();
    }
  };

  return (
    <>
      <ListItem
        disablePadding
        sx={{
          pl: level * 2,
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        <ListItemButton
          onClick={handleClick}
          selected={isCurrent}
          sx={{
            py: 0.5,
            minHeight: 32,
            '&.Mui-selected': {
              backgroundColor: 'primary.light',
              color: 'primary.contrastText',
              '&:hover': {
                backgroundColor: 'primary.main',
              },
              '& .MuiListItemIcon-root': {
                color: 'primary.contrastText',
              },
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>
            {showExpandIcon ? (
              <Box
                component="span"
                onClick={handleToggle}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  width: 20,
                  height: 20,
                  justifyContent: 'center',
                }}
              >
                {loading ? (
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      border: '2px solid',
                      borderColor: 'action.disabled',
                      borderTopColor: 'primary.main',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      '@keyframes spin': {
                        '0%': { transform: 'rotate(0deg)' },
                        '100%': { transform: 'rotate(360deg)' },
                      },
                    }}
                  />
                ) : isExpanded ? (
                  <ExpandMoreIcon fontSize="small" />
                ) : (
                  <ChevronRightIcon fontSize="small" />
                )}
              </Box>
            ) : (
              <Box sx={{ width: 20 }} />
            )}
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            {isHome ? (
              <HomeIcon fontSize="small" />
            ) : isExpanded ? (
              <FolderOpenIcon fontSize="small" />
            ) : (
              <FolderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="body2"
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                {name}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      {hasChildren && (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {children.map((child) => (
              <FolderTreeItem
                key={child.path}
                path={child.path}
                name={child.name}
                level={level + 1}
                currentPath={currentPath}
                onPathClick={onPathClick}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
                user={user}
                treeUpdateTrigger={treeUpdateTrigger}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
};

const FolderTree = ({ currentPath, onPathClick, user, treeUpdateTrigger, onCreateFolder, onUploadFile, selectionMode }) => {
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;

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
    } else {
      setExpandedPaths(new Set([homePath]));
    }
  }, [currentPath, homePath]);

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

  return (
    <Box
      sx={{
        width: 200,
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      <Box
        sx={{
          p: 3,
          display: 'flex',
          gap: 0,
        }}
      >
        <IconButton
          onClick={onCreateFolder}
          title="폴더 만들기"
          sx={{
            flex: 1,
            borderRadius: '20px 0 0 20px',
            backgroundColor: 'white',
            color: 'text.secondary',
            boxShadow: 2,
            '&:hover': {
              backgroundColor: 'grey.100',
              boxShadow: 3,
            },
          }}
        >
          <CreateNewFolderIcon />
        </IconButton>
        <IconButton
          onClick={onUploadFile}
          title="파일 업로드"
          sx={{
            flex: 1,
            borderRadius: '0 20px 20px 0',
            backgroundColor: 'white',
            color: 'text.secondary',
            boxShadow: 2,
            '&:hover': {
              backgroundColor: 'grey.100',
              boxShadow: 3,
            },
          }}
        >
          <UploadIcon />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <List dense sx={{ py: 1 }}>
        {user?.is_admin && homePath === '/' ? (
          <FolderTreeItem
            path="/"
            name="홈"
            level={0}
            currentPath={currentPath}
            onPathClick={onPathClick}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
            user={user}
            isHome={true}
            treeUpdateTrigger={treeUpdateTrigger}
          />
        ) : (
          <FolderTreeItem
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
          />
        )}
        </List>
      </Box>
    </Box>
  );
};

export default FolderTree;
