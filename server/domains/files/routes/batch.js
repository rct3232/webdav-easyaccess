'use strict';

const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const {
  asyncHandler,
  validationError,
  forbiddenError,
  notFoundError,
} = require('../../../utils/errorHandler');
const { parseNodeId } = require('../../../middleware/validateNodeIdParam');

const { scheduleBulkWorker } = require('../services/batchOperationService');
const { createOperationProgressStore } = require('../stores/operationProgress');
const opStore = createOperationProgressStore();

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');

// POST /batch-delete
router.post(
  '/batch-delete',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { nodeIds } = req.body;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const parsedNodeIds = nodeIds.map((id) => parseNodeId(id));

    const { jobId } = opStore.createJob(req.user.id, 'delete', { nodeIds: parsedNodeIds });
    scheduleBulkWorker(jobId);
    res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
  })
);

// POST /batch-move
router.post(
  '/batch-move',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { moves } = req.body;
    if (!moves || !Array.isArray(moves) || moves.length === 0) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const parsedMoves = moves.map((move) => ({
      sourceNodeId: parseNodeId(move.sourceNodeId),
      destinationParentNodeId: parseNodeId(move.destinationParentNodeId),
    }));

    const { jobId } = opStore.createJob(req.user.id, 'move', { moves: parsedMoves });
    scheduleBulkWorker(jobId);
    res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
  })
);

// POST /batch-copy
router.post(
  '/batch-copy',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { copies } = req.body;
    if (!copies || !Array.isArray(copies) || copies.length === 0) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const parsedCopies = copies.map((copy) => ({
      sourceNodeId: parseNodeId(copy.sourceNodeId),
      destinationParentNodeId: parseNodeId(copy.destinationParentNodeId),
      newName: copy.newName || null,
    }));

    const { jobId } = opStore.createJob(req.user.id, 'copy', { copies: parsedCopies });
    scheduleBulkWorker(jobId);
    res.status(HTTP_STATUS.ACCEPTED).json({ jobId });
  })
);

// GET /bulk-operation/:jobId
router.get(
  '/bulk-operation/:jobId',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
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
  })
);

// POST /bulk-operation/:jobId/cancel
router.post(
  '/bulk-operation/:jobId/cancel',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
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
  })
);

module.exports = router;
