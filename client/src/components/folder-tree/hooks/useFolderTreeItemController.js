import { useCallback, useEffect, useRef, useState } from 'react';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { useDropToUpload } from '../../../hooks/useDropToUpload';
import folderTreeGateway from '../../../services/folderTreeGateway';

const useFolderTreeItemController = ({
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
  hasReadPermission: hasReadPermissionProp = true,
  hasWritePermission: hasWritePermissionProp = true,
  sharedFoldersMap,

  // DnD / drop mode
  onExplorerDrop,
  onInternalFileDrop,
  onInternalDragStart,
  onInternalDragEnd,
  internalDraggedPath,
  isMobile = false,

  // children + reload behavior
  children: initialChildren = [],
  treeUpdateTrigger,
  isHome = false,
  isHidden: isHiddenProp = false,

  // shared/tree filtering options
  user, // included for compatibility; controller does not directly use in this step
  useHiddenFilesFilter = true,
  listFilesOptions,
  filterChildNames,
}) => {
  const path = pathProp || node?.path;
  const name = nameProp || node?.name;
  const isHidden = isHiddenProp || node?.isHidden || false;

  // Permission derivation:
  // - Prefer explicit node permission fields (when provided in node object)
  // - Otherwise, for shared-tree mode, derive permissions from sharedFoldersMap
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
    onInternalFileDrop,
    internalDraggedPath,
  });

  const loadChildren = useCallback(
    async (force = false) => {
      if (loading && !force) return;
      setLoading(true);

      try {
        const folders = await folderTreeGateway.listFolderChildren({
          path,
          listFilesOptions,
          useHiddenFilesFilter,
          filterChildNames,
        });

        setChildren(folders);
        setHasLoaded(true);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load folder children:', error);
        setChildren([]);
        setHasLoaded(true);
      } finally {
        setLoading(false);
      }
    },
    [path, loading, useHiddenFilesFilter, listFilesOptions, filterChildNames]
  );

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
    if (!treeUpdateTrigger || treeUpdateTrigger === prevTreeUpdateTriggerRef.current) return;

    prevTreeUpdateTriggerRef.current = treeUpdateTrigger;

    if (treeUpdateTrigger.type === 'created') {
      const { folderPath, folderName, parentPath } = treeUpdateTrigger;
      if (parentPath === path) {
        setChildren((prev) => {
          const exists = prev.some((child) => child.path === folderPath);
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
      setChildren((prev) => prev.filter((child) => child.path !== folderPath));
    } else if (treeUpdateTrigger.type === 'refresh') {
      if (isExpanded || isHome) {
        loadChildren(true);
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

  const handleDragStart = useCallback(
    (e) => {
      if (isMobile || isDisabled) return;
      e.stopPropagation();
      onInternalDragStart?.(path);

      if (e?.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', path);
      }
    },
    [path, isMobile, isDisabled, onInternalDragStart]
  );

  const handleDragEnd = useCallback(() => {
    onInternalDragEnd?.();
  }, [onInternalDragEnd]);

  return {
    path,
    name,
    isHidden,
    hasReadPermission,
    hasWritePermission,
    children,
    loading,
    hasLoaded,
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
  };
};

export default useFolderTreeItemController;

