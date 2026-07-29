const archiver = require('archiver');
const path = require('path');
const { listDirectory, getFileContents } = require('../../../utils/webdav');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { normalizePath, getParentPath, getBasename } = require('@webdav-easyaccess/shared/pathUtils');
const { validationError, forbiddenError } = require('../../../utils/errorHandler');
const { selectiveCollectFiles } = require('./selectiveDownload');
const { isSharePrincipal, buildSyncReadChecker, buildSyncReadFileChecker, checkFolderPermission, checkFilePermission } = require('../../permissions/services/aclService');
const PermissionFacade = require('../../permissions/services/permissionFacade');

async function detectIsDirectory(filePath) {
  try {
    const parentPath = getParentPath(filePath);
    const fileName = getBasename(filePath);
    const parentItems = await listDirectory(parentPath);
    const item = parentItems.find(i => i.basename === fileName);
    if (item) return item.type === 'directory';
  } catch {}
  try {
    const items = await listDirectory(filePath);
    return items.length > 0 || filePath.endsWith('/');
  } catch {
    return false;
  }
}

async function downloadMultiple(req, res, opStore) {
  const principalId = req.principalId;
  const isShare = isSharePrincipal(principalId);
  const { paths, downloadId: clientDownloadId } = req.body;
  const downloadId = clientDownloadId || `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  let canEnterDirectory;
  let canIncludeFile;

  const checkInclude = async (fp) => {
    const r = canIncludeFile(fp);
    return typeof r?.then === 'function' ? await r : Boolean(r);
  };

  if (isShare) {
    const token = req.shareContext.token;
    canEnterDirectory = (dirPath) => checkFolderPermission('share:' + token, dirPath, PERMISSIONS.READ);
    canIncludeFile = (filePath) => checkFilePermission('share:' + token, filePath, PERMISSIONS.READ);
  } else {
    const user = req.user.full;
    const doc = await PermissionFacade.getPermissionDoc(principalId);
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
      const isDirectory = await detectIsDirectory(filePath);

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
}

module.exports = {
  downloadMultiple,
};
