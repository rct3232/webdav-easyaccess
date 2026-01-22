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
  Share as ShareIcon,
} from '@mui/icons-material';
import { listFiles } from '../services/fileService';
import { useExplorerDragAndDrop } from '../hooks/useExplorerDragAndDrop';
import axios from 'axios';
import { FileTreeSkeleton } from './FileSkeletons';

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
  hasReadPermission = true, // 권한 정보 (기본값: true)
  hasWritePermission = true, // 쓰기 권한 정보
  onExplorerDrop,
  isMobile = false,
}) => {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const isExpanded = expandedPaths.has(path);
  const isCurrent = currentPath === path;
  const hasChildren = children.length > 0;
  const showExpandIcon = hasChildren || isExpanded || hasLoaded;
  const prevTreeUpdateTriggerRef = useRef(treeUpdateTrigger);
  const isDisabled = hasReadPermission === false;

  const {
    isDraggingOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useExplorerDragAndDrop();

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
          hasReadPermission: item.hasReadPermission,
          hasWritePermission: item.hasWritePermission,
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
    // 권한이 없는 경우 클릭하지 않음
    if (isDisabled) {
      return;
    }
    onPathClick(path);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggleExpand(path);
    if (!isExpanded && children.length === 0) {
      loadChildren();
    }
  };

  const handleFolderDragOver = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleDragOver(e);
      setIsDropTarget(true);
    }
  };

  const handleFolderDragEnter = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleDragEnter(e);
      setIsDropTarget(true);
    }
  };

  const handleFolderDragLeave = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleDragLeave(e);
      setIsDropTarget(false);
    }
  };

  const handleFolderDrop = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal && onExplorerDrop) {
      handleDrop(e, path, onExplorerDrop);
      setIsDropTarget(false);
    }
  };

  return (
    <>
      <ListItem
        disablePadding
        sx={{
          '&:hover': {
            backgroundColor: isDisabled ? 'transparent' : ((isDropTarget || isDraggingOver) && hasWritePermission ? 'transparent' : 'action.hover'),
          },
        }}
        onDragEnter={isMobile ? undefined : handleFolderDragEnter}
        onDragOver={isMobile ? undefined : handleFolderDragOver}
        onDragLeave={isMobile ? undefined : handleFolderDragLeave}
        onDrop={isMobile ? undefined : handleFolderDrop}
      >
        <ListItemButton
          onClick={handleClick}
          selected={isCurrent && !isDisabled}
          disabled={isDisabled}
          sx={{
            py: 0.5,
            minHeight: 32,
            pl: level * 2,
            opacity: isDisabled ? 0.4 : 1,
            backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'primary.main' : 'transparent',
            transition: 'all 0.2s',
            ...((isDropTarget || isDraggingOver) && hasWritePermission && {
              color: 'white',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '& .MuiListItemIcon-root': {
                color: 'white',
              },
              '& .MuiTypography-root': {
                color: 'white',
              },
            }),
            '&.Mui-selected': {
              backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'primary.main' : 'transparent',
              color: (isDropTarget || isDraggingOver) && hasWritePermission ? 'white' : 'primary.main',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '&:hover': {
                backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'primary.main' : 'action.hover',
              },
              '& .MuiListItemIcon-root': {
                color: (isDropTarget || isDraggingOver) && hasWritePermission ? 'white' : 'primary.main',
              },
            },
            '&.Mui-disabled': {
              cursor: 'not-allowed',
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
                  fontWeight: isCurrent ? 700 : 400,
                }}
              >
                {name}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      {(hasChildren || loading) && (
        <Collapse in={isExpanded && (hasChildren || loading)} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {loading && !hasChildren ? (
              <FileTreeSkeleton level={level + 1} count={3} />
            ) : (
              children.map((child) => (
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
                  hasReadPermission={child.hasReadPermission}
                  hasWritePermission={child.hasWritePermission}
                  onExplorerDrop={onExplorerDrop}
                  isMobile={isMobile}
                />
              ))
            )}
          </List>
        </Collapse>
      )}
    </>
  );
};

const FolderTree = ({ currentPath, onPathClick, user, treeUpdateTrigger, onCreateFolder, onUploadFile, selectionMode, hasWritePermission, onExplorerDrop, isMobile = false }) => {
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [sharedFolders, setSharedFolders] = useState([]);
  const [sharedExpanded, setSharedExpanded] = useState(false);
  const homePath = user?.is_admin ? '/' : `/${user?.username || ''}`;
  const userBaseFolder = `/${user?.username || ''}`;

  useEffect(() => {
    if (user && user.id && !user.is_admin) {
      loadSharedFolders();
    } else {
      // 관리자는 공유됨 폴더 트리를 로드하지 않음
      setSharedFolders([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadSharedFolders = async () => {
    if (!user || !user.id || user.is_admin) return;
    
    try {
      const response = await axios.get(`/api/permissions/user/${user.id}`);
      // 자기 자신의 폴더 및 그 하위 모든 디렉토리는 제외
      // 경로 정규화 함수 (끝의 / 제거)
      const normalizePath = (path) => {
        if (!path || path === '/') return '/';
        return path.endsWith('/') ? path.slice(0, -1) : path;
      };
      
      const filtered = response.data.filter(perm => {
        const folderPath = normalizePath(perm.folder_path);
        const normalizedUserBaseFolder = normalizePath(userBaseFolder);
        // 사용자 기본 폴더로 시작하지 않는 경로만 포함
        // 예: /user1/subfolder 는 제외, /other/shared 는 포함
        return !folderPath.startsWith(normalizedUserBaseFolder + '/') && folderPath !== normalizedUserBaseFolder;
      });
      setSharedFolders(filtered);
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolders([]);
    }
  };

  // 공유된 폴더들을 트리 구조로 변환
  // 직접 권한이 부여된 경로만 표시 (중간 경로는 생성하지 않음)
  const buildSharedFolderTree = () => {
    if (sharedFolders.length === 0) return [];

    // 경로 정규화 함수 (끝의 / 제거)
    const normalizePath = (path) => {
      if (!path || path === '/') return '/';
      return path.endsWith('/') ? path.slice(0, -1) : path;
    };
    
    // 권한이 직접 부여된 경로만 사용 (정규화된 경로로 저장)
    const permissionPaths = new Map();
    sharedFolders.forEach(perm => {
      const normalized = normalizePath(perm.folder_path);
      permissionPaths.set(normalized, perm);
    });
    
    // 경로를 기반으로 트리 구조 생성 (직접 권한이 있는 경로만)
    const pathMap = new Map();
    
    permissionPaths.forEach((perm, normalizedPath) => {
      const parts = normalizedPath.split('/').filter(Boolean);
      const name = parts[parts.length - 1] || normalizedPath;
      let parentPath = null;
      
      // 부모 경로 찾기 (직접 권한이 있는 가장 가까운 상위 경로)
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
        hasReadPermission: true // 직접 권한이 있는 경로는 항상 true
      });
    });
    
    // 트리 구조 구성
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
    
    // 루트부터 시작 (null은 루트의 직접 자식들을 의미)
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
      
      // 공유된 폴더 경로인지 확인 또는 공유됨 뷰인지 확인
      if (currentPath === '/__shared__') {
        setSharedExpanded(true);
      } else {
        const isSharedPath = sharedFolders.some(perm => currentPath.startsWith(perm.folder_path));
        if (isSharedPath) {
          setSharedExpanded(true);
        }
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

  const handleSharedClick = () => {
    // 공유됨 클릭 시 경로로 이동 (홈 트리와 동일하게)
    onPathClick('/__shared__');
  };

  const handleSharedToggle = (e) => {
    e.stopPropagation();
    const newExpanded = !sharedExpanded;
    setSharedExpanded(newExpanded);
    // 공유됨을 처음 확장할 때 특별한 경로로 설정하여 공유된 폴더 목록 표시
    if (newExpanded) {
      onPathClick('/__shared__');
    }
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
        <Box
          sx={{
            p: 3,
            display: 'flex',
            gap: 0,
          }}
        >
          <IconButton
            onClick={onCreateFolder}
            disabled={!hasWritePermission}
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
            disabled={!hasWritePermission}
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
      )}
      <Box sx={{ flex: 1, overflow: 'auto', px: '5px', pt: isMobile ? 2 : 0 }}>
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
            hasWritePermission={true}
            onExplorerDrop={onExplorerDrop}
            isMobile={isMobile}
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
            hasWritePermission={true}
            onExplorerDrop={onExplorerDrop}
            isMobile={isMobile}
          />
        )}
        
        {/* 공유된 폴더 섹션 - 관리자는 표시하지 않음 */}
        {!user?.is_admin && sharedFolders.length > 0 && (
          <>
            <ListItem
              disablePadding
              sx={{
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <ListItemButton
                onClick={handleSharedClick}
                selected={currentPath === '/__shared__'}
                sx={{
                  py: 0.5,
                  minHeight: 32,
                  pl: 0,
                  transition: 'all 0.2s',
                  '&.Mui-selected': {
                    backgroundColor: 'transparent',
                    color: 'primary.main',
                    borderLeft: '3px solid',
                    borderLeftColor: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                    '& .MuiListItemIcon-root': {
                      color: 'primary.main',
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>
                  <Box
                    component="span"
                    onClick={handleSharedToggle}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      width: 20,
                      height: 20,
                      justifyContent: 'center',
                    }}
                  >
                    {sharedExpanded ? (
                      <ExpandMoreIcon fontSize="small" />
                    ) : (
                      <ChevronRightIcon fontSize="small" />
                    )}
                  </Box>
                </ListItemIcon>
                <ListItemIcon sx={{ minWidth: 24 }}>
                  <ShareIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: '0.875rem',
                        fontWeight: currentPath === '/__shared__' ? 700 : 400,
                      }}
                    >
                      공유됨
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>
            <Collapse in={sharedExpanded} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {(() => {
                  const sharedTree = buildSharedFolderTree();
                  const sharedFoldersMap = new Map(sharedFolders.map(perm => [perm.folder_path, perm]));
                  
                  return sharedTree.map((node) => (
                    <SharedFolderTreeItem
                      key={node.path}
                      node={node}
                      level={1}
                      currentPath={currentPath}
                      onPathClick={handleSharedFolderClick}
                      expandedPaths={expandedPaths}
                      onToggleExpand={handleToggleExpand}
                      user={user}
                      treeUpdateTrigger={treeUpdateTrigger}
                      sharedFoldersMap={sharedFoldersMap}
                      onExplorerDrop={onExplorerDrop}
                      isMobile={isMobile}
                    />
                  ));
                })()}
              </List>
            </Collapse>
          </>
        )}
        </List>
      </Box>
    </Box>
  );
};

// 공유된 폴더 트리 아이템 (재귀적 렌더링 + lazy loading)
const SharedFolderTreeItem = ({ 
  node, 
  level = 0, 
  currentPath, 
  onPathClick, 
  expandedPaths, 
  onToggleExpand,
  user,
  treeUpdateTrigger,
  sharedFoldersMap, // 권한이 있는 폴더들의 Map
  onExplorerDrop,
  isMobile = false,
}) => {
  const [children, setChildren] = useState(node.children || []);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(node.children && node.children.length > 0);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const isExpanded = expandedPaths.has(node.path);
  const isCurrent = currentPath === node.path;
  const hasChildren = children.length > 0;
  const showExpandIcon = hasChildren || isExpanded || hasLoaded;
  
  // 현재 노드의 권한 확인
  let hasPermission = false;
  let hasWritePermission = false;
  
  if (node.hasReadPermission !== undefined) {
    // 서버에서 반환한 권한 정보 사용
    hasPermission = node.hasReadPermission === true;
  } else if (sharedFoldersMap) {
    // sharedFoldersMap에 있으면 권한 있음 (직접 권한이 부여된 최상위 폴더)
    hasPermission = sharedFoldersMap.has(node.path) || sharedFoldersMap.has(node.path + '/');
  }
  
  if (node.hasWritePermission !== undefined) {
    hasWritePermission = node.hasWritePermission === true;
  } else if (sharedFoldersMap) {
    const perm = sharedFoldersMap.get(node.path) || sharedFoldersMap.get(node.path + '/');
    hasWritePermission = perm && perm.permission === 'write';
  }
  
  const isDisabled = !hasPermission;

  const {
    isDraggingOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useExplorerDragAndDrop();

  useEffect(() => {
    if (isExpanded && !hasLoaded && !loading) {
      loadChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, hasLoaded, loading]);

  useEffect(() => {
    if (currentPath && currentPath.startsWith(node.path + '/') && node.path !== currentPath) {
      if (!isExpanded) {
        onToggleExpand(node.path);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, node.path, isExpanded]);

  const loadChildren = async (force = false) => {
    if (loading && !force) return;
    setLoading(true);
    try {
      const data = await listFiles(node.path);
      // 모든 디렉토리 표시 (직접 권한이 없는 디렉토리는 비활성화 상태로 표시)
      const folders = data
        .filter(item => item.type === 'directory')
        .map(item => {
          // 서버에서 반환한 권한 정보 사용
          const hasReadPermission = item.hasReadPermission === true;
          
          return {
            path: item.path,
            name: item.basename || item.name,
            hasReadPermission,
          };
        })
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
    // 권한이 없는 경우 클릭하지 않음
    if (isDisabled) {
      return;
    }
    onPathClick(node.path);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggleExpand(node.path);
    if (!isExpanded && children.length === 0) {
      loadChildren();
    }
  };

  const handleFolderDragOver = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleDragOver(e);
      setIsDropTarget(true);
    }
  };

  const handleFolderDragEnter = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleDragEnter(e);
      setIsDropTarget(true);
    }
  };

  const handleFolderDragLeave = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal) {
      handleDragLeave(e);
      setIsDropTarget(false);
    }
  };

  const handleFolderDrop = (e) => {
    if (isDisabled || !hasWritePermission) return;
    
    const types = e.dataTransfer.types;
    const isExternal = types && types.includes('Files');
    
    if (isExternal && onExplorerDrop) {
      handleDrop(e, node.path, onExplorerDrop);
      setIsDropTarget(false);
    }
  };

  return (
    <>
      <ListItem
        disablePadding
        sx={{
          '&:hover': {
            backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'transparent' : 'action.hover',
          },
        }}
        onDragEnter={isMobile ? undefined : handleFolderDragEnter}
        onDragOver={isMobile ? undefined : handleFolderDragOver}
        onDragLeave={isMobile ? undefined : handleFolderDragLeave}
        onDrop={isMobile ? undefined : handleFolderDrop}
      >
        <ListItemButton
          onClick={handleClick}
          selected={isCurrent}
          disabled={isDisabled}
          sx={{
            py: 0.5,
            minHeight: 32,
            pl: level * 2,
            opacity: isDisabled ? 0.5 : 1,
            backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'primary.main' : 'transparent',
            transition: 'all 0.2s',
            ...((isDropTarget || isDraggingOver) && hasWritePermission && {
              color: 'white',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '& .MuiListItemIcon-root': {
                color: 'white',
              },
              '& .MuiTypography-root': {
                color: 'white',
              },
            }),
            '&.Mui-selected': {
              backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'primary.main' : 'transparent',
              color: (isDropTarget || isDraggingOver) && hasWritePermission ? 'white' : 'primary.main',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '&:hover': {
                backgroundColor: (isDropTarget || isDraggingOver) && hasWritePermission ? 'primary.main' : 'action.hover',
              },
              '& .MuiListItemIcon-root': {
                color: (isDropTarget || isDraggingOver) && hasWritePermission ? 'white' : 'primary.main',
              },
            },
            '&.Mui-disabled': {
              opacity: 0.5,
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
            {isExpanded ? (
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
                  fontWeight: isCurrent ? 700 : 400,
                }}
              >
                {node.name}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>
      {(hasChildren || loading) && (
        <Collapse in={isExpanded && (hasChildren || loading)} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {loading && !hasChildren ? (
              <FileTreeSkeleton level={level + 1} count={3} />
            ) : (
              children.map((child) => {
                // child가 이미 노드 구조인지 확인
                const childNode = typeof child === 'object' && child.path 
                  ? child 
                  : { path: child.path || child, name: child.name || child.path?.split('/').filter(Boolean).pop() || child, children: [] };
                
                // 권한 정보 포함 - 서버에서 반환한 권한 정보 사용
                if (child.hasReadPermission !== undefined) {
                  childNode.hasReadPermission = child.hasReadPermission === true;
                } else {
                  childNode.hasReadPermission = false;
                }
                
                return (
                  <SharedFolderTreeItem
                    key={childNode.path}
                    node={childNode}
                    level={level + 1}
                    currentPath={currentPath}
                    onPathClick={onPathClick}
                    expandedPaths={expandedPaths}
                    onToggleExpand={onToggleExpand}
                    user={user}
                    treeUpdateTrigger={treeUpdateTrigger}
                    sharedFoldersMap={sharedFoldersMap}
                    onExplorerDrop={onExplorerDrop}
                    isMobile={isMobile}
                  />
                );
              })
            )}
          </List>
        </Collapse>
      )}
    </>
  );
};

export default FolderTree;
