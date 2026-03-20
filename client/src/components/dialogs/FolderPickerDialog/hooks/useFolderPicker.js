import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import folderPickerGateway from '../../../../services/folderPickerGateway';
import { getUserBaseFolder } from '../../../../utils/userUtils';
import { buildFolderPickerBreadcrumbs } from './helpers/buildFolderPickerBreadcrumbs';
import { deriveFolderPickerSharedState } from './helpers/deriveFolderPickerSharedState';
import { isInvalidFolderPickerDestination } from './helpers/isInvalidFolderPickerDestination';
import { resolveFolderPickerToggleTarget } from './helpers/resolveFolderPickerToggleTarget';

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
  const [sharedFolderRoots, setSharedFolderRoots] = useState([]);
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

  const applySharedPermissionState = useCallback((permissions) => {
    const {
      sharedPermissionPaths: nextSharedPermissionPaths,
      sharedFolders,
      sharedFolderRoots: nextSharedFolderRoots,
    } = deriveFolderPickerSharedState({ permissions });

    setSharedPermissionPaths(nextSharedPermissionPaths);
    setSharedFolderRoots(nextSharedFolderRoots);

    return sharedFolders;
  }, []);

  const loadFolders = useCallback(async (path) => {
    setLoading(true);
    try {
      if (path === '/__shared__') {
        const sharedPermissions = await folderPickerGateway.getUserSharedFolderPermissions({ user });
        setFolders(applySharedPermissionState(sharedPermissions));
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
  }, [applySharedPermissionState, user]);

  const loadSharedFolders = useCallback(async () => {
    if (!user?.id || user.is_admin) return;
    try {
      const sharedPermissions = await folderPickerGateway.getUserSharedFolderPermissions({ user });
      applySharedPermissionState(sharedPermissions);
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolderRoots([]);
      setSharedPermissionPaths(new Set());
    }
  }, [applySharedPermissionState, user]);

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

  const handleTogglePath = useCallback((event, newValue) => {
    const toggleTarget = resolveFolderPickerToggleTarget({
      nextPathType: newValue,
      action,
      user,
      sourceFilePath,
      sourceFilePaths,
      sharedFolderRoots,
    });

    if (!toggleTarget) {
      return;
    }

    setSelectedPath(toggleTarget.path);
    loadFolders(toggleTarget.path);

    if (action === 'copy' || action === 'move') {
      if (typeof toggleTarget.presetHasWritePermission === 'boolean') {
        setHasWritePermission(toggleTarget.presetHasWritePermission);
      } else {
        checkWritePermission(toggleTarget.path);
      }
    }
  }, [action, checkWritePermission, loadFolders, sharedFolderRoots, sourceFilePath, sourceFilePaths, user]);

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
