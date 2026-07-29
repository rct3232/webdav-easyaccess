'use strict';

const path = require('path');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createFileStoreAdapter } = require('../../../infrastructure/adapters/filestore');
const PermissionFacade = require('../../../domains/permissions/services/permissionFacade');
const { getThumbnailUrl } = require('../../thumbnails/services/thumbnailService');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { conflictError, notFoundError } = require('../../../utils/errorHandler');
const { buildSyncWriteChecker, buildSyncReadChecker, buildSyncWriteFileByParentChecker, buildSyncReadFileChecker, isOwnerPath } = require('../../../domains/permissions/services/aclService');
const { getHomeOwnerUserIdForPath } = require('../../../domains/permissions/policy/ownerPathResolver');

async function _isDirectoryPath(webdavPath, webdav) {
  try {
    await webdav.listDirectory(webdavPath);
    return true;
  } catch (error) {
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

function createFileService(options = {}) {
  const webdav = options.webdav || createFileStoreAdapter();
  const _conflictError = options.conflictError || conflictError;
  const _notFoundError = options.notFoundError || notFoundError;

  async function listDirectoryWithPermissions(principalId, folderPath, user, isShare) {
    const doc = isShare ? null : await PermissionFacade.getPermissionDoc(user.id);

    let items;
    try {
      items = await webdav.listDirectory(folderPath);
    } catch (error) {
      if (error.status === HTTP_STATUS.NOT_FOUND) {
        throw _notFoundError(SERVER_MESSAGE_CODES.files.invalidPath);
      }
      throw error;
    }

    const filteredItems = user && user.is_admin
      ? items
      : items.filter(item => item.basename !== '.wea');

    const currentDirWritePermission = isShare
      ? false
      : (user.is_admin || isOwnerPath(user, folderPath) || PermissionFacade.checkPermissionSync(doc, folderPath, PERMISSIONS.WRITE));

    const syncCheckers = {};
    if (!isShare && !user.is_admin) {
      syncCheckers.canWriteFolder = buildSyncWriteChecker(user, doc);
      syncCheckers.canReadFolder = buildSyncReadChecker(user, doc);
      syncCheckers.canWriteFileByParent = buildSyncWriteFileByParentChecker(user, doc);
      syncCheckers.canReadFile = buildSyncReadFileChecker(user, doc);
    }

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
          hasReadPermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkPermissionSync(doc, normalizedPath, PERMISSIONS.READ);
          hasWritePermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkPermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);
        }
      } else {
        if (user.is_admin) {
          hasReadPermission = true;
          hasWritePermission = true;
        } else {
          hasReadPermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkFilePermissionSync(doc, normalizedPath, PERMISSIONS.READ);
          hasWritePermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkFilePermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);
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

    return itemsWithThumbnails.filter(item => item !== null);
  }

  async function downloadFile(filePath) {
    return await webdav.getFileContents(filePath);
  }

  async function uploadFile(user, folderPath, fileBuffer, originalFilename, relativePath, onConflict) {
    let normalizedFolderPath;

    if (user.is_admin) {
      normalizedFolderPath = normalizePath(folderPath);
    } else {
      const normalizedPath = normalizePath(folderPath);
      if (normalizedPath === '/' || normalizedPath === '') {
        normalizedFolderPath = `/${user.username}`;
      } else {
        normalizedFolderPath = normalizedPath;
      }
    }

    let finalFolderPath;
    if (normalizedFolderPath !== '/') {
      finalFolderPath = normalizedFolderPath.endsWith('/') ? normalizedFolderPath : normalizedFolderPath + '/';
    } else {
      finalFolderPath = '/';
    }

    if (relativePath) {
      const relativeDir = path.dirname(relativePath);
      if (relativeDir && relativeDir !== '.') {
        let constructedPath = path.join(finalFolderPath, relativeDir).replace(/\\/g, '/');
        if (!constructedPath.endsWith('/')) {
          constructedPath = constructedPath + '/';
        }
        finalFolderPath = constructedPath;

        const dirParts = relativeDir.split('/').filter(Boolean);
        let currentPath = normalizedFolderPath;

        let parentFolderOwners = [];
        try {
          const parentPermissions = await PermissionFacade.getFolderPermissions(normalizedFolderPath);
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

          const dirExists = await webdav.pathExists(currentPath);

          if (!dirExists) {
            try {
              await webdav.createDirectory(currentPath);

              try {
                await PermissionFacade.grant(user.id, currentPath, PERMISSIONS.WRITE);

                for (const ownerId of parentFolderOwners) {
                  try {
                    if (ownerId !== user.id) {
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

    let filename = originalFilename;
    try {
      if (/[^\x00-\x7F]/.test(filename)) {
        const latin1Buffer = Buffer.from(filename, 'latin1');
        filename = latin1Buffer.toString('utf8');
      }
    } catch (e) {}

    const filePath = finalFolderPath === '/'
      ? '/' + filename
      : (finalFolderPath + filename).replace(/\\/g, '/').replace(/\/+/g, '/');

    const fileExists = await webdav.pathExists(filePath);

    if (fileExists && onConflict === 'skip') {
      return { path: filePath };
    }

    if (fileExists && onConflict !== 'overwrite') {
      throw _conflictError(SERVER_MESSAGE_CODES.files.duplicateFile);
    }

    await webdav.putFileContents(filePath, fileBuffer);
    return { path: filePath };
  }

  async function renameFile(oldPath, newName) {
    const isDir = await _isDirectoryPath(oldPath, webdav);
    const normalizedOld = normalizePath(oldPath);

    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName).replace(/\\/g, '/');
    const normalizedOldPath = oldPath.replace(/\\/g, '/');
    const normalizedNewPath = newPath.replace(/\\/g, '/');

    if (normalizedOldPath === normalizedNewPath) {
      return { path: newPath };
    }

    const targetExists = await webdav.pathExists(newPath);
    if (targetExists) {
      throw _conflictError(SERVER_MESSAGE_CODES.files.duplicateFile);
    }

    await webdav.moveFile(oldPath, newPath, null, false, { isDirectory: isDir });

    if (isDir) {
      const normalizedNew = normalizePath(newPath);
      try {
        await PermissionFacade.rewritePermissionsForAllUsers([{ fromPrefix: normalizedOld, toPrefix: normalizedNew }]);
      } catch (permError) {
        console.error('Failed to rewrite permissions after directory rename:', permError);
      }

      try {
        const homeOwnerId = await getHomeOwnerUserIdForPath(normalizedNew);
        if (homeOwnerId != null) {
          await PermissionFacade.grant(homeOwnerId, normalizedNew, PERMISSIONS.ADMIN);
        }
      } catch (homeOwnerPermError) {
        console.error('Failed to grant home owner admin permission after directory rename:', homeOwnerPermError);
      }
    }

    return { path: newPath };
  }

  return {
    listDirectoryWithPermissions,
    downloadFile,
    uploadFile,
    renameFile,
  };
}

module.exports = { createFileService };