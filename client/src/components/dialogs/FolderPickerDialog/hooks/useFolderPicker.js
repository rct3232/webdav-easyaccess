import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import folderPickerGateway from '../../../../services/folderPickerGateway';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { normalizePath } from '../../../../utils/pathUtils';
import { getUserBaseFolder } from '../../../../utils/userUtils';
import { buildFolderPickerBreadcrumbs } from './helpers/buildFolderPickerBreadcrumbs';
import { isInvalidFolderPickerDestination } from './helpers/isInvalidFolderPickerDestination';

/**
 * FolderPickerDialog state and logic: folder list, selected path, permissions, breadcrumbs.
 */
export function useFolderPicker({
  open,
  currentPath,
  user,
  action,
  sourceFilePath,
  sourceFilePaths,
}) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState(currentPath || '/');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasWritePermission, setHasWritePermission] = useState(true);
  const [sharedFolders, setSharedFolders] = useState([]);
  const [sharedPermissionPaths, setSharedPermissionPaths] = useState(new Set());

  const prevOpenRef = useRef(false);

  const checkWritePermission = useCallback(async (path) => {
    try {
      if (user?.is_admin) {
        setHasWritePermission(true);
        return;
      }
      const permission = await folderPickerGateway.checkWritePermission({ path });
      setHasWritePermission(permission.hasWrite);
    } catch (error) {
      console.error('Failed to check permission:', error);
      if (user?.is_admin) {
        setHasWritePermission(true);
      } else {
        setHasWritePermission(path.startsWith(getUserBaseFolder(user)));
      }
    }
  }, [user]);

  const loadFolders = useCallback(async (path) => {
    setLoading(true);
    try {
      if (path === '/__shared__') {
        const sharedFoldersData = await folderPickerGateway.getUserSharedFolderPermissions({ user });
        const permissionPaths = new Map();
        sharedFoldersData.forEach(perm => {
          permissionPaths.set(normalizePath(perm.folder_path), perm);
        });
        const topLevelFolders = Array.from(permissionPaths.entries()).filter(([normalizedPath]) => {
          const pathParts = normalizedPath.split('/').filter(Boolean);
          for (let i = pathParts.length - 1; i > 0; i--) {
            const parentPath = '/' + pathParts.slice(0, i).join('/');
            if (permissionPaths.has(parentPath)) return false;
          }
          return true;
        });
        const sharedFolderList = topLevelFolders.map(([normalizedPath, perm]) => {
          const pathParts = normalizedPath.split('/').filter(Boolean);
          const name = pathParts[pathParts.length - 1] || normalizedPath;
          return {
            path: normalizedPath,
            basename: name,
            name,
            type: 'directory',
            size: 0,
            lastmodified: null,
            hasReadPermission: true,
            hasWritePermission: perm.permission === PERMISSIONS.WRITE || perm.permission === PERMISSIONS.ADMIN,
          };
        });
        setFolders(sharedFolderList);
      } else {
        const data = await folderPickerGateway.listFolderContents({ path });
        const directories = Array.isArray(data) ? data.filter(item => item.type === 'directory') : [];
        setFolders(directories);
      }
    } catch (error) {
      console.error('Failed to load folders:', error);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadSharedFolders = useCallback(async () => {
    if (!user?.id || user.is_admin) return;
    try {
      const filtered = await folderPickerGateway.getUserSharedFolderPermissions({ user });
      const permissionPaths = new Map();
      filtered.forEach(perm => permissionPaths.set(normalizePath(perm.folder_path), perm));
      setSharedPermissionPaths(new Set(permissionPaths.keys()));
      const topLevelFolders = Array.from(permissionPaths.keys()).filter(normalizedPath => {
        const pathParts = normalizedPath.split('/').filter(Boolean);
        for (let i = pathParts.length - 1; i > 0; i--) {
          const parentPath = '/' + pathParts.slice(0, i).join('/');
          if (permissionPaths.has(parentPath)) return false;
        }
        return true;
      });
      setSharedFolders(topLevelFolders);
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolders([]);
      setSharedPermissionPaths(new Set());
    }
  }, [user]);

  useEffect(() => {
    const wasClosed = !prevOpenRef.current;
    const isNowOpen = open;
    if (wasClosed && isNowOpen) {
      const initialPath = currentPath || '/';
      setSelectedPath(initialPath);
      loadFolders(initialPath);
      if (action === 'copy' || action === 'move') {
        if (user?.is_admin) setHasWritePermission(true);
        else checkWritePermission(initialPath);
      } else {
        setHasWritePermission(true);
      }
      if (user && !user.is_admin && (action === 'copy' || action === 'move')) {
        loadSharedFolders();
      }
    }
    prevOpenRef.current = open;
  }, [open, currentPath, action, user, loadFolders, checkWritePermission, loadSharedFolders]);

  const handleFolderClick = useCallback((folder) => {
    if (folder.hasReadPermission === false) return;
    const newPath = folder.path;
    setSelectedPath(newPath);
    loadFolders(newPath);
    if (action === 'copy' || action === 'move') {
      if (folder.hasWritePermission !== undefined) {
        setHasWritePermission(folder.hasWritePermission);
      } else {
        checkWritePermission(newPath);
      }
    }
  }, [action, loadFolders, checkWritePermission]);

  const handlePathClick = useCallback((path) => {
    setSelectedPath(path);
    loadFolders(path);
    if (action === 'copy' || action === 'move') {
      if (path === '/__shared__') setHasWritePermission(true);
      else checkWritePermission(path);
    }
  }, [action, loadFolders, checkWritePermission]);

  const isInvalidDestination = useCallback(() => {
    return isInvalidFolderPickerDestination({
      action,
      selectedPath,
      sourceFilePath,
      sourceFilePaths,
    });
  }, [action, selectedPath, sourceFilePath, sourceFilePaths]);

  const isSourceInHome = useCallback(() => {
    if (!action || (action !== 'copy' && action !== 'move')) return false;
    if (user?.is_admin) {
      if (sourceFilePath) return sourceFilePath === '/' || sourceFilePath.startsWith('/');
      if (sourceFilePaths?.length) return sourceFilePaths.every(p => p === '/' || p.startsWith('/'));
      return false;
    }
    const userBaseFolder = getUserBaseFolder(user);
    if (sourceFilePath) return sourceFilePath.startsWith(userBaseFolder);
    if (sourceFilePaths?.length) return sourceFilePaths.some(p => p.startsWith(userBaseFolder));
    return false;
  }, [action, user, sourceFilePath, sourceFilePaths]);

  const getSharedRootPath = useCallback(() => {
    if (!action || (action !== 'copy' && action !== 'move')) return null;
    const userBaseFolder = getUserBaseFolder(user);
    const sourcePaths = sourceFilePath ? [sourceFilePath] : (sourceFilePaths || []);
    if (!sourcePaths.length) return null;
    const firstPath = normalizePath(sourcePaths[0]);
    if (firstPath.startsWith(userBaseFolder)) return null;
    let bestMatch = null;
    let bestMatchLength = 0;
    for (const sharedPath of sharedFolders) {
      const normalizedSharedPath = normalizePath(sharedPath);
      if (firstPath.startsWith(normalizedSharedPath + '/') || firstPath === normalizedSharedPath) {
        if (normalizedSharedPath.length > bestMatchLength) {
          bestMatch = normalizedSharedPath;
          bestMatchLength = normalizedSharedPath.length;
        }
      }
    }
    if (bestMatch) return bestMatch;
    const parts = firstPath.split('/').filter(Boolean);
    return parts.length > 0 ? `/${parts[0]}` : null;
  }, [action, user, sourceFilePath, sourceFilePaths, sharedFolders]);

  const handleTogglePath = useCallback((event, newValue) => {
    if (!newValue) return;
    const userBaseFolder = getUserBaseFolder(user);
    const homePath = user?.is_admin ? '/' : userBaseFolder;
    const isSourceHome = isSourceInHome();

    if (newValue === 'home') {
      if (isSourceHome) {
        const sourcePath = sourceFilePath || sourceFilePaths?.[0];
        if (sourcePath) {
          const parentDir = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '/';
          const normalizedParent = parentDir === '/' ? '/' : parentDir.replace(/\/$/, '');
          setSelectedPath(normalizedParent || homePath);
          loadFolders(normalizedParent || homePath);
          if (action === 'copy' || action === 'move') checkWritePermission(normalizedParent || homePath);
        } else {
          setSelectedPath(homePath);
          loadFolders(homePath);
          if (action === 'copy' || action === 'move') checkWritePermission(homePath);
        }
      } else {
        setSelectedPath(homePath);
        loadFolders(homePath);
        if (action === 'copy' || action === 'move') checkWritePermission(homePath);
      }
    } else if (newValue === 'shared') {
      if (isSourceHome) {
        setSelectedPath('/__shared__');
        loadFolders('/__shared__');
        setHasWritePermission(true);
      } else {
        const sharedRoot = getSharedRootPath();
        if (sharedRoot) {
          const sourcePath = sourceFilePath || sourceFilePaths?.[0];
          if (sourcePath) {
            const parentDir = sourcePath.substring(0, sourcePath.lastIndexOf('/')) || '/';
            const normalizedParent = parentDir === '/' ? '/' : parentDir.replace(/\/$/, '');
            setSelectedPath(normalizedParent || sharedRoot);
            loadFolders(normalizedParent || sharedRoot);
            if (action === 'copy' || action === 'move') checkWritePermission(normalizedParent || sharedRoot);
          } else {
            setSelectedPath(sharedRoot);
            loadFolders(sharedRoot);
            if (action === 'copy' || action === 'move') checkWritePermission(sharedRoot);
          }
        }
      }
    }
  }, [user, action, sourceFilePath, sourceFilePaths, isSourceInHome, getSharedRootPath, loadFolders, checkWritePermission]);

  const getCurrentPathType = useCallback(() => {
    const userBaseFolder = getUserBaseFolder(user);
    const homePath = user?.is_admin ? '/' : userBaseFolder;
    if (selectedPath === '/__shared__') return 'shared';
    if (user?.is_admin) return selectedPath?.startsWith('/') ? 'home' : 'shared';
    if (selectedPath === homePath || selectedPath.startsWith(homePath + '/')) return 'home';
    return 'shared';
  }, [user, selectedPath]);

  const homePath = user?.is_admin ? '/' : getUserBaseFolder(user);
  const homeLabel = user?.is_admin ? t('nav.root') : t('nav.home');
  const breadcrumbs = buildFolderPickerBreadcrumbs({
    selectedPath,
    user,
    homePath,
    homeLabel,
    sharedPermissionPaths,
    sharedLabel: t('nav.shared'),
  });

  return {
    selectedPath,
    setSelectedPath,
    folders,
    loading,
    hasWritePermission,
    breadcrumbs,
    handleFolderClick,
    handlePathClick,
    handleTogglePath,
    getCurrentPathType,
    isInvalidDestination,
    loadFolders,
    checkWritePermission,
  };
}
