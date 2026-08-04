'use strict';

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getThumbnailUrl } = require('../../thumbnails/services/thumbnailService');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { conflictError, notFoundError, forbiddenError, validationError } = require('../../../utils/errorHandler');

function createFileService(options = {}) {
  const fileNodeService = options.fileNodeService;
  const blobStorageService = options.blobStorageService;
  const uploadService = options.uploadService;
  const aclService = options.aclService;
  const fileStorageMode = options.fileStorageMode || 's3';
  const _conflictError = options.conflictError || conflictError;
  const _notFoundError = options.notFoundError || notFoundError;

  async function listDirectoryWithPermissions(userId, parentNodeId, user) {
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

  async function uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict) {
    if (!user || !aclService.isAdminUser(user)) {
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
        await blobStorageService.ensureExclusiveBlob(existingFile.id);
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

  async function downloadFile(fileNodeId, userId, user) {
    if (!user || !aclService.isAdminUser(user)) {
      const allowed = await aclService.checkFilePermission(userId, fileNodeId, 'read');
      if (!allowed) {
        throw _notFoundError(SERVER_ERROR_CODES.files.notFound);
      }
    }

    const buffer = await blobStorageService.downloadBlob(fileNodeId);
    if (buffer === null || buffer === undefined) {
      throw _notFoundError(SERVER_ERROR_CODES.files.notFound);
    }
    return buffer;
  }

  async function renameNode(nodeId, newName, userId, user) {
    if (!newName || newName.trim().length === 0) {
      throw conflictError(SERVER_ERROR_CODES.files.invalidName);
    }
    if (newName.includes('/') || newName.includes('\\')) {
      throw conflictError(SERVER_ERROR_CODES.files.invalidName);
    }

    if (!user || !aclService.isAdminUser(user)) {
      const allowed = await aclService.checkFilePermission(userId, nodeId, 'write');
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    const node = await fileNodeService.getNode(nodeId);
    const siblings = await fileNodeService.listDirectory(node.parent_id);
    if (siblings.some(s => s.name === newName && s.id !== nodeId)) {
      throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
    }

    // Best-effort WebDAV storage sync: download content before DB rename so we can re-upload to new path
    let webdavBuffer = null;
    if (fileStorageMode === 'webdav') {
      try {
        webdavBuffer = await blobStorageService.downloadBlob(nodeId);
      } catch (_) {
        // If download fails, proceed with DB rename only; storage sync is best-effort
      }
    }

    await fileNodeService.renameNode(nodeId, newName);

    // Re-upload to new path after rename (DB state is authoritative)
    if (fileStorageMode === 'webdav' && webdavBuffer != null) {
      try {
        await blobStorageService.uploadToWebdav(nodeId, webdavBuffer);
      } catch (error) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      }
    }

    return { nodeId, newName };
  }

  async function moveNode(nodeId, newParentNodeId, userId, user) {
    if (!user || !aclService.isAdminUser(user)) {
      const sourceAllowed = await aclService.checkFilePermission(userId, nodeId, 'write');
      if (!sourceAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
      const destAllowed = await aclService.checkFolderPermission(userId, newParentNodeId, 'write');
      if (!destAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

   // Best-effort WebDAV storage sync: download content before DB move so we can re-upload to new path
    let webdavBuffer = null;
    if (fileStorageMode === 'webdav') {
      try {
        webdavBuffer = await blobStorageService.downloadBlob(nodeId);
      } catch (_) {
        // If download fails, proceed with DB move only; storage sync is best-effort
      }
    }

    await fileNodeService.moveNode(nodeId, newParentNodeId);

    // Re-upload to new path after move (DB state is authoritative)
    if (fileStorageMode === 'webdav' && webdavBuffer != null) {
      try {
        await blobStorageService.uploadToWebdav(nodeId, webdavBuffer);
      } catch (error) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      }
    }

    return { nodeId, newParentId: newParentNodeId };
  }

  async function deleteNode(nodeId, userId, user) {
    if (!user || !aclService.isAdminUser(user)) {
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

    // WebDAV: bottom-up storage deletion before DB removal (deepest first, then target node)
    if (fileStorageMode === 'webdav') {
      const allNodesToCleanup = [...descendantIds].reverse().concat([nodeId]);
      for (const descId of allNodesToCleanup) {
        try {
          await blobStorageService.deleteBlob(descId);
        } catch (error) {
          await fileNodeService.updateSyncStatus(descId, 'orphaned_node');
        }
      }
    }

    await fileNodeService.deleteNode(nodeId);
    return { deletedCount: descendantIds.length + 1 };
  }

  async function copyFile(nodeId, destinationParentNodeId, newName, userId, user) {
    if (!user || !aclService.isAdminUser(user)) {
      const sourceAllowed = await aclService.checkFilePermission(userId, nodeId, 'read');
      if (!sourceAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
      const destAllowed = await aclService.checkFolderPermission(userId, destinationParentNodeId, 'write');
      if (!destAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    const sourceNode = await fileNodeService.getNode(nodeId);
    if (!sourceNode) {
      throw _notFoundError(SERVER_ERROR_CODES.files.notFound);
    }
    const targetName = newName || sourceNode.name;

    if (fileStorageMode === 's3') {
      // COW logic: determine effective S3 key BEFORE creating file_node to avoid orphan window
      const activeS3Key = await blobStorageService.getActiveS3Key(nodeId);
      const activeCount = await blobStorageService.countActiveObjectsByS3Key(activeS3Key);

      let effectiveS3Key;
      if (activeCount === 1) {
        // Blob is exclusively owned → link the same key (zero-copy)
        effectiveS3Key = activeS3Key;
      } else {
        // Blob is shared → duplicate so new copy doesn't add another sharer
        effectiveS3Key = await blobStorageService.duplicateBlob(activeS3Key);
      }

      const newFile = await fileNodeService.createFile(destinationParentNodeId, targetName);
      const copiedNodeId = newFile.id;
      await blobStorageService.linkObject(copiedNodeId, effectiveS3Key);

      return { sourceNodeId: nodeId, copiedNodeId };
    }

    // WebDAV mode: download + upload
    const buffer = await blobStorageService.downloadBlob(nodeId);
    const newFile = await fileNodeService.createFile(destinationParentNodeId, targetName);
    const copiedNodeId = newFile.id;

    try {
      await blobStorageService.uploadToWebdav(copiedNodeId, buffer);
    } catch (error) {
      await fileNodeService.updateSyncStatus(copiedNodeId, 'orphaned_node');
      throw error;
    }

    return { sourceNodeId: nodeId, copiedNodeId };
  }

  return {
    listDirectoryWithPermissions,
    downloadFile,
    uploadFile,
    renameNode,
    moveNode,
    deleteNode,
    copyFile,
  };
}

module.exports = { createFileService };
