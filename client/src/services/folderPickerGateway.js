import { listFiles } from './fileService';
import { checkPermission, getSharedPermissions } from './permissionService';
import { filterOutUserOwnFolders } from '../utils/userUtils';

const normalizeEntry = (item) => {
  if (!item || item.nodeId == null) return item;
  return {
    ...item,
    path: item.path ?? item.display_path ?? '',
    basename: item.basename ?? item.name ?? '',
    mime: item.mime ?? item.mimeType ?? null,
    lastmod: item.lastmod ?? item.modifiedAt ?? null,
    display_path: item.display_path ?? item.path ?? '',
  };
};

/**
 * List directory entries for picker nodeIds (normal folders).
 * Normalizes entries to the explorer shape (basename/name fallback) so the
 * picker dialog can render accessible item labels.
 */
export const listFolderContents = async ({ nodeId, options } = {}) => {
  const data = await listFiles(nodeId, options || {});
  return Array.isArray(data) ? data.map(normalizeEntry) : data;
};

/**
 * Check effective permission for a nodeId and return the same structure used by the picker hook.
 */
export const checkWritePermission = async ({ nodeId } = {}) => {
  return checkPermission(nodeId);
};

/**
 * Load shared-folder permissions for the picker’s “__shared__” root.
 * The server already excludes the user's own subtree; the client keeps a
 * root-level safety filter and returns only directory entries.
 */
export const getUserSharedFolderPermissions = async ({ user, options: _options } = {}) => {
  if (!user || !user.id || user.is_admin) return [];
  const data = await getSharedPermissions();
  const filtered = filterOutUserOwnFolders(data || [], user);
  return (Array.isArray(filtered) ? filtered : []).filter((perm) => perm.type === 'directory');
};

const folderPickerGateway = {
  listFolderContents,
  checkWritePermission,
  getUserSharedFolderPermissions,
};

export default folderPickerGateway;

