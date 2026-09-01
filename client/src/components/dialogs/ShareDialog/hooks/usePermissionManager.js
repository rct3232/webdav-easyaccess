import { useState, useCallback } from 'react';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

/**
 * Hook for managing node-based folder permissions in ShareDialog.
 */
export const usePermissionManager = (_config) => {
  const [folderPermissions, setFolderPermissions] = useState(new Map());
  const [initialFolderPermissions, setInitialFolderPermissions] = useState(new Map());
  const [userInfoMap, setUserInfoMap] = useState(new Map());
  const [saving, setSaving] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  const handleAddUserPermission = useCallback((nodeId, targetUserId, permission, subfolderNodeIds = []) => {
    setFolderPermissions(prev => {
      const newMap = new Map(prev);
      if (!newMap.has(nodeId)) {
        newMap.set(nodeId, new Map());
      }
      // Clone the inner map to ensure immutability
      const userPermMap = new Map(newMap.get(nodeId));
      newMap.set(nodeId, userPermMap);
      userPermMap.set(targetUserId, permission);

      // Apply to subfolders
      subfolderNodeIds.forEach(subNodeId => {
        const subUserPermMap = new Map(newMap.get(subNodeId) || new Map());
        newMap.set(subNodeId, subUserPermMap);
        subUserPermMap.set(targetUserId, permission);
      });
      return newMap;
    });
  }, []);

  const handleRemoveUserPermission = useCallback((nodeId, targetUserId, subfolderNodeIds = []) => {
    setFolderPermissions(prev => {
      const newMap = new Map(prev);
      
      const removePerm = (targetNodeId) => {
        const userPermMap = newMap.get(targetNodeId);
        if (userPermMap) {
          const newUserPermMap = new Map(userPermMap);
          newUserPermMap.delete(targetUserId);
          if (newUserPermMap.size === 0) {
            newMap.delete(targetNodeId);
          } else {
            newMap.set(targetNodeId, newUserPermMap);
          }
        }
      };

      removePerm(nodeId);

      // Remove from subfolders
      subfolderNodeIds.forEach(subNodeId => {
        removePerm(subNodeId);
      });
      return newMap;
    });
  }, []);

  const handleToggleUserPermission = useCallback((nodeId, targetUserId, subfolderNodeIds = []) => {
    setFolderPermissions(prev => {
      const newMap = new Map(prev);
      
      const togglePerm = (targetNodeId, forcePermission = null) => {
        const userPermMap = newMap.get(targetNodeId);
        if (userPermMap) {
          const newUserPermMap = new Map(userPermMap);
          const currentPermission = newUserPermMap.get(targetUserId) || PERMISSIONS.READ;
          const newPermission = forcePermission || (currentPermission === PERMISSIONS.READ ? PERMISSIONS.WRITE : PERMISSIONS.READ);
          newUserPermMap.set(targetUserId, newPermission);
          newMap.set(targetNodeId, newUserPermMap);
          return newPermission;
        }
        return null;
      };

      const newPerm = togglePerm(nodeId);

      // Toggle in subfolders with the same permission
      if (newPerm) {
        subfolderNodeIds.forEach(subNodeId => {
          togglePerm(subNodeId, newPerm);
        });
      }
      return newMap;
    });
  }, []);

  const hasPermissionChanged = useCallback((nodeId) => {
    const currentPerms = folderPermissions.get(nodeId) || new Map();
    const initialPerms = initialFolderPermissions.get(nodeId) || new Map();

    if (currentPerms.size !== initialPerms.size) return true;
    
    for (const [uid, permission] of currentPerms.entries()) {
      if (initialPerms.get(uid) !== permission) return true;
    }
    
    for (const [uid] of initialPerms.entries()) {
      if (!currentPerms.has(uid)) return true;
    }
    
    return false;
  }, [folderPermissions, initialFolderPermissions]);

  return {
    folderPermissions,
    setFolderPermissions,
    initialFolderPermissions,
    setInitialFolderPermissions,
    userInfoMap,
    setUserInfoMap,
    saving,
    setSaving,
    loadingPermissions,
    setLoadingPermissions,
    handleAddUserPermission,
    handleRemoveUserPermission,
    handleToggleUserPermission,
    hasPermissionChanged,
  };
};
