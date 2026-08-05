import { checkConflicts, getFilesMetadata, listByPath, listFiles, uploadMultipleFiles } from './fileService';
import { checkPermission, getUserPermissions, listFilePermissions } from './permissionService';
import { addRecentFile, getRecentFiles, removeRecentFile } from './recentFilesRepository';
import { onRecentFilesChange } from './recentFilesNotifier';
import { getShowHiddenFiles } from '../utils/localStorage';
import { filterOutUserOwnFolders } from '../utils/userUtils';

const hasAdminPermissionForNodeId = (itemNodeId, adminNodeIds) => {
  if (itemNodeId == null || adminNodeIds.length === 0) return false;
  return adminNodeIds.has(itemNodeId);
};

export const listDirectory = async ({ nodeId, path: targetPath, options = {} } = {}) => {
  // Support both Phase 4 nodeId-based calls and legacy path-based calls from useFileManager.
  // When called with { path, options: { shareToken, user } }, extract the nested values.
  const resolvedOpts = typeof options === 'object' && !Array.isArray(options) ? options : {};
  const extracted = resolvedOpts.shareToken || resolvedOpts.user ? resolvedOpts : (options || {});
  const { shareToken, showHiddenFiles, user } = extracted;

  const listParams = nodeId != null ? { nodeId } : (targetPath ? { path: targetPath } : {});
  let data;
  if (nodeId != null) {
    data = await listFiles(nodeId, shareToken ? { shareToken } : {});
  } else if (targetPath) {
    data = await listByPath(targetPath, shareToken ? { shareToken } : {});
  } else {
    data = await listFiles(undefined, shareToken ? { shareToken } : {});
  }

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

  const seenNodeIds = new Set();
  const folderEntries = sharedFolders.map((permission) => {
    const nodeId = permission.nodeId;
    if (seenNodeIds.has(nodeId)) return null;
    seenNodeIds.add(nodeId);
    return {
      nodeId,
      name: `node-${nodeId}`,
      basename: `node-${nodeId}`,
      type: 'directory',
      size: 0,
      lastmodified: null,
      hasReadPermission: true,
      hasWritePermission: permission.permission === 'write' || permission.permission === 'admin',
      hasAdminPermission: permission.permission === 'admin',
    };
  }).filter(Boolean);

  let fileOnlyEntries = [];
  try {
    const filePermissions = await listFilePermissions();
    if (Array.isArray(filePermissions) && filePermissions.length > 0) {
      fileOnlyEntries = filePermissions
        .filter(({ file_node_id: fileNodeId }) => !seenNodeIds.has(fileNodeId))
        .map(({ file_node_id: fileNodeId, permission }) => ({
          nodeId: fileNodeId,
          name: `file-${fileNodeId}`,
          basename: `file-${fileNodeId}`,
          type: 'file',
          size: 0,
          lastmodified: null,
          hasReadPermission: true,
          hasWritePermission: permission === 'write' || permission === 'admin',
          hasAdminPermission: permission === 'admin',
        }));
    }
  } catch (error) {
    console.error('[explorerGateway] Failed to load file-only shared permissions:', error);
  }

  if (fileOnlyEntries.length === 0) {
    return [...folderEntries];
  }

  try {
    const metadataList = await getEntriesMetadata({ entries: fileOnlyEntries });
    const metadataByNodeId = new Map(metadataList.map((m) => [m.nodeId, m]));
    fileOnlyEntries = fileOnlyEntries.map((entry) => {
      const metadata = metadataByNodeId.get(entry.nodeId);
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

export const checkConflictsForExplorer = async ({ operations, parentNodeId, files, options } = {}) => {
  if (Array.isArray(operations)) {
    return checkConflicts(operations, options);
  }
  if (Array.isArray(files) && files.length > 0) {
    const ops = files.map(f => ({
      sourceNodeId: f?.file?.nodeId || undefined,
      destinationParentNodeId: parentNodeId,
      fileName: f?.file?.name || f?.relativePath || 'unknown',
    }));
    return checkConflicts(ops, options);
  }
  return [];
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
