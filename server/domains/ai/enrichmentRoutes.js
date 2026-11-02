'use strict';

/**
 * /api/ai/enrichments router (docs/spec/server/routes/aiEnrichments.md) —
 * read-only AI Info surface for the properties dialog. JWT only: the route is
 * never mounted behind `authenticateTokenOrShare`, so share-link tokens are
 * excluded by construction.
 *
 * Mount (server/index.js, after the setup guard, next to /api/search):
 *   app.use('/api/ai', setupModeGuardInstance,
 *     require('./domains/ai/enrichmentRoutes'));
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { parseNodeId } = require('../../middleware/validateNodeIdParam');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getComposition } = require('../../service/composition');

const ERROR_MAP = {
  notFound: SERVER_ERROR_CODES.files.notFound,
};

function handleServiceError(error) {
  return mapServiceError(error, ERROR_MAP);
}

router.get(
  '/enrichments/:nodeId',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    // Derived, per-viewer state — never cacheable at any layer.
    res.set('Cache-Control', 'no-store');
    const nodeId = parseNodeId(req.params.nodeId, 'nodeId');
    const { enrichmentService } = getComposition();
    try {
      const result = await enrichmentService.getNodeEnrichment(req.user.full.id, nodeId);
      res.json({ node_id: result.nodeId, enrichment: result.enrichment });
    } catch (error) {
      throw handleServiceError(error);
    }
  })
);

module.exports = router;
