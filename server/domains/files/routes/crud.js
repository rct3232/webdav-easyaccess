'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const multer = require('multer');

const { authenticateToken, authenticateTokenOrShare } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = requireUser;
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const { asyncHandler, validationError, forbiddenError, notFoundError, conflictError } = require('../../../utils/errorHandler');

const { createFileService } = require('../services/fileService');
const { getConflicts } = require('../services/conflictResolver');

const {
  checkFilePermission,
  checkFolderPermission,
  canWriteFolder,
  canWriteFile,
  isSharePrincipal,
} = require('../../permissions/services/aclService');
const PermissionFacade = require('../../permissions/services/permissionFacade');

const { getHomeOwnerUserIdForPath } = require('../../permissions/policy/ownerPathResolver');
const { getFileMetadata, pathExists, createDirectory, putFileContents } = require('../../../utils/webdav');

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');

const upload = multer({ storage: multer.memoryStorage(), preservePath: true });

function requireTokenNotShare(req, res, next) {
  if (isSharePrincipal(req.principalId)) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }
  next();
}

async function isDirectoryPath(webdavPath) {
  try {
    const result = await pathExists(webdavPath);
    if (result) return true;
  } catch (error) {}
  try {
    if (!webdavPath.endsWith('/')) {
      const meta = await getFileMetadata(webdavPath + '/');
      if (meta && meta.type === 'directory') return true;
    }
  } catch (_) {}
  try {
    if (webdavPath.endsWith('/') && webdavPath !== '/') {
      const meta = await getFileMetadata(webdavPath.slice(0, -1));
      if (meta && meta.type === 'directory') return true;
    }
  } catch (_) {}
  return false;
}

const METADATA_PATHS_LIMIT = 100;

router.post('/check-conflicts', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { operations, limit = true } = req.body;
  if (!operations || !Array.isArray(operations)) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const conflicts = await getConflicts(operations, { limit });
  res.json({ conflicts });
}));

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
    const hasRead = await checkFilePermission(principalId, normalized, PERMISSIONS.READ);
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

  let hasPermission = await checkFolderPermission(principalId, folderPath, PERMISSIONS.READ);
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
  const fileService = createFileService();
  const itemsWithThumbnails = await fileService.listDirectoryWithPermissions(principalId, folderPath, user, isShare);

  res.json(itemsWithThumbnails);
}));

router.get('/download', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const inline = req.query.inline === 'true';

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const principalId = req.principalId;
  const hasPermission = await checkFilePermission(principalId, filePath, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const fileService = createFileService();
  const buffer = await fileService.downloadFile(filePath);
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
  } catch (e) {}

  let folderPath = req.body.path || '/';
  const relativePath = req.body.relativePath || '';

  const user = req.user.full;
  
  if (!user.is_admin) {
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
    folderPath = normalizePath(folderPath);
  }
  
  if (folderPath !== '/' && !folderPath.endsWith('/')) {
    folderPath = folderPath + '/';
  }
  
  let finalFolderPath = folderPath;
  if (relativePath) {
    const relativeDir = path.dirname(relativePath);
    if (relativeDir && relativeDir !== '.') {
      finalFolderPath = path.join(folderPath, relativeDir).replace(/\\/g, '/');
      if (!finalFolderPath.endsWith('/')) {
        finalFolderPath = finalFolderPath + '/';
      }
      
      const dirParts = relativeDir.split('/').filter(Boolean);
      let currentPath = folderPath;
      
      let parentFolderOwners = [];
      try {
        const parentPermissions = await PermissionFacade.getFolderPermissions(folderPath);
        parentFolderOwners = parentPermissions
          .filter(perm => perm.permission === PERMISSIONS.WRITE || perm.permission === PERMISSIONS.ADMIN)
          .map(perm => perm.id);
      } catch (permQueryError) {
        console.error('Failed to query parent folder permissions:', permQueryError);
      }
      
      for (const dirPart of dirParts) {
        currentPath = path.join(currentPath, dirPart).replace(/\\/g, '/');
        if (!currentPath.endsWith('/')) {
          currentPath = currentPath + '/';
        }
        
        const dirExists = await pathExists(currentPath);
        
        if (!dirExists) {
          try {
            await createDirectory(currentPath);
            
            try {
              await PermissionFacade.grant(req.user.id, currentPath, PERMISSIONS.WRITE);
              
              for (const ownerId of parentFolderOwners) {
                try {
                  if (ownerId !== req.user.id) {
                    await PermissionFacade.grant(ownerId, currentPath, PERMISSIONS.WRITE);
                  }
                } catch (ownerPermError) {
                  console.error(`Failed to grant permission to parent folder owner ${ownerId} for ${currentPath}:`, ownerPermError);
                }
              }

              try {
                const homeOwnerId = await getHomeOwnerUserIdForPath(currentPath);
                if (homeOwnerId != null) {
                  await PermissionFacade.grant(homeOwnerId, currentPath, PERMISSIONS.ADMIN);
                }
              } catch (homeOwnerPermError) {
                console.error('Failed to grant home owner admin permission for intermediate directory:', homeOwnerPermError);
              }
              
            } catch (permError) {
              console.error('Failed to grant permissions for intermediate directory:', permError);
            }
          } catch (createError) {}
        }
      }
    }
  }

  const { onConflict } = req.body;

  const filePath = finalFolderPath === '/' 
    ? '/' + originalFilename 
    : (finalFolderPath + originalFilename).replace(/\\/g, '/').replace(/\/+/g, '/');

  const fileExists = await pathExists(filePath);

  if (fileExists && onConflict === 'skip') {
    return res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSkipped, path: filePath, skipped: true });
  }

  if (fileExists && onConflict !== 'overwrite') {
    throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
  }

  await putFileContents(filePath, req.file.buffer);

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSuccess, path: filePath });
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
    : await canWriteFile(user, normalizedOld);

  if (!hasPermission) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }

  const fileService = createFileService();
  const result = await fileService.renameFile(oldPath, newName);

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.renameSuccess, path: result.path });
}));

module.exports = router;
