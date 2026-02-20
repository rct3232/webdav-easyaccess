/**
 * Folder path utilities (e.g. collect folder + all subfolder paths).
 */
import { normalizePath } from './pathUtils';
import { listFiles } from '../services/fileService';

/**
 * Recursively collect folderPath and all subfolder paths under it.
 * Only includes paths we successfully list; excludes paths whose listFiles fails (per spec 2.5).
 * @param {string} folderPath - Folder path
 * @returns {Promise<string[]>} [folderPath, ...subfolder paths]
 */
export async function collectSubfolderPaths(folderPath) {
  const normalized = normalizePath(folderPath);

  async function traverse(path) {
    try {
      const items = await listFiles(path);
      const dirs = (items || []).filter((item) => item.type === 'directory');
      const collected = [path];
      for (const d of dirs) {
        const p = normalizePath(d.path);
        try {
          const sub = await traverse(p);
          collected.push(...sub);
        } catch (err) {
          console.error('Failed to list path:', p, err);
        }
      }
      return collected;
    } catch (err) {
      console.error('Failed to list path:', path, err);
      throw err;
    }
  }

  try {
    return await traverse(normalized);
  } catch {
    return [];
  }
}
