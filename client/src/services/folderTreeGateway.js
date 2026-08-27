import { listFiles } from './fileService';
import { getSharedPermissions } from './permissionService';
import { getShowHiddenFiles } from '../utils/localStorage';
import { filterOutUserOwnFolders } from '../utils/userUtils';

/**
 * List directory children for expandable folder-tree nodes.
 * - Preserves existing folder-tree behavior (directories only, hidden-file filtering, sorting).
 */
export const listFolderChildren = async ({
  nodeId,
  listFilesOptions = {},
  useHiddenFilesFilter = true,
  filterChildNames,
} = {}) => {
  const data = await listFiles(nodeId, listFilesOptions || {});

  const showHiddenFiles = useHiddenFilesFilter ? getShowHiddenFiles() : true;

  let folders = (data || [])
    .filter((item) => item.type === 'directory')
    .filter((item) => showHiddenFiles || !item.isHidden)
    .map((item) => ({
      nodeId: item.nodeId,
      name: item.basename || item.name,
      hasReadPermission: item.hasReadPermission,
      hasWritePermission: item.hasWritePermission,
      isHidden: item.isHidden,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (filterChildNames && filterChildNames.length > 0) {
    const set = new Set(filterChildNames);
    folders = folders.filter((f) => !set.has(f.name));
  }

  return folders;
};

/**
 * Load shared-folder permissions for the folder-tree “__shared__” section.
 * The server already excludes the user's own subtree; the client keeps a
 * root-level safety filter and returns only directory entries.
 */
export const getUserSharedFolderPermissions = async ({ user, options } = {}) => {
  if (!user || !user.id || user.is_admin) return [];
  const data = await getSharedPermissions();
  const filtered = filterOutUserOwnFolders(data || [], user);
  return (Array.isArray(filtered) ? filtered : []).filter((perm) => perm.type === 'directory');
};

const folderTreeGateway = {
  listFolderChildren,
  getUserSharedFolderPermissions,
};

export default folderTreeGateway;

