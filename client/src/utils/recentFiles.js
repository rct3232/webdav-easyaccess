/**
 * Product utility: pure path-mutation helpers for recent entries.
 *
 * These functions do NOT perform IO or notifications. They only plan
 * which recent entries should be removed and which should be re-added
 * after path changes (rename/move/delete).
 */
import { normalizePath } from './pathUtils';

/**
 * @typedef {Object} RecentEntry
 * @property {string} path
 * @property {string=} name
 * @property {'file'|'directory'=} type
 * @property {string=} basename
 */

/**
 * @typedef {Object} RecentMutationPlan
 * @property {string[]} removedPaths
 * @property {RecentEntry[]} addedEntries
 */

const uniqueStrings = (values) => Array.from(new Set(values));

/**
 * Update recent entries under `oldPath` to point at `newPath`.
 *
 * - Any recent entry under (or equal to) `oldPath` becomes removed.
 * - For non-directory recent entries, a corresponding updated entry is added under `newPath`.
 * - Recent entries with `type === 'directory'` are NOT re-added.
 *
 * @param {RecentEntry[]} recentEntries
 * @param {string} oldPath
 * @param {string} newPath
 * @returns {RecentMutationPlan}
 */
export function updateSubPathsOnPathChange(recentEntries, oldPath, newPath) {
  if (!Array.isArray(recentEntries) || recentEntries.length === 0) {
    return { removedPaths: [], addedEntries: [] };
  }

  const normalizedOldPath = normalizePath(oldPath);
  const normalizedNewPath = normalizePath(newPath);

  if (normalizedOldPath === normalizedNewPath) {
    return { removedPaths: [], addedEntries: [] };
  }

  const oldPrefix = normalizedOldPath === '/' ? '/' : `${normalizedOldPath}/`;
  const removedPaths = [];
  const addedEntries = [];

  for (const entry of recentEntries) {
    if (!entry?.path) continue;

    const normalizedEntryPath = normalizePath(entry.path);
    const isUnderOldPath =
      normalizedEntryPath === normalizedOldPath ||
      normalizedEntryPath.startsWith(oldPrefix);

    if (!isUnderOldPath) continue;

    removedPaths.push(normalizedEntryPath);

    if (entry.type === 'directory') {
      continue;
    }

    const relativePart =
      normalizedEntryPath === normalizedOldPath
        ? ''
        : normalizedOldPath === '/'
          ? normalizedEntryPath
          : normalizedEntryPath.substring(normalizedOldPath.length);

    addedEntries.push({
      ...entry,
      path: normalizePath(normalizedNewPath + relativePart),
      type: entry.type || 'file',
      basename: entry.basename ?? entry.name,
    });
  }

  return {
    removedPaths: uniqueStrings(removedPaths),
    addedEntries,
  };
}

/**
 * Remove recent entries that are exactly `folderPath` or are inside it.
 *
 * @param {RecentEntry[]} recentEntries
 * @param {string} folderPath
 * @returns {{ removedPaths: string[] }}
 */
export function removeSubPathsOnFolderDelete(recentEntries, folderPath) {
  if (!Array.isArray(recentEntries) || recentEntries.length === 0) {
    return { removedPaths: [] };
  }

  const normalizedFolderPath = normalizePath(folderPath);
  const prefix = normalizedFolderPath === '/' ? '/' : `${normalizedFolderPath}/`;
  const removedPaths = [];

  for (const entry of recentEntries) {
    if (!entry?.path) continue;

    const normalizedEntryPath = normalizePath(entry.path);
    if (
      normalizedEntryPath === normalizedFolderPath ||
      normalizedEntryPath.startsWith(prefix)
    ) {
      removedPaths.push(normalizedEntryPath);
    }
  }

  return { removedPaths: uniqueStrings(removedPaths) };
}

/**
 * Remove only exact path matches after normalization.
 *
 * @param {RecentEntry[]} recentEntries
 * @param {string[]} filePaths
 * @returns {{ removedPaths: string[] }}
 */
export function removeMultiplePaths(recentEntries, filePaths) {
  if (!Array.isArray(recentEntries) || recentEntries.length === 0) {
    return { removedPaths: [] };
  }

  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { removedPaths: [] };
  }

  const normalizedTargets = new Set(filePaths.map((path) => normalizePath(path)));
  const removedPaths = [];

  for (const entry of recentEntries) {
    if (!entry?.path) continue;

    const normalizedEntryPath = normalizePath(entry.path);
    if (normalizedTargets.has(normalizedEntryPath)) {
      removedPaths.push(normalizedEntryPath);
    }
  }

  return { removedPaths: uniqueStrings(removedPaths) };
}
