const path = require('path');
const { normalizePath } = require('../utils/pathUtils');
const { isMetaPath } = require('../store/metaPaths');
const { asyncLimit } = require('../utils/asyncUtils');

function posixJoin(a, b) {
  const left = a === '/' ? '' : String(a || '');
  const right = String(b || '');
  const joined = path.posix.join(left, right);
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function defaultWebdavAdapter() {
  const { listDirectory, deleteFile } = require('../utils/webdav');
  return { listDirectory, deleteFile };
}

/**
 * Selectively delete a directory tree (recursive_strict).
 *
 * - Only enter/delete a directory if canEnterDirectory(dirPath) is true.
 * - Only delete a file if canDeleteFileByParent(parentDirPath) is true.
 * - Skipped items are left intact and returned in skippedPaths.
 *
 * Returns:
 * - deletedPaths: paths successfully deleted (files and directories)
 * - deletedDirPrefixes: directories successfully deleted (useful for ACL cleanup)
 * - skippedPaths: skipped directory/file paths
 */
async function selectiveDelete({
  rootPath,
  canEnterDirectory,
  canDeleteFileByParent,
  webdav = defaultWebdavAdapter(),
  allowMetaPath = false,
} = {}) {
  if (typeof canEnterDirectory !== 'function' || typeof canDeleteFileByParent !== 'function') {
    throw new Error('canEnterDirectory and canDeleteFileByParent are required');
  }

  const root = normalizePath(rootPath);
  if (isMetaPath(root) && !allowMetaPath) {
    throw new Error('Access denied');
  }

  const deletedPaths = [];
  const deletedDirPrefixes = [];
  const skippedPaths = [];

  const canEnterRoot = await canEnterDirectory(root);
  if (!canEnterRoot) {
    return { deletedPaths, deletedDirPrefixes, skippedPaths: [root] };
  }

  async function walkDir(dirPath) {
    const items = await webdav.listDirectory(dirPath);
    
    // Track items that couldn't be deleted
    const results = await asyncLimit(10, items, async (item) => {
      if (!item?.basename) return { skipped: false };
      if (item.basename === '.wea' && !allowMetaPath) return { skipped: false };

      const childPath = posixJoin(dirPath, item.basename);
      if (isMetaPath(childPath) && !allowMetaPath) return { skipped: false };

      if (item.type !== 'directory') {
        const ok = await canDeleteFileByParent(dirPath);
        if (!ok) {
          skippedPaths.push(childPath);
          return { skipped: true };
        }
        try {
          await webdav.deleteFile(childPath);
          deletedPaths.push(childPath);
          return { skipped: false };
        } catch {
          skippedPaths.push(childPath);
          return { skipped: true };
        }
      } else {
        const ok = await canEnterDirectory(childPath);
        if (!ok) {
          skippedPaths.push(childPath);
          return { skipped: true };
        }

        const childFullyDeleted = await walkDir(childPath);
        return { skipped: !childFullyDeleted };
      }
    });

    const hadSkipOrFailure = results.some(r => r.skipped);

    // Critical: Never delete a directory if anything in its subtree was skipped or failed.
    if (hadSkipOrFailure) {
      return false;
    }

    try {
      await webdav.deleteFile(dirPath);
      deletedPaths.push(dirPath);
      deletedDirPrefixes.push(dirPath);
      return true;
    } catch {
      return false;
    }
  }

  await walkDir(root);

  return { deletedPaths, deletedDirPrefixes, skippedPaths };
}

module.exports = {
  selectiveDelete,
};

