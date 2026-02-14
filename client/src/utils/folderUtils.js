/**
 * Folder path utilities (e.g. collect folder + all subfolder paths).
 */
import { normalizePath } from './pathUtils';
import { listFiles } from '../services/fileService';

/**
 * Recursively collect folderPath and all subfolder paths under it.
 * @param {string} folderPath - Folder path
 * @returns {Promise<string[]>} [folderPath, ...subfolder paths]
 */
export async function collectSubfolderPaths(folderPath) {
  const paths = [];
  const normalized = normalizePath(folderPath);

  async function traverse(path) {
    try {
      const items = await listFiles(path);
      const dirs = (items || []).filter((item) => item.type === 'directory');
      for (const d of dirs) {
        const p = normalizePath(d.path);
        paths.push(p);
        await traverse(p);
      }
    } catch (err) {
      console.error('Failed to list path:', path, err);
    }
  }

  await traverse(normalized);
  return [normalized, ...paths];
}
