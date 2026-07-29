const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncLimitSettledWithCancel } = require('../../../utils/asyncUtils');
const fileStore = require('../../../infrastructure/adapters/filestore').createFileStoreAdapter();
const PermissionFacade = require('../../permissions/services/permissionFacade');
const User = require('../../../models/User');
const { getCachedUser, isOwnerPath } = require('../../permissions/services/aclService');
const { isMetaPath } = require('../../../store/metaPaths');
const operationProgress = require('../stores/operationProgress').createOperationProgressStore();
const { selectiveTransfer } = require('./selectiveTransfer');
const { selectiveDelete } = require('./selectiveDelete');
const { getConflicts, handleSingleOpConflict } = require('./conflictResolver');
const {
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncWriteFileByParentChecker,
  buildSyncReadFileChecker,
} = require('../../permissions/services/aclService');
const { getHomeOwnerUserIdForPath } = require('../../permissions/policy/ownerPathResolver');

async function isDirectoryPath(webdavPath) {
  try {
    await fileStore.listDirectory(webdavPath);
    return true;
  } catch (error) {
    try {
      if (!webdavPath.endsWith('/')) {
        await fileStore.listDirectory(webdavPath + '/');
        return true;
      }
    } catch (_) {}
    try {
      if (webdavPath.endsWith('/') && webdavPath !== '/') {
        await fileStore.listDirectory(webdavPath.slice(0, -1));
        return true;
      }
    } catch (_) {}
    return false;
  }
}

function scheduleBulkWorker(jobId) {
  if (process.env.NODE_ENV === 'test' && process.env.WEA_SKIP_BULK_WORKER === '1') {
    return;
  }
  setImmediate(runBulkJobWorker, jobId);
}

async function runBulkJobWorker(jobId) {
  const job = operationProgress.getJob(jobId);
  if (!job || job.status !== 'pending') return;
  operationProgress.updateJob(jobId, { status: 'running' });

  const userId = job.userId;
  let user;
  try {
    user = await getCachedUser(userId);
    if (!user) {
      operationProgress.updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.auth.userNotFound });
      return;
    }
    user = user.toObject ? user.toObject() : user;
  } catch (e) {
    operationProgress.updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.internalServerError });
    return;
  }

  const doc = await PermissionFacade.getPermissionDoc(userId);
  const canWriteDirSync = buildSyncWriteChecker(user, doc);
  const canWriteFileByParentSync = buildSyncWriteFileByParentChecker(user, doc);
  const canReadDirSync = buildSyncReadChecker(user, doc);
  const canReadFileSync = buildSyncReadFileChecker(user, doc);

  const getJobRef = () => operationProgress.getJob(jobId);
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
                await fileStore.listDirectory(filePath);
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
                console.debug ? console.debug(`[BulkJob ${jobId}] Skipping directory check for admin: user=${userId}, path=${filePath}`, dirError) : null;
              }
            }
            if (isDir) {
              if (user.is_admin || isOwnerPath(user, normalizedTargetPath)) {
                await fileStore.deleteFile(filePath, { isDirectory: true });
                try {
                  await PermissionFacade.revokePermissionsPrefixForAllUsers([normalizedTargetPath]);
                  allDeletedDirPrefixes.add(normalizedTargetPath);
                } catch (permError) {
                  console.error(`[BulkJob ${jobId}] Failed to revoke permissions after direct directory deletion: user=${userId}, path=${normalizedTargetPath}`, permError);
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
                  await PermissionFacade.revokePermissionsPrefixForAllUsers(prefixes);
                  prefixes.forEach(p => allDeletedDirPrefixes.add(p));
                }
              } catch (permError) {
                console.error(`[BulkJob ${jobId}] Failed to revoke permissions after selective directory deletion: user=${userId}, path=${normalizedTargetPath}`, permError);
              }
              pushResult({ path: filePath, status: 'succeeded' });
              if (result.skippedPaths && result.skippedPaths.length > 0) {
                result.skippedPaths.forEach(p => pushResult({ path: p, status: 'skipped' }));
              }
            } else {
              await fileStore.deleteFile(filePath, { isDirectory: false });
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
        operationProgress.updateJob(jobId, { status: finalJob.cancelled ? 'cancelled' : 'completed' });
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
                await PermissionFacade.rewritePermissionsForAllUsers(
                  [{ fromPrefix: normalizedSourcePath, toPrefix: normalizedDestinationPath }],
                  { excludePrefixes, duplicateExactMatches: !rootMovedFully }
                );
               } catch (permError) {
                console.error(`[BulkJob ${jobId}] Failed to rewrite permissions after move: user=${userId}, source=${sourcePath}, dest=${destinationPath}`, permError);
              }
              if (result.movedDirMappings && result.movedDirMappings.length > 0) {
                try {
                  await PermissionFacade.rewritePermissionsForAllUsers(result.movedDirMappings);
                } catch (permError) {
                  console.error(`[BulkJob ${jobId}] Failed to rewrite dir mappings after move: user=${userId}, source=${sourcePath}, dest=${destinationPath}`, permError);
                }
              }
              try {
                for (const dir of result.createdDirs || []) {
                  const homeOwnerId = await getHomeOwnerUserIdForPath(dir);
                  if (homeOwnerId != null) {
                    await PermissionFacade.grant(homeOwnerId, dir, PERMISSIONS.ADMIN);
                  }
                }
               } catch (permError) {
                console.error(`[BulkJob ${jobId}] Failed to grant home owner admin after directory move: user=${userId}, source=${sourcePath}, dest=${destinationPath}`, permError);
              }
              pushResult({ sourcePath, destinationPath, status: 'succeeded' });
              if (result.skippedPaths && result.skippedPaths.length > 0) {
                result.skippedPaths.forEach(p => pushResult({ path: p, status: 'skippedByConflict' }));
              }
            } else {
              const overwrite = onConflict === 'overwrite';
              await fileStore.moveFile(sourcePath, destinationPath, null, overwrite, { isDirectory: false });
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
        operationProgress.updateJob(jobId, { status: finalJob.cancelled ? 'cancelled' : 'completed' });
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
                  await PermissionFacade.grant(userId, dir, PERMISSIONS.WRITE);
                  allCreatedDirs.add(dir);
                }
              } catch (permError) {
                console.error(`[BulkJob ${jobId}] Failed to grant executor permissions after copy: user=${userId}, source=${sourcePath}, dest=${destinationPath}`, permError);
              }
              try {
                for (const dir of result.createdDirs || []) {
                  const homeOwnerId = await getHomeOwnerUserIdForPath(dir);
                  if (homeOwnerId != null) {
                    await PermissionFacade.grant(homeOwnerId, dir, PERMISSIONS.ADMIN);
                  }
                }
              } catch (permError) {
                console.error(`[BulkJob ${jobId}] Failed to grant home owner admin after copy: user=${userId}, source=${sourcePath}, dest=${destinationPath}`, permError);
              }
              pushResult({ sourcePath, destinationPath, status: 'succeeded' });
              if (result.skippedPaths && result.skippedPaths.length > 0) {
                result.skippedPaths.forEach(p => pushResult({ path: p, status: 'skippedByConflict' }));
              }
            } else {
              const overwrite = onConflict === 'overwrite';
              await fileStore.copyFile(sourcePath, destinationPath, null, overwrite, { isDirectory: false });
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
        operationProgress.updateJob(jobId, { status: finalJob.cancelled ? 'cancelled' : 'completed' });
      }
      return;
    }

    operationProgress.updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.defaultMessage });
  } catch (err) {
    console.error('runBulkJobWorker error:', err);
    operationProgress.updateJob(jobId, { status: 'failed', errorCode: SERVER_ERROR_CODES.errorHandler.internalServerError });
  }
}

module.exports = {
  scheduleBulkWorker,
  runBulkJobWorker,
  isDirectoryPath,
};
