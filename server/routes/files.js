const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const { authenticateToken, authenticateTokenOrShare } = require('../utils/auth');
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
  getFileMetadata,
} = require('../utils/webdav');
const { getThumbnailUrl } = require('../utils/thumbnail');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
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
  buildSyncReadFileChecker,
  buildSyncWriteFileByParentChecker,
} = require('../utils/permissionPolicy');
const { selectiveTransfer } = require('../services/selectiveTransfer');
const { selectiveCollectFiles } = require('../services/selectiveDownload');
const { selectiveDelete } = require('../services/selectiveDelete');
const { isMetaPath } = require('../store/metaPaths');
const { isSharePrincipal } = require('../middleware/permissions');
const { createJob, getJob, setJobCancelled, updateJob } = require('../store/bulkJobStore');
const { asyncLimitSettled, asyncLimitSettledWithCancel } = require('../utils/asyncUtils');
const path = require('path');
const requireUser = require('../middleware/requireUser');
const { requireAuth } = require('../middleware/requireUser');
const { checkMetaPathAccess } = require('../middleware/metaPathGuard');
const normalizePathParam = require('../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError, notFoundError, conflictError } = require('../utils/errorHandler');
const { sendBufferAsChunks } = require('../utils/responseWriter');

/** Reject Share principal on write routes; Share links are read-only. Use after authenticateTokenOrShare, requireAuth. */
function requireTokenNotShare(req, res, next) {
  if (isSharePrincipal(req.principalId)) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }
  next();
}

const downloadProgress = new Map();
const operationProgress = new Map();

// In-memory ticket store for video preview streaming (server restart invalidates all tickets).
// ticket -> { principalId, path, expiresAtMs }
const previewTickets = new Map();
const PREVIEW_TICKET_TTL_MS = parseInt(process.env.WEA_PREVIEW_TICKET_TTL_MS || '120000', 10) || 120000;

function issuePreviewTicket(principalId, filePath) {
  const ticket = crypto.randomBytes(32).toString('hex');
  previewTickets.set(ticket, { principalId, path: filePath, expiresAtMs: Date.now() + PREVIEW_TICKET_TTL_MS });
  return ticket;
}

function readPreviewTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const entry = previewTickets.get(ticket);
  if (!entry) return null;
  if (Date.now() > entry.expiresAtMs) {
    previewTickets.delete(ticket);
    return { expired: true };
  }
  return entry;
}

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

  // Only include files in conflicts (folders are not treated as conflicts)
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

function scheduleBulkWorker(jobId) {
  if (process.env.NODE_ENV === 'test' && process.env.WEA_SKIP_BULK_WORKER === '1') {
    return;
  }
  setImmediate(runBulkJobWorker, jobId);
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
      updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.auth.userNotFound });
      return;
    }
    user = user.toObject ? user.toObject() : user;
  } catch (e) {
    updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.internalServerError });
    return;
  }

  const doc = await Permission.getPermissionDoc(userId);
  const canWriteDirSync = buildSyncWriteChecker(user, doc);
  const canWriteFileByParentSync = buildSyncWriteFileByParentChecker(user, doc);
  const canReadDirSync = buildSyncReadChecker(user, doc);
  const canReadFileSync = buildSyncReadFileChecker(user, doc);

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
            pushResult({ path: filePath, status: 'failed', errorCode: SERVER_ERROR_CODES.files.invalidPath });
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
              const canDeleteFileByParent = (filePath) => canWriteFileByParentSync(filePath);
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
              pushResult({ path: filePath, status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.defaultMessage });
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
              errorCode: SERVER_ERROR_CODES.files.sourceDestRequired,
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
              const canTransferFile = (filePath) => canWriteFileByParentSync(filePath);
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
                errorCode: SERVER_ERROR_CODES.errorHandler.defaultMessage,
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
              errorCode: SERVER_ERROR_CODES.files.sourceDestRequired,
            });
            return;
          }
          try {
            const isSourceDir = await isDirectoryPath(sourcePath);
            const normalizedSource = normalizePath(sourcePath);
            const hasSourcePermission = isSourceDir
              ? canReadDirSync(normalizedSource)
              : canReadFileSync(normalizedSource);
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
              const canTransferFile = (filePath) => canReadFileSync(filePath);
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
                errorCode: SERVER_ERROR_CODES.errorHandler.defaultMessage,
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

    updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.defaultMessage });
  } catch (err) {
    console.error('runBulkJobWorker error:', err);
    updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.internalServerError });
  }
}

router.post('/check-conflicts', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { operations, limit = true } = req.body;
  if (!operations || !Array.isArray(operations)) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const conflicts = await getConflicts(operations, { limit });
  res.json({ conflicts });
}));

const METADATA_PATHS_LIMIT = 100;

router.post('/metadata', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const paths = req.body.paths;
  if (!Array.isArray(paths)) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  if (paths.length > METADATA_PATHS_LIMIT) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
  }
  const principalId = req.principalId;
  const results = [];
  for (const p of paths) {
    const pathVal = typeof p === 'string' ? p.trim() : '';
    if (!pathVal) continue;
    const normalized = normalizePath(pathVal);
    const hasRead = await canReadFile(principalId, normalized, PERMISSIONS.READ);
    if (!hasRead) continue;
    try {
      const meta = await getFileMetadata(normalized);
      results.push({
        path: normalized,
        size: meta.size,
        lastmod: meta.lastmod,
        mime: meta.mime,
      });
    } catch (err) {
      if (err.status !== HTTP_STATUS.NOT_FOUND) {
        console.error(`[files/metadata] getFileMetadata failed for ${normalized}:`, err.message);
      }
    }
  }
  res.json(results);
}));

router.get('/list', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const principalId = req.principalId;
  const isShare = isSharePrincipal(principalId);
  let folderPath = normalizePath(req.query.path || '/');

  if (isShare) {
    const rootPath = req.shareContext.rootPath;
    if (folderPath === '/' || folderPath === '') {
      folderPath = rootPath;
    }
  }

  let hasPermission = await canReadFolder(principalId, folderPath, PERMISSIONS.READ);
  if (!hasPermission) {
    if (isShare) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        errorCode: SERVER_ERROR_CODES.files.folderAccessDenied,
      });
    }
    const user = req.user.full;
    const userFolder = `/${user.username}`;
    if (folderPath === '/' || folderPath === '') {
      folderPath = userFolder;
    } else if (!folderPath.startsWith(userFolder)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        errorCode: SERVER_ERROR_CODES.files.folderAccessDenied,
      });
    }
  }

  const user = req.user?.full;
  const doc = isShare ? null : await Permission.getPermissionDoc(req.user.id);

  let items;
    try {
      items = await listDirectory(folderPath);
    } catch (error) {
      // Handle 404 errors (directory doesn't exist) with proper status code
      if (error.status === HTTP_STATUS.NOT_FOUND) {
        throw notFoundError(SERVER_ERROR_CODES.files.invalidPath);
      }
      // Re-throw other errors
      throw error;
    }
    // For admins, return .wea folder too (filtering handled by client)
    // Share mode and regular users filter out .wea
    const filteredItems = (user && user.is_admin)
      ? items
      : items.filter(item => item.basename !== '.wea');
    const { getThumbnailUrl } = require('../utils/thumbnail');
    
    // Current directory write permission (sync from doc). Share: always false.
    const currentDirWritePermission = isShare
      ? false
      : (user.is_admin || isOwnerPath(user, folderPath) || Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.WRITE));

    // Per-item permission check (sync, doc-based). Share mode: hasReadPermission=true, hasWritePermission=false
    const itemsWithThumbnails = filteredItems.map((item) => {
      if (!item.basename || item.basename.includes('/') || item.basename.includes('\\')) {
        return null;
      }
      const cleanFolderPath = folderPath === '/' ? '/' : folderPath;
      const fullPath =
        cleanFolderPath === '/' ? '/' + item.basename : cleanFolderPath + '/' + item.basename;
      const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');

      let hasReadPermission;
      let hasWritePermission;

      if (isShare) {
        hasReadPermission = true;
        hasWritePermission = false;
      } else if (item.type === 'directory') {
        if (user.is_admin) {
          hasReadPermission = true;
          hasWritePermission = true;
        } else {
          hasReadPermission =
            isOwnerPath(user, normalizedPath) || Permission.checkPermissionSync(doc, normalizedPath, PERMISSIONS.READ);
          hasWritePermission =
            isOwnerPath(user, normalizedPath) || Permission.checkPermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);
        }
      } else {
        if (user.is_admin) {
          hasReadPermission = true;
          hasWritePermission = true;
        } else {
          hasReadPermission =
            isOwnerPath(user, normalizedPath) || Permission.checkFilePermissionSync(doc, normalizedPath, PERMISSIONS.READ);
          hasWritePermission =
            isOwnerPath(user, normalizedPath) || Permission.checkFilePermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);
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

  // Return all items (with permission info)
  // Directories without direct permissions are also shown but in a disabled state
  res.json(itemsWithThumbnails.filter(item => item !== null));
}));

router.get('/download', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const inline = req.query.inline === 'true';

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const principalId = req.principalId;
  const hasPermission = await canReadFile(principalId, filePath, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
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

// Video preview: issue short-lived ticket so <video src> can load without custom headers.
router.post('/preview-ticket', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.body?.path;
  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const principalId = req.principalId;
  const hasPermission = await canReadFile(principalId, filePath, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const filename = path.basename(filePath);
  if (!isVideoFile(filename)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.files.previewNotVideo });
  }

  const ticket = issuePreviewTicket(principalId, filePath);
  res.json({ ticket });
}));

// Video preview: stream bytes inline using ticket-based auth.
router.get('/preview-stream', normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const ticket = req.query.ticket;

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const entry = readPreviewTicket(ticket);
  if (!entry) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketInvalid });
  }
  if (entry.expired) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketExpired });
  }

  const normalizedReqPath = normalizePath(filePath);
  const normalizedTicketPath = normalizePath(entry.path);
  if (normalizedReqPath !== normalizedTicketPath) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketInvalid });
  }

  // Optional: confirm caller still has access (ACL changes after ticket issuance).
  const hasPermission = await canReadFile(entry.principalId, normalizedReqPath, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const buffer = await getFileContents(normalizedReqPath);
  const filename = path.basename(normalizedReqPath);
  const encodedFilename = encodeURIComponent(filename);
  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');

  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Disposition', `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader('Content-Type', getContentType(filename));
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Accept-Ranges', 'bytes');

  await sendBufferAsChunks(res, buffer);
}));

router.post('/upload', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
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
    
    // Admins can upload files to any path
    if (!user.is_admin) {
      // Normalize path (remove trailing /)
      const normalizedPath = normalizePath(folderPath);
      
      if (normalizedPath === '/' || normalizedPath === '') {
        folderPath = `/${user.username}`;
      } else {
        const ok = await canWriteFolder(user, normalizedPath);
        if (!ok) {
          return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
        }
        folderPath = normalizedPath;
      }
    } else {
      // Admins also normalize the path
      folderPath = normalizePath(folderPath);
    }
    
    // Convert to directory path (append trailing /)
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
    return res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSkipped, path: filePath, skipped: true });
  }

  if (fileExists && onConflict !== 'overwrite') {
    throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
  }

  // Final permission check already done above (permission check for folderPath)
  // No additional check needed for the file path itself (parent folder permission is sufficient)

  await putFileContents(filePath, req.file.buffer);

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSuccess, path: filePath });
}));

// Batch delete endpoint (Job-based: returns 202 + jobId, worker runs in background)
router.post('/batch-delete', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  const { jobId } = createJob(req.user.id, 'delete', { paths });
  scheduleBulkWorker(jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

router.put('/rename', authenticateTokenOrShare, requireAuth, requireTokenNotShare, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const user = req.user.full;

  const isDir = await isDirectoryPath(oldPath);
  const normalizedOld = normalizePath(oldPath);
  const hasPermission = isDir
    ? await canWriteFolder(user, normalizedOld)
    : await canWriteFileByParent(user, normalizedOld);

  if (!hasPermission) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }

  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, newName).replace(/\\/g, '/');
  const normalizedOldPath = oldPath.replace(/\\/g, '/');
  const normalizedNewPath = newPath.replace(/\\/g, '/');
  
  if (normalizedOldPath === normalizedNewPath) {
    return res.json({ messageCode: SERVER_MESSAGE_CODES.files.nameUnchanged, path: newPath });
  }

  const targetExists = await pathExists(newPath);
  if (targetExists) {
    throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
  }

  await moveFile(oldPath, newPath, null, false, { isDirectory: isDir });
  if (isDir) {
    const normalizedNew = normalizePath(newPath);
    try {
      await Permission.rewritePermissionsForAllUsers([{ fromPrefix: normalizedOld, toPrefix: normalizedNew }]);
    } catch (permError) {
      console.error('Failed to rewrite permissions after directory rename:', permError);
    }
    // Grant home owner ADMIN on the new path (consistently applied even if no permission entry existed at the old path)
    try {
      const homeOwnerId = await getHomeOwnerUserIdForPath(normalizedNew);
      if (homeOwnerId != null) {
        await Permission.grant(homeOwnerId, normalizedNew, PERMISSIONS.ADMIN);
      }
    } catch (homeOwnerPermError) {
      console.error('Failed to grant home owner admin permission after directory rename:', homeOwnerPermError);
    }
  }
  res.json({ messageCode: SERVER_MESSAGE_CODES.files.renameSuccess, path: newPath });
}));

// Helper to handle onConflict in batch operations
// Folders are not subject to conflict handling (always merge); files use skip/overwrite
const handleSingleOpConflict = async (destPath, onConflict) => {
  const destExists = await pathExists(destPath);
  if (!destExists) return 'none';
  const isDestDir = await isDirectoryPath(destPath);
  if (isDestDir) return 'none';
  if (onConflict === 'skip') return 'skip';
  if (onConflict !== 'overwrite') {
    throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
  }
  return 'overwrite';
};

// Batch move endpoint (Job-based: returns 202 + jobId)
router.post('/batch-move', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { moves, onConflict } = req.body;
  if (!moves || !Array.isArray(moves) || moves.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  const { jobId } = createJob(req.user.id, 'move', { moves, onConflict });
  scheduleBulkWorker(jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// Batch copy endpoint (Job-based: returns 202 + jobId)
router.post('/batch-copy', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { copies, onConflict } = req.body;
  if (!copies || !Array.isArray(copies) || copies.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  const { jobId } = createJob(req.user.id, 'copy', { copies, onConflict });
  scheduleBulkWorker(jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// Get bulk operation status (polling)
router.get('/bulk-operation/:jobId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    throw notFoundError(SERVER_ERROR_CODES.files.jobNotFound);
  }
  if (String(job.userId) !== String(req.user.id)) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
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
    throw notFoundError(SERVER_ERROR_CODES.files.jobNotFound);
  }
  if (String(job.userId) !== String(req.user.id)) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }
  setJobCancelled(jobId);
  res.json({ messageCode: SERVER_MESSAGE_CODES.files.cancelRequested, jobId });
}));

router.get('/thumbnail/:hash', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { hash } = req.params;
  const { thumbnailCache, getThumbnailHash } = require('../utils/thumbnail');

  let foundPath = null;
  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundPath = webdavPath;
      foundThumbnail = thumbnail;
      break;
    }
  }

  if (!foundThumbnail) {
    throw notFoundError(SERVER_ERROR_CODES.files.invalidPath);
  }

  const canRead = await canReadFile(req.user.id, foundPath, PERMISSIONS.READ);
  if (!canRead) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }

  res.setHeader('Content-Type', foundThumbnail.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.send(foundThumbnail.buffer);
}));

router.post('/thumbnails/batch', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths } = req.body;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const principalId = req.principalId;
  const allowedPaths = [];
  for (const p of paths) {
    if (typeof p !== 'string') continue;
    const canRead = await canReadFile(principalId, p, PERMISSIONS.READ);
    if (canRead) allowedPaths.push(p);
  }

  const { ensureThumbnailsBatch } = require('../utils/thumbnail');
  const results = await ensureThumbnailsBatch(allowedPaths);

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

router.post('/download-multiple', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths, downloadId: clientDownloadId } = req.body;
  const downloadId = clientDownloadId || `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const principalId = req.principalId;
  const isShare = isSharePrincipal(principalId);
  let canEnterDirectory;
  let canIncludeFile;

  const checkInclude = async (fp) => {
    const r = canIncludeFile(fp);
    return typeof r?.then === 'function' ? await r : Boolean(r);
  };

  if (isShare) {
    const token = req.shareContext.token;
    canEnterDirectory = (dirPath) => Permission.checkSharePermission(token, dirPath, PERMISSIONS.READ);
    canIncludeFile = (filePath) => Permission.checkSharePermission(token, filePath, PERMISSIONS.READ);
  } else {
    const user = req.user.full;
    const doc = await Permission.getPermissionDoc(req.user.id);
    const canReadDirSync = buildSyncReadChecker(user, doc);
    const canReadFileSync = buildSyncReadFileChecker(user, doc);
    canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
    canIncludeFile = (filePath) => canReadFileSync(filePath);
  }

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
            const ok = await checkInclude(filePath);
            if (!ok) {
              skippedPaths.push(filePath);
            } else {
              allFiles.push({ path: filePath, relativePath: fileName });
            }
          } else {
            if (commonParentDir && commonParentDir !== '/') {
              const relativePath = filePath.replace(commonParentDir, '').replace(/^\//, '');
              const ok = await checkInclude(filePath);
              if (!ok) {
                skippedPaths.push(filePath);
              } else {
                allFiles.push({ path: filePath, relativePath });
              }
            } else {
              const ok = await checkInclude(filePath);
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
        // If we can't determine type, treat as file and apply file-path read check
        const ok = await checkInclude(filePath);
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
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
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
        errorCode: SERVER_ERROR_CODES.files.zipFail,
      });
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.files.zipFail });
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

router.get('/download-progress/:id', authenticateTokenOrShare, requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = downloadProgress.get(id);
  
  if (!progress) {
    throw notFoundError(SERVER_ERROR_CODES.files.progressNotFound);
  }
  
  res.json(progress);
}));

router.get('/operation-progress/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = operationProgress.get(id);
  
  if (!progress) {
    throw notFoundError(SERVER_ERROR_CODES.files.progressNotFound);
  }
  
  res.json(progress);
}));

module.exports = router;

