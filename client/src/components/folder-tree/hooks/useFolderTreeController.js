import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentFiles } from '../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../services/recentFilesNotifier';
import { getUserBaseFolder } from '../../../utils/userUtils';
import folderTreeGateway from '../../../services/folderTreeGateway';

const useFolderTreeController = ({ currentPath, user, onPathClick }) => {
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
      path: `/__shared__/${perm.nodeId}`,
      name: `Shared (${perm.nodeId})`,
      children: [],
      permission: perm.permission,
      hasReadPermission: true,
    }));
  }, [sharedFolders]);

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
        const isSharedNode = currentPath.startsWith('/__shared__/') && sharedFolders.length > 0;
         if (isSharedNode) {
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

  const onToggleExpand = useCallback((path) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
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
        onPathClick('/__shared__');
      }
    },
    [sharedExpanded, onPathClick]
  );

  const handleSharedClick = useCallback(() => {
    onPathClick('/__shared__');
  }, [onPathClick]);

  const handleSharedFolderClick = useCallback(
    (folderPath) => {
      onPathClick(folderPath);
    },
    [onPathClick]
  );

  const handleRecentToggle = useCallback(
    (e) => {
      e.stopPropagation();
      setRecentExpanded((prev) => !prev);
    },
    []
  );

  const handleRecentClick = useCallback(() => {
    onPathClick('/__recent__');
  }, [onPathClick]);

  return {
    homePath,
    expandedPaths,
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

