import { listFiles } from './fileService';
import { checkPermission, getUserPermissions } from './permissionService';
import { filterOutUserOwnFolders } from '../utils/userUtils';

/**
 * List directory entries for picker paths (normal folders).
 * Preserves listFiles raw response shape; callers decide how to filter.
 */
export const listFolderContents = async ({ path, options } = {}) => {
  return listFiles(path, options || {});
};

/**
 * Check effective permission for a path and return the same structure used by the picker hook.
 */
export const checkWritePermission = async ({ path } = {}) => {
  return checkPermission(path);
};

/**
 * Load shared-folder permissions for the picker’s “__shared__” root.
 * Filters out folders owned by the current user.
 */
export const getUserSharedFolderPermissions = async ({ user, options } = {}) => {
  if (!user || !user.id || user.is_admin) return [];
  const data = await getUserPermissions(user.id, options);
  const filtered = filterOutUserOwnFolders(data || [], user);
  return Array.isArray(filtered) ? filtered : [];
};

const folderPickerGateway = {
  listFolderContents,
  checkWritePermission,
  getUserSharedFolderPermissions,
};

export default folderPickerGateway;

