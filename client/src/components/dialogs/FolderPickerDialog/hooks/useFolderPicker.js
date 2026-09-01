import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import folderPickerGateway from '../../../../services/folderPickerGateway';
import { buildFolderPickerBreadcrumbs } from './helpers/buildFolderPickerBreadcrumbs';
import { deriveFolderPickerSharedState } from './helpers/deriveFolderPickerSharedState';
import { isInvalidFolderPickerDestination } from './helpers/isInvalidFolderPickerDestination';
import { resolveFolderPickerToggleTarget } from './helpers/resolveFolderPickerToggleTarget';

/**
 * FolderPickerDialog state and logic: folder list, selected nodeId, permissions, breadcrumbs.
 * Navigation is nodeId-first: the hook keeps a { nodeId, name } stack so breadcrumbs and
 * back-navigation work without server ancestor calls.
 */
export function useFolderPicker({
  open,
  currentNodeId,
  user,
  action,
  sourceNodeId,
  sourceNodeIds,
}) {
  const { t } = useTranslation();

  const homeNodeId = user?.is_admin ? null : (user?.rootNodeId ?? null);
  const homeLabel = user?.is_admin ? t('nav.root') : t('nav.home');
  const sharedLabel = t('nav.shared');

  const [selectedNodeId, setSelectedNodeId] = useState(currentNodeId != null ? currentNodeId : homeNodeId);
  const [navStack, setNavStack] = useState(() => [
    { nodeId: homeNodeId ?? null, name: homeLabel },
  ]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasWritePermission, setHasWritePermission] = useState(true);
  const [sharedFolderRoots, setSharedFolderRoots] = useState([]);
  const [_sharedPermissionNodeIds, setSharedPermissionNodeIds] = useState(new Set());

  const prevOpenRef = useRef(false);

  const getCurrentPathType = useCallback(() => {
    return navStack[0]?.isSharedRoot ? 'shared' : 'home';
  }, [navStack]);

  const checkWritePermission = useCallback(async (nodeId) => {
    try {
      if (user?.is_admin) {
        setHasWritePermission(true);
        return;
      }
      const permission = await folderPickerGateway.checkWritePermission({ nodeId });
      setHasWritePermission(permission?.hasWrite === true);
    } catch (error) {
      console.error('Failed to check permission:', error);
      setHasWritePermission(Boolean(user?.is_admin));
    }
  }, [user]);

  const applySharedPermissionState = useCallback((permissions) => {
    const {
      sharedPermissionNodeIds: nextSharedPermissionNodeIds,
      sharedFolders,
      sharedFolderRoots: nextSharedFolderRoots,
    } = deriveFolderPickerSharedState({ permissions });

    setSharedPermissionNodeIds(nextSharedPermissionNodeIds);
    setSharedFolderRoots(nextSharedFolderRoots);

    return sharedFolders;
  }, []);

  const loadFolders = useCallback(async (nodeId, pathType = getCurrentPathType()) => {
    setLoading(true);
    try {
      if (pathType === 'shared' && nodeId == null) {
        const sharedPermissions = await folderPickerGateway.getUserSharedFolderPermissions({ user });
        setFolders(applySharedPermissionState(sharedPermissions));
      } else {
        const data = await folderPickerGateway.listFolderContents({ nodeId });
        const directories = Array.isArray(data) ? data.filter(item => item.type === 'directory') : [];
        setFolders(directories);
      }
    } catch (error) {
      console.error('Failed to load folders:', error);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [applySharedPermissionState, getCurrentPathType, user]);

  const loadSharedFolders = useCallback(async () => {
    if (!user?.id || user.is_admin) return new Set();
    try {
      const sharedPermissions = await folderPickerGateway.getUserSharedFolderPermissions({ user });
      const sharedState = deriveFolderPickerSharedState({ permissions: sharedPermissions });
      applySharedPermissionState(sharedPermissions);
      return sharedState.sharedPermissionNodeIds;
    } catch (error) {
      console.error('Failed to load shared folders:', error);
      setSharedFolderRoots([]);
      setSharedPermissionNodeIds(new Set());
      return new Set();
    }
  }, [applySharedPermissionState, user]);

  useEffect(() => {
    const wasClosed = !prevOpenRef.current;
    const isNowOpen = open;
    if (wasClosed && isNowOpen) {
      const initialNodeId = currentNodeId != null ? currentNodeId : homeNodeId;
      setSelectedNodeId(initialNodeId);
      setNavStack([{ nodeId: homeNodeId ?? null, name: homeLabel }]);

      if (action === 'copy' || action === 'move') {
        if (user?.is_admin) setHasWritePermission(true);
        else checkWritePermission(initialNodeId);
      } else {
        setHasWritePermission(true);
      }

      if (user && !user.is_admin && (action === 'copy' || action === 'move')) {
        loadSharedFolders().then((sharedPermissionNodeIds) => {
          if (initialNodeId != null && sharedPermissionNodeIds.has(String(initialNodeId))) {
            setNavStack([{ nodeId: null, name: sharedLabel, isSharedRoot: true }]);
          }
        });
      }

      loadFolders(initialNodeId, 'home');
    }
    prevOpenRef.current = open;
  }, [open, currentNodeId, action, user, homeNodeId, homeLabel, sharedLabel, loadFolders, loadSharedFolders, checkWritePermission]);

  const handleFolderClick = useCallback((folder) => {
    if (folder.hasReadPermission === false) return;
    const nodeId = folder.nodeId != null ? folder.nodeId : null;
    const pathType = getCurrentPathType();
    setSelectedNodeId(nodeId);
    setNavStack(prev => [...prev, { nodeId, name: folder.basename || folder.name || '' }]);
    loadFolders(nodeId, pathType);
    if (action === 'copy' || action === 'move') {
      if (folder.hasWritePermission !== undefined) {
        setHasWritePermission(folder.hasWritePermission);
      } else {
        checkWritePermission(nodeId);
      }
    }
  }, [action, getCurrentPathType, loadFolders, checkWritePermission]);

  const handleNodeClick = useCallback((nodeId) => {
    const pathType = getCurrentPathType();
    const index = navStack.findIndex((entry) => entry.nodeId === nodeId);
    if (index < 0) return;
    setNavStack(navStack.slice(0, index + 1));
    setSelectedNodeId(nodeId);
    loadFolders(nodeId, pathType);
    if (action === 'copy' || action === 'move') {
      if (index === 0 && pathType === 'shared') setHasWritePermission(true);
      else checkWritePermission(nodeId);
    }
  }, [action, getCurrentPathType, navStack, loadFolders, checkWritePermission]);

  const isInvalidDestination = useCallback(() => {
    return isInvalidFolderPickerDestination({
      action,
      selectedNodeId,
      sourceNodeId,
      sourceNodeIds,
    });
  }, [action, selectedNodeId, sourceNodeId, sourceNodeIds]);

  const handleTogglePath = useCallback((event, newValue) => {
    const toggleTarget = resolveFolderPickerToggleTarget({
      nextPathType: newValue,
      action,
      sourceNodeId,
      sourceNodeIds,
      sharedFolderRoots,
      homeNodeId,
    });

    if (!toggleTarget) {
      return;
    }

    const { nodeId, pathType, presetHasWritePermission } = toggleTarget;
    setSelectedNodeId(nodeId);
    setNavStack([
      {
        nodeId: nodeId ?? null,
        name: pathType === 'shared' ? sharedLabel : homeLabel,
        ...(pathType === 'shared' ? { isSharedRoot: true } : {}),
      },
    ]);
    loadFolders(nodeId, pathType);

    if (action === 'copy' || action === 'move') {
      if (typeof presetHasWritePermission === 'boolean') {
        setHasWritePermission(presetHasWritePermission);
      } else {
        checkWritePermission(nodeId);
      }
    }
  }, [action, checkWritePermission, loadFolders, sharedFolderRoots, sourceNodeId, sourceNodeIds, homeNodeId, homeLabel, sharedLabel]);

  const breadcrumbs = buildFolderPickerBreadcrumbs({
    homeNodeId: homeNodeId ?? null,
    homeLabel,
    sharedLabel,
    navStack,
  });

  return {
    selectedNodeId,
    setSelectedNodeId,
    folders,
    loading,
    hasWritePermission,
    breadcrumbs,
    handleFolderClick,
    handleNodeClick,
    handleTogglePath,
    getCurrentPathType,
    isInvalidDestination,
    loadFolders,
    checkWritePermission,
  };
}
