import { checkConflicts, getFilesMetadata, listFiles, uploadMultipleFiles } from './fileService';
import { checkPermission, getUserPermissions, listFilePermissions } from './permissionService';
import { addRecentFile, getRecentFiles, removeRecentFile } from './recentFilesRepository';
import { onRecentFilesChange } from './recentFilesNotifier';
import { getShowHiddenFiles } from '../utils/localStorage';
import { normalizePath, getBasename, getParentPath } from '../utils/pathUtils';
import { filterOutUserOwnFolders } from '../utils/userUtils';

const hasAdminPermissionForNodeId = (itemNodeId, adminNodeIds) => {
  if (itemNodeId == null || adminNodeIds.length === 0) return false;
  return adminNodeIds.has(itemNodeId);
};

export const listDirectory = async ({ nodeId, options = {} } = {}) => {
  const {
    shareToken,
    showHiddenFiles,
    user,
  } = options;

  const data = await listFiles(nodeId, shareToken ? { shareToken } : {});

  if (shareToken) {
    return Array.isArray(data) ? data : [];
  }

  let files = Array.isArray(data) ? data : [];
  const shouldShowHiddenFiles = typeof showHiddenFiles === 'boolean'
    ? showHiddenFiles
    : getShowHiddenFiles();

  if (!shouldShowHiddenFiles) {
    files = files.filter((item) => item?.isHidden !== true);
  }

  if (!user || user.is_admin || files.length === 0) {
    return files;
  }

  try {
    const permissions = await getUserPermissions(user.id);
    const adminNodeIds = new Set(
      (permissions || [])
        .filter((permission) => permission.permission === 'admin')
        .map((permission) => permission.node_id)
    );

    return files.map((item) => (
      item?.nodeId != null
        ? { ...item, hasAdminPermission: hasAdminPermissionForNodeId(item.nodeId, adminNodeIds) }
        : item
    ));
  } catch (error) {
    console.error('[explorerGateway] Failed to load admin prefixes for listing:', error);
    return files;
  }
};

export const getPathAccess = async ({ nodeId, options = {} } = {}) => {
  const permission = await checkPermission(nodeId, options);
  return {
    canRead: permission?.hasRead === true,
    canWrite: permission?.hasWrite === true,
    raw: permission,
  };
};

export const canNavigateToPath = async (nodeId, options) => {
  const access = await getPathAccess({ nodeId, options });
  return access.canRead;
};

export const getEntriesMetadata = async ({ entries = [], options = {} } = {}) => {
  const nodeIds = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.type === 'file' && entry?.nodeId != null)
    .map((entry) => entry.nodeId);

  return getFilesMetadata(nodeIds, options);
};

export const loadRecentFiles = async (options) => {
  return getRecentFiles(options);
};

export const loadSharedEntries = async ({ user, options = {} } = {}) => {
  if (!user?.id) {
    return [];
  }

  const permissions = await getUserPermissions(user.id, options);
  const sharedFolders = filterOutUserOwnFolders(permissions || [], user);

  const permissionPaths = new Map();
  sharedFolders.forEach((permission) => {
    const normalizedPath = normalizePath(permission.folder_path);
    permissionPaths.set(normalizedPath, permission);
  });

  const topLevelFolders = Array.from(permissionPaths.entries()).filter(([normalizedPath]) => {
    const pathParts = normalizedPath.split('/').filter(Boolean);
    for (let index = pathParts.length - 1; index > 0; index -= 1) {
      const parentPath = `/${pathParts.slice(0, index).join('/')}`;
      if (permissionPaths.has(parentPath)) {
        return false;
      }
    }
    return true;
  });

  const folderEntries = topLevelFolders.map(([normalizedPath, permission]) => {
    const name = getBasename(normalizedPath) || normalizedPath;
    return {
      path: normalizedPath,
      basename: name,
      name,
      type: 'directory',
      size: 0,
      lastmodified: null,
      hasReadPermission: true,
      hasWritePermission: permission.permission === 'write' || permission.permission === 'admin',
      hasAdminPermission: permission.permission === 'admin',
    };
  });

  let fileOnlyEntries = [];
  try {
    const filePermissions = await listFilePermissions();
    if (Array.isArray(filePermissions) && filePermissions.length > 0) {
      fileOnlyEntries = filePermissions
        .filter(({ filePath }) => {
          const normalizedPath = normalizePath(filePath);
          const parentPath = getParentPath(normalizedPath);
          return parentPath !== undefined && parentPath !== null && !permissionPaths.has(parentPath);
        })
        .map(({ filePath, permission }) => {
          const normalizedPath = normalizePath(filePath);
          const name = getBasename(normalizedPath) || normalizedPath;
          return {
            path: normalizedPath,
            basename: name,
            name,
            type: 'file',
            size: 0,
            lastmodified: null,
            hasReadPermission: true,
            hasWritePermission: permission === 'write' || permission === 'admin',
            hasAdminPermission: permission === 'admin',
          };
        });
    }
  } catch (error) {
    console.error('[explorerGateway] Failed to load file-only shared permissions:', error);
  }

  if (fileOnlyEntries.length === 0) {
    return [...folderEntries];
  }

  try {
    const metadataList = await getEntriesMetadata({ entries: fileOnlyEntries });
    const metadataByPath = new Map(metadataList.map((metadata) => [metadata.path, metadata]));
    fileOnlyEntries = fileOnlyEntries.map((entry) => {
      const metadata = metadataByPath.get(entry.path);
      if (!metadata) return entry;
      return {
        ...entry,
        size: metadata.size != null ? metadata.size : 0,
        lastmod: metadata.lastmod ?? null,
        mime: metadata.mime ?? null,
      };
    });
  } catch (error) {
    console.error('[explorerGateway] Failed to load metadata for shared file entries:', error);
  }

  return [...folderEntries, ...fileOnlyEntries];
};

export const checkConflictsForExplorer = async ({ operations, options } = {}) => {
  return checkConflicts(Array.isArray(operations) ? operations : [], options);
};

export const uploadToPath = async ({
  parentNodeId,
  files = [],
  onProgress,
  onConflict = 'error',
  options,
} = {}) => {
  return uploadMultipleFiles(files, parentNodeId, onProgress, onConflict, options);
};

export const addExplorerRecentFile = async (file, options) => {
  return addRecentFile(file, options);
};

export const removeExplorerRecentFile = async (path, options) => {
  return removeRecentFile(path, options);
};

export const subscribeToRecentFiles = (callback) => {
  return onRecentFilesChange(callback);
};

const explorerGateway = {
  addRecentFile: addExplorerRecentFile,
  getEntriesMetadata,
  getPathAccess,
  listDirectory,
  loadRecentFiles,
  loadSharedEntries,
  removeRecentFile: removeExplorerRecentFile,
  canNavigateToPath,
  checkConflicts: checkConflictsForExplorer,
  subscribeToRecentFiles,
  uploadToPath,
};

export default explorerGateway;
