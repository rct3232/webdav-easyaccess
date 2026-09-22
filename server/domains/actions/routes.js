const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const actionsService = require('./service');

const ERROR_MAP = {
  invalidDomain: SERVER_ERROR_CODES.actions.invalidDomain,
  notFound: SERVER_ERROR_CODES.actions.notFound,
  cascadeConfirmRequired: SERVER_ERROR_CODES.actions.cascadeConfirmRequired,
  fingerprintMismatch: SERVER_ERROR_CODES.actions.fingerprintMismatch,
  expired: SERVER_ERROR_CODES.actions.expired,
  alreadyUndone: SERVER_ERROR_CODES.actions.alreadyUndone,
};

/**
 * Map service errors to HTTP errors. mapServiceError drops `params`, so the
 * cascade-confirm count (params.laterChanges) is copied over explicitly.
 * Errors already carrying status+errorCode (the executor's fingerprint
 * refusal, thrown inside the undo tx) pass through unchanged.
 */
function handleServiceError(error) {
  if (error && error.errorCode) {
    return error;
  }
  const mapped = mapServiceError(error, ERROR_MAP);
  if (error && error.params != null && Object.keys(error.params).length > 0) {
    mapped.params = error.params;
  }
  return mapped;
}

// GET /api/actions — 30-day feed, newest first, optional domain filter.
router.get(
  '/',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      res.json(await actionsService.getActionsFeed(req.user.full.id, { domain: req.query.domain }));
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

// POST /api/actions/:id/undo — tip undo free / cascade-confirm on non-tip.
router.post(
  '/:id/undo',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await actionsService.undoAction(req.user.full.id, Number(req.params.id), {
          confirmCascade: req.body && req.body.confirmCascade === true,
        })
      );
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

module.exports = router;