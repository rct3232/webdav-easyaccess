const path = require('path');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { isMetaPath } = require('../../../store/metaPaths');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');
const { createFileStoreAdapter } = require('../../../infrastructure/adapters/filestore');

function posixJoin(a, b) {
  const left = a === '/' ? '' : String(a || '');
  const right = String(b || '');
  const joined = path.posix.join(left, right);
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function defaultWebdavAdapter() {
  return createFileStoreAdapter();
}

/**
 * Collect downloadable files under a directory recursively (recursive_strict).
 *
 * - Only enter a directory if canEnterDirectory(dirPath) is true.
 * - Only include a file if canIncludeFile(filePath) is true (filePath = full path of the file to include).
 *
 * Returns:
 * - files: [{ path, relativePath }]
 * - skippedPaths: skipped directory/file paths
 */
async function selectiveCollectFiles({
  rootPath,
  basePath = '',
  canEnterDirectory,
  canIncludeFile,
  webdav = defaultWebdavAdapter(),
} = {}) {
  if (typeof canEnterDirectory !== 'function' || typeof canIncludeFile !== 'function') {
    throw createError(SERVER_ERROR_CODES.selectiveTransfer.callbacksRequired, 400);
  }

  const root = normalizePath(rootPath);
  if (isMetaPath(root)) {
    throw createError(SERVER_ERROR_CODES.selectiveTransfer.accessDenied, 403);
  }

  const files = [];
  const skippedPaths = [];

  let canEnterRoot = canEnterDirectory(root);
  if (typeof canEnterRoot?.then === 'function') canEnterRoot = await canEnterRoot;
  if (!canEnterRoot) {
    return { files, skippedPaths: [root] };
  }

  async function walkDir(dirPath, relBase) {
    const items = await webdav.listDirectory(dirPath);
    for (const item of items) {
      if (!item?.basename) continue;
      if (item.basename === '.wea') continue;

      const childPath = posixJoin(dirPath, item.basename);
      if (isMetaPath(childPath)) continue;
      const childRel = relBase ? `${relBase}/${item.basename}` : item.basename;

      if (item.type === 'directory') {
        let ok = canEnterDirectory(childPath);
        if (typeof ok?.then === 'function') ok = await ok;
        if (!ok) {
          skippedPaths.push(childPath);
          continue;
        }
        await walkDir(childPath, childRel);
      } else {
        let ok = canIncludeFile(childPath);
        if (typeof ok?.then === 'function') ok = await ok;
        if (!ok) {
          skippedPaths.push(childPath);
          continue;
        }
        files.push({ path: childPath, relativePath: childRel });
      }
    }
  }

  await walkDir(root, basePath || '');
  return { files, skippedPaths };
}

module.exports = {
  selectiveCollectFiles,
};
