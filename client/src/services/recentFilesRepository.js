/**
 * Server-backed repository for user-specific recent files.
 *
 * This module isolates HTTP IO and notification triggering.
 * Recent entries are keyed by stable nodeId (server `fileNodeId`); paths are
 * display-only (`displayPath`).
 */
import { get, post, del } from './apiClient';
import { normalizePath } from '../utils/pathUtils';
import { notifyRecentFilesChange } from './recentFilesNotifier';

const asRecentEntry = (entry = {}) => {
  const displayPath = entry.displayPath ?? entry.display_path ?? entry.path ?? '';
  const name = entry.name || entry.basename || undefined;
  return {
    nodeId: entry.nodeId ?? entry.fileNodeId ?? null,
    name,
    type: entry.type || 'file',
    basename: entry.basename ?? entry.name ?? name,
    lastAccessed: entry.lastAccessed ?? null,
    path: displayPath ? normalizePath(displayPath) : '',
    displayPath: displayPath ? normalizePath(displayPath) : '',
  };
};

/**
 * @returns {Promise<Array<{nodeId: number|null, name?: string, type: 'file'|'directory', basename?: string, lastAccessed?: any, path: string, displayPath: string}>>}
 */
export const getRecentFiles = async () => {
  try {
    const response = await get('/recent-files');
    return Array.isArray(response?.data) ? response.data.map(asRecentEntry) : [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load recent files:', error);
    return [];
  }
};

/**
 * Persist a new recent entry. Server derives name/type from the nodeId.
 * @param {{nodeId: number}} file
 * @param {{silent?: boolean}} [options]
 * @returns {Promise<Array>}
 */
export const addRecentFile = async (file, options = {}) => {
  const silent = options?.silent === true;

  try {
    await post('/recent-files', { fileNodeId: file?.nodeId });

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
 * Remove a recent entry by nodeId.
 * @param {number} fileNodeId
 * @param {{silent?: boolean}} [options]
 * @returns {Promise<Array>}
 */
export const removeRecentFile = async (fileNodeId, options = {}) => {
  const silent = options?.silent === true;

  try {
    const response = await del(`/recent-files/${fileNodeId}`);
    const result = Array.isArray(response?.data) ? response.data.map(asRecentEntry) : [];

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
