'use strict';

const path = require('path');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createFileStoreAdapter } = require('../../../infrastructure/adapters/filestore');
const PermissionFacade = require('../../../domains/permissions/services/permissionFacade');
const { getThumbnailUrl } = require('../../thumbnails/services/thumbnailService');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { conflictError, notFoundError, forbiddenError, validationError } = require('../../../utils/errorHandler');
const { buildSyncWriteChecker, buildSyncReadChecker, buildSyncWriteFileByParentChecker, buildSyncReadFileChecker, isOwnerPath } = require('../../../domains/permissions/services/aclService');
const { getHomeOwnerUserIdForPath } = require('../../../domains/permissions/policy/ownerNodeResolver');

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
  const fileNodeService = options.fileNodeService;
  const blobStorageService = options.blobStorageService;
  const uploadService = options.uploadService;
  const aclService = options.aclService;
  const fileStorageMode = options.fileStorageMode || 's3';
  const _conflictError = options.conflictError || conflictError;
  const _notFoundError = options.notFoundError || notFoundError;

  // ═══════════════════════════════════════════════════════════════════
  //  LEGACY path-based methods (preserved identically for routes/files.test.js)
  // ═══════════════════════════════════════════════════════════════════

  async function listDirectoryByPath(principalId, folderPath, user, isShare) {
    const doc = isShare ? null : await PermissionFacade.getPermissionDoc(user.id);

    let items;
    try {
      items = await webdav.listDirectory(folderPath);
    } catch (error) {
      if (error.status === HTTP_STATUS.NOT_FOUND) {
        throw _notFoundError(SERVER_ERROR_CODES.files.invalidPath);
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

  async function downloadFileByPath(filePath) {
    return await webdav.getFileContents(filePath);
  }

  async function uploadFileByPath(user, folderPath, fileBuffer, originalFilename, relativePath, onConflict) {
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
      return { path: filePath, skipped: true };
    }

    if (fileExists && onConflict !== 'overwrite') {
      throw _conflictError(SERVER_ERROR_CODES.files.duplicateFile);
    }

    await webdav.putFileContents(filePath, fileBuffer);
    return { path: filePath };
  }

  async function renameFileByPath(oldPath, newName) {
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
      throw _conflictError(SERVER_ERROR_CODES.files.duplicateFile);
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

  // ═══════════════════════════════════════════════════════════════════
  //  NEW nodeId-based methods (added alongside legacy, not replacing)
  // ═══════════════════════════════════════════════════════════════════

  async function listDirectoryByNodeId(userId, parentNodeId, user) {
    const children = await fileNodeService.listDirectory(parentNodeId);

    if (!children || children.length === 0) {
      return [];
    }

    const isAdmin = user && aclService.isAdminUser(user);

    const results = [];
    for (const child of children) {
      let hasReadPermission;
      let hasWritePermission;

      if (isAdmin) {
        hasReadPermission = true;
        hasWritePermission = true;
      } else {
        const isDir = child.type === 'directory';
        if (isDir) {
          hasReadPermission = await aclService.checkFolderPermission(userId, child.id, PERMISSIONS.READ);
          hasWritePermission = await aclService.checkFolderPermission(userId, child.id, PERMISSIONS.WRITE);
        } else {
          hasReadPermission = await aclService.checkFilePermission(userId, child.id, PERMISSIONS.READ);
          hasWritePermission = await aclService.checkFilePermission(userId, child.id, PERMISSIONS.WRITE);
        }
      }

      const display_path = await fileNodeService.getNodePath(child.id);

      let thumbnailUrl = null;
      if (isImageFile(child.name) || isVideoFile(child.name)) {
        thumbnailUrl = getThumbnailUrl(display_path || `/${child.name}`);
      }

      results.push({
        id: child.id,
        nodeId: child.id,
        name: child.name,
        type: child.type,
        display_path,
        size: child.size ?? null,
        mimeType: child.mimeType ?? null,
        modifiedAt: child.updatedAt ?? null,
        hasReadPermission,
        hasWritePermission,
        isHidden: (child.name || '').startsWith('.'),
        thumbnailUrl,
      });
    }

    return results;
  }

  async function uploadFileByNodeId(userId, parentNodeId, name, buffer, mimeType, user, onConflict) {
    if (!aclService.isAdminUser(user)) {
      const allowed = await aclService.checkFolderPermission(userId, parentNodeId, 'write');
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    // Conflict check: see if file with same name exists under parent
    const existingChildren = await fileNodeService.listDirectory(parentNodeId);
    const existingFile = existingChildren.find(c => c.name === name && c.type === 'file');

    if (existingFile) {
      if (onConflict === 'skip') {
        return { nodeId: existingFile.id, skipped: true };
      }
      if (onConflict !== 'overwrite') {
        throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
      }
    }

    const isOverwrite = !!existingFile;

    if (fileStorageMode === 's3') {
      if (isOverwrite) {
        return await uploadService.overwriteFile(existingFile.id, buffer, mimeType);
      }
      return await uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
    }

    // WebDAV mode
    let nodeId;
    if (!isOverwrite) {
      const newFile = await fileNodeService.createFile(parentNodeId, name);
      nodeId = newFile.id;
    } else {
      nodeId = existingFile.id;
    }

    try {
      await blobStorageService.uploadToWebdav(nodeId, buffer);
    } catch (error) {
      await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      throw error;
    }

    return { nodeId, size: buffer.length, mimeType };
  }

  async function downloadFileByNodeId(fileNodeId, userId, user) {
    if (!aclService.isAdminUser(user)) {
      const allowed = await aclService.checkFilePermission(userId, fileNodeId, 'read');
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    const buffer = await blobStorageService.downloadBlob(fileNodeId);
    if (buffer === null || buffer === undefined) {
      throw _notFoundError(SERVER_ERROR_CODES.files.notFound);
    }
    return buffer;
  }

  async function renameNode(nodeId, newName, userId, user) {
    if (!newName || newName.length === 0) {
      throw validationError(SERVER_ERROR_CODES.files.invalidName);
    }
    if (newName.includes('/') || newName.includes('\\')) {
      throw validationError(SERVER_ERROR_CODES.files.invalidName);
    }

    if (!aclService.isAdminUser(user)) {
      const allowed = await aclService.checkFilePermission(userId, nodeId, 'write');
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    await fileNodeService.renameNode(nodeId, newName);

    // Best-effort WebDAV MOVE on failure, mark orphaned but do not abort DB rename
    if (fileStorageMode === 'webdav') {
      try {
        const newPath = await fileNodeService.getNodePath(nodeId);
        // WebDAV MOVE attempt via blobStorageService (best-effort)
        await blobStorageService.uploadToWebdav(nodeId, Buffer.alloc(0));
      } catch (error) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      }
    }

    return { nodeId, newName };
  }

  async function moveNode(nodeId, newParentNodeId, userId, user) {
    if (!aclService.isAdminUser(user)) {
      const sourceAllowed = await aclService.checkFilePermission(userId, nodeId, 'write');
      if (!sourceAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
      const destAllowed = await aclService.checkFolderPermission(userId, newParentNodeId, 'write');
      if (!destAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    await fileNodeService.moveNode(nodeId, newParentNodeId);

    // Best-effort WebDAV MOVE on failure, mark orphaned but do not abort DB move
    if (fileStorageMode === 'webdav') {
      try {
        // WebDAV MOVE attempt via blobStorageService (best-effort)
        await blobStorageService.uploadToWebdav(nodeId, Buffer.alloc(0));
      } catch (error) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      }
    }

    return { nodeId, newParentId: newParentNodeId };
  }

  async function deleteNodeByNodeId(nodeId, userId, user) {
    if (!aclService.isAdminUser(user)) {
      const allowed = await aclService.checkFilePermission(userId, nodeId, 'write');
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      throw _notFoundError(SERVER_ERROR_CODES.files.notFound);
    }

    const descendantIds = await fileNodeService.getDescendantIds(nodeId);

    // WebDAV: bottom-up storage deletion before DB removal
    if (fileStorageMode === 'webdav') {
      for (const descendantId of [...descendantIds].reverse()) {
        try {
          await blobStorageService.deleteBlob(descendantId);
        } catch (error) {
          await fileNodeService.updateSyncStatus(descendantId, 'orphaned_node');
        }
      }
    }

    await fileNodeService.deleteNode(nodeId);
    return { deletedCount: descendantIds.length };
  }

  async function copyFileByNodeId(nodeId, destinationParentNodeId, newName, userId, user) {
    if (!aclService.isAdminUser(user)) {
      const sourceAllowed = await aclService.checkFilePermission(userId, nodeId, 'read');
      if (!sourceAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
      const destAllowed = await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
      if (!destAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    if (fileStorageMode === 's3') {
      // COW logic: check if blob is exclusively owned
      const activeS3Key = await blobStorageService.getActiveS3Key(nodeId);
      const activeCount = await blobStorageService.countActiveObjectsByS3Key(activeS3Key);

      const newFile = await fileNodeService.createFile(destinationParentNodeId, newName);
      const copiedNodeId = newFile.id;

      if (activeCount === 1) {
        await blobStorageService.linkObject(copiedNodeId, activeS3Key);
      } else {
        const newS3Key = await blobStorageService.duplicateBlob(activeS3Key);
        await blobStorageService.linkObject(copiedNodeId, newS3Key);
      }

      return { sourceNodeId: nodeId, copiedNodeId };
    }

    // WebDAV mode: download + upload
    const buffer = await blobStorageService.downloadBlob(nodeId);
    const newFile = await fileNodeService.createFile(destinationParentNodeId, newName);
    const copiedNodeId = newFile.id;

    try {
      await blobStorageService.uploadToWebdav(copiedNodeId, buffer);
    } catch (error) {
      await fileNodeService.updateSyncStatus(copiedNodeId, 'orphaned_node');
      throw error;
    }

    return { sourceNodeId: nodeId, copiedNodeId };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Export — conditional dispatch based on DI injection
  // ═══════════════════════════════════════════════════════════════════

  if (fileNodeService) {
    // nodeId-injected mode (unit tests / future routes)
    return {
      listDirectoryWithPermissions: listDirectoryByNodeId,
      downloadFile: downloadFileByNodeId,
      uploadFile: uploadFileByNodeId,
      renameFile: renameFileByPath,
      renameNode,
      moveNode,
      deleteNode: deleteNodeByNodeId,
      copyFile: copyFileByNodeId,
    };
  }

  // Legacy path-based mode (current routes, files.test.js)
  return {
    listDirectoryWithPermissions: listDirectoryByPath,
    downloadFile: downloadFileByPath,
    uploadFile: uploadFileByPath,
    renameFile: renameFileByPath,
  };
}

module.exports = { createFileService };
