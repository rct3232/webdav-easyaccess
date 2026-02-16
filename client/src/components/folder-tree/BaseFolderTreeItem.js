import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Typography,
  List,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { listFiles } from '../../services/fileService';
import { useDropToUpload } from '../../hooks/useDropToUpload';
import { getShowHiddenFiles } from '../../utils/localStorage';
import { FileTreeSkeleton } from '../file-manager/FileSkeletons';

/**
 * 통합된 폴더 트리 아이템 컴포넌트
 * BaseFolderTreeItem과 SharedFolderTreeItem의 기능을 모두 지원
 *
 * @param {string} path - 폴더 경로 (node가 없을 때 사용)
 * @param {string} name - 폴더 이름 (node가 없을 때 사용)
 * @param {object} node - 폴더 노드 객체 (path, name 포함)
 * @param {boolean} useHiddenFilesFilter - 숨김 파일 필터링 사용 여부 (기본값: true)
 * @param {Map} sharedFoldersMap - 공유 폴더 맵 (SharedFolderTree용)
 */
const BaseFolderTreeItem = ({
  // path/name 또는 node 지원
  path: pathProp,
  name: nameProp,
  node,
  level = 0,
  currentPath,
  onPathClick,
  expandedPaths,
  onToggleExpand,
  hasReadPermission: hasReadPermissionProp = true,
  hasWritePermission: hasWritePermissionProp = true,
  onExplorerDrop,
  isMobile = false,
  icon,
  openIcon,
  children: initialChildren = [],
  treeUpdateTrigger,
  isHome = false,
  renderChild,
  isHidden: isHiddenProp = false,
  // 추가 props for SharedFolderTreeItem compatibility
  user,
  sharedFoldersMap,
  useHiddenFilesFilter = true,
  listFilesOptions,
  filterChildNames,
}) => {
  // path/name 또는 node에서 값 추출
  const path = pathProp || node?.path;
  const name = nameProp || node?.name;
  const isHidden = isHiddenProp || node?.isHidden || false;

  // 권한 계산 - sharedFoldersMap이 있으면 그것을 사용
  let hasReadPermission = hasReadPermissionProp;
  let hasWritePermission = hasWritePermissionProp;

  if (node?.hasReadPermission !== undefined) {
    hasReadPermission = node.hasReadPermission === true;
  } else if (sharedFoldersMap) {
    hasReadPermission = sharedFoldersMap.has(path) || sharedFoldersMap.has(path + '/');
  }

  if (node?.hasWritePermission !== undefined) {
    hasWritePermission = node.hasWritePermission === true;
  } else if (sharedFoldersMap) {
    const perm = sharedFoldersMap.get(path) || sharedFoldersMap.get(path + '/');
    hasWritePermission = perm && perm.permission === PERMISSIONS.WRITE;
  }

  const nodeChildren = node?.children || initialChildren;
  const [children, setChildren] = useState(nodeChildren);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(nodeChildren.length > 0);
  const isExpanded = expandedPaths.has(path);
  const isCurrent = currentPath === path;
  const hasChildren = children.length > 0;
  const showExpandIcon = hasChildren || isExpanded || hasLoaded;
  const prevTreeUpdateTriggerRef = useRef(treeUpdateTrigger);
  const isDisabled = hasReadPermission === false;

  // 드래그앤드롭 핸들러
  const {
    isDropTarget,
    isDraggingOver,
    handleFolderDragOver,
    handleFolderDragEnter,
    handleFolderDragLeave,
    handleFolderDrop,
  } = useDropToUpload({
    path,
    isDisabled,
    hasWritePermission,
    onExplorerDrop,
  });

  const loadChildren = useCallback(async (force = false) => {
    if (loading && !force) return;
    setLoading(true);
    try {
      const data = await listFiles(path, listFilesOptions || {});
      const showHiddenFiles = useHiddenFilesFilter ? getShowHiddenFiles() : true;
      let folders = data
        .filter(item => item.type === 'directory')
        .filter(item => showHiddenFiles || !item.isHidden)
        .map(item => ({
          path: item.path,
          name: item.basename || item.name,
          hasReadPermission: item.hasReadPermission,
          hasWritePermission: item.hasWritePermission,
          isHidden: item.isHidden,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (filterChildNames && filterChildNames.length > 0) {
        const set = new Set(filterChildNames);
        folders = folders.filter(f => !set.has(f.name));
      }
      setChildren(folders);
      setHasLoaded(true);
    } catch (error) {
      console.error('Failed to load folder children:', error);
      setChildren([]);
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [path, loading, useHiddenFilesFilter, listFilesOptions, filterChildNames]);

  useEffect(() => {
    if (isExpanded && !hasLoaded && !loading) {
      loadChildren();
    }
  }, [isExpanded, hasLoaded, loading, loadChildren]);

  useEffect(() => {
    if (currentPath && currentPath.startsWith(path + '/') && path !== currentPath) {
      if (!isExpanded) {
        onToggleExpand(path);
      }
    }
  }, [currentPath, path, isExpanded, onToggleExpand]);

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
            return [...prev, newChild].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
  }, [treeUpdateTrigger, path, isExpanded, isHome, onToggleExpand, loadChildren]);

  const handleClick = () => {
    if (isDisabled) return;
    onPathClick(path);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggleExpand(path);
    if (!isExpanded && children.length === 0) {
      loadChildren();
    }
  };

  // 자식 렌더링 함수
  const renderChildItem = (child, childLevel) => {
    if (renderChild) {
      return renderChild(child, childLevel);
    }
    return (
      <BaseFolderTreeItem
        key={child.path}
        path={child.path}
        name={child.name}
        level={childLevel}
        currentPath={currentPath}
        onPathClick={onPathClick}
        expandedPaths={expandedPaths}
        onToggleExpand={onToggleExpand}
        hasReadPermission={child.hasReadPermission}
        hasWritePermission={child.hasWritePermission}
        onExplorerDrop={onExplorerDrop}
        isMobile={isMobile}
        treeUpdateTrigger={treeUpdateTrigger}
        isHidden={child.isHidden}
        user={user}
        sharedFoldersMap={sharedFoldersMap}
        useHiddenFilesFilter={useHiddenFilesFilter}
        listFilesOptions={listFilesOptions}
      />
    );
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
              '& .MuiListItemIcon-root': { color: 'white' },
              '& .MuiTypography-root': { color: 'white' },
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
            {isExpanded ? (openIcon || <FolderOpenIcon fontSize="small" />) : (icon || <FolderIcon fontSize="small" />)}
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
            sx={{
              opacity: (isHidden || (name && name.startsWith('.'))) ? 0.5 : 1,
            }}
          />
        </ListItemButton>
      </ListItem>
      {(hasChildren || loading) && (
        <Collapse in={isExpanded && (hasChildren || loading)} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {loading && !hasChildren ? (
              <FileTreeSkeleton level={level + 1} count={3} />
            ) : (
              children.map((child) => renderChildItem(child, level + 1))
            )}
          </List>
        </Collapse>
      )}
    </>
  );
};

export default BaseFolderTreeItem;
