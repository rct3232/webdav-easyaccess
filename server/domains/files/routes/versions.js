'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { authenticateTokenOrShare } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = requireUser;
const { asyncHandler, notFoundError, validationError } = require('../../../utils/errorHandler');
const { parseNodeId } = require('../../../middleware/validateNodeIdParam');

const { isSharePrincipal } = require('../../permissions/services/aclService');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');

const { getComposition } = require('../../../service/composition');

// DEF-11: no share-token access to version history (past-content disclosure
// guard). Share principals receive an explicit 403 on every versions route.
function requireTokenNotShare(req, res, next) {
  if (isSharePrincipal(req.principalId)) {
    return res
      .status(HTTP_STATUS.FORBIDDEN)
      .json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }
  next();
}

function parseVersionNumber(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

router.get(
  '/versions',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const nodeId = parseNodeId(req.query.nodeId, 'nodeId');
    const { versionsService } = getComposition();
    const result = await versionsService.listVersions(req.principalId, nodeId, req.user?.full);
    res.json(result);
  })
);

router.post(
  '/versions/restore',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const { nodeId, versionNumber } = req.body;
    if (nodeId == null || versionNumber == null) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const parsedNodeId = parseNodeId(nodeId, 'nodeId');
    const parsedVersion = parseVersionNumber(versionNumber);
    if (parsedVersion === null) {
      throw notFoundError(SERVER_ERROR_CODES.files.versionNotFound, {
        versionNumber,
      });
    }

    const { versionsService } = getComposition();
    const result = await versionsService.restoreVersion(
      req.principalId,
      parsedNodeId,
      parsedVersion,
      req.user?.full
    );

    res.json({
      messageCode: result.messageCode || SERVER_MESSAGE_CODES.files.versionRestored,
      nodeId: result.nodeId,
      restoredVersionNumber: result.restoredVersionNumber,
    });
  })
);

router.get(
  '/versions/download',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const nodeId = parseNodeId(req.query.nodeId, 'nodeId');
    const versionNumber = parseVersionNumber(req.query.versionNumber);
    if (versionNumber === null) {
      throw notFoundError(SERVER_ERROR_CODES.files.versionNotFound, {
        versionNumber: req.query.versionNumber,
      });
    }

    const { versionsService, fileNodeService } = getComposition();
    const buffer = await versionsService.downloadVersion(
      req.principalId,
      nodeId,
      versionNumber,
      req.user?.full
    );
    if (!buffer) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }

    const node = await fileNodeService.getNode(nodeId);
    const filename = node ? node.name : `version-${versionNumber}`;
    const encodedFilename = encodeURIComponent(filename);
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_'); // eslint-disable-line no-control-regex
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', 'application/octet-stream');

    res.send(buffer);
  })
);

module.exports = router;
