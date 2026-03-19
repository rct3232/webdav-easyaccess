import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentFiles, onRecentFilesChange } from '../../../utils/recentFiles';
import { normalizePath } from '../../../utils/pathUtils';
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

    const permissionPaths = new Map();
    sharedFolders.forEach((perm) => {
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
        name,
        children: [],
        parentPath,
        permission: perm.permission,
        hasReadPermission: true,
      });
    });

    const buildTree = (parentPath) => {
      const children = [];
      pathMap.forEach((node, path) => {
        if (node.parentPath === parentPath) {
          const childNode = {
            ...node,
            children: buildTree(path),
          };
          children.push(childNode);
        }
      });
      return children.sort((a, b) => a.name.localeCompare(b.name));
    };

    return buildTree(null);
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
        const isSharedPath = sharedFolders.some((perm) => currentPath.startsWith(perm.folder_path));
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

