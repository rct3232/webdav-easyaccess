import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export function deriveFolderPickerSharedState({ permissions } = {}) {
  const permissionMap = new Map();

  (Array.isArray(permissions) ? permissions : []).forEach((permission) => {
    if (permission?.nodeId == null) {
      return;
    }

    permissionMap.set(String(permission.nodeId), permission);
  });

  const sharedFolders = Array.from(permissionMap.entries()).map(([nodeIdStr, permission]) => ({
    nodeId: parseInt(nodeIdStr, 10),
    name: permission?.name || `Shared (${nodeIdStr})`,
    type: 'directory',
    size: 0,
    lastmodified: null,
    hasReadPermission: true,
    hasWritePermission:
      permission?.permission === PERMISSIONS.WRITE
      || permission?.permission === PERMISSIONS.ADMIN,
  }));

  return {
    sharedPermissionNodeIds: new Set(permissionMap.keys()),
    sharedFolderRoots: Array.from(permissionMap.keys()),
    sharedFolders,
  };
}
