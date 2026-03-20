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
  Tooltip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { FileTreeSkeleton } from '../file-manager/FileSkeletons';
import useFolderTreeItemController from './hooks/useFolderTreeItemController';

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
  onInternalFileDrop,
  onInternalDragStart,
  onInternalDragEnd,
  internalDraggedPath,
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
  const {
    name,
    isHidden,
    hasWritePermission,
    children,
    loading,
    isExpanded,
    isCurrent,
    hasChildren,
    showExpandIcon,
    isDisabled,
    isDropTarget,
    isDraggingOver,
    handleFolderDragOver,
    handleFolderDragEnter,
    handleFolderDragLeave,
    handleFolderDrop,
    handleClick,
    handleToggle,
    handleDragStart,
    handleDragEnd,
  } = useFolderTreeItemController({
    // path/name or node
    path: pathProp,
    name: nameProp,
    node,

    // display + navigation
    currentPath,
    expandedPaths,
    onPathClick,
    onToggleExpand,

    // permissions
    hasReadPermission: hasReadPermissionProp,
    hasWritePermission: hasWritePermissionProp,
    sharedFoldersMap,

    // DnD / drop mode
    onExplorerDrop,
    onInternalFileDrop,
    onInternalDragStart,
    onInternalDragEnd,
    internalDraggedPath,
    isMobile,

    // children + reload behavior
    children: initialChildren,
    treeUpdateTrigger,
    isHome,
    isHidden: isHiddenProp,

    // compatibility + filtering
    user,
    useHiddenFilesFilter,
    listFilesOptions,
    filterChildNames,
  });
  const nameTextRef = useRef(null);
  const [isNameTruncated, setIsNameTruncated] = useState(false);

  const checkNameTruncation = useCallback(() => {
    const el = nameTextRef.current;
    if (!el) return;
    setIsNameTruncated(el.scrollWidth > el.clientWidth);
  }, []);

  useEffect(() => {
    checkNameTruncation();
    const el = nameTextRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkNameTruncation);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name, checkNameTruncation]);

  // 자식 렌더링 함수
  const isDropHighlight = (isDropTarget || isDraggingOver) && hasWritePermission;

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
        onInternalFileDrop={onInternalFileDrop}
        onInternalDragStart={onInternalDragStart}
        onInternalDragEnd={onInternalDragEnd}
        internalDraggedPath={internalDraggedPath}
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
            backgroundColor: isDisabled ? 'transparent' : (isDropHighlight ? 'transparent' : 'action.hover'),
          },
        }}
        draggable={!isMobile && !isDisabled}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
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
            backgroundColor: isDropHighlight ? 'primary.main' : 'transparent',
            transition: 'all 0.2s',
            ...(isDropHighlight && {
              color: 'white',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '& .MuiListItemIcon-root': { color: 'white' },
              '& .MuiTypography-root': { color: 'white' },
            }),
            '&.Mui-selected': {
              backgroundColor: isDropHighlight ? 'primary.main' : 'transparent',
              color: isDropHighlight ? 'white' : 'primary.main',
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              '&:hover': {
                backgroundColor: isDropHighlight ? 'primary.main' : 'action.hover',
              },
              '& .MuiListItemIcon-root': {
                color: isDropHighlight ? 'white' : 'primary.main',
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
              <Tooltip title={isNameTruncated ? (name || '') : ''} disableInteractive enterDelay={300}>
                <Typography
                  ref={nameTextRef}
                  variant="body2"
                  component="span"
                  sx={{
                    fontSize: '0.875rem',
                    fontWeight: isCurrent ? 700 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {name}
                </Typography>
              </Tooltip>
            }
            sx={{
              opacity: (isHidden || (name && name.startsWith('.'))) ? 0.5 : 1,
              minWidth: 0,
              overflow: 'hidden',
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
