/**
 * Utility functions for path manipulation
 */

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

