const express = require('express');
const router = express.Router();
const multer = require('multer');
const archiver = require('archiver');
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
const {
  listDirectory,
  getFileContents,
  putFileContents,
  deleteFile,
  moveFile,
  copyFile,
  isImageFile,
  isVideoFile,
  pathExists,
} = require('../utils/webdav');
const { getThumbnailUrl } = require('../utils/thumbnail');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { normalizePath, getParentPath, getBasename } = require('@webdav-easyaccess/shared/pathUtils');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const {
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  hasDirectFolderPermission,
  isOwnerPath,
  getHomeOwnerUserIdForPath,
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncWriteFileByParentChecker,
} = require('../utils/permissionPolicy');
const { selectiveTransfer } = require('../services/selectiveTransfer');
const { selectiveCollectFiles } = require('../services/selectiveDownload');
const { selectiveDelete } = require('../services/selectiveDelete');
const { isMetaPath } = require('../store/metaPaths');
const { createJob, getJob, setJobCancelled, updateJob } = require('../store/bulkJobStore');
const { asyncLimitSettled, asyncLimitSettledWithCancel } = require('../utils/asyncUtils');
const path = require('path');
const requireUser = require('../middleware/requireUser');
const { checkMetaPathAccess } = require('../middleware/metaPathGuard');
const normalizePathParam = require('../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError, notFoundError, conflictError } = require('../utils/errorHandler');

const downloadProgress = new Map();
const operationProgress = new Map();

async function isDirectoryPath(webdavPath) {
  try {
    await listDirectory(webdavPath);
    return true;
  } catch (error) {
    // Try with/without trailing slash (WebDAV servers can differ)
    try {
      if (!webdavPath.endsWith('/')) {
        await listDirectory(webdavPath + '/');
        return true;
      }
    } catch (_) {
      // ignore
    }
    try {
      if (webdavPath.endsWith('/') && webdavPath !== '/') {
        await listDirectory(webdavPath.slice(0, -1));
        return true;
      }
    } catch (_) {
      // ignore
    }
    return false;
  }
}

async function hasDirectFolderWritePermission(userId, folderPath) {
  return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.WRITE);
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  preservePath: true,
});

async function checkConflictsRecursive(sourcePath, destinationPath, conflicts = [], depth = 0, cache = {}, opts = {}) {
  const limit = opts.limit !== false;
  if (limit && (depth > 5 || conflicts.length > 100)) return conflicts;

  const getItems = async (p) => {
    if (cache[p] !== undefined) return cache[p];
    try {
      const items = await listDirectory(p);
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
    const exists = await pathExists(p);
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

  // conflict에 파일만 포함 (폴더는 conflict로 처리하지 않음)
  if (!isDestDir) {
    conflicts.push({
      path: destinationPath,
      type: 'file',
      sourcePath: sourcePath
    });
  }

  if (limit && conflicts.length > 100) return conflicts;

  // If both are directories, check children
  if (isSourceDir && isDestDir && sourceItems && destItems) {
    const destItemNames = new Set(destItems.map(item => item.basename));

    const itemResults = await Promise.all(sourceItems.map(async (item) => {
      if (limit && conflicts.length > 100) return;

      if (destItemNames.has(item.basename)) {
        const childSourcePath = sourcePath === '/' ? '/' + item.basename : sourcePath + '/' + item.basename;
        const childDestPath = destinationPath === '/' ? '/' + item.basename : destinationPath + '/' + item.basename;
        
        if (item.type === 'directory') {
          await checkConflictsRecursive(childSourcePath, childDestPath, conflicts, depth + 1, cache, opts);
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

async function getConflicts(operations, opts = {}) {
  const limit = opts.limit !== false;
  const conflicts = [];
  const cache = {};

  const getItems = async (p) => {
    if (cache[p] !== undefined) return cache[p];
    try {
      const items = await listDirectory(p);
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
    const exists = await pathExists(p);
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
        const isDir = await isDirectoryPath(destinationPath);
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
    await checkConflictsRecursive(op.sourcePath, op.destinationPath, conflicts, 0, cache, opts);
  });

  return conflicts;
}

async function runBulkJobWorker(jobId) {
  const job = getJob(jobId);
  if (!job || job.status !== 'pending') return;
  updateJob(jobId, { status: 'running' });

  const userId = job.userId;
  let user;
  try {
    user = await User.findById(userId);
    if (!user) {
      updateJob(jobId, { status: 'failed', errorMessage: 'User not found' });
      return;
    }
    user = user.toObject ? user.toObject() : user;
  } catch (e) {
    updateJob(jobId, { status: 'failed', errorMessage: e.message });
    return;
  }

  const doc = await Permission.getPermissionDoc(userId);
  const canWriteDirSync = buildSyncWriteChecker(user, doc);
  const canWriteFileByParentSync = buildSyncWriteFileByParentChecker(user, doc);
  const canReadDirSync = buildSyncReadChecker(user, doc);

  const getJobRef = () => getJob(jobId);
  const pushResult = (entry) => {
    const j = getJobRef();
    if (j) {
      j.results.push(entry);
      j.progress = j.results.length;
    }
  };

  try {
    if (job.operation === 'delete') {
      const paths = job.payload.paths || [];
      const allDeletedDirPrefixes = new Set();
      const settled = await asyncLimitSettledWithCancel(
        5,
        paths,
        async (filePath) => {
          if (!filePath || typeof filePath !== 'string') {
            pushResult({ path: filePath, status: 'failed', error: 'Invalid path' });
            return;
          }
          try {
            const normalizedTargetPath = normalizePath(filePath);
            const isDir = await isDirectoryPath(filePath);
            const hasPermission = isDir
              ? canWriteDirSync(normalizedTargetPath)
              : canWriteFileByParentSync(normalizedTargetPath);
            if (!hasPermission) {
              pushResult({ path: filePath, status: 'skipped' });
              return;
            }
            if (user.is_admin) {
              try {
                await listDirectory(filePath);
                const normalizedPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
                const pathParts = normalizedPath.split('/').filter(Boolean);
                if (pathParts.length === 1) {
                  const folderUsername = pathParts[0];
                  const folderUser = await User.findByUsername(folderUsername);
                  if (folderUser) {
                    pushResult({ path: filePath, status: 'skipped' });
                    return;
                  }
                }
              } catch (dirError) {
                // proceed
              }
            }
            if (isDir) {
              if (user.is_admin || isOwnerPath(user, normalizedTargetPath)) {
                await deleteFile(filePath, { isDirectory: true });
                try {
                  await Permission.revokePermissionsPrefixForAllUsers([normalizedTargetPath]);
                  allDeletedDirPrefixes.add(normalizedTargetPath);
                } catch (permError) {
                  console.error('Failed to revoke permissions after direct directory deletion:', permError);
                }
                pushResult({ path: filePath, status: 'succeeded' });
                return;
              }
              const canEnterDirectory = (dirPath) => canWriteDirSync(dirPath);
              const canDeleteFileByParent = (parentDir) => canWriteDirSync(parentDir);
              const result = await selectiveDelete({
                rootPath: normalizedTargetPath,
                canEnterDirectory,
                canDeleteFileByParent,
                allowMetaPath: user.is_admin && isMetaPath(normalizedTargetPath),
              });
              try {
                const prefixes = (result.deletedDirPrefixes || []).map((p) => normalizePath(p));
                if (prefixes.length > 0) {
                  await Permission.revokePermissionsPrefixForAllUsers(prefixes);
                  prefixes.forEach(p => allDeletedDirPrefixes.add(p));
                }
              } catch (permError) {
                console.error('Failed to revoke permissions after directory deletion:', permError);
              }
              pushResult({ path: filePath, status: 'succeeded' });
              if (result.skippedPaths && result.skippedPaths.length > 0) {
                result.skippedPaths.forEach(p => pushResult({ path: p, status: 'skipped' }));
              }
            } else {
              await deleteFile(filePath, { isDirectory: false });
              pushResult({ path: filePath, status: 'succeeded' });
            }
          } catch (error) {
            console.error(`Failed to delete ${filePath}:`, error);
            const errorStatus = error.status || error.response?.status;
            if (errorStatus === 403 || errorStatus === 401) {
              pushResult({ path: filePath, status: 'skipped' });
            } else {
              pushResult({ path: filePath, status: 'failed', error: error.message || 'Unknown error' });
            }
          }
        },
        () => (getJobRef() && getJobRef().cancelled)
      );
      const finalJob = getJobRef();
      if (finalJob) {
        updateJob(jobId, { status: finalJob.cancelled ? 'cancelled' : 'completed' });
      }
      return;
    }

    if (job.operation === 'move') {
      const { moves, onConflict } = job.payload;
      let movesToProcess = moves || [];
      if (onConflict === 'skip') {
        const operations = (moves || []).map(m => ({
          sourcePath: m.sourcePath,
          destinationPath: m.destinationPath,
          type: 'move',
        }));
        const conflicts = await getConflicts(operations, { limit: false });
        const conflictPaths = new Set(
          conflicts.filter(c => c.type === 'file').map(c => normalizePath(c.path))
        );
        moves.filter(m => conflictPaths.has(normalizePath(m.destinationPath))).forEach(m => {
          pushResult({ sourcePath: m.sourcePath, destinationPath: m.destinationPath, status: 'skippedByConflict' });
        });
        movesToProcess = moves.filter(m => !conflictPaths.has(normalizePath(m.destinationPath)));
      }
      const settled = await asyncLimitSettledWithCancel(
        1,
        movesToProcess,
        async (move) => {
          const { sourcePath, destinationPath } = move;
          if (!sourcePath || !destinationPath) {
            pushResult({
              sourcePath: sourcePath || 'unknown',
              destinationPath: destinationPath || 'unknown',
              status: 'failed',
              error: 'Source and destination paths are required',
            });
            return;
          }
          try {
            const normalizedSourcePath = normalizePath(sourcePath);
            const normalizedDestinationPath = normalizePath(destinationPath);
            const isSourceDir = await isDirectoryPath(sourcePath);
            const hasSourcePermission = isSourceDir
              ? canWriteDirSync(normalizedSourcePath)
              : canWriteFileByParentSync(normalizedSourcePath);
            if (!hasSourcePermission) {
              pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
              return;
            }
            const destParentPath = getParentPath(normalizedDestinationPath);
            if (!canWriteDirSync(destParentPath)) {
              pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
              return;
            }
            const conflictStatus = await handleSingleOpConflict(destinationPath, onConflict || 'error');
            if (conflictStatus === 'skip') {
              pushResult({ sourcePath, destinationPath, status: 'skippedByConflict' });
              return;
            }
            if (isSourceDir) {
              const canEnterDirectory = (dirPath) => canWriteDirSync(dirPath);
              const canTransferFile = (parentDir) => canWriteDirSync(parentDir);
              const result = await selectiveTransfer({
                sourceRoot: normalizedSourcePath,
                destRoot: normalizedDestinationPath,
                mode: 'move',
                canEnterDirectory,
                canTransferFile,
                onConflict: onConflict || 'error',
              });
              try {
                const excludePrefixes = (result.skippedPaths || [])
                  .map((p) => normalizePath(p))
                  .filter((p) => p !== normalizedSourcePath && p.startsWith(`${normalizedSourcePath}/`));
                const rootMovedFully = (result.movedDirMappings || []).some(
                  (m) => normalizePath(m.fromPrefix) === normalizedSourcePath
                );
                await Permission.rewritePermissionsForAllUsers(
                  [{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }],
                  { excludePrefixes, duplicateExactMatches: !rootMovedFully }
                );
              } catch (permError) {
                console.error('Failed to rewrite permissions after move:', permError);
              }
              if (result.movedDirMappings && result.movedDirMappings.length > 0) {
                try {
                  await Permission.rewritePermissionsForAllUsers(result.movedDirMappings);
                } catch (permError) {
                  console.error('Failed to rewrite permissions after move:', permError);
                }
              }
              try {
                for (const dir of result.createdDirs || []) {
                  const homeOwnerId = await getHomeOwnerUserIdForPath(dir);
                  if (homeOwnerId != null) {
                    await Permission.grant(homeOwnerId, dir, PERMISSIONS.ADMIN);
                  }
                }
              } catch (permError) {
                console.error('Failed to grant home owner admin permission after directory move:', permError);
              }
              pushResult({ sourcePath, destinationPath, status: 'succeeded' });
              if (result.skippedPaths && result.skippedPaths.length > 0) {
                result.skippedPaths.forEach(p => pushResult({ path: p, status: 'skippedByConflict' }));
              }
            } else {
              const overwrite = onConflict === 'overwrite';
              await moveFile(sourcePath, destinationPath, null, overwrite, { isDirectory: false });
              pushResult({ sourcePath, destinationPath, status: 'succeeded' });
            }
          } catch (error) {
            console.error(`Failed to move ${sourcePath} to ${destinationPath}:`, error);
            const errorStatus = error.status || error.response?.status;
            if (errorStatus === 403 || errorStatus === 401) {
              pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
            } else {
              pushResult({
                sourcePath,
                destinationPath,
                status: 'failed',
                error: error.message || 'Unknown error',
              });
            }
          }
        },
        () => (getJobRef() && getJobRef().cancelled)
      );
      const finalJob = getJobRef();
      if (finalJob) {
        updateJob(jobId, { status: finalJob.cancelled ? 'cancelled' : 'completed' });
      }
      return;
    }

    if (job.operation === 'copy') {
      const { copies, onConflict } = job.payload;
      let copiesToProcess = copies || [];
      if (onConflict === 'skip') {
        const operations = (copies || []).map(c => ({
          sourcePath: c.sourcePath,
          destinationPath: c.destinationPath,
          type: 'copy',
        }));
        const conflicts = await getConflicts(operations, { limit: false });
        const conflictPaths = new Set(
          conflicts.filter(c => c.type === 'file').map(c => normalizePath(c.path))
        );
        copies.filter(c => conflictPaths.has(normalizePath(c.destinationPath))).forEach(c => {
          pushResult({ sourcePath: c.sourcePath, destinationPath: c.destinationPath, status: 'skippedByConflict' });
        });
        copiesToProcess = copies.filter(c => !conflictPaths.has(normalizePath(c.destinationPath)));
      }
      const allCreatedDirs = new Set();
      const settled = await asyncLimitSettledWithCancel(
        1,
        copiesToProcess,
        async (copy) => {
          const { sourcePath, destinationPath } = copy;
          if (!sourcePath || !destinationPath) {
            pushResult({
              sourcePath: sourcePath || 'unknown',
              destinationPath: destinationPath || 'unknown',
              status: 'failed',
              error: 'Source and destination paths are required',
            });
            return;
          }
          try {
            const isSourceDir = await isDirectoryPath(sourcePath);
            const normalizedSource = normalizePath(sourcePath);
            const hasSourcePermission = isSourceDir
              ? canReadDirSync(normalizedSource)
              : canReadDirSync(getParentPath(normalizedSource));
            if (!hasSourcePermission) {
              pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
              return;
            }
            const normalizedDest = normalizePath(destinationPath);
            const destParentPath = getParentPath(normalizedDest);
            if (!canWriteDirSync(destParentPath)) {
              pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
              return;
            }
            const conflictStatus = await handleSingleOpConflict(destinationPath, onConflict || 'error');
            if (conflictStatus === 'skip') {
              pushResult({ sourcePath, destinationPath, status: 'skippedByConflict' });
              return;
            }
            if (isSourceDir) {
              const canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
              const canTransferFile = (parentDir) => canReadDirSync(parentDir);
              const okRoot = canEnterDirectory(normalizedSource);
              if (!okRoot) {
                pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
                return;
              }
              const result = await selectiveTransfer({
                sourceRoot: normalizedSource,
                destRoot: normalizedDest,
                mode: 'copy',
                canEnterDirectory,
                canTransferFile,
                onConflict: onConflict || 'error',
              });
              try {
                for (const dir of result.createdDirs || []) {
                  await Permission.grant(userId, dir, PERMISSIONS.WRITE);
                  allCreatedDirs.add(dir);
                }
              } catch (permError) {
                console.error('Failed to grant executor permissions after copy:', permError);
              }
              try {
                for (const dir of result.createdDirs || []) {
                  const homeOwnerId = await getHomeOwnerUserIdForPath(dir);
                  if (homeOwnerId != null) {
                    await Permission.grant(homeOwnerId, dir, PERMISSIONS.ADMIN);
                  }
                }
              } catch (permError) {
                console.error('Failed to grant home owner admin permissions after copy:', permError);
              }
              pushResult({ sourcePath, destinationPath, status: 'succeeded' });
              if (result.skippedPaths && result.skippedPaths.length > 0) {
                result.skippedPaths.forEach(p => pushResult({ path: p, status: 'skippedByConflict' }));
              }
            } else {
              const overwrite = onConflict === 'overwrite';
              await copyFile(sourcePath, destinationPath, null, overwrite, { isDirectory: false });
              pushResult({ sourcePath, destinationPath, status: 'succeeded' });
            }
          } catch (error) {
            console.error(`Failed to copy ${sourcePath} to ${destinationPath}:`, error);
            const errorStatus = error.status || error.response?.status;
            if (errorStatus === 403 || errorStatus === 401) {
              pushResult({ sourcePath, destinationPath, status: 'skippedByPermission' });
            } else {
              pushResult({
                sourcePath,
                destinationPath,
                status: 'failed',
                error: error.message || 'Unknown error',
              });
            }
          }
        },
        () => (getJobRef() && getJobRef().cancelled)
      );
      const finalJob = getJobRef();
      if (finalJob) {
        updateJob(jobId, { status: finalJob.cancelled ? 'cancelled' : 'completed' });
      }
      return;
    }

    updateJob(jobId, { status: 'failed', errorMessage: 'Unknown operation' });
  } catch (err) {
    console.error('runBulkJobWorker error:', err);
    updateJob(jobId, { status: 'failed', errorMessage: err.message || 'Unknown error' });
  }
}

router.post('/check-conflicts', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { operations, limit = true } = req.body;
  if (!operations || !Array.isArray(operations)) {
    throw validationError('Operations array is required');
  }

  const conflicts = await getConflicts(operations, { limit });
  res.json({ conflicts });
}));

router.get('/list', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  let folderPath = normalizePath(req.query.path || '/');
  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);

    // 권한 체크 (doc 1회 로드 후 동기 판별)
    let hasPermission =
      user.is_admin ||
      isOwnerPath(user, folderPath) ||
      Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.READ);
    if (!hasPermission && folderPath !== '/') {
      const pathParts = folderPath.split('/').filter(Boolean);
      for (let i = pathParts.length; i > 0; i--) {
        const parentPath = '/' + pathParts.slice(0, i).join('/');
        if (Permission.checkPermissionSync(doc, parentPath, PERMISSIONS.READ)) {
          hasPermission = true;
          break;
        }
      }
    }
    if (!hasPermission && folderPath !== '/') {
      hasPermission = Permission.checkPermissionSync(doc, '/', PERMISSIONS.READ);
    }
    if (!hasPermission) {
      if (user.is_admin) {
        // 권한 체크 건너뛰기
      } else {
        const userFolder = `/${user.username}`;
        if (folderPath === '/' || folderPath === '') {
          folderPath = userFolder;
        } else if (!folderPath.startsWith(userFolder)) {
          return res.status(HTTP_STATUS.FORBIDDEN).json({
            error: 'Access denied',
            message: '이 폴더에 대한 접근 권한이 없습니다.'
          });
        }
      }
    }

    let items;
    try {
      items = await listDirectory(folderPath);
    } catch (error) {
      // Handle 404 errors (directory doesn't exist) with proper status code
      if (error.status === HTTP_STATUS.NOT_FOUND) {
        throw notFoundError(`Directory not found: ${folderPath}`);
      }
      // Re-throw other errors
      throw error;
    }
    // Admin인 경우 .wea 폴더도 반환 (필터링은 클라이언트에서 처리)
    // 일반 사용자는 여전히 필터링 (보안)
    const filteredItems = user.is_admin 
      ? items 
      : items.filter(item => item.basename !== '.wea');
    const { getThumbnailUrl } = require('../utils/thumbnail');
    
    // Current directory write permission (sync from doc)
    const currentDirWritePermission =
      user.is_admin ||
      isOwnerPath(user, folderPath) ||
      Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.WRITE);

    // 항목별 권한 체크 (동기, doc 기반)
    const itemsWithThumbnails = filteredItems.map((item) => {
      if (!item.basename || item.basename.includes('/') || item.basename.includes('\\')) {
        return null;
      }
      const cleanFolderPath = folderPath === '/' ? '/' : folderPath;
      const fullPath =
        cleanFolderPath === '/' ? '/' + item.basename : cleanFolderPath + '/' + item.basename;
      const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');

      let hasReadPermission = true;
      let hasWritePermission = item.type === 'directory' ? true : currentDirWritePermission;

      if (item.type === 'directory') {
        if (user.is_admin) {
          hasReadPermission = true;
          hasWritePermission = true;
        } else {
          hasReadPermission =
            isOwnerPath(user, normalizedPath) || Permission.checkPermissionSync(doc, normalizedPath, PERMISSIONS.READ);
          hasWritePermission =
            isOwnerPath(user, normalizedPath) || Permission.checkPermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);
        }
      }

      let thumbnailUrl = null;
      if (isImageFile(item.basename) || isVideoFile(item.basename)) {
        thumbnailUrl = getThumbnailUrl(normalizedPath);
      }
      const isHidden = item.basename.startsWith('.');

      return {
        ...item,
        path: normalizedPath,
        thumbnailUrl,
        hasReadPermission,
        hasWritePermission,
        isHidden,
      };
    });

  // 모든 항목 반환 (권한 정보 포함)
  // 직접 권한이 없는 디렉토리도 표시하되, 비활성화 상태로 표시됨
  res.json(itemsWithThumbnails.filter(item => item !== null));
}));

router.get('/download', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const inline = req.query.inline === 'true';
  
  if (!filePath) {
    throw validationError('File path is required');
  }

  const user = req.user.full;

    // Download policy: direct-only read (admin/owner bypass)
    let hasPermission = false;
    if (user.is_admin || isOwnerPath(user, filePath)) {
      hasPermission = true;
    } else {
      const normalized = normalizePath(filePath);
      const parentDir = getParentPath(normalized);
      hasPermission = await hasDirectFolderPermission(user.id, parentDir, PERMISSIONS.READ);
    }
    if (!hasPermission) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
    }

    const buffer = await getFileContents(filePath);
    const filename = path.basename(filePath);
    const encodedFilename = encodeURIComponent(filename);
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Disposition', `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
    
    if (inline) {
      res.setHeader('Content-Type', getContentType(filename));
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
  }
  
  res.send(buffer);
}));

router.post('/upload', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw validationError('No file uploaded');
  }

  let originalFilename = req.file.originalname;
  
  try {
    if (/[^\x00-\x7F]/.test(originalFilename)) {
      const latin1Buffer = Buffer.from(originalFilename, 'latin1');
      originalFilename = latin1Buffer.toString('utf8');
    }
  } catch (e) {
    // If conversion fails, use original filename
  }

  let folderPath = req.body.path || '/';
  const relativePath = req.body.relativePath || ''; // Support for nested folder uploads
  
  const user = req.user.full;
    
    // 관리자는 모든 경로에 파일 업로드 가능
    if (!user.is_admin) {
      // 경로 정규화 (끝의 / 제거)
      const normalizedPath = normalizePath(folderPath);
      
      if (normalizedPath === '/' || normalizedPath === '') {
        folderPath = `/${user.username}`;
      } else {
        const ok = await canWriteFolder(user, normalizedPath);
        if (!ok) {
          return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
        }
        folderPath = normalizedPath;
      }
    } else {
      // 관리자의 경우도 경로 정규화
      folderPath = normalizePath(folderPath);
    }
    
    // 디렉토리 경로로 변환 (끝에 / 추가)
    if (folderPath !== '/' && !folderPath.endsWith('/')) {
      folderPath = folderPath + '/';
    }
    
    // If relativePath is provided, create intermediate directories
    let finalFolderPath = folderPath;
    if (relativePath) {
      // Extract directory path from relativePath (excluding filename)
      const relativeDir = path.dirname(relativePath);
      if (relativeDir && relativeDir !== '.') {
        // Construct full directory path
        finalFolderPath = path.join(folderPath, relativeDir).replace(/\\/g, '/');
        if (!finalFolderPath.endsWith('/')) {
          finalFolderPath = finalFolderPath + '/';
        }
        
        // Create intermediate directories if they don't exist
        const { createDirectory } = require('../utils/webdav');
        const dirParts = relativeDir.split('/').filter(Boolean);
        let currentPath = folderPath;
        
        // Get parent folder owners (users with write/admin permissions on the parent folder)
        // This is done once before the loop to avoid repeated queries
        let parentFolderOwners = [];
        try {
          const parentPermissions = await Permission.getFolderPermissions(folderPath);
          // Filter users with write or admin permissions
          parentFolderOwners = parentPermissions
            .filter(perm => perm.permission === PERMISSIONS.WRITE || perm.permission === PERMISSIONS.ADMIN)
            .map(perm => perm.id);
        } catch (permQueryError) {
          console.error('Failed to query parent folder permissions:', permQueryError);
          // Continue even if query fails
        }
        
        for (const dirPart of dirParts) {
          currentPath = path.join(currentPath, dirPart).replace(/\\/g, '/');
          if (!currentPath.endsWith('/')) {
            currentPath = currentPath + '/';
          }
          
          // Check if directory exists, create if not
          const dirExists = await pathExists(currentPath);
          
          if (!dirExists) {
            try {
              await createDirectory(currentPath);
              
              // Grant permissions to the user who created it
              try {
                await Permission.grant(req.user.id, currentPath, PERMISSIONS.WRITE);
                
                // Grant permissions to parent folder owners (users with write/admin permissions on parent folder)
                for (const ownerId of parentFolderOwners) {
                  try {
                    // Skip if it's the same user (already granted above)
                    if (ownerId !== req.user.id) {
                      await Permission.grant(ownerId, currentPath, PERMISSIONS.WRITE);
                    }
                  } catch (ownerPermError) {
                    console.error(`Failed to grant permission to parent folder owner ${ownerId} for ${currentPath}:`, ownerPermError);
                    // Continue with other owners even if one fails
                  }
                }

                // Grant home directory owner ADMIN on this folder
                try {
                  const homeOwnerId = await getHomeOwnerUserIdForPath(currentPath);
                  if (homeOwnerId != null) {
                    await Permission.grant(homeOwnerId, currentPath, PERMISSIONS.ADMIN);
                  }
                } catch (homeOwnerPermError) {
                  console.error('Failed to grant home owner admin permission for intermediate directory:', homeOwnerPermError);
                }
                
              } catch (permError) {
                console.error('Failed to grant permissions for intermediate directory:', permError);
              }
            } catch (createError) {
              // Directory might already exist or be created by another request
            }
          }
        }
      }
    }
  const { onConflict } = req.body;

  const filePath = finalFolderPath === '/' 
    ? '/' + originalFilename 
    : (finalFolderPath + originalFilename).replace(/\\/g, '/').replace(/\/+/g, '/');

  // Check if file already exists
  const fileExists = await pathExists(filePath);

  // If onConflict is 'skip' and file exists, return success without uploading
  if (fileExists && onConflict === 'skip') {
    return res.json({ message: 'File upload skipped', path: filePath, skipped: true });
  }

  if (fileExists && onConflict !== 'overwrite') {
    throw conflictError(`파일 업로드 실패: "${originalFilename}" 이름의 파일이 이미 존재합니다.`);
  }

  // 최종 권한 체크는 이미 위에서 완료됨 (folderPath에 대한 권한 체크)
  // 파일 경로 자체에 대한 추가 체크는 불필요 (부모 폴더 권한으로 충분)

  await putFileContents(filePath, req.file.buffer);

  res.json({ message: 'File uploaded successfully', path: filePath });
}));

// Batch delete endpoint (Job-based: returns 202 + jobId, worker runs in background)
router.post('/batch-delete', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError('Paths array is required');
  }
  const { jobId } = createJob(req.user.id, 'delete', { paths });
  setImmediate(runBulkJobWorker, jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

router.put('/rename', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) {
    throw validationError('Old path and new name are required');
  }

  const user = req.user.full;

  const isDir = await isDirectoryPath(oldPath);
  const normalizedOld = normalizePath(oldPath);
  const hasPermission = isDir
    ? await canWriteFolder(user, normalizedOld)
    : await canWriteFileByParent(user, normalizedOld);

  if (!hasPermission) {
    throw forbiddenError('Access denied');
  }

  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, newName).replace(/\\/g, '/');
  const normalizedOldPath = oldPath.replace(/\\/g, '/');
  const normalizedNewPath = newPath.replace(/\\/g, '/');
  
  if (normalizedOldPath === normalizedNewPath) {
    return res.json({ message: 'File name unchanged', path: newPath });
  }

  const targetExists = await pathExists(newPath);
  if (targetExists) {
    throw conflictError(`파일 이름 변경 실패: "${newName}" 이름의 파일이 이미 존재합니다.`);
  }

  await moveFile(oldPath, newPath, null, false, { isDirectory: isDir });
  if (isDir) {
    const normalizedNew = normalizePath(newPath);
    try {
      await Permission.rewritePermissionsForAllUsers([{ fromPrefix: normalizedOld, toPrefix: normalizedNew }]);
    } catch (permError) {
      console.error('Failed to rewrite permissions after directory rename:', permError);
    }
    // 새 경로에 홈 소유자 ADMIN 부여 (기존 경로에 권한 엔트리가 없었던 경우에도 일관되게 적용)
    try {
      const homeOwnerId = await getHomeOwnerUserIdForPath(normalizedNew);
      if (homeOwnerId != null) {
        await Permission.grant(homeOwnerId, normalizedNew, PERMISSIONS.ADMIN);
      }
    } catch (homeOwnerPermError) {
      console.error('Failed to grant home owner admin permission after directory rename:', homeOwnerPermError);
    }
  }
  res.json({ message: 'File renamed successfully', path: newPath });
}));

// Helper to handle onConflict in batch operations
// 폴더는 conflict 적용 안 함 (항상 merge), 파일만 skip/overwrite 적용
const handleSingleOpConflict = async (destPath, onConflict) => {
  const destExists = await pathExists(destPath);
  if (!destExists) return 'none';
  const isDestDir = await isDirectoryPath(destPath);
  if (isDestDir) return 'none';
  if (onConflict === 'skip') return 'skip';
  if (onConflict !== 'overwrite') {
    throw conflictError('대상 디렉토리에 같은 이름의 파일이 이미 존재합니다');
  }
  return 'overwrite';
};

// Batch move endpoint (Job-based: returns 202 + jobId)
router.post('/batch-move', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { moves, onConflict } = req.body;
  if (!moves || !Array.isArray(moves) || moves.length === 0) {
    throw validationError('Moves array is required');
  }
  const { jobId } = createJob(req.user.id, 'move', { moves, onConflict });
  setImmediate(runBulkJobWorker, jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// Batch copy endpoint (Job-based: returns 202 + jobId)
router.post('/batch-copy', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { copies, onConflict } = req.body;
  if (!copies || !Array.isArray(copies) || copies.length === 0) {
    throw validationError('Copies array is required');
  }
  const { jobId } = createJob(req.user.id, 'copy', { copies, onConflict });
  setImmediate(runBulkJobWorker, jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// Get bulk operation status (polling)
router.get('/bulk-operation/:jobId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    throw notFoundError('Job not found or expired');
  }
  if (String(job.userId) !== String(req.user.id)) {
    throw forbiddenError('Access denied');
  }
  res.json({
    status: job.status,
    progress: job.progress,
    total: job.total,
    results: job.results,
    errorMessage: job.errorMessage,
  });
}));

// Cancel bulk operation
router.post('/bulk-operation/:jobId/cancel', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    throw notFoundError('Job not found or expired');
  }
  if (String(job.userId) !== String(req.user.id)) {
    throw forbiddenError('Access denied');
  }
  setJobCancelled(jobId);
  res.json({ message: 'Cancel requested', jobId });
}));

router.get('/thumbnail/:hash', asyncHandler(async (req, res) => {
  const { hash } = req.params;
  const { thumbnailCache, getThumbnailHash } = require('../utils/thumbnail');
  
  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundThumbnail = thumbnail;
      break;
    }
  }
  
  if (foundThumbnail) {
    res.setHeader('Content-Type', foundThumbnail.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(foundThumbnail.buffer);
  } else {
    throw notFoundError('Thumbnail not found');
  }
}));

router.post('/thumbnails/batch', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { paths } = req.body;
  
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError('Paths array is required');
  }
  
  const { ensureThumbnailsBatch } = require('../utils/thumbnail');
  const results = await ensureThumbnailsBatch(paths);
  
  res.json({ thumbnails: results });
}));

async function collectFilesFromDirectory(dirPath, basePath = '', files = []) {
  try {
    const items = await listDirectory(dirPath);
    for (const item of items) {
      const itemPath = item.filename || `${dirPath}/${item.basename}`;
      const relativePath = basePath ? `${basePath}/${item.basename}` : item.basename;
      
      if (item.type === 'directory') {
        await collectFilesFromDirectory(itemPath, relativePath, files);
      } else {
        files.push({ path: itemPath, relativePath });
      }
    }
  } catch (error) {
    console.error(`Error collecting files from ${dirPath}:`, error);
  }
  return files;
}

router.post('/download-multiple', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths, downloadId: clientDownloadId } = req.body;
  const downloadId = clientDownloadId || `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError('Paths array is required');
  }

  const user = req.user.full;
  const doc = await Permission.getPermissionDoc(req.user.id);
  const canReadDirSync = buildSyncReadChecker(user, doc);
  const canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
  const canIncludeFile = (parentDir) => canReadDirSync(parentDir);

    const skippedPaths = [];

    downloadProgress.set(downloadId, {
      status: 'preparing',
      progress: 0,
      total: 0,
      current: '',
      zipName: '',
    });

    const allFiles = [];
    let zipName = 'download';
    
    let commonParentDir = null;
    if (paths.length > 1) {
      const parentDirs = paths.map(p => {
        const dir = path.dirname(p);
        return dir === '/' ? '' : dir;
      });
      
      if (parentDirs.every(d => d === parentDirs[0])) {
        commonParentDir = parentDirs[0] || '/';
      }
    }
    
    for (const filePath of paths) {
      try {
        let isDirectory = false;
        try {
          const parentPath = getParentPath(filePath);
          const fileName = getBasename(filePath);
          const parentItems = await listDirectory(parentPath);
          const item = parentItems.find(i => i.basename === fileName);
          if (item) {
            isDirectory = item.type === 'directory';
          } else {
            try {
              const items = await listDirectory(filePath);
              isDirectory = items.length > 0 || filePath.endsWith('/');
            } catch (listError) {
              isDirectory = false;
            }
          }
        } catch (checkError) {
          try {
            const items = await listDirectory(filePath);
            isDirectory = items.length > 0 || filePath.endsWith('/');
          } catch (listError) {
            isDirectory = false;
          }
        }
        
        if (isDirectory) {
          const dirName = path.basename(filePath.replace(/\/$/, '')) || 'folder';
          if (paths.length === 1) {
            zipName = dirName;
          }
          const collected = await selectiveCollectFiles({
            rootPath: filePath,
            basePath: dirName,
            canEnterDirectory,
            canIncludeFile,
          });
          allFiles.push(...collected.files);
          skippedPaths.push(...collected.skippedPaths);
        } else {
          const fileName = path.basename(filePath);
          
          if (paths.length === 1) {
            const parentDir = path.dirname(filePath);
            if (parentDir && parentDir !== '/') {
              zipName = path.basename(parentDir) || 'download';
            } else {
              zipName = fileName.replace(/\.[^/.]+$/, '');
            }
            const parentDirForPerm = getParentPath(normalizePath(filePath));
            const ok = await canIncludeFile(parentDirForPerm);
            if (!ok) {
              skippedPaths.push(filePath);
            } else {
              allFiles.push({ path: filePath, relativePath: fileName });
            }
          } else {
            if (commonParentDir && commonParentDir !== '/') {
              const relativePath = filePath.replace(commonParentDir, '').replace(/^\//, '');
              const parentDirForPerm = getParentPath(normalizePath(filePath));
              const ok = await canIncludeFile(parentDirForPerm);
              if (!ok) {
                skippedPaths.push(filePath);
              } else {
                allFiles.push({ path: filePath, relativePath });
              }
            } else {
              const parentDirForPerm = getParentPath(normalizePath(filePath));
              const ok = await canIncludeFile(parentDirForPerm);
              if (!ok) {
                skippedPaths.push(filePath);
              } else {
                allFiles.push({ path: filePath, relativePath: fileName });
              }
            }
          }
        }
      } catch (error) {
        const fileName = path.basename(filePath);
        // If we can't determine type, treat as file and apply direct-only read check
        const parentDirForPerm = getParentPath(normalizePath(filePath));
        const ok = await canIncludeFile(parentDirForPerm);
        if (!ok) {
          skippedPaths.push(filePath);
        } else {
          if (paths.length === 1) {
            const parentDir = path.dirname(filePath);
            if (parentDir && parentDir !== '/') {
              zipName = path.basename(parentDir) || 'download';
            } else {
              zipName = fileName.replace(/\.[^/.]+$/, '');
            }
            allFiles.push({ path: filePath, relativePath: fileName });
          } else {
            allFiles.push({ path: filePath, relativePath: fileName });
          }
        }
      }
    }

  if (allFiles.length === 0) {
    throw forbiddenError('Access denied');
  }

    if (paths.length > 1) {
      const firstPath = paths[0];
      const parentDir = path.dirname(firstPath);
      if (parentDir && parentDir !== '/') {
        zipName = path.basename(parentDir) || 'download';
      } else {
        zipName = 'download';
      }
    }

    downloadProgress.set(downloadId, {
      status: 'downloading',
      progress: 0,
      total: allFiles.length,
      current: '',
      zipName: `${zipName}.zip`,
    });

    const encodedZipName = encodeURIComponent(`${zipName}.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-WEA-Skipped-Count, X-WEA-Skipped');
    res.setHeader('X-WEA-Skipped-Count', String(skippedPaths.length));
    try {
      const maxLen = 7000;
      let payload = {
        paths: skippedPaths.slice(0, 100),
        truncated: skippedPaths.length > 100,
      };
      let encoded = encodeURIComponent(JSON.stringify(payload));

      // Keep the header parseable: shrink list instead of slicing percent-encoded data.
      while (encoded.length > maxLen && payload.paths.length > 0) {
        payload.paths.pop();
        payload.truncated = true;
        encoded = encodeURIComponent(JSON.stringify(payload));
      }

      if (encoded.length > maxLen) {
        encoded = encodeURIComponent(JSON.stringify({ paths: [], truncated: true }));
      }

      res.setHeader('X-WEA-Skipped', encoded);
    } catch {
      res.setHeader('X-WEA-Skipped', encodeURIComponent(JSON.stringify({ paths: [], truncated: true })));
    }
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"; filename*=UTF-8''${encodedZipName}`);

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      downloadProgress.set(downloadId, {
        status: 'error',
        progress: 0,
        total: allFiles.length,
        current: '',
        zipName: `${zipName}.zip`,
        error: err.message,
      });
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to create zip archive' });
      }
    });

    archive.pipe(res);

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      try {
        downloadProgress.set(downloadId, {
          status: 'downloading',
          progress: i + 1,
          total: allFiles.length,
          current: file.relativePath,
          zipName: `${zipName}.zip`,
        });

        const buffer = await getFileContents(file.path);
        const fileBuffer = Buffer.from(buffer);
        archive.append(fileBuffer, { name: file.relativePath });
        } catch (error) {
          // Continue with other files even if one fails
        }
      }

    await archive.finalize();

    downloadProgress.set(downloadId, {
      status: 'completed',
      progress: allFiles.length,
      total: allFiles.length,
      current: '',
      zipName: `${zipName}.zip`,
    });

  setTimeout(() => {
    downloadProgress.delete(downloadId);
  }, 5 * 60 * 1000);
}));

router.get('/download-progress/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = downloadProgress.get(id);
  
  if (!progress) {
    throw notFoundError('Download progress not found');
  }
  
  res.json(progress);
}));

router.get('/operation-progress/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = operationProgress.get(id);
  
  if (!progress) {
    throw notFoundError('Operation progress not found');
  }
  
  res.json(progress);
}));

module.exports = router;

