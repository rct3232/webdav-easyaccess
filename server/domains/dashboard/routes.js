const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const requireNonAdmin = require('../../middleware/requireNonAdmin');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const dashboardService = require('./service');

const ERROR_MAP = {
  emptyNodeIds: SERVER_ERROR_CODES.dashboard.emptyNodeIds,
  invalidSuggestionId: SERVER_ERROR_CODES.dashboard.invalidSuggestionId,
  suggestionNotFound: SERVER_ERROR_CODES.dashboard.suggestionNotFound,
};

function serializeSuggestion(row) {
  return {
    id: row.id,
    node_id: row.nodeId,
    kind: row.kind,
    path: row.path,
    size_bytes: row.sizeBytes,
    reason: row.reason,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
  };
}

function serializeSummary(result) {
  return {
    duplicates: {
      group_count: result.duplicates.groupCount,
      duplicate_count: result.duplicates.duplicateCount,
      reclaimable_bytes: result.duplicates.reclaimableBytes,
    },
    // vector near-dup block: present ONLY when the leg is available
    // (nearDupFinderService degrade — absent section, never an error)
    ...(result.nearDuplicates
      ? {
          near_duplicates: {
            group_count: result.nearDuplicates.groupCount,
            duplicate_count: result.nearDuplicates.duplicateCount,
          },
        }
      : {}),
    suggestions: result.suggestions.map(serializeSuggestion),
    trash: {
      item_count: result.trash.itemCount,
      total_bytes: result.trash.totalBytes,
      oldest_deleted_at: result.trash.oldestDeletedAt,
      retention_days: result.trash.retentionDays,
    },
  };
}

// GET /api/dashboard — one-shot self-storage hygiene + persisted suggestions
// read (the generator pass materializes pending rows inside the read).
router.get(
  '/',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await dashboardService.getDashboardSummary(req.user.full.id);
      res.json(serializeSummary(result));
    } catch (e) {
      throw mapServiceError(e, ERROR_MAP);
    }
  })
);

// POST /api/dashboard/suggestions/accept — checked rows -> trash as ONE
// journaled command (routes/dashboard.md §2.4); the response carries the
// undo pointer, undo executes via POST /api/actions/:id/undo.
router.post(
  '/suggestions/accept',
  authenticateToken,
  requireUser,
  requireNonAdmin,
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
        ...(result.actionId != null ? { undo: { action_id: result.actionId } } : {}),
      });
    } catch (e) {
      throw mapServiceError(e, ERROR_MAP);
    }
  })
);

// POST /api/dashboard/suggestions/dismiss — per-row dismiss of a persisted
// suggestion (pending -> dismissed; no toast, no journal row).
router.post(
  '/suggestions/dismiss',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await dashboardService.dismissSuggestion(
        req.user.full.id,
        req.body ? req.body.suggestionId : undefined
      );
      res.json({ id: result.id, state: result.state });
    } catch (e) {
      throw mapServiceError(e, ERROR_MAP);
    }
  })
);

module.exports = router;
