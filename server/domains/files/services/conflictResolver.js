const path = require('path');
const { getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { asyncLimitSettled } = require('../../../utils/asyncUtils');
const { conflictError } = require('../../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createFileStoreAdapter } = require('../../../infrastructure/adapters/filestore');
const { getComposition } = require('../../../service/composition');

async function isDirectoryPath(webdav, webdavPath) {
  try {
    await webdav.listDirectory(webdavPath);
    return true;
  } catch {
    try {
      if (!webdavPath.endsWith('/')) {
        await webdav.listDirectory(webdavPath + '/');
        return true;
      }
    } catch (_) {}
    try {
      if (webdavPath.endsWith('/') && webdavPath !== '/') {
        await webdav.listDirectory(webdavPath.slice(0, -1));
        return true;
      }
    } catch (_) {}
    return false;
  }
}

async function checkConflictsRecursive(sourcePath, destinationPath, conflicts = [], depth = 0, cache = {}, opts = {}, webdav = createFileStoreAdapter()) {
  const limit = opts.limit !== false;
  if (limit && (depth > 5 || conflicts.length > 100)) return conflicts;

  const getItems = async (p) => {
    if (cache[p] !== undefined) return cache[p];
    try {
      const items = await webdav.listDirectory(p);
      cache[p] = items;
      return items;
    } catch (e) {
      cache[p] = null;
      return null;
    }
  };

  const getExists = async (p) => {
    const key = `exists:${p}`;
    if (cache[key] !== undefined) return cache[key];
    const exists = await webdav.pathExists(p);
    cache[key] = exists;
    return exists;
  };

  const [sourceItems, destItems] = await Promise.all([
    getItems(sourcePath),
    getItems(destinationPath)
  ]);

  const isSourceDir = sourceItems !== null;
  const isDestDir = destItems !== null;

  if (!isDestDir) {
    const exists = await getExists(destinationPath);
    if (!exists) return conflicts;
  }

  if (!isDestDir) {
    conflicts.push({
      path: destinationPath,
      type: 'file',
      sourcePath: sourcePath
    });
  }

  if (limit && conflicts.length > 100) return conflicts;

  if (isSourceDir && isDestDir && sourceItems && destItems) {
    const destItemNames = new Set(destItems.map(item => item.basename));

    await Promise.all(sourceItems.map(async (item) => {
      if (limit && conflicts.length > 100) return;

      if (destItemNames.has(item.basename)) {
        const childSourcePath = sourcePath === '/' ? '/' + item.basename : sourcePath + '/' + item.basename;
        const childDestPath = destinationPath === '/' ? '/' + item.basename : destinationPath + '/' + item.basename;

        if (item.type === 'directory') {
          await checkConflictsRecursive(childSourcePath, childDestPath, conflicts, depth + 1, cache, opts, webdav);
        } else {
          conflicts.push({
            path: childDestPath,
            type: 'file',
            sourcePath: childSourcePath
          });
        }
      }
    }));
  }

  return conflicts;
}

async function getConflicts(operations, opts = {}, webdav = createFileStoreAdapter()) {
  const limit = opts.limit !== false;
  const conflicts = [];
  const cache = {};

  const getItems = async (p) => {
    if (cache[p] !== undefined) return cache[p];
    try {
      const items = await webdav.listDirectory(p);
      cache[p] = items;
      return items;
    } catch (e) {
      cache[p] = null;
      return null;
    }
  };

  const getExists = async (p) => {
    const key = `exists:${p}`;
    if (cache[key] !== undefined) return cache[key];
    const exists = await webdav.pathExists(p);
    cache[key] = exists;
    return exists;
  };

  const uploadOps = operations.filter(op => op.type === 'upload');
  const otherOps = operations.filter(op => op.type !== 'upload');

  await asyncLimitSettled(10, uploadOps, async (op) => {
    if (limit && conflicts.length > 100) return;
    const { sourcePath, destinationPath } = op;
    const parentPath = getParentPath(destinationPath);
    const fileName = path.posix.basename(destinationPath);
    const items = await getItems(parentPath);

    if (items) {
      const item = items.find(i => i.basename === fileName);
      if (item && item.type !== 'directory') {
        conflicts.push({
          path: destinationPath,
          type: 'file',
          sourcePath: sourcePath || destinationPath
        });
      }
    } else {
      const exists = await getExists(destinationPath);
      if (exists) {
        const isDir = await isDirectoryPath(webdav, destinationPath);
        if (!isDir) {
          conflicts.push({
            path: destinationPath,
            type: 'file',
            sourcePath: sourcePath || destinationPath
          });
        }
      }
    }
  });

  await asyncLimitSettled(5, otherOps, async (op) => {
    if (limit && conflicts.length > 100) return;
    await checkConflictsRecursive(op.sourcePath, op.destinationPath, conflicts, 0, cache, opts, webdav);
  });

  return conflicts;
}

async function handleSingleOpConflict(destPath, onConflict, webdav = createFileStoreAdapter()) {
  const destExists = await webdav.pathExists(destPath);
  if (!destExists) return 'none';
  const isDestDir = await isDirectoryPath(webdav, destPath);
  if (isDestDir) return 'none';
  if (onConflict === 'skip') return 'skip';
  if (onConflict !== 'overwrite') {
    throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
  }
  return 'overwrite';
}

async function getConflictsByNodeIds(operations, opts = {}) {
  const limit = opts.limit !== false;
  const conflicts = [];

  if (!Array.isArray(operations) || operations.length === 0) {
    return conflicts;
  }

  const { fileNodeService } = getComposition();

  for (const op of operations) {
    if (limit && conflicts.length > 100) break;

    try {
      let sourceNodeId, destinationParentNodeId, name;

      if (op.type === 'upload') {
        sourceNodeId = null;
        destinationParentNodeId = op.destinationParentNodeId;
        name = op.name;
      } else {
        sourceNodeId = op.sourceNodeId;
        destinationParentNodeId = op.destinationParentNodeId;
        name = null;
      }

      if (!destinationParentNodeId) continue;

      if (sourceNodeId && !name) {
        const sourceNode = await fileNodeService.getNode(sourceNodeId);
        if (sourceNode) {
          name = sourceNode.name;
        } else {
          continue;
        }
      }

      if (!name) continue;

      const children = await fileNodeService.listDirectory(destinationParentNodeId);
      const existingChild = children.find(c => c.name === name && c.type !== 'directory');

      if (existingChild) {
        conflicts.push({
          sourceNodeId: sourceNodeId || -1,
          destinationParentNodeId,
          conflictingNodeId: existingChild.id,
          name,
          type: op.type || 'move',
        });
      }
    } catch (_) {
      // Skip operations that fail (e.g., invalid nodeIds)
    }
  }

  return conflicts;
}

module.exports = {
  checkConflictsRecursive,
  getConflicts,
  handleSingleOpConflict,
  getConflictsByNodeIds,
};
