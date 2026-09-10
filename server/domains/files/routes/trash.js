'use strict';

const express = require('express');
const router = express.Router();

const { HTTP_STATUS, PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateTokenOrShare } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = requireUser;
const { asyncHandler } = require('../../../utils/errorHandler');
const { isSharePrincipal } = require('../../permissions/services/aclService');
const ownerNodeResolver = require('../../permissions/policy/ownerNodeResolver');
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
 * GET /api/files/trash — trash listing (DEF-16 P9 companion route).
 *
 * Permission-based (NOT admin-only): returns the trashed nodes visible to the
 * caller — a trashed row is visible iff the caller has WRITE permission on it
 * (permission rows survive the trash) or is an admin. Per-row flags mirror
 * listDirectoryWithPermissions. Rows carry the original displayPath (path
 * resolution is trash-aware) and deletedAt. limit/offset paginate the
 * caller-visible set (default window 50).
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

    const trashedNodes = await fileNodesStore.getTrashedNodes();

    const visible = [];
    for (const node of trashedNodes) {
      let hasReadPermission;
      let hasWritePermission;
      let hasAdminPermission;

      if (isAdmin) {
        hasReadPermission = true;
        hasWritePermission = true;
        hasAdminPermission = true;
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
        hasAdminPermission = await ownerNodeResolver.isOwnerNode(principalId, node.id);
      }

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

module.exports = router;
