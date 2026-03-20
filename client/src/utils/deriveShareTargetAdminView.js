import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export function buildShareTargetAccessList({ permissions, isDirectory } = {}) {
  return (Array.isArray(permissions) ? permissions : [])
    .filter((permission) => !permission?.is_admin)
    .map((permission) => {
      if (isDirectory) {
        return {
          id: permission.id,
          username: permission.username || '',
          email: permission.email || '',
          permission: permission.permission || PERMISSIONS.READ,
        };
      }

      const pathPermission = permission.permission ?? null;
      const filePermission = permission.file_permission ?? null;

      return {
        id: permission.id,
        username: permission.username || '',
        email: permission.email || '',
        pathPermission,
        filePermission,
        permission: filePermission ?? pathPermission ?? PERMISSIONS.READ,
      };
    });
}

export function filterShareTargetUsers({ users, searchQuery } = {}) {
  const userList = Array.isArray(users) ? users : [];
  const normalizedQuery = searchQuery?.trim().toLowerCase();

  if (!normalizedQuery) {
    return userList;
  }

  return userList.filter((user) => {
    const username = user?.username?.toLowerCase() || '';
    const email = user?.email?.toLowerCase() || '';
    return username.includes(normalizedQuery) || email.includes(normalizedQuery);
  });
}

export function sortShareTargetAccessList(accessList = []) {
  return [...accessList].sort((left, right) => {
    if (left.permission === PERMISSIONS.ADMIN && right.permission !== PERMISSIONS.ADMIN) {
      return -1;
    }
    if (left.permission !== PERMISSIONS.ADMIN && right.permission === PERMISSIONS.ADMIN) {
      return 1;
    }
    return 0;
  });
}
