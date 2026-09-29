import {
  checkConflicts,
  getAncestors,
  getFilesMetadata,
  getTrashFiles,
  listFiles,
  uploadMultipleFiles,
} from './fileService';
import { checkPermission, getSharedPermissions } from './permissionService';
import { addRecentFile, getRecentFiles, removeRecentFile } from './recentFilesRepository';
import { onRecentFilesChange } from './recentFilesNotifier';
import {
  getLikedItems,
  getLikedNodeIds,
  setFileLike as repositorySetFileLike,
  subscribeFileLikesChange,
} from './fileLikesRepository';
import {
  addCollectionItems,
  archiveCollection,
  createCollection,
  deleteCollection,
  dismissMerge,
  getCollectionItems,
  getCollections,
  getGrants,
  getMemberships,
  getMergeSuggestions,
  grantCollection,
  mergeCollections,
  previewCollection,
  previewExistingCollection,
  publishItems,
  recordSearchClick,
  rejectMerge,
  removeCollectionItems,
  restoreCollection,
  acceptFileSuggestions,
  getActions,
  getFileSuggestions,
  revokeGrant,
  revokeOwnGrant,
  runSearch,
  undoAction,
  updateCollection,
} from './collectionsRepository';
import { onCollectionsChange } from './collectionsNotifier';
import { getShowHiddenFiles } from '../utils/localStorage';
import { filterOutUserOwnFolders } from '../utils/userUtils';

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
  const extracted = resolvedOpts.shareToken || resolvedOpts.user ? resolvedOpts : options || {};
  const { shareToken, showHiddenFiles, user } = extracted;

  const data = await listFiles(nodeId ?? null, shareToken ? { shareToken } : {});

  if (shareToken) {
    return Array.isArray(data) ? data.map(normalizeFileEntry) : [];
  }

  let files = Array.isArray(data) ? data.map(normalizeFileEntry) : [];
  const shouldShowHiddenFiles =
    typeof showHiddenFiles === 'boolean' ? showHiddenFiles : getShowHiddenFiles();

  if (!shouldShowHiddenFiles) {
    files = files.filter((item) => item?.isHidden !== true);
  }

  // T0.5 §3.3: the whole-viewer like read feeds `file.liked` on listing rows.
  // The repository read absorbs failures into `{ liked: [] }`, so the listing
  // never rejects on the like fetch.
  if (files.length > 0) {
    const likedIds = new Set(((await getLikedNodeIds()) || {}).liked ?? []);
    files = files.map((item) =>
      item?.nodeId != null ? { ...item, liked: likedIds.has(item.nodeId) } : item
    );
  }

  if (!user || user.is_admin || files.length === 0) {
    return files;
  }

  // hasAdminPermission is now computed server-side per listing row
  // (admin bypass || owner of the node || explicit admin grant — see
  // docs/spec/server/services/fileService.md). The gateway only normalizes it
  // to a boolean; it no longer recomputes it from getUserPermissions rows,
  // which under the "No self-grants" policy would hide the owner's admin
  // capability on their own folders.
  return files.map((item) =>
    item?.nodeId != null ? { ...item, hasAdminPermission: item.hasAdminPermission === true } : item
  );
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

/**
 * Load the caller-visible trashed rows for the trash view (DEF-16).
 * Hierarchical navigation: without `parentId` the server lists TOPMOST trashed
 * items; with `options.parentId` it lists the trashed children of that trashed
 * folder. Rows carry the trash contract fields including filecache-backed
 * `size` (no lastmod), so the trash listing renders name + type + size without
 * original-path/deleted-date subtitles.
 * @param {{ parentId?: number, limit?: number, offset?: number }} options
 */
export const loadTrashEntries = async (options = {}) => {
  const data = await getTrashFiles(options);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((item) => ({
    ...item,
    path: item.displayPath ?? '',
    display_path: item.displayPath ?? '',
    basename: item.name ?? '',
    hasReadPermission: item.hasReadPermission === true,
    hasWritePermission: item.hasWritePermission === true,
    hasAdminPermission: item.hasAdminPermission === true,
    isTrashed: true,
  }));
};

export const loadSharedEntries = async ({ user, options: _options = {} } = {}) => {
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

export const checkConflictsForExplorer = async ({
  operations,
  parentNodeId,
  files,
  options,
} = {}) => {
  if (Array.isArray(operations)) {
    return checkConflicts(operations, options);
  }
  if (Array.isArray(files) && files.length > 0) {
    const ops = files.map((f) => ({
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

export const removeExplorerRecentFile = async (nodeId, options) => {
  return removeRecentFile(nodeId, options);
};

export const subscribeToRecentFiles = (callback) => {
  return onRecentFilesChange(callback);
};

// -- Collections platform (T0.3; explorerGateway §2.6) — pass-through re-exports: //
// the repository's failure-absorption and notify-after-real-success semantics    //
// are preserved verbatim; payloads stay snake_case.                              //

export const loadCollections = (params) => getCollections(params);

export const loadCollectionItems = (id, params) => getCollectionItems(id, params);

export const subscribeToCollections = (callback) => {
  return onCollectionsChange(callback);
};

// -- Search results mode (T0.11; §2.6 search group) — names pass through      //
// unchanged: the collectionsRepository search seams (runSearch failure-       //
// absorption + recordSearchClick absorbed boolean; payloads stay snake_case). //

export { runSearch, recordSearchClick };
// Undo execution seam (actions.md; collectionsRepository.md §2.5 structured result).
export { undoAction };

// Actions feed + Storage dashboard seams (T0.10; routes/{actions,dashboard}.md) —
// repository absorbed-read/mutation shapes pass through verbatim.
export { getActions, getFileSuggestions, acceptFileSuggestions };

// -- File likes (T0.5; §2.6 file-likes group) — the fileLikesRepository       //
// absorbed-read fallback ({ liked: [] }), payload ∥ null mutation and         //
// notify-after-real-success fan-out pass through unchanged.                   //

export const loadFileLikes = () => getLikedNodeIds();

// P-5 Likes-surface cursor read (`fileLikesRepository.getLikedItems`).
export const loadLikedItems = (params) => getLikedItems(params);

export const setFileLike = (nodeId, liked, options) =>
  repositorySetFileLike(nodeId, liked, options);

export const subscribeToFileLikes = (callback) => subscribeFileLikesChange(callback);

/**
 * Narrow metadata helper: `POST /api/files/metadata` for raw nodeIds (no
 * listing entries — search result rows carry no `type` until enriched;
 * routes/search.md §2.4.2). Absorbed to `[]` on failure.
 */
export const loadNodesMetadata = async (nodeIds = []) => {
  try {
    return await getFilesMetadata(nodeIds);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[explorerGateway] Failed to load node metadata:', error);
    return [];
  }
};

/**
 * Ancestor chain (root → node, self last) for "Reveal original location".
 * Pass-through of `fileService.getAncestors` — rejects map to caller-visible
 * errors (gateway §2.3: structured, no UI here).
 */
export const loadNodeAncestors = (nodeId) => getAncestors(nodeId);

const explorerGateway = {
  addRecentFile: addExplorerRecentFile,
  getEntriesMetadata,
  getPathAccess,
  listDirectory,
  loadRecentFiles,
  loadSharedEntries,
  loadTrashEntries,
  removeRecentFile: removeExplorerRecentFile,
  canNavigateToNode,
  checkConflicts: checkConflictsForExplorer,
  subscribeToRecentFiles,
  uploadToPath,
  // Listing/render helpers (§2.6 narrow helpers)
  loadNodesMetadata,
  loadNodeAncestors,
  // Collections platform (§2.6 re-export group)
  loadCollections,
  createCollection,
  updateCollection,
  archiveCollection,
  restoreCollection,
  deleteCollection,
  loadCollectionItems,
  addCollectionItems,
  removeCollectionItems,
  publishItems,
  getMemberships,
  previewCollection,
  previewExistingCollection,
  getMergeSuggestions,
  mergeCollections,
  dismissMerge,
  rejectMerge,
  getGrants,
  grantCollection,
  revokeGrant,
  revokeOwnGrant,
  subscribeToCollections,
  // Search results mode (§2.6 search group)
  runSearch,
  recordSearchClick,
  undoAction,
  // Actions feed + Storage dashboard (T0.10 — §2.6 dashboard group)
  getActions,
  getFileSuggestions,
  acceptFileSuggestions,
  // File likes (§2.6 file-likes group)
  loadFileLikes,
  loadLikedItems,
  setFileLike,
  subscribeToFileLikes,
};

export default explorerGateway;
