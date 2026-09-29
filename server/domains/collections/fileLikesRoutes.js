/**
 * /api/file-likes router (docs/spec/server/routes/fileLikes.md) — viewer-scoped
 * like read + explicit set for the context-menu / action-sheet / properties
 * heart. Separate mount from /api/collections (per-node subject); the router
 * file stays in the collections domain. No journal involvement (§4.11).
 *
 * Mount (server/index.js, next to the collections mount):
 *   app.use('/api/file-likes', setupModeGuardInstance,
 *     require('./domains/collections/fileLikesRoutes'));
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError, validationError } = require('../../utils/errorHandler');
const { parseNodeId } = require('../../middleware/validateNodeIdParam');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const fileLikesService = require('./fileLikesService');
const wire = require('./wire');

const ERROR_MAP = {
  notFound: SERVER_ERROR_CODES.files.notFound,
};

function handleServiceError(error) {
  return mapServiceError(error, ERROR_MAP);
}

router.get(
  '/',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const liked = await fileLikesService.listLikedNodeIds(req.user.full.id);
      res.json({ liked });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.get(
  '/items',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const result = await fileLikesService.listLikedItems(req.user.full.id, {
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      res.json({
        items: result.items.map(wire.serializeLikedItem),
        next_cursor: result.nextCursor,
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.put(
  '/:nodeId',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const nodeId = parseNodeId(req.params.nodeId, 'nodeId');
      const { liked } = req.body || {};
      if (typeof liked !== 'boolean') {
        throw validationError(SERVER_ERROR_CODES.files.invalidPath);
      }
      const result = await fileLikesService.setLiked(req.user.full.id, nodeId, liked);
      res.json({ node_id: result.nodeId, liked: result.liked });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

module.exports = router;
