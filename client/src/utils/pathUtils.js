/**
 * Utility functions for path manipulation
 */

/**
 * Normalize a path by:
 * - Ensuring it starts with /
 * - Removing trailing / (except for root)
 * - Replacing backslashes with forward slashes
 * - Removing duplicate slashes
 * 
 * @param {string} path - The path to normalize
 * @returns {string} The normalized path
 */
export const normalizePath = (path) => {
  if (!path) return '/';
  
  let normalized = path.trim();
  
  // Replace backslashes first
  normalized = normalized.replace(/\\/g, '/');
  
  // Ensure starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  
  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, '/');
  
  // Remove trailing / (except for root)
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  
  return normalized;
};

/**
 * Get parent path from current path
 * @param {string} currentPath - Current path
 * @returns {string} Parent path
 */
export const getParentPath = (currentPath) => {
  if (!currentPath || currentPath === '/' || currentPath === '/__shared__') {
    return '/';
  }

  const parts = currentPath.split('/').filter(Boolean);
  parts.pop(); // Remove last segment
  
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
};

/**
 * Check if path is root
 * @param {string} path - Path to check
 * @returns {boolean} True if root
 */
export const isRootPath = (path) => {
  return !path || path === '/' || path === '/__shared__';
};

/**
 * Get folder name from path
 * @param {string} path - Path
 * @returns {string} Folder name
 */
export const getFolderName = (path) => {
  if (!path || path === '/') return 'Root';
  if (path === '/__shared__') return '공유됨';
  
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'Root';
};

/**
 * Get file/folder name from path (without localization)
 * @param {string} path - Path
 * @returns {string} File/folder name
 */
export const getFileName = (path) => {
  if (!path) return '';
  return path.split('/').filter(Boolean).pop() || '';
};

/**
 * Split path into parts
 * @param {string} path - Path to split
 * @returns {string[]} Array of path parts
 */
export const getPathParts = (path) => {
  if (!path) return [];
  return path.split('/').filter(Boolean);
};

/**
 * Join path parts
 * @param {...string} parts - Path parts to join
 * @returns {string} Joined path
 */
export const joinPath = (...parts) => {
  const joined = parts
    .filter(Boolean)
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return '/' + joined;
};

/**
 * Check if childPath is a subpath of parentPath
 * @param {string} childPath - Potential child path
 * @param {string} parentPath - Potential parent path
 * @returns {boolean} True if childPath is under parentPath
 */
export const isSubPath = (childPath, parentPath) => {
  const normalizedChild = normalizePath(childPath);
  const normalizedParent = normalizePath(parentPath);
  
  if (normalizedParent === '/') return true;
  return normalizedChild.startsWith(normalizedParent + '/');
};
