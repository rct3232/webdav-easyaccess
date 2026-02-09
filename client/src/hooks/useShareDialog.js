import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { PERMISSIONS, HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { normalizePath } from '../utils/pathUtils';
import { getUserBaseFolder } from '../utils/userUtils';
import { approvePermissionRequest } from '../services/permissionRequestService';

/**
 * ShareDialog 상태 및 API 로직 훅.
 * usePermissionManager와 함께 사용하며, 폴더 트리/사용자 목록/초기화/저장 로직을 담당.
 */
export function useShareDialog({
  open,
  mode,
  userId,
  username,
  startFromUserHome,
  folderPath,
  folderName,
  permissionRequest,
  enableExternalShare,
  onMessage,
  onSave,
  onApprove,
  onClose,
  // usePermissionManager에서 온 것
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
  const isAdminMode = mode === 'admin';
  const isShareMode = mode === 'share';
  const isReviewMode = mode === 'review';

  const rootPath = isAdminMode
    ? (startFromUserHome && username ? getUserBaseFolder({ username }) : '/')
    : (folderPath && folderPath !== '/' && folderPath.endsWith('/') ? folderPath.slice(0, -1) : (folderPath || '/'));

  const [users, setUsers] = useState([]);
  const [folderTree, setFolderTree] = useState(new Map());
  const [expandedPaths, setExpandedPaths] = useState(new Set([rootPath]));
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [loadingAllFolders, setLoadingAllFolders] = useState(false);
  const [folderMenuAnchor, setFolderMenuAnchor] = useState(null);
  const [folderMenuPath, setFolderMenuPath] = useState(null);
  const [folderMenuView, setFolderMenuView] = useState('manage');

  const [externalShareLoading, setExternalShareLoading] = useState(false);
  const [externalShareLink, setExternalShareLink] = useState(null);
  const [externalShareExpiresInDays, setExternalShareExpiresInDays] = useState(14);
  const [externalShareUnlimited, setExternalShareUnlimited] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const response = await axios.get('/api/users/approved');
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to load users:', error);
      if (onMessage) {
        onMessage({ text: '사용자 목록을 불러오는데 실패했습니다.', type: 'error' });
      }
    }
  }, [onMessage]);

  const loadFolderChildren = useCallback(async (path) => {
    if (loadingPaths.has(path)) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!loadingPaths.has(path)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });
    }

    setLoadingPaths(prev => new Set(prev).add(path));
    try {
      const response = await axios.get('/api/files/list', { params: { path } });
      const folders = response.data
        .filter(item => item.type === 'directory')
        .map(folder => ({
          path: folder.path,
          name: folder.basename || folder.name,
          children: [],
        }));

      setFolderTree(prev => {
        const newMap = new Map(prev);
        let current = newMap.get(path);
        if (!current) {
          current = {
            path,
            name: path === '/' ? 'Root' : path.split('/').filter(Boolean).pop() || 'Root',
            children: [],
          };
        }
        current.children = folders;
        newMap.set(path, current);
        folders.forEach(folder => {
          if (!newMap.has(folder.path)) newMap.set(folder.path, folder);
        });
        return newMap;
      });

      return folders;
    } catch (error) {
      if (error.response?.status === HTTP_STATUS.NOT_FOUND) return [];
      console.error(`Failed to load folder children for ${path}:`, error);
      return [];
    } finally {
      setLoadingPaths(prev => {
        const newSet = new Set(prev);
        newSet.delete(path);
        return newSet;
      });
    }
  }, [loadingPaths]);

  const loadAllSubfoldersRecursive = useCallback(async (parentPath) => {
    const expandedPathsSet = new Set();
    const allSubfolderPaths = [];
    const loadRecursive = async (path) => {
      try {
        const children = await loadFolderChildren(path);
        expandedPathsSet.add(path);
        for (const child of children) {
          allSubfolderPaths.push(child.path);
          await loadRecursive(child.path);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (err) {}
    };
    await loadRecursive(parentPath);
    return { expandedPathsSet, allSubfolderPaths };
  }, [loadFolderChildren]);

  const initializeDialog = useCallback(async () => {
    if (enableExternalShare) {
      setLoadingAllFolders(false);
      return;
    }

    setFolderPermissions(new Map());
    setInitialFolderPermissions(new Map());
    setUserInfoMap(new Map());
    setExpandedPaths(new Set([rootPath]));
    setFolderTree(new Map());
    setLoadingPaths(new Set());
    setLoadingPermissions(false);
    setLoadingAllFolders(true);

    try {
      if (isAdminMode) {
        const userBaseFolder = getUserBaseFolder({ username });
        await loadFolderChildren(rootPath);
        const { expandedPathsSet } = await loadAllSubfoldersRecursive(rootPath);
        setExpandedPaths(prev => new Set([...prev, ...expandedPathsSet]));

        if (userId) {
          setLoadingPermissions(true);
          const permResponse = await axios.get(`/api/users/${userId}/permissions`);
          const newFolderPermissions = new Map();
          permResponse.data.forEach(perm => {
            const normalizedPath = normalizePath(perm.folder_path);
            let shouldInclude = true;
            if (startFromUserHome) {
              shouldInclude = normalizedPath === userBaseFolder || normalizedPath.startsWith(userBaseFolder + '/');
            }
            if (shouldInclude) {
              if (!newFolderPermissions.has(normalizedPath)) newFolderPermissions.set(normalizedPath, new Map());
              newFolderPermissions.get(normalizedPath).set(userId, perm.permission);
            }
          });
          if (startFromUserHome) {
            if (!newFolderPermissions.has(userBaseFolder)) newFolderPermissions.set(userBaseFolder, new Map());
            newFolderPermissions.get(userBaseFolder).set(userId, PERMISSIONS.WRITE);
          }
          setFolderPermissions(newFolderPermissions);
          setLoadingPermissions(false);
        } else {
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      } else if (isReviewMode) {
        const selectedFolder = { path: rootPath, name: folderName, children: [] };
        setFolderTree(new Map([[rootPath, selectedFolder]]));
        await loadFolderChildren(rootPath);
        const { expandedPathsSet, allSubfolderPaths } = await loadAllSubfoldersRecursive(rootPath);
        expandedPathsSet.add(rootPath);
        setExpandedPaths(expandedPathsSet);

        setLoadingPermissions(true);
        try {
          const getPermissionPriority = (p) => (p === PERMISSIONS.ADMIN ? 3 : p === PERMISSIONS.WRITE ? 2 : p === PERMISSIONS.READ ? 1 : 0);
          const getHigherPermission = (a, b) => (getPermissionPriority(a) >= getPermissionPriority(b) ? a : b);
          const newFolderPermissions = new Map();
          const newUserInfoMap = new Map();

          try {
            const permResponse = await axios.get('/api/permissions/folder', {
              params: { path: rootPath, includeSubfolders: 'true' },
            });
            permResponse.data.forEach(perm => {
              const normalizedPath = normalizePath(perm.folder_path);
              if (!newFolderPermissions.has(normalizedPath)) newFolderPermissions.set(normalizedPath, new Map());
              newFolderPermissions.get(normalizedPath).set(perm.id, perm.permission);
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
            const normalizedRootPath = normalizePath(rootPath);
            if (!newFolderPermissions.has(normalizedRootPath)) newFolderPermissions.set(normalizedRootPath, new Map());
            const rootMap = newFolderPermissions.get(normalizedRootPath);
            const existing = rootMap.get(requesterId);
            rootMap.set(requesterId, existing ? getHigherPermission(existing, requestedPermission) : requestedPermission);
            allSubfolderPaths.forEach(subfolderPath => {
              const norm = normalizePath(subfolderPath);
              if (!newFolderPermissions.has(norm)) newFolderPermissions.set(norm, new Map());
              const subMap = newFolderPermissions.get(norm);
              const ex = subMap.get(requesterId);
              subMap.set(requesterId, ex ? getHigherPermission(ex, requestedPermission) : requestedPermission);
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
          newFolderPermissions.forEach((userPermMap, fp) => deepCopied.set(fp, new Map(userPermMap)));
          setInitialFolderPermissions(deepCopied);
          setUserInfoMap(newUserInfoMap);
          setLoadingPermissions(false);
        } catch (error) {
          console.error('Failed to initialize review mode:', error);
          setLoadingPermissions(false);
        }
        setLoadingAllFolders(false);
      } else {
        const selectedFolder = { path: rootPath, name: folderName, children: [] };
        setFolderTree(new Map([[rootPath, selectedFolder]]));
        await loadFolderChildren(rootPath);
        const { expandedPathsSet } = await loadAllSubfoldersRecursive(rootPath);
        expandedPathsSet.add(rootPath);
        setExpandedPaths(expandedPathsSet);

        setLoadingPermissions(true);
        try {
          const permResponse = await axios.get('/api/permissions/folder', {
            params: { path: rootPath, includeSubfolders: 'true' },
          });
          const newFolderPermissions = new Map();
          const newUserInfoMap = new Map();
          permResponse.data.forEach(perm => {
            const normalizedPath = normalizePath(perm.folder_path);
            if (!newFolderPermissions.has(normalizedPath)) newFolderPermissions.set(normalizedPath, new Map());
            newFolderPermissions.get(normalizedPath).set(perm.id, perm.permission);
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
          newFolderPermissions.forEach((userPermMap, fp) => deepCopied.set(fp, new Map(userPermMap)));
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
      if (onMessage) onMessage({ text: '다이얼로그 초기화에 실패했습니다.', type: 'error' });
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
    loadFolderChildren,
    loadAllSubfoldersRecursive,
    setFolderPermissions,
    setInitialFolderPermissions,
    setUserInfoMap,
    setLoadingPermissions,
    onMessage,
  ]);

  useEffect(() => {
    if (open) {
      if (isShareMode || isReviewMode) loadUsers();
      initializeDialog();
    }
  }, [open, rootPath, isAdminMode, isShareMode, isReviewMode, userId, username, permissionRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = useCallback(async (path) => {
    const wasExpanded = expandedPaths.has(path);
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) newSet.delete(path);
      else newSet.add(path);
      return newSet;
    });
    if (!wasExpanded) {
      const node = folderTree.get(path);
      if (node && (!node.children || node.children.length === 0)) {
        await loadFolderChildren(path);
      }
    }
  }, [expandedPaths, folderTree, loadFolderChildren]);

  const getAllSubfolderPaths = useCallback((folderPathArg) => {
    const subfolders = [];
    const node = folderTree.get(folderPathArg);
    if (!node || !node.children) return subfolders;
    const traverse = (path) => {
      const currentNode = folderTree.get(path);
      if (!currentNode) return;
      if (currentNode.children) {
        currentNode.children.forEach(child => {
          subfolders.push(child.path);
          traverse(child.path);
        });
      }
    };
    traverse(folderPathArg);
    return subfolders;
  }, [folderTree]);

  const getUserName = useCallback((targetUserId) => {
    if (isAdminMode) return username;
    if (userInfoMap.has(targetUserId)) return userInfoMap.get(targetUserId).username;
    const u = users.find(us => us.id === targetUserId);
    return u ? u.username : '';
  }, [isAdminMode, username, userInfoMap, users]);

  const handleAddUser = useCallback((folderPathArg, targetUserId = null) => {
    if (isAdminMode) {
      if (!userId) return;
      const defaultPermission =
        isReviewMode && permissionRequest ? (permissionRequest.requested_permission || PERMISSIONS.READ) : PERMISSIONS.WRITE;
      const subfolders = getAllSubfolderPaths(folderPathArg);
      handleAddUserPermission(folderPathArg, userId, defaultPermission, subfolders);
    } else {
      setFolderMenuPath(folderPathArg);
      setFolderMenuView('selectUser');
    }
  }, [isAdminMode, isReviewMode, permissionRequest, userId, getAllSubfolderPaths, handleAddUserPermission]);

  const handleUserSelect = useCallback((selectedUserId) => {
    if (!folderMenuPath) return;
    const defaultPermission =
      isReviewMode && permissionRequest ? (permissionRequest.requested_permission || PERMISSIONS.READ) : PERMISSIONS.WRITE;
    const subfolders = getAllSubfolderPaths(folderMenuPath);
    handleAddUserPermission(folderMenuPath, selectedUserId, defaultPermission, subfolders);
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
  }, [folderMenuPath, isReviewMode, permissionRequest, users, getAllSubfolderPaths, handleAddUserPermission, setUserInfoMap]);

  const handleRemoveUser = useCallback((folderPathArg, targetUserId) => {
    const subfolders = getAllSubfolderPaths(folderPathArg);
    handleRemoveUserPermission(folderPathArg, targetUserId, subfolders);
  }, [getAllSubfolderPaths, handleRemoveUserPermission]);

  const handleTogglePermission = useCallback((folderPathArg, targetUserId) => {
    const subfolders = getAllSubfolderPaths(folderPathArg);
    handleToggleUserPermission(folderPathArg, targetUserId, subfolders);
  }, [getAllSubfolderPaths, handleToggleUserPermission]);

  const handleSave = useCallback(async () => {
    if (isAdminMode) {
      try {
        const userBaseFolder = getUserBaseFolder({ username });
        const permissions = [];
        folderPermissions.forEach((userPermMap, fp) => {
          userPermMap.forEach((permission, targetUserId) => {
            if (targetUserId === userId) {
              permissions.push({
                folderPath: fp,
                permission: fp === userBaseFolder ? 'write' : permission,
              });
            }
          });
        });
        await axios.put(`/api/users/${userId}/permissions`, { permissions });
        if (onSave) onSave();
        if (onMessage) onMessage({ text: '권한이 저장되었습니다.', type: 'success' });
        onClose();
      } catch (error) {
        console.error('Failed to save permissions:', error);
        if (onMessage) onMessage({ text: '권한 저장에 실패했습니다.', type: 'error' });
      }
    } else if (isReviewMode) {
      if (!permissionRequest || !permissionRequest.id) {
        if (onMessage) onMessage({ text: '권한 신청 정보가 없습니다.', type: 'error' });
        return;
      }
      setSaving(true);
      try {
        const permissionsToRevoke = [];
        for (const [fp, initialUserPermMap] of initialFolderPermissions.entries()) {
          const currentUserPermMap = folderPermissions.get(fp);
          for (const [targetUserId] of initialUserPermMap.entries()) {
            if (!currentUserPermMap || !currentUserPermMap.has(targetUserId)) {
              permissionsToRevoke.push({ userId: targetUserId, folderPath: normalizePath(fp) });
            }
          }
        }
        for (const { userId: uid, folderPath: fp } of permissionsToRevoke) {
          try {
            await axios.delete('/api/permissions/revoke', {
              params: { userId: uid, folderPath: fp, includeSubfolders: 'true' },
            });
          } catch (e) {
            console.error(`Failed to revoke permission for ${fp}:`, e);
          }
        }
        for (const [fp, userPermMap] of folderPermissions.entries()) {
          const normalizedPath = normalizePath(fp);
          for (const [targetUserId, permission] of userPermMap.entries()) {
            await axios.post('/api/permissions/grant', {
              userId: targetUserId,
              folderPath: normalizedPath,
              permission,
            });
          }
        }
        await approvePermissionRequest(permissionRequest.id);
        if (onMessage) onMessage({ text: '권한 신청을 승인했습니다.', type: 'success' });
        if (onApprove) onApprove();
        onClose();
      } catch (error) {
        console.error('Failed to approve permission request:', error);
        const errorMsg = error.response?.data?.error || '권한 신청 승인에 실패했습니다.';
        if (onMessage) onMessage({ text: errorMsg, type: 'error' });
      } finally {
        setSaving(false);
      }
    } else {
      if (folderPermissions.size === 0) {
        if (onMessage) onMessage({ text: '공유할 폴더를 선택해주세요.', type: 'error' });
        return;
      }
      setSaving(true);
      try {
        const permissionsToRevoke = [];
        for (const [fp, initialUserPermMap] of initialFolderPermissions.entries()) {
          const currentUserPermMap = folderPermissions.get(fp);
          for (const [targetUserId] of initialUserPermMap.entries()) {
            if (!currentUserPermMap || !currentUserPermMap.has(targetUserId)) {
              permissionsToRevoke.push({ userId: targetUserId, folderPath: normalizePath(fp) });
            }
          }
        }
        for (const { userId: uid, folderPath: fp } of permissionsToRevoke) {
          try {
            await axios.delete('/api/permissions/revoke', {
              params: { userId: uid, folderPath: fp, includeSubfolders: 'true' },
            });
          } catch (e) {
            console.error(`Failed to revoke permission for ${fp}:`, e);
          }
        }
        for (const [fp, userPermMap] of folderPermissions.entries()) {
          const normalizedPath = normalizePath(fp);
          for (const [targetUserId, permission] of userPermMap.entries()) {
            await axios.post('/api/permissions/grant', {
              userId: targetUserId,
              folderPath: normalizedPath,
              permission,
            });
          }
        }
        if (onMessage) onMessage({ text: '폴더 공유가 완료되었습니다.', type: 'success' });
        onClose();
      } catch (error) {
        console.error('Failed to share folder:', error);
        const errorMsg = error.response?.data?.error || '폴더 공유에 실패했습니다.';
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
    folderPermissions,
    initialFolderPermissions,
    permissionRequest,
    onSave,
    onMessage,
    onApprove,
    onClose,
    setSaving,
  ]);

  const handleClose = useCallback(() => {
    setFolderPermissions(new Map());
    setInitialFolderPermissions(new Map());
    setFolderTree(new Map());
    setExpandedPaths(new Set());
    setFolderMenuAnchor(null);
    setFolderMenuPath(null);
    setFolderMenuView('manage');
    setUserInfoMap(new Map());
    setExternalShareLink(null);
    setExternalShareExpiresInDays(14);
    setExternalShareUnlimited(false);
    setLinkCopied(false);
    onClose();
  }, [setFolderPermissions, setInitialFolderPermissions, setUserInfoMap, onClose]);

  return {
    rootPath,
    isAdminMode,
    isShareMode,
    isReviewMode,
    users,
    folderTree,
    expandedPaths,
    loadingPaths,
    loadingAllFolders,
    folderMenuAnchor,
    setFolderMenuAnchor,
    folderMenuPath,
    setFolderMenuPath,
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
    getAllSubfolderPaths,
    getUserName,
    handleAddUser,
    handleUserSelect,
    handleRemoveUser,
    handleTogglePermission,
    handleSave,
    handleClose,
  };
}
