const path = require('path');
const { normalizePath } = require('../utils/pathUtils');
const { isMetaPath } = require('../store/metaPaths');

function posixJoin(a, b) {
  const left = a === '/' ? '' : String(a || '');
  const right = String(b || '');
  const joined = path.posix.join(left, right);
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function defaultWebdavAdapter() {
  const { listDirectory, createDirectory, moveFile, copyFile, deleteFile, pathExists } = require('../utils/webdav');
  return { listDirectory, createDirectory, moveFile, copyFile, deleteFile, pathExists };
}

async function safeEnsureDir(webdav, dirPath) {
  const p = normalizePath(dirPath);
  try {
    const exists = await webdav.pathExists(p);
    if (exists) return;
  } catch {
    // ignore and try create
  }
  try {
    await webdav.createDirectory(p);
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (!msg.includes('already exists') && !msg.includes('exists')) {
      throw e;
    }
  }
}

/**
 * Selectively move/copy a directory tree (recursive_strict).
 *
 * - Only enter a directory if canEnterDirectory(dirPath) is true.
 * - Only transfer a file if canTransferFile(parentDirPath) is true.
 * - Skipped items are left untouched and returned in skippedPaths.
 *
 * Returns:
 * - movedDirMappings: directories that were fully moved (source removed) -> [{fromPrefix,toPrefix}]
 * - createdDirs: destination directories created
 * - skippedPaths: skipped directory/file paths
 */
async function selectiveTransfer({
  sourceRoot,
  destRoot,
  mode,
  canEnterDirectory,
  canTransferFile,
  webdav = defaultWebdavAdapter(),
} = {}) {
  if (mode !== 'move' && mode !== 'copy') {
    throw new Error(`Invalid mode: ${mode}`);
  }
  if (typeof canEnterDirectory !== 'function' || typeof canTransferFile !== 'function') {
    throw new Error('canEnterDirectory and canTransferFile are required');
  }

  const srcRoot = normalizePath(sourceRoot);
  const dstRoot = normalizePath(destRoot);

  if (isMetaPath(srcRoot) || isMetaPath(dstRoot)) {
    throw new Error('Access denied');
  }

  await safeEnsureDir(webdav, dstRoot);

  const createdDirsSet = new Set([dstRoot]);
  const skippedPaths = [];
  const movedDirMappings = [];

  async function transferFile(srcPath, dstPath) {
    if (mode === 'move') {
      await webdav.moveFile(srcPath, dstPath);
    } else {
      await webdav.copyFile(srcPath, dstPath);
    }
  }

  async function walkDir(srcDir, dstDir) {
    const items = await webdav.listDirectory(srcDir);
    let skippedCount = 0;

    for (const item of items) {
      if (!item?.basename) continue;
      if (item.basename === '.wea') continue;

      const srcChild = posixJoin(srcDir, item.basename);
      if (isMetaPath(srcChild)) continue;
      const dstChild = posixJoin(dstDir, item.basename);

      if (item.type === 'directory') {
        const ok = await canEnterDirectory(srcChild);
        if (!ok) {
          skippedPaths.push(srcChild);
          skippedCount++;
          continue;
        }

        await safeEnsureDir(webdav, dstChild);
        createdDirsSet.add(normalizePath(dstChild));

        const childResult = await walkDir(srcChild, dstChild);
        if (mode === 'move' && childResult.movedFully) {
          movedDirMappings.push({ fromPrefix: srcChild, toPrefix: dstChild });
        } else if (mode === 'move') {
          skippedCount++;
        }
      } else {
        const ok = await canTransferFile(srcDir);
        if (!ok) {
          skippedPaths.push(srcChild);
          skippedCount++;
          continue;
        }
        await transferFile(srcChild, dstChild);
      }
    }

    if (mode !== 'move') return { movedFully: false };
    if (skippedCount > 0) return { movedFully: false };

    try {
      await webdav.deleteFile(srcDir);
      return { movedFully: true };
    } catch {
      return { movedFully: false };
    }
  }

  const canEnterRoot = await canEnterDirectory(srcRoot);
  if (!canEnterRoot) {
    return {
      movedDirMappings: [],
      createdDirs: Array.from(createdDirsSet),
      skippedPaths: [srcRoot],
    };
  }

  const rootResult = await walkDir(srcRoot, dstRoot);
  if (mode === 'move' && rootResult.movedFully) {
    movedDirMappings.push({ fromPrefix: srcRoot, toPrefix: dstRoot });
  }

  return {
    movedDirMappings,
    createdDirs: Array.from(createdDirsSet),
    skippedPaths,
  };
}

module.exports = {
  selectiveTransfer,
};

