'use strict';

const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../../../utils/errorHandler');

const { scheduleBulkWorker } = require('../services/batchOperationService');
const { createOperationProgressStore } = require('../stores/operationProgress');
const opStore = createOperationProgressStore();

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

// POST /batch-delete
router.post('/batch-delete', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  const { jobId } = opStore.createJob(req.user.id, 'delete', { paths });
  scheduleBulkWorker(jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// POST /batch-move
router.post('/batch-move', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { moves, onConflict } = req.body;
  if (!moves || !Array.isArray(moves) || moves.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  const { jobId } = opStore.createJob(req.user.id, 'move', { moves, onConflict });
  scheduleBulkWorker(jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// POST /batch-copy
router.post('/batch-copy', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { copies, onConflict } = req.body;
  if (!copies || !Array.isArray(copies) || copies.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  const { jobId } = opStore.createJob(req.user.id, 'copy', { copies, onConflict });
  scheduleBulkWorker(jobId);
  res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
}));

// GET /bulk-operation/:jobId
router.get('/bulk-operation/:jobId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = opStore.getJob(jobId);
  if (!job) {
    throw notFoundError(SERVER_ERROR_CODES.files.jobNotFound);
  }
  if (String(job.userId) !== String(req.user.id)) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }
  res.json({
    status: job.status,
    progress: job.progress,
    total: job.total,
    results: job.results,
    errorMessage: job.errorMessage,
  });
}));

// POST /bulk-operation/:jobId/cancel
router.post('/bulk-operation/:jobId/cancel', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = opStore.getJob(jobId);
  if (!job) {
    throw notFoundError(SERVER_ERROR_CODES.files.jobNotFound);
  }
  if (String(job.userId) !== String(req.user.id)) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }
  opStore.setJobCancelled(jobId);
  res.json({ messageCode: SERVER_MESSAGE_CODES.files.cancelRequested, jobId });
}));

module.exports = router;
