import { useCallback, useEffect, useRef, useState } from 'react';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { useDropToUpload } from '../../../hooks/useDropToUpload';
import folderTreeGateway from '../../../services/folderTreeGateway';

const useFolderTreeItemController = ({
  // path/name or node (nodeId-first end-state: nodeId comes from node)
  path: pathProp,
  name: nameProp,
  node,

  // display + navigation
  currentNodeId,
  expandedNodeIds,
  onToggleExpand,
  onNodeClick,

  // permissions
  hasReadPermission: hasReadPermissionProp = true,
  hasWritePermission: hasWritePermissionProp = true,
  sharedFoldersMap,

  // DnD / drop mode
  onExplorerDrop,
  onInternalFileDrop,
  onInternalDragStart,
  onInternalDragEnd,
  internalDraggedNodeId,
  isMobile = false,

  // children + reload behavior
  children: initialChildren = [],
  treeUpdateTrigger,
  isHome = false,
  isHidden: isHiddenProp = false,

  // shared/tree filtering options
  user: _user, // included for compatibility; controller does not directly use in this step
  useHiddenFilesFilter = true,
  listFilesOptions,
  filterChildNames,
}) => {
  const nodeId = node?.nodeId != null ? node.nodeId : null;
  const name = nameProp || node?.name || (pathProp ? pathProp.split('/').filter(Boolean).pop() || '' : '');
  const isHidden = isHiddenProp || node?.isHidden || false;

  // Permission derivation:
  // - Prefer explicit node permission fields (when provided in node object)
  // - Otherwise, for shared-tree mode, derive permissions from sharedFoldersMap (keyed by nodeId)
  let hasReadPermission = hasReadPermissionProp;
  let hasWritePermission = hasWritePermissionProp;

  if (node?.hasReadPermission !== undefined) {
    hasReadPermission = node.hasReadPermission === true;
  } else if (sharedFoldersMap && nodeId != null) {
    hasReadPermission =
      sharedFoldersMap.has(nodeId) || sharedFoldersMap.has(String(nodeId));
  }

  if (node?.hasWritePermission !== undefined) {
    hasWritePermission = node.hasWritePermission === true;
  } else if (sharedFoldersMap && nodeId != null) {
    const perm = sharedFoldersMap.get(nodeId) || sharedFoldersMap.get(String(nodeId));
    hasWritePermission = perm && perm.permission === PERMISSIONS.WRITE;
  }

  const nodeChildren = node?.children || initialChildren;
  const [children, setChildren] = useState(nodeChildren);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(nodeChildren.length > 0);

  const isExpanded = nodeId != null && expandedNodeIds.has(nodeId);
  const isCurrent = currentNodeId != null && nodeId != null && currentNodeId === nodeId;
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
    nodeId,
    isDisabled,
    hasWritePermission,
    onExplorerDrop,
    onInternalFileDrop,
    internalDraggedNodeId,
  });

  const loadChildren = useCallback(
    async (force = false) => {
      if (loading && !force) return;
      setLoading(true);

      try {
        const folders = await folderTreeGateway.listFolderChildren({
          nodeId,
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
    [nodeId, loading, useHiddenFilesFilter, listFilesOptions, filterChildNames]
  );

  useEffect(() => {
    if (nodeId != null && isExpanded && !hasLoaded && !loading) {
      loadChildren();
    }
  }, [nodeId, isExpanded, hasLoaded, loading, loadChildren]);

  useEffect(() => {
    if (!treeUpdateTrigger || treeUpdateTrigger === prevTreeUpdateTriggerRef.current) return;

    prevTreeUpdateTriggerRef.current = treeUpdateTrigger;

    if (treeUpdateTrigger.type === 'created') {
      const { parentNodeId, nodeId: createdNodeId, name: createdName } = treeUpdateTrigger;
      if (parentNodeId !== nodeId) return;

      setChildren((prev) => {
        const exists = prev.some((child) => child.nodeId === createdNodeId);
        if (exists) return prev;

        const newChild = { nodeId: createdNodeId, name: createdName };
        return [...prev, newChild].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      });

      if (!isExpanded) {
        onToggleExpand(nodeId);
      }

      setHasLoaded(true);
    } else if (treeUpdateTrigger.type === 'deleted') {
      const { nodeId: deletedNodeId } = treeUpdateTrigger;
      setChildren((prev) => prev.filter((child) => child.nodeId !== deletedNodeId));
    } else if (treeUpdateTrigger.type === 'refresh') {
      if (isExpanded || isHome) {
        loadChildren(true);
      }
    }
  }, [treeUpdateTrigger, nodeId, isExpanded, isHome, onToggleExpand, loadChildren]);

  const handleClick = () => {
    if (isDisabled) return;
    onNodeClick(nodeId);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    if (nodeId == null) return;
    onToggleExpand(nodeId);

    if (!isExpanded && children.length === 0) {
      loadChildren();
    }
  };

  const handleDragStart = useCallback(
    (e) => {
      if (isMobile || isDisabled || nodeId == null) return;
      e.stopPropagation();
      onInternalDragStart?.(nodeId);

      if (e?.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(nodeId));
      }
    },
    [nodeId, isMobile, isDisabled, onInternalDragStart]
  );

  const handleDragEnd = useCallback(() => {
    onInternalDragEnd?.();
  }, [onInternalDragEnd]);

  return {
    nodeId,
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
