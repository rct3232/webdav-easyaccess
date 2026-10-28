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
    // The `semantic` key and the `semantic_capped_segments` flag are present
    // exactly when the embed leg ran — an honestly EMPTY leg returns
    // `"semantic": []`; the gate-off degrade OMITS both (routes/search.md
    // §2.4 — absent and honestly empty are distinct wire states).
    ...(result.semantic
      ? {
          semantic: result.semantic.map((row) => ({
            node_id: row.nodeId,
            name: row.name,
            score: row.score,
          })),
        }
      : {}),
    result_ref: result.resultRef,
    counts: {
      name: result.counts.name,
      semantic: result.counts.semantic,
      total: result.counts.total,
      name_truncated: result.counts.nameTruncated,
      ...(result.counts.semanticCappedSegments !== undefined
        ? { semantic_capped_segments: result.counts.semanticCappedSegments }
        : {}),
    },
    ...(result.semanticUnavailableReason !== undefined
      ? { semantic_unavailable_reason: result.semanticUnavailableReason }
      : {}),
    // §2.4 (routes spec): the NL-parsed shared-grammar atoms — present
    // EXACTLY when the parse leg applied; absent, the response stays
    // byte-identical to the parser-free shape.
    ...(result.predicates !== undefined ? { predicates: result.predicates } : {}),
  };
}

router.post(
  '/',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const result = await searchService.search(req.user.full.id, {
        // `result_ref`/`predicates` are the snake_case request fields
        // (routes spec §2.4.2 Decision — the replay token, accepted and
        // ignored; the session predicate state is grammar-validated by the
        // service and discarded silently when malformed).
        query: req.body?.query,
        resultRef: req.body?.result_ref,
        predicates: req.body?.predicates,
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
        getUsageService().recordEvent({
          userId: req.user.full.id,
          nodeId,
          action: USAGE_ACTION.OPEN,
        })
      )
      .catch(() => {});
    res.status(204).end();
  })
);

module.exports = router;
