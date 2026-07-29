/**
 * Inheritance policy for permission checks.
 *
 * Rules:
 * 1. Read checks are direct-only — no ancestor traversal.
 * 2. Write checks allow parent-path fallback for files (file-level if present, else parent folder).
 * 3. Admin/owner bypass applies to both read and write.
 */

const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

/**
 * Determines whether a path should be treated as a directory.
 */
function isDirectoryPath(path) {
  return typeof path === 'string' && (path.endsWith('/') || path === '/');
}

/**
 * Normalizes the path for permission lookup, handling both slash and no-slash variants.
 * Returns an array of [normalizedWithSlash, normalizedWithoutSlash] if they differ,
 * otherwise just the single normalized path.
 */
function getLookupPaths(path, options = {}) {
  const opts = { isDirectory: false, ...options };
  const primary = normalizePath(path, opts.isDirectory ? { isDirectory: true } : undefined);
  
  if (opts.isDirectory) {
    const noSlash = normalizePath(path);
    return noSlash !== '/' && noSlash !== primary 
      ? [primary, noSlash] 
      : [primary];
  }
  
  return [primary];
}

/**
 * Checks whether a direct permission grant exists for the path (no inheritance).
 * Returns true if any lookup path matches.
 */
function isDirectPermission(userId, folderPath, requiredPermission) {
  // This is a policy marker — actual DB check happens in the store/model layer.
  const paths = getLookupPaths(folderPath, { isDirectory: true });
  return paths.some(p => p === folderPath || (folderPath !== '/' && normalizePath(folderPath) === p));
}

module.exports = {
  isDirectoryPath,
  getLookupPaths,
  isDirectPermission,
};
