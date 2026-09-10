'use strict';

const path = require('path');

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, notFoundError, forbiddenError } = require('../utils/errorHandler');
const storage = require('../store/storage');
const thumbnailService = require('../domains/thumbnails/services/thumbnailService');
const { createWebdavRemoteOps, buildTrashPath } = require('./webdavRemoteOps');

function isNotFoundError(error) {
  if (!error) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  if (error.$metadata && error.$metadata.httpStatusCode === 404) return true;
  const haystack = `${error.name || ''} ${error.message || ''}`;
  return /404|not found|notfound|nosuchkey/i.test(haystack);
}

/**
 * Factory: trash channel service (DEF-16 P3 — OS-recycle-bin semantics on top
 * of the P2 soft-delete model).
 *
 * restore: auto-restores trashed ANCESTORS (topmost trashed ancestor first —
 * Windows-style path recreation; siblings of each restored ancestor stay
 * trashed), then untrashes the target's whole subtree in ONE transaction.
 * Name collisions against LIVE siblings at every restore boundary auto-suffix
 * `name (2).ext` (resolveRestoreName — live siblings only, conflictResolver is
 * not touched). WebDAV mode moves each row's own /.wea-trash/<id> entry back
 * to its resolved display path BEFORE the DB transaction.
 *
 * Purge = the shared physical core `purgeNode` (WebDAV: trash-path remote
 * delete for trashed rows / display-path bottom-up for live rows; S3: eager
 * per-row blob deletes for the whole subtree — version rows die WITH the
 * trash), then `fileNodeService.deleteNode` + FK cascade (permission, share,
 * recent rows are removed at purge time). Consumers: the trash routes, GC
 * Tier 3 and the admin permanent-delete maintenance route.
 *
 * @param {Object} opts
 * @param {Object} opts.fileNodesStore - trash-aware tree reads/writes
 *   (getNodeIncludingTrashed, getChildren, getTrashChildren,
 *   getTopmostTrashedNodes, markSubtreeDeleted/untrashSubtree,
 *   getObjectMapBySubtree, renameNode).
 * @param {Object} opts.fileNodeService - tree ops (getDescendantIds,
 *   getNodePath, deleteNode).
 * @param {Object} [opts.blobStore] - blob-store adapter (headBlob/moveBlob/
 *   deleteBlob); required for the WebDAV remote moves.
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 * @param {Object} [opts.aclService] - permission gates; defaults to the real
 *   aclService singleton (composition injects it explicitly).
 */
function createTrashService({
  fileNodesStore,
  fileNodeService,
  blobStore,
  fileStorageMode = 's3',
  aclService: injectedAclService,
}) {
  const aclService = injectedAclService || require('../domains/permissions/services/aclService');
  const isWebdavMode = fileStorageMode === 'webdav' && Boolean(blobStore);

  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  function userIsAdmin(user) {
    return Boolean(user && aclService.isAdminUser(user));
  }

  /** HEAD the trash path; 404-style errors map to null, others propagate. */
  async function headTrashEntryOrNull(trashPath) {
    try {
      return await blobStore.headBlob(trashPath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Restore-name collision helper: checks LIVE siblings only (getChildren is a
   * live-row read) plus any names already claimed by co-restored siblings in
   * the same operation, and returns the first free `name`, `name (2).ext`,
   * `name (3).ext`, ... Windows recycle-bin style: the restored row is renamed
   * to the suffixed name. Deliberately NOT an extension of conflictResolver.
   */
  async function resolveRestoreName(parentId, name, claimedNames) {
    const siblings = await fileNodesStore.getChildren(parentId == null ? null : Number(parentId));
    const taken = new Set(siblings.map((sibling) => sibling.name));
    if (Array.isArray(claimedNames)) {
      for (const claimed of claimedNames) taken.add(claimed);
    }
    if (!taken.has(name)) return name;
    const ext = path.extname(name);
    const base = ext ? name.slice(0, name.length - ext.length) : name;
    for (let i = 2; ; i += 1) {
      const candidate = `${base} (${i})${ext}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Restore one trashed node (and auto-restore its trashed ancestors).
   * Returns the restore summary; all DB mutations happen in one TX after the
   * remote moves succeeded.
   */
  async function restoreNode(userId, nodeId, user) {
    const target = await fileNodesStore.getNodeIncludingTrashed(Number(nodeId));
    if (!target) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound, { nodeId: Number(nodeId) });
    }
    if (target.deletedAt == null) {
      throw createError(SERVER_ERROR_CODES.files.notTrashed, 409, { nodeId: Number(nodeId) });
    }

    // Trashed-ancestor chain: [target, parent, ...] up to (and including) the
    // TOPMOST trashed ancestor whose own parent is live-or-NULL.
    const chain = [target];
    let cursor = target;
    while (cursor.parentId != null) {
      const parent = await fileNodesStore.getNodeIncludingTrashed(cursor.parentId);
      if (!parent || parent.deletedAt == null) break;
      chain.push(parent);
      cursor = parent;
    }
    const restoreOrder = [...chain].reverse(); // topmost trashed ancestor first

    // Gates: write on the target node (delete-perm family) + write on the
    // first LIVE ancestor folder when it exists (move-dest precedent — the
    // target is placed back under it).
    if (!userIsAdmin(user)) {
      const nodeAllowed = await aclService.checkFilePermission(
        userId,
        Number(nodeId),
        PERMISSIONS.WRITE
      );
      if (!nodeAllowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
      const topmost = restoreOrder[0];
      if (topmost.parentId != null) {
        const parentAllowed = await aclService.checkFolderPermission(
          userId,
          topmost.parentId,
          PERMISSIONS.WRITE
        );
        if (!parentAllowed) {
          throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
        }
      }
    }

    // Restore order = topmost chain node → target, then the target's trashed
    // descendants breadth-first (getTrashChildren returns only trashed rows;
    // every child of a trashed row is trashed). Parents are always processed
    // before their children, so each row's final display path can be derived
    // incrementally.
    const orderedRows = [...restoreOrder];
    const queue = [target];
    while (queue.length > 0) {
      const node = queue.shift();
      const trashedChildren = await fileNodesStore.getTrashChildren(node.id);
      for (const child of trashedChildren) {
        orderedRows.push(child);
        queue.push(child);
      }
    }
    const untrashIds = orderedRows.map((row) => row.id);

    const renames = new Map(); // nodeId -> finalName (applied inside the TX)
    const finalPathByNodeId = new Map(); // nodeId -> post-restore display path
    const claimedByParent = new Map(); // parentId|null -> Set of claimed names
    const claim = (parentId, name) => {
      const key = parentId == null ? 'root' : Number(parentId);
      if (!claimedByParent.has(key)) claimedByParent.set(key, new Set());
      claimedByParent.get(key).add(name);
    };

    for (const row of orderedRows) {
      let parentFinalPath = null;
      if (row.parentId != null) {
        parentFinalPath = finalPathByNodeId.get(Number(row.parentId));
        if (parentFinalPath === undefined) {
          // Parent was not restored in this op (the live ancestor of the
          // topmost chain node) — resolve its current display path.
          parentFinalPath = await fileNodeService.getNodePath(Number(row.parentId));
        }
      }
      const claimed = claimedByParent.get(row.parentId == null ? 'root' : Number(row.parentId));
      const finalName = await resolveRestoreName(row.parentId, row.name, claimed || []);
      const rowFinalPath = parentFinalPath ? `${parentFinalPath}/${finalName}` : `/${finalName}`;
      finalPathByNodeId.set(row.id, rowFinalPath);
      claim(row.parentId, finalName);

      if (isWebdavMode) {
        const trashPath = buildTrashPath(row.id);
        const trashEntry = await headTrashEntryOrNull(trashPath);
        if (trashEntry != null) {
          // The row owns its own /.wea-trash/<id> entry (it was individually
          // trash-MOVEd): move it back to the resolved display path.
          await blobStore.moveBlob(trashPath, rowFinalPath);
        } else if (finalName !== row.name) {
          // Renamed covered row: its content came back with the subtree's
          // collection move and sits at the parent's final path under the
          // row's original name — rename it remotely to match the suffixed
          // DB name.
          const originalPath = parentFinalPath ? `${parentFinalPath}/${row.name}` : `/${row.name}`;
          if (originalPath !== rowFinalPath) {
            await blobStore.moveBlob(originalPath, rowFinalPath);
          }
        }
        // Covered + not renamed: the content came back with the subtree's own
        // trash MOVE-back and is already at the display path — nothing to do.
      }

      if (finalName !== row.name) {
        renames.set(row.id, finalName);
      }
    }

    // ONE TX for the whole restore: apply the collision renames (rows are
    // still trashed here — the partial live-only unique index does not apply),
    // then clear deleted_at on the chain + the target's whole subtree.
    await withTx(async () => {
      for (const [id, newName] of renames) {
        await fileNodesStore.renameNode(id, newName);
      }
      await fileNodesStore.untrashSubtree(untrashIds);
    });

    // Defensive thumbnail eviction (trash had no cache entry once the read
    // gates hit — the eviction is cheap insurance for pre-gating rows).
    try {
      thumbnailService.invalidate(Number(nodeId));
    } catch (_) {
      /* best-effort */
    }

    const finalPath = await fileNodeService.getNodePath(Number(nodeId));
    return {
      messageCode: SERVER_MESSAGE_CODES.files.trashRestored,
      nodeId: Number(nodeId),
      restoredNodes: untrashIds,
      finalPath,
    };
  }

  /**
   * Shared physical purge core (no permission gates — callers gate). Removes
   * the remote content first, then the DB subtree (FK cascade removes the
   * object_map/filecache/closure/permission/share/recent rows).
   *
   * WebDAV trashed row: deleteBlob at the row's own trash path
   * (/.wea-trash/<id>, recursive collection delete) — plus, when the row sits
   * INSIDE a still-trashed ancestor R, the covered path
   * /.wea-trash/<R>/<relative display path>. Best-effort (a missing path is
   * ignored). WebDAV live row: display-path bottom-up subtree delete
   * (webdavRemoteOps). S3 mode: deleteBlob for EVERY object_map row of the
   * subtree (active + history + orphaned + pending).
   */
  async function purgeNode(nodeId) {
    const id = Number(nodeId);
    const node = await fileNodesStore.getNodeIncludingTrashed(id);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound, { nodeId: id });
    }

    const subtreeRows = await fileNodesStore.getDescendants(id); // includes the self row
    const errors = [];
    let deletedBlobs = 0;

    if (isWebdavMode) {
      if (node.deletedAt != null) {
        try {
          await blobStore.deleteBlob(buildTrashPath(id));
          deletedBlobs += 1;
        } catch (error) {
          /* best-effort — the DB purge proceeds */
        }
        // A row trashed INSIDE a still-trashed ancestor has its content under
        // that ancestor's trash collection — remove the covered trash path.
        const trashRoot = await findTopmostTrashedAncestor(node);
        if (trashRoot && trashRoot.id !== id) {
          const [nodeDisplayPath, rootDisplayPath] = await Promise.all([
            fileNodeService.getNodePath(id),
            fileNodeService.getNodePath(trashRoot.id),
          ]);
          const relative = nodeDisplayPath.startsWith(rootDisplayPath)
            ? nodeDisplayPath.slice(rootDisplayPath.length)
            : '';
          if (relative) {
            try {
              await blobStore.deleteBlob(`${buildTrashPath(trashRoot.id)}${relative}`);
              deletedBlobs += 1;
            } catch (error) {
              /* best-effort — the DB purge proceeds */
            }
          }
        }
      } else {
        const remoteOps = createWebdavRemoteOps({
          blobStore,
          fileStorageMode,
          fileNodeService,
        });
        await remoteOps.deleteRemoteSubtreeBestEffort(id);
      }
    } else {
      const objectRows = await fileNodesStore.getObjectMapBySubtree(id);
      for (const row of objectRows) {
        if (!row.s3_key) continue;
        try {
          await blobStore.deleteBlob(row.s3_key);
          deletedBlobs += 1;
        } catch (error) {
          errors.push(`Failed to delete S3 blob ${row.s3_key}: ${error.message}`);
        }
      }
    }

    await fileNodeService.deleteNode(id);
    return { purgedNodes: subtreeRows.length, deletedBlobs, errors };
  }

  /** Topmost trashed ancestor of a trashed row (the row itself when topmost). */
  async function findTopmostTrashedAncestor(node) {
    let topmost = node;
    let cursor = node;
    while (cursor.parentId != null) {
      const parent = await fileNodesStore.getNodeIncludingTrashed(cursor.parentId);
      if (!parent || parent.deletedAt == null) break;
      topmost = parent;
      cursor = parent;
    }
    return topmost;
  }

  /**
   * Permanent delete of ONE trashed item (route-facing gates): the node must
   * be trashed (409 files.notTrashed) and the caller needs the same delete
   * perm a hard-delete requires today (write check, admin bypasses).
   */
  async function purgeTrashedNode(userId, nodeId, user) {
    const id = Number(nodeId);
    const node = await fileNodesStore.getNodeIncludingTrashed(id);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound, { nodeId: id });
    }
    if (node.deletedAt == null) {
      throw createError(SERVER_ERROR_CODES.files.notTrashed, 409, { nodeId: id });
    }
    if (!userIsAdmin(user)) {
      const allowed = await aclService.checkFilePermission(userId, id, PERMISSIONS.WRITE);
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }
    const result = await purgeNode(id);
    return {
      messageCode: SERVER_MESSAGE_CODES.files.trashPurged,
      nodeId: id,
      purgedNodes: result.purgedNodes,
      deletedBlobs: result.deletedBlobs,
    };
  }

  /**
   * Empty trash: purge every TOPMOST trashed node (their subtrees die with
   * each root), best-effort per node. The route enforces admin-only.
   */
  async function emptyTrash() {
    const topmost = await fileNodesStore.getTopmostTrashedNodes();
    const errors = [];
    let purgedNodes = 0;
    let purgedBlobs = 0;
    for (const node of topmost) {
      try {
        const result = await purgeNode(node.id);
        purgedNodes += result.purgedNodes;
        purgedBlobs += result.deletedBlobs;
      } catch (error) {
        errors.push(`Failed to purge trashed node ${node.id}: ${error.message}`);
      }
    }
    return { purgedNodes, purgedBlobs, errors };
  }

  return {
    resolveRestoreName,
    restoreNode,
    purgeNode,
    purgeTrashedNode,
    emptyTrash,
  };
}

module.exports = { createTrashService };
