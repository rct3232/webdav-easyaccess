import { listFiles } from './fileService';
import { getUserPermissions } from './permissionService';
import { getShowHiddenFiles } from '../utils/localStorage';
import { filterOutUserOwnFolders } from '../utils/userUtils';

/**
 * List directory children for expandable folder-tree nodes.
 * - Preserves existing folder-tree behavior (directories only, hidden-file filtering, sorting).
 */
export const listFolderChildren = async ({
  path,
  listFilesOptions = {},
  useHiddenFilesFilter = true,
  filterChildNames,
} = {}) => {
  const data = await listFiles(path, listFilesOptions || {});

  const showHiddenFiles = useHiddenFilesFilter ? getShowHiddenFiles() : true;

  let folders = (data || [])
    .filter((item) => item.type === 'directory')
    .filter((item) => showHiddenFiles || !item.isHidden)
    .map((item) => ({
      path: item.path,
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
 * Filters out folders owned by the current user.
 */
export const getUserSharedFolderPermissions = async ({ user, options } = {}) => {
  if (!user || !user.id || user.is_admin) return [];
  const data = await getUserPermissions(user.id, options);
  const filtered = filterOutUserOwnFolders(data || [], user);
  return Array.isArray(filtered) ? filtered : [];
};

const folderTreeGateway = {
  listFolderChildren,
  getUserSharedFolderPermissions,
};

export default folderTreeGateway;

