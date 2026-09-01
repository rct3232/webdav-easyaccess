import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentFiles } from '../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../services/recentFilesNotifier';
import folderTreeGateway from '../../../services/folderTreeGateway';

const EMPTY_ANCESTORS = [];

const useFolderTreeController = ({
  currentNodeId,
  currentPath = '',
  user,
  onNodeClick,
  ancestors = EMPTY_ANCESTORS,
}) => {
  const chain = Array.isArray(ancestors) ? ancestors : EMPTY_ANCESTORS;
  const [expandedNodeIds, setExpandedNodeIds] = useState(new Set());
  const [sharedFolders, setSharedFolders] = useState([]);
  const [recentFilesList, setRecentFilesList] = useState([]);
  const [sharedExpanded, setSharedExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const homeNodeId = user?.is_admin ? null : (user?.rootNodeId ?? null);

  useEffect(() => {
    if (!user) {
      setRecentFilesList([]);
      return undefined;
    }

    const loadRecentFiles = async () => {
      try {
        const files = await getRecentFiles();
        setRecentFilesList(files);
      } catch (error) {
        // eslint-disable-next-line no-console
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
      const filtered = await folderTreeGateway.getUserSharedFolderPermissions({ user });
      setSharedFolders(filtered);
    } catch (error) {
      // eslint-disable-next-line no-console
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

  const buildSharedFolderTree = useMemo(() => {
    if (sharedFolders.length === 0) return [];

    return sharedFolders.map((perm) => ({
      nodeId: perm.nodeId,
      name: perm.name || `Shared (${perm.nodeId})`,
      children: [],
      parentNodeId: homeNodeId,
      permission: perm.permission,
      hasReadPermission: true,
    }));
  }, [sharedFolders, homeNodeId]);

  // Expansion derivation: home node + the current node's ancestor node ids + current node.
  // Virtual-root / shared-subtree location auto-expands sections (manual toggles are never overridden).
  useEffect(() => {
    const ids = new Set();
    if (homeNodeId != null) ids.add(homeNodeId);
    if (currentNodeId != null) {
      chain.forEach((ancestor) => {
        if (ancestor?.nodeId != null) ids.add(ancestor.nodeId);
      });
      ids.add(currentNodeId);
    }
    setExpandedNodeIds(ids);

    const sharedNodeIds = new Set(sharedFolders.map((perm) => perm.nodeId));
    const isInSharedTree =
      currentNodeId != null &&
      (sharedNodeIds.has(currentNodeId) || chain.some((a) => sharedNodeIds.has(a?.nodeId)));
    if (currentPath === '/__shared__' || isInSharedTree) {
      setSharedExpanded(true);
    }
    if (currentPath === '/__recent__') {
      setRecentExpanded(true);
    }
  }, [currentNodeId, currentPath, homeNodeId, chain, sharedFolders]);

  const onToggleExpand = useCallback((nodeId) => {
    setExpandedNodeIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, []);

  const handleSharedToggle = useCallback(
    (e) => {
      e.stopPropagation();
      const newExpanded = !sharedExpanded;
      setSharedExpanded(newExpanded);
      if (newExpanded) {
        onNodeClick('/__shared__');
      }
    },
    [sharedExpanded, onNodeClick]
  );

  const handleSharedClick = useCallback(() => {
    onNodeClick('/__shared__');
  }, [onNodeClick]);

  const handleSharedFolderClick = useCallback(
    (nodeId) => {
      onNodeClick(nodeId);
    },
    [onNodeClick]
  );

  const handleRecentToggle = useCallback((e) => {
    e.stopPropagation();
    setRecentExpanded((prev) => !prev);
  }, []);

  const handleRecentClick = useCallback(() => {
    onNodeClick('/__recent__');
  }, [onNodeClick]);

  return {
    homeNodeId,
    expandedNodeIds,
    onToggleExpand,
    sharedFolders,
    sharedExpanded,
    handleSharedToggle,
    handleSharedClick,
    handleSharedFolderClick,
    buildSharedFolderTree: () => buildSharedFolderTree,
    recentExpanded,
    handleRecentToggle,
    handleRecentClick,
    recentFilesList,
  };
};

export default useFolderTreeController;
