'use strict';

const express = require('express');
const router = express.Router();

const { HTTP_STATUS, PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateTokenOrShare } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = requireUser;
const {
  asyncHandler,
  notFoundError,
  validationError,
  forbiddenError,
} = require('../../../utils/errorHandler');
const { parseNodeId } = require('../../../middleware/validateNodeIdParam');
const { isSharePrincipal } = require('../../permissions/services/aclService');
const ownerNodeResolver = require('../../permissions/policy/ownerNodeResolver');
const permissionStore = require('../../../store/permissionStore');
const { getComposition } = require('../../../service/composition');

const DEFAULT_TRASH_LIMIT = 50;
const MAX_TRASH_LIMIT = 200;

function requireTokenNotShare(req, res, next) {
  if (isSharePrincipal(req.principalId)) {
    return res
      .status(HTTP_STATUS.FORBIDDEN)
      .json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }
  next();
}

/**
 * GET /api/files/trash — trash listing (DEF-16 P2/P3/P9).
 *
 * Permission-based (NOT admin-only): returns the trashed nodes visible to the
 * caller — a trashed row is visible iff the caller has WRITE permission on it
 * (permission rows survive the trash) or is an admin. Per-row flags mirror
 * listDirectoryWithPermissions (admin bypass; ownership + explicit admin
 * grants). Rows carry the original displayPath (path resolution is
 * trash-aware) and deletedAt.
 *
 * Hierarchical navigation: WITHOUT `parentId` only the TOPMOST trashed rows
 * are returned (deleted_at ≠ NULL AND parent live-or-NULL — never the flat
 * full list; getTrashedNodes stays a GC/empty internal). With `parentId` the
 * route returns that node's trashed children (getTrashChildren), so the trash
 * view can navigate into trashed folders. limit/offset paginate the
 * caller-visible set (default window 50, capped at 200).
 */
router.get(
  '/trash',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  asyncHandler(async (req, res) => {
    const user = req.user.full;
    const principalId = req.principalId;
    const { fileNodesStore, fileNodeService, aclService } = getComposition();

    const isAdmin = aclService.isAdminUser(user);

    const limitParam = Number.parseInt(req.query.limit, 10);
    const offsetParam = Number.parseInt(req.query.offset, 10);
    const limit =
      Number.isInteger(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_TRASH_LIMIT)
        : DEFAULT_TRASH_LIMIT;
    const offset = Number.isInteger(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

    const parentIdParam = req.query.parentId;
    let trashedNodes;
    if (parentIdParam !== undefined && parentIdParam !== '') {
      const parentId = parseNodeId(parentIdParam, 'parentId');
      const parentNode = await fileNodesStore.getNodeIncludingTrashed(parentId);
      if (!parentNode) {
        throw notFoundError(SERVER_ERROR_CODES.files.notFound, { nodeId: parentId });
      }
      trashedNodes = await fileNodesStore.getTrashChildren(parentId);
    } else {
      trashedNodes = await fileNodesStore.getTopmostTrashedNodes();
    }

    // Admin capability ("can manage permissions on this node"), computed like
    // listDirectoryWithPermissions: admin bypass covers every row; otherwise
    // ownership (closure table) + explicit admin grants decide.
    let adminGrantNodeIds = null;
    if (!isAdmin) {
      const grants = await permissionStore.getUserPermissions(principalId);
      adminGrantNodeIds = new Set(
        (grants || [])
          .filter((grant) => grant.permission === 'admin')
          .map((grant) => Number(grant.file_node_id))
      );
    }

    const visible = [];
    for (const node of trashedNodes) {
      let hasReadPermission;
      let hasWritePermission;

      if (isAdmin) {
        hasReadPermission = true;
        hasWritePermission = true;
      } else {
        const check =
          node.type === 'directory'
            ? aclService.checkFolderPermission
            : aclService.checkFilePermission;
        hasWritePermission = await check.call(aclService, principalId, node.id, PERMISSIONS.WRITE);
        // Visibility = trashed ∧ write perm survives on the row (or admin).
        // Read-only grantees are invisible to the trash listing.
        if (!hasWritePermission) continue;
        hasReadPermission = await check.call(aclService, principalId, node.id, PERMISSIONS.READ);
      }

      const hasAdminPermission =
        isAdmin ||
        (await ownerNodeResolver.isOwnerNode(principalId, node.id)) ||
        (adminGrantNodeIds != null && adminGrantNodeIds.has(Number(node.id)));

      const displayPath = await fileNodeService.getNodePath(node.id);
      visible.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        deletedAt: node.deletedAt,
        displayPath,
        hasReadPermission,
        hasWritePermission,
        hasAdminPermission,
      });
    }

    res.json({ items: visible.slice(offset, offset + limit), total: visible.length });
  })
);

/**
 * POST /api/files/trash/restore — OS-recycle-bin restore (DEF-16 P3).
 * Gates + semantics live in trashService.restoreNode: node must be trashed
 * (409 files.notTrashed), write perm on the node + the first live parent
 * folder (403), trashed ancestors auto-restore (siblings stay trashed),
 * name collisions auto-suffix `name (2).ext`, WebDAV mode moves each row's
 * trash entry back before the single all-or-nothing DB TX.
 */
router.post(
  '/trash/restore',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const { nodeId } = req.body || {};
    if (nodeId == null) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }
    const parsedNodeId = parseNodeId(nodeId, 'nodeId');

    const { trashService } = getComposition();
    const result = await trashService.restoreNode(req.principalId, parsedNodeId, req.user?.full);
    res.json({
      messageCode: result.messageCode,
      nodeId: result.nodeId,
      restoredNodes: result.restoredNodes,
      finalPath: result.finalPath,
    });
  })
);

/**
 * POST /api/files/trash/purge — permanent delete of ONE trashed item
 * (DEF-16 P3). Gates: node must be trashed (409 files.notTrashed); delete
 * perm = the same write check a hard-delete requires today (admin bypasses).
 * Physical: WebDAV trash-path deletes / S3 per-row blob deletes, then the DB
 * hard delete (FK cascade removes permission/share rows at purge time).
 */
router.post(
  '/trash/purge',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const { nodeId } = req.body || {};
    if (nodeId == null) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }
    const parsedNodeId = parseNodeId(nodeId, 'nodeId');

    const { trashService } = getComposition();
    const result = await trashService.purgeTrashedNode(
      req.principalId,
      parsedNodeId,
      req.user?.full
    );
    res.json({
      messageCode: result.messageCode,
      nodeId: result.nodeId,
      purgedNodes: result.purgedNodes,
      deletedBlobs: result.deletedBlobs,
    });
  })
);

/**
 * POST /api/files/trash/empty — purge ALL topmost trashed items (DEF-16 P3).
 * ADMIN-only: non-admin callers receive 403. Best-effort per node; the
 * response carries the aggregate counts plus collected errors.
 */
router.post(
  '/trash/empty',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const user = req.user.full;
    const { trashService, aclService } = getComposition();

    if (!user || !aclService.isAdminUser(user)) {
      throw forbiddenError(SERVER_ERROR_CODES.admin.adminRequired);
    }

    const result = await trashService.emptyTrash();
    res.json({
      purgedNodes: result.purgedNodes,
      purgedBlobs: result.purgedBlobs,
      errors: result.errors,
    });
  })
);

module.exports = router;
