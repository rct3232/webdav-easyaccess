import { listFiles } from './fileService';
import { checkPermission, getUserPermissions } from './permissionService';
import { filterOutUserOwnFolders } from '../utils/userUtils';

/**
 * List directory entries for picker nodeIds (normal folders).
 * Preserves listFiles raw response shape; callers decide how to filter.
 */
export const listFolderContents = async ({ nodeId, options } = {}) => {
  return listFiles(nodeId, options || {});
};

/**
 * Check effective permission for a nodeId and return the same structure used by the picker hook.
 */
export const checkWritePermission = async ({ nodeId } = {}) => {
  return checkPermission(nodeId);
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

