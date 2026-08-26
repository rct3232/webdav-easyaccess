import { checkConflicts, getFilesMetadata, listFiles, uploadMultipleFiles } from './fileService';
import { checkPermission, getSharedPermissions, getUserPermissions } from './permissionService';
import { addRecentFile, getRecentFiles, removeRecentFile } from './recentFilesRepository';
import { onRecentFilesChange } from './recentFilesNotifier';
import { getShowHiddenFiles } from '../utils/localStorage';
import { filterOutUserOwnFolders } from '../utils/userUtils';

const hasAdminPermissionForNodeId = (itemNodeId, adminNodeIds) => {
  if (itemNodeId == null || adminNodeIds.length === 0) return false;
  return adminNodeIds.has(itemNodeId);
};

const normalizeFileEntry = (item) => {
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

export const listDirectory = async ({ nodeId, options = {} } = {}) => {
  const resolvedOpts = typeof options === 'object' && !Array.isArray(options) ? options : {};
  const extracted = resolvedOpts.shareToken || resolvedOpts.user ? resolvedOpts : (options || {});
  const { shareToken, showHiddenFiles, user } = extracted;

  const data = await listFiles(nodeId ?? null, shareToken ? { shareToken } : {});

  if (shareToken) {
    return Array.isArray(data) ? data.map(normalizeFileEntry) : [];
  }

  let files = Array.isArray(data) ? data.map(normalizeFileEntry) : [];
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
        .map((permission) => permission.nodeId)
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

export const canNavigateToNode = async (nodeId, options) => {
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

  const permissions = await getSharedPermissions();
  const sharedFolders = filterOutUserOwnFolders(permissions || [], user);

  const seenNodeIds = new Set();
  const folderEntries = [];
  const fileEntries = [];

  sharedFolders.forEach((permission) => {
    const nodeId = permission.nodeId;
    if (seenNodeIds.has(nodeId)) return;
    seenNodeIds.add(nodeId);
    const base = {
      nodeId,
      name: permission.name || `node-${nodeId}`,
      basename: permission.name || `node-${nodeId}`,
      size: 0,
      lastmodified: null,
      hasReadPermission: true,
      hasWritePermission: permission.permission === 'write' || permission.permission === 'admin',
      hasAdminPermission: permission.permission === 'admin',
    };
    if (permission.type === 'file') {
      fileEntries.push({ ...base, type: 'file' });
    } else {
      folderEntries.push({ ...base, type: 'directory' });
    }
  });

  if (fileEntries.length > 0) {
    try {
      const metadataList = await getEntriesMetadata({ entries: fileEntries });
      const metadataByNodeId = new Map(metadataList.map((m) => [m.nodeId, m]));
      fileEntries.forEach((entry, index) => {
        const metadata = metadataByNodeId.get(entry.nodeId);
        if (!metadata) return;
        fileEntries[index] = {
          ...entry,
          size: metadata.size != null ? metadata.size : 0,
          lastmod: metadata.lastmod ?? null,
          mime: metadata.mime ?? null,
        };
      });
    } catch (error) {
      console.error('[explorerGateway] Failed to load metadata for shared file entries:', error);
    }
  }

  return [...folderEntries, ...fileEntries];
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
  canNavigateToNode,
  checkConflicts: checkConflictsForExplorer,
  subscribeToRecentFiles,
  uploadToPath,
};

export default explorerGateway;
