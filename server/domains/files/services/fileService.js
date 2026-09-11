'use strict';

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { buildTrashPath } = require('../../../service/webdavRemoteOps');
const { getThumbnailUrl } = require('../../thumbnails/services/thumbnailService');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { conflictError, notFoundError, forbiddenError } = require('../../../utils/errorHandler');
const ownerNodeResolver = require('../../permissions/policy/ownerNodeResolver');
const permissionStore = require('../../../store/permissionStore');

function createFileService(options = {}) {
  const fileNodeService = options.fileNodeService;
  const blobStorageService = options.blobStorageService;
  const uploadService = options.uploadService;
  const aclService = options.aclService;
  const fileStorageMode = options.fileStorageMode || 's3';
  const blobStore = options.blobStore || null;
  const _ownerNodeResolver = options.ownerNodeResolver || ownerNodeResolver;
  const _permissionStore = options.permissionStore || permissionStore;
  const _fileNodesStore = options.fileNodesStore || null;
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
      parentOwned =
        parentNodeId != null
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
          hasReadPermission = await aclService.checkFolderPermission(
            userId,
            child.id,
            PERMISSIONS.READ
          );
          hasWritePermission = await aclService.checkFolderPermission(
            userId,
            child.id,
            PERMISSIONS.WRITE
          );
        } else {
          hasReadPermission = await aclService.checkFilePermission(
            userId,
            child.id,
            PERMISSIONS.READ
          );
          hasWritePermission = await aclService.checkFilePermission(
            userId,
            child.id,
            PERMISSIONS.WRITE
          );
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

      const hasAdminPermission =
        isAdmin ||
        parentOwned ||
        (adminGrantNodeIds != null && adminGrantNodeIds.has(Number(child.id)));

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
    const existingFile = existingChildren.find((c) => c.name === name && c.type === 'file');

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
    let tmpPath = null;
    let displayPath = null;
    if (!isOverwrite) {
      const newFile = await fileNodeService.createFile(parentNodeId, name);
      nodeId = newFile.id;
    } else {
      nodeId = existingFile.id;
      // Last-good snapshot BEFORE the destructive PUT: one server-side COPY
      // of the previous bytes into the reserved /.wea-tmp namespace. A COPY
      // failure aborts before touching the live path; a missing remote source
      // means there is nothing to protect and the PUT proceeds.
      if (blobStore) {
        displayPath = await fileNodeService.getNodePath(nodeId);
        const candidate = `/.wea-tmp/${nodeId}`;
        try {
          await blobStore.ensureDirectoryExists('/.wea-tmp');
          await blobStore.copyBlob(displayPath, candidate);
          tmpPath = candidate;
        } catch (error) {
          if (!error || error.errorCode !== SERVER_ERROR_CODES.webdav.sourceNotFound) {
            throw error;
          }
        }
      }
    }

    try {
      await blobStorageService.uploadToWebdav(nodeId, buffer);
    } catch (error) {
      if (!isOverwrite) {
        // New node: roll it back so a failed upload never leaves a phantom
        // 0-byte file in listings or blocks a retry with a duplicate-name 409.
        try {
          await fileNodeService.deleteNode(nodeId);
        } catch (_) {
          /* best-effort — surface the original upload error */
        }
      } else if (tmpPath && blobStore) {
        // Restore the previous bytes (native MOVE tmp→display, Overwrite:T).
        try {
          await blobStore.moveBlob(tmpPath, displayPath, true);
        } catch (restoreError) {
          // Restoration failed — fail-safe marker on the existing node.
          try {
            await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
          } catch (_) {
            /* best-effort — the original PUT error still surfaces */
          }
        }
      } else {
        // Existing node without a restorable snapshot: fail-safe marker, kept.
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      }
      throw error;
    }

    if (tmpPath && blobStore) {
      // Snapshot is spent — best-effort cleanup. A leftover /.wea-tmp entry
      // (failed delete or crash) is reconciliation residue (DEF-18 class).
      try {
        await blobStore.deleteBlob(tmpPath);
      } catch (_) {
        /* best-effort */
      }
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
    if (siblings.some((s) => s.name === newName && s.id !== nodeId)) {
      throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
    }

    // WebDAV sync (native MOVE + DB rollback): capture the remote path BEFORE
    // the DB rename so the MOVE — and the rollback — can address it afterwards.
    const oldPath =
      fileStorageMode === 'webdav' && blobStore
        ? await fileNodeService.getNodePath(nodeId)
        : null;

    await fileNodeService.renameNode(nodeId, newName);

    if (oldPath !== null) {
      const newPath = await fileNodeService.getNodePath(nodeId);
      try {
        await blobStore.moveBlob(oldPath, newPath);
      } catch (error) {
        if (error && error.errorCode === SERVER_ERROR_CODES.webdav.sourceNotFound) {
          // No remote content existed to move → nothing to restore. The DB
          // rename stands and the node is flagged for repair; the error
          // propagates so the user sees the degraded sync.
          await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
          throw error;
        }
        try {
          await fileNodeService.renameNode(nodeId, node.name);
        } catch (rollbackError) {
          // Rollback failed (e.g. the old name was taken meanwhile) — keep the
          // DB change and mark it instead of silently desyncing.
          await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
        }
        throw error;
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

    // WebDAV sync (native MOVE + DB rollback): capture the remote path and the
    // original parent BEFORE the DB move so the MOVE — and the rollback — can
    // address them afterwards.
    let oldPath = null;
    let oldParentNodeId = null;
    if (fileStorageMode === 'webdav' && blobStore) {
      const node = await fileNodeService.getNode(nodeId);
      oldParentNodeId = node ? node.parent_id : null;
      oldPath = await fileNodeService.getNodePath(nodeId);
    }

    await fileNodeService.moveNode(nodeId, newParentNodeId);

    if (oldPath !== null) {
      const newPath = await fileNodeService.getNodePath(nodeId);
      try {
        await blobStore.moveBlob(oldPath, newPath);
      } catch (error) {
        if (error && error.errorCode === SERVER_ERROR_CODES.webdav.sourceNotFound) {
          await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
          throw error;
        }
        try {
          await fileNodeService.moveNode(nodeId, oldParentNodeId);
        } catch (rollbackError) {
          await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
        }
        throw error;
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

    // WebDAV (DEF-16 P2): ONE remote MOVE of the subtree root to the reserved
    // hidden trash path before any DB marking. Children travel with the
    // collection; S3 mode does zero physical I/O (stable UUID keys).
    if (fileStorageMode === 'webdav' && blobStore) {
      // The /.wea-trash/ parent must exist — WebDAV MOVE does not auto-create
      // destination parents (500 → fallback 403 when missing). Idempotent MKCOL.
      await blobStore.ensureDirectoryExists('/.wea-trash');
      const displayPath = await fileNodeService.getNodePath(nodeId);
      const trashPath = buildTrashPath(nodeId);
      // Destination-exists guard: a pre-existing /.wea-* entry (legacy /
      // out-of-band node — new .wea- names are rejected by validateFileName)
      // must never be clobbered. Abort with a clear error; no marking happens.
      let trashTargetFree = true;
      try {
        trashTargetFree = (await blobStore.headBlob(trashPath)) == null;
      } catch (_) {
        // Probe inconclusive (non-404 error) — let the MOVE surface the failure.
      }
      if (!trashTargetFree) {
        throw _conflictError(SERVER_ERROR_CODES.files.trashTargetExists);
      }
      try {
        await blobStore.moveBlob(displayPath, trashPath);
      } catch (error) {
        // MOVE failure: existing fail-safe marker on the subtree root, the
        // trash is aborted (deleted_at stays unset) and the error surfaces.
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
        throw error;
      }
    }

    // Soft delete: mark every row of the subtree. No physical row removal —
    // fileNodeService.deleteNode (hard delete) stays reserved for the repair
    // channel, upload/copy rollback and the admin permanent-delete route.
    await fileNodeService.markSubtreeDeleted([nodeId, ...descendantIds]);
    return { deletedCount: descendantIds.length + 1 };
  }

  async function copyFile(nodeId, destinationParentNodeId, newName, userId, user) {
    if (!user || !aclService.isAdminUser(user)) {
      const sourceAllowed = await aclService.checkFilePermission(userId, nodeId, 'read');
      if (!sourceAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
      const destAllowed = await aclService.checkFolderPermission(
        userId,
        destinationParentNodeId,
        'write'
      );
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
      // A copy is immediately usable and migratable: mirror the S3 upload
      // lifecycle end-state ('active') instead of leaving the new node
      // pending_upload, which would drop it from s3→webdav migration snapshots
      // (they enumerate only sync_status='active' file nodes).
      await fileNodeService.updateSyncStatus(copiedNodeId, 'active');

      // Mirror the source filecache row onto the copy: the COW blob is
      // byte-identical, so the copy lists the real size/mime without a
      // remote probe (without this the listing LEFT JOIN yields no row → 0 B).
      if (_fileNodesStore) {
        const sourceCache = await _fileNodesStore.getCache(nodeId);
        if (sourceCache) {
          await _fileNodesStore.upsertCache(
            copiedNodeId,
            Number(sourceCache.size),
            sourceCache.mime_type,
            null
          );
        }
      }

      return { sourceNodeId: nodeId, copiedNodeId };
    }

    // WebDAV mode: one native server-side COPY (Depth: infinity — a directory
    // source travels with its whole subtree; streamed fallback inside the
    // adapter). Bytes never round-trip through the app.
    const sourcePath = await fileNodeService.getNodePath(nodeId);
    const newFile = await fileNodeService.createFile(destinationParentNodeId, targetName);
    const copiedNodeId = newFile.id;
    let copyPath = null;

    try {
      copyPath = await fileNodeService.getNodePath(copiedNodeId);
      await blobStore.copyBlob(sourcePath, copyPath);
    } catch (error) {
      // New copy node: roll it back on a failed remote write (no phantom copy).
      try {
        await fileNodeService.deleteNode(copiedNodeId);
      } catch (_) {
        /* best-effort — surface the original copy error */
      }
      throw error;
    }

    // Mirror listing metadata for files (directories carry no filecache row).
    if (sourceNode.type === 'file' && _fileNodesStore) {
      const head = await blobStore.headBlob(copyPath);
      if (head) {
        await _fileNodesStore.upsertCache(
          copiedNodeId,
          Number(head.contentLength) || 0,
          head.contentType || 'application/octet-stream',
          null
        );
      }
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
