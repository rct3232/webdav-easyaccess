import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

import { normalizePath } from '../../../../../utils/pathUtils';

function getTopLevelSharedFolderRoots(permissionMap) {
  return Array.from(permissionMap.keys()).filter((normalizedPath) => {
    const pathParts = normalizedPath.split('/').filter(Boolean);
    for (let i = pathParts.length - 1; i > 0; i -= 1) {
      const parentPath = `/${pathParts.slice(0, i).join('/')}`;
      if (permissionMap.has(parentPath)) {
        return false;
      }
    }
    return true;
  });
}

export function deriveFolderPickerSharedState({ permissions } = {}) {
  const permissionMap = new Map();

  (Array.isArray(permissions) ? permissions : []).forEach((permission) => {
    if (!permission?.folder_path) {
      return;
    }

    permissionMap.set(normalizePath(permission.folder_path), permission);
  });

  const sharedFolderRoots = getTopLevelSharedFolderRoots(permissionMap);
  const sharedFolders = sharedFolderRoots.map((normalizedPath) => {
    const pathParts = normalizedPath.split('/').filter(Boolean);
    const name = pathParts[pathParts.length - 1] || normalizedPath;
    const permission = permissionMap.get(normalizedPath);

    return {
      path: normalizedPath,
      basename: name,
      name,
      type: 'directory',
      size: 0,
      lastmodified: null,
      hasReadPermission: true,
      hasWritePermission:
        permission?.permission === PERMISSIONS.WRITE
        || permission?.permission === PERMISSIONS.ADMIN,
    };
  });

  return {
    sharedPermissionPaths: new Set(permissionMap.keys()),
    sharedFolderRoots,
    sharedFolders,
  };
}
