import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRecentFiles } from '../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../services/recentFilesNotifier';
import folderTreeGateway from '../../../services/folderTreeGateway';
import explorerGateway from '../../../services/explorerGateway';

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
  // -- AI-platform §3: __collections__ section state (flat depth-1 rows only).
  const [collectionsTreeRows, setCollectionsTreeRows] = useState([]);
  const [collectionsExpanded, setCollectionsExpanded] = useState(false);

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

  // §3: flat collection rows (activity order, server-given) — no badge read.
  // loaded through the explorerGateway seams only; notifier refreshes rows.
  // Operator rule (PLAN §14 client half): admins never load collections —
  // no loadCollections call, no subscription, no /api/collections traffic.
  const loadCollectionsRows = useCallback(async () => {
    try {
      const active = await explorerGateway.loadCollections({
        sort: 'activity',
        include: 'mine,shared',
      });
      setCollectionsTreeRows(active?.collections ?? []);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load collections rows:', error);
      setCollectionsTreeRows([]);
    }
  }, []);

  useEffect(() => {
    if (!user || user.is_admin) {
      setCollectionsTreeRows([]);
      return undefined;
    }

    loadCollectionsRows();
    const unsubscribe = explorerGateway.subscribeToCollections(loadCollectionsRows);
    return () => {
      // Safe-cleanup idiom: a test-injected mock may resolve the subscription
      // seam to a non-callable; never let unmount throw.
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [user, loadCollectionsRows]);

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
    if (currentPath === '/__collections__' || (currentPath || '').startsWith('/__collections__/')) {
      setCollectionsExpanded(true);
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

  // -- §3 collections handlers -------------------------------------------------

  // Returning to the list view re-fetches the rows: opening a collection stamps
  // the server digest cursor (GET /:id/items), so the cleared dots appear on the
  // refreshed rows (ruling 2026-10-01 — replaces the localStorage write effect).
  // Transition-only: the mount load (or a same-path re-render) never double-fetches.
  const previousPathRef = useRef(currentPath);
  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = currentPath;
    if (currentPath !== '/__collections__' || previousPath === '/__collections__') return;
    if (!user || user.is_admin) return;
    loadCollectionsRows();
  }, [currentPath, user, loadCollectionsRows]);

  // New-dot rule (ruling 2026-10-01): dot ⇔ the requester NEVER opened the
  // collection — the server-cursor row field `last_visited_at` is null/absent.
  const newCollectionIds = useMemo(
    () =>
      (collectionsTreeRows ?? [])
        .filter((row) => row?.last_visited_at == null)
        .map((row) => row.collection_id),
    [collectionsTreeRows]
  );

  const handleCollectionsToggle = useCallback(
    (e) => {
      e.stopPropagation();
      const nextExpanded = !collectionsExpanded;
      setCollectionsExpanded(nextExpanded);
      if (nextExpanded) {
        onNodeClick('/__collections__');
      }
    },
    [collectionsExpanded, onNodeClick]
  );

  const handleCollectionsClick = useCallback(() => {
    onNodeClick('/__collections__');
  }, [onNodeClick]);

  const handleArchiveClick = useCallback(() => {
    onNodeClick('/__collections__/__archive__');
  }, [onNodeClick]);

  // P-5: static Likes child row (owner ruling — section child, not a root).
  const handleLikedClick = useCallback(() => {
    onNodeClick('/__collections__/liked');
  }, [onNodeClick]);

  const handleCollectionClick = useCallback(
    (collectionId) => {
      onNodeClick(`/__collections__/collection/${collectionId}`);
    },
    [onNodeClick]
  );

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
    // §3 AI-platform collections section
    collectionsExpanded,
    handleCollectionsToggle,
    handleCollectionsClick,
    handleCollectionClick,
    handleArchiveClick,
    handleLikedClick,
    collectionsTreeRows,
    newCollectionIds,
  };
};

export default useFolderTreeController;
