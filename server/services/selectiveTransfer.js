const path = require('path');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { isMetaPath } = require('../store/metaPaths');
const { asyncLimit } = require('../utils/asyncUtils');

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
  onConflict = 'error', // 'error', 'overwrite', 'skip'
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
    const exists = await webdav.pathExists(dstPath);
    if (exists) {
      if (onConflict === 'skip') {
        skippedPaths.push(srcPath);
        return false;
      } else if (onConflict === 'error') {
        throw new Error(`Conflict: Destination already exists: ${dstPath}`);
      }
      // 'overwrite' falls through to move/copy with Overwrite: 'T'
    }

    if (mode === 'move') {
      await webdav.moveFile(srcPath, dstPath, null, onConflict === 'overwrite', { isDirectory: false });
    } else {
      await webdav.copyFile(srcPath, dstPath, null, onConflict === 'overwrite', { isDirectory: false });
    }
    return true;
  }

  async function walkDir(srcDir, dstDir) {
    const items = await webdav.listDirectory(srcDir);
    let skippedCount = 0;

    // Process items in parallel with a concurrency limit
    const results = await asyncLimit(10, items, async (item) => {
      if (!item?.basename) return { skipped: false };
      if (item.basename === '.wea') return { skipped: false };

      const srcChild = posixJoin(srcDir, item.basename);
      if (isMetaPath(srcChild)) return { skipped: false };
      const dstChild = posixJoin(dstDir, item.basename);

      if (item.type === 'directory') {
        let ok = canEnterDirectory(srcChild);
        if (typeof ok?.then === 'function') ok = await ok;
        if (!ok) {
          skippedPaths.push(srcChild);
          return { skipped: true };
        }

        await safeEnsureDir(webdav, dstChild);
        createdDirsSet.add(normalizePath(dstChild));

        const childResult = await walkDir(srcChild, dstChild);
        if (mode === 'move' && childResult.movedFully) {
          movedDirMappings.push({ fromPrefix: srcChild, toPrefix: dstChild });
          return { skipped: false };
        } else {
          return { skipped: mode === 'move' };
        }
      } else {
        let ok = canTransferFile(srcDir);
        if (typeof ok?.then === 'function') ok = await ok;
        if (!ok) {
          skippedPaths.push(srcChild);
          return { skipped: true };
        }
        const transferred = await transferFile(srcChild, dstChild);
        return { skipped: !transferred };
      }
    });

    skippedCount = results.filter(r => r.skipped).length;

    if (mode !== 'move') return { movedFully: false };
    if (skippedCount > 0) return { movedFully: false };

    try {
      await webdav.deleteFile(srcDir, { isDirectory: true });
      return { movedFully: true };
    } catch {
      return { movedFully: false };
    }
  }

  let canEnterRoot = canEnterDirectory(srcRoot);
  if (typeof canEnterRoot?.then === 'function') canEnterRoot = await canEnterRoot;
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

