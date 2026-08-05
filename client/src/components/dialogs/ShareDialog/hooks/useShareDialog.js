import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { listFiles, resolvePath } from '../../../../services/fileService';
import { PERMISSIONS, HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { getUserBaseFolder } from '../../../../utils/userUtils';
import { getServerErrorDisplay } from '../../../../utils/errorUtils';
import { getApprovedUsers } from '../../../../services/userService';
import sharePermissionGateway from '../../../../services/sharePermissionGateway';
import { shareReviewUseCase } from '../../../../services/shareReviewUseCase';
import { sharePermissionSaveUseCase } from '../../../../services/sharePermissionSaveUseCase';
import { adminPermissionSaveUseCase } from '../../../../services/adminPermissionSaveUseCase';

/**
 * ShareDialog state and API logic hook.
 * Used together with usePermissionManager; owns the folder tree / user list /
 * initialization / save logic. All permission state and tree keys are nodeId-based.
 */
export function useShareDialog({
  open,
  mode,
  userId,
  username,
  startFromUserHome,
  folderPath,
  folderName,
  folderNodeId,
  targetNodeId,
  permissionRequest,
  enableExternalShare,
  onMessage,
  onSave,
  onApprove,
  onClose,
  // from usePermissionManager
  folderPermissions,
  setFolderPermissions,
  initialFolderPermissions,
  setInitialFolderPermissions,
  userInfoMap,
  setUserInfoMap,
  setSaving,
  setLoadingPermissions,
  handleAddUserPermission,
  handleRemoveUserPermission,
  handleToggleUserPermission,
  hasPermissionChanged,
}) {
  const { t } = useTranslation();
  const isAdminMode = mode === 'admin';
  const isShareMode = mode === 'share';
  const isReviewMode = mode === 'review';

  const rootPath = isAdminMode
    ? (startFromUserHome && username ? getUserBaseFolder({ username }) : '/')
    : (folderPath && folderPath !== '/' && folderPath.endsWith('/') ? folderPath.slice(0, -1) : (folderPath || '/'));

  const folderNodeIdProp = folderNodeId ?? targetNodeId ?? null;

  const [users, setUsers] = useState([]);
  const [folderTree, setFolderTree] = useState(new Map());
  const [expandedNodeIds, setExpandedNodeIds] = useState(new Set());
  const [loadingNodeIds, setLoadingNodeIds] = useState(new Set());
  const [loadingAllFolders, setLoadingAllFolders] = useState(false);
  const [folderMenuAnchor, setFolderMenuAnchor] = useState(null);
  const [folderMenuNodeId, setFolderMenuNodeId] = useState(null);
  const [folderMenuView, setFolderMenuView] = useState('manage');
  const [rootNodeId, setRootNodeId] = useState(null);
  const [baseFolderNodeId, setBaseFolderNodeId] = useState(null);

  const [externalShareLoading, setExternalShareLoading] = useState(false);
  const [externalShareLink, setExternalShareLink] = useState(null);
  const [externalShareExpiresInDays, setExternalShareExpiresInDays] = useState(14);
  const [externalShareUnlimited, setExternalShareUnlimited] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const inFlightFolderLoadsRef = useRef(new Map());

  const loadUsers = useCallback(async () => {
    try {
      const data = await getApprovedUsers();
      setUsers(data);
    } catch (error) {
      console.error('Failed to load users:', error);
      if (onMessage) {
        onMessage({ text: t('dialogs.userListLoadFail'), type: 'error' });
      }
    }
  }, [onMessage, t]);

  const loadFolderChildren = useCallback((nodeId) => {
    const cacheKey = nodeId ?? '__root__';
    const inFlight = inFlightFolderLoadsRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const loadPromise = (async () => {
      setLoadingNodeIds(prev => new Set(prev).add(nodeId));
      try {
        const data = await listFiles(nodeId);
        const folders = (data || [])
          .filter(item => item.type === 'directory')
          .map(folder => ({
            nodeId: folder.nodeId,
            name: folder.basename || folder.name,
            path: folder.display_path || folder.path || '',
            children: [],
          }));

        setFolderTree(prev => {
          const newMap = new Map(prev);
          let current = newMap.get(nodeId);
          if (!current) {
            current = {
              nodeId,
              path: nodeId == null ? rootPath : '',
              name: nodeId == null ? 'Root' : String(nodeId),
              children: [],
            };
          }
          current.children = folders;
          newMap.set(nodeId, current);
          if (current.path) newMap.set(current.path, current);
          folders.forEach(folder => {
            if (!newMap.has(folder.nodeId)) newMap.set(folder.nodeId, folder);
            if (folder.path) newMap.set(folder.path, folder);
          });
          return newMap;
        });

        return folders;
      } catch (error) {
        if (error.response?.status === HTTP_STATUS.NOT_FOUND) return [];
        console.error(`Failed to load folder children for ${nodeId}:`, error);
        return [];
      } finally {
        setLoadingNodeIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(nodeId);
          return newSet;
        });
        inFlightFolderLoadsRef.current.delete(cacheKey);
      }
    })();

    inFlightFolderLoadsRef.current.set(cacheKey, loadPromise);
    return loadPromise;
  }, [rootPath]);

  const loadAllSubfoldersRecursive = useCallback(async (parentNodeId) => {
    const expandedNodeIdsSet = new Set();
    const loadRecursive = async (nodeId) => {
      try {
        const children = await loadFolderChildren(nodeId);
        expandedNodeIdsSet.add(nodeId);
        for (const child of children) {
          await loadRecursive(child.nodeId);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (err) {}
    };
    await loadRecursive(parentNodeId);
    return expandedNodeIdsSet;
  }, [loadFolderChildren]);

  const initializeDialog = useCallback(async () => {
    if (enableExternalShare) {
      setLoadingAllFolders(false);
      return;
    }

    setFolderPermissions(new Map());
    setInitialFolderPermissions(new Map());
    setUserInfoMap(new Map());
    setExpandedNodeIds(new Set());
    setFolderTree(new Map());
    setLoadingNodeIds(new Set());
    setLoadingPermissions(false);
    setLoadingAllFolders(true);

    try {
      let resolvedRootNodeId = folderNodeIdProp;
      let resolvedBaseFolderNodeId = null;

      if (isReviewMode && permissionRequest) {
        resolvedRootNodeId = permissionRequest.file_node_id ?? resolvedRootNodeId;
      }
      if (isAdminMode && resolvedRootNodeId == null && startFromUserHome && username) {
        try {
          const resolved = await resolvePath(getUserBaseFolder({ username }));
          resolvedRootNodeId = resolved?.nodeId ?? null;
        } catch (error) {
          resolvedRootNodeId = null;
        }
        resolvedBaseFolderNodeId = resolvedRootNodeId;
      }
      if (resolvedRootNodeId == null && rootPath && rootPath !== '/') {
        try {
          const resolved = await resolvePath(rootPath);
          resolvedRootNodeId = resolved?.nodeId ?? null;
        } catch (error) {
          resolvedRootNodeId = null;
        }
      }

      setRootNodeId(resolvedRootNodeId);

      if (isAdminMode && resolvedBaseFolderNodeId == null && username) {
        try {
          const resolved = await resolvePath(getUserBaseFolder({ username }));
          resolvedBaseFolderNodeId = resolved?.nodeId ?? null;
        } catch (error) {
          resolvedBaseFolderNodeId = null;
        }
      }
      setBaseFolderNodeId(resolvedBaseFolderNodeId);

      const selectedFolder = {
        nodeId: resolvedRootNodeId,
        name: resolvedRootNodeId == null ? 'Root' : (folderName || 'Root'),
        path: rootPath,
        children: [],
      };
      setFolderTree(new Map([[resolvedRootNodeId, selectedFolder], [rootPath, selectedFolder]]));

      if (isAdminMode) {
        await loadFolderChildren(resolvedRootNodeId);
        const expandedNodeIdsSet = await loadAllSubfoldersRecursive(resolvedRootNodeId);
        setExpandedNodeIds(prev => new Set([...prev, ...expandedNodeIdsSet]));

        if (userId) {
          setLoadingPermissions(true);
          const permData = await sharePermissionGateway.getUserPermissions(userId);
          const newFolderPermissions = new Map();
          (permData || []).forEach(perm => {
            const permNodeId = perm.nodeId;
            if (permNodeId == null || !expandedNodeIdsSet.has(permNodeId)) return;
            if (!newFolderPermissions.has(permNodeId)) newFolderPermissions.set(permNodeId, new Map());
            newFolderPermissions.get(permNodeId).set(userId, perm.permission);
          });
          if (startFromUserHome && resolvedBaseFolderNodeId != null) {
            if (!newFolderPermissions.has(resolvedBaseFolderNodeId)) newFolderPermissions.set(resolvedBaseFolderNodeId, new Map());
            newFolderPermissions.get(resolvedBaseFolderNodeId).set(userId, PERMISSIONS.WRITE);
          }
          setFolderPermissions(newFolderPermissions);
          const deepCopied = new Map();
          newFolderPermissions.forEach((userPermMap, nodeId) => deepCopied.set(nodeId, new Map(userPermMap)));
          setInitialFolderPermissions(deepCopied);
          setLoadingPermissions(false);
        } else {
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      } else if (isReviewMode) {
        await loadFolderChildren(resolvedRootNodeId);
        const expandedNodeIdsSet = await loadAllSubfoldersRecursive(resolvedRootNodeId);
        expandedNodeIdsSet.add(resolvedRootNodeId);
        setExpandedNodeIds(expandedNodeIdsSet);

        setLoadingPermissions(true);
        try {
          const getPermissionPriority = (p) => (p === PERMISSIONS.ADMIN ? 3 : p === PERMISSIONS.WRITE ? 2 : p === PERMISSIONS.READ ? 1 : 0);
          const getHigherPermission = (a, b) => (getPermissionPriority(a) >= getPermissionPriority(b) ? a : b);
          const newFolderPermissions = new Map();
          const newUserInfoMap = new Map();

          try {
            const fileNodeId = permissionRequest?.targetType === 'file' ? permissionRequest.file_node_id : undefined;
            const permData = await sharePermissionGateway.getFolderPermissions(resolvedRootNodeId, fileNodeId);
            (permData || []).forEach(perm => {
              const permNodeId = perm.node_id;
              if (permNodeId == null) return;
              if (!newFolderPermissions.has(permNodeId)) newFolderPermissions.set(permNodeId, new Map());
              newFolderPermissions.get(permNodeId).set(perm.id, perm.permission);
              if (perm.id && perm.username) {
                newUserInfoMap.set(perm.id, {
                  username: perm.username,
                  email: perm.email || '',
                  is_admin: Boolean(perm.is_admin),
                });
              }
            });
          } catch (e) {
            console.log('Failed to load existing permissions:', e);
          }

          if (permissionRequest) {
            const requesterId = permissionRequest.requester_id;
            const requestedPermission = permissionRequest.requested_permission || PERMISSIONS.READ;
            if (!newFolderPermissions.has(resolvedRootNodeId)) newFolderPermissions.set(resolvedRootNodeId, new Map());
            const rootMap = newFolderPermissions.get(resolvedRootNodeId);
            const existing = rootMap.get(requesterId);
            rootMap.set(requesterId, existing ? getHigherPermission(existing, requestedPermission) : requestedPermission);
            expandedNodeIdsSet.forEach(subNodeId => {
              if (subNodeId === resolvedRootNodeId) return;
              if (!newFolderPermissions.has(subNodeId)) newFolderPermissions.set(subNodeId, new Map());
              const subMap = newFolderPermissions.get(subNodeId);
              const subExisting = subMap.get(requesterId);
              subMap.set(requesterId, subExisting ? getHigherPermission(subExisting, requestedPermission) : requestedPermission);
            });
            if (requesterId && permissionRequest.requester_username && !newUserInfoMap.has(requesterId)) {
              newUserInfoMap.set(requesterId, {
                username: permissionRequest.requester_username,
                email: '',
                is_admin: false,
              });
            }
          }

          setFolderPermissions(newFolderPermissions);
          const deepCopied = new Map();
          newFolderPermissions.forEach((userPermMap, nodeId) => deepCopied.set(nodeId, new Map(userPermMap)));
          setInitialFolderPermissions(deepCopied);
          setUserInfoMap(newUserInfoMap);
          setLoadingPermissions(false);
        } catch (error) {
          console.error('Failed to initialize review mode:', error);
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      } else {
        const selectedFolderNode = { nodeId: resolvedRootNodeId, name: folderName, path: rootPath, children: [] };
        setFolderTree(new Map([[resolvedRootNodeId, selectedFolderNode], [rootPath, selectedFolderNode]]));
        await loadFolderChildren(resolvedRootNodeId);
        const expandedNodeIdsSet = await loadAllSubfoldersRecursive(resolvedRootNodeId);
        expandedNodeIdsSet.add(resolvedRootNodeId);
        setExpandedNodeIds(expandedNodeIdsSet);

        setLoadingPermissions(true);
        try {
          const permData = await sharePermissionGateway.getFolderPermissions(resolvedRootNodeId);
          const newFolderPermissions = new Map();
          const newUserInfoMap = new Map();
          (permData || []).forEach(perm => {
            const permNodeId = perm.node_id;
            if (permNodeId == null) return;
            if (!newFolderPermissions.has(permNodeId)) newFolderPermissions.set(permNodeId, new Map());
            newFolderPermissions.get(permNodeId).set(perm.id, perm.permission);
            if (perm.id && perm.username) {
              newUserInfoMap.set(perm.id, {
                username: perm.username,
                email: perm.email || '',
                is_admin: Boolean(perm.is_admin),
              });
            }
          });
          setFolderPermissions(newFolderPermissions);
          const deepCopied = new Map();
          newFolderPermissions.forEach((userPermMap, nodeId) => deepCopied.set(nodeId, new Map(userPermMap)));
          setInitialFolderPermissions(deepCopied);
          setUserInfoMap(newUserInfoMap);
          setLoadingPermissions(false);
        } catch (error) {
          console.log('Failed to load folder permissions:', error);
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      }
    } catch (error) {
      console.error('Failed to initialize dialog:', error);
      setLoadingAllFolders(false);
      if (onMessage) onMessage({ text: t('dialogs.initFail'), type: 'error' });
    }
  }, [
    enableExternalShare,
    rootPath,
    isAdminMode,
    isReviewMode,
    userId,
    username,
    startFromUserHome,
    folderName,
    permissionRequest,
    folderNodeIdProp,
    loadFolderChildren,
    loadAllSubfoldersRecursive,
    setFolderPermissions,
    setInitialFolderPermissions,
    setUserInfoMap,
    setLoadingPermissions,
    onMessage,
    t,
  ]);

  useEffect(() => {
    if (open) {
      if (isShareMode || isReviewMode) loadUsers();
      initializeDialog();
    }
  }, [open, rootPath, isAdminMode, isShareMode, isReviewMode, userId, username, permissionRequest, folderNodeIdProp]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = useCallback(async (nodeId) => {
    const wasExpanded = expandedNodeIds.has(nodeId);
    setExpandedNodeIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) newSet.delete(nodeId);
      else newSet.add(nodeId);
      return newSet;
    });
    if (!wasExpanded) {
      const node = folderTree.get(nodeId);
      if (node && (!node.children || node.children.length === 0)) {
        await loadFolderChildren(nodeId);
      }
    }
  }, [expandedNodeIds, folderTree, loadFolderChildren]);

  const getAllSubfolderNodeIds = useCallback((nodeId) => {
    const subfolders = [];
    const node = folderTree.get(nodeId);
    if (!node || !node.children) return subfolders;
    const traverse = (currentNodeId) => {
      const currentNode = folderTree.get(currentNodeId);
      if (!currentNode || !currentNode.children) return;
      currentNode.children.forEach(child => {
        subfolders.push(child.nodeId);
        traverse(child.nodeId);
      });
    };
    traverse(nodeId);
    return subfolders;
  }, [folderTree]);

  const getUserName = useCallback((targetUserId) => {
    if (isAdminMode) return username;
    if (userInfoMap.has(targetUserId)) return userInfoMap.get(targetUserId).username;
    const u = users.find(us => us.id === targetUserId);
    return u ? u.username : '';
  }, [isAdminMode, username, userInfoMap, users]);

  const handleAddUser = useCallback((nodeId, targetUserId = null) => {
    if (isAdminMode) {
      if (!userId) return;
      const defaultPermission =
        isReviewMode && permissionRequest ? (permissionRequest.requested_permission || PERMISSIONS.READ) : PERMISSIONS.WRITE;
      const subfolders = getAllSubfolderNodeIds(nodeId);
      handleAddUserPermission(nodeId, userId, defaultPermission, subfolders);
    } else {
      setFolderMenuNodeId(nodeId);
      setFolderMenuView('selectUser');
    }
  }, [isAdminMode, isReviewMode, permissionRequest, userId, getAllSubfolderNodeIds, handleAddUserPermission]);

  const handleUserSelect = useCallback((selectedUserId) => {
    if (folderMenuNodeId == null) return;
    const defaultPermission =
      isReviewMode && permissionRequest ? (permissionRequest.requested_permission || PERMISSIONS.READ) : PERMISSIONS.WRITE;
    const subfolders = getAllSubfolderNodeIds(folderMenuNodeId);
    handleAddUserPermission(folderMenuNodeId, selectedUserId, defaultPermission, subfolders);
    const selectedUser = users.find(u => u.id === selectedUserId);
    if (selectedUser) {
      setUserInfoMap(prev => {
        const newMap = new Map(prev);
        newMap.set(selectedUserId, {
          username: selectedUser.username,
          email: selectedUser.email || '',
          is_admin: Boolean(selectedUser.is_admin),
        });
        return newMap;
      });
    }
    setFolderMenuView('manage');
  }, [folderMenuNodeId, isReviewMode, permissionRequest, users, getAllSubfolderNodeIds, handleAddUserPermission, setUserInfoMap]);

  const handleRemoveUser = useCallback((nodeId, targetUserId) => {
    const subfolders = getAllSubfolderNodeIds(nodeId);
    handleRemoveUserPermission(nodeId, targetUserId, subfolders);
  }, [getAllSubfolderNodeIds, handleRemoveUserPermission]);

  const handleTogglePermission = useCallback((nodeId, targetUserId) => {
    const subfolders = getAllSubfolderNodeIds(nodeId);
    handleToggleUserPermission(nodeId, targetUserId, subfolders);
  }, [getAllSubfolderNodeIds, handleToggleUserPermission]);

  const handleSave = useCallback(async () => {
    if (isAdminMode) {
      try {
        await adminPermissionSaveUseCase({
          userId,
          username,
          homeFolderNodeId: baseFolderNodeId,
          initialFolderPermissions,
          folderPermissions,
        });
        if (onSave) onSave();
        if (onMessage) onMessage({ text: t('dialogs.permissionSaveSuccess'), type: 'success' });
        onClose();
      } catch (error) {
        console.error('Failed to save permissions:', error);
        if (onMessage) onMessage({ text: t('dialogs.permissionSaveFail'), type: 'error' });
      }
    } else if (isReviewMode) {
      if (!permissionRequest || !permissionRequest.id) {
        if (onMessage) onMessage({ text: t('dialogs.noPermissionRequestInfo'), type: 'error' });
        return;
      }
      setSaving(true);
      try {
        await shareReviewUseCase({
          permissionRequestId: permissionRequest.id,
          initialNodePermissions: initialFolderPermissions,
          nodePermissions: folderPermissions,
        });
        if (onMessage) onMessage({ text: t('dialogs.permissionRequestApproved'), type: 'success' });
        if (onApprove) onApprove();
        onClose();
      } catch (error) {
        console.error('Failed to approve permission request:', error);
        const errorMsg = getServerErrorDisplay(error?.response?.data, t) || t('dialogs.permissionRequestApproveFail');
        if (onMessage) onMessage({ text: errorMsg, type: 'error' });
      } finally {
        setSaving(false);
      }
    } else {
      if (folderPermissions.size === 0) {
        if (onMessage) onMessage({ text: t('dialogs.selectFolderToShare'), type: 'error' });
        return;
      }
      setSaving(true);
      try {
        await sharePermissionSaveUseCase({
          initialNodePermissions: initialFolderPermissions,
          nodePermissions: folderPermissions,
        });
        if (onMessage) onMessage({ text: t('dialogs.folderShareSuccess'), type: 'success' });
        onClose();
      } catch (error) {
        console.error('Failed to share folder:', error);
        const errorMsg = getServerErrorDisplay(error?.response?.data, t) || t('dialogs.folderShareFail');
        if (onMessage) onMessage({ text: errorMsg, type: 'error' });
      } finally {
        setSaving(false);
      }
    }
  }, [
    isAdminMode,
    isReviewMode,
    username,
    userId,
    baseFolderNodeId,
    folderPermissions,
    initialFolderPermissions,
    permissionRequest,
    onSave,
    onMessage,
    onApprove,
    onClose,
    setSaving,
    t,
  ]);

  const handleClose = useCallback(() => {
    setFolderPermissions(new Map());
    setInitialFolderPermissions(new Map());
    setFolderTree(new Map());
    setExpandedNodeIds(new Set());
    setFolderMenuAnchor(null);
    setFolderMenuNodeId(null);
    setFolderMenuView('manage');
    setUserInfoMap(new Map());
    setRootNodeId(null);
    setBaseFolderNodeId(null);
    setExternalShareLink(null);
    setExternalShareExpiresInDays(14);
    setExternalShareUnlimited(false);
    setLinkCopied(false);
    onClose();
  }, [setFolderPermissions, setInitialFolderPermissions, setUserInfoMap, onClose]);

  return {
    rootPath,
    rootNodeId,
    baseFolderNodeId,
    isAdminMode,
    isShareMode,
    isReviewMode,
    users,
    folderTree,
    expandedNodeIds,
    loadingNodeIds,
    loadingAllFolders,
    folderMenuAnchor,
    setFolderMenuAnchor,
    folderMenuNodeId,
    setFolderMenuNodeId,
    folderMenuView,
    setFolderMenuView,
    externalShareLoading,
    setExternalShareLoading,
    externalShareLink,
    setExternalShareLink,
    externalShareExpiresInDays,
    setExternalShareExpiresInDays,
    externalShareUnlimited,
    setExternalShareUnlimited,
    linkCopied,
    setLinkCopied,
    loadFolderChildren,
    toggleExpand,
    getAllSubfolderNodeIds,
    getUserName,
    handleAddUser,
    handleUserSelect,
    handleRemoveUser,
    handleTogglePermission,
    handleSave,
    handleClose,
  };
}
