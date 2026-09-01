/**
 * Path utility functions for WebDAV path normalization and manipulation.
 * Shared by server and client; options (isDirectory, treatAsRoot) allow environment-specific behavior.
 */

/**
 * Normalize a path by:
 * - Ensuring it starts with /
 * - Removing trailing / (except for root), unless options.isDirectory is true
 * - Replacing backslashes with forward slashes
 * - Removing duplicate slashes
 *
 * @param {string} path - The path to normalize
 * @param {object} [options] - Optional settings
 * @param {boolean} [options.isDirectory] - If true, ensure path ends with / (for directory paths)
 * @returns {string} The normalized path
 */
function normalizePath(path, options) {
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

  // Remove trailing / (except for root), unless isDirectory
  if (normalized !== '/' && normalized.endsWith('/') && !options?.isDirectory) {
    normalized = normalized.slice(0, -1);
  }

  // Add trailing / for directory paths
  if (options?.isDirectory && normalized !== '/' && !normalized.endsWith('/')) {
    normalized = normalized + '/';
  }

  return normalized;
}

/**
 * Get the parent path of a given path.
 * @param {string} path - The path to get parent from
 * @param {object} [options] - Optional settings
 * @param {string[]} [options.treatAsRoot] - Paths in this array are treated as roots; their parent is '/'
 * @returns {string} The parent path
 */
function getParentPath(path, options) {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';

  const treatAsRoot = options?.treatAsRoot;
  if (Array.isArray(treatAsRoot) && treatAsRoot.includes(normalized)) {
    return '/';
  }

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === 0) return '/';

  return normalized.substring(0, lastSlash);
}

/**
 * Check if path is root (empty, '/' or in treatAsRoot list).
 * @param {string} path - Path to check
 * @param {string[]} [treatAsRoot] - Paths to treat as root (e.g. ['/__shared__', '/__recent__'])
 * @returns {boolean} True if root
 */
function isRootPath(path, treatAsRoot) {
  if (!path || path === '/') return true;
  const normalized = normalizePath(path);
  if (Array.isArray(treatAsRoot) && treatAsRoot.includes(normalized)) {
    return true;
  }
  return false;
}

/**
 * Get the basename (last segment) of a path
 *
 * @param {string} path - The path to get basename from
 * @returns {string} The basename
 */
function getBasename(path) {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';

  const lastSlash = normalized.lastIndexOf('/');
  return normalized.substring(lastSlash + 1);
}

/**
 * Check if a path is under another path (child of parent)
 *
 * @param {string} childPath - The potential child path
 * @param {string} parentPath - The potential parent path
 * @returns {boolean} True if childPath is under parentPath
 */
function isPathUnder(childPath, parentPath) {
  const normalizedChild = normalizePath(childPath);
  const normalizedParent = normalizePath(parentPath);

  if (normalizedParent === '/') return true;

  return normalizedChild === normalizedParent || normalizedChild.startsWith(normalizedParent + '/');
}

/**
 * Get all parent paths from a given path (excluding the path itself)
 * Returns paths from immediate parent to root
 *
 * @param {string} path - The path to get parents from
 * @returns {string[]} Array of parent paths
 */
function getParentPaths(path) {
  const normalized = normalizePath(path);
  if (normalized === '/') return [];

  const parts = normalized.split('/').filter(Boolean);
  const parents = [];

  for (let i = parts.length - 1; i > 0; i--) {
    parents.push('/' + parts.slice(0, i).join('/'));
  }

  parents.push('/');
  return parents;
}

module.exports = {
  normalizePath,
  getParentPath,
  isRootPath,
  getBasename,
  isPathUnder,
  getParentPaths,
};
