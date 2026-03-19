/**
 * Server-backed repository for user-specific recent files.
 *
 * This module isolates HTTP IO and notification triggering.
 */
import { get, post, del } from './apiClient';
import { normalizePath } from '../utils/pathUtils';
import { notifyRecentFilesChange } from './recentFilesNotifier';
import { updateSubPathsOnPathChange } from '../utils/recentFiles';

const asRecentEntry = (entry = {}) => {
  const normalizedPath = entry.path ? normalizePath(entry.path) : '';
  return {
    path: normalizedPath,
    name: entry.name || entry.basename || undefined,
    type: entry.type || 'file',
    basename: entry.basename ?? entry.name ?? undefined,
  };
};

/**
 * @returns {Promise<Array<{path: string, name?: string, type?: 'file'|'directory', basename?: string, lastAccessed?: any}>>}
 */
export const getRecentFiles = async () => {
  try {
    const response = await get('/recent-files');
    return Array.isArray(response?.data) ? response.data : [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load recent files:', error);
    return [];
  }
};

/**
 * Persist a new recent entry.
 * @param {{path: string, name?: string, type?: 'file'|'directory', basename?: string}} file
 * @param {{silent?: boolean}} [options]
 * @returns {Promise<Array>}
 */
export const addRecentFile = async (file, options = {}) => {
  const silent = options?.silent === true;

  try {
    const entry = asRecentEntry(file);
    const payload = {
      path: entry.path,
      name: entry.name,
      type: entry.type,
      basename: entry.basename,
    };

    await post('/recent-files', payload);

    if (silent) return [];

    const result = await getRecentFiles();
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save recent file:', error);
    if (silent) return [];

    try {
      return await getRecentFiles();
    } catch {
      return [];
    }
  }
};

/**
 * Remove a recent entry by exact path.
 * @param {string} filePath
 * @param {{silent?: boolean}} [options]
 * @returns {Promise<Array>}
 */
export const removeRecentFile = async (filePath, options = {}) => {
  const silent = options?.silent === true;

  try {
    const normalizedPath = normalizePath(filePath);
    const encodedPath = encodeURIComponent(normalizedPath);
    const response = await del(`/recent-files/${encodedPath}`);
    const result = Array.isArray(response?.data) ? response.data : [];

    if (!silent) notifyRecentFilesChange();
    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to remove recent file:', error);
    return [];
  }
};

/**
 * Clear all recent entries.
 * @returns {Promise<void>}
 */
export const clearRecentFiles = async () => {
  try {
    await del('/recent-files');
    notifyRecentFilesChange();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear recent files:', error);
  }
};

/**
 * Apply recent-file updates after rename.
 *
 * - For file renames: remove old exact path and add new exact path.
 * - For directory renames: use pure path-mutation planning helpers to update subpaths.
 *
 * @param {string} oldPath
 * @param {string} newPath
 * @param {{type?: 'file'|'directory', name?: string, basename?: string}} file
 * @returns {Promise<Array>}
 */
export const applyRecentFilesAfterRename = async (oldPath, newPath, file) => {
  try {
    if (file?.type !== 'directory') {
      await removeRecentFile(oldPath, { silent: true });

      await addRecentFile(
        {
          path: newPath,
          name: file?.name || file?.basename,
          type: file?.type || 'file',
          basename: file?.basename ?? file?.name,
        },
        { silent: true }
      );

      const result = await getRecentFiles();
      notifyRecentFilesChange();
      return result;
    }

    const recentEntries = await getRecentFiles();
    const plan = updateSubPathsOnPathChange(recentEntries, oldPath, newPath);

    // Apply removals/additions without triggering multiple notifications.
    for (const removedPath of plan.removedPaths) {
      await removeRecentFile(removedPath, { silent: true });
    }

    for (const entry of plan.addedEntries) {
      await addRecentFile(entry, { silent: true });
    }

    const result = await getRecentFiles();
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to update recent files after rename:', error);
    return [];
  }
};

/**
 * Apply recent-file updates after bulk delete.
 * @param {{ filePaths?: string[], folderPaths?: string[] }} params
 * @returns {Promise<Array>}
 */
export const applyRecentFilesAfterBulkDelete = async ({ filePaths = [], folderPaths = [] } = {}) => {
  if (!filePaths?.length && !folderPaths?.length) {
    return await getRecentFiles();
  }

  try {
    await post('/recent-files/remove-paths', {
      filePaths: filePaths || [],
      folderPaths: folderPaths || [],
    });

    const result = await getRecentFiles();
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clean up recent files after bulk delete:', error);
    return [];
  }
};

/**
 * Apply recent-file updates after bulk move.
 * @param {{oldPath: string, newPath: string, file?: {type?: 'file'|'directory', name?: string, basename?: string}}[]} moves
 * @returns {Promise<Array>}
 */
export const applyRecentFilesAfterBulkMove = async (moves = []) => {
  if (!moves || moves.length === 0) {
    return await getRecentFiles();
  }

  try {
    const payloadMoves = moves.map(({ oldPath, newPath, file }) => ({
      oldPath,
      newPath,
      file: file
        ? { type: file.type, name: file.name, basename: file.basename }
        : undefined,
    }));

    await post('/recent-files/apply-moves', { moves: payloadMoves });

    const result = await getRecentFiles();
    notifyRecentFilesChange();
    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to update recent files after bulk move:', error);
    return [];
  }
};

