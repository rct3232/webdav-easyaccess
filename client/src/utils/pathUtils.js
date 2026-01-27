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

