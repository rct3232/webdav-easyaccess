'use strict';

const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError, validationError } = require('../../../utils/errorHandler');

// Middleware to check if user is admin (same pattern as the sibling modules)
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

/** Wire shaping per CODING_STYLE Express Patterns: snake_case response fields. */
function toWireRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: row.payload,
    created_at: row.createdAt,
  };
}

// Admin report list (§4.14 Tier A): persisted admin_reports runs — GC,
// startup fail-safe scan + boot content-hash completeness probe, cleanup.
// Paths are relative to the mount point (/reports via the maintenance module
// router — see docs/spec/server/routes/admin.md §2.1).
router.get(
  '/',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const adminReportsStore = require('../../../store/adminReportsStore');
    const reports = await adminReportsStore.listReports();
    res.json({ reports: reports.map(toWireRow) });
  })
);

router.get(
  '/:id',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const adminReportsStore = require('../../../store/adminReportsStore');
    const row = await adminReportsStore.getReport(req.params.id);
    if (!row) {
      throw createError(SERVER_ERROR_CODES.admin.reportNotFound, HTTP_STATUS.NOT_FOUND, {
        reportId: Number(req.params.id),
      });
    }
    res.json({ report: toWireRow(row) });
  })
);

// Kind/action-dispatched row repair. Known actions:
//   content_hash  — kind-dispatched: failsafe rows carrying the
//                   contentHashCompleteness section only; backfills ALL NULL
//                   filecache.content_hash (idempotent, streams blob hashes)
//   repair-sync   — delegates to the §2.2.3 fail-safe repair core
//   perm-delete   — delegates to the §2.2.3 permanent-delete purge core
router.post(
  '/:id/repair',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { repairAdminReport } = require('../services/adminReportsService');
    const params = req.body || {};
    if (!params || typeof params !== 'object' || !params.action) {
      throw validationError(SERVER_ERROR_CODES.admin.repairNotAvailable);
    }

    const { report, result, messageCode } = await repairAdminReport(req.params.id, params);

    res.json({
      messageCode: messageCode || SERVER_MESSAGE_CODES.admin.reportRepaired,
      report: toWireRow(report),
      result,
    });
  })
);

module.exports = router;
