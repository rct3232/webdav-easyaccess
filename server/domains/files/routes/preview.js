const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const archiver = require('archiver');
const path = require('path');

const { authenticateToken, authenticateTokenOrShare } = require('../../../utils/auth');
const Permission = require('../../../models/Permission');
const {
  listDirectory,
  getFileContents,
  isVideoFile,
} = require('../../../utils/webdav');
const { thumbnailCache, getThumbnailHash, ensureThumbnailsBatch } = require('../../../utils/thumbnail');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { normalizePath, getParentPath, getBasename } = require('@webdav-easyaccess/shared/pathUtils');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { isSharePrincipal } = require('../../../middleware/permissions');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = require('../../../middleware/requireUser');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../../../utils/errorHandler');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');
const { selectiveCollectFiles } = require('../services/selectiveDownload');
const { canReadFile, buildSyncReadChecker, buildSyncReadFileChecker } = require('../../../utils/permissionPolicy');
const { createOperationProgressStore } = require('../stores/operationProgress');

const opStore = createOperationProgressStore();

/* ------------------------------------------------------------------ */
/* 1. POST /preview-ticket                                            */
/* ------------------------------------------------------------------ */
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

  const ticket = opStore.issuePreviewTicket(principalId, filePath);
  res.json({ ticket });
}));

/* ------------------------------------------------------------------ */
/* 2. GET /preview-stream                                             */
/* ------------------------------------------------------------------ */
router.get('/preview-stream', normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const ticket = req.query.ticket;

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const entry = opStore.readPreviewTicket(ticket);
  if (!entry) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketInvalid });
  }

  const normalizedReqPath = normalizePath(filePath);
  const normalizedTicketPath = normalizePath(entry.filePath);
  if (normalizedReqPath !== normalizedTicketPath) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketMismatch });
  }

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

/* ------------------------------------------------------------------ */
/* 3. POST /download-multiple                                         */
/* ------------------------------------------------------------------ */
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

  opStore.setDownloadProgress(downloadId, {
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

  opStore.setDownloadProgress(downloadId, {
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
    opStore.setDownloadProgress(downloadId, {
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
      opStore.setDownloadProgress(downloadId, {
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

  opStore.setDownloadProgress(downloadId, {
    status: 'completed',
    progress: allFiles.length,
    total: allFiles.length,
    current: '',
    zipName: `${zipName}.zip`,
  });

  opStore.cleanupDownloadProgress(downloadId);
}));

/* ------------------------------------------------------------------ */
/* 4. GET /download-progress/:id                                      */
/* ------------------------------------------------------------------ */
router.get('/download-progress/:id', authenticateTokenOrShare, requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = opStore.getDownloadProgress(id);

  if (!progress) {
    throw notFoundError(SERVER_ERROR_CODES.files.progressNotFound);
  }

  res.json(progress);
}));

/* ------------------------------------------------------------------ */
/* 5. GET /thumbnail/:hash                                            */
/* ------------------------------------------------------------------ */
router.get('/thumbnail/:hash', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { hash } = req.params;

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

/* ------------------------------------------------------------------ */
/* 6. POST /thumbnails/batch                                          */
/* ------------------------------------------------------------------ */
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

  const results = await ensureThumbnailsBatch(allowedPaths);

  res.json({ thumbnails: results });
}));

module.exports = router;
