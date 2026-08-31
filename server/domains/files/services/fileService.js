'use strict';

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getThumbnailUrl } = require('../../thumbnails/services/thumbnailService');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { conflictError, notFoundError, forbiddenError, validationError } = require('../../../utils/errorHandler');
const ownerNodeResolver = require('../../permissions/policy/ownerNodeResolver');
const permissionStore = require('../../../store/permissionStore');

function createFileService(options = {}) {
  const fileNodeService = options.fileNodeService;
  const blobStorageService = options.blobStorageService;
  const uploadService = options.uploadService;
  const aclService = options.aclService;
  const fileStorageMode = options.fileStorageMode || 's3';
  const _ownerNodeResolver = options.ownerNodeResolver || ownerNodeResolver;
  const _permissionStore = options.permissionStore || permissionStore;
  const _conflictError = options.conflictError || conflictError;
  const _notFoundError = options.notFoundError || notFoundError;

  async function listDirectoryWithPermissions(userId, parentNodeId, user) {
    const children = await fileNodeService.listDirectory(parentNodeId);

    if (!children || children.length === 0) {
      return [];
    }

    const isAdmin = user && aclService.isAdminUser(user);
    const isShareCaller = aclService.isSharePrincipal(userId);

    // Admin capability ("can manage permissions on this node") is derived once
    // per listing:
    // - Admin bypass covers every node.
    // - The owner is an effective admin on every node under their own home root
    //   (ownership derived via the closure table, NOT stored grant rows — see
    //   "No self-grants" in docs/features/permissions.md). Children of an owned
    //   directory are owned, so a single isOwnerNode(parent) check suffices.
    // - A user additionally keeps the admin capability on nodes where they hold
    //   an explicit admin grant (e.g. admin received on a shared folder).
    // Share principals never carry an admin capability.
    let parentOwned = false;
    let adminGrantNodeIds = null;
    if (!isAdmin && !isShareCaller && children.length > 0) {
      parentOwned = parentNodeId != null
        ? await _ownerNodeResolver.isOwnerNode(userId, Number(parentNodeId))
        : false;
      const grants = await _permissionStore.getUserPermissions(userId);
      adminGrantNodeIds = new Set(
        (grants || [])
          .filter((grant) => grant.permission === 'admin')
          .map((grant) => Number(grant.file_node_id))
      );
    }

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

      // For SHARE principals only, exclude children the principal cannot read.
      // Share tokens must never disclose sibling/parent nodes outside the share
      // scope (the share-scope metadata leak, D2). Regular user listings RETAIN
      // unreadable children with their hasReadPermission:false flags — the
      // request-access flow (E2E-OVERLAY-003) needs to see them in another
      // user's folder. Admin bypass sets both flags true, so admin listings are
      // unaffected.
      if (isShareCaller && !hasReadPermission) {
        continue;
      }

      const hasAdminPermission = isAdmin
        || parentOwned
        || (adminGrantNodeIds != null && adminGrantNodeIds.has(Number(child.id)));

      const display_path = await fileNodeService.getNodePath(child.id);

      let thumbnailUrl = null;
      if (isImageFile(child.name) || isVideoFile(child.name)) {
        thumbnailUrl = await getThumbnailUrl(child.id);
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
        hasAdminPermission,
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

    // Ownership-transfer detection (D6). A non-admin mover that OWNS the node
    // (node inside its home subtree) and moves it OUTSIDE that home subtree
    // loses ownership: its explicit permission rows on the moved subtree
    // (historical self-grants, admin-assigned rows) would otherwise resurface
    // in `GET /api/permissions/shared` as "shared with me" leaks. Resolved
    // BEFORE the move because the closure-table rebuild afterwards rewrites the
    // moved subtree's ancestry. A mover that merely received a grant (node not
    // under its home) does NOT own it — the received grant must persist.
    const isAdmin = !!user && aclService.isAdminUser(user);
    let ownershipTransfer = false;
    if (user && !isAdmin) {
      const ownedBeforeMove = await _ownerNodeResolver.isOwnerNode(userId, nodeId);
      if (ownedBeforeMove) {
        const destInsideMoverHome =
          newParentNodeId != null &&
          (await _ownerNodeResolver.isOwnerNode(userId, newParentNodeId));
        ownershipTransfer = !destInsideMoverHome;
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

    // After the closure rebuild: on ownership transfer, revoke the mover's rows
    // on the moved subtree (root + descendants, depth >= 0) so the moved folder
    // can never resurface in the mover's `__shared__` listing. Admin movers are
    // skipped (no home, no self-grant rows to leak). Best-effort: the DB move
    // already committed; a failed cleanup must not abort the move.
    if (ownershipTransfer) {
      await _permissionStore.revokeUserSubtreePermissions(userId, nodeId);
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
