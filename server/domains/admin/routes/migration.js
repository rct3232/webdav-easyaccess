'use strict';

const express = require('express');
const {
  HTTP_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const { deriveDirection, destinationTypeForDirection } = require('../../../infrastructure/adapters/blobstore/config');

const VALID_MODES = ['dry-run', 'apply'];
const DEST_REQUIRED_FIELDS = {
  s3: ['bucket', 'accessKey', 'secretKey'],
  webdav: ['url', 'username', 'password'],
};

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

/**
 * Validate and normalize the migration request payload.
 * `expectedDestType` is derived server-side from the composition's
 * fileStorageMode; a dest.type that does not match it is invalid.
 * Returns `{ errorCode }` for a 400, or `{ payload }` for a valid body.
 */
function parseMigrationPayload(body, expectedDestType) {
  const {
    mode = 'dry-run',
    force = false,
    dest,
  } = body || {};

  if (!VALID_MODES.includes(mode)) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  if (!dest || typeof dest !== 'object' || !dest.type) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
  }
  if (dest.type !== 's3' && dest.type !== 'webdav') {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  if (dest.type !== expectedDestType) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationInvalidPayload };
  }
  const missing = DEST_REQUIRED_FIELDS[dest.type].filter((field) => !dest[field]);
  if (missing.length > 0) {
    return { errorCode: SERVER_ERROR_CODES.admin.migrationMissingRequired };
  }

  return {
    payload: {
      mode,
      force: Boolean(force),
      dest,
    },
  };
}

/**
 * Background worker: drives one migration job to a terminal state.
 * Progress updates are written on every onProgress callback.
 */
function runMigrationWorker(jobId, { destConfig, mode, force }) {
  const { getComposition } = require('../../../service/composition');
  const { migrationService, migrationJobStore } = getComposition();

  migrationJobStore.update(jobId, { status: 'running' });

  let total = 0;
  return migrationService
    .run({
      destConfig,
      mode,
      force,
      onProgress: ({ total: jobTotal, done, current, copied, skipped, failed }) => {
        total = jobTotal;
        migrationJobStore.update(jobId, {
          progress: done,
          total: jobTotal,
          current: current && current.path ? current.path : null,
          results: { copied, skipped, failed, errors: [] },
        });
      },
    })
    .then((results) => {
      migrationJobStore.update(jobId, {
        status: 'completed',
        progress: total,
        total,
        current: null,
        results,
        completedAt: new Date().toISOString(),
      });
    })
    .catch((error) => {
      migrationJobStore.update(jobId, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date().toISOString(),
      });
    });
}

function dispatchWorker(jobId, params) {
  if (process.env.WEA_SKIP_MIGRATION_WORKER === '1') return;
  setImmediate(() => {
    runMigrationWorker(jobId, params);
  });
}

const router = express.Router();

// Migration info: source + direction derived from the current config
router.get('/migration/info', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { fileStorageMode } = getComposition();
  res.json({ source: fileStorageMode, direction: deriveDirection(fileStorageMode) });
}));

// Start a blob migration job (202 + poll contract)
router.post('/migration/blobs', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore, fileStorageMode } = getComposition();

  const direction = deriveDirection(fileStorageMode);
  const expectedDestType = destinationTypeForDirection(direction);
  const parsed = parseMigrationPayload(req.body, expectedDestType);
  if (parsed.errorCode) {
    throw createError(parsed.errorCode, HTTP_STATUS.BAD_REQUEST);
  }

  if (migrationJobStore.hasRunning()) {
    throw createError(SERVER_ERROR_CODES.admin.migrationAlreadyRunning, HTTP_STATUS.CONFLICT);
  }

  const { mode, force, dest } = parsed.payload;
  const job = migrationJobStore.create({ direction, mode });
  const destConfig = { type: dest.type, ...dest };

  dispatchWorker(job.jobId, { destConfig, mode, force });

  res.status(HTTP_STATUS.ACCEPTED).json({ jobId: job.jobId });
}));

// Get migration job status/progress
router.get('/migration/jobs/:jobId', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore } = getComposition();
  const job = migrationJobStore.get(req.params.jobId);
  if (!job) {
    throw createError(SERVER_ERROR_CODES.admin.migrationJobNotFound, HTTP_STATUS.NOT_FOUND);
  }
  res.json(job);
}));

// Cancel a running migration job
router.post('/migration/jobs/:jobId/cancel', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { migrationJobStore } = getComposition();
  if (!migrationJobStore.cancel(req.params.jobId)) {
    throw createError(SERVER_ERROR_CODES.admin.migrationJobNotFound, HTTP_STATUS.NOT_FOUND);
  }
  res.json({ messageCode: SERVER_MESSAGE_CODES.admin.migrationCancelled, jobId: req.params.jobId });
}));

module.exports = router;
