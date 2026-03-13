import { useState, useCallback } from 'react';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { normalizePath } from '../../../../utils/pathUtils';

/**
 * Hook for managing folder permissions in ShareDialog.
 */
export const usePermissionManager = ({
  mode,
  userId,
  username,
  permissionRequest,
  onMessage,
  onSave,
  onApprove,
  onClose,
}) => {
  const [folderPermissions, setFolderPermissions] = useState(new Map());
  const [initialFolderPermissions, setInitialFolderPermissions] = useState(new Map());
  const [userInfoMap, setUserInfoMap] = useState(new Map());
  const [saving, setSaving] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  const handleAddUserPermission = useCallback((folderPath, targetUserId, permission, subfolderPaths = []) => {
    setFolderPermissions(prev => {
      const newMap = new Map(prev);
      if (!newMap.has(folderPath)) {
        newMap.set(folderPath, new Map());
      }
      // Clone the inner map to ensure immutability
      const userPermMap = new Map(newMap.get(folderPath));
      newMap.set(folderPath, userPermMap);
      userPermMap.set(targetUserId, permission);

      // Apply to subfolders
      subfolderPaths.forEach(subPath => {
        const normalizedSubPath = normalizePath(subPath);
        const subUserPermMap = new Map(newMap.get(normalizedSubPath) || new Map());
        newMap.set(normalizedSubPath, subUserPermMap);
        subUserPermMap.set(targetUserId, permission);
      });
      return newMap;
    });
  }, []);

  const handleRemoveUserPermission = useCallback((folderPath, targetUserId, subfolderPaths = []) => {
    setFolderPermissions(prev => {
      const newMap = new Map(prev);
      
      const removePerm = (path) => {
        const userPermMap = newMap.get(path);
        if (userPermMap) {
          const newUserPermMap = new Map(userPermMap);
          newUserPermMap.delete(targetUserId);
          if (newUserPermMap.size === 0) {
            newMap.delete(path);
          } else {
            newMap.set(path, newUserPermMap);
          }
        }
      };

      removePerm(folderPath);

      // Remove from subfolders
      subfolderPaths.forEach(subPath => {
        removePerm(normalizePath(subPath));
      });
      return newMap;
    });
  }, []);

  const handleToggleUserPermission = useCallback((folderPath, targetUserId, subfolderPaths = []) => {
    setFolderPermissions(prev => {
      const newMap = new Map(prev);
      
      const togglePerm = (path, forcePermission = null) => {
        const userPermMap = newMap.get(path);
        if (userPermMap) {
          const newUserPermMap = new Map(userPermMap);
          const currentPermission = newUserPermMap.get(targetUserId) || PERMISSIONS.READ;
          const newPermission = forcePermission || (currentPermission === PERMISSIONS.READ ? PERMISSIONS.WRITE : PERMISSIONS.READ);
          newUserPermMap.set(targetUserId, newPermission);
          newMap.set(path, newUserPermMap);
          return newPermission;
        }
        return null;
      };

      const newPerm = togglePerm(folderPath);

      // Toggle in subfolders with the same permission
      if (newPerm) {
        subfolderPaths.forEach(subPath => {
          togglePerm(normalizePath(subPath), newPerm);
        });
      }
      return newMap;
    });
  }, []);

  const hasPermissionChanged = useCallback((folderPath) => {
    const currentPerms = folderPermissions.get(folderPath) || new Map();
    const initialPerms = initialFolderPermissions.get(folderPath) || new Map();

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
