const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const dashboardService = require('./service');

const ERROR_MAP = {
  emptyNodeIds: SERVER_ERROR_CODES.dashboard.emptyNodeIds,
};

function serializeSuggestion(row) {
  return {
    node_id: row.nodeId,
    kind: row.kind,
    path: row.path,
    size_bytes: row.sizeBytes,
    reason: { kind: row.reason.kind, keep_node_id: row.reason.keepNodeId },
  };
}

function serializeSummary(result) {
  return {
    duplicates: {
      group_count: result.duplicates.groupCount,
      duplicate_count: result.duplicates.duplicateCount,
      reclaimable_bytes: result.duplicates.reclaimableBytes,
    },
    suggestions: result.suggestions.map(serializeSuggestion),
    trash: {
      item_count: result.trash.itemCount,
      total_bytes: result.trash.totalBytes,
      oldest_deleted_at: result.trash.oldestDeletedAt,
      retention_days: result.trash.retentionDays,
    },
  };
}

// GET /api/dashboard — one-shot self-storage hygiene + suggestions read.
router.get(
  '/',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const result = await dashboardService.getDashboardSummary(req.user.full.id);
      res.json(serializeSummary(result));
    } catch (e) {
      throw mapServiceError(e, ERROR_MAP);
    }
  })
);

// POST /api/dashboard/suggestions/accept — checked rows -> trash (P0: no
// journal row; trash-restore is the undo path, routes/dashboard.md §2.4).
router.post(
  '/suggestions/accept',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    try {
      const result = await dashboardService.acceptSuggestions(
        req.user.full.id,
        req.user.full,
        req.body ? req.body.nodeIds : undefined
      );
      res.json({
        trashed: result.trashed,
        rejected_not_owned: result.rejectedNotOwned,
        skipped: result.skipped,
      });
    } catch (e) {
      throw mapServiceError(e, ERROR_MAP);
    }
  })
);

module.exports = router;
