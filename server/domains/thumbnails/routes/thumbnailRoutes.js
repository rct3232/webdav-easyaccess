const express = require('express');
const router = express.Router();
const { authenticateTokenOrShare } = require('../../../utils/auth');
const { ensureThumbnailsBatch } = require('../services/thumbnailService');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { requireAuth } = require('../../../middleware/requireUser');
const { asyncHandler, validationError } = require('../../../utils/errorHandler');
const { checkFilePermission } = require('../../permissions/services/aclService');
const { parseNodeId } = require('../../../middleware/validateNodeIdParam');

router.post(
  '/batch',
  authenticateTokenOrShare,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { nodeIds } = req.body;

    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const principalId = req.principalId;
    const allowedNodeIds = [];
    for (const raw of nodeIds) {
      const nodeId = parseNodeId(raw);
      const canRead = await checkFilePermission(principalId, nodeId, PERMISSIONS.READ);
      if (canRead) allowedNodeIds.push(nodeId);
    }

    const results = await ensureThumbnailsBatch(allowedNodeIds);

    res.json({ thumbnails: results });
  })
);

module.exports = router;
