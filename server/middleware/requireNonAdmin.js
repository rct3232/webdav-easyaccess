/**
 * Middleware gating personal-storage surfaces (collections, file-likes,
 * dashboard) to NON-admin actors: the admin is a pure operator and never
 * participates in them (owner pivot 2026-10-01 — docs/features/permissions.md
 * "Owner exception" scope bullet, docs/spec/server/routes/{collections,fileLikes,dashboard}.md §2.3).
 *
 * Usage: router.get('/path', authenticateToken, requireUser, requireNonAdmin, handler)
 *
 * Reads the resolved principal the same way requireUser does (req.user.full,
 * set by requireUser from req.user.id). An admin requester gets 403
 * serverErrors.collections.forbidden — the shared admin-operator gate code
 * (docs/shared-contracts.md); no new i18n codes. The file-ACL
 * admin-owns-everything convention (permissionPolicy / isOwnerNode) is
 * untouched; it governs file surfaces, not these ones.
 */

const { forbiddenError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

/**
 * Reject admin requesters with the operator-gate 403.
 *
 * @param {Object} req - Express request object (after requireUser)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @example
 * router.get('/profile', authenticateToken, requireUser, requireNonAdmin, handler);
 */
function requireNonAdmin(req, res, next) {
  if (req.user && req.user.full && req.user.full.is_admin) {
    return next(forbiddenError(SERVER_ERROR_CODES.collections.forbidden));
  }
  return next();
}

module.exports = requireNonAdmin;
