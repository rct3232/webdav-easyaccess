/**
 * Middleware gating personal-storage surfaces (collections, file-likes,
 * storage) to NON-admin actors: the admin is a pure operator and never
 * participates in them (owner pivot 2026-10-01 — docs/features/permissions.md
 * "Owner exception" scope bullet, docs/spec/server/routes/{collections,fileLikes,storage}.md §2.3).
 *
 * Usage: router.get('/path', authenticateToken, requireUser, requireNonAdmin, handler)
 *
 * Reads the resolved principal the same way requireUser does (req.user.full,
 * set by requireUser from req.user.id). An admin requester gets 403 with the
 * shared admin-operator gate code for the surface (collections default;
 * storage routes use `requireNonAdmin.withCode(SERVER_ERROR_CODES.storage.forbidden)`).
 * The file-ACL admin-owns-everything convention (permissionPolicy / isOwnerNode)
 * is untouched; it governs file surfaces, not these ones.
 */

const { forbiddenError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

/**
 * Build the operator-gate middleware for a specific error code.
 *
 * @param {string} code - SERVER_ERROR_CODES value returned to admin requesters
 * @returns {Function} Express middleware
 */
function requireNonAdminWithCode(code) {
  return function requireNonAdminForSurface(req, res, next) {
    if (req.user && req.user.full && req.user.full.is_admin) {
      return next(forbiddenError(code));
    }
    return next();
  };
}

/**
 * Reject admin requesters with the collections operator-gate 403.
 *
 * @param {Object} req - Express request object (after requireUser)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @example
 * router.get('/profile', authenticateToken, requireUser, requireNonAdmin, handler);
 */
function requireNonAdmin(req, res, next) {
  return requireNonAdminWithCode(SERVER_ERROR_CODES.collections.forbidden)(req, res, next);
}

requireNonAdmin.withCode = requireNonAdminWithCode;

module.exports = requireNonAdmin;
