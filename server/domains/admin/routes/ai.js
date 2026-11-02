'use strict';

/**
 * Admin AI governance routes (docs/spec/server/routes/admin.md §2.2.7).
 * Mounted by the config module at `/api/admin/ai` so server/index.js needs no
 * mount edit. All routes are DB-backed admin gated; responses are snake_case.
 */

const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError, mapServiceError } = require('../../../utils/errorHandler');
const { getLlmAdapter } = require('../../../infrastructure/llmAdapterRuntime');
const { createAiAdminService } = require('../services/aiAdminService');

const ERROR_MAP = {
  alreadyActive: SERVER_ERROR_CODES.admin.reembedAlreadyActive,
  modelUnavailable: SERVER_ERROR_CODES.admin.reembedModelUnavailable,
};

const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

/**
 * Service errors carry bare string codes; mapServiceError drops `params`, so
 * `active_jobs` (the single-active guard) is copied back explicitly. Errors
 * that already carry status+errorCode pass through unchanged.
 */
function handleServiceError(error) {
  if (error && error.errorCode) return error;
  const mapped = mapServiceError(error, ERROR_MAP);
  if (error && error.params != null && Object.keys(error.params).length > 0) {
    mapped.params = error.params;
  }
  return mapped;
}

let serviceInstance = null;
function service() {
  if (!serviceInstance) serviceInstance = createAiAdminService();
  return serviceInstance;
}

// Polled operations snapshot.
router.get(
  '/summary',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    // Read-through reconciliation keeps the panel correct after out-of-band
    // DB edits (the documented direct-SQL backstop). Provider-free: probes are
    // scheduled on the normal debounce, never awaited here.
    const adapter = getLlmAdapter();
    if (adapter && typeof adapter.reconcileConfiguredRoles === 'function') {
      try {
        await adapter.reconcileConfiguredRoles();
      } catch {
        /* read-through reconciliation is best-effort */
      }
    }
    res.json(await service().getSummary());
  })
);

// Read-only deterministic launcher preview.
router.get(
  '/reembed/preview',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    res.json(await service().getReembedPreview());
  })
);

// THE launcher: lock + model gate + single-active + journaled enqueue.
router.post(
  '/reembed',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(await service().launchReembed({ actor: req.user.id }));
    } catch (error) {
      throw handleServiceError(error);
    }
  })
);

module.exports = router;
