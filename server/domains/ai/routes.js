const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError, validationError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { USAGE_ACTION } = require('@webdav-easyaccess/shared/constants');
const { createSearchService } = require('./searchService');
const { getUsageService } = require('../../infrastructure/usageService');

const searchService = createSearchService();

const ERROR_MAP = {
  queryRequired: SERVER_ERROR_CODES.search.queryRequired,
  queryTooLong: SERVER_ERROR_CODES.search.queryTooLong,
  searchFail: SERVER_ERROR_CODES.search.fail,
};

function handleServiceError(error) {
  return mapServiceError(error, ERROR_MAP);
}

function serializeSearch(result) {
  return {
    name_matches: result.nameMatches.map((row) => ({ node_id: row.nodeId, name: row.name })),
    result_ref: result.resultRef,
    counts: {
      name: result.counts.name,
      semantic: result.counts.semantic,
      total: result.counts.total,
      name_truncated: result.counts.nameTruncated,
    },
    semantic_available: result.semanticAvailable,
    semantic_unavailable_reason: result.semanticUnavailableReason,
  };
}

router.post(
  '/',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const result = await searchService.search(req.user.full.id, {
        // `result_ref` is the ONLY snake_case request field (routes spec
        // §2.4.2 Decision — opaque replay token, accepted and ignored by MVP).
        query: req.body?.query,
        resultRef: req.body?.result_ref,
      });
      res.json(serializeSearch(result));
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

/**
 * §3.4 list-entry-click recording point (routes/search.md §2.4.0, register
 * (a)): records the `open` usage signal fire-and-forget and responds 204 —
 * a recording failure never surfaces.
 */
router.post(
  '/click',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const nodeId = Number(req.body?.node_id);
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      throw validationError(SERVER_ERROR_CODES.search.clickTargetRequired);
    }
    Promise.resolve()
      .then(() =>
        getUsageService().recordEvent({ userId: req.user.full.id, nodeId, action: USAGE_ACTION.OPEN })
      )
      .catch(() => {});
    res.status(204).end();
  })
);

module.exports = router;
